'use client';

// Siddesh Logs — Debug & Diagnostics UI. All text is rendered through React (auto-escaped);
// raw log content is NEVER injected as HTML. Permissions only shape the UI — the server
// actions re-check every one of them.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScrollText, RefreshCw, Download, X, Search, ChevronLeft, ChevronRight, ShieldAlert, Trash2, CheckCircle2, HardDrive } from 'lucide-react';
import { createPortal } from 'react-dom';
import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import FormModal from '@/components/FormModal';
import InfoTip from '@/components/InfoTip';
import { HELP, LOGS_TAB_HELP } from '@/lib/diagnostics/help';
import * as A from './actions';

/* eslint-disable @typescript-eslint/no-explicit-any -- rows from dynamic selects */

const TABS = [
  ['live', 'Live Logs'], ['all', 'All Events'], ['errors', 'Errors'], ['crashes', 'Crashes'], ['exceptions', 'Exceptions'],
  ['performance', 'Performance'], ['api', 'API Logs'], ['user', 'User Actions'], ['system', 'System Events'],
  ['bugs', 'Bug Reports'], ['dumps', 'Crash Dumps'], ['diagnostics', 'Diagnostics'],
] as const;
type Tab = (typeof TABS)[number][0];
const IST = 'Asia/Kolkata';
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: IST }) : '—');
const bytes = (n?: number | null) => { const v = Number(n ?? 0); return v > 1e9 ? `${(v / 1e9).toFixed(2)} GB` : v > 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${(v / 1e3).toFixed(0)} KB`; };
const SEV_CLS: Record<string, string> = {
  DEBUG: 'text-zinc-400', INFO: 'text-sky-400', WARNING: 'text-amber-400', ERROR: 'text-rose-400', CRITICAL: 'text-rose-500', FATAL: 'text-rose-600 font-bold',
};
const Sev = ({ s }: { s: string }) => <span className={`text-[11px] font-semibold ${SEV_CLS[s] ?? ''}`}>{s}</span>;
const Chip = ({ children }: { children: React.ReactNode }) => <span className="stat-chip">{children}</span>;

export default function LogsClient() {
  const [me, setMe] = useState<{ role: string; permissions: string[]; scoped: boolean } | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  // Deep links from the Operations Center: ?tab=…&issue=…&school=…
  const params = useSearchParams();
  const initialTab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'crashes';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [openIssue, setOpenIssue] = useState<string | null>(params.get('issue'));
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [openCrash, setOpenCrash] = useState<string | null>(null);

  useEffect(() => { A.getMe().then((r) => (r.ok ? setMe(r.data) : setDenied(r.error))); }, []);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);

  if (denied) return (
    <div className="max-w-xl mx-auto mt-24"><GlassCard><div className="flex items-center gap-3"><ShieldAlert className="w-5 h-5 text-rose-400" /><p className="text-sm text-foreground">{denied}</p></div></GlassCard></div>
  );
  if (!me) return <div className="mt-24 text-center text-sm text-zinc-500">Loading Logs…</div>;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="h-10" />
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><ScrollText className="w-6 h-6" /> Logs &amp; Diagnostics</h2>
        <Chip>Role <span className="stat-chip-value">{me.role.replace('_', ' ')}</span>{me.scoped ? ' · school-scoped' : ''}</Chip>
      </div>
      <div className="flex items-center gap-0 flex-wrap border-b border-sidebar-border">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`filter-tab ${tab === k ? 'filter-tab-active' : ''}`}>{label}</button>
        ))}
      </div>
      <p className="text-xs text-zinc-500 flex items-center gap-1"><InfoTip text={LOGS_TAB_HELP[tab]} /> {LOGS_TAB_HELP[tab]}</p>

      {tab === 'crashes' && <IssuesView key="c" kind="CRASH" onOpen={setOpenIssue} />}
      {tab === 'bugs' && <IssuesView key="b" onOpen={setOpenIssue} />}
      {tab === 'dumps' && <DumpsView can={can} onOpen={setOpenIssue} />}
      {tab === 'diagnostics' && <DiagnosticsView can={can} />}
      {!['crashes', 'bugs', 'dumps', 'diagnostics'].includes(tab) && <EventsView key={tab} view={tab} live={tab === 'live'} school={params.get('school') ?? undefined} onOpen={setOpenEvent} />}

      {openIssue && <IssueDrawer id={openIssue} can={can} onClose={() => setOpenIssue(null)} onCrash={setOpenCrash} onEvent={setOpenEvent} />}
      {openCrash && <CrashDrawer id={openCrash} can={can} onClose={() => setOpenCrash(null)} />}
      {openEvent && <EventDrawer id={openEvent} onClose={() => setOpenEvent(null)} onIssue={(i) => { setOpenEvent(null); setOpenIssue(i); }} />}
    </div>
  );
}


/** Panel-styled dropdown (CustomSelect) — replaces native <select> so menus match the panel theme. */
function Sel({ value, onChange, options, w = 'w-40' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; w?: string }) {
  return <CustomSelect size="sm" className={w} value={value} onChange={onChange} options={options} />;
}
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, ' ').toLowerCase().replace(/^w/, (c) => c.toUpperCase()) }));

/** Visible text field for destructive confirmations (the bare inputs look like plain text). */
const CONFIRM_FIELD = 'mt-1 block w-64 rounded-lg border border-sidebar-border bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-rose-400';
/** Typed confirmation matches ignoring case and surrounding spaces. */
const sameCode = (typed: string, code: string) => typed.trim().toUpperCase() === code.toUpperCase();

// ── Events table (search / filter / sort / paginate) ───────────────────────
function EventsView({ view, live, school, onOpen }: { view: string; live: boolean; school?: string; onOpen: (id: string) => void }) {
  const [f, setF] = useState<A.EventFilters>({ view, school, page: 0, pageSize: 50, sort: 'ts' });
  const [data, setData] = useState<{ rows: any[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { A.listEvents(f).then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error))); }, [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!live) return; const t = setInterval(load, 10_000); return () => clearInterval(t); }, [live, load]);
  const set = (p: Partial<A.EventFilters>) => setF((o) => ({ ...o, page: 0, ...p }));
  const sortBy = (c: string) => setF((o) => ({ ...o, sort: c, asc: o.sort === c ? !o.asc : false }));
  const th = (children: React.ReactNode, c?: string) => (
    <th key={String(children)} className={c ? 'cursor-pointer select-none' : ''} onClick={c ? () => sortBy(c) : undefined}>{children}{c && f.sort === c ? (f.asc ? ' ▲' : ' ▼') : ''}</th>
  );
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <InfoTip text={HELP['Event filters']} />
        <label className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input className="bare-input pl-7 pr-2 py-1.5 bg-transparent w-56" placeholder="Search message…" onChange={(e) => set({ q: e.target.value })} /></label>
        <Sel value={f.severity ?? ''} onChange={(v) => set({ severity: v || undefined })} options={[{ value: '', label: 'All severities' }, ...opts(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'])]} />
        <input className="bare-input py-1.5 bg-transparent w-32" placeholder="Product id" onChange={(e) => set({ product: e.target.value })} />
        <input className="bare-input py-1.5 bg-transparent w-24" placeholder="Version" onChange={(e) => set({ version: e.target.value })} />
        <input className="bare-input py-1.5 bg-transparent w-36" placeholder="School/entity id" defaultValue={school} onChange={(e) => set({ school: e.target.value })} />
        <input className="bare-input py-1.5 bg-transparent w-28" placeholder="Module" onChange={(e) => set({ module: e.target.value })} />
        <input className="bare-input py-1.5 bg-transparent w-36" placeholder="Event type" onChange={(e) => set({ event_type: e.target.value.toUpperCase() })} />
        <input type="datetime-local" className="bare-input py-1.5 bg-transparent" onChange={(e) => set({ from: e.target.value })} title="From" />
        <input type="datetime-local" className="bare-input py-1.5 bg-transparent" onChange={(e) => set({ to: e.target.value })} title="To" />
        <button className="filter-tab" onClick={load}><RefreshCw className={`w-3.5 h-3.5 ${live ? 'animate-spin [animation-duration:3s]' : ''}`} />{live ? 'Live · 10s' : 'Refresh'}</button>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich min-w-[1300px] text-xs">
            <thead><tr className="border-b border-sidebar-border h-[40px]">
              {th("Timestamp", "ts")}{th("Severity", "severity")}{th("Event", "event_type")}{th("Product", "product_id")}{th("Version", "product_version")}
              {th("School")}{th("Computer")}{th("User")}{th("Module", "module")}{th("Feature")}{th("Status")}{th("Error ID")}{th("Crash ID")}{th("Bug")}{th("Message")}
            </tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-white/5" onClick={() => onOpen(r.id)}>
                  <td className="whitespace-nowrap">{fmt(r.ts)}</td><td><Sev s={r.severity} /></td><td>{r.event_type}</td><td>{r.product_id ?? '—'}</td>
                  <td>{r.product_version ?? '—'}</td><td>{r.school_name ?? '—'}</td><td>{r.computer_name ?? r.machine_id?.slice(0, 10)}</td><td>{r.user_id ?? '—'}</td>
                  <td>{r.module ?? '—'}</td><td>{r.feature ?? '—'}</td><td>{r.result ?? '—'}</td><td>{r.error_code ?? '—'}</td>
                  <td>{r.crash_id ? r.crash_id.slice(0, 8) : '—'}</td><td>{r.issue_id ? '●' : '—'}</td>
                  <td className="max-w-[320px] truncate" title={r.message ?? ''}>{r.message ?? r.action ?? ''}</td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={15} className="text-center text-zinc-500 py-6">No events match.</td></tr>}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <Pager page={f.page ?? 0} total={data?.total ?? 0} size={f.pageSize ?? 50} onPage={(p) => setF((o) => ({ ...o, page: p }))} />
    </>
  );
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const last = Math.max(0, Math.ceil(total / size) - 1);
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-zinc-400">
      <span>~{total.toLocaleString()} rows · page {page + 1} / {last + 1}</span>
      <button className="filter-tab" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft className="w-3.5 h-3.5" /></button>
      <button className="filter-tab" disabled={page >= last} onClick={() => onPage(page + 1)}><ChevronRight className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ── Issues (fingerprint groups) ─────────────────────────────────────────────
function IssuesView({ kind, onOpen }: { kind?: string; onOpen: (id: string) => void }) {
  const [f, setF] = useState<A.IssueFilters>({ kind, status: 'OPEN', page: 0 });
  const [data, setData] = useState<{ rows: any[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { A.listIssues(f).then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error))); }, [f]);
  const set = (p: Partial<A.IssueFilters>) => setF((o) => ({ ...o, page: 0, ...p }));
  return (
    <>
      <div className="flex flex-wrap gap-2 text-xs">
        <input className="bare-input py-1.5 px-2 bg-transparent w-64" placeholder="Search title…" onChange={(e) => set({ q: e.target.value })} />
        {!kind && <Sel value={f.kind ?? ''} onChange={(v) => set({ kind: v || undefined })} options={[{ value: '', label: 'All kinds' }, ...opts(['CRASH', 'ERROR', 'WARNING', 'USER_REPORT'])]} />}
        <Sel value={f.status ?? ''} onChange={(v) => set({ status: v || undefined })} options={[{ value: 'OPEN', label: 'Open' }, { value: '', label: 'Any status' }, ...opts(['NEW', 'REOPENED', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'RESOLVED', 'DELETE_PENDING', 'DELETED'])]} />
        <Sel value={f.sort ?? 'last_seen_at'} onChange={(v) => set({ sort: v })} options={[{ value: 'last_seen_at', label: 'Last seen' }, { value: 'occurrence_count', label: 'Most frequent' }, { value: 'first_seen_at', label: 'First seen' }]} />
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich min-w-[1100px] text-xs">
            <thead><tr className="border-b border-sidebar-border h-[40px]">
              <th>Bug ID</th><th>Kind</th><th>Severity</th><th>Issue</th><th>Product</th><th>Count</th><th>Schools</th><th>Machines</th><th>Versions</th><th>First seen</th><th>Last seen</th><th>Status</th>
            </tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-white/5" onClick={() => onOpen(r.id)}>
                  <td className="font-mono">{r.code}</td><td>{r.kind}</td><td><Sev s={r.severity} /></td>
                  <td className="max-w-[340px] truncate" title={r.title}>{r.title}</td><td>{r.product_id ?? '—'}</td>
                  <td className="font-semibold">{Number(r.occurrence_count).toLocaleString()}</td><td>{r.schools}</td><td>{r.machines}</td>
                  <td className="max-w-[120px] truncate">{r.affected_versions.join(', ')}</td><td className="whitespace-nowrap">{fmt(r.first_seen_at)}</td>
                  <td className="whitespace-nowrap">{fmt(r.last_seen_at)}</td><td><StatusPill s={r.status} reopened={r.reopen_count} /></td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={12} className="text-center text-zinc-500 py-6">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <Pager page={f.page ?? 0} total={data?.total ?? 0} size={50} onPage={(p) => setF((o) => ({ ...o, page: p }))} />
    </>
  );
}

const StatusPill = ({ s, reopened }: { s: string; reopened?: number }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s === 'RESOLVED' || s === 'DELETED' ? 'border-emerald-500/30 text-emerald-400' : s === 'REOPENED' || s === 'NEW' ? 'border-rose-500/30 text-rose-400' : 'border-amber-500/30 text-amber-400'}`}>
    {s.replace('_', ' ')}{reopened ? ` ×${reopened}` : ''}
  </span>
);

// ── Drawers ────────────────────────────────────────────────────────────────
function Drawer({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  // Portal: a transformed ancestor would otherwise trap `fixed` (see FormModal). Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-surface-hover border-l border-sidebar-border p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-foreground break-all">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="filter-tab"><X className="w-4 h-4" /></button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, rows }: { title: string; rows: [string, unknown][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1">{title}{HELP[title] && <InfoTip text={HELP[title]} />}</h4>
      <div className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1 text-xs">
        {shown.map(([k, v]) => (
          <React.Fragment key={k}><span className="text-zinc-500">{k}</span>
            <span className="text-foreground break-all whitespace-pre-wrap">{typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}</span></React.Fragment>
        ))}
      </div>
    </div>
  );
}

const Pre = ({ title, text }: { title: string; text?: string | null }) => (text ? (
  <div><h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1">{title}{HELP[title] && <InfoTip text={HELP[title]} />}</h4>
    <pre className="text-[11px] leading-relaxed bg-black/30 rounded-lg p-3 overflow-x-auto max-h-80 whitespace-pre text-zinc-200">{text}</pre></div>
) : null);

function Timeline({ events }: { events: any[] }) {
  if (!events?.length) return null;
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1">Timeline (oldest → failure)<InfoTip text={HELP['Timeline (oldest → failure)']} /></h4>
      <ol className="relative border-l border-sidebar-border ml-2 space-y-1.5">
        {events.map((e, i) => (
          <li key={e.id ?? e.event_id ?? i} className="ml-3 text-xs">
            <span className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${['ERROR', 'CRITICAL', 'FATAL'].includes(e.severity) ? 'bg-rose-500' : e.severity === 'WARNING' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
            <span className="text-zinc-500 mr-2">{e.ts ?? e.timestamp ? new Date(e.ts ?? e.timestamp).toLocaleTimeString('en-IN', { timeZone: IST }) : ''}</span>
            <span className="font-semibold text-foreground">{e.event_type}</span>
            {[e.module, e.feature, e.action].filter(Boolean).length > 0 && <span className="text-zinc-400"> · {[e.module, e.feature, e.action].filter(Boolean).join(' › ')}</span>}
            {e.message && <span className="text-zinc-400"> — {String(e.message).slice(0, 200)}</span>}
            {e.result === 'FAIL' && <span className="text-rose-400 font-semibold"> FAIL</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function saveBase64(name: string, b64: string) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function IssueDrawer({ id, can, onClose, onCrash, onEvent }: { id: string; can: (p: string) => boolean; onClose: () => void; onCrash: (id: string) => void; onEvent: (id: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'resolve' | 'delete'>('none');
  const load = useCallback(() => { A.getIssue(id).then((r) => (r.ok ? setD(r.data) : setMsg(r.error))); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Drawer title="Loading…" onClose={onClose}>{msg && <p className="text-xs text-rose-400">{msg}</p>}</Drawer>;
  const i = d.issue;
  const act = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => { const r = await p; setMsg(r.ok ? done : (r as any).error); if (r.ok) { setMode('none'); load(); } };
  return (
    <Drawer title={<>{i.code} · {i.title}</>} onClose={onClose}>
      <div className="flex flex-wrap gap-2 items-center">
        <StatusPill s={i.status} reopened={i.reopen_count} />
        <InfoTip text={<ul className="list-disc pl-4 space-y-1">{['Download Diagnostic Bundle', 'Start investigating', 'Mark as resolved', 'Delete diagnostics'].map((k) => <li key={k}><b>{k}:</b> {HELP[k]}</li>)}</ul>} />
        {can('DIAGNOSTIC_DOWNLOAD') && i.status !== 'DELETED' && <button className="filter-tab" onClick={async () => { const r = await A.downloadBundle(i.id); if (r.ok) { saveBase64(r.data.filename, r.data.base64); load(); } else setMsg(r.error); }}><Download className="w-3.5 h-3.5" /> Download Diagnostic Bundle</button>}
        {can('BUG_MANAGE') && ['NEW', 'REOPENED', 'REVIEWING', 'DOWNLOADED'].includes(i.status) && <button className="filter-tab" onClick={() => act(A.setIssueStatus(i.id, 'INVESTIGATING'), 'Marked investigating.')}>Start investigating</button>}
        {can('BUG_MANAGE') && !['RESOLVED', 'DELETE_PENDING', 'DELETED'].includes(i.status) && <button className="filter-tab" onClick={() => setMode('resolve')}><CheckCircle2 className="w-3.5 h-3.5" /> Mark as resolved</button>}
        {can('DIAGNOSTIC_DELETE') && i.status !== 'DELETED' && <button className="filter-tab text-rose-400" onClick={() => setMode('delete')}><Trash2 className="w-3.5 h-3.5" /> Delete diagnostics</button>}
      </div>
      {msg && <p className="text-xs text-amber-400">{msg}</p>}
      {mode === 'resolve' && <FormModal open onClose={() => setMode('none')} panelClassName="w-full max-w-lg relative animate-slide-up"><ResolveForm issue={i} onSubmit={(f) => act(A.resolveIssue(i.id, f), 'Resolved. Diagnostics will be deleted after the grace period.')} onCancel={() => setMode('none')} /></FormModal>}
      {mode === 'delete' && <FormModal open onClose={() => setMode('none')} panelClassName="w-full max-w-lg relative animate-slide-up"><DeleteConfirm issueId={i.id} can={can} onDone={(m) => { setMsg(m); setMode('none'); load(); }} onCancel={() => setMode('none')} /></FormModal>}
      <Section title="Occurrence" rows={[['Occurrences', Number(i.occurrence_count).toLocaleString()], ['Schools affected', i.affected_schools?.length], ['Machines affected', i.affected_machines?.length],
        ['Versions', i.affected_versions?.join(', ')], ['Modules', i.affected_modules?.join(', ')], ['First seen', fmt(i.first_seen_at)], ['Last seen', fmt(i.last_seen_at)], ['Fingerprint', i.fingerprint]]} />
      <Section title="Behaviour" rows={[['Expected', i.expected_behavior], ['Actual', i.actual_behavior], ['Result', i.expected_behavior || i.actual_behavior ? 'FAIL' : null]]} />
      <Section title="Error" rows={[['Kind', i.kind], ['Severity', i.severity], ['Exception', i.exception_type], ['Message', i.message_sample], ['Product', i.product_id]]} />
      <Pre title="Stack trace (sample)" text={i.stack_sample} />
      <Section title="Resolution" rows={[['Root cause', i.root_cause], ['Resolution', i.resolution], ['Fixed in', i.fixed_version], ['Resolved by', i.resolved_by], ['Resolved at', i.resolved_at && fmt(i.resolved_at)], ['Notes', i.developer_notes], ['Downloaded at', i.downloaded_at && fmt(i.downloaded_at)], ['Deletes after', i.delete_after && fmt(i.delete_after)]]} />
      {d.crashes.length > 0 && <div><h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Crashes ({d.crashes.length})</h4>
        <table className="data-table text-xs w-full"><tbody>{d.crashes.map((c: any) => (
          <tr key={c.id} className="cursor-pointer hover:bg-white/5" onClick={() => onCrash(c.id)}>
            <td className="font-mono">{c.code}</td><td>{fmt(c.ts)}</td><td>{c.school_name}</td><td>{c.computer_name ?? c.machine_id?.slice(0, 10)}</td><td>v{c.product_version}</td><td>{c.module}</td></tr>))}</tbody></table></div>}
      {d.events.length > 0 && <div><h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Sample events ({d.events.length})</h4>
        <table className="data-table text-xs w-full"><tbody>{d.events.map((e: any) => (
          <tr key={e.id} className="cursor-pointer hover:bg-white/5" onClick={() => onEvent(e.id)}>
            <td>{fmt(e.ts)}</td><td><Sev s={e.severity} /></td><td>{e.event_type}</td><td>{e.school_name}</td><td className="truncate max-w-[260px]">{e.message}</td></tr>))}</tbody></table></div>}
      {d.artifacts.length > 0 && <Artifacts list={d.artifacts} can={can} />}
    </Drawer>
  );
}

function Artifacts({ list, can }: { list: any[]; can: (p: string) => boolean }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div><h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1">Evidence<InfoTip text={HELP.Evidence} /></h4>
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-3 text-xs py-1">
          <span className="font-semibold">{a.kind}</span><span>{bytes(a.size_bytes)}</span><span className="text-zinc-500">{fmt(a.created_at)}</span>
          {can('CRASH_DOWNLOAD') && <button className="filter-tab" onClick={async () => { const r = await A.getArtifactUrl(a.id); if (r.ok) window.location.assign(r.data.url); else setErr(r.error); }}><Download className="w-3.5 h-3.5" /> Download</button>}
        </div>
      ))}
      {err && <p className="text-xs text-rose-400">{err}</p>}
    </div>
  );
}

function ResolveForm({ issue, onSubmit, onCancel }: { issue: any; onSubmit: (f: { root_cause: string; resolution: string; fixed_version: string; notes?: string }) => void; onCancel: () => void }) {
  const [f, setF] = useState({ root_cause: '', resolution: '', fixed_version: '', notes: '' });
  const inp = 'bare-input w-full bg-transparent px-2 py-1.5 text-xs';
  return (
    <GlassCard><div className="space-y-2 text-xs">
      <p className="text-zinc-400">Bug ID <b className="text-foreground">{issue.code}</b> · Developer: you · Resolved at: now</p>
      <textarea className={inp} rows={2} placeholder="Root cause *" onChange={(e) => setF({ ...f, root_cause: e.target.value })} />
      <textarea className={inp} rows={2} placeholder="Resolution *" onChange={(e) => setF({ ...f, resolution: e.target.value })} />
      <input className={inp} placeholder="Fixed in build/version *" onChange={(e) => setF({ ...f, fixed_version: e.target.value })} />
      <textarea className={inp} rows={2} placeholder="Developer notes (optional)" onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="flex gap-2"><button className="filter-tab filter-tab-active" onClick={() => onSubmit(f)}>Resolve</button><button className="filter-tab" onClick={onCancel}>Cancel</button></div>
    </div></GlassCard>
  );
}

function DeleteConfirm({ issueId, can, onDone, onCancel }: { issueId: string; can: (p: string) => boolean; onDone: (m: string) => void; onCancel: () => void }) {
  const [p, setP] = useState<any>(null);
  const [code, setCode] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { A.previewDelete(issueId).then((r) => (r.ok ? setP(r.data) : setErr(r.error))); }, [issueId]);
  if (!p) return <p className="text-xs text-rose-400">{err ?? 'Loading…'}</p>;
  const doDelete = async () => {
    setBusy(true); setErr(null);
    const r = await A.deleteIssueDiagnostics(issueId, p.code, force); // canonical code once the typed one matches
    setBusy(false);
    if (r.ok) onDone(r.data?.alreadyDeleted ? 'Already deleted.' : 'Diagnostics deleted.'); else setErr(r.error);
  };
  return (
    <GlassCard><div className="space-y-2 text-xs">
      <p className="font-semibold text-rose-400">You are about to permanently delete:</p>
      <p>Bug {p.code} · Logs: {p.events.toLocaleString()} · Crashes: {p.crashes} · Screenshots: {p.screenshots} · Crash dumps: {p.dumps} · Log files: {p.logs} · Storage: {bytes(p.bytes)}</p>
      <p className="text-zinc-400">This action cannot be undone. A small bug summary (fingerprint, counts, resolution) is kept.</p>
      {p.protected && <p className="text-amber-400">This issue is still {p.status}. {can('FORCE_DELETE') ? <label><input type="checkbox" onChange={(e) => setForce(e.target.checked)} /> Override retention policy (Super Admin)</label> : 'Resolve it first.'}</p>}
      <label className="block text-zinc-400">Type <b className="font-mono text-foreground">{p.code}</b> to confirm
        <input autoFocus className={CONFIRM_FIELD} placeholder={p.code} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sameCode(code, p.code)) void doDelete(); }} /></label>
      <div className="flex gap-2">
        <button className="filter-tab text-rose-400 disabled:opacity-40 disabled:cursor-not-allowed" disabled={!sameCode(code, p.code) || busy || (p.protected && !force)} onClick={() => void doDelete()}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        <button className="filter-tab" onClick={onCancel}>Cancel</button></div>
      {err && <p className="text-rose-400">{err}</p>}
    </div></GlassCard>
  );
}

function CrashDrawer({ id, can, onClose }: { id: string; can: (p: string) => boolean; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { A.getCrash(id).then((r) => (r.ok ? setD(r.data) : setErr(r.error))); }, [id]);
  if (!d) return <Drawer title="Loading…" onClose={onClose}>{err && <p className="text-xs text-rose-400">{err}</p>}</Drawer>;
  const c = d.crash; const x = c.exception ?? {}; const s = c.system_info ?? {}; const n = c.network_state ?? {}; const p = c.perf_state ?? {};
  return (
    <Drawer title={<>{c.code} · {c.event_type}</>} onClose={onClose}>
      <Section title="Application" rows={[['Product', c.product_id], ['Version', c.product_version], ['Build', c.build_number], ['Commit', c.build_commit]]} />
      <Section title="Deployment" rows={[['School', c.school_name], ['School/entity id', c.entity_id], ['Installation', c.installation_id], ['Machine', c.machine_id], ['Computer', c.computer_name]]} />
      <Section title="Session" rows={[['User', c.user_id], ['Session', c.session_id], ['Process ID', c.process_id], ['Screen', c.current_screen]]} />
      <Section title="Event" rows={[['Timestamp', fmt(c.ts)], ['Received', fmt(c.received_at)], ['Module', c.module], ['Feature', c.feature], ['Action', c.action]]} />
      <Section title="Behaviour" rows={[['Expected', c.expected_behavior], ['Actual', c.actual_behavior], ['Result', c.result]]} />
      <Section title="Error" rows={[['Type', x.type], ['Message', x.message], ['Code', x.code], ['Native code', x.native_code], ['Fault address', x.fault_address], ['Faulting module', x.faulting_module], ['Source', x.source_file && `${x.source_file}:${x.source_line ?? ''}`], ['Function', x.function], ['Inner exception', x.inner]]} />
      <Pre title="Stack trace" text={c.stack_trace} />
      <Section title="System" rows={Object.entries(s)} />
      <Section title="Network" rows={Object.entries(n)} />
      <Section title="Performance" rows={Object.entries(p)} />
      <Section title="Application state" rows={Object.entries(c.app_state ?? {})} />
      {d.artifacts.length > 0 && <Artifacts list={d.artifacts} can={can} />}
      <Timeline events={Array.isArray(c.last_events) ? c.last_events : []} />
    </Drawer>
  );
}

function EventDrawer({ id, onClose, onIssue }: { id: string; onClose: () => void; onIssue: (id: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { A.getEvent(id).then((r) => (r.ok ? setD(r.data) : setErr(r.error))); }, [id]);
  if (!d) return <Drawer title="Loading…" onClose={onClose}>{err && <p className="text-xs text-rose-400">{err}</p>}</Drawer>;
  const e = d.event; const data = e.data ?? {}; const x = data.exception ?? {};
  return (
    <Drawer title={<>{e.event_type} · <Sev s={e.severity} /></>} onClose={onClose}>
      {e.issue_id && <button className="filter-tab" onClick={() => onIssue(e.issue_id)}>Open grouped issue →</button>}
      <Section title="Application" rows={[['Product', e.product_id], ['Version', e.product_version], ['Build', e.build_number], ['Commit', e.build_commit]]} />
      <Section title="Deployment" rows={[['School', e.school_name], ['Installation', e.installation_id], ['Machine', e.machine_id], ['Computer', e.computer_name]]} />
      <Section title="Session" rows={[['User', e.user_id], ['Role', data.user_role], ['Session', e.session_id], ['Process ID', e.process_id], ['Correlation', e.correlation_id], ['Request', e.request_id]]} />
      <Section title="Event" rows={[['Timestamp', fmt(e.ts)], ['Category', e.category], ['Module', e.module], ['Feature', e.feature], ['Action', e.action], ['Duration', e.duration_ms != null ? `${e.duration_ms} ms` : null], ['Message', e.message], ['Expires', fmt(e.expires_at)]]} />
      <Section title="Behaviour" rows={[['Expected', data.expected_behavior], ['Actual', data.actual_behavior], ['Result', e.result]]} />
      <Section title="Error" rows={[['Type', x.type], ['Message', x.message], ['Code', e.error_code], ['Inner exception', x.inner], ['Source', x.source_file && `${x.source_file}:${x.source_line ?? ''}`], ['Function', x.function]]} />
      <Pre title="Stack trace" text={data.stack_trace} />
      <Section title="Network" rows={Object.entries(data.network ?? {})} />
      <Section title="Performance" rows={Object.entries(data.performance ?? {})} />
      <Section title="Extra" rows={Object.entries(data.extra ?? {})} />
      <Timeline events={d.timeline} />
    </Drawer>
  );
}

// ── Crash dumps + Diagnostics (storage, retention, roles, audit) ────────────
function DumpsView({ can, onOpen }: { can: (p: string) => boolean; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { A.listArtifacts(0).then((r) => (r.ok ? setRows(r.data.rows) : setErr(r.error))); }, []);
  return (
    <GlassCard className="!p-0 overflow-hidden"><div className="overflow-x-auto px-[15px] py-2.5">
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <table className="data-table text-xs w-full"><thead><tr><th>Kind</th><th>Bug</th><th>Size</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
        <tbody>{(rows ?? []).map((a) => (
          <tr key={a.id}><td>{a.kind}</td><td className="cursor-pointer font-mono" onClick={() => a.issue_id && onOpen(a.issue_id)}>{a.diag_issues?.code ?? '—'}</td>
            <td>{bytes(a.size_bytes)}</td><td>{fmt(a.created_at)}</td><td>{a.status}</td>
            <td>{can('CRASH_DOWNLOAD') && a.status === 'ACTIVE' && <button className="filter-tab" onClick={async () => { const r = await A.getArtifactUrl(a.id); if (r.ok) window.location.assign(r.data.url); else setErr(r.error); }}><Download className="w-3.5 h-3.5" /></button>}</td></tr>))}
          {rows && rows.length === 0 && <tr><td colSpan={6} className="text-center text-zinc-500 py-6">No crash dumps stored.</td></tr>}</tbody></table>
    </div></GlassCard>
  );
}

const RET_LABELS: [string, string][] = [
  ['debugHours', 'Debug logs (hours)'], ['infoHours', 'Raw INFO logs (hours)'], ['warningDays', 'Warnings (days)'], ['errorDays', 'Errors (days)'],
  ['resolvedGraceHours', 'Resolved crash retention (hours)'], ['artifactGraceHours', 'Artifacts after resolution (hours)'],
  ['cleanupEveryMinutes', 'Cleanup frequency (minutes)'], ['samplePerFingerprintPerDay', 'Stored samples per warning/day'],
  ['orphanGraceMinutes', 'Orphan grace (minutes)'], ['auditDays', 'Security audit retention (days)'],
];

function DiagnosticsView({ can }: { can: (p: string) => boolean }) {
  const [st, setSt] = useState<any>(null);
  const [ret, setRet] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { A.getStorage().then((r) => r.ok && setSt(r.data)); A.getRetention().then((r) => r.ok && setRet(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  const s = st?.stats ?? {};
  const art = useMemo(() => st?.stats?.artifacts ?? {}, [st]);
  const logsBytes = Number(s.events_table_bytes ?? 0) + Number(s.crashes_table_bytes ?? 0) + Number(s.issues_table_bytes ?? 0);
  const artBytes = useMemo(() => Object.values(art).reduce((t: number, v: any) => t + Number(v.bytes ?? 0), 0), [art]);
  return (
    <div className="space-y-4">
      <GlassCard><div className="space-y-2 text-xs">
        <h4 className="font-semibold text-foreground flex items-center gap-2"><HardDrive className="w-4 h-4" /> Diagnostic Storage<InfoTip text={HELP['Diagnostic Storage']} /></h4>
        <div className="flex flex-wrap gap-2">
          <Chip>Logs tables <span className="stat-chip-value">{bytes(logsBytes)}</span></Chip>
          <Chip>Crash dumps <span className="stat-chip-value">{bytes(art.DUMP?.bytes)}</span></Chip>
          <Chip>Screenshots <span className="stat-chip-value">{bytes(art.SCREENSHOT?.bytes)}</span></Chip>
          <Chip>Pending delete <span className="stat-chip-value">{bytes(s.pending_delete_bytes)}</span></Chip>
          <Chip>Total <span className="stat-chip-value">{bytes(logsBytes + artBytes)}</span></Chip>
          <Chip>Events <span className="stat-chip-value">{Number(s.events_count ?? 0).toLocaleString()}</span></Chip>
          <Chip>Avg event <span className="stat-chip-value">{s.events_count ? bytes(Number(s.events_table_bytes) / Number(s.events_count)) : '—'}</span></Chip>
          <Chip>Crashes <span className="stat-chip-value">{s.crashes_count ?? 0}</span></Chip>
          <Chip>Open issues <span className="stat-chip-value">{s.issues_open ?? 0}</span></Chip>
          <Chip>Awaiting delete <span className="stat-chip-value">{s.issues_pending_delete ?? 0}</span></Chip>
          <Chip>Oldest event <span className="stat-chip-value">{fmt(s.oldest_event)}</span></Chip>
          <Chip>Database <span className="stat-chip-value">{bytes(s.db_bytes)}</span></Chip>
        </div>
        <p className="text-zinc-500">Deleted rows are reclaimed by Postgres autovacuum (file size may not shrink immediately). Supabase backups keep deleted data until they age out — see LOGS.md.</p>
        {can('RETENTION_MANAGE') && <button className="filter-tab" onClick={async () => { const r = await A.runCleanupNow(); setMsg(r.ok ? `Cleanup done: ${JSON.stringify(r.data)}` : r.error); load(); }}><RefreshCw className="w-3.5 h-3.5" /> Run cleanup now</button>}
        {msg && <p className="text-amber-400 break-all">{msg}</p>}
        <table className="data-table w-full"><thead><tr><th>Cleanup run</th><th>Events</th><th>Crashes</th><th>Issues</th><th>Artifacts</th><th>Orphans</th><th>Reclaimed</th><th>Error</th></tr></thead>
          <tbody>{(st?.runs ?? []).map((r: any) => <tr key={r.id}><td>{fmt(r.started_at)}</td><td>{r.events_deleted}</td><td>{r.crashes_deleted}</td><td>{r.issues_purged}</td><td>{r.artifacts_deleted}</td><td>{r.orphans_deleted}</td><td>{bytes(r.bytes_reclaimed)}</td><td className="text-rose-400">{r.error ?? ''}</td></tr>)}</tbody></table>
      </div></GlassCard>

      {ret && <GlassCard><div className="space-y-2 text-xs">
        <h4 className="font-semibold text-foreground flex items-center gap-1">Retention policy<InfoTip text={HELP["Retention policy"]} /></h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{RET_LABELS.map(([k, l]) => (
          <label key={k} className="flex items-center justify-between gap-2"><span className="text-zinc-400">{l}</span>
            <input type="number" disabled={!can('RETENTION_MANAGE')} className="bare-input bg-transparent px-2 py-1 w-24" value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: Number(e.target.value) })} /></label>))}</div>
        {can('RETENTION_MANAGE') && <button className="filter-tab filter-tab-active" onClick={async () => { const r = await A.saveRetention(ret); setMsg(r.ok ? 'Retention saved.' : r.error); if (r.ok) setRet(r.data); }}>Save retention</button>}
      </div></GlassCard>}

      {can('FORCE_DELETE') && <BulkDelete />}
      {can('ROLE_MANAGE') && <Roles />}
      {can('AUDIT_VIEW') && <Audit />}
    </div>
  );
}

function BulkDelete() {
  const [days, setDays] = useState(7);
  const [p, setP] = useState<any>(null);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <GlassCard><div className="space-y-2 text-xs">
      <h4 className="font-semibold text-foreground flex items-center gap-1">Bulk cleanup<InfoTip text={HELP["Bulk cleanup"]} /></h4>
      <div className="flex items-center gap-2">Delete all resolved diagnostics older than
        <input type="number" className="bare-input bg-transparent px-2 py-1 w-16" value={days} onChange={(e) => { setDays(Number(e.target.value)); setP(null); }} /> days
        <button className="filter-tab" onClick={async () => { const r = await A.previewBulkDelete(days); if (r.ok) setP(r.data); else setMsg(r.error); }}>Preview</button></div>
      {p && <>
        <p>Issues: {p.issues} · Records: {(p.events + p.crashes).toLocaleString()} · Artifacts: {p.artifacts} · Estimated space reclaimed: {bytes(p.bytes)} (+ row storage)</p>
        <label className="block text-zinc-400">Type <b className="font-mono text-foreground">DELETE</b> to confirm
          <input className={CONFIRM_FIELD} placeholder="DELETE" onChange={(e) => setConfirm(e.target.value)} /></label>
        <button className="filter-tab text-rose-400 disabled:opacity-40 disabled:cursor-not-allowed" disabled={!sameCode(confirm, 'DELETE') || !p.issues} onClick={async () => { const r = await A.bulkDeleteResolved(days, 'DELETE'); setMsg(r.ok ? `Purged ${r.data.purged} issues.` : r.error); setP(null); }}>Delete permanently</button>
      </>}
      {msg && <p className="text-amber-400">{msg}</p>}
    </div></GlassCard>
  );
}

function Roles() {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ email: '', role: 'VIEWER', schools: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { A.listRoles().then((r) => r.ok && setRows(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (email: string, role: string | null, schools: string) => {
    const r = await A.setRole(email, role, schools ? schools.split(',').map((s) => s.trim()) : null); setMsg(r.ok ? 'Saved.' : r.error); load();
  };
  return (
    <GlassCard><div className="space-y-2 text-xs">
      <h4 className="font-semibold text-foreground flex items-center gap-1">Logs access (RBAC)<InfoTip text={HELP["Logs access (RBAC)"]} /></h4>
      <p className="text-zinc-500">Viewer: view/search · Developer: + download · Debug Admin: + resolve/delete · Super Admin: + retention, roles, audit, force delete. Leave schools empty for all schools.</p>
      <table className="data-table w-full"><tbody>{rows.map((r) => (
        <tr key={r.email}><td>{r.email}</td><td>{r.role}</td><td>{r.school_ids?.join(', ') ?? 'All schools'}</td>
          <td><button className="filter-tab text-rose-400" onClick={() => save(r.email, null, '')}>Remove</button></td></tr>))}</tbody></table>
      <div className="flex flex-wrap gap-2">
        <input className="bare-input bg-transparent px-2 py-1 w-56" placeholder="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Sel value={f.role} onChange={(v) => setF({ ...f, role: v })} options={opts(['VIEWER', 'DEVELOPER', 'DEBUG_ADMIN', 'SUPER_ADMIN'])} />
        <input className="bare-input bg-transparent px-2 py-1 w-64" placeholder="school/entity ids, comma-separated" onChange={(e) => setF({ ...f, schools: e.target.value })} />
        <button className="filter-tab filter-tab-active" onClick={() => save(f.email, f.role, f.schools)}>Grant</button>
      </div>
      {msg && <p className="text-amber-400">{msg}</p>}
    </div></GlassCard>
  );
}

function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { A.listAudit(0).then((r) => r.ok && setRows(r.data)); }, []);
  return (
    <GlassCard><div className="text-xs space-y-2"><h4 className="font-semibold text-foreground flex items-center gap-1">Security audit trail<InfoTip text={HELP["Security audit trail"]} /></h4>
      <div className="max-h-96 overflow-y-auto"><table className="data-table w-full"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Result</th><th>IP</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{fmt(r.at)}</td><td>{r.actor}</td><td>{r.action}</td><td>{r.resource_id ?? '—'}</td><td>{r.result}</td><td>{r.ip}</td></tr>)}</tbody></table></div>
    </div></GlassCard>
  );
}
