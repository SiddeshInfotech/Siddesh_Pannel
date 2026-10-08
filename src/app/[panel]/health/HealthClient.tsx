'use client';

// Operations Center UI. Every number shows where it came from; anything without data reads
// "Not available" — never a placeholder value. Polls one summary action every 30 s (no
// per-browser provider calls; providers are synced by the backend cron).
import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/PanelLink';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HeartPulse, RefreshCw, ShieldAlert } from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import InfoTip from '@/components/InfoTip';
import ConfirmDialog from '@/components/ConfirmDialog';
import { HEALTH_TAB_HELP, HELP } from '@/lib/diagnostics/help';
import * as A from './actions';

/* eslint-disable @typescript-eslint/no-explicit-any -- action payloads */

const TABS = [
  ['overview', 'Overview'], ['schools', 'Schools'], ['devices', 'Devices'], ['performance', 'Performance'], ['incidents', 'Incidents'],
  ['alerts', 'Alerts'], ['infrastructure', 'Infrastructure'], ['cost', 'Consumption & Cost'], ['deployments', 'Deployments'], ['settings', 'Settings'],
] as const;
type Tab = (typeof TABS)[number][0];
const IST = 'Asia/Kolkata';
const NA = <span className="text-zinc-500">Not available</span>;
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—');
const ago = (s?: string | null) => { if (!s) return 'never'; const m = Math.round((Date.now() - Date.parse(s)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const num = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: d }) : null);
const show = (v: any, suffix = '', d = 1) => { const s = num(v, d); return s === null ? NA : <>{s}{suffix}</>; };
const bytes = (v: any) => { const n = Number(v); if (!Number.isFinite(n)) return NA; return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`; };
const DOT: Record<string, string> = { HEALTHY: '🟢', WARNING: '🟡', DEGRADED: '🟡', CRITICAL: '🔴', DOWN: '🔴', OFFLINE: '🔴', ONLINE: '🟢', STALE: '🟡', UNKNOWN: '⚪' };
const St = ({ s }: { s?: string | null }) => <span className="whitespace-nowrap">{DOT[s ?? 'UNKNOWN'] ?? '⚪'} {(s ?? 'UNKNOWN').toLowerCase()}</span>;
const Card = ({ title, children, className = '' }: { title: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <GlassCard className={className}><div className="text-xs space-y-2"><h4 className="font-semibold text-foreground text-sm flex items-center gap-1">{title}{typeof title === 'string' && HELP[title] && <InfoTip text={HELP[title]} />}</h4>{children}</div></GlassCard>
);
const Kpi = ({ label, value, href, sub }: { label: string; value: React.ReactNode; href?: string; sub?: React.ReactNode }) => {
  const body = <div className="rounded-xl border border-sidebar-border p-3 hover:bg-white/5"><div className="text-[11px] text-zinc-500 flex items-center gap-1">{label}{HELP[label] && <InfoTip text={HELP[label]} />}</div><div className="text-lg font-bold text-foreground">{value}</div>{sub && <div className="text-[11px] text-zinc-500">{sub}</div>}</div>;
  return href ? <Link href={href}>{body}</Link> : body;
};
function useLoad<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string } | any>, deps: unknown[], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(deps);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `fn` is recreated each render; `key` captures its inputs
  const load = useCallback(() => { fn().then((r: any) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error))); }, [key]);
  useEffect(() => { load(); if (!pollMs) return; const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs); return () => clearInterval(t); }, [load, pollMs]);
  return { data, err, reload: load };
}
const Err = ({ e }: { e: string | null }) => (e ? <GlassCard><p className="text-xs text-rose-400 flex items-center gap-2"><ShieldAlert className="w-4 h-4" />{e}</p></GlassCard> : null);
const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="overflow-x-auto"><table className="data-table text-xs w-full"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="text-center text-zinc-500 py-4">No data</td></tr>}</tbody></table></div>
);

export default function HealthClient({ products }: { products: { value: string; label: string; group?: string }[] }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState('24h');
  const [product, setProduct] = useState<string>('');
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="h-10" />
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><HeartPulse className="w-6 h-6" /> Operations Center</h2>
        <div className="flex gap-2 text-xs">
          <Sel w="w-72" value={product} onChange={setProduct} options={[{ value: '', label: 'All Products' }, ...products]} />
          <Sel w="w-44" value={range} onChange={setRange} options={[['15m', 'Last 15 minutes'], ['1h', 'Last 1 hour'], ['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([value, label]) => ({ value, label }))} />
        </div>
      </div>
      <div className="flex flex-wrap border-b border-sidebar-border">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`filter-tab ${tab === k ? 'filter-tab-active' : ''}`}>{l}</button>)}
      </div>
      <p className="text-xs text-zinc-500 flex items-center gap-1"><InfoTip text={HEALTH_TAB_HELP[tab]} /> {HEALTH_TAB_HELP[tab]}</p>
      {tab === 'overview' && <Overview range={range} product={product} onProduct={setProduct} onTab={setTab} />}
      {tab === 'schools' && <Schools product={product} />}
      {tab === 'devices' && <Devices product={product} />}
      {tab === 'performance' && <Performance range={range} product={product} />}
      {tab === 'incidents' && <Incidents />}
      {tab === 'alerts' && <Alerts />}
      {tab === 'infrastructure' && <Infrastructure />}
      {tab === 'cost' && <Cost />}
      {tab === 'deployments' && <Deployments product={product} />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}


/** Panel-styled dropdown (CustomSelect) — replaces native <select> so menus match the panel theme. */
function Sel({ value, onChange, options, w = 'w-40' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; w?: string }) {
  return <CustomSelect size="sm" className={w} value={value} onChange={onChange} options={options} />;
}
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, ' ').toLowerCase().replace(/^w/, (c) => c.toUpperCase()) }));

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ range, product, onProduct, onTab }: { range: string; product: string; onProduct: (p: string) => void; onTab: (t: Tab) => void }) {
  const { data: d, err, reload } = useLoad<any>(() => A.getOverview(range, product || null), [range, product], 30_000);
  if (err) return <Err e={err} />;
  if (!d) return <p className="text-xs text-zinc-500">Loading…</p>;
  const s = d.score, o = d.operational, v = d.values, c = d.counts, inf = d.infrastructure;
  const delta = s.score !== null && d.previousScore !== null ? s.score - d.previousScore : null;
  const crashHref = '/logs?tab=crashes';
  return (
    <div className="space-y-4">
      <div className="flex justify-end text-[11px] text-zinc-500 gap-2 items-center">Updated {ago(d.generatedAt)} · auto-refresh 30 s<button className="filter-tab" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></button></div>
      {/* Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title="Overall Health">
          <div className="text-3xl font-bold">{s.score === null ? '—' : `${s.score} / 100`}</div><St s={s.status} />
          {delta !== null && <div className="text-zinc-500">{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} vs last hour</div>}
          <ul className="text-zinc-400 list-disc pl-4">{s.penalties.map((p: any) => <li key={p.reason}>−{p.points} {p.reason}</li>)}{!s.penalties.length && s.score !== null && <li>No deductions</li>}</ul>
          <details className="text-zinc-500"><summary className="cursor-pointer">How is this calculated?</summary>100 minus capped penalties: crash rate (10/1%, max 30), error rate (2/1%, max 20), API errors (max 10), API P95 over threshold (5), open incidents (max 30), open alerts (max 10), providers down/degraded (max 20), DB/storage over 80/90% of quota. Missing data is never penalised; no data at all = Unknown.</details>
        </Card>
        <Kpi label="Active incidents" value={d.incidents.filter((i: any) => !['RESOLVED', 'CLOSED'].includes(i.status)).length} sub={`${d.alerts.length} open alerts`} />
        <Kpi label="Active users (15 min)" value={o.activeUsers15m ?? NA} sub="distinct users reporting telemetry" />
        <Kpi label="Online devices" value={`${num(o.onlineDevices)} / ${num(o.devices)}`} sub={`${o.staleDevices} stale · ${o.offlineDevices} offline`} />
      </div>
      {/* Row 2: health by area */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Products" value={`${d.products.filter((p: any) => p.status === 'HEALTHY').length} healthy / ${d.products.length}`} sub={`${d.products.filter((p: any) => p.status === 'WARNING').length} warning · ${d.products.filter((p: any) => p.status === 'CRITICAL').length} critical`} />
        <Kpi label="API health (1 h)" value={c.apiCalls1h ? show(v.api_error_rate_pct, '% errors', 2) : NA} sub={v.api_p95_ms !== null ? `P95 ${num(v.api_p95_ms)} ms` : 'no API telemetry'} />
        <Kpi label="Database" value={inf ? show(inf.dbUsagePct, '% of quota') : NA} sub={inf ? <span onClick={() => onTab('infrastructure')} className="cursor-pointer underline">details</span> : null} />
        <Kpi label="Infrastructure" value={inf?.providers.length ? `${inf.providers.filter((p: any) => p.status === 'HEALTHY').length} / ${inf.providers.length} healthy` : NA} sub={inf?.providers.some((p: any) => p.fresh === 'STALE') ? '⚠ Data may be stale' : inf?.providers.length ? 'synced by backend' : 'no providers configured'} />
      </div>
      {/* Row 3: errors / crashes / latency / users */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Errors (24 h)" value={num(c.errors24h)} sub={v.error_rate_pct !== null ? `${num(v.error_rate_pct, 2)}% of events` : 'no events'} href="/logs?tab=errors" />
        <Kpi label="Crashes (24 h)" value={num(c.crashes24h)} sub={v.crash_rate_pct !== null ? `${num(v.crash_rate_pct, 2)}% of active devices · ${d.newFingerprints24h} new fingerprints` : 'no active devices'} href={crashHref} />
        <Kpi label="Schools online" value={`${o.onlineSchools} / ${o.schools}`} sub={`${o.sessionsStartedToday} sessions started today · ${o.sessionsEndedToday} ended`} />
        <Kpi label="Device disk / RAM P95" value={v.fleet_disk_p95 !== null ? `${num(v.fleet_disk_p95)}% / ${num(v.fleet_ram_p95)}%` : NA} sub={v.fleet_cpu_p95 !== null ? `CPU P95 ${num(v.fleet_cpu_p95)}%` : 'from app heartbeats'} />
      </div>
      <Card title={`Activity — ${range}`}>
        {d.series.length ? (
          <div className="h-56"><ResponsiveContainer><AreaChart data={d.series.map((x: any) => ({ t: new Date(x.bucket).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', day: range.endsWith('d') ? '2-digit' : undefined }), events: +x.events, errors: +x.errors, crashes: +x.crashes, devices: +x.machines }))}>
            <CartesianGrid strokeOpacity={0.1} /><XAxis dataKey="t" fontSize={10} /><YAxis fontSize={10} /><Tooltip />
            <Area dataKey="devices" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.15} /><Area dataKey="errors" stroke="#fb7185" fill="#fb7185" fillOpacity={0.15} /><Area dataKey="crashes" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.3} />
          </AreaChart></ResponsiveContainer></div>) : <p className="text-zinc-500">No telemetry in this range.</p>}
      </Card>
      {/* Products */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {d.products.map((p: any) => (
          <GlassCard key={p.id} interactive><div className="text-xs space-y-1" onClick={() => onProduct(p.id)}>
            <div className="flex justify-between"><b className="text-sm text-foreground">{p.name}</b><St s={p.status} /></div>
            <div className="grid grid-cols-2 gap-x-3 text-zinc-400">
              <span>Version</span><span>{p.version ?? '—'}</span><span>Schools</span><span>{p.schools}</span>
              <span>Devices</span><span>{p.online} online / {p.devices}</span><span>Active users</span><span>{p.activeUsers ?? '—'}</span>
              <span>Error rate</span><span>{p.errorRate === null ? '—' : `${p.errorRate.toFixed(2)}%`}</span><span>Crash rate</span><span>{p.crashRate === null ? '—' : `${p.crashRate.toFixed(2)}%`}</span>
              <span>Uptime</span><span>Not available</span><span>Last deployment</span><span>{p.lastDeployment ? fmt(p.lastDeployment) : '—'}</span>
            </div></div></GlassCard>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <Card title="Top crash issues">
          <Table head={['Bug', 'Issue', 'Occurrences', 'Schools', 'Machines']} rows={d.topCrashes.map((x: any) => [
            <Link key="l" href={`/logs?tab=crashes&issue=${x.id}`} className="underline font-mono">{x.code}</Link>, x.title, num(x.occurrence_count), x.schools, x.machines])} />
        </Card>
        <Card title="Health timeline">
          <ul className="space-y-1 max-h-64 overflow-y-auto">{d.timeline.map((t: any, i: number) => <li key={i}><span className="text-zinc-500">{fmt(t.at)}</span> <b>{t.kind}</b> {t.text}</li>)}
            {!d.timeline.length && <li className="text-zinc-500">No deployments, incidents or alerts in this period.</li>}</ul>
        </Card>
        <Card title="Recent incidents"><Table head={['Incident', 'Title', 'Severity', 'Status', 'Started']} rows={d.incidents.slice(0, 5).map((i: any) => [i.code, i.title, i.severity, i.status, fmt(i.started_at)])} /></Card>
        <Card title="Recent deployments"><Table head={['Product', 'Version', 'Env', 'Status', 'When']} rows={d.releases.slice(0, 6).map((r: any) => [r.product_id, r.version, r.environment, r.status ?? '—', fmt(r.first_seen)])} /></Card>
      </div>
    </div>
  );
}

// ── Schools / devices ───────────────────────────────────────────────────────
function Schools({ product }: { product: string }) {
  const { data, err } = useLoad<any[]>(() => A.getSchools(product || null), [product]);
  if (err) return <Err e={err} />;
  return (
    <Card title={`Schools (${data?.length ?? '…'})`}>
      <Table head={['School', 'Health', 'Devices', 'Online', 'Offline', 'Last seen', 'Errors today', 'Crashes today', 'Versions', '']} rows={(data ?? []).map((s) => [
        s.name, <St key="s" s={s.health} />, s.devices, s.online, s.offline, ago(s.lastSeen), s.errors, s.crashes,
        s.versions.slice(0, 3).map((v: any) => `${v.version} ${v.pct}%`).join(' · '),
        <Link key="l" href={`/logs?tab=all&school=${encodeURIComponent(s.id)}`} className="underline">Diagnostics →</Link>])} />
    </Card>
  );
}

function Devices({ product }: { product: string }) {
  const [f, setF] = useState<{ state?: string; version?: string; page: number }>({ page: 0 });
  const { data, err } = useLoad<any>(() => A.getDevices({ ...f, product: product || undefined }), [f, product]);
  if (err) return <Err e={err} />;
  return (
    <Card title={`Devices (${data?.total ?? '…'})`}>
      <div className="flex gap-2">
        <Sel value={f.state ?? ''} onChange={(v) => setF({ ...f, state: v || undefined, page: 0 })} options={[{ value: '', label: 'All states' }, ...opts(['ONLINE', 'STALE', 'OFFLINE', 'UNKNOWN'])]} />
        <input className="bare-input bg-transparent px-2 py-1 w-28" placeholder="Version" onChange={(e) => setF({ ...f, version: e.target.value || undefined, page: 0 })} />
      </div>
      <Table head={['Computer / machine', 'School', 'Product', 'Version', 'Status', 'Last heartbeat', 'CPU', 'RAM', 'Disk', 'Crashes 24h', 'Errors 24h']} rows={(data?.rows ?? []).map((x: any) => [
        <span key="c" title={x.fp}>{x.computer ?? `${x.fp.slice(0, 12)}…`}</span>, x.school ?? '—', x.product ?? '—', x.version ?? '—', <St key="s" s={x.state} />, ago(x.lastSeen),
        x.cpu === null ? '—' : `${num(x.cpu)}%`, x.ram === null ? '—' : `${num(x.ram)}%`, x.disk === null ? '—' : `${num(x.disk)}%`, x.crashes24h, x.errors24h])} />
      <div className="flex gap-2 justify-end">
        <button className="filter-tab" disabled={!f.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Prev</button>
        <button className="filter-tab" disabled={!data || (f.page + 1) * 50 >= data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
      </div>
      <p className="text-zinc-500">CPU/RAM/Disk come from the app heartbeat (every 15 min); “—” means the device hasn’t reported it.</p>
    </Card>
  );
}

// ── Performance ─────────────────────────────────────────────────────────────
function Performance({ range, product }: { range: string; product: string }) {
  const { data, err } = useLoad<any>(() => A.getPerformance(range, product || null), [range, product]);
  if (err) return <Err e={err} />;
  const ms = (v: any) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);
  const api = (data?.percentiles ?? []).filter((r: any) => r.category === 'API');
  return (
    <div className="space-y-3">
      <Card title="Latency percentiles (reported durations)">
        <Table head={['Category', 'Operation', 'Count', 'P50', 'P75', 'P90', 'P95', 'P99']} rows={(data?.percentiles ?? []).filter((r: any) => r.category !== 'API').map((r: any) => [r.category, r.name, num(Number(r.n)), ms(r.p50), ms(r.p75), ms(r.p90), ms(r.p95), ms(r.p99)])} />
      </Card>
      <Card title="API endpoints">
        <Table head={['Endpoint', 'Requests', 'Errors', 'Error %', 'P50', 'P95', 'P99']} rows={api.map((r: any) => [r.name ?? '—', num(Number(r.n)), num(Number(r.errors)), `${((Number(r.errors) / Number(r.n)) * 100).toFixed(2)}%`, ms(r.p50), ms(r.p95), ms(r.p99)])} />
        {!api.length && <p className="text-zinc-500">No API telemetry reported by the apps in this range.</p>}
      </Card>
      <Card title="Feature health (from telemetry)">
        <Table head={['Module', 'Status', 'Events', 'Errors', 'Crashes', 'Error %']} rows={(data?.features ?? []).map((x: any) => [x.module, <St key="s" s={x.status} />, num(x.events), x.errors, x.crashes, `${x.errorPct.toFixed(2)}%`])} />
        {data?.sampled && <p className="text-amber-400">Sampled: first 50,000 events of the range.</p>}
      </Card>
    </div>
  );
}

// ── Incidents / alerts ──────────────────────────────────────────────────────
function Incidents() {
  const { data, err, reload } = useLoad<any[]>(() => A.listIncidents(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [n, setN] = useState({ title: '', severity: 'CRITICAL' });
  const [move, setMove] = useState<{ id: string; code: string; to: string } | null>(null);
  const act = async (p: Promise<any>) => { const r = await p; setMsg(r.ok ? 'Saved.' : r.error); reload(); };
  if (err) return <Err e={err} />;
  const next: Record<string, string[]> = { DETECTED: ['INVESTIGATING', 'IDENTIFIED', 'MITIGATING', 'RESOLVED'], INVESTIGATING: ['IDENTIFIED', 'MITIGATING', 'RESOLVED'], IDENTIFIED: ['MITIGATING', 'RESOLVED'], MITIGATING: ['RESOLVED'], RESOLVED: ['CLOSED'], CLOSED: [] };
  return (
    <Card title="Incident Center">
      <div className="flex gap-2"><input className="bare-input bg-transparent px-2 py-1 w-72" placeholder="New incident title" onChange={(e) => setN({ ...n, title: e.target.value })} />
        <Sel w="w-32" value={n.severity} onChange={(v) => setN({ ...n, severity: v })} options={opts(['CRITICAL', 'WARNING', 'INFO'])} />
        <button className="filter-tab" onClick={() => act(A.createIncident(n))}>Create</button></div>
      {msg && <p className="text-amber-400">{msg}</p>}
      <ConfirmDialog open={!!move} title={move ? `Move ${move.code} to ${move.to.toLowerCase()}` : ''} body="Add a short note for the incident timeline (what was found or done)." noteLabel="Note (optional)" confirmLabel="Update incident"
        onConfirm={async (note) => { if (move) await act(A.updateIncident(move.id, move.to, note)); }} onClose={() => setMove(null)} />
      <Table head={['Incident', 'Title', 'Severity', 'Status', 'Started', 'Resolved', 'Affected', 'Move to']} rows={(data ?? []).map((i) => [i.code, i.title, i.severity, i.status, fmt(i.started_at), fmt(i.resolved_at),
        i.affected ? Object.entries(i.affected).map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed?.(2) ?? v : v}`).join(' · ') : '—',
        <span key="m" className="flex gap-1 flex-wrap">{(next[i.status] ?? []).map((s) => <button key={s} className="filter-tab" onClick={() => setMove({ id: i.id, code: i.code, to: s })}>{s.toLowerCase()}</button>)}</span>])} />
    </Card>
  );
}

function Alerts() {
  const [status, setStatus] = useState('');
  const { data, err, reload } = useLoad<any[]>(() => A.listAlerts(status || undefined), [status], 30_000);
  if (err) return <Err e={err} />;
  return (
    <Card title="Alert Center">
      <div className="flex gap-1">{['', 'NEW', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => <button key={s} className={`filter-tab ${status === s ? 'filter-tab-active' : ''}`} onClick={() => setStatus(s)}>{s || 'All'}</button>)}</div>
      <Table head={['Level', 'Category', 'Alert', 'Count', 'First', 'Last', 'Status', '']} rows={(data ?? []).map((a) => [a.level, a.category, a.title, a.occurrences, fmt(a.first_at), fmt(a.last_at), a.status,
        a.status !== 'RESOLVED' && <span key="b" className="flex gap-1">{a.status === 'NEW' && <button className="filter-tab" onClick={async () => { await A.setAlertStatus(a.id, 'ACKNOWLEDGED'); reload(); }}>Ack</button>}
          <button className="filter-tab" onClick={async () => { await A.setAlertStatus(a.id, 'RESOLVED'); reload(); }}>Resolve</button></span>])} />
      <p className="text-zinc-500">Alerts with the same rule are grouped (one open alert, occurrence count increases). Rules auto-resolve when the metric recovers.</p>
    </Card>
  );
}

// ── Infrastructure / cost ───────────────────────────────────────────────────
function Infrastructure() {
  const { data: d, err } = useLoad<any>(() => A.getInfrastructure(), []);
  if (err) return <Err e={err} />;
  if (!d) return <p className="text-xs text-zinc-500">Loading…</p>;
  const db = d.database ?? {};
  const g = d.dbGrowth;
  const perMonth = g.length >= 2 ? ((g.at(-1).value - g[0].value) / ((Date.parse(g.at(-1).bucket) - Date.parse(g[0].bucket)) / 86_400_000)) * 30 : null;
  const dbP = d.providers.flatMap((p: any) => p.metrics).find((m: any) => m.metric === 'db_bytes');
  const months = perMonth && perMonth > 0 && dbP?.quota ? (dbP.quota - dbP.value) / perMonth : null;
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {d.providers.map((p: any) => (
          <Card key={p.id} title={<span className="flex justify-between">{p.name} <St s={p.last_status} /></span>}>
            <div className="text-zinc-500">{p.kind} · {p.service ?? '—'} · {p.environment} · synced {ago(p.last_sync)} {p.fresh === 'STALE' && <span className="text-amber-400">⚠ Data may be stale</span>}</div>
            {p.last_error && <div className="text-rose-400">Last sync error: {p.last_error}</div>}
            {p.uptime30d !== null && <div>Uptime (30 d checks): <b>{p.uptime30d.toFixed(2)}%</b></div>}
            <table className="w-full"><tbody>{p.metrics.map((m: any) => (
              <tr key={m.metric}><td className="text-zinc-400">{m.metric}</td>
                <td>{m.text_value ?? (m.unit === 'bytes' ? bytes(m.value) : num(m.value, 2) ?? '—')}{m.quota ? <> / {m.unit === 'bytes' ? bytes(m.quota) : num(m.quota)} ({((m.value / m.quota) * 100).toFixed(1)}%)</> : null}</td>
                <td className="text-[10px] text-zinc-500">{m.source === 'manual' ? 'Manual estimate' : m.source} · {ago(m.fetched_at)}</td></tr>))}</tbody></table>
            {p.links.dashboard && <a className="underline" href={p.links.dashboard} target="_blank" rel="noopener noreferrer">Open provider dashboard ↗</a>}
          </Card>))}
        {!d.providers.length && <Card title="No providers configured">Add Supabase, Vercel, Render, HTTP health checks or manual services under Settings.</Card>}
      </div>
      <Card title="Database (live from Postgres catalog)">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Kpi label="Size" value={bytes(db.db_bytes)} sub={dbP?.quota ? `${((dbP.value / dbP.quota) * 100).toFixed(1)}% of ${bytes(dbP.quota)}` : 'quota: Unavailable (set in provider)'} />
          <Kpi label="Growth" value={perMonth !== null ? `${bytes(perMonth)} / month` : NA} sub={months !== null ? `≈ ${months.toFixed(1)} months to quota` : 'needs ≥ 2 days of history'} />
          <Kpi label="Connections" value={`${num(db.connections) ?? '—'} / ${num(db.max_connections) ?? '—'}`} sub={`${num(db.active_connections) ?? '—'} active`} />
          <Kpi label="Cache hit" value={show(db.cache_hit_pct, '%', 2)} sub={`${num(db.deadlocks) ?? '—'} deadlocks · ${num(db.waiting_locks) ?? '—'} waiting locks`} />
          <Kpi label="Rollbacks" value={num(db.xact_rollback) ?? NA} sub={`of ${num(db.xact_commit) ?? '—'} commits since ${fmt(db.stats_reset)}`} />
          <Kpi label="Long-running queries" value={num(db.long_running_queries) ?? NA} sub="> 30 s active" />
        </div>
        <Table head={['Largest tables', 'Total', 'Indexes']} rows={(db.largest_tables ?? []).map((t: any) => [t.name, bytes(t.total_bytes), bytes(t.index_bytes)])} />
        <h5 className="font-semibold">Slow queries</h5>
        {db.slow_queries ? <Table head={['Query', 'Calls', 'Mean ms', 'Max ms']} rows={db.slow_queries.map((q: any) => [q.query, num(q.calls), q.mean_ms, q.max_ms])} /> : <p className="text-zinc-500">Not available (pg_stat_statements not enabled).</p>}
      </Card>
      <Card title="Storage buckets">
        <Table head={['Bucket', 'Files', 'Size', 'Uploads 24 h', 'Added 30 d']} rows={d.storage.map((b: any) => [b.bucket, num(b.files), bytes(b.bytes), num(b.files_24h), bytes(b.bytes_30d)])} />
        <p className="text-zinc-500">Storage quota: {d.storageUsagePct !== null ? `${d.storageUsagePct}% used` : 'Unavailable — set storageQuotaGb on the Supabase provider.'} Bandwidth: {d.bandwidthUsagePct !== null ? `${d.bandwidthUsagePct}% of quota (manual)` : 'Not available — no official API; add an egress_gb_month manual metric.'}</p>
      </Card>
    </div>
  );
}

function Cost() {
  const { data: d, err, reload } = useLoad<any>(() => A.getCosts(), []);
  const [f, setF] = useState({ provider: '', category: 'Hosting', amount_inr: 0, note: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (err) return <Err e={err} />;
  if (!d) return null;
  const inr = (v: number | null) => (v === null ? 'Billing data unavailable' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
  const day = new Date().getUTCDate(), days = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0).getDate();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Current month (${d.month})`} value={inr(d.total)} sub="month-to-date, manual unless marked api" />
        <Kpi label="Previous month" value={inr(d.previousTotal)} />
        <Kpi label="Change" value={d.total !== null && d.previousTotal ? `${(((d.total - d.previousTotal) / d.previousTotal) * 100).toFixed(1)}%` : NA} />
        <Kpi label="Projected month-end" value={d.total !== null ? inr((d.total / day) * days) : NA} sub="linear projection of month-to-date" />
      </div>
      <Card title="Cost entries">
        <Table head={['Provider', 'Category', 'Amount', 'Source', 'Note', 'Updated']} rows={d.current.map((c: any) => [c.provider, c.category, inr(Number(c.amount_inr)), c.source === 'manual' ? 'Manual estimate' : 'API', c.note ?? '', fmt(c.updated_at)])} />
        <div className="flex flex-wrap gap-2">
          <input className="bare-input bg-transparent px-2 py-1" placeholder="Provider (e.g. Vercel)" onChange={(e) => setF({ ...f, provider: e.target.value })} />
          <Sel w="w-36" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={['Hosting', 'Database', 'Storage', 'Bandwidth', 'SMS', 'Email', 'AI APIs', 'CDN', 'Other'].map((c) => ({ value: c, label: c }))} />
          <input type="number" className="bare-input bg-transparent px-2 py-1 w-28" placeholder="₹" onChange={(e) => setF({ ...f, amount_inr: Number(e.target.value) })} />
          <input className="bare-input bg-transparent px-2 py-1" placeholder="Note" onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="filter-tab filter-tab-active" onClick={async () => { const r = await A.saveCost(f); setMsg(r.ok ? 'Saved.' : r.error); reload(); }}>Save (month-to-date)</button>
        </div>
        {msg && <p className="text-amber-400">{msg}</p>}
        <p className="text-zinc-500">{d.note}</p>
      </Card>
    </div>
  );
}

// ── Deployments ─────────────────────────────────────────────────────────────
function Deployments({ product }: { product: string }) {
  const { data: d, err } = useLoad<any>(() => A.getDeployments(product || null), [product]);
  if (err) return <Err e={err} />;
  if (!d) return null;
  return (
    <div className="space-y-3">
      {d.regressions.filter((r: any) => r.flagged).map((r: any) => (
        <GlassCard key={r.product + r.version}><p className="text-xs text-amber-400">⚠ <b>Potential Regression</b> — {r.product} {r.version} first seen {fmt(r.at)}. Errors/device {r.errorsPerDevice.before.toFixed(2)} → {r.errorsPerDevice.after.toFixed(2)}, crashes/device {r.crashesPerDevice.before.toFixed(3)} → {r.crashesPerDevice.after.toFixed(3)} (24 h before vs after). Correlation, not proven cause.</p></GlassCard>))}
      <div className="grid md:grid-cols-2 gap-3">
        {d.versions.map((v: any) => (
          <Card key={v.product} title={v.name}>
            {v.rows.map((r: any) => <div key={r.version} className="flex items-center gap-2"><span className="w-20">{r.version}</span><div className="flex-1 h-2 bg-white/5 rounded"><div className="h-2 rounded bg-sky-500" style={{ width: `${r.pct}%` }} /></div><span className="w-24 text-right">{r.pct}% · {r.devices}</span></div>)}
            <div className="text-zinc-400">Devices on old version: <b>{v.outdated}</b> · Schools: <b>{v.outdatedSchools}</b> · Latest: {v.latest ?? '—'}</div>
          </Card>))}
      </div>
      <Card title="Update health (7 days)">
        {d.updates ? <div className="flex gap-4 flex-wrap"><span>Available {d.updates.available}</span><span>Downloaded {d.updates.downloaded}</span><span>Installed {d.updates.installed}</span><span>Failed {d.updates.failed}</span><span>Skipped {d.updates.skipped}</span><b>Success rate {d.updates.successRate === null ? '—' : `${d.updates.successRate.toFixed(1)}%`}</b></div>
          : <p className="text-zinc-500">No update telemetry reported yet (apps emit UPDATE_* events).</p>}
      </Card>
      <Card title="Releases & deployments">
        <Table head={['Product', 'Version', 'Commit', 'Environment', 'Status', 'Source', 'When', 'Duration']} rows={d.releases.map((r: any) => [r.product_id, r.version, r.build_commit?.slice(0, 10) ?? '—', r.environment, r.status ?? '—', r.source === 'field' ? 'first seen in field' : r.source, fmt(r.first_seen), r.duration_s ? `${r.duration_s}s` : '—'])} />
      </Card>
    </div>
  );
}

// ── Settings: providers, rules, thresholds ──────────────────────────────────
const FIELDS: Record<string, string[]> = { supabase: ['projectRef', 'dbQuotaGb', 'storageQuotaGb', 'dashboardUrl'], vercel: ['projectId', 'teamId', 'productId', 'dashboardUrl'], render: ['serviceId', 'productId', 'dashboardUrl'], http: ['url', 'slowMs', 'dashboardUrl'], manual: ['dashboardUrl'] };
function Settings() {
  const prov = useLoad<any[]>(() => A.listProviders(), []);
  const rules = useLoad<any>(() => A.listRules(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const [p, setP] = useState<any>({ kind: 'supabase', name: '', service: '', environment: 'production', config: {}, credential: '', manual: '' });
  const [r, setR] = useState<any>({ name: '', metric: 'crash_rate_pct', op: '>', threshold: 2, for_minutes: 5, level: 'CRITICAL', create_incident: true, enabled: true });
  const done = (res: any, reload: () => void) => { setMsg(res.ok ? 'Saved.' : res.error); reload(); };
  const saveP = async () => {
    let manual: any[] = [];
    if (p.manual.trim()) { try { manual = JSON.parse(p.manual); } catch { setMsg('Manual metrics must be JSON, e.g. [{"metric":"egress_gb_month","value":120,"quota":250,"unit":"GB"}]'); return; } }
    const config = { ...p.config, ...(manual.length ? { manual } : {}) };
    for (const k of ['dbQuotaGb', 'storageQuotaGb', 'slowMs']) if (config[k] !== undefined) config[k] = Number(config[k]);
    done(await A.saveProvider({ ...p, config, credential: p.credential || undefined }), prov.reload);
  };
  return (
    <div className="space-y-3">
      {msg && <p className="text-xs text-amber-400">{msg}</p>}
      <ConfirmDialog open={!!remove} danger title={`Remove provider ${remove?.name ?? ''}?`} body="Its stored credential and cached metrics are deleted. Monitoring for this service stops." confirmLabel="Remove"
        onConfirm={async () => { if (remove) done(await A.deleteProvider(remove.id), prov.reload); }} onClose={() => setRemove(null)} />
      <Card title="Infrastructure providers">
        {prov.err ? <p className="text-rose-400">{prov.err}</p> : <Table head={['Name', 'Type', 'Service', 'Env', 'Credential', 'Status', 'Last sync', '']} rows={(prov.data ?? []).map((x) => [x.name, x.kind, x.service ?? '—', x.environment, x.hasCredential ? '•••••• (saved)' : 'none', <St key="s" s={x.last_status} />, ago(x.last_sync),
          <button key="d" className="filter-tab text-rose-400" onClick={() => setRemove({ id: x.id, name: x.name })}>Remove</button>])} />}
        <div className="flex flex-wrap gap-2 items-center">
          <Sel w="w-36" value={p.kind} onChange={(v) => setP({ ...p, kind: v, config: {} })} options={[{ value: 'supabase', label: 'Supabase' }, { value: 'vercel', label: 'Vercel' }, { value: 'render', label: 'Render' }, { value: 'http', label: 'HTTP health check' }, { value: 'manual', label: 'Manual / other' }]} />
          <input className="bare-input bg-transparent px-2 py-1" placeholder="Name" onChange={(e) => setP({ ...p, name: e.target.value })} />
          <input className="bare-input bg-transparent px-2 py-1" placeholder="Service (e.g. Database)" onChange={(e) => setP({ ...p, service: e.target.value })} />
          {FIELDS[p.kind].map((k) => <input key={k} className="bare-input bg-transparent px-2 py-1 w-40" placeholder={k} onChange={(e) => setP({ ...p, config: { ...p.config, [k]: e.target.value } })} />)}
          {['supabase', 'vercel', 'render'].includes(p.kind) && <input type="password" autoComplete="off" className="bare-input bg-transparent px-2 py-1 w-56" placeholder="API token (stored encrypted, write-only)" onChange={(e) => setP({ ...p, credential: e.target.value })} />}
          <input className="bare-input bg-transparent px-2 py-1 w-96" placeholder='Manual metrics JSON (optional) [{"metric":"egress_gb_month","value":120,"quota":250,"unit":"GB"}]' onChange={(e) => setP({ ...p, manual: e.target.value })} />
          <button className="filter-tab filter-tab-active" onClick={saveP}>Add provider</button>
          <button className="filter-tab" onClick={async () => done(await A.syncNow(), prov.reload)}><RefreshCw className="w-3.5 h-3.5" /> Sync now</button>
        </div>
        <p className="text-zinc-500">Use least-privilege tokens (read-only where the provider supports it). Tokens are encrypted (AES-256-GCM), used only by the backend sync job, and never shown again.</p>
      </Card>
      <Card title="Alert rules">
        <Table head={['Rule', 'Condition', 'For', 'Level', 'Incident', 'Enabled', '']} rows={(rules.data?.rules ?? []).map((x: any) => [x.name, `${x.metric} ${x.op} ${x.threshold}`, `${x.for_minutes} min`, x.level, x.create_incident ? 'yes' : 'no', x.enabled ? 'yes' : 'no',
          <span key="b" className="flex gap-1"><button className="filter-tab" onClick={async () => done(await A.saveRule({ ...x, enabled: !x.enabled }), rules.reload)}>{x.enabled ? 'Disable' : 'Enable'}</button>
            <button className="filter-tab text-rose-400" onClick={async () => done(await A.deleteRule(x.id), rules.reload)}>Delete</button></span>])} />
        <div className="flex flex-wrap gap-2 items-center">IF
          <Sel w="w-72" value={r.metric} onChange={(v) => setR({ ...r, metric: v })} options={Object.entries(rules.data?.metrics ?? {}).map(([value, label]) => ({ value, label: String(label) }))} />
          <Sel w="w-20" value={r.op} onChange={(v) => setR({ ...r, op: v })} options={['>', '>=', '<', '<='].map((o) => ({ value: o, label: o }))} />
          <input type="number" className="bare-input bg-transparent px-2 py-1 w-20" value={r.threshold} onChange={(e) => setR({ ...r, threshold: Number(e.target.value) })} /> FOR
          <input type="number" className="bare-input bg-transparent px-2 py-1 w-16" value={r.for_minutes} onChange={(e) => setR({ ...r, for_minutes: Number(e.target.value) })} /> min THEN
          <Sel w="w-32" value={r.level} onChange={(v) => setR({ ...r, level: v })} options={opts(['INFO', 'WARNING', 'CRITICAL'])} />
          <label><input type="checkbox" checked={r.create_incident} onChange={(e) => setR({ ...r, create_incident: e.target.checked })} /> create incident</label>
          <input className="bare-input bg-transparent px-2 py-1" placeholder="Rule name" onChange={(e) => setR({ ...r, name: e.target.value })} />
          <button className="filter-tab filter-tab-active" onClick={async () => done(await A.saveRule(r), rules.reload)}>Add rule</button>
        </div>
        <p className="text-zinc-500">Notifications: Siddesh Panel Alert Center + the webhook in LMS_ALERT_WEBHOOK_URL (Slack/Discord/WhatsApp gateway) for WARNING/CRITICAL.</p>
      </Card>
      <OpsConfigCard onMsg={setMsg} />
    </div>
  );
}

function OpsConfigCard({ onMsg }: { onMsg: (m: string) => void }) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const { data } = useLoad<any>(() => A.getOverview('15m', null), []);
  if (!data) return null;
  const c = { ...data.config, ...edits };
  const setC = (x: Record<string, number>) => setEdits(x);
  const L: [string, string][] = [['onlineMinutes', 'Online if heartbeat within (min)'], ['staleMinutes', 'Stale until (min), then offline'], ['apiP95ThresholdMs', 'API P95 threshold (ms)'], ['rawDays', 'Device metrics retention (days)'], ['hourlyDays', 'Hourly aggregates (days)'], ['dailyDays', 'Daily summaries (days)'], ['resolvedAlertDays', 'Resolved alerts (days)'], ['closedIncidentDays', 'Closed incidents (days)']];
  return (
    <Card title="Monitoring configuration">
      <div className="grid md:grid-cols-2 gap-2">{L.map(([k, l]) => <label key={k} className="flex justify-between gap-2"><span className="text-zinc-400">{l}</span><input type="number" className="bare-input bg-transparent px-2 py-1 w-24" value={c[k]} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} /></label>)}</div>
      <button className="filter-tab filter-tab-active" onClick={async () => { const r = await A.saveOpsSettings(c); onMsg(r.ok ? 'Configuration saved.' : r.error); }}>Save configuration</button>
    </Card>
  );
}
