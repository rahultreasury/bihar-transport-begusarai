/**
 * TripStateMachine
 * ---------------------------------------------------------------------------
 * Single source of truth for TRIP status transitions.
 *
 * This follows the same pattern the repository already uses for
 * BookingStateMachine.js and EnquiryStateMachine.js — a plain, pure module
 * with no database access, so it is directly unit-testable.
 *
 * BEFORE Phase 4 there was NO trip state machine at all:
 * `TripService.updateTripStatus()` only checked that the requested status was
 * a member of the enum, which meant ANY trip could jump to ANY status,
 * including backwards. The operational reality is a sequence, and this file
 * is that sequence written down.
 *
 * THE LIFECYCLE
 *
 *     PENDING ─► ASSIGNED ─► TO_LOADING_POINT ─► AT_LOADING_POINT
 *                                                     │
 *                                                     ▼
 *                              IN_TRANSIT ◄── DISPATCHED ◄── LOADED
 *
 * CANCELLATION is allowed from any non-terminal state, which is what the
 * existing "Cancel Trip" UI control relies on.
 *
 * THE LEGACY SHORT-CUT (and why it exists)
 *   The existing admin UI has always offered a direct "Mark In Transit"
 *   action, and 3 live trips are already sitting in IN_TRANSIT having been put
 *   there that way. Removing that ability would break a shipped workflow that
 *   Phase 4 was told not to redesign, so it is kept — but it is now an
 *   EXPLICIT, DELIBERATE, AUDITED edge in this table rather than an accident
 *   of having no table at all:
 *
 *     ASSIGNED ─► IN_TRANSIT        (legacy admin short-cut, audited)
 *     DELIVERED ─► IN_TRANSIT       (legacy admin short-cut, audited)
 *
 *   `isLegacySkip()` identifies those edges so the caller can record in the
 *   audit log that the intermediate loading/dispatch steps were bypassed. The
 *   dedicated operational endpoints (TripOperationalService) never use them —
 *   there, the full chain is mandatory.
 *
 * RULES
 *   - Invalid transitions raise ValidationError.
 *   - Terminal states (COMPLETED, CANCELLED) accept nothing further.
 *   - Backwards transitions are refused. LOADED can never become
 *     AT_LOADING_POINT again, because goods do not un-load on the road.
 */

const { ValidationError } = require('./AppError');

/** Mirrors the Prisma `TripStatus` enum exactly. */
const TRIP_STATUSES = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
  'LOADED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

/** The ordered operational chain, used for progress reporting. */
const OPERATIONAL_SEQUENCE = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
  'LOADED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
]);

const TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED']);

/**
 * Edges that skip the loading/dispatch chain. Preserved from the pre-Phase-4
 * UI. Audited whenever they are used.
 */
const LEGACY_SKIP_TRANSITIONS = Object.freeze([
  { from: 'ASSIGNED', to: 'IN_TRANSIT' },
  { from: 'PENDING', to: 'IN_TRANSIT' },
  { from: 'DELIVERED', to: 'IN_TRANSIT' },
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: ['ASSIGNED', 'IN_TRANSIT', 'CANCELLED'],
  ASSIGNED: ['TO_LOADING_POINT', 'IN_TRANSIT', 'CANCELLED'],
  TO_LOADING_POINT: ['AT_LOADING_POINT', 'CANCELLED'],
  AT_LOADING_POINT: ['LOADED', 'CANCELLED'],
  LOADED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  // DELIVERED stays cancellable and reversible: both edges existed before
  // Phase 4 (when any status could move to any status), and removing them
  // would break the shipped "Cancel Trip" control on a delivered trip.
  DELIVERED: ['COMPLETED', 'IN_TRANSIT', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

/**
 * Validate a transition.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {ValidationError} when the transition is not permitted
 */
function validateTransition(fromStatus, toStatus) {
  if (!TRIP_STATUSES.includes(fromStatus)) {
    throw new ValidationError(`Invalid current trip status: ${fromStatus}`);
  }
  if (!TRIP_STATUSES.includes(toStatus)) {
    throw new ValidationError(
      `Invalid target trip status: ${toStatus}. Valid statuses: ${TRIP_STATUSES.join(', ')}`
    );
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    const reason = allowed.length === 0
      ? `${fromStatus} is a terminal state`
      : `Allowed from ${fromStatus}: ${allowed.join(', ')}`;
    throw new ValidationError(`Cannot move trip from ${fromStatus} to ${toStatus}. ${reason}`);
  }
}

/**
 * Validate a transition for the DEDICATED OPERATIONAL ENDPOINTS.
 *
 * PHASE 5 FIX. `validateTransition()` above is the permissive table, because the
 * shipped `PATCH /trips/:id/status` control has always been able to jump
 * straight to "in transit", and Phase 4 was told not to redesign it.
 *
 * The operational endpoints, however, are the CANONICAL path: pressing
 * "Start Transit" there asserts that the vehicle was actually dispatched, so it
 * must not inherit the legacy short-cut. Without this function
 * `TripOperationalService._perform` called `validateTransition()` and therefore
 * happily accepted PENDING → IN_TRANSIT and LOADED → IN_TRANSIT — the
 * "canonical operational path" was no stricter than the legacy control it was
 * supposed to sit alongside.
 *
 * The ONLY edges this refuses are the legacy short-cuts. Every genuine
 * operational edge behaves exactly as before, so no Phase 4 workflow changes.
 * `TripService.updateTripStatus()` still calls `validateTransition()` and the
 * shipped short-cut still works.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {ValidationError} when the transition is not permitted, or when it is
 *         only reachable through a legacy short-cut
 */
function validateOperationalTransition(fromStatus, toStatus) {
  validateTransition(fromStatus, toStatus);

  if (isLegacySkip(fromStatus, toStatus)) {
    throw new ValidationError(
      `Cannot move trip from ${fromStatus} to ${toStatus} through the operational endpoint: `
      + 'that edge is a legacy short-cut and is only available via the status update API. '
      + 'Complete the preceding operational steps first.'
    );
  }
}

/**
 * Is this status terminal?
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Does this edge bypass the loading/dispatch chain?
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
function isLegacySkip(fromStatus, toStatus) {
  return LEGACY_SKIP_TRANSITIONS.some((t) => t.from === fromStatus && t.to === toStatus);
}

/**
 * Every status this trip could legally move to next.
 * @param {string} status
 * @returns {string[]}
 */
function allowedNext(status) {
  return [...(ALLOWED_TRANSITIONS[status] || [])];
}

/**
 * True when the trip has already been through the operational chain far
 * enough that a short-cut is no longer possible.
 * @param {string} status
 * @returns {boolean}
 */
function hasPassedDispatch(status) {
  return ['LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(status);
}

/**
 * How far along the operational sequence a trip is.
 * @param {string} status
 * @returns {number} 0-based index, or -1 when the status is off the chain
 */
function stepIndex(status) {
  return OPERATIONAL_SEQUENCE.indexOf(status);
}

module.exports = {
  TRIP_STATUSES,
  OPERATIONAL_SEQUENCE,
  TERMINAL_STATUSES,
  LEGACY_SKIP_TRANSITIONS,
  ALLOWED_TRANSITIONS,
  validateTransition,
  validateOperationalTransition,
  isTerminal,
  isLegacySkip,
  allowedNext,
  hasPassedDispatch,
  stepIndex,
};
