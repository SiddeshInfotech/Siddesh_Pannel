'use client';

import React from 'react';
import { Shield } from 'lucide-react';

export default function Loading() {
  return (
    <div className="space-y-8 max-w-6xl mx-auto w-full animate-in fade-in duration-500">
      <div className="h-10" />

      {/* Header Skeleton */}
      <div className="flex items-center gap-4 px-1">
        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 animate-pulse flex items-center justify-center shadow-lg">
          <Shield className="w-5 h-5 text-accent-violet/40" />
        </div>
        <div className="space-y-2.5">
          <div className="h-6 w-48 bg-white/5 rounded-lg animate-pulse" />
          <div className="h-3 w-72 bg-white/5 rounded-md animate-pulse" />
        </div>
      </div>

      {/* Metrics Row Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-3xl bg-[#121216]/40 border border-white/5 p-6 flex flex-col justify-between animate-pulse relative overflow-hidden">
            {/* Shimmer effect */}
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.02] to-transparent animate-[shimmer_2s_infinite]" />
            
            <div className="flex justify-between items-start relative z-10">
              <div className="h-3 w-28 bg-white/10 rounded-md" />
              <div className="h-8 w-8 rounded-xl bg-white/5" />
            </div>
            <div className="h-10 w-20 bg-white/10 rounded-lg relative z-10" />
          </div>
        ))}
      </div>

      {/* Main Content Area Skeleton */}
      <div className="rounded-3xl bg-[#121216]/40 border border-white/5 p-6 space-y-6 animate-pulse relative overflow-hidden">
        {/* Shimmer effect */}
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.02] to-transparent animate-[shimmer_2s_infinite]" />
        
        {/* Tabs placeholder */}
        <div className="flex gap-4 border-b border-white/5 pb-4 relative z-10">
          <div className="h-9 w-32 bg-white/10 rounded-xl" />
          <div className="h-9 w-32 bg-white/5 rounded-xl" />
        </div>
        
        {/* List items placeholder */}
        <div className="space-y-4 relative z-10">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between py-3 px-4 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-white/10" />
                <div className="space-y-2.5">
                  <div className="h-4 w-56 bg-white/10 rounded-md" />
                  <div className="h-3 w-32 bg-white/5 rounded-md" />
                </div>
              </div>
              <div className="h-7 w-24 bg-white/5 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
