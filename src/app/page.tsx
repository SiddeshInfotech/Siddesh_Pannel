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
      {/* Spacer to maintain layout height */}
      <div className="h-10" />

      <div className="flex justify-between items-center flex-wrap gap-4 pb-2">
        <h2 className="text-2xl font-bold text-foreground">Overview</h2>
        {/* Metric chips stream in via Suspense */}
        <Suspense fallback={<MetricsSkeleton />}>
          <DashboardMetrics />
        </Suspense>
      </div>

      <DashboardTabs />
    </div>
  );
}
