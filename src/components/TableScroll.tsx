'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * Horizontal scroller for a data table. When the table is wider than its card, a small ‹ › pill
 * sits on the card's top edge at the right, so the hidden columns are easy to reach. Nothing shows
 * when the table fits. The card around it must not clip (no overflow-hidden), or the pill is cut.
 */
export default function TableScroll({ children, className = 'px-[15px] py-2.5' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fires once on observe, then whenever the card or the table changes size.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const scroll = (direction: -1 | 1) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.6, behavior: 'smooth' });
  // Solid colours (no see-through): active arrows in the text colour, turning violet on hover; the
  // arrow with nowhere to go is a quiet grey.
  const button = 'w-6 h-6 rounded-full flex items-center justify-center text-foreground hover:text-accent-violet hover:bg-accent-violet/10 transition-colors cursor-pointer disabled:text-zinc-500/60 disabled:bg-transparent disabled:cursor-default';

  return (
    <div className="relative">
      {(edges.left || edges.right) && (
        <div className="absolute right-[15px] top-0 -translate-y-1/2 z-20 flex items-center rounded-full border border-[var(--card-border)] bg-[var(--sidebar)] p-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
          <button type="button" onClick={() => scroll(-1)} disabled={!edges.left} className={button} title="Scroll left" aria-label="Scroll table left">
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
          <span className="w-px h-3.5 bg-[var(--card-border)]" aria-hidden="true" />
          <button type="button" onClick={() => scroll(1)} disabled={!edges.right} className={button} title="Scroll right" aria-label="Scroll table right">
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>
      )}
      <div ref={ref} onScroll={measure} className={`overflow-x-auto ${className}`}>{children}</div>
    </div>
  );
}
