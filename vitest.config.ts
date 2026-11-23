import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js resolves this package to a build-time client-import error. Unit tests run
      // entirely in Node, so map it to a harmless empty module without weakening production.
      'server-only': path.resolve(__dirname, './src/test/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    // Dummy values only — real Supabase calls are always mocked (vi.doMock) in tests
    // that need them. This just satisfies @/lib/supabase's module-load-time env check
    // for any test that transitively imports it (e.g. attestationTelemetry.ts).
    env: {
      SUPABASE_URL: 'https://test.invalid',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  },
});
