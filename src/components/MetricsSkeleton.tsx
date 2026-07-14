import React from 'react';

export default function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {[1, 2, 3].map((i) => (
        <div 
          key={i} 
          className="relative overflow-hidden rounded-[24px] border border-white/5 bg-black/[0.02] dark:bg-white/[0.02] p-6 shadow-sm"
        >
          <div className="flex justify-between items-start mb-6">
            <div className="h-4 w-24 bg-black/10 dark:bg-white/10 rounded-md animate-pulse" />
            <div className="h-8 w-8 bg-black/5 dark:bg-white/5 rounded-xl animate-pulse" />
          </div>
          <div className="flex items-end justify-between">
            <div className="h-10 w-20 bg-black/10 dark:bg-white/10 rounded-lg animate-pulse" />
            <div className="h-6 w-16 bg-black/5 dark:bg-white/5 rounded-full animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
