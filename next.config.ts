import type { NextConfig } from "next";

// NOTE: Content-Security-Policy is intentionally NOT set here. It is emitted
// per-request with a fresh nonce by src/proxy.ts (nonce-based, no 'unsafe-inline'
// /'unsafe-eval' for scripts). A second static CSP header here would make the
// browser apply the INTERSECTION of both and strip the nonce — breaking scripts.
// proxy.ts is the single source of truth for CSP.

// Production domain of the "rotarydhuleconnect" zone (a separate Next.js app that
// uses basePath '/rotarydhuleconnect'). We proxy that zone under our own domain.
const ROTARY_ZONE = 'https://custom-templete-palate.vercel.app';

// One app serves both admin panels under /lms-admin (src/lib/appPanel.ts). Which panel a
// signed-in admin sees — LMS-Admin or Lab-Admin — comes from the signed `panel` claim in their
// session token, decided at login by which login table holds their email.
const BASE_PATH = '/lms-admin';

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  // Remove X-Powered-By: Next.js header — prevents tech stack fingerprinting
  poweredByHeader: false,
  // Keep the dev-only Next.js badge off the sidebar's bottom-left buttons.
  devIndicators: { position: 'bottom-right' },
  // Multi-zone proxy. These MUST be `beforeFiles` so they run before this app's
  // own `_next/static` filesystem handler — otherwise `/rotarydhuleconnect/_next/*`
  // asset requests get swallowed here (404) instead of proxying to the zone, which
  // strips all CSS/JS from the proxied pages. `basePath: false` opts these paths out
  // of the '/lms-admin' prefix so they match at the domain root.
  async rewrites() {
    return {
      beforeFiles: [
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
      // Lab-Admin no longer has its own app: its admins sign in at the universal /lms-admin login.
      { source: '/lab-admin', destination: '/lms-admin', basePath: false, permanent: false },
      { source: '/lab-admin/:path*', destination: '/lms-admin', basePath: false, permanent: false },
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
