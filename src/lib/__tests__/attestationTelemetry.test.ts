import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { classifyAttestationReason, sanitizeReasonDetail } from '@/lib/attestationTelemetry';

// ── Reason-code classification (reviewer item #3: never rely on the raw verifier
//    string being a stable, bounded set — the enum is the primary signal). ──────────
describe('classifyAttestationReason', () => {
  it('maps every known verifier reason string to its bounded code', () => {
    expect(classifyAttestationReason('attestation chain missing or too short')).toBe('CHAIN_MISSING');
    expect(classifyAttestationReason('chain link 2 invalid')).toBe('CHAIN_INVALID');
    expect(classifyAttestationReason('chain parse failed: Unsupported')).toBe('CHAIN_INVALID');
    expect(classifyAttestationReason('chain does not terminate at a pinned Google root')).toBe('ROOT_UNTRUSTED');
    expect(classifyAttestationReason('device_wrap_pubkey missing')).toBe('PUBKEY_MISSING');
    expect(classifyAttestationReason('leaf public key != device_wrap_pubkey')).toBe('PUBKEY_MISMATCH');
    expect(classifyAttestationReason('device_wrap_pubkey unparseable: bad DER')).toBe('PUBKEY_MISMATCH');
    expect(classifyAttestationReason('attestation challenge mismatch (not bound to this request)')).toBe('CHALLENGE_MISMATCH');
    expect(classifyAttestationReason('attestationChallenge field mismatch')).toBe('CHALLENGE_MISMATCH');
    expect(classifyAttestationReason('attestation security level not hardware (0)')).toBe('SECURITY_LEVEL_INVALID');
    expect(classifyAttestationReason('attested key origin not confirmed hardware-generated (origin=2)')).toBe('ORIGIN_INVALID');
    expect(classifyAttestationReason('attestation extension unparseable (strict)')).toBe('EXTENSION_UNPARSEABLE');
    expect(classifyAttestationReason('WIN_TPM_ATTESTED but no attestation claim present')).toBe('CLAIM_MISSING');
    expect(classifyAttestationReason('request signature invalid (not bound to this request / wrong key)')).toBe('SIGNATURE_INVALID');
    expect(classifyAttestationReason('strict: request signature required')).toBe('SIGNATURE_INVALID');
    expect(classifyAttestationReason('attestation cert revoked (REVOKED: KEY_COMPROMISE)')).toBe('CERT_REVOKED');
    expect(classifyAttestationReason('attestation nonce replay')).toBe('NONCE_REPLAY');
    expect(classifyAttestationReason('attestation timestamp skew')).toBe('CLOCK_SKEW');
    expect(classifyAttestationReason('no pinned attestation roots configured (LMS_ATTEST_ROOT_CERTS)')).toBe('SERVER_MISCONFIGURED');
    expect(classifyAttestationReason('LMS_ATTEST_STRICT set but no AIK roots configured')).toBe('SERVER_MISCONFIGURED');
  });

  it('falls back to UNKNOWN for anything unrecognized — never throws, never guesses', () => {
    expect(classifyAttestationReason('some brand new OpenSSL error we have never seen')).toBe('UNKNOWN');
    expect(classifyAttestationReason(undefined)).toBe('UNKNOWN');
    expect(classifyAttestationReason(null)).toBe('UNKNOWN');
    expect(classifyAttestationReason('')).toBe('UNKNOWN');
  });
});

describe('sanitizeReasonDetail', () => {
  it('passes short strings through unchanged', () => {
    expect(sanitizeReasonDetail('chain link 0 invalid')).toBe('chain link 0 invalid');
  });

  it('truncates a pathologically long / dynamic message to a bounded length', () => {
    const huge = 'chain parse failed: ' + 'x'.repeat(5000);
    const result = sanitizeReasonDetail(huge);
    expect(result.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('never throws on null/undefined input', () => {
    expect(sanitizeReasonDetail(undefined)).toBe('unknown');
    expect(sanitizeReasonDetail(null)).toBe('unknown');
  });
});

// ── recordAttestationIssue: severity separation + deduplication (reviewer items #2
//    and the TEMPORARY_ERROR policy question). Mocks supabaseAdmin so this never
//    touches a real database. ────────────────────────────────────────────────────
describe('recordAttestationIssue', () => {
  // The row shape recordAttestationIssue actually writes — used only to type-check
  // assertions against captured calls, never imported by the module under test.
  interface TimelineWriteRow {
    event_type: string;
    detail: {
      reason_code: string;
      count: number;
      action: string;
      [key: string]: unknown;
    };
  }
  type Call = { op: 'insert' | 'update'; args: TimelineWriteRow };

  interface FakeBuilder {
    select: () => FakeBuilder;
    eq: () => FakeBuilder;
    order: () => FakeBuilder;
    limit: () => FakeBuilder;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
    insert: (row: TimelineWriteRow) => Promise<{ data: { id: string }[]; error: null }>;
    update: (row: TimelineWriteRow) => { eq: () => Promise<{ error: null }> };
  }

  // Minimal fake Supabase query builder covering exactly the chain this module uses:
  // .from(t).select(...).eq(...).eq(...).order(...).limit(...).maybeSingle()  (read)
  // .from(t).insert({...})                                                    (write)
  // .from(t).update({...}).eq(...)                                            (write)
  function makeFakeSupabase(existingRow: { id: string; created_at: string; detail: unknown } | null) {
    const calls: Call[] = [];
    const builder: FakeBuilder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: existingRow, error: null }),
      insert: async (row) => {
        calls.push({ op: 'insert', args: row });
        return { data: [{ id: 'new-id' }], error: null };
      },
      update: (row) => {
        calls.push({ op: 'update', args: row });
        return { eq: async () => ({ error: null }) };
      },
    };
    return { admin: { from: () => builder }, calls };
  }

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('@/lib/supabase');
  });

  it('does NOT write anything for UNSUPPORTED or a VERIFIED_* success', async () => {
    const { admin, calls } = makeFakeSupabase(null);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp1', product: 'lms_lab_android', tier: 'UNSUPPORTED',
      rawReason: undefined, enforced: false, deviceModel: 'x301', ip: '1.2.3.4', stage: 'activate',
    });
    await recordAttestationIssue({
      deviceFingerprint: 'fp1', product: 'lms_lab_android', tier: 'VERIFIED_TEE',
      rawReason: undefined, enforced: false, deviceModel: 'Pixel', ip: '1.2.3.4', stage: 'activate',
    });
    expect(calls.length).toBe(0);
  });

  it('writes a NEW row as event_type ATTESTATION_ISSUE for INVALID/REVOKED/REPLAY_OR_SKEW', async () => {
    const { admin, calls } = makeFakeSupabase(null);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp2', product: 'lms_android', tier: 'INVALID',
      rawReason: 'leaf public key != device_wrap_pubkey', enforced: true,
      deviceModel: 'Pixel 7', ip: '5.6.7.8', stage: 'activate',
    });
    expect(calls.length).toBe(1);
    expect(calls[0].op).toBe('insert');
    const row = calls[0].args;
    expect(row.event_type).toBe('ATTESTATION_ISSUE');
    expect(row.detail.reason_code).toBe('PUBKEY_MISMATCH');
    expect(row.detail.count).toBe(1);
    expect(row.detail.action).toBe('REJECTED');
  });

  it('writes a DIFFERENT event_type (ATTESTATION_HEALTH_WARNING) for TEMPORARY_ERROR — never mixed with security events', async () => {
    const { admin, calls } = makeFakeSupabase(null);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp3', product: 'lms_lab_windows', tier: 'TEMPORARY_ERROR',
      rawReason: 'infra hiccup', enforced: false, deviceModel: 'DellPC', ip: '9.9.9.9', stage: 'activate',
    });
    expect(calls.length).toBe(1);
    const row = calls[0].args;
    expect(row.event_type).toBe('ATTESTATION_HEALTH_WARNING');
    expect(row.event_type).not.toBe('ATTESTATION_ISSUE');
  });

  it('deduplicates: same device + same reason code within the window UPDATES instead of inserting', async () => {
    const recentExisting = {
      id: 'row-1',
      created_at: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
      detail: { reason_code: 'CHAIN_MISSING', count: 3 },
    };
    const { admin, calls } = makeFakeSupabase(recentExisting);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp4', product: 'lms_android', tier: 'INVALID',
      rawReason: 'attestation chain missing or too short', enforced: true,
      deviceModel: 'x301', ip: '1.1.1.1', stage: 'activate',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].op).toBe('update');
    const detail = calls[0].args.detail;
    expect(detail.count).toBe(4); // incremented from 3, not reset to 1
  });

  it('does NOT deduplicate across a different reason code, even for the same device', async () => {
    const oldDifferentReason = {
      id: 'row-2',
      created_at: new Date(Date.now() - 60_000).toISOString(),
      detail: { reason_code: 'CHAIN_MISSING', count: 5 },
    };
    const { admin, calls } = makeFakeSupabase(oldDifferentReason);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp5', product: 'lms_android', tier: 'REVOKED',
      rawReason: 'attestation cert revoked (REVOKED: KEY_COMPROMISE)', enforced: true,
      deviceModel: 'Pixel', ip: '2.2.2.2', stage: 'activate',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].op).toBe('insert'); // new reason code -> fresh row, not merged
    const row = calls[0].args;
    expect(row.detail.reason_code).toBe('CERT_REVOKED');
    expect(row.detail.count).toBe(1);
  });

  it('does NOT deduplicate once the prior occurrence is outside the window', async () => {
    const stale = {
      id: 'row-3',
      created_at: new Date(Date.now() - 20 * 60_000).toISOString(), // 20 minutes ago
      detail: { reason_code: 'CHAIN_MISSING', count: 7 },
    };
    const { admin, calls } = makeFakeSupabase(stale);
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await recordAttestationIssue({
      deviceFingerprint: 'fp6', product: 'lms_android', tier: 'INVALID',
      rawReason: 'attestation chain missing or too short', enforced: true,
      deviceModel: 'x301', ip: '3.3.3.3', stage: 'activate',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].op).toBe('insert'); // stale -> starts a fresh occurrence, not a merge
    expect(calls[0].args.detail.count).toBe(1);
  });

  it('never throws when the DB write itself fails — activation verdict must be unaffected', async () => {
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({
          maybeSingle: async () => { throw new Error('connection reset'); },
        }) }) }) }) }),
      }),
    };
    vi.doMock('@/lib/supabase', () => ({ supabaseAdmin: admin }));
    const { recordAttestationIssue } = await import('@/lib/attestationTelemetry');

    await expect(
      recordAttestationIssue({
        deviceFingerprint: 'fp7', product: 'lms_android', tier: 'INVALID',
        rawReason: 'chain link 0 invalid', enforced: true,
        deviceModel: 'Pixel', ip: '4.4.4.4', stage: 'activate',
      })
    ).resolves.toBeUndefined();
  });
});
