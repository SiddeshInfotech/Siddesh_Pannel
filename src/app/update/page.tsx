import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import UpdateClient from './UpdateClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// A device counts as "online now" if its last heartbeat is within this window
// (must be >= the app's heartbeat interval + the endpoint's SESSION_GAP_MS).
const ONLINE_WINDOW_MS = 6 * 60 * 1000;

// Render all timestamps in India Standard Time (Vercel runs in UTC). India-only deployment.
const IST = 'Asia/Kolkata';

function humanDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function agoFrom(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// IST calendar-day string (YYYY-MM-DD), matching device_daily_online.day and how the
// client groups timeline events by day — so a key's "activation day" and a duration row's
// "day" are always comparable as plain strings.
function istDayKey(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: IST });
}

// Entity embeds — a licence key belongs to exactly one of school/vendor/parent (mirrors
// monitoring/page.tsx's SCHOOL_COLS/VENDOR_COLS/PARENT_COLS so both pages resolve the same
// device to the same name; trimmed to just what this page's table/search need).
const SCHOOL_COLS = 'schools (id, name, school_id)';
const VENDOR_COLS = 'vendors (vendor_id, vendor_name)';
const PARENT_COLS = 'parents (id, parent_id, parent_name, kid_name)';
const KEY_COLS_BASE = 'id, key, status, expires_at, activated_at, school_id, vendor_id, parent_id, device_fingerprint';

async function fetchActivatedKeys(includeTier: boolean) {
  // security_tier / product_id are NEW columns (scripts/add_security_tier.sql,
  // product-identity-upgrade.sql). If either isn't migrated yet, selecting it 400s the
  // whole query and blanks the device list — so retry without both on error. Tiers/product
  // then show "—"/"Unknown" until the migration runs. Push order-independent.
  const sel = includeTier
    ? `${KEY_COLS_BASE}, security_tier, product_id, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`
    : `${KEY_COLS_BASE}, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`;
  return supabaseAdmin
    .from('activation_keys')
    .select(sel)
    .not('device_fingerprint', 'is', null)
    .neq('device_fingerprint', '')
    .order('activated_at', { ascending: false });
}

// Per-device live telemetry (only exists once a device has successfully pinged at least
// once) — merged onto the activation-key list below rather than being the row SOURCE, so a
// key that hasn't (yet) pinged still shows up as an offline row instead of vanishing.
// security_tier/product_id are included here (not just from activation_keys) because
// /api/device/ping refreshes them on EVERY heartbeat, while activation_keys only gets them
// once at activation time — device_status is the fresher of the two whenever it has a row.
async function fetchDeviceStatusByFingerprint(): Promise<Map<string, any /* eslint-disable-line @typescript-eslint/no-explicit-any */>> {
  // activation_key is the key that sent the MOST RECENT heartbeat for this device — /api/device/
  // ping upserts it on every beat. It is the only authoritative answer to "which of this
  // device's keys is actually live right now", which the online column below depends on.
  const DS_BASE = 'device_fingerprint, activation_key, app_version, first_seen, last_seen, total_online_seconds, last_ip';
  const withTier = await supabaseAdmin.from('device_status').select(`${DS_BASE}, security_tier, product_id`);
  const rows = withTier.error
    ? (await supabaseAdmin.from('device_status').select(DS_BASE)).data
    : withTier.data;
  const map = new Map<string, any /* eslint-disable-line @typescript-eslint/no-explicit-any */>();
  for (const row of rows ?? []) if (row.device_fingerprint) map.set(row.device_fingerprint, row);
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
  if (fingerprints.length === 0) return { ok: true, map };
  const { data, error } = await supabaseAdmin
    .from('device_daily_online')
    .select('device_fingerprint, day, seconds')
    .in('device_fingerprint', fingerprints);
  if (error) return { ok: false, map };
  for (const row of data ?? []) {
    const list = map.get(row.device_fingerprint) ?? [];
    list.push({ day: row.day, seconds: Number(row.seconds) || 0 });
    map.set(row.device_fingerprint, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { ok: true, map };
}

async function getTelemetry() {
  // Row SOURCE is activation_keys — every active licence key across schools, vendors AND
  // parents (previously this queried device_status directly, which: (a) only ever has a
  // row for a device that has successfully sent at least one heartbeat, silently dropping
  // any freshly-activated/not-yet-reporting key from the table and undercounting "Active
  // keys" against the Monitoring tab's count of the same fleet; (b) only ever embedded
  // schools(...), so every vendor- or parent-owned device showed "Unknown School").
  const first = await fetchActivatedKeys(true);
  let keys = first.data;
  if (first.error) {
    keys = (await fetchActivatedKeys(false)).data;
  }

  const statusByFp = await fetchDeviceStatusByFingerprint();
  const fingerprints = [...new Set((keys ?? []).map((k: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => k.device_fingerprint).filter(Boolean))] as string[];
  const dailyOnline = await fetchDailyOnlineByFingerprint(fingerprints);

  // ── Each key's OWN active window on its device ────────────────────────────────────────
  // One physical device is routinely activated several times over its life (install/uninstall
  // test cycles, renewals, re-issued keys), leaving MULTIPLE Active keys bound to the same
  // device_fingerprint. A key stops being that device's key the moment the NEXT key is
  // activated on the same fingerprint — so this maps each key to that successor's activation
  // time (absent = this key was the last one activated on the device).
  //
  // Built from the FULL key list, before the Active/expiry filter below: a key that has since
  // been revoked or expired still occupied the device while it was live, so it still ends the
  // previous key's window.
  const supersededAtByKeyId = new Map<string, string>();
  {
    const byFingerprint = new Map<string, { id: string; at: number; iso: string }[]>();
    for (const k of (keys ?? []) as any[] /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
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

  // Scoped to THIS fleet's device fingerprints (not a global top-150 across every device that
  // has ever pinged) — an unscoped query let a chattier device's events crowd a quieter
  // device's own history out of the window entirely, making its Activity Timeline wrongly
  // look sparse or empty. The `schools(name)` embed was removed: it was never read (the
  // timeline popup shows the selected DEVICE's schoolName, not the event's), and was wrong
  // for vendor/parent-owned devices anyway (always fell back to "Unknown School").
  const { data: timeline } = fingerprints.length > 0
    ? await supabaseAdmin
        .from('device_timeline')
        .select('id, event_type, detail, created_at, device_fingerprint')
        .in('device_fingerprint', fingerprints)
        .order('created_at', { ascending: false })
        .limit(1000)
    : { data: [] as never[] };

  const now = Date.now();
  const devices = (keys ?? [])
    // "Active keys" means live licence keys, matching this page's own subtitle ("one row
    // per active licence key") and monitoring/page.tsx's expiry-aware effective-status
    // definition: an Active key past its expires_at no longer counts as active.
    .filter((k: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
      if (k.status !== 'Active') return false;
      if (k.expires_at && new Date(k.expires_at).getTime() <= now) return false;
      return true;
    })
    .map((k: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
      // Which entity owns this device (exactly one id is set) — identical resolution to
      // monitoring/page.tsx's entityName logic, so both pages agree on the display name.
      const school = k.schools;
      const vendor = k.vendors;
      const parent = k.parents;
      let entityName = school?.name || 'Unknown School';
      let entityId = school?.school_id || '—';
      if (k.vendor_id) {
        entityName = vendor?.vendor_name || vendor?.vendor_id || 'Unknown Vendor';
        entityId = vendor?.vendor_id || '—';
      } else if (k.parent_id) {
        entityName = parent?.kid_name || parent?.parent_name || 'Unknown Student';
        entityId = parent?.parent_id || '—';
      }

      const ds = k.device_fingerprint ? statusByFp.get(k.device_fingerprint) : undefined;
      const deviceLastSeen = ds?.last_seen ?? null;
      const deviceOnline = deviceLastSeen ? now - new Date(deviceLastSeen).getTime() <= ONLINE_WINDOW_MS : false;

      // Is THIS key the one actually running on the device right now? device_status.activation_key
      // names the key that sent the latest heartbeat, so it is authoritative. Without this check
      // every key ever activated on a device inherited that device's Online state — one machine
      // coming online lit up all five of its old test keys as "Online" simultaneously, making the
      // fleet look five times more connected than it is.
      // Fallback for legacy device_status rows written before activation_key existed: treat the
      // most recently activated key on the device as the live one.
      const supersededAtIso = supersededAtByKeyId.get(k.id) ?? null;
      const liveKeyOnDevice = ds?.activation_key ?? null;
      const isLiveKey = liveKeyOnDevice ? liveKeyOnDevice === k.key : supersededAtIso === null;

      // A superseded key is not online, no matter what its device is doing.
      const online = deviceOnline && isLiveKey;

      // Online time SCOPED TO THIS KEY's own window on the device — bounded at BOTH ends: from
      // its activation day until the day the next key took over. device_status
      // .total_online_seconds is a device LIFETIME total across every key it ever ran, and even
      // device_daily_online is per-device-per-day, so without both bounds a long-dead test key
      // kept inheriting the device's ongoing time and every key on that device showed the same
      // ever-growing total. (Days are whole-day buckets, so a day on which one key replaced
      // another is counted for both — the finest split this data supports.)
      // Falls back to the device-lifetime total only when device_daily_online isn't migrated
      // yet (dailyOnline.ok false), so this never regresses to "0m" for everyone pre-migration.
      const activatedDay = k.activated_at ? istDayKey(k.activated_at) : null;
      const supersededDay = supersededAtIso ? istDayKey(supersededAtIso) : null;
      const allDailyRows = k.device_fingerprint ? dailyOnline.map.get(k.device_fingerprint) ?? [] : [];
      const keyDailyRows = allDailyRows.filter(
        (r) => (!activatedDay || r.day >= activatedDay) && (!supersededDay || r.day <= supersededDay)
      );
      const totalOnlineSeconds = dailyOnline.ok
        ? keyDailyRows.reduce((sum, r) => sum + r.seconds, 0)
        : Number(ds?.total_online_seconds) || 0;
      const dailyBreakdown = dailyOnline.ok
        ? keyDailyRows.map((r) => ({ day: r.day, totalOnline: humanDuration(r.seconds) }))
        : [];

      return {
        // The activation-key row's own id — the actual unique identity of a table row now
        // that rows are "one per active licence key" (this page's own definition) rather
        // than "one per device": the same device_fingerprint can legitimately carry more
        // than one Active key (e.g. a renewal that issued a new key without revoking the
        // old one), so device_fingerprint alone is NOT safe as a React list key / row id.
        id: k.id,
        fingerprint: k.device_fingerprint,
        activationKey: k.key ?? '—',
        // Raw ISO of this KEY's own activation — the timeline popup uses it to show only
        // events from here onward, not the device's entire cross-key history.
        activatedAtIso: k.activated_at ?? null,
        // When the NEXT key took over this device (null = this key is still the device's key).
        // Bounds the activity timeline so a dead key's popup doesn't show its successor's events.
        supersededAtIso,
        // True when a different key is the one actually running on this device now. Drives the
        // "Superseded" status badge instead of a misleading Online/Offline.
        superseded: !isLiveKey,
        schoolName: entityName,
        schoolId: entityId,
        // app_version / last_seen on device_status describe whichever key is LIVE on the device.
        // Attributing them to a superseded key would show that key as "seen 1m ago" purely
        // because the machine is running a different key now.
        appVersion: isLiveKey ? (ds?.app_version ?? '—') : '—',
        online,
        lastSeenAgo: isLiveKey ? agoFrom(deviceLastSeen) : '—',
        lastSeenExact: isLiveKey && deviceLastSeen
          ? new Date(deviceLastSeen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST })
          : '—',
        firstSeenExact: ds?.first_seen ? new Date(ds.first_seen).toLocaleString('en-IN', { dateStyle: 'medium', timeZone: IST }) : '—',
        totalOnline: humanDuration(totalOnlineSeconds),
        dailyBreakdown,
        lastIp: ds?.last_ip ?? '—',
        // device_status is refreshed on every heartbeat; activation_keys only got these once
        // at activation time. Prefer the fresher device_status value when the device has
        // pinged at all, falling back to the activation-time snapshot otherwise.
        securityTier: ds?.security_tier ?? k.security_tier ?? 'UNREPORTED',
        productId: ds?.product_id ?? k.product_id ?? null,
      };
    });

  const events = (timeline ?? []).map((e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: e.id,
    type: e.event_type,
    fingerprint: e.device_fingerprint,
    detail: e.detail ?? {},
    // Raw ISO timestamp, kept alongside the pre-formatted strings below, so the client
    // can group events by IST calendar day without re-deriving it from a locale string.
    createdAt: e.created_at ?? null,
    when: e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—',
    whenAgo: agoFrom(e.created_at),
  }));

  // "Online now" = DEVICES actually connected right now. Only the live key on a device can be
  // online (see isLiveKey above), so this is already one row per device; the de-dupe by
  // fingerprint stays as a guard so the headline number can never drift above the real number
  // of connected machines even if a device somehow reported two live keys.
  const onlineCount = new Set(devices.filter((d) => d.online).map((d) => d.fingerprint)).size;

  return {
    devices,
    events,
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
