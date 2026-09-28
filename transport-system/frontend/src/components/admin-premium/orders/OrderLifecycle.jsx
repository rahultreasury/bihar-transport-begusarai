/**
 * OrderLifecycle.jsx
 * ---------------------------------------------------------------------------
 * The shipment lifecycle rail: Enquiry → Quotation → Order Confirmed →
 * Vehicle Hired → Loading → Dispatch → Transit → Delivery → POD → Completed.
 *
 * This is NOT decorative. Every node's state comes from `resolveOrder()`, which
 * projects the real Booking.status / quote_status / Delivery.current_status /
 * Trip.status values. The "Current Stage" and "Next Action" lines underneath are
 * likewise derived, not hardcoded.
 *
 * Mobile: the rail scrolls horizontally rather than wrapping into a tall stack
 * (spec §23). Desktop: a single row.
 */

import React from 'react';
import { Check, CircleDot, X, Circle } from 'lucide-react';
import { BRAND } from './orderUi';

const NODE_ICON = {
  done: Check,
  current: CircleDot,
  blocked: X,
  upcoming: Circle,
};

const NODE_COLOR = {
  done: 'text-emerald-600',
  current: 'text-[#F5A000]',
  blocked: 'text-red-600',
  upcoming: 'text-slate-300',
};

const RING = {
  done: 'bg-emerald-50 ring-emerald-600/20',
  current: 'bg-amber-50 ring-[#F5A000]/30',
  blocked: 'bg-red-50 ring-red-600/20',
  upcoming: 'bg-slate-50 ring-slate-300/40',
};

const LABEL = {
  done: 'text-slate-700',
  current: 'text-[#15345B]',
  blocked: 'text-red-700',
  upcoming: 'text-slate-400',
};

export default function OrderLifecycle({ resolved, onSelect, className = '' }) {
  if (!resolved) return null;
  const { stages, stageLabel, state, nextAction, blockedReason } = resolved;

  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.04)] ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundColor: state === 'blocked' ? '#DC2626' : BRAND.navy }}
          >
            Current Stage · {stageLabel}
          </span>
        </div>
        <p className="min-w-0 truncate text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Next Action:</span>{' '}
          {state === 'blocked' ? blockedReason : nextAction}
        </p>
      </div>

      {/* Horizontally scrollable on small screens (§23). */}
      <div className="overflow-x-auto px-5 py-5">
        <ol className="flex min-w-max items-start gap-0">
          {stages.map((stage, i) => {
            const Icon = NODE_ICON[stage.state] || Circle;
            const last = i === stages.length - 1;
            // The connector is lit only when the NEXT node has been reached too.
            const connectorDone = !last && stages[i + 1].state !== 'upcoming';
            return (
              <li key={stage.key} className="flex items-start">
                <button
                  type="button"
                  onClick={() => onSelect?.(stage)}
                  aria-current={stage.state === 'current' ? 'step' : undefined}
                  className="group flex w-[104px] shrink-0 flex-col items-center gap-2 rounded-lg px-1 py-1 text-center transition-colors hover:bg-slate-50"
                  title={stage.label}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset ${RING[stage.state]}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${NODE_COLOR[stage.state]} ${
                        stage.state === 'current' ? 'animate-pulse' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={`text-[11px] font-semibold leading-tight ${LABEL[stage.state]}`}
                  >
                    {stage.short}
                  </span>
                </button>

                {!last && (
                  <span
                    aria-hidden="true"
                    className={`mt-4 h-0.5 w-6 shrink-0 rounded ${
                      connectorDone ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
