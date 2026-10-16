// Siddesh Logs — lifecycle cleanup + reconciliation. Runs from the cron route (never inline
// with user traffic) and from "Run cleanup now". Deletion order is STORAGE FIRST, then rows:
//   artifact row → DELETE_PENDING → storage object removed → row deleted.
// A crash between steps leaves a DELETE_PENDING row that the next run retries, so we never
// end with "row gone but dump remains" or "dump gone but row says it exists".
// Rows live in MongoDB; artifact FILES stay in the Supabase `diagnostics` bucket. Expired raw
// events are also removed by MongoDB's own TTL index — step 1 here protects evidence of open bugs.
import 'server-only';
import { randomUUID } from 'crypto';
import { diagDb, loadRetention, type Panel } from './server';
import { PROTECTED_STATUSES } from './core';
import { col } from './mongo';

export type CleanupResult = { events_deleted: number; crashes_deleted: number; issues_purged: number; artifacts_deleted: number; orphans_deleted: number; bytes_reclaimed: number };

const BUCKET = 'diagnostics';
type ArtRow = { _id: string; storage_path: string; size_bytes: number };
const artProjection = { projection: { storage_path: 1, size_bytes: 1 } };

/** Remove artifact objects then rows. Returns [deleted, bytes]. Failures stay DELETE_PENDING for retry. */
async function removeArtifacts(rows: ArtRow[]): Promise<[number, number]> {
  const arts = await col('diag_artifacts');
  let n = 0, bytes = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const ids = chunk.map((r) => r._id) as never[];
    await arts.updateMany({ _id: { $in: ids } }, { $set: { status: 'DELETE_PENDING' } });
    const { error } = await diagDb().storage.from(BUCKET).remove(chunk.map((r) => r.storage_path));
    if (error) continue; // retried next run
    await arts.deleteMany({ _id: { $in: ids } });
    n += chunk.length; bytes += chunk.reduce((s, r) => s + Number(r.size_bytes), 0);
  }
  return [n, bytes];
}

/** Hard-delete all temporary diagnostics of one issue; keep only the small bug summary. */
export async function purgeIssue(panel: Panel, issueId: string): Promise<CleanupResult & { ok: boolean }> {
  const r: CleanupResult & { ok: boolean } = { ok: false, events_deleted: 0, crashes_deleted: 0, issues_purged: 0, artifacts_deleted: 0, orphans_deleted: 0, bytes_reclaimed: 0 };
  const issues = await col('diag_issues');
  await issues.updateOne({ _id: issueId as never, panel, status: { $ne: 'DELETED' } }, { $set: { status: 'DELETE_PENDING' } });
  const arts = await (await col('diag_artifacts')).find({ issue_id: issueId, panel }, artProjection).toArray() as unknown as ArtRow[];
  [r.artifacts_deleted, r.bytes_reclaimed] = await removeArtifacts(arts);
  if (r.artifacts_deleted < arts.length) return r; // storage not clean yet → stay DELETE_PENDING, retry
  const [ev, cr] = await Promise.all([
    (await col('diag_events')).deleteMany({ issue_id: issueId, panel }),
    (await col('diag_crashes')).deleteMany({ issue_id: issueId, panel }),
  ]);
  r.events_deleted = ev.deletedCount;
  r.crashes_deleted = cr.deletedCount;
  const done = await issues.updateOne({ _id: issueId as never, panel }, { $set: { status: 'DELETED', deleted_at: new Date(), stack_sample: null, affected_machines: [] } });
  r.ok = done.acknowledged;
  r.issues_purged = r.ok ? 1 : 0;
  return r;
}

export async function runCleanup(panel: Panel): Promise<CleanupResult> {
  const cfg = await loadRetention(panel);
  const now = Date.now();
  const total: CleanupResult = { events_deleted: 0, crashes_deleted: 0, issues_purged: 0, artifacts_deleted: 0, orphans_deleted: 0, bytes_reclaimed: 0 };
  const add = (x: Partial<CleanupResult>) => { for (const k of Object.keys(total) as (keyof CleanupResult)[]) total[k] += x[k] ?? 0; };
  const runs = await col('diag_cleanup_runs');
  const runId = randomUUID();
  await runs.insertOne({ _id: runId as never, panel, started_at: new Date(), finished_at: null, error: null });
  let err: string | null = null;
  try {
    const issues = await col('diag_issues');
    // 1. Expired raw events — except evidence attached to an active investigation. The TTL index would
    //    delete that evidence too, so its expiry is pushed forward while the bug is still open.
    const protIds = await issues.distinct('_id', { panel, status: { $in: [...PROTECTED_STATUSES] } });
    const events = await col('diag_events');
    if (protIds.length) {
      await events.updateMany({ panel, issue_id: { $in: protIds }, expires_at: { $lt: new Date(now + 2 * 86_400_000) } },
        { $set: { expires_at: new Date(now + 7 * 86_400_000) } });
    }
    const gone = await events.deleteMany({ panel, expires_at: { $lt: new Date(now) }, ...(protIds.length ? { issue_id: { $nin: protIds } } : {}) });
    add({ events_deleted: gone.deletedCount });

    // 2. Resolved past grace → purge. DELETE_PENDING (earlier partial runs) → retry.
    const graceCut = new Date(now - cfg.resolvedGraceHours * 3600_000);
    const due = await issues.find({ panel, $or: [
      { status: 'DELETE_PENDING' }, { status: 'RESOLVED', resolved_at: { $lt: graceCut } }, { status: 'RESOLVED', delete_after: { $lt: new Date(now) } },
    ] }, { projection: { _id: 1 } }).limit(200).toArray();
    for (const i of due) add(await purgeIssue(panel, String(i._id)));

    // 3. Artifacts: retry DELETE_PENDING, expire per artifact grace after resolution, drop orphaned rows.
    const artCut = new Date(now - cfg.artifactGraceHours * 3600_000);
    const resolvedIssues = await issues.find({ panel, status: 'RESOLVED', resolved_at: { $lt: artCut } }, { projection: { _id: 1 } }).limit(500).toArray();
    const ors: Record<string, unknown>[] = [{ status: 'DELETE_PENDING' }, { issue_id: null }, { expires_at: { $lt: new Date(now) } }];
    if (resolvedIssues.length) ors.push({ issue_id: { $in: resolvedIssues.map((x) => String(x._id)) } });
    const arts = await (await col('diag_artifacts')).find({ panel, $or: ors }, artProjection).limit(1000).toArray() as unknown as ArtRow[];
    const [n, bytes] = await removeArtifacts(arts);
    add({ artifacts_deleted: n, bytes_reclaimed: bytes });

    // 4. Reconciliation: storage objects with no DB row (older than grace) and rows with no object.
    add({ orphans_deleted: await reconcile(panel, cfg.orphanGraceMinutes) });

    // 5. Separate retention for the security audit trail and run history.
    await (await col('diag_audit')).deleteMany({ panel, at: { $lt: new Date(now - cfg.auditDays * 86_400_000) } });
    await runs.deleteMany({ panel, started_at: { $lt: new Date(now - 90 * 86_400_000) } });
  } catch (e) {
    err = e instanceof Error ? e.message.slice(0, 300) : 'cleanup failed';
  }
  await runs.updateOne({ _id: runId as never }, { $set: { ...total, finished_at: new Date(), error: err } });
  return total;
}

async function reconcile(panel: Panel, graceMin: number): Promise<number> {
  const bucket = diagDb().storage.from(BUCKET);
  const { data: folders } = await bucket.list(panel, { limit: 1000 });
  const objects: { path: string; created: number }[] = [];
  for (const f of folders ?? []) {
    const { data: files } = await bucket.list(`${panel}/${f.name}`, { limit: 100 });
    for (const x of files ?? []) objects.push({ path: `${panel}/${f.name}/${x.name}`, created: Date.parse(x.created_at ?? '') || 0 });
  }
  const arts = await col('diag_artifacts');
  const paths = objects.map((o) => o.path);
  const known = new Set<string>(paths.length ? await arts.distinct('storage_path', { storage_path: { $in: paths } }) : []);
  const cutoff = Date.now() - graceMin * 60_000;
  const orphanObjs = objects.filter((o) => !known.has(o.path) && o.created < cutoff).map((o) => o.path);
  let n = 0;
  if (orphanObjs.length && !(await bucket.remove(orphanObjs)).error) n += orphanObjs.length;
  // Rows whose object is gone (only safe when the listing covered everything).
  if ((folders?.length ?? 0) < 1000) {
    const present = new Set(paths);
    const rows = await arts.find({ panel, status: 'ACTIVE', created_at: { $lt: new Date(cutoff) } }, { projection: { storage_path: 1 } }).limit(1000).toArray();
    const missing = rows.filter((r) => !present.has(r.storage_path)).map((r) => r._id);
    if (missing.length) n += (await arts.deleteMany({ _id: { $in: missing } })).deletedCount;
  }
  return n;
}
