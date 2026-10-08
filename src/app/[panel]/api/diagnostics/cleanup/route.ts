import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runCleanup } from '@/lib/diagnostics/cleanup';
import { diagDb, loadRetention } from '@/lib/diagnostics/server';

// GET /api/diagnostics/cleanup — scheduled lifecycle worker (Vercel Cron, hourly).
// Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this automatically).
// Honors each panel's configured cleanupEveryMinutes by skipping if the last run is too recent.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const out: Record<string, unknown> = {};
  for (const panel of ['lms', 'lab'] as const) {
    const cfg = await loadRetention(panel);
    const { data: last } = await diagDb().from('diag_cleanup_runs').select('started_at').eq('panel', panel).order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.started_at) < (cfg.cleanupEveryMinutes - 5) * 60_000) { out[panel] = 'skipped'; continue; }
    out[panel] = await runCleanup(panel);
  }
  return NextResponse.json(out);
}
