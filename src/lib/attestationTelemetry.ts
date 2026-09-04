import { supabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { ServerAttestationTier } from '@/lib/attestationPolicy';

// SF-2 follow-up (reviewer-requested hardening): admin-facing attestation-failure
// telemetry, centralized so /api/activate and /api/device/terms-accept can never drift
// onto different reason-coding, deduplication, or severity classification — the same
// reason this module's sibling, attestationPolicy.ts, exists.

// ── Bounded reason codes (never store an unbounded/dynamic string as the primary,
//    filterable signal) ───────────────────────────────────────────────────────────
// The verifier's raw `reason` strings (attestation.ts / windowsAttestation.ts) are a
// small fixed set TODAY, but nothing guarantees they stay that way forever — a future
// parser change could embed a dynamic OpenSSL/JS error message. Classify by PATTERN
// into this bounded enum so the admin UI's primary label/filter never depends on that
// assumption holding. The raw text is still kept (see sanitizeReasonDetail) as
// truncated, secondary, human-readable context — never as the thing anything filters
// or branches on.
export type AttestationReasonCode =
  | 'CHAIN_MISSING'
  | 'CHAIN_INVALID'
  | 'ROOT_UNTRUSTED'
  | 'PUBKEY_MISSING'
  | 'PUBKEY_MISMATCH'
  | 'CHALLENGE_MISMATCH'
  | 'SECURITY_LEVEL_INVALID'
  | 'ORIGIN_INVALID'
  | 'EXTENSION_UNPARSEABLE'
  | 'CLAIM_MISSING'
  | 'SIGNATURE_INVALID'
  | 'CERT_REVOKED'
  | 'NONCE_REPLAY'
  | 'CLOCK_SKEW'
  | 'SERVER_MISCONFIGURED'
  | 'UNKNOWN';

const REASON_PATTERNS: ReadonlyArray<readonly [RegExp, AttestationReasonCode]> = [
  [/chain missing or too short/, 'CHAIN_MISSING'],
  [/no pinned attestation roots/, 'SERVER_MISCONFIGURED'],
  [/no aik roots configured/, 'SERVER_MISCONFIGURED'],
  [/does not terminate at a pinned/, 'ROOT_UNTRUSTED'],
  [/device_wrap_pubkey missing/, 'PUBKEY_MISSING'],
  [/!= device_wrap_pubkey/, 'PUBKEY_MISMATCH'],
  [/device_wrap_pubkey unparseable/, 'PUBKEY_MISMATCH'],
  [/challenge/, 'CHALLENGE_MISMATCH'],
  [/security level not hardware/, 'SECURITY_LEVEL_INVALID'],
  [/origin not confirmed hardware-generated/, 'ORIGIN_INVALID'],
  [/extension unparseable/, 'EXTENSION_UNPARSEABLE'],
  [/no attestation claim present/, 'CLAIM_MISSING'],
  [/signature invalid|signature required/, 'SIGNATURE_INVALID'],
  [/cert revoked/, 'CERT_REVOKED'],
  [/^attestation nonce replay$/, 'NONCE_REPLAY'],
  [/^attestation timestamp skew$/, 'CLOCK_SKEW'],
  [/chain link \d+ invalid/, 'CHAIN_INVALID'],
  [/chain parse failed/, 'CHAIN_INVALID'],
  [/claim parse failed/, 'CHAIN_INVALID'],
  [/leaf key export failed/, 'CHAIN_INVALID'],
  [/outside validity window/, 'CHAIN_INVALID'],
];

export function classifyAttestationReason(rawReason: string | null | undefined): AttestationReasonCode {
  const s = (rawReason ?? '').toLowerCase();
  if (!s) return 'UNKNOWN';
  for (const [pattern, code] of REASON_PATTERNS) {
    if (pattern.test(s)) return code;
  }
  return 'UNKNOWN';
}

const MAX_REASON_DETAIL_LEN = 200;
/** Truncated, secondary context only — never the primary/filterable signal. */
export function sanitizeReasonDetail(rawReason: string | null | undefined): string {
  const s = (rawReason ?? 'unknown').toString();
  return s.length > MAX_REASON_DETAIL_LEN ? s.slice(0, MAX_REASON_DETAIL_LEN) + '…' : s;
}

// ── Severity classification ─────────────────────────────────────────────────────
// INVALID/REVOKED/REPLAY_OR_SKEW are genuine security events (bad/forged/replayed
// evidence). TEMPORARY_ERROR is reserved for a distinguishable INFRA-side failure
// (not yet produced by any current code path — see attestationPolicy.ts) and must
// NEVER be classified alongside real attack evidence: an attestation-service outage
// must not make a fleet of legitimate devices look compromised. Kept as two disjoint
// sets (not one, with a branch) so a future addition to either can't accidentally
// land in both.
const SECURITY_TIERS = new Set<ServerAttestationTier>(['INVALID', 'REVOKED', 'REPLAY_OR_SKEW']);
const HEALTH_WARNING_TIERS = new Set<ServerAttestationTier>(['TEMPORARY_ERROR']);

export const EVENT_TYPE_SECURITY = 'ATTESTATION_ISSUE';
export const EVENT_TYPE_HEALTH = 'ATTESTATION_HEALTH_WARNING';

const DEDUP_WINDOW_MS = 15 * 60 * 1000;

export interface AttestationIssueInput {
  deviceFingerprint: string;
  product: string | null;
  tier: ServerAttestationTier;
  rawReason: string | null | undefined;
  enforced: boolean;
  deviceModel: string;
  ip: string;
  stage: 'activate' | 'terms-accept';
}

/**
 * Records an admin-visible attestation problem — SAFEGUARDS:
 *   1. Never returned to the device (caller's HTTP response is unaffected either way).
 *   2. Only genuine problem tiers write anything (checked here too, defense in depth,
 *      even though callers already gate on this) — never the routine no-hardware case.
 *   3. Best-effort: any DB error is swallowed after logging; this never affects the
 *      activation/terms-accept verdict.
 *   4. Deduplicated: the SAME device + SAME reason code within DEDUP_WINDOW_MS updates
 *      one row's occurrence count instead of inserting another — an attacker retrying
 *      the same invalid evidence cannot flood the timeline or the database.
 *   5. Security events (INVALID/REVOKED/REPLAY_OR_SKEW) and health warnings
 *      (TEMPORARY_ERROR) are written as DIFFERENT event_types so the admin UI can never
 *      conflate "someone attacked this device" with "our own verification had a hiccup."
 */
export async function recordAttestationIssue(input: AttestationIssueInput): Promise<void> {
  const isSecurity = SECURITY_TIERS.has(input.tier);
  const isHealth = HEALTH_WARNING_TIERS.has(input.tier);
  if (!isSecurity && !isHealth) return; // UNSUPPORTED / VERIFIED_* — nothing to record

  const eventType = isSecurity ? EVENT_TYPE_SECURITY : EVENT_TYPE_HEALTH;
  const reasonCode = classifyAttestationReason(input.rawReason);
  const reasonDetail = sanitizeReasonDetail(input.rawReason);
  const nowIso = new Date().toISOString();

  try {
    const { data: existing } = await supabaseAdmin
      .from('device_timeline')
      .select('id, created_at, detail')
      .eq('device_fingerprint', input.deviceFingerprint)
      .eq('event_type', eventType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingDetail = (existing?.detail ?? {}) as Record<string, unknown>;
    const withinWindow =
      !!existing && Date.now() - new Date(existing.created_at).getTime() < DEDUP_WINDOW_MS;
    const sameReason = existingDetail.reason_code === reasonCode;

    if (existing && withinWindow && sameReason) {
      const priorCount = typeof existingDetail.count === 'number' ? existingDetail.count : 1;
      const { error } = await supabaseAdmin
        .from('device_timeline')
        .update({
          detail: {
            ...existingDetail,
            count: priorCount + 1,
            last_seen_at: nowIso,
            reason_detail: reasonDetail,
            enforced: input.enforced,
            action: input.enforced ? 'REJECTED' : 'ALLOWED_AUDIT_ONLY',
          },
        })
        .eq('id', existing.id);
      if (error) logger.warn({ event: 'ATTESTATION_ISSUE_DEDUP_UPDATE_FAILED', error: error.message });
      return;
    }

    const { error } = await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint: input.deviceFingerprint,
      school_id: null,
      vendor_id: null,
      parent_id: null,
      product: input.product,
      event_type: eventType,
      detail: {
        tier: input.tier,
        reason_code: reasonCode,
        reason_detail: reasonDetail,
        count: 1,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        enforced: input.enforced,
        action: input.enforced ? 'REJECTED' : 'ALLOWED_AUDIT_ONLY',
        device_model: input.deviceModel,
        ip: input.ip,
        stage: input.stage,
      },
    });
    if (error) logger.warn({ event: 'ATTESTATION_ISSUE_INSERT_FAILED', error: error.message });
  } catch (e) {
    logger.warn({
      event: 'ATTESTATION_ISSUE_TIMELINE_FAILED',
      stage: input.stage,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
