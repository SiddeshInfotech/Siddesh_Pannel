// ============================================================================
// Siddesh Logs + Operations Center storage — MongoDB Atlas (free M0: 512 MB incl. indexes).
// Everything the Health and Logs tabs read/write lives here; business data (keys, schools,
// admin logins), the login rate limiter, the BUG-/CR-/INC- code counters and the artifact
// FILES stay in Supabase.
//
// Documents keep the old Postgres row shape (snake_case columns, `_id` = the row's `id`) so the
// actions and UI did not change shape: write rows with toDoc(), read them back with toRow().
// Timestamps are stored as BSON Dates (TTL + range queries) and come back as ISO strings.
// ============================================================================
import 'server-only';
import dns from 'node:dns';
import { MongoClient, type Collection, type Db, type Document, type IndexDescription } from 'mongodb';

export type LogsCollection =
  | 'diag_events' | 'diag_crashes' | 'diag_issues' | 'diag_artifacts' | 'diag_audit' | 'diag_roles' | 'diag_settings' | 'diag_cleanup_runs'
  | 'ops_device_metrics' | 'ops_rollups' | 'ops_activity_daily' | 'ops_alerts' | 'ops_alert_rules' | 'ops_incidents'
  | 'ops_releases' | 'ops_providers' | 'ops_provider_metrics' | 'ops_costs' | 'ops_settings' | 'ops_key_presence' | 'counters';

/** Postgres timestamptz columns → stored as Date. (`date` columns such as `day`/`month` stay 'YYYY-MM-DD' strings.) */
const DATE_FIELDS = new Set([
  'ts', 'received_at', 'expires_at', 'first_seen_at', 'last_seen_at', 'created_at', 'downloaded_at', 'resolved_at', 'delete_after',
  'deleted_at', 'at', 'started_at', 'finished_at', 'updated_at', 'reported_at', 'bucket', 'last_sync', 'fetched_at', 'breach_since',
  'first_at', 'last_at', 'first_seen',
]);

/**
 * An env value as the app should see it. Values pasted into a hosting UI often keep what a `.env` parser
 * would drop: a trailing "  # comment", surrounding quotes or spaces (e.g. MONGODB_DB=siddesh_logs  # optional).
 */
export function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const v = raw.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return v || undefined;
}
const DEFAULT_DB = 'siddesh_logs';
/** MongoDB database names: ≤ 38 bytes, none of  /\. "$*<>:|?  — anything else falls back to the default (and is logged). */
export function logsDbName(): string {
  const name = envValue('MONGODB_DB');
  if (!name) return DEFAULT_DB;
  if (Buffer.byteLength(name) <= 38 && !/[/\\. "$*<>:|?]/.test(name)) return name;
  console.error(`[mongo] MONGODB_DB "${name.slice(0, 60)}" is not a valid database name — using "${DEFAULT_DB}".`);
  return DEFAULT_DB;
}

export const QUOTA_BYTES = Math.max(1, Number(envValue('MONGODB_QUOTA_MB')) || 512) * 1024 * 1024;

// Indexes count toward the 512 MB — only what the queries need.
const INDEXES: Partial<Record<LogsCollection, IndexDescription[]>> = {
  diag_events: [
    { key: { panel: 1, ts: -1 } },
    { key: { panel: 1, category: 1, severity: 1, ts: -1 } },
    { key: { panel: 1, machine_id: 1, ts: -1 } },
    { key: { panel: 1, machine_id: 1, received_at: 1 } },
    { key: { panel: 1, entity_id: 1, ts: -1 } },
    { key: { issue_id: 1 }, partialFilterExpression: { issue_id: { $type: 'string' } } },
    { key: { fingerprint: 1, ts: 1 }, partialFilterExpression: { fingerprint: { $type: 'string' } } },
    { key: { expires_at: 1 }, expireAfterSeconds: 0 }, // native retention: Atlas deletes expired events itself
  ],
  diag_crashes: [{ key: { panel: 1, ts: -1 } }, { key: { panel: 1, machine_id: 1, ts: -1 } }, { key: { issue_id: 1, ts: -1 } }],
  diag_issues: [{ key: { panel: 1, fingerprint: 1 }, unique: true }, { key: { panel: 1, status: 1, last_seen_at: -1 } }, { key: { code: 1 }, unique: true }],
  diag_artifacts: [{ key: { issue_id: 1 } }, { key: { crash_id: 1 } }, { key: { panel: 1, status: 1 } }, { key: { storage_path: 1 }, unique: true }],
  diag_audit: [{ key: { panel: 1, at: -1 } }],
  diag_roles: [{ key: { panel: 1, email: 1 }, unique: true }],
  diag_cleanup_runs: [{ key: { panel: 1, started_at: -1 } }],
  ops_device_metrics: [{ key: { panel: 1, machine_id: 1 }, unique: true }],
  ops_rollups: [{ key: { panel: 1, granularity: 1, bucket: 1, product_id: 1, metric: 1 }, unique: true }, { key: { panel: 1, metric: 1, granularity: 1, bucket: -1 } }],
  ops_activity_daily: [{ key: { panel: 1, day: 1, product_id: 1 }, unique: true }],
  ops_alerts: [{ key: { panel: 1, status: 1, last_at: -1 } }, { key: { panel: 1, dedup_key: 1, status: 1 } }],
  ops_alert_rules: [{ key: { panel: 1 } }],
  ops_incidents: [{ key: { panel: 1, status: 1, started_at: -1 } }],
  ops_releases: [{ key: { panel: 1, product_id: 1, version: 1, environment: 1 }, unique: true }],
  ops_provider_metrics: [{ key: { provider_id: 1, metric: 1 }, unique: true }],
  ops_costs: [{ key: { month: 1, provider: 1, category: 1 }, unique: true }],
};

type G = typeof globalThis & { __siddeshMongo?: Promise<Db> };

async function connect(): Promise<Db> {
  const uri = envValue('MONGODB_URI');
  if (!uri) throw new Error('MONGODB_URI is not set — Health/Logs storage is unavailable.');
  // mongodb+srv:// needs a DNS SRV lookup (dns.resolveSrv). Some PCs' local resolvers refuse those
  // (querySrv ECONNREFUSED) while normal lookups work. MONGODB_DNS_SERVERS forces resolvers; without
  // it, a refused SRV lookup is retried once via public DNS. Only dns.resolve* is affected — normal
  // hostname lookups (Supabase, providers) keep using the OS resolver.
  const servers = (envValue('MONGODB_DNS_SERVERS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (servers.length) dns.setServers(servers);
  const open = async () => {
    // Pool 20: one Health overview runs ~17 queries at once (with 5 they queued in rounds). Atlas M0 allows 500 connections.
    const client = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000, appName: 'siddesh-panel' });
    await client.connect();
    return client;
  };
  let client: MongoClient;
  try {
    client = await open();
  } catch (e) {
    if (servers.length || !/querySrv|ECONNREFUSED|ETIMEOUT|ESERVFAIL/.test(e instanceof Error ? e.message : String(e))) throw e;
    console.warn('[mongo] SRV lookup refused by the local DNS resolver — retrying via public DNS (8.8.8.8, 1.1.1.1).');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    client = await open();
  }
  const db = client.db(logsDbName());
  await ensureIndexes(db);
  return db;
}

/** One client per server instance (serverless invocations reuse it); a failed connect is retried next call. */
export function logsDb(): Promise<Db> {
  const g = globalThis as G;
  if (!g.__siddeshMongo) g.__siddeshMongo = connect().catch((e) => { g.__siddeshMongo = undefined; throw e; });
  return g.__siddeshMongo;
}

export async function col<T extends Document = Document>(name: LogsCollection): Promise<Collection<T>> {
  return (await logsDb()).collection<T>(name);
}

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all(Object.entries(INDEXES).map(([name, idx]) => db.collection(name).createIndexes(idx!).catch((e) => {
    console.error(`[mongo] index setup failed for ${name}:`, e instanceof Error ? e.message : e);
  })));
}

// ── Row ↔ document mapping ──────────────────────────────────────────────────
const asDate = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : v);

/** Postgres-shaped row → document: `id` → `_id`, timestamp strings → Date, undefined dropped. */
export function toDoc<T extends Record<string, unknown>>(row: T): Document {
  const out: Document = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (k === 'id') out._id = v;
    else out[k] = DATE_FIELDS.has(k) ? asDate(v) : v;
  }
  return out;
}

/** Same, for a `$set` patch (never renames `id`). */
export function toSet<T extends Record<string, unknown>>(patch: T): Document {
  const out: Document = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && k !== 'id') out[k] = DATE_FIELDS.has(k) ? asDate(v) : v;
  return out;
}

/** Document → Postgres-shaped row: `_id` → `id`, Date → ISO string. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toRow(doc: Document | null | undefined): any {
  if (!doc) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id') out.id = v;
    else out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toRows = (docs: Document[]): any[] => docs.map(toRow);

/** Projection from a column list ('id, ts, severity') — the old `.select(...)` strings, unchanged. */
export function fields(list: string): { projection: Record<string, 1> } {
  const projection: Record<string, 1> = {};
  for (const f of list.split(',').map((s) => s.trim()).filter(Boolean)) projection[f === 'id' ? '_id' : f] = 1;
  return { projection };
}

/** Case-insensitive "contains" (Postgres ilike %s%) with the input escaped. */
export const contains = (s: string) => ({ $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });

/** Mongo errors → the same user-facing text style as before. */
export function logsDbErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  // The real cause goes to the server log (Vercel → Logs); credentials in a URI are masked.
  console.error('[mongo] Health/Logs storage error:', name, m.replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***@').slice(0, 500));
  if (/MONGODB_URI is not set/.test(m)) return 'Logs/Health storage is not configured. Set MONGODB_URI (MongoDB Atlas) on the server and redeploy.';
  if (/quota|space|storage limit/i.test(m)) return 'Logs/Health storage is full (MongoDB free tier). Old data is being cleaned up — try again later.';
  if (/bad auth|authentication failed|auth.*fail/i.test(m) || (e as { code?: number })?.code === 18) {
    return 'MongoDB rejected the login. Check the user name and password in MONGODB_URI (special characters must be URL-encoded), then redeploy.';
  }
  if (/querySrv|ENOTFOUND|getaddrinfo/i.test(m)) return 'MongoDB address not found. Check the cluster host in MONGODB_URI (mongodb+srv://…mongodb.net).';
  if (/ServerSelection|ETIMEDOUT|ECONNREFUSED|timed out|ECONNRESET|not authorized.*IP|whitelist|IP access/i.test(name + ' ' + m)) {
    return 'Cannot reach MongoDB Atlas. In Atlas → Network Access, allow 0.0.0.0/0 (Vercel servers use changing IPs), then try again.';
  }
  if (/database name|Invalid namespace|is too long/i.test(m)) return 'MONGODB_DB is not a valid database name. Use e.g. siddesh_logs (no spaces or "# comments") and redeploy.';
  return 'Something went wrong. Please try again.';
}
