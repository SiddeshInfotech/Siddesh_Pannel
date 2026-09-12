import { SECURITY_LEVEL } from '@/lib/attestationExtension';

// SF-2 remediation — single source of truth for "should this request be
// attestation-enforced", shared by /api/activate and /api/device/terms-accept so the
// two endpoints can never drift onto different postures.
//
// NOTHING the device reports about itself can lower security: not security_tier (a device can
// claim a non-attestable tier or omit its chain), and not model / brand / OS strings (Build.MODEL
// is attacker-settable). The two former model allowlists — LMS_ATTEST_EXEMPT_MODELS (x301) and
// LMS_MANAGED_PANEL_MODELS — were REMOVED for that reason; model values are telemetry only.
// Interactive panels without Google attestation are handled by operator-issued
// Interactive-panel KEYS (src/lib/deviceClass.ts) inside /api/activate instead.
export function shouldEnforceAttestation(): boolean {
  return process.env.LMS_ENFORCE_ATTESTATION === 'true';
}

// Server-derived, authoritative tier for persistence/telemetry — computed ENTIRELY from
// what the server itself cryptographically observed. This is what an admin should trust
// when auditing fleet posture. The raw client-reported security_tier is still persisted
// separately (existing security_tier column) purely as the client's own self-diagnosis —
// never as a trust signal.
//
// Distinct outcomes are kept SEPARATE on purpose (never collapsed into one "unverified"
// bucket) so an admin/incident-responder can tell "this device genuinely has no hardware
// security" from "this device presented evidence that was actively wrong/revoked/replayed" —
// those are very different situations even though both currently result in the SAME
// enforcement outcome (audit-only or reject, decided independently in route.ts).
//
//   VERIFIED_STRONGBOX     Android, hardware security level confirmed STRONGBOX.
//   VERIFIED_TEE           Android, hardware security level confirmed TEE.
//   VERIFIED_UNSPECIFIED_HW  Chain verified ok, but the hardware security level wasn't
//                            parsed (e.g. LMS_ATTEST_STRICT off, or the extension parser
//                            couldn't read it) — evidence is real, just not classified.
//   VERIFIED_PLATFORM_CLAIM  Windows only. A TPM platform claim was present and the
//                            request was self-consistently signed by the claimed wrap
//                            key. This is DELIBERATELY NOT equated with VERIFIED_TEE/
//                            VERIFIED_STRONGBOX: without AIK/EK enrollment (see
//                            windowsAttestation.ts), the server cannot cryptographically
//                            confirm the claim actually originates from silicon TPM
//                            rather than a well-behaved software impostor. Treat this as
//                            "device asserted a platform claim, self-consistently," not
//                            as parity with Android's hardware proof.
//   UNSUPPORTED            No evidence was presented, and none was expected/required —
//                          the genuinely-non-attestable path (old Android hardware,
//                          Windows without a usable TPM). Not a failure.
//   INVALID                Evidence was presented (or, on Windows, was claimed-required
//                          but omitted) and failed verification — wrong root, bad
//                          signature, wrong challenge, wrong pubkey, bad key origin, or a
//                          WIN_TPM_ATTESTED claim that provided no actual claim bytes.
//   REVOKED                The presented certificate is on Google's revocation list.
//   REPLAY_OR_SKEW         Timestamp outside the allowed skew, or the nonce was reused.
//   TEMPORARY_ERROR        Reserved for a distinguishable infra-side failure (e.g. the
//                          nonce-replay or revocation checks themselves erroring out,
//                          which today fail OPEN and are indistinguishable from a clean
//                          pass at the call site) — not yet produced by any current code
//                          path. Kept in the enum so a future infra-error signal doesn't
//                          need a schema/taxonomy change to report through.
//   MANAGED_PANEL_BOUND    Android activated with an operator-issued Interactive-panel key and
//                          no verified hardware attestation. Means: licence-authorized + bound
//                          to one device key (rolling proof-of-possession on every heartbeat).
//                          It is NOT hardware-attested and must never be shown as such. Set by
//                          /api/activate (deriveServerTier never produces it).
export type ServerAttestationTier =
  | 'VERIFIED_STRONGBOX'
  | 'VERIFIED_TEE'
  | 'VERIFIED_PLATFORM_CLAIM'
  | 'VERIFIED_UNSPECIFIED_HW'
  | 'UNSUPPORTED'
  | 'INVALID'
  | 'REVOKED'
  | 'REPLAY_OR_SKEW'
  | 'TEMPORARY_ERROR'
  | 'MANAGED_PANEL_BOUND';

export function deriveServerTier(input: {
  isWindows: boolean;
  // Whether real evidence (Android: a >=2-cert chain; Windows: a non-empty platform
  // claim blob) was actually present in the request — independent of whether it verified.
  chainPresent: boolean;
  attestationOk: boolean;
  revoked: boolean;
  skewOk: boolean;
  nonceOk: boolean;
  securityLevel?: number;
}): ServerAttestationTier {
  if (input.revoked) return 'REVOKED';
  if (!input.skewOk || !input.nonceOk) return 'REPLAY_OR_SKEW';
  if (!input.chainPresent) {
    // Android's verifier requires a chain unconditionally, so "no chain" is the normal
    // shape of a genuinely non-attestable Android device (SW_ONLY/TEE_LEGACY_NOATTEST/
    // KEYSTORE_PLAIN) — never itself a red flag. Windows' lenient verifier only demands a
    // claim when the device claims WIN_TPM_ATTESTED, so "no claim" with attestationOk
    // already false there specifically means "claimed capable, produced nothing."
    if (input.isWindows && !input.attestationOk) return 'INVALID';
    return 'UNSUPPORTED';
  }
  if (!input.attestationOk) return 'INVALID';
  if (input.isWindows) return 'VERIFIED_PLATFORM_CLAIM';
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
  // No managed TPM/AIK verifier exists yet (see windowsAttestation.ts) — strict mode fails
  // closed unconditionally for WIN_TPM_ATTESTED, regardless of LMS_WIN_ATTEST_AIK_ROOTS. This
  // is CRITICAL, not a NOTE: it means every attestation-capable Windows device will be
  // rejected outright the moment this flag is set, until real managed verification ships.
  if (process.env.LMS_WIN_ATTEST_STRICT === 'true') {
    console.error(
      '[ATTEST_CONFIG_CRITICAL]',
      JSON.stringify({
        message:
          'LMS_WIN_ATTEST_STRICT=true but no managed TPM/AIK verifier is implemented yet — ' +
          'every WIN_TPM_ATTESTED Windows activation/heartbeat will be REJECTED, not verified. ' +
          'Leave this unset (Windows stays on the lenient VERIFIED_PLATFORM_CLAIM path) until ' +
          'real AD CS / Intune / MDM-backed AIK verification is implemented.',
      })
    );
  }
  // Removed model allowlists: still set in an environment → say loudly that they do nothing, so
  // nobody believes a device model is exempt. Interactive panels use panel KEYS.
  const ignoredModelVars = ['LMS_ATTEST_EXEMPT_MODELS', 'LMS_MANAGED_PANEL_MODELS']
    .filter((name) => !!process.env[name]?.trim());
  if (ignoredModelVars.length > 0) {
    console.warn(
      '[ATTEST_CONFIG_NOTE]',
      JSON.stringify({
        message:
          `${ignoredModelVars.join(' and ')} ${ignoredModelVars.length > 1 ? 'are' : 'is'} IGNORED — a device model is ` +
          'self-reported and never lowers security. Generate Interactive-panel keys for panels without Google ' +
          'attestation, and remove these variables.',
      })
    );
  }
}
