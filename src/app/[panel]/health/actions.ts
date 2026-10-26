'use server';

// Operations Center — server actions. RBAC via the Logs roles (OPS_VIEW / OPS_MANAGE /
// INFRA_VIEW / INFRA_MANAGE); school-scoped users only see their schools and no infrastructure.
// Every number returned is either computed from stored telemetry or labelled with its source.
// Telemetry + Operations data live in MongoDB; keys/schools/devices (business data) in Supabase.
import { DiagAuthError, audit, dbErrorMessage, rateLimit, requireActor, visiblePanels, type Actor } from '@/lib/diagnostics/server';
import { cleanLine } from '@/lib/diagnostics/core';
import { col, contains, fields, logsDb, toRows } from '@/lib/diagnostics/mongo';
import { eventSeries, eventTotalsByProduct, mongoCollections, mongoUsage, productKey, PROD, sessionCrashStats, sessionCrashStatsByProduct, type ProductTotals } from '@/lib/diagnostics/mongoOps';
import { ActionResult, fail, ok } from '@/lib/actionResult';
import { panelDb } from '@/lib/panelTables';
import { productDisplayName, productsForPanel } from '@/lib/productIdentity';
import { fetchAllPages } from '@/app/[panel]/update/telemetry';
import type { Panel } from '@/lib/supabase';
import { computeMetrics, loadDevices, loadOps, maybeEvaluate, maybeRecordActivity, supabaseUsage, type DeviceRow } from '@/lib/ops/engine';
import { heartbeatState, versionDistribution } from '@/lib/ops/health';
import { after } from 'next/server';
import { swrCache } from '@/lib/swrCache';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic documents */
const iso = (ms: number) => new Date(ms).toISOString();
const ERR = ['ERROR', 'CRITICAL', 'FATAL'];
async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try { return await fn(); } catch (e) { return fail(e instanceof DiagAuthError ? e.message : dbErrorMessage(e)); }
}
async function viewer(perm: 'OPS_VIEW' | 'INFRA_VIEW' = 'OPS_VIEW') {
  const a = await requireActor(perm);
  if (perm === 'INFRA_VIEW' && a.schoolIds) throw new DiagAuthError('Infrastructure is not available for school-scoped roles.');
  if (!(await rateLimit(`ops:${a.email}`, 60_000, 240))) throw new DiagAuthError('Too many requests. Please wait a moment.');
  return a;
}
const inScope = (a: Actor, entity: string | null) => !a.schoolIds || (!!entity && a.schoolIds.includes(entity));
const productOk = (a: Actor, p: string | null | undefined) => (p && visiblePanels(a).some((pn) => productsForPanel(pn).some((x) => x.id === p)) ? p : null);

// ── Overview: health score + products ───────────────────────────────────────
// Full-scope admins of a panel all see the same overview, so concurrent viewers and refreshes
// share one computation: fresh for 15 s, then served (≤ 45 s old, generatedAt says when) while one
// background refresh runs. School-scoped roles always compute their own, never from this cache.
const overviewCache = swrCache<any>({ freshMs: 15_000, maxMs: 45_000 });

export async function getOverview(product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer(); // permission + rate limit first, cached or not
    const prod = productOk(a, product);
    return ok(a.schoolIds
      ? await computeOverview(a, prod)
      : await overviewCache.get(`${a.panel}|${prod ?? ''}`, () => computeOverview(a, prod)));
  });
}

async function computeOverview(a: Actor, prod: string | null) {
  const now = Date.now();
  const hour = Math.floor(now / 3600_000) * 3600_000;
  // LMS-Admin + Lab-Admin together (school-scoped roles: their own panel only).
  const panels = visiblePanels(a);

  // Steps that do not depend on each other run together, so the page waits for each round
  // trip (Vercel → MongoDB / Supabase) once per stage instead of once per call.
  const [cfgs, , [prevScores, releases]] = await Promise.all([
    Promise.all(panels.map((p) => loadOps(p))),
    logsDb(), // fail loudly when storage is not configured instead of rendering zeros as "healthy"
    Promise.all([col('ops_rollups'), col('ops_releases')]).then(([rollups, releasesCol]) => Promise.all([
      // Exactly the previous hour's snapshot(s) — no comparison when none was recorded.
      prod ? Promise.resolve([]) : rollups.find({ panel: { $in: panels }, granularity: 'hour', product_id: '_all', metric: 'health_score', bucket: new Date(hour - 3600_000) }).toArray(),
      releasesCol.find({ panel: { $in: panels } }, fields('panel, product_id, first_seen')).sort({ first_seen: -1 }).limit(100).toArray().then(toRows),
    ])),
  ]);
  const cfg = cfgs[panels.indexOf(a.panel)];
  const previousScore = prevScores.length ? prevScores.reduce((s, r) => s + Number(r.value), 0) / prevScores.length : null;

  const devicesBy = new Map<Panel, DeviceRow[]>(await Promise.all(panels.map(async (p, i) =>
    [p, (await loadDevices(p, cfgs[i])).filter((d) => p !== a.panel || inScope(a, d.entity))] as [Panel, DeviceRow[]])));
  const allDevices = [...devicesBy.values()].flat();

  // Every product of every visible panel with the same fields (24 h), plus an "All products" total.
  const dayFrom = iso(now - 86_400_000), dayTo = iso(now);
  const summarize = (inPanels: Panel[], id: string | null, name: string, os: string | null, r: ProductTotals, ss: { sessions: number; crashed: number }) => {
    const pd = inPanels.flatMap((p) => devicesBy.get(p) ?? []).filter((d) => !id || d.product === id);
    const errorRate = r.events ? (r.errors / r.events) * 100 : null;
    const crashRate = ss.sessions ? (ss.crashed / ss.sessions) * 100 : null; // crashed sessions, never > 100%
    const status = !pd.length && !r.events ? 'UNKNOWN' : (crashRate ?? 0) > 2 || (errorRate ?? 0) > 10 ? 'CRITICAL' : (crashRate ?? 0) > 0.5 || (errorRate ?? 0) > 3 ? 'WARNING' : 'HEALTHY';
    return {
      id: id ?? '', name, group: name.replace(/ (Android|Windows|Linux)$/, ''), os, status, version: id ? versionDistribution(pd.map((d) => d.version)).latest : null,
      panel: inPanels.length === 1 ? inPanels[0] : null, external: false,
      devices: pd.length, online: pd.filter((d) => d.state === 'ONLINE').length,
      schools: new Set(pd.map((d) => d.entity).filter(Boolean)).size, activeUsers: r.users || null,
      errors24h: r.errors, crashes24h: r.crashes, errorRate, crashRate,
      lastDeployment: releases.find((x: any) => inPanels.includes(x.panel) && (!id || x.product_id === id))?.first_seen ?? null,
    };
  };
  // "All products" keeps its own queries: distinct users cannot be summed from per-product rows.
  const allProducts = async () => {
    const [s24, ss] = await Promise.all([eventSeries(panels, dayFrom, dayTo, 86_400, null), sessionCrashStats(panels, dayFrom, dayTo, null)]);
    const r = s24.reduce((t, x) => ({ events: t.events + x.events, errors: t.errors + x.errors, crashes: t.crashes + x.crashes, users: Math.max(t.users, x.users) }), { events: 0, errors: 0, crashes: 0, users: 0 });
    return summarize(panels, null, 'All products', null, r, ss);
  };
  // Every product's numbers come from 2 grouped queries instead of 2 queries per product.
  const productRows = async () => {
    const [totals, crashes] = await Promise.all([eventTotalsByProduct(panels, dayFrom, dayTo), sessionCrashStatsByProduct(panels, dayFrom, dayTo)]);
    return panels.flatMap((p) => productsForPanel(p).map((pr) => summarize([p], pr.id, pr.displayName, pr.targetOs,
      totals.get(productKey(p, pr.id)) ?? { events: 0, errors: 0, crashes: 0, users: 0 },
      crashes.get(productKey(p, pr.id)) ?? { sessions: 0, crashed: 0 })));
  };
  // The health score and the per-product rows only share the device list loaded above.
  const [m, all, rows] = await Promise.all([computeMetrics(panels, prod, cfg, allDevices), allProducts(), productRows()]);
  const products = [all, ...rows];

  if (!a.schoolIds) {
    // Bookkeeping the response does not need: run it after the response is sent.
    after(async () => {
      // Alert rules are per panel: evaluated on THIS panel's own metrics (≤ 1/min), not the combined view.
      await maybeEvaluate(a.panel, cfg).catch(() => undefined);
      // Today's Activity rows; hourly health snapshots per panel come from the hourly cron.
      await maybeRecordActivity(a.panel, panels.length === 1 && !prod ? m.score.score : null).catch(() => undefined);
    });
  }

  return { generatedAt: iso(now), product: prod, score: m.score, previousScore, products };
}

// ── Activity: 24 h from raw events, longer windows from the compact daily table ─
const ACTIVITY_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, '3y': 1095 } as const;
export async function getActivity(window: string, product?: string | null): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await viewer();
    const prod = productOk(a, product);
    const now = Date.now();
    if (!(window in ACTIVITY_DAYS)) {
      const data = await eventSeries(visiblePanels(a), iso(now - 86_400_000), iso(now), 3600, prod);
      const points = data.map((x) => ({ t: x.bucket, events: x.events, errors: x.errors, crashes: x.crashes, devices: x.machines }));
      return ok({ window: '24h', granularity: 'hour', points });
    }
    const days = ACTIVITY_DAYS[window as keyof typeof ACTIVITY_DAYS];
    const first = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const data = toRows(await (await col('ops_activity_daily')).find({ panel: { $in: visiblePanels(a) }, product_id: prod ?? '_all', day: { $gte: first } },
      fields('day, events, errors, crashes, devices, health_score')).sort({ day: 1 }).limit(8000).toArray());
    // Both panels' rows of a day added up (health = average); one point per day, zero-filled.
    const byDay = new Map<string, any>();
    for (const r of data) {
      const d = byDay.get(r.day);
      if (!d) { byDay.set(r.day, { ...r, _h: r.health_score == null ? [] : [r.health_score] }); continue; }
      for (const k of ['events', 'errors', 'crashes', 'devices']) d[k] = (d[k] ?? 0) + (r[k] ?? 0);
      if (r.health_score != null) d._h.push(r.health_score);
    }
    for (const d of byDay.values()) d.health_score = d._h.length ? d._h.reduce((s: number, x: number) => s + x, 0) / d._h.length : null;
    const points = [];
    for (let d = Date.parse(first); d <= now; d += 86_400_000) {
      const key = new Date(d).toISOString().slice(0, 10);
      const r: any = byDay.get(key);
      points.push({ t: key, events: r?.events ?? 0, errors: r?.errors ?? 0, crashes: r?.crashes ?? 0, devices: r?.devices ?? 0, health: r?.health_score ?? null });
    }
    return ok({ window, granularity: 'day', points, recordedSince: data[0]?.day ?? null });
  });
}

// ── Infrastructure + consumption + cost ──────────────────────────────────────
export async function getInfrastructure(): Promise<ActionResult<any>> {
  return guard(async () => {
    await viewer('INFRA_VIEW');
    const now = Date.now();
    const [sb, mongo, mcols] = await Promise.all([supabaseUsage().catch(() => null), mongoUsage().catch(() => null), mongoCollections().catch(() => null)]);
    // One storage snapshot per UTC day → growth over the last 30 days (real measurements only).
    const rollups = await col('ops_rollups');
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
    const snap = { supabase_db_bytes: sb?.dbBytes ?? null, supabase_file_bytes: sb?.connected ? sb.fileBytes : null, mongo_bytes: mongo?.used ?? null };
    await Promise.all(Object.entries(snap).filter(([, v]) => v !== null).map(([metric, value]) =>
      rollups.updateOne({ panel: '_infra', granularity: 'day', bucket: day, product_id: '_all', metric }, { $set: { value } }, { upsert: true })));
    const hist = toRows(await rollups.find({ panel: '_infra', granularity: 'day', metric: { $in: Object.keys(snap) }, bucket: { $gte: new Date(now - 30 * 86_400_000) } },
      fields('bucket, metric, value')).sort({ bucket: 1 }).toArray());
    const growth = (metric: string) => {
      const h = hist.filter((x: any) => x.metric === metric);
      if (h.length < 2) return null;
      const days = (Date.parse(h.at(-1).bucket) - Date.parse(h[0].bucket)) / 86_400_000;
      return { bytes: h.at(-1).value - h[0].value, days };
    };
    return ok({
      supabase: sb && { ...sb, growth: growth('supabase_db_bytes'), fileGrowth: growth('supabase_file_bytes') },
      mongo: mongo && { ...mongo, documents: mcols?.documents ?? null, collections: (mcols?.collections ?? []).slice(0, 3), growth: growth('mongo_bytes') },
    });
  });
}

// ── Active devices (Lab-Admin sees LMS School AND Lab devices; LMS-Admin only its own) ──
// Active = key status 'Active', bound to a device, and not past expires_at. School-scoped roles
// only ever see their own panel's schools.
const panelsFor = (a: Actor): Panel[] => visiblePanels(a);
const PANEL_LABEL: Record<Panel, string> = { lms: 'LMS School', lab: 'Lab' };
const maskKey = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');
const KEY_COLS = 'id, key, status, expires_at, activated_at, device_fingerprint, device_model, device_os, product_id, school_id, vendor_id, parent_id, schools (name), vendors (vendor_name), parents (kid_name)';
function keyRow(p: Panel, k: any) {
  return {
    panel: p, panelLabel: PANEL_LABEL[p], keyId: k.id as string, key: maskKey(String(k.key ?? '')), status: k.status as string,
    expiresAt: (k.expires_at ?? null) as string | null, activatedAt: k.activated_at ?? null,
    fp: (k.device_fingerprint ?? null) as string | null, model: k.device_model ?? null, os: k.device_os ?? null,
    product: k.product_id ? productDisplayName(k.product_id) : null, productId: k.product_id ?? null,
    entity: (k.school_id ?? k.vendor_id ?? k.parent_id ?? null) as string | null, owner: k.schools?.name ?? k.vendors?.vendor_name ?? k.parents?.kid_name ?? null,
  };
}

export async function getActiveDevices(f: { q?: string; panel?: string; page?: number; pageSize?: number }): Promise<ActionResult<{ rows: any[]; total: number; page: number; panels: Panel[] }>> {
  return guard(async () => {
    const a = await viewer();
    const panels = panelsFor(a).filter((p) => !f.panel || p === f.panel);
    const nowIso = iso(Date.now());
    const cfg = await loadOps(a.panel);
    const rows: ReturnType<typeof keyRow>[] = [];
    const rawKey = new Map<string, string>(); // key id → full key, server-side only (rows show it masked)
    for (const p of panels) {
      const { data } = await fetchAllPages<any>((from, to) => panelDb(p).from('activation_keys').select(KEY_COLS)
        .eq('status', 'Active').not('device_fingerprint', 'is', null).or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('id').range(from, to));
      const q = cleanLine(f.q, 80)?.toLowerCase();
      // Search matches the activation key too (rows only ever show it masked).
      rows.push(...data.filter((k) => !q || String(k.key ?? '').toLowerCase().includes(q)
        || [keyRow(p, k).owner, k.device_model, k.product_id && productDisplayName(k.product_id), k.device_fingerprint].some((v) => v && String(v).toLowerCase().includes(q)))
        .map((k) => { rawKey.set(k.id, String(k.key ?? '')); return keyRow(p, k); }).filter((r) => p !== a.panel || inScope(a, r.entity)));
    }
    // Online/offline + version PER KEY: one device can run several apps (one key each), so the
    // per-device device_status row is only trusted for the key that sent its last heartbeat;
    // every key's own last heartbeat comes from ops_key_presence (written by /api/device/ping).
    const ds = new Map<string, any>();
    for (const p of panels) {
      const fps = rows.filter((r) => r.panel === p && r.fp).map((r) => r.fp!);
      for (let i = 0; i < fps.length; i += 500) {
        const { data } = await panelDb(p).from('device_status').select('device_fingerprint, activation_key, app_version, last_seen').in('device_fingerprint', fps.slice(i, i + 500));
        for (const d of data ?? []) ds.set(`${p}|${d.device_fingerprint}`, d);
      }
    }
    const presence = new Map((await (await col('ops_key_presence')).find({ _id: { $in: rows.map((r) => `${r.panel}:${r.keyId}`) as never[] } }).toArray())
      .map((x: any) => [String(x._id), x]));
    const statusOf = (r: (typeof rows)[number]) => {
      const pr: any = presence.get(`${r.panel}:${r.keyId}`);
      const d = ds.get(`${r.panel}|${r.fp}`);
      const viaDevice = d && d.activation_key === rawKey.get(r.keyId) ? d : null;
      const last = [pr?.last_seen ? new Date(pr.last_seen).toISOString() : null, viaDevice?.last_seen ?? null].filter(Boolean).sort().at(-1) ?? null;
      return { lastSeen: last as string | null, version: (pr?.app_version ?? viaDevice?.app_version ?? null) as string | null };
    };
    const st = new Map(rows.map((r) => [r.keyId, statusOf(r)]));
    const seen = (r: (typeof rows)[number]) => st.get(r.keyId)?.lastSeen ?? '';
    rows.sort((x, y) => seen(y).localeCompare(seen(x)));
    const size = Math.min(100, Math.max(5, Number(f.pageSize) || 50));
    // A page past the end (rows expired or a narrower search) falls back to the last page.
    const page = Math.min(Math.max(0, Number(f.page) || 0), Math.max(0, Math.ceil(rows.length / size) - 1));
    const slice = rows.slice(page * size, page * size + size);
    // Errors per key = that device's errors from THIS key's product (events carry the key's pinned product).
    const errs = slice.length ? await (await col('diag_events')).aggregate([
      { $match: { panel: { $in: panels }, machine_id: { $in: slice.map((r) => r.fp!) }, severity: { $in: ERR }, ts: { $gte: new Date(Date.now() - 86_400_000) } } },
      { $group: { _id: { p: '$panel', m: '$machine_id', pr: '$product_id' }, n: { $sum: 1 } } },
    ]).toArray() : [];
    const errN = (r: (typeof rows)[number]) => errs.filter((e: any) => e._id.p === r.panel && e._id.m === r.fp && (!r.productId || e._id.pr === r.productId))
      .reduce((s, e: any) => s + Number(e.n), 0);
    const now = Date.now();
    return ok({
      total: rows.length, page, panels,
      rows: slice.map((r) => {
        const s = st.get(r.keyId)!;
        return { ...r, version: s.version, lastSeen: s.lastSeen, state: heartbeatState(s.lastSeen, now, cfg.onlineMinutes, cfg.staleMinutes), errors24h: errN(r) };
      }),
    });
  });
}

/** Everything one device reported (events + crashes), newest first; an offline backlog keeps its real time.
 *  Rows linked to a bug carry its code + status, so fixed bugs can be told apart. */
export async function getDeviceLogs(f: { panel: string; keyId: string; category?: string; q?: string; page?: number; limit?: number }): Promise<ActionResult<{ rows: any[]; total: number; crashes: any[]; byCategory: Record<string, number> }>> {
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
    const size = Math.min(1000, Math.max(20, Number(f.limit) || 100));
    const q: Record<string, unknown> = { panel: p, machine_id: fp };
    const cat = cleanLine(f.category, 30);
    if (cat) q.category = cat;
    const s = cleanLine(f.q, 80);
    if (s) q.$or = ['message', 'event_type', 'feature', 'action'].map((field) => ({ [field]: contains(s) }));
    const [events, crashes] = await Promise.all([col('diag_events'), col('diag_crashes')]);
    const [data, total, crashRows, cats] = await Promise.all([
      events.find(q, fields('id, ts, received_at, severity, event_type, category, module, feature, action, result, message, product_version, session_id, issue_id, data'))
        .sort({ ts: -1 }).skip(page * size).limit(size).toArray(),
      events.countDocuments(q, { limit: 10_000 }),
      crashes.find({ panel: p, machine_id: fp }, fields('id, code, ts, event_type, current_screen, actual_behavior, product_version, issue_id')).sort({ ts: -1 }).limit(20).toArray(),
      events.aggregate([{ $match: { panel: p, machine_id: fp, ts: { $gte: new Date(Date.now() - 30 * 86_400_000) } } }, { $group: { _id: '$category', n: { $sum: 1 } } }]).toArray(),
    ]);
    const byCategory: Record<string, number> = Object.fromEntries(cats.map((c: any) => [c._id, Number(c.n)]));
    const [rows, crashList] = await Promise.all([attachBugs(toRows(data)), attachBugs(toRows(crashRows))]);
    return ok({ rows, total, crashes: crashList, byCategory });
  });
}

/** Bug code + status for rows linked to an issue (so fixed bugs can be shown differently). */
async function attachBugs<R extends { issue_id?: string | null }>(rows: R[]): Promise<(R & { bug: { code: string; status: string; fixedIn: string | null } | null })[]> {
  const ids = [...new Set(rows.map((r) => r.issue_id).filter(Boolean))] as string[];
  const data = ids.length ? await (await col('diag_issues')).find({ _id: { $in: ids as never[] } }, fields('code, status, fixed_version')).toArray() : [];
  const m = new Map(data.map((i: any) => [String(i._id), i]));
  return rows.map((r) => { const i: any = r.issue_id ? m.get(r.issue_id) : null; return { ...r, bug: i ? { code: i.code, status: i.status, fixedIn: i.fixed_version ?? null } : null }; });
}


// ── Open incidents + alerts (the "Points lost" lines of Overall Health) ─────────────────────────
// Same set the score counts: incidents not RESOLVED/CLOSED and alerts not RESOLVED, in every visible panel.
const PANEL_NAME: Record<string, string> = { lms: 'LMS School', lab: 'Lab' };
export async function listOpenOps(): Promise<ActionResult<{ incidents: any[]; alerts: any[] }>> {
  return guard(async () => {
    const a = await viewer();
    const panel = { $in: visiblePanels(a) };
    const [incidents, alerts] = await Promise.all([
      col('ops_incidents').then((c) => c.find({ panel, status: { $nin: ['RESOLVED', 'CLOSED'] } }).sort({ started_at: -1 }).limit(50).toArray()).then(toRows),
      col('ops_alerts').then((c) => c.find({ panel, status: { $ne: 'RESOLVED' } }).sort({ last_at: -1 }).limit(50).toArray()).then(toRows),
    ]);
    const label = (r: any) => ({ ...r, panelLabel: PANEL_NAME[r.panel] ?? r.panel });
    const withErrors = await Promise.all(incidents.map(async (i: any) => ({ ...label(i), errors: await incidentErrors(i) })));
    return ok({ incidents: withErrors, alerts: alerts.map(label) });
  });
}

/**
 * The errors behind an incident: crash reports and ERROR/CRITICAL/FATAL events of its panel (and
 * product, if set) from 24 h before it opened (the window its metric was computed over) until it
 * was resolved, or now. Newest first, capped so the modal stays light.
 */
const INCIDENT_ERRORS_MAX = 100;
async function incidentErrors(i: any) {
  const started = Date.parse(i.started_at);
  const ts = { $gte: new Date(started - 86_400_000), $lte: i.resolved_at ? new Date(i.resolved_at) : new Date() };
  const match = { panel: i.panel, ts, ...PROD, ...(i.product_id ? { product_id: i.product_id } : {}) };
  const f = 'ts, event_type, product_id, product_version, computer_name, school_name, session_id, issue_id';
  const [crashes, events] = await Promise.all([
    col('diag_crashes').then((c) => c.find(match, fields(`${f}, exception`)).sort({ ts: -1 }).limit(INCIDENT_ERRORS_MAX).toArray()).then(toRows),
    col('diag_events').then((c) => c.find({ ...match, severity: { $in: ['ERROR', 'CRITICAL', 'FATAL'] } }, fields(`${f}, severity, message`)).sort({ ts: -1 }).limit(INCIDENT_ERRORS_MAX).toArray()).then(toRows),
  ]);
  const rows = [
    ...crashes.map(({ exception, ...c }: any) => ({ ...c, kind: 'CRASH', severity: 'FATAL', message: exception?.message ?? exception?.type ?? null })),
    ...events.map((e: any) => ({ ...e, kind: 'EVENT' })),
  ].sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts)).slice(0, INCIDENT_ERRORS_MAX);
  return attachBugs(rows);
}

/** Take ownership of an incident: DETECTED → INVESTIGATING (noted in its update history). */
export async function investigateIncident(id: string, note: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    const incidents = await col('ops_incidents');
    const inc = await incidents.findOne({ _id: String(id).slice(0, 64) as never, panel: { $in: visiblePanels(a) } }, fields('status, code'));
    if (!inc) return fail('Not found.');
    if (inc.status !== 'DETECTED') return ok(undefined); // already investigating, or resolved
    const now = new Date();
    const r = await incidents.updateOne({ _id: inc._id, status: 'DETECTED' }, { $set: { status: 'INVESTIGATING' },
      $push: { updates: { at: now.toISOString(), by: a.email, status: 'INVESTIGATING', note: cleanLine(note, 500) ?? '' } } as never });
    if (r.modifiedCount) await audit(a, 'OPS_INCIDENT_INVESTIGATING', inc.code, 'OK');
    return ok(undefined);
  });
}

/** Resolve an incident with a note (kept in its update history). It stops counting against the score.
 *  Flow: DETECTED → INVESTIGATING (investigateIncident) → RESOLVED. */
export async function resolveIncident(id: string, note: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    const incidents = await col('ops_incidents');
    const inc = await incidents.findOne({ _id: String(id).slice(0, 64) as never, panel: { $in: visiblePanels(a) } }, fields('status, updates, code'));
    if (!inc) return fail('Not found.');
    if (['RESOLVED', 'CLOSED'].includes(inc.status)) return ok(undefined);
    if (inc.status !== 'INVESTIGATING') return fail('Start investigating first.');
    const now = new Date();
    await incidents.updateOne({ _id: inc._id }, { $set: { status: 'RESOLVED', resolved_at: now },
      $push: { updates: { at: now.toISOString(), by: a.email, status: 'RESOLVED', note: cleanLine(note, 500) ?? '' } } as never });
    await audit(a, 'OPS_INCIDENT_RESOLVED', inc.code, 'OK');
    return ok(undefined);
  });
}

/** Resolve an alert. If its rule is still breached, the next evaluation opens a new one. */
export async function resolveAlert(id: string): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('OPS_MANAGE');
    const r = await (await col('ops_alerts')).updateOne({ _id: String(id).slice(0, 64) as never, panel: { $in: visiblePanels(a) }, status: { $ne: 'RESOLVED' } },
      { $set: { status: 'RESOLVED', resolved_at: new Date(), acknowledged_by: a.email } });
    if (r.matchedCount) await audit(a, 'OPS_ALERT_RESOLVED', id, 'OK');
    return ok(undefined);
  });
}
