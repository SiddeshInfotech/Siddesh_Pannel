import type { NextConfig } from "next";

// NOTE: Content-Security-Policy is intentionally NOT set here. It is emitted
// per-request with a fresh nonce by src/proxy.ts (nonce-based, no 'unsafe-inline'
// /'unsafe-eval' for scripts). A second static CSP header here would make the
// browser apply the INTERSECTION of both and strip the nonce — breaking scripts.
// proxy.ts is the single source of truth for CSP.

const nextConfig: NextConfig = {
  // Remove X-Powered-By: Next.js header — prevents tech stack fingerprinting
  poweredByHeader: false,
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
