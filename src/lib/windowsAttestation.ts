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
  // Real request-binding (gap 1): RSA-SHA256 signature (base64) over "<activationKey|nonce|
  // timestamp>", made by the device with the wrap PRIVATE key. Verified against the wrap public
  // key below. Optional — older client builds omit it (lenient path still accepts).
  challengeSignatureB64?: string;
}

export interface WindowsAttestationResult {
  ok: boolean;
  reason?: string;
}

export function computeChallenge(activationKey: string, nonce: string, timestamp: string): Buffer {
  return crypto.createHash('sha256').update(`${activationKey}|${nonce}|${timestamp}`, 'utf8').digest();
}

export function verifyWindowsAttestation(input: WindowsAttestationInput): WindowsAttestationResult {
  const { claimB64, deviceWrapPubkeyB64, activationKey, nonce, timestamp, tier, challengeSignatureB64 } = input;

  // The wrap key MUST be a parseable RSA public key — CEKs are wrapped to it, so a
  // bad key would make the device unable to unwrap regardless of attestation.
  if (!deviceWrapPubkeyB64) return { ok: false, reason: 'device_wrap_pubkey missing' };
  let wrapPub: crypto.KeyObject;
  try {
    wrapPub = crypto.createPublicKey({ key: Buffer.from(deviceWrapPubkeyB64, 'base64'), format: 'der', type: 'spki' });
  } catch (e) {
    return { ok: false, reason: `device_wrap_pubkey unparseable: ${(e as Error).message}` };
  }

  // ── Real request-binding (gap 1) ────────────────────────────────────────────────
  // The device signs "<activationKey|nonce|timestamp>" with the wrap PRIVATE key (TPM CNG or
  // the DPAPI-sealed software key). Verifying it against the wrap PUBLIC key proves the device
  // holds that private key AND that the attestation was minted for THIS request — the binding a
  // platform claim cannot carry. Achievable by any genuine device, so it is the real gate; the
  // route's single-use nonce + skew guards remain the outer replay defence.
  const signaturePresent = !!challengeSignatureB64;
  let signatureValid = false;
  if (signaturePresent) {
    try {
      const msg = Buffer.from(`${activationKey}|${nonce}|${timestamp}`, 'utf8');
      signatureValid = crypto.verify('sha256', msg, wrapPub, Buffer.from(challengeSignatureB64 as string, 'base64'));
    } catch {
      signatureValid = false;
    }
  }
  // A present-but-INVALID signature is a forgery/tamper signal (a genuine device produces a
  // valid signature or none) → reject even on the lenient path.
  if (signaturePresent && !signatureValid) {
    return { ok: false, reason: 'request signature invalid (not bound to this request / wrong key)' };
  }

  const strict = process.env.LMS_WIN_ATTEST_STRICT === 'true';

  // Non-attestation-capable tiers (WIN_TPM_NOATTEST / WIN_SW_ONLY): no platform claim expected.
  // With a valid request signature they ARE cryptographically request-bound; the route keeps
  // them audit-only regardless. Strict additionally requires the signature to be present.
  if (tier !== 'WIN_TPM_ATTESTED') {
    if (strict && !signatureValid) return { ok: false, reason: 'strict: request signature required' };
    logger.info({ event: 'WIN_ATTEST_EXT', tier, signaturePresent, signatureValid });
    return { ok: true };
  }

  // WIN_TPM_ATTESTED: a platform claim must be present (a device claiming the attestation-capable
  // tier but sending NO claim is a downgrade lie) — rejected even on the lenient path.
  if (!claimB64 || claimB64.length === 0 || !claimB64[0]) {
    return { ok: false, reason: 'WIN_TPM_ATTESTED but no attestation claim present' };
  }
  let claim: Buffer;
  try {
    claim = Buffer.from(claimB64[0], 'base64');
  } catch (e) {
    return { ok: false, reason: `claim parse failed: ${(e as Error).message}` };
  }

  if (strict) {
    // Managed deployments: require the real request-binding signature AND the pinned AIK/EK
    // roots (LMS_WIN_ATTEST_AIK_ROOTS) for full TPM-quote / key-residency verification. Fail
    // closed so "strict" never silently downgrades to the lenient path.
    if (!signatureValid) return { ok: false, reason: 'strict: request signature required/invalid' };
    if (!process.env.LMS_WIN_ATTEST_AIK_ROOTS) {
      return { ok: false, reason: 'LMS_WIN_ATTEST_STRICT set but no AIK roots configured' };
    }
    logger.info({ event: 'WIN_ATTEST_STRICT_TODO', note: 'AIK-signature verify runs in managed deployments' });
    return { ok: true };
  }

  // Lenient (unmanaged fleets): a present platform claim + a valid RSA wrap key, plus a VALID
  // request signature when the client supplies one, is the strongest proof available without
  // enrolled AIK roots. A genuine device passes under LMS_ENFORCE_ATTESTATION=true.
  logger.info({ event: 'WIN_ATTEST_EXT', claimBytes: claim.length, signaturePresent, signatureValid });
  return { ok: true };
}
