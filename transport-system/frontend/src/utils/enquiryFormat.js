/**
 * enquiryFormat.js
 * ---------------------------------------------------------------------------
 * Presentation helpers for the enquiry module.
 *
 * These exist so the confirmation page, the admin table and the workspace all
 * render the SAME value the same way — an Indian-locale rupee amount, one
 * distance format, one date format. Formatting is kept out of the components so
 * a price can never appear as "61000" on one screen and "₹61,000" on another.
 *
 * Note: this file formats NUMBERS AND DATES ONLY. It has no access to, and
 * renders no, any driver's contact detail — the customer UI simply never asks
 * for one.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format a rupee amount with Indian digit grouping: 61000 → "₹61,000".
 * @param {number|string|null|undefined} value
 * @returns {string} '' when there is no usable number
 */
export function formatINR(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * Format an estimated range: 54495 / 66605 → "₹54,495 – ₹66,605".
 * Falls back to a single value or a "from"/"up to" phrasing when only one
 * bound is known.
 */
export function formatFareRange(min, max) {
  const hasMin = Number.isFinite(Number(min)) && min !== null && min !== '';
  const hasMax = Number.isFinite(Number(max)) && max !== null && max !== '';

  if (hasMin && hasMax) {
    if (Number(min) === Number(max)) return formatINR(min);
    return `${formatINR(min)} – ${formatINR(max)}`;
  }
  if (hasMin) return `from ${formatINR(min)}`;
  if (hasMax) return `up to ${formatINR(max)}`;
  return '';
}

/**
 * Format a distance: 1211 → "1,211 km".
 */
export function formatKm(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${Math.round(n).toLocaleString('en-IN')} km`;
}

/**
 * Format a date as "26 September 2026".
 *
 * UTC BY DESIGN. The backend stores `Enquiry.pickup_date` pinned to UTC
 * midnight so the stored value IS the calendar date the customer chose
 * (see parsePickupDate in services/EnquiryService.js). Formatting that value in
 * the browser's local timezone would shift it: 2026-10-02T00:00:00Z is
 * 05:30 on the 2nd in IST — fine — but 2026-10-02T00:00:00Z rendered in a
 * zone behind UTC would show the 1st. Reading the UTC components guarantees the
 * displayed date always equals the submitted date.
 *
 * The same rule applies to `formatTimestamp`, which renders audit-event times —
 * those are real instants, so they are shown in local time, but the DATE
 * portion of an event always falls on the day it happened locally.
 */
export function formatLongDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Short numeric date: "26 Sep 2026". UTC, for the same reason. */
export function formatShortDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/**
 * Format a time-of-day string ("10:00:00") or Date as "10:00 AM".
 */
export function formatTime12(value) {
  if (!value) return '';
  if (value instanceof Date) {
    let h = value.getHours();
    const m = String(value.getMinutes()).padStart(2, '0');
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${suffix}`;
  }
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value);
  let h = Number(match[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${match[2]} ${suffix}`;
}

/** "26 Sep 2026, 5:20 PM" for the activity feed. */
export function formatTimestamp(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatShortDate(d)}, ${formatTime12(d)}`;
}

/**
 * Combine a numeric value and a unit: (85, 'Bundles') → "85 Bundles".
 */
export function withUnit(value, unit) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  const base = Number.isFinite(n) ? n.toLocaleString('en-IN') : String(value);
  return unit ? `${base} ${unit}` : base;
}

/**
 * Canonical EnquiryStatus lifecycle constants, mirroring
 * backend/utils/EnquiryStateMachine.js.
 *
 * Duplicated in the UI on purpose: the timeline must render instantly on first
 * paint, before any network response arrives. The server remains authoritative —
 * the UI never writes a status, it only displays the one it is given.
 */
export const ENQUIRY_STATUS = {
  ENQUIRY_SUBMITTED: 'ENQUIRY_SUBMITTED',
  ADMIN_REVIEW: 'ADMIN_REVIEW',
  ASSIGNMENT_PENDING: 'ASSIGNMENT_PENDING',
  VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  QUOTE_READY: 'QUOTE_READY',
  AWAITING_CUSTOMER_ACCEPTANCE: 'AWAITING_CUSTOMER_ACCEPTANCE',
  CUSTOMER_ACCEPTED: 'CUSTOMER_ACCEPTED',
  CUSTOMER_REJECTED: 'CUSTOMER_REJECTED',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

/** Terminal statuses — the timeline renders as finished, not as a pause. */
export const TERMINAL_STATUSES = [
  ENQUIRY_STATUS.CUSTOMER_REJECTED,
  ENQUIRY_STATUS.CANCELLED,
  ENQUIRY_STATUS.COMPLETED,
];

/**
 * The six customer-facing progress steps.
 *
 * `match` lists every server status that satisfies the step, so a step is
 * "done" whenever the enquiry has progressed past it — the customer does not
 * need to land on exactly one status to see the tick.
 *
 * `completeOn` is the important refinement: a step can be MATCHED by a status
 * that means the step has FINISHED rather than "is being worked on right now".
 * "Vehicle & Driver Assignment" spans two backend statuses — VEHICLE_ASSIGNED
 * (a truck, still looking for its driver) and DRIVER_ASSIGNED (truck + crew
 * settled). Treating DRIVER_ASSIGNED as "in progress" was what left the badge
 * reading "In progress" forever on a fully assigned shipment. Listing it in
 * `completeOn` ticks the step and hands the active marker to the next one.
 *
 * The state is still derived purely from the server's status — this is a
 * mapping, not a second state machine.
 */
export const TIMELINE_STEPS = [
  {
    key: 'submitted',
    title: 'Request Submitted',
    description: 'We have received your transport request.',
    match: [ENQUIRY_STATUS.ENQUIRY_SUBMITTED],
  },
  {
    key: 'review',
    title: 'Transport Team Reviewing',
    description: 'Our team is checking vehicle availability and pricing.',
    match: [ENQUIRY_STATUS.ADMIN_REVIEW, ENQUIRY_STATUS.ASSIGNMENT_PENDING],
  },
  {
    key: 'assignment',
    title: 'Vehicle & Driver Assignment',
    description: 'We are arranging the right vehicle and crew for your load.',
    match: [ENQUIRY_STATUS.VEHICLE_ASSIGNED, ENQUIRY_STATUS.DRIVER_ASSIGNED],
    // A driver on the job means the assignment is finished — tick it.
    completeOn: [ENQUIRY_STATUS.DRIVER_ASSIGNED],
  },
  {
    key: 'quote',
    // QUOTE_READY is the "quote prepared" state: an admin has entered a final
    // price, but has NOT sent it yet — the customer still sees no number.
    title: 'Quote Prepared',
    description: 'Your confirmed transport price is being prepared.',
    match: [ENQUIRY_STATUS.QUOTE_READY],
  },
  {
    key: 'acceptance',
    // AWAITING_CUSTOMER_ACCEPTANCE is the "quote sent" state: the price is now
    // published and the decision belongs to the customer.
    title: 'Customer Acceptance',
    description: 'Your quote has been sent. Review the price and approve it to confirm your trip.',
    match: [ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE],
  },
  {
    key: 'confirmed',
    title: 'Trip Confirmed',
    description: 'Your trip is confirmed and scheduled.',
    match: [
      ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
      ENQUIRY_STATUS.CONFIRMED,
      ENQUIRY_STATUS.IN_PROGRESS,
      ENQUIRY_STATUS.COMPLETED,
    ],
  },
];

/**
 * Compute the timeline state for a given status.
 *
 * @param {string} status
 * @returns {{steps: Array<{key:string,title:string,description:string,state:'done'|'active'|'pending'|'halted'}>, isTerminal:boolean}}
 */
export function buildTimeline(status) {
  const isTerminal = TERMINAL_STATUSES.includes(status);

  // Which step does the server's status land in? -1 for a status that maps to no
  // step at all (e.g. CANCELLED), which is handled by the halted branch below.
  const matchedIndex = TIMELINE_STEPS.findIndex((s) => s.match.includes(status));
  const reachedIndex = matchedIndex === -1 ? 0 : matchedIndex;

  // If the matched status COMPLETES its step, the step is ticked and the next
  // one becomes the active/current step. Clamped so a completion on the last
  // step (COMPLETED) keeps that last step as the active one.
  const matchedStep = matchedIndex === -1 ? null : TIMELINE_STEPS[matchedIndex];
  const stepIsComplete = Boolean(matchedStep && matchedStep.completeOn?.includes(status));
  const activeIndex = stepIsComplete
    ? Math.min(reachedIndex + 1, TIMELINE_STEPS.length - 1)
    : reachedIndex;

  const steps = TIMELINE_STEPS.map((step, i) => {
    let state;
    if (isTerminal && status !== ENQUIRY_STATUS.COMPLETED) {
      // The journey stopped early: nothing after the reached point is
      // "pending", it is simply halted.
      if (i < reachedIndex) state = 'done';
      else if (i === reachedIndex) state = 'active';
      else state = 'halted';
    } else if (i < activeIndex) {
      state = 'done';
    } else if (i === activeIndex) {
      state = 'active';
    } else {
      state = 'pending';
    }
    return { ...step, state };
  });

  return { steps, isTerminal };
}

/** Human-readable status label for badges. */
export function statusLabel(status) {
  return String(status || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Tailwind classes for a status badge, keyed by lifecycle family. */
export function statusTone(status) {
  switch (status) {
    case ENQUIRY_STATUS.CANCELLED:
    case ENQUIRY_STATUS.CUSTOMER_REJECTED:
      return 'bg-red-50 text-red-700 ring-1 ring-red-200';
    case ENQUIRY_STATUS.COMPLETED:
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
    case ENQUIRY_STATUS.CONFIRMED:
    case ENQUIRY_STATUS.CUSTOMER_ACCEPTED:
    case ENQUIRY_STATUS.IN_PROGRESS:
      return 'bg-green-50 text-green-700 ring-1 ring-green-200';
    case ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE:
      return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
    case ENQUIRY_STATUS.QUOTE_READY:
      return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
    case ENQUIRY_STATUS.VEHICLE_ASSIGNED:
    case ENQUIRY_STATUS.DRIVER_ASSIGNED:
      return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200';
    case ENQUIRY_STATUS.ADMIN_REVIEW:
    case ENQUIRY_STATUS.ASSIGNMENT_PENDING:
      return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200';
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

export default {
  formatINR,
  formatFareRange,
  formatKm,
  formatLongDate,
  formatShortDate,
  formatTime12,
  formatTimestamp,
  withUnit,
  ENQUIRY_STATUS,
  TIMELINE_STEPS,
  TERMINAL_STATUSES,
  buildTimeline,
  statusLabel,
  statusTone,
};
