'use client';

import React, { useState } from 'react';
import {
  Lock,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Laptop,
  Monitor,
  Globe,
  Clock,
  KeyRound,
  Fingerprint,
  BadgeCheck,
  Hash,
  Copy,
  Check,
  X,
} from 'lucide-react';

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return timeStr;
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy'}
      className="log-copy-btn"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="flex items-center gap-2 text-[12px] text-zinc-500 shrink-0">
        <Icon className="w-4 h-4 text-zinc-400" />
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 text-right whitespace-nowrap overflow-x-auto">{children}</div>
    </div>
  );
}

export default function HandshakeLogsList({ logs }: HandshakeLogsListProps) {
  const [selectedLog, setSelectedLog] = useState<HandshakeLogItem | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th>Activation Key</th>
            <th className="text-right pr-6">Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan={2} className="text-center !py-10 text-zinc-500 text-sm">
                No cryptographic handshakes recorded yet. Try activating a tablet!
              </td>
            </tr>
          ) : (
            logs.map((item) => {
              const isSuccess = item.status === 'SUCCESS';
              const StatusIcon = isSuccess ? Lock : ShieldAlert;

              const statusBadge = (
                <span
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md font-semibold ${
                    isSuccess ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {isSuccess ? 'Active' : 'Failed'}
                </span>
              );

              return (
                <tr key={item.id} onClick={() => setSelectedLog(item)} className="cursor-pointer bg-surface-hover hover:bg-white/5 transition-colors">
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="metric-icon">
                        <StatusIcon className="w-4 h-4 text-foreground" />
                      </span>
                      <span className="text-[13px] font-semibold text-white font-mono truncate">{item.activationKey}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-4 pr-2">
                      {statusBadge}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {/* Modal Overlay */}
    {selectedLog && (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm animate-fade-in" 
        onClick={() => setSelectedLog(null)}
      >
        <div 
          className="glass-interactive w-full max-w-6xl max-h-[90vh] overflow-y-auto relative animate-slide-up rounded-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-5 border-b border-white/5 sticky top-0 z-10 glass">
            <h3 className="text-base font-semibold text-white flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              Handshake Details
            </h3>
            <button 
              onClick={() => setSelectedLog(null)} 
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Modal Body */}
          <div className="p-6">
            {selectedLog.errorMessage && (
              <div className="mb-6 text-sm bg-rose-500/10 text-rose-500 px-4 py-3 rounded-xl flex items-center gap-3 font-medium">
                <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                <span>{selectedLog.errorMessage}</span>
              </div>
            )}

            <div className="grid lg:grid-cols-[2fr_3fr] gap-8">
              {/* Device & network */}
              <div>
                <div className="flex items-center gap-4 pb-4 border-b border-white/5 mb-2">
                  <div className="metric-icon flex items-center justify-center bg-violet-500/10 text-violet-500 border border-violet-500/20">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sm font-semibold text-white">Device & Network</span>
                    <span className="block text-xs text-zinc-500">Hardware reported at handshake</span>
                  </div>
                </div>
                <div className="divide-y divide-white/5">
                  <DetailRow icon={Laptop} label="Device Model">
                    <span className="text-[13px] font-semibold text-white">{selectedLog.deviceModel}</span>
                  </DetailRow>
                  <DetailRow icon={Monitor} label="OS Version">
                    <span className="text-[13px] font-semibold text-white">{selectedLog.deviceOS}</span>
                  </DetailRow>
                  <DetailRow icon={Globe} label="IP Address">
                    <span className="text-[13px] font-semibold text-white">{selectedLog.ipAddress}</span>
                  </DetailRow>
                  <DetailRow icon={Clock} label="Monitored Time">
                    <span className="text-[13px] font-semibold text-white">{formatDateTime(selectedLog.time)}</span>
                  </DetailRow>
                </div>
              </div>

              {/* Security payload */}
              <div>
                <div className="flex items-center gap-4 pb-4 border-b border-white/5 mb-2">
                  <div className="metric-icon flex items-center justify-center bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-sm font-semibold text-white">Security Payload</span>
                    <span className="block text-xs text-zinc-500">Signed license handshake</span>
                  </div>
                </div>
                <div className="divide-y divide-white/5">
                  <DetailRow icon={KeyRound} label="License Alg">
                    <span className="text-[13px] font-semibold text-white">ES256 · ECDSA</span>
                  </DetailRow>
                  <DetailRow icon={Fingerprint} label="Fingerprint">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-white font-mono whitespace-nowrap">
                        {selectedLog.deviceFingerprint || 'N/A'}
                      </span>
                      {selectedLog.deviceFingerprint && <CopyButton value={selectedLog.deviceFingerprint} />}
                    </div>
                  </DetailRow>
                  <DetailRow icon={BadgeCheck} label="Activation">
                    <span className="text-[13px] font-semibold text-emerald-500">
                      {selectedLog.status}
                    </span>
                  </DetailRow>
                  <DetailRow icon={Hash} label="Handshake ID">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-white font-mono whitespace-nowrap">{selectedLog.id}</span>
                      <CopyButton value={selectedLog.id} />
                    </div>
                  </DetailRow>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
