import React from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  badgeText: string;
  badgeType: 'positive' | 'stable' | 'warning' | 'neutral';
  icon: React.ComponentType<{ className?: string }>;
  caption?: string;
  sparklineType?: 'bars' | 'wave' | 'progress' | 'none';
  progress?: number; // 0 to 100
}

export default function MetricCard({
  title,
  value,
  badgeText,
  badgeType,
  icon: Icon,
  caption,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sparklineType = 'none',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  progress,
}: MetricCardProps) {
  const getBadgeStyles = () => {
    switch (badgeType) {
      case 'positive':
        return 'text-emerald-500 bg-emerald-500/10';
      case 'stable':
        return 'text-indigo-500 bg-indigo-500/10';
      case 'warning':
        return 'text-amber-500 bg-amber-500/10';
      default:
        return 'text-zinc-500 bg-zinc-500/10';
    }
  };

  return (
    <div className="metric-card flex flex-col gap-3">
      {/* Header: icon box + title */}
      <div className="flex items-center gap-3">
        <span className="metric-icon">
          <Icon className="w-4 h-4 text-foreground" />
        </span>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
      </div>

      {/* Value + badge on one row */}
      <div className="flex items-end justify-between gap-2">
        <h3 className="text-3xl font-bold text-foreground tracking-tight leading-none">{value}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${getBadgeStyles()}`}>
          {badgeText}
        </span>
      </div>

      {caption && <span className="text-[10px] text-zinc-500">{caption}</span>}
    </div>
  );
}
