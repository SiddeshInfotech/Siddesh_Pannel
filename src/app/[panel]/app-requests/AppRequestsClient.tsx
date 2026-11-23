'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import EntityAvatar from '@/components/EntityAvatar';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import type { WindowsAppRequest } from '@/lib/websiteDb';
import { markAppRequestSentAction } from './actions';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Over 24 hours old and still waiting: the buyer was promised the app by now.
const overdue = (r: WindowsAppRequest) => r.status === 'pending' && Date.now() - Date.parse(r.requested_at) > 86_400_000;

export default function AppRequestsClient({ requests }: { requests: WindowsAppRequest[] | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const markSent = (r: WindowsAppRequest) => {
    if (!window.confirm(`Mark the Windows app as sent to ${r.full_name || r.email}?`)) return;
    setBusy(r.user_id);
    startTransition(async () => {
      const result = await markAppRequestSentAction(r.user_id);
      setBusy(null);
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
    <GlassCard className="overflow-hidden !p-0">
      <div className="overflow-x-auto px-[15px] py-2.5">
        <table className="data-table data-table-rich">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Contact</th>
              <th>Order</th>
              <th>Requested</th>
              <th>Status</th>
              <th className="num">Action</th>
            </tr>
          </thead>
          <tbody>
            {(requests ?? []).map((r) => (
              <tr key={r.user_id}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <EntityAvatar name={r.full_name || r.email} />
                    <span className="cell-strong">{r.full_name || r.email.split('@')[0]}</span>
                  </div>
                </td>
                <td>
                  <span className="flex items-center gap-1.5">
                    {r.email}
                    <button type="button" className="icon-btn" onClick={() => copy(r.email)} title="Copy email" aria-label={`Copy ${r.email}`}>
                      <Copy className="w-3 h-3" />
                    </button>
                  </span>
                  <span className="block cell-sub">{r.phone ?? 'No phone'}</span>
                </td>
                <td><span className="cell-mono cell-muted">{r.order_id.slice(0, 8).toUpperCase()}</span></td>
                <td>
                  <span className={`block ${overdue(r) ? 'text-red-400 font-medium' : ''}`}>{when(r.requested_at)}</span>
                  {overdue(r) && <span className="block cell-sub">Over 24 hours</span>}
                </td>
                <td>
                  <StatusBadge status={r.status === 'pending' ? 'Pending' : 'COMPLETED'} />
                  {r.status === 'sent' && <span className="block cell-sub" title={r.sent_by ?? undefined}>Sent {when(r.sent_at)}</span>}
                </td>
                <td className="num">
                  {r.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => markSent(r)}
                      disabled={busy !== null}
                      className="btn btn-secondary !h-8 !px-3 !text-xs whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {busy === r.user_id ? 'Saving…' : 'Mark sent'}
                    </button>
                  ) : (
                    <span className="cell-sub">Done</span>
                  )}
                </td>
              </tr>
            ))}
            {(requests === null || requests.length === 0) && (
              <tr>
                <td colSpan={6} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
                  {requests === null ? 'Could not load requests from the website. Try again in a minute.' : 'No app requests yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
