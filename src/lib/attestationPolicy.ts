import { SECURITY_LEVEL } from '@/lib/attestationExtension';

// SF-2 remediation — single source of truth for "should this request be
// attestation-enforced", shared by /api/activate and /api/device/terms-accept so the
// two endpoints can never drift onto different postures (previously each kept its own
// hand-copied version of this logic).
//
// security_tier is CLIENT-SUPPLIED and must NEVER decide whether hardware attestation is
// enforced: a device can simply claim a non-attestable tier (or omit its chain) to make
// itself look like hardware that genuinely can't attest. The ONLY escape from enforcement
// is an EXPLICIT, operator-configured model allowlist (LMS_ATTEST_EXEMPT_MODELS). There is
// no built-in default any more — an unset/empty var exempts nothing, so a fresh deployment
// enforces every device once LMS_ENFORCE_ATTESTATION=true, until the operator explicitly
// lists real non-attestable hardware (e.g. x301 panels).
export function isModelExempt(deviceModel: string | null | undefined): boolean {
  const exemptModels = (process.env.LMS_ATTEST_EXEMPT_MODELS ?? '')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0);
  return exemptModels.includes((deviceModel ?? '').trim().toLowerCase());
}

export function shouldEnforceAttestation(deviceModel: string | null | undefined): boolean {
  return process.env.LMS_ENFORCE_ATTESTATION === 'true' && !isModelExempt(deviceModel);
}

// Server-derived, authoritative tier for persistence/telemetry — computed ENTIRELY from
// what the server itself cryptographically observed (chain-verification result, plus the
// hardware security level parsed from the attestation extension when available). This is
// what an admin should trust when auditing fleet posture. The raw client-reported
// security_tier is still persisted separately (existing security_tier column) purely as
// the client's own self-diagnosis — never as a trust signal.
export type ServerAttestationTier =
  | 'VERIFIED_STRONGBOX'
  | 'VERIFIED_TEE'
  | 'VERIFIED_UNSPECIFIED_HW' // chain verified, but extension security level unavailable (e.g. Windows, or strict off)
  | 'UNVERIFIED';

export function deriveServerTier(input: { attestationOk: boolean; securityLevel?: number }): ServerAttestationTier {
  if (!input.attestationOk) return 'UNVERIFIED';
  if (input.securityLevel === SECURITY_LEVEL.STRONGBOX) return 'VERIFIED_STRONGBOX';
  if (input.securityLevel === SECURITY_LEVEL.TEE) return 'VERIFIED_TEE';
  return 'VERIFIED_UNSPECIFIED_HW';
}

// One-time-per-instance sanity check for dangerous env-var combinations. Never throws —
// a bad config here must not crash the app, only surface loudly in startup logs so a
// self-inflicted total-outage (or a silently-reopened SF-2 hole) can't go unnoticed.
export function validateAttestationConfig(): void {
  const enforce = process.env.LMS_ENFORCE_ATTESTATION === 'true';
  const hasRoots = !!process.env.LMS_ATTEST_ROOT_CERTS?.trim();
  const exemptConfigured = !!process.env.LMS_ATTEST_EXEMPT_MODELS?.trim();

  if (enforce && !hasRoots) {
    console.error(
      '[ATTEST_CONFIG_CRITICAL]',
      JSON.stringify({
        message:
          'LMS_ENFORCE_ATTESTATION=true but LMS_ATTEST_ROOT_CERTS is not configured — ' +
          'every Android activation and terms-accept request will be rejected (no pinned root to verify against).',
      })
    );
  }
  if (process.env.LMS_ATTEST_STRICT === 'true' && !enforce) {
    console.warn(
      '[ATTEST_CONFIG_NOTE]',
      JSON.stringify({ message: 'LMS_ATTEST_STRICT=true has no effect while LMS_ENFORCE_ATTESTATION is not "true".' })
    );
  }
  if (process.env.LMS_WIN_ATTEST_STRICT === 'true' && !process.env.LMS_WIN_ATTEST_AIK_ROOTS?.trim()) {
    console.warn(
      '[ATTEST_CONFIG_NOTE]',
      JSON.stringify({
        message:
          'LMS_WIN_ATTEST_STRICT=true but LMS_WIN_ATTEST_AIK_ROOTS is not set — every WIN_TPM_ATTESTED request will be rejected under strict.',
      })
    );
  }
  if (!exemptConfigured) {
    console.warn(
      '[ATTEST_CONFIG_NOTE]',
      JSON.stringify({
        message:
          'LMS_ATTEST_EXEMPT_MODELS is not set — no device model is exempt from attestation enforcement. ' +
          'If the fleet includes hardware that cannot produce Google/TPM attestation (e.g. x301 panels), ' +
          'list it here explicitly, or those devices will be rejected once LMS_ENFORCE_ATTESTATION=true.',
      })
    );
  }
}
