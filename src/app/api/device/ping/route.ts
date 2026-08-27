import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';
import { signPayload } from '@/lib/licenseSign';
import { sendSecurityAlert } from '@/lib/alert';
import { resolveEffectiveProductId } from '@/lib/product';
import { PRODUCT_ID_ENUM, isProductId } from '@/lib/productIdentity';

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
  //   GUARD_UNSEAL_FAIL— LEGACY (pre-split clients only): the anti-rollback sidecar could not be
  //                      unsealed, cause unknown. Newer clients report one of the three GUARD_*
  //                      values below instead, which distinguish genuine tamper from a benign
  //                      TPM/environment hiccup (see GUARD_HEALTH_REASONS below).
  //   GUARD_CORRUPTED  — sidecar present with POSITIVE evidence of tamper/corruption (malformed
  //                      bytes, or opened-with-the-right-key-but-failed-to-authenticate)
  //   GUARD_KEY_UNAVAILABLE — sidecar present but its TPM-sealing key could not be opened right
  //                      now (Windows Update TPM reset, sleep/hibernate/BitLocker hiccup, etc.) —
  //                      NOT evidence of tampering
  //   GUARD_MISSING    — the sidecar file itself is absent (could be antivirus/disk cleanup, or a
  //                      rollback attempt) — treated as a health signal, not a tamper attempt
  //   FINGERPRINT_MISMATCH — signed device binding does not match this device (clone/restore)
  //   LEASE_INVALID    — a Signed Renewable Lease failed signature/binding verification
  //   WINE_DETECTED    — the Windows app is running under Wine/Proton (Linux/Kali) — no genuine
  //                      TPM, so DRM/anti-rollback degrade; a strong reverse-engineering signal
  tamper_status: z
    .enum([
      'CLOCK_ROLLBACK', 'STORAGE_TAMPER', 'SIGNATURE_INVALID', 'GUARD_UNSEAL_FAIL',
      'GUARD_CORRUPTED', 'GUARD_KEY_UNAVAILABLE', 'GUARD_MISSING',
      'FINGERPRINT_MISMATCH', 'LEASE_INVALID', 'WINE_DETECTED',
    ])
    .optional(),
  // Server-side expiry-tamper detection: the expiry the device currently holds/enforces
  // (from its signed payload), as an ISO string. The panel compares it to signed_expires_at
  // (the value it signed at activation). Bounded length; parse issues just skip the check.
  reported_expiry: z.string().max(40).optional(),
  // LMS Lab platform ('windows' | 'linux' | 'android'). Optional + backward compatible:
  // older builds omit it. When present, the heartbeat also stamps the matching per-platform
  // LMS Lab column on device_status (see lms-lab-device-platform.sql). Never affects authZ.
  os_platform: z.enum(['windows', 'linux', 'android']).optional(),
  // Canonical, compiled-in client product identity (src/lib/productIdentity.ts). Optional +
  // backward compatible: older/unmigrated clients fall back to resolveEffectiveProductId()'s
  // legacy heuristic. When present it is checked against the pinned activation_keys.product_id.
  product_id: z.enum(PRODUCT_ID_ENUM).optional(),
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
  const { activation_key, device_fingerprint, app_version, nonce, timestamp, security_tier, cek_status, tamper_status, reported_expiry, os_platform, product_id } = body;
  const reportedTier = (security_tier ?? '').trim();
  // Which product this heartbeat is from: the client's own declared product_id if sent
  // (authoritative), else the legacy heuristic (os_platform / app_version / device_os).
  const clientProductId = resolveEffectiveProductId({
    productId: product_id,
    osPlatform: os_platform,
    securityTier: reportedTier,
    appVersion: app_version,
  });

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
    .select('id, school_id, vendor_id, parent_id, status, device_fingerprint, expires_at, product_id')
    .eq('key', activation_key)
    .maybeSingle();

  // Entity columns for telemetry writes — a key belongs to exactly one of school/
  // vendor/parent, so device_status + device_timeline are stamped with the right one
  // (the other two stay null). Vendor/parent keys have school_id = null, which is why
  // multi-entity-chain.sql drops NOT NULL on device_status/device_timeline.school_id.
  const entityCols = (k: { school_id?: string | null; vendor_id?: string | null; parent_id?: string | null }) => ({
    school_id: k.school_id ?? null,
    vendor_id: k.vendor_id ?? null,
    parent_id: k.parent_id ?? null,
  });

  if (keyErr) {
    logger.error({ event: 'PING_KEY_LOOKUP_ERROR', error: keyErr.message });
    return generic(503, 'Service unavailable.');
  }

  // Product identity: the license's pin is authoritative once set (matches the hard gate
  // enforced at /api/activate). A heartbeat reporting a DIFFERENT known product than the
  // pin is a strong tamper/clone signal — audit-logged, but the heartbeat is still accepted
  // (the hard reject already happened at activation; a ping mismatch alone must not brick a
  // legitimately-activated fleet on a flaky/ambiguous legacy signal). Never re-pins here.
  const pinnedProductId = key && isProductId(key.product_id) ? key.product_id : null;
  if (pinnedProductId && clientProductId !== 'UNKNOWN' && clientProductId !== pinnedProductId) {
    logger.warn({ event: 'PING_PRODUCT_MISMATCH', device_fingerprint, pinned: pinnedProductId, reported: clientProductId });
  }
  const product = pinnedProductId ?? (clientProductId === 'UNKNOWN' ? null : clientProductId);

  // Remote-kill propagation (P4): an admin "Deactivate" flips the key to 'Revoked'. That
  // is a deliberate signal to THIS device — so when the revoked key is presented ON ITS OWN
  // bound fingerprint (no information disclosure: the device is proving it already holds this
  // exact key+fingerprint pair), answer 200 with kill:true instead of a blanket 403. Both the
  // Android and Windows clients purge their keys + permanently block on kill. Any OTHER
  // unauthorized shape (unknown key, or a fingerprint that does not match) still gets the
  // uniform 403 below and learns nothing. Fires every ping until the device stops calling —
  // idempotent on the client (purgeAndBlock is a no-op once blocked).
  const ownRevoked = key
    && key.status === 'Revoked'
    && key.device_fingerprint === device_fingerprint;
  if (ownRevoked) {
    logger.warn({ event: 'PING_REMOTE_KILL', device_fingerprint, school_id: key.school_id, app_version });
    // Best-effort audit trail so the panel timeline shows WHEN the kill actually reached the
    // device (distinct from when the admin clicked Deactivate). Written EXACTLY ONCE: a killed
    // device keeps pinging (its client purge is idempotent), so we skip the insert if a
    // REMOTE_KILL row already exists for this device — no timeline spam. Never blocks the kill.
    try {
      const { data: priorKill } = await supabaseAdmin
        .from('device_timeline')
        .select('id')
        .eq('device_fingerprint', device_fingerprint)
        .eq('event_type', 'REMOTE_KILL')
        .limit(1)
        .maybeSingle();
      if (!priorKill) {
        const { error: ktErr } = await supabaseAdmin.from('device_timeline').insert({
          device_fingerprint,
          ...entityCols(key),
          product_id: product,
          event_type: 'REMOTE_KILL',
          detail: { reason: 'revoked', app_version, ip },
        });
        if (ktErr) logger.warn({ event: 'PING_KILL_TIMELINE_FAILED', error: ktErr.message });
        // Proactively alert admins the first time the kill actually reaches the device.
        if (!ktErr) {
          await sendSecurityAlert('REMOTE_KILL', `Device deactivated key reached device (school ${key.school_id})`, {
            device_fingerprint, school_id: key.school_id, app_version, ip,
          });
        }
      }
    } catch (e) {
      logger.warn({ event: 'PING_KILL_TIMELINE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
    return NextResponse.json({
      ok: true,
      kill: true,
      kill_reason: 'revoked',
      server_time: new Date().toISOString(),
    });
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
    ...entityCols(key),
    activation_key,
    app_version,
    last_seen: new Date(now).toISOString(),
    session_start: sessionStart,
    total_online_seconds: total,
    last_ip: ip,
    updated_at: new Date(now).toISOString(),
  }, { onConflict: 'device_fingerprint' });
  if (upErr) logger.error({ event: 'PING_STATUS_UPSERT_ERROR', error: upErr.message });

  // Canonical product tag — SEPARATE best-effort write (like security_tier below) so a
  // not-yet-migrated `product_id` column (run product-identity-upgrade.sql) can't blackout
  // the whole heartbeat write. Skipped when unresolved (null) so we never clobber a
  // previously-pinned value with "don't know" on a genuinely ambiguous heartbeat.
  if (product) {
    const { error: prodErr } = await supabaseAdmin
      .from('device_status')
      .update({ product_id: product })
      .eq('device_fingerprint', device_fingerprint);
    if (prodErr) logger.warn({ event: 'PING_PRODUCT_PERSIST_FAILED', error: prodErr.message });
  }

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

  // LMS Lab per-platform online telemetry. Records this heartbeat's time into the LMS Lab
  // column matching the reporting platform, so Windows/Linux/Android online activity is
  // tracked SEPARATELY (per requirement) without touching the shared device_status fields.
  // Additive + fail-open: a not-yet-migrated column (run lms-lab-device-platform.sql) or any
  // error is logged and skipped — it never blocks the heartbeat. Runs only on the bound path.
  if (os_platform) {
    const platformColumn =
      os_platform === 'windows' ? 'lms_lab_windows_last_seen'
      : os_platform === 'linux' ? 'lms_lab_linux_last_seen'
      : 'lms_lab_android_last_seen';
    const { error: platErr } = await supabaseAdmin
      .from('device_status')
      .update({ [platformColumn]: new Date(now).toISOString() })
      .eq('device_fingerprint', device_fingerprint);
    if (platErr) logger.warn({ event: 'PING_LMS_LAB_PLATFORM_PERSIST_FAILED', platform: os_platform, error: platErr.message });
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
      ...entityCols(key),
      product_id: product,
      event_type: 'CEK_DECRYPT_FAILED',
      detail: { app_version, ip, security_tier: reportedTier || null },
    });
  }

  // EXPIRY-TAMPER — the client fail-closed on a licence/expiry tamper attempt and told us
  // why. Record it LOUDLY (log + a dedicated timeline event) so an admin can answer "did
  // someone try to change the expiry on device X?" — the client is the only place that can
  // observe a local edit / clock rollback (a large rollback never even reaches this endpoint
  // because the timestamp-skew gate 401s it, so the device's own report is the signal).
  //
  // GUARD_KEY_UNAVAILABLE and GUARD_MISSING are NOT positive evidence of tampering — a
  // legitimate device's TPM-sealed guard can become unreadable for reasons that have nothing to
  // do with an attack (see the client's TpmSealing.UnsealOutcome docs). They still get a
  // timeline entry for visibility, but are classified as a device-health issue rather than the
  // alarming EXPIRY_TAMPER security alert, so admins can tell "this machine may have a TPM
  // problem" apart from "this machine shows evidence of tampering."
  const GUARD_HEALTH_REASONS = new Set(['GUARD_KEY_UNAVAILABLE', 'GUARD_MISSING']);
  if (tamper_status) {
    const isGenuineTamper = !GUARD_HEALTH_REASONS.has(tamper_status);
    logger.warn({
      event: isGenuineTamper ? 'PING_EXPIRY_TAMPER' : 'PING_GUARD_HEALTH_ISSUE',
      reason: tamper_status,
      device_fingerprint,
      school_id: key.school_id,
      security_tier: reportedTier || null,
      app_version,
      ip,
    });
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      ...entityCols(key),
      product_id: product,
      event_type: isGenuineTamper ? 'EXPIRY_TAMPER' : 'GUARD_HEALTH_ISSUE',
      detail: { reason: tamper_status, app_version, ip, security_tier: reportedTier || null },
    });
    if (isGenuineTamper) {
      await sendSecurityAlert('EXPIRY_TAMPER', `Device reported ${tamper_status} (school ${key.school_id})`, {
        reason: tamper_status, device_fingerprint, school_id: key.school_id, app_version, ip,
      });
    }
  }

  // SERVER-SIDE EXPIRY-TAMPER (the robust, un-spoofable detector) — compare the expiry the
  // device reports against what we SIGNED at activation (signed_expires_at, immutable to admin
  // edits). If the device claims a LATER expiry than was ever signed, it extended its own
  // licence → flag it. FALSE-POSITIVE-SAFE: admin shorten/extend never changes signed_expires_at,
  // and we only flag `reported > signed`. DEDUPLICATED via a conditional false→true flip, so a
  // tampered device writes exactly ONE timeline row (no panel spam, no new rate-limit surface).
  // Fully fail-open: a missing column, parse error, or race just skips — never breaks the ping.
  if (reported_expiry) {
    try {
      const { data: exRow, error: exErr } = await supabaseAdmin
        .from('activation_keys')
        .select('signed_expires_at, expiry_tamper_flag')
        .eq('id', key.id)
        .maybeSingle();
      const signedMs = exRow?.signed_expires_at ? new Date(exRow.signed_expires_at).getTime() : NaN;
      const reportedMs = new Date(reported_expiry).getTime();
      const TOLERANCE_MS = 60_000; // absorb format/rounding; only a real extension trips it
      if (!exErr && Number.isFinite(signedMs) && Number.isFinite(reportedMs)
          && reportedMs > signedMs + TOLERANCE_MS && exRow?.expiry_tamper_flag !== true) {
        const detail = {
          reason: 'SERVER_MISMATCH',
          reported_expiry,
          signed_expires_at: exRow?.signed_expires_at ?? null,
          extra_days: Math.round((reportedMs - signedMs) / 86_400_000),
          app_version,
          ip,
        };
        // Conditional false→true flip → exactly-once even under concurrent heartbeats.
        const { data: flipped, error: flagErr } = await supabaseAdmin
          .from('activation_keys')
          .update({ expiry_tamper_flag: true, expiry_tamper_at: new Date(now).toISOString(), expiry_tamper_detail: detail })
          .eq('id', key.id)
          .eq('expiry_tamper_flag', false)
          .select('id');
        if (!flagErr && flipped && flipped.length > 0) {
          logger.warn({ event: 'PING_EXPIRY_TAMPER_SERVER', device_fingerprint, school_id: key.school_id, ...detail });
          await supabaseAdmin.from('device_timeline').insert({
            device_fingerprint,
            ...entityCols(key),
            product_id: product,
            event_type: 'EXPIRY_TAMPER',
            detail,
          });
          await sendSecurityAlert('EXPIRY_TAMPER', `Device claimed +${detail.extra_days}d beyond signed expiry (school ${key.school_id})`, {
            device_fingerprint, school_id: key.school_id, ...detail,
          });
        }
      }
    } catch (e) {
      logger.warn({ event: 'PING_EXPIRY_COMPARE_FAILED', error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (newSession) {
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      ...entityCols(key),
      product_id: product,
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
