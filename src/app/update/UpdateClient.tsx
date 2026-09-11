'use client';

import React, { useMemo, useState } from 'react';
import {
  DownloadCloud, Circle, Clock, Server, Search, Wifi, WifiOff, ShieldAlert, KeyRound,
  CheckCircle2, AlertTriangle, X, CalendarX, Ban, Replace, Loader2, Info,
} from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import { PRODUCT_FILTER_OPTIONS, UNRESOLVED_PRODUCT_FILTER_VALUE, productDisplayName } from '@/lib/productIdentity';
import { tierStyle } from '@/lib/tierStyle';
import { getKeyTimeline } from './actions';
import { IST, SECURITY_EVENT_TYPES, humanDuration, type Device, type Ev, type KeyState } from './shared';

// ── Key status + connection badges ──────────────────────────────────────────────────
const KEY_STATE: Record<KeyState, { label: string; cls: string; help: string }> = {
  active: {
    label: 'Active',
    cls: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    help: 'Activated, not expired, and the key its device is running now.',
  },
  expired: {
    label: 'Expired',
    cls: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
    help: 'Past its expiry date. The app on that device stops playing content until the key is renewed.',
  },
  superseded: {
    label: 'Superseded',
    cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    help: 'This key was activated on a device, but a NEWER key was later activated on that same device, so this key is no longer in use there. Common on test machines activated several times, or after a renewal with a new key.',
  },
  revoked: {
    label: 'Revoked',
    cls: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400',
    help: 'Deactivated by an admin. The device can no longer use it.',
  },
  not_activated: {
    label: 'Not activated',
    cls: 'bg-white/5 border-white/10 text-zinc-500',
    help: 'Generated but never activated on any device yet (or its device binding was reset).',
  },
};

// ── Timeline event registry — turns raw event_type codes into a clear label, an
//    icon, and a colour tone so the timeline reads at a glance. ──────────────────
type Tone = 'ok' | 'info' | 'warn' | 'danger';
const TONE: Record<Tone, { ring: string; text: string; chip: string }> = {
  ok:     { ring: 'border-emerald-400/60', text: 'text-emerald-300', chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' },
  info:   { ring: 'border-sky-400/60',     text: 'text-sky-200',     chip: 'bg-sky-500/10 border-sky-500/25 text-sky-300' },
  warn:   { ring: 'border-amber-400/60',   text: 'text-amber-300',   chip: 'bg-amber-500/10 border-amber-500/25 text-amber-300' },
  danger: { ring: 'border-rose-500/70',    text: 'text-rose-300',    chip: 'bg-rose-500/10 border-rose-500/25 text-rose-300' },
};

function eventStyle(type: string, detail: Record<string, unknown>): { label: string; Icon: React.ElementType; tone: Tone } {
  switch (type) {
    case 'ONLINE':             return { label: 'Came online',                Icon: Wifi,          tone: 'ok' };
    case 'OFFLINE':            return { label: detail.ongoing ? 'Went offline (still offline)' : 'Went offline', Icon: WifiOff, tone: 'info' };
    case 'KEY_ACTIVATED':
    case 'ACTIVATED':          return { label: 'Key activated on this device', Icon: CheckCircle2, tone: 'ok' };
    case 'KEY_SUPERSEDED':     return { label: 'Replaced by a newer key',    Icon: Replace,       tone: 'warn' };
    case 'KEY_EXPIRED':        return { label: 'Key expired',                Icon: CalendarX,     tone: 'danger' };
    case 'REMOTE_KILL':        return { label: 'Remotely deactivated',       Icon: Ban,           tone: 'danger' };
    case 'EXPIRY_TAMPER':      return { label: 'Expiry tamper attempt',      Icon: ShieldAlert,   tone: 'danger' };
    case 'GUARD_HEALTH_ISSUE': return { label: 'Guard/TPM health issue',     Icon: AlertTriangle, tone: 'warn' };
    case 'CEK_DECRYPT_FAILED': return { label: 'Content key decrypt failed', Icon: KeyRound,      tone: 'warn' };
    case 'ATTESTATION_ISSUE':  return { label: 'Attestation issue',          Icon: ShieldAlert,   tone: 'danger' };
    // Deliberately NOT a security tone — an infra-side verification hiccup must never
    // read as an attack on the fleet. See attestationTelemetry.ts.
    case 'ATTESTATION_HEALTH_WARNING': return { label: 'Attestation health warning', Icon: AlertTriangle, tone: 'warn' };
    default:                   return { label: type.replace(/_/g, ' '),      Icon: Circle,        tone: 'info' };
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

const SECURITY_EVENTS = new Set<string>(SECURITY_EVENT_TYPES);

type StatusFilter = 'all' | 'online' | 'offline' | KeyState;

// Local noon in IST for a YYYY-MM-DD day key — formatting midnight in the browser's own
// timezone could land on the neighbouring IST day for viewers outside India.
const dayLabelFor = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });

type TimelineState = { status: 'loading' | 'ready' | 'error'; events: Ev[]; error?: string };

export default function UpdateClient({
  devices, securityEvents, onlineCount, serverTime,
}: {
  devices: Device[]; securityEvents: Ev[]; onlineCount: number; serverTime: string;
}) {
  const [q, setQ] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showLegend, setShowLegend] = useState(false);
  // Selects a table ROW (one licence key), not a device: the same device_fingerprint can
  // carry more than one key over time, so only the key's own row id is unique.
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, TimelineState>>({});

  // Product + search narrow the list first; the status counts are computed on THAT list so
  // the numbers in the status filter always match what selecting them would show.
  const searched = useMemo(() => {
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

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: searched.length, online: 0, offline: 0,
      active: 0, expired: 0, superseded: 0, revoked: 0, not_activated: 0,
    };
    for (const d of searched) {
      c[d.keyState] += 1;
      if (d.connection === 'online') c.online += 1;
      if (d.connection === 'offline' || d.connection === 'never') c.offline += 1;
    }
    return c;
  }, [searched]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return searched;
    if (statusFilter === 'online') return searched.filter((d) => d.connection === 'online');
    if (statusFilter === 'offline') return searched.filter((d) => d.connection === 'offline' || d.connection === 'never');
    return searched.filter((d) => d.keyState === statusFilter);
  }, [searched, statusFilter]);

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: `All keys (${counts.all})` },
    { value: 'online', label: `Online now (${counts.online})` },
    { value: 'offline', label: `Offline (${counts.offline})` },
    { value: 'active', label: `Active (${counts.active})` },
    { value: 'expired', label: `Expired (${counts.expired})` },
    { value: 'superseded', label: `Superseded (${counts.superseded})` },
    { value: 'revoked', label: `Revoked (${counts.revoked})` },
    { value: 'not_activated', label: `Not activated (${counts.not_activated})` },
  ];

  // Fingerprints that have at least one security event (for the red row marker).
  const flaggedFingerprints = useMemo(() => new Set(securityEvents.map((e) => e.fingerprint)), [securityEvents]);
  const securityAlertCount = securityEvents.filter((e) => SECURITY_EVENTS.has(e.type)).length;

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedKeyId) ?? null,
    [devices, selectedKeyId]
  );
  const timeline = selectedKeyId ? timelines[selectedKeyId] : undefined;

  // Opening a row (re)loads that key's full timeline from the server — always fresh, while
  // any previously loaded copy stays on screen until the new one arrives.
  const openKey = (d: Device) => {
    if (selectedKeyId === d.id) { setSelectedKeyId(null); return; }
    setSelectedKeyId(d.id);
    if (!d.fingerprint) return;
    setTimelines((t) => ({ ...t, [d.id]: { status: 'loading', events: t[d.id]?.events ?? [] } }));
    getKeyTimeline(d.id)
      .then((res) =>
        setTimelines((t) => ({
          ...t,
          [d.id]: res.ok ? { status: 'ready', events: res.data } : { status: 'error', events: [], error: res.error },
        }))
      )
      .catch(() =>
        setTimelines((t) => ({ ...t, [d.id]: { status: 'error', events: [], error: 'Could not load the timeline. Please try again.' } }))
      );
  };

  // Day-grouped for the timeline popup: one date divider per IST calendar day. Events arrive
  // newest-first from the server. Each day also carries its total online duration (already
  // scoped to this key's own window) — merged in even for a day with online time but no
  // event of its own (a session running through midnight logs nothing on the second day).
  const eventsByDay = useMemo(() => {
    const groups: { dayKey: string; events: Ev[]; totalOnline: string | null }[] = [];
    const indexByKey = new Map<string, number>();
    const dailyByKey = new Map((selectedDevice?.dailyBreakdown ?? []).map((d) => [d.day, d.totalOnline]));
    for (const e of timeline?.events ?? []) {
      const dayKey = e.createdAt ? new Date(e.createdAt).toLocaleDateString('en-CA', { timeZone: IST }) : 'unknown';
      let idx = indexByKey.get(dayKey);
      if (idx === undefined) {
        idx = groups.length;
        indexByKey.set(dayKey, idx);
        groups.push({ dayKey, events: [], totalOnline: dailyByKey.get(dayKey) ?? null });
      }
      groups[idx].events.push(e);
    }
    for (const [dayKey, totalOnline] of dailyByKey) {
      if (!indexByKey.has(dayKey)) groups.push({ dayKey, events: [], totalOnline });
    }
    groups.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0)); // newest first
    return groups;
  }, [timeline, selectedDevice]);

  const statCard = (
    filter: StatusFilter, label: React.ReactNode, value: number, tone: string, active = statusFilter === filter
  ) => (
    <button
      type="button"
      onClick={() => setStatusFilter(active ? 'all' : filter)}
      className={`text-left rounded-2xl border p-5 transition-colors cursor-pointer ${
        active ? 'border-sky-500/50 bg-sky-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${tone}`}>{label}</div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </button>
  );

  return (
    <div className="p-8 max-w-[1300px] mx-auto text-foreground">
      <div className="flex items-center gap-3 mb-1">
        <DownloadCloud className="w-6 h-6 text-sky-400" />
        <h1 className="text-2xl font-bold">Update &amp; Online Sync</h1>
      </div>
      <p className="text-sm text-zinc-400 mb-6">
        Every licence key — one row per key, whatever its state (active, expired, superseded, revoked or not
        yet activated) — with its device&apos;s online status, online time, security posture and a per-key activity
        timeline. <span className="text-zinc-500">Server time: {serverTime}</span>
      </p>

      {/* Stat row — each card is also a one-click filter (click again to clear). */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        {statCard('all', <><Server className="w-3 h-3" /> All keys</>, counts.all, 'text-zinc-400')}
        {/* Devices, not key rows: one machine online is one, however many keys it has held. */}
        {statCard('online', <><Circle className="w-3 h-3 fill-emerald-400" /> Online now</>, onlineCount, 'text-emerald-400')}
        {statCard('offline', <><WifiOff className="w-3 h-3" /> Offline</>, counts.offline, 'text-zinc-400')}
        {statCard('expired', <><CalendarX className="w-3 h-3" /> Expired</>, counts.expired, 'text-rose-400')}
        <div className={`rounded-2xl border p-5 ${securityAlertCount > 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-white/10 bg-white/5'}`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${securityAlertCount > 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
            <ShieldAlert className="w-3 h-3" /> Security alerts
          </div>
          <div className={`text-3xl font-bold mt-2 ${securityAlertCount > 0 ? 'text-rose-300' : ''}`}>{securityAlertCount}</div>
        </div>
      </div>

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
        <div className="w-[200px] flex-shrink-0">
          <CustomSelect value={statusFilter} onChange={(val) => setStatusFilter(val as StatusFilter)} options={statusOptions} />
        </div>
        <div className="w-[190px] flex-shrink-0">
          <CustomSelect value={productFilter} onChange={(val) => setProductFilter(val)} options={PRODUCT_FILTER_OPTIONS} />
        </div>
        <button
          type="button"
          onClick={() => setShowLegend((v) => !v)}
          className={`p-2 rounded-xl border transition-colors cursor-pointer ${showLegend ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-white/10 bg-white/5 text-zinc-400 hover:text-white'}`}
          title="What do the statuses mean?"
          aria-label="What do the statuses mean?"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      {showLegend && (
        <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 grid gap-2 sm:grid-cols-2 text-xs">
          {(Object.keys(KEY_STATE) as KeyState[]).map((s) => (
            <div key={s} className="flex items-start gap-2">
              <span className={`inline-flex shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${KEY_STATE[s].cls}`}>{KEY_STATE[s].label}</span>
              <span className="text-zinc-400">{KEY_STATE[s].help}</span>
            </div>
          ))}
          <div className="flex items-start gap-2 sm:col-span-2 pt-1 border-t border-white/5">
            <span className="text-zinc-300 font-semibold shrink-0">Connection</span>
            <span className="text-zinc-400">
              Online = the device sent a heartbeat in the last 6 minutes. Offline = it has reported before but not
              recently. Never seen = activated but no heartbeat yet. Shown only for the key a device is running — a
              superseded key&apos;s device reports for its newer key.
            </span>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-white/5 text-zinc-400 text-[11px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">School</th>
                <th className="text-left px-4 py-3 font-semibold">Licence key</th>
                <th className="text-left px-4 py-3 font-semibold">Key status</th>
                <th className="text-left px-4 py-3 font-semibold">Connection</th>
                <th className="text-left px-4 py-3 font-semibold">Expires</th>
                <th className="text-left px-4 py-3 font-semibold">Tier</th>
                <th className="text-left px-4 py-3 font-semibold">Product</th>
                <th className="text-right px-4 py-3 font-semibold">Online time</th>
                <th className="text-left px-4 py-3 font-semibold">App</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-zinc-500">No keys match these filters.</td></tr>
              )}
              {filtered.map((d) => {
                const isSelected = d.id === selectedKeyId;
                const flagged = !!d.fingerprint && flaggedFingerprints.has(d.fingerprint);
                const t = tierStyle(d.securityTier);
                const ks = KEY_STATE[d.keyState];
                const expiredNow = d.keyState === 'expired';
                return (
                  <tr
                    key={d.id}
                    onClick={() => openKey(d)}
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
                      <span title={ks.help} className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${ks.cls}`}>
                        {ks.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" title={d.lastSeenExact}>
                      {d.connection === 'online' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                          <Circle className="w-2.5 h-2.5 fill-emerald-400" /> Online
                        </span>
                      )}
                      {d.connection === 'offline' && (
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-zinc-400 text-xs font-semibold">
                            <Circle className="w-2.5 h-2.5 fill-zinc-600" /> Offline
                          </span>
                          <div className="text-[11px] text-zinc-500">seen {d.lastSeenAgo}</div>
                        </div>
                      )}
                      {d.connection === 'never' && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-500 text-xs font-semibold">
                          <Circle className="w-2.5 h-2.5 text-zinc-600" /> Never seen
                        </span>
                      )}
                      {d.connection === 'na' && <span className="text-zinc-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.expiresAtIso ? (
                        <div>
                          <div className={`text-xs ${expiredNow ? 'text-rose-400 font-semibold' : 'text-zinc-300'}`}>{d.expiresExact}</div>
                          <div className={`text-[11px] ${expiredNow ? 'text-rose-400/70' : 'text-zinc-500'}`}>
                            {expiredNow ? `expired ${d.expiresRelative}` : d.expiresRelative}
                          </div>
                        </div>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span title={d.securityTier} className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${t.cls}`}>
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
                    <td className="px-4 py-3 text-right tabular-nums">{d.totalOnline}</td>
                    <td className="px-4 py-3 text-zinc-400">{d.appVersion}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timeline popup — a centered rectangle with the panel's usual backdrop blur. Closes on
          backdrop / Close / re-clicking the same row. */}
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
                <p className="text-sm font-bold text-white truncate mt-1">{selectedDevice.schoolName}</p>
                <p className="text-[11px] font-mono text-zinc-500 truncate">{selectedDevice.activationKey}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px]">
                  <span className={`px-2 py-0.5 rounded-md border font-semibold ${KEY_STATE[selectedDevice.keyState].cls}`}>
                    {KEY_STATE[selectedDevice.keyState].label}
                  </span>
                  {selectedDevice.activatedAtIso && (
                    <span className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-400">activated {selectedDevice.activatedExact}</span>
                  )}
                  {selectedDevice.expiresAtIso && (
                    <span className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-400">
                      {selectedDevice.keyState === 'expired' ? 'expired' : 'expires'} {selectedDevice.expiresExact}
                    </span>
                  )}
                  {selectedDevice.fingerprint && (
                    <span className="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-400">online {selectedDevice.totalOnline}</span>
                  )}
                </div>
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
              {!selectedDevice.fingerprint ? (
                <div className="text-zinc-500 text-sm">This key has not been activated on any device yet, so there is no activity to show.</div>
              ) : timeline?.status === 'error' ? (
                <div className="text-rose-300 text-sm">{timeline.error}</div>
              ) : timeline?.status === 'loading' && timeline.events.length === 0 ? (
                <div className="flex items-center gap-2 text-zinc-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading timeline…
                </div>
              ) : eventsByDay.length === 0 ? (
                <div className="text-zinc-500 text-sm">No activity recorded since this key was activated.</div>
              ) : (
                /* One rail runs the full height — behind the day dividers AND every event node. */
                <div className="relative">
                  <span className="absolute left-4 top-2 bottom-2 w-px bg-white/10" aria-hidden="true" />
                  <div className="space-y-6">
                    {eventsByDay.map((group) => (
                      <div key={group.dayKey}>
                        <div className="relative flex items-center gap-3 mb-4">
                          <span className="relative z-10 w-[33px] h-[33px] shrink-0 rounded-full border-2 border-white/15 bg-[#0e0e12] flex items-center justify-center">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                          </span>
                          <span className="text-xs font-bold text-zinc-200 uppercase tracking-wide">
                            {group.dayKey === 'unknown' ? 'Date unknown' : dayLabelFor(group.dayKey)}
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
                            const { label, Icon, tone } = eventStyle(e.type, e.detail);
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
                            const sessionSecs = typeof e.detail?.duration_seconds === 'number' ? e.detail.duration_seconds : null;
                            const timeOfDay = e.createdAt
                              ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
                              : '—';
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
                                    <div className="text-xs text-zinc-400 mt-0.5 break-words">{TAMPER_REASON[reason] ?? reason}</div>
                                  )}
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {sessionSecs !== null && (
                                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${c.chip}`}>
                                        session {sessionSecs < 60 ? 'under 1m' : humanDuration(sessionSecs)}
                                      </span>
                                    )}
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
