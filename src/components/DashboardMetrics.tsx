import React from 'react';
import { School, Key, CreditCard } from 'lucide-react';
import MetricCard from './MetricCard';
import MetricGroup from './MetricGroup';
import { getDashboardMetrics } from '@/app/actions';

export default async function DashboardMetrics() {
  const metrics = await getDashboardMetrics();

  return (

    <div className="space-y-6">

      <MetricGroup className="grid-cols-1 md:grid-cols-3">
        <MetricCard
          title="Total Schools"
          value={metrics.totalSchools.toString()}
          icon={School}
        />
        <MetricCard
          title="Active Keys"
          value={metrics.activeKeys.toString()}
          icon={Key}
        />
        <MetricCard
          title="Pending Payments"
          value={metrics.pendingPayments.toString()}
          icon={CreditCard}
        />
      </MetricGroup>
    </div>
  );
}
