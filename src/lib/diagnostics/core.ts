// ============================================================================
// Siddesh Logs — pure core (no I/O, fully unit-tested):
//   event taxonomy, centralized redaction + log-injection sanitizing, payload limits,
//   error fingerprinting, lifecycle state machine, RBAC matrix, retention policy.
// Every ingest path goes through sanitizeEvent(), so redaction never depends on an
// individual developer remembering to do it.
// ============================================================================

import { createHash } from 'crypto';

export const EVENT_CATEGORIES = {
  APPLICATION: ['APP_STARTED', 'APP_INITIALIZED', 'APP_READY', 'APP_CLOSING', 'APP_CLOSED', 'APP_CRASHED', 'APP_UNRESPONSIVE', 'APP_HEARTBEAT'],
  UPDATE: ['UPDATE_AVAILABLE', 'UPDATE_DOWNLOADED', 'UPDATE_INSTALLED', 'UPDATE_FAILED', 'UPDATE_SKIPPED'],
  AUTHENTICATION: ['LOGIN_STARTED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_EXPIRED'],
  NAVIGATION: ['SCREEN_OPENED', 'SCREEN_CLOSED', 'MODULE_OPENED', 'MODULE_CLOSED'],
  USER_ACTION: ['BUTTON_CLICKED', 'FORM_SUBMITTED', 'FILE_SELECTED', 'FILE_SAVED', 'FILE_DELETED', 'SEARCH_PERFORMED', 'USER_REPORT'],
  API: ['API_REQUEST_STARTED', 'API_REQUEST_SUCCESS', 'API_REQUEST_FAILED', 'API_TIMEOUT', 'API_RETRY'],
  DATABASE: ['DB_CONNECTED', 'DB_CONNECTION_FAILED', 'DB_QUERY_FAILED', 'DB_TRANSACTION_FAILED'],
  FILE: ['FILE_READ', 'FILE_WRITE', 'FILE_NOT_FOUND', 'FILE_PERMISSION_DENIED', 'ASSET_LOAD_FAILED'],
  PERFORMANCE: ['SLOW_OPERATION', 'HIGH_MEMORY', 'HIGH_CPU', 'LOW_DISK', 'UI_FREEZE'],
  ERROR: ['WARNING', 'ERROR', 'EXCEPTION', 'FATAL_EXCEPTION', 'UNHANDLED_EXCEPTION'],
  CRASH: ['PROCESS_CRASH', 'NATIVE_CRASH', 'UNEXPECTED_TERMINATION'],
} as const;

export type Category = keyof typeof EVENT_CATEGORIES;
export const ALL_EVENT_TYPES: string[] = Object.values(EVENT_CATEGORIES).flat();
const CATEGORY_OF = new Map<string, Category>(
  (Object.entries(EVENT_CATEGORIES) as [Category, readonly string[]][]).flatMap(([c, ts]) => ts.map((t) => [t, c] as [string, Category])),
);
export function categoryOf(eventType: string): Category | null {
  return CATEGORY_OF.get(eventType) ?? null;
}
export const CRASH_TYPES = new Set(['APP_CRASHED', 'PROCESS_CRASH', 'NATIVE_CRASH', 'UNEXPECTED_TERMINATION', 'FATAL_EXCEPTION', 'UNHANDLED_EXCEPTION']);

export const SEVERITIES = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const severityRank = (s: string) => Math.max(0, SEVERITIES.indexOf(s as Severity));

// ── Payload limits (one bad client can never fill the DB) ───────────────────
export const LIMITS = {
  batchEvents: 500,
  requestBytes: 1_500_000,
  textField: 256,
  message: 2_000,
  stackTrace: 32_000,
  eventData: 8_000,        // serialized JSON bytes per event `data`
  crashLastEvents: 500,
  crashSnapshot: 400_000,  // serialized bytes of last_events
  crashSection: 16_000,    // app_state / system_info / network_state / perf_state each
  artifactBytes: { DUMP: 50 * 1024 * 1024, SCREENSHOT: 5 * 1024 * 1024, LOG: 5 * 1024 * 1024, BUNDLE: 20 * 1024 * 1024 },
} as const;

// ── Redaction ────────────────────────────────────────────────────────────────
export const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /pass(word|wd|phrase)?|pwd|otp|secret|token|auth|bearer|api[-_]?key|apikey|private[-_]?key|cookie|session[-_]?secret|credential|activation[-_]?key|license[-_]?key|encryption[-_]?key|signature|cek|jwt/i;
// Keys that merely CONTAIN a sensitive word but are safe identifiers we need.
const SAFE_KEYS = new Set(['session_id', 'sessionId', 'author', 'auth_method', 'token_type', 'error_code']);

const VALUE_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\b(password|passwd|pwd|otp|token|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1=[REDACTED]'],
  [/([?&](?:token|key|sig|signature|otp|password|code|access_token)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s]+@/gi, '$1://[REDACTED]@'],
];

// Control chars / ANSI escapes / CR-LF in single-line fields are log-injection vectors.
 
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CTRL_KEEP_NL = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u2028\\u2029]', 'g');
const CTRL_ALL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]', 'g');

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Single-line field: strip escapes + control chars + newlines, redact, cap. */
export function cleanLine(v: unknown, max: number = LIMITS.textField): string | null {
  if (v === null || v === undefined) return null;
  const s = redactString(String(v).replace(ANSI, '').replace(CTRL_ALL, ' ')).trim();
  return s ? truncate(s, max) : null;
}

/** Multi-line field (stack traces, messages): keep \n, strip other control chars, redact, cap. */
export function cleanBlock(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = redactString(String(v).replace(ANSI, '').replace(/\r\n?/g, '\n').replace(CTRL_KEEP_NL, ' ')).trim();
  return s ? truncate(s, max) : null;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 15)}…[truncated]`;
}

/** Deep redaction of arbitrary JSON: sensitive KEYS → [REDACTED], strings scrubbed. Depth/size bounded. */
export function redactDeep(v: unknown, depth = 0, maxArray = 200): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof v === 'string') return cleanBlock(v, LIMITS.message) ?? '';
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, depth === 0 ? maxArray : 200).map((x) => redactDeep(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
      const key = cleanLine(k, 64) ?? '_';
      out[key] = !SAFE_KEYS.has(k) && SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(val, depth + 1);
    }
    return out;
  }
  return null;
}

/** Redact then size-cap a JSON section; oversized sections become a marker, never a reject. */
export function boundedJson(v: unknown, maxBytes: number, maxArray = 200): unknown {
  if (v === undefined || v === null) return null;
  const r = redactDeep(v, 0, maxArray);
  const s = JSON.stringify(r);
  return s.length <= maxBytes ? r : { _truncated: true, _bytes: s.length, preview: s.slice(0, Math.min(2000, maxBytes)) };
}

// ── Fingerprinting ───────────────────────────────────────────────────────────
/** Strip volatile parts (numbers, ids, paths, addresses) so the same bug hashes the same. */
export function normalizeForFingerprint(s: string): string {
  return s
    .replace(/[A-Za-z]:\\[^\s:'"]*|\/(?:[\w.-]+\/)+[\w.-]*/g, '<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Top frames only (line numbers dropped) so a recompile that shifts lines still groups. */
export function topFrames(stack: string | null | undefined, n = 5): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(at |#\d|\w[\w.$<>]*\(|\d+\s+\S+)/.test(l))
    .slice(0, n)
    .map((l) => l.replace(/:\d+(:\d+)?\)?$/, '').replace(/\(.*?\)/g, '()').replace(/\+0x[0-9a-f]+/gi, ''));
}

export function fingerprintOf(input: {
  product_id?: string | null; event_type: string; exception_type?: string | null;
  message?: string | null; stack?: string | null; module?: string | null; error_code?: string | null;
}): string {
  const frames = topFrames(input.stack);
  const parts = [
    input.product_id ?? '',
    CRASH_TYPES.has(input.event_type) ? 'CRASH' : input.event_type,
    input.exception_type ?? '',
    input.error_code ?? '',
    // With a stack, frames identify the bug; message text varies too much. Without one, use the message.
    frames.length ? frames.join('|') : normalizeForFingerprint(input.message ?? ''),
    frames.length ? '' : input.module ?? '',
  ];
  return createHash('sha256').update(parts.join('␟')).digest('hex').slice(0, 32);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export const ISSUE_STATUSES = ['NEW', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'RESOLVED', 'DELETE_PENDING', 'DELETED', 'REOPENED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  NEW: ['REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'RESOLVED'],
  REOPENED: ['REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'RESOLVED'],
  REVIEWING: ['DOWNLOADED', 'INVESTIGATING', 'RESOLVED'],
  DOWNLOADED: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['DOWNLOADED', 'RESOLVED'],
  RESOLVED: ['DELETE_PENDING', 'INVESTIGATING'],
  DELETE_PENDING: ['DELETED', 'RESOLVED'],
  DELETED: [], // recurrence → REOPENED happens only via ingest (diag_touch_issue)
};
export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
/** Statuses the automatic cleanup must never touch. */
export const PROTECTED_STATUSES: IssueStatus[] = ['NEW', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'REOPENED'];
export const isProtected = (s: string) => (PROTECTED_STATUSES as string[]).includes(s);

// ── RBAC ─────────────────────────────────────────────────────────────────────
export const ROLES = ['VIEWER', 'DEVELOPER', 'DEBUG_ADMIN', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export type Permission =
  | 'LOG_VIEW' | 'LOG_SEARCH' | 'LOG_DOWNLOAD' | 'LOG_DELETE'
  | 'CRASH_VIEW' | 'CRASH_DOWNLOAD' | 'CRASH_DELETE'
  | 'BUG_MANAGE' | 'DIAGNOSTIC_DOWNLOAD' | 'DIAGNOSTIC_DELETE'
  | 'RETENTION_MANAGE' | 'ROLE_MANAGE' | 'AUDIT_VIEW' | 'FORCE_DELETE'
  | 'OPS_VIEW' | 'OPS_MANAGE' | 'INFRA_VIEW' | 'INFRA_MANAGE';
const VIEW: Permission[] = ['LOG_VIEW', 'LOG_SEARCH', 'CRASH_VIEW', 'OPS_VIEW'];
const DEV: Permission[] = [...VIEW, 'INFRA_VIEW', 'LOG_DOWNLOAD', 'CRASH_DOWNLOAD', 'DIAGNOSTIC_DOWNLOAD'];
const DBG: Permission[] = [...DEV, 'OPS_MANAGE', 'BUG_MANAGE', 'LOG_DELETE', 'CRASH_DELETE', 'DIAGNOSTIC_DELETE'];
const ROLE_PERMS: Record<Role, Set<Permission>> = {
  VIEWER: new Set(VIEW),
  DEVELOPER: new Set(DEV),
  DEBUG_ADMIN: new Set(DBG),
  SUPER_ADMIN: new Set([...DBG, 'RETENTION_MANAGE', 'ROLE_MANAGE', 'AUDIT_VIEW', 'FORCE_DELETE', 'INFRA_MANAGE']),
};
export function hasPermission(role: Role | null | undefined, p: Permission): boolean {
  return !!role && ROLE_PERMS[role]?.has(p) === true;
}
export function permissionsOf(role: Role | null): Permission[] {
  return role ? [...ROLE_PERMS[role]] : [];
}

// ── Retention (defaults only — the live values come from diag_settings) ─────
export type RetentionConfig = {
  infoHours: number; warningDays: number; errorDays: number; debugHours: number;
  resolvedGraceHours: number; artifactGraceHours: number; auditDays: number;
  cleanupEveryMinutes: number; samplePerFingerprintPerDay: number; orphanGraceMinutes: number;
};
export const DEFAULT_RETENTION: RetentionConfig = {
  debugHours: 24, infoHours: 72, warningDays: 7, errorDays: 14,
  resolvedGraceHours: 24, artifactGraceHours: 24, auditDays: 365,
  cleanupEveryMinutes: 60, samplePerFingerprintPerDay: 50, orphanGraceMinutes: 60,
};
const RANGES: Record<keyof RetentionConfig, [number, number]> = {
  debugHours: [1, 168], infoHours: [1, 720], warningDays: [1, 90], errorDays: [1, 180],
  resolvedGraceHours: [0, 2160], artifactGraceHours: [0, 2160], auditDays: [30, 3650],
  cleanupEveryMinutes: [15, 1440], samplePerFingerprintPerDay: [1, 10000], orphanGraceMinutes: [10, 1440],
};
export function mergeRetention(raw: unknown): RetentionConfig {
  const out = { ...DEFAULT_RETENTION };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(RANGES) as (keyof RetentionConfig)[]) {
      const v = Number((raw as Record<string, unknown>)[k]);
      const [lo, hi] = RANGES[k];
      if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = Math.round(v);
    }
  }
  return out;
}
export function retentionRanges() {
  return RANGES;
}
/** Raw-event expiry by severity. Crash evidence is protected separately (lives in diag_crashes). */
export function eventExpiry(severity: string, from: Date, cfg: RetentionConfig): Date {
  const h = 3600_000;
  const ms = severity === 'DEBUG' ? cfg.debugHours * h
    : severity === 'INFO' ? cfg.infoHours * h
    : severity === 'WARNING' ? cfg.warningDays * 24 * h
    : cfg.errorDays * 24 * h;
  return new Date(from.getTime() + ms);
}

// ── Artifact validation (magic bytes, not just extension/MIME) ──────────────
export function sniffArtifact(kind: string, buf: Uint8Array): string | null {
  const starts = (sig: number[]) => sig.every((b, i) => buf[i] === b);
  if (kind === 'DUMP' && starts([0x4d, 0x44, 0x4d, 0x50])) return 'application/x-dmp'; // "MDMP"
  if (kind === 'SCREENSHOT' && starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (kind === 'SCREENSHOT' && starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (kind === 'LOG') {
    // Plain UTF-8 text only: reject anything with NUL bytes or an executable header.
    if (starts([0x4d, 0x5a]) || starts([0x7f, 0x45, 0x4c, 0x46])) return null;
    for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) return null;
    return 'text/plain';
  }
  return null;
}

/** Display-only id like CR-20261008-3F9A1. */
export function crashCode(id: string, ts: Date): string {
  const d = ts.toISOString().slice(0, 10).replace(/-/g, '');
  return `CR-${d}-${id.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
}
