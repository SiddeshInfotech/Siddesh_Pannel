// ============================================================================
// Which admin panel THIS running app serves. The same code runs as two separate apps:
//   - LMS-Admin: default (ADMIN_PANEL unset)  → served under /lms-admin
//   - Lab-Admin: ADMIN_PANEL=lab              → served under /lab-admin
// Each app has its own login cookie, so an LMS-Admin and a Lab-Admin session live side by side
// in one browser and never replace each other. next.config.ts inlines NEXT_PUBLIC_ADMIN_PANEL
// at build/dev time, so this is identical on the server, in the proxy and in the browser.
// Safe to import from client components (no server-only imports).
// ============================================================================

export type AppPanel = 'lms' | 'lab';

export const APP_PANEL: AppPanel = process.env.NEXT_PUBLIC_ADMIN_PANEL === 'lab' ? 'lab' : 'lms';

/** URL prefix of this app (Next.js basePath). */
export const BASE_PATH = APP_PANEL === 'lab' ? '/lab-admin' : '/lms-admin';
