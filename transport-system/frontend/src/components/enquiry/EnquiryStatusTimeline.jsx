/**
 * EnquiryStatusTimeline.jsx
 * ---------------------------------------------------------------------------
 * The vertical progress tracker on the enquiry confirmation page.
 *
 * It renders six steps: Submitted → Reviewing → Assignment → Final Quote →
 * Acceptance → Confirmed. Each step is `done`, `active`, `pending` or
 * `halted`, derived purely from the server-supplied status
 * (see buildTimeline in utils/enquiryFormat.js).
 *
 * The component is read-only. It never sets a status and never guesses one —
 * if the socket is down, the parent re-polls and this re-renders.
 */

import { Check, Loader2, XCircle } from 'lucide-react';
import { buildTimeline, statusLabel } from '../../utils/enquiryFormat';

/**
 * @param {Object} props
 * @param {string} props.status - the server's EnquiryStatus
 * @param {boolean} [props.compact=false]
 */
export default function EnquiryStatusTimeline({ status, compact = false }) {
  const { steps } = buildTimeline(status);

  return (
    <ol className="relative" aria-label="Enquiry progress">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;

        return (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector line */}
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute left-[13px] top-7 h-full w-0.5 ${
                  step.state === 'done' ? 'bg-[#25D366]' : 'bg-[#172B4D]/10'
                }`}
              />
            )}

            {/* Marker */}
            <span className="relative z-10 shrink-0">
              {step.state === 'done' && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                </span>
              )}

              {step.state === 'active' && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F5A623] text-white shadow-sm ring-4 ring-[#F5A623]/20">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} aria-hidden="true" />
                </span>
              )}

              {step.state === 'halted' && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 ring-4 ring-red-50">
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                </span>
              )}

              {step.state === 'pending' && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#172B4D]/15 bg-white">
                  <span className="h-2 w-2 rounded-full bg-[#172B4D]/20" />
                </span>
              )}
            </span>

            {/* Label */}
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={`text-sm font-semibold leading-tight ${
                  step.state === 'pending'
                    ? 'text-slate-400'
                    : step.state === 'halted'
                    ? 'text-slate-500 line-through'
                    : 'text-[#172B4D]'
                }`}
              >
                {step.title}
              </p>
              {!compact && (
                <p
                  className={`mt-0.5 text-xs leading-relaxed ${
                    step.state === 'pending' ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {step.description}
                </p>
              )}
              {step.state === 'active' && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#F5A623]/10 px-2 py-0.5 text-[11px] font-medium text-[#B26A00]">
                  In progress · {statusLabel(status)}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
