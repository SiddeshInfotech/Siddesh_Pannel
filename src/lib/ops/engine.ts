// Siddesh Operations Center — server engine.
// Reads EXISTING sources (device_status heartbeat, device_timeline sessions, diag_* telemetry)
// with bounded, indexed queries; writes only small aggregates. Called by the hourly cron and,
// throttled to once a minute, by dashboard loads (so alert rules can honour `for_minutes`).
import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { panelDb, type Panel } from '@/lib/panelTables';
import { decryptAES } from '@/lib/crypto';
import { sendSecurityAlert } from '@/lib/alert';
import { fetchAllPages } from '@/app/[panel]/update/telemetry';
import { PROVIDERS, GB, type ProviderRow } from './providers';
import { DEFAULT_RULES, evaluateRule, healthScore, heartbeatState, mergeOps, pct, type OpsConfig } from './health';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Supabase rows */
const db = () => supabaseAdmin;
const iso = (ms: number) => new Date(ms).toISOString();
const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]; };

export async function loadOps(panel: Panel): Promise<OpsConfig> {
  const { data } = await db().from('ops_settings').select('config').eq('panel', panel).maybeSingle();
  return mergeOps(data?.config);
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
  const [{ data: providers }, { data: metrics }] = await Promise.all([
    db().from('ops_providers').select('id, kind, name, service, environment, enabled, sync_minutes, last_sync, last_status, last_error, config'),
    db().from('ops_provider_metrics').select('provider_id, metric, value, quota, unit, text_value, source, fetched_at'),
  ]);
  const byProvider = new Map<string, any[]>();
  for (const m of metrics ?? []) byProvider.set(m.provider_id, [...(byProvider.get(m.provider_id) ?? []), m]);
  const find = (metric: string) => (metrics ?? []).find((m) => m.metric === metric && m.value !== null);
  const quotaOf = (metric: string) => (metrics ?? []).find((m) => m.metric === metric && m.quota !== null);
  const dbUsed = find('db_bytes'), dbQuota = quotaOf('db_bytes');
  const stUsed = find('storage_bytes'), stQuota = quotaOf('storage_bytes');
  const bw = (metrics ?? []).find((m) => m.metric === 'egress_gb_month');
  return {
    providers: (providers ?? []).map(({ config, ...p }) => ({
      ...p, links: { dashboard: typeof config?.dashboardUrl === 'string' ? config.dashboardUrl : null },
      metrics: byProvider.get(p.id) ?? [],
    })),
    dbUsagePct: pct(dbUsed?.value, dbQuota?.quota), storageUsagePct: pct(stUsed?.value, stQuota?.quota),
    bandwidthUsagePct: pct(bw?.value, bw?.quota),
  };
}

/** Metrics that drive the health score and alert rules. Missing → null (never 0-by-default). */
export async function computeMetrics(panel: Panel, product: string | null, cfg: OpsConfig, devices?: DeviceRow[]) {
  const now = Date.now();
  const devs = (devices ?? (await loadDevices(panel, cfg))).filter((d) => !product || d.product === product);
  const recent = devs.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 7 * 86_400_000);
  const active24 = devs.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 86_400_000).length;
  const scope = (q: any) => (product ? q.eq('product_id', product) : q);
  const [ev, er, cr, apiAll, apiFail, perc, dm, inc, al, infra] = await Promise.all([
    scope(db().from('diag_events').select('id', { count: 'estimated', head: true }).eq('panel', panel).gte('ts', iso(now - 86_400_000))),
    scope(db().from('diag_events').select('id', { count: 'exact', head: true }).eq('panel', panel).gte('ts', iso(now - 86_400_000)).in('severity', ['ERROR', 'CRITICAL', 'FATAL'])),
    scope(db().from('diag_crashes').select('id', { count: 'exact', head: true }).eq('panel', panel).gte('ts', iso(now - 86_400_000))),
    scope(db().from('diag_events').select('id', { count: 'exact', head: true }).eq('panel', panel).eq('category', 'API').gte('ts', iso(now - 3600_000))),
    scope(db().from('diag_events').select('id', { count: 'exact', head: true }).eq('panel', panel).in('event_type', ['API_REQUEST_FAILED', 'API_TIMEOUT']).gte('ts', iso(now - 3600_000))),
    db().rpc('ops_percentiles', { p_panel: panel, p_from: iso(now - 3600_000), p_to: iso(now), p_product: product }),
    scope(db().from('ops_device_metrics').select('cpu_pct, ram_pct, disk_pct').eq('panel', panel).gte('reported_at', iso(now - 86_400_000)).limit(5000)),
    db().from('ops_incidents').select('severity').eq('panel', panel).not('status', 'in', '(RESOLVED,CLOSED)'),
    db().from('ops_alerts').select('level').eq('panel', panel).neq('status', 'RESOLVED'),
    infraSnapshot(),
  ]);
  const apiRows = (perc.data ?? []).filter((r: any) => r.category === 'API');
  const apiN = apiRows.reduce((s: number, r: any) => s + Number(r.n), 0);
  // Weighted P95 across endpoints (upper-bound approximation; exact per-endpoint values in the API table).
  const apiP95 = apiN ? apiRows.reduce((s: number, r: any) => s + Number(r.p95) * Number(r.n), 0) / apiN : null;
  const m = dm.data ?? [];
  const pick = (k: string) => m.map((x: any) => x[k]).filter((v: any) => typeof v === 'number');
  const values = {
    crash_rate_pct: active24 ? ((cr.count ?? 0) / active24) * 100 : null,
    error_rate_pct: ev.count ? ((er.count ?? 0) / ev.count) * 100 : null,
    api_error_rate_pct: apiAll.count ? ((apiFail.count ?? 0) / apiAll.count) * 100 : null,
    api_p95_ms: apiP95,
    db_usage_pct: infra.dbUsagePct, storage_usage_pct: infra.storageUsagePct, bandwidth_usage_pct: infra.bandwidthUsagePct,
    offline_devices_pct: recent.length ? (recent.filter((d) => d.state === 'OFFLINE').length / recent.length) * 100 : null,
    fleet_cpu_p95: p95(pick('cpu_pct')), fleet_ram_p95: p95(pick('ram_pct')), fleet_disk_p95: p95(pick('disk_pct')),
    providers_down: infra.providers.length ? infra.providers.filter((p) => p.enabled && p.last_status === 'DOWN').length : null,
    health_score: null as number | null,
  };
  const score = healthScore({
    crashes24h: active24 ? cr.count ?? 0 : null, activeDevices24h: active24, errors24h: er.count ?? 0, events24h: ev.count ?? 0,
    apiFailed: apiFail.count ?? 0, apiTotal: apiAll.count ?? 0, apiP95Ms: apiP95, apiP95ThresholdMs: cfg.apiP95ThresholdMs,
    openIncidents: product ? undefined : inc.data ?? [], openAlerts: product ? undefined : al.data ?? [],
    providers: product ? undefined : infra.providers.filter((p) => p.enabled).map((p) => ({ status: p.last_status })),
    dbUsagePct: product ? null : infra.dbUsagePct, storageUsagePct: product ? null : infra.storageUsagePct,
  });
  values.health_score = score.score;
  return {
    values, score, infra,
    counts: { events24h: ev.count ?? 0, errors24h: er.count ?? 0, crashes24h: cr.count ?? 0, apiCalls1h: apiAll.count ?? 0, apiFailed1h: apiFail.count ?? 0, activeDevices24h: active24 },
    devices: devs,
  };
}

// ── Provider sync (backend only; dashboards read the cached result) ─────────
export async function syncProviders(force = false) {
  const { data: rows } = await db().from('ops_providers').select('*').eq('enabled', true);
  const now = Date.now();
  for (const p of rows ?? []) {
    if (!force && p.last_sync && now - Date.parse(p.last_sync) < p.sync_minutes * 60_000) continue;
    const impl = PROVIDERS[p.kind];
    if (!impl) continue;
    let secret: string | null = null;
    try { secret = p.credential_enc ? decryptAES(p.credential_enc) : null; } catch { secret = null; }
    try {
      const r = await impl.sync(p as ProviderRow, secret);
      if (p.kind === 'supabase') {
        // Derived from our own database (exact): DB size and storage bytes. Quotas come from manual config.
        const [{ data: st }, { data: sto }] = await Promise.all([db().rpc('ops_db_stats'), db().rpc('ops_storage_stats')]);
        const q = (k: string) => { const v = Number((p.config as any)?.[k]); return Number.isFinite(v) && v > 0 ? v * GB : null; };
        if (st) r.metrics.push({ metric: 'db_bytes', value: Number(st.db_bytes), quota: q('dbQuotaGb'), unit: 'bytes', source: 'derived' });
        if (Array.isArray(sto)) r.metrics.push({ metric: 'storage_bytes', value: sto.reduce((s: number, b: any) => s + Number(b.bytes), 0), quota: q('storageQuotaGb'), unit: 'bytes', source: 'derived' });
        if (st) r.metrics.push({ metric: 'db_connections', value: Number(st.connections), quota: Number(st.max_connections), source: 'derived' });
        // Daily size history → growth rate + projected time-to-quota (real measurements only).
        if (st) {
          const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
          await db().from('ops_rollups').upsert({ panel: '_infra', granularity: 'day', bucket: day.toISOString(), product_id: '_all', metric: 'db_bytes', value: Number(st.db_bytes) });
        }
      }
      const fetched = new Date().toISOString();
      if (r.metrics.length) {
        await db().from('ops_provider_metrics').upsert(r.metrics.map((m) => ({
          provider_id: p.id, metric: m.metric, value: m.value ?? null, quota: m.quota ?? null, unit: m.unit ?? null, text_value: m.text ?? null, source: m.source, fetched_at: fetched,
        })));
      }
      if (r.releases.length) {
        await db().from('ops_releases').upsert(r.releases.map((x) => ({ panel: '_infra', source: p.kind, ...x })), { onConflict: 'panel,product_id,version,environment' });
      }
      const ok = r.metrics.find((m) => m.metric === 'check_ok');
      if (ok) await bumpRollup('_infra', 'hour', hourStart(now), p.id, ok.value ? 'uptime_ok' : 'uptime_fail', 1);
      await db().from('ops_providers').update({ last_sync: fetched, last_status: r.status, last_error: null }).eq('id', p.id);
    } catch (e) {
      // Store a short, secret-free reason only.
      await db().from('ops_providers').update({ last_sync: new Date().toISOString(), last_status: 'DOWN', last_error: e instanceof Error ? e.message.slice(0, 120) : 'sync failed' }).eq('id', p.id);
    }
  }
}

const hourStart = (ms: number) => { const d = new Date(ms); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
async function bumpRollup(panel: string, g: 'hour' | 'day', bucket: string, product: string, metric: string, inc: number) {
  const { data } = await db().from('ops_rollups').select('value').match({ panel, granularity: g, bucket, product_id: product, metric }).maybeSingle();
  await db().from('ops_rollups').upsert({ panel, granularity: g, bucket, product_id: product, metric, value: Number(data?.value ?? 0) + inc });
}

// ── Rollups + releases-in-the-field ─────────────────────────────────────────
export async function rollup(panel: Panel, cfg: OpsConfig) {
  const now = Date.now();
  const to = Date.parse(hourStart(now));
  const from = to - 3600_000;
  const products = [null, ...new Set((await loadDevices(panel, cfg)).map((d) => d.product).filter(Boolean))] as (string | null)[];
  const rows: any[] = [];
  for (const product of products) {
    const { data } = await db().rpc('ops_event_series', { p_panel: panel, p_from: iso(from), p_to: iso(to), p_bucket_s: 3600, p_product: product });
    const r = (data ?? [])[0];
    for (const k of ['events', 'errors', 'warnings', 'crashes', 'machines', 'users']) rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: product ?? '_all', metric: k, value: Number(r?.[k] ?? 0) });
  }
  const m = await computeMetrics(panel, null, cfg);
  rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: '_all', metric: 'online_devices', value: m.devices.filter((d) => d.state === 'ONLINE').length });
  if (m.score.score !== null) rows.push({ panel, granularity: 'hour', bucket: iso(from), product_id: '_all', metric: 'health_score', value: m.score.score });
  await db().from('ops_rollups').upsert(rows);

  // Daily rollup once the IST/UTC day closes: sum hourly counters, average score.
  const dayStart = new Date(from); dayStart.setUTCHours(0, 0, 0, 0);
  if (new Date(to).getUTCHours() === 0) {
    const { data: hours } = await db().from('ops_rollups').select('product_id, metric, value').eq('panel', panel).eq('granularity', 'hour')
      .gte('bucket', iso(dayStart.getTime())).lt('bucket', iso(dayStart.getTime() + 86_400_000)).limit(20_000);
    const agg = new Map<string, { s: number; n: number }>();
    for (const h of hours ?? []) { const k = `${h.product_id}|${h.metric}`; const a = agg.get(k) ?? { s: 0, n: 0 }; a.s += Number(h.value); a.n++; agg.set(k, a); }
    const avgMetrics = new Set(['health_score', 'online_devices', 'machines', 'users']);
    await db().from('ops_rollups').upsert([...agg.entries()].map(([k, a]) => {
      const [product_id, metric] = k.split('|');
      return { panel, granularity: 'day', bucket: dayStart.toISOString(), product_id, metric, value: avgMetrics.has(metric) ? a.s / a.n : a.s };
    }));
  }

  // EXE releases observed in the field: first APP_STARTED of each (product, version).
  const { data: starts } = await db().from('diag_events').select('product_id, product_version, build_commit, ts').eq('panel', panel)
    .eq('event_type', 'APP_STARTED').gte('ts', iso(now - 2 * 3600_000)).order('ts', { ascending: true }).limit(5000);
  const seen = new Map<string, any>();
  for (const s of starts ?? []) if (s.product_id && s.product_version && !seen.has(`${s.product_id}|${s.product_version}`)) seen.set(`${s.product_id}|${s.product_version}`, s);
  if (seen.size) {
    await db().from('ops_releases').upsert([...seen.values()].map((s) => ({
      panel, product_id: s.product_id, version: s.product_version, build_commit: s.build_commit, environment: 'production', source: 'field', status: 'SEEN', first_seen: s.ts,
    })), { onConflict: 'panel,product_id,version,environment', ignoreDuplicates: true });
  }
}

// ── Alert rules → alerts (deduplicated) → incidents → notifications ─────────
export async function evaluateRules(panel: Panel, cfg: OpsConfig, metrics?: Awaited<ReturnType<typeof computeMetrics>>) {
  const { data: existing } = await db().from('ops_alert_rules').select('id').eq('panel', panel).limit(1);
  if (!existing?.length) await db().from('ops_alert_rules').insert(DEFAULT_RULES.map((r) => ({ ...r, panel })));
  const { data: rules } = await db().from('ops_alert_rules').select('*').eq('panel', panel).eq('enabled', true);
  const m = metrics ?? (await computeMetrics(panel, null, cfg));
  const now = Date.now();
  for (const rule of rules ?? []) {
    const value = (m.values as Record<string, number | null>)[rule.metric];
    const r = evaluateRule(rule, value, now);
    if (r.breachSince !== rule.breach_since) await db().from('ops_alert_rules').update({ breach_since: r.breachSince }).eq('id', rule.id);
    const key = `rule:${rule.id}`;
    if (r.action === 'clear') {
      await db().from('ops_alerts').update({ status: 'RESOLVED', resolved_at: iso(now) }).eq('panel', panel).eq('dedup_key', key).neq('status', 'RESOLVED');
      continue;
    }
    if (r.action !== 'fire') continue;
    const title = `${rule.name}: ${Number(value).toFixed(1)} ${rule.op} ${rule.threshold}`;
    const { data: open } = await db().from('ops_alerts').select('id, occurrences').eq('panel', panel).eq('dedup_key', key).neq('status', 'RESOLVED').maybeSingle();
    let alertId = open?.id as string | undefined;
    if (open) {
      await db().from('ops_alerts').update({ occurrences: open.occurrences + 1, last_at: iso(now), value, title }).eq('id', open.id);
    } else {
      const { data: created } = await db().from('ops_alerts').insert({ panel, rule_id: rule.id, dedup_key: key, level: rule.level, category: categoryFor(rule.metric), title, value }).select('id').single();
      alertId = created?.id;
      if (rule.level !== 'INFO') await sendSecurityAlert('OPS_ALERT', `[${rule.level}] ${title}`, { panel, metric: rule.metric, value });
    }
    if (rule.create_incident && rule.level === 'CRITICAL' && alertId) {
      const { data: openInc } = await db().from('ops_incidents').select('id').eq('panel', panel).eq('rule_id', rule.id).not('status', 'in', '(RESOLVED,CLOSED)').limit(1);
      if (!openInc?.length) {
        await db().from('ops_incidents').insert({
          panel, title: rule.name, severity: 'CRITICAL', alert_id: alertId, rule_id: rule.id,
          affected: { metric: rule.metric, value, devices_24h: m.counts.activeDevices24h, crashes_24h: m.counts.crashes24h },
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

/** Throttled evaluation from dashboard loads (≤ 1 per minute per panel). */
export async function maybeEvaluate(panel: Panel, cfg: OpsConfig, metrics: Awaited<ReturnType<typeof computeMetrics>>) {
  const { data } = await db().from('ops_settings').select('config').eq('panel', panel).maybeSingle();
  const last = Number((data?.config as any)?._lastEval ?? 0);
  if (Date.now() - last < 60_000) return;
  await db().from('ops_settings').upsert({ panel, config: { ...(data?.config ?? {}), _lastEval: Date.now() } });
  await evaluateRules(panel, cfg, metrics);
}

// ── Retention ────────────────────────────────────────────────────────────────
export async function opsRetention(panel: Panel, cfg: OpsConfig) {
  const now = Date.now();
  await Promise.all([
    db().from('ops_rollups').delete().eq('panel', panel).eq('granularity', 'hour').lt('bucket', iso(now - cfg.hourlyDays * 86_400_000)),
    db().from('ops_rollups').delete().eq('panel', panel).eq('granularity', 'day').lt('bucket', iso(now - cfg.dailyDays * 86_400_000)),
    db().from('ops_rollups').delete().eq('panel', '_infra').lt('bucket', iso(now - cfg.hourlyDays * 86_400_000)),
    db().from('ops_device_metrics').delete().eq('panel', panel).lt('reported_at', iso(now - cfg.rawDays * 86_400_000)),
    db().from('ops_alerts').delete().eq('panel', panel).eq('status', 'RESOLVED').lt('resolved_at', iso(now - cfg.resolvedAlertDays * 86_400_000)),
    db().from('ops_incidents').delete().eq('panel', panel).eq('status', 'CLOSED').lt('resolved_at', iso(now - cfg.closedIncidentDays * 86_400_000)),
  ]);
}
