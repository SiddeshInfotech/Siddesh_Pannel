// MongoDB storage for Health/Logs: row mapping, the ported Postgres functions and the indexes,
// against a real (in-memory) mongod. Supabase is mocked — only next_public_seq is used.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('server-only', () => ({}));
const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a) } }));

let server: MongoMemoryServer;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = 'siddesh_test';
}, 120_000);
afterAll(async () => {
  const { logsDb } = await import('../diagnostics/mongo');
  await (await logsDb()).client.close();
  await server?.stop();
});

const ev = (over: Record<string, unknown>) => ({
  _id: crypto.randomUUID(), panel: 'lab', ts: new Date(), severity: 'INFO', event_type: 'SCREEN_OPENED', category: 'NAVIGATION',
  machine_id: 'm1', user_id: null, product_id: 'P1', expires_at: new Date(Date.now() + 86_400_000), ...over,
});

describe('MongoDB logs storage', () => {
  it('maps rows ↔ documents (id ↔ _id, timestamps ↔ Date)', async () => {
    const { toDoc, toRow } = await import('../diagnostics/mongo');
    const d = toDoc({ id: 'x1', ts: '2026-10-16T10:00:00.000Z', day: '2026-10-16', note: undefined, n: 1 });
    expect(d).toEqual({ _id: 'x1', ts: new Date('2026-10-16T10:00:00.000Z'), day: '2026-10-16', n: 1 });
    expect(toRow(d)).toEqual({ id: 'x1', ts: '2026-10-16T10:00:00.000Z', day: '2026-10-16', n: 1 });
  });

  it('creates indexes, including the TTL that expires raw events', async () => {
    const { col } = await import('../diagnostics/mongo');
    const idx = await (await col('diag_events')).indexes();
    expect(idx.find((i) => i.key.expires_at === 1)?.expireAfterSeconds).toBe(0);
    expect((await (await col('diag_issues')).indexes()).some((i) => i.unique && i.key.fingerprint === 1)).toBe(true);
  });

  it('allocates codes from Supabase next_public_seq, with a MongoDB fallback', async () => {
    const { allocCode, padSeq } = await import('../diagnostics/mongoOps');
    expect(padSeq(7)).toBe('0007');
    expect(padSeq(12345)).toBe('12345');
    rpc.mockResolvedValueOnce({ data: 42, error: null });
    expect(await allocCode('CR', new Date('2026-10-16T03:00:00Z'))).toBe('CR-20261016-0042');
    rpc.mockResolvedValue({ data: null, error: { message: 'function next_public_seq does not exist' } });
    const a = await allocCode('INC', new Date('2026-01-02T00:00:00Z'));
    const b = await allocCode('INC', new Date('2026-01-02T00:00:00Z'));
    expect([a, b]).toEqual(['INC-2026-0001', 'INC-2026-0002']);
  });

  it('touchIssue groups occurrences and reopens a resolved bug', async () => {
    const { touchIssue } = await import('../diagnostics/mongoOps');
    const { col } = await import('../diagnostics/mongo');
    rpc.mockResolvedValue({ data: 5, error: null });
    const base = { panel: 'lab', fingerprint: 'fp-1', kind: 'ERROR', severity: 'ERROR', title: 'Boom', product: 'P1', excType: 'IOException',
      message: 'm', stack: 's', expected: null, actual: null, school: 'S1', machine: 'M1', version: '1.0', module: 'Video', count: 2, seen: '2026-10-16T10:00:00Z' };
    const id = await touchIssue(base);
    const issues = await col('diag_issues');
    let doc = await issues.findOne({ _id: id as never });
    expect(doc).toMatchObject({ code: `BUG-${new Date().getUTCFullYear()}-0005`, occurrence_count: 2, status: 'NEW', affected_schools: ['S1'] });

    expect(await touchIssue({ ...base, count: 3, school: 'S2', seen: '2026-10-16T11:00:00Z' })).toBe(id);
    doc = await issues.findOne({ _id: id as never });
    expect(doc).toMatchObject({ occurrence_count: 5, affected_schools: ['S1', 'S2'], last_seen_at: new Date('2026-10-16T11:00:00Z') });

    await issues.updateOne({ _id: id as never }, { $set: { status: 'RESOLVED', delete_after: new Date() } });
    await touchIssue({ ...base, kind: 'CRASH', severity: 'FATAL', count: 1, message: '$where: literal text' });
    doc = await issues.findOne({ _id: id as never });
    expect(doc).toMatchObject({ status: 'REOPENED', reopen_count: 1, delete_after: null, kind: 'CRASH', severity: 'FATAL', occurrence_count: 6, message_sample: 'm' });
  });

  it('eventSeries buckets counts and distinct devices (nulls ignored)', async () => {
    const { col } = await import('../diagnostics/mongo');
    const { eventSeries } = await import('../diagnostics/mongoOps');
    const t0 = new Date('2026-10-16T00:00:00Z');
    await (await col('diag_events')).insertMany([
      ev({ ts: new Date(t0.getTime() + 10 * 60_000), machine_id: 'a' }),
      ev({ ts: new Date(t0.getTime() + 20 * 60_000), machine_id: 'b', severity: 'ERROR' }),
      ev({ ts: new Date(t0.getTime() + 70 * 60_000), machine_id: 'a', severity: 'WARNING', category: 'CRASH' }),
      ev({ ts: new Date(t0.getTime() + 80 * 60_000), machine_id: null, product_id: 'P2' }),
    ] as never[]);
    const s = await eventSeries('lab', t0.toISOString(), new Date(t0.getTime() + 2 * 3600_000).toISOString(), 3600, null);
    expect(s).toEqual([
      { bucket: '2026-10-16T00:00:00.000Z', events: 2, errors: 1, warnings: 0, crashes: 0, machines: 2, users: 0 },
      { bucket: '2026-10-16T01:00:00.000Z', events: 2, errors: 0, warnings: 1, crashes: 1, machines: 1, users: 0 },
    ]);
    expect((await eventSeries('lab', t0.toISOString(), new Date(t0.getTime() + 2 * 3600_000).toISOString(), 3600, 'P2'))[0].events).toBe(1);
  });

  it('percentiles reports P50…P99 of durations per operation', async () => {
    const { col } = await import('../diagnostics/mongo');
    const { percentiles } = await import('../diagnostics/mongoOps');
    const t = new Date('2026-10-15T05:00:00Z');
    await (await col('diag_events')).insertMany(Array.from({ length: 100 }, (_, i) => ev({ ts: t, category: 'PERFORMANCE', event_type: 'SLOW_OPERATION', duration_ms: i + 1 })) as never[]);
    const [p] = await percentiles('lab', '2026-10-15T00:00:00Z', '2026-10-15T23:00:00Z', null);
    expect(p).toMatchObject({ category: 'PERFORMANCE', name: 'SLOW_OPERATION', n: 100 });
    expect(p.p50).toBeGreaterThanOrEqual(49);
    expect(p.p50).toBeLessThanOrEqual(51);
    expect(p.p99).toBeGreaterThanOrEqual(98);
  });

  it('activityRefresh writes daily rows whose counters never go down', async () => {
    const { col } = await import('../diagnostics/mongo');
    const { activityRefresh } = await import('../diagnostics/mongoOps');
    const today = new Date().toISOString().slice(0, 10);
    const events = await col('diag_events');
    await events.insertMany([ev({ panel: 'lms', machine_id: 'x' }), ev({ panel: 'lms', machine_id: 'y', severity: 'ERROR' })] as never[]);
    await activityRefresh('lms', 1);
    const daily = await col('ops_activity_daily');
    expect(await daily.findOne({ panel: 'lms', day: today, product_id: '_all' })).toMatchObject({ events: 2, errors: 1, devices: 2 });
    await events.deleteMany({ panel: 'lms' });
    await events.insertOne(ev({ panel: 'lms' }) as never);
    await activityRefresh('lms', 1);
    expect(await daily.findOne({ panel: 'lms', day: today, product_id: '_all' })).toMatchObject({ events: 2, devices: 2 });
  });
  it('regroupIssues merges bugs that now share a fingerprint and is idempotent', async () => {
    const { col } = await import('../diagnostics/mongo');
    const { regroupIssues } = await import('../diagnostics/regroup');
    const issues = await col('diag_issues'), events = await col('diag_events');
    await issues.deleteMany({}); await events.deleteMany({});
    const bug = (id: string, n: number, status: string, day: number, machine: string) => ({
      _id: id, code: `BUG-${id}`, panel: 'lab', fingerprint: `old-${id}`, kind: 'WARNING', severity: 'WARNING', title: `UI_FREEZE: ${n}ms`, product_id: 'P1',
      status, occurrence_count: n, reopen_count: 0, affected_schools: ['S1'], affected_machines: [machine], affected_versions: ['1.0.0'], affected_modules: [],
      first_seen_at: new Date(`2026-10-${day}T00:00:00Z`), last_seen_at: new Date(`2026-10-${day}T01:00:00Z`), created_at: new Date(), environment: 'production',
    });
    await issues.insertMany([bug('a', 2, 'NEW', 10, 'M1'), bug('b', 3, 'RESOLVED', 11, 'M2'), bug('c', 1, 'REVIEWING', 12, 'M1'), { ...bug('d', 1, 'NEW', 9, 'M3'), product_id: 'P2' }] as never[]);
    const freeze = (issue: string, ms: number, product = 'P1') => ev({ issue_id: issue, product_id: product, panel: 'lab', event_type: 'UI_FREEZE', category: 'PERFORMANCE', severity: 'WARNING', message: `UI thread unresponsive for ${ms}ms` });
    await events.insertMany([freeze('a', 5015), freeze('b', 6614), freeze('c', 5002), freeze('d', 5009, 'P2')] as never[]);

    const plan = await regroupIssues({ dryRun: true });
    expect(plan.groups).toEqual([{ survivor: 'BUG-a', merged: ['BUG-b', 'BUG-c'], fingerprint: expect.any(String) }]);
    expect(await issues.countDocuments({})).toBe(4); // dry run changed nothing

    const r = await regroupIssues();
    expect(r.merged).toBe(2);
    const a = await issues.findOne({ _id: 'a' as never });
    expect(a).toMatchObject({ occurrence_count: 6, status: 'REVIEWING', affected_machines: ['M1', 'M2'], fingerprint: plan.groups[0].fingerprint,
      first_seen_at: new Date('2026-10-10T00:00:00Z'), last_seen_at: new Date('2026-10-12T01:00:00Z') });
    expect(await issues.countDocuments({ _id: { $in: ['b', 'c'] as never[] } })).toBe(0);
    expect(await events.countDocuments({ issue_id: 'a' })).toBe(3);
    expect((await issues.findOne({ _id: 'd' as never }))?.fingerprint).not.toBe('old-d'); // P2 freeze kept apart, fingerprint refreshed
    expect((await regroupIssues()).merged).toBe(0);
  });
  it('reads env values pasted with "# comments", quotes or spaces, and explains connection errors', async () => {
    const { envValue, logsDbName, logsDbErrorMessage } = await import('../diagnostics/mongo');
    const keep = process.env.MONGODB_DB;
    try {
      process.env.MONGODB_DB = 'siddesh_logs          # optional, default siddesh_logs';
      expect(envValue('MONGODB_DB')).toBe('siddesh_logs');
      process.env.MONGODB_DB = '"siddesh_logs"';
      expect(logsDbName()).toBe('siddesh_logs');
      process.env.MONGODB_DB = 'bad name/with.dots';
      expect(logsDbName()).toBe('siddesh_logs'); // invalid → default, never a broken database name
    } finally { process.env.MONGODB_DB = keep; }
    const silent = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(logsDbErrorMessage(Object.assign(new Error('Server selection timed out after 8000 ms'), { name: 'MongoServerSelectionError' }))).toMatch(/Network Access/);
    expect(logsDbErrorMessage(Object.assign(new Error('bad auth : authentication failed'), { code: 8000 }))).toMatch(/rejected the login/);
    expect(logsDbErrorMessage(new Error('querySrv ENOTFOUND _mongodb._tcp.x.mongodb.net'))).toMatch(/address not found/);
    silent.mockRestore();
  });
});
