import { NextRequest, NextResponse } from 'next/server';
import { getActivity } from '../../../health/actions';

// GET /<panel>/api/ops/activity?window=24h|7d|…&product=<id>
// Read-only twin of the getActivity server action, so it loads in parallel with the overview
// (see ../overview/route.ts). getActivity runs its own OPS_VIEW + rate-limit checks.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const window = q.get('window')?.slice(0, 8) || '24h';
  const product = q.get('product')?.slice(0, 100) || null;
  return NextResponse.json(await getActivity(window, product), { headers: { 'Cache-Control': 'no-store' } });
}
