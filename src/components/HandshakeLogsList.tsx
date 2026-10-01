'use client';

import React, { useState } from 'react';
import FormModal from './FormModal';
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
      <div className="overflow-x-auto px-[15px] py-2.5">
      <table className="data-table data-table-rich min-w-[860px]">
        <thead>
          <tr>
            <th>Activation Key</th>
            <th>Device</th>
            <th>IP Address</th>
            <th>Time</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan={5} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500 text-sm">
                No cryptographic handshakes recorded yet. Try activating a tablet!
              </td>
            </tr>
          ) : (
            logs.map((item) => {
              const isSuccess = item.status === 'SUCCESS';
              const StatusIcon = isSuccess ? Lock : ShieldAlert;

              const statusBadge = (
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border font-semibold ${
                    isSuccess ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/25' : 'text-rose-500 bg-rose-500/10 border-rose-500/25'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {isSuccess ? 'Active' : 'Failed'}
                </span>
              );

              return (
                <tr key={item.id} onClick={() => setSelectedLog(item)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-8 h-8 shrink-0 rounded-[10px] border flex items-center justify-center ${
                        isSuccess ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500' : 'bg-rose-500/10 border-rose-500/25 text-rose-500'
                      }`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                      </span>
                      <span className="cell-strong cell-mono truncate">{item.activationKey}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-strong">{item.deviceModel || '—'}</div>
                    {item.deviceOS && <div className="cell-sub">{item.deviceOS}</div>}
                  </td>
                  <td className="cell-mono cell-muted">{item.ipAddress || '—'}</td>
                  <td className="cell-muted cell-num">{formatDateTime(item.time)}</td>
                  <td className="text-right">{statusBadge}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {/* Modal Overlay */}
    {selectedLog && (
      <FormModal
        open
        onClose={() => setSelectedLog(null)}
        panelClassName="glass relative w-full max-w-4xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden animate-slide-up"
      >
          {/* Modal Header */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-10 h-10 shrink-0 rounded-[10px] flex items-center justify-center border ${
                selectedLog.status === 'SUCCESS' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
              }`}>
                {selectedLog.status === 'SUCCESS' ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground tracking-tight">Handshake details</h3>
                <p className="text-xs text-zinc-500 font-medium truncate font-mono">{selectedLog.activationKey}</p>
              </div>
            </div>
            <button type="button" onClick={() => setSelectedLog(null)} className="icon-btn shrink-0" aria-label="Close" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="px-6 py-5 overflow-y-auto">
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
                    <span className="block text-sm font-semibold text-foreground">Device & Network</span>
                    <span className="block text-xs text-zinc-500">Hardware reported at handshake</span>
                  </div>
                </div>
                <div className="divide-y divide-white/5">
                  <DetailRow icon={Laptop} label="Device Model">
                    <span className="text-[13px] font-semibold text-foreground">{selectedLog.deviceModel}</span>
                  </DetailRow>
                  <DetailRow icon={Monitor} label="OS Version">
                    <span className="text-[13px] font-semibold text-foreground">{selectedLog.deviceOS}</span>
                  </DetailRow>
                  <DetailRow icon={Globe} label="IP Address">
                    <span className="text-[13px] font-semibold text-foreground">{selectedLog.ipAddress}</span>
                  </DetailRow>
                  <DetailRow icon={Clock} label="Monitored Time">
                    <span className="text-[13px] font-semibold text-foreground">{formatDateTime(selectedLog.time)}</span>
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
                    <span className="block text-sm font-semibold text-foreground">Security Payload</span>
                    <span className="block text-xs text-zinc-500">Signed license handshake</span>
                  </div>
                </div>
                <div className="divide-y divide-white/5">
                  <DetailRow icon={KeyRound} label="License Alg">
                    <span className="text-[13px] font-semibold text-foreground">ES256 · ECDSA</span>
                  </DetailRow>
                  <DetailRow icon={Fingerprint} label="Fingerprint">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-foreground font-mono whitespace-nowrap">
                        {selectedLog.deviceFingerprint || 'N/A'}
                      </span>
                      {selectedLog.deviceFingerprint && <CopyButton value={selectedLog.deviceFingerprint} />}
                    </div>
                  </DetailRow>
                  <DetailRow icon={BadgeCheck} label="Activation">
                    <span className={`text-[13px] font-semibold ${selectedLog.status === 'SUCCESS' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {selectedLog.status}
                    </span>
                  </DetailRow>
                  <DetailRow icon={Hash} label="Handshake ID">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-foreground font-mono whitespace-nowrap">{selectedLog.id}</span>
                      <CopyButton value={selectedLog.id} />
                    </div>
                  </DetailRow>
                </div>
              </div>
            </div>
          </div>
      </FormModal>
    )}
  </>
  );
}
