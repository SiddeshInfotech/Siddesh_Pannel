'use server';

// Operations Center — server actions. RBAC via the Logs roles (OPS_VIEW / OPS_MANAGE /
// INFRA_VIEW / INFRA_MANAGE); school-scoped users only see their schools and no infrastructure.
// Every number returned is either computed from stored telemetry or labelled with its source.
import { DiagAuthError, audit, dbErrorMessage, diagDb, rateLimit, requireActor, type Actor } from '@/lib/diagnostics/server';
import { cleanLine } from '@/lib/diagnostics/core';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { panelDb } from '@/lib/panelTables';
import { productsForPanel } from '@/lib/productIdentity';
import { encryptAES } from '@/lib/crypto';
import { computeMetrics, infraSnapshot, loadDevices, loadOps, maybeEvaluate, syncProviders } from '@/lib/ops/engine';
import { PROVIDER_FIELDS } from '@/lib/ops/providers';
import { RANGES, RULE_METRICS, bucketSeconds, freshness, mergeOps, regressionCheck, versionDistribution, type RangeKey } from '@/lib/ops/health';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Supabase rows */
const db = () => diagDb();
const iso = (ms: number) => new Date(ms).toISOString();
async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try { return await fn(); } catch (e) { return fail(e instanceof DiagAuthError ? e.message : GENERIC_ERROR); }
}
async function viewer(perm: 'OPS_VIEW' | 'INFRA_VIEW' = 'OPS_VIEW') {
  const a = await requireActor(perm);
  if (perm === 'INFRA_VIEW' && a.schoolIds) throw new DiagAuthError('Infrastructure is not available for school-scoped roles.');
  if (!(await rateLimit(`ops:${a.email}`, 60_000, 240))) throw new DiagAuthError('Too many requests. Please wait a moment.');
  return a;
}
const inScope = (a: Actor, entity: string | null) => !a.schoolIds || (!!entity && a.schoolIds.includes(entity));
const rangeMs = (r: string) => RANGES[(r in RANGES ? r : '24h') as RangeKey];
const productOk = (a: Actor, p: string | null | undefined) => (p && productsForPanel(a.panel).some((x) => x.id === p) ? p : null);

async function entityNames(a: Actor, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const t = panelDb(a.panel);
  const [s, v, p] = await Promise.all([
    t.from('schools').select('id, name').in('id', ids),
    t.from('vendors').select('vendor_id, vendor_name').in('vendor_id', ids),
    t.from('parents').select('id, kid_name').in('id', ids),
  ]);
  for (const r of s.data ?? []) out.set(r.id, r.name);
  for (const r of v.data ?? []) out.set(r.vendor_id, r.vendor_name);
  for (const r of p.data ?? []) out.set(r.id, r.kid_name);
  return out;
}

// ── Overview / product view ─────────────────────────────────────────────────
export async function getOverview(range: string, product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const cfg = await loadOps(a.panel);
    const prod = productOk(a, product);
    const now = Date.now();
    const span = rangeMs(range);
    // Fail loudly if the schema is missing instead of rendering zeros as "healthy".
    const [p1, p2] = await Promise.all([db().from('diag_events').select('id', { head: true }).limit(1), db().from('ops_alert_rules').select('id', { head: true }).limit(1)]);
    if (p1.error || p2.error) return fail(dbErrorMessage(p1.error ?? p2.error));
    const allDevices = (await loadDevices(a.panel, cfg)).filter((d) => inScope(a, d.entity));
    const m = await computeMetrics(a.panel, prod, cfg, allDevices);
    if (!a.schoolIds) await maybeEvaluate(a.panel, cfg, m).catch(() => undefined);
    const devs = m.devices;

    const [series, prevScore, crashesTop, newFp, incidents, alerts, releases, sessions, users15] = await Promise.all([
      db().rpc('ops_event_series', { p_panel: a.panel, p_from: iso(now - span), p_to: iso(now), p_bucket_s: bucketSeconds(span), p_product: prod }),
      db().from('ops_rollups').select('value, bucket').eq('panel', a.panel).eq('granularity', 'hour').eq('product_id', '_all').eq('metric', 'health_score').order('bucket', { ascending: false }).limit(1).maybeSingle(),
      (prod ? db().from('diag_issues').select('id, code, title, occurrence_count, affected_schools, affected_machines, status, product_id').eq('product_id', prod) : db().from('diag_issues').select('id, code, title, occurrence_count, affected_schools, affected_machines, status, product_id'))
        .eq('panel', a.panel).eq('kind', 'CRASH').not('status', 'in', '(RESOLVED,DELETE_PENDING,DELETED)').order('occurrence_count', { ascending: false }).limit(5),
      db().from('diag_issues').select('id', { count: 'exact', head: true }).eq('panel', a.panel).gte('first_seen_at', iso(now - 86_400_000)),
      db().from('ops_incidents').select('id, code, title, severity, status, product_id, started_at, resolved_at').eq('panel', a.panel).order('started_at', { ascending: false }).limit(10),
      db().from('ops_alerts').select('id, level, category, title, status, occurrences, first_at, last_at').eq('panel', a.panel).neq('status', 'RESOLVED').order('last_at', { ascending: false }).limit(20),
      db().from('ops_releases').select('product_id, version, build_commit, environment, status, first_seen, source').in('panel', [a.panel, '_infra']).order('first_seen', { ascending: false }).limit(15),
      panelDb(a.panel).from('device_timeline').select('event_type', { count: 'exact', head: false }).in('event_type', ['ONLINE', 'OFFLINE']).gte('created_at', iso(startOfIstDay(now))).limit(20_000),
      db().rpc('ops_event_series', { p_panel: a.panel, p_from: iso(now - 15 * 60_000), p_to: iso(now), p_bucket_s: 900, p_product: prod }),
    ]);

    // Product cards (only products of this panel; status UNKNOWN when there's no telemetry at all).
    const products = await Promise.all(productsForPanel(a.panel).filter((p) => !prod || p.id === prod).map(async (p) => {
      const pd = allDevices.filter((d) => d.product === p.id);
      const { data: s24 } = await db().rpc('ops_event_series', { p_panel: a.panel, p_from: iso(now - 86_400_000), p_to: iso(now), p_bucket_s: 86_400, p_product: p.id });
      const r = (s24 ?? []).reduce((t: any, x: any) => ({ events: t.events + Number(x.events), errors: t.errors + Number(x.errors), crashes: t.crashes + Number(x.crashes), users: Math.max(t.users, Number(x.users)) }), { events: 0, errors: 0, crashes: 0, users: 0 });
      const active24 = pd.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 86_400_000).length;
      const vd = versionDistribution(pd.map((d) => d.version));
      const last = (releases.data ?? []).find((x: any) => x.product_id === p.id);
      const errorRate = r.events ? (r.errors / r.events) * 100 : null;
      const crashRate = active24 ? (r.crashes / active24) * 100 : null;
      const status = !pd.length && !r.events ? 'UNKNOWN' : (crashRate ?? 0) > 2 || (errorRate ?? 0) > 10 ? 'CRITICAL' : (crashRate ?? 0) > 0.5 || (errorRate ?? 0) > 3 ? 'WARNING' : 'HEALTHY';
      return {
        id: p.id, name: p.displayName, status, version: vd.latest, devices: pd.length, online: pd.filter((d) => d.state === 'ONLINE').length,
        schools: new Set(pd.map((d) => d.entity).filter(Boolean)).size, activeUsers: r.users || null, errorRate, crashRate,
        crashes24h: r.crashes, errors24h: r.errors, lastDeployment: last?.first_seen ?? null,
      };
    }));

    const online = devs.filter((d) => d.state === 'ONLINE');
    const schoolIds = new Set(devs.map((d) => d.entity).filter(Boolean));
    const onlineSchools = new Set(online.map((d) => d.entity).filter(Boolean));
    const sess = sessions.data ?? [];
    return ok({
      generatedAt: iso(now), range, product: prod, config: cfg,
      score: m.score, previousScore: prevScore.data?.value ?? null, values: m.values, counts: m.counts,
      operational: {
        devices: devs.length, onlineDevices: online.length, staleDevices: devs.filter((d) => d.state === 'STALE').length,
        offlineDevices: devs.filter((d) => d.state === 'OFFLINE').length, schools: schoolIds.size, onlineSchools: onlineSchools.size,
        activeUsers15m: (users15.data ?? []).reduce((s: number, x: any) => Math.max(s, Number(x.users)), 0) || null,
        sessionsStartedToday: sess.filter((x: any) => x.event_type === 'ONLINE').length, sessionsEndedToday: sess.filter((x: any) => x.event_type === 'OFFLINE').length,
      },
      infrastructure: a.schoolIds ? null : { dbUsagePct: m.infra.dbUsagePct, storageUsagePct: m.infra.storageUsagePct, bandwidthUsagePct: m.infra.bandwidthUsagePct,
        providers: m.infra.providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: p.last_status, lastSync: p.last_sync, fresh: freshness(p.last_sync, now, p.sync_minutes) })) },
      series: series.data ?? [], products, topCrashes: (crashesTop.data ?? []).map((c: any) => ({ ...c, schools: c.affected_schools.length, machines: c.affected_machines.length, affected_schools: undefined, affected_machines: undefined })),
      newFingerprints24h: newFp.count ?? 0, incidents: incidents.data ?? [], alerts: alerts.data ?? [], releases: releases.data ?? [],
      timeline: buildTimeline(releases.data ?? [], incidents.data ?? [], alerts.data ?? [], now - Math.max(span, 86_400_000)),
    });
  });
}
function startOfIstDay(now: number) { const ist = now + 5.5 * 3600_000; return ist - (ist % 86_400_000) - 5.5 * 3600_000; }
function buildTimeline(rel: any[], inc: any[], al: any[], since: number) {
  const t = [
    ...rel.map((r) => ({ at: r.first_seen, kind: 'DEPLOYMENT', text: `${r.product_id} ${r.version} ${r.environment}${r.source === 'field' ? ' first seen in field' : ` (${r.status ?? ''})`}` })),
    ...inc.flatMap((i) => [{ at: i.started_at, kind: 'INCIDENT', text: `${i.code} ${i.title} detected` }, ...(i.resolved_at ? [{ at: i.resolved_at, kind: 'RESOLVED', text: `${i.code} resolved` }] : [])]),
    ...al.map((x) => ({ at: x.first_at, kind: 'ALERT', text: `[${x.level}] ${x.title}` })),
  ];
  return t.filter((x) => Date.parse(x.at) >= since).sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 40);
}

// ── Schools + devices ────────────────────────────────────────────────────────
export async function getSchools(product?: string | null): Promise<ActionResult<any[]>> {
  return guard(async () => {
    const a = await viewer();
    const cfg = await loadOps(a.panel);
    const prod = productOk(a, product);
    const devs = (await loadDevices(a.panel, cfg)).filter((d) => inScope(a, d.entity) && (!prod || d.product === prod) && d.entity);
    const since = iso(startOfIstDay(Date.now()));
    const [{ data: errs }, { data: crs }] = await Promise.all([
      db().from('diag_events').select('entity_id').eq('panel', a.panel).in('severity', ['ERROR', 'CRITICAL', 'FATAL']).gte('ts', since).limit(50_000),
      db().from('diag_crashes').select('entity_id').eq('panel', a.panel).gte('ts', since).limit(20_000),
    ]);
    const countBy = (rows: any[] | null) => (rows ?? []).reduce((m: Map<string, number>, r: any) => m.set(r.entity_id, (m.get(r.entity_id) ?? 0) + 1), new Map<string, number>());
    const e = countBy(errs), c = countBy(crs);
    const groups = new Map<string, typeof devs>();
    for (const d of devs) groups.set(d.entity!, [...(groups.get(d.entity!) ?? []), d]);
    const names = await entityNames(a, [...groups.keys()]);
    return ok([...groups.entries()].map(([id, ds]) => {
      const online = ds.filter((d) => d.state === 'ONLINE').length;
      const crashes = c.get(id) ?? 0, errors = e.get(id) ?? 0;
      return {
        id, name: names.get(id) ?? id, products: [...new Set(ds.map((d) => d.product).filter(Boolean))], devices: ds.length, online,
        offline: ds.filter((d) => d.state === 'OFFLINE').length, lastSeen: ds.map((d) => d.lastSeen).filter(Boolean).sort().at(-1) ?? null,
        errors, crashes, versions: versionDistribution(ds.map((d) => d.version)).rows,
        health: crashes > 3 || errors > 100 ? 'CRITICAL' : crashes > 0 || errors > 20 ? 'WARNING' : online === 0 ? 'UNKNOWN' : 'HEALTHY',
      };
    }).sort((x, y) => y.crashes - x.crashes || y.errors - x.errors || x.name.localeCompare(y.name)));
  });
}

export async function getDevices(f: { school?: string; product?: string; state?: string; version?: string; page?: number }): Promise<ActionResult<{ rows: any[]; total: number }>> {
  return guard(async () => {
    const a = await viewer();
    const cfg = await loadOps(a.panel);
    let devs = (await loadDevices(a.panel, cfg)).filter((d) => inScope(a, d.entity));
    if (f.school) devs = devs.filter((d) => d.entity === f.school);
    if (f.product) devs = devs.filter((d) => d.product === f.product);
    if (f.state) devs = devs.filter((d) => d.state === f.state);
    if (f.version) devs = devs.filter((d) => d.version === f.version);
    devs.sort((x, y) => (y.lastSeen ?? '').localeCompare(x.lastSeen ?? ''));
    const page = Math.max(0, Number(f.page) || 0);
    const slice = devs.slice(page * 50, page * 50 + 50);
    const fps = slice.map((d) => d.fp);
    const since = iso(Date.now() - 86_400_000);
    const [{ data: met }, { data: errs }, { data: crs }, names] = await Promise.all([
      db().from('ops_device_metrics').select('*').eq('panel', a.panel).in('machine_id', fps),
      db().from('diag_events').select('machine_id').eq('panel', a.panel).in('machine_id', fps).in('severity', ['ERROR', 'CRITICAL', 'FATAL']).gte('ts', since).limit(10_000),
      db().from('diag_crashes').select('machine_id').eq('panel', a.panel).in('machine_id', fps).gte('ts', since).limit(5_000),
      entityNames(a, [...new Set(slice.map((d) => d.entity).filter(Boolean))] as string[]),
    ]);
    const mm = new Map((met ?? []).map((x: any) => [x.machine_id, x]));
    const cnt = (rows: any[] | null, fp: string) => (rows ?? []).filter((r) => r.machine_id === fp).length;
    return ok({
      total: devs.length,
      rows: slice.map((d) => {
        const x: any = mm.get(d.fp);
        return { ...d, school: d.entity ? names.get(d.entity) ?? d.entity : null, computer: x?.computer_name ?? null, cpu: x?.cpu_pct ?? null, ram: x?.ram_pct ?? null,
          disk: x?.disk_pct ?? null, metricsAt: x?.reported_at ?? null, errors24h: cnt(errs, d.fp), crashes24h: cnt(crs, d.fp) };
      }),
    });
  });
}

// ── Performance + feature health ─────────────────────────────────────────────
export async function getPerformance(range: string, product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const now = Date.now();
    const prod = productOk(a, product);
    const from = iso(now - rangeMs(range));
    const [{ data: perc }, { data: mods }] = await Promise.all([
      db().rpc('ops_percentiles', { p_panel: a.panel, p_from: from, p_to: iso(now), p_product: prod }),
      (prod ? db().from('diag_events').select('module, severity, category').eq('product_id', prod) : db().from('diag_events').select('module, severity, category'))
        .eq('panel', a.panel).gte('ts', from).not('module', 'is', null).limit(50_000),
    ]);
    // Feature health = per-module error share from real telemetry (no telemetry → not listed).
    const fm = new Map<string, { n: number; err: number; crash: number }>();
    for (const r of mods ?? []) { const x = fm.get(r.module) ?? { n: 0, err: 0, crash: 0 }; x.n++; if (['ERROR', 'CRITICAL', 'FATAL'].includes(r.severity)) x.err++; if (r.category === 'CRASH') x.crash++; fm.set(r.module, x); }
    const features = [...fm.entries()].map(([module, x]) => ({ module, events: x.n, errors: x.err, crashes: x.crash, errorPct: (x.err / x.n) * 100,
      status: x.crash > 0 || x.err / x.n > 0.1 ? 'CRITICAL' : x.err / x.n > 0.02 ? 'WARNING' : 'HEALTHY' })).sort((p, q) => q.errors - p.errors);
    return ok({ percentiles: perc ?? [], features, sampled: (mods ?? []).length >= 50_000 });
  });
}

// ── Deployments, versions, update health, regressions ────────────────────────
export async function getDeployments(product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const cfg = await loadOps(a.panel);
    const prod = productOk(a, product);
    const devs = (await loadDevices(a.panel, cfg)).filter((d) => inScope(a, d.entity));
    const now = Date.now();
    const { data: rel } = await db().from('ops_releases').select('*').in('panel', [a.panel, '_infra']).order('first_seen', { ascending: false }).limit(100);
    const releases = (rel ?? []).filter((r: any) => !prod || r.product_id === prod);
    const versions = productsForPanel(a.panel).filter((p) => !prod || p.id === prod).map((p) => {
      const pd = devs.filter((d) => d.product === p.id);
      const vd = versionDistribution(pd.map((d) => d.version));
      return { product: p.id, name: p.displayName, ...vd, outdatedSchools: new Set(pd.filter((d) => d.version && vd.latest && d.version !== vd.latest).map((d) => d.entity)).size };
    }).filter((v) => v.rows.length);
    // Regression check for field releases first seen in the last 7 days (24h before vs 24h after).
    const regressions = [];
    for (const r of releases.filter((x: any) => x.source === 'field' && now - Date.parse(x.first_seen) < 7 * 86_400_000).slice(0, 10)) {
      const t = Date.parse(r.first_seen);
      const win = async (from: number, to: number) => {
        const [{ data: s }] = await Promise.all([db().rpc('ops_event_series', { p_panel: a.panel, p_from: iso(from), p_to: iso(to), p_bucket_s: 86_400, p_product: r.product_id })]);
        const x = (s ?? [])[0] ?? {};
        return { errors: Number(x.errors ?? 0), crashes: Number(x.crashes ?? 0), devices: Number(x.machines ?? 0) };
      };
      const before = await win(t - 86_400_000, t), after = await win(t, Math.min(now, t + 86_400_000));
      const chk = regressionCheck(before, after);
      regressions.push({ product: r.product_id, version: r.version, at: r.first_seen, before, after, ...chk });
    }
    const { data: upd } = await db().from('diag_events').select('event_type').eq('panel', a.panel).eq('category', 'UPDATE').gte('ts', iso(now - 7 * 86_400_000)).limit(50_000);
    const uc = (t: string) => (upd ?? []).filter((x: any) => x.event_type === t).length;
    const installed = uc('UPDATE_INSTALLED'), failed = uc('UPDATE_FAILED');
    return ok({ releases, versions, regressions,
      updates: (upd ?? []).length ? { available: uc('UPDATE_AVAILABLE'), downloaded: uc('UPDATE_DOWNLOADED'), installed, failed, skipped: uc('UPDATE_SKIPPED'),
        successRate: installed + failed ? (installed / (installed + failed)) * 100 : null } : null });
  });
}

// ── Infrastructure + consumption + cost ──────────────────────────────────────
export async function getInfrastructure(): Promise<ActionResult<any>> {
  return guard(async () => {
    await viewer('INFRA_VIEW');
    const now = Date.now();
    const [infra, { data: dbs }, { data: sto }, { data: up }, { data: growth }] = await Promise.all([
      infraSnapshot(), db().rpc('ops_db_stats'), db().rpc('ops_storage_stats'),
      db().from('ops_rollups').select('product_id, metric, value').eq('panel', '_infra').gte('bucket', iso(now - 30 * 86_400_000)).in('metric', ['uptime_ok', 'uptime_fail']),
      db().from('ops_rollups').select('bucket, value').eq('panel', '_infra').eq('granularity', 'day').eq('metric', 'db_bytes').order('bucket', { ascending: true }).limit(400),
    ]);
    const uptime = new Map<string, { ok: number; fail: number }>();
    for (const r of up ?? []) { const u = uptime.get(r.product_id) ?? { ok: 0, fail: 0 }; if (r.metric === 'uptime_ok') u.ok += Number(r.value); else u.fail += Number(r.value); uptime.set(r.product_id, u); }
    return ok({
      providers: infra.providers.map((p) => {
        const u = uptime.get(p.id);
        return { ...p, fresh: freshness(p.last_sync, now, p.sync_minutes), uptime30d: u && u.ok + u.fail ? (u.ok / (u.ok + u.fail)) * 100 : null };
      }),
      database: dbs ?? null, storage: sto ?? [], dbUsagePct: infra.dbUsagePct, storageUsagePct: infra.storageUsagePct, bandwidthUsagePct: infra.bandwidthUsagePct,
      dbGrowth: growth ?? [],
    });
  });
}

export async function getCosts(): Promise<ActionResult<any>> {
  return guard(async () => {
    await viewer('INFRA_VIEW');
    const now = new Date();
    const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), m1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const { data } = await db().from('ops_costs').select('*').in('month', [m0.toISOString().slice(0, 10), m1.toISOString().slice(0, 10)]).order('provider');
    const cur = (data ?? []).filter((c: any) => c.month === m0.toISOString().slice(0, 10));
    const prev = (data ?? []).filter((c: any) => c.month === m1.toISOString().slice(0, 10));
    const sum = (r: any[]) => r.reduce((s, c) => s + Number(c.amount_inr), 0);
    return ok({ month: m0.toISOString().slice(0, 7), current: cur, previous: prev, total: cur.length ? sum(cur) : null, previousTotal: prev.length ? sum(prev) : null,
      note: 'Entered amounts are month-to-date manual figures unless the source is "api". No provider billing API is configured by default.' });
  });
}

export async function saveCost(c: { provider: string; category: string; amount_inr: number; note?: string }): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    const provider = cleanLine(c.provider, 60), category = cleanLine(c.category, 60);
    const amt = Number(c.amount_inr);
    if (!provider || !category || !Number.isFinite(amt) || amt < 0 || amt > 1e9) return fail('Provider, category and a valid amount are required.');
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const { error } = await db().from('ops_costs').upsert({ month, provider, category, amount_inr: amt, source: 'manual', note: cleanLine(c.note, 200), updated_by: a.email, updated_at: new Date().toISOString() }, { onConflict: 'month,provider,category' });
    if (error) return fail(GENERIC_ERROR);
    await audit(a, 'OPS_COST_SAVED', `${provider}/${category}`, 'OK', { amt });
    return ok(undefined);
  });
}

// ── Providers (credentials write-only) ───────────────────────────────────────
export async function listProviders(): Promise<ActionResult<any[]>> {
  return guard(async () => {
    await requireActor('INFRA_MANAGE');
    const { data } = await db().from('ops_providers').select('id, kind, name, service, environment, config, enabled, sync_minutes, last_sync, last_status, last_error, credential_enc').order('name');
    return ok((data ?? []).map(({ credential_enc, ...p }: any) => ({ ...p, hasCredential: !!credential_enc })));
  });
}

export async function saveProvider(p: { id?: string; kind: string; name: string; service?: string; environment?: string; config: Record<string, unknown>; credential?: string; enabled?: boolean; sync_minutes?: number }): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    if (!(p.kind in PROVIDER_FIELDS)) return fail('Unknown provider type.');
    const name = cleanLine(p.name, 60);
    if (!name) return fail('Name is required.');
    // Only whitelisted non-secret config keys + manual quota fields are stored in plain config.
    const allowed = new Set([...PROVIDER_FIELDS[p.kind], 'dashboardUrl', 'dbQuotaGb', 'storageQuotaGb', 'manual']);
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.config ?? {})) if (allowed.has(k)) config[k] = typeof v === 'string' ? cleanLine(v, 300) : v;
    if (typeof config.url === 'string' && !/^https:\/\//.test(config.url)) return fail('Health-check URL must be https://');
    if (typeof config.dashboardUrl === 'string' && !/^https:\/\//.test(config.dashboardUrl)) delete config.dashboardUrl;
    const row: any = { kind: p.kind, name, service: cleanLine(p.service, 60), environment: cleanLine(p.environment, 30) ?? 'production', config,
      enabled: p.enabled !== false, sync_minutes: Math.min(1440, Math.max(5, Number(p.sync_minutes) || 15)) };
    if (p.credential) row.credential_enc = encryptAES(p.credential.trim());   // encrypted at rest; never read back to UI
    const { error } = p.id ? await db().from('ops_providers').update(row).eq('id', p.id) : await db().from('ops_providers').insert(row);
    if (error) return fail(GENERIC_ERROR);
    await audit(a, 'OPS_PROVIDER_SAVED', name, 'OK', { kind: p.kind, credentialChanged: !!p.credential });
    return ok(undefined);
  });
}

export async function deleteProvider(id: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    await db().from('ops_providers').delete().eq('id', String(id).slice(0, 64));
    await audit(a, 'OPS_PROVIDER_DELETED', id, 'OK');
    return ok(undefined);
  });
}

export async function syncNow(): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    if (!(await rateLimit(`ops-sync:${a.email}`, 300_000, 3))) return fail('Sync was run recently. Try again in a few minutes.');
    await syncProviders(true);
    await audit(a, 'OPS_SYNC_MANUAL', null, 'OK');
    return ok(undefined);
  });
}

// ── Alerts, incidents, rules, settings ───────────────────────────────────────
export async function listAlerts(status?: string): Promise<ActionResult<any[]>> {
  return guard(async () => {
    const a = await viewer();
    let q = db().from('ops_alerts').select('*').eq('panel', a.panel).order('last_at', { ascending: false }).limit(200);
    if (status && ['NEW', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) q = q.eq('status', status);
    const { data } = await q;
    return ok(data ?? []);
  });
}

export async function setAlertStatus(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED'): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) return fail('Invalid status.');
    await db().from('ops_alerts').update({ status, acknowledged_by: a.email, ...(status === 'RESOLVED' ? { resolved_at: new Date().toISOString() } : {}) }).eq('id', id).eq('panel', a.panel);
    await audit(a, `OPS_ALERT_${status}`, id, 'OK');
    return ok(undefined);
  });
}

const INC_FLOW: Record<string, string[]> = {
  DETECTED: ['INVESTIGATING', 'IDENTIFIED', 'MITIGATING', 'RESOLVED'], INVESTIGATING: ['IDENTIFIED', 'MITIGATING', 'RESOLVED'],
  IDENTIFIED: ['MITIGATING', 'RESOLVED'], MITIGATING: ['RESOLVED', 'INVESTIGATING'], RESOLVED: ['CLOSED', 'INVESTIGATING'], CLOSED: [],
};
export async function listIncidents(): Promise<ActionResult<any[]>> {
  return guard(async () => {
    const a = await viewer();
    const { data } = await db().from('ops_incidents').select('*').eq('panel', a.panel).order('started_at', { ascending: false }).limit(100);
    return ok(data ?? []);
  });
}
export async function createIncident(i: { title: string; severity: string; product_id?: string }): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    const title = cleanLine(i.title, 200);
    if (!title || !['INFO', 'WARNING', 'CRITICAL'].includes(i.severity)) return fail('Title and severity are required.');
    await db().from('ops_incidents').insert({ panel: a.panel, title, severity: i.severity, product_id: productOk(a, i.product_id), created_by: a.email,
      updates: [{ at: new Date().toISOString(), by: a.email, status: 'DETECTED', note: 'Created manually' }] });
    await audit(a, 'OPS_INCIDENT_CREATED', title, 'OK');
    return ok(undefined);
  });
}
export async function updateIncident(id: string, status: string, note: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    const { data: inc } = await db().from('ops_incidents').select('status, updates, code').eq('id', id).eq('panel', a.panel).maybeSingle();
    if (!inc) return fail('Not found.');
    if (!INC_FLOW[inc.status]?.includes(status)) return fail(`Cannot move from ${inc.status} to ${status}.`);
    const now = new Date().toISOString();
    await db().from('ops_incidents').update({ status, ...(status === 'RESOLVED' ? { resolved_at: now } : {}),
      updates: [...(inc.updates ?? []), { at: now, by: a.email, status, note: cleanLine(note, 500) ?? '' }] }).eq('id', id);
    await audit(a, 'OPS_INCIDENT_UPDATED', inc.code, 'OK', { status });
    return ok(undefined);
  });
}

export async function listRules(): Promise<ActionResult<{ rules: any[]; metrics: Record<string, string> }>> {
  return guard(async () => {
    const a = await viewer();
    const { data } = await db().from('ops_alert_rules').select('*').eq('panel', a.panel).order('created_at');
    return ok({ rules: data ?? [], metrics: RULE_METRICS });
  });
}
export async function saveRule(r: { id?: string; name: string; metric: string; op: string; threshold: number; for_minutes: number; level: string; create_incident: boolean; enabled: boolean }): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    const name = cleanLine(r.name, 80);
    if (!name || !(r.metric in RULE_METRICS) || !['>', '>=', '<', '<='].includes(r.op) || !Number.isFinite(Number(r.threshold)) || !['INFO', 'WARNING', 'CRITICAL'].includes(r.level)) return fail('Invalid rule.');
    const row = { panel: a.panel, name, metric: r.metric, op: r.op, threshold: Number(r.threshold), for_minutes: Math.min(1440, Math.max(0, Number(r.for_minutes) || 0)), level: r.level, create_incident: !!r.create_incident, enabled: r.enabled !== false };
    const { error } = r.id ? await db().from('ops_alert_rules').update(row).eq('id', r.id).eq('panel', a.panel) : await db().from('ops_alert_rules').insert(row);
    if (error) return fail(GENERIC_ERROR);
    await audit(a, 'OPS_RULE_SAVED', name, 'OK', row);
    return ok(undefined);
  });
}
export async function deleteRule(id: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    await db().from('ops_alert_rules').delete().eq('id', id).eq('panel', a.panel);
    await audit(a, 'OPS_RULE_DELETED', id, 'OK');
    return ok(undefined);
  });
}

export async function saveOpsSettings(cfg: Record<string, unknown>): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await requireActor('INFRA_MANAGE');
    const { data } = await db().from('ops_settings').select('config').eq('panel', a.panel).maybeSingle();
    const merged = mergeOps({ ...(data?.config ?? {}), ...cfg });
    await db().from('ops_settings').upsert({ panel: a.panel, config: { ...(data?.config ?? {}), ...merged }, updated_by: a.email, updated_at: new Date().toISOString() });
    await audit(a, 'OPS_SETTINGS_SAVED', null, 'OK', merged);
    return ok(merged);
  });
}
