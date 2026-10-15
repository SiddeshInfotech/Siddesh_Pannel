'use server';

// Operations Center — server actions. RBAC via the Logs roles (OPS_VIEW / OPS_MANAGE /
// INFRA_VIEW / INFRA_MANAGE); school-scoped users only see their schools and no infrastructure.
// Every number returned is either computed from stored telemetry or labelled with its source.
import { DiagAuthError, audit, dbErrorMessage, diagDb, rateLimit, requireActor, type Actor } from '@/lib/diagnostics/server';
import { cleanLine } from '@/lib/diagnostics/core';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { panelDb } from '@/lib/panelTables';
import { productDisplayName, productsForPanel } from '@/lib/productIdentity';
import { fetchAllPages } from '@/app/[panel]/update/telemetry';
import type { Panel } from '@/lib/supabase';
import { encryptAES } from '@/lib/crypto';
import { computeMetrics, infraSnapshot, loadDevices, loadOps, maybeEvaluate, maybeRecordActivity, syncProviders } from '@/lib/ops/engine';
import { PROVIDER_FIELDS } from '@/lib/ops/providers';
import { RANGES, RULE_METRICS, freshness, heartbeatState, mergeOps, regressionCheck, versionDistribution, type RangeKey } from '@/lib/ops/health';

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

// ── Overview: health score + products ───────────────────────────────────────
export async function getOverview(product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const cfg = await loadOps(a.panel);
    const prod = productOk(a, product);
    const now = Date.now();
    // Fail loudly if the schema is missing instead of rendering zeros as "healthy".
    const [p1, p2] = await Promise.all([db().from('diag_events').select('id', { head: true }).limit(1), db().from('ops_alert_rules').select('id', { head: true }).limit(1)]);
    if (p1.error || p2.error) return fail(dbErrorMessage(p1.error ?? p2.error));
    const allDevices = (await loadDevices(a.panel, cfg)).filter((d) => inScope(a, d.entity));
    const m = await computeMetrics(a.panel, prod, cfg, allDevices);
    if (!a.schoolIds) {
      await maybeEvaluate(a.panel, cfg, m).catch(() => undefined);
      // Hourly health snapshot (whole panel only) + today's Activity row.
      await maybeRecordActivity(a.panel, prod ? null : m.score.score).catch(() => undefined);
    }

    const hour = Math.floor(now / 3600_000) * 3600_000;
    const [prevScore, releases] = await Promise.all([
      // Exactly the previous hour's snapshot — no comparison when it wasn't recorded.
      prod ? Promise.resolve({ data: null }) : db().from('ops_rollups').select('value').eq('panel', a.panel).eq('granularity', 'hour').eq('product_id', '_all')
        .eq('metric', 'health_score').eq('bucket', iso(hour - 3600_000)).maybeSingle(),
      db().from('ops_releases').select('product_id, first_seen').eq('panel', a.panel).order('first_seen', { ascending: false }).limit(50),
    ]);

    // Every product of this panel with the same fields (24 h), plus an "All products" total.
    type Ctx = { panel: 'lms' | 'lab'; devices: typeof allDevices; releases: any[] };
    const own: Ctx = { panel: a.panel, devices: allDevices, releases: releases.data ?? [] };
    const summarize = async (ctx: Ctx, id: string | null, name: string, os: string | null = null) => {
      const pd = ctx.devices.filter((d) => !id || d.product === id);
      const { data: s24 } = await db().rpc('ops_event_series', { p_panel: ctx.panel, p_from: iso(now - 86_400_000), p_to: iso(now), p_bucket_s: 86_400, p_product: id });
      const r = (s24 ?? []).reduce((t: any, x: any) => ({ events: t.events + Number(x.events), errors: t.errors + Number(x.errors), crashes: t.crashes + Number(x.crashes), users: Math.max(t.users, Number(x.users)) }), { events: 0, errors: 0, crashes: 0, users: 0 });
      const active24 = pd.filter((d) => d.lastSeen && now - Date.parse(d.lastSeen) < 86_400_000).length;
      const errorRate = r.events ? (r.errors / r.events) * 100 : null;
      const crashRate = active24 ? (r.crashes / active24) * 100 : null;
      const status = !pd.length && !r.events ? 'UNKNOWN' : (crashRate ?? 0) > 2 || (errorRate ?? 0) > 10 ? 'CRITICAL' : (crashRate ?? 0) > 0.5 || (errorRate ?? 0) > 3 ? 'WARNING' : 'HEALTHY';
      return {
        id: id ?? '', name, group: name.replace(/ (Android|Windows|Linux)$/, ''), os, status, version: id ? versionDistribution(pd.map((d) => d.version)).latest : null,
        // `external`: a product of the OTHER admin, shown for reference only (it can't filter this page).
        panel: ctx.panel, external: ctx.panel !== a.panel,
        devices: pd.length, online: pd.filter((d) => d.state === 'ONLINE').length,
        schools: new Set(pd.map((d) => d.entity).filter(Boolean)).size, activeUsers: r.users || null,
        errors24h: r.errors, crashes24h: r.crashes, errorRate, crashRate,
        lastDeployment: ctx.releases.find((x: any) => !id || x.product_id === id)?.first_seen ?? null,
      };
    };
    const products = await Promise.all([summarize(own, null, 'All products'), ...productsForPanel(a.panel).map((p) => summarize(own, p.id, p.displayName, p.targetOs))]);

    // Lab-Admin also lists the LMS School products (read-only summary from LMS-Admin's data).
    // Not for school-scoped roles: their scope is this admin's schools only.
    if (a.panel === 'lab' && !a.schoolIds) {
      const school = productsForPanel('lms').filter((p) => p.family === 'school');
      const [lmsDevices, { data: lmsReleases }] = await Promise.all([
        loadOps('lms').then((c) => loadDevices('lms', c)),
        db().from('ops_releases').select('product_id, first_seen').eq('panel', 'lms').order('first_seen', { ascending: false }).limit(50),
      ]);
      const lms: Ctx = { panel: 'lms', devices: lmsDevices, releases: lmsReleases ?? [] };
      products.push(...await Promise.all(school.map((p) => summarize(lms, p.id, p.displayName, p.targetOs))));
    }

    return ok({ generatedAt: iso(now), product: prod, score: m.score, previousScore: prevScore.data?.value ?? null, products });
  });
}

// ── Activity: 24 h from raw events, longer windows from the compact daily table ─
const ACTIVITY_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, '3y': 1095 } as const;
export async function getActivity(window: string, product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const prod = productOk(a, product);
    const now = Date.now();
    if (!(window in ACTIVITY_DAYS)) {
      const { data, error } = await db().rpc('ops_event_series', { p_panel: a.panel, p_from: iso(now - 86_400_000), p_to: iso(now), p_bucket_s: 3600, p_product: prod });
      if (error) return fail(dbErrorMessage(error));
      const points = (data ?? []).map((x: any) => ({ t: x.bucket, events: Number(x.events), errors: Number(x.errors), crashes: Number(x.crashes), devices: Number(x.machines) }));
      return ok({ window: '24h', granularity: 'hour', points });
    }
    const days = ACTIVITY_DAYS[window as keyof typeof ACTIVITY_DAYS];
    const first = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db().from('ops_activity_daily').select('day, events, errors, crashes, devices, health_score')
      .eq('panel', a.panel).eq('product_id', prod ?? '_all').gte('day', first).order('day', { ascending: true }).limit(4000);
    if (error) return fail(dbErrorMessage(error));
    // One point per day, zero-filled, so gaps read as "no activity" rather than a broken axis.
    const byDay = new Map((data ?? []).map((r: any) => [r.day, r]));
    const points = [];
    for (let d = Date.parse(first); d <= now; d += 86_400_000) {
      const key = new Date(d).toISOString().slice(0, 10);
      const r: any = byDay.get(key);
      points.push({ t: key, events: r?.events ?? 0, errors: r?.errors ?? 0, crashes: r?.crashes ?? 0, devices: r?.devices ?? 0, health: r?.health_score ?? null });
    }
    return ok({ window, granularity: 'day', points, recordedSince: data?.[0]?.day ?? null });
  });
}

/** Monitoring thresholds/retention for the Settings tab (no metrics computed). */
export async function getOpsConfig(): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    return ok(await loadOps(a.panel));
  });
}

// ── Devices ────────────────────────────────────────────────────────
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

// ── Security / suspicious devices (category SECURITY — root, emulator, Frida, capture, tamper…) ──
// Apps send each signal once per session plus repeat rows carrying data.occurrences, so a device's
// count = per (session, type, signal) the highest occurrences seen, summed.
export async function getSecurity(range: string, product?: string | null): Promise<ActionResult<{ devices: any[]; recent: any[]; total: number }>> {
  return guard(async () => {
    const a = await viewer();
    const prod = productOk(a, product);
    let q = db().from('diag_events').select('ts, machine_id, computer_name, entity_id, school_name, product_id, product_version, session_id, severity, event_type, message, data')
      .eq('panel', a.panel).eq('category', 'SECURITY').gte('ts', iso(Date.now() - rangeMs(range))).order('ts', { ascending: false }).limit(5000);
    if (prod) q = q.eq('product_id', prod);
    if (a.schoolIds) q = q.in('entity_id', a.schoolIds.length ? a.schoolIds : ['-']);
    const { data, error } = await q;
    if (error) return fail(dbErrorMessage(error));
    const rows = data ?? [];
    const extra = (r: any) => (r.data?.extra ?? {}) as { signal?: string; occurrences?: number };
    const peak = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.machine_id}|${r.session_id}|${r.event_type}|${extra(r).signal ?? ''}`;
      peak.set(k, Math.max(peak.get(k) ?? 0, Number(extra(r).occurrences) || 1));
    }
    const rank = (s: string) => ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'].indexOf(s);
    const devs = new Map<string, any>();
    for (const r of rows) {
      const d = devs.get(r.machine_id) ?? { fp: r.machine_id, computer: r.computer_name, school: r.school_name ?? r.entity_id, product: r.product_id, version: r.product_version,
        lastSeen: r.ts, firstSeen: r.ts, worst: r.severity, signals: {} as Record<string, number> };
      if (rank(r.severity) > rank(d.worst)) d.worst = r.severity;
      if (r.ts < d.firstSeen) d.firstSeen = r.ts;
      devs.set(r.machine_id, d);
    }
    for (const [k, n] of peak) {
      const [fp, , type] = k.split('|');
      const d = devs.get(fp);
      if (d) d.signals[type] = (d.signals[type] ?? 0) + n;
    }
    const devices = [...devs.values()].sort((x, y) => rank(y.worst) - rank(x.worst) || y.lastSeen.localeCompare(x.lastSeen));
    const recent = rows.slice(0, 100).map((r: any) => ({ ts: r.ts, computer: r.computer_name ?? r.machine_id, school: r.school_name ?? r.entity_id, type: r.event_type,
      signal: extra(r).signal ?? null, occurrences: Number(extra(r).occurrences) || 1, severity: r.severity, message: r.message }));
    return ok({ devices, recent, total: rows.length });
  });
}

// ── Active devices + key search (Lab-Admin sees LMS School AND Lab devices; LMS-Admin only its own) ──
// Active = key status 'Active', bound to a device, and not past expires_at. School-scoped roles
// only ever see their own panel's schools.
const panelsFor = (a: Actor): Panel[] => (a.panel === 'lab' && !a.schoolIds ? ['lab', 'lms'] : [a.panel]);
const PANEL_LABEL: Record<Panel, string> = { lms: 'LMS School', lab: 'Lab' };
const maskKey = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');
const KEY_COLS = 'id, key, status, expires_at, activated_at, device_fingerprint, device_model, device_os, product_id, school_id, vendor_id, parent_id, schools (name), vendors (vendor_name), parents (kid_name)';
const likeSafe = (s: string) => s.replace(/[%_,()*\\]/g, '');
function keyRow(p: Panel, k: any) {
  return {
    panel: p, panelLabel: PANEL_LABEL[p], keyId: k.id as string, key: maskKey(String(k.key ?? '')), status: k.status as string,
    expiresAt: (k.expires_at ?? null) as string | null, activatedAt: k.activated_at ?? null,
    fp: (k.device_fingerprint ?? null) as string | null, model: k.device_model ?? null, os: k.device_os ?? null,
    product: k.product_id ? productDisplayName(k.product_id) : null, productId: k.product_id ?? null,
    entity: (k.school_id ?? k.vendor_id ?? k.parent_id ?? null) as string | null, owner: k.schools?.name ?? k.vendors?.vendor_name ?? k.parents?.kid_name ?? null,
  };
}

export async function getActiveDevices(f: { q?: string; panel?: string; page?: number }): Promise<ActionResult<{ rows: any[]; total: number; panels: Panel[] }>> {
  return guard(async () => {
    const a = await viewer();
    const panels = panelsFor(a).filter((p) => !f.panel || p === f.panel);
    const nowIso = iso(Date.now());
    const cfg = await loadOps(a.panel);
    let rows: ReturnType<typeof keyRow>[] = [];
    for (const p of panels) {
      const { data } = await fetchAllPages<any>((from, to) => panelDb(p).from('activation_keys').select(KEY_COLS)
        .eq('status', 'Active').not('device_fingerprint', 'is', null).or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('id').range(from, to));
      rows.push(...data.map((k) => keyRow(p, k)).filter((r) => p !== a.panel || inScope(a, r.entity)));
    }
    const q = cleanLine(f.q, 80)?.toLowerCase();
    if (q) rows = rows.filter((r) => [r.owner, r.model, r.product, r.fp].some((v) => v && String(v).toLowerCase().includes(q)));
    const ds = new Map<string, any>();
    for (const p of panels) {
      const fps = rows.filter((r) => r.panel === p && r.fp).map((r) => r.fp!);
      for (let i = 0; i < fps.length; i += 500) {
        const { data } = await panelDb(p).from('device_status').select('device_fingerprint, app_version, last_seen').in('device_fingerprint', fps.slice(i, i + 500));
        for (const d of data ?? []) ds.set(`${p}|${d.device_fingerprint}`, d);
      }
    }
    const seen = (r: { panel: Panel; fp: string | null }) => ds.get(`${r.panel}|${r.fp}`)?.last_seen ?? '';
    rows.sort((x, y) => seen(y).localeCompare(seen(x)));
    const page = Math.max(0, Number(f.page) || 0);
    const slice = rows.slice(page * 50, page * 50 + 50);
    const since = iso(Date.now() - 86_400_000);
    const { data: errs } = slice.length
      ? await db().from('diag_events').select('panel, machine_id').in('panel', panels).in('machine_id', slice.map((r) => r.fp!))
        .in('severity', ['ERROR', 'CRITICAL', 'FATAL']).gte('ts', since).limit(10_000)
      : { data: [] as any[] };
    const now = Date.now();
    return ok({
      total: rows.length, panels,
      rows: slice.map((r) => {
        const d = ds.get(`${r.panel}|${r.fp}`);
        return { ...r, version: d?.app_version ?? null, lastSeen: d?.last_seen ?? null, state: heartbeatState(d?.last_seen, now, cfg.onlineMinutes, cfg.staleMinutes),
          errors24h: (errs ?? []).filter((e: any) => e.panel === r.panel && e.machine_id === r.fp).length };
      }),
    });
  });
}

/** Full activation key → its device (searched in every panel this admin may see). Audited. */
export async function lookupKey(rawKey: string): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await requireActor('LOG_SEARCH');
    if (!(await rateLimit(`keylookup:${a.email}`, 60_000, 30))) return fail('Too many lookups. Please wait a moment.');
    const key = String(rawKey ?? '').trim().slice(0, 200);
    if (key.length < 6) return fail('Enter the full activation key.');
    for (const p of panelsFor(a)) {
      for (const k of [...new Set([key, key.toUpperCase()])]) {
        const { data } = await panelDb(p).from('activation_keys').select(KEY_COLS).eq('key', k).maybeSingle();
        if (!data) continue;
        const r = keyRow(p, data);
        if (p === a.panel && !inScope(a, r.entity)) continue;
        await audit(a, 'DEVICE_KEY_LOOKUP', r.keyId, 'OK', { panel: p });
        return ok({ ...r, expired: !!r.expiresAt && Date.parse(r.expiresAt) < Date.now() });
      }
    }
    await audit(a, 'DEVICE_KEY_LOOKUP', null, 'NOT_FOUND');
    return fail('No device found for this key.');
  });
}

/** Everything one device reported (events + crashes), newest first; an offline backlog keeps its real time. */
export async function getDeviceLogs(f: { panel: string; keyId: string; category?: string; q?: string; page?: number }): Promise<ActionResult<{ rows: any[]; total: number; crashes: any[]; byCategory: Record<string, number> }>> {
  return guard(async () => {
    const a = await requireActor('LOG_SEARCH');
    const p = panelsFor(a).find((x) => x === f.panel);
    if (!p) return fail('Not allowed.');
    // The device is resolved from the key id server-side — the client never names a fingerprint.
    const { data: k } = await panelDb(p).from('activation_keys').select(KEY_COLS).eq('id', f.keyId).maybeSingle();
    if (!k?.device_fingerprint) return fail('This key is not bound to a device.');
    if (p === a.panel && !inScope(a, keyRow(p, k).entity)) return fail('Not allowed.');
    const fp = k.device_fingerprint as string;
    const page = Math.max(0, Number(f.page) || 0);
    let q: any = db().from('diag_events').select('id, ts, received_at, severity, event_type, category, module, feature, action, result, message, product_version, session_id, data', { count: 'estimated' })
      .eq('panel', p).eq('machine_id', fp);
    const cat = cleanLine(f.category, 30);
    if (cat) q = q.eq('category', cat);
    const s = likeSafe(cleanLine(f.q, 80) ?? '');
    if (s) q = q.or(`message.ilike.%${s}%,event_type.ilike.%${s}%,feature.ilike.%${s}%,action.ilike.%${s}%`);
    const since30 = iso(Date.now() - 30 * 86_400_000);
    const [{ data, count, error }, { data: crashes }, { data: cats }] = await Promise.all([
      q.order('ts', { ascending: false }).range(page * 100, page * 100 + 99),
      db().from('diag_crashes').select('id, code, ts, event_type, current_screen, actual_behavior, product_version').eq('panel', p).eq('machine_id', fp).order('ts', { ascending: false }).limit(20),
      db().from('diag_events').select('category').eq('panel', p).eq('machine_id', fp).gte('ts', since30).limit(20_000),
    ]);
    if (error) return fail(dbErrorMessage(error));
    const byCategory: Record<string, number> = {};
    for (const c of cats ?? []) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    return ok({ rows: data ?? [], total: count ?? 0, crashes: crashes ?? [], byCategory });
  });
}
