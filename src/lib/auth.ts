/**
 * auth.ts — Secure JWT utilities (asymmetric ES256) and session tracking for admin authentication
 *
 * Security design:
 * - Uses 'jose' library (industry standard, edge-runtime compatible)
 * - ES256 signed with ECDSA private key from env variables (asymmetric)
 * - Token stored ONLY in HttpOnly + Secure + SameSite=Strict cookie
 * - XSS-proof: JavaScript (document.cookie) cannot read HttpOnly cookies
 * - 8-hour expiry enforced both at signing and at verification
 * - Stateful Session Revocation: verifies JWT signature first (stateless),
 *   then queries Supabase 'admin_sessions' to check for revocation.
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cache } from 'react';
import { supabaseFor, type Panel } from './supabase';
import { logger } from './logger';
import { APP_PANEL } from './appPanel';

const isProd = process.env.NODE_ENV === 'production';
// One cookie per admin app (src/lib/appPanel.ts), so an LMS-Admin and a Lab-Admin session coexist
// in the same browser. LMS-Admin keeps its original cookie name.
const COOKIE_BASE = APP_PANEL === 'lab' ? 'lab_admin_token' : 'admin_token';
export const COOKIE_NAME = isProd ? `__Host-${COOKIE_BASE}` : COOKIE_BASE;
const EXPIRY_SECONDS = 8 * 60 * 60; // 8 hours
const JWT_ISSUER = 'siddesh-lms-admin';
const JWT_AUDIENCE = 'siddesh-lms-client';

// Admin-session JWTs are signed with a key SEPARATE from the device-license
// signing key (PRIVATE_KEY). Reusing one key across two trust domains means a
// compromise of either affects both; ADMIN_JWT_PRIVATE_KEY isolates admin auth.
// Falls back to PRIVATE_KEY for transition until the dedicated key is provisioned.
const privateKeyPem = process.env.ADMIN_JWT_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
if (!privateKeyPem) {
  throw new Error('CRITICAL CONFIG ERROR: ADMIN_JWT_PRIVATE_KEY/PRIVATE_KEY environment variable is missing.');
}
if (!process.env.ADMIN_JWT_PRIVATE_KEY) {
  console.warn('[auth] ADMIN_JWT_PRIVATE_KEY not set — admin JWTs share the license key. Provision a dedicated key.');
}

// Derive public key from the private key PEM (cross-platform, edge compatible)
function extractPublicKeyFromPrivateKey(privKeyPem: string): string {
  const base64 = privKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  
  const binaryString = atob(base64);
  const der = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    der[i] = binaryString.charCodeAt(i);
  }

  let pubKeyOffset = -1;
  for (let i = 0; i < der.length - 4; i++) {
    if (der[i] === 0x03 && der[i+1] === 0x42 && der[i+2] === 0x00 && der[i+3] === 0x04) {
      pubKeyOffset = i;
      break;
    }
  }

  if (pubKeyOffset === -1) {
    throw new Error('Could not find public key coordinates in private key DER');
  }

  const bitStringLength = 2 + 66; // tag, length, unused bits, and 65 bytes of point coordinates
  const bitString = der.subarray(pubKeyOffset, pubKeyOffset + bitStringLength);

  const spkiPrefix = new Uint8Array([
    0x30, 0x59, // SEQUENCE, length 89
    0x30, 0x13, // SEQUENCE, length 19 (AlgorithmIdentifier)
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // id-ecPublicKey
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // secp256r1 / P-256
  ]);

  const spkiDer = new Uint8Array(spkiPrefix.length + bitString.length);
  spkiDer.set(spkiPrefix, 0);
  spkiDer.set(bitString, spkiPrefix.length);

  let bin = '';
  for (let i = 0; i < spkiDer.length; i++) {
    bin += String.fromCharCode(spkiDer[i]);
  }
  const spkiBase64 = btoa(bin);

  const matches = spkiBase64.match(/.{1,64}/g);
  const formattedBase64 = matches ? matches.join('\n') : spkiBase64;

  return `-----BEGIN PUBLIC KEY-----\n${formattedBase64}\n-----END PUBLIC KEY-----\n`;
}

// Pre-load keys to optimize execution path (caches promises)
const signingKeyPromise = importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'ES256');

let verificationKeyPromise: Promise<any> /* eslint-disable-line @typescript-eslint/no-explicit-any */;
try {
  const normalizedPrivateKey = privateKeyPem.replace(/\\n/g, '\n');
  const publicKeyPem = extractPublicKeyFromPrivateKey(normalizedPrivateKey);
  verificationKeyPromise = importSPKI(publicKeyPem, 'ES256');
} catch (err) {
  console.error('Failed to extract public key from private key:', err);
  verificationKeyPromise = Promise.reject(err);
}

async function getSigningKey() {
  return await signingKeyPromise;
}

async function getVerificationKey() {
  return await verificationKeyPromise;
}

/**
 * Sign a new admin JWT token using asymmetric ES256
 */
export async function signAdminToken(email: string, sessionId: string, panel: 'lms' | 'lab'): Promise<string> {
  const key = await getSigningKey();
  // `purpose: 'admin-session'` makes a fully-authenticated session token
  // STRUCTURALLY distinct from the pre-MFA challenge token (purpose:
  // 'mfa-challenge'). verifyAdminToken/proxy require this exact value, so a
  // challenge token can never be replayed as a session. `sid` is mandatory so
  // every session is revocable.
  // `panel` (admin_users.panel) decides which admin dashboard + table set this session uses
  // (src/lib/panelTables.ts). It is inside the signed token, so a client cannot switch it.
  return await new SignJWT({ email, role: 'administrator', sid: sessionId, purpose: 'admin-session', panel })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(key);
}

/**
 * Verify a JWT token string. Returns payload or null if invalid/expired/revoked.
 */
export async function verifyAdminToken(
  token: string
): Promise<{ email: string; role: string; sid?: string; panel: 'lms' | 'lab' } | null> {
  try {
    const key = await getVerificationKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const email = payload.email as string;
    const sid = payload.sid as string | undefined;
    const role = payload.role as string | undefined;
    const purpose = payload.purpose as string | undefined;
    // Sessions issued before the Lab-Admin split carry no panel claim: they are LMS-Admin.
    const panel = payload.panel === 'lab' ? 'lab' : 'lms';

    // ── Token-type gate (closes the MFA-challenge-token bypass) ───────────────
    // ONLY a fully-authenticated session token may stand in for a session. The
    // pre-MFA challenge token shares the signing key/issuer/audience but carries
    // purpose:'mfa-challenge' and no sid/role — reject anything that isn't an
    // explicit admin-session. Fail CLOSED.
    if (purpose !== 'admin-session' || role !== 'administrator' || !sid) {
      logger.warn({ event: 'TOKEN_REJECTED_WRONG_TYPE', purpose: purpose ?? null, hasSid: !!sid });
      return null;
    }

    // A session is valid only in the admin app that issued it (LMS-Admin vs Lab-Admin).
    if (panel !== APP_PANEL) {
      logger.warn({ event: 'TOKEN_REJECTED_WRONG_PANEL', panel, appPanel: APP_PANEL });
      return null;
    }

    // ── Stateful revocation check (mandatory; fail closed) ────────────────────
    // Sessions live in the database of the panel that issued them (LMS-Admin or Lab-Admin).
    const { data: session, error } = await supabaseFor(panel)
      .from('admin_sessions')
      .select('revoked, expires_at')
      .eq('session_id', sid)
      .maybeSingle();

    if (error || !session) {
      // No silent stateless fallback: if we cannot positively confirm the
      // session is live, deny. (The admin_sessions table is a hard dependency.)
      logger.error({ event: 'SESSION_LOOKUP_FAILED', sid, error: error?.message ?? 'no-row' });
      return null;
    }

    if (session.revoked || new Date() > new Date(session.expires_at)) {
      return null; // Session is revoked or expired
    }

    logger.info({ event: 'TOKEN_VERIFIED', adminId: sid });
    return { email, role, sid, panel };
  } catch (err) {
    console.error('❌ verifyAdminToken failed:', err);
    return null;
  }
}

/**
 * Read and verify the admin session from the current request's cookies.
 * Use in Server Components and Server Actions.
 * Returns null if not authenticated or token expired/revoked.
 */
export const getAdminSession = cache(async (): Promise<{ email: string; role: string; panel: 'lms' | 'lab' } | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  logger.info({ event: 'SESSION_CHECK', hasToken: !!token });
  if (!token) return null;
  const verified = await verifyAdminToken(token);
  logger.info({ event: 'SESSION_VERIFICATION_RESULT', verified: !!verified });
  return verified;
});

/**
 * Panel ('lms' | 'lab') of the current request's admin token, from its signature-verified
 * claims only (no DB round trip) — used to pick the table set on every query. Authentication
 * itself is still enforced by getAdminSession() in each page/action. Null without a valid token.
 */
export const getAdminPanel = cache(async (): Promise<'lms' | 'lab' | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await getVerificationKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (payload.purpose !== 'admin-session') return null;
    const panel = payload.panel === 'lab' ? 'lab' : 'lms';
    return panel === APP_PANEL ? panel : null;
  } catch {
    return null;
  }
});

/**
 * Attach the auth cookie to a NextResponse.
 * Cookie flags: HttpOnly, Secure, SameSite=Strict — XSS + CSRF proof.
 * Uses __Host- prefix which requires secure: true, path: '/' and no domain.
 */
export function setAuthCookie(res: NextResponse, token: string): NextResponse {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // Must be true for __Host- cookie
    sameSite: 'strict',
    path: '/',
    maxAge: EXPIRY_SECONDS,
  });
  return res;
}

/**
 * Clear the auth cookie (logout).
 */
export function clearAuthCookie(res: NextResponse): NextResponse {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}

/**
 * Log a security event to the audit trail (security_events table).
 */
export async function logSecurityEvent(
  email: string,
  eventType: string,
  ip: string | null,
  userAgent: string | null,
  panel: Panel = 'lms'
): Promise<void> {
  try {
    const { error } = await supabaseFor(panel).from('security_events').insert({
      email,
      event_type: eventType,
      ip: ip || 'unknown',
      user_agent: userAgent || 'unknown',
    });
    if (error) {
      console.error('Failed to log security event:', error.message);
    }
  } catch (err) {
    console.error('Error logging security event:', err);
  }
}

/**
 * Sign a 2-minute temporary challenge token for Phase 1 of MFA login.
 */
export async function signChallengeToken(email: string, nonce: string, panel: Panel): Promise<string> {
  const key = await getSigningKey();
  return await new SignJWT({ email, purpose: 'mfa-challenge', nonce, panel })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('2m')
    .sign(key);
}

/**
 * Verify a temporary challenge token and return its payload.
 */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function verifyChallengeToken(token: string): Promise<any | null> {
  try {
    const key = await getVerificationKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (payload.purpose !== 'mfa-challenge') {
      return { error: 'Invalid purpose' };
    }

    return {
      email: payload.email as string,
      nonce: payload.nonce as string,
      panel: (payload.panel === 'lab' ? 'lab' : 'lms') as Panel,
    };
  } catch (err: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
    console.error('❌ verifyChallengeToken failed:', err);
    return { error: err.message || String(err) };
  }
}


/**
 * Finds an admin account by email in ONE panel's login table (admin_users / lab_admin_users).
 * Each admin app signs in only its own panel's accounts (src/lib/appPanel.ts).
 */
export async function findAdminUser(
  email: string,
  panel: Panel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ user: any | null; error: string | null }> {
  let db;
  try {
    db = supabaseFor(panel);
  } catch (err) {
    // Lab database not configured: fail closed, same response as an unknown account.
    logger.error({ event: 'ADMIN_LOOKUP_DB_UNAVAILABLE', panel, error: String(err) });
    return { user: null, error: 'Admin database unavailable' };
  }
  const { data, error } = await db
    .from('admin_users')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) return { user: null, error: error.message };
  return { user: data?.[0] ?? null, error: null };
}
