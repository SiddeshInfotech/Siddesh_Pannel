'use client';

import React, { useState, useTransition } from 'react';
import { Terminal, School, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import GlassCard from './GlassCard';
import HandshakeLogsList from './HandshakeLogsList';
import StatusBadge from './StatusBadge';
import { getHandshakeLogs, getLiveSchoolsFeed } from '@/app/actions';

export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<'logs' | 'schools'>('logs');
  const [logs, setLogs] = useState<any[]>([]);
  const [liveFeed, setLiveFeed] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalLogsCount, setTotalLogsCount] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Lazy load data when tabs change
  React.useEffect(() => {
    startTransition(async () => {
      if (activeTab === 'logs' && logs.length === 0) {
        try {
          const result = await getHandshakeLogs(1, 10);
          setLogs(result.logs);
          setTotalLogsCount(result.totalCount);
        } catch (err) {
          console.error('Failed to fetch initial handshake logs:', err);
        }
      } else if (activeTab === 'schools' && liveFeed.length === 0) {
        try {
          const feed = await getLiveSchoolsFeed();
          setLiveFeed(feed);
        } catch (err) {
          console.error('Failed to fetch live feed:', err);
        }
      }
    });
  }, [activeTab]);

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
    <div className="space-y-6">
      {/* Tabs Header */}
      <div className="flex gap-8 px-2 tab-header-border">
        <button
          onClick={() => setActiveTab('logs')}
          className={`pt-2 pb-4 px-4 rounded-t-xl text-sm font-bold transition-all relative tab-button-hover ${
            activeTab === 'logs' 
              ? 'active-tab-text' 
              : 'inactive-tab-text'
          }`}
        >
          Cryptographic Handshake Audit Logs
          {activeTab === 'logs' && (
            <div className="absolute bottom-[-1px] left-4 right-4 h-[1.5px] active-tab-line" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('schools')}
          className={`pt-2 pb-4 px-4 rounded-t-xl text-sm font-bold transition-all relative tab-button-hover ${
            activeTab === 'schools' 
              ? 'active-tab-text' 
              : 'inactive-tab-text'
          }`}
        >
          Registered Schools
          {activeTab === 'schools' && (
            <div className="absolute bottom-[-1px] left-4 right-4 h-[1.5px] active-tab-line" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="transition-all duration-300">
        {activeTab === 'logs' ? (
          <GlassCard className="bg-black/5 dark:bg-[#121216]/40 !border-0 shadow-none space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-bold text-black dark:text-white tracking-tight flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[#8b5cf6]" />
                Audit Logs
              </h3>
              {isPending && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-violet" />
                  Loading...
                </div>
              )}
            </div>
            <div className="space-y-4">
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
        ) : (
          <GlassCard className="bg-black/5 dark:bg-[#121216]/40 !border-0 shadow-none">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-black dark:text-white tracking-tight flex items-center gap-2">
                <School className="w-5 h-5 text-gray-500 dark:text-zinc-400" />
                Schools Overview
              </h3>
            </div>
            <div className="space-y-4">
              {isPending && liveFeed.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-accent-violet" />
                </div>
              ) : liveFeed.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No active schools found.</div>
              ) : (
                liveFeed.map((item) => (
                <div 
                  key={item.id} 
                  className="flex items-center justify-between p-4 bg-black/[0.02] dark:bg-white/[0.02] border border-card-border rounded-2xl hover:border-black/10 dark:hover:border-white/10 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-500 dark:text-zinc-400">
                      <School className="w-5 h-5 text-gray-500 dark:text-zinc-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-black dark:text-white">{item.school}</h4>
                      <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{item.details}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[11px] text-gray-500 dark:text-zinc-500 font-medium">
                      {item.time !== 'Recently' && !isNaN(new Date(item.time).getTime()) 
                        ? new Date(item.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) 
                        : item.time}
                    </span>
                    <StatusBadge status={item.status as any} />
                  </div>
                </div>
              )))}
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
