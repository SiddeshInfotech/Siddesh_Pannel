'use client';

import React, { useState } from 'react';
import FormModal from './FormModal';

/**
 * Styled replacement for window.confirm / window.prompt (built on FormModal: portal, Esc,
 * click-outside). Optional note field and "type X to confirm" guard for destructive actions.
 */
export default function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', danger = false, noteLabel, typeToConfirm, onConfirm, onClose,
}: {
  open: boolean; title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean;
  noteLabel?: string; typeToConfirm?: string;
  onConfirm: (note: string) => void | Promise<void>; onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = busy || (!!typeToConfirm && typed.trim().toUpperCase() !== typeToConfirm.toUpperCase());
  const close = () => { setNote(''); setTyped(''); onClose(); };
  return (
    <FormModal open={open} onClose={close} panelClassName="glass-interactive w-full max-w-md relative animate-slide-up rounded-2xl p-5">
      <div className="space-y-3 text-sm">
        <h3 className={`text-base font-bold ${danger ? 'text-rose-400' : 'text-foreground'}`}>{title}</h3>
        {body && <div className="text-xs text-zinc-400 space-y-1">{body}</div>}
        {noteLabel && <textarea autoFocus rows={3} className="w-full rounded-lg border border-sidebar-border bg-transparent px-3 py-2 text-xs text-foreground outline-none focus:border-accent-violet" placeholder={noteLabel} value={note} onChange={(e) => setNote(e.target.value)} />}
        {typeToConfirm && <label className="block text-xs text-zinc-400">Type <b className="font-mono text-foreground">{typeToConfirm}</b> to confirm<input autoFocus className="mt-1 block w-full rounded-lg border border-sidebar-border bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-rose-400" placeholder={typeToConfirm} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="filter-tab" onClick={close}>Cancel</button>
          <button type="button" disabled={blocked} className={`filter-tab ${danger ? 'text-rose-400' : 'filter-tab-active'} disabled:opacity-40`}
            onClick={async () => { setBusy(true); try { await onConfirm(note); close(); } finally { setBusy(false); } }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
