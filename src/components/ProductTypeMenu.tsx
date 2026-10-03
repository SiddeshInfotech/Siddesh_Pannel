'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { splitGroups, type GroupedOption } from '@/lib/labelGroups';

// Column shades, light → darker (same scale as the grouped product dropdown).
const GROUP_TINT_PERCENT = [6, 11, 16, 21, 26];
const COLUMN_WIDTH = 152; // px — fits "Robotics & Drone Lab" on one line; longer titles wrap
const GAP = 6;
const PAD = 8;
const EDGE = 16; // minimum distance from the viewport edges

/**
 * Product Types filter popover: one column per lab (STEM, Robotics & Drone, …) and one row per
 * OS (Android / Windows / Linux), so every product is visible at once.
 *
 * - Rendered in a portal (the tab strip it opens from scrolls and would clip it), fixed under the
 *   anchor and horizontally CENTERED on `boundaryRef` (the filter bar), clamped to the viewport.
 * - Narrow screens: columns wrap onto more rows instead of overflowing; very short screens scroll.
 * - Closes on outside click, Escape (focus returns to the anchor), or when the page scrolls;
 *   re-positions on window resize. Scrolling inside the menu does not close it.
 */
export default function ProductTypeMenu({
  open,
  onClose,
  anchorRef,
  boundaryRef,
  options,
  value,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  boundaryRef?: RefObject<HTMLElement | null>;
  options: GroupedOption[];
  value: string;
  onSelect: (value: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { ungrouped, groups } = splitGroups(options);
  const columns = Math.max(groups.length, 1);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const b = (boundaryRef?.current ?? anchor).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const natural = columns * COLUMN_WIDTH + (columns - 1) * GAP + PAD * 2;
    const width = Math.min(natural, vw - EDGE * 2);
    const center = b.left + b.width / 2;
    const left = Math.min(Math.max(center - width / 2, EDGE), vw - width - EDGE);
    const top = a.bottom + 8;
    // Positioning is written straight to the element (it depends on live layout, not on React
    // state), and the menu stays hidden until it has been placed — no flash at a wrong spot.
    const el = menuRef.current;
    if (!el) return;
    Object.assign(el.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(vh - top - EDGE, 160)}px`,
      visibility: 'visible',
    });
  }, [anchorRef, boundaryRef, columns]);

  // Measure before paint.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!t && (menuRef.current?.contains(t as Node) || anchorRef.current?.contains(t as Node));
    const onMouseDown = (e: MouseEvent) => { if (!inside(e.target)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    // The popover is fixed: if the page (or the tab strip) scrolls it would float away.
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, place, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  const item = (opt: GroupedOption, text: string) => {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        title={opt.label}
        onClick={() => onSelect(opt.value)}
        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center justify-between gap-2 focus-visible:outline-2 focus-visible:outline-accent-violet ${
          active ? 'bg-accent-violet/15 text-accent-violet' : 'text-foreground hover:bg-foreground/5'
        }`}
      >
        <span className="truncate">{text}</span>
        {active && <span className="w-1.5 h-1.5 rounded-full bg-accent-violet shrink-0" />}
      </button>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Product types"
      className="fixed z-50 animate-fade-in overflow-y-auto overscroll-contain"
      style={{ visibility: 'hidden' }}
    >
      <div className="menu-panel !gap-2" style={{ padding: PAD }}>
        {ungrouped.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {ungrouped.map((opt) => (
              <div key={opt.value} className="min-w-[150px]">
                {item(opt, opt.label === 'All Products' ? 'All Product Types' : opt.label)}
              </div>
            ))}
          </div>
        )}
        {groups.length > 0 ? (
          <div
            className="grid"
            style={{ gap: GAP, gridTemplateColumns: `repeat(auto-fit, minmax(${COLUMN_WIDTH - 12}px, 1fr))` }}
          >
            {groups.map((g, gi) => (
              <div
                key={g.key}
                className="rounded-xl p-1 flex flex-col gap-0.5 min-w-0"
                style={{ backgroundColor: `color-mix(in srgb, var(--accent-violet) ${GROUP_TINT_PERCENT[gi % GROUP_TINT_PERCENT.length]}%, transparent)` }}
              >
                {/* Two-line slot so long lab names wrap without misaligning the rows below. */}
                <div
                  className="px-2.5 pt-1 pb-0.5 min-h-[30px] text-[9px] leading-tight font-bold uppercase tracking-wider text-accent-violet line-clamp-2"
                  title={g.title || g.items[0].label}
                >
                  {g.title || g.items[0].label}
                </div>
                {g.items.map((i) => item(i, i.short))}
              </div>
            ))}
          </div>
        ) : ungrouped.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-500 text-center">No product types</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
