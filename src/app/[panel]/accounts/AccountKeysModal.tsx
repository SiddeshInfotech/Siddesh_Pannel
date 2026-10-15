'use client';

import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Search, X } from 'lucide-react';
import FormModal from '@/components/FormModal';
import { getAccountKeys, type AccountKeyRow, type AccountKeyStatus, type AccountKind } from './actions';

/** The account whose keys are shown; `id` is the owner reference used on activation_keys. */
export interface KeysTarget {
  kind: AccountKind;
  id: string;
  name: string;
  publicId: string;
}

const STATUS_LABEL: Record<AccountKeyStatus, string> = {
  active: 'Active',
  superseded: 'Superseded',
  expired: 'Expired',
  failed: 'Failed',
  revoked: 'Revoked',
  not_activated: 'Not activated',
};

const STATUS_STYLE: Record<AccountKeyStatus, string> = {
  active: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500',
  superseded: 'bg-sky-500/10 border-sky-500/25 text-sky-500',
  expired: 'bg-amber-500/10 border-amber-500/25 text-amber-500',
  failed: 'bg-rose-500/10 border-rose-500/25 text-rose-500',
  revoked: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-400',
  not_activated: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-400',
};

const IST = 'Asia/Kolkata';
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '—';

/** Clickable key count shown in each account row. */
export function KeyCountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-sidebar-border text-[11px] font-semibold text-foreground hover:bg-zinc-500/10 transition-colors cursor-pointer"
      title="Show licence keys"
    >
      <KeyRound className="w-3 h-3 text-zinc-500" />
      {count}
    </button>
  );
}

export default function AccountKeysModal({ target, onClose }: { target: KeysTarget | null; onClose: () => void }) {
  // Result tagged with the account it belongs to, so a stale answer is never shown for another row.
  const [result, setResult] = useState<{ for: string; rows?: AccountKeyRow[]; error?: string } | null>(null);
  const tag = target ? `${target.kind}:${target.id}` : '';

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    getAccountKeys(target.kind, target.id).then((res) => {
      if (!cancelled) setResult(res.ok ? { for: tag, rows: res.data } : { for: tag, error: res.error });
    });
    return () => { cancelled = true; };
  }, [target, tag]);

  const current = result?.for === tag ? result : null;
  const rows = current?.rows ?? null;
  const error = current?.error ?? null;

  // Search text, also tagged so it starts empty for each account opened.
  const [search, setSearch] = useState({ for: '', q: '' });
  const query = search.for === tag ? search.q : '';
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return rows;
    // Matches the key, status, time left and the dates as displayed (e.g. "15 Oct", "expired").
    return rows.filter((k) =>
      [k.key, STATUS_LABEL[k.status], k.timeLeft, fmt(k.createdAt), fmt(k.activatedAt)]
        .some((v) => v.toLowerCase().includes(q)));
  }, [rows, query]);

  return (
    <FormModal
      open={!!target}
      onClose={onClose}
      panelClassName="glass-interactive w-full max-w-4xl max-h-[85vh] overflow-y-auto relative animate-slide-up rounded-2xl p-5"
    >
      {target && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-foreground">Licence keys</h3>
              <p className="text-xs text-zinc-500">
                {target.name} · <span className="cell-mono">{target.publicId}</span>
                {rows && shown && (shown.length === rows.length
                  ? ` · ${rows.length} key${rows.length === 1 ? '' : 's'}`
                  : ` · ${shown.length} of ${rows.length} keys`)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {rows && rows.length > 0 && (
                <div className="relative w-[220px] rounded-lg border border-sidebar-border">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                  <input
                    value={query}
                    onChange={(e) => setSearch({ for: tag, q: e.target.value })}
                    placeholder="Search keys, status, date…"
                    autoFocus
                    className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
                  />
                </div>
              )}
              <button type="button" onClick={onClose} className="icon-btn" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {error ? (
            <p className="text-xs text-rose-500 py-6 text-center">{error}</p>
          ) : !rows ? (
            <p className="text-xs text-zinc-500 py-6 text-center">Loading keys…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">No licence keys for this account.</p>
          ) : shown?.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">No keys match “{query.trim()}”.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table data-table-rich">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Created</th>
                    <th>Activated</th>
                    <th>Time left</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(shown ?? rows).map((k) => (
                    <tr key={k.id}>
                      <td className="cell-mono">{k.key}</td>
                      <td className="cell-muted cell-num">{fmt(k.createdAt)}</td>
                      <td className="cell-muted cell-num">{fmt(k.activatedAt)}</td>
                      <td className="cell-num" title={k.expiresAt ? `Expires ${fmt(k.expiresAt)}` : undefined}>{k.timeLeft}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLE[k.status]}`}>
                          {STATUS_LABEL[k.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </FormModal>
  );
}
