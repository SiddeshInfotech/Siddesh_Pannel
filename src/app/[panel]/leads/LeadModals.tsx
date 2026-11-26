'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import CustomSelect from '@/components/CustomSelect';
import FormModal from '@/components/FormModal';
import { FORM_INPUT_CLASS, FORM_SAVE_BUTTON_CLASS } from '@/components/forms/FormHeader';
import { useToast } from '@/components/Toast';
import {
  LEAD_BEST_TIMES, LEAD_ROLES, LEAD_STAGES, LEAD_TIMELINES, type Lead, type LeadEdit, type LeadEvent, type LeadStage,
} from '@/lib/leads';
import { leadTimelineAction, updateLeadAction } from './actions';

const PANEL = 'glass-interactive w-full max-w-lg max-h-[90vh] overflow-y-auto relative animate-slide-up rounded-2xl p-5';
const LABEL = 'text-xs font-semibold text-zinc-300';
const CANCEL = 'px-5 py-2.5 bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl hover:bg-white/10 transition-all cursor-pointer';
const opts = (list: readonly string[]) => [{ value: '', label: '—' }, ...list.map((v) => ({ value: v, label: v }))];
const stageLabel = (s: string | null) => (s && s in LEAD_STAGES ? LEAD_STAGES[s as LeadStage] : s ?? '—');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// Mounted with key={lead.id}, so the form starts from that lead's details.
export function LeadEditModal({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<LeadEdit>({
    name: lead.name, email: lead.email, phone: lead.phone?.replace(/^\+91/, '') ?? '', city: lead.city ?? '',
    role: lead.role ?? '', best_time: lead.best_time ?? '', timeline: lead.timeline ?? '', message: lead.message ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof LeadEdit, string>>>({});
  const [saving, startSaving] = useTransition();

  const set = (k: keyof LeadEdit) => (v: string) => setForm({ ...form, [k]: v });
  const field = (k: keyof LeadEdit, label: string, input: ReactNode) => (
    <div className="space-y-1.5">
      <label className={LABEL}>{label}</label>
      {input}
      {errors[k] && <p className="text-[11px] text-rose-400">{errors[k]}</p>}
    </div>
  );
  const text = (k: keyof LeadEdit, max: number, type = 'text') => (
    <input type={type} value={form[k]} maxLength={max} onChange={(e) => set(k)(e.target.value)} className={FORM_INPUT_CLASS} />
  );

  const save = () => startSaving(async () => {
    const result = await updateLeadAction(lead.id, form);
    if (!result.ok) return toast(result.error, 'error');
    if (result.data.errors) return setErrors(result.data.errors);
    toast('Lead updated.', 'success');
    onSaved();
  });

  return (
    <FormModal open onClose={onClose} panelClassName={PANEL}>
      <div className="space-y-4">
        <h3 className="text-base font-bold text-foreground">Edit lead</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          {field('name', 'Name', text('name', 200))}
          {field('email', 'Email', text('email', 254, 'email'))}
          {field('phone', 'WhatsApp number', text('phone', 16, 'tel'))}
          {field('city', 'City', text('city', 100))}
          {field('role', 'Person', <CustomSelect size="sm" value={form.role} onChange={set('role')} options={opts(LEAD_ROLES)} />)}
          {field('best_time', 'Time to call', <CustomSelect size="sm" value={form.best_time} onChange={set('best_time')} options={opts(LEAD_BEST_TIMES)} />)}
          {field('timeline', 'Looking to start', <CustomSelect size="sm" value={form.timeline} onChange={set('timeline')} options={opts(LEAD_TIMELINES)} />)}
        </div>
        {field('message', 'Note', (
          <textarea rows={3} value={form.message} maxLength={5000} onChange={(e) => set('message')(e.target.value)} className={FORM_INPUT_CLASS} />
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={CANCEL} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_SAVE_BUTTON_CLASS} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </FormModal>
  );
}

// Mounted with key={lead.id}, so each lead loads its own timeline.
export function LeadTimelineModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [events, setEvents] = useState<LeadEvent[] | null | 'error'>(null);

  useEffect(() => {
    let live = true;
    leadTimelineAction(lead.id).then((r) => live && setEvents(r.ok ? r.data : 'error'));
    return () => { live = false; };
  }, [lead.id]);

  const describe = (e: LeadEvent) =>
    e.kind === 'created' ? 'Enquiry raised on the website'
      : e.kind === 'edited' ? 'Details edited'
        : `${stageLabel(e.from_status)} → ${stageLabel(e.to_status)}`;

  return (
    <FormModal open onClose={onClose} panelClassName={PANEL}>
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-bold text-foreground">Timeline</h3>
          <p className="text-xs text-zinc-500">{lead.name}</p>
        </div>
        {events === null && <p className="text-xs text-zinc-500">Loading…</p>}
        {events === 'error' && <p className="text-xs text-rose-400">Could not load the timeline. Try again in a minute.</p>}
        {Array.isArray(events) && (
          <ol className="relative border-l border-sidebar-border ml-1.5 space-y-4">
            {events.map((e, i) => (
              <li key={i} className="pl-4 relative">
                <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${i === events.length - 1 ? 'bg-accent-violet' : 'bg-zinc-600'}`} />
                <p className="text-xs font-semibold text-foreground">{describe(e)}</p>
                <p className="text-[11px] text-zinc-500">{when(e.at)}{e.by_email ? ` · ${e.by_email}` : ''}</p>
              </li>
            ))}
          </ol>
        )}
        <div className="flex justify-end">
          <button type="button" className={CANCEL} onClick={onClose}>Close</button>
        </div>
      </div>
    </FormModal>
  );
}
