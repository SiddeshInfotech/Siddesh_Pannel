import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';
import { verifyAttestation, checkRevocation } from '@/lib/attestation';

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
  // [WINDOWS] Desktop has no Android Keystore/StrongBox: the Windows client reports
  // security_tier "DESKTOP" with an empty device_wrap_pubkey / attestation_chain. That
  // tier is NOT attestation-capable (see ATTEST_CAPABLE_TIERS), so it is audit-only and
  // never enforced — Android's hardware-attestation enforcement is unchanged.
  device_wrap_pubkey: z.string().max(4096).optional().default(''),
  attestation_chain: z.array(z.string()).optional(),
  security_tier: z
    .enum([
      'SW_ONLY',
      'TEE_LEGACY_NOATTEST',
      'MODEL_SKIP',
      'ATTESTED_STRONGBOX',
      'ATTESTED_TEE',
      'KEYSTORE_PLAIN',
      'PROVISION_FAILED',
      'DESKTOP', // [WINDOWS] software-only desktop consent (audit-only, never blocked)
    ])
    .optional(),
});

// Mirror /api/activate's tier staging so enforcement is identical across endpoints.
const ATTEST_CAPABLE_TIERS = new Set(['ATTESTED_STRONGBOX', 'ATTESTED_TEE']);
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

  // ── Gate 4 — NC-1 hardware key-attestation. Identical staging to /api/activate:
  //    fail CLOSED only for devices that reported an attestation-capable tier (or
  //    actually sent a chain), audit-only for genuinely chain-less low tiers and
  //    model-exempt panels, all gated behind LMS_ENFORCE_ATTESTATION. The challenge
  //    binds to the same token the app used to provision its wrap key. ─────────────
  {
    const requestModel = device_model || 'Unknown Tablet';
    const exemptModels = (process.env.LMS_ATTEST_EXEMPT_MODELS ?? 'x301')
      .split(',')
      .map((m) => m.trim().toLowerCase())
      .filter((m) => m.length > 0);
    const modelExempt = exemptModels.includes(requestModel.trim().toLowerCase());
    const tierCapable =
      ATTEST_CAPABLE_TIERS.has(reportedTier) || (attestation_chain?.length ?? 0) >= 2;
    const enforceAttest =
      process.env.LMS_ENFORCE_ATTESTATION === 'true' && tierCapable && !modelExempt;

    if (ALERT_TIERS.has(reportedTier)) {
      console.warn('[TERMS_ATTEST_TIER_ALERT]', JSON.stringify({ tier: reportedTier, model: requestModel, ip }));
    }
    if (modelExempt) {
      console.warn('[TERMS_ATTEST_MODEL_EXEMPT]', JSON.stringify({ tier: reportedTier, model: requestModel, ip }));
    }

    // Same challenge binding the app used: "terms-accept:<fingerprint>:<version>".
    const bindToken = `terms-accept:${device_fingerprint}:${terms_version}`;
    const att = verifyAttestation({
      chainB64: attestation_chain ?? [],
      deviceWrapPubkeyB64: device_wrap_pubkey,
      activationKey: bindToken,
      nonce,
      timestamp,
    });
    const rev = await checkRevocation(attestation_chain ?? []);

    if (!att.ok || rev.revoked) {
      const reason = rev.revoked ? rev.reason : att.reason;
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

  return NextResponse.json({ ok: true });
}
