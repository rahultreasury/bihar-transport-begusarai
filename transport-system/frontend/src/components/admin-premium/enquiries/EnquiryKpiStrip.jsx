/**
 * EnquiryKpiStrip.jsx
 * ---------------------------------------------------------------------------
 * "Enquiry Overview" — compact KPI tiles for /admin/enquiries.
 *
 * DATA INTEGRITY
 *   Every value passed in as `counts` is a real `pagination.total` read back
 *   from GET /api/admin/bookings (one request per status group). The parent
 *   passes `null` while a count is in flight, which renders a skeleton rather
 *   than a placeholder number. Nothing here is hardcoded.
 */

import React from 'react';

const ACCENT = {
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  navy: 'bg-[#1e3a5f]',
};

const VALUE_TONE = {
  amber: 'text-amber-600',
  orange: 'text-orange-600',
  sky: 'text-sky-600',
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  navy: 'text-[#1e3a5f]',
};

export default function EnquiryKpiStrip({ defs, counts, activeKey, onSelect }) {
  return (
    <section aria-labelledby="enquiry-overview-heading">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2
          id="enquiry-overview-heading"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted"
        >
          Enquiry Overview
        </h2>
        <span className="hidden text-[11px] text-muted sm:inline">Live counts from the bookings API</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {defs.map((def) => {
          const value = counts?.[def.key];
          const isActive = activeKey === def.key;
          return (
            <button
              key={def.key}
              type="button"
              onClick={() => onSelect?.(def.key)}
              title={def.hint}
              aria-pressed={isActive}
              className={`group relative overflow-hidden rounded-lg border bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition ${
                isActive
                  ? 'border-amber-400 ring-1 ring-amber-200'
                  : 'border-border hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              <span
                className={`absolute inset-y-0 left-0 w-[3px] ${ACCENT[def.tone] || ACCENT.amber}`}
                aria-hidden="true"
              />
              <span className="block pl-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                {def.label}
              </span>
              {value === null || value === undefined ? (
                <span className="mt-1.5 block h-6 w-10 rounded bg-skeleton animate-pulse" aria-hidden="true" />
              ) : (
                <span
                  className={`mt-0.5 block pl-1.5 text-[22px] font-bold leading-7 tracking-tight ${
                    VALUE_TONE[def.tone] || VALUE_TONE.amber
                  }`}
                >
                  {value.toLocaleString('en-IN')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
