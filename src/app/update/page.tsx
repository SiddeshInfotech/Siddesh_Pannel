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
  const DS_BASE = 'device_fingerprint, app_version, first_seen, last_seen, total_online_seconds, last_ip';
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

  const { data: timeline } = await supabaseAdmin
    .from('device_timeline')
    .select('id, event_type, detail, created_at, device_fingerprint, schools(name)')
    .order('created_at', { ascending: false })
    .limit(150);

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
      const lastSeen = ds?.last_seen ?? null;
      const online = lastSeen ? now - new Date(lastSeen).getTime() <= ONLINE_WINDOW_MS : false;

      // Online time SCOPED TO THIS KEY: device_status.total_online_seconds is a lifetime
      // total across every key ever activated on this device_fingerprint (a device
      // re-activated several times, e.g. during testing, would show the SAME inflated
      // total on every one of its rows). device_daily_online lets us sum only the days
      // from THIS key's own activated_at onward instead. Falls back to the old
      // device-lifetime total only when the table isn't migrated yet (dailyOnline.ok
      // false), so this never regresses to showing "0m" for everyone pre-migration.
      const activatedDay = k.activated_at ? istDayKey(k.activated_at) : null;
      const allDailyRows = k.device_fingerprint ? dailyOnline.map.get(k.device_fingerprint) ?? [] : [];
      const keyDailyRows = activatedDay ? allDailyRows.filter((r) => r.day >= activatedDay) : allDailyRows;
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
        schoolName: entityName,
        schoolId: entityId,
        appVersion: ds?.app_version ?? '—',
        online,
        lastSeenAgo: agoFrom(lastSeen),
        lastSeenExact: lastSeen ? new Date(lastSeen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST }) : '—',
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
    schoolName: e.schools?.name ?? 'Unknown School',
    fingerprint: e.device_fingerprint,
    detail: e.detail ?? {},
    // Raw ISO timestamp, kept alongside the pre-formatted strings below, so the client
    // can group events by IST calendar day without re-deriving it from a locale string.
    createdAt: e.created_at ?? null,
    when: e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—',
    whenAgo: agoFrom(e.created_at),
  }));

  // "Online now" counts DEVICES actually connected right now, not licence-key rows — the
  // same device_fingerprint can carry several Active keys (see the row-id comment above),
  // and each of THOSE rows independently shows Online, which would otherwise multiply-count
  // one physical device as several "online" entries.
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
