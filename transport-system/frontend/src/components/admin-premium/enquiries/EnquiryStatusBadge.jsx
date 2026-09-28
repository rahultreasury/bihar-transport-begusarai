/**
 * EnquiryStatusBadge.jsx
 * ---------------------------------------------------------------------------
 * Professional status pills for the ENQUIRY workspace.
 * The tone is derived from the real backend `quote_status` (see enquiryStatus.js)
 * so a badge can never disagree with the row it sits in.
 */

import React from 'react';
import { getStatusMeta } from './enquiryStatus';

const TONE_CLASSES = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const DOT_CLASSES = {
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400',
};

export default function EnquiryStatusBadge({ booking, size = 'sm', className = '' }) {
  const meta = getStatusMeta(booking);
  const sizing = size === 'lg' ? 'px-3 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-bold uppercase tracking-wide ring-1 ring-inset ${TONE_CLASSES[meta.tone] || TONE_CLASSES.amber} ${sizing} ${className}`}
      title={meta.label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[meta.tone] || DOT_CLASSES.amber}`} aria-hidden="true" />
      {meta.chip}
    </span>
  );
}
