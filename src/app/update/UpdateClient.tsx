'use client';

import React, { useMemo, useState } from 'react';
import { DownloadCloud, Circle, Clock, Server, Search } from 'lucide-react';

type Device = {
  fingerprint: string;
  schoolName: string;
  schoolId: string;
  appVersion: string;
  online: boolean;
  lastSeenAgo: string;
  lastSeenExact: string;
  firstSeenExact: string;
  totalOnline: string;
  lastIp: string;
};
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
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return devices;
    return devices.filter(
      (d) => d.schoolName.toLowerCase().includes(t) || d.schoolId.toLowerCase().includes(t)
    );
  }, [q, devices]);

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
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Last seen</th>
                  <th className="text-left px-4 py-3">Online time</th>
                  <th className="text-left px-4 py-3">App</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No devices have reported in yet.
                  </td></tr>
                )}
                {filtered.map((d) => (
                  <tr key={d.fingerprint} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{d.schoolName}</div>
                      <div className="text-xs text-zinc-500">{d.schoolId}</div>
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
                    <td className="px-4 py-3" title={d.lastSeenExact}>{d.lastSeenAgo}</td>
                    <td className="px-4 py-3">{d.totalOnline}</td>
                    <td className="px-4 py-3 text-zinc-400">{d.appVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Timeline */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-3">Timeline</h2>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 max-h-[560px] overflow-y-auto">
            {events.length === 0 && <div className="text-zinc-500 text-sm">No events yet.</div>}
            <ol className="relative border-l border-white/10 ml-2">
              {events.map((e) => (
                <li key={e.id} className="mb-5 ml-4">
                  <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-sky-400 border-2 border-black/40" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-300">{e.type}</span>
                    <span className="text-[10px] text-zinc-500">{e.whenAgo}</span>
                  </div>
                  <div className="text-sm font-medium">{e.schoolName}</div>
                  <div className="text-[11px] text-zinc-500">{e.when}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
