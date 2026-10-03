// ============================================================================
// One app serves both admin panels (LMS-Admin and Lab-Admin) under /lms-admin. The panel a
// request belongs to is NOT a build or URL setting: it is the signed `panel` claim of the
// admin's session token (src/lib/auth.ts — getAdminSession / getAdminPanel).
// Safe to import from client components (no server-only imports).
// ============================================================================

/** URL prefix of this app (Next.js basePath). */
export const BASE_PATH = '/lms-admin';
