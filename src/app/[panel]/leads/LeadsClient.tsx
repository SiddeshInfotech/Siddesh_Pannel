'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Edit2, Eye, History, Mail, MessageCircle, Phone, Trash2, Users, XCircle } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CustomSelect from '@/components/CustomSelect';
import GlassCard from '@/components/GlassCard';
import PanelLink from '@/components/PanelLink';
import { useToast } from '@/components/Toast';
import { LEAD_STAGES, type Lead, type LeadStage } from '@/lib/leads';
import { deleteLeadAction, setLeadStageAction } from './actions';
import { LeadEditModal, LeadTimelineModal } from './LeadModals';

import ScrollableTabs from '@/components/ScrollableTabs';
import StatChips from '@/components/StatChips';
const STAGES = Object.entries(LEAD_STAGES) as [LeadStage, string][];
// Discussion, Win and Lose have no tab: Won and Lost are in the counts at the top.
const TAB_STAGES = STAGES.filter(([key]) => key === 'new' || key === 'contacted' || key === 'call' || key === 'email');
const STAGE_OPTIONS = STAGES.map(([value, label]) => ({ value, label }));

// '+919876543210' → '+91 98765 43210'
const showNumber = (e164: string) => e164.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const LINK = 'text-zinc-500 hover:text-zinc-200 transition-colors';
const leadId = (n: number) => `ENQ${String(n).padStart(4, '0')}`;

type Data = { leads: Lead[]; total: number; counts: Partial<Record<LeadStage, number>> } | null;

export default function LeadsClient({ data, stage, page, pages }: { data: Data; stage: LeadStage | null; page: number; pages: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [timelineFor, setTimelineFor] = useState<Lead | null>(null);
  const all = Object.values(data?.counts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
  const href = (s: LeadStage | null, p = 1) => `/leads?${new URLSearchParams({ ...(s ? { stage: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  const move = (lead: Lead, next: string) => {
    if (next === lead.status) return;
    setBusy(lead.id);
    startTransition(async () => {
      const result = await setLeadStageAction(lead.id, next);
      setBusy(null);
      if (!result.ok) return toast(result.error, 'error');
      toast(`${leadId(lead.ref_no)} moved to ${LEAD_STAGES[next as LeadStage]}.`, 'success');
      router.refresh();
    });
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteLeadAction(deleting.id);
    if (!result.ok) return toast(result.error, 'error');
    toast(`${leadId(deleting.ref_no)} deleted.`, 'success');
    setDeleting(null);
    router.refresh();
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto relative">

      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center gap-4">
          <h2 className="shrink-0 text-2xl font-bold text-foreground">Leads</h2>
          <StatChips>
            <span className="stat-chip"><Users className="w-3.5 h-3.5 text-accent-violet" /> All leads <span className="stat-chip-value">{all}</span></span>
            <span className="stat-chip"><Eye className="w-3.5 h-3.5 text-amber-500" /> To view <span className="stat-chip-value">{data?.counts.new ?? 0}</span></span>
            <span className="stat-chip"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Won <span className="stat-chip-value">{data?.counts.won ?? 0}</span></span>
            <span className="stat-chip"><XCircle className="w-3.5 h-3.5 text-rose-500" /> Lost <span className="stat-chip-value">{data?.counts.lost ?? 0}</span></span>
          </StatChips>
        </div>

        <div className="flex items-end gap-0 w-full border-b border-sidebar-border">
          <ScrollableTabs className="-mb-[1px] flex-1">
            <PanelLink href={href(null)} className={`filter-tab ${stage === null ? 'filter-tab-active' : ''}`}>
              All <span className="filter-tab-count">{all}</span>
            </PanelLink>
            {TAB_STAGES.map(([key, label]) => (
              <PanelLink key={key} href={href(key)} className={`filter-tab ${stage === key ? 'filter-tab-active' : ''}`}>
                {label} <span className="filter-tab-count">{data?.counts[key] ?? 0}</span>
              </PanelLink>
            ))}
          </ScrollableTabs>
        </div>
      </div>

      {/* Not overflow-hidden: the stage menu opens below its row. */}
      <GlassCard className="!p-0">
        <div className="overflow-x-auto lg:overflow-visible px-[15px] py-2.5">
          <table className="data-table data-table-rich">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Contact</th>
                <th>Person</th>
                <th>Enquiry</th>
                <th>Raised</th>
                <th>Stage</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.leads ?? []).map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <span className="block cell-strong">{lead.name}</span>
                    <span className="block cell-sub cell-mono">{leadId(lead.ref_no)}</span>
                  </td>
                  <td>
                    {lead.phone && (
                      <span className="flex items-center gap-2">
                        <span className="cell-mono">{showNumber(lead.phone)}</span>
                        <a href={`tel:${lead.phone}`} className={LINK} title="Call" aria-label={`Call ${lead.phone}`}><Phone className="w-3.5 h-3.5" /></a>
                        <a href={`https://wa.me/${lead.phone.replace(/^\+/, '')}`} target="_blank" rel="noopener noreferrer" className={LINK} title="Open WhatsApp chat" aria-label={`Open WhatsApp chat with ${lead.phone}`}>
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      </span>
                    )}
                    <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 cell-sub hover:text-zinc-200" title="Send email">
                      <Mail className="w-3 h-3 shrink-0" />{lead.email}
                    </a>
                    {lead.best_time && <span className="block cell-sub">Call: {lead.best_time}</span>}
                  </td>
                  <td>
                    <span className="block">{lead.role ?? '—'}</span>
                    <span className="block cell-sub">{[lead.city, lead.student_count && `${lead.student_count} students`, lead.class_range].filter(Boolean).join(' · ') || '—'}</span>
                  </td>
                  <td className="!whitespace-normal">
                    <span className="block">{lead.product ?? '—'}</span>
                    {lead.timeline && <span className="block cell-sub">Starting {lead.timeline}</span>}
                    {lead.message && <span className="block cell-sub line-clamp-2" title={lead.message}>{lead.message}</span>}
                  </td>
                  <td><span className="cell-sub">{when(lead.created_at)}</span></td>
                  <td>
                    <div className={`w-32 ${busy !== null ? 'pointer-events-none opacity-60' : ''}`}>
                      <CustomSelect size="sm" value={lead.status} onChange={(next) => move(lead, next)} options={STAGE_OPTIONS} />
                    </div>
                    {lead.updated_at && <span className="block cell-sub" title={lead.panel_updated_by ?? undefined}>{busy === lead.id ? 'Saving…' : when(lead.updated_at)}</span>}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setEditing(lead)} className="icon-btn" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => setTimelineFor(lead)} className="icon-btn" title="Timeline"><History className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => setDeleting(lead)} className="icon-btn icon-btn-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {(data === null || data.leads.length === 0) && (
                <tr>
                  <td colSpan={7} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
                    {data === null ? 'Could not load leads from the website. Try again in a minute.' : 'No leads here yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {editing && <LeadEditModal key={editing.id} lead={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
      {timelineFor && <LeadTimelineModal key={timelineFor.id} lead={timelineFor} onClose={() => setTimelineFor(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete lead?"
        body={deleting && <p>{leadId(deleting.ref_no)} · {deleting.name} and its timeline will be removed. This can&apos;t be undone.</p>}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-zinc-400">
          {page > 1 && <PanelLink href={href(stage, page - 1)} className="btn btn-secondary !h-8 !px-3 !text-xs">Previous</PanelLink>}
          <span>Page {page} of {pages}</span>
          {page < pages && <PanelLink href={href(stage, page + 1)} className="btn btn-secondary !h-8 !px-3 !text-xs">Next</PanelLink>}
        </div>
      )}
    </div>
  );
}
