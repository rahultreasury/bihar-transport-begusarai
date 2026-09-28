/**
 * JourneyTimeline.jsx
 * ---------------------------------------------------------------------------
 * The six-step customer-journey rail:
 *   Request Received → Under Review → Quote Prepared → Quote Sent
 *   → Customer Accepted → Confirmed
 *
 * IT IS NOW A NAVIGATION CONTROL, NOT A DECORATIVE BADGE
 *   Every step is a button. Clicking one scrolls the page to the existing
 *   section that owns that stage and marks it active. The six sections stay on
 *   the page exactly as before — nothing is hidden, nothing is re-laid-out.
 *
 * THE RAIL IS DERIVED FROM THE DATABASE
 *   The highlighted step comes only from real persisted fields (quote_status,
 *   status, confirmation_source, quote_sent_at, quote_accepted_at,
 *   confirmed_at) — see stageForBooking() in workflow/workflowStages.js. There
 *   is no client-side progress, no timers, and no optimistic advancement, so
 *   the rail is identical after a browser refresh.
 *
 * FUTURE STEPS ARE NOT SHOUTY "LOCKED" BADGES
 *   A future step is drawn in the same neutral style as before and carries a
 *   short, honest hint of what is actually missing — "Next step", "Requires
 *   driver", "Requires quote", "Awaiting customer" — so the operator can see
 *   the path forward without being told the system is broken.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleDot, XCircle } from 'lucide-react';

import { STAGE, describeWorkflow, stageForBooking } from './workflow/workflowStages';

/** Where each stage lives on the page. The page renders these ids. */
export const STAGE_SECTIONS = {
  [STAGE.RECEIVED]: 'stage-request-received',
  [STAGE.UNDER_REVIEW]: 'stage-under-review',
  [STAGE.QUOTE_PREPARED]: 'stage-quote-prepared',
  [STAGE.QUOTE_SENT]: 'stage-quote-sent',
  [STAGE.CUSTOMER_ACCEPTED]: 'stage-customer-accepted',
  [STAGE.CONFIRMED]: 'stage-confirmed',
};

/** Scroll a section into view and give it a brief highlight. */
export function focusStageSection(key) {
  const id = STAGE_SECTIONS[key];
  if (typeof document === 'undefined' || !id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('ring-2', 'ring-amber-400/70');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400/70'), 1600);
}

function dotClasses(stage, halted) {
  if (halted) return 'border-rose-200 bg-rose-50 text-rose-600';
  if (stage.done) return 'border-emerald-500 bg-emerald-500 text-white';
  if (stage.active) return 'border-amber-500 bg-amber-500 text-white';
  return 'border-border bg-white text-slate-400';
}

function labelClasses(stage) {
  if (stage.active) return 'text-amber-700';
  if (stage.done) return 'text-text';
  return 'text-muted';
}

function StageGlyph({ stage, halted }) {
  if (halted) return <XCircle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />;
  if (stage.done) return <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />;
  if (stage.active) return <CircleDot className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />;
  return <span aria-hidden="true">{stage.index + 1}</span>;
}

/**
 * @param {object} props
 * @param {object} props.booking      the live booking row from the API
 * @param {string} [props.activeStage] which stage the operator has focused
 * @param {(key: string) => void} [props.onStageClick]
 */
export default function JourneyTimeline({ booking, activeStage, onStageClick }) {
  const workflow = describeWorkflow(booking);
  const [focused, setFocused] = useState(activeStage || workflow.current);
  const previousCurrent = useRef(workflow.current);

  // The rail follows the DATABASE forward. If a mutation (or a customer
  // accepting on their tracking page) advances the enquiry, the operator is
  // taken to the new stage automatically — unless they are deliberately
  // reviewing an earlier, already-completed stage.
  useEffect(() => {
    if (previousCurrent.current === workflow.current) return;
    previousCurrent.current = workflow.current;

    const prevIndex = workflow.stages.find((s) => s.key === focused)?.index ?? 0;
    if (prevIndex <= workflow.currentIndex) {
      setFocused(workflow.current);
      onStageClick?.(workflow.current);
    }
  }, [workflow, focused, onStageClick]);

  useEffect(() => {
    if (activeStage) setFocused(activeStage);
  }, [activeStage]);

  const handleClick = (key) => {
    setFocused(key);
    onStageClick?.(key);
    focusStageSection(key);
  };

  const rejected =
    String(booking?.quote_status || '').toUpperCase() === 'REJECTED' || Boolean(booking?.quote_rejected_at);

  return (
    <nav
      aria-label="Customer journey status"
      className="rounded-xl border border-border bg-white px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
    >
      {/* Desktop rail */}
      <ol className="hidden items-stretch lg:flex">
        {workflow.stages.map((stage) => {
          const halted = rejected && stage.active;
          const selected = stage.key === focused;

          return (
            <li key={stage.key} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => handleClick(stage.key)}
                aria-current={selected ? 'step' : undefined}
                title={stage.locked ? stage.lockReason : stage.purpose}
                className={`group flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg px-1 py-1.5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  selected ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition ${dotClasses(
                    stage,
                    halted,
                  )} ${selected ? 'ring-2 ring-amber-500/30 ring-offset-1' : ''}`}
                >
                  <StageGlyph stage={stage} halted={halted} />
                </span>
                <span className={`whitespace-nowrap text-[11px] font-semibold ${labelClasses(stage)}`}>
                  {stage.label}
                </span>
                {/* Subtle, honest hint — never a shouty "LOCKED" badge. */}
                <span className="whitespace-nowrap text-[9.5px] font-medium uppercase tracking-wider text-slate-400">
                  {stage.done ? 'Done' : stage.active ? 'Now' : stage.hint}
                </span>
              </button>

              {stage.index < workflow.stages.length - 1 ? (
                <span
                  className={`mx-1 h-px min-w-[8px] flex-1 ${
                    workflow.stages[stage.index + 1].done ? 'bg-emerald-300' : 'bg-border'
                  }`}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Mobile / tablet list */}
      <ol className="space-y-2 lg:hidden">
        {workflow.stages.map((stage) => {
          const halted = rejected && stage.active;
          const selected = stage.key === focused;
          return (
            <li key={stage.key}>
              <button
                type="button"
                onClick={() => handleClick(stage.key)}
                aria-current={selected ? 'step' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                  selected ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${dotClasses(
                    stage,
                    halted,
                  )}`}
                >
                  <StageGlyph stage={stage} halted={halted} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[12.5px] font-semibold ${labelClasses(stage)}`}>
                    {stage.label}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                    {stage.done ? 'Done' : stage.active ? 'Now' : stage.hint}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { stageForBooking };
