'use client';

import React, { useMemo, useState } from 'react';
import {
  DownloadCloud, Circle, Clock, Server, Search,
  Wifi, WifiOff, ShieldAlert, KeyRound, CheckCircle2, AlertTriangle, X,
} from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import { PRODUCT_FILTER_OPTIONS, UNRESOLVED_PRODUCT_FILTER_VALUE, productDisplayName } from '@/lib/productIdentity';
import { tierStyle } from '@/lib/tierStyle';

type DailyOnline = { day: string; totalOnline: string };

type Device = {
  id: string;
  fingerprint: string;
  activationKey: string;
  activatedAtIso: string | null;
  supersededAtIso: string | null;
  superseded: boolean;
  schoolName: string;
  schoolId: string;
  appVersion: string;
  online: boolean;
  lastSeenAgo: string;
  lastSeenExact: string;
  firstSeenExact: string;
  totalOnline: string;
  dailyBreakdown: DailyOnline[];
  lastIp: string;
  securityTier: string;
  productId: string | null;
};

type Ev = {
  id: string;
  type: string;
  fingerprint: string;
  detail: Record<string, unknown>;
  createdAt: string | null;
  when: string;
  whenAgo: string;
};

// ── Timeline event registry — turns raw event_type codes into a clear label, an
//    icon, and a colour tone so the timeline reads at a glance. ──────────────────
type Tone = 'ok' | 'info' | 'warn' | 'danger';
const TONE: Record<Tone, { dot: string; ring: string; text: string; chip: string }> = {
  ok:     { dot: 'bg-emerald-400', ring: 'border-emerald-400/60', text: 'text-emerald-300', chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' },
  info:   { dot: 'bg-sky-400',     ring: 'border-sky-400/60',     text: 'text-sky-200',     chip: 'bg-sky-500/10 border-sky-500/25 text-sky-300' },
  warn:   { dot: 'bg-amber-400',   ring: 'border-amber-400/60',   text: 'text-amber-300',   chip: 'bg-amber-500/10 border-amber-500/25 text-amber-300' },
  danger: { dot: 'bg-rose-500',    ring: 'border-rose-500/70',    text: 'text-rose-300',    chip: 'bg-rose-500/10 border-rose-500/25 text-rose-300' },
};

function eventStyle(type: string): { label: string; Icon: React.ElementType; tone: Tone } {
  switch (type) {
    case 'ONLINE':             return { label: 'Came online',              Icon: Wifi,          tone: 'ok' };
    case 'OFFLINE':            return { label: 'Went offline',             Icon: WifiOff,       tone: 'info' };
    case 'ACTIVATED':          return { label: 'Device activated',         Icon: CheckCircle2,  tone: 'ok' };
    case 'EXPIRY_TAMPER':      return { label: 'Expiry tamper attempt',    Icon: ShieldAlert,   tone: 'danger' };
    case 'GUARD_HEALTH_ISSUE': return { label: 'Guard/TPM health issue',   Icon: AlertTriangle, tone: 'warn' };
    case 'CEK_DECRYPT_FAILED': return { label: 'Content key decrypt failed', Icon: KeyRound,    tone: 'warn' };
    case 'ATTESTATION_ISSUE': return { label: 'Attestation issue',          Icon: ShieldAlert,   tone: 'danger' };
    // Deliberately NOT a security tone — an infra-side verification hiccup must never
    // read as an attack on the fleet. See attestationTelemetry.ts.
    case 'ATTESTATION_HEALTH_WARNING': return { label: 'Attestation health warning', Icon: AlertTriangle, tone: 'warn' };
    default:                   return { label: type.replace(/_/g, ' '),    Icon: Circle,        tone: 'info' };
  }
}

// Human-readable expansion of a client-reported tamper reason.
const TAMPER_REASON: Record<string, string> = {
  CLOCK_ROLLBACK:       'Device clock was set backwards',
  STORAGE_TAMPER:       'Activation record was edited on disk',
  SIGNATURE_INVALID:    'Stored licence signature no longer valid',
  GUARD_UNSEAL_FAIL:    'Sealed anti-rollback state was tampered',   // legacy — pre-split clients only
  GUARD_CORRUPTED:      'Sealed anti-rollback state was tampered',
  GUARD_KEY_UNAVAILABLE:'TPM key temporarily unreadable (not tampering — e.g. Windows Update, sleep/hibernate)',
  GUARD_MISSING:        'Anti-rollback sidecar file is missing (not necessarily tampering)',
  FINGERPRINT_MISMATCH: 'Licence is bound to a different device',
  LEASE_INVALID:        'Server lease failed verification',
};

// Event types that represent a SECURITY concern (drive the alert count + row markers).
const SECURITY_EVENTS = new Set(['EXPIRY_TAMPER', 'CEK_DECRYPT_FAILED', 'ATTESTATION_ISSUE']);

// Every other timestamp on this page (page.tsx) is formatted in IST — the day dividers
// in the timeline popup must bucket events into the same calendar days, not the
// viewing browser's local timezone.
const IST = 'Asia/Kolkata';

export default function UpdateClient({
  devices, events, onlineCount, serverTime,
}: {
  devices: Device[]; events: Ev[]; onlineCount: number; serverTime: string;
}) {
  const [q, setQ] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  // Selects a table ROW (one licence key), not a device: the same device_fingerprint can
  // legitimately carry more than one Active key, so it can't uniquely identify which row
  // was clicked — the key's own row id can.
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = devices;
    if (productFilter === UNRESOLVED_PRODUCT_FILTER_VALUE) list = list.filter((d) => !d.productId);
    else if (productFilter !== 'all') list = list.filter((d) => d.productId === productFilter);
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (d) => d.schoolName.toLowerCase().includes(t) ||
             d.schoolId.toLowerCase().includes(t) ||
             d.activationKey.toLowerCase().includes(t)
    );
  }, [q, devices, productFilter]);

  // Fingerprints that have at least one security event (for the red row marker).
  const flaggedFingerprints = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (SECURITY_EVENTS.has(e.type)) s.add(e.fingerprint);
    return s;
  }, [events]);

  const securityAlertCount = useMemo(
    () => events.filter((e) => SECURITY_EVENTS.has(e.type)).length,
    [events]
  );

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedKeyId) ?? null,
    [devices, selectedKeyId]
  );

  // device_timeline events are recorded per physical device (device_fingerprint), not per
  // licence key — a device can carry several Active keys over time (renewals, re-activation
  // during testing), so filtering by fingerprint alone would show every OTHER key's history
  // too. Also require createdAt >= this key's OWN activated_at, so the popup only shows
  // activity from when THIS key went live, not the device's full cross-key past.
  const filteredEvents = useMemo(() => {
    if (!selectedDevice) return [];
    const sinceMs = selectedDevice.activatedAtIso ? new Date(selectedDevice.activatedAtIso).getTime() : null;
    // Upper bound too: once the NEXT key was activated on this device, later events belong to
    // that key, not this one. Without it a superseded key's timeline kept showing its
    // successor's "came online" events as if the dead key were still in use.
    const untilMs = selectedDevice.supersededAtIso ? new Date(selectedDevice.supersededAtIso).getTime() : null;
    return events.filter((e) => {
      if (e.fingerprint !== selectedDevice.fingerprint) return false;
      if (!e.createdAt) return sinceMs === null;
      const at = new Date(e.createdAt).getTime();
      if (sinceMs !== null && at < sinceMs) return false;
      if (untilMs !== null && at >= untilMs) return false;
      return true;
    });
  }, [events, selectedDevice]);

  // Day-grouped for the timeline popup: one date divider per calendar day (IST, matching
  // every other timestamp on this page) instead of repeating the full date on every
  // event. Events already arrive newest-first from the query, and Object grouping
  // preserves that first-seen order, so no re-sort is needed. Each day also carries its
  // total online duration (dailyBreakdown, already scoped to this key's activation day
  // onward by the server) — merged in even for a day with online time but no fresh "Came
  // online" event (a session that started the day before and ran through midnight logs no
  // new ONLINE event, so day-grouping by events alone would silently drop that day).
  const eventsByDay = useMemo(() => {
    const groups: { dayKey: string; dayLabel: string; events: Ev[]; totalOnline: string | null }[] = [];
    const indexByKey = new Map<string, number>();
    const dayLabelFor = (dayKey: string) =>
      new Date(`${dayKey}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
    const dailyByKey = new Map((selectedDevice?.dailyBreakdown ?? []).map((d) => [d.day, d.totalOnline]));

    for (const e of filteredEvents) {
      const d = e.createdAt ? new Date(e.createdAt) : null;
      const dayKey = d ? d.toLocaleDateString('en-CA', { timeZone: IST }) : 'unknown';
      const dayLabel = d ? dayLabelFor(dayKey) : 'Date unknown';
      let idx = indexByKey.get(dayKey);
      if (idx === undefined) {
        idx = groups.length;
        indexByKey.set(dayKey, idx);
        groups.push({ dayKey, dayLabel, events: [], totalOnline: dailyByKey.get(dayKey) ?? null });
      }
      groups[idx].events.push(e);
    }
    // Days with recorded online duration but no ONLINE event of their own.
    for (const [dayKey, totalOnline] of dailyByKey) {
      if (indexByKey.has(dayKey)) continue;
      groups.push({ dayKey, dayLabel: dayLabelFor(dayKey), events: [], totalOnline });
    }
    groups.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0)); // newest first
    return groups;
  }, [filteredEvents, selectedDevice]);

  return (
    <div className="p-8 max-w-[1200px] mx-auto text-foreground">
      <div className="flex items-center gap-3 mb-1">
        <DownloadCloud className="w-6 h-6 text-sky-400" />
        <h1 className="text-2xl font-bold">Update &amp; Online Sync</h1>
      </div>
      <p className="text-sm text-zinc-400 mb-6">
        Live per-device telemetry — one row per <span className="text-zinc-300 font-medium">active licence key</span>:
        online status, cumulative online time, security posture, and a per-device activity timeline.
      </p>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wide">
            <Circle className="w-3 h-3 fill-emerald-400" /> Online now
          </div>
          <div className="text-3xl font-bold mt-2">{onlineCount}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-semibold uppercase tracking-wide">
            <Server className="w-3 h-3" /> Active keys
          </div>
          <div className="text-3xl font-bold mt-2">{devices.length}</div>
        </div>
        <div className={`rounded-2xl border p-5 ${securityAlertCount > 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-white/10 bg-white/5'}`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${securityAlertCount > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
            <ShieldAlert className="w-3 h-3" /> Security alerts
          </div>
          <div className={`text-3xl font-bold mt-2 ${securityAlertCount > 0 ? 'text-rose-300' : ''}`}>{securityAlertCount}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-semibold uppercase tracking-wide">
            <Clock className="w-3 h-3" /> Server time
          </div>
          <div className="text-sm font-semibold mt-2">{serverTime}</div>
        </div>
      </div>

      {/* The table now owns the full width — the timeline used to occupy a third of the
          page permanently while showing "Select a device" most of the time. It opens as a
          drawer on row click instead. */}
      <div>
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search school, ID, or licence key…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="w-[190px] flex-shrink-0">
              <CustomSelect
                value={productFilter}
                onChange={(val) => setProductFilter(val)}
                options={PRODUCT_FILTER_OPTIONS}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-white/5 text-zinc-400 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">School</th>
                    <th className="text-left px-4 py-3 font-semibold">Active key</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Tier</th>
                    <th className="text-left px-4 py-3 font-semibold">Product</th>
                    <th className="text-left px-4 py-3 font-semibold">Last seen</th>
                    <th className="text-right px-4 py-3 font-semibold">Online time</th>
                    <th className="text-left px-4 py-3 font-semibold">App</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                      No devices have reported in yet.
                    </td></tr>
                  )}
                  {filtered.map((d) => {
                    const isSelected = d.id === selectedKeyId;
                    const flagged = flaggedFingerprints.has(d.fingerprint);
                    const t = tierStyle(d.securityTier);
                    return (
                      <tr
                        key={d.id}
                        onClick={() => setSelectedKeyId(isSelected ? null : d.id)}
                        className={`border-t border-white/5 hover:bg-white/10 cursor-pointer transition-colors ${isSelected ? 'bg-sky-500/10' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {flagged && (
                              <span title="Security event on this device">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              </span>
                            )}
                            <div>
                              <div className="font-semibold">{d.schoolName}</div>
                              <div className="text-xs text-zinc-500">{d.schoolId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 font-mono text-xs truncate max-w-[150px]" title={d.activationKey}>
                          {d.activationKey}
                        </td>
                        <td className="px-4 py-3">
                          {d.online ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                              <Circle className="w-2.5 h-2.5 fill-emerald-400" /> Online
                            </span>
                          ) : d.superseded ? (
                            /* A newer key took over this device — it can't be online, and its
                               device's live heartbeat belongs to that newer key, not this one. */
                            <span
                              title="Replaced — a newer key was activated on this same device, so this key is no longer in use"
                              className="inline-flex items-center gap-1.5 text-amber-400/80 text-xs font-semibold"
                            >
                              <Circle className="w-2.5 h-2.5 fill-amber-500/60" /> Superseded
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-zinc-500 text-xs font-semibold">
                              <Circle className="w-2.5 h-2.5 fill-zinc-600" /> Offline
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            title={d.securityTier}
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${t.cls}`}
                          >
                            {t.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            title={d.productId ?? 'Unknown'}
                            className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap bg-white/5 border-white/10 text-zinc-300"
                          >
                            {productDisplayName(d.productId)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" title={d.lastSeenExact}>{d.lastSeenAgo}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.totalOnline}</td>
                        <td className="px-4 py-3 text-zinc-400">{d.appVersion}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>

      {/* Timeline popup — a centered rectangle, not an edge drawer, so it reads as its
          own focused view rather than a sidebar; same backdrop blur as the rest of the
          panel's modals. Closes on backdrop / Close / re-clicking the same row (the
          table already toggles selectedKeyId that way). */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close timeline"
            onClick={() => setSelectedKeyId(null)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
          />
          <div className="relative w-full max-w-xl max-h-[85vh] bg-[#0e0e12]/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-start justify-between gap-3 p-5 border-b border-white/5 bg-white/[0.02] rounded-t-2xl">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Activity Timeline</h2>
                {selectedDevice && (
                  <>
                    <p className="text-sm font-bold text-white truncate mt-1">{selectedDevice.schoolName}</p>
                    <p className="text-[11px] font-mono text-zinc-500 truncate">{selectedDevice.activationKey}</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedKeyId(null)}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
                aria-label="Close timeline"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {eventsByDay.length === 0 ? (
                <div className="text-zinc-500 text-sm">No activity recorded since this key was activated.</div>
              ) : (
                /* One rail runs the full height of the popup — behind the day dividers
                   AND every event node — so it reads as one unbroken line with the day
                   labels threaded through it, not separate boxed timelines per day. */
                <div className="relative">
                  <span className="absolute left-4 top-2 bottom-2 w-px bg-white/10" aria-hidden="true" />
                  <div className="space-y-6">
                    {eventsByDay.map((group) => (
                      <div key={group.dayKey}>
                        {/* Day divider — sits ON the rail (same left offset as the event
                            icons below), matching the "day-wise" grouping. */}
                        <div className="relative flex items-center gap-3 mb-4">
                          <span className="relative z-10 w-[33px] h-[33px] shrink-0 rounded-full border-2 border-white/15 bg-[#0e0e12] flex items-center justify-center">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                          </span>
                          <span className="text-xs font-bold text-zinc-200 uppercase tracking-wide">
                            {group.dayLabel}
                          </span>
                          {group.totalOnline && (
                            <span className="px-1.5 py-0.5 rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-[10px] font-semibold whitespace-nowrap">
                              {group.totalOnline} online
                            </span>
                          )}
                        </div>

                        {group.events.length === 0 && (
                          <div className="text-xs text-zinc-500 mb-4 pl-[45px]">
                            Online this day (session continued from the day before) — no new &quot;came online&quot; event.
                          </div>
                        )}

                        <ol className="space-y-6">
                          {group.events.map((e) => {
                            const { label, Icon, tone } = eventStyle(e.type);
                            const c = TONE[tone];
                            const reason =
                              typeof e.detail?.reason === 'string'
                                ? e.detail.reason
                                : typeof e.detail?.reason_detail === 'string'
                                ? e.detail.reason_detail
                                : null;
                            const occurrenceCount = typeof e.detail?.count === 'number' ? e.detail.count : null;
                            const appV = typeof e.detail?.app_version === 'string' ? e.detail.app_version : null;
                            const ip = typeof e.detail?.ip === 'string' ? e.detail.ip : null;
                            const timeOfDay = e.createdAt
                              ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
                              : e.when;
                            return (
                              <li key={e.id} className="relative flex gap-3">
                                <span
                                  className={`relative z-10 w-[33px] h-[33px] shrink-0 rounded-full border-2 ${c.ring} bg-[#0e0e12] flex items-center justify-center`}
                                  aria-hidden="true"
                                >
                                  <Icon className={`w-3.5 h-3.5 ${c.text}`} />
                                </span>
                                <div className="min-w-0 flex-1 pt-1">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className={`font-semibold text-sm ${c.text}`}>{label}</span>
                                    <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">{timeOfDay}</span>
                                  </div>
                                  {reason && (
                                    <div className="text-xs text-zinc-400 mt-0.5 break-words">
                                      {TAMPER_REASON[reason] ?? reason}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {appV && <span className={`px-1.5 py-0.5 rounded border text-[10px] ${c.chip}`}>app {appV}</span>}
                                    {ip && <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-zinc-400">{ip}</span>}
                                    {occurrenceCount && occurrenceCount > 1 && (
                                      <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-zinc-400">×{occurrenceCount}</span>
                                    )}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
