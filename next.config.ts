import type { NextConfig } from "next";

// NOTE: Content-Security-Policy is intentionally NOT set here. It is emitted
// per-request with a fresh nonce by src/proxy.ts (nonce-based, no 'unsafe-inline'
// /'unsafe-eval' for scripts). A second static CSP header here would make the
// browser apply the INTERSECTION of both and strip the nonce — breaking scripts.
// proxy.ts is the single source of truth for CSP.

// Production domain of the "rotarydhuleconnect" zone (a separate Next.js app that
// uses basePath '/rotarydhuleconnect'). We proxy that zone under our own domain.
const ROTARY_ZONE = 'https://custom-templete-palate.vercel.app';

// One app serves both admin panels, each under its own prefix: /lms-admin/... and /lab-admin/...
// (app/[panel]/..., src/lib/appPanel.ts). The prefix must match the signed `panel` claim of the
// session token — enforced in src/proxy.ts and app/[panel]/layout.tsx.
const PANEL = ':panel(lms-admin|lab-admin)';

const nextConfig: NextConfig = {
  // Remove X-Powered-By: Next.js header — prevents tech stack fingerprinting
  poweredByHeader: false,
  // Keep the dev-only Next.js badge off the sidebar's bottom-left buttons.
  devIndicators: { position: 'bottom-right' },
  // Multi-zone proxy. These MUST be `beforeFiles` so they run before this app's
  // own `_next/static` filesystem handler — otherwise `/rotarydhuleconnect/_next/*`
  // asset requests get swallowed here (404) instead of proxying to the zone, which
  // strips all CSS/JS from the proxied pages.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/siddeshcomputers',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect/siddeshcomputers`,
        },
        {
          source: '/rotarydhuleconnect',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect`,
        },
        {
          source: '/rotarydhuleconnect/:path+',
          destination: `${ROTARY_ZONE}/rotarydhuleconnect/:path+`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      // Neutral entry point for the universal login; after sign-in the proxy moves each admin
      // to their own panel's prefix.
      { source: '/admin', destination: '/lms-admin', permanent: false },
      // The Data page was renamed Accounts: old links and bookmarks keep working.
      { source: `/${PANEL}/data`, destination: '/:panel/accounts', permanent: true },
      { source: `/${PANEL}/data/:path*`, destination: '/:panel/accounts/:path*', permanent: true },
      { source: `/${PANEL}/schools`, destination: '/:panel/accounts?tab=schools', permanent: true },
      { source: `/${PANEL}/vendors`, destination: '/:panel/accounts?tab=vendors', permanent: true },
      { source: `/${PANEL}/parents`, destination: '/:panel/accounts?tab=parents', permanent: true },
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
