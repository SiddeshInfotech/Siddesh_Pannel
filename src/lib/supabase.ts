import { createClient } from '@supabase/supabase-js';

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
