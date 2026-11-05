/**
 * DetailAccordion.jsx
 * ---------------------------------------------------------------------------
 * Collapsible container for the secondary request details.
 *
 * Route, shipment, schedule and fare are all still shown — they are just
 * demoted behind an accordion so the page leads with "received + supported"
 * instead of a wall of fields.
 *
 * Accessibility: a real <button> with aria-expanded / aria-controls, and the
 * panel unmounts when collapsed so its content is never focusable off-screen.
 */

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function DetailAccordion({
  title,
  icon: Icon,
  summary,
  children,
  defaultOpen = false,
  tone = 'default',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const toneStyles =
    tone === 'accent'
      ? 'text-[#B26A00] bg-[#F5A623]/10'
      : 'text-[#172B4D] bg-[#172B4D]/5';

  return (
    <div className="overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-white shadow-[0_1px_2px_rgba(23,43,77,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#172B4D]/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F5A623]/60 sm:px-5"
      >
        {Icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneStyles}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-[#172B4D]">{title}</span>
          {summary && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>
          )}
        </span>

        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="border-t border-slate-100 px-4 py-4 sm:px-5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A label/value row used inside the accordions. Renders nothing when the value
 * is empty, so an absent field never leaves a dangling label.
 */
export function DetailRow({ label, value, mono = false, strong = false }) {
  if (value === null || value === undefined || value === '' || value === false) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-slate-500">{label}</span>
      <span
        className={`text-right text-sm ${mono ? 'font-mono text-[13px]' : 'font-medium'} ${
          strong ? 'text-[15px] text-[#172B4D]' : 'text-[#172B4D]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** A titled sub-block for grouped detail (e.g. addresses). */
export function DetailBlock({ label, children }) {
  if (!children) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-[#172B4D]">{children}</p>
    </div>
  );
}
