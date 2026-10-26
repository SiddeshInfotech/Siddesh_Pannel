import { NextRequest, NextResponse } from 'next/server';
import { getOverview } from '../../../health/actions';

// GET /<panel>/api/ops/overview?product=<id>
// Read-only twin of the getOverview server action. Server actions sent from the browser run one
// at a time; a GET lets the Overview and Activity panels load in parallel. Auth is unchanged: the
// proxy's admin-session gate covers /api/*, and getOverview runs its own OPS_VIEW + rate-limit checks.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get('product')?.slice(0, 100) || null;
  return NextResponse.json(await getOverview(product), { headers: { 'Cache-Control': 'no-store' } });
}
