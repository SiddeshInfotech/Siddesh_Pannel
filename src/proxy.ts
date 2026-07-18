/**
 * proxy.ts — Next.js Route Protection Proxy for JWT validation
 *
 * Security model:
 * - Runs on EVERY request before any page/API handler
 * - Decodes URL and normalizes paths to prevent middleware bypass attempts
 * - Reads the HttpOnly 'admin_token' cookie
 * - Verifies JWT signature + expiry using jose (edge-compatible)
 * - Enforces the admin allowlist by checking the payload email exists in admin_users (multi-admin)
 * - Checks session revocation in Supabase 'admin_sessions'
 * - Injects Cache-Control: no-store to prevent page caching on all authenticated routes
 *
 * Public routes (no auth required):
 * - POST /api/auth/login  (credential verification)
 * - POST /api/auth/logout (cookie clearing)
 * - POST /api/activate    (Android tablet handshake — no admin token)
 * - Static assets, Next.js internals
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, importSPKI } from 'jose';
import { verifyAdminToken, COOKIE_NAME } from './lib/auth';
import { supabaseAdmin } from './lib/supabase';
import { logger } from './lib/logger';

// Must match auth.ts: admin JWTs are verified with the admin signing key
// (separate from the device-license PRIVATE_KEY), falling back to PRIVATE_KEY
// during transition.
const privateKeyPem = process.env.ADMIN_JWT_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
if (!privateKeyPem) {
  throw new Error('CRITICAL CONFIG ERROR: ADMIN_JWT_PRIVATE_KEY/PRIVATE_KEY environment variable is missing.');
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

// Pre-load the public key using jose (edge-compatible)
let keyPromise: Promise<any>;
try {
  const publicKeyPem = extractPublicKeyFromPrivateKey(privateKeyPem);
  keyPromise = importSPKI(publicKeyPem, 'ES256');
} catch (err) {
  console.error('Failed to extract public key in proxy:', err);
  keyPromise = Promise.reject(err);
}

const JWT_ISSUER = 'siddesh-lms-admin';
const JWT_AUDIENCE = 'siddesh-lms-client';
const isProd = process.env.NODE_ENV === 'production';

// Routes that do NOT require admin JWT authentication
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/activate',
  '/api/seed', // Self-guarded: returns 403 in production, requires SEED_SECRET in dev
];

// Build a per-request, nonce-based Content-Security-Policy.
//
// script-src: 'nonce-<random>' + 'strict-dynamic' — NO 'unsafe-inline', NO
//   'unsafe-eval' in production. This is the real XSS hardening: an injected
//   <script> cannot run because it lacks the unguessable per-request nonce, and
//   strict-dynamic lets Next.js's own nonced bootstrap load the app chunks.
//   ('unsafe-eval' is added in DEV only — React uses eval for dev error overlays.)
// style-src: keeps 'unsafe-inline' on purpose. React inline style={{…}} attributes
//   and the Google-Fonts @import in globals.css CANNOT carry a nonce (CSP nonces
//   only apply to <style> elements, not style="" attributes). Inline styles are a
//   far lower XSS risk than scripts, so this is the correct, non-breaking trade-off.
function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://pwvilsmuxyegangnboub.supabase.co",
    "connect-src 'self' https://pwvilsmuxyegangnboub.supabase.co wss://pwvilsmuxyegangnboub.supabase.co",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ') + ';';
}

export async function proxy(req: NextRequest) {
  // Per-request CSP nonce. Next.js reads it from the request's Content-Security-Policy
  // header and stamps it onto every framework/page <script> it emits, so only those
  // scripts run — an injected inline script has no matching nonce and is blocked.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, !isProd);

  const injectSecurityHeaders = (res: NextResponse, isAuthenticatedRoute = false): NextResponse => {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    res.headers.set('Content-Security-Policy', csp);
    if (isAuthenticatedRoute) {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.headers.set('Pragma', 'no-cache');
      res.headers.set('Expires', '0');
    }
    return res;
  };

  // Forward the nonce to Next's renderer ONLY on GET document/RSC navigations — that
  // is what carries the nonce into the rendered HTML. Server Actions (POST) and other
  // methods get a plain pass-through identical to the pre-CSP behavior, so rewriting
  // request headers can NEVER interfere with Next's Server-Action origin validation
  // (which was returning 500 on POST /keys and /payments).
  const pageNext = (): NextResponse => {
    if (req.method !== 'GET') {
      return NextResponse.next();
    }
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  let pathname: string;
  try {
    pathname = decodeURIComponent(req.nextUrl.pathname).trim().replace(/\/+/g, '/');
  } catch {
    return injectSecurityHeaders(
      NextResponse.json({ error: 'Blocked: Invalid URI encoding.' }, { status: 400 })
    );
  }

  // Traversal attack checks
  if (pathname.includes('/..') || pathname.includes('../') || pathname.includes('/.')) {
    return injectSecurityHeaders(
      NextResponse.json({ error: 'Blocked: Traversal pattern detected.' }, { status: 400 })
    );
  }

  // Always allow public API routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return injectSecurityHeaders(NextResponse.next(), false);
  }

  // Always allow Next.js internal routes and genuine static assets. We match a
  // strict extension allowlist at the END of the path — NOT a bare `includes('.')`,
  // which let any dotted path (e.g. `/keys/x.y`) skip authentication entirely.
  const STATIC_EXT = /\.(?:png|jpe?g|svg|ico|webp|gif|css|js|map|woff2?|ttf|eot|txt|json)$/i;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/siddesh_logo') ||
    STATIC_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Read the JWT from HttpOnly cookie
  const token = req.cookies.get(COOKIE_NAME)?.value;
  logger.info({ event: 'MIDDLEWARE_AUTH_CHECK', path: pathname, hasToken: !!token });

  // No token — reject
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return injectSecurityHeaders(
        NextResponse.json(
          { error: 'Unauthorized. Please log in.' },
          { status: 401 }
        ),
        true
      );
    }
    // For pages, the AuthWrapper handles the UI — just let it through but protect with cache headers
    return injectSecurityHeaders(pageNext(), true);
  }

  // Verify JWT
  try {
    const key = await keyPromise;
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const email = payload.email as string;
    const sid = payload.sid as string | undefined;
    const role = payload.role as string | undefined;
    const purpose = payload.purpose as string | undefined;

    // ── Token-type gate (closes the MFA-challenge-token bypass) ─────────────
    // A pre-MFA challenge token (purpose:'mfa-challenge', no sid/role) is signed
    // with the same key/issuer/audience but must NEVER grant page/API access.
    // Require an explicit admin-session token. Fail closed.
    if (purpose !== 'admin-session' || role !== 'administrator' || !sid) {
      console.error('[proxy] Access blocked: token is not a valid admin session.');
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
        : NextResponse.redirect(new URL('/lms-admin/', req.url));
      response.cookies.set(COOKIE_NAME, '', {
        maxAge: 0, path: '/', secure: isProd, httpOnly: true, sameSite: 'strict',
      });
      return injectSecurityHeaders(response, true);
    }

    // ── Admin Allowlist (multi-admin) ──────────────────────────────────────
    // The panel supports up to 5 co-equal administrators. Grant access to any
    // JWT whose email matches a row in admin_users (case-insensitive). This
    // replaces the previous single-admin lock that only accepted the
    // first-created account. Session revocation/expiry is still enforced below.
    const { data: adminUsers, error: queryError } = await supabaseAdmin
      .from('admin_users')
      .select('email')
      .ilike('email', email)
      .limit(1);

    const adminUser = adminUsers?.[0];
    if (queryError || !adminUser) {
      console.error('[proxy] Access blocked: JWT email is not a registered admin.');

      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Unauthorized email.' }, { status: 401 })
        : NextResponse.redirect(new URL('/lms-admin/', req.url));
      
      response.cookies.set(COOKIE_NAME, '', {
        maxAge: 0,
        path: '/',
        secure: isProd,
        httpOnly: true,
        sameSite: 'strict',
      });
      return injectSecurityHeaders(response, true);
    }

    // Stateful session check in database (mandatory — sid is guaranteed present
    // by the token-type gate above; fail closed on any error/miss).
    {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('admin_sessions')
        .select('revoked, expires_at')
        .eq('session_id', sid)
        .maybeSingle();

      if (sessionError || !session || session.revoked || new Date() > new Date(session.expires_at)) {
        console.error('[proxy] Session revoked, expired, or unverifiable.');

        const response = pathname.startsWith('/api/')
          ? NextResponse.json({ error: 'Session revoked or expired.' }, { status: 401 })
          : NextResponse.redirect(new URL('/lms-admin/', req.url));

        response.cookies.set(COOKIE_NAME, '', {
          maxAge: 0,
          path: '/',
          secure: isProd,
          httpOnly: true,
          sameSite: 'strict',
        });
        return injectSecurityHeaders(response, true);
      }
    }

    return injectSecurityHeaders(pageNext(), true);
  } catch (err) {
    console.error('❌ verifyAdminToken in proxy failed:', err);
    // Expired or tampered token
    if (pathname.startsWith('/api/')) {
      return injectSecurityHeaders(
        NextResponse.json(
          { error: 'Session expired. Please log in again.' },
          { status: 401 }
        ),
        true
      );
    }
    // Clear the bad cookie and continue
    const response = pageNext();
    response.cookies.set(COOKIE_NAME, '', {
      maxAge: 0,
      path: '/',
      secure: isProd,
      httpOnly: true,
      sameSite: 'strict',
    });
    return injectSecurityHeaders(response, true);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, .png, .jpg, .svg etc
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)',
  ],
};

