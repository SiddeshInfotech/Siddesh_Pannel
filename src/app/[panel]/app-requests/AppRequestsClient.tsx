'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, Mail, MessageCircle, MonitorDown } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import GlassCard from '@/components/GlassCard';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import type { WindowsAppRequest } from '@/lib/websiteDb';
import { markAppRequestSentAction } from './actions';
import TableScroll from '@/components/TableScroll';

import ScrollableTabs from '@/components/ScrollableTabs';
import StatChips from '@/components/StatChips';
// '+919876543210' → '+91 98765 43210'
const showNumber = (e164: string) => e164.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const LINK = 'text-zinc-500 hover:text-zinc-200 transition-colors';

// Over 24 hours old and still waiting: the buyer was promised the app by now.
const overdue = (r: WindowsAppRequest) => r.status === 'pending' && Date.now() - Date.parse(r.requested_at) > 86_400_000;

type Tab = 'all' | 'pending' | 'sent';
const TABS: [Tab, string][] = [['all', 'All'], ['pending', 'Waiting'], ['sent', 'Sent']];

export default function AppRequestsClient({ requests }: { requests: WindowsAppRequest[] | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<WindowsAppRequest | null>(null);
  const [, startTransition] = useTransition();

  const list = requests ?? [];
  const count = (t: Tab) => (t === 'all' ? list.length : list.filter((r) => r.status === t).length);
  const shown = tab === 'all' ? list : list.filter((r) => r.status === tab);

  const markSent = async () => {
    const r = confirming;
    if (!r) return;
    setBusy(r.user_id);
    startTransition(async () => {
      const result = await markAppRequestSentAction(r.user_id);
      setBusy(null);
      setConfirming(null);
      if (!result.ok) return toast(result.error, 'error');
      toast(result.data.already ? 'This request was already marked sent.' : 'Marked as sent.', 'success');
      router.refresh();
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.', 'success');
    } catch {
      toast('Could not copy.', 'error');
    }
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto relative">

      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center gap-4">
          <h2 className="shrink-0 text-2xl font-bold text-foreground">App requests</h2>
          <StatChips>
            <span className="stat-chip"><MonitorDown className="w-3.5 h-3.5 text-accent-violet" /> All requests <span className="stat-chip-value">{count('all')}</span></span>
            <span className="stat-chip"><Clock className="w-3.5 h-3.5 text-amber-500" /> Waiting <span className="stat-chip-value">{count('pending')}</span></span>
            <span className="stat-chip"><AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> Over 24h <span className="stat-chip-value">{list.filter(overdue).length}</span></span>
            <span className="stat-chip"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Sent <span className="stat-chip-value">{count('sent')}</span></span>
          </StatChips>
        </div>

        <div className="flex items-end gap-0 w-full border-b border-sidebar-border">
          <ScrollableTabs className="-mb-[1px] flex-1">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`filter-tab ${tab === key ? 'filter-tab-active' : ''}`}>
                {label} <span className="filter-tab-count">{count(key)}</span>
              </button>
            ))}
          </ScrollableTabs>
        </div>
      </div>

      <GlassCard className="!p-0">
        <TableScroll>
          <table className="data-table data-table-rich">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>WhatsApp</th>
                <th>Order</th>
                <th>Requested</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    <span className="block cell-strong">{r.full_name || r.email.split('@')[0]}</span>
                    <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 cell-sub hover:text-zinc-200" title="Send email">
                      <Mail className="w-3 h-3 shrink-0" />{r.email}
                    </a>
                  </td>
                  <td>
                    {r.whatsapp ? (
                      <span className="flex items-center gap-2">
                        <span className="cell-mono">{showNumber(r.whatsapp)}</span>
                        <button type="button" className={LINK} onClick={() => copy(r.whatsapp!)} title="Copy number" aria-label={`Copy ${r.whatsapp}`}>
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <a href={`https://wa.me/${r.whatsapp.replace(/^\+/, '')}`} target="_blank" rel="noopener noreferrer" className={LINK} title="Open WhatsApp chat" aria-label={`Open WhatsApp chat with ${r.whatsapp}`}>
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      </span>
                    ) : (
                      <span className="cell-sub text-rose-400">No WhatsApp number</span>
                    )}
                  </td>
                  <td><span className="cell-mono cell-sub">{r.order_id.slice(0, 8).toUpperCase()}</span></td>
                  <td>
                    <span className={`block cell-sub ${overdue(r) ? '!text-rose-400' : ''}`}>{when(r.requested_at)}</span>
                    {overdue(r) && <span className="block cell-sub !text-rose-400">Over 24 hours</span>}
                  </td>
                  <td>
                    <StatusBadge status={r.status === 'pending' ? 'Pending' : 'COMPLETED'} />
                    {r.status === 'sent' && <span className="block cell-sub" title={r.sent_by ?? undefined}>{when(r.sent_at)}</span>}
                  </td>
                  <td className="text-right">
                    {r.status === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => setConfirming(r)}
                        disabled={busy !== null}
                        className="icon-btn ml-auto"
                        title="Mark sent"
                        aria-label={`Mark the app sent to ${r.full_name || r.email}`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="cell-sub">Done</span>
                    )}
                  </td>
                </tr>
              ))}
              {(requests === null || shown.length === 0) && (
                <tr>
                  <td colSpan={6} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
                    {requests === null ? 'Could not load requests from the website. Try again in a minute.' : 'No requests here.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </GlassCard>

      <ConfirmDialog
        open={confirming !== null}
        title="Mark as sent?"
        body={confirming && <p>Mark the Windows app as sent to {confirming.full_name || confirming.email}.</p>}
        confirmLabel="Mark sent"
        onConfirm={markSent}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
