'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/**
 * "i" button that explains what a section / metric / action does. Opens on hover or click,
 * closes on Esc / click outside. Rendered in a portal with fixed positioning so tables with
 * overflow and transformed ancestors can't clip it.
 */
export default function InfoTip({ text, className = '' }: { text: React.ReactNode; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = 300;
    setPos({ x: Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)), y: r.bottom + 6 });
  };
  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !btn.current?.contains(e.target as Node)) { setPinned(false); setPos(null); } };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); };
  }, [pinned]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="What is this?"
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-zinc-500 hover:text-sky-400 align-middle cursor-help ${className}`}
        onMouseEnter={show}
        onMouseLeave={() => { if (!pinned) setPos(null); }}
        onClick={(e) => { e.stopPropagation(); show(); setPinned((p) => !p); }}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {pos && typeof document !== 'undefined' && createPortal(
        <div role="tooltip" style={{ left: pos.x, top: pos.y, width: 300 }}
          className="fixed z-[70] rounded-xl border border-sidebar-border bg-surface-hover shadow-xl p-3 text-xs leading-relaxed text-foreground font-normal normal-case tracking-normal whitespace-normal animate-fade-in">
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
