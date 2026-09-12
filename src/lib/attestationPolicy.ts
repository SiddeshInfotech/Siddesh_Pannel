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

// Managed classroom panels (interactive flat panels on uncertified Android builds): they
// cannot produce a Google-rooted hardware attestation chain and often ship a system `su`
// binary, so they need an operator-granted allowance. SEPARATE from LMS_ATTEST_EXEMPT_MODELS
// on purpose — that list keeps its exact existing meaning (x301: audit-only attestation,
// nothing else), while a managed panel additionally gets `device_class: "managed_panel"` signed
// into its licence payload (see /api/activate), which the Android client reads to tolerate a
// system root binary at video-key release (hook/debugger/emulator checks still apply).
//
// Entries are "MODEL@ANDROID_VERSION", comma-separated, e.g. "IFP-86X@11,IFP-75X@9":
//   • the Android version is REQUIRED — an operator must know exactly which panel build they
//     are allowing, and a model that later runs a different Android build is not covered;
//   • matching is exact after trim + lowercase (device_model == MODEL, device_os ==
//     "Android <VERSION>"); only Android devices can ever match.
// An entry without "@<version>" is ignored (flagged by validateAttestationConfig).
function managedPanelEntries(): Array<{ model: string; version: string }> {
  return (process.env.LMS_MANAGED_PANEL_MODELS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const at = entry.lastIndexOf('@');
      return at > 0
        ? { model: entry.slice(0, at).trim().toLowerCase(), version: entry.slice(at + 1).trim().toLowerCase() }
        : { model: '', version: '' };
    })
    .filter((e) => e.model.length > 0 && e.version.length > 0);
}

/** The "<version>" of an Android device_os ("Android 11" → "11"), or null for any non-Android OS. */
function androidVersionOf(deviceOs: string | null | undefined): string | null {
  const m = /^android\s+(.+)$/i.exec((deviceOs ?? '').trim());
  return m ? m[1].trim().toLowerCase() : null;
}

export function isManagedPanel(deviceModel: string | null | undefined, deviceOs: string | null | undefined): boolean {
  const version = androidVersionOf(deviceOs);
  if (version === null) return false;
  const model = (deviceModel ?? '').trim().toLowerCase();
  return managedPanelEntries().some((e) => e.model === model && e.version === version);
}

export function shouldEnforceAttestation(
  deviceModel: string | null | undefined,
  deviceOs?: string | null,
): boolean {
  return (
    process.env.LMS_ENFORCE_ATTESTATION === 'true' &&
    !isModelExempt(deviceModel) &&
    !isManagedPanel(deviceModel, deviceOs)
  );
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
export type ServerAttestationTier =
  | 'VERIFIED_STRONGBOX'
  | 'VERIFIED_TEE'
  | 'VERIFIED_PLATFORM_CLAIM'
  | 'VERIFIED_UNSPECIFIED_HW'
  | 'UNSUPPORTED'
  | 'INVALID'
  | 'REVOKED'
  | 'REPLAY_OR_SKEW'
  | 'TEMPORARY_ERROR';

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
  const malformedPanels = (process.env.LMS_MANAGED_PANEL_MODELS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^.+@.+$/.test(entry));
  if (malformedPanels.length > 0) {
    console.warn(
      '[ATTEST_CONFIG_NOTE]',
      JSON.stringify({
        message:
          'LMS_MANAGED_PANEL_MODELS entries must be "MODEL@ANDROID_VERSION" (e.g. "IFP-86X@11") — ' +
          'these entries are IGNORED until the Android version is added.',
        entries: malformedPanels,
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
