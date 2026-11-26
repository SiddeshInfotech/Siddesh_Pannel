'use client';

import React, { useCallback, useEffect, useRef } from 'react';

const GAP = 8; // px between chips when they fit
const MIN_VISIBLE = 34; // px of each covered chip that stays visible (its icon)

/**
 * Row of `.stat-chip`s. When the chips don't fit the available width they overlap like a
 * stacked deck (later chips on top, the last one fully visible) instead of wrapping to a new
 * line. Hovering or focusing a covered chip lifts it to the top so it can be read.
 */
export default function StatChips({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const layout = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const chips = Array.from(el.children) as HTMLElement[];
    if (chips.length < 2) return;
    const widths = chips.map((c) => c.offsetWidth);
    const natural = widths.reduce((a, b) => a + b, 0) + GAP * (chips.length - 1);
    const stacked = natural > el.clientWidth;
    // Every covered chip shows the same sliver, so the deck steps evenly; the last chip is whole.
    const sliver = Math.max(MIN_VISIBLE, (el.clientWidth - widths[widths.length - 1]) / (chips.length - 1));
    el.dataset.stacked = stacked ? 'true' : 'false';
    // Even the tightest deck doesn't fit: start from the left so the first chip isn't cut off.
    el.dataset.cramped = stacked && sliver === MIN_VISIBLE ? 'true' : 'false';
    chips.forEach((c, i) => {
      c.style.marginLeft = i === 0 ? '0px' : `${stacked ? Math.min(GAP, sliver - widths[i - 1]) : GAP}px`;
      c.style.zIndex = String(i + 1);
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    // Counts load in after first paint and change chip widths.
    const mo = new MutationObserver(layout);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [layout]);

  return (
    <div ref={ref} className={`stat-chips ${className}`}>
      {children}
    </div>
  );
}
