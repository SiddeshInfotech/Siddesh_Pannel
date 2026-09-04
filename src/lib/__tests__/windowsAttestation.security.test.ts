import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyWindowsAttestation } from '@/lib/windowsAttestation';

// Regression coverage for the strict-mode false-positive fix (2026-09-04 review): strict mode
// used to return ok:true for WIN_TPM_ATTESTED once LMS_WIN_ATTEST_AIK_ROOTS held ANY non-empty
// string, while logging 'WIN_ATTEST_STRICT_TODO' — no AIK/quote cryptographic verification ever
// ran. That let an operator who flips LMS_WIN_ATTEST_STRICT=true believe Windows devices are
// hardware-attested when nothing was actually checked beyond what the lenient path already
// verifies. Fixed to fail closed unconditionally until a real managed TPM/AIK verifier exists.

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LMS_WIN_ATTEST_STRICT;
  delete process.env.LMS_WIN_ATTEST_AIK_ROOTS;
}

beforeEach(() => {
  resetEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// A real RSA keypair standing in for the TPM/DPAPI wrap key, and a genuine request-binding
// signature — exactly the shape TpmSealing.jvm.kt's signRequestDigest() / DeviceActivation.jvm.kt
// produce, so this exercises the real crypto.verify() call, not a mock of it.
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACTIVATION_KEY = 'LMS-TEST-KEY-0001';
const NONCE = 'test-nonce-abc123';
const TIMESTAMP = '1700000000000';
const WRAP_PUBKEY_B64 = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const VALID_CLAIM_B64 = Buffer.from('stand-in-platform-claim-bytes').toString('base64');

function validSignature(): string {
  const msg = Buffer.from(`${ACTIVATION_KEY}|${NONCE}|${TIMESTAMP}`, 'utf8');
  return crypto.sign('sha256', msg, keyPair.privateKey).toString('base64');
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    claimB64: [VALID_CLAIM_B64],
    deviceWrapPubkeyB64: WRAP_PUBKEY_B64,
    activationKey: ACTIVATION_KEY,
    nonce: NONCE,
    timestamp: TIMESTAMP,
    tier: 'WIN_TPM_ATTESTED',
    challengeSignatureB64: validSignature(),
    ...overrides,
  };
}

describe('verifyWindowsAttestation — existing legitimate paths stay unaffected (strict=false, current default)', () => {
  it('TPM-capable device: WIN_TPM_ATTESTED with a valid claim + valid signature still passes (VERIFIED_PLATFORM_CLAIM path)', () => {
    expect(verifyWindowsAttestation(baseInput()).ok).toBe(true);
  });

  it('no-TPM device: WIN_SW_ONLY (DPAPI fallback) still passes with a valid signature', () => {
    const result = verifyWindowsAttestation(baseInput({ tier: 'WIN_SW_ONLY', claimB64: [] }));
    expect(result.ok).toBe(true);
  });
});

describe('verifyWindowsAttestation — strict mode fails closed (no managed TPM/AIK verifier exists yet)', () => {
  it('WIN_TPM_ATTESTED + strict=true + a non-empty but ARBITRARY LMS_WIN_ATTEST_AIK_ROOTS must NOT return verified', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    process.env.LMS_WIN_ATTEST_AIK_ROOTS = 'not-a-real-root-just-a-placeholder-string';
    const result = verifyWindowsAttestation(baseInput());
    expect(result.ok).toBe(false);
  });

  it('WIN_TPM_ATTESTED + strict=true + no AIK roots configured also fails', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    const result = verifyWindowsAttestation(baseInput());
    expect(result.ok).toBe(false);
  });

  it('WIN_TPM_ATTESTED + strict=true fails even with a genuinely valid request signature — proof-of-possession alone is not managed attestation', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    process.env.LMS_WIN_ATTEST_AIK_ROOTS = 'some-root-value';
    const result = verifyWindowsAttestation(baseInput());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not implemented/i);
  });

  it('never re-introduces the old ok:true-once-roots-non-empty shape, across several arbitrary root strings', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    for (const roots of ['x', 'placeholder', '-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----']) {
      process.env.LMS_WIN_ATTEST_AIK_ROOTS = roots;
      expect(verifyWindowsAttestation(baseInput()).ok).toBe(false);
    }
  });
});

describe('verifyWindowsAttestation — client-supplied "managed" claims never elevate trust', () => {
  it('extra isManaged/isIntuneEnrolled/hasAIK/hasEK fields on the request have zero effect under strict', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    process.env.LMS_WIN_ATTEST_AIK_ROOTS = 'root';
    const spoofed = {
      ...baseInput(),
      isManaged: true,
      isIntuneEnrolled: true,
      hasAIK: true,
      hasEK: true,
    };
    expect(verifyWindowsAttestation(spoofed).ok).toBe(false);
  });

  it('the same spoofed fields have zero effect under the lenient path either — result is identical to the unspoofed input', () => {
    const plain = verifyWindowsAttestation(baseInput());
    const spoofed = verifyWindowsAttestation({ ...baseInput(), isManaged: true, hasEK: true });
    expect(spoofed).toEqual(plain);
  });
});

describe('verifyWindowsAttestation — the two legitimate architectures keep working regardless of strict', () => {
  it('TPM local device: VERIFIED_PLATFORM_CLAIM path (lenient) is unchanged by this fix', () => {
    expect(verifyWindowsAttestation(baseInput()).ok).toBe(true);
  });

  it('no TPM: DPAPI fallback stays audit-only and unaffected, whether strict is on or off', () => {
    expect(verifyWindowsAttestation(baseInput({ tier: 'WIN_SW_ONLY', claimB64: [] })).ok).toBe(true);
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    expect(verifyWindowsAttestation(baseInput({ tier: 'WIN_SW_ONLY', claimB64: [] })).ok).toBe(true);
  });
});
