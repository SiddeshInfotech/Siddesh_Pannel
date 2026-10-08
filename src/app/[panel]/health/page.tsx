import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { productOptionsFor } from '@/lib/productIdentity';
import HealthClient from './HealthClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// All data flows through RBAC-checked server actions (./actions.ts); only the static product
// list for this panel is passed down.
export default async function HealthPage() {
  const session = await getAdminSession();
  if (!session) return null;
  return <HealthClient products={productOptionsFor(session.panel)} />;
}
