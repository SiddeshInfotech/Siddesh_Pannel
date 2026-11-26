'use strict';

import React, { Suspense } from 'react';
import { getAdminSession } from '@/lib/auth';
import DashboardMetrics from '@/components/DashboardMetrics';
import MetricsSkeleton from '@/components/MetricsSkeleton';
import DashboardTabs from '@/components/DashboardTabs';

export default async function DashboardPage() {
  const session = await getAdminSession();
  if (!session) return null;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">

      <div className="flex justify-between items-center gap-4 pb-2">
        <h2 className="shrink-0 text-2xl font-bold text-foreground">Overview</h2>
        {/* Metric chips stream in via Suspense */}
        <Suspense fallback={<MetricsSkeleton />}>
          <DashboardMetrics />
        </Suspense>
      </div>

      <DashboardTabs />
    </div>
  );
}
