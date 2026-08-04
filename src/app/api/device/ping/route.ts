import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';
import { signPayload } from '@/lib/licenseSign';

// ============================================================================
// POST /api/device/ping  — device online heartbeat (Telemetry, Phase 1)
//
// Threat model / defenses (ASVS L2, Zero-Trust — never trust the client):
//  • Device-bound authZ: the (activation_key, device_fingerprint) pair MUST match
//    an *Active* activation_keys row bound to THIS device. A key alone is useless;
//    a stolen key on another device fails the fingerprint check (IDOR/clone guard).
//  • Replay: single-use nonce (bump RPC max=1 over the skew window) + timestamp
//    skew bound. A captured heartbeat cannot be re-sent.
//  • DoS/enumeration: layered rate limits per IP (burst + window) and per device.
//  • Input validation: strict zod schema, length caps.
//  • Least disclosure: uniform generic errors; details only in server logs.
//  • No secrets in response; server_time is returned for device clock sync only.
// The endpoint only ever WRITES telemetry (device_status/device_timeline); it can
// neither read content keys nor mutate entitlement.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PingSchema = z.object({
  activation_key: z.string().min(1).max(200),
  device_fingerprint: z.string().min(8).max(256),
  app_version: z.string().min(1).max(40),
  nonce: z.string().min(8).max(128),
  timestamp: z.string().min(1).max(40), // epoch millis as string
  // Persisted device security tier, re-sent every heartbeat (may be "" for devices
  // activated before the field existed). Kept as a loose string (bounded length) so a
  // future tier value from a newer app can't 400 an otherwise-valid heartbeat.
  security_tier: z.string().max(40).optional(),
  // Tier 8: set to "DECRYPT_FAILED" when a wrapped CEK failed to unwrap on-device since
  // the last heartbeat (previously swallowed to "" inside KeystoreCrypto.unwrap()).
  cek_status: z.enum(['DECRYPT_FAILED']).optional(),
  // EXPIRY-TAMPER telemetry: the client fail-closes locally when it detects an attempt to
  // tamper with the licence/expiry, and reports the reason here so an admin can SEE it.
  //   CLOCK_ROLLBACK   — device wall clock was set behind the sealed monotonic high-water-mark
  //   STORAGE_TAMPER   — the activation record file was edited (side field ignored / mismatch)
  //   SIGNATURE_INVALID— the stored signed payload no longer verifies (forged/edited)
  //   GUARD_UNSEAL_FAIL— the TPM/DPAPI-sealed anti-rollback sidecar could not be unsealed
  //   FINGERPRINT_MISMATCH — signed device binding does not match this device (clone/restore)
  //   LEASE_INVALID    — a Signed Renewable Lease failed signature/binding verification
  tamper_status: z
    .enum(['CLOCK_ROLLBACK', 'STORAGE_TAMPER', 'SIGNATURE_INVALID', 'GUARD_UNSEAL_FAIL', 'FINGERPRINT_MISMATCH', 'LEASE_INVALID'])
    .optional(),
});

const isProd = process.env.NODE_ENV === 'production';
// ── Signed Renewable Lease (SRL) — docs/Expiry_Server_Authority_Design.md ──────
// Dark-launched: emit only when LMS_LEASE_ENABLED=true. Old clients ignore the extra
// fields, so turning this on is backward compatible. The lease is ECDSA-signed with the
// SAME key /api/activate uses, so the client verifies it with the already-pinned pubkey.
const LEASE_ENABLED = process.env.LMS_LEASE_ENABLED === 'true';
const LEASE_TTL_DAYS = Number(process.env.LMS_LEASE_TTL_DAYS ?? 14);
const MAX_SKEW_MS = 5 * 60 * 1000;         // clock-drift tolerance for air-gapped tablets
const SESSION_GAP_MS = 6 * 60 * 1000;      // gap > this ⇒ a NEW online session (new timeline row)
const RL_IP_BURST = { win: 10 * 1000, max: 10 };
const RL_IP_WIN = { win: 15 * 60 * 1000, max: 120 };
const RL_FP_WIN = { win: 15 * 60 * 1000, max: 60 };

async function bump(key: string, windowMs: number, max: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('bump_login_rate_limit', {
    p_key: key, p_window_ms: windowMs, p_max: max,
  });
  if (error) {
    // Fail OPEN on infra error so a DB hiccup can't blackout telemetry fleet-wide.
    logger.warn({ event: 'PING_RL_RPC_ERROR', key, error: error.message });
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

  // Gate 0 — IP burst + window rate limits BEFORE any parsing/DB lookup.
  if (isProd) {
    if (!(await bump(`ping_ip_burst:${ip}`, RL_IP_BURST.win, RL_IP_BURST.max)) ||
        !(await bump(`ping_ip:${ip}`, RL_IP_WIN.win, RL_IP_WIN.max))) {
      return generic(429, 'Too many requests.');
    }
  }

  let body: z.infer<typeof PingSchema>;
  try {
    body = PingSchema.parse(await req.json());
  } catch {
    return generic(400, 'Invalid request.');
  }
  const { activation_key, device_fingerprint, app_version, nonce, timestamp, security_tier, cek_status, tamper_status } = body;
  const reportedTier = (security_tier ?? '').trim();

  // Gate 1 — per-device rate limit.
  if (isProd && !(await bump(`ping_fp:${device_fingerprint}`, RL_FP_WIN.win, RL_FP_WIN.max))) {
    return generic(429, 'Too many requests.');
  }

  // Gate 2 — timestamp skew (bounds replay window; nonce below is the real guard).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return generic(401, 'Request expired.');
  }

  // Gate 3 — single-use nonce. First use allowed; any repeat in the window blocked.
  if (isProd && !(await bump(`ping_nonce:${nonce}`, MAX_SKEW_MS, 1))) {
    logger.warn({ event: 'PING_NONCE_REPLAY', ipHash: ip.slice(0, 12) });
    return generic(401, 'Request rejected.');
  }

  // Gate 4 — device-bound authorization: key must be Active AND bound to THIS device.
  const { data: key, error: keyErr } = await supabaseAdmin
    .from('activation_keys')
    .select('id, school_id, status, device_fingerprint, expires_at')
    .eq('key', activation_key)
    .maybeSingle();

  if (keyErr) {
    logger.error({ event: 'PING_KEY_LOOKUP_ERROR', error: keyErr.message });
    return generic(503, 'Service unavailable.');
  }
  const bound = key
    && key.status === 'Active'
    && key.device_fingerprint === device_fingerprint;
  if (!bound) {
    // Uniform 403 — never reveal which check failed (key vs binding vs status).
    logger.warn({ event: 'PING_UNAUTHORIZED', keyKnown: !!key, status: key?.status ?? null });
    return generic(403, 'Not authorized.');
  }
  // Expired subscription: accept the heartbeat (so the timeline records it) but
  // signal the device it is expired. Enforcement/blocking is the app's job + P4.
  const expired = key.expires_at ? new Date(key.expires_at).getTime() < Date.now() : false;

  // ── Update online state + cumulative online time; append a timeline event on
  //    a fresh session (device came back online after a gap). Idempotent-ish:
  //    replayed pings are already blocked by the nonce gate above.
  const now = Date.now();
  const { data: prev } = await supabaseAdmin
    .from('device_status')
    .select('last_seen, session_start, total_online_seconds')
    .eq('device_fingerprint', device_fingerprint)
    .maybeSingle();

  let newSession = true;
  let sessionStart = new Date(now).toISOString();
  let total = 0;
  if (prev) {
    const lastSeenMs = new Date(prev.last_seen).getTime();
    const gap = now - lastSeenMs;
    total = Number(prev.total_online_seconds) || 0;
    if (gap <= SESSION_GAP_MS) {
      newSession = false;
      sessionStart = prev.session_start;
      total += Math.max(0, Math.floor(gap / 1000)); // credit the inter-heartbeat time
    }
  }

  const { error: upErr } = await supabaseAdmin.from('device_status').upsert({
    device_fingerprint,
    school_id: key.school_id,
    activation_key,
    app_version,
    last_seen: new Date(now).toISOString(),
    session_start: sessionStart,
    total_online_seconds: total,
    last_ip: ip,
    updated_at: new Date(now).toISOString(),
  }, { onConflict: 'device_fingerprint' });
  if (upErr) logger.error({ event: 'PING_STATUS_UPSERT_ERROR', error: upErr.message });

  // Persist the reported security tier onto device_status (best-effort, SEPARATE from
  // the upsert above so a not-yet-migrated `security_tier` column can't blackout the
  // whole heartbeat write). Run scripts/add_security_tier.sql to add the column.
  if (reportedTier) {
    const { error: stErr } = await supabaseAdmin
      .from('device_status')
      .update({ security_tier: reportedTier })
      .eq('device_fingerprint', device_fingerprint);
    if (stErr) logger.warn({ event: 'PING_SECURITY_TIER_PERSIST_FAILED', error: stErr.message });
  }

  // Tier 8 — CEK decrypt failure. Previously the app swallowed unwrap() failures to ""
  // and the panel stayed blind ("why is video black on device X?"). Now record it loudly
  // AND on the timeline so an admin can see exactly which device/session it happened on.
  if (cek_status === 'DECRYPT_FAILED') {
    logger.warn({
      event: 'PING_CEK_DECRYPT_FAILED',
      device_fingerprint,
      school_id: key.school_id,
      security_tier: reportedTier || null,
      app_version,
    });
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      school_id: key.school_id,
      event_type: 'CEK_DECRYPT_FAILED',
      detail: { app_version, ip, security_tier: reportedTier || null },
    });
  }

  // EXPIRY-TAMPER — the client fail-closed on a licence/expiry tamper attempt and told us
  // why. Record it LOUDLY (log + a dedicated timeline event) so an admin can answer "did
  // someone try to change the expiry on device X?" — the client is the only place that can
  // observe a local edit / clock rollback (a large rollback never even reaches this endpoint
  // because the timestamp-skew gate 401s it, so the device's own report is the signal).
  if (tamper_status) {
    logger.warn({
      event: 'PING_EXPIRY_TAMPER',
      reason: tamper_status,
      device_fingerprint,
      school_id: key.school_id,
      security_tier: reportedTier || null,
      app_version,
      ip,
    });
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      school_id: key.school_id,
      event_type: 'EXPIRY_TAMPER',
      detail: { reason: tamper_status, app_version, ip, security_tier: reportedTier || null },
    });
  }

  if (newSession) {
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      school_id: key.school_id,
      event_type: 'ONLINE',
      detail: { app_version, ip },
    });
  }

  // ── Signed Renewable Lease (SRL) ────────────────────────────────────────────
  // Reached only on the bound + Active success path (Gate 4 already 403'd revoked/
  // unbound devices). The lease is the client's CURRENT, trusted source of expiry +
  // time: short-lived, fingerprint-bound, and nonce-bound (the nonce was single-use-
  // verified above). Entirely additive + best-effort — a signing/DB error never breaks
  // the heartbeat; we just omit the lease and the client falls back to staleness.
  const nowIso = new Date(now).toISOString();
  let lease_str: string | undefined;
  let lease_sig: string | undefined;
  if (LEASE_ENABLED) {
    try {
      const lease = {
        v: 1,
        device_fingerprint,
        activation_key_id: key.id,
        issued_at: nowIso,                                        // TRUSTED server time
        not_after: new Date(now + LEASE_TTL_DAYS * 86_400_000).toISOString(),
        subscription_expires_at: key.expires_at ?? null,          // authoritative expiry
        status: expired ? 'Expired' : 'Active',                   // bound ⇒ key is Active
        nonce,                                                     // echo → binds to THIS request
      };
      lease_str = JSON.stringify(lease);
      lease_sig = signPayload(lease_str);
      // Audit only (best-effort): when we last leased this device. Column added by
      // scripts/add_device_lease.sql; a not-yet-migrated column must not break the ping.
      const { error: leErr } = await supabaseAdmin
        .from('activation_keys')
        .update({ last_lease_issued_at: nowIso })
        .eq('id', key.id);
      if (leErr) logger.warn({ event: 'PING_LEASE_AUDIT_PERSIST_FAILED', error: leErr.message });
    } catch (e) {
      lease_str = undefined;
      lease_sig = undefined;
      logger.warn({ event: 'PING_LEASE_SIGN_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    server_time: nowIso,      // device clock sync
    expired,
    // Present only when SRL is enabled and signing succeeded; omitted otherwise.
    ...(lease_str && lease_sig ? { lease_str, lease_sig } : {}),
  });
}
