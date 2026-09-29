import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only: this module is never imported by a Client Component, so none of
// these need the NEXT_PUBLIC_ prefix. Keeping them unprefixed means NOTHING
// Supabase-related (not even the URL/anon key) is inlined into the browser
// bundle — least-exposure. The service_role key MUST never be NEXT_PUBLIC_.
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!supabaseAnonKey) throw new Error('Missing SUPABASE_ANON_KEY');

/**
 * Public anon client — read-only reference.
 * This panel doesn't expose any data to anonymous users.
 * All actual queries use supabaseAdmin below.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Admin client using service_role key.
 * ⛔ SERVER-SIDE ONLY — never import in Client Components.
 * ⛔ Never assign to a NEXT_PUBLIC_ variable.
 * Bypasses Row Level Security (RLS) — use only in:
 *   - API routes (route.ts)
 *   - Server Actions ('use server' files)
 *   - Server Components (async page.tsx)
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
  global: {
    fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' })
  }
});

/** Which admin panel a request belongs to: LMS-Admin or Lab-Admin. */
export type Panel = 'lms' | 'lab';

/** Table access for one panel — the only part of the client the panel code uses per panel. */
export type PanelClient = Pick<SupabaseClient, 'from'>;

// Embedded selects like `schools ( name )` name the related table. For Lab-Admin they must read
// lab_schools etc. — aliased back (`schools:lab_schools ( name )`) so rows keep the same shape.
const EMBEDDED_TABLE = /\b(schools|vendors|parents|activation_keys)\s*\(/g;

export function labEmbeds(columns: string): string {
  return columns.replace(EMBEDDED_TABLE, (_, t: string) => `${t}:lab_${t} (`);
}

/**
 * Lab-Admin lives in the SAME database but in its own `lab_*` tables (lab-admin-schema.sql):
 * its own admin logins (lab_admin_users / lab_admin_sessions / lab_security_events), keys,
 * schools and devices. Nothing is shared with LMS-Admin's tables.
 */
const labClient: PanelClient = {
  from: ((table: string) => {
    const query = supabaseAdmin.from(`lab_${table}`);
    const select = query.select.bind(query);
    query.select = ((columns?: string, options?: Parameters<typeof select>[1]) =>
      select(columns === undefined ? columns : labEmbeds(columns), options)) as typeof query.select;
    return query;
  }) as PanelClient['from'],
};

/** Table access for [panel]: LMS-Admin → the original tables, Lab-Admin → the lab_* tables. */
export function supabaseFor(panel: Panel): PanelClient {
  return panel === 'lab' ? labClient : supabaseAdmin;
}
