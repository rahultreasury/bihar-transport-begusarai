/**
 * workflowStages.js
 * ---------------------------------------------------------------------------
 * THE SINGLE SOURCE OF TRUTH for the six-stage admin ENQUIRY rail.
 *
 *   1 Request Received
 *   2 Under Review
 *   3 Quote Prepared
 *   4 Quote Sent
 *   5 Customer Accepted
 *   6 Confirmed
 *
 * THE DATABASE IS THE SOURCE OF TRUTH
 *   The current stage is DERIVED, never stored in the browser. Every value
 *   read below comes from fields the booking module already persists and
 *   already returns from GET /api/admin/bookings/by-number/:number:
 *
 *     quote_status         PENDING | PREPARING | DRIVER_RESERVED |
 *                          VEHICLE_RESERVED | SENT | QUOTE_SENT |
 *                          WAITING_CUSTOMER_APPROVAL | ACCEPTED |
 *                          REJECTED | EXPIRED
 *     status               the operational BookingStatus (pending, confirmed,
 *                          in_transit, delivered, completed, cancelled …)
 *     confirmation_source  CUSTOMER (the customer accepted) | ADMIN (an admin
 *                          explicitly confirmed the booking)
 *
 *   There is deliberately NO parallel status field. If the backend already
 *   persisted something, this file names it — it never invents it.
 *
 * WHY STAGE 5 AND STAGE 6 ARE DISTINGUISHABLE
 *   `acceptQuote()` (customer) flips quote_status to ACCEPTED and, as part of
 *   the same transaction, also sets status='confirmed'. So "the customer said
 *   yes" and "an admin signed the booking off" are genuinely different events
 *   and are recorded differently:
 *     • customer accepted → confirmation_source stays 'CUSTOMER'
 *     • admin confirmed  → BookingService.confirmBooking() sets it to 'ADMIN'
 *   The timestamp pair (confirmed_at vs quote_accepted_at) is used as a
 *   secondary signal so bookings confirmed by any other path still land on the
 *   right stage. Because both signals are persisted columns, the rail is
 *   identical after a hard browser refresh.
 */

import {
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Inbox,
  Send,
} from 'lucide-react';

/** Stable stage keys. Never renumber these — the array order is the rail. */
export const STAGE = {
  RECEIVED: 'RECEIVED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  QUOTE_PREPARED: 'QUOTE_PREPARED',
  QUOTE_SENT: 'QUOTE_SENT',
  CUSTOMER_ACCEPTED: 'CUSTOMER_ACCEPTED',
  CONFIRMED: 'CONFIRMED',
};

/**
 * The rail, in order.
 *
 * `hint` is the short, honest line shown under a not-yet-reached step. It is
 * deliberately NOT the word "LOCKED": the operator should see the path forward
 * ("Next step", "Requires driver", "Awaiting customer") rather than a wall.
 * `lockReason` is the longer explanation used only if someone asks why.
 */
export const WORKFLOW_STAGES = [
  {
    key: STAGE.RECEIVED,
    index: 0,
    label: 'Request Received',
    shortLabel: 'Received',
    icon: Inbox,
    headline: 'Original customer request',
    purpose: 'Exactly what the customer submitted, read-only.',
    hint: 'Start',
  },
  {
    key: STAGE.UNDER_REVIEW,
    index: 1,
    label: 'Under Review',
    shortLabel: 'Review',
    icon: FileSearch,
    headline: 'Assign driver, set the final quote',
    purpose: 'Evaluate the request and arrange the resources behind it.',
    hint: 'Next step',
    lockReason: 'Start the review to begin assigning a driver.',
  },
  {
    key: STAGE.QUOTE_PREPARED,
    index: 2,
    label: 'Quote Prepared',
    shortLabel: 'Prepared',
    icon: ClipboardCheck,
    headline: 'Quote preview',
    purpose: 'Review the complete quote before it reaches the customer.',
    hint: 'Requires quote',
    lockReason: 'Assign a driver and set a final price at Under Review first.',
  },
  {
    key: STAGE.QUOTE_SENT,
    index: 3,
    label: 'Quote Sent',
    shortLabel: 'Sent',
    icon: Send,
    headline: 'Published quote',
    purpose: 'The quote has been published to the customer and is awaiting a decision.',
    hint: 'Awaiting send',
    lockReason: 'Prepare the quote before sending it to the customer.',
  },
  {
    key: STAGE.CUSTOMER_ACCEPTED,
    index: 4,
    label: 'Customer Accepted',
    shortLabel: 'Accepted',
    icon: CheckCircle2,
    headline: 'Customer accepted the quote',
    purpose: 'The customer committed. Confirm the booking to release it for dispatch.',
    hint: 'Awaiting customer',
    lockReason: 'The customer must accept the quote from their tracking page first.',
  },
  {
    key: STAGE.CONFIRMED,
    index: 5,
    label: 'Confirmed',
    shortLabel: 'Confirmed',
    icon: BadgeCheck,
    headline: 'Booking confirmed',
    purpose: 'The booking is committed. Hand it over to trip operations.',
    hint: 'Final step',
    lockReason: 'Confirm the booking before releasing it to trip operations.',
  },
];

export const STAGE_KEYS = WORKFLOW_STAGES.map((s) => s.key);

/** Human labels for the raw backend values, shown in the side panel. */
export const QUOTE_STATUS_LABEL = {
  PENDING: 'Request received',
  PREPARING: 'Under review',
  DRIVER_RESERVED: 'Quote prepared',
  VEHICLE_RESERVED: 'Quote prepared',
  SENT: 'Quote sent',
  QUOTE_SENT: 'Quote sent',
  WAITING_CUSTOMER_APPROVAL: 'Quote sent',
  ACCEPTED: 'Customer accepted',
  REJECTED: 'Customer rejected',
  EXPIRED: 'Quote expired',
};

/** Operational statuses that are unambiguously past the workflow. */
const TERMINAL_OPERATIONAL_STATUSES = [
  'in_transit',
  'out_for_delivery',
  'delivered',
  'completed',
];

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function lower(value) {
  return String(value ?? '').trim().toLowerCase();
}

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The raw quote_status as the backend stores it, defaulting like the DB does. */
export function quoteStatus(booking) {
  return upper(booking?.quote_status) || 'PENDING';
}

/** The raw operational status as the backend stores it. */
export function bookingStatus(booking) {
  return lower(booking?.status) || 'pending';
}

/** A quote the customer has already decided on (one way or the other). */
export function isQuoteDecided(booking) {
  const q = quoteStatus(booking);
  return q === 'ACCEPTED' || q === 'REJECTED' || q === 'EXPIRED';
}

export function isCustomerAccepted(booking) {
  return quoteStatus(booking) === 'ACCEPTED';
}

export function isCustomerRejected(booking) {
  return quoteStatus(booking) === 'REJECTED';
}

export function isQuoteExpired(booking) {
  return quoteStatus(booking) === 'EXPIRED';
}

/**
 * Did an ADMIN explicitly confirm this booking?
 *
 * Primary signal is the persisted `confirmation_source = 'ADMIN'`, which only
 * BookingService.confirmBooking() writes. The timestamp comparison is a
 * fallback for a booking confirmed through some other path: the customer's
 * accept writes confirmed_at and quote_accepted_at from the same `now`, so
 * they are equal, while a later confirmation is strictly greater.
 */
export function isAdminConfirmed(booking) {
  if (upper(booking?.confirmation_source) === 'ADMIN') return true;

  const acceptedAt = toTime(booking?.quote_accepted_at);
  const confirmedAt = toTime(booking?.confirmed_at);
  if (acceptedAt != null && confirmedAt != null) return confirmedAt > acceptedAt;

  return false;
}

/**
 * THE mapping: booking row → workflow stage key.
 *
 * @param {object} booking
 * @returns {string} one of STAGE.*
 */
export function stageForBooking(booking) {
  if (!booking) return STAGE.RECEIVED;

  // Once goods are moving the booking is operationally past the rail.
  if (TERMINAL_OPERATIONAL_STATUSES.includes(bookingStatus(booking))) {
    return STAGE.CONFIRMED;
  }

  const q = quoteStatus(booking);

  switch (q) {
    case 'PENDING':
      return STAGE.RECEIVED;

    case 'PREPARING':
      return STAGE.UNDER_REVIEW;

    case 'DRIVER_RESERVED':
    case 'VEHICLE_RESERVED':
      return STAGE.QUOTE_PREPARED;

    case 'SENT':
    case 'QUOTE_SENT':
    case 'WAITING_CUSTOMER_APPROVAL':
      return STAGE.QUOTE_SENT;

    case 'ACCEPTED':
      // Customer said yes. Stage 6 only once an admin confirmed.
      return isAdminConfirmed(booking) ? STAGE.CONFIRMED : STAGE.CUSTOMER_ACCEPTED;

    case 'REJECTED':
    case 'EXPIRED':
      // The rail stopped at the quote stage; surface the truth rather than
      // pretending the customer is still deciding.
      return STAGE.QUOTE_SENT;

    default:
      return STAGE.RECEIVED;
  }
}

/** Zero-based position of a stage on the rail. */
export function stageIndex(key) {
  const found = WORKFLOW_STAGES.find((s) => s.key === key);
  return found ? found.index : 0;
}

/**
 * Per-stage state for the rail: reached / current / locked.
 *
 * @param {object} booking
 * @returns {{ current: string, currentIndex: number, stages: Array }}
 */
export function describeWorkflow(booking) {
  const current = stageForBooking(booking);
  const currentIndex = stageIndex(current);

  const stages = WORKFLOW_STAGES.map((stage) => {
    const done = stage.index < currentIndex;
    const active = stage.index === currentIndex;
    const locked = stage.index > currentIndex;

    return {
      ...stage,
      state: done ? 'done' : active ? 'active' : 'upcoming',
      done,
      active,
      upcoming: locked,
      // Kept as `locked` too so existing consumers keep working.
      locked,
      // Why this stage is not reached yet — a plain explanation, never a write.
      lockReason: locked ? lockMessageForStage(stage, current, booking) : null,
    };
  });

  return { current, currentIndex, stages };
}

/**
 * A specific, honest reason for a stage the enquiry has not reached.
 *
 * Derived from real state, so the hint changes as the admin works:
 *   no driver yet      → "Requires driver"
 *   driver but no price→ "Requires quote"
 *   quote sent         → "Awaiting customer"
 */
function lockMessageForStage(stage, currentKey, booking) {
  if (stage.key === STAGE.CUSTOMER_ACCEPTED || stage.key === STAGE.CONFIRMED) {
    if (currentKey === STAGE.QUOTE_SENT) {
      return 'Awaiting customer — they accept or reject the quote from their tracking page.';
    }
  }
  if (stage.key === STAGE.QUOTE_PREPARED || stage.key === STAGE.QUOTE_SENT) {
    if (currentKey === STAGE.UNDER_REVIEW && !booking?.driver_id) {
      return 'Requires driver — assign a driver at Under Review.';
    }
    if (Number(booking?.final_price) <= 0) {
      return 'Requires quote — set a final price at Under Review.';
    }
  }
  return stage.lockReason || 'Complete the previous stage first.';
}

/**
 * Can the admin open this stage's workspace?
 *
 * Locked stages are still *clickable* — the click explains what is missing.
 * Only the mutation guard below stops an illegal write.
 */
export function canOpenStage(workflow, key) {
  const stage = workflow?.stages?.find((s) => s.key === key);
  return Boolean(stage);
}

/** Actions each stage may present. Purely presentational emphasis. */
export const STAGE_ACTIONS = {
  [STAGE.RECEIVED]: ['startReview'],
  [STAGE.UNDER_REVIEW]: ['assignDriver', 'prepareQuote'],
  [STAGE.QUOTE_PREPARED]: ['editQuote', 'editAssignment', 'sendQuote'],
  [STAGE.QUOTE_SENT]: ['viewSentQuote', 'viewCustomerResponse'],
  [STAGE.CUSTOMER_ACCEPTED]: ['confirmBooking'],
  [STAGE.CONFIRMED]: ['createTrip'],
};

/** A one-line status sentence for the side panel, derived from the DB. */
export function statusSentence(booking) {
  const q = quoteStatus(booking);
  const s = bookingStatus(booking);

  if (s === 'cancelled') return 'This booking was cancelled.';
  if (s === 'completed') return 'This booking has been completed.';
  if (s === 'delivered') return 'This booking has been delivered.';
  if (s === 'in_transit') return 'This booking is in transit.';

  if (q === 'REJECTED') return 'The customer rejected this quote.';
  if (q === 'EXPIRED') return 'This quote expired before the customer responded.';

  return `${QUOTE_STATUS_LABEL[q] || 'Request received'} · booking status ${s}`;
}

export default WORKFLOW_STAGES;
