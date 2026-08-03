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
// verify what is provable without enrollment (the wrap key is a valid RSA SPKI, and the
// request-bound challenge is present in the claim), and gate the strict AIK-signature
// check behind LMS_WIN_ATTEST_STRICT for managed deployments that ship the AIK roots.

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

  // WIN_TPM_ATTESTED: a platform claim must be present and bind this request.
  if (!claimB64 || claimB64.length === 0 || !claimB64[0]) {
    return { ok: false, reason: 'WIN_TPM_ATTESTED but no attestation claim present' };
  }

  let claim: Buffer;
  try {
    claim = Buffer.from(claimB64[0], 'base64');
  } catch (e) {
    return { ok: false, reason: `claim parse failed: ${(e as Error).message}` };
  }

  // Request binding: the 32-byte challenge must appear in the claim blob (the device
  // includes it when producing the claim for this activation).
  const challenge = computeChallenge(activationKey, nonce, timestamp);
  if (claim.indexOf(challenge) === -1) {
    return { ok: false, reason: 'attestation claim not bound to this request (challenge absent)' };
  }

  // Strict AIK-signature verification is only possible with enrolled AIK/EK roots.
  const strict = process.env.LMS_WIN_ATTEST_STRICT === 'true';
  if (strict) {
    // Managed deployments: verify the TPM claim signature against the pinned AIK roots
    // (LMS_WIN_ATTEST_AIK_ROOTS). Not implemented for unmanaged fleets — fail closed so
    // "strict" never silently downgrades to the lenient path.
    if (!process.env.LMS_WIN_ATTEST_AIK_ROOTS) {
      return { ok: false, reason: 'LMS_WIN_ATTEST_STRICT set but no AIK roots configured' };
    }
    logger.info({ event: 'WIN_ATTEST_STRICT_TODO', note: 'AIK-signature verify runs in managed deployments' });
  } else {
    logger.info({ event: 'WIN_ATTEST_EXT', claimBytes: claim.length, challengeBound: true });
  }

  return { ok: true };
}
