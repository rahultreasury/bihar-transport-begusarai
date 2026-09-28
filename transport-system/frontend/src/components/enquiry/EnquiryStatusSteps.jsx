/**
 * EnquiryStatusSteps.jsx
 * ---------------------------------------------------------------------------
 * A cleaner, more compact rendering of the six-step request lifecycle.
 *
 * Replaces the old large vertical timeline on the confirmation page. It reads
 * the SAME backend state as before (utils/enquiryFormat.buildTimeline) and
 * never invents progress: there are no timers, no optimistic steps, no
 * simulation. A step turns green only when the API says it happened.
 *
 * Visual language:
 *   completed → green check
 *   current   → brand orange, ringed, with a live pulse
 *   future    → light grey
 *   halted    → red (rejected / cancelled)
 */

import { Check } from 'lucide-react';
import { buildTimeline, statusLabel } from '../../utils/enquiryFormat';

export default function EnquiryStatusSteps({ status, connected = false, className = '' }) {
  const { steps } = buildTimeline(status);
  const active = steps.find((s) => s.state === 'active');

  return (
    <section
      className={`rounded-3xl border border-[#172B4D]/10 bg-white p-5 shadow-[0_2px_6px_rgba(23,43,77,0.05),0_20px_44px_-30px_rgba(11,27,51,0.4)] sm:p-6 ${className}`}
      aria-labelledby="request-status-heading"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2
          id="request-status-heading"
          className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#172B4D]"
        >
          Request Status
        </h2>

        {/* Only claims "live" when the socket is genuinely connected. */}
        {connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live updates
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Reconnecting…
          </span>
        )}
      </div>

      {/* ── The rail ──────────────────────────────────────────────────
          A grid, not a list: 2 columns on a phone, 3 on a tablet, one row of
          six on a desktop. The connector line only appears in the single-row
          layout, where a line between two dots always means "then" — wrapped
          onto two rows it would be ambiguous, so it is dropped there. */}
      <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;

          return (
            <li
              key={step.key}
              className="relative min-w-0"
              aria-current={step.state === 'active' ? 'step' : undefined}
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[13px] right-0 top-[11px] hidden h-[3px] rounded-full lg:block ${
                    step.state === 'done' ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                />
              )}

              <span className="relative z-10 flex h-6 w-6 items-center justify-center">
                {step.state === 'done' && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white ring-4 ring-emerald-50">
                    <Check className="h-3.5 w-3.5" strokeWidth={3.5} aria-hidden="true" />
                  </span>
                )}

                {step.state === 'active' && (
                  <span className="btb-accent-pulse flex h-6 w-6 items-center justify-center rounded-full bg-[#F5A623] ring-4 ring-[#F5A623]/20">
                    <span className="h-2 w-2 rounded-full bg-white" />
                  </span>
                )}

                {step.state === 'halted' && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 ring-4 ring-red-50">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                  </span>
                )}

                {step.state === 'pending' && (
                  <span className="h-6 w-6 rounded-full border-2 border-slate-200 bg-white" />
                )}
              </span>

              <p
                className={`mt-2 pr-1 text-[11.5px] font-semibold leading-tight ${
                  step.state === 'pending' || step.state === 'halted'
                    ? 'text-slate-400'
                    : 'text-[#172B4D]'
                }`}
              >
                {step.title}
              </p>
            </li>
          );
        })}
      </ol>

      {/* ── The one line that actually matters right now ── */}
      {active && (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 ${
            active.state === 'halted' ? 'bg-red-50' : 'bg-[#F5A623]/[0.08]'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`text-[11px] font-bold uppercase tracking-[0.14em] ${
                active.state === 'halted' ? 'text-red-700' : 'text-[#B26A00]'
              }`}
            >
              {statusLabel(status)}
            </p>
            {active.state === 'active' && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#B26A00]/80">
                <span className="btb-accent-pulse h-1.5 w-1.5 rounded-full bg-[#F5A623]" />
                In progress
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-[#172B4D]/80">
            {active.description}
          </p>
        </div>
      )}
    </section>
  );
}
