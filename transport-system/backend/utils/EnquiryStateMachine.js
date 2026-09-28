/**
 * EnquiryStateMachine
 * ---------------------------------------------------------------------------
 * Single source of truth for Enquiry lifecycle transitions.
 *
 * This is the PRE-BOOKING request state machine. It is deliberately separate
 * from BookingStateMachine (which governs the operational booking/trip) because
 * the enquiry has a distinct concern: an admin must assign resources and enter
 * a final price BEFORE the customer commits to anything.
 *
 *   ENQUIRY_SUBMITTED
 *     → ADMIN_REVIEW
 *     → ASSIGNMENT_PENDING
 *     → VEHICLE_ASSIGNED
 *     → DRIVER_ASSIGNED
 *     → QUOTE_READY
 *     → AWAITING_CUSTOMER_ACCEPTANCE
 *     → CUSTOMER_ACCEPTED
 *     → CONFIRMED                       (Booking row created here)
 *     → IN_PROGRESS
 *     → COMPLETED
 *
 * Terminal states: CUSTOMER_REJECTED, CANCELLED, COMPLETED
 *
 * Rules
 *   - Invalid transitions throw ValidationError.
 *   - Cancellation is allowed from every pre-terminal state (customer may
 *     always walk away before dispatch).
 *   - Once CONFIRMED/IN_PROGRESS, only an ADMIN may cancel (the customer must
 *     call customer care) — this is what stops a customer silently killing a
 *     loaded vehicle, and mirrors the "driver cannot unilaterally cancel" rule.
 *   - No status is ever derived from client input: the caller reads the
 *     persisted status, calls assertTransition, and writes the result.
 */

const { ValidationError } = require('./AppError');

const ENQUIRY_STATUSES = [
  'ENQUIRY_SUBMITTED',
  'ADMIN_REVIEW',
  'ASSIGNMENT_PENDING',
  'VEHICLE_ASSIGNED',
  'DRIVER_ASSIGNED',
  'QUOTE_READY',
  'AWAITING_CUSTOMER_ACCEPTANCE',
  'CUSTOMER_ACCEPTED',
  'CUSTOMER_REJECTED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

const TERMINAL_STATUSES = ['CUSTOMER_REJECTED', 'CANCELLED', 'COMPLETED'];

/**
 * Forward (happy-path) transitions.
 *
 * DESIGN RULE: the lifecycle is monotonic FORWARD, and an admin may legitimately
 * perform several steps in one action. Assigning a vehicle and driver together
 * is one click; it must not require driving the row through ASSIGNMENT_PENDING
 * first. So each earlier stage may move directly to any LATER stage.
 *
 * What is still blocked, and why it matters:
 *   • Nothing can reach CONFIRMED without passing through
 *     AWAITING_CUSTOMER_ACCEPTANCE, so a trip can never be confirmed without the
 *     customer accepting a price.
 *   • AWAITING_CUSTOMER_ACCEPTANCE cannot be skipped from an early stage —
 *     QUOTE_READY must be reached first, which is exactly where a final price
 *     is recorded.
 *   • Terminal states are final.
 *   • A confirmed trip cannot be silently un-quoted.
 *
 * `cancelled` is additionally permitted from any non-terminal state — see
 * canCancel() — so it is not repeated here.
 */
const ALLOWED_TRANSITIONS = {
  ENQUIRY_SUBMITTED: ['ADMIN_REVIEW', 'ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY'],
  ADMIN_REVIEW: ['ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY'],
  ASSIGNMENT_PENDING: ['ADMIN_REVIEW', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY'],
  VEHICLE_ASSIGNED: ['ASSIGNMENT_PENDING', 'DRIVER_ASSIGNED', 'QUOTE_READY'],
  DRIVER_ASSIGNED: ['ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED', 'QUOTE_READY'],
  QUOTE_READY: ['AWAITING_CUSTOMER_ACCEPTANCE', 'VEHICLE_ASSIGNED'],
  AWAITING_CUSTOMER_ACCEPTANCE: ['CUSTOMER_ACCEPTED', 'CUSTOMER_REJECTED', 'QUOTE_READY'],
  CUSTOMER_ACCEPTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CUSTOMER_REJECTED: [],
  CANCELLED: [],
};

/**
 * Statuses from which the customer may still cancel on their own (self-service).
 * Once the trip is confirmed the customer must contact customer care, because
 * a vehicle + driver are already committed to the load.
 */
const CUSTOMER_CANCELLABLE_STATUSES = [
  'ENQUIRY_SUBMITTED',
  'ADMIN_REVIEW',
  'ASSIGNMENT_PENDING',
  'VEHICLE_ASSIGNED',
  'DRIVER_ASSIGNED',
  'QUOTE_READY',
  'AWAITING_CUSTOMER_ACCEPTANCE',
];

/**
 * Assert a transition is legal, or throw.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {ValidationError}
 */
function assertTransition(fromStatus, toStatus) {
  if (!ENQUIRY_STATUSES.includes(fromStatus)) {
    throw new ValidationError({ message: `Invalid enquiry status: ${fromStatus}` });
  }
  if (!ENQUIRY_STATUSES.includes(toStatus)) {
    throw new ValidationError({ message: `Invalid enquiry status: ${toStatus}` });
  }
  if (fromStatus === toStatus) {
    throw new ValidationError({
      message: `Enquiry is already in status ${toStatus}`,
    });
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ValidationError({
      message: `Cannot move enquiry from ${fromStatus} to ${toStatus}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
    });
  }
}

/**
 * Non-throwing variant, for guards and UI hints.
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
function canTransition(fromStatus, toStatus) {
  if (!ENQUIRY_STATUSES.includes(fromStatus) || !ENQUIRY_STATUSES.includes(toStatus)) return false;
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Find the shortest legal path of statuses from `from` to `to`.
 *
 * Used where an action legitimately spans stages. "Send quote to customer" on
 * an enquiry that is sitting at DRIVER_ASSIGNED has to pass through
 * QUOTE_READY — that intermediate state is meaningful (a final price now
 * exists), so the audit trail records it rather than jumping straight to
 * AWAITING_CUSTOMER_ACCEPTANCE.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string[]|null} the statuses to traverse (excluding `from`),
 *   or null when no legal path exists
 */
function shortestPath(from, to) {
  if (from === to) return [];
  if (!ENQUIRY_STATUSES.includes(from) || !ENQUIRY_STATUSES.includes(to)) return null;

  // Breadth-first over the transition graph. The graph is tiny and acyclic
  // apart from the deliberate "go back a step" edges, so this terminates.
  const queue = [[from, []]];
  const seen = new Set([from]);

  while (queue.length) {
    const [current, path] = queue.shift();
    const next = ALLOWED_TRANSITIONS[current] || [];

    for (const candidate of next) {
      if (seen.has(candidate)) continue;
      const nextPath = [...path, candidate];
      if (candidate === to) return nextPath;
      seen.add(candidate);
      queue.push([candidate, nextPath]);
    }
  }

  return null;
}

/**
 * Can this enquiry be cancelled (by the given actor)?
 *
 * @param {string} status
 * @param {'CUSTOMER'|'ADMIN'} actorType
 * @returns {boolean}
 */
function canCancel(status, actorType = 'CUSTOMER') {
  if (isTerminal(status)) return false;
  if (actorType === 'ADMIN') {
    // Admins may cancel any non-terminal enquiry, including a live trip.
    return (ALLOWED_TRANSITIONS[status] || []).includes('cancelled') || status === 'CONFIRMED' || status === 'IN_PROGRESS';
  }
  return CUSTOMER_CANCELLABLE_STATUSES.includes(status);
}

/**
 * Statuses in which the customer must be asked to approve a price.
 * @param {string} status
 * @returns {boolean}
 */
function awaitsCustomerAcceptance(status) {
  return status === 'AWAITING_CUSTOMER_ACCEPTANCE';
}

/**
 * Has the final quote been deliberately PUBLISHED to the customer yet?
 *
 * The single source of truth for "may the customer see the price?". A price
 * saved by an admin is a DRAFT: it lives in `final_quoted_price` from the
 * moment it is typed, but the customer must not learn it until the admin
 * presses "Send Quote to Customer" — that is the act which moves the enquiry
 * to AWAITING_CUSTOMER_ACCEPTANCE and stamps `quoted_at`.
 *
 * This is what stops a draft price from leaking through the customer DTO and
 * the customer /quote endpoint while the admin is still negotiating it.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isQuoteVisibleToCustomer(status) {
  return [
    'AWAITING_CUSTOMER_ACCEPTANCE',
    'CUSTOMER_ACCEPTED',
    'CUSTOMER_REJECTED',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
  ].includes(status);
}

/**
 * Are the resources an admin must commit before a quote counts as
 * "prepared" (i.e. before it can be sent to the customer)?
 *
 * A quote for a load with no truck and no driver is not a quotation the
 * company can honour, so the send endpoint refuses to publish it.
 *
 * @param {{assigned_vehicle_id?:number|null, assigned_driver_id?:number|null}} e
 * @returns {boolean}
 */
function hasRequiredAssignment(e) {
  return Boolean(e && e.assigned_vehicle_id && e.assigned_driver_id);
}

/**
 * Has the customer already committed (used to decide when driver details may
 * become visible on the customer-facing DTO).
 *
 * @param {string} status
 * @returns {boolean}
 */
function isCustomerCommitted(status) {
  return ['CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(status);
}

/**
 * Customer-facing progress stage (1..6) driving the confirmation-page timeline.
 * Returns 0 for statuses the customer should not have reached yet.
 *
 * @param {string} status
 * @returns {number}
 */
function toProgressStage(status) {
  const stage = {
    ENQUIRY_SUBMITTED: 1,
    ADMIN_REVIEW: 2,
    ASSIGNMENT_PENDING: 2,
    VEHICLE_ASSIGNED: 3,
    DRIVER_ASSIGNED: 3,
    QUOTE_READY: 4,
    AWAITING_CUSTOMER_ACCEPTANCE: 5,
    CUSTOMER_ACCEPTED: 6,
    CONFIRMED: 6,
    IN_PROGRESS: 6,
    COMPLETED: 6,
    CUSTOMER_REJECTED: 6,
    CANCELLED: 6,
  };
  return stage[status] || 1;
}

module.exports = {
  ENQUIRY_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  CUSTOMER_CANCELLABLE_STATUSES,
  assertTransition,
  canTransition,
  shortestPath,
  isTerminal,
  canCancel,
  awaitsCustomerAcceptance,
  isCustomerCommitted,
  isQuoteVisibleToCustomer,
  hasRequiredAssignment,
  toProgressStage,
};
