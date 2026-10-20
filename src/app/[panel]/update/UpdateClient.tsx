'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Circle, Clock, Server, Search, Wifi, WifiOff, ShieldAlert, KeyRound,
  CheckCircle2, AlertTriangle, X, CalendarX, Ban, Replace, Loader2, Info, Layers, ChevronDown,
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import ProductTypeMenu from '@/components/ProductTypeMenu';
import FormModal from '@/components/FormModal';
import EntityAvatar from '@/components/EntityAvatar';
import { productFilterOptionsFor, UNRESOLVED_PRODUCT_FILTER_VALUE, productDisplayName } from '@/lib/productIdentity';
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
// Readable in both themes: tinted node + strong icon colour; the event label itself stays neutral.
const TONE: Record<Tone, { node: string; text: string }> = {
  ok:     { node: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600', text: 'text-emerald-600' },
  info:   { node: 'bg-sky-500/10 border-sky-500/30 text-sky-600',             text: 'text-sky-600' },
  warn:   { node: 'bg-amber-500/10 border-amber-500/30 text-amber-600',       text: 'text-amber-600' },
  danger: { node: 'bg-rose-500/10 border-rose-500/30 text-rose-600',          text: 'text-rose-600' },
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

// Plain-language meaning of an ATTESTATION_ISSUE's reason_code (bounded set from
// attestationTelemetry.ts). `risk` marks the codes that point at tampering / forgery; the rest are
// device or setup problems that look alarming but are not an attack on their own.
const ATTEST_REASON: Record<string, { text: string; risk: boolean }> = {
  PUBKEY_MISSING:         { risk: false, text: 'The app sent no device key: its secure key store failed to set up on this PC (app/installer problem, not an attack).' },
  ROOT_UNTRUSTED:         { risk: false, text: "The device's hardware key is not certified by Google. Common on uncertified Android panels and custom builds; not tampering by itself." },
  CHAIN_MISSING:          { risk: false, text: 'The device sent no attestation certificates (old app version or unsupported device).' },
  CHAIN_INVALID:          { risk: false, text: "The device's attestation certificates are broken or expired." },
  SECURITY_LEVEL_INVALID: { risk: false, text: 'The key is software-only, not stored in secure hardware.' },
  EXTENSION_UNPARSEABLE:  { risk: false, text: 'The attestation data could not be read.' },
  CLAIM_MISSING:          { risk: false, text: 'The attestation contained no device claim.' },
  CLOCK_SKEW:             { risk: false, text: "The device's clock is too far from server time." },
  SERVER_MISCONFIGURED:   { risk: false, text: 'Server-side problem: no trusted attestation roots are configured.' },
  ORIGIN_INVALID:         { risk: true,  text: 'The key was imported, not generated inside the device hardware.' },
  PUBKEY_MISMATCH:        { risk: true,  text: 'The device key does not match its attestation: possible cloned or modified install.' },
  CHALLENGE_MISMATCH:     { risk: true,  text: 'The attestation answered a different challenge: possible replay.' },
  SIGNATURE_INVALID:      { risk: true,  text: 'The attestation signature is invalid: possible forgery.' },
  CERT_REVOKED:           { risk: true,  text: "The device's attestation certificate has been revoked." },
  NONCE_REPLAY:           { risk: true,  text: 'The same attestation was sent twice: possible replay attack.' },
};
const STAGE_LABEL: Record<string, string> = { 'terms-accept': 'Terms acceptance', activate: 'Activation' };

const SECURITY_EVENTS = new Set<string>(SECURITY_EVENT_TYPES);

type StatusFilter = 'all' | 'online' | 'offline' | KeyState;

const KEYS_PER_PAGE = 20;

// Local noon in IST for a YYYY-MM-DD day key — formatting midnight in the browser's own
// timezone could land on the neighbouring IST day for viewers outside India.
const dayLabelFor = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });

type TimelineState = { status: 'loading' | 'ready' | 'error'; events: Ev[]; error?: string };

export default function UpdateClient({
  devices, securityEvents, onlineCount, panel,
}: {
  devices: Device[]; securityEvents: Ev[]; onlineCount: number; serverTime: string; panel: 'lms' | 'lab';
}) {
  const [q, setQ] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showLegend, setShowLegend] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [page, setPage] = useState(1);
  const [isProductMenuOpen, setIsProductMenuOpen] = useState(false);
  const productMenuButtonRef = useRef<HTMLButtonElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const closeProductMenu = React.useCallback(() => setIsProductMenuOpen(false), []);
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
  // Same pagination as Device Monitoring. Clamped so a narrower filter never leaves an empty page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / KEYS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * KEYS_PER_PAGE;
  const pagedKeys = filtered.slice(pageStart, pageStart + KEYS_PER_PAGE);

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All keys' },
    { value: 'online', label: 'Online now' },
    { value: 'offline', label: 'Offline' },
    { value: 'active', label: 'Active' },
    { value: 'expired', label: 'Expired' },
    { value: 'superseded', label: 'Superseded' },
    { value: 'revoked', label: 'Revoked' },
    { value: 'not_activated', label: 'Not activated' },
  ];
  const productOptions = productFilterOptionsFor(panel);

  // Fingerprints that have at least one security event (for the red row marker).
  const flaggedFingerprints = useMemo(() => new Set(securityEvents.map((e) => e.fingerprint)), [securityEvents]);
  const securityAlerts = useMemo(
    () => securityEvents.filter((e) => SECURITY_EVENTS.has(e.type))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [securityEvents]
  );
  const securityAlertCount = securityAlerts.length;
  // The device an alert came from: the key that device runs now (active), else its newest key row.
  const deviceFor = (fingerprint: string) => {
    const rows = devices.filter((d) => d.fingerprint === fingerprint);
    return rows.find((d) => d.keyState === 'active') ?? rows[0] ?? null;
  };

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

  return (
    <div className="space-y-4 max-w-7xl mx-auto text-foreground">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-2xl font-bold text-foreground">Update &amp; Online Sync</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="stat-chip"><Server className="w-3.5 h-3.5 text-accent-violet" /> All keys <span className="stat-chip-value">{counts.all}</span></span>
            {/* Devices, not key rows: one machine online is one, however many keys it has held. */}
            <span className="stat-chip"><span className="live-dot" /> Online now <span className="stat-chip-value">{onlineCount}</span></span>
            <span className="stat-chip"><WifiOff className="w-3.5 h-3.5" /> Offline <span className="stat-chip-value">{counts.offline}</span></span>
            <span className="stat-chip"><CalendarX className="w-3.5 h-3.5 text-rose-500" /> Expired <span className="stat-chip-value">{counts.expired}</span></span>
            <button
              type="button"
              onClick={() => setShowSecurity(true)}
              title="Show security alerts"
              className={`stat-chip cursor-pointer hover:border-accent-violet/40 ${securityAlertCount > 0 ? '!text-rose-500 !border-rose-500/40' : ''}`}
            >
              <ShieldAlert className="w-3.5 h-3.5" /> Security alerts
              <span className={`stat-chip-value ${securityAlertCount > 0 ? '!text-rose-500' : ''}`}>{securityAlertCount}</span>
            </button>
          </div>
        </div>

        {/* Filter bar — same underlined tabs as Keys / Monitoring; search + legend on the right. */}
        <div ref={filterBarRef} className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border mt-2">
          <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
            {statusTabs.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => { setStatusFilter(t.value); setProductFilter('all'); setPage(1); }}
                className={`filter-tab ${statusFilter === t.value && productFilter === 'all' ? 'filter-tab-active' : ''}`}
              >
                {t.label}
                <span className="filter-tab-count">{counts[t.value]}</span>
              </button>
            ))}

            <div className="relative">
              <button
                ref={productMenuButtonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={isProductMenuOpen}
                onClick={() => setIsProductMenuOpen((v) => !v)}
                className={`filter-tab ${productFilter !== 'all' ? 'filter-tab-active' : ''}`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {productFilter === 'all'
                    ? 'All Products'
                    : productOptions.find((o) => o.value === productFilter)?.label || 'All Products'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${isProductMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              <ProductTypeMenu
                open={isProductMenuOpen}
                onClose={closeProductMenu}
                anchorRef={productMenuButtonRef}
                boundaryRef={filterBarRef}
                options={productOptions}
                value={productFilter}
                onSelect={(v) => { setProductFilter(v); setStatusFilter('all'); setPage(1); setIsProductMenuOpen(false); }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
            <div className="relative flex-1 xl:w-[260px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Search school, ID, or licence key…"
                className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowLegend((v) => !v)}
              className={`icon-btn !w-7 !h-7 shrink-0 ${showLegend ? '!text-accent-violet !border-accent-violet/40' : ''}`}
              title="What do the statuses mean?"
              aria-label="What do the statuses mean?"
              aria-pressed={showLegend}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Security alerts pop-up (opened by the "Security alerts" chip). */}
      {showSecurity && (
        <FormModal
          open
          onClose={() => setShowSecurity(false)}
          panelClassName="glass relative w-[min(1100px,96vw)] max-h-[85vh] rounded-2xl flex flex-col overflow-hidden animate-slide-up"
        >
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-rose-500/10 border border-rose-500/20 text-rose-500">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-foreground tracking-tight">Security alerts ({securityAlertCount})</h3>
                <p className="text-xs text-zinc-500 font-medium">Expiry tampering, content-key decrypt failures and attestation issues reported by devices — newest first</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowSecurity(false)} className="icon-btn shrink-0" aria-label="Close" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-auto">
            {!securityAlertCount ? (
              <p className="text-sm text-zinc-500 text-center py-10">No security alerts.</p>
            ) : (
              <table className="w-full table-fixed text-left text-xs">
                <colgroup><col className="w-40" /><col className="w-48" /><col /><col className="w-40" /><col className="w-56" /><col className="w-24" /></colgroup>
                <thead className="text-zinc-500 sticky top-0 bg-background">
                  <tr>{['Time (IST)', 'Alert', 'What it means', 'Result', 'Device', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {securityAlerts.map((e) => {
                    const { label, Icon, tone } = eventStyle(e.type, e.detail);
                    const reason = typeof e.detail?.reason === 'string' ? e.detail.reason
                      : typeof e.detail?.reason_detail === 'string' ? e.detail.reason_detail : null;
                    const count = typeof e.detail?.count === 'number' && e.detail.count > 1 ? e.detail.count : null;
                    const appV = typeof e.detail?.app_version === 'string' ? e.detail.app_version : null;
                    const code = typeof e.detail?.reason_code === 'string' ? e.detail.reason_code : null;
                    const meaning = code ? ATTEST_REASON[code] : undefined;
                    const blocked = e.detail?.action === 'REJECTED';
                    const stage = typeof e.detail?.stage === 'string' ? STAGE_LABEL[e.detail.stage] ?? e.detail.stage : null;
                    const model = typeof e.detail?.device_model === 'string' ? e.detail.device_model : null;
                    const d = deviceFor(e.fingerprint);
                    return (
                      <tr key={e.id} className="border-t border-sidebar-border align-top">
                        <td className="px-4 py-2 text-zinc-500 tabular-nums">
                          {e.createdAt ? new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }) : '—'}
                        </td>
                        <td className={`px-4 py-2 font-semibold ${TONE[tone].text}`}>
                          <span className="inline-flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 shrink-0" /> {label}</span>
                          {count && <span className="ml-1 text-zinc-500 font-normal">×{count}</span>}
                        </td>
                        <td className="px-4 py-2 break-words">
                          {meaning ? <>
                            <span className={`inline-block mb-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${meaning.risk ? 'border-rose-500/40 text-rose-500' : 'border-amber-500/40 text-amber-600'}`}>
                              {meaning.risk ? 'Possible tampering' : 'Not an attack'}
                            </span>
                            <div className="text-foreground">{meaning.text}</div>
                            {reason && <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{code} · {reason}</div>}
                          </> : <span className="text-foreground">{reason ? (TAMPER_REASON[reason] ?? reason) : '—'}</span>}
                        </td>
                        <td className="px-4 py-2">
                          {typeof e.detail?.action === 'string' ? (
                            <span className={`font-semibold ${blocked ? 'text-rose-500' : 'text-amber-600'}`}>{blocked ? 'Blocked' : 'Allowed (logged only)'}</span>
                          ) : <span className="text-zinc-500">—</span>}
                          {stage && <div className="text-zinc-500">at {stage}</div>}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">
                          {d ? <>
                            <div className="truncate text-foreground" title={d.schoolName}>{d.schoolName || '—'}</div>
                            <div className="truncate" title={d.activationKey}>{d.productId ? productDisplayName(d.productId) : 'Unknown product'}{appV ? ` · v${appV}` : ''}</div>
                            {model && <div className="truncate text-zinc-500">{model}</div>}
                          </> : <span className="font-mono truncate block" title={e.fingerprint}>{e.fingerprint.slice(0, 12)}…</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {d && (
                            <button type="button" className="filter-tab" onClick={() => { setShowSecurity(false); if (selectedKeyId !== d.id) openKey(d); }}>
                              Timeline
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </FormModal>
      )}

      {/* Status guide pop-up (opened by the i button in the filter bar). */}
      {showLegend && (
        <FormModal
          open
          onClose={() => setShowLegend(false)}
          panelClassName="glass relative w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden animate-slide-up"
        >
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-accent-violet/10 border border-accent-violet/20 text-accent-violet">
                <Info className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-foreground tracking-tight">Status guide</h3>
                <p className="text-xs text-zinc-500 font-medium">What each key status and connection state means</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowLegend(false)} className="icon-btn shrink-0" aria-label="Close" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-5 space-y-6">
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Key status</h4>
              <div className="space-y-2">
                {(Object.keys(KEY_STATE) as KeyState[]).map((st) => (
                  <div key={st} className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                    <span className="w-[96px] shrink-0">
                      <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${KEY_STATE[st].cls}`}>
                        {KEY_STATE[st].label}
                      </span>
                    </span>
                    <span className="text-[13px] text-zinc-400 leading-relaxed">{KEY_STATE[st].help}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Connection</h4>
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                  <span className="w-[96px] shrink-0">
                    <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/25 text-emerald-600 text-[11px] font-semibold">
                      <span className="live-dot" /> Online
                    </span>
                  </span>
                  <span className="text-[13px] text-zinc-400 leading-relaxed">The device sent a heartbeat in the last 6 minutes.</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                  <span className="w-[96px] shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-zinc-400 text-[11px] font-semibold pt-0.5">
                      <Circle className="w-2.5 h-2.5 fill-zinc-500 text-zinc-500" /> Offline
                    </span>
                  </span>
                  <span className="text-[13px] text-zinc-400 leading-relaxed">It has reported before, but not recently.</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                  <span className="w-[96px] shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-zinc-500 text-[11px] font-semibold pt-0.5">
                      <Circle className="w-2.5 h-2.5 text-zinc-500" /> Never seen
                    </span>
                  </span>
                  <span className="text-[13px] text-zinc-400 leading-relaxed">Activated, but no heartbeat yet.</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
                Connection is shown only for the key a device is running now — a superseded key&apos;s device reports for its newer key.
              </p>
            </div>
          </div>
        </FormModal>
      )}

      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich min-w-[1100px]">
            <thead>
              <tr>
                <th>School</th>
                <th>Licence key</th>
                <th>Key status</th>
                <th>Connection</th>
                <th>Expires</th>
                <th>Tier</th>
                <th>Product</th>
                <th className="text-right">Online time</th>
                <th>App</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="!h-auto py-12 text-center text-zinc-500 text-sm">No keys match these filters.</td></tr>
              )}
              {pagedKeys.map((d) => {
                const isSelected = d.id === selectedKeyId;
                const flagged = !!d.fingerprint && flaggedFingerprints.has(d.fingerprint);
                const t = tierStyle(d.securityTier);
                const ks = KEY_STATE[d.keyState];
                const expiredNow = d.keyState === 'expired';
                return (
                  <tr
                    key={d.id}
                    onClick={() => openKey(d)}
                    className={`cursor-pointer ${isSelected ? '[&>td]:!bg-accent-violet/10' : ''}`}
                  >
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="relative">
                          <EntityAvatar name={d.schoolName} size={32} />
                          {flagged && (
                            <span
                              title="Security event on this device"
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center ring-2 ring-[var(--card)]"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </span>
                        <div>
                          <div className="cell-strong">{d.schoolName}</div>
                          <div className="cell-sub">{d.schoolId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="cell-mono cell-muted truncate max-w-[170px]" title={d.activationKey}>
                      {d.activationKey}
                    </td>
                    <td>
                      <span title={ks.help} className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${ks.cls}`}>
                        {ks.label}
                      </span>
                    </td>
                    <td title={d.lastSeenExact}>
                      {d.connection === 'online' && (
                        <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/25 text-emerald-600 text-[11px] font-semibold">
                          <span className="live-dot" /> Online
                        </span>
                      )}
                      {d.connection === 'offline' && (
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-zinc-400 text-xs font-semibold">
                            <Circle className="w-2.5 h-2.5 fill-zinc-600" /> Offline
                          </span>
                          <div className="cell-sub">seen {d.lastSeenAgo}</div>
                        </div>
                      )}
                      {d.connection === 'never' && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-500 text-xs font-semibold">
                          <Circle className="w-2.5 h-2.5 text-zinc-600" /> Never seen
                        </span>
                      )}
                      {d.connection === 'na' && <span className="text-zinc-600 text-xs">—</span>}
                    </td>
                    <td className="cell-num">
                      {d.expiresAtIso ? (
                        <div>
                          <div className={expiredNow ? 'text-rose-500 font-semibold' : ''}>{d.expiresExact}</div>
                          <div className={`cell-sub ${expiredNow ? '!text-rose-500/70' : ''}`}>
                            {expiredNow ? `expired ${d.expiresRelative}` : d.expiresRelative}
                          </div>
                        </div>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                    <td>
                      <span title={d.securityTier} className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap ${t.cls}`}>
                        {t.label}
                      </span>
                    </td>
                    <td>
                      <span
                        title={d.productId ?? 'Unknown'}
                        className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap bg-white/5 border-white/10 text-zinc-300"
                      >
                        {productDisplayName(d.productId)}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1.5 cell-num cell-strong">
                        <Clock className="w-3.5 h-3.5 text-zinc-400" /> {d.totalOnline}
                      </span>
                    </td>
                    <td className="cell-mono cell-muted">{d.appVersion}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-white/5 bg-white/[0.02]">
            <span className="text-[11px] font-bold text-zinc-400">
              Showing <span className="text-foreground">{pageStart + 1}–{Math.min(pageStart + KEYS_PER_PAGE, filtered.length)}</span> of{' '}
              <span className="text-foreground">{filtered.length}</span> keys
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                Prev
              </button>
              {/* Sliding window: first, last, and the current page with its neighbours. */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 1)
                .map((n, idx, arr) => (
                  <React.Fragment key={n}>
                    {idx > 0 && n - arr[idx - 1] > 1 && <span className="px-1 text-[11px] font-bold text-zinc-600">…</span>}
                    <button
                      type="button"
                      onClick={() => setPage(n)}
                      className={`min-w-[32px] px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        n === currentPage ? 'bg-accent-violet text-white shadow-md' : 'bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  </React.Fragment>
                ))}
              <button type="button" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                Next
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Timeline popup — a centered rectangle with the panel's usual backdrop blur. Closes on
          backdrop / Close / re-clicking the same row. */}
      {selectedDevice && (
        <FormModal
          open
          onClose={() => setSelectedKeyId(null)}
          panelClassName="glass relative w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden animate-slide-up"
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-sidebar-border">
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-10 h-10 shrink-0 rounded-[10px] flex items-center justify-center bg-accent-violet/10 border border-accent-violet/20 text-accent-violet">
                  <Clock className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2 min-w-0">
                    <span className="truncate">{selectedDevice.schoolName}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${KEY_STATE[selectedDevice.keyState].cls}`}>
                      {KEY_STATE[selectedDevice.keyState].label}
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 font-medium truncate">Activity timeline · <span className="font-mono">{selectedDevice.activationKey}</span></p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedKeyId(null)} className="icon-btn shrink-0" aria-label="Close timeline" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Key facts */}
            <div className="grid grid-cols-3 gap-2 px-6 py-3 border-b border-sidebar-border">
              {[
                { label: 'Activated', value: selectedDevice.activatedAtIso ? selectedDevice.activatedExact : '—', danger: false },
                {
                  label: selectedDevice.keyState === 'expired' ? 'Expired' : 'Expires',
                  value: selectedDevice.expiresAtIso ? selectedDevice.expiresExact : '—',
                  danger: selectedDevice.keyState === 'expired',
                },
                { label: 'Online total', value: selectedDevice.fingerprint ? selectedDevice.totalOnline : '—', danger: false },
              ].map((f) => (
                <div key={f.label} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{f.label}</div>
                  <div className={`text-[13px] font-semibold truncate ${f.danger ? 'text-rose-500' : 'text-foreground'}`} title={String(f.value)}>{f.value}</div>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {!selectedDevice.fingerprint ? (
                <div className="text-zinc-500 text-sm text-center py-8">This key has not been activated on any device yet, so there is no activity to show.</div>
              ) : timeline?.status === 'error' ? (
                <div className="text-rose-500 text-sm text-center py-8">{timeline.error}</div>
              ) : timeline?.status === 'loading' && timeline.events.length === 0 ? (
                <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm py-8">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading timeline…
                </div>
              ) : eventsByDay.length === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-8">No activity recorded since this key was activated.</div>
              ) : (
                <div className="space-y-5">
                  {eventsByDay.map((group) => (
                    <section key={group.dayKey}>
                      {/* Day divider */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 whitespace-nowrap">
                          {group.dayKey === 'unknown' ? 'Date unknown' : dayLabelFor(group.dayKey)}
                        </span>
                        {group.totalOnline && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 text-[10px] font-semibold whitespace-nowrap">
                            <Wifi className="w-3 h-3" /> {group.totalOnline} online
                          </span>
                        )}
                      </div>

                      {group.events.length === 0 && (
                        <div className="text-xs text-zinc-500 mb-2">
                          Online this day (session continued from the day before) — no new &quot;came online&quot; event.
                        </div>
                      )}

                      {/* Events — a rail links the nodes within the day. */}
                      <ol className="space-y-2">
                        {group.events.map((e, i) => {
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
                          const hasMeta = sessionSecs !== null || appV || ip || (occurrenceCount && occurrenceCount > 1);
                          return (
                            <li key={e.id} className="relative flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                              {/* Connector: from this icon down into the next card's icon (border 1 + padding 12 + half icon 16 − 1). */}
                              {i < group.events.length - 1 && (
                                <span className="absolute left-[28px] top-[44px] -bottom-[21px] w-0.5 rounded-full bg-sidebar-border z-10" aria-hidden="true" />
                              )}
                              <span
                                className={`w-8 h-8 shrink-0 rounded-[10px] border flex items-center justify-center ${c.node}`}
                                aria-hidden="true"
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </span>
                              <div className="min-w-0 flex-1 pt-1">
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="text-[13px] font-semibold text-foreground">{label}</span>
                                  <span className="text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">{timeOfDay}</span>
                                </div>
                                {reason && (
                                  <div className={`text-xs mt-0.5 break-words ${c.text}`}>{TAMPER_REASON[reason] ?? reason}</div>
                                )}
                                {hasMeta && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {sessionSecs !== null && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-[10px] font-medium text-zinc-500">
                                        <Clock className="w-3 h-3" /> {sessionSecs < 60 ? 'under 1m' : humanDuration(sessionSecs)}
                                      </span>
                                    )}
                                    {appV && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-[10px] font-medium text-zinc-500">app {appV}</span>}
                                    {ip && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-[10px] font-medium text-zinc-500 font-mono">{ip}</span>}
                                    {occurrenceCount && occurrenceCount > 1 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-[10px] font-medium text-zinc-500">×{occurrenceCount}</span>}
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  ))}
                </div>
              )}
            </div>
        </FormModal>
      )}
    </div>
  );
}
