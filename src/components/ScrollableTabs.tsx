'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A single-row tab strip that scrolls sideways when the tabs don't fit, instead of wrapping.
 * Scrollbars are hidden app-wide, so it also turns a vertical mouse wheel into horizontal
 * scrolling and fades the edge that has more tabs behind it.
 */
export default function ScrollableTabs({
  children,
  className = '',
  onScroll,
}: {
  children: React.ReactNode;
  className?: string;
  /** Called when the strip scrolls (e.g. to close a dropdown anchored to a tab). */
  onScroll?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Vertical wheel → horizontal scroll, only while the strip actually overflows.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure]);

  const fade =
    edges.left && edges.right ? 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)'
    : edges.right ? 'linear-gradient(to right, #000 calc(100% - 24px), transparent)'
    : edges.left ? 'linear-gradient(to right, transparent, #000 24px)'
    : undefined;

  return (
    <div
      ref={ref}
      onScroll={() => { measure(); onScroll?.(); }}
      className={`flex items-center flex-nowrap overflow-x-auto min-w-0 [&>*]:shrink-0 ${className}`}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      {children}
    </div>
  );
}
