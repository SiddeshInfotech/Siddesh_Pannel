import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isLeadStage, LEADS_PAGE_SIZE, type Lead, type LeadEvent, type LeadStage } from './leads';

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
  user_id: string; email: string; full_name: string | null; phone: string | null;
  /** Where to send the .exe on WhatsApp: the number the buyer gave, or their profile number. */
  whatsapp: string | null; order_id: string;
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

// ---- Leads: the website's contact-form enquiries ----

/** One page of leads, newest first, with the total and per-stage counts. Null if the website is unavailable. */
export async function websiteLeads(stage: LeadStage | null, page: number): Promise<{ leads: Lead[]; total: number; counts: Partial<Record<LeadStage, number>> } | null> {
  const db = websiteDb();
  if (!db) return null;
  const [list, counts] = await Promise.all([
    db.rpc('panel_contact_enquiries', { p_status: stage, p_limit: LEADS_PAGE_SIZE, p_offset: (page - 1) * LEADS_PAGE_SIZE }),
    db.rpc('panel_contact_enquiry_counts'),
  ]);
  if (list.error || counts.error) {
    console.error('websiteLeads failed:', list.error?.code ?? counts.error?.code);
    return null;
  }
  const rows = (list.data ?? []) as (Lead & { total: number })[];
  const byStage: Partial<Record<LeadStage, number>> = {};
  for (const row of (counts.data ?? []) as { status: string; total: number }[]) if (isLeadStage(row.status)) byStage[row.status] = Number(row.total);
  return { leads: rows, total: Number(rows[0]?.total ?? 0), counts: byStage };
}

/** Moves a lead to a stage. False if it failed or the lead is gone. */
export async function setWebsiteLeadStage(id: string, stage: LeadStage, adminEmail: string): Promise<boolean> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(id) || !isLeadStage(stage)) return false;
  const { data, error } = await db.rpc('panel_set_enquiry_stage', { p_id: id, p_status: stage, p_admin_email: adminEmail });
  if (error) {
    console.error('setWebsiteLeadStage failed:', error.code);
    return false;
  }
  return data === true;
}

/** Saves corrected lead details (already checked by cleanLeadEdit). False if it failed or the lead is gone. */
export async function updateWebsiteLead(id: string, v: { name: string; email: string; phone: string | null; city: string | null; role: string | null; best_time: string | null; timeline: string | null; message: string }, adminEmail: string): Promise<boolean> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(id)) return false;
  const { data, error } = await db.rpc('panel_update_enquiry', {
    p_id: id, p_name: v.name, p_email: v.email, p_phone: v.phone, p_city: v.city, p_role: v.role,
    p_best_time: v.best_time, p_timeline: v.timeline, p_message: v.message, p_admin_email: adminEmail,
  });
  if (error) {
    console.error('updateWebsiteLead failed:', error.code);
    return false;
  }
  return data === true;
}

/** Deletes a lead and its timeline. False if it failed or the lead was already gone. */
export async function deleteWebsiteLead(id: string): Promise<boolean> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(id)) return false;
  const { data, error } = await db.rpc('panel_delete_enquiry', { p_id: id });
  if (error) {
    console.error('deleteWebsiteLead failed:', error.code);
    return false;
  }
  return data === true;
}

/** A lead's timeline, oldest first. Null if it couldn't be loaded. */
export async function websiteLeadTimeline(id: string): Promise<LeadEvent[] | null> {
  const db = websiteDb();
  if (!db || !WEBSITE_UUID.test(id)) return null;
  const { data, error } = await db.rpc('panel_enquiry_timeline', { p_id: id });
  if (error) {
    console.error('websiteLeadTimeline failed:', error.code);
    return null;
  }
  return (data ?? []) as LeadEvent[];
}
