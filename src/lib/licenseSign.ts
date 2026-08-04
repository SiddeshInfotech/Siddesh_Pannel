import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * ============================================================================
 *  licenseSign.ts — shared ECDSA-P256 (ES256) payload signer.
 *
 *  Single source of truth for licence/lease signing so /api/activate and
 *  /api/device/ping produce byte-identical signatures the client verifies with
 *  the SAME pinned public key. Extracted verbatim from the inline signer that
 *  used to live in activate/route.ts (behaviour is unchanged).
 *
 *  Key resolution (identical to the activate route):
 *    1. process.env.PRIVATE_KEY  (PEM, "\n"-escaped) — production (Vercel).
 *    2. <cwd>/keys/private.pem
 *    3. /tmp/keys/private.pem     — read-only-FS fallback.
 * ============================================================================
 */

let cachedPem: string | null = null;

function resolvePrivateKeyPem(): string {
  const envPem = process.env.PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (envPem) return envPem;
  let target = path.join(process.cwd(), 'keys', 'private.pem');
  if (!fs.existsSync(target)) {
    target = path.join('/tmp', 'keys', 'private.pem');
  }
  return fs.readFileSync(target, 'utf8');
}

/** Sign `payloadStr` with the licence private key; returns a base64 ECDSA signature. */
export function signPayload(payloadStr: string): string {
  if (!cachedPem) cachedPem = resolvePrivateKeyPem();
  const signer = crypto.createSign('SHA256');
  signer.update(payloadStr);
  signer.end();
  return signer.sign(cachedPem, 'base64');
}
