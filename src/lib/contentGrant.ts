import crypto from 'crypto';
import { familyFor, isProductId } from './productIdentity';

export const CONTENT_GRANT_PROTOCOL = 'LMS-CONTENT-GRANT-1';

/** Sign the exact encrypted key map and recipient, separately from the display licence. */
export function createContentGrant(input: {
  productId: string;
  fingerprint: string;
  activationKeyId: string;
  publicKeyBase64: string;
  issuedAt: string;
  expiresAt: string;
  wrappedScopes: Record<string, string>;
}, sign: (text: string) => string): { grant_str: string; grant_signature: string } | null {
  if (!isProductId(input.productId) || familyFor(input.productId) !== 'school') return null;
  const pub = crypto.createPublicKey({ key: Buffer.from(input.publicKeyBase64, 'base64'), type: 'spki', format: 'der' });
  if (pub.asymmetricKeyType !== 'rsa') throw new Error('Content recipient must be RSA');
  if (!input.fingerprint || !input.activationKeyId || input.activationKeyId.length > 128 || !Number.isFinite(Date.parse(input.issuedAt)) ||
      !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) {
    throw new Error('Invalid content grant dates or device');
  }
  const entries = Object.entries(input.wrappedScopes);
  if (entries.length > 128 || entries.some(([scope, value]) =>
    !/^class_([1-9]|1[0-2])\/[A-Za-z][A-Za-z ]{0,39}$/.test(scope) ||
    value.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) {
    throw new Error('Invalid scoped envelope map');
  }
  const grant_str = JSON.stringify({
    protocol: CONTENT_GRANT_PROTOCOL,
    product_id: input.productId,
    device_fingerprint: input.fingerprint,
    activation_key_id: input.activationKeyId,
    recipient_sha256: crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex'),
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    scopes: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))),
  });
  return { grant_str, grant_signature: sign(grant_str) };
}
