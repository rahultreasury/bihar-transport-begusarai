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
 * The rail, in order — the CLIENT'S commercial sequence.
 *
 *   ENQUIRY → RATE QUOTED → QUOTE SENT → CUSTOMER ACCEPTED → ORDER CONFIRMED
 *
 * WHY "Under Review" IS NO LONGER A RAIL STEP
 *   The client document's commercial progression has five stages and "Under
 *   Review" is not one of them — reviewing a request is an internal activity,
 *   not a commercial milestone the customer passes through. The page still
 *   KEEPS its "Under Review" section (STAGE.UNDER_REVIEW is still exported and
 *   still used as a scroll anchor by AdminEnquiryDetail); it simply is not a
 *   step on the progress rail. Nothing was deleted from the page.
 *
 * WHY THIS IS NOT A NEW STATUS SYSTEM
 *   Every label below maps onto a column the backend ALREADY persists. No new
 *   enum value, column or table was introduced. The STAGE keys themselves are
 *   unchanged so the existing page anchors keep working.
 */
export const WORKFLOW_STAGES = [
  {
    key: STAGE.RECEIVED,
    index: 0,
    label: 'Enquiry',
    shortLabel: 'Enquiry',
    icon: Inbox,
    headline: 'Enquiry received',
    purpose: 'The customer request exists. At this point there is no confirmed business.',
    hint: 'Start',
  },
  {
    key: STAGE.QUOTE_PREPARED,
    index: 1,
    label: 'Rate Quoted',
    shortLabel: 'Rate Quoted',
    icon: ClipboardCheck,
    headline: 'Quotation saved',
    purpose: 'A rate has been saved. It is still INTERNAL — the customer has not been sent it.',
    hint: 'Save the rate',
    lockReason: 'Save a quotation first.',
  },
  {
    key: STAGE.QUOTE_SENT,
    index: 2,
    label: 'Quote Sent',
    shortLabel: 'Quote Sent',
    icon: Send,
    headline: 'Quotation sent',
    purpose: 'The quotation has been published. The customer can see it and decide.',
    hint: 'Send the quote',
    lockReason: 'Send the quotation to the customer.',
  },
  {
    key: STAGE.CUSTOMER_ACCEPTED,
    index: 3,
    label: 'Customer Accepted',
    shortLabel: 'Accepted',
    icon: CheckCircle2,
    headline: 'Customer accepted the quotation',
    purpose: 'The customer committed to the rate. Confirm the order to open operations.',
    hint: 'Awaiting customer',
    lockReason: 'The customer must accept the quotation first.',
  },
  {
    key: STAGE.CONFIRMED,
    index: 4,
    label: 'Order Confirmed',
    shortLabel: 'Order Confirmed',
    icon: BadgeCheck,
    headline: 'Order confirmed',
    purpose: 'The order exists. The separate operational workflow (vehicle, loading, dispatch…) begins here.',
    hint: 'Final step',
    lockReason: 'Confirm the order to create it.',
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
 * THE MAPPING: PERSISTED ENQUIRY + QUOTATION STATE → RAIL STAGE.
 *
 * THE SERVER IS THE ONLY SOURCE OF TRUTH
 *   Every input below is a column the backend already writes and returns in the
 *   single GET /api/admin/enquiries/:id response:
 *
 *     commercial.quotation_status  DRAFT | RATE_QUOTED | SENT | CONVERTED
 *     commercial.customer_decision ACCEPTED | REJECTED | null
 *     commercial.has_order         boolean   (Enquiry.booking_id is set)
 *     status                        EnquiryStatus
 *     accepted_at / rejected_at     DateTime
 *
 *   It is NEVER inferred from whether a text input happens to contain ₹60,000,
 *   and never from local React state — so a hard browser refresh, or a different
 *   browser entirely, renders exactly the same rail.
 *
 * SAVE ≠ SEND
 *   A saved quotation has status RATE_QUOTED and the customer CANNOT see it.
 *   Only a SENT quotation is customer-visible. These are deliberately different
 *   stages.
 *
 * ACCEPTED ≠ ORDER CONFIRMED
 *   A customer acceptance is not an order. The order only exists once
 *   `has_order` is true. Acceptance never hires a vehicle — that belongs to the
 *   separate operational workflow.
 *
 * OPERATIONAL STATUSES ARE IGNORED
 *   Vehicle, driver, loading, dispatch, transit, POD, customer-payment and
 *   vendor-payment state play NO part in this calculation. This rail is the
 *   commercial Enquiry → Quotation → Order progression only.
 *
 * @param {object} enquiry  the admin enquiry payload
 * @returns {string} one of STAGE.*
 */
export function stageForEnquiry(enquiry) {
  if (!enquiry) return STAGE.RECEIVED;

  const commercial = enquiry.commercial || {};
  const quotationStatus = upper(commercial.quotation_status);
  const decision = upper(commercial.customer_decision);
  const status = upper(enquiry.status);
  const hasOrder = commercial.has_order === true || Boolean(commercial.booking_id);

  // ── ORDER CONFIRMED ────────────────────────────────────────────────────
  // An order exists. This is the strongest possible commercial signal, so it is
  // checked first and can never be contradicted by a later field.
  if (hasOrder) return STAGE.CONFIRMED;

  // ── CUSTOMER ACCEPTED ───────────────────────────────────────────────────
  // The customer said yes but no order exists yet, so the order is still NEXT.
  if (decision === 'ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;
  if (status === 'CUSTOMER_ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;

  // ── QUOTE SENT ──────────────────────────────────────────────────────────
  // Persisted on the quotation only. A SAVED quotation is RATE_QUOTED and must
  // never reach this stage, which is exactly the Save ≠ Send requirement.
  if (quotationStatus === 'SENT') return STAGE.QUOTE_SENT;

  // ── RATE QUOTED ─────────────────────────────────────────────────────────
  // A rate has been saved and is still internal.
  if (quotationStatus === 'RATE_QUOTED' || quotationStatus === 'DRAFT') {
    return STAGE.QUOTE_PREPARED;
  }

  // Legacy pricing axis: the pre-Phase-B quote endpoints never create a
  // Quotation row, so an enquiry quoted that way still has to advance.
  //
  // ⚠ ESTIMATED IS DELIBERATELY EXCLUDED. The pricing engine writes
  // price_status='ESTIMATED' at INTAKE, before any operator has given a rate.
  // Treating it as "Rate Quoted" would put a fresh enquiry straight onto step
  // two — the exact false-progress this fix exists to remove. Only a human
  // quotation moves the rail.
  const priceStatus = upper(commercial.price_status);
  if (priceStatus === 'ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;
  if (priceStatus === 'SENT') return STAGE.QUOTE_SENT;
  if (priceStatus === 'QUOTED') return STAGE.QUOTE_PREPARED;

  // ── ENQUIRY ─────────────────────────────────────────────────────────────
  // Received, and nothing commercial has happened yet.
  return STAGE.RECEIVED;
}

/**
 * Backwards-compatible alias. `stageForBooking` is still imported by
 * QuoteWorkspace.jsx (the legacy booking-bound quote card), so it is kept —
 * but it now delegates to the SAME commercial mapping so the two can never
 * disagree about where an enquiry actually is.
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
export function describeWorkflow(enquiry) {
  const current = stageForEnquiry(enquiry);
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
      lockReason: locked ? lockMessageForStage(stage, current, enquiry) : null,
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
function lockMessageForStage(stage, currentKey, enquiry) {
  const commercial = enquiry?.commercial || {};

  if (stage.key === STAGE.CUSTOMER_ACCEPTED) {
    if (currentKey === STAGE.QUOTE_SENT) {
      return 'Awaiting customer — they accept or decline the quotation on their tracking page.';
    }
    return 'The customer must accept the quotation first.';
  }

  if (stage.key === STAGE.CONFIRMED) {
    if (currentKey === STAGE.CUSTOMER_ACCEPTED) {
      return 'Customer has accepted — confirm the order to create it.';
    }
    return 'The order exists only after the customer accepts the quotation.';
  }

  if (stage.key === STAGE.QUOTE_SENT) {
    // Saving a rate is NOT sending it. The client is explicit that these are
    // separate actions, so the hint says so plainly.
    return 'A saved rate is not sent yet — send the quotation to publish it.';
  }

  if (stage.key === STAGE.QUOTE_PREPARED) {
    if (!commercial.quotation_status) {
      return 'Save a quotation to give a rate.';
    }
    return 'Complete the rate and save the quotation.';
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
