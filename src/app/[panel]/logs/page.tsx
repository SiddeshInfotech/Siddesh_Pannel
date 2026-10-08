import React from 'react';
import { getAdminSession } from '@/lib/auth';
import LogsClient from './LogsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Data is loaded through RBAC-checked server actions (./actions.ts), never embedded here,
// so a user without a Logs role receives nothing but the "no access" message.
export default async function LogsPage() {
  const session = await getAdminSession();
  if (!session) return null;
  return <LogsClient />;
}
