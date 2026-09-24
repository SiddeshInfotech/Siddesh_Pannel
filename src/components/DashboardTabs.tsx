'use client';

import React, { useState, useTransition } from 'react';
import { Terminal, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import GlassCard from './GlassCard';
import HandshakeLogsList from './HandshakeLogsList';
import { getHandshakeLogs } from '@/app/actions';

export default function DashboardTabs() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalLogsCount, setTotalLogsCount] = useState(0);
  const [isPending, startTransition] = useTransition();

  React.useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getHandshakeLogs(1, 10);
        setLogs(result.logs);
        setTotalLogsCount(result.totalCount);
      } catch (err) {
        console.error('Failed to fetch initial handshake logs:', err);
      }
    });
  }, []);

  const limit = 10;
  const totalPages = Math.ceil(totalLogsCount / limit);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;

    startTransition(async () => {
      try {
        const result = await getHandshakeLogs(newPage, limit);
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
    <GlassCard className="panel-group space-y-2.5">
      <div className="flex justify-between items-center">
        {/* panel-heading: icon flush with cards, 10px above and below like the card gap */}
        <h3 className="panel-heading text-xl font-bold text-white tracking-tight flex items-center gap-3">
          <span className="metric-icon">
            <Terminal className="w-5 h-5 text-foreground" />
          </span>
          Cryptographic Handshake Audit Logs
        </h3>
        {isPending && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-violet" />
            Loading...
          </div>
        )}
      </div>
      <div className="space-y-2.5">
        <HandshakeLogsList logs={logs} />
      </div>

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
    </GlassCard>
  );
}
