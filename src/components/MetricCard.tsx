import React from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  caption?: string;
  sparklineType?: 'bars' | 'wave' | 'progress' | 'none';
  progress?: number; // 0 to 100
}

export default function MetricCard({
  title,
  value,
  icon: Icon,
  caption,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sparklineType = 'none',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  progress,
}: MetricCardProps) {
  return (
    // One row: icon + title (optional caption under it) on the left, the number on the right.
    <div className="metric-card flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className="metric-icon shrink-0">
          <Icon className="w-4 h-4 text-foreground" />
        </span>
        <div className="min-w-0 flex flex-col items-start gap-1">
          <span className="text-[13px] font-semibold text-foreground truncate max-w-full">{title}</span>
          {caption && <span className="text-[10px] text-zinc-500">{caption}</span>}
        </div>
      </div>

      <h3 className="text-3xl font-bold text-foreground tracking-tight leading-none shrink-0">{value}</h3>
    </div>
  );
}
