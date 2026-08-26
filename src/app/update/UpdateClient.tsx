'use client';

import React, { useMemo, useState } from 'react';
import {
  DownloadCloud, Circle, Clock, Server, Search,
  Wifi, WifiOff, ShieldAlert, KeyRound, CheckCircle2, AlertTriangle,
} from 'lucide-react';

type Device = {
  fingerprint: string;
  activationKey: string;
  schoolName: string;
  schoolId: string;
  appVersion: string;
  online: boolean;
  lastSeenAgo: string;
  lastSeenExact: string;
  firstSeenExact: string;
  totalOnline: string;
  lastIp: string;
  securityTier: string;
};

// Short label + badge colour per device security tier (KeystoreCrypto taxonomy).
function tierStyle(tier: string): { label: string; cls: string } {
  switch (tier) {
    case 'ATTESTED_STRONGBOX':
      return { label: 'StrongBox', cls: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' };
    case 'ATTESTED_TEE':
      return { label: 'TEE', cls: 'bg-green-500/10 border-green-500/30 text-green-400' };
    case 'KEYSTORE_PLAIN':
      return { label: 'No chain', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400' };
    case 'TEE_LEGACY_NOATTEST':
      return { label: 'TEE legacy', cls: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' };
    case 'MODEL_SKIP':
      return { label: 'Model skip', cls: 'bg-sky-500/10 border-sky-500/30 text-sky-400' };
    case 'SW_ONLY':
      return { label: 'Software', cls: 'bg-orange-500/10 border-orange-500/30 text-orange-400' };
    case 'PROVISION_FAILED':
    case 'CEK_DECRYPT_FAILED':
      return { label: tier === 'CEK_DECRYPT_FAILED' ? 'CEK failed' : 'Failed', cls: 'bg-rose-500/10 border-rose-500/30 text-rose-400' };
    default:
      return { label: '—', cls: 'bg-white/5 border-white/10 text-zinc-500' };
  }
}

type Ev = {
  id: string;
  type: string;
  schoolName: string;
  fingerprint: string;
  detail: Record<string, unknown>;
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
const SECURITY_EVENTS = new Set(['EXPIRY_TAMPER', 'CEK_DECRYPT_FAILED']);

export default function UpdateClient({
  devices, events, onlineCount, serverTime,
}: {
  devices: Device[]; events: Ev[]; onlineCount: number; serverTime: string;
}) {
  const [q, setQ] = useState('');
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return devices;
    return devices.filter(
      (d) => d.schoolName.toLowerCase().includes(t) ||
             d.schoolId.toLowerCase().includes(t) ||
             d.activationKey.toLowerCase().includes(t)
    );
  }, [q, devices]);

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

  const filteredEvents = useMemo(() => {
    if (!selectedFingerprint) return [];
    return events.filter((e) => e.fingerprint === selectedFingerprint);
  }, [events, selectedFingerprint]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.fingerprint === selectedFingerprint) ?? null,
    [devices, selectedFingerprint]
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Devices table */}
        <div className="lg:col-span-2">
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
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead className="bg-white/5 text-zinc-400 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">School</th>
                    <th className="text-left px-4 py-3 font-semibold">Active key</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Tier</th>
                    <th className="text-left px-4 py-3 font-semibold">Last seen</th>
                    <th className="text-right px-4 py-3 font-semibold">Online time</th>
                    <th className="text-left px-4 py-3 font-semibold">App</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                      No devices have reported in yet.
                    </td></tr>
                  )}
                  {filtered.map((d) => {
                    const isSelected = d.fingerprint === selectedFingerprint;
                    const flagged = flaggedFingerprints.has(d.fingerprint);
                    const t = tierStyle(d.securityTier);
                    return (
                      <tr
                        key={d.fingerprint}
                        onClick={() => setSelectedFingerprint(isSelected ? null : d.fingerprint)}
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

        {/* Timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Timeline</h2>
            {selectedDevice && (
              <span className="text-xs text-zinc-500 truncate max-w-[160px]" title={selectedDevice.schoolName}>
                {selectedDevice.schoolName}
              </span>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 max-h-[560px] overflow-y-auto">
            {!selectedFingerprint ? (
              <div className="text-zinc-500 text-sm">Select a device from the table to view its timeline.</div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-zinc-500 text-sm">No events for this device yet.</div>
            ) : (
              <div className="relative mt-1">
                {filteredEvents.map((e, index) => {
                  const isLast = index === filteredEvents.length - 1;
                  const { label, Icon, tone } = eventStyle(e.type);
                  const c = TONE[tone];
                  const reason = typeof e.detail?.reason === 'string' ? e.detail.reason : null;
                  const appV = typeof e.detail?.app_version === 'string' ? e.detail.app_version : null;
                  const ip = typeof e.detail?.ip === 'string' ? e.detail.ip : null;
                  return (
                    <div key={e.id} className="relative flex items-start gap-3 pb-6 last:pb-0">
                      {/* Rail: icon-in-circle + connecting line */}
                      <div className="relative flex flex-col items-center shrink-0">
                        <div className={`w-7 h-7 rounded-full border-2 ${c.ring} bg-background z-10 flex items-center justify-center`}>
                          <Icon className={`w-3.5 h-3.5 ${c.text}`} />
                        </div>
                        {!isLast && <div className="absolute top-7 bottom-[-24px] w-px bg-white/15" />}
                      </div>

                      {/* Card */}
                      <div className={`flex-1 rounded-xl p-3 border ${tone === 'danger' ? 'bg-rose-500/5 border-rose-500/25' : 'bg-white/5 border-white/10'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={`font-semibold text-sm ${c.text}`}>{label}</div>
                          <div className="text-[10px] text-zinc-500 whitespace-nowrap">{e.whenAgo}</div>
                        </div>
                        {reason && (
                          <div className="text-xs text-rose-200/90 mt-1">
                            {TAMPER_REASON[reason] ?? reason}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {appV && <span className={`px-1.5 py-0.5 rounded border text-[10px] ${c.chip}`}>app {appV}</span>}
                          {ip && <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-zinc-400">{ip}</span>}
                        </div>
                        <div className="text-[10px] font-medium text-zinc-500 mt-2">{e.when}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
