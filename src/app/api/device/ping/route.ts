import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/sanitize';

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
});

const isProd = process.env.NODE_ENV === 'production';
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
  const { activation_key, device_fingerprint, app_version, nonce, timestamp } = body;

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

  if (newSession) {
    await supabaseAdmin.from('device_timeline').insert({
      device_fingerprint,
      school_id: key.school_id,
      event_type: 'ONLINE',
      detail: { app_version, ip },
    });
  }

  return NextResponse.json({
    ok: true,
    server_time: new Date(now).toISOString(), // device clock sync
    expired,
  });
}
