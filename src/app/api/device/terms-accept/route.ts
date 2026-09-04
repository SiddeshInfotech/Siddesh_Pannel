import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';
import { verifyAttestation, checkRevocation } from '@/lib/attestation';
import { verifyWindowsAttestation } from '@/lib/windowsAttestation';
import { resolveEffectiveProductId, resolveLegacyProductId } from '@/lib/product';
import { PRODUCT_ID_ENUM } from '@/lib/productIdentity';
import { shouldEnforceAttestation, isModelExempt, deriveServerTier } from '@/lib/attestationPolicy';
import { recordAttestationIssue } from '@/lib/attestationTelemetry';

// ============================================================================
// POST /api/device/terms-accept — pre-activation consent record
//
// The Android app calls this the instant the user accepts the Privacy Policy +
// Terms & Conditions, which happens BEFORE an activation key is entered. There is
// therefore no activation key to bind to yet — the record is keyed on the device
// fingerprint (the same value the device later sends to /api/activate), and the
// monitoring page joins the two on that fingerprint.
//
// SECURITY (Zero-Trust — never trust the client). Because no activation key exists
// yet, authenticity is proven the SAME way /api/activate proves it: HARDWARE KEY
// ATTESTATION. The device provisions a hardware-backed (TEE/StrongBox) key whose
// attestation challenge is bound to (terms-accept:<fingerprint>:<version> | nonce |
// timestamp) and sends the Google-rooted certificate chain. We verify that chain and
// challenge here, so a forged fingerprint from a non-genuine device cannot forge a
// record. Enforcement is staged by the SAME env flags as activation
// (LMS_ENFORCE_ATTESTATION / LMS_ATTEST_* / LMS_ATTEST_EXEMPT_MODELS), so the two
// endpoints always share one security posture and can never drift apart.
// Additional defenses: layered rate limits (IP burst + window + per-device), a
// single-use nonce (replay guard), a timestamp-skew bound, strict zod validation with
// length caps, uniform generic errors (details to logs only). The endpoint can only
// WRITE to terms_acceptances — it cannot read keys/content or mutate entitlement.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TermsSchema = z.object({
  device_fingerprint: z.string().min(8).max(256),
  terms_version: z.string().min(1).max(40),
  accepted_at: z.string().min(1).max(40),   // ISO-8601 UTC from the device
  nonce: z.string().min(8).max(128),
  timestamp: z.string().min(1).max(40),     // epoch millis as string
  device_model: z.string().max(120).optional(),
  device_os: z.string().max(60).optional(),
  // NC-1 hardware key-attestation (same scheme as /api/activate).
  // [WINDOWS] Desktop has no Android Keystore/StrongBox: it provisions a TPM (or DPAPI
  // software) wrap key via DrmPolicy and reports a WIN_* tier for telemetry only — SF-2:
  // it plays no role in whether enforcement applies (attestationPolicy.ts decides that
  // purely from LMS_ENFORCE_ATTESTATION + the explicit model allowlist). The obsolete
  // "DESKTOP" tier (empty pubkey) is still accepted for backward compatibility.
  device_wrap_pubkey: z.string().max(4096).optional().default(''),
  attestation_chain: z.array(z.string()).optional(),
  security_tier: z
    .enum([
      // Android (KeystoreCrypto) taxonomy — unchanged.
      'SW_ONLY',
      'TEE_LEGACY_NOATTEST',
      'MODEL_SKIP',
      'ATTESTED_STRONGBOX',
      'ATTESTED_TEE',
      'KEYSTORE_PLAIN',
      'PROVISION_FAILED',
      // Windows desktop (TpmSealing) taxonomy — advisory/logged only.
      'WIN_TPM_ATTESTED',
      'WIN_TPM_NOATTEST',
      'WIN_SW_ONLY',
      // Legacy desktop consent path (empty pubkey + tier "DESKTOP"). Kept for backward
      // compatibility with older Windows builds; also audit-only, never blocked.
      'DESKTOP',
    ])
    .optional(),
  // [Windows] Real request-binding: RSA-SHA256 signature (base64) over
  // "terms-accept:<fingerprint>:<version>|nonce|timestamp", made with the wrap private key.
  // Verified against device_wrap_pubkey (see verifyWindowsAttestation). Optional/advisory.
  challenge_signature: z.string().max(1024).optional(),
  // Canonical, compiled-in client product identity (src/lib/productIdentity.ts). Optional +
  // backward compatible — no activation key exists yet at this point, so there is nothing
  // to gate against; this is recorded for monitoring consistency only.
  product_id: z.enum(PRODUCT_ID_ENUM).optional(),
});

// SF-2: enforcement is decided by attestationPolicy.ts (shared with /api/activate) so
// the two endpoints can never drift onto different postures — security_tier is
// client-supplied and plays no role in that decision any more. ALERT_TIERS is still
// used here purely for logging.
const ALERT_TIERS = new Set(['PROVISION_FAILED', 'CEK_DECRYPT_FAILED']);

const isProd = process.env.NODE_ENV === 'production';
const MAX_SKEW_MS = 5 * 60 * 1000;          // clock-drift tolerance for air-gapped tablets
const RL_IP_BURST = { win: 10 * 1000, max: 10 };
const RL_IP_WIN = { win: 15 * 60 * 1000, max: 60 };
const RL_FP_WIN = { win: 15 * 60 * 1000, max: 10 };

async function bump(key: string, windowMs: number, max: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('bump_login_rate_limit', {
    p_key: key, p_window_ms: windowMs, p_max: max,
  });
  if (error) {
    // Fail OPEN on infra error so a DB hiccup can't blackout consent recording.
    logger.warn({ event: 'TERMS_RL_RPC_ERROR', key, error: error.message });
    return true;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.allowed ?? true;
}

function generic(status: number, msg: string) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // Gate 0 — IP burst + window rate limits BEFORE any parsing/DB work.
  if (isProd) {
    if (!(await bump(`terms_ip_burst:${ip}`, RL_IP_BURST.win, RL_IP_BURST.max)) ||
        !(await bump(`terms_ip:${ip}`, RL_IP_WIN.win, RL_IP_WIN.max))) {
      return generic(429, 'Too many requests.');
    }
  }

  let body: z.infer<typeof TermsSchema>;
  try {
    body = TermsSchema.parse(await req.json());
  } catch {
    return generic(400, 'Invalid request.');
  }
  const {
    device_fingerprint, terms_version, accepted_at, nonce, timestamp,
    device_model, device_os, device_wrap_pubkey, attestation_chain, security_tier,
    challenge_signature, product_id,
  } = body;
  const reportedTier = security_tier ?? 'UNREPORTED';

  // Gate 1 — per-device rate limit (a tablet should only accept occasionally).
  if (isProd && !(await bump(`terms_fp:${device_fingerprint}`, RL_FP_WIN.win, RL_FP_WIN.max))) {
    return generic(429, 'Too many requests.');
  }

  // Gate 2 — timestamp skew (bounds the replay window; nonce below is the real guard).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return generic(401, 'Request expired.');
  }

  // Gate 3 — single-use nonce. First use allowed; any repeat in the window blocked.
  if (isProd && !(await bump(`terms_nonce:${nonce}`, MAX_SKEW_MS, 1))) {
    logger.warn({ event: 'TERMS_NONCE_REPLAY', ipHash: ip.slice(0, 12) });
    return generic(401, 'Request rejected.');
  }

  // ── Gate 4 — NC-1 hardware key-attestation. Identical staging to /api/activate (via
  //    the shared attestationPolicy.ts): FAIL CLOSED for every device once
  //    LMS_ENFORCE_ATTESTATION=true, audit-only only for an EXPLICITLY model-exempt
  //    panel. The challenge binds to the same token the app used to provision its
  //    wrap key. ──────────────────────────────────────────────────────────────────
  {
    const requestModel = device_model || 'Unknown Tablet';
    const modelExempt = isModelExempt(requestModel);
    const enforceAttest = shouldEnforceAttestation(requestModel);

    if (ALERT_TIERS.has(reportedTier)) {
      console.warn('[TERMS_ATTEST_TIER_ALERT]', JSON.stringify({ tier: reportedTier, model: requestModel, ip }));
    }
    if (modelExempt) {
      console.warn('[TERMS_ATTEST_MODEL_EXEMPT]', JSON.stringify({ tier: reportedTier, model: requestModel, ip }));
    }

    // Route to the platform's attestation verifier (parity with /api/activate):
    // Windows (WIN_* tier, legacy DESKTOP tier, or a Windows device_os) = TPM platform
    // claim (DRM-006); Android = Google-rooted X.509 key-attestation chain. Same challenge
    // binding the app used: "terms-accept:<fingerprint>:<version>".
    const isWindows =
      reportedTier.startsWith('WIN_') ||
      reportedTier === 'DESKTOP' ||
      (device_os ?? '').toLowerCase().includes('windows');
    const bindToken = `terms-accept:${device_fingerprint}:${terms_version}`;
    const att = isWindows
      ? verifyWindowsAttestation({
          claimB64: attestation_chain ?? [],
          deviceWrapPubkeyB64: device_wrap_pubkey,
          activationKey: bindToken,
          nonce,
          timestamp,
          tier: reportedTier,
          challengeSignatureB64: challenge_signature,
        })
      : verifyAttestation({
          chainB64: attestation_chain ?? [],
          deviceWrapPubkeyB64: device_wrap_pubkey,
          activationKey: bindToken,
          nonce,
          timestamp,
        });
    // Google revocation list is Android-only; Windows TPM claims are not on it.
    const rev = isWindows
      ? { revoked: false as boolean, reason: undefined as string | undefined }
      : await checkRevocation(attestation_chain ?? []);

    // Real evidence presence, independent of whether it verified — same computation as
    // /api/activate. Gate 2/3 above already 401 skew/replay before this block runs, so
    // both are unconditionally "ok" here.
    const chainPresent = isWindows
      ? (attestation_chain?.length ?? 0) >= 1 && !!attestation_chain?.[0]
      : (attestation_chain?.length ?? 0) >= 2;
    const serverAttestationTier = deriveServerTier({
      isWindows,
      chainPresent,
      attestationOk: att.ok,
      revoked: rev.revoked,
      skewOk: true,
      nonceOk: true,
      securityLevel: att.securityLevel,
    });

    if (!att.ok || rev.revoked) {
      const reason = rev.revoked ? rev.reason : att.reason;
      // Admin-only diagnostic — same safeguards as /api/activate (bounded reason codes,
      // deduplication, best-effort, security-vs-health-warning separation): never
      // returned to the client. See attestationTelemetry.ts.
      await recordAttestationIssue({
        deviceFingerprint: device_fingerprint,
        product: resolveLegacyProductId({ securityTier: reportedTier, deviceOs: device_os }),
        tier: serverAttestationTier,
        rawReason: reason,
        enforced: enforceAttest,
        deviceModel: requestModel,
        ip,
        stage: 'terms-accept',
      });
      if (enforceAttest) {
        console.warn('[TERMS_ATTEST_FAILED_ENFORCED]', JSON.stringify({ tier: reportedTier, reason, ip }));
        return generic(401, 'Request verification failed.');
      }
      console.warn('[TERMS_ATTEST_FAILED_AUDIT]', JSON.stringify({ tier: reportedTier, reason, ip }));
    } else {
      console.log('[TERMS_ATTEST_OK]', JSON.stringify({ tier: reportedTier, chainLen: (attestation_chain ?? []).length, ip }));
    }
  }

  // Validate the device-supplied acceptance timestamp; fall back to server now()
  // if it can't be parsed (never trust the client to be well-formed).
  const acceptedAtIso = (() => {
    const d = new Date(accepted_at);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  const now = new Date().toISOString();
  // Which product recorded this consent: explicit product_id if sent, else the legacy
  // heuristic (device_os only — no app_version at this pre-activation stage).
  const product = resolveEffectiveProductId({ productId: product_id, securityTier: reportedTier, deviceOs: device_os });
  const { error: upErr } = await supabaseAdmin.from('terms_acceptances').upsert({
    device_fingerprint,
    terms_version,
    accepted_at: acceptedAtIso,
    device_model: device_model ?? null,
    device_os: device_os ?? null,
    ip_address: ip,
    updated_at: now,
  }, { onConflict: 'device_fingerprint' });

  if (upErr) {
    // Most likely the terms_acceptances table isn't migrated yet
    // (run scripts/add_terms_acceptances.sql). Log and return a generic 503.
    logger.error({ event: 'TERMS_UPSERT_ERROR', error: upErr.message });
    return generic(503, 'Service unavailable.');
  }

  // Canonical product tag — SEPARATE best-effort write so a not-yet-migrated `product_id`
  // column (run product-identity-upgrade.sql) can never fail an otherwise-successful
  // consent record. Skipped when unresolved.
  if (product !== 'UNKNOWN') {
    const { error: prodErr } = await supabaseAdmin
      .from('terms_acceptances')
      .update({ product_id: product })
      .eq('device_fingerprint', device_fingerprint);
    if (prodErr) logger.warn({ event: 'TERMS_PRODUCT_PERSIST_FAILED', error: prodErr.message });
  }

  return NextResponse.json({ ok: true });
}
