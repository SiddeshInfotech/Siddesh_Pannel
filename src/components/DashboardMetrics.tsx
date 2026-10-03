import React from 'react';
import { School, Key, CreditCard } from 'lucide-react';
import { getDashboardMetrics } from '@/app/[panel]/actions';

export default async function DashboardMetrics() {
  const metrics = await getDashboardMetrics();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="stat-chip"><School className="w-3.5 h-3.5 text-sky-500" /> Total schools <span className="stat-chip-value">{metrics.totalSchools}</span></span>
      <span className="stat-chip"><Key className="w-3.5 h-3.5 text-emerald-500" /> Active keys <span className="stat-chip-value">{metrics.activeKeys}</span></span>
      <span className={`stat-chip ${metrics.pendingPayments > 0 ? '!text-amber-600 !border-amber-500/40' : ''}`}>
        <CreditCard className="w-3.5 h-3.5 text-amber-500" /> Pending payments
        <span className="stat-chip-value">{metrics.pendingPayments}</span>
      </span>
    </div>
  );
}
