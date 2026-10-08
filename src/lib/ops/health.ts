// ============================================================================
// Siddesh Operations Center — pure logic (no I/O, unit-tested).
//
// HEALTH SCORE (documented, deterministic). Start at 100 and subtract capped penalties,
// each computed ONLY from metrics that are actually available (missing data = no penalty,
// and if nothing is available the status is UNKNOWN, never a made-up "100"):
//   crash rate   (crashes / active devices, 24h)      : 10 pts per 1%        cap 30
//   error rate   (error events / all events, 24h)     : 2 pts per 1%         cap 20
//   API errors   (failed / all API calls, range)      : 2 pts per 1%         cap 10
//   API P95 over threshold                             : 5
//   open incidents: CRITICAL 15 each, other 5 each    :                       cap 30
//   open alerts:   CRITICAL 5 each, WARNING 2 each    :                       cap 10
//   providers:     DOWN 10 each, DEGRADED 4 each      :                       cap 20
//   DB / storage usage vs known quota: >80% 5, >90% 10 (each)
// Status: ≥ 90 HEALTHY · ≥ 70 WARNING · < 70 CRITICAL · no inputs → UNKNOWN.
// ============================================================================

export type Status = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export type ScoreInput = {
  crashes24h?: number | null; activeDevices24h?: number | null;
  errors24h?: number | null; events24h?: number | null;
  apiFailed?: number | null; apiTotal?: number | null; apiP95Ms?: number | null; apiP95ThresholdMs?: number;
  openIncidents?: { severity: string }[]; openAlerts?: { level: string }[];
  providers?: { status: string | null }[];
  dbUsagePct?: number | null; storageUsagePct?: number | null;
};
export type Penalty = { reason: string; points: number };

const cap = (v: number, c: number) => Math.min(c, Math.max(0, v));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function healthScore(i: ScoreInput): { score: number | null; status: Status; penalties: Penalty[] } {
  const p: Penalty[] = [];
  let inputs = 0;
  if (num(i.crashes24h) && num(i.activeDevices24h) && i.activeDevices24h > 0) {
    inputs++;
    const rate = (i.crashes24h / i.activeDevices24h) * 100;
    p.push({ reason: `Crash rate ${rate.toFixed(2)}%`, points: cap(rate * 10, 30) });
  }
  if (num(i.errors24h) && num(i.events24h) && i.events24h > 0) {
    inputs++;
    const rate = (i.errors24h / i.events24h) * 100;
    p.push({ reason: `Error rate ${rate.toFixed(2)}%`, points: cap(rate * 2, 20) });
  }
  if (num(i.apiFailed) && num(i.apiTotal) && i.apiTotal > 0) {
    inputs++;
    const rate = (i.apiFailed / i.apiTotal) * 100;
    p.push({ reason: `API error rate ${rate.toFixed(2)}%`, points: cap(rate * 2, 10) });
  }
  if (num(i.apiP95Ms) && num(i.apiP95ThresholdMs)) {
    inputs++;
    if (i.apiP95Ms > i.apiP95ThresholdMs) p.push({ reason: `API P95 ${Math.round(i.apiP95Ms)} ms > ${i.apiP95ThresholdMs} ms`, points: 5 });
  }
  // Incidents/alerts only deduct — "no incidents" alone is not evidence the products are healthy.
  if (i.openIncidents) {
    const pts = i.openIncidents.reduce((s, x) => s + (x.severity === 'CRITICAL' ? 15 : 5), 0);
    if (pts) p.push({ reason: `${i.openIncidents.length} open incident(s)`, points: cap(pts, 30) });
  }
  if (i.openAlerts) {
    const pts = i.openAlerts.reduce((s, x) => s + (x.level === 'CRITICAL' ? 5 : x.level === 'WARNING' ? 2 : 0), 0);
    if (pts) p.push({ reason: `${i.openAlerts.length} open alert(s)`, points: cap(pts, 10) });
  }
  if (i.providers?.length) {
    inputs++;
    const down = i.providers.filter((x) => x.status === 'DOWN').length;
    const deg = i.providers.filter((x) => x.status === 'DEGRADED').length;
    if (down || deg) p.push({ reason: `${down} provider(s) down, ${deg} degraded`, points: cap(down * 10 + deg * 4, 20) });
  }
  for (const [label, v] of [['Database', i.dbUsagePct], ['Storage', i.storageUsagePct]] as const) {
    if (!num(v)) continue;
    inputs++;
    if (v > 90) p.push({ reason: `${label} at ${v.toFixed(1)}% of quota`, points: 10 });
    else if (v > 80) p.push({ reason: `${label} at ${v.toFixed(1)}% of quota`, points: 5 });
  }
  if (!inputs) return { score: null, status: 'UNKNOWN', penalties: [] };
  const penalties = p.filter((x) => x.points > 0);
  const score = Math.round((100 - penalties.reduce((s, x) => s + x.points, 0)) * 10) / 10;
  return { score: Math.max(0, score), status: statusOf(score), penalties };
}

export function statusOf(score: number | null): Status {
  if (score === null) return 'UNKNOWN';
  return score >= 90 ? 'HEALTHY' : score >= 70 ? 'WARNING' : 'CRITICAL';
}

// ── Heartbeat state ──────────────────────────────────────────────────────────
export type HeartbeatState = 'ONLINE' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
export function heartbeatState(lastSeen: string | null | undefined, now: number, onlineMin: number, staleMin: number): HeartbeatState {
  const t = lastSeen ? Date.parse(lastSeen) : NaN;
  if (!Number.isFinite(t)) return 'UNKNOWN';
  const age = (now - t) / 60_000;
  return age <= onlineMin ? 'ONLINE' : age <= staleMin ? 'STALE' : 'OFFLINE';
}

// ── Versions ─────────────────────────────────────────────────────────────────
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10));
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10));
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const x = Number.isFinite(pa[k]) ? pa[k] : 0, y = Number.isFinite(pb[k]) ? pb[k] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
export function versionDistribution(versions: (string | null | undefined)[]) {
  const counts = new Map<string, number>();
  for (const v of versions) counts.set(v || 'unknown', (counts.get(v || 'unknown') ?? 0) + 1);
  const total = versions.length || 1;
  const known = [...counts.keys()].filter((v) => v !== 'unknown');
  const latest = known.sort(compareVersions).at(-1) ?? null;
  const rows = [...counts.entries()].map(([version, n]) => ({ version, devices: n, pct: Math.round((n / total) * 1000) / 10 }))
    .sort((x, y) => (x.version === 'unknown' ? 1 : y.version === 'unknown' ? -1 : compareVersions(y.version, x.version)));
  const outdated = latest ? versions.filter((v) => v && compareVersions(v, latest) < 0).length : 0;
  return { latest, rows, outdated };
}

// ── Deployment correlation (labelled "Potential Regression", never causation) ─
export function regressionCheck(before: { errors: number; crashes: number; devices: number }, after: { errors: number; crashes: number; devices: number }) {
  const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
  const eB = rate(before.errors, before.devices), eA = rate(after.errors, after.devices);
  const cB = rate(before.crashes, before.devices), cA = rate(after.crashes, after.devices);
  // Need real volume after release + a clear jump (≥ 2× and above a floor) to flag.
  const flagged = after.devices >= 3 && ((eA >= 2 * eB && after.errors >= 10) || (cA >= 2 * cB && after.crashes >= 3));
  return { flagged, label: flagged ? 'Potential Regression' : null, errorsPerDevice: { before: eB, after: eA }, crashesPerDevice: { before: cB, after: cA } };
}

// ── Alert rules ──────────────────────────────────────────────────────────────
export const RULE_METRICS = {
  crash_rate_pct: 'Crash rate % (24h, per active device)',
  error_rate_pct: 'Error rate % (24h, of all events)',
  api_error_rate_pct: 'API error rate % (1h)',
  api_p95_ms: 'API P95 latency ms (1h)',
  db_usage_pct: 'Database usage % of quota',
  storage_usage_pct: 'Storage usage % of quota',
  bandwidth_usage_pct: 'Bandwidth usage % of quota',
  offline_devices_pct: 'Offline devices % (seen in last 7d)',
  fleet_cpu_p95: 'Device CPU P95 %',
  fleet_ram_p95: 'Device RAM P95 %',
  fleet_disk_p95: 'Device disk P95 %',
  providers_down: 'Providers down (count)',
  health_score: 'Overall health score',
} as const;
export type RuleMetric = keyof typeof RULE_METRICS;

export function compare(op: string, v: number, t: number): boolean {
  return op === '>' ? v > t : op === '>=' ? v >= t : op === '<' ? v < t : op === '<=' ? v <= t : false;
}

/** Decide what a rule does this evaluation. `for_minutes` requires the breach to persist. */
export function evaluateRule(rule: { op: string; threshold: number; for_minutes: number; breach_since: string | null }, value: number | null | undefined, now: number):
  { action: 'none' | 'pending' | 'fire' | 'clear'; breachSince: string | null } {
  if (!num(value)) return { action: 'none', breachSince: rule.breach_since }; // no data → never fire
  if (!compare(rule.op, value, rule.threshold)) return { action: 'clear', breachSince: null };
  const since = rule.breach_since ?? new Date(now).toISOString();
  return { action: now - Date.parse(since) >= rule.for_minutes * 60_000 ? 'fire' : 'pending', breachSince: since };
}

export const DEFAULT_RULES: { name: string; metric: RuleMetric; op: string; threshold: number; for_minutes: number; level: string; create_incident: boolean }[] = [
  { name: 'Crash rate high', metric: 'crash_rate_pct', op: '>', threshold: 2, for_minutes: 5, level: 'CRITICAL', create_incident: true },
  { name: 'API errors high', metric: 'api_error_rate_pct', op: '>', threshold: 5, for_minutes: 5, level: 'CRITICAL', create_incident: true },
  { name: 'Database usage high', metric: 'db_usage_pct', op: '>', threshold: 80, for_minutes: 0, level: 'WARNING', create_incident: false },
  { name: 'Storage usage critical', metric: 'storage_usage_pct', op: '>', threshold: 90, for_minutes: 0, level: 'CRITICAL', create_incident: false },
  { name: 'Bandwidth usage high', metric: 'bandwidth_usage_pct', op: '>', threshold: 80, for_minutes: 0, level: 'WARNING', create_incident: false },
  { name: 'Device disk nearly full', metric: 'fleet_disk_p95', op: '>', threshold: 85, for_minutes: 0, level: 'WARNING', create_incident: false },
  { name: 'Provider down', metric: 'providers_down', op: '>=', threshold: 1, for_minutes: 10, level: 'CRITICAL', create_incident: true },
];

// ── Settings ─────────────────────────────────────────────────────────────────
export type OpsConfig = {
  onlineMinutes: number; staleMinutes: number; apiP95ThresholdMs: number;
  rawDays: number; hourlyDays: number; dailyDays: number; resolvedAlertDays: number; closedIncidentDays: number;
};
export const DEFAULT_OPS: OpsConfig = {
  onlineMinutes: 6, staleMinutes: 30, apiP95ThresholdMs: 1500,
  rawDays: 7, hourlyDays: 30, dailyDays: 365, resolvedAlertDays: 90, closedIncidentDays: 365,
};
const OPS_RANGES: Record<keyof OpsConfig, [number, number]> = {
  onlineMinutes: [1, 60], staleMinutes: [2, 1440], apiP95ThresholdMs: [50, 60_000],
  rawDays: [1, 90], hourlyDays: [7, 365], dailyDays: [30, 3650], resolvedAlertDays: [7, 365], closedIncidentDays: [30, 3650],
};
export function mergeOps(raw: unknown): OpsConfig {
  const out = { ...DEFAULT_OPS };
  if (raw && typeof raw === 'object') for (const k of Object.keys(OPS_RANGES) as (keyof OpsConfig)[]) {
    const v = Number((raw as Record<string, unknown>)[k]);
    if (Number.isFinite(v) && v >= OPS_RANGES[k][0] && v <= OPS_RANGES[k][1]) out[k] = Math.round(v);
  }
  if (out.staleMinutes <= out.onlineMinutes) out.staleMinutes = out.onlineMinutes + 1;
  return out;
}

export const RANGES = { '15m': 15 * 60_000, '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
export type RangeKey = keyof typeof RANGES;
/** Bucket size chosen so a chart never has more than ~60 points. */
export function bucketSeconds(rangeMs: number): number {
  const steps = [60, 300, 900, 3600, 6 * 3600, 86_400];
  return steps.find((s) => rangeMs / (s * 1000) <= 60) ?? 86_400;
}

/** Freshness label for any externally sourced number. */
export function freshness(fetchedAt: string | null | undefined, now: number, expectedMinutes: number): 'FRESH' | 'STALE' | 'NONE' {
  if (!fetchedAt) return 'NONE';
  return now - Date.parse(fetchedAt) <= expectedMinutes * 2 * 60_000 ? 'FRESH' : 'STALE';
}

export const pct = (used: number | null | undefined, quota: number | null | undefined): number | null =>
  num(used) && num(quota) && quota > 0 ? Math.round((used / quota) * 1000) / 10 : null;
