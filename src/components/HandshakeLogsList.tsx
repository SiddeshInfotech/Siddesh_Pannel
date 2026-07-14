'use client';

import React, { useState } from 'react';
import { Lock, ShieldAlert, ChevronDown, ChevronUp, Cpu, Shield } from 'lucide-react';
import StatusBadge from './StatusBadge';

interface HandshakeLogItem {
  id: string;
  activationKey: string;
  deviceFingerprint: string;
  deviceModel: string;
  deviceOS: string;
  status: string;
  errorMessage: string;
  ipAddress: string;
  time: string;
}

interface HandshakeLogsListProps {
  logs: HandshakeLogItem[];
}

function formatDateTime(timeStr: string) {
  if (!timeStr || timeStr === 'Just now') return timeStr;
  try {
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return timeStr;
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return timeStr;
  }
}

export default function HandshakeLogsList({ logs }: HandshakeLogsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      {logs.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          No cryptographic handshakes recorded yet. Try activating a tablet!
        </div>
      ) : (
        logs.map((item) => {
          const isExpanded = expandedId === item.id;
          const formattedTime = formatDateTime(item.time);
          return (
            <div 
              key={item.id} 
              className={`border border-card-border rounded-2xl bg-black/[0.01] dark:bg-white/[0.01] hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all overflow-hidden ${
                isExpanded ? 'border-card-border bg-black/[0.03] dark:bg-white/[0.03]' : ''
              }`}
            >
              {/* Header Card (Clickable) */}
              <div 
                onClick={() => toggleExpand(item.id)}
                className="p-4 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-500 dark:text-zinc-400">
                    <Lock className="w-4 h-4 text-gray-500 dark:text-zinc-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-black dark:text-white font-mono">{item.activationKey}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-gray-500 dark:text-zinc-400 font-mono">
                        {(item.deviceFingerprint || '').slice(0, 10)}...
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                      {item.deviceModel} ({item.deviceOS})
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-gray-500 dark:text-zinc-500 font-medium">{formattedTime}</span>
                  <StatusBadge status={item.status === 'SUCCESS' ? 'Active' : 'Unpaid'} />
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500 dark:text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-gray-500 dark:text-zinc-400" />}
                </div>
              </div>

              {/* Expandable Details Panel */}
              {isExpanded && (
                <div className="px-6 pb-6 pt-2 border-t border-card-border bg-black/5 dark:bg-black/40 space-y-4 text-sm text-gray-600 dark:text-zinc-300">
                  {item.errorMessage && (
                    <div className="text-xs bg-rose-500/10 border border-rose-500/20 text-rose-400 px-3 py-2 rounded-xl flex items-center gap-2 font-medium">
                      <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{item.errorMessage}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Device & Connection Info */}
                    <div className="space-y-3 bg-black/[0.02] dark:bg-white/[0.02] p-4 rounded-xl border border-card-border">
                      <h4 className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-[#8b5cf6]" />
                        Device & Network Metadata
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between border-b border-black/5 dark:border-white/5 pb-1">
                          <span className="text-gray-500 dark:text-zinc-500">Device Model:</span>
                          <span className="font-semibold text-black dark:text-white">{item.deviceModel}</span>
                        </div>
                        <div className="flex justify-between border-b border-black/5 dark:border-white/5 pb-1">
                          <span className="text-gray-500 dark:text-zinc-500">OS Version:</span>
                          <span className="font-semibold text-black dark:text-white">{item.deviceOS}</span>
                        </div>
                        <div className="flex justify-between border-b border-black/5 dark:border-white/5 pb-1">
                          <span className="text-gray-500 dark:text-zinc-500">IP Address:</span>
                          <span className="font-semibold text-black dark:text-white font-mono">{item.ipAddress}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-zinc-500">Monitored Time:</span>
                          <span className="font-semibold text-black dark:text-white">{formattedTime}</span>
                        </div>
                      </div>
                    </div>

                    {/* Cryptographic Licensing Payload */}
                    <div className="space-y-3 bg-black/[0.02] dark:bg-white/[0.02] p-4 rounded-xl border border-card-border">
                      <h4 className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-emerald-500" />
                        Handshake Security Payload
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between border-b border-black/5 dark:border-white/5 pb-1">
                          <span className="text-gray-500 dark:text-zinc-500">License Alg:</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">ES256 (ECDSA)</span>
                        </div>
                        <div className="flex justify-between border-b border-black/5 dark:border-white/5 pb-1 flex-wrap">
                          <span className="text-gray-500 dark:text-zinc-500">Full Fingerprint:</span>
                          <span className="font-semibold text-black dark:text-white font-mono break-all text-[10px] text-right max-w-full md:max-w-[200px]">
                            {item.deviceFingerprint || 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-zinc-500">Activation Status:</span>
                          <span className={`font-semibold ${item.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Handshake ID:</span>
                          <span className="font-mono text-zinc-400 text-[10px]">{item.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
