/**
 * EnquiryLifecycleRail.jsx
 * ---------------------------------------------------------------------------
 * The horizontal workflow indicator under the enquiry header.
 *
 * WHERE THE STATE COMES FROM
 *   The rail NEVER decides its own state. Every circle is derived from the
 *   server's `enquiry.status` by matching it against the `match` list of each
 *   stage. That membership list mirrors backend/utils/EnquiryStateMachine.js
 *   exactly — the same statuses that make a transition legal there make a stage
 *   "current" here. Change the state machine and this file is the only other
 *   place that needs to know.
 *
 *   The DTO also ships `progress_stage` (1..6, from EnquiryStateMachine
 *   .toProgressStage). It is NOT used to drive the rail because it collapses
 *   CANCELLED / CUSTOMER_REJECTED onto stage 6, which would render a cancelled
 *   enquiry as "Confirmed ✓" — visually claiming a trip that never existed.
 *   Cancelled/rejected are terminal, so the rail HALTS at the last real stage
 *   instead.
 *
 * RESPONSIVE
 *   The track is `min-w-max` inside an overflow-x-auto container, so on a
 *   phone it scrolls sideways rather than wrapping into a broken staircase.
 */

import React from 'react';
import {
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Inbox,
  PlayCircle,
  Send,
  X,
} from 'lucide-react';
import { ENQUIRY_STATUS } from '../../../utils/enquiryFormat';

/**
 * The six operator-facing stages. `match` is the set of server statuses that
 * make this stage the current one.
 */
const STAGES = [
  {
    key: 'received',
    label: 'Request Received',
    icon: Inbox,
    match: [ENQUIRY_STATUS.ENQUIRY_SUBMITTED],
  },
  {
    key: 'review',
    label: 'Under Review',
    icon: PlayCircle,
    match: [
      ENQUIRY_STATUS.ADMIN_REVIEW,
      ENQUIRY_STATUS.ASSIGNMENT_PENDING,
      ENQUIRY_STATUS.VEHICLE_ASSIGNED,
      ENQUIRY_STATUS.DRIVER_ASSIGNED,
    ],
  },
  {
    key: 'quote',
    label: 'Quote Prepared',
    icon: ClipboardCheck,
    match: [ENQUIRY_STATUS.QUOTE_READY],
  },
  {
    key: 'sent',
    label: 'Quote Sent',
    icon: Send,
    match: [ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE],
  },
  {
    key: 'accepted',
    label: 'Customer Accepted',
    icon: CheckCircle2,
    match: [ENQUIRY_STATUS.CUSTOMER_ACCEPTED],
  },
  {
    key: 'confirmed',
    label: 'Confirmed',
    icon: BadgeCheck,
    match: [
      ENQUIRY_STATUS.CONFIRMED,
      ENQUIRY_STATUS.IN_PROGRESS,
      ENQUIRY_STATUS.COMPLETED,
    ],
  },
];

/** Statuses that stop the journey before Confirmed. */
const HALTED = [ENQUIRY_STATUS.CANCELLED, ENQUIRY_STATUS.CUSTOMER_REJECTED];

/**
 * Resolve the current stage index from the server status.
 * An unrecognised status falls back to stage 0 rather than "all done".
 */
function stageIndexFor(status) {
  const i = STAGES.findIndex((s) => s.match.includes(status));
  return i === -1 ? 0 : i;
}

/**
 * Build the per-stage visual state.
 * @returns {{stages: Array, halted: boolean, reached: number}}
 */
export function buildLifecycle(status) {
  const halted = HALTED.includes(status);
  const current = stageIndexFor(status);

  // A finished journey (CONFIRMED / IN_PROGRESS / COMPLETED) has no stage left
  // to point at, so the last stage reads DONE rather than permanently "NOW".
  const journeyComplete = [
    ENQUIRY_STATUS.CONFIRMED,
    ENQUIRY_STATUS.IN_PROGRESS,
    ENQUIRY_STATUS.COMPLETED,
  ].includes(status);

  const stages = STAGES.map((stage, i) => {
    let state;
    if (halted) {
      // Everything past the last real stage is unreachable, not "pending".
      if (i < current) state = 'done';
      else if (i === current) state = 'halted';
      else state = 'unreachable';
    } else if (i < current) {
      state = 'done';
    } else if (i === current) {
      state = journeyComplete ? 'done' : 'now';
    } else {
      state = 'next';
    }
    return { ...stage, state, index: i };
  });

  return { stages, halted, reached: current };
}

/* ── Cell renderers ──────────────────────────────────────────────────────── */

const CIRCLE = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  now: 'border-amber-500 bg-white text-amber-600 ring-4 ring-amber-500/15',
  next: 'border-slate-300 bg-white text-slate-400',
  halted: 'border-slate-300 bg-slate-100 text-slate-500',
  unreachable: 'border-slate-200 bg-white text-slate-300',
};

const LABEL = {
  done: 'text-text',
  now: 'text-text',
  next: 'text-muted',
  halted: 'text-muted',
  unreachable: 'text-slate-300',
};

const CHIP = {
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  now: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  next: 'bg-slate-100 text-slate-500 ring-slate-500/10',
  halted: 'bg-slate-100 text-slate-600 ring-slate-500/10',
  unreachable: 'bg-slate-50 text-slate-400 ring-slate-400/10',
};

const CHIP_TEXT = {
  done: 'DONE',
  now: 'NOW',
  next: 'NEXT',
  halted: 'STOPPED',
  unreachable: '—',
};

function StageCell({ stage }) {
  const Icon = stage.icon;
  return (
    <div className="flex w-[108px] shrink-0 flex-col items-center gap-2 px-1 text-center sm:w-[132px]">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${CIRCLE[stage.state]}`}
        aria-hidden="true"
      >
        {stage.state === 'done' ? (
          <Check className="h-4 w-4" strokeWidth={3.25} />
        ) : stage.state === 'halted' ? (
          <X className="h-4 w-4" strokeWidth={3.25} />
        ) : (
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        )}
      </span>

      <span
        className={`text-[11.5px] font-semibold leading-tight ${
          stage.state === 'now' ? 'text-text' : LABEL[stage.state]
        }`}
      >
        {stage.label}
      </span>

      <span
        className={`rounded px-1.5 py-px text-[9px] font-bold tracking-wider ring-1 ring-inset ${
          CHIP[stage.state]
        }`}
      >
        {CHIP_TEXT[stage.state]}
      </span>
    </div>
  );
}

function Connector({ complete }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-[18px] h-px w-5 shrink-0 sm:w-8 ${
        complete ? 'bg-emerald-400' : 'bg-slate-200'
      }`}
    />
  );
}

/**
 * The rail itself.
 * @param {{status: string}} props
 */
export default function EnquiryLifecycleRail({ status }) {
  const { stages } = buildLifecycle(status);
  const current = stages.find((s) => s.state === 'now');

  return (
    <nav aria-label="Enquiry lifecycle">
      <ol className="overflow-x-auto pb-1">
        <li className="flex min-w-max items-start">
          {stages.map((stage, i) => (
            <React.Fragment key={stage.key}>
              <StageCell stage={stage} />
              {i < stages.length - 1 ? (
                <Connector complete={stage.state === 'done' && stages[i + 1].state !== 'unreachable'} />
              ) : null}
            </React.Fragment>
          ))}
        </li>
      </ol>
      <span className="sr-only">
        Current stage: {current ? current.label : 'Journey complete'}
      </span>
    </nav>
  );
}

export { STAGES as LIFECYCLE_STAGES };
