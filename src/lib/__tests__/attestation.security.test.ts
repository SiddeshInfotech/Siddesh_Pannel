import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FIXTURE_ACTIVATION_KEY,
  FIXTURE_NONCE,
  FIXTURE_TIMESTAMP,
  ROOT_CERT_PEM,
  GENUINE_CHAIN_B64,
  GENUINE_WRAP_PUBKEY_SPKI_B64,
  WRONG_WRAP_PUBKEY_SPKI_B64,
  STRICT_LEAF_GENERATED_B64,
  STRICT_LEAF_IMPORTED_B64,
  STRICT_LEAF_UNKNOWN_ORIGIN_B64,
  STRICT_LEAF_NO_ORIGIN_B64,
  ROOT_CERT_DER_B64,
} from './fixtures/attestationFixtures';
import { SECURITY_LEVEL } from '@/lib/attestationExtension';

// These use REAL, openssl-generated X.509 certificates (see fixtures/attestationFixtures.ts
// header for the exact regeneration recipe) chained to a fake-but-real root, exercising the
// actual chain-signature-verification / root-pinning / challenge-binding code paths in
// src/lib/attestation.ts — not mocks of them.

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LMS_ATTEST_STRICT;
  delete process.env.LMS_ATTEST_CHECK_REVOCATION;
  delete process.env.LMS_ATTEST_EXEMPT_MODELS;
  delete process.env.LMS_ENFORCE_ATTESTATION;
  process.env.LMS_ATTEST_ROOT_CERTS = ROOT_CERT_PEM;
}

beforeEach(() => {
  resetEnv();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('verifyAttestation — genuine device baseline', () => {
  it('passes for a genuine chain + matching device_wrap_pubkey + correct challenge triple', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: GENUINE_CHAIN_B64,
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(true);
  });
});

describe('verifyAttestation — device_wrap_pubkey binding (item 2)', () => {
  it('rejects a genuine, validly-chained attestation replayed with a substituted wrap pubkey', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: GENUINE_CHAIN_B64,
      deviceWrapPubkeyB64: WRONG_WRAP_PUBKEY_SPKI_B64, // attacker's own key, not the leaf's
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/device_wrap_pubkey/);
  });
});

describe('verifyAttestation — downgrade / spoofing (items 1, 5)', () => {
  it('fails on a missing chain regardless of what tier the client claims', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    // The function no longer even accepts a "tier" parameter — there is nothing for a
    // client to lie about here. This is the structural fix: verification depends only
    // on cryptographic evidence actually presented, never on a self-reported label.
    const result = verifyAttestation({
      chainB64: [],
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/chain missing or too short/);
  });

  it('rejects a replayed chain bound to a different activation/nonce/timestamp', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: GENUINE_CHAIN_B64,
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: 'a-different-nonce', // attacker replaying a captured chain against a new request
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/challenge mismatch/);
  });

  it('rejects a chain that does not terminate at a pinned root (untrusted/self-issued attacker chain)', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    process.env.LMS_ATTEST_ROOT_CERTS = ''; // no root pinned == attacker's own chain can't be trusted
    const result = verifyAttestation({
      chainB64: GENUINE_CHAIN_B64,
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no pinned attestation roots/);
  });
});

describe('attestationPolicy — enforcement no longer trusts client security_tier (items 1, 3, 5)', () => {
  it('enforces every model once LMS_ENFORCE_ATTESTATION=true when no exemption is configured', async () => {
    process.env.LMS_ENFORCE_ATTESTATION = 'true';
    const { shouldEnforceAttestation, isModelExempt } = await import('@/lib/attestationPolicy');
    // No LMS_ATTEST_EXEMPT_MODELS set — there is no implicit "x301" default any more.
    expect(isModelExempt('x301')).toBe(false);
    expect(shouldEnforceAttestation('x301')).toBe(true);
    expect(shouldEnforceAttestation('Some Random Rooted Phone')).toBe(true);
  });

  it('exempts only an explicitly-configured model, and nothing else', async () => {
    process.env.LMS_ENFORCE_ATTESTATION = 'true';
    process.env.LMS_ATTEST_EXEMPT_MODELS = 'x301';
    const { shouldEnforceAttestation } = await import('@/lib/attestationPolicy');
    expect(shouldEnforceAttestation('x301')).toBe(false);
    expect(shouldEnforceAttestation('X301')).toBe(false); // case-insensitive
    expect(shouldEnforceAttestation('x302')).toBe(true); // a lookalike model is NOT exempt
  });

  it('never enforces anything while the master switch is off', async () => {
    const { shouldEnforceAttestation } = await import('@/lib/attestationPolicy');
    expect(shouldEnforceAttestation('anything')).toBe(false);
  });

  it('deriveServerTier ignores attestationOk-independent input and reflects only crypto evidence', async () => {
    const { deriveServerTier } = await import('@/lib/attestationPolicy');
    expect(deriveServerTier({ attestationOk: false })).toBe('UNVERIFIED');
    expect(deriveServerTier({ attestationOk: true, securityLevel: SECURITY_LEVEL.STRONGBOX })).toBe('VERIFIED_STRONGBOX');
    expect(deriveServerTier({ attestationOk: true, securityLevel: SECURITY_LEVEL.TEE })).toBe('VERIFIED_TEE');
    expect(deriveServerTier({ attestationOk: true })).toBe('VERIFIED_UNSPECIFIED_HW');
  });
});

describe('verifyAttestation — strict-mode key-origin hardening (item 6)', () => {
  it('passes strict for a real, hardware-GENERATED key', async () => {
    process.env.LMS_ATTEST_STRICT = 'true';
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: [STRICT_LEAF_GENERATED_B64, ROOT_CERT_DER_B64],
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(true);
    expect(result.securityLevel).toBe(SECURITY_LEVEL.TEE);
  });

  it('rejects strict for an IMPORTED key (attacker-controlled private key)', async () => {
    process.env.LMS_ATTEST_STRICT = 'true';
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: [STRICT_LEAF_IMPORTED_B64, ROOT_CERT_DER_B64],
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/origin/);
  });

  it('rejects strict for an unrecognized/UNKNOWN key origin (new hardening — previously passed)', async () => {
    process.env.LMS_ATTEST_STRICT = 'true';
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: [STRICT_LEAF_UNKNOWN_ORIGIN_B64, ROOT_CERT_DER_B64],
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/origin/);
  });

  it('rejects strict when the origin tag is entirely absent (ambiguous parse, new hardening — previously passed)', async () => {
    process.env.LMS_ATTEST_STRICT = 'true';
    const { verifyAttestation } = await import('@/lib/attestation');
    const result = verifyAttestation({
      chainB64: [STRICT_LEAF_NO_ORIGIN_B64, ROOT_CERT_DER_B64],
      deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
      activationKey: FIXTURE_ACTIVATION_KEY,
      nonce: FIXTURE_NONCE,
      timestamp: FIXTURE_TIMESTAMP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/origin/);
  });

  it('lenient (strict off) still accepts IMPORTED/UNKNOWN/no-origin leaves — staged rollout is preserved', async () => {
    const { verifyAttestation } = await import('@/lib/attestation');
    for (const leaf of [STRICT_LEAF_IMPORTED_B64, STRICT_LEAF_UNKNOWN_ORIGIN_B64, STRICT_LEAF_NO_ORIGIN_B64]) {
      const result = verifyAttestation({
        chainB64: [leaf, ROOT_CERT_DER_B64],
        deviceWrapPubkeyB64: GENUINE_WRAP_PUBKEY_SPKI_B64,
        activationKey: FIXTURE_ACTIVATION_KEY,
        nonce: FIXTURE_NONCE,
        timestamp: FIXTURE_TIMESTAMP,
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe('checkRevocation — classification hardening (item 7)', () => {
  it('detects revocation via a DECIMAL-keyed entry (previously silently missed)', async () => {
    const { checkRevocation } = await import('@/lib/attestation');
    process.env.LMS_ATTEST_CHECK_REVOCATION = 'true';
    // Compute the leaf's own serial in decimal so this test asserts the real fix, not a
    // fabricated coincidence.
    const crypto = await import('crypto');
    const cert = new crypto.X509Certificate(Buffer.from(GENUINE_CHAIN_B64[0], 'base64'));
    const decimalSerial = BigInt('0x' + cert.serialNumber).toString(10);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ entries: { [decimalSerial]: { status: 'REVOKED', reason: 'KEY_COMPROMISE' } } }),
      }))
    );
    const result = await checkRevocation(GENUINE_CHAIN_B64);
    expect(result.revoked).toBe(true);
    expect(result.reason).toMatch(/KEY_COMPROMISE/);
  });

  it('detects revocation via a lowercase-HEX-keyed entry', async () => {
    const { checkRevocation } = await import('@/lib/attestation');
    process.env.LMS_ATTEST_CHECK_REVOCATION = 'true';
    const crypto = await import('crypto');
    const cert = new crypto.X509Certificate(Buffer.from(GENUINE_CHAIN_B64[0], 'base64'));
    const hexSerial = cert.serialNumber.toLowerCase().replace(/^0+/, '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ entries: { [hexSerial]: { status: 'REVOKED', reason: 'SOFTWARE_FLAW' } } }),
      }))
    );
    const result = await checkRevocation(GENUINE_CHAIN_B64);
    expect(result.revoked).toBe(true);
  });

  it('fails open (not revoked) when the list has no matching entry', async () => {
    const { checkRevocation } = await import('@/lib/attestation');
    process.env.LMS_ATTEST_CHECK_REVOCATION = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ entries: {} }) }))
    );
    const result = await checkRevocation(GENUINE_CHAIN_B64);
    expect(result.revoked).toBe(false);
  });

  it('is a no-op (never fetches) while LMS_ATTEST_CHECK_REVOCATION is not "true"', async () => {
    const { checkRevocation } = await import('@/lib/attestation');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkRevocation(GENUINE_CHAIN_B64);
    expect(result.revoked).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
