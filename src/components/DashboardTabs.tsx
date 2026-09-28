'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { Terminal, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import GlassCard from './GlassCard';
import HandshakeLogsList from './HandshakeLogsList';
import { getHandshakeLogs } from '@/app/actions';

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
    <GlassCard className="panel-group !p-0 flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 pt-5 pb-2">
        <div className="flex h-10 p-1 px-4 items-center gap-2 bg-surface-hover rounded-full w-fit">
          <Terminal className="w-4 h-4 text-foreground" />
          <span className="text-[13px] font-semibold text-foreground">Cryptographic Handshake Audit Logs</span>
        </div>

        <div className="flex items-center gap-3">
          {isPending && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-violet" />
            </div>
          )}
          <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
              <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search keys..."
                  className="field-input pl-9"
              />
          </div>
        </div>
      </div>
      <div className="px-6 pb-6 space-y-4">
        <HandshakeLogsList logs={logs} />

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/5 text-zinc-400 text-xs font-semibold">
            <div>
              Showing <span className="text-white">{showingFrom}</span> to{' '}
              <span className="text-white">{showingTo}</span> of{' '}
              <span className="text-white">{totalLogsCount}</span> logs
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isPending}
                className="p-2 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-all cursor-pointer flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-4 py-2 bg-[#121216]/60 border border-white/10 rounded-xl font-mono text-zinc-200">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages || isPending}
                className="p-2 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-all cursor-pointer flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
