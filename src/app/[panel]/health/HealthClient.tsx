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
  ['overview', 'Overview'], ['active', 'Active devices'], ['devices', 'Devices'], ['security', 'Security'], ['performance', 'Performance'], ['incidents', 'Alerts & Incidents'],
  ['infrastructure', 'Infrastructure'], ['cost', 'Consumption & Cost'], ['deployments', 'Deployments'], ['settings', 'Settings'],
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
  // One refresh control for the whole page (right end of the tab row).
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="h-10" />
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><HeartPulse className="w-6 h-6" /> Operations Center</h2>
        <div className="flex flex-wrap gap-2 text-xs w-full sm:w-auto">
          <Sel w="w-full sm:w-72" value={product} onChange={setProduct} options={[{ value: '', label: 'All Products' }, ...products]} />
          {(tab === 'performance' || tab === 'security') && <Sel w="w-44" value={range} onChange={setRange} options={[['15m', 'Last 15 minutes'], ['1h', 'Last 1 hour'], ['6h', 'Last 6 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([value, label]) => ({ value, label }))} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center border-b border-sidebar-border">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`filter-tab ${tab === k ? 'filter-tab-active' : ''}`}>{l}</button>)}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500 py-1 pl-2">
          {tab === 'overview' && updatedAt && <span>Updated {ago(updatedAt)} · auto 30 s</span>}
          <button type="button" className="icon-btn" title="Refresh" onClick={() => setRefresh((n) => n + 1)}><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {tab !== 'overview' && <p className="text-xs text-zinc-500 flex items-center gap-1"><InfoTip text={HEALTH_TAB_HELP[tab]} /> {HEALTH_TAB_HELP[tab]}</p>}
      {tab === 'overview' && <Overview product={product} onProduct={setProduct} refresh={refresh} onUpdated={setUpdatedAt} />}
      <div key={refresh} className="space-y-4">
      {tab === 'active' && <ActiveDevices />}
      {tab === 'devices' && <Devices product={product} />}
      {tab === 'security' && <Security range={range} product={product} />}
      {tab === 'performance' && <Performance range={range} product={product} />}
      {tab === 'incidents' && <div className="space-y-3"><Alerts /><Incidents /></div>}
      {tab === 'infrastructure' && <Infrastructure />}
      {tab === 'cost' && <Cost />}
      {tab === 'deployments' && <Deployments product={product} />}
      {tab === 'settings' && <Settings />}
      </div>
    </div>
  );
}


/** Panel-styled dropdown (CustomSelect) — replaces native <select> so menus match the panel theme. */
function Sel({ value, onChange, options, w = 'w-40' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; w?: string }) {
  return <CustomSelect size="sm" className={w} value={value} onChange={onChange} options={options} />;
}
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, ' ').toLowerCase().replace(/^w/, (c) => c.toUpperCase()) }));

// ── Overview ────────────────────────────────────────────────────────────────
// Products | Overall Health | Activity. Picking a product (or one of its platforms) filters the
// health score and the activity chart; "All products" shows the whole panel.
const ACTIVITY_WINDOWS = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d'], ['90d', '90 d'], ['1y', '1 y'], ['3y', '3 y']] as const;
const OS_LABEL: Record<string, string> = { ANDROID: 'Android', WINDOWS: 'Windows', LINUX: 'Linux' };
const STATUS_BAR: Record<string, string> = { HEALTHY: 'bg-emerald-500', WARNING: 'bg-amber-500', DEGRADED: 'bg-amber-500', CRITICAL: 'bg-rose-500' };
const SERIES = [['devices', 'Devices', '#38bdf8'], ['errors', 'Errors', '#fb7185'], ['crashes', 'Crashes', '#e11d48']] as const;
const pctOf = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
const Panel = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <GlassCard className="h-full"><div className="text-xs flex flex-col gap-3 h-full">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-foreground text-sm flex items-center gap-1">{title}{HELP[title] && <InfoTip text={HELP[title]} />}</h4>{right}</div>
    {children}
  </div></GlassCard>
);

function Overview({ product, onProduct, refresh, onUpdated }: { product: string; onProduct: (p: string) => void; refresh: number; onUpdated: (at: string) => void }) {
  const { data: d, err } = useLoad<any>(() => A.getOverview(product || null), [product, refresh], 30_000);
  useEffect(() => { if (d?.generatedAt) onUpdated(d.generatedAt); }, [d?.generatedAt, onUpdated]);
  if (err) return <Err e={err} />;
  if (!d) return <p className="text-xs text-zinc-500">Loading…</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-stretch">
      <div className="md:col-span-2 xl:col-span-5 min-w-0"><Products list={d.products} product={product} onProduct={onProduct} /></div>
      <div className="xl:col-span-3 min-w-0"><OverallHealth d={d} /></div>
      <div className="xl:col-span-4 min-w-0"><Activity product={product} refresh={refresh} /></div>
    </div>
  );
}

function Products({ list, product, onProduct }: { list: any[]; product: string; onProduct: (p: string) => void }) {
  // Products of the other admin (LMS School on Lab-Admin) can be inspected but not used as a filter.
  const [picked, setPicked] = useState<string | null>(null);
  const all = list.find((p) => !p.id);
  const active = picked ?? product;
  const selected = list.find((p) => p.id && p.id === active) ?? all;
  const groupsOf = (xs: any[]) => [...new Map(xs.map((p) => [p.group, xs.filter((x) => x.group === p.group)])).entries()];
  const own = groupsOf(list.filter((p) => p.id && !p.external));
  const external = groupsOf(list.filter((p) => p.id && p.external));
  const choose = (p: any) => { if (p.external) setPicked(p.id); else { setPicked(null); onProduct(p.id); } };
  const rows: [string, React.ReactNode][] = selected ? [
    ['Status', <St key="s" s={selected.status} />], ['Version', selected.version ?? '—'], ['Schools', num(selected.schools) ?? '0'],
    ['Devices', `${num(selected.online)} online / ${num(selected.devices)}`], ['Active users', selected.activeUsers ?? '—'],
    ['Errors (24 h)', `${num(selected.errors24h)} · ${pctOf(selected.errorRate)}`], ['Crashes (24 h)', `${num(selected.crashes24h)} · ${pctOf(selected.crashRate)}`],
    ['Last deployment', selected.lastDeployment ? fmt(selected.lastDeployment) : '—'],
  ] : [];
  const chip = (p: any) => (
    <button key={p.id} type="button" onClick={() => choose(p)} title={p.name}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] ${p.id === active ? 'border-violet-500 bg-violet-500/10 text-foreground' : 'border-sidebar-border text-zinc-400 hover:text-foreground'}`}>
      {DOT[p.status] ?? '⚪'} {OS_LABEL[p.os] ?? p.os}
    </button>
  );
  const group = ([name, items]: [string, any[]]) => (
    <div key={name} className="px-2 py-1.5 rounded-lg border border-sidebar-border space-y-1">
      <div className="font-medium text-foreground leading-tight break-words">{name}</div>
      <div className="flex flex-wrap gap-1">{items.map(chip)}</div>
    </div>
  );
  return (
    <Panel title="Products">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-0">
        <div className="space-y-1 max-h-60 sm:max-h-80 overflow-y-auto pr-1 min-w-0">
          <button type="button" onClick={() => { setPicked(null); onProduct(''); }}
            className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-1.5 ${!active ? 'bg-violet-500/10 text-foreground font-semibold' : 'text-zinc-400 hover:bg-white/5'}`}>
            {DOT[all?.status] ?? '⚪'} All products
          </button>
          {own.map(group)}
          {external.length > 0 && <>
            <div className="pt-1 text-[10px] uppercase tracking-wide text-zinc-500">From LMS Admin</div>
            {external.map(group)}
          </>}
        </div>
        <div className="rounded-lg bg-white/5 p-2.5 self-start w-full min-w-0">
          <div className="font-semibold text-foreground mb-1.5 leading-tight break-words">{selected?.name ?? '—'}</div>
          {selected?.external && <div className="text-[11px] text-zinc-500 mb-1.5">From LMS Admin — for reference; the health score and activity here cover this admin’s products.</div>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-zinc-500 whitespace-nowrap">{k}</dt><dd className="text-right text-foreground break-words">{v}</dd></React.Fragment>)}
          </dl>
        </div>
      </div>
    </Panel>
  );
}

function OverallHealth({ d }: { d: any }) {
  const s = d.score;
  const delta = s.score !== null && d.previousScore !== null ? s.score - d.previousScore : null;
  const name = d.products.find((p: any) => p.id === (d.product ?? ''))?.name;
  return (
    <Panel title="Overall Health" right={d.product ? <span className="text-zinc-500 truncate max-w-[50%]" title={name}>{name}</span> : null}>
      <div className="flex items-end gap-2"><span className="text-4xl font-bold text-foreground leading-none">{s.score === null ? '—' : s.score}</span><span className="text-zinc-500 mb-0.5">/ 100</span></div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${STATUS_BAR[s.status] ?? 'bg-zinc-500'}`} style={{ width: `${s.score ?? 0}%` }} /></div>
      <div className="flex flex-wrap items-center justify-between gap-1"><St s={s.status} />{delta !== null && <span className={delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} vs previous hour</span>}</div>
      {s.score === null ? <p className="text-zinc-500">No telemetry yet — the score appears once devices report.</p> : (
        <div className="space-y-1">
          <div className="text-zinc-500">{s.penalties.length ? 'Points lost' : 'No deductions'}</div>
          {s.penalties.map((p: any) => <div key={p.reason} className="flex justify-between gap-2 rounded-md bg-rose-500/5 px-2 py-1"><span className="text-zinc-400 min-w-0 break-words">{p.reason}</span><span className="text-rose-500 font-semibold">−{p.points}</span></div>)}
        </div>)}
      <details className="text-zinc-500 mt-auto"><summary className="cursor-pointer">How is this calculated?</summary>100 minus capped penalties: crash rate (10/1%, max 30), error rate (2/1%, max 20), API errors (max 10), API P95 over threshold (5), open incidents (max 30), open alerts (max 10), providers down/degraded (max 20), DB/storage over 80/90% of quota. Missing data is never penalised; no data at all = Unknown.</details>
    </Panel>
  );
}

function Activity({ product, refresh }: { product: string; refresh: number }) {
  const [win, setWin] = useState<string>('24h');
  const { data, err } = useLoad<any>(() => A.getActivity(win, product || null), [win, product, refresh], 60_000);
  const daily = data?.granularity === 'day';
  const label = (t: string) => daily
    ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: win === '1y' || win === '3y' ? '2-digit' : undefined, timeZone: 'UTC' })
    : new Date(t).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });
  const pts = data?.points ?? [];
  const sum = (k: string) => pts.reduce((t: number, x: any) => t + (x[k] ?? 0), 0);
  const peak = pts.reduce((m: number, x: any) => Math.max(m, x.devices ?? 0), 0);
  return (
    <Panel title="Activity" right={<div className="flex rounded-lg border border-sidebar-border overflow-hidden">{ACTIVITY_WINDOWS.map(([k, l]) => (
      <button key={k} type="button" onClick={() => setWin(k)} className={`px-1.5 py-0.5 text-[11px] ${win === k ? 'bg-violet-500 text-white' : 'text-zinc-500 hover:text-foreground'}`}>{l}</button>))}</div>}>
      <div className="grid grid-cols-3 gap-2">
        {[['Peak devices', peak], ['Errors', sum('errors')], ['Crashes', sum('crashes')]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg bg-white/5 px-2 py-1.5"><div className="text-zinc-500 text-[11px]">{k}</div><div className="text-base font-bold text-foreground">{num(v as number)}</div></div>))}
      </div>
      {err ? <p className="text-rose-400">{err}</p> : !data ? <p className="text-zinc-500">Loading…</p> : pts.some((x: any) => x.events || x.devices) ? (
        <div className="h-44"><ResponsiveContainer><AreaChart data={pts.map((x: any) => ({ ...x, t: label(x.t) }))} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeOpacity={0.1} vertical={false} /><XAxis dataKey="t" fontSize={10} minTickGap={20} tickLine={false} /><YAxis fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip />
          {SERIES.map(([k, n, c]) => <Area key={k} dataKey={k} name={n} stroke={c} fill={c} fillOpacity={k === 'devices' ? 0.12 : 0.25} />)}
        </AreaChart></ResponsiveContainer></div>) : <p className="text-zinc-500 py-10 text-center">No activity in this period.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-500 mt-auto">
        <span className="flex flex-wrap gap-3">{SERIES.map(([k, n, c]) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{n}</span>)}</span>
        {daily && data?.recordedSince && <span>since {fmt(data.recordedSince).split(',')[0]}</span>}
      </div>
    </Panel>
  );
}

// ── Active devices + key search ────────────────────────────────────────────
// Active = licence Active, bound to a device, not expired. Lab-Admin lists LMS School + Lab.
type DevRef = { panel: string; keyId: string };
function ActiveDevices() {
  const [f, setF] = useState<{ q?: string; panel?: string; page: number }>({ page: 0 });
  const [key, setKey] = useState('');
  const [found, setFound] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<DevRef | null>(null);
  const { data, err } = useLoad<any>(() => A.getActiveDevices(f), [f], 60_000);
  const search = async () => {
    setMsg(null); setFound(null);
    const r = await A.lookupKey(key);
    if (r.ok) { setFound(r.data); setOpen({ panel: r.data.panel, keyId: r.data.keyId }); } else setMsg(r.error ?? 'Not found.');
  };
  if (open) return <DeviceLogs dev={open} info={found} onBack={() => { setOpen(null); setFound(null); }} />;
  return (
    <div className="space-y-3">
      <Card title="Search by activation key">
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="bare-input bg-transparent px-2 py-1 flex-1 min-w-[220px] font-mono" placeholder="Enter the full activation key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="submit" className="filter-tab filter-tab-active" disabled={!key.trim()}>Show logs</button>
        </form>
        {msg && <p className="text-rose-400">{msg}</p>}
        <p className="text-zinc-500">Opens everything that device reported: screens, actions, typed searches, security signals, errors and crashes. Lookups are audited.</p>
      </Card>
      {err ? <Err e={err} /> : (
        <Card title={`Active devices (${data?.total ?? '…'})`}>
          <div className="flex gap-2 flex-wrap">
            {(data?.panels?.length ?? 0) > 1 && <Sel value={f.panel ?? ''} onChange={(v) => setF({ ...f, panel: v || undefined, page: 0 })} options={[{ value: '', label: 'LMS School + Lab' }, { value: 'lms', label: 'LMS School' }, { value: 'lab', label: 'Lab' }]} />}
            <input className="bare-input bg-transparent px-2 py-1 w-56" placeholder="School, model, product…" onChange={(e) => setF({ ...f, q: e.target.value || undefined, page: 0 })} />
          </div>
          <Table head={['Panel', 'Product', 'School / owner', 'Device', 'Key', 'Version', 'Status', 'Last seen', 'Expires', 'Errors 24h', '']} rows={(data?.rows ?? []).map((r: any) => [
            r.panelLabel, r.product ?? '—', r.owner ?? '—', <span key="d" title={r.fp ?? ''}>{r.model ?? `${(r.fp ?? '').slice(0, 12)}…`}</span>, <span key="k" className="font-mono">{r.key}</span>,
            r.version ?? '—', <St key="s" s={r.state} />, ago(r.lastSeen), fmt(r.expiresAt), r.errors24h,
            <button key="l" className="filter-tab" onClick={() => setOpen({ panel: r.panel, keyId: r.keyId })}>Logs</button>])} />
          <div className="flex gap-2 justify-end">
            <button className="filter-tab" disabled={!f.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Prev</button>
            <button className="filter-tab" disabled={!data || (f.page + 1) * 50 >= data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
          </div>
        </Card>
      )}
    </div>
  );
}

const CATS = ['', 'NAVIGATION', 'USER_ACTION', 'SECURITY', 'AUTHENTICATION', 'APPLICATION', 'ERROR', 'CRASH', 'PERFORMANCE', 'API', 'FILE', 'UPDATE'];
function DeviceLogs({ dev, info, onBack }: { dev: DevRef; info: any; onBack: () => void }) {
  const [f, setF] = useState<{ category?: string; q?: string; page: number }>({ page: 0 });
  const { data, err } = useLoad<any>(() => A.getDeviceLogs({ ...dev, ...f }), [dev, f], 60_000);
  const detail = (r: any) => {
    const x = r.data?.extra;
    const extra = x && typeof x === 'object' ? Object.entries(x).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '';
    return [r.message, extra].filter(Boolean).join(' — ') || '—';
  };
  // Uploaded > 10 min after it happened ⇒ the device was offline and sent its stored backlog.
  const late = (r: any) => r.received_at && Date.parse(r.received_at) - Date.parse(r.ts) > 600_000;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button className="filter-tab" onClick={onBack}>← Back</button>
        {info && <span className="text-xs text-zinc-400">{info.panelLabel} · {info.product ?? '—'} · {info.owner ?? '—'} · {info.model ?? '—'} · key {info.key} · {info.status}{info.expired ? ' (expired)' : ''} · expires {fmt(info.expiresAt)}</span>}</div>
      {err ? <Err e={err} /> : (
        <>
          <Card title={`Device logs (${data?.total ?? '…'})`}>
            <div className="flex gap-1 flex-wrap">{CATS.map((c) => (
              <button key={c} className={`filter-tab ${(f.category ?? '') === c ? 'filter-tab-active' : ''}`} onClick={() => setF({ ...f, category: c || undefined, page: 0 })}>
                {c ? `${c.replace(/_/g, ' ').toLowerCase()}${data?.byCategory?.[c] ? ` (${data.byCategory[c]})` : ''}` : 'All'}</button>))}
              <input className="bare-input bg-transparent px-2 py-1 w-48" placeholder="Search…" onChange={(e) => setF({ ...f, q: e.target.value || undefined, page: 0 })} />
            </div>
            <Table head={['Time', 'Level', 'Type', 'Screen', 'Action', 'Detail']} rows={(data?.rows ?? []).map((r: any) => [
              <span key="t" title={`Received ${fmt(r.received_at)}`}>{fmt(r.ts)}{late(r) && <span className="text-amber-400"> · offline</span>}</span>,
              r.severity.toLowerCase(), r.event_type, r.feature ?? '—', r.action ?? '—', <span key="d" className="break-all">{detail(r)}</span>])} />
            <div className="flex gap-2 justify-end">
              <button className="filter-tab" disabled={!f.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Prev</button>
              <button className="filter-tab" disabled={!data || (f.page + 1) * 100 >= data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
            </div>
            <p className="text-zinc-500">“offline” = the action happened while the device had no internet; it was stored on the device with its real time and uploaded later.</p>
          </Card>
          <Card title="Crashes">
            <Table head={['Code', 'Time', 'Type', 'Screen', 'What happened', 'Version']} rows={(data?.crashes ?? []).map((c: any) => [c.code ?? '—', fmt(c.ts), c.event_type, c.current_screen ?? '—', c.actual_behavior ?? '—', c.product_version ?? '—'])} />
          </Card>
        </>
      )}
    </div>
  );
}

// ── Devices ───────────────────────────────────────────────────────
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

// ── Security / suspicious devices ───────────────────────────────────────────
const SEC_LABEL: Record<string, string> = {
  ROOT_DETECTED: 'Root', EMULATOR_DETECTED: 'Emulator', DEBUGGER_DETECTED: 'Debugger', INSTRUMENTATION_DETECTED: 'Frida/Xposed',
  APK_SIGNATURE_MISMATCH: 'Re-signed APK', INTEGRITY_CHECK_ERROR: 'Check error', SCREEN_CAPTURE_DETECTED: 'Screen capture',
  LICENSE_TAMPERED: 'Licence tamper', CLOCK_ROLLBACK: 'Clock rollback', CONTENT_TAMPERED: 'Modified video', DECRYPTION_FAILED: 'Decrypt failed',
  ADB_ENABLED: 'USB/ADB debugging', DEVELOPER_MODE_ENABLED: 'Developer mode', AUTOMATION_DETECTED: 'Automation', SUSPICIOUS_APP_INSTALLED: 'Tool installed', SUSPICIOUS_PROCESS: 'Tool running',
};
function Security({ range, product }: { range: string; product: string }) {
  const { data, err } = useLoad<any>(() => A.getSecurity(range, product || undefined), [range, product], 60_000);
  if (err) return <Err e={err} />;
  const sev = (s: string) => <span className={s === 'CRITICAL' || s === 'FATAL' ? 'text-rose-400' : s === 'WARNING' ? 'text-amber-400' : ''}>{s.toLowerCase()}</span>;
  return (
    <div className="space-y-3">
      <Card title={`Suspicious devices (${data?.devices.length ?? '…'})`}>
        <Table head={['Device', 'School', 'Product', 'Version', 'Worst', 'Signals (count)', 'First', 'Last']} rows={(data?.devices ?? []).map((d: any) => [
          <span key="c" title={d.fp ?? ''}>{d.computer ?? `${(d.fp ?? '').slice(0, 12)}…`}</span>, d.school ?? '—', d.product ?? '—', d.version ?? '—', sev(d.worst),
          <span key="s" className="flex gap-1 flex-wrap">{Object.entries(d.signals as Record<string, number>).map(([t, n]) => <span key={t} className="rounded border border-sidebar-border px-1.5">{SEC_LABEL[t] ?? t} ×{n}</span>)}</span>,
          fmt(d.firstSeen), ago(d.lastSeen)])} />
      </Card>
      <Card title="Recent security events">
        <Table head={['Time', 'Device', 'School', 'Signal', 'Detail', 'Count', 'Level']} rows={(data?.recent ?? []).map((r: any) => [
          fmt(r.ts), r.computer ?? '—', r.school ?? '—', SEC_LABEL[r.type] ?? r.type, <span key="m" title={r.message ?? ''}>{r.signal ?? '—'}</span>, r.occurrences, sev(r.severity)])} />
        <p className="text-zinc-500">Each signal is sent once per app session; repeats only raise its count. Copying encrypted files to a PC or filming the screen with another camera cannot be detected by the app.</p>
      </Card>
    </div>
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
// Derived from the same catalog query as the Database / Storage cards — shown there, not twice.
const SHOWN_BELOW = new Set(['db_bytes', 'storage_bytes']);
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
            <table className="w-full"><tbody>{p.metrics.filter((m: any) => !SHOWN_BELOW.has(m.metric)).map((m: any) => (
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
        {prov.err ? <p className="text-rose-400">{prov.err}</p> : <Table head={['Name', 'Type', 'Service', 'Env', 'Credential', '']} rows={(prov.data ?? []).map((x) => [x.name, x.kind, x.service ?? '—', x.environment, x.hasCredential ? '•••••• (saved)' : 'none',
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
        <p className="text-zinc-500">Live status and last sync of each provider: Infrastructure tab. Use least-privilege tokens (read-only where the provider supports it). Tokens are encrypted (AES-256-GCM), used only by the backend sync job, and never shown again.</p>
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
  const { data } = useLoad<any>(() => A.getOpsConfig(), []);
  if (!data) return null;
  const c = { ...data, ...edits };
  const setC = (x: Record<string, number>) => setEdits(x);
  const L: [string, string][] = [['onlineMinutes', 'Online if heartbeat within (min)'], ['staleMinutes', 'Stale until (min), then offline'], ['apiP95ThresholdMs', 'API P95 threshold (ms)'], ['rawDays', 'Device metrics retention (days)'], ['hourlyDays', 'Hourly aggregates (days)'], ['dailyDays', 'Activity history (days, min 1095 = 3 y)'], ['resolvedAlertDays', 'Resolved alerts (days)'], ['closedIncidentDays', 'Closed incidents (days)']];
  return (
    <Card title="Monitoring configuration">
      <div className="grid md:grid-cols-2 gap-2">{L.map(([k, l]) => <label key={k} className="flex justify-between gap-2"><span className="text-zinc-400">{l}</span><input type="number" className="bare-input bg-transparent px-2 py-1 w-24" value={c[k]} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} /></label>)}</div>
      <button className="filter-tab filter-tab-active" onClick={async () => { const r = await A.saveOpsSettings(c); onMsg(r.ok ? 'Configuration saved.' : r.error); }}>Save configuration</button>
    </Card>
  );
}
