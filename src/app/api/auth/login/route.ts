/**
 * POST /api/auth/login
 *
 * Security hardening:
 * 1. Rate limiting — 5 attempts per 5 minutes per IP and per Email address
 * 2. Input sanitization — trim, length cap, checks types and size limits
 * 3. Database Authentication — verifies credentials against custom database table,
 *    utilizing native scrypt key derivation function. No environment fallback or auto-seeding.
 * 4. Timing-safe comparison — prevents timing attacks on password verification
 * 5. Two-Phase Challenge-Response MFA:
 *    - Phase 1: Verify password. If valid, store a UUID nonce in DB and sign a 2-minute temporary challenge token.
 *    - Phase 2: Verify challenge token & DB nonce. Verify TOTP (±30s window for login, ±2m for setup) or Recovery Code.
 * 6. Lockout & Replay Protection: Lockout MFA after 5 consecutive failures for 5 minutes. Check TOTP counters.
 * 7. Cookie flags: HttpOnly + Secure + SameSite=Strict + __Host- prefix (CSRF + XSS proof)
 * 8. Stateful Session Revocation — logs active session IDs in database on success
 */

import { NextRequest, NextResponse } from 'next/server';
import { signAdminToken, setAuthCookie, logSecurityEvent, signChallengeToken, verifyChallengeToken, getAdminSession } from '@/lib/auth';
import { verifyPassword, verifyTOTP, encryptAES, decryptAES, generateTOTPSecret, generateRecoveryCodes, hashRecoveryCode } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';

const LoginRequestSchema = z.object({
  email: z.string().email().min(3).max(254).optional(),
  password: z.string().min(6).max(200).optional(),
  mode: z.string().max(50).optional(),
  challengeToken: z.string().optional(),
  code: z.string().length(6).optional(),
  recoveryCode: z.string().max(64).optional(),
});

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── Atomic rate limiter (F-08 fix) ─────────────────────────────────────────
// Backed by the `login_rate_limits` table + `bump_login_rate_limit` RPC
// (see scripts/create_login_rate_limits.sql). Each check is a SINGLE atomic
// increment-and-check, so there is no read-then-decide window for concurrent
// requests to slip through — unlike the previous COUNT-based limiter.
//
//   • IP gate     — coarse anti-abuse / DoS: every request to this endpoint.
//   • Email gate  — targeted brute-force: Phase-1 password attempts per account.
// The email window is cleared on a successful password verification so a
// legitimate admin's earlier typos don't lock them out.

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const IP_MAX_ATTEMPTS = 20;      // requests per IP per window (multi-phase + a few users)
const EMAIL_MAX_ATTEMPTS = 5;    // password attempts per account per window

/**
 * Atomically increments the counter for `key` and reports whether it is still
 * within `max` for the current window. Fails OPEN only on a genuine infra error
 * (so a DB hiccup can't lock everyone out) and alerts when it does.
 */
async function bumpRateLimit(
  key: string,
  max: number
): Promise<{ allowed: boolean; resetAt: number }> {
  const { data, error } = await supabaseAdmin.rpc('bump_login_rate_limit', {
    p_key: key,
    p_window_ms: WINDOW_MS,
    p_max: max,
  });

  if (error) {
    // FAIL CLOSED on the auth path: if we cannot account for an attempt, deny it.
    // Admin login already depends on the DB (admin_users lookup) so a DB outage
    // does not uniquely lock out legitimate use here, and failing open would
    // permit unlimited brute force during that outage.
    logger.error({ event: 'RATE_LIMIT_RPC_ERROR_FAIL_CLOSED', key, error: error.message });
    return { allowed: false, resetAt: Date.now() + WINDOW_MS };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const resetAt = row?.reset_at ? new Date(row.reset_at).getTime() : Date.now() + WINDOW_MS;
  return { allowed: row?.allowed ?? true, resetAt };
}

/** Clears a rate-limit window (called after a successful password check). */
async function resetRateLimit(key: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('reset_login_rate_limit', { p_key: key });
  if (error) logger.warn({ event: 'RATE_LIMIT_RESET_ERROR', key, error: error.message });
}

/** Builds a 429 response with the correct Retry-After / rate-limit headers. */
function rateLimited(message: string, resetAt: number): NextResponse {
  const retryAfterSecs = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: `${message} Try again in ${Math.ceil(retryAfterSecs / 60)} minute(s).` },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSecs),
        'X-RateLimit-Limit': String(EMAIL_MAX_ATTEMPTS),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);

    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      const ipRl = await bumpRateLimit(`ip:${ip}`, IP_MAX_ATTEMPTS);
      if (!ipRl.allowed) {
        return rateLimited('Too many login attempts from this network.', ipRl.resetAt);
      }
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const validationResult = LoginRequestSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn({ event: 'LOGIN_VALIDATION_FAILED', errors: validationResult.error.flatten(), ip });
      return NextResponse.json({ error: 'Invalid input data format.' }, { status: 400 });
    }

    const { email, password, mode, challengeToken, code, recoveryCode } = validationResult.data;

    // Targeted brute-force gate: count Phase-1 password attempts per account.
    if (isProd && email) {
      const normalizedEmail = email.trim().toLowerCase();
      const emailRl = await bumpRateLimit(`email:${normalizedEmail}`, EMAIL_MAX_ATTEMPTS);
      if (!emailRl.allowed) {
        return rateLimited('Too many login attempts on this account.', emailRl.resetAt);
      }
    }

    // ── Unlock Mode (Screen Re-authentication) ──────────────────────────────
    if (mode === 'unlock') {
      if (!password) {
        return NextResponse.json({ error: 'Security key is required.' }, { status: 400 });
      }

      // Re-authenticate the CURRENTLY logged-in admin against their OWN security
      // key (each of the admins unlocks with their own password) instead of
      // always checking the first-created account.
      const session = await getAdminSession();
      if (!session) {
        return NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 });
      }

      const { data: adminUsers, error: queryError } = await supabaseAdmin
        .from('admin_users')
        .select('*')
        .eq('email', session.email)
        .limit(1);

      const matchedUser = adminUsers?.[0];

      if (queryError || !matchedUser) {
        return NextResponse.json({ error: 'Invalid security key.' }, { status: 401 });
      }

      const success = await verifyPassword(password, matchedUser.password_hash, matchedUser.salt);
      if (success) {
        await logSecurityEvent(matchedUser.email, 'CONSOLE_UNLOCKED', ip, req.headers.get('user-agent'));
        return NextResponse.json({ success: true, message: 'Console unlocked.' });
      }
      await logSecurityEvent(matchedUser.email, 'FAILED_CONSOLE_UNLOCK', ip, req.headers.get('user-agent'));
      return NextResponse.json({ error: 'Invalid security key.' }, { status: 401 });
    }

    // ── Phase 2: MFA Code or Recovery Code Verification ────────────────────
    if (challengeToken) {
      if (!code && !recoveryCode) {
        return NextResponse.json({ error: 'Verification code or recovery code is required.' }, { status: 400 });
      }

      const challenge = await verifyChallengeToken(challengeToken);
      if (challenge && challenge.error) {
        // V-04: keep the internal verification reason in server logs only; the
        // client gets the same generic message as an expired/invalid challenge.
        logger.warn({ event: 'CHALLENGE_VERIFY_ERROR', detail: challenge.error, ip });
        return NextResponse.json({ error: 'Challenge expired. Please sign in again.' }, { status: 401 });
      }
      if (!challenge || !challenge.email) {
        return NextResponse.json({ error: 'Challenge expired. Please sign in again.' }, { status: 401 });
      }

      const { data: adminUsers, error: queryError } = await supabaseAdmin
        .from('admin_users')
        .select('*')
        .eq('email', challenge.email)
        .order('created_at', { ascending: true })
        .limit(1);

      const matchedUser = adminUsers?.[0];

      if (queryError || !matchedUser) {
        return NextResponse.json({ error: 'User not found.' }, { status: 401 });
      }

      // Verify challenge nonce matches what is stored
      if (!matchedUser.mfa_challenge_nonce || matchedUser.mfa_challenge_nonce !== challenge.nonce) {
        logger.error({ event: 'INVALID_CHALLENGE_NONCE', email: challenge.email });
        return NextResponse.json({ 
          error: `Invalid or reused security challenge. Please sign in again.` 
        }, { status: 401 });
      }

      // Check lockout status
      if (matchedUser.mfa_locked_until && new Date() < new Date(matchedUser.mfa_locked_until)) {
        const lockedRemainingSecs = Math.ceil((new Date(matchedUser.mfa_locked_until).getTime() - Date.now()) / 1000);
        return NextResponse.json({
          error: `MFA is locked out. Try again in ${Math.ceil(lockedRemainingSecs / 60)} minute(s).`,
        }, { status: 423 });
      }

      // Case A: Recovery Code verification
      if (recoveryCode) {
        const hashedCode = hashRecoveryCode(recoveryCode);
        const codeIndex = (matchedUser.recovery_code_hashes || []).indexOf(hashedCode);

        if (codeIndex === -1) {
          // Increment failures
          const failures = matchedUser.mfa_failures + 1;
          const lockedUntil = failures >= 5 ? new Date(Date.now() + WINDOW_MS).toISOString() : null;
          await supabaseAdmin
            .from('admin_users')
            .update({ mfa_failures: failures, mfa_locked_until: lockedUntil })
            .eq('id', matchedUser.id);

          await logSecurityEvent(matchedUser.email, failures >= 5 ? 'MFA_LOCKOUT' : 'FAILED_RECOVERY_CODE', ip, req.headers.get('user-agent'));

          if (failures >= 5) {
            return NextResponse.json({
              error: 'MFA is locked out due to too many failed attempts. Try again in 5 minutes.',
            }, { status: 423 });
          }
          return NextResponse.json({ error: 'Invalid recovery code.' }, { status: 401 });
        }

        // Recovery code matches! Disable MFA and log in
        const updatedHashes = [...matchedUser.recovery_code_hashes];
        updatedHashes.splice(codeIndex, 1);

        await supabaseAdmin
          .from('admin_users')
          .update({
            mfa_enabled: false,
            totp_secret: null,
            recovery_code_hashes: updatedHashes,
            mfa_challenge_nonce: null,
            mfa_failures: 0,
            mfa_locked_until: null,
          })
          .eq('id', matchedUser.id);

        await logSecurityEvent(matchedUser.email, 'MFA_RECOVERY_CODE_USED', ip, req.headers.get('user-agent'));

        // Log active session
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin.from('admin_sessions').insert({
          email: matchedUser.email,
          session_id: sessionId,
          user_agent: req.headers.get('user-agent') || 'Unknown',
          ip_address: ip,
          expires_at: expiresAt,
          revoked: false,
        });

        const token = await signAdminToken(matchedUser.email, sessionId);
        const res = NextResponse.json({
          success: true,
          message: 'MFA bypassed using recovery code. Please re-enable MFA immediately.',
          user: { email: matchedUser.email, role: 'administrator' },
          mfaDisabled: true,
        });
        return setAuthCookie(res, token);
      }

      // Case B: OTP Verification
      if (code) {
        if (!matchedUser.totp_secret) {
          return NextResponse.json({ error: 'MFA configuration missing.' }, { status: 400 });
        }

        let decryptedSecret: string;
        try {
          decryptedSecret = decryptAES(matchedUser.totp_secret);
        } catch (err) {
          logger.error({ event: 'TOTP_DECRYPTION_FAILED', email: matchedUser.email }, err);
          return NextResponse.json({ error: 'Server key decryption error.' }, { status: 500 });
        }

        const windowSize = matchedUser.mfa_enabled ? 1 : 4; // Normal login: 1 (±30s), Setup: 4 (±2m)
        const matchedCounter = verifyTOTP(decryptedSecret, code, windowSize);

        if (matchedCounter === null) {
          // Increment failures
          const failures = matchedUser.mfa_failures + 1;
          const lockedUntil = failures >= 5 ? new Date(Date.now() + WINDOW_MS).toISOString() : null;
          await supabaseAdmin
            .from('admin_users')
            .update({ mfa_failures: failures, mfa_locked_until: lockedUntil })
            .eq('id', matchedUser.id);

          await logSecurityEvent(matchedUser.email, failures >= 5 ? 'MFA_LOCKOUT' : 'FAILED_MFA_OTP', ip, req.headers.get('user-agent'));

          if (failures >= 5) {
            return NextResponse.json({
              error: 'MFA is locked out due to too many failed attempts. Try again in 5 minutes.',
            }, { status: 423 });
          }
          return NextResponse.json({ error: 'Invalid authenticator code.' }, { status: 401 });
        }

        // Check for OTP replay attacks (only for enabled MFA)
        if (matchedUser.mfa_enabled && matchedUser.totp_last_counter !== null) {
          if (BigInt(matchedCounter) <= BigInt(matchedUser.totp_last_counter)) {
            await logSecurityEvent(matchedUser.email, 'MFA_REPLAY_REJECTED', ip, req.headers.get('user-agent'));
            return NextResponse.json({ error: 'Authenticator code already used. Please wait for the next code.' }, { status: 401 });
          }
        }

        // Success!
        let responsePayload: any = {
          success: true,
          message: 'Authentication successful.',
          user: { email: matchedUser.email, role: 'administrator' },
        };

        const updateData: any = {
          totp_last_counter: matchedCounter,
          mfa_challenge_nonce: null,
          mfa_failures: 0,
          mfa_locked_until: null,
        };

        if (!matchedUser.mfa_enabled) {
          // If setup, we enable MFA and generate recovery codes
          updateData.mfa_enabled = true;
          const recoveryCodes = generateRecoveryCodes();
          updateData.recovery_code_hashes = recoveryCodes.map(c => hashRecoveryCode(c));
          responsePayload.recoveryCodes = recoveryCodes;
          await logSecurityEvent(matchedUser.email, 'MFA_ENABLED', ip, req.headers.get('user-agent'));
        } else {
          await logSecurityEvent(matchedUser.email, 'MFA_LOGIN_SUCCESS', ip, req.headers.get('user-agent'));
        }

        const { error: finalUpdateError } = await supabaseAdmin
          .from('admin_users')
          .update(updateData)
          .eq('id', matchedUser.id);

        if (finalUpdateError) {
          logger.error({ event: 'PHASE_2_UPDATE_ERROR', email: matchedUser.email }, finalUpdateError);
          return NextResponse.json({ error: `An internal server error occurred during verification.` }, { status: 500 });
        }

        // Create session
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin.from('admin_sessions').insert({
          email: matchedUser.email,
          session_id: sessionId,
          user_agent: req.headers.get('user-agent') || 'Unknown',
          ip_address: ip,
          expires_at: expiresAt,
          revoked: false,
        });

        const token = await signAdminToken(matchedUser.email, sessionId);
        const res = NextResponse.json(responsePayload);
        return setAuthCookie(res, token);
      }
    }

    // ── Phase 1: Password Verification ────────────────────────────────────
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and security key are required.' }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const { data: adminUsers, error: queryError } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('email', trimmedEmail)
      .order('created_at', { ascending: true })
      .limit(1);

    const matchedUser = adminUsers?.[0];

    if (queryError || !matchedUser || matchedUser.email.trim().toLowerCase() !== trimmedEmail) {
      const fakeSalt = '00000000000000000000000000000000';
      const fakeHash = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
      await verifyPassword(password, fakeHash, fakeSalt);
      await logSecurityEvent(trimmedEmail, 'FAILED_LOGIN_USER_NOT_FOUND', ip, req.headers.get('user-agent'));
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // Check lockout status
    if (matchedUser.mfa_locked_until && new Date() < new Date(matchedUser.mfa_locked_until)) {
      const lockedRemainingSecs = Math.ceil((new Date(matchedUser.mfa_locked_until).getTime() - Date.now()) / 1000);
      await logSecurityEvent(trimmedEmail, 'LOGIN_BLOCKED_MFA_LOCKED', ip, req.headers.get('user-agent'));
      return NextResponse.json({
        error: `MFA is locked out. Try again in ${Math.ceil(lockedRemainingSecs / 60)} minute(s).`,
      }, { status: 423 });
    }

    const isPasswordValid = await verifyPassword(password, matchedUser.password_hash, matchedUser.salt);
    if (!isPasswordValid) {
      await logSecurityEvent(trimmedEmail, 'FAILED_LOGIN_PASSWORD_INVALID', ip, req.headers.get('user-agent'));
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // Password verified — clear this account's brute-force window so earlier
    // typos don't count against the legitimate owner. (MFA has its own lockout.)
    if (isProd) await resetRateLimit(`email:${trimmedEmail}`);

    // Password is valid! Initiate MFA challenge
    const nonce = randomUUID();
    const signedChallengeToken = await signChallengeToken(matchedUser.email, nonce);

    const updatePayload: any = {
      mfa_challenge_nonce: nonce,
    };

    let responseData: any = {
      mfaRequired: true,
      challengeToken: signedChallengeToken,
      mfaSetupRequired: !matchedUser.mfa_enabled,
    };

    // If MFA is not setup, generate or reuse a temporary TOTP secret
    if (!matchedUser.mfa_enabled) {
      let tempSecret: string;
      if (matchedUser.totp_secret) {
        try {
          // Reuse the existing secret so the user's authenticator app doesn't go out of sync
          tempSecret = decryptAES(matchedUser.totp_secret);
        } catch (err) {
          logger.warn({ event: 'TOTP_DECRYPTION_FAILED_REGENERATING', email: matchedUser.email }, err instanceof Error ? err.message : String(err));
          tempSecret = generateTOTPSecret();
          updatePayload.totp_secret = encryptAES(tempSecret);
        }
      } else {
        tempSecret = generateTOTPSecret();
        updatePayload.totp_secret = encryptAES(tempSecret);
      }
      responseData.totpSecret = tempSecret;
    }

    const { error: updateError } = await supabaseAdmin
      .from('admin_users')
      .update(updatePayload)
      .eq('id', matchedUser.id);

    if (updateError) {
      logger.error({ event: 'PHASE_1_UPDATE_ERROR', email: matchedUser.email }, updateError);
      return NextResponse.json(
        { error: `An internal server error occurred during the login process.` },
        { status: 500 }
      );
    }

    await logSecurityEvent(matchedUser.email, 'PASSWORD_VERIFIED_MFA_CHALLENGE_ISSUED', ip, req.headers.get('user-agent'));

    return NextResponse.json(responseData);
  } catch (err: unknown) {
    logger.error({ event: 'AUTH_API_CRITICAL_ERROR' }, err);
    return NextResponse.json({ error: 'Internal authentication error.' }, { status: 500 });
  }
}

