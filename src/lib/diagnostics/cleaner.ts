// Siddesh Logs — ingest "cleaner": the middle layer between a device batch and the database.
// Only data worth keeping is stored, and one device can never flood the tables:
//   • DEBUG noise is dropped;
//   • empty values are pruned from `data`, long strings are capped;
//   • identical events inside one batch collapse into one row (data.collapsed = n);
//   • per device per UTC day: at most CLEANER.infoPerDevicePerDay INFO rows and
//     CLEANER.warnPerDevicePerDay WARNING+ rows are stored — the rest are acknowledged
//     (so the client clears its queue) but never written;
//   • storage guard (MongoDB free tier, 512 MB): from 80 % used only WARNING+ is stored,
//     from 95 % only CRITICAL/FATAL — so the database never hits the hard limit.
// Pure (no I/O) → unit-tested; the route supplies today's per-device counts.

export const CLEANER = { infoPerDevicePerDay: 3000, warnPerDevicePerDay: 1000, maxString: 500, maxDepth: 6, pressureWarnPct: 80, pressureCriticalPct: 95 } as const;

type CleanableRow = {
  severity: string; event_type: string; module: string | null; action: string | null; feature: string | null;
  message: string | null; session_id: string | null; data: unknown;
};
export type CleanStats = { debug: number; collapsed: number; quota: number; pressure: number };

/** Removes null / '' / {} / [] recursively and caps strings. */
export function prune(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') { const s = v.trim(); return s ? (s.length > CLEANER.maxString ? `${s.slice(0, CLEANER.maxString)}…` : s) : undefined; }
  if (typeof v !== 'object') return v;
  if (depth >= CLEANER.maxDepth) return undefined;
  if (Array.isArray(v)) { const a = v.map((x) => prune(x, depth + 1)).filter((x) => x !== undefined); return a.length ? a : undefined; }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const p = prune(x, depth + 1); if (p !== undefined) out[k] = p; }
  return Object.keys(out).length ? out : undefined;
}

const isInfo = (s: string) => s === 'DEBUG' || s === 'INFO';
/** 0 = INFO, 1 = WARNING / ERROR, 2 = CRITICAL / FATAL (what survives storage pressure). */
const rank = (s: string) => (s === 'CRITICAL' || s === 'FATAL' ? 2 : isInfo(s) ? 0 : 1);

/**
 * @param usedToday rows this device already stored today ({ info, warn }), from the DB.
 * @param storagePct how full the logs database is (0–100+).
 * Returns the rows to store (input order kept) plus what was dropped and why.
 */
export function cleanBatch<R extends CleanableRow>(rows: R[], usedToday: { info: number; warn: number }, storagePct = 0): { keep: R[]; stats: CleanStats } {
  const stats: CleanStats = { debug: 0, collapsed: 0, quota: 0, pressure: 0 };
  const minRank = storagePct >= CLEANER.pressureCriticalPct ? 2 : storagePct >= CLEANER.pressureWarnPct ? 1 : 0;
  const firstByKey = new Map<string, R>();
  const counts = new Map<R, number>();
  const unique: R[] = [];
  for (const r of rows) {
    if (r.severity === 'DEBUG') { stats.debug++; continue; }
    if (rank(r.severity) < minRank) { stats.pressure++; continue; }
    r.data = prune(r.data) ?? null;
    const key = JSON.stringify([r.event_type, r.severity, r.module, r.action, r.feature, r.message, r.session_id, r.data]);
    const first = firstByKey.get(key);
    if (first) { counts.set(first, (counts.get(first) ?? 1) + 1); stats.collapsed++; continue; }
    firstByKey.set(key, r);
    unique.push(r);
  }
  let info = usedToday.info, warn = usedToday.warn;
  const keep: R[] = [];
  for (const r of unique) {
    const n = counts.get(r);
    if (n) r.data = { ...((r.data as Record<string, unknown>) ?? {}), collapsed: n };
    if (isInfo(r.severity)) { if (info >= CLEANER.infoPerDevicePerDay) { stats.quota++; continue; } info++; }
    else { if (warn >= CLEANER.warnPerDevicePerDay) { stats.quota++; continue; } warn++; }
    keep.push(r);
  }
  return { keep, stats };
}
