import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runCleanup } from '@/lib/diagnostics/cleanup';
import { loadRetention } from '@/lib/diagnostics/server';
import { col } from '@/lib/diagnostics/mongo';

// GET /api/diagnostics/cleanup — scheduled lifecycle worker (Vercel Cron, hourly).
// Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this automatically).
// Honors each panel's configured cleanupEveryMinutes by skipping if the last run is too recent.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby limit; work is bounded (≤200 issues, ≤1000 artifacts per run)

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
    const last = await (await col('diag_cleanup_runs')).find({ panel }, { projection: { started_at: 1 } }).sort({ started_at: -1 }).limit(1).next();
    if (last && Date.now() - new Date(last.started_at).getTime() < (cfg.cleanupEveryMinutes - 5) * 60_000) { out[panel] = 'skipped'; continue; }
    out[panel] = await runCleanup(panel);
  }
  return NextResponse.json(out);
}
