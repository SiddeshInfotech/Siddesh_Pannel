// Siddesh Logs — lifecycle cleanup + reconciliation. Runs from the cron route (never inline
// with user traffic) and from "Run cleanup now". Deletion order is STORAGE FIRST, then rows:
//   artifact row → DELETE_PENDING → storage object removed → row deleted.
// A crash between steps leaves a DELETE_PENDING row that the next run retries, so we never
// end with "row gone but dump remains" or "dump gone but row says it exists".
// Physical space: Postgres autovacuum reuses freed pages; we deliberately do NOT run
// VACUUM FULL (it locks tables) — see LOGS.md.
import 'server-only';
import { diagDb, loadRetention, type Panel } from './server';
import { PROTECTED_STATUSES } from './core';

type Db = ReturnType<typeof diagDb>;
export type CleanupResult = { events_deleted: number; crashes_deleted: number; issues_purged: number; artifacts_deleted: number; orphans_deleted: number; bytes_reclaimed: number };

const BUCKET = 'diagnostics';

/** Remove artifact objects then rows. Returns [deleted, bytes]. Failures stay DELETE_PENDING for retry. */
async function removeArtifacts(db: Db, rows: { id: string; storage_path: string; size_bytes: number }[]): Promise<[number, number]> {
  let n = 0, bytes = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await db.from('diag_artifacts').update({ status: 'DELETE_PENDING' }).in('id', chunk.map((r) => r.id));
    const { error } = await db.storage.from(BUCKET).remove(chunk.map((r) => r.storage_path));
    if (error) continue; // retried next run
    const { error: delErr } = await db.from('diag_artifacts').delete().in('id', chunk.map((r) => r.id));
    if (!delErr) { n += chunk.length; bytes += chunk.reduce((s, r) => s + Number(r.size_bytes), 0); }
  }
  return [n, bytes];
}

/** Hard-delete all temporary diagnostics of one issue; keep only the small bug summary. */
export async function purgeIssue(db: Db, panel: Panel, issueId: string): Promise<CleanupResult & { ok: boolean }> {
  const r: CleanupResult & { ok: boolean } = { ok: false, events_deleted: 0, crashes_deleted: 0, issues_purged: 0, artifacts_deleted: 0, orphans_deleted: 0, bytes_reclaimed: 0 };
  await db.from('diag_issues').update({ status: 'DELETE_PENDING' }).eq('id', issueId).eq('panel', panel).neq('status', 'DELETED');
  const { data: arts } = await db.from('diag_artifacts').select('id, storage_path, size_bytes').eq('issue_id', issueId).eq('panel', panel);
  [r.artifacts_deleted, r.bytes_reclaimed] = await removeArtifacts(db, arts ?? []);
  if (r.artifacts_deleted < (arts?.length ?? 0)) return r; // storage not clean yet → stay DELETE_PENDING, retry
  const ev = await db.from('diag_events').delete({ count: 'exact' }).eq('issue_id', issueId).eq('panel', panel);
  const cr = await db.from('diag_crashes').delete({ count: 'exact' }).eq('issue_id', issueId).eq('panel', panel);
  if (ev.error || cr.error) return r;
  r.events_deleted = ev.count ?? 0;
  r.crashes_deleted = cr.count ?? 0;
  const { error } = await db.from('diag_issues').update({
    status: 'DELETED', deleted_at: new Date().toISOString(), stack_sample: null, affected_machines: [],
  }).eq('id', issueId).eq('panel', panel);
  r.ok = !error;
  r.issues_purged = r.ok ? 1 : 0;
  return r;
}

export async function runCleanup(panel: Panel): Promise<CleanupResult> {
  const db = diagDb();
  const cfg = await loadRetention(panel);
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const total: CleanupResult = { events_deleted: 0, crashes_deleted: 0, issues_purged: 0, artifacts_deleted: 0, orphans_deleted: 0, bytes_reclaimed: 0 };
  const add = (x: Partial<CleanupResult>) => { for (const k of Object.keys(total) as (keyof CleanupResult)[]) total[k] += x[k] ?? 0; };
  const { data: run } = await db.from('diag_cleanup_runs').insert({ panel }).select('id').single();
  let err: string | null = null;
  try {
    // 1. Expired raw events — except evidence attached to an active investigation.
    const { data: prot } = await db.from('diag_issues').select('id').eq('panel', panel).in('status', PROTECTED_STATUSES);
    const protIds = (prot ?? []).map((p) => p.id);
    const a = await db.from('diag_events').delete({ count: 'exact' }).eq('panel', panel).lt('expires_at', iso(now)).is('issue_id', null);
    let q = db.from('diag_events').delete({ count: 'exact' }).eq('panel', panel).lt('expires_at', iso(now)).not('issue_id', 'is', null);
    if (protIds.length) q = q.not('issue_id', 'in', `(${protIds.join(',')})`);
    const b = await q;
    add({ events_deleted: (a.count ?? 0) + (b.count ?? 0) });

    // 2. Resolved past grace → purge. DELETE_PENDING (earlier partial runs) → retry.
    const graceCut = iso(now - cfg.resolvedGraceHours * 3600_000);
    const { data: due } = await db.from('diag_issues').select('id')
      .eq('panel', panel)
      .or(`status.eq.DELETE_PENDING,and(status.eq.RESOLVED,resolved_at.lt.${graceCut}),and(status.eq.RESOLVED,delete_after.lt.${iso(now)})`)
      .limit(200);
    for (const i of due ?? []) add(await purgeIssue(db, panel, i.id));

    // 3. Artifacts: retry DELETE_PENDING, expire per artifact grace after resolution, drop orphaned rows.
    const artCut = iso(now - cfg.artifactGraceHours * 3600_000);
    const { data: resolvedIssues } = await db.from('diag_issues').select('id').eq('panel', panel).eq('status', 'RESOLVED').lt('resolved_at', artCut).limit(500);
    const ors = ['status.eq.DELETE_PENDING', 'issue_id.is.null', `expires_at.lt.${iso(now)}`];
    if (resolvedIssues?.length) ors.push(`issue_id.in.(${resolvedIssues.map((x) => x.id).join(',')})`);
    const { data: arts } = await db.from('diag_artifacts').select('id, storage_path, size_bytes').eq('panel', panel).or(ors.join(',')).limit(1000);
    const [n, bytes] = await removeArtifacts(db, arts ?? []);
    add({ artifacts_deleted: n, bytes_reclaimed: bytes });

    // 4. Reconciliation: storage objects with no DB row (older than grace) and rows with no object.
    add({ orphans_deleted: await reconcile(db, panel, cfg.orphanGraceMinutes) });

    // 5. Separate retention for the security audit trail and run history.
    await db.from('diag_audit').delete().eq('panel', panel).lt('at', iso(now - cfg.auditDays * 86_400_000));
    await db.from('diag_cleanup_runs').delete().eq('panel', panel).lt('started_at', iso(now - 90 * 86_400_000));
  } catch (e) {
    err = e instanceof Error ? e.message.slice(0, 300) : 'cleanup failed';
  }
  if (run?.id) await db.from('diag_cleanup_runs').update({ ...total, finished_at: new Date().toISOString(), error: err }).eq('id', run.id);
  return total;
}

async function reconcile(db: Db, panel: Panel, graceMin: number): Promise<number> {
  const { data: folders } = await db.storage.from(BUCKET).list(panel, { limit: 1000 });
  const objects: { path: string; created: number }[] = [];
  for (const f of folders ?? []) {
    const { data: files } = await db.storage.from(BUCKET).list(`${panel}/${f.name}`, { limit: 100 });
    for (const x of files ?? []) objects.push({ path: `${panel}/${f.name}/${x.name}`, created: Date.parse(x.created_at ?? '') || 0 });
  }
  const paths = objects.map((o) => o.path);
  const known = new Set<string>();
  for (let i = 0; i < paths.length; i += 200) {
    const { data } = await db.from('diag_artifacts').select('storage_path').in('storage_path', paths.slice(i, i + 200));
    for (const r of data ?? []) known.add(r.storage_path);
  }
  const cutoff = Date.now() - graceMin * 60_000;
  const orphanObjs = objects.filter((o) => !known.has(o.path) && o.created < cutoff).map((o) => o.path);
  let n = 0;
  if (orphanObjs.length && !(await db.storage.from(BUCKET).remove(orphanObjs)).error) n += orphanObjs.length;
  // Rows whose object is gone (only safe when the listing covered everything).
  if ((folders?.length ?? 0) < 1000) {
    const present = new Set(paths);
    const { data: rows } = await db.from('diag_artifacts').select('id, storage_path').eq('panel', panel).eq('status', 'ACTIVE')
      .lt('created_at', new Date(cutoff).toISOString()).limit(1000);
    const missing = (rows ?? []).filter((r) => !present.has(r.storage_path)).map((r) => r.id);
    if (missing.length && !(await db.from('diag_artifacts').delete().in('id', missing)).error) n += missing.length;
  }
  return n;
}
