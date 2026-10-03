'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { Terminal, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import GlassCard from './GlassCard';
import HandshakeLogsList from './HandshakeLogsList';
import { getHandshakeLogs } from '@/app/[panel]/actions';

export default function DashboardTabs() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalLogsCount, setTotalLogsCount] = useState(0);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await getHandshakeLogs(1, 10, search);
          setLogs(result.logs);
          setTotalLogsCount(result.totalCount);
          setPage(1); // Reset to page 1 on new search
        } catch (err) {
          console.error('Failed to fetch initial handshake logs:', err);
        }
      });
    }, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [search]);

  const limit = 10;
  const totalPages = Math.ceil(totalLogsCount / limit);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;

    startTransition(async () => {
      try {
        const result = await getHandshakeLogs(newPage, limit, search);
        setLogs(result.logs);
        setPage(result.currentPage);
        setTotalLogsCount(result.totalCount);
      } catch (err) {
        console.error('Failed to fetch handshake logs:', err);
      }
    });
  };

  const showingFrom = totalLogsCount === 0 ? 0 : (page - 1) * limit + 1;
  const showingTo = Math.min(page * limit, totalLogsCount);

  return (
    <div className="space-y-4">
      {/* Filter bar — same underlined-tab bar as the other pages; search on the right. */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
        <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
          <span className="filter-tab filter-tab-active !cursor-default">
            <Terminal className="w-3.5 h-3.5" />
            Handshake audit logs
            <span className="filter-tab-count">{totalLogsCount}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
          {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-violet shrink-0" />}
          <div className="relative flex-1 xl:w-[260px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys…"
              className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <HandshakeLogsList logs={logs} />

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-3 border-t border-sidebar-border text-xs font-medium text-zinc-500">
            <div>
              Showing <span className="font-semibold text-foreground">{showingFrom}–{showingTo}</span> of{' '}
              <span className="font-semibold text-foreground">{totalLogsCount}</span> logs
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isPending}
                className="icon-btn"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="stat-chip">
                Page <span className="stat-chip-value">{page}</span> of <span className="stat-chip-value">{totalPages}</span>
              </span>
              <button
                type="button"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages || isPending}
                className="icon-btn"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
