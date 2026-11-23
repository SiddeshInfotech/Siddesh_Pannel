import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// LMS School website (ThinkSpher360) — read and manage its users from LMS-Admin.
// ⛔ SERVER-SIDE ONLY (server components and 'use server' actions), like ./supabase.ts.
// WEBSITE_SUPABASE_SECRET_KEY is a dedicated secret key of the website's Supabase project,
// created for this panel only so it can be revoked on its own. Never NEXT_PUBLIC_, never logged.
// All writes go through the website's panel_* database functions, which validate and scope
// every change to one user (website migration 20261118020000_panel_user_admin.sql).
// ============================================================================

let client: SupabaseClient | null | undefined;

export function websiteDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.WEBSITE_SUPABASE_URL;
  const key = process.env.WEBSITE_SUPABASE_SECRET_KEY;
  client = url && key
    ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    })
    : null;
  return client;
}

export const WEBSITE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** email (lower case) → website user id, for the given panel parents' emails. Empty map if the website isn't configured. */
export async function websiteUsersByEmail(emails: string[]): Promise<Map<string, string>> {
  const db = websiteDb();
  const wanted = [...new Set(emails.filter((e) => typeof e === 'string' && e.includes('@')).map((e) => e.trim().toLowerCase()))];
  const found = new Map<string, string>();
  if (!db || !wanted.length) return found;
  for (let i = 0; i < wanted.length; i += 2000) {
    const { data, error } = await db.rpc('panel_users_by_email', { p_emails: wanted.slice(i, i + 2000) });
    if (error) {
      console.error('websiteUsersByEmail failed:', error.code);
      return found;
    }
    for (const row of (data ?? []) as { user_id: string; email: string }[]) found.set(row.email, row.user_id);
  }
  return found;
}

export interface WebsiteOverview {
  account: {
    id: string; email: string; created_at: string; last_sign_in_at: string | null; blocked: boolean;
    full_name: string | null; phone: string | null; phone_verified_at: string | null;
  };
  classes: { id: string; plan: string | null; course: string | null; source: string; status: string; starts_at: string; ends_at: string | null; revoked_reason: string | null }[];
  orders: { id: string; status: string; total_minor: number; currency: string; created_at: string; items: string[]; payment_ids: string[] }[];
  keys: { order_id: string; panel_key_id: string | null; created_at: string; revoked_at: string | null }[];
  devices: { id: string; name: string | null; platform: string; version: string; status: string; wrap_scheme: string; first_seen_at: string | null; last_seen_at: string | null }[];
}

export async function websiteUserOverview(userId: string): Promise<WebsiteOverview | null> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(userId)) return null;
  const { data, error } = await db.rpc('panel_user_overview', { p_user_id: userId });
  if (error) {
    console.error('websiteUserOverview failed:', error.code);
    return null;
  }
  return (data as WebsiteOverview | null) ?? null;
}

export interface WindowsAppRequest {
  user_id: string; email: string; full_name: string | null; phone: string | null; order_id: string;
  status: 'pending' | 'sent'; requested_at: string; sent_at: string | null; sent_by: string | null;
}

/** Website buyers' requests for the Windows app (.exe): open ones oldest first, then recently sent. Null if unavailable. */
export async function websiteAppRequests(limit = 200): Promise<WindowsAppRequest[] | null> {
  const db = websiteDb();
  if (!db) return null;
  const { data, error } = await db.rpc('panel_windows_app_requests', { p_limit: limit });
  if (error) {
    console.error('websiteAppRequests failed:', error.code);
    return null;
  }
  return (data ?? []) as WindowsAppRequest[];
}

/** Marks a buyer's open request sent. 'done', 'already' (sent before or withdrawn) or 'failed'. */
export async function markWebsiteAppSent(userId: string, adminEmail: string): Promise<'done' | 'already' | 'failed'> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(userId)) return 'failed';
  const { data, error } = await db.rpc('panel_mark_windows_app_sent', { p_user_id: userId, p_admin_email: adminEmail });
  if (error) {
    console.error('markWebsiteAppSent failed:', error.code);
    return 'failed';
  }
  return data === true ? 'done' : 'already';
}

export async function websitePlans(): Promise<{ id: string; name: string }[]> {
  const db = websiteDb();
  if (!db) return [];
  const { data } = await db.from('plans').select('id, name').eq('is_active', true).order('name').limit(500);
  return (data ?? []) as { id: string; name: string }[];
}
