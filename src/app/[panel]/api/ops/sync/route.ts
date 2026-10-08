import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { evaluateRules, loadOps, opsRetention, rollup, syncProviders } from '@/lib/ops/engine';

// GET /api/ops/sync — scheduled Operations Center worker (Vercel Cron daily 21:30 UTC = 03:00 IST, Bearer CRON_SECRET).
// Provider sync (each provider honours its own sync_minutes), hourly/daily rollups,
// alert-rule evaluation, retention. Dashboards never call providers directly.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby limit; each step is bounded and failures are isolated per panel

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const out: Record<string, string> = {};
  try { await syncProviders(); out.providers = 'ok'; } catch { out.providers = 'failed'; }
  for (const panel of ['lms', 'lab'] as const) {
    try {
      const cfg = await loadOps(panel);
      await rollup(panel, cfg);
      await evaluateRules(panel, cfg);
      await opsRetention(panel, cfg);
      out[panel] = 'ok';
    } catch { out[panel] = 'failed'; }
  }
  return NextResponse.json(out);
}
