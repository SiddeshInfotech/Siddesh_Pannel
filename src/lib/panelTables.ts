// ============================================================================
// Admin panel split — LMS-Admin (School products) vs Lab-Admin (the 5 LMS-Lab products).
//
// Both panels run the SAME code against the SAME database, but every business table is
// separate: Lab-Admin reads/writes `lab_<table>` (lab-admin-schema.sql). Which panel a
// request belongs to comes from:
//   - admin pages / server actions → the signed-in admin's `panel` (admin_users.panel, carried
//     in the session JWT) — see adminDb();
//   - device endpoints (activate / ping / terms-accept) → the device's product family.
// Admin accounts and sessions (admin_users, admin_sessions) stay shared.
// ============================================================================

import { supabaseAdmin } from './supabase';
import { familyFor, isProductId } from './productIdentity';

export type Panel = 'lms' | 'lab';

export const PANEL_TABLES = [
  'activation_keys', 'schools', 'vendors', 'parents', 'payments', 'device_status',
  'device_timeline', 'handshake_logs', 'terms_acceptances', 'revoked_device_bindings',
  'device_daily_online',
] as const;
export type PanelTable = (typeof PANEL_TABLES)[number];

export function isPanel(value: unknown): value is Panel {
  return value === 'lms' || value === 'lab';
}

/** Physical table name of [table] for [panel]. */
export function tableFor(panel: Panel, table: PanelTable): string {
  return panel === 'lab' ? `lab_${table}` : table;
}

/** Panel a device product belongs to: lab products → Lab-Admin, everything else → LMS-Admin. */
export function panelForProduct(productId: string | null | undefined): Panel {
  return isProductId(productId) && familyFor(productId) === 'lab' ? 'lab' : 'lms';
}

// Embedded selects like `schools ( name )` name the related table. On the Lab panel they must
// read lab_schools etc. — aliased back (`schools:lab_schools ( name )`) so every row keeps the
// same shape and no page needs to know which panel it runs in.
const EMBEDDED_TABLE = /\b(schools|vendors|parents|activation_keys)\s*\(/g;

export function labEmbeds(columns: string): string {
  return columns.replace(EMBEDDED_TABLE, (_, t: string) => `${t}:lab_${t} (`);
}

/** Supabase access scoped to one panel's tables. */
export function panelDb(panel: Panel) {
  return {
    panel,
    from: (table: PanelTable) => {
      const query = supabaseAdmin.from(tableFor(panel, table));
      if (panel === 'lab') {
        const select = query.select.bind(query);
        query.select = ((columns?: string, options?: Parameters<typeof select>[1]) =>
          select(columns === undefined ? columns : labEmbeds(columns), options)) as typeof query.select;
      }
      return query;
    },
  };
}

/**
 * Panel-scoped DB for the signed-in admin. Throws when there is no valid admin token so a
 * query can never silently fall back to the wrong panel's tables (callers check the session
 * with getAdminSession() first — this does not replace that check).
 */
export async function adminDb() {
  const { getAdminPanel } = await import('./auth');
  const panel = await getAdminPanel();
  if (!panel) throw new Error('adminDb: no admin session');
  return panelDb(panel);
}
