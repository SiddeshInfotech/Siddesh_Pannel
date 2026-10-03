// ============================================================================
// One app serves both admin panels, each under its own URL prefix:
//   LMS-Admin → /lms-admin/...      Lab-Admin → /lab-admin/...
// The prefix is for clarity (audit logs, bookmarks, support) and is ENFORCED, not trusted:
// src/proxy.ts and app/[panel]/layout.tsx only let a session into the prefix matching the signed
// `panel` claim of its token, and all data access still picks tables from that claim.
// Safe to import from client components (no server-only imports).
// ============================================================================

export type Panel = 'lms' | 'lab';
export type PanelSlug = 'lms-admin' | 'lab-admin';

export const PANEL_SLUG: Record<Panel, PanelSlug> = { lms: 'lms-admin', lab: 'lab-admin' };

/** Where the universal login lives (any panel prefix shows it; this is the canonical one). */
export const LOGIN_SLUG: PanelSlug = 'lms-admin';

/** 'lms-admin' → 'lms', 'lab-admin' → 'lab', anything else → null. */
export function panelFromSlug(slug: string | null | undefined): Panel | null {
  return slug === 'lms-admin' ? 'lms' : slug === 'lab-admin' ? 'lab' : null;
}

/** Prefix an in-panel path ('/keys', '/', '/accounts?tab=x') with a panel slug. */
export function panelPath(slug: PanelSlug, path: string): string {
  return `/${slug}${path === '/' ? '' : path}`;
}
