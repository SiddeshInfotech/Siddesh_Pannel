import { scrypt, randomBytes, timingSafeEqual, createHmac, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const masterCekRaw = process.env.LMS_MASTER_CEK;
if (!masterCekRaw) {
  throw new Error('CRITICAL CONFIG ERROR: LMS_MASTER_CEK environment variable is missing.');
}

// ── Admin TOTP-secret encryption key (separated from the content master key) ──
// Previously this was sha256(LMS_MASTER_CEK) — i.e. the SAME secret that protects
// all video content also protected admin MFA seeds, so one leak crossed both
// trust domains. The TOTP encryption key now comes from its OWN secret
// (LMS_TOTP_ENC_KEY). When that env var is not yet set, we derive a
// DOMAIN-SEPARATED key from the master (so it is at least not identical to the
// content key) and warn. Decryption falls back to the legacy identical-key
// scheme so secrets enrolled before this change still open; they are re-encrypted
// under the new key the next time MFA is set up.
const totpEncSecret = process.env.LMS_TOTP_ENC_KEY;
if (!totpEncSecret) {
  console.warn(
    '[crypto] LMS_TOTP_ENC_KEY not set — deriving TOTP key from LMS_MASTER_CEK (domain-separated). ' +
    'Set a dedicated LMS_TOTP_ENC_KEY for full key separation.'
  );
}
const CEK = totpEncSecret
  ? createHash('sha256').update(totpEncSecret).digest()
  : createHash('sha256').update('lms-totp-enc:v1:' + masterCekRaw).digest();

// Legacy key = the old sha256(LMS_MASTER_CEK). Used ONLY as a decrypt fallback so
// MFA secrets enrolled before key separation keep working during transition.
const LEGACY_CEK = createHash('sha256').update(masterCekRaw).digest();

/**
 * Hash a password using Node's native scrypt key derivation function (highly secure).
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return {
    hash: derivedKey.toString('hex'),
    salt,
  };
}

/**
 * Verify a password against a stored scrypt hash and salt.
 */
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const verifyHash = derivedKey.toString('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Base32 decoder implementation for TOTP key verification.
 */
function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanStr = base32.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const val = alphabet.indexOf(cleanStr[i]);
    if (val === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generate an HMAC-based One-Time Password (HOTP) for a given counter.
 */
function generateHOTP(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Verify a Time-based One-Time Password (TOTP) against a base32 secret.
 * Returns the matched counter step, or null if verification fails.
 * Includes a configurable tolerance window for clock drift.
 */
export function verifyTOTP(secret: string, code: string, window = 1): number | null {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (generateHOTP(secret, counter + i) === code) {
      return counter + i;
    }
  }
  return null;
}

/**
 * Base32-encode a buffer (RFC 4648, no padding) — inverse of base32Decode.
 */
function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Generate a TOTP secret using a CRYPTOGRAPHICALLY SECURE RNG.
 * 20 random bytes = 160 bits of entropy (matches the SHA-1 HMAC block of TOTP),
 * base32-encoded. NEVER use Math.random() here — it is a predictable PRNG and an
 * MFA seed is a long-lived secret.
 */
export function generateTOTPSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Encrypt a text string using AES-256-GCM with the Master Key.
 * Output format: iv_hex:auth_tag_hex:encrypted_hex
 */
export function encryptAES(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', CEK, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a text string using AES-256-GCM with the Master Key.
 * Input format: iv_hex:auth_tag_hex:encrypted_hex
 */
export function decryptAES(encryptedText: string): string {
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const tryKey = (key: Buffer): string => {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8'); // throws on auth-tag mismatch (wrong key)
    return decrypted;
  };

  try {
    return tryKey(CEK);
  } catch {
    // Transition fallback: secret was encrypted under the legacy
    // sha256(LMS_MASTER_CEK) key before key separation. GCM auth guarantees we
    // only accept a correct decryption.
    return tryKey(LEGACY_CEK);
  }
}

/**
 * Generate one-time-use recovery codes, each with 128 bits of entropy.
 * Previously these were 32-bit (randomBytes(4)) — crackable in seconds from a
 * leaked, unsalted SHA-256 hash. 16 random bytes (base32) defeats any offline
 * brute force. Displayed in 5-char groups for readability; the hash normalizer
 * below strips the separators so the user may type them with or without dashes.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(16)); // 128-bit
    const grouped = raw.match(/.{1,5}/g)?.join('-') ?? raw;
    codes.push(grouped);
  }
  return codes;
}

/**
 * Hash a recovery code using SHA-256 over a NORMALIZED form (uppercase, with all
 * non-base32 characters — dashes, spaces — removed) so presentation formatting
 * never affects matching. Safe against rainbow tables because the codes carry
 * 128 bits of entropy.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return createHash('sha256')
    .update(normalized)
    .digest('hex');
}

