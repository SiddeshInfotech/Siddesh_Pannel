// ============================================================================
// Admin panel split — LMS-Admin (existing products) vs Lab-Admin (the 5 LMS-Lab products).
//
// Both panels run the SAME code and database, but Lab-Admin uses its own lab_* tables (see
// supabaseFor in src/lib/supabase.ts): its own admin logins, keys, schools and devices, nothing
// shared with LMS-Admin's tables. Which table set a request uses comes from:
//   - admin pages / server actions → the signed-in admin's panel (carried in the session JWT,
//     decided by the login page used: /lms-admin or /lab-admin) — see adminDb();
//   - device endpoints (activate / ping / terms-accept) → the device's product (productIdentity.ts).
// ============================================================================

import { supabaseFor, type Panel } from './supabase';
import { isProductId, panelFor } from './productIdentity';

export type { Panel } from './supabase';

export type PanelTable =
  | 'activation_keys' | 'schools' | 'vendors' | 'parents' | 'payments' | 'device_status'
  | 'device_timeline' | 'handshake_logs' | 'terms_acceptances' | 'revoked_device_bindings'
  | 'device_daily_online';

export function isPanel(value: unknown): value is Panel {
  return value === 'lms' || value === 'lab';
}

/** Panel a device product belongs to: the 5 LMS-Lab products → Lab-Admin, the rest → LMS-Admin. */
export function panelForProduct(productId: string | null | undefined): Panel {
  return isProductId(productId) ? panelFor(productId) : 'lms';
}

/** Business-table access in [panel]'s database. */
export function panelDb(panel: Panel) {
  return {
    panel,
    from: (table: PanelTable) => supabaseFor(panel).from(table),
  };
}

/**
 * Panel-scoped DB for the signed-in admin. Throws when there is no valid admin token so a
 * query can never silently fall back to the wrong panel's database (callers check the session
 * with getAdminSession() first — this does not replace that check).
 */
export async function adminDb() {
  const { getAdminPanel } = await import('./auth');
  const panel = await getAdminPanel();
  if (!panel) throw new Error('adminDb: no admin session');
  return panelDb(panel);
}
