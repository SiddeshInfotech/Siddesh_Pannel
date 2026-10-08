'use server';

// Siddesh Logs — server actions. Every action: requireActor(permission) → panel + school scope
// enforced HERE (never by the UI) → rate limit where abusable → audit. Only whitelisted
// columns/values reach the query builder (PostgREST parameterizes; no SQL is concatenated).
import { DiagAuthError, audit, canSeeIssue, dbErrorMessage, diagDb, rateLimit, requireActor, resolveActor, scoped, loadRetention, type Actor } from '@/lib/diagnostics/server';
import {
  ALL_EVENT_TYPES, EVENT_CATEGORIES, ISSUE_STATUSES, ROLES, SEVERITIES, canTransition, cleanBlock, cleanLine, isProtected,
  mergeRetention, permissionsOf, type IssueStatus, type Permission, type RetentionConfig,
} from '@/lib/diagnostics/core';
import { purgeIssue, runCleanup } from '@/lib/diagnostics/cleanup';
import { buildZip } from '@/lib/diagnostics/zip';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Supabase rows */

const PAGE_MAX = 100;
const SORTABLE_EVENTS = new Set(['ts', 'severity', 'event_type', 'product_id', 'product_version', 'module']);
const SORTABLE_ISSUES = new Set(['last_seen_at', 'first_seen_at', 'occurrence_count', 'severity', 'status']);

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try { return await fn(); } catch (e) { return fail(e instanceof DiagAuthError ? e.message : GENERIC_ERROR); }
}
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const str = (v: unknown, n = 80) => (typeof v === 'string' ? cleanLine(v, n) : null);
async function limited(a: Actor, bucket: string, windowMs: number, max: number) {
  if (!(await rateLimit(`${bucket}:${a.email}`, windowMs, max))) throw new DiagAuthError('Too many requests. Please wait a moment.');
}

export async function getMe(): Promise<ActionResult<{ email: string; role: string; permissions: Permission[]; scoped: boolean }>> {
  return guard(async () => {
    const a = await resolveActor();
    if (!a) return fail('You do not have access to Logs. Ask a Super Admin to grant you a Logs role.');
    await audit(a, 'LOGS_OPENED', null, 'OK');
    return ok({ email: a.email, role: a.role, permissions: permissionsOf(a.role), scoped: !!a.schoolIds });
  });
}

// ── Events ───────────────────────────────────────────────────────────────────
export type EventFilters = {
  view?: string; q?: string; severity?: string; category?: string; event_type?: string; product?: string; version?: string;
  school?: string; module?: string; from?: string; to?: string; sort?: string; asc?: boolean; page?: number; pageSize?: number;
};
const VIEW_CATEGORIES: Record<string, string[]> = {
  performance: ['PERFORMANCE'], api: ['API'], user: ['USER_ACTION', 'NAVIGATION'],
  system: ['APPLICATION', 'AUTHENTICATION', 'DATABASE', 'FILE'], exceptions: ['ERROR', 'CRASH'],
};

export async function listEvents(f: EventFilters): Promise<ActionResult<{ rows: any[]; total: number }>> {
  return guard(async () => {
    const a = await requireActor('LOG_SEARCH');
    await limited(a, 'search', 60_000, 120);
    const size = Math.min(Math.max(Number(f.pageSize) || 50, 10), PAGE_MAX);
    const page = Math.max(0, Number(f.page) || 0);
    let q: any = scoped(diagDb().from('diag_events').select(
      'id, ts, severity, event_type, category, product_id, product_version, build_number, school_name, entity_id, computer_name, machine_id, user_id, session_id, module, feature, action, result, message, error_code, duration_ms, issue_id, crash_id, correlation_id',
      { count: 'estimated' }), a);
    const cats = f.view && VIEW_CATEGORIES[f.view];
    if (cats) q = q.in('category', cats);
    if (f.view === 'errors') q = q.in('severity', ['ERROR', 'CRITICAL', 'FATAL']);
    if (f.view === 'exceptions') q = q.in('event_type', ['EXCEPTION', 'FATAL_EXCEPTION', 'UNHANDLED_EXCEPTION', ...EVENT_CATEGORIES.CRASH]);
    if (f.view === 'reports') q = q.eq('event_type', 'USER_REPORT');
    if (f.severity && (SEVERITIES as readonly string[]).includes(f.severity)) q = q.eq('severity', f.severity);
    if (f.category && f.category in EVENT_CATEGORIES) q = q.eq('category', f.category);
    if (f.event_type && ALL_EVENT_TYPES.includes(f.event_type)) q = q.eq('event_type', f.event_type);
    for (const [col, v] of [['product_id', f.product], ['product_version', f.version], ['entity_id', f.school], ['module', f.module]] as const) {
      const s = str(v); if (s) q = q.eq(col, s);
    }
    const search = str(f.q, 100);
    if (search) q = q.ilike('message', like(search));
    if (f.from && !Number.isNaN(Date.parse(f.from))) q = q.gte('ts', new Date(f.from).toISOString());
    if (f.to && !Number.isNaN(Date.parse(f.to))) q = q.lte('ts', new Date(f.to).toISOString());
    const sort = f.sort && SORTABLE_EVENTS.has(f.sort) ? f.sort : 'ts';
    const { data, count, error } = await q.order(sort, { ascending: !!f.asc }).range(page * size, page * size + size - 1);
    if (error) return fail(dbErrorMessage(error));
    return ok({ rows: data ?? [], total: count ?? 0 });
  });
}

export async function getEvent(id: string): Promise<ActionResult<{ event: any; timeline: any[] }>> {
  return guard(async () => {
    const a = await requireActor('LOG_VIEW', id);
    const { data: ev } = await scoped(diagDb().from('diag_events').select('*'), a).eq('id', String(id).slice(0, 64)).maybeSingle();
    if (!ev) return fail('Not found.');
    let timeline: any[] = [];
    if (ev.session_id) {
      const { data } = await scoped(diagDb().from('diag_events').select('id, ts, severity, event_type, module, feature, action, message, result'), a)
        .eq('session_id', ev.session_id).lte('ts', ev.ts).order('ts', { ascending: false }).limit(100);
      timeline = (data ?? []).reverse();
    }
    await audit(a, 'LOG_VIEWED', id, 'OK');
    return ok({ event: ev, timeline });
  });
}

// ── Issues (fingerprint groups / bugs) ──────────────────────────────────────
export type IssueFilters = { kind?: string; status?: string; q?: string; product?: string; sort?: string; page?: number };
export async function listIssues(f: IssueFilters): Promise<ActionResult<{ rows: any[]; total: number }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW');
    await limited(a, 'search', 60_000, 120);
    let q: any = diagDb().from('diag_issues').select(
      'id, code, kind, severity, title, product_id, status, occurrence_count, affected_schools, affected_machines, affected_versions, affected_modules, first_seen_at, last_seen_at, resolved_at, fixed_version, reopen_count',
      { count: 'exact' }).eq('panel', a.panel);
    if (a.schoolIds) q = q.overlaps('affected_schools', a.schoolIds.length ? a.schoolIds : ['__none__']);
    if (f.kind && ['CRASH', 'ERROR', 'WARNING', 'USER_REPORT'].includes(f.kind)) q = q.eq('kind', f.kind);
    if (f.status === 'OPEN') q = q.not('status', 'in', '(RESOLVED,DELETE_PENDING,DELETED)');
    else if (f.status && (ISSUE_STATUSES as readonly string[]).includes(f.status)) q = q.eq('status', f.status);
    const s = str(f.q, 100); if (s) q = q.ilike('title', like(s));
    const p = str(f.product); if (p) q = q.eq('product_id', p);
    const sort = f.sort && SORTABLE_ISSUES.has(f.sort) ? f.sort : 'last_seen_at';
    const page = Math.max(0, Number(f.page) || 0);
    const { data, count, error } = await q.order(sort, { ascending: false }).range(page * 50, page * 50 + 49);
    if (error) return fail(dbErrorMessage(error));
    const rows = (data ?? []).map((r: any) => ({
      ...r, schools: r.affected_schools.length, machines: r.affected_machines.length, affected_schools: undefined, affected_machines: undefined,
    }));
    return ok({ rows, total: count ?? 0 });
  });
}

async function loadIssue(a: Actor, id: string) {
  const { data } = await diagDb().from('diag_issues').select('*').eq('id', String(id).slice(0, 64)).eq('panel', a.panel).maybeSingle();
  return data && canSeeIssue(a, data) ? data : null;
}

export async function getIssue(id: string): Promise<ActionResult<{ issue: any; crashes: any[]; events: any[]; artifacts: any[] }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    const db = diagDb();
    const [cr, ev, ar] = await Promise.all([
      scoped(db.from('diag_crashes').select('id, code, ts, product_version, build_number, school_name, computer_name, machine_id, user_id, session_id, module, feature, action, event_type'), a)
        .eq('issue_id', issue.id).order('ts', { ascending: false }).limit(50),
      scoped(db.from('diag_events').select('id, ts, severity, event_type, school_name, computer_name, product_version, module, action, message'), a)
        .eq('issue_id', issue.id).order('ts', { ascending: false }).limit(50),
      db.from('diag_artifacts').select('id, kind, crash_id, size_bytes, mime, created_at, sha256').eq('issue_id', issue.id).eq('panel', a.panel),
    ]);
    // Opening a NEW issue moves it to REVIEWING (only for users who may manage bugs).
    if ((issue.status === 'NEW' || issue.status === 'REOPENED') && permissionsOf(a.role).includes('BUG_MANAGE')) {
      await db.from('diag_issues').update({ status: 'REVIEWING' }).eq('id', issue.id).eq('status', issue.status);
      issue.status = 'REVIEWING';
    }
    await audit(a, 'ISSUE_VIEWED', issue.code, 'OK');
    return ok({ issue, crashes: cr.data ?? [], events: ev.data ?? [], artifacts: ar.data ?? [] });
  });
}

export async function getCrash(id: string): Promise<ActionResult<{ crash: any; artifacts: any[] }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW', id);
    const { data: crash } = await scoped(diagDb().from('diag_crashes').select('*'), a).eq('id', String(id).slice(0, 64)).maybeSingle();
    if (!crash) return fail('Not found.');
    const { data: artifacts } = await diagDb().from('diag_artifacts').select('id, kind, size_bytes, mime, created_at, sha256').eq('crash_id', crash.id).eq('panel', a.panel);
    await audit(a, 'CRASH_VIEWED', crash.code, 'OK');
    return ok({ crash, artifacts: artifacts ?? [] });
  });
}

// ── Evidence download ────────────────────────────────────────────────────────
const README = `SIDDESH DIAGNOSTIC BUNDLE
=========================
Generated by the Siddesh Panel Logs tab. All values were redacted at ingest
(passwords, OTPs, tokens, API keys, private keys, licence keys -> [REDACTED]).

issue.json            Grouped issue (fingerprint, counts, affected schools/versions, lifecycle)
application-info.json Product, version, build number, build commit per crash
session-info.json     Session / user / process per crash
crash.json            Full crash records (exception, expected vs actual, state snapshots)
stacktrace.txt        Stack traces (one block per crash)
events.json           Last-N events captured with each crash (timeline)
errors.json           Sample error/warning events grouped under this issue
api-events.json       API events from the timelines
performance.json      Performance state + performance events
system-info.json      OS / CPU / RAM / GPU / disk / display per crash
environment.json      Network state + app state per crash
crash-dumps/          List of dump/screenshot artifacts (download each from the panel;
                      links are short-lived and every download is audited)

Treat this bundle as confidential. Delete it once the issue is fixed.
`;

export async function downloadBundle(issueId: string): Promise<ActionResult<{ filename: string; base64: string }>> {
  return guard(async () => {
    const a = await requireActor('DIAGNOSTIC_DOWNLOAD', issueId);
    await limited(a, 'download', 600_000, 20);
    const issue = await loadIssue(a, issueId);
    if (!issue) return fail('Not found.');
    const db = diagDb();
    const [{ data: crashes }, { data: events }, { data: arts }] = await Promise.all([
      scoped(db.from('diag_crashes').select('*'), a).eq('issue_id', issue.id).order('ts', { ascending: false }).limit(20),
      scoped(db.from('diag_events').select('*'), a).eq('issue_id', issue.id).order('ts', { ascending: false }).limit(200),
      db.from('diag_artifacts').select('id, kind, crash_id, size_bytes, mime, sha256, created_at').eq('issue_id', issue.id).eq('panel', a.panel),
    ]);
    const cs = crashes ?? [];
    const timeline = cs.flatMap((c: any) => (Array.isArray(c.last_events) ? c.last_events : []).map((e: any) => ({ crash: c.code, ...e })));
    const j = (v: unknown) => JSON.stringify(v, null, 2);
    const zip = buildZip([
      { name: 'README.txt', data: README },
      { name: 'issue.json', data: j(issue) },
      { name: 'application-info.json', data: j(cs.map((c: any) => ({ crash: c.code, product: c.product_id, version: c.product_version, build: c.build_number, commit: c.build_commit, installation: c.installation_id }))) },
      { name: 'session-info.json', data: j(cs.map((c: any) => ({ crash: c.code, school: c.school_name, computer: c.computer_name, machine: c.machine_id, user: c.user_id, session: c.session_id, pid: c.process_id, screen: c.current_screen }))) },
      { name: 'crash.json', data: j(cs.map((c: any) => ({ ...c, last_events: undefined }))) },
      { name: 'stacktrace.txt', data: cs.map((c: any) => `### ${c.code}  ${c.exception?.type ?? c.event_type}\n${c.stack_trace ?? '(no stack trace)'}\n`).join('\n') || issue.stack_sample || '(no stack trace)' },
      { name: 'events.json', data: j(timeline) },
      { name: 'errors.json', data: j(events ?? []) },
      { name: 'api-events.json', data: j(timeline.filter((e: any) => String(e.event_type ?? '').startsWith('API_'))) },
      { name: 'performance.json', data: j({ crashes: cs.map((c: any) => ({ crash: c.code, perf: c.perf_state })), events: timeline.filter((e: any) => ['SLOW_OPERATION', 'HIGH_MEMORY', 'HIGH_CPU', 'LOW_DISK', 'UI_FREEZE'].includes(e.event_type)) }) },
      { name: 'system-info.json', data: j(cs.map((c: any) => ({ crash: c.code, system: c.system_info }))) },
      { name: 'environment.json', data: j(cs.map((c: any) => ({ crash: c.code, network: c.network_state, app_state: c.app_state }))) },
      { name: 'crash-dumps/ARTIFACTS.json', data: j(arts ?? []) },
    ]);
    const now = new Date().toISOString();
    const upd: any = { downloaded_at: now };
    if (canTransition(issue.status, 'DOWNLOADED')) upd.status = 'DOWNLOADED';
    await db.from('diag_issues').update(upd).eq('id', issue.id);
    await audit(a, 'BUNDLE_DOWNLOADED', issue.code, 'OK', { crashes: cs.length, bytes: zip.length });
    return ok({ filename: `siddesh-diagnostics-${issue.code}.zip`, base64: Buffer.from(zip).toString('base64') });
  });
}

/** Short-lived (60 s) signed URL for one dump/screenshot, by internal id only. */
export async function getArtifactUrl(artifactId: string): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_DOWNLOAD', artifactId);
    await limited(a, 'download', 600_000, 20);
    const db = diagDb();
    const { data: art } = await db.from('diag_artifacts').select('id, storage_path, issue_id, kind, status').eq('id', String(artifactId).slice(0, 64)).eq('panel', a.panel).maybeSingle();
    if (!art || art.status !== 'ACTIVE') return fail('Not found.');
    if (a.schoolIds && art.issue_id && !(await loadIssue(a, art.issue_id))) return fail('Not found.');
    const { data, error } = await db.storage.from('diagnostics').createSignedUrl(art.storage_path, 60, { download: `${art.kind.toLowerCase()}-${art.id}` });
    if (error || !data) return fail(GENERIC_ERROR);
    await audit(a, 'ARTIFACT_DOWNLOADED', art.id, 'OK', { kind: art.kind });
    return ok({ url: data.signedUrl });
  });
}

export async function listArtifacts(page = 0): Promise<ActionResult<{ rows: any[] }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW');
    const { data } = await diagDb().from('diag_artifacts').select('id, kind, crash_id, issue_id, size_bytes, mime, status, created_at, diag_issues (code, status)')
      .eq('panel', a.panel).order('created_at', { ascending: false }).range(page * 50, page * 50 + 49);
    let rows = data ?? [];
    if (a.schoolIds) {
      const ids = new Set<string>();
      for (const r of rows) if (r.issue_id && (await loadIssue(a, r.issue_id))) ids.add(r.issue_id);
      rows = rows.filter((r) => r.issue_id && ids.has(r.issue_id));
    }
    return ok({ rows });
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export async function setIssueStatus(id: string, to: IssueStatus): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('BUG_MANAGE', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    if (to === 'RESOLVED' || to === 'DELETED' || to === 'DELETE_PENDING') return fail('Use Resolve / Delete for this step.');
    if (!canTransition(issue.status, to)) return fail(`Cannot move from ${issue.status} to ${to}.`);
    await diagDb().from('diag_issues').update({ status: to }).eq('id', issue.id).eq('status', issue.status);
    await audit(a, 'ISSUE_STATUS', issue.code, 'OK', { from: issue.status, to });
    return ok(undefined);
  });
}

export async function resolveIssue(id: string, form: { root_cause: string; resolution: string; fixed_version: string; notes?: string }): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('BUG_MANAGE', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    if (!canTransition(issue.status, 'RESOLVED')) return fail(`Cannot resolve from ${issue.status}.`);
    const root = cleanBlock(form.root_cause, 2000), res = cleanBlock(form.resolution, 2000), fixed = cleanLine(form.fixed_version, 40);
    if (!root || !res || !fixed) return fail('Root cause, resolution and fixed build/version are required.');
    const cfg = await loadRetention(a.panel);
    const now = Date.now();
    await diagDb().from('diag_issues').update({
      status: 'RESOLVED', resolved_at: new Date(now).toISOString(), resolved_by: a.email, root_cause: root, resolution: res,
      fixed_version: fixed, developer_notes: cleanBlock(form.notes, 4000), delete_after: new Date(now + cfg.resolvedGraceHours * 3600_000).toISOString(),
    }).eq('id', issue.id).eq('status', issue.status);
    await audit(a, 'ISSUE_RESOLVED', issue.code, 'OK', { fixed_version: fixed });
    return ok(undefined);
  });
}

export async function previewDelete(id: string): Promise<ActionResult<{ code: string; status: string; events: number; crashes: number; screenshots: number; dumps: number; logs: number; bytes: number; protected: boolean }>> {
  return guard(async () => {
    const a = await requireActor('DIAGNOSTIC_DELETE', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    const db = diagDb();
    const [ev, cr, ar] = await Promise.all([
      db.from('diag_events').select('id', { count: 'exact', head: true }).eq('issue_id', issue.id),
      db.from('diag_crashes').select('id', { count: 'exact', head: true }).eq('issue_id', issue.id),
      db.from('diag_artifacts').select('kind, size_bytes').eq('issue_id', issue.id),
    ]);
    const arts = ar.data ?? [];
    return ok({
      code: issue.code, status: issue.status, events: ev.count ?? 0, crashes: cr.count ?? 0,
      screenshots: arts.filter((x) => x.kind === 'SCREENSHOT').length, dumps: arts.filter((x) => x.kind === 'DUMP').length, logs: arts.filter((x) => x.kind === 'LOG').length,
      bytes: arts.reduce((s, x) => s + Number(x.size_bytes), 0), protected: isProtected(issue.status),
    });
  });
}

/** Manual hard delete. Requires typing the issue code. Active investigations need FORCE_DELETE (Super Admin). Idempotent. */
export async function deleteIssueDiagnostics(id: string, confirmCode: string, force = false): Promise<ActionResult<{ alreadyDeleted?: boolean }>> {
  return guard(async () => {
    const a = await requireActor('DIAGNOSTIC_DELETE', id);
    await limited(a, 'delete', 600_000, 30);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    if (issue.status === 'DELETED') return ok({ alreadyDeleted: true });
    if (confirmCode !== issue.code) return fail(`Type ${issue.code} to confirm.`);
    if (isProtected(issue.status)) {
      if (!force || !permissionsOf(a.role).includes('FORCE_DELETE')) {
        await audit(a, 'DELETE_BLOCKED_ACTIVE', issue.code, 'DENIED', { status: issue.status });
        return fail('This issue is still under investigation. Resolve it first (or a Super Admin must force-delete).');
      }
    }
    const r = await purgeIssue(diagDb(), a.panel, issue.id);
    await audit(a, force ? 'DIAGNOSTICS_FORCE_DELETED' : 'DIAGNOSTICS_DELETED', issue.code, r.ok ? 'OK' : 'PARTIAL', r);
    return r.ok ? ok({}) : fail('Some files could not be deleted yet; cleanup will retry automatically.');
  });
}

export async function previewBulkDelete(days: number): Promise<ActionResult<{ issues: number; events: number; crashes: number; artifacts: number; bytes: number }>> {
  return guard(async () => {
    const a = await requireActor('FORCE_DELETE');
    const d = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)));
    const db = diagDb();
    const { data: iss } = await db.from('diag_issues').select('id').eq('panel', a.panel).eq('status', 'RESOLVED').lt('resolved_at', new Date(Date.now() - d * 86_400_000).toISOString()).limit(1000);
    const ids = (iss ?? []).map((x) => x.id);
    if (!ids.length) return ok({ issues: 0, events: 0, crashes: 0, artifacts: 0, bytes: 0 });
    const [ev, cr, ar] = await Promise.all([
      db.from('diag_events').select('id', { count: 'exact', head: true }).in('issue_id', ids),
      db.from('diag_crashes').select('id', { count: 'exact', head: true }).in('issue_id', ids),
      db.from('diag_artifacts').select('size_bytes').in('issue_id', ids),
    ]);
    return ok({ issues: ids.length, events: ev.count ?? 0, crashes: cr.count ?? 0, artifacts: ar.data?.length ?? 0, bytes: (ar.data ?? []).reduce((s, x) => s + Number(x.size_bytes), 0) });
  });
}

export async function bulkDeleteResolved(days: number, confirm: string): Promise<ActionResult<{ purged: number }>> {
  return guard(async () => {
    const a = await requireActor('FORCE_DELETE');
    await limited(a, 'delete', 600_000, 30);
    if (confirm !== 'DELETE') return fail('Type DELETE to confirm.');
    const d = Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)));
    const { data: iss } = await diagDb().from('diag_issues').select('id').eq('panel', a.panel).eq('status', 'RESOLVED').lt('resolved_at', new Date(Date.now() - d * 86_400_000).toISOString()).limit(1000);
    let purged = 0;
    for (const i of iss ?? []) if ((await purgeIssue(diagDb(), a.panel, i.id)).ok) purged++;
    await audit(a, 'BULK_DELETE_RESOLVED', null, 'OK', { days: d, purged });
    return ok({ purged });
  });
}

// ── Storage / settings / RBAC / audit ───────────────────────────────────────
export async function getStorage(): Promise<ActionResult<{ stats: any; runs: any[] }>> {
  return guard(async () => {
    const a = await requireActor('LOG_VIEW');
    const db = diagDb();
    const [{ data: stats }, { data: runs }] = await Promise.all([
      db.rpc('diag_storage_stats', { p_panel: a.panel }),
      db.from('diag_cleanup_runs').select('*').eq('panel', a.panel).order('started_at', { ascending: false }).limit(10),
    ]);
    return ok({ stats: stats ?? {}, runs: runs ?? [] });
  });
}

export async function runCleanupNow(): Promise<ActionResult<any>> {
  return guard(async () => {
    const a = await requireActor('RETENTION_MANAGE');
    await limited(a, 'cleanup', 600_000, 5);
    const r = await runCleanup(a.panel);
    await audit(a, 'CLEANUP_MANUAL', null, 'OK', r);
    return ok(r);
  });
}

export async function getRetention(): Promise<ActionResult<RetentionConfig>> {
  return guard(async () => { const a = await requireActor('LOG_VIEW'); return ok(await loadRetention(a.panel)); });
}

export async function saveRetention(cfg: Partial<RetentionConfig>): Promise<ActionResult<RetentionConfig>> {
  return guard(async () => {
    const a = await requireActor('RETENTION_MANAGE');
    const before = await loadRetention(a.panel);
    const merged = mergeRetention({ ...before, ...cfg });
    const { error } = await diagDb().from('diag_settings').upsert({ panel: a.panel, config: merged, updated_at: new Date().toISOString(), updated_by: a.email });
    if (error) return fail(GENERIC_ERROR);
    await audit(a, 'RETENTION_CHANGED', null, 'OK', { before, after: merged });
    return ok(merged);
  });
}

export async function listRoles(): Promise<ActionResult<any[]>> {
  return guard(async () => {
    const a = await requireActor('ROLE_MANAGE');
    const { data } = await diagDb().from('diag_roles').select('email, role, school_ids, updated_at').eq('panel', a.panel).order('email');
    return ok(data ?? []);
  });
}

export async function setRole(email: string, role: string | null, schoolIds: string[] | null): Promise<ActionResult> {
  return guard(async () => {
    const a = await requireActor('ROLE_MANAGE');
    const e = cleanLine(email, 200)?.toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fail('Enter a valid email.');
    if (e === a.email) return fail('You cannot change your own Logs role.');
    const db = diagDb();
    if (role === null) await db.from('diag_roles').delete().eq('panel', a.panel).eq('email', e);
    else {
      if (!(ROLES as readonly string[]).includes(role)) return fail('Invalid role.');
      const ids = schoolIds?.map((s) => cleanLine(s, 64)).filter((s): s is string => !!s) ?? null;
      await db.from('diag_roles').upsert({ panel: a.panel, email: e, role, school_ids: ids?.length ? ids : null, updated_at: new Date().toISOString() });
    }
    await audit(a, 'ROLE_CHANGED', e, 'OK', { role, schoolIds });
    return ok(undefined);
  });
}

export async function listAudit(page = 0): Promise<ActionResult<any[]>> {
  return guard(async () => {
    const a = await requireActor('AUDIT_VIEW');
    const { data } = await diagDb().from('diag_audit').select('at, actor, action, resource_id, result, ip').eq('panel', a.panel).order('at', { ascending: false }).range(page * 100, page * 100 + 99);
    return ok(data ?? []);
  });
}
