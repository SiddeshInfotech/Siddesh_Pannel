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

      {/* Metrics Row streaming via Suspense */}
      <Suspense fallback={<MetricsSkeleton />}>
        <DashboardMetrics />
      </Suspense>

      {/* Grid Content Layout using Lazy Loaded Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-12">
          <DashboardTabs />
        </div>
      </div>
    </div>
  );
}
