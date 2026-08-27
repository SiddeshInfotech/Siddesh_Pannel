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

async function getTelemetry() {
  // security_tier / product_id are NEW columns (scripts/add_security_tier.sql,
  // product-identity-upgrade.sql). If either isn't migrated yet, selecting it 400s the
  // whole query and blanks the device list — so retry without both on error. Tiers/product
  // then show "—"/"Unknown" until the migration runs. Push order-independent.
  const BASE = 'device_fingerprint, activation_key, app_version, first_seen, last_seen, total_online_seconds, last_ip';
  const withTier = await supabaseAdmin
    .from('device_status')
    .select(`${BASE}, security_tier, product_id, schools(id, name, school_id)`)
    .order('last_seen', { ascending: false });
  let statuses: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[] | null = withTier.data;
  if (withTier.error) {
    const noTier = await supabaseAdmin
      .from('device_status')
      .select(`${BASE}, schools(id, name, school_id)`)
      .order('last_seen', { ascending: false });
    statuses = noTier.data;
  }

  const { data: timeline } = await supabaseAdmin
    .from('device_timeline')
    .select('id, event_type, detail, created_at, device_fingerprint, schools(name)')
    .order('created_at', { ascending: false })
    .limit(150);

  const now = Date.now();
  const devices = (statuses ?? []).map((s: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
    const online = s.last_seen ? now - new Date(s.last_seen).getTime() <= ONLINE_WINDOW_MS : false;
    return {
      fingerprint: s.device_fingerprint,
      activationKey: s.activation_key ?? '—',
      schoolName: s.schools?.name ?? 'Unknown School',
      schoolId: s.schools?.school_id ?? '—',
      appVersion: s.app_version ?? '—',
      online,
      lastSeenAgo: agoFrom(s.last_seen),
      lastSeenExact: s.last_seen ? new Date(s.last_seen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST }) : '—',
      firstSeenExact: s.first_seen ? new Date(s.first_seen).toLocaleString('en-IN', { dateStyle: 'medium', timeZone: IST }) : '—',
      totalOnline: humanDuration(Number(s.total_online_seconds) || 0),
      lastIp: s.last_ip ?? '—',
      securityTier: s.security_tier ?? 'UNREPORTED',
      productId: s.product_id ?? null,
    };
  });

  const events = (timeline ?? []).map((e: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: e.id,
    type: e.event_type,
    schoolName: e.schools?.name ?? 'Unknown School',
    fingerprint: e.device_fingerprint,
    detail: e.detail ?? {},
    when: e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—',
    whenAgo: agoFrom(e.created_at),
  }));

  return {
    devices,
    events,
    onlineCount: devices.filter((d) => d.online).length,
    serverTime: new Date(now).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium', timeZone: IST }),
  };
}

export default async function UpdatePage() {
  const session = await getAdminSession();
  if (!session) return null; // fail-closed: never render telemetry without an admin session
  const data = await getTelemetry();
  return <UpdateClient {...data} />;
}
