'use server';

// Siddesh Logs — server actions. Every action: requireActor(permission) → panel + school scope
// enforced HERE (never by the UI) → rate limit where abusable → audit. Only whitelisted
// fields/values reach the MongoDB filter (user text is regex-escaped, never an operator).
import { DiagAuthError, audit, canSeeIssue, dbErrorMessage, diagDb, rateLimit, requireActor, resolveActor, scoped, loadRetention, visiblePanels, type Actor } from '@/lib/diagnostics/server';
import { ISSUE_STATUSES, canTransition, cleanBlock, cleanLine, isProtected, permissionsOf, type IssueStatus, type Permission } from '@/lib/diagnostics/core';
import { purgeIssue } from '@/lib/diagnostics/cleanup';
import { buildZip } from '@/lib/diagnostics/zip';
import { col, contains, fields, toRow, toRows, toSet } from '@/lib/diagnostics/mongo';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic documents */

const SORTABLE_ISSUES = new Set(['last_seen_at', 'first_seen_at', 'occurrence_count', 'severity', 'status']);
const CLOSED = ['RESOLVED', 'DELETE_PENDING', 'DELETED'];

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try { return await fn(); } catch (e) { return fail(e instanceof DiagAuthError ? e.message : dbErrorMessage(e)); }
}
const str = (v: unknown, n = 80) => (typeof v === 'string' ? cleanLine(v, n) : null);
const idOf = (v: unknown) => String(v).slice(0, 64) as never;
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

export async function getEvent(id: string): Promise<ActionResult<{ event: any; timeline: any[] }>> {
  return guard(async () => {
    const a = await requireActor('LOG_VIEW', id);
    const events = await col('diag_events');
    const ev = toRow(await events.findOne({ ...scoped(a), _id: idOf(id) }));
    if (!ev) return fail('Not found.');
    let timeline: any[] = [];
    if (ev.session_id) {
      const docs = await events.find({ ...scoped(a), session_id: ev.session_id, ts: { $lte: new Date(ev.ts) } },
        fields('id, ts, severity, event_type, module, feature, action, message, result')).sort({ ts: -1 }).limit(100).toArray();
      timeline = toRows(docs).reverse();
    }
    await audit(a, 'LOG_VIEWED', id, 'OK');
    return ok({ event: ev, timeline });
  });
}

// ── Issues (fingerprint groups / bugs) ──────────────────────────────────────
export type IssueFilters = { kind?: string; status?: string; q?: string; product?: string; sort?: string; page?: number; pageSize?: number };
export async function listIssues(f: IssueFilters): Promise<ActionResult<{ rows: any[]; total: number; page: number }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW');
    await limited(a, 'search', 60_000, 120);
    const q: Record<string, any> = { panel: { $in: visiblePanels(a) } };
    if (a.schoolIds) q.affected_schools = { $in: a.schoolIds };
    if (f.kind && ['CRASH', 'ERROR', 'WARNING', 'USER_REPORT'].includes(f.kind)) q.kind = f.kind;
    if (f.status === 'OPEN') q.status = { $nin: CLOSED };
    else if (f.status && (ISSUE_STATUSES as readonly string[]).includes(f.status)) q.status = f.status;
    const s = str(f.q, 100); if (s) q.title = contains(s);
    const p = str(f.product); if (p) q.product_id = p;
    const sort = f.sort && SORTABLE_ISSUES.has(f.sort) ? f.sort : 'last_seen_at';
    const size = Math.min(100, Math.max(5, Number(f.pageSize) || 50));
    const issues = await col('diag_issues');
    const total = await issues.countDocuments(q);
    // A page past the end (narrower filter, purged issues) falls back to the last page.
    const page = Math.min(Math.max(0, Number(f.page) || 0), Math.max(0, Math.ceil(total / size) - 1));
    const docs = await issues.find(q, fields('id, code, panel, kind, severity, title, product_id, status, occurrence_count, affected_schools, affected_machines, affected_versions, affected_modules, first_seen_at, last_seen_at, resolved_at, fixed_version, reopen_count'))
      .sort({ [sort]: -1, _id: 1 }).skip(page * size).limit(size).toArray();
    const rows = toRows(docs).map((r: any) => ({
      ...r, schools: (r.affected_schools ?? []).length, machines: (r.affected_machines ?? []).length, affected_schools: undefined, affected_machines: undefined,
    }));
    return ok({ rows, total, page });
  });
}

async function loadIssue(a: Actor, id: string) {
  const data = toRow(await (await col('diag_issues')).findOne({ _id: idOf(id), panel: { $in: visiblePanels(a) } }));
  return data && canSeeIssue(a, data) ? data : null;
}

export async function getIssue(id: string): Promise<ActionResult<{ issue: any; crashes: any[]; events: any[]; artifacts: any[] }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    const [cr, ev, ar] = await Promise.all([
      (await col('diag_crashes')).find({ ...scoped(a), issue_id: issue.id }, fields('id, code, ts, product_version, build_number, school_name, computer_name, machine_id, user_id, session_id, module, feature, action, event_type'))
        .sort({ ts: -1 }).limit(50).toArray(),
      (await col('diag_events')).find({ ...scoped(a), issue_id: issue.id }, fields('id, ts, severity, event_type, school_name, computer_name, product_version, module, action, message'))
        .sort({ ts: -1 }).limit(50).toArray(),
      (await col('diag_artifacts')).find({ issue_id: issue.id, panel: issue.panel }, fields('id, kind, crash_id, size_bytes, mime, created_at, sha256')).toArray(),
    ]);
    // Opening a NEW issue moves it to REVIEWING (only for users who may manage bugs).
    if ((issue.status === 'NEW' || issue.status === 'REOPENED') && permissionsOf(a.role).includes('BUG_MANAGE')) {
      await (await col('diag_issues')).updateOne({ _id: issue.id, status: issue.status }, { $set: { status: 'REVIEWING' } });
      issue.status = 'REVIEWING';
    }
    await audit(a, 'ISSUE_VIEWED', issue.code, 'OK');
    return ok({ issue, crashes: toRows(cr), events: toRows(ev), artifacts: toRows(ar) });
  });
}

export async function getCrash(id: string): Promise<ActionResult<{ crash: any; artifacts: any[] }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_VIEW', id);
    const crash = toRow(await (await col('diag_crashes')).findOne({ ...scoped(a), _id: idOf(id) }));
    if (!crash) return fail('Not found.');
    const artifacts = await (await col('diag_artifacts')).find({ crash_id: crash.id, panel: crash.panel }, fields('id, kind, size_bytes, mime, created_at, sha256')).toArray();
    await audit(a, 'CRASH_VIEWED', crash.code, 'OK');
    return ok({ crash, artifacts: toRows(artifacts) });
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
    const [crashes, events, arts] = await Promise.all([
      (await col('diag_crashes')).find({ ...scoped(a), issue_id: issue.id }).sort({ ts: -1 }).limit(20).toArray(),
      (await col('diag_events')).find({ ...scoped(a), issue_id: issue.id }).sort({ ts: -1 }).limit(200).toArray(),
      (await col('diag_artifacts')).find({ issue_id: issue.id, panel: issue.panel }, fields('id, kind, crash_id, size_bytes, mime, sha256, created_at')).toArray(),
    ]);
    const cs = toRows(crashes);
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
      { name: 'errors.json', data: j(toRows(events)) },
      { name: 'api-events.json', data: j(timeline.filter((e: any) => String(e.event_type ?? '').startsWith('API_'))) },
      { name: 'performance.json', data: j({ crashes: cs.map((c: any) => ({ crash: c.code, perf: c.perf_state })), events: timeline.filter((e: any) => ['SLOW_OPERATION', 'HIGH_MEMORY', 'HIGH_CPU', 'LOW_DISK', 'UI_FREEZE'].includes(e.event_type)) }) },
      { name: 'system-info.json', data: j(cs.map((c: any) => ({ crash: c.code, system: c.system_info }))) },
      { name: 'environment.json', data: j(cs.map((c: any) => ({ crash: c.code, network: c.network_state, app_state: c.app_state }))) },
      { name: 'crash-dumps/ARTIFACTS.json', data: j(toRows(arts)) },
    ]);
    const upd: any = { downloaded_at: new Date().toISOString() };
    if (canTransition(issue.status, 'DOWNLOADED')) upd.status = 'DOWNLOADED';
    await (await col('diag_issues')).updateOne({ _id: issue.id }, { $set: toSet(upd) });
    await audit(a, 'BUNDLE_DOWNLOADED', issue.code, 'OK', { crashes: cs.length, bytes: zip.length });
    return ok({ filename: `siddesh-diagnostics-${issue.code}.zip`, base64: Buffer.from(zip).toString('base64') });
  });
}

/** Short-lived (60 s) signed URL for one dump/screenshot, by internal id only. */
export async function getArtifactUrl(artifactId: string): Promise<ActionResult<{ url: string }>> {
  return guard(async () => {
    const a = await requireActor('CRASH_DOWNLOAD', artifactId);
    await limited(a, 'download', 600_000, 20);
    const art = toRow(await (await col('diag_artifacts')).findOne({ _id: idOf(artifactId), panel: { $in: visiblePanels(a) } }, fields('id, storage_path, issue_id, kind, status')));
    if (!art || art.status !== 'ACTIVE') return fail('Not found.');
    if (a.schoolIds && art.issue_id && !(await loadIssue(a, art.issue_id))) return fail('Not found.');
    const { data, error } = await diagDb().storage.from('diagnostics').createSignedUrl(art.storage_path, 60, { download: `${art.kind.toLowerCase()}-${art.id}` });
    if (error || !data) return fail(GENERIC_ERROR);
    await audit(a, 'ARTIFACT_DOWNLOADED', art.id, 'OK', { kind: art.kind });
    return ok({ url: data.signedUrl });
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
    await (await col('diag_issues')).updateOne({ _id: issue.id, status: issue.status }, { $set: { status: to } });
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
    const cfg = await loadRetention(issue.panel);
    const now = Date.now();
    await (await col('diag_issues')).updateOne({ _id: issue.id, status: issue.status }, { $set: {
      status: 'RESOLVED', resolved_at: new Date(now), resolved_by: a.email, root_cause: root, resolution: res,
      fixed_version: fixed, developer_notes: cleanBlock(form.notes, 4000), delete_after: new Date(now + cfg.resolvedGraceHours * 3600_000),
    } });
    await audit(a, 'ISSUE_RESOLVED', issue.code, 'OK', { fixed_version: fixed });
    return ok(undefined);
  });
}

export async function previewDelete(id: string): Promise<ActionResult<{ code: string; status: string; events: number; crashes: number; screenshots: number; dumps: number; logs: number; bytes: number; protected: boolean }>> {
  return guard(async () => {
    const a = await requireActor('DIAGNOSTIC_DELETE', id);
    const issue = await loadIssue(a, id);
    if (!issue) return fail('Not found.');
    const [events, crashes, arts] = await Promise.all([
      (await col('diag_events')).countDocuments({ issue_id: issue.id }),
      (await col('diag_crashes')).countDocuments({ issue_id: issue.id }),
      (await col('diag_artifacts')).find({ issue_id: issue.id }, fields('kind, size_bytes')).toArray(),
    ]);
    return ok({
      code: issue.code, status: issue.status, events, crashes,
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
    const r = await purgeIssue(issue.panel, issue.id);
    await audit(a, force ? 'DIAGNOSTICS_FORCE_DELETED' : 'DIAGNOSTICS_DELETED', issue.code, r.ok ? 'OK' : 'PARTIAL', r);
    return r.ok ? ok({}) : fail('Some files could not be deleted yet; cleanup will retry automatically.');
  });
}
