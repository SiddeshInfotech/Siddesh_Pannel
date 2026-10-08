// Siddesh Logs — server-side helpers: actor resolution (auth + Logs RBAC + school scope),
// audit trail, rate limiting, settings. Every Logs action/route starts with requireActor().
import 'server-only';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminSession } from '@/lib/auth';
import { getClientIp } from '@/lib/sanitize';
import { ROLES, hasPermission, mergeRetention, type Permission, type RetentionConfig, type Role } from './core';

export type Panel = 'lms' | 'lab';
export type Actor = { email: string; panel: Panel; role: Role; schoolIds: string[] | null; ip: string };

export const diagDb = () => supabaseAdmin;

/** Bootstrap Super Admins (comma-separated emails) — needed once to grant the first roles. */
function bootstrapSuperAdmins(): Set<string> {
  return new Set((process.env.DIAG_SUPER_ADMINS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export async function resolveActor(): Promise<Actor | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const email = session.email.toLowerCase();
  let ip = '0.0.0.0';
  try { ip = getClientIp(await headers()); } catch { /* not in a request scope */ }
  if (bootstrapSuperAdmins().has(email)) return { email, panel: session.panel, role: 'SUPER_ADMIN', schoolIds: null, ip };
  const { data } = await diagDb().from('diag_roles').select('role, school_ids').eq('panel', session.panel).eq('email', email).maybeSingle();
  if (!data || !(ROLES as readonly string[]).includes(data.role)) return null; // authenticated ≠ authorized
  return { email, panel: session.panel, role: data.role as Role, schoolIds: data.school_ids ?? null, ip };
}

export class DiagAuthError extends Error {}

/** Auth + permission check; failures are audited (log access monitoring). */
export async function requireActor(perm: Permission, resourceId?: string): Promise<Actor> {
  const actor = await resolveActor();
  if (!actor) throw new DiagAuthError('Not authorized for Logs.');
  if (!hasPermission(actor.role, perm)) {
    await audit(actor, `DENIED:${perm}`, resourceId ?? null, 'DENIED');
    throw new DiagAuthError('You do not have permission for this action.');
  }
  return actor;
}

export async function audit(actor: Pick<Actor, 'email' | 'panel' | 'ip'>, action: string, resourceId: string | null, result: string, detail?: Record<string, unknown>) {
  try {
    await diagDb().from('diag_audit').insert({ panel: actor.panel, actor: actor.email, action, resource_id: resourceId, result, ip: actor.ip, detail: detail ?? null });
  } catch { /* audit failure must never break the request */ }
}

/** Uses the existing bump_login_rate_limit RPC. Fails CLOSED for panel users (downloads/deletes). */
export async function rateLimit(key: string, windowMs: number, max: number, failOpen = false): Promise<boolean> {
  const { data, error } = await diagDb().rpc('bump_login_rate_limit', { p_key: `diag:${key}`, p_window_ms: windowMs, p_max: max });
  if (error) return failOpen;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.allowed ?? failOpen;
}

export async function loadRetention(panel: Panel): Promise<RetentionConfig> {
  const { data } = await diagDb().from('diag_settings').select('config').eq('panel', panel).maybeSingle();
  return mergeRetention(data?.config);
}

/** School/tenant scope applied server-side to every query (frontend filtering is not security). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoped<Q extends { eq: any; in: any }>(q: Q, actor: Actor, col = 'entity_id'): Q {
  let out = q.eq('panel', actor.panel);
  if (actor.schoolIds) out = out.in(col, actor.schoolIds.length ? actor.schoolIds : ['__none__']);
  return out;
}

export function canSeeIssue(actor: Actor, issue: { panel: string; affected_schools?: string[] | null }): boolean {
  if (issue.panel !== actor.panel) return false;
  if (!actor.schoolIds) return true;
  return (issue.affected_schools ?? []).some((s) => actor.schoolIds!.includes(s));
}

/** User-facing message for a DB error: a missing table/function means the SQL migration hasn't run. */
export function dbErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? '';
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(code) || /does not exist|could not find the (table|function)/i.test(error?.message ?? '')) {
    return 'Logs/Health database is not set up yet. Run diagnostics-schema.sql, then ops-schema.sql, in the Supabase SQL editor.';
  }
  return 'Something went wrong. Please try again.';
}
