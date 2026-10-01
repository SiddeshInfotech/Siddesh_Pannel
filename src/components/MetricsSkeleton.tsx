import React from 'react';

/** Placeholder for the Overview metric chips while they stream in. */
export default function MetricsSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {[132, 116, 156].map((w) => (
        <div key={w} style={{ width: w }} className="skeleton h-8 !rounded-[10px]" />
      ))}
    </div>
  );
}
