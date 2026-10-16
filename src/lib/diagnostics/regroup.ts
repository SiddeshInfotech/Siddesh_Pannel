// Siddesh Logs — re-group bugs after the fingerprint rules change (core.ts fingerprintOf).
// Each bug's fingerprint is recomputed from one of its own events/crashes with the CURRENT rules;
// bugs that now share a fingerprint are merged into the oldest one (counts added, affected
// schools/machines/versions/modules joined, events/crashes/files re-pointed), the others removed.
// Every remaining bug gets the new fingerprint so future reports join it. Idempotent: a second run
// finds nothing to merge. dryRun = report the plan only.
import 'server-only';
import { fingerprintOf, severityRank } from './core';
import { col } from './mongo';

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic documents */

const CLOSED = ['RESOLVED', 'DELETE_PENDING', 'DELETED'];
// Most advanced open status wins when open and resolved duplicates are merged.
const OPEN_ORDER = ['NEW', 'REOPENED', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING'];
const union = (lists: any[][], cap: number) => [...new Set(lists.flat().filter(Boolean))].slice(0, cap);

export type RegroupResult = { scanned: number; recomputed: number; merged: number; groups: { survivor: string; merged: string[]; fingerprint: string }[] };

/** Fingerprint of a bug from one of its events (or crashes), computed exactly like ingest does. */
async function currentFingerprint(issueId: string): Promise<string | null> {
  const ev: any = await (await col('diag_events')).findOne({ issue_id: issueId },
    { projection: { product_id: 1, event_type: 1, message: 1, module: 1, error_code: 1, 'data.exception.type': 1, 'data.stack_trace': 1 } });
  if (ev) {
    return fingerprintOf({ product_id: ev.product_id, event_type: ev.event_type, exception_type: ev.data?.exception?.type, message: ev.message,
      stack: ev.data?.stack_trace, module: ev.module, error_code: ev.error_code ?? ev.data?.exception?.code });
  }
  const cr: any = await (await col('diag_crashes')).findOne({ issue_id: issueId },
    { projection: { product_id: 1, event_type: 1, module: 1, exception: 1, stack_trace: 1 } });
  if (cr) {
    return fingerprintOf({ product_id: cr.product_id, event_type: cr.event_type, exception_type: cr.exception?.type, message: cr.exception?.message,
      stack: cr.stack_trace, module: cr.module, error_code: cr.exception?.code ?? cr.exception?.native_code });
  }
  return null; // its raw evidence already expired → keep the bug as it is
}

export async function regroupIssues(opts: { dryRun?: boolean } = {}): Promise<RegroupResult> {
  const issues = await col('diag_issues');
  const all: any[] = await issues.find({ status: { $ne: 'DELETED' } }).sort({ first_seen_at: 1, _id: 1 }).toArray();
  const byKey = new Map<string, any[]>();
  let recomputed = 0;
  for (const i of all) {
    const fp = await currentFingerprint(String(i._id));
    if (!fp) continue;
    recomputed++;
    i._newFp = fp;
    const key = `${i.panel}|${fp}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  const result: RegroupResult = { scanned: all.length, recomputed, merged: 0, groups: [] };
  for (const members of byKey.values()) {
    const [survivor, ...dupes] = members; // oldest first
    if (dupes.length) result.groups.push({ survivor: survivor.code, merged: dupes.map((d) => d.code), fingerprint: survivor._newFp });
    if (opts.dryRun) continue;
    if (dupes.length) {
      const ids = dupes.map((d) => d._id);
      const open = members.filter((m) => !CLOSED.includes(m.status));
      const status = open.length ? open.map((m) => m.status).sort((x, y) => OPEN_ORDER.indexOf(y) - OPEN_ORDER.indexOf(x))[0] : survivor.status;
      const worst = members.map((m) => m.severity).sort((x, y) => severityRank(y) - severityRank(x))[0];
      const max = (k: string) => members.map((m) => m[k]).filter(Boolean).sort((x, y) => +y - +x)[0] ?? null;
      const min = (k: string) => members.map((m) => m[k]).filter(Boolean).sort((x, y) => +x - +y)[0] ?? null;
      await Promise.all(['diag_events', 'diag_crashes', 'diag_artifacts'].map(async (name) =>
        (await col(name as 'diag_events')).updateMany({ issue_id: { $in: ids } }, { $set: { issue_id: survivor._id } })));
      await issues.deleteMany({ _id: { $in: ids } });
      await issues.updateOne({ _id: survivor._id }, { $set: {
        status, severity: worst, kind: members.some((m) => m.kind === 'CRASH') ? 'CRASH' : survivor.kind,
        occurrence_count: members.reduce((s, m) => s + Number(m.occurrence_count ?? 0), 0),
        reopen_count: members.reduce((s, m) => s + Number(m.reopen_count ?? 0), 0),
        first_seen_at: min('first_seen_at'), last_seen_at: max('last_seen_at'), downloaded_at: max('downloaded_at'),
        affected_schools: union(members.map((m) => m.affected_schools ?? []), 500), affected_machines: union(members.map((m) => m.affected_machines ?? []), 500),
        affected_versions: union(members.map((m) => m.affected_versions ?? []), 200), affected_modules: union(members.map((m) => m.affected_modules ?? []), 200),
        environment: members.some((m) => m.environment === 'production') ? 'production' : survivor.environment,
        ...(status !== 'RESOLVED' ? { delete_after: null } : {}),
      } });
      result.merged += dupes.length;
    }
    // Future reports must find the bug under the new rules. (A bug whose evidence already expired and that
    // happens to hold this fingerprint keeps it — unique (panel, fingerprint) — so this is best-effort.)
    if (survivor.fingerprint !== survivor._newFp) {
      await issues.updateOne({ _id: survivor._id }, { $set: { fingerprint: survivor._newFp } }).catch(() => undefined);
    }
  }
  return result;
}
