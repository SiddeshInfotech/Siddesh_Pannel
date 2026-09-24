'use client';

import React, { useState } from 'react';
import {
  Lock,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
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
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 text-right">{children}</div>
    </div>
  );
}

export default function HandshakeLogsList({ logs }: HandshakeLogsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-2.5">
      {logs.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          No cryptographic handshakes recorded yet. Try activating a tablet!
        </div>
      ) : (
        logs.map((item) => {
          const isExpanded = expandedId === item.id;
          const isSuccess = item.status === 'SUCCESS';
          const formattedTime = formatDateTime(item.time);
          const StatusIcon = isSuccess ? Lock : ShieldAlert;

          const keyPart = (
            <div className="flex items-center gap-3 min-w-0">
              <span className="metric-icon">
                <StatusIcon className="w-4 h-4 text-foreground" />
              </span>
              <span className="text-[13px] font-semibold text-white font-mono truncate">{item.activationKey}</span>
            </div>
          );
          const statusPart = (
            <div className="flex items-center gap-3 shrink-0">
              <span
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md font-semibold ${
                  isSuccess ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                {isSuccess ? 'Active' : 'Failed'}
              </span>
              <span className={`log-chevron ${isExpanded ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-3.5 h-3.5" />
              </span>
            </div>
          );
          const toggle = () => toggleExpand(item.id);

          return (
            <div key={item.id} className={`log-row ${isExpanded ? 'is-open' : ''}`}>
              {/* Collapsed header; when open, its halves move into the tops of the two detail cards */}
              {!isExpanded && (
                <div
                  onClick={toggle}
                  className="px-3 py-3 flex items-center justify-between gap-4 cursor-pointer select-none"
                >
                  {keyPart}
                  {statusPart}
                </div>
              )}

              {/* Expandable details, animated via grid rows */}
              <div
                className={`grid transition-all duration-300 ease-in-out ${
                  isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="log-details">
                    {item.errorMessage && (
                      <div className="md:col-span-2 text-xs bg-rose-500/10 text-rose-500 px-3 py-2 rounded-xl flex items-center gap-2 font-medium">
                        <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{item.errorMessage}</span>
                      </div>
                    )}

                    {/* Device & network */}
                    <div className="metric-card">
                      <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                        <span className="metric-icon">
                          <Cpu className="w-4 h-4 text-accent-violet" />
                        </span>
                        <div className="min-w-0">
                          <span className="block text-[11px] font-semibold text-foreground">Device & Network</span>
                          <span className="block text-[10px] text-zinc-500">Hardware reported at handshake</span>
                        </div>
                        <span
                          onClick={toggle}
                          className="ml-auto text-[13px] font-semibold text-white font-mono truncate cursor-pointer select-none"
                        >
                          {item.activationKey}
                        </span>
                      </div>
                      <div className="divide-y divide-white/5">
                        <DetailRow icon={Laptop} label="Device Model">
                          <span className="text-xs font-semibold text-white">{item.deviceModel}</span>
                        </DetailRow>
                        <DetailRow icon={Monitor} label="OS Version">
                          <span className="text-xs font-semibold text-white">{item.deviceOS}</span>
                        </DetailRow>
                        <DetailRow icon={Globe} label="IP Address">
                          <span className="text-xs font-semibold text-white">{item.ipAddress}</span>
                        </DetailRow>
                        <DetailRow icon={Clock} label="Monitored Time">
                          <span className="text-xs font-semibold text-white">{formattedTime}</span>
                        </DetailRow>
                      </div>
                    </div>

                    {/* Security payload */}
                    <div className="metric-card">
                      <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                        <span className="metric-icon">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        </span>
                        <div>
                          <span className="block text-[11px] font-semibold text-foreground">Security Payload</span>
                          <span className="block text-[10px] text-zinc-500">Signed license handshake</span>
                        </div>
                        <div onClick={toggle} className="ml-auto cursor-pointer select-none">
                          {statusPart}
                        </div>
                      </div>
                      <div className="divide-y divide-white/5">
                        <DetailRow icon={KeyRound} label="License Alg">
                          <span className="text-xs font-semibold text-white">ES256 · ECDSA</span>
                        </DetailRow>
                        <DetailRow icon={Fingerprint} label="Fingerprint">
                          <span className="text-[10px] font-semibold text-white font-mono break-all max-w-[220px]">
                            {item.deviceFingerprint || 'N/A'}
                          </span>
                          {item.deviceFingerprint && <CopyButton value={item.deviceFingerprint} />}
                        </DetailRow>
                        <DetailRow icon={BadgeCheck} label="Activation">
                          <span className="text-xs font-semibold text-white">
                            {item.status}
                          </span>
                        </DetailRow>
                        <DetailRow icon={Hash} label="Handshake ID">
                          <span className="text-xs font-semibold text-white font-mono truncate">{item.id}</span>
                          <CopyButton value={item.id} />
                        </DetailRow>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
