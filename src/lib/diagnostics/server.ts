// Siddesh Logs — server-side helpers: actor resolution (auth + Logs RBAC + school scope),
// audit trail, rate limiting, settings. Every Logs action/route starts with requireActor().
import 'server-only';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminSession } from '@/lib/auth';
import { getClientIp } from '@/lib/sanitize';
import { ROLES, hasPermission, mergeRetention, type Permission, type RetentionConfig, type Role } from './core';
import { col } from './mongo';
import { swrCache } from '@/lib/swrCache';

export type Panel = 'lms' | 'lab';
export type Actor = { email: string; panel: Panel; role: Role; schoolIds: string[] | null; ip: string };

/** Supabase — only for the artifact file bucket, the shared login rate limiter and the code counters.
 *  Every Health/Logs table lives in MongoDB (./mongo.ts). */
export const diagDb = () => supabaseAdmin;

/** Bootstrap Super Admins (comma-separated emails) — needed once to grant the first roles. */
function bootstrapSuperAdmins(): Set<string> {
  // Tolerate values pasted with quotes/spaces/semicolons in the Vercel UI ("a@x.com"; b@y.com).
  return new Set((process.env.DIAG_SUPER_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.replace(/["']/g, '').trim().toLowerCase()).filter(Boolean));
}

// Role lookups (MongoDB) are remembered for 15 s per panel+email, so every Health/Logs request does
// not wait on a MongoDB round trip. Plain TTL (never served stale); a failed lookup is never cached.
// Roles are edited outside this app, so a role removal/downgrade/scope change applies within 15 s
// (the admin session itself is still re-checked on every request by getAdminSession()).
const roleCache = swrCache<{ role: unknown; school_ids?: string[] | null } | null>({ freshMs: 15_000, maxMs: 15_000, maxEntries: 500 });

export async function resolveActor(): Promise<Actor | null> {
  const session = await getAdminSession();
  if (!session) return null;
  const email = session.email.toLowerCase();
  let ip = '0.0.0.0';
  try { ip = getClientIp(await headers()); } catch { /* not in a request scope */ }
  if (bootstrapSuperAdmins().has(email)) return { email, panel: session.panel, role: 'SUPER_ADMIN', schoolIds: null, ip };
  const data = await roleCache.get(`${session.panel}|${email}`, async () => {
    const d = await (await col('diag_roles')).findOne({ panel: session.panel, email }, { projection: { role: 1, school_ids: 1 } });
    return d ? { role: d.role, school_ids: (d.school_ids as string[] | null | undefined) ?? null } : null;
  });
  if (!data || !(ROLES as readonly string[]).includes(data.role as string)) return null; // authenticated ≠ authorized
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
    await (await col('diag_audit')).insertOne({ panel: actor.panel, at: new Date(), actor: actor.email, action, resource_id: resourceId, result, ip: actor.ip, detail: detail ?? null });
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
  const data = await (await col('diag_settings')).findOne({ _id: panel as never }, { projection: { config: 1 } });
  return mergeRetention(data?.config);
}

/**
 * Panels whose Logs/Health data this actor sees. A full (unscoped) admin of EITHER login sees
 * LMS-Admin and Lab-Admin data together; a school-scoped role only its own panel (its school ids
 * belong to that panel).
 */
export function visiblePanels(actor: Pick<Actor, 'panel' | 'schoolIds'>): Panel[] {
  return actor.schoolIds ? [actor.panel] : ['lms', 'lab'];
}

/** School/tenant scope applied server-side to every query (frontend filtering is not security): a filter to spread into a MongoDB query. */
export function scoped(actor: Actor, field = 'entity_id'): Record<string, unknown> {
  const panel = { $in: visiblePanels(actor) };
  return actor.schoolIds ? { panel, [field]: { $in: actor.schoolIds } } : { panel };
}

export function canSeeIssue(actor: Actor, issue: { panel: string; affected_schools?: string[] | null }): boolean {
  if (!visiblePanels(actor).includes(issue.panel as Panel)) return false;
  if (!actor.schoolIds) return true;
  return (issue.affected_schools ?? []).some((s) => actor.schoolIds!.includes(s));
}

export { logsDbErrorMessage as dbErrorMessage } from './mongo';
