// ============================================================================
// "Session already verified" request header, from the proxy to the page render of the SAME request.
//
// The proxy checks every admin session against the database (src/proxy.ts → sessionCache). The page
// then calls getAdminSession(), which checks again; on a cache miss that is a second DB round trip.
// After its own check passes, the proxy attaches this header; verifyAdminToken() still verifies the
// JWT itself and skips ONLY the DB check when this header:
//   - carries a valid HMAC-SHA256 (key derived from the admin JWT signing key — server-only), and
//   - names the same session id, email and panel as the JWT being verified, and
//   - is at most MAX_AGE_MS old.
// A client cannot forge it (no key), and the proxy deletes any client-sent copy on page requests.
// Worst case it extends trust by MAX_AGE_MS — far less than the session cache already does (60 s).
// ============================================================================

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const VERIFIED_HEADER = 'x-admin-verified';
export const MAX_AGE_MS = 5_000;

type Claims = { sid: string; email: string; panel: 'lms' | 'lab' };

let key: Buffer | null = null;
function hmacKey(): Buffer {
  if (!key) {
    const pem = process.env.ADMIN_JWT_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
    if (!pem) throw new Error('verifiedHeader: admin signing key missing');
    // Separate key per purpose: never the JWT key itself.
    key = createHash('sha256').update(`siddesh-admin-verified-header|v1|${pem}`).digest();
  }
  return key;
}

const mac = (body: string) => createHmac('sha256', hmacKey()).update(body).digest('base64url');

/** Header value for a session the proxy has just verified. */
export function signVerified(c: Claims, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ sid: c.sid, email: c.email, panel: c.panel, at: now })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** True only for an authentic, fresh header that names exactly this session. */
export function isVerifiedFor(value: string | null | undefined, c: Claims, now = Date.now()): boolean {
  if (!value || value.length > 1024) return false;
  const [body, sig, extra] = value.split('.');
  if (!body || !sig || extra !== undefined) return false;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.sid === c.sid && p.email === c.email && p.panel === c.panel
      // ≤ 1 s ahead allows for clock skew when the proxy and the page run on different machines.
      && typeof p.at === 'number' && p.at <= now + 1_000 && now - p.at <= MAX_AGE_MS;
  } catch {
    return false;
  }
}
