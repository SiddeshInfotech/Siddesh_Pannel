/**
 * sanitize.ts
 * 
 * Utility to sanitize user input to prevent Cross-Site Scripting (XSS).
 * Escapes common HTML characters to prevent injection of malicious scripts.
 */

export function sanitize(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * Resolve the real client IP from request headers.
 *
 * SECURITY: `x-forwarded-for` is a comma list the CLIENT can prepend to, so its
 * leftmost value is attacker-controlled — using it for rate-limit keys or audit
 * logs lets an attacker rotate buckets and forge log entries. On Vercel (and
 * most edge platforms) `x-real-ip` is set by the platform to the actual TCP peer
 * and CANNOT be overridden by the client, so we trust it first. We deliberately
 * do NOT trust the leftmost XFF entry.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  // Fallback: take the RIGHTMOST XFF hop (closest trusted proxy), not the
  // client-spoofable leftmost one.
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return '127.0.0.1';
}
