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
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="h-10" />

      <div className="space-y-4">
        {/* Metrics Row streaming via Suspense */}
        <Suspense fallback={<MetricsSkeleton />}>
          <DashboardMetrics />
        </Suspense>

        <DashboardTabs />
      </div>
    </div>
  );
}
