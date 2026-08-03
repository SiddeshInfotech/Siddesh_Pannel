import React from 'react';
import GlassCard from './GlassCard';

interface MetricCardProps {
  title: string;
  value: string;
  badgeText: string;
  badgeType: 'positive' | 'stable' | 'warning' | 'neutral';
  icon: React.ComponentType<{ className?: string }>;
  sparklineType?: 'bars' | 'wave' | 'progress' | 'none';
  progress?: number; // 0 to 100
}

export default function MetricCard({
  title,
  value,
  badgeText,
  badgeType,
  icon: Icon,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sparklineType = 'none',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  progress,
}: MetricCardProps) {
  const getBadgeStyles = () => {
    switch (badgeType) {
      case 'positive':
        return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
      case 'stable':
        return 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20';
      case 'warning':
        return 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
      default:
        return 'text-zinc-400 bg-zinc-500/10 border border-zinc-500/20';
    }
  };

  return (
    <GlassCard className="relative overflow-hidden flex flex-col justify-between p-5 border border-white/5 backdrop-blur-xl">
      {/* Header Info */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{title}</p>
          <h3 className="text-3xl font-extrabold text-white mt-2 tracking-tight">{value}</h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="p-2 rounded-xl bg-white/5 border border-white/10">
            <Icon className="w-4 h-4 text-zinc-300" />
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getBadgeStyles()}`}>
            {badgeText}
          </span>
        </div>
      </div>
    </GlassCard>
  );
}
