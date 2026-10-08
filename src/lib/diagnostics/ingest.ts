// Siddesh Logs — ingest contract + pure normalization (schema, redaction, limits, expiry,
// fingerprint). The route only does auth + I/O; everything that shapes a stored row is here.
import { z } from 'zod';
import {
  ALL_EVENT_TYPES, CRASH_TYPES, LIMITS, SEVERITIES, boundedJson, categoryOf, cleanBlock, cleanLine,
  eventExpiry, fingerprintOf, severityRank, type RetentionConfig,
} from './core';
import type { DeviceIdentity } from './deviceAuth';

const uuid = z.string().uuid();
const str = (n = 400) => z.string().max(n).optional().nullable();
const json = z.unknown().optional().nullable();

export const ExceptionSchema = z.object({
  type: str(), message: str(4000), code: str(), stack: str(64_000), inner: str(8000),
  source_file: str(), source_line: z.number().int().optional().nullable(), function: str(),
  faulting_module: str(), native_code: str(), fault_address: str(),
}).partial().optional().nullable();

export const EventSchema = z.object({
  event_id: uuid,
  timestamp: z.string().max(40),
  severity: z.enum(SEVERITIES),
  event_type: z.string().max(40),
  module: str(), feature: str(), action: str(),
  user_id: str(), user_role: str(), session_id: str(), process_id: z.number().int().optional().nullable(),
  correlation_id: str(), request_id: str(),
  message: str(4000), error_code: str(), duration_ms: z.number().int().min(0).max(86_400_000).optional().nullable(),
  expected_behavior: str(1000), actual_behavior: str(1000), result: z.enum(['PASS', 'FAIL', 'PARTIAL']).optional().nullable(),
  exception: ExceptionSchema,
  network: json, performance: json, data: json,
});

export const CrashSchema = z.object({
  crash_id: uuid,
  timestamp: z.string().max(40),
  event_type: z.enum(['APP_CRASHED', 'PROCESS_CRASH', 'NATIVE_CRASH', 'UNEXPECTED_TERMINATION', 'FATAL_EXCEPTION', 'UNHANDLED_EXCEPTION', 'APP_UNRESPONSIVE']),
  module: str(), feature: str(), action: str(), current_screen: str(),
  user_id: str(), session_id: str(), process_id: z.number().int().optional().nullable(),
  expected_behavior: str(1000), actual_behavior: str(1000), result: z.enum(['PASS', 'FAIL', 'PARTIAL']).optional().nullable(),
  exception: ExceptionSchema,
  last_events: z.array(z.unknown()).max(LIMITS.crashLastEvents * 2).optional().nullable(),
  app_state: json, system_info: json, network_state: json, perf_state: json,
});

export const IngestSchema = z.object({
  activation_key: z.string().min(1).max(200),
  device_fingerprint: z.string().min(8).max(256),
  product_id: z.string().max(64).optional(),
  product_name: str(80), product_version: str(40), build_number: str(40), build_commit: str(64),
  installation_id: str(64), computer_name: str(64),
  events: z.array(z.unknown()).max(LIMITS.batchEvents).default([]),
  crashes: z.array(z.unknown()).max(20).default([]),
});
export type IngestBody = z.infer<typeof IngestSchema>;

function parseTs(s: string, now: Date): Date {
  const d = new Date(s);
  // Clamp nonsense clocks: future > 1 day or older than 30 days → server receive time.
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000 || d.getTime() < now.getTime() - 30 * 86_400_000) return now;
  return d;
}

function cleanException(e: z.infer<typeof ExceptionSchema>) {
  if (!e) return null;
  return {
    type: cleanLine(e.type), message: cleanBlock(e.message, LIMITS.message), code: cleanLine(e.code, 64),
    inner: cleanBlock(e.inner, 4000), source_file: cleanLine(e.source_file), source_line: e.source_line ?? null,
    function: cleanLine(e.function), faulting_module: cleanLine(e.faulting_module), native_code: cleanLine(e.native_code, 32),
    fault_address: cleanLine(e.fault_address, 32),
  };
}

function common(b: IngestBody, id: DeviceIdentity) {
  return {
    panel: id.panel,
    product_id: id.productId ?? cleanLine(b.product_id, 64),
    product_version: cleanLine(b.product_version, 40), build_number: cleanLine(b.build_number, 40), build_commit: cleanLine(b.build_commit, 64),
    entity_id: id.entityId, school_name: id.schoolName, installation_id: cleanLine(b.installation_id, 64),
    machine_id: id.machineId, computer_name: cleanLine(b.computer_name, 64),
  };
}

export type EventRow = ReturnType<typeof normalizeEvent> & object;
export type TouchSpec = { fingerprint: string; kind: string; severity: string; title: string; exc_type: string | null; message: string | null; stack: string | null; expected: string | null; actual: string | null; module: string | null };

/** Returns null for an invalid event (rejected individually, never the whole batch). */
export function normalizeEvent(raw: unknown, b: IngestBody, id: DeviceIdentity, cfg: RetentionConfig, now: Date) {
  const p = EventSchema.safeParse(raw);
  if (!p.success) return null;
  const e = p.data;
  const eventType = ALL_EVENT_TYPES.includes(e.event_type) ? e.event_type : 'ERROR';
  const category = categoryOf(eventType) ?? 'ERROR';
  const ts = parseTs(e.timestamp, now);
  const exc = cleanException(e.exception);
  const stack = cleanBlock(e.exception?.stack, LIMITS.stackTrace);
  const base = common(b, id);
  const message = cleanBlock(e.message ?? e.exception?.message, LIMITS.message);
  const groupable = severityRank(e.severity) >= severityRank('WARNING') || CRASH_TYPES.has(eventType);
  const fingerprint = groupable
    ? fingerprintOf({ product_id: base.product_id, event_type: eventType, exception_type: exc?.type, message, stack, module: e.module, error_code: e.error_code ?? exc?.code })
    : null;
  const row = {
    id: e.event_id, ...base, ts: ts.toISOString(),
    user_id: cleanLine(e.user_id, 64), session_id: cleanLine(e.session_id, 64), process_id: e.process_id ?? null,
    module: cleanLine(e.module, 80), feature: cleanLine(e.feature, 80), action: cleanLine(e.action, 120),
    correlation_id: cleanLine(e.correlation_id, 64), request_id: cleanLine(e.request_id, 64),
    severity: e.severity, event_type: eventType, category, message,
    error_code: cleanLine(e.error_code ?? exc?.code, 64), duration_ms: e.duration_ms ?? null, result: e.result ?? null,
    fingerprint, issue_id: null as string | null, crash_id: null,
    data: boundedJson({
      user_role: e.user_role ?? undefined,
      expected_behavior: cleanBlock(e.expected_behavior, 1000), actual_behavior: cleanBlock(e.actual_behavior, 1000),
      exception: exc, stack_trace: stack, network: e.network, performance: e.performance, extra: e.data,
    }, LIMITS.eventData),
    expires_at: eventExpiry(e.severity, ts, cfg).toISOString(),
  };
  const touch: TouchSpec | null = fingerprint ? {
    fingerprint,
    kind: CRASH_TYPES.has(eventType) ? 'CRASH' : eventType === 'USER_REPORT' ? 'USER_REPORT' : severityRank(e.severity) >= severityRank('ERROR') ? 'ERROR' : 'WARNING',
    severity: e.severity,
    title: cleanLine(`${exc?.type ?? eventType}: ${message ?? e.action ?? ''}`, 200) ?? eventType,
    exc_type: exc?.type ?? null, message, stack,
    expected: cleanBlock(e.expected_behavior, 1000), actual: cleanBlock(e.actual_behavior, 1000), module: row.module,
  } : null;
  return { row, touch };
}

export function normalizeCrash(raw: unknown, b: IngestBody, id: DeviceIdentity, now: Date) {
  const p = CrashSchema.safeParse(raw);
  if (!p.success) return null;
  const c = p.data;
  const ts = parseTs(c.timestamp, now);
  const exc = cleanException(c.exception);
  const stack = cleanBlock(c.exception?.stack, LIMITS.stackTrace);
  const base = common(b, id);
  const message = cleanBlock(c.exception?.message, LIMITS.message);
  const fingerprint = fingerprintOf({ product_id: base.product_id, event_type: c.event_type, exception_type: exc?.type, message, stack, module: c.module, error_code: exc?.code ?? exc?.native_code });
  // Last-N events: keep the most recent LIMITS.crashLastEvents, each redacted, whole thing size-bounded.
  const last = (c.last_events ?? []).slice(-LIMITS.crashLastEvents);
  const row = {
    id: c.crash_id, ...base, ts: ts.toISOString(),
    user_id: cleanLine(c.user_id, 64), session_id: cleanLine(c.session_id, 64), process_id: c.process_id ?? null,
    module: cleanLine(c.module, 80), feature: cleanLine(c.feature, 80), action: cleanLine(c.action, 120), current_screen: cleanLine(c.current_screen, 120),
    event_type: c.event_type, exception: exc, stack_trace: stack,
    expected_behavior: cleanBlock(c.expected_behavior, 1000), actual_behavior: cleanBlock(c.actual_behavior, 1000), result: c.result ?? 'FAIL',
    last_events: boundedJson(last, LIMITS.crashSnapshot, LIMITS.crashLastEvents),
    app_state: boundedJson(c.app_state, LIMITS.crashSection), system_info: boundedJson(c.system_info, LIMITS.crashSection),
    network_state: boundedJson(c.network_state, LIMITS.crashSection), perf_state: boundedJson(c.perf_state, LIMITS.crashSection),
  };
  const touch: TouchSpec = {
    fingerprint, kind: 'CRASH', severity: 'FATAL',
    title: cleanLine(`${exc?.type ?? c.event_type}: ${message ?? c.action ?? c.module ?? ''}`, 200) ?? c.event_type,
    exc_type: exc?.type ?? null, message, stack, expected: row.expected_behavior, actual: row.actual_behavior, module: row.module,
  };
  return { row, touch };
}
