'use client';

import React from 'react';

// Mirrors the real page frame: title + count chips, underlined filter bar, table card.
export default function Loading() {
  return (
    <div className="space-y-4 max-w-7xl mx-auto w-full" aria-busy="true" aria-label="Loading">
      <div className="h-10" />

      {/* Title + count chips */}
      <div className="flex justify-between items-center flex-wrap gap-4 pb-2">
        <div className="skeleton h-8 w-56" />
        <div className="flex items-center gap-2">
          {[112, 96, 104, 120].map((w) => (
            <div key={w} style={{ width: w }} className="skeleton h-8 !rounded-[10px]" />
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-end justify-between gap-3 border-b border-sidebar-border pb-2">
        <div className="flex items-center gap-5">
          {[44, 56, 52, 60, 48].map((w, i) => (
            <div key={i} style={{ width: w }} className="skeleton h-3.5" />
          ))}
        </div>
        <div className="skeleton h-3.5 w-56" />
      </div>

      {/* Table card */}
      <div className="glass rounded-2xl px-4 py-2.5">
        <div className="skeleton h-11 !rounded-[10px] opacity-60" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 h-[52px] px-3 border-t border-sidebar-border first:border-t-0">
            <div className="flex items-center gap-2.5 w-[22%]">
              <div className="skeleton w-7 h-7 !rounded-full shrink-0" />
              <div className="skeleton h-3.5 flex-1" />
            </div>
            <div className="skeleton h-3 w-[18%]" />
            <div className="skeleton h-3 w-[14%]" />
            <div className="skeleton h-5 w-16 !rounded-md" />
            <div className="ml-auto flex gap-2">
              <div className="skeleton w-8 h-8 !rounded-[10px]" />
              <div className="skeleton w-8 h-8 !rounded-[10px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
