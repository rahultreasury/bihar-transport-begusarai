/**
 * OrderLifecycle.jsx
 * ---------------------------------------------------------------------------
 * The shipment lifecycle rail: Enquiry → Quote → Confirmed → Vehicle →
 * Loading → Dispatch → Transit → Delivery → POD → Completed.
 *
 * EVERY NODE IS CLICKABLE, AND CLICKING NEVER CHANGES A STATUS
 *   A click NAVIGATES — it opens the enquiry, the trip's loading workspace, the
 *   dispatch form, tracking, the POD panel and so on. It never writes. Status
 *   only ever moves through the named operational endpoint the backend offers,
 *   and those are guarded by the existing TripStateMachine. That is why a future
 *   stage can be clicked to VIEW what it requires without being able to jump
 *   into it.
 *
 * WHERE THE STATE COMES FROM
 *   `workflow` is the backend's canonical projection — `GET /api/trips/:id/workflow`
 *   → `stage`, resolved by `config/tripStagePolicy` from `Trip.status` alone.
 *   When it is present the rail renders exactly what the server decided.
 *   Without it (the Order LIST has no trip call) the rail falls back to the
 *   client-side `resolveOrder()` projection, so the two can never disagree.
 *
 * THE FOUR VISUAL STATES (§14)
 *   done      a green tick — this stage is behind the consignment
 *   current   highlighted — where the consignment actually is now
 *   available the next stage, styled as an action
 *   locked    muted, still clickable for viewing requirements
 */

import React from 'react';
import { Check, CircleDot, X, Circle, ArrowRight } from 'lucide-react';
import { BRAND } from './orderUi';

/**
 * Icon + colour per state. `available` is deliberately styled as an action so
 * the rail shows where the consignment is going, not only where it has been.
 */
const NODE_ICON = {
  done: Check,
  current: CircleDot,
  blocked: X,
  upcoming: Circle,
  available: ArrowRight,
  locked: Circle,
  // The order has no operational trip yet — nothing to show as reached.
  unavailable: Circle,
};

const NODE_COLOR = {
  done: 'text-emerald-600',
  current: 'text-[#F5A000]',
  blocked: 'text-red-600',
  upcoming: 'text-slate-300',
  available: 'text-[#F5A000]',
  locked: 'text-slate-300',
  unavailable: 'text-slate-200',
};

const RING = {
  done: 'bg-emerald-50 ring-emerald-600/20',
  current: 'bg-amber-50 ring-[#F5A000]/30',
  blocked: 'bg-red-50 ring-red-600/20',
  upcoming: 'bg-slate-50 ring-slate-300/40',
  available: 'bg-amber-50 ring-[#F5A000]/40',
  locked: 'bg-slate-50 ring-slate-300/30',
  unavailable: 'bg-slate-50 ring-slate-200/30',
};

const LABEL = {
  done: 'text-slate-700',
  current: 'text-[#15345B]',
  blocked: 'text-red-700',
  upcoming: 'text-slate-400',
  available: 'text-[#15345B]',
  locked: 'text-slate-400',
  unavailable: 'text-slate-300',
};

export default function OrderLifecycle({ resolved, workflow, onSelect, className = '' }) {
  if (!resolved && !workflow) return null;

  const gotoFor = (key) => {
    const k = String(key || '').toUpperCase();
    switch (k) {
      case 'ENQUIRY':
        return { kind: 'enquiry' };
      case 'QUOTATION':
        return { kind: 'enquiry', anchor: 'quote' };
      case 'ORDER_CONFIRMED':
        return { kind: 'overview' };
      case 'VEHICLE_HIRED':
        return { kind: 'vehicle_hire' };
      case 'LOADING':
        return { kind: 'trip_tab', tab: 'loading' };
      case 'DISPATCH':
        return { kind: 'trip_tab', tab: 'dispatch' };
      case 'TRANSIT':
        return { kind: 'trip_tab', tab: 'tracking' };
      case 'DELIVERY':
        return { kind: 'trip_tab', tab: 'delivery' };
      case 'POD':
        return { kind: 'trip_tab', tab: 'pod' };
      case 'COMPLETED':
        return { kind: 'trip_tab', tab: 'summary' };
      default:
        return null;
    }
  };

  // Prefer the SERVER projection. `stages` from the backend already carry the
  // four states and the click destination, so nothing is recomputed here.
  const stages = workflow?.stages?.length
    ? workflow.stages.map((s) => ({
        key: s.key,
        label: s.label,
        short: s.label,
        state: s.state,
        goto: s.goto || gotoFor(s.key),
        requirement: s.requirement,
      }))
    : (resolved?.stages || []).map((s) => ({ ...s, goto: gotoFor(s.key), requirement: null }));

  const stageLabel = workflow?.current_stage_label || resolved?.stageLabel || '';
  const state = resolved?.state || 'current';
  const nextAction = workflow?.next_action || null;
  const blockedReason = resolved?.blockedReason || null;

  /**
   * The tooltip a future stage shows on hover: what it is, and what must be
   * true before it can begin. It explains the rail rather than just muting it.
   */
  const hintFor = (stage) =>
    stage.requirement
      ? `${stage.label}\nRequired before starting: ${stage.requirement}`
      : stage.label;

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

        {/* NEXT ACTION — a real control, not static text. Clicking it opens the
            workspace for whatever the server says happens next. */}
        {nextAction ? (
          <button
            type="button"
            onClick={() => onSelect?.({ key: nextAction.stage, goto: { kind: 'next_action' }, action: nextAction })}
            title={nextAction.endpoint ? `${nextAction.method} ${nextAction.endpoint}` : 'No action required'}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-[#F5A000]/40 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-[#15345B] transition hover:border-[#F5A000] hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A000]/50"
          >
            <span className="font-bold uppercase tracking-wide text-[10.5px] text-slate-500">
              Next Action
            </span>
            <span className="truncate">{nextAction.label}</span>
            <ArrowRight size={13} className="shrink-0 text-[#F5A000]" aria-hidden="true" />
          </button>
        ) : (
          <p className="min-w-0 truncate text-sm text-slate-600">
            <span className="font-semibold text-slate-700">Next Action:</span>{' '}
            {state === 'blocked' ? blockedReason : resolved?.nextAction || '—'}
          </p>
        )}
      </div>

      {/* Horizontally scrollable on small screens. */}
      <div className="overflow-x-auto px-5 py-5">
        <ol className="flex min-w-max items-start gap-0">
          {stages.map((stage, i) => {
            const Icon = NODE_ICON[stage.state] || Circle;
            const last = i === stages.length - 1;
            // The connector is lit only when the NEXT node has been reached too.
            const connectorDone = !last && ['done', 'current', 'blocked'].includes(stages[i + 1].state);
            return (
              <li key={stage.key} className="flex items-start">
                <button
                  type="button"
                  onClick={() => onSelect?.(stage)}
                  aria-current={stage.state === 'current' ? 'step' : undefined}
                  title={hintFor(stage)}
                  className={`group flex w-[104px] shrink-0 cursor-pointer flex-col items-center gap-2 rounded-lg px-1 py-1 text-center transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A000]/50 ${
                    stage.state === 'available' ? 'bg-amber-50/60 hover:bg-amber-100' : ''
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-inset ${RING[stage.state] || RING.upcoming}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${NODE_COLOR[stage.state] || NODE_COLOR.upcoming} ${
                        stage.state === 'current' ? 'animate-pulse' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={`text-[11px] font-semibold leading-tight ${LABEL[stage.state] || LABEL.upcoming}`}
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
