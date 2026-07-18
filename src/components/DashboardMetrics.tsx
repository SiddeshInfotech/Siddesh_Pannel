import React from 'react';
import { School, Key, CreditCard } from 'lucide-react';
import MetricCard from './MetricCard';
import { getDashboardMetrics } from '@/app/actions';

export default async function DashboardMetrics() {
  const metrics = await getDashboardMetrics();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <MetricCard
        title="Total Schools"
        value={metrics.totalSchools.toString()}
        badgeText="Live"
        badgeType="positive"
        icon={School}
      />
      <MetricCard
        title="Active Keys"
        value={metrics.activeKeys.toString()}
        badgeText="Active"
        badgeType="stable"
        icon={Key}
      />
      <MetricCard
        title="Pending Payments"
        value={metrics.pendingPayments.toString()}
        badgeText="Pending"
        badgeType="warning"
        icon={CreditCard}
      />
    </div>
  );
}
