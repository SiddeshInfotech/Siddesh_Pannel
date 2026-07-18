import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, clearAuthCookie, verifyAdminToken } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/auth/logout
 *
 * Security hardening:
 * 1. CSRF protection — validates the Origin header against the allowed app domain.
 *    Cross-origin pages (e.g. attacker.com) cannot spoof the Origin header via a
 *    form POST, so forced-logout attacks (F-09) are blocked.
 * 2. Session revocation — marks the active session as revoked in Supabase so the
 *    JWT cannot be reused even before it expires.
 * 3. Cookie clearing — removes the HttpOnly admin_token cookie server-side.
 */

// Optional canonical origin (e.g. a production custom domain). Accepted IN
// ADDITION to the origin the request was actually served on, so a single pinned
// value can never lock out localhost / Vercel preview / custom-domain logins.
const CONFIGURED_ORIGIN = process.env.APP_URL ? new URL(process.env.APP_URL).origin : undefined;

// Same-origin CSRF check that works across localhost, Vercel previews and custom
// domains. Accept the request when its Origin matches the origin the request was
// actually served on (derived from Vercel's forwarded headers), or the optional
// configured APP_URL. Only an explicit CROSS-origin (e.g. evil.com) is blocked —
// an attacker page cannot forge a matching Origin, and the SameSite=Strict cookie
// is not even sent cross-site.
function isSameOrigin(req: NextRequest, origin: string): boolean {
  if (CONFIGURED_ORIGIN && origin === CONFIGURED_ORIGIN) return true;
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host && origin === `${proto}://${host}`) return true;
  if (origin === req.nextUrl.origin) return true;
  return false;
}

export async function POST(req: NextRequest) {
  // ── CSRF: Validate Origin header ─────────────────────────────────────────
  // Browsers always send an Origin header on cross-origin POST requests.
  // Same-origin requests from the panel itself match (or omit the header, which
  // is allowed). We only block an explicit cross-origin mismatch.
  const origin = req.headers.get('origin');
  if (origin && !isSameOrigin(req, origin)) {
    console.warn(`[logout] Blocked cross-origin logout attempt from: ${origin}`);
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  // ── Session revocation ────────────────────────────────────────────────────
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (token) {
      const session = await verifyAdminToken(token);
      if (session && session.sid) {
        // Mark session as revoked in the database so existing JWTs are invalidated
        await supabaseAdmin
          .from('admin_sessions')
          .update({ revoked: true })
          .eq('session_id', session.sid);
      }
    }
  } catch (err) {
    console.error('Logout session revocation error:', err);
  }

  // ── Clear the auth cookie ─────────────────────────────────────────────────
  const res = NextResponse.json({ success: true, message: 'Logged out successfully.' });
  return clearAuthCookie(res);
}
