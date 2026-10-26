// ============================================================================
// Siddesh Logs / Operations Center — the former Postgres functions, as MongoDB operations.
//   diag_touch_issue      → touchIssue        (atomic upsert of a fingerprint group)
//   assign_record_code    → allocCode         (BUG-/CR-/INC- codes; counter still in Supabase)
//   ops_event_series      → eventSeries       (bucketed counts)
//   ops_percentiles       → percentiles       (P50…P99 of reported durations)
//   ops_activity_refresh  → activityRefresh   (compact daily history, counters only go up)
//   diag_storage_stats    → storageStats      (+ MongoDB free-tier usage)
// ============================================================================
import 'server-only';
import { randomUUID } from 'crypto';
import type { Document } from 'mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import { QUOTA_BYTES, col, logsDb, toRow } from './mongo';

/* eslint-disable @typescript-eslint/no-explicit-any -- aggregation results */

// ── Record codes ────────────────────────────────────────────────────────────
/** 0001 … 9999, then 10000 … (same as public_id_pad). */
export const padSeq = (n: number) => (n < 10000 ? String(n).padStart(4, '0') : String(n));
const utc = (d: Date, len: 4 | 8) => d.toISOString().slice(0, 10).replace(/-/g, '').slice(0, len);

/**
 * Next code PREFIX-PERIOD-NNNN. The counter stays in Supabase (next_public_seq, shared with the
 * account ids), so numbering continues from the old records and is unique across both panels.
 * Without that function (standard-ids.sql not run) a MongoDB counter keeps codes unique.
 */
export async function allocCode(prefix: 'BUG' | 'CR' | 'INC', at: Date = new Date()): Promise<string> {
  const period = prefix === 'CR' ? utc(at, 8) : utc(at, 4);
  const { data, error } = await supabaseAdmin.rpc('next_public_seq', { p_scope: prefix, p_period: period });
  let n = Number(data);
  if (error || !Number.isFinite(n) || n <= 0) {
    const c = await (await col<{ _id: string; v: number }>('counters')).findOneAndUpdate(
      { _id: `${prefix}:${period}` }, { $inc: { v: 1 } }, { upsert: true, returnDocument: 'after' });
    n = Number(c?.v ?? 1);
  }
  return `${prefix}-${period}-${padSeq(n)}`;
}

// ── Issues ──────────────────────────────────────────────────────────────────
export type TouchArgs = {
  panel: string; fingerprint: string; kind: string; severity: string; title: string; product: string | null; excType: string | null;
  message: string | null; stack: string | null; expected: string | null; actual: string | null; school: string | null; machine: string | null;
  version: string | null; module: string | null; count: number; seen: string; environment?: string;
};
const CLOSED = ['RESOLVED', 'DELETE_PENDING', 'DELETED'];
const lit = (v: unknown) => ({ $literal: v });
/** Append v unless null, already present, or the list reached cap (same rule as the SQL). */
const addCapped = (field: string, v: string | null, cap: number) => (v === null ? `$${field}` : {
  $cond: [{ $or: [{ $in: [lit(v), `$${field}`] }, { $gte: [{ $size: `$${field}` }, cap] }] }, `$${field}`, { $concatArrays: [`$${field}`, [lit(v)]] }],
});

/** Count occurrences into the issue of this fingerprint (creating it with a BUG- code); returns its id. */
export async function touchIssue(t: TouchArgs): Promise<string> {
  const issues = await col('diag_issues');
  const env = t.environment === 'test' ? 'test' : 'production';
  const seen = new Date(t.seen);
  const crash = t.kind === 'CRASH';
  const update: Document[] = [
    { $set: {
      _closed: { $in: ['$status', CLOSED] },
      occurrence_count: { $add: ['$occurrence_count', t.count] },
      last_seen_at: { $max: ['$last_seen_at', lit(seen)] },
      severity: crash ? lit(t.severity) : '$severity',
      kind: crash ? lit('CRASH') : '$kind',
      stack_sample: { $ifNull: ['$stack_sample', lit(t.stack)] },
      message_sample: { $ifNull: ['$message_sample', lit(t.message)] },
      affected_schools: addCapped('affected_schools', t.school, 500),
      affected_machines: addCapped('affected_machines', t.machine, 500),
      affected_versions: addCapped('affected_versions', t.version, 200),
      affected_modules: addCapped('affected_modules', t.module, 200),
      environment: env === 'production' ? lit('production') : '$environment',
    } },
    { $set: {
      status: { $cond: ['$_closed', 'REOPENED', '$status'] },
      reopen_count: { $add: ['$reopen_count', { $cond: ['$_closed', 1, 0] }] },
      delete_after: { $cond: ['$_closed', null, '$delete_after'] },
      deleted_at: { $cond: ['$_closed', null, '$deleted_at'] },
    } },
    { $unset: '_closed' },
  ];
  const filter = { panel: t.panel, fingerprint: t.fingerprint };
  const existing = await issues.findOneAndUpdate(filter, update, { projection: { _id: 1 } });
  if (existing) return String(existing._id);
  const id = randomUUID();
  const arr = (v: string | null) => (v === null ? [] : [v]);
  try {
    await issues.insertOne({
      _id: id as any, code: await allocCode('BUG'), panel: t.panel, fingerprint: t.fingerprint, kind: t.kind, severity: t.severity, title: t.title,
      product_id: t.product, exception_type: t.excType, message_sample: t.message, stack_sample: t.stack, expected_behavior: t.expected,
      actual_behavior: t.actual, status: 'NEW', occurrence_count: t.count, affected_schools: arr(t.school), affected_machines: arr(t.machine),
      affected_versions: arr(t.version), affected_modules: arr(t.module), first_seen_at: seen, last_seen_at: seen, created_at: new Date(),
      downloaded_at: null, resolved_at: null, resolved_by: null, root_cause: null, resolution: null, fixed_version: null, developer_notes: null,
      delete_after: null, deleted_at: null, reopen_count: 0, environment: env,
    });
    return id;
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    // Lost a race with a concurrent insert of the same fingerprint → count into that row.
    const won = await issues.findOneAndUpdate(filter, update, { projection: { _id: 1 } });
    if (!won) throw e;
    return String(won._id);
  }
}

// ── Series / percentiles / activity ─────────────────────────────────────────
const ERR = ['ERROR', 'CRITICAL', 'FATAL'];
const nonNull = (arr: string) => ({ $size: { $setDifference: [arr, [null]] } });

export type SeriesRow = { bucket: string; events: number; errors: number; warnings: number; crashes: number; machines: number; users: number };
/** Same as ops_event_series: buckets of `bucketS` seconds starting at `from` (date_bin). */
const panelMatch = (panel: string | string[]) => (Array.isArray(panel) ? { $in: panel } : panel);
/** Production rows only: developer runs (environment "test") stay out of rates, alerts and incidents. Untagged (older) rows count as production. */
export const PROD = { environment: { $ne: 'test' } } as const;
export async function eventSeries(panel: string | string[], from: string, to: string, bucketS: number, product: string | null): Promise<SeriesRow[]> {
  const f = new Date(from), ms = bucketS * 1000;
  const rows = await (await col('diag_events')).aggregate([
    { $match: { panel: panelMatch(panel), ts: { $gte: f, $lt: new Date(to) }, ...PROD, ...(product ? { product_id: product } : {}) } },
    { $group: {
      _id: { $add: [f, { $multiply: [{ $floor: { $divide: [{ $subtract: ['$ts', f] }, ms] } }, ms] }] },
      events: { $sum: 1 },
      errors: { $sum: { $cond: [{ $in: ['$severity', ERR] }, 1, 0] } },
      warnings: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } },
      crashes: { $sum: { $cond: [{ $eq: ['$category', 'CRASH'] }, 1, 0] } },
      m: { $addToSet: '$machine_id' }, u: { $addToSet: '$user_id' },
    } },
    { $project: { _id: 0, bucket: '$_id', events: 1, errors: 1, warnings: 1, crashes: 1, machines: nonNull('$m'), users: nonNull('$u') } },
    { $sort: { bucket: 1 } },
  ], { allowDiskUse: true }).toArray();
  return rows.map((r) => ({ ...(r as any), bucket: (r.bucket as Date).toISOString() }));
}

/**
 * Crash rate by session: distinct app sessions seen in the window (events ∪ crash reports) and how
 * many of them have a crash report. Per session, so one PC force-closed twice can't read as "200%".
 */
export async function sessionCrashStats(panel: string | string[], from: string, to: string, product: string | null): Promise<{ sessions: number; crashed: number }> {
  const match = { panel: panelMatch(panel), ts: { $gte: new Date(from), $lt: new Date(to) }, session_id: { $type: 'string' }, ...PROD, ...(product ? { product_id: product } : {}) };
  const [r] = await (await col('diag_events')).aggregate([
    { $match: match },
    { $group: { _id: '$session_id' } },
    { $project: { c: { $literal: 0 } } },
    { $unionWith: { coll: 'diag_crashes', pipeline: [{ $match: match }, { $group: { _id: '$session_id' } }, { $project: { c: { $literal: 1 } } }] } },
    { $group: { _id: '$_id', c: { $max: '$c' } } },
    { $group: { _id: null, sessions: { $sum: 1 }, crashed: { $sum: '$c' } } },
  ], { allowDiskUse: true }).toArray();
  return { sessions: Number(r?.sessions ?? 0), crashed: Number(r?.crashed ?? 0) };
}

/** Key of the per-product maps below: `<panel>|<product_id>`. */
export const productKey = (panel: string, product: string) => `${panel}|${product}`;
export type ProductTotals = { events: number; errors: number; crashes: number; users: number };

/**
 * eventSeries totals over the whole window for EVERY (panel, product) at once — one aggregation
 * instead of one per product. Same match rules (production rows, time window) as eventSeries.
 */
export async function eventTotalsByProduct(panels: string[], from: string, to: string): Promise<Map<string, ProductTotals>> {
  const rows = await (await col('diag_events')).aggregate([
    { $match: { panel: { $in: panels }, ts: { $gte: new Date(from), $lt: new Date(to) }, product_id: { $type: 'string' }, ...PROD } },
    { $group: {
      _id: { panel: '$panel', product: '$product_id' },
      events: { $sum: 1 },
      errors: { $sum: { $cond: [{ $in: ['$severity', ERR] }, 1, 0] } },
      crashes: { $sum: { $cond: [{ $eq: ['$category', 'CRASH'] }, 1, 0] } },
      u: { $addToSet: '$user_id' },
    } },
    { $project: { _id: 1, events: 1, errors: 1, crashes: 1, users: nonNull('$u') } },
  ], { allowDiskUse: true }).toArray();
  return new Map(rows.map((r: any) => [productKey(r._id.panel, r._id.product),
    { events: r.events, errors: r.errors, crashes: r.crashes, users: r.users }]));
}

/** sessionCrashStats for EVERY (panel, product) at once — same per-session rules, one aggregation. */
export async function sessionCrashStatsByProduct(panels: string[], from: string, to: string): Promise<Map<string, { sessions: number; crashed: number }>> {
  const match = { panel: { $in: panels }, ts: { $gte: new Date(from), $lt: new Date(to) }, session_id: { $type: 'string' }, product_id: { $type: 'string' }, ...PROD };
  const bySession = { panel: '$panel', product: '$product_id', session: '$session_id' };
  const rows = await (await col('diag_events')).aggregate([
    { $match: match },
    { $group: { _id: bySession } },
    { $project: { c: { $literal: 0 } } },
    { $unionWith: { coll: 'diag_crashes', pipeline: [{ $match: match }, { $group: { _id: bySession } }, { $project: { c: { $literal: 1 } } }] } },
    { $group: { _id: '$_id', c: { $max: '$c' } } },
    { $group: { _id: { panel: '$_id.panel', product: '$_id.product' }, sessions: { $sum: 1 }, crashed: { $sum: '$c' } } },
  ], { allowDiskUse: true }).toArray();
  return new Map(rows.map((r: any) => [productKey(r._id.panel, r._id.product), { sessions: Number(r.sessions), crashed: Number(r.crashed) }]));
}

/** Same as ops_percentiles (approximate percentiles; exact enough for P50…P99 dashboards). */
export async function percentiles(panel: string | string[], from: string, to: string, product: string | null) {
  const at = (i: number) => ({ $arrayElemAt: ['$pcts', i] });
  const rows = await (await col('diag_events')).aggregate([
    { $match: { panel: panelMatch(panel), ts: { $gte: new Date(from), $lt: new Date(to) }, duration_ms: { $ne: null }, ...PROD, ...(product ? { product_id: product } : {}) } },
    { $group: {
      _id: { category: '$category', name: { $cond: [{ $eq: ['$category', 'API'] }, { $ifNull: ['$feature', '$event_type'] }, '$event_type'] } },
      n: { $sum: 1 },
      errors: { $sum: { $cond: [{ $or: [{ $in: ['$event_type', ['API_REQUEST_FAILED', 'API_TIMEOUT']] }, { $eq: ['$result', 'FAIL'] }] }, 1, 0] } },
      pcts: { $percentile: { input: '$duration_ms', p: [0.5, 0.75, 0.9, 0.95, 0.99], method: 'approximate' } },
    } },
    { $sort: { n: -1 } }, { $limit: 50 },
    { $project: { _id: 0, category: '$_id.category', name: '$_id.name', n: 1, errors: 1, p50: at(0), p75: at(1), p90: at(2), p95: at(3), p99: at(4) } },
  ], { allowDiskUse: true }).toArray();
  return rows as { category: string; name: string; n: number; errors: number; p50: number; p75: number; p90: number; p95: number; p99: number }[];
}

/** Same as ops_activity_refresh: re-aggregate the last `days` UTC days; counters only ever go up. */
export async function activityRefresh(panel: string, days: number): Promise<number> {
  const first = new Date(); first.setUTCHours(0, 0, 0, 0); first.setUTCDate(first.getUTCDate() - (Math.max(1, days) - 1));
  const events = await col('diag_events');
  const groupBy = (product: unknown) => events.aggregate([
    { $match: { panel, ts: { $gte: first }, ...PROD } },
    { $group: {
      _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: 'UTC' } }, product },
      events: { $sum: 1 }, errors: { $sum: { $cond: [{ $in: ['$severity', ERR] }, 1, 0] } },
      warnings: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } }, crashes: { $sum: { $cond: [{ $eq: ['$category', 'CRASH'] }, 1, 0] } },
      m: { $addToSet: '$machine_id' }, u: { $addToSet: '$user_id' },
    } },
  ], { allowDiskUse: true }).toArray();
  const [perProduct, all] = await Promise.all([groupBy({ $ifNull: ['$product_id', '_unknown'] }), groupBy('_all')]);
  const daily = await col('ops_activity_daily');
  const ops = [...perProduct, ...all].map((r: any) => {
    const vals = { events: r.events, errors: r.errors, warnings: r.warnings, crashes: r.crashes,
      devices: r.m.filter((x: unknown) => x !== null).length, users: r.u.filter((x: unknown) => x !== null).length };
    return { updateOne: { filter: { panel, day: r._id.day, product_id: r._id.product }, update: { $max: vals }, upsert: true } };
  });
  if (ops.length) await daily.bulkWrite(ops, { ordered: false });
  // Daily health = average of that day's hourly snapshots.
  const health = await (await col('ops_rollups')).aggregate([
    { $match: { panel, granularity: 'hour', product_id: '_all', metric: 'health_score', bucket: { $gte: first } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$bucket', timezone: 'UTC' } }, v: { $avg: '$value' } } },
  ]).toArray();
  if (health.length) await daily.bulkWrite(health.map((h: any) => ({ updateOne: { filter: { panel, day: h._id, product_id: '_all' }, update: { $set: { health_score: h.v } }, upsert: true } })), { ordered: false });
  return ops.length;
}

// ── Storage ─────────────────────────────────────────────────────────────────
/** Bytes used in the MongoDB database (data + indexes) vs the free-tier quota. */
export async function mongoUsage(): Promise<{ used: number; quota: number; pct: number }> {
  const s = await (await logsDb()).stats();
  const used = Number(s.dataSize ?? 0) + Number(s.indexSize ?? 0);
  return { used, quota: QUOTA_BYTES, pct: (used / QUOTA_BYTES) * 100 };
}

/** Biggest collections (data + indexes) and the total document count. */
export async function mongoCollections(): Promise<{ documents: number; collections: { name: string; bytes: number; count: number }[] }> {
  const db = await logsDb();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  const stats = await Promise.all(names.map(async (name) => {
    try {
      const [s] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
      const st: any = s?.storageStats ?? {};
      return { name, bytes: Number(st.size ?? 0) + Number(st.totalIndexSize ?? 0), count: Number(st.count ?? 0) };
    } catch { return { name, bytes: 0, count: 0 }; }
  }));
  stats.sort((a, b) => b.bytes - a.bytes);
  return { documents: stats.reduce((s, c) => s + c.count, 0), collections: stats };
}

let pressureCache: { at: number; pct: number } | null = null;
/** % of the free-tier quota in use, refreshed at most every 5 minutes (0 when it cannot be read). */
export async function storagePressure(): Promise<number> {
  if (pressureCache && Date.now() - pressureCache.at < 5 * 60_000) return pressureCache.pct;
  const pct = await mongoUsage().then((u) => u.pct).catch(() => 0);
  pressureCache = { at: Date.now(), pct };
  return pct;
}

/** Same fields as diag_storage_stats (events/crashes/issues/audit sizes now from MongoDB). */
export async function storageStats(panel: string) {
  const db = await logsDb();
  const size = async (name: string) => {
    try { const s = await db.command({ collStats: name }); return Number(s.size ?? 0) + Number(s.totalIndexSize ?? 0); } catch { return 0; }
  };
  const issues = db.collection('diag_issues');
  const [ev, cr, is, au, usage, evN, crN, open, pend, oldest, arts, resolvedIds] = await Promise.all([
    size('diag_events'), size('diag_crashes'), size('diag_issues'), size('diag_audit'), mongoUsage(),
    db.collection('diag_events').countDocuments({ panel }), db.collection('diag_crashes').countDocuments({ panel }),
    issues.countDocuments({ panel, status: { $nin: CLOSED } }), issues.countDocuments({ panel, status: { $in: ['RESOLVED', 'DELETE_PENDING'] } }),
    db.collection('diag_events').find({ panel }, { projection: { ts: 1 } }).sort({ ts: 1 }).limit(1).next(),
    db.collection('diag_artifacts').aggregate([{ $match: { panel } }, { $group: { _id: '$kind', count: { $sum: 1 }, bytes: { $sum: '$size_bytes' } } }]).toArray(),
    issues.distinct('_id', { panel, status: { $in: ['RESOLVED', 'DELETE_PENDING'] } }),
  ]);
  const pendingBytes = await db.collection('diag_artifacts').aggregate([
    { $match: { panel, $or: [{ status: 'DELETE_PENDING' }, { issue_id: { $in: resolvedIds } }] } }, { $group: { _id: null, b: { $sum: '$size_bytes' } } },
  ]).next();
  return {
    events_table_bytes: ev, crashes_table_bytes: cr, issues_table_bytes: is, audit_table_bytes: au,
    db_bytes: usage.used, db_quota_bytes: usage.quota, db_usage_pct: usage.pct, store: 'MongoDB Atlas',
    events_count: evN, crashes_count: crN, issues_open: open, issues_pending_delete: pend,
    oldest_event: oldest ? toRow(oldest).ts : null,
    artifacts: Object.fromEntries(arts.map((a: any) => [a._id, { count: a.count, bytes: a.bytes }])),
    pending_delete_bytes: Number(pendingBytes?.b ?? 0),
  };
}
