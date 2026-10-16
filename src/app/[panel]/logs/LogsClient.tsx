'use client';

// Siddesh Logs — Debug & Diagnostics UI. All text is rendered through React (auto-escaped);
// raw log content is NEVER injected as HTML. Permissions only shape the UI — the server
// actions re-check every one of them.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScrollText, Download, X, Search, ShieldAlert, Trash2, CheckCircle2, Copy, Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import FormModal from '@/components/FormModal';
import InfoTip from '@/components/InfoTip';
import { HELP } from '@/lib/diagnostics/help';
import * as A from './actions';

/* eslint-disable @typescript-eslint/no-explicit-any -- rows from dynamic selects */

const TABS = [['crashes', 'Crashes'], ['bugs', 'Bug Reports']] as const;
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
  // Bumped when a popup closes: status changes made in it (review / resolve / delete) show in the list at once.
  const [listVersion, setListVersion] = useState(0);
  const closeIssue = useCallback(() => { setOpenIssue(null); setListVersion((v) => v + 1); }, []);
  // Each tab keeps its own search/kind/status (switching tabs does not reset the other one).
  const [filters, setFilters] = useState<Record<Tab, ListFilter>>({ crashes: { q: '', kind: '', status: 'OPEN' }, bugs: { q: '', kind: '', status: 'OPEN' } });

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
      {/* items-end: the tabs sit on the gray line (active = purple underline on it), even though the filters are taller. */}
      <div className="flex items-end justify-between gap-2 flex-wrap border-b border-sidebar-border">
        <div className="flex items-end self-end">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`filter-tab ${tab === k ? 'filter-tab-active' : ''}`}>{label}</button>
          ))}
        </div>
        <IssueFilterBar showKind={tab === 'bugs'} f={filters[tab]} onChange={(f) => setFilters((o) => ({ ...o, [tab]: f }))} />
      </div>

      {tab === 'crashes' && <IssuesView key="c" kind="CRASH" f={filters.crashes} version={listVersion} onOpen={setOpenIssue} />}
      {tab === 'bugs' && <IssuesView key="b" f={filters.bugs} version={listVersion} onOpen={setOpenIssue} />}

      {openIssue && <IssueDrawer id={openIssue} can={can} onClose={closeIssue} onCrash={setOpenCrash} onEvent={setOpenEvent} />}
      {openCrash && <CrashDrawer id={openCrash} can={can} onClose={() => setOpenCrash(null)} />}
      {openEvent && <EventDrawer id={openEvent} onClose={() => setOpenEvent(null)} onIssue={(i) => { setOpenEvent(null); setOpenIssue(i); }} />}
    </div>
  );
}


/** Panel-styled dropdown (CustomSelect) — replaces native <select> so menus match the panel theme. */
function Sel({ value, onChange, options, w = 'w-40' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; w?: string }) {
  // CustomSelect is `w-full` by design; the wrapper gives it the intended width so filters sit side by side.
  return <div className={`${w} shrink-0`}><CustomSelect size="sm" value={value} onChange={onChange} options={options} /></div>;
}
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, ' ').toLowerCase().replace(/^w/, (c) => c.toUpperCase()) }));

/** Visible text field for destructive confirmations (the bare inputs look like plain text). */
const CONFIRM_FIELD = 'mt-1 block w-64 rounded-lg border border-sidebar-border bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-rose-400';
/** Typed confirmation matches ignoring case and surrounding spaces. */
const sameCode = (typed: string, code: string) => typed.trim().toUpperCase() === code.toUpperCase();

/** "Showing 1–10 of 27" · Prev 1 … 4 5 6 … 9 Next (pages are 0-based internally). */
function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  if (!total) return null;
  const pages = Math.ceil(total / size);
  const cur = Math.min(Math.max(0, page), pages - 1);
  const nums = [...new Set([0, cur - 1, cur, cur + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((x, y) => x - y);
  const btn = 'min-w-8 h-8 px-2 rounded-lg border border-sidebar-border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
      <span className="text-zinc-500">Showing <b className="text-foreground">{cur * size + 1}–{Math.min(total, (cur + 1) * size)}</b> of <b className="text-foreground">{total.toLocaleString()}</b></span>
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

/**
 * Horizontal scroll for wide tables. The panel hides native scrollbars globally (globals.css), so
 * this draws a slim bar above the header that appears on hover (and while dragging): drag the
 * thumb, or click the track to jump. Touchpad / Shift+wheel / swipe scrolling still work as usual.
 */
function HScroll({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ w: 0, sw: 0, left: 0 });
  const [dragging, setDragging] = useState(false);
  const measure = useCallback(() => { const el = ref.current; if (el) setM({ w: el.clientWidth, sw: el.scrollWidth, left: el.scrollLeft }); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);
  const INSET = 15; // track is inset like the table's own padding
  const overflow = m.sw > m.w + 1;
  const track = Math.max(1, m.w - 2 * INSET);
  const thumbW = overflow ? Math.min(track, Math.max(48, (m.w / m.sw) * track)) : 0;
  const thumbX = overflow ? (m.left / (m.sw - m.w)) * (track - thumbW) : 0;
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const startX = e.clientX, start = el.scrollLeft, ratio = (m.sw - m.w) / Math.max(1, track - thumbW);
    const move = (ev: PointerEvent) => { el.scrollLeft = start + (ev.clientX - startX) * ratio; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setDragging(true);
  };
  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !ref.current) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    ref.current.scrollBy({ left: (x < thumbX ? -1 : 1) * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div className="relative group/hs">
      {overflow && (
        <div onMouseDown={jump} aria-hidden="true"
          className={`absolute left-[15px] right-[15px] top-1 z-10 h-1.5 rounded-full bg-white/10 cursor-pointer transition-opacity ${dragging ? 'opacity-100' : 'opacity-0 group-hover/hs:opacity-100'}`}>
          <div onPointerDown={drag} className="absolute top-0 h-1.5 rounded-full bg-zinc-400/70 hover:bg-zinc-300 cursor-grab active:cursor-grabbing"
            style={{ width: thumbW, transform: `translateX(${thumbX}px)` }} />
        </div>
      )}
      <div ref={ref} onScroll={measure} className={`overflow-x-auto ${className}`}>{children}</div>
    </div>
  );
}

// ── Issues (fingerprint groups) ─────────────────────────────────────────────
// Filters live in the tab row (IssueFilterBar); the list owns only its page (10 rows).
type ListFilter = { q: string; kind: string; status: string };
const PANEL_LABEL: Record<string, string> = { lms: 'LMS School', lab: 'Lab' };
const PAGE_SIZE = 10;
function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
function IssueFilterBar({ showKind, f, onChange }: { showKind: boolean; f: ListFilter; onChange: (f: ListFilter) => void }) {
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs pb-1.5">
      <div className="relative w-56 shrink-0">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
        <input className="bare-input bg-transparent pl-7 pr-2 py-1.5 w-full" placeholder="Search title…" value={f.q} onChange={(e) => onChange({ ...f, q: e.target.value })} autoComplete="off" spellCheck={false} />
      </div>
      {showKind && <Sel w="w-36" value={f.kind} onChange={(v) => onChange({ ...f, kind: v })} options={[{ value: '', label: 'All kinds' }, ...opts(['CRASH', 'ERROR', 'WARNING', 'USER_REPORT'])]} />}
      <Sel w="w-36" value={f.status} onChange={(v) => onChange({ ...f, status: v })} options={[{ value: 'OPEN', label: 'Open' }, { value: '', label: 'Any status' }, ...opts(['NEW', 'REOPENED', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'RESOLVED', 'DELETE_PENDING', 'DELETED'])]} />
    </div>
  );
}
function IssuesView({ kind, f, version, onOpen }: { kind?: string; f: ListFilter; version: number; onOpen: (id: string) => void }) {
  const q = useDebounced(f.q.trim());
  const filterKey = `${q}|${f.kind}|${f.status}`;
  const [pg, setPg] = useState({ key: filterKey, page: 0 });
  const page = pg.key === filterKey ? pg.page : 0; // any filter change → back to page 1
  const [data, setData] = useState<{ rows: any[]; total: number; page: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    A.listIssues({ kind: kind ?? (f.kind || undefined), status: f.status || undefined, q: q || undefined, page, pageSize: PAGE_SIZE })
      .then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)));
  }, [kind, f.kind, f.status, q, page, version]);
  return (
    <>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <GlassCard className="!p-0 overflow-hidden">
        <HScroll className="px-[15px] pt-3.5 pb-2.5">
          <table className="data-table data-table-rich min-w-[1100px] text-xs">
            <thead><tr className="border-b border-sidebar-border h-[40px]">
              <th>Bug ID</th><th>Panel</th><th>Kind</th><th>Severity</th><th>Issue</th><th>Product</th><th>Count</th><th>Schools</th><th>Machines</th><th>Versions</th><th>First seen</th><th>Last seen</th><th>Status</th>
            </tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-white/5" onClick={() => onOpen(r.id)}>
                  <td className="font-mono">{r.code}</td><td className="whitespace-nowrap">{PANEL_LABEL[r.panel] ?? r.panel}</td><td>{r.kind}</td><td><Sev s={r.severity} /></td>
                  <td className="max-w-[340px] truncate" title={r.title}>{r.title}</td><td>{r.product_id ?? '—'}</td>
                  <td className="font-semibold">{Number(r.occurrence_count).toLocaleString()}</td><td>{r.schools}</td><td>{r.machines}</td>
                  <td className="max-w-[120px] truncate">{r.affected_versions.join(', ')}</td><td className="whitespace-nowrap">{fmt(r.first_seen_at)}</td>
                  <td className="whitespace-nowrap">{fmt(r.last_seen_at)}</td><td><StatusPill s={r.status} reopened={r.reopen_count} /></td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={13} className="text-center text-zinc-500 py-6">Nothing here.</td></tr>}
            </tbody>
          </table>
        </HScroll>
      </GlassCard>
      <Pager page={data?.page ?? page} total={data?.total ?? 0} size={PAGE_SIZE} onPage={(p) => setPg({ key: filterKey, page: p })} />
    </>
  );
}

const StatusPill = ({ s, reopened }: { s: string; reopened?: number }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${s === 'RESOLVED' || s === 'DELETED' ? 'border-emerald-500/30 text-emerald-400' : s === 'REOPENED' || s === 'NEW' ? 'border-rose-500/30 text-rose-400' : 'border-amber-500/30 text-amber-400'}`}>
    {s.replace('_', ' ')}{reopened ? ` ×${reopened}` : ''}
  </span>
);

// ── Drawers ────────────────────────────────────────────────────────────────
/** Puts `value` on the clipboard; true only when the browser actually accepted it. */
async function writeClipboard(value: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; } catch { /* blocked / unavailable → legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = value; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Copies `text` (or what `get()` returns). Shows "Copied" only when it really worked, else "Copy failed" —
 *  never a false "Copied" that leaves the previous record on the clipboard. */
function CopyButton({ text, get, label, className = '' }: { text?: string; get?: () => string | Promise<string>; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === 'busy') return;
    setState('busy');
    const value = get ? await get() : text ?? '';
    const ok = await writeClipboard(value);
    setState(ok ? 'ok' : 'fail');
    setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" onClick={copy} title={state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : 'Copy'} aria-label={label ?? 'Copy'}
      className={`inline-flex items-center gap-1 text-zinc-400 hover:text-foreground transition-colors ${className}`}>
      {state === 'ok' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : state === 'fail' ? <X className="w-3.5 h-3.5 text-rose-400" /> : <Copy className="w-3.5 h-3.5" />}
      {label && <span className={`text-xs ${state === 'fail' ? 'text-rose-400' : ''}`}>{state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : state === 'busy' ? 'Copying…' : label}</span>}
    </button>
  );
}

function Drawer({ title, onClose, copy, children }: { title: React.ReactNode; onClose: () => void; copy?: () => string | Promise<string>; children: React.ReactNode }) {
  // Portal: a transformed ancestor would otherwise trap `fixed` (see FormModal). Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface-hover border border-sidebar-border shadow-2xl p-5 space-y-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-foreground break-all">{title}</h3>
          <div className="flex items-center gap-1 shrink-0">
            {copy && <CopyButton get={copy} label="Copy all" className="filter-tab" />}
            <button onClick={onClose} aria-label="Close" className="filter-tab"><X className="w-4 h-4" /></button>
          </div></div>
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
    <Drawer title={<>{i.code} · {i.title}</>} onClose={onClose} copy={async () => {
      // Full record of each crash (system info, stack, timeline…), not just the list row — up to 20.
      const crashes = await Promise.all(((d.crashes ?? []) as any[]).slice(0, 20).map((c) => A.getCrash(c.id).then((r) => (r.ok ? r.data.crash : c)).catch(() => c)));
      return JSON.stringify({ bug: i, crashes, events: d.events ?? [], artifacts: d.artifacts ?? [] }, null, 2);
    }}>
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
    <Drawer title={<>{c.code} · {c.event_type}</>} onClose={onClose} copy={() => JSON.stringify(c, null, 2)}>
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
    <Drawer title={<>{e.event_type} · <Sev s={e.severity} /></>} onClose={onClose} copy={() => JSON.stringify(e, null, 2)}>
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
