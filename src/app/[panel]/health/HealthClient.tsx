'use client';

// Operations Center UI. Every number shows where it came from; anything without data reads
// "Not available" — never a placeholder value. Polls one summary action every 30 s (no
// per-browser provider calls; providers are synced by the backend cron).
import React, { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HeartPulse, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import InfoTip from '@/components/InfoTip';
import FormModal from '@/components/FormModal';
import { HEALTH_TAB_HELP, HELP } from '@/lib/diagnostics/help';
import * as A from './actions';

/* eslint-disable @typescript-eslint/no-explicit-any -- action payloads */

const TABS = [
  ['overview', 'Overview'], ['active', 'Active devices'], ['infrastructure', 'Infrastructure'],
] as const;
type Tab = (typeof TABS)[number][0];
const IST = 'Asia/Kolkata';
const NA = <span className="text-zinc-500">Not available</span>;
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—');
const ago = (s?: string | null) => { if (!s) return 'never'; const m = Math.round((Date.now() - Date.parse(s)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const num = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: d }) : null);
const bytes = (v: any) => { const n = Number(v); if (!Number.isFinite(n)) return NA; const K = 1024, M = K * K, G = M * K; return n >= G ? `${(n / G).toFixed(2)} GB` : n >= M ? `${(n / M).toFixed(1)} MB` : `${(n / K).toFixed(0)} KB`; };
const DOT: Record<string, string> = { HEALTHY: '🟢', WARNING: '🟡', DEGRADED: '🟡', CRITICAL: '🔴', DOWN: '🔴', OFFLINE: '🔴', ONLINE: '🟢', STALE: '🟡', UNKNOWN: '⚪' };
const St = ({ s }: { s?: string | null }) => <span className="whitespace-nowrap">{DOT[s ?? 'UNKNOWN'] ?? '⚪'} {(s ?? 'UNKNOWN').toLowerCase()}</span>;
const Card = ({ title, children, className = '', right }: { title: React.ReactNode; children: React.ReactNode; className?: string; right?: React.ReactNode }) => (
  <GlassCard className={className}><div className="text-xs space-y-2"><div className="flex items-center justify-between gap-2 flex-wrap"><h4 className="font-semibold text-foreground text-sm flex items-center gap-1">{title}{typeof title === 'string' && HELP[title] && <InfoTip text={HELP[title]} />}</h4>{right}</div>{children}</div></GlassCard>
);
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
const Table = ({ head, rows, onRow, rowClass }: { head: string[]; rows: React.ReactNode[][]; onRow?: (i: number) => void; rowClass?: (i: number) => string }) => (
  <div className="overflow-x-auto"><table className="data-table text-xs w-full"><thead><tr>{head.map((h, k) => <th key={`${h}${k}`}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={i} onClick={onRow && (() => onRow(i))} className={`${onRow ? 'cursor-pointer hover:bg-white/5' : ''} ${rowClass?.(i) ?? ''}`}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="text-center text-zinc-500 py-4">No data</td></tr>}</tbody></table></div>
);

export default function HealthClient({ products }: { products: { value: string; label: string; group?: string }[] }) {
  // The open tab lives in the URL (?tab=…) so a refresh keeps it.
  const params = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() => TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'overview');
  const setTab = (t: Tab) => {
    setTabState(t);
    const u = new URL(window.location.href);
    if (t === 'overview') u.searchParams.delete('tab'); else u.searchParams.set('tab', t);
    window.history.replaceState(null, '', u);
  };
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
        </div>
      </div>
      {/* items-end: tabs sit on the gray line (active = purple underline on it) even though the refresh button is taller. */}
      <div className="flex flex-wrap items-end border-b border-sidebar-border">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`filter-tab ${tab === k ? 'filter-tab-active' : ''}`}>{l}</button>)}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500 pb-1.5 pl-2">
          {tab === 'overview' && updatedAt && <span>Updated {ago(updatedAt)} · auto 30 s</span>}
          <button type="button" className="icon-btn" title="Refresh" onClick={() => setRefresh((n) => n + 1)}><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {tab !== 'overview' && HEALTH_TAB_HELP[tab] && <p className="text-xs text-zinc-500 flex items-center gap-1"><InfoTip text={HEALTH_TAB_HELP[tab]} /> {HEALTH_TAB_HELP[tab]}</p>}
      {tab === 'overview' && <Overview product={product} onProduct={setProduct} refresh={refresh} onUpdated={setUpdatedAt} />}
      <div key={refresh} className="space-y-4">
      {tab === 'active' && <ActiveDevices />}
      {tab === 'infrastructure' && <Infrastructure />}
      </div>
    </div>
  );
}


/** Panel-styled dropdown (CustomSelect) — replaces native <select> so menus match the panel theme. */
function Sel({ value, onChange, options, w = 'w-40' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; w?: string }) {
  // CustomSelect is `w-full` by design; the wrapper gives it the intended width.
  return <div className={`${w} shrink-0`}><CustomSelect size="sm" value={value} onChange={onChange} options={options} /></div>;
}

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
  const { data: d, err, reload } = useLoad<any>(() => A.getOverview(product || null), [product, refresh], 30_000);
  useEffect(() => { if (d?.generatedAt) onUpdated(d.generatedAt); }, [d?.generatedAt, onUpdated]);
  if (err) return <Err e={err} />;
  if (!d) return <p className="text-xs text-zinc-500">Loading…</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-stretch">
      <div className="md:col-span-2 xl:col-span-5 min-w-0"><Products list={d.products} product={product} onProduct={onProduct} /></div>
      <div className="xl:col-span-3 min-w-0"><OverallHealth d={d} onChanged={reload} /></div>
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

/** Open incidents + alerts behind "Points lost": details, the errors behind each incident, and
 *  Start investigating → Resolve (with a note) for incidents. */
function OpenOpsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data, err, reload } = useLoad<any>(() => A.listOpenOps(), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (id: string, p: Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id); setMsg(null);
    const r = await p;
    setBusy(null);
    if (!r.ok) { setMsg(r.error ?? 'Could not update.'); return; }
    reload(); onChanged();
  };
  const affected = (x: any) => (x && typeof x === 'object' ? Object.entries(x).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? num(v, 2) : String(v)}`).join(' · ') : null);
  const incidents: any[] = data?.incidents ?? [], alerts: any[] = data?.alerts ?? [];
  return (
    <div className="text-xs space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">Open incidents &amp; alerts</h3>
        <button type="button" className="icon-btn" title="Close" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      {err && <p className="text-rose-400">{err}</p>}
      {msg && <p className="text-rose-400">{msg}</p>}
      {!data ? <p className="text-zinc-500">Loading…</p> : !incidents.length && !alerts.length ? <p className="text-zinc-500 py-6 text-center">Nothing open — no points lost to incidents or alerts.</p> : <>
        {incidents.length > 0 && <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500">Incidents ({incidents.length})</h4>
          {incidents.map((i) => (
            <div key={i.id} className="border border-sidebar-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-zinc-400">{i.code}</span>
                <span className="font-semibold text-foreground">{i.title}</span>
                <span className={`rounded-full px-1.5 text-[10px] font-semibold border ${i.severity === 'CRITICAL' ? 'border-rose-500/40 text-rose-400' : 'border-amber-500/40 text-amber-400'}`}>{i.severity}</span>
                <span className="text-zinc-500">{i.panelLabel} · {i.status.toLowerCase()} · started {fmt(i.started_at)}</span>
              </div>
              {affected(i.affected) && <p className="text-zinc-400">{affected(i.affected)}</p>}
              {(i.updates ?? []).length > 0 && <ol className="space-y-0.5 text-zinc-500">{(i.updates as any[]).map((u, k) => <li key={k}>{fmt(u.at)} · {u.by} · {String(u.status).toLowerCase()}{u.note ? ` — ${u.note}` : ''}</li>)}</ol>}
              <IncidentErrors rows={i.errors ?? []} />
              <div className="flex flex-wrap items-center gap-2">
                <input className="bare-input bg-transparent px-2 py-1.5 flex-1 min-w-[200px]" placeholder={i.status === 'INVESTIGATING' ? 'What was done (optional)' : 'Cause / plan (optional)'} value={notes[i.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))} />
                {i.status === 'INVESTIGATING'
                  ? <button type="button" className="filter-tab filter-tab-active" disabled={busy === i.id} onClick={() => run(i.id, A.resolveIncident(i.id, notes[i.id] ?? ''))}>
                      {busy === i.id ? 'Resolving…' : 'Resolve incident'}</button>
                  : <button type="button" className="filter-tab filter-tab-active" disabled={busy === i.id} onClick={() => run(i.id, A.investigateIncident(i.id, notes[i.id] ?? ''))}>
                      {busy === i.id ? 'Starting…' : 'Start investigating'}</button>}
              </div>
            </div>
          ))}
        </section>}
        {alerts.length > 0 && <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500">Alerts ({alerts.length})</h4>
          {alerts.map((a) => (
            <div key={a.id} className="border border-sidebar-border p-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{a.title}</span>
              <span className="rounded-full px-1.5 text-[10px] font-semibold border border-sidebar-border">{a.level}</span>
              <span className="text-zinc-500">{a.panelLabel} · ×{a.occurrences} · first {fmt(a.first_at)} · last {ago(a.last_at)}</span>
              <button type="button" className="filter-tab ml-auto" disabled={busy === a.id} onClick={() => run(a.id, A.resolveAlert(a.id))}>{busy === a.id ? 'Resolving…' : 'Resolve'}</button>
            </div>
          ))}
        </section>}
        <p className="text-zinc-500">If the cause is still there (the rule is still breached), the next check opens a new alert/incident.</p>
      </>}
    </div>
  );
}

/** Crash reports + error events in the incident's window (newest first), with their bug code if grouped. */
function IncidentErrors({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="text-zinc-500">No crash reports or error events in this incident&apos;s window.</p>;
  const th = 'px-2 py-1 font-normal';
  return (
    <details open className="border border-sidebar-border">
      <summary className="cursor-pointer px-2 py-1.5 text-zinc-400">Errors ({rows.length >= 100 ? 'latest 100' : rows.length})</summary>
      <div className="max-h-80 overflow-auto">
        <table className="w-full table-fixed text-left">
          {/* Fixed narrow columns; the message takes the rest of the width. */}
          <colgroup><col className="w-36" /><col className="w-48" /><col className="w-56" /><col className="w-16" /><col /><col className="w-32" /></colgroup>
          <thead className="text-zinc-500"><tr><th className={th}>Time</th><th className={th}>Type</th><th className={th}>Computer</th><th className={th}>Version</th><th className={th}>Message</th><th className={th}>Bug</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`} className="border-t border-sidebar-border align-top">
              <td className="px-2 py-1 whitespace-nowrap text-zinc-500">{fmt(r.ts)}</td>
              <td title={r.event_type} className={`px-2 py-1 truncate ${r.kind === 'CRASH' ? 'text-rose-400' : 'text-amber-400'}`}>{r.event_type}</td>
              <td className="px-2 py-1 truncate text-zinc-400" title={[r.computer_name, r.school_name].filter(Boolean).join(' · ')}>{r.computer_name ?? '—'}{r.school_name ? ` · ${r.school_name}` : ''}</td>
              <td className="px-2 py-1 whitespace-nowrap text-zinc-500">{r.product_version ?? '—'}</td>
              <td className="px-2 py-1 text-zinc-300 break-words">{r.message ?? '—'}</td>
              <td className="px-2 py-1 truncate font-mono text-zinc-400">{r.bug ? `${r.bug.code} (${String(r.bug.status).toLowerCase()})` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

function OverallHealth({ d, onChanged }: { d: any; onChanged: () => void }) {
  const [openOps, setOpenOps] = useState(false);
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
          {s.penalties.map((p: any) => /open (incident|alert)/.test(p.reason)
            // Incidents/alerts can be handled from here: opens their details with Resolve.
            ? <button key={p.reason} type="button" onClick={() => setOpenOps(true)} title="Show and resolve"
                className="w-full flex justify-between gap-2 rounded-md bg-rose-500/5 hover:bg-rose-500/10 px-2 py-1 text-left cursor-pointer">
                <span className="text-zinc-400 min-w-0 break-words underline decoration-dotted underline-offset-2">{p.reason}</span><span className="text-rose-500 font-semibold">−{p.points}</span></button>
            : <div key={p.reason} className="flex justify-between gap-2 rounded-md bg-rose-500/5 px-2 py-1"><span className="text-zinc-400 min-w-0 break-words">{p.reason}</span><span className="text-rose-500 font-semibold">−{p.points}</span></div>)}
        </div>)}
      <FormModal open={openOps} onClose={() => setOpenOps(false)} panelClassName="glass-interactive w-[min(1280px,96vw)] max-h-[90vh] overflow-y-auto relative animate-slide-up rounded-none p-5">
        {openOps && <OpenOpsModal onClose={() => setOpenOps(false)} onChanged={onChanged} />}
      </FormModal>
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

// ── Active devices ──────────────────────────────────────────────────────────
// Active = licence Active, bound to a device, not expired. Lab-Admin lists LMS School + Lab.
// The search also matches the activation key; clicking a row opens that device's logs.
function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
/** Page number that resets to 0 whenever [filterKey] changes (no effect needed). */
function usePageFor(filterKey: string): [number, (n: number) => void] {
  const [pg, setPg] = useState({ key: filterKey, page: 0 });
  return [pg.key === filterKey ? pg.page : 0, (n) => setPg({ key: filterKey, page: n })];
}
const SearchBox = ({ value, onChange, placeholder, w = 'w-64' }: { value: string; onChange: (v: string) => void; placeholder: string; w?: string }) => (
  <div className={`relative ${w}`}>
    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
    <input className="bare-input bg-transparent pl-7 pr-2 py-1 w-full text-xs font-normal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
  </div>
);

/** "Showing 1–10 of 31" · rows per page · Prev 1 … 3 4 5 … 9 Next. Pages are 0-based internally. */
const PAGE_SIZES = [10, 25, 50];
function Pager({ page, size, total, onPage, onSize }: { page: number; size: number; total: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  if (!total) return null;
  const pages = Math.ceil(total / size);
  const cur = Math.min(Math.max(0, page), pages - 1);
  const nums = [...new Set([0, cur - 1, cur, cur + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const btn = 'min-w-8 h-8 px-2 rounded-lg border border-sidebar-border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <div className="flex items-center gap-2 text-zinc-500">
        <span>Showing <b className="text-foreground">{cur * size + 1}–{Math.min(total, (cur + 1) * size)}</b> of <b className="text-foreground">{total}</b></span>
        <span className="hidden sm:inline">·</span>
        <span className="flex items-center gap-1" role="group" aria-label="Rows per page">Rows
          {PAGE_SIZES.map((s) => (
            <button key={s} type="button" aria-pressed={s === size} onClick={() => onSize(s)}
              className={`${btn} ${s === size ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 font-semibold' : 'hover:bg-white/5'}`}>{s}</button>
          ))}
        </span>
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button type="button" className={`${btn} hover:bg-white/5`} disabled={cur === 0} onClick={() => onPage(cur - 1)}>Prev</button>
          {nums.map((p, i) => (
            <React.Fragment key={p}>
              {i > 0 && p - nums[i - 1] > 1 && <span className="px-1 text-zinc-500">…</span>}
              <button type="button" aria-current={p === cur ? 'page' : undefined} onClick={() => onPage(p)}
                className={`${btn} ${p === cur ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 font-semibold' : 'hover:bg-white/5'}`}>{p + 1}</button>
            </React.Fragment>
          ))}
          <button type="button" className={`${btn} hover:bg-white/5`} disabled={cur >= pages - 1} onClick={() => onPage(cur + 1)}>Next</button>
        </nav>
      )}
    </div>
  );
}

function ActiveDevices() {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [size, setSize] = useState(10);
  const [page, setPage] = usePageFor(`${q}|${size}`);
  const [open, setOpen] = useState<any>(null);
  const { data, err } = useLoad<any>(() => A.getActiveDevices({ q: q || undefined, page, pageSize: size }), [q, page, size], 60_000);
  const shownPage = data?.page ?? page;
  if (err) return <Err e={err} />;
  const rows: any[] = data?.rows ?? [];
  return (
    <>
      <Card title={`Active devices (${data?.total ?? '…'})`} right={
        <div className="flex gap-2 items-center flex-wrap justify-end">
          <SearchBox value={text} onChange={setText} placeholder="Search key, school, device…" />
        </div>}>
        <Table onRow={(i) => setOpen(rows[i])} head={['Panel', 'Product', 'School / owner', 'Device', 'Key', 'Version', 'Status', 'Last seen', 'Expires', 'Errors 24h', '']} rows={rows.map((r) => [
          r.panelLabel, r.product ?? '—', r.owner ?? '—', <span key="d" title={r.fp ?? ''}>{r.model ?? `${(r.fp ?? '').slice(0, 12)}…`}</span>, <span key="k" className="font-mono">{r.key}</span>,
          r.version ?? '—', <St key="s" s={r.state} />, ago(r.lastSeen), fmt(r.expiresAt), r.errors24h,
          <span key="l" className="text-sky-400 whitespace-nowrap">Logs ›</span>])} />
        <Pager page={shownPage} size={size} total={data?.total ?? 0} onPage={setPage} onSize={setSize} />
      </Card>
      <FormModal open={!!open} onClose={() => setOpen(null)} panelClassName="glass-interactive w-full max-w-5xl max-h-[90vh] overflow-y-auto relative animate-slide-up rounded-2xl p-5">
        {open && <DeviceLogs dev={open} onClose={() => setOpen(null)} />}
      </FormModal>
    </>
  );
}

// ── Day-wise timeline (device popup) ────────────────────────────────────────
// Neutral by design: the ONLY colour is green, for entries whose bug is already fixed.
type Entry = { id: string; ts: string; late: boolean; title: string; crash: boolean; severity: string; screen?: string | null; action?: string | null;
  detail: string; bug: any };
const FIXED = 'RESOLVED';
const human = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
function toEntry(r: any): Entry {
  const x = r.data?.extra;
  const extra = x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'occurrences' || Number(x[k]) > 1)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '';
  return {
    id: r.id, ts: r.ts, late: !!r.received_at && Date.parse(r.received_at) - Date.parse(r.ts) > 600_000, title: human(r.event_type), crash: false,
    severity: r.severity, screen: r.feature, action: r.action && r.action !== r.event_type ? r.action : null,
    detail: [r.message, extra].filter(Boolean).join(' — '), bug: r.bug,
  };
}
const crashEntry = (c: any): Entry => ({
  id: c.id, ts: c.ts, late: false, title: `Crash${c.code ? ` ${c.code}` : ''} · ${human(c.event_type)}`, crash: true, severity: 'FATAL',
  screen: c.current_screen, action: null, detail: [c.actual_behavior, c.product_version && `v${c.product_version}`].filter(Boolean).join(' — '), bug: c.bug,
});
const dayKey = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: IST });
function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(`${key}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
}
const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: IST });

function Timeline({ entries, empty = 'Nothing recorded yet.' }: { entries: Entry[]; empty?: string }) {
  if (!entries.length) return <p className="text-zinc-500 py-6 text-center">{empty}</p>;
  const days: [string, Entry[]][] = [];
  for (const e of entries) {
    const k = dayKey(e.ts);
    if (days.at(-1)?.[0] === k) days.at(-1)![1].push(e); else days.push([k, [e]]);
  }
  return (
    <div className="space-y-5">
      {days.map(([k, items]) => (
        <section key={k}>
          <div className="sticky top-0 z-10 -mx-1 px-1 py-2 flex items-center gap-3 bg-background/90 backdrop-blur">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">{dayLabel(k)}</span>
            <span className="text-[11px] text-zinc-500">{items.length} {items.length === 1 ? 'entry' : 'entries'}</span>
            <div className="flex-1 h-px bg-sidebar-border" />
          </div>
          <ol className="relative ml-[5.5rem] border-l border-sidebar-border">
            {items.map((e) => {
              const fixed = e.bug?.status === FIXED;
              return (
                <li key={e.id} className="relative pl-5 py-1">
                  <time className="absolute -left-[5.5rem] top-2.5 w-[4.75rem] text-right text-[11px] tabular-nums text-zinc-500" dateTime={e.ts}>{clock(e.ts)}</time>
                  <span className={`absolute -left-[5px] top-3 w-2.5 h-2.5 rounded-full ring-4 ring-background ${fixed ? 'bg-emerald-400' : e.crash ? 'bg-foreground' : 'bg-zinc-500'}`} />
                  <div className={`rounded-xl border px-3 py-2 transition-colors ${fixed ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-sidebar-border/60 hover:bg-white/5'}`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`font-semibold ${fixed ? '' : 'text-foreground'}`}>{e.title}</span>
                      {e.severity !== 'INFO' && <span className="rounded-full border border-sidebar-border px-1.5 text-[10px] uppercase tracking-wide">{e.severity.toLowerCase()}</span>}
                      {e.screen && <span className="rounded-full bg-white/5 px-1.5 text-[10px]">{e.screen}</span>}
                      {e.action && <span className="rounded-full bg-white/5 px-1.5 text-[10px]">{e.action}</span>}
                      {e.late && <span className="text-[10px] text-zinc-500" title="Happened offline, uploaded later">offline</span>}
                      {e.bug && <span className="ml-auto text-[10px] whitespace-nowrap">{e.bug.code}{fixed ? ` · fixed${e.bug.fixedIn ? ` in ${e.bug.fixedIn}` : ''}` : ''}</span>}
                    </div>
                    {e.detail && <p className={`mt-0.5 break-all ${fixed ? '' : 'text-zinc-500'}`}>{e.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

const CATS = ['', 'NAVIGATION', 'USER_ACTION', 'SECURITY', 'AUTHENTICATION', 'APPLICATION', 'ERROR', 'CRASH', 'PERFORMANCE', 'API', 'FILE', 'UPDATE'];
function DeviceLogs({ dev, onClose }: { dev: any; onClose: () => void }) {
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [more, setMore] = usePageFor(`${q}|${category}`); // extra pages of 100 loaded via "Load older"
  const limit = (more + 1) * 100;
  const { data, err } = useLoad<any>(() => A.getDeviceLogs({ panel: dev.panel, keyId: dev.keyId, category: category || undefined, q: q || undefined, limit }), [dev.panel, dev.keyId, category, q, limit], 60_000);
  const rows: any[] = data?.rows ?? [];
  const hasMore = (data?.total ?? 0) > rows.length;
  // Crashes join the timeline when they fall inside the loaded window (all of them once everything is loaded).
  const oldest = rows.at(-1)?.ts ?? '';
  const crashes: any[] = (category && category !== 'CRASH') || q ? [] : (data?.crashes ?? []).filter((c: any) => !hasMore || c.ts >= oldest);
  const entries = [...rows.map(toEntry), ...crashes.map(crashEntry)].sort((x, y) => y.ts.localeCompare(x.ts));
  return (
    <div className="text-xs space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{dev.owner ?? 'Device'} · {dev.model ?? `${(dev.fp ?? '').slice(0, 12)}…`}</h3>
          <p className="text-zinc-500">{dev.panelLabel} · {dev.product ?? '—'} · key <span className="font-mono">{dev.key}</span>{dev.version ? ` · v${dev.version}` : ''}{dev.lastSeen ? ` · last seen ${ago(dev.lastSeen)}` : ''} · expires {fmt(dev.expiresAt)}</p>
        </div>
        <button type="button" className="icon-btn" title="Close" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        {CATS.map((c) => (
          <button key={c} className={`filter-tab ${category === c ? 'filter-tab-active' : ''}`} onClick={() => setCategory(c)}>
            {c ? `${human(c)}${data?.byCategory?.[c] ? ` (${data.byCategory[c]})` : ''}` : 'All'}</button>))}
        <div className="ml-auto"><SearchBox value={text} onChange={setText} placeholder="Search logs…" w="w-56" /></div>
      </div>
      {err ? <Err e={err} /> : !data ? <p className="text-zinc-500 py-6 text-center">Loading…</p> : (
        <>
          <Timeline entries={entries} empty={q || category ? 'No logs match.' : 'This device has not reported anything yet.'} />
          {hasMore && <div className="flex justify-center"><button className="filter-tab" onClick={() => setMore(more + 1)}>Load older</button></div>}
          <p className="text-zinc-500 text-center"><span className="text-emerald-400">Green</span> = the bug behind that entry is already fixed · times in IST</p>
        </>
      )}
    </div>
  );
}

// ── Infrastructure: storage utilisation of the services the panel runs on ────
// Live from Supabase (Postgres catalog) and MongoDB Atlas (dbStats). Vercel hosts no data for the
// panel and has no public usage API, so it is not shown (usage + analytics: Vercel dashboard).
const growthText = (g: { bytes: number; days: number } | null | undefined) =>
  !g ? 'growth shows after 2 days of snapshots' : `${g.bytes >= 0 ? '+' : '−'}${bytes(Math.abs(g.bytes))} in ${Math.max(1, Math.round(g.days))} d`;
function Usage({ label, used, quota, growth }: { label: string; used: number | null | undefined; quota: number; growth?: { bytes: number; days: number } | null }) {
  const pct = typeof used === 'number' ? (used / quota) * 100 : null;
  const tone = pct === null ? 'bg-zinc-600' : pct >= 90 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2">
        <span className="text-zinc-400">{label}</span>
        <span className="font-semibold text-foreground">{pct === null ? NA : <>{bytes(used)} <span className="font-normal text-zinc-500">/ {bytes(quota)}</span></>}</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden"><div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(pct ?? 0, pct ? 1 : 0))}%` }} /></div>
      <div className="flex justify-between text-[11px] text-zinc-500"><span>{pct === null ? '—' : `${pct.toFixed(1)}% used`}</span>{growth !== undefined && <span>{growthText(growth)}</span>}</div>
    </div>
  );
}
const Stat = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-2"><span className="text-zinc-400">{k}</span><span className="text-foreground">{v}</span></div>;
const Service = ({ name, ok, children }: { name: string; ok: boolean; children: React.ReactNode }) => (
  <GlassCard>
    <div className="text-xs space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-foreground text-sm">{name}</h4>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{ok ? 'Connected' : 'Not connected'}</span>
      </div>
      {children}
    </div>
  </GlassCard>
);

function Infrastructure() {
  const { data: d, err } = useLoad<any>(() => A.getInfrastructure(), [], 60_000);
  if (err) return <Err e={err} />;
  if (!d) return <p className="text-xs text-zinc-500">Loading…</p>;
  const sb = d.supabase, mg = d.mongo;
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <Service name="Supabase" ok={!!sb?.connected}>
          {sb?.connected ? <>
            <Usage label="Database" used={sb.dbBytes} quota={sb.dbQuota} growth={sb.growth} />
            <Usage label="File storage" used={sb.fileBytes} quota={sb.fileQuota} growth={sb.fileGrowth} />
            <div className="space-y-1 pt-1 border-t border-sidebar-border">
              <Stat k="Cache hit" v={sb.cacheHitPct === null ? '—' : `${num(Number(sb.cacheHitPct), 2)}%`} />
              <Stat k="Connections" v={`${num(sb.connections) ?? '—'} / ${num(sb.maxConnections) ?? '—'}`} />
              {sb.largestTables.length > 0 && <Stat k="Largest tables" v={sb.largestTables.map((t: any) => `${t.name} ${bytes(t.bytes)}`).join(' · ')} />}
            </div>
          </> : <p className="text-zinc-500">Could not read the database statistics (ops_db_stats). Check SUPABASE_SERVICE_ROLE_KEY.</p>}
        </Service>

        <Service name="MongoDB Atlas" ok={!!mg}>
          {mg ? <>
            <Usage label="Health / Logs storage" used={mg.used} quota={mg.quota} growth={mg.growth} />
            <div className="space-y-1 pt-1 border-t border-sidebar-border">
              <Stat k="Documents" v={num(mg.documents) ?? '—'} />
              <Stat k="Storage guard" v={mg.pct >= 95 ? 'Critical only' : mg.pct >= 80 ? 'Warnings and above' : 'All events stored'} />
              {mg.collections.length > 0 && <Stat k="Largest" v={mg.collections.map((c: any) => `${c.name} ${bytes(c.bytes)}`).join(' · ')} />}
            </div>
          </> : <p className="text-zinc-500">Not reachable. Check MONGODB_URI and the Atlas Network Access list.</p>}
        </Service>

      </div>

    </div>
  );
}
