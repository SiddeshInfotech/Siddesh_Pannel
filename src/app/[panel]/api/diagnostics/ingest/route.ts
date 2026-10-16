import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/sanitize';
import { authenticateDevice } from '@/lib/diagnostics/deviceAuth';
import { loadRetention, rateLimit } from '@/lib/diagnostics/server';
import { IngestSchema, normalizeCrash, normalizeEvent, type TouchSpec } from '@/lib/diagnostics/ingest';
import { LIMITS } from '@/lib/diagnostics/core';
import { cleanBatch } from '@/lib/diagnostics/cleaner';
import { col, toDoc } from '@/lib/diagnostics/mongo';
import { allocCode, storagePressure, touchIssue } from '@/lib/diagnostics/mongoOps';

// ============================================================================
// POST /api/diagnostics/ingest — batched, offline-queue friendly diagnostics upload.
//  • Device-bound auth (activation key + fingerprint), school identity from the server.
//  • Batch insert (≤500 events/request), idempotent: event_id / crash_id are PKs, so a
//    retried batch returns the same ids as `duplicates` and is never double-counted.
//  • Every field passes the central redaction/sanitizer; payloads are size-capped.
//  • Repetitive WARNINGs are sampled per fingerprint/day; crashes are never sampled.
//  • Responds with accepted/duplicate ids = upload confirmation; the client then drops them
//    from its local queue.
// ============================================================================
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bad = (status: number, msg: string) => NextResponse.json({ error: msg }, { status });

export async function POST(req: NextRequest) {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > LIMITS.requestBytes) return bad(413, 'Payload too large.');
  let text: string;
  try { text = await req.text(); } catch { return bad(400, 'Bad request.'); }
  if (text.length > LIMITS.requestBytes) return bad(413, 'Payload too large.');
  let parsed;
  try { parsed = IngestSchema.safeParse(JSON.parse(text)); } catch { return bad(400, 'Bad request.'); }
  if (!parsed.success) return bad(400, 'Bad request.');
  const body = parsed.data;

  const ip = getClientIp(req.headers);
  if (!(await rateLimit(`ingest-ip:${ip}`, 60_000, 120, true)) || !(await rateLimit(`ingest-fp:${body.device_fingerprint}`, 60_000, 30, true))) {
    return NextResponse.json({ error: 'Rate limited.' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const identity = await authenticateDevice(body.activation_key, body.device_fingerprint, body.product_id);
  if (!identity) return bad(401, 'Request rejected.');

  const now = new Date();
  const [evCol, crCol] = await Promise.all([col('diag_events'), col('diag_crashes')]);
  const cfg = await loadRetention(identity.panel);
  const rejected: { id: string | null; reason: string }[] = [];

  const events = body.events.map((r) => {
    const n = normalizeEvent(r, body, identity, cfg, now);
    if (!n) rejected.push({ id: (r as { event_id?: string })?.event_id ?? null, reason: 'invalid' });
    return n;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const crashes = body.crashes.map((r) => {
    const n = normalizeCrash(r, body, identity, now);
    if (!n) rejected.push({ id: (r as { crash_id?: string })?.crash_id ?? null, reason: 'invalid' });
    return n;
  }).filter((x): x is NonNullable<typeof x> => !!x);

  // Duplicate prevention BEFORE any counter is touched.
  const [seenEv, seenCr] = await Promise.all([
    events.length ? evCol.distinct('_id', { _id: { $in: events.map((e) => e.row.id) as never[] } }) : [],
    crashes.length ? crCol.distinct('_id', { _id: { $in: crashes.map((c) => c.row.id) as never[] } }) : [],
  ]);
  const dup = new Set([...seenEv, ...seenCr].map(String));
  const freshEvents = events.filter((e) => !dup.has(e.row.id));
  const freshCrashes = crashes.filter((c) => !dup.has(c.row.id));

  // One issue upsert per distinct fingerprint in the batch (count = occurrences).
  const groups = new Map<string, { t: TouchSpec; n: number; seen: string; version: string | null }>();
  for (const x of [...freshEvents, ...freshCrashes]) {
    if (!x.touch) continue;
    const g = groups.get(x.touch.fingerprint);
    if (g) { g.n++; if (x.row.ts > g.seen) g.seen = x.row.ts; if (x.touch.kind === 'CRASH') g.t = x.touch; }
    else groups.set(x.touch.fingerprint, { t: x.touch, n: 1, seen: x.row.ts, version: x.row.product_version });
  }
  const issueByFp = new Map<string, string>();
  for (const [fp, g] of groups) {
    try {
      issueByFp.set(fp, await touchIssue({
        panel: identity.panel, fingerprint: fp, kind: g.t.kind, severity: g.t.severity, title: g.t.title,
        product: identity.productId, excType: g.t.exc_type, message: g.t.message, stack: g.t.stack,
        expected: g.t.expected, actual: g.t.actual, school: identity.entityId, machine: identity.machineId,
        version: g.version, module: g.t.module, count: g.n, seen: g.seen, environment: body.environment ?? 'production',
      }));
    } catch (e) { console.error('[ingest] issue upsert failed:', e instanceof Error ? e.message : e); }
  }

  // Sampling: non-error repeats beyond N/day per fingerprint are counted (above) but not stored.
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const budget = new Map<string, number>();
  const rows = [];
  for (const e of freshEvents) {
    if (e.row.fingerprint) e.row.issue_id = issueByFp.get(e.row.fingerprint) ?? null;
    if (e.row.fingerprint && e.row.severity === 'WARNING') {
      if (!budget.has(e.row.fingerprint)) {
        const count = await evCol.countDocuments({ panel: identity.panel, fingerprint: e.row.fingerprint, ts: { $gte: dayStart } });
        budget.set(e.row.fingerprint, Math.max(0, cfg.samplePerFingerprintPerDay - count));
      }
      const left = budget.get(e.row.fingerprint)!;
      if (left <= 0) continue;
      budget.set(e.row.fingerprint, left - 1);
    }
    rows.push(e.row);
  }

  // APP_HEARTBEAT = lightweight resource snapshot → ONE upserted row per device (ops_device_metrics),
  // never appended as raw events, so heartbeats can't grow the events table.
  const beats = rows.filter((r) => r.event_type === 'APP_HEARTBEAT');
  if (beats.length) {
    const last = beats.reduce((a, b) => (b.ts > a.ts ? b : a));
    const x = ((last.data as { extra?: Record<string, unknown> } | null)?.extra ?? {}) as Record<string, unknown>;
    const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
    await (await col('ops_device_metrics')).updateOne({ panel: identity.panel, machine_id: identity.machineId }, { $set: toDoc({
      product_id: last.product_id, version: last.product_version,
      computer_name: last.computer_name, entity_id: identity.entityId, cpu_pct: n(x.cpu_pct, 100), ram_pct: n(x.ram_pct, 100),
      disk_pct: n(x.disk_pct, 100), uptime_s: n(x.uptime_s, 1e9), session_count: n(x.session_count, 1e6), status: 'RUNNING', reported_at: last.ts,
    }) }, { upsert: true });
  }
  const stored = rows.filter((r) => r.event_type !== 'APP_HEARTBEAT');
  rows.length = 0;
  // Cleaner (middle layer): drop noise + in-batch duplicates and cap this device's rows per day,
  // counted by receive time so an offline backlog can't bypass it; near the MongoDB free-tier
  // limit it keeps only the important rows. Dropped rows are still acked.
  if (stored.length) {
    const today = (info: boolean) => evCol.countDocuments({ panel: identity.panel, machine_id: identity.machineId,
      received_at: { $gte: dayStart }, severity: info ? 'INFO' : { $ne: 'INFO' } });
    const [info, warn, pressure] = await Promise.all([today(true), today(false), storagePressure()]);
    rows.push(...cleanBatch(stored, { info, warn }, pressure).keep);
  }

  const failed: string[] = [];
  if (rows.length) {
    try {
      await evCol.insertMany(rows.map((r) => toDoc({ ...r, received_at: now.toISOString() })), { ordered: false });
    } catch (e: unknown) {
      // Duplicate ids (a retried batch raced us) are fine; anything else must be retried by the device.
      const errs = (e as { writeErrors?: { code: number; index: number }[] }).writeErrors;
      if (!errs) failed.push(...rows.map((r) => r.id));
      else for (const w of errs) if (w.code !== 11000) failed.push(rows[w.index].id);
    }
  }
  const crashAck: { crash_id: string; code: string }[] = [];
  for (const c of freshCrashes) {
    const issueId = issueByFp.get(c.touch.fingerprint);
    if (!issueId) { failed.push(c.row.id); continue; }
    // `code` (CR-YYYYMMDD-NNNN) is always allocated server-side from the shared counter, never by the client.
    let code: string | null = null;
    try {
      code = await allocCode('CR', new Date(c.row.ts));
      await crCol.insertOne(toDoc({ ...c.row, issue_id: issueId, code, received_at: now.toISOString() }));
    } catch (e: unknown) {
      // Stored concurrently by a retry of the same batch → report the code it already has.
      code = (e as { code?: number }).code === 11000
        ? ((await crCol.findOne({ _id: c.row.id as never }, { projection: { code: 1 } }))?.code as string | undefined) ?? null
        : null;
    }
    if (!code) failed.push(c.row.id); else crashAck.push({ crash_id: c.row.id, code });
  }

  const failedSet = new Set(failed);
  return NextResponse.json({
    // The client may drop accepted + duplicates from its queue; `failed` must be retried.
    accepted: [...freshEvents.map((e) => e.row.id), ...freshCrashes.map((c) => c.row.id)].filter((id) => !failedSet.has(id)),
    duplicates: [...dup],
    rejected,
    failed,
    crashes: crashAck,
    server_time: now.toISOString(),
  }, { status: failed.length ? 207 : 200 });
}
