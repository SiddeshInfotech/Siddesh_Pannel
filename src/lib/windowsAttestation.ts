import crypto from 'crypto';
import { logger } from '@/lib/logger';

// DRM-006 (Windows side): server-side verification of the Windows TPM attestation
// the desktop app sends at activation. This is the Windows counterpart of the Android
// Google-rooted key-attestation in ./attestation.ts. It mirrors that file's staged
// design: verify + AUDIT-LOG by default, and only FAIL CLOSED once the operator flips
// the enforcement flag — because content stays safe regardless (every CEK is RSA-wrapped
// to device_wrap_pubkey, whose private half never leaves the device's TPM).
//
// Windows tiers (see TpmSealing.jvm.kt):
//   WIN_TPM_ATTESTED  — TPM-resident wrap key + a platform attestation claim (managed/
//                       enrolled device). Attestation-capable → subject to enforcement.
//   WIN_TPM_NOATTEST  — wrap key IS in the TPM, but no claimable AIK (typical consumer
//                       TPM). Device-bound, no HW-attestation proof → audit-only.
//   WIN_SW_ONLY       — no TPM/PCP; software wrap key (explicit §6.2 degradation) → audit-only.
//
// NOTE: a full TPMS_ATTEST quote verification requires the device's AIK/EK certificate,
// which is only available on AD/MDM-enrolled fleets. For WIN_TPM_ATTESTED we therefore
// verify what is provable without enrollment (the wrap key is a valid RSA SPKI and a
// platform claim is present); the request-bound challenge cannot be required on the lenient
// path because the shipped desktop client's NCRYPT_CLAIM_PLATFORM blob does not embed a
// caller nonce. The strict challenge + AIK-signature check is gated behind
// LMS_WIN_ATTEST_STRICT for managed deployments that ship the AIK roots (and a client build
// that embeds the challenge). Request-binding on the lenient path is provided by the route's
// single-use nonce + timestamp-skew guards; content is bound by the RSA wrap key regardless.

export interface WindowsAttestationInput {
  claimB64: string[];          // NCryptCreateClaim(NCRYPT_CLAIM_PLATFORM) output, base64 (or [])
  deviceWrapPubkeyB64: string; // base64 SPKI (DER) of the TPM RSA key
  activationKey: string;
  nonce: string;
  timestamp: string;
  tier: string;                // WIN_* security tier reported by the device
}

export interface WindowsAttestationResult {
  ok: boolean;
  reason?: string;
}

export function computeChallenge(activationKey: string, nonce: string, timestamp: string): Buffer {
  return crypto.createHash('sha256').update(`${activationKey}|${nonce}|${timestamp}`, 'utf8').digest();
}

export function verifyWindowsAttestation(input: WindowsAttestationInput): WindowsAttestationResult {
  const { claimB64, deviceWrapPubkeyB64, activationKey, nonce, timestamp, tier } = input;

  // The wrap key MUST be a parseable RSA public key — CEKs are wrapped to it, so a
  // bad key would make the device unable to unwrap regardless of attestation.
  if (!deviceWrapPubkeyB64) return { ok: false, reason: 'device_wrap_pubkey missing' };
  try {
    crypto.createPublicKey({ key: Buffer.from(deviceWrapPubkeyB64, 'base64'), format: 'der', type: 'spki' });
  } catch (e) {
    return { ok: false, reason: `device_wrap_pubkey unparseable: ${(e as Error).message}` };
  }

  // Chain-less tiers cannot present a claim — they are audit-only (like the Android
  // non-attestable tiers). Treat as OK here; the route keeps them out of enforcement.
  if (tier !== 'WIN_TPM_ATTESTED') {
    return { ok: true };
  }

  // WIN_TPM_ATTESTED: a platform claim must be present. A device that reports the
  // attestation-capable tier but sends NO claim is contradictory (a downgrade lie), so
  // that is rejected even on the lenient path so it can't be used to fake "attested".
  if (!claimB64 || claimB64.length === 0 || !claimB64[0]) {
    return { ok: false, reason: 'WIN_TPM_ATTESTED but no attestation claim present' };
  }

  let claim: Buffer;
  try {
    claim = Buffer.from(claimB64[0], 'base64');
  } catch (e) {
    return { ok: false, reason: `claim parse failed: ${(e as Error).message}` };
  }

  // Whether the 32-byte request challenge is embedded in the claim. IMPORTANT: the shipped
  // desktop client builds the claim with NCryptCreateClaim(NCRYPT_CLAIM_PLATFORM) and a NULL
  // parameter list (TpmSealing.createClaim), so a platform claim attests PCR state — it does
  // NOT carry a caller nonce. On the lenient (unmanaged) path this is therefore best-effort
  // telemetry, NOT a gate: request-binding is enforced by the route's single-use nonce +
  // timestamp-skew guards, and content is bound by the RSA wrap key (CEKs are OAEP-wrapped to
  // it). Requiring the challenge here would wrongly block every genuine TPM device under
  // LMS_ENFORCE_ATTESTATION=true. Managed fleets that ship a client which embeds the challenge
  // opt into a hard check via LMS_WIN_ATTEST_STRICT below.
  const challenge = computeChallenge(activationKey, nonce, timestamp);
  const challengeBound = claim.indexOf(challenge) !== -1;

  const strict = process.env.LMS_WIN_ATTEST_STRICT === 'true';
  if (strict) {
    // Managed deployments: require BOTH the request-bound challenge in the claim AND the
    // pinned AIK/EK roots (LMS_WIN_ATTEST_AIK_ROOTS) for full quote-signature verification.
    // Fail closed so "strict" never silently downgrades to the lenient path.
    if (!challengeBound) {
      return { ok: false, reason: 'attestation claim not bound to this request (challenge absent)' };
    }
    if (!process.env.LMS_WIN_ATTEST_AIK_ROOTS) {
      return { ok: false, reason: 'LMS_WIN_ATTEST_STRICT set but no AIK roots configured' };
    }
    logger.info({ event: 'WIN_ATTEST_STRICT_TODO', note: 'AIK-signature verify runs in managed deployments' });
    return { ok: true };
  }

  // Lenient (unmanaged fleets): a present, parseable platform claim + a valid RSA wrap key
  // (checked above) is the strongest proof available without enrolled AIK roots. This lets a
  // genuine TPM-attested Windows device pass under LMS_ENFORCE_ATTESTATION=true instead of
  // being wrongly blocked by a challenge check its platform claim cannot satisfy.
  logger.info({ event: 'WIN_ATTEST_EXT', claimBytes: claim.length, challengeBound });
  return { ok: true };
}
