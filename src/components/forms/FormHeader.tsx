'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/** Shared look of the Add Vendor / School / Parent forms (page and pop-up). */
export const FORM_INPUT_CLASS =
  'w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white';
export const FORM_GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5';
/** Final save button (same grey as the data tables, theme-aware). */
export const FORM_SAVE_BUTTON_CLASS =
  'flex items-center gap-1.5 px-6 py-2.5 bg-[var(--surface-hover)] hover:brightness-95 border border-[var(--card-border)] text-xs font-semibold text-[var(--foreground)] rounded-xl transition-all active:scale-95 cursor-pointer disabled:opacity-55';
const CANCEL_CLASS =
  'px-5 py-2.5 bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl hover:bg-white/10 transition-all cursor-pointer';

export interface FormStepDef<T extends string> {
  id: T;
  label: string;
}

/**
 * Title + Cancel, then the divider line with the step pills sitting on it.
 * In the pop-up the header stays at its normal position (top-0: sticky already sits inside the
 * pop-up's padding, so it never moves) while the form scrolls. Only what is behind it is blurred:
 * the band from the pop-up's top edge down to the divider line, plus the step pills themselves,
 * so the blur edge follows  ----\( pills )/----. The band covers FormModal's pt-3 / px-6 padding.
 */
export default function FormHeader<T extends string>({
  title,
  steps,
  activeStep,
  onStepChange,
  inModal,
  onClose,
  cancelHref,
  backHref,
  backLabel,
}: {
  title: string;
  /** Omit for a single-page form: the header then shows a plain divider line, no pills. */
  steps?: FormStepDef<T>[];
  activeStep?: T;
  onStepChange?: (step: T) => void;
  inModal: boolean;
  onClose?: () => void;
  /** Page only: where Cancel and the back link go. */
  cancelHref: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className={inModal ? 'sticky top-0 z-20' : undefined}>
      {inModal && (
        <div
          aria-hidden
          className="absolute -top-3 bottom-5 -left-6 -right-6 -z-10 bg-[color-mix(in_srgb,var(--card)_75%,transparent)] backdrop-blur-md"
        />
      )}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          {!inModal && (
            <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-xs font-semibold cursor-pointer mb-2">
              <Link href={backHref} className="flex items-center gap-1">
                <ChevronLeft className="w-3.5 h-3.5" />
                {backLabel}
              </Link>
            </div>
          )}
          <h2 className="text-3xl font-extrabold text-white tracking-tight leading-tight">{title}</h2>
        </div>
        {inModal ? (
          <button type="button" onClick={onClose} className={CANCEL_CLASS}>
            Cancel
          </button>
        ) : (
          <Link href={cancelHref} className={CANCEL_CLASS}>
            Cancel
          </Link>
        )}
      </div>

      {!steps?.length ? (
        // Single-page form: just the divider line, at the same place the pill line's line sits.
        <div className="mt-3 pb-5 border-t border-[var(--card-border)]" />
      ) : (
      /* Divider line with the step pills sitting on it (line stops at the pills' edges, so it
          never shows through their translucent dark-theme background) */
      <div className="flex items-center -mt-2">
        <div className="flex-1 border-t border-[var(--card-border)]" />
        {/* Same capsule style as the Vendors / Schools / Parents tabs */}
        <div className={`flex h-10 p-1 items-center gap-1 bg-[var(--surface-hover)] rounded-full w-fit shrink-0 ${inModal ? 'backdrop-blur-md' : ''}`}>
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepChange?.(step.id)}
              className={`px-5 h-full flex items-center justify-center rounded-full text-[13px] font-semibold whitespace-nowrap border transition-colors duration-300 outline-none focus:outline-none focus-visible:outline-none ${
                activeStep === step.id
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm border-[var(--card-border)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {step.label}
            </button>
          ))}
        </div>
        <div className="flex-1 border-t border-[var(--card-border)]" />
      </div>
      )}
    </div>
  );
}
