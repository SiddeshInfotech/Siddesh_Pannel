/**
 * GET /api/auth/status
 * Returns 200 if the admin_token cookie is valid, 401 otherwise.
 * Used by AuthWrapper to determine if user is authenticated.
 * The actual JWT validation happens in middleware.ts, so if this
 * route is reached with a valid token, middleware already passed.
 */

import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    user: { email: session.email, role: session.role },
  });
}
