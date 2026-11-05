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
 * `skipped` indicates a stage that was bypassed via legacy admin shortcut.
 */
const NODE_ICON = {
  done: Check,
  current: CircleDot,
  blocked: X,
  upcoming: Circle,
  available: ArrowRight,
  locked: Circle,
  skipped: X, // Cross indicates skipped/bypassed
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
  skipped: 'text-amber-600', // Amber for skipped (bypassed)
  unavailable: 'text-slate-200',
};

const RING = {
  done: 'bg-emerald-50 ring-emerald-600/20',
  current: 'bg-amber-50 ring-[#F5A000]/30',
  blocked: 'bg-red-50 ring-red-600/20',
  upcoming: 'bg-slate-50 ring-slate-300/40',
  available: 'bg-amber-50 ring-[#F5A000]/40',
  locked: 'bg-slate-50 ring-slate-300/30',
  skipped: 'bg-amber-50 ring-amber-600/20', // Amber ring for skipped
  unavailable: 'bg-slate-50 ring-slate-200/30',
};

const LABEL = {
  done: 'text-slate-700',
  current: 'text-[#15345B]',
  blocked: 'text-red-700',
  upcoming: 'text-slate-400',
  available: 'text-[#15345B]',
  locked: 'text-slate-400',
  skipped: 'text-amber-700', // Amber label for skipped
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

  console.log('[OrderLifecycle] Rendering stages:', stages.map(s => ({ key: s.key, state: s.state, goto: s.goto })));

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

      {/* Responsive horizontal timeline - works on all screen sizes */}
      <div className="px-5 py-5">
        <div className="relative">
          {/* Timeline line - always visible */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 transform -translate-y-1/2 z-0" />
          
          <ol className="flex items-center justify-between relative z-10 min-w-max">
            {stages.map((stage, i) => {
              const Icon = NODE_ICON[stage.state] || Circle;
              const isCurrent = stage.state === 'current';
              const isDone = stage.state === 'done';
              const isAvailable = stage.state === 'available';
              const isBlocked = stage.state === 'blocked';
              const isUpcoming = stage.state === 'upcoming';
              const isLocked = stage.state === 'locked';
              const isUnavailable = stage.state === 'unavailable';
              const isSkipped = stage.state === 'skipped';
              
              return (
                <li key={stage.key} className="flex flex-col items-center relative flex-shrink-0 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      console.log('[OrderLifecycle] stage clicked:', stage.key, stage.state);
                      onSelect?.(stage);
                    }}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={hintFor(stage)}
                    className={`flex flex-col items-center gap-2 p-2 rounded-lg transition-all duration-200 ${isCurrent ? 'bg-amber-50/60' : 'hover:bg-slate-100'} ${isCurrent ? 'z-20' : ''}`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-inset transition-all duration-200 ${isCurrent ? 'bg-amber-50 ring-[#F5A000]/30 scale-110' : isDone ? 'bg-emerald-50 ring-emerald-600/20' : isAvailable ? 'bg-amber-50 ring-[#F5A000]/20' : isBlocked ? 'bg-red-50 ring-red-600/20' : isSkipped ? 'bg-amber-50 ring-amber-600/20' : isUpcoming || isLocked ? 'bg-slate-50 ring-slate-300/40' : isUnavailable ? 'bg-slate-50 ring-slate-200/30' : 'bg-slate-50 ring-slate-300/40'}`}
                    >
                      <Icon
                        className={`h-5 w-5 ${isCurrent ? 'text-[#15345B]' : isDone ? 'text-emerald-600' : isAvailable ? 'text-[#F5A000]' : isBlocked ? 'text-red-600' : isSkipped ? 'text-amber-600' : isUpcoming || isLocked ? 'text-slate-400' : isUnavailable ? 'text-slate-300' : 'text-slate-400'} ${isCurrent ? 'animate-pulse' : ''}`}
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${isCurrent ? 'text-[#15345B]' : isDone ? 'text-slate-700' : isAvailable ? 'text-[#F5A000]' : isBlocked ? 'text-red-700' : isSkipped ? 'text-amber-700' : isUpcoming || isLocked ? 'text-slate-400' : isUnavailable ? 'text-slate-300' : 'text-slate-400'}`}
                    >
                      {stage.short}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        
        {/* Horizontal scroll indicator for mobile */}
        <div className="hidden sm:block mt-2 text-center">
          <p className="text-xs text-slate-400">← Swipe or scroll horizontally to see all stages →</p>
        </div>
      </div>
    </div>
  );
}
