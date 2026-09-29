'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Wide pop-up for the "Add Vendor / School / Parent" forms on the Accounts page. The form keeps
 * its own title and buttons; this only supplies the overlay and closing on Esc or a click outside.
 * Rendered into <body> (portal): inside the page, an ancestor with a transform / backdrop-filter
 * would make `fixed inset-0` cover only that ancestor, leaving part of the window uncovered.
 * The theme class lives on <html>, so light / dark styling still applies.
 */
export default function FormModal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="glass-interactive w-full max-w-6xl max-h-[90vh] overflow-y-auto relative animate-slide-up rounded-2xl px-6 pt-3 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
