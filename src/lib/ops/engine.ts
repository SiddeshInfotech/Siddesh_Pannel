// Siddesh Operations Center — server engine.
// Reads EXISTING sources (device_status heartbeat in Supabase, diag_* telemetry in MongoDB)
// with bounded, indexed queries; writes only small aggregates (MongoDB). Called by the hourly
// cron and, throttled to once a minute, by dashboard loads (so alert rules can honour `for_minutes`).
import 'server-only';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { panelDb, type Panel } from '@/lib/panelTables';
import { decryptAES } from '@/lib/crypto';
import { sendSecurityAlert } from '@/lib/alert';
import { fetchAllPages } from '@/app/[panel]/update/telemetry';
import { col, toRows, toSet } from '@/lib/diagnostics/mongo';
import { activityRefresh, allocCode, eventSeries, percentiles, PROD, sessionCrashStats, storagePressure } from '@/lib/diagnostics/mongoOps';
import { PROVIDERS, GB, type ProviderRow } from './providers';
import { DEFAULT_RULES, LOGS_STORAGE_RULE, evaluateRule, healthScore, heartbeatState, mergeOps, pct, type OpsConfig } from './health';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic documents */
const iso = (ms: number) => new Date(ms).toISOString();
const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]; };
const ERR = ['ERROR', 'CRITICAL', 'FATAL'];

async function opsConfigDoc(panel: string) {
  return (await col('ops_settings')).findOne({ _id: panel as never }, { projection: { config: 1 } });
}

export async function loadOps(panel: Panel): Promise<OpsConfig> {
  return mergeOps((await opsConfigDoc(panel))?.config);
}

// ── Storage utilisation, read live (no provider setup needed) ───────────────
// Free-tier limits by default; override when the plan changes.
const MB = 1024 * 1024;
export const SUPABASE_DB_QUOTA = (Number(process.env.SUPABASE_DB_QUOTA_MB) || 500) * MB;
export const SUPABASE_FILE_QUOTA = (Number(process.env.SUPABASE_STORAGE_QUOTA_MB) || 1024) * MB;

/** Supabase database size, file storage, cache hit and connections from the Postgres catalog. */
export async function supabaseUsage() {
  const [{ data: st, error }, { data: sto }] = await Promise.all([supabaseAdmin.rpc('ops_db_stats'), supabaseAdmin.rpc('ops_storage_stats')]);
  const buckets: { bucket: string; files: number; bytes: number }[] = Array.isArray(sto) ? sto.map((b: any) => ({ bucket: b.bucket, files: Number(b.files), bytes: Number(b.bytes) })) : [];
  const dbBytes = st ? Number(st.db_bytes) : null;
  const fileBytes = buckets.reduce((s, b) => s + b.bytes, 0);
  return {
    connected: !error && !!st, dbBytes, dbQuota: SUPABASE_DB_QUOTA, dbPct: dbBytes === null ? null : (dbBytes / SUPABASE_DB_QUOTA) * 100,
    fileBytes, fileQuota: SUPABASE_FILE_QUOTA, filePct: (fileBytes / SUPABASE_FILE_QUOTA) * 100, buckets,
    cacheHitPct: st?.cache_hit_pct ?? null, connections: st?.connections ?? null, maxConnections: st?.max_connections ?? null,
    largestTables: ((st?.largest_tables ?? []) as any[]).slice(0, 3).map((t) => ({ name: t.name, bytes: Number(t.total_bytes) })),
  };
}

export type DeviceRow = { fp: string; entity: string | null; product: string | null; version: string | null; lastSeen: string | null; state: string };

/** Heartbeat source of truth = existing device_status (written by /api/device/ping). */
export async function loadDevices(panel: Panel, cfg: OpsConfig): Promise<DeviceRow[]> {
  const t = panelDb(panel);
  const { data } = await fetchAllPages<any>((from, to) =>
    t.from('device_status').select('device_fingerprint, school_id, vendor_id, parent_id, app_version, last_seen, product_id')
      .order('device_fingerprint').range(from, to));
  const now = Date.now();
  return data.map((r) => ({
    fp: r.device_fingerprint, entity: r.school_id ?? r.vendor_id ?? r.parent_id ?? null, product: r.product_id ?? null,
    version: r.app_version ?? null, lastSeen: r.last_seen ?? null, state: heartbeatState(r.last_seen, now, cfg.onlineMinutes, cfg.staleMinutes),
  }));
}

/** Infra numbers shared by all panels: provider status, DB + storage usage vs (manual or API) quota. */
export async function infraSnapshot() {
  const [providers, metrics] = await Promise.all([
    col('ops_providers').then((c) => c.find({}, { projection: { credential_enc: 0 } }).toArray()).then(toRows),
    col('ops_provider_metrics').then((c) => c.find({}, { projection: { _id: 0 } }).toArray()).then(toRows),
  ]);
  const byProvider = new Map<string, any[]>();
  for (const m of metrics) byProvider.set(m.provider_id, [...(byProvider.get(m.provider_id) ?? []), m]);
  const find = (metric: string) => metrics.find((m: any) => m.metric === metric && m.value !== null);
  const quotaOf = (metric: string) => metrics.find((m: any) => m.metric === metric && m.quota !== null);
  const dbUsed = find('db_bytes'), dbQuota = quotaOf('db_bytes');
  const stUsed = find('storage_bytes'), stQuota = quotaOf('storage_bytes');
  const bw = metrics.find((m: any) => m.metric === 'egress_gb_month');
  return {
    providers: providers.map(({ config, ...p }: any) => ({
      ...p, links: { dashboard: typeof config?.dashboardUrl === 'string' ? config.dashboardUrl : null },
      metrics: byProvider.get(p.id) ?? [],
    })) as any[],
    dbUsagePct: pct(dbUsed?.value, dbQuota?.quota), storageUsagePct: pct(stUsed?.value, stQuota?.quota),
    bandwidthUsagePct: pct(bw?.value, bw?.quota),
  };
}

/** Metrics that drive the health score and alert rules. Missing → null (never 0-by-default). */
export async function computeMetrics(panelOrPanels: Panel | Panel[], product: string | null, cfg: OpsConfig, devices?: DeviceRow[]) {
  const now = Date.now();
  // One panel (cron, alert rules) or several (dashboard of an admin who sees both panels).
  const panels = Array.isArray(panelOrPanels) ? panelOrPanels : [panelOrPanels];
  const panel = { $in: panels };
  const devs = (devices ?? (await Promise.all(panels.map((p) => loadDevices(p, cfg)))).flat()).filter((d) => !product || d.product === product);
  const recent = devs.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 7 * 86_400_000);
  const active24 = devs.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 86_400_000).length;
  const day = new Date(now - 86_400_000), hour = new Date(now - 3600_000);
  const scope = { ...PROD, ...(product ? { product_id: product } : {}) };
  const [events, crashes, metricsCol, incidents, alerts] = await Promise.all([col('diag_events'), col('diag_crashes'), col('ops_device_metrics'), col('ops_incidents'), col('ops_alerts')]);
  const [ev, er, cr, apiAll, apiFail, perc, dm, inc, al, infra, logsPct, sb, ss] = await Promise.all([
    events.countDocuments({ panel, ts: { $gte: day }, ...scope }),
    events.countDocuments({ panel, ts: { $gte: day }, severity: { $in: ERR }, ...scope }),
    crashes.countDocuments({ panel, ts: { $gte: day }, ...scope }),
    events.countDocuments({ panel, category: 'API', ts: { $gte: hour }, ...scope }),
    events.countDocuments({ panel, event_type: { $in: ['API_REQUEST_FAILED', 'API_TIMEOUT'] }, ts: { $gte: hour }, ...scope }),
    percentiles(panels, iso(now - 3600_000), iso(now), product),
    metricsCol.find({ panel, reported_at: { $gte: day }, ...(product ? { product_id: product } : {}) }, { projection: { cpu_pct: 1, ram_pct: 1, disk_pct: 1 } }).limit(5000).toArray(),
    incidents.find({ panel, status: { $nin: ['RESOLVED', 'CLOSED'] } }, { projection: { _id: 0, severity: 1 } }).toArray(),
    alerts.find({ panel, status: { $ne: 'RESOLVED' } }, { projection: { _id: 0, level: 1 } }).toArray(),
    infraSnapshot(),
    storagePressure(),
    supabaseUsage().catch(() => null), // usage rules work without a configured Supabase provider
    sessionCrashStats(panels, iso(day.getTime()), iso(now), product),
  ]);
  if (infra.dbUsagePct === null && sb?.dbPct != null) infra.dbUsagePct = Number(sb.dbPct.toFixed(1));
  if (infra.storageUsagePct === null && sb) infra.storageUsagePct = Number(sb.filePct.toFixed(1));
  const apiRows = perc.filter((r) => r.category === 'API');
  const apiN = apiRows.reduce((s, r) => s + Number(r.n), 0);
  // Weighted P95 across endpoints (upper-bound approximation; exact per-endpoint values in the API table).
  const apiP95 = apiN ? apiRows.reduce((s, r) => s + Number(r.p95) * Number(r.n), 0) / apiN : null;
  const pick = (k: string) => dm.map((x: any) => x[k]).filter((v: any) => typeof v === 'number');
  const values = {
    crash_rate_pct: ss.sessions ? (ss.crashed / ss.sessions) * 100 : null,
    error_rate_pct: ev ? (er / ev) * 100 : null,
    api_error_rate_pct: apiAll ? (apiFail / apiAll) * 100 : null,
    api_p95_ms: apiP95,
    db_usage_pct: infra.dbUsagePct, storage_usage_pct: infra.storageUsagePct, bandwidth_usage_pct: infra.bandwidthUsagePct,
    offline_devices_pct: recent.length ? (recent.filter((d) => d.state === 'OFFLINE').length / recent.length) * 100 : null,
    fleet_cpu_p95: p95(pick('cpu_pct')), fleet_ram_p95: p95(pick('ram_pct')), fleet_disk_p95: p95(pick('disk_pct')),
    providers_down: infra.providers.length ? infra.providers.filter((p) => p.enabled && p.last_status === 'DOWN').length : null,
    logs_storage_pct: logsPct || null,
    health_score: null as number | null,
  };
  const score = healthScore({
    crashedSessions24h: ss.sessions ? ss.crashed : null, sessions24h: ss.sessions, errors24h: er, events24h: ev,
    apiFailed: apiFail, apiTotal: apiAll, apiP95Ms: apiP95, apiP95ThresholdMs: cfg.apiP95ThresholdMs,
    openIncidents: product ? undefined : (inc as any[]), openAlerts: product ? undefined : (al as any[]),
    providers: product ? undefined : infra.providers.filter((p) => p.enabled).map((p) => ({ status: p.last_status })),
    dbUsagePct: product ? null : infra.dbUsagePct, storageUsagePct: product ? null : infra.storageUsagePct,
  });
  values.health_score = score.score;
  return {
    values, score, infra,
    counts: { events24h: ev, errors24h: er, crashes24h: cr, apiCalls1h: apiAll, apiFailed1h: apiFail, activeDevices24h: active24,
      sessions24h: ss.sessions, crashedSessions24h: ss.crashed },
    devices: devs,
  };
}

// ── Provider sync (backend only; dashboards read the cached result) ─────────
export async function syncProviders(force = false) {
  const providers = await col('ops_providers');
  const rows = toRows(await providers.find({ enabled: true }).toArray());
  const now = Date.now();
  for (const p of rows) {
    if (!force && p.last_sync && now - Date.parse(p.last_sync) < p.sync_minutes * 60_000) continue;
    const impl = PROVIDERS[p.kind];
    if (!impl) continue;
    let secret: string | null = null;
    try { secret = p.credential_enc ? decryptAES(p.credential_enc) : null; } catch { secret = null; }
    try {
      const r = await impl.sync(p as ProviderRow, secret);
      if (p.kind === 'supabase') {
        // Derived from our own Supabase database (exact): DB size and storage bytes. Quotas come from manual config.
        const [{ data: st }, { data: sto }] = await Promise.all([supabaseAdmin.rpc('ops_db_stats'), supabaseAdmin.rpc('ops_storage_stats')]);
        const q = (k: string) => { const v = Number((p.config as any)?.[k]); return Number.isFinite(v) && v > 0 ? v * GB : null; };
        if (st) r.metrics.push({ metric: 'db_bytes', value: Number(st.db_bytes), quota: q('dbQuotaGb'), unit: 'bytes', source: 'derived' });
        if (Array.isArray(sto)) r.metrics.push({ metric: 'storage_bytes', value: sto.reduce((s: number, b: any) => s + Number(b.bytes), 0), quota: q('storageQuotaGb'), unit: 'bytes', source: 'derived' });
        if (st) r.metrics.push({ metric: 'db_connections', value: Number(st.connections), quota: Number(st.max_connections), source: 'derived' });
        // Daily size history → growth rate + projected time-to-quota (real measurements only).
        if (st) {
          const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
          await setRollup('_infra', 'day', day.toISOString(), '_all', 'db_bytes', Number(st.db_bytes));
        }
      }
      const fetched = new Date();
      if (r.metrics.length) {
        await (await col('ops_provider_metrics')).bulkWrite(r.metrics.map((m) => ({ updateOne: {
          filter: { provider_id: p.id, metric: m.metric },
          update: { $set: { value: m.value ?? null, quota: m.quota ?? null, unit: m.unit ?? null, text_value: m.text ?? null, source: m.source, fetched_at: fetched } },
          upsert: true,
        } })));
      }
      if (r.releases.length) {
        await (await col('ops_releases')).bulkWrite(r.releases.map((x) => ({ updateOne: {
          filter: { panel: '_infra', product_id: x.product_id, version: x.version, environment: x.environment ?? 'production' },
          update: { $set: toSet({ source: p.kind, ...x }), $setOnInsert: { _id: randomUUID() as never } }, upsert: true,
        } })));
      }
      const ok = r.metrics.find((m) => m.metric === 'check_ok');
      if (ok) await bumpRollup('_infra', 'hour', hourStart(now), p.id, ok.value ? 'uptime_ok' : 'uptime_fail', 1);
      await providers.updateOne({ _id: p.id }, { $set: { last_sync: fetched, last_status: r.status, last_error: null } });
    } catch (e) {
      // Store a short, secret-free reason only.
      await providers.updateOne({ _id: p.id }, { $set: { last_sync: new Date(), last_status: 'DOWN', last_error: e instanceof Error ? e.message.slice(0, 120) : 'sync failed' } });
    }
  }
}

const hourStart = (ms: number) => { const d = new Date(ms); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
const rollupKey = (panel: string, g: string, bucket: string, product: string, metric: string) => ({ panel, granularity: g, bucket: new Date(bucket), product_id: product, metric });
async function setRollup(panel: string, g: 'hour' | 'day', bucket: string, product: string, metric: string, value: number) {
  await (await col('ops_rollups')).updateOne(rollupKey(panel, g, bucket, product, metric), { $set: { value } }, { upsert: true });
}
async function bumpRollup(panel: string, g: 'hour' | 'day', bucket: string, product: string, metric: string, inc: number) {
  await (await col('ops_rollups')).updateOne(rollupKey(panel, g, bucket, product, metric), { $inc: { value: inc } }, { upsert: true });
}
async function setRollups(rows: { panel: string; granularity: string; bucket: string; product_id: string; metric: string; value: number }[]) {
  if (!rows.length) return;
  await (await col('ops_rollups')).bulkWrite(rows.map((r) => ({ updateOne: {
    filter: rollupKey(r.panel, r.granularity, r.bucket, r.product_id, r.metric), update: { $set: { value: r.value } }, upsert: true,
  } })), { ordered: false });
}

// ── Rollups + releases-in-the-field ─────────────────────────────────────────
export async function rollup(panel: Panel, cfg: OpsConfig) {
  const now = Date.now();
  const to = Date.parse(hourStart(now));
  const from = to - 3600_000;
  const products = [null, ...new Set((await loadDevices(panel, cfg)).map((d) => d.product).filter(Boolean))] as (string | null)[];
  const rows: { panel: string; granularity: string; bucket: string; product_id: string; metric: string; value: number }[] = [];
  for (const product of products) {
    const r: any = (await eventSeries(panel, iso(from), iso(to), 3600, product))[0];
    for (const k of ['events', 'errors', 'warnings', 'crashes', 'machines', 'users']) rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: product ?? '_all', metric: k, value: Number(r?.[k] ?? 0) });
  }
  const m = await computeMetrics(panel, null, cfg);
  rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: '_all', metric: 'online_devices', value: m.devices.filter((d) => d.state === 'ONLINE').length });
  if (m.score.score !== null) rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: '_all', metric: 'health_score', value: m.score.score });
  await setRollups(rows);

  // Daily rollup once the IST/UTC day closes: sum hourly counters, average score.
  const dayStart = new Date(from); dayStart.setUTCHours(0, 0, 0, 0);
  if (new Date(to).getUTCHours() === 0) {
    const hours = await (await col('ops_rollups')).find({ panel, granularity: 'hour', bucket: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 86_400_000) } },
      { projection: { product_id: 1, metric: 1, value: 1 } }).limit(20_000).toArray();
    const agg = new Map<string, { s: number; n: number }>();
    for (const h of hours) { const k = `${h.product_id}|${h.metric}`; const a = agg.get(k) ?? { s: 0, n: 0 }; a.s += Number(h.value); a.n++; agg.set(k, a); }
    const avgMetrics = new Set(['health_score', 'online_devices', 'machines', 'users']);
    await setRollups([...agg.entries()].map(([k, a]) => {
      const [product_id, metric] = k.split('|');
      return { panel, granularity: 'day', bucket: dayStart.toISOString(), product_id, metric, value: avgMetrics.has(metric) ? a.s / a.n : a.s };
    }));
  }

  // EXE releases observed in the field: first APP_STARTED of each (product, version).
  const starts = await (await col('diag_events')).find({ panel, event_type: 'APP_STARTED', ts: { $gte: new Date(now - 2 * 3600_000) } },
    { projection: { product_id: 1, product_version: 1, build_commit: 1, ts: 1 } }).sort({ ts: 1 }).limit(5000).toArray();
  const seen = new Map<string, any>();
  for (const s of starts) if (s.product_id && s.product_version && !seen.has(`${s.product_id}|${s.product_version}`)) seen.set(`${s.product_id}|${s.product_version}`, s);
  if (seen.size) {
    await (await col('ops_releases')).bulkWrite([...seen.values()].map((s) => ({ updateOne: {
      filter: { panel, product_id: s.product_id, version: s.product_version, environment: 'production' },
      // ignoreDuplicates: an already-known release keeps its first_seen.
      update: { $setOnInsert: { _id: randomUUID() as never, build_commit: s.build_commit ?? null, source: 'field', status: 'SEEN', first_seen: s.ts, duration_s: null, url: null } },
      upsert: true,
    } })), { ordered: false });
  }
}

/** New incident with its INC-YYYY-NNNN code (formerly the assign_record_code trigger). */
export async function insertIncident(i: { panel: string; title: string; severity: string; product_id?: string | null; created_by?: string; alert_id?: string | null;
  rule_id?: string | null; affected?: unknown; updates: unknown[] }) {
  const started = new Date();
  await (await col('ops_incidents')).insertOne({
    _id: randomUUID() as never, code: await allocCode('INC', started), status: 'DETECTED', started_at: started, resolved_at: null, environment: 'production',
    product_id: null, alert_id: null, rule_id: null, affected: null, created_by: 'system', ...i,
  });
}

// ── Alert rules → alerts (deduplicated) → incidents → notifications ─────────
export async function evaluateRules(panel: Panel, cfg: OpsConfig, metrics?: Awaited<ReturnType<typeof computeMetrics>>) {
  const [rulesCol, alerts, incidents] = await Promise.all([col('ops_alert_rules'), col('ops_alerts'), col('ops_incidents')]);
  const newRule = (r: object) => ({ _id: randomUUID() as never, panel, enabled: true, breach_since: null, created_at: new Date(), ...r });
  if (!(await rulesCol.findOne({ panel }, { projection: { _id: 1 } }))) await rulesCol.insertMany(DEFAULT_RULES.map(newRule));
  // Panels whose rules predate the MongoDB move also get the storage-guard rule (once).
  else if (!(await rulesCol.findOne({ panel, metric: LOGS_STORAGE_RULE.metric }, { projection: { _id: 1 } }))) await rulesCol.insertOne(newRule(LOGS_STORAGE_RULE));
  const rules = toRows(await rulesCol.find({ panel, enabled: true }).toArray());
  const m = metrics ?? (await computeMetrics(panel, null, cfg));
  const now = Date.now();
  for (const rule of rules) {
    const value = (m.values as Record<string, number | null>)[rule.metric];
    const r = evaluateRule(rule, value, now);
    if (r.breachSince !== rule.breach_since) await rulesCol.updateOne({ _id: rule.id }, { $set: toSet({ breach_since: r.breachSince }) });
    const key = `rule:${rule.id}`;
    if (r.action === 'clear') {
      await alerts.updateMany({ panel, dedup_key: key, status: { $ne: 'RESOLVED' } }, { $set: { status: 'RESOLVED', resolved_at: new Date(now) } });
      continue;
    }
    if (r.action !== 'fire') continue;
    const title = `${rule.name}: ${Number(value).toFixed(1)} ${rule.op} ${rule.threshold}`;
    const open = await alerts.findOne({ panel, dedup_key: key, status: { $ne: 'RESOLVED' } }, { projection: { occurrences: 1 } });
    let alertId = open ? String(open._id) : undefined;
    if (open) {
      await alerts.updateOne({ _id: open._id }, { $set: { last_at: new Date(now), value, title }, $inc: { occurrences: 1 } });
    } else {
      alertId = randomUUID();
      await alerts.insertOne({ _id: alertId as never, panel, rule_id: rule.id, dedup_key: key, level: rule.level, category: categoryFor(rule.metric), title, value,
        status: 'NEW', occurrences: 1, first_at: new Date(now), last_at: new Date(now), acknowledged_by: null, resolved_at: null });
      if (rule.level !== 'INFO') await sendSecurityAlert('OPS_ALERT', `[${rule.level}] ${title}`, { panel, metric: rule.metric, value });
    }
    if (rule.create_incident && rule.level === 'CRITICAL' && alertId) {
      const openInc = await incidents.findOne({ panel, rule_id: rule.id, status: { $nin: ['RESOLVED', 'CLOSED'] } }, { projection: { _id: 1 } });
      if (!openInc) {
        await insertIncident({
          panel, title: rule.name, severity: 'CRITICAL', alert_id: alertId, rule_id: rule.id,
          affected: { metric: rule.metric, value, devices_24h: m.counts.activeDevices24h, crashes_24h: m.counts.crashes24h,
            sessions_24h: m.counts.sessions24h, crashed_sessions_24h: m.counts.crashedSessions24h },
          updates: [{ at: iso(now), by: 'system', status: 'DETECTED', note: title }],
        });
      }
    }
  }
}
function categoryFor(metric: string) {
  return metric.startsWith('crash') ? 'CRASH' : metric.startsWith('api') ? 'API' : metric.startsWith('db') ? 'DATABASE'
    : metric.startsWith('storage') ? 'STORAGE' : metric.startsWith('bandwidth') || metric.startsWith('providers') ? 'INFRASTRUCTURE' : 'APPLICATION';
}

/** Throttle marker in ops_settings.config (`_lastEval`, `_lastActivity`): true when ≥ 1 min since the last run. */
async function claimMinute(panel: Panel, field: '_lastEval' | '_lastActivity'): Promise<boolean> {
  const now = Date.now();
  const res = await (await col('ops_settings')).updateOne(
    { _id: panel as never, $or: [{ [`config.${field}`]: { $exists: false } }, { [`config.${field}`]: { $lt: now - 60_000 } }] },
    { $set: { [`config.${field}`]: now } }, { upsert: false });
  if (res.matchedCount) return true;
  // No settings document yet → create it (a concurrent creator simply wins the minute).
  if (await opsConfigDoc(panel)) return false;
  try { await (await col('ops_settings')).insertOne({ _id: panel as never, config: { [field]: now }, updated_at: new Date(), updated_by: null }); return true; } catch { return false; }
}

/** Throttled evaluation from dashboard loads (≤ 1 per minute per panel). Without `metrics`, this panel's own are computed. */
export async function maybeEvaluate(panel: Panel, cfg: OpsConfig, metrics?: Awaited<ReturnType<typeof computeMetrics>>) {
  if (await claimMinute(panel, '_lastEval')) await evaluateRules(panel, cfg, metrics);
}

// ── Activity history (ops_activity_daily) ────────────────────────────────────
/** Re-aggregate the last `days` UTC days of raw events into the compact daily table. */
export async function refreshActivity(panel: Panel, days: number) {
  await activityRefresh(panel, days);
}

/**
 * While the Overview is open (≤ once a minute per panel): store this hour's health score and
 * bring today's activity row up to date. The daily cron alone runs too rarely for either.
 */
export async function maybeRecordActivity(panel: Panel, score: number | null) {
  if (!(await claimMinute(panel, '_lastActivity'))) return;
  if (score !== null) await setRollup(panel, 'hour', hourStart(Date.now()), '_all', 'health_score', score);
  await refreshActivity(panel, 1);
}

// ── Retention ────────────────────────────────────────────────────────────────
export async function opsRetention(panel: Panel, cfg: OpsConfig) {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000);
  const [rollups, daily, metrics, alerts, incidents] = await Promise.all([col('ops_rollups'), col('ops_activity_daily'), col('ops_device_metrics'), col('ops_alerts'), col('ops_incidents')]);
  await Promise.all([
    rollups.deleteMany({ panel, granularity: 'hour', bucket: { $lt: ago(cfg.hourlyDays) } }),
    rollups.deleteMany({ panel, granularity: 'day', bucket: { $lt: ago(cfg.dailyDays) } }),
    daily.deleteMany({ panel, day: { $lt: ago(cfg.dailyDays).toISOString().slice(0, 10) } }),
    rollups.deleteMany({ panel: '_infra', bucket: { $lt: ago(cfg.hourlyDays) } }),
    metrics.deleteMany({ panel, reported_at: { $lt: ago(cfg.rawDays) } }),
    alerts.deleteMany({ panel, status: 'RESOLVED', resolved_at: { $lt: ago(cfg.resolvedAlertDays) } }),
    incidents.deleteMany({ panel, status: 'CLOSED', resolved_at: { $lt: ago(cfg.closedIncidentDays) } }),
  ]);
}
