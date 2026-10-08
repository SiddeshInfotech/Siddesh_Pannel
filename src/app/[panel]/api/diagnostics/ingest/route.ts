import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/sanitize';
import { authenticateDevice } from '@/lib/diagnostics/deviceAuth';
import { diagDb, loadRetention, rateLimit } from '@/lib/diagnostics/server';
import { IngestSchema, normalizeCrash, normalizeEvent, type TouchSpec } from '@/lib/diagnostics/ingest';
import { LIMITS, crashCode } from '@/lib/diagnostics/core';

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

  const db = diagDb();
  const now = new Date();
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
  const [{ data: seenEv }, { data: seenCr }] = await Promise.all([
    events.length ? db.from('diag_events').select('id').in('id', events.map((e) => e.row.id)) : Promise.resolve({ data: [] }),
    crashes.length ? db.from('diag_crashes').select('id').in('id', crashes.map((c) => c.row.id)) : Promise.resolve({ data: [] }),
  ]);
  const dup = new Set([...(seenEv ?? []), ...(seenCr ?? [])].map((r: { id: string }) => r.id));
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
    const { data, error } = await db.rpc('diag_touch_issue', {
      p_panel: identity.panel, p_fingerprint: fp, p_kind: g.t.kind, p_severity: g.t.severity, p_title: g.t.title,
      p_product: identity.productId, p_exc_type: g.t.exc_type, p_message: g.t.message, p_stack: g.t.stack,
      p_expected: g.t.expected, p_actual: g.t.actual, p_school: identity.entityId, p_machine: identity.machineId,
      p_version: g.version, p_module: g.t.module, p_count: g.n, p_seen: g.seen,
    });
    if (!error && data) issueByFp.set(fp, data as string);
  }

  // Sampling: non-error repeats beyond N/day per fingerprint are counted (above) but not stored.
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const budget = new Map<string, number>();
  const rows = [];
  for (const e of freshEvents) {
    if (e.row.fingerprint) e.row.issue_id = issueByFp.get(e.row.fingerprint) ?? null;
    if (e.row.fingerprint && e.row.severity === 'WARNING') {
      if (!budget.has(e.row.fingerprint)) {
        const { count } = await db.from('diag_events').select('id', { count: 'exact', head: true })
          .eq('panel', identity.panel).eq('fingerprint', e.row.fingerprint).gte('ts', dayStart.toISOString());
        budget.set(e.row.fingerprint, Math.max(0, cfg.samplePerFingerprintPerDay - (count ?? 0)));
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
    await db.from('ops_device_metrics').upsert({
      panel: identity.panel, machine_id: identity.machineId, product_id: last.product_id, version: last.product_version,
      computer_name: last.computer_name, entity_id: identity.entityId, cpu_pct: n(x.cpu_pct, 100), ram_pct: n(x.ram_pct, 100),
      disk_pct: n(x.disk_pct, 100), uptime_s: n(x.uptime_s, 1e9), session_count: n(x.session_count, 1e6), status: 'RUNNING', reported_at: last.ts,
    });
  }
  const stored = rows.filter((r) => r.event_type !== 'APP_HEARTBEAT');
  rows.length = 0;
  rows.push(...stored);

  const failed: string[] = [];
  if (rows.length) {
    const { error } = await db.from('diag_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) failed.push(...rows.map((r) => r.id));
  }
  const crashAck: { crash_id: string; code: string }[] = [];
  for (const c of freshCrashes) {
    const issueId = issueByFp.get(c.touch.fingerprint);
    if (!issueId) { failed.push(c.row.id); continue; }
    const code = crashCode(c.row.id, new Date(c.row.ts));
    const { error } = await db.from('diag_crashes').upsert({ ...c.row, code, issue_id: issueId }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) failed.push(c.row.id); else crashAck.push({ crash_id: c.row.id, code });
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
