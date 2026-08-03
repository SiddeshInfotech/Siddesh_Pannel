'use client';

import React, { useMemo, useState } from 'react';
import { DownloadCloud, Circle, Clock, Server, Search } from 'lucide-react';

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
      (d) => d.schoolName.toLowerCase().includes(t) || d.schoolId.toLowerCase().includes(t)
    );
  }, [q, devices]);

  const filteredEvents = useMemo(() => {
    if (!selectedFingerprint) return [];
    return events.filter((e) => e.fingerprint === selectedFingerprint);
  }, [events, selectedFingerprint]);

  return (
    <div className="p-8 max-w-[1200px] mx-auto text-foreground">
      <div className="flex items-center gap-3 mb-1">
        <DownloadCloud className="w-6 h-6 text-sky-400" />
        <h1 className="text-2xl font-bold">Update &amp; Online Sync</h1>
      </div>
      <p className="text-sm text-zinc-400 mb-6">
        Live device telemetry — online status, cumulative online time, and a per-school activity timeline.
        APK / content push tools arrive in the next phase of this tab.
      </p>

      {/* Stat row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wide">
            <Circle className="w-3 h-3 fill-emerald-400" /> Online now
          </div>
          <div className="text-3xl font-bold mt-2">{onlineCount}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-zinc-400 text-xs font-semibold uppercase tracking-wide">
            <Server className="w-3 h-3" /> Known devices
          </div>
          <div className="text-3xl font-bold mt-2">{devices.length}</div>
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
                placeholder="Search school name or ID…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-sky-500/50"
              />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-zinc-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">School</th>
                  <th className="text-left px-4 py-3">Key</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Tier</th>
                  <th className="text-left px-4 py-3">Last seen</th>
                  <th className="text-left px-4 py-3">Online time</th>
                  <th className="text-left px-4 py-3">App</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No devices have reported in yet.
                  </td></tr>
                )}
                {filtered.map((d) => {
                  const isSelected = d.fingerprint === selectedFingerprint;
                  return (
                    <tr 
                      key={d.fingerprint} 
                      onClick={() => setSelectedFingerprint(isSelected ? null : d.fingerprint)}
                      className={`border-t border-white/5 hover:bg-white/10 cursor-pointer transition-colors ${isSelected ? 'bg-white/10' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{d.schoolName}</div>
                        <div className="text-xs text-zinc-500">{d.schoolId}</div>
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
                        {(() => {
                          const t = tierStyle(d.securityTier);
                          return (
                            <span
                              title={d.securityTier}
                              className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${t.cls}`}
                            >
                              {t.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3" title={d.lastSeenExact}>{d.lastSeenAgo}</td>
                      <td className="px-4 py-3">{d.totalOnline}</td>
                      <td className="px-4 py-3 text-zinc-400">{d.appVersion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Timeline */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-3">Timeline</h2>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 max-h-[560px] overflow-y-auto">
            {!selectedFingerprint ? (
              <div className="text-zinc-500 text-sm">Select a device from the table to view its timeline.</div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-zinc-500 text-sm">No events for this device yet.</div>
            ) : (
              <div className="relative mt-2">
                {filteredEvents.map((e, index) => {
                  const isLast = index === filteredEvents.length - 1;
                  return (
                    <div key={e.id} className="relative flex items-start mb-6 last:mb-0">
                      {/* Time on the left */}
                      <div className="w-[60px] text-right pt-2 shrink-0 text-xs font-semibold text-zinc-400">
                        {e.whenAgo}
                      </div>

                      {/* Line and circle in the middle */}
                      <div className="relative flex flex-col items-center w-10 shrink-0">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-sky-400 bg-background z-10 mt-2" />
                        {!isLast && (
                          <div className="absolute top-5 bottom-[-32px] left-1/2 -translate-x-1/2 w-px bg-white/20" />
                        )}
                      </div>

                      {/* Card on the right */}
                      <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 shadow-sm hover:bg-white/10 transition-colors">
                        <div className="font-bold text-sky-100 text-sm mb-1">{e.type}</div>
                        <div className="text-sm text-zinc-300 mb-2">{e.schoolName}</div>
                        <div className="text-xs font-semibold text-zinc-500 uppercase">{e.when}</div>
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
