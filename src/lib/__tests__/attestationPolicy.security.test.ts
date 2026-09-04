import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateAttestationConfig } from '@/lib/attestationPolicy';

// Regression coverage for the LMS_WIN_ATTEST_STRICT startup safeguard (2026-09-04 review):
// turning strict mode on must surface a loud, CRITICAL-level warning — not the old quiet NOTE
// that only fired when LMS_WIN_ATTEST_AIK_ROOTS happened to be empty — since strict now fails
// closed unconditionally (no managed TPM/AIK verifier exists yet; see windowsAttestation.ts).

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
  vi.restoreAllMocks();
});

function strictCriticalCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(
    ([tag, payload]) => tag === '[ATTEST_CONFIG_CRITICAL]' && typeof payload === 'string' && payload.includes('LMS_WIN_ATTEST_STRICT'),
  );
}

describe('validateAttestationConfig — Windows strict-mode startup safeguard', () => {
  it('logs a CRITICAL error when LMS_WIN_ATTEST_STRICT=true, with AIK roots configured', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    process.env.LMS_WIN_ATTEST_AIK_ROOTS = 'some-root-value';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    validateAttestationConfig();
    expect(strictCriticalCalls(spy).length).toBe(1);
  });

  it('logs the same CRITICAL error when LMS_WIN_ATTEST_STRICT=true even with NO AIK roots configured — strict fails closed either way now', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    validateAttestationConfig();
    expect(strictCriticalCalls(spy).length).toBe(1);
  });

  it('does NOT log the strict-mode critical warning when LMS_WIN_ATTEST_STRICT is unset (current production default)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    validateAttestationConfig();
    expect(strictCriticalCalls(spy).length).toBe(0);
  });

  it('never throws, even in the strict-misconfigured case — startup must not crash the app', () => {
    process.env.LMS_WIN_ATTEST_STRICT = 'true';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => validateAttestationConfig()).not.toThrow();
  });
});
