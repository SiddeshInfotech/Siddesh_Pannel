import type { NextConfig } from "next";

// NOTE: Content-Security-Policy is intentionally NOT set here. It is emitted
// per-request with a fresh nonce by src/proxy.ts (nonce-based, no 'unsafe-inline'
// /'unsafe-eval' for scripts). A second static CSP header here would make the
// browser apply the INTERSECTION of both and strip the nonce — breaking scripts.
// proxy.ts is the single source of truth for CSP.

// Production domain of the "rotarydhuleconnect" zone (a separate Next.js app that
// uses basePath '/rotarydhuleconnect'). We proxy that zone under our own domain.
const ROTARY_ZONE = 'https://custom-templete-palate.vercel.app';

// The same code runs as two separate apps (src/lib/appPanel.ts):
//   LMS-Admin — default          → basePath /lms-admin, build dir .next
//   Lab-Admin — ADMIN_PANEL=lab  → basePath /lab-admin, build dir .next-lab
// Separate build dirs let both dev servers run at once from this folder.
const ADMIN_PANEL = process.env.ADMIN_PANEL === 'lab' ? 'lab' : 'lms';
const BASE_PATH = ADMIN_PANEL === 'lab' ? '/lab-admin' : '/lms-admin';
// Where the Lab-Admin app runs. The LMS-Admin app forwards /lab-admin/* there, like the rotary
// zone below. Production: set LAB_ZONE_URL to the Lab-Admin Vercel URL. Local dev defaults to
// `npm run dev:lab` on port 3001.
const LAB_ZONE_URL = (
  process.env.LAB_ZONE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001')
).replace(/\/+$/, '');

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  distDir: ADMIN_PANEL === 'lab' ? '.next-lab' : '.next',
  env: { NEXT_PUBLIC_ADMIN_PANEL: ADMIN_PANEL },
  // Remove X-Powered-By: Next.js header — prevents tech stack fingerprinting
  poweredByHeader: false,
  // Multi-zone proxy. These MUST be `beforeFiles` so they run before this app's
  // own `_next/static` filesystem handler — otherwise `/rotarydhuleconnect/_next/*`
  // asset requests get swallowed here (404) instead of proxying to the zone, which
  // strips all CSS/JS from the proxied pages. `basePath: false` opts these paths out
  // of the '/lms-admin' prefix so they match at the domain root.
  async rewrites() {
    // Zone forwarding lives only in the LMS-Admin app (the one serving the domain).
    if (ADMIN_PANEL === 'lab') return { beforeFiles: [], afterFiles: [], fallback: [] };
    const labZone = LAB_ZONE_URL
      ? [
          { source: '/lab-admin', destination: `${LAB_ZONE_URL}/lab-admin`, basePath: false as const },
          { source: '/lab-admin/:path+', destination: `${LAB_ZONE_URL}/lab-admin/:path+`, basePath: false as const },
        ]
      : [];
    return {
      beforeFiles: [
        ...labZone,
        {
          source: '/siddeshcomputers',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect/siddeshcomputers`,
          basePath: false,
        },
        {
          source: '/rotarydhuleconnect',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect`,
          basePath: false,
        },
        {
          source: '/rotarydhuleconnect/:path+',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect/:path+`,
          basePath: false,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      // The Data page was renamed Accounts: old links and bookmarks keep working.
      { source: '/data', destination: '/accounts', permanent: true },
      { source: '/data/:path*', destination: '/accounts/:path*', permanent: true },
      { source: '/schools', destination: '/accounts?tab=schools', permanent: true },
      { source: '/vendors', destination: '/accounts?tab=vendors', permanent: true },
      { source: '/parents', destination: '/accounts?tab=parents', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
