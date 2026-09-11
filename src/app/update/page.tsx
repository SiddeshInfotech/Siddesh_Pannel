import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import UpdateClient from './UpdateClient';
import {
  IST, ONLINE_WINDOW_MS, SECURITY_EVENT_TYPES,
  type Connection, type Device, type Ev, type KeyState,
} from './shared';
import { agoFrom, chunk, fetchAllPages, humanDuration, istDateTime, istDayKey, relativeTo } from './telemetry';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows with dynamic selects */

// Entity embeds — a licence key belongs to exactly one of school/vendor/parent (mirrors
// monitoring/page.tsx's SCHOOL_COLS/VENDOR_COLS/PARENT_COLS so both pages resolve the same
// device to the same name; trimmed to just what this page's table/search need).
const SCHOOL_COLS = 'schools (id, name, school_id)';
const VENDOR_COLS = 'vendors (vendor_id, vendor_name)';
const PARENT_COLS = 'parents (id, parent_id, parent_name, kid_name)';
const KEY_COLS_BASE = 'id, key, status, expires_at, activated_at, school_id, vendor_id, parent_id, device_fingerprint';

// EVERY licence key — activated or not, expired, revoked or superseded — so the admin can
// track the whole fleet here, not just the currently-live subset. Never-activated keys sort
// last (nullsFirst: false); `id` is a tiebreaker so paging is stable.
async function fetchAllKeys(includeTier: boolean) {
  // security_tier / product_id are NEW columns (scripts/add_security_tier.sql,
  // product-identity-upgrade.sql). If either isn't migrated yet, selecting it 400s the
  // whole query and blanks the list — so retry without both on error. Tiers/product
  // then show "—"/"Unknown" until the migration runs.
  const sel = includeTier
    ? `${KEY_COLS_BASE}, security_tier, product_id, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`
    : `${KEY_COLS_BASE}, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`;
  return fetchAllPages<any>((from, to) =>
    supabaseAdmin
      .from('activation_keys')
      .select(sel)
      .order('activated_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
  );
}

// Per-device live telemetry (only exists once a device has successfully pinged at least
// once) — merged onto the key list below rather than being the row SOURCE, so a key that
// hasn't (yet) pinged still shows up (as "Never seen") instead of vanishing.
// security_tier/product_id are included here (not just from activation_keys) because
// /api/device/ping refreshes them on EVERY heartbeat, while activation_keys only gets them
// once at activation time — device_status is the fresher of the two whenever it has a row.
async function fetchDeviceStatusByFingerprint(): Promise<Map<string, any>> {
  // activation_key is the key that sent the MOST RECENT heartbeat for this device — /api/device/
  // ping upserts it on every beat. It is the only authoritative answer to "which of this
  // device's keys is actually live right now", which the connection column depends on.
  const DS_BASE = 'device_fingerprint, activation_key, app_version, first_seen, last_seen, session_start, total_online_seconds, last_ip';
  const page = (sel: string) => (from: number, to: number) =>
    supabaseAdmin.from('device_status').select(sel).order('device_fingerprint').range(from, to);
  let res = await fetchAllPages<any>(page(`${DS_BASE}, security_tier, product_id`));
  if (res.error) res = await fetchAllPages<any>(page(DS_BASE));
  const map = new Map<string, any>();
  for (const row of res.data) if (row.device_fingerprint) map.set(row.device_fingerprint, row);
  return map;
}

type DailyRow = { day: string; seconds: number };

// device_daily_online (add-device-daily-online.sql) — per-day online seconds per device,
// fed by /api/device/ping. `ok: false` means the table isn't migrated yet, so callers can
// fall back to device_status.total_online_seconds instead of showing "0m" for every row.
async function fetchDailyOnlineByFingerprint(
  fingerprints: string[]
): Promise<{ ok: boolean; map: Map<string, DailyRow[]> }> {
  const map = new Map<string, DailyRow[]>();
  for (const part of chunk(fingerprints)) {
    const { data, error } = await fetchAllPages<any>((from, to) =>
      supabaseAdmin
        .from('device_daily_online')
        .select('device_fingerprint, day, seconds')
        .in('device_fingerprint', part)
        .order('device_fingerprint')
        .order('day')
        .range(from, to)
    );
    if (error) return { ok: false, map: new Map() };
    for (const row of data) {
      const list = map.get(row.device_fingerprint) ?? [];
      list.push({ day: row.day, seconds: Number(row.seconds) || 0 });
      map.set(row.device_fingerprint, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { ok: true, map };
}

// Security events only (tamper / CEK failure / attestation) — they drive the alert count and
// the red row marker. Each key's full activity timeline is loaded on demand when its row is
// opened (actions.ts getKeyTimeline), so routine ONLINE/OFFLINE traffic no longer has to fit
// into one fleet-wide capped query that pushed quieter devices' history out of the window.
async function fetchSecurityEvents(fleet: Set<string>): Promise<Ev[]> {
  const { data } = await fetchAllPages<any>((from, to) =>
    supabaseAdmin
      .from('device_timeline')
      .select('id, event_type, detail, created_at, device_fingerprint')
      .in('event_type', [...SECURITY_EVENT_TYPES])
      .order('created_at', { ascending: false })
      .range(from, to),
    5000
  );
  return data
    .filter((e) => fleet.has(e.device_fingerprint))
    .map((e) => ({
      id: e.id,
      type: e.event_type,
      fingerprint: e.device_fingerprint,
      detail: e.detail ?? {},
      createdAt: e.created_at ?? null,
    }));
}

async function getTelemetry() {
  const first = await fetchAllKeys(true);
  const keys = first.error ? (await fetchAllKeys(false)).data : first.data;

  const statusByFp = await fetchDeviceStatusByFingerprint();
  const fingerprints = [...new Set(keys.map((k) => k.device_fingerprint).filter(Boolean))] as string[];
  const dailyOnline = await fetchDailyOnlineByFingerprint(fingerprints);
  const securityEvents = await fetchSecurityEvents(new Set(fingerprints));

  // ── Each key's OWN active window on its device ────────────────────────────────────────
  // One physical device is routinely activated several times over its life (install/uninstall
  // test cycles, renewals, re-issued keys), leaving MULTIPLE keys bound to the same
  // device_fingerprint. A key stops being that device's key the moment the NEXT key is
  // activated on the same fingerprint — so this maps each key to that successor's activation
  // time (absent = this key was the last one activated on the device). Built from every key,
  // including revoked/expired ones: those still occupied the device while they were live.
  const supersededAtByKeyId = new Map<string, string>();
  {
    const byFingerprint = new Map<string, { id: string; at: number; iso: string }[]>();
    for (const k of keys) {
      if (!k.device_fingerprint || !k.activated_at) continue;
      const list = byFingerprint.get(k.device_fingerprint) ?? [];
      list.push({ id: k.id, at: new Date(k.activated_at).getTime(), iso: k.activated_at });
      byFingerprint.set(k.device_fingerprint, list);
    }
    for (const list of byFingerprint.values()) {
      list.sort((a, b) => a.at - b.at);
      for (let i = 0; i < list.length - 1; i++) supersededAtByKeyId.set(list[i].id, list[i + 1].iso);
    }
  }

  const now = Date.now();
  const devices: Device[] = keys.map((k) => {
    // Which entity owns this key (exactly one id is set) — identical resolution to
    // monitoring/page.tsx's entityName logic, so both pages agree on the display name.
    let entityName = k.schools?.name || 'Unknown School';
    let entityId = k.schools?.school_id || '—';
    if (k.vendor_id) {
      entityName = k.vendors?.vendor_name || k.vendors?.vendor_id || 'Unknown Vendor';
      entityId = k.vendors?.vendor_id || '—';
    } else if (k.parent_id) {
      entityName = k.parents?.kid_name || k.parents?.parent_name || 'Unknown Student';
      entityId = k.parents?.parent_id || '—';
    }

    const fingerprint: string | null = k.device_fingerprint || null;
    const ds = fingerprint ? statusByFp.get(fingerprint) : undefined;
    const supersededAtIso = supersededAtByKeyId.get(k.id) ?? null;

    // Is THIS key the one actually running on its device right now? device_status.activation_key
    // names the key that sent the latest heartbeat, so it is authoritative. Without this check
    // every key ever activated on a device inherited that device's Online state. Fallback for
    // legacy device_status rows written before activation_key existed: the most recently
    // activated key on the device is the live one.
    const liveKeyOnDevice = ds?.activation_key ?? null;
    const isLiveKey = !!fingerprint && (liveKeyOnDevice ? liveKeyOnDevice === k.key : supersededAtIso === null);

    const expired = !!k.expires_at && new Date(k.expires_at).getTime() <= now;
    let keyState: KeyState;
    if (k.status === 'Revoked') keyState = 'revoked';
    else if (!fingerprint) keyState = 'not_activated';
    else if (expired) keyState = 'expired';
    else if (!isLiveKey) keyState = 'superseded';
    else keyState = 'active';

    // Connectivity is only meaningful for the key the device is running: a superseded key's
    // device heartbeat belongs to its successor. An EXPIRED live key still reports — the
    // device keeps pinging — so an expired-but-online machine is visible here too.
    const deviceLastSeen: string | null = ds?.last_seen ?? null;
    let connection: Connection = 'na';
    if (isLiveKey) {
      connection = !deviceLastSeen
        ? 'never'
        : now - new Date(deviceLastSeen).getTime() <= ONLINE_WINDOW_MS ? 'online' : 'offline';
    }

    // Online time SCOPED TO THIS KEY's own window on the device — bounded at BOTH ends: from
    // its activation day until the day the next key took over (device_daily_online is
    // per-device-per-day, so without both bounds a long-dead test key would keep inheriting
    // the device's ongoing time). Falls back to the device-lifetime total only when
    // device_daily_online isn't migrated yet.
    const activatedDay = k.activated_at ? istDayKey(k.activated_at) : null;
    const supersededDay = supersededAtIso ? istDayKey(supersededAtIso) : null;
    const allDailyRows = fingerprint ? dailyOnline.map.get(fingerprint) ?? [] : [];
    const keyDailyRows = allDailyRows.filter(
      (r) => (!activatedDay || r.day >= activatedDay) && (!supersededDay || r.day <= supersededDay)
    );
    const totalOnlineSeconds = dailyOnline.ok
      ? keyDailyRows.reduce((sum, r) => sum + r.seconds, 0)
      : Number(ds?.total_online_seconds) || 0;

    return {
      id: k.id,
      fingerprint,
      activationKey: k.key ?? '—',
      keyState,
      connection,
      activatedAtIso: k.activated_at ?? null,
      activatedExact: istDateTime(k.activated_at ?? null),
      supersededAtIso,
      expiresAtIso: k.expires_at ?? null,
      expiresExact: istDateTime(k.expires_at ?? null, false),
      expiresRelative: k.expires_at ? relativeTo(k.expires_at) : '',
      schoolName: entityName,
      schoolId: entityId,
      // app_version / last_seen on device_status describe whichever key is LIVE on the device.
      appVersion: isLiveKey ? (ds?.app_version ?? '—') : '—',
      lastSeenAgo: isLiveKey ? agoFrom(deviceLastSeen) : '—',
      lastSeenExact: isLiveKey && deviceLastSeen
        ? new Date(deviceLastSeen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST })
        : '—',
      totalOnline: fingerprint ? humanDuration(totalOnlineSeconds) : '—',
      dailyBreakdown: dailyOnline.ok
        ? keyDailyRows.map((r) => ({ day: r.day, totalOnline: humanDuration(r.seconds) }))
        : [],
      securityTier: fingerprint ? (ds?.security_tier ?? k.security_tier ?? 'UNREPORTED') : 'UNREPORTED',
      productId: ds?.product_id ?? k.product_id ?? null,
    };
  });

  // "Online now" = DEVICES actually connected right now. Only a device's live key can be
  // online, so this is already one per device; the de-dupe by fingerprint is a guard.
  const onlineCount = new Set(devices.filter((d) => d.connection === 'online').map((d) => d.fingerprint)).size;

  return {
    devices,
    securityEvents,
    onlineCount,
    serverTime: new Date(now).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium', timeZone: IST }),
  };
}

export default async function UpdatePage() {
  const session = await getAdminSession();
  if (!session) return null; // fail-closed: never render telemetry without an admin session
  const data = await getTelemetry();
  return <UpdateClient {...data} />;
}
