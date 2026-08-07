/**
 * BookingStateMachine
 * Single source of truth for booking status transitions.
 *
 * Enterprise booking lifecycle:
 *   pending → quote_sent → confirmed → pickup_started → pickup_completed
 *   → in_transit → out_for_delivery → delivered → completed
 *
 * Alternative terminal states:
 *   rejected (from quote_sent — customer rejected the final quote)
 *   cancelled (from pending, quote_sent, confirmed, pickup_started,
 *              pickup_completed, in_transit, out_for_delivery)
 *
 * Rules:
 * - Invalid transitions fail with ValidationError.
 * - Completed bookings cannot change state.
 * - Cancelled bookings cannot restart.
 * - Rejected bookings cannot restart (admin must create a new booking).
 * - Quote must be accepted (quote_status === 'ACCEPTED') before a booking
 *   can move from quote_sent → confirmed.
 * - Delivery state must always match booking state.
 */

const { ValidationError } = require('../utils/AppError');

const BOOKING_STATUSES = [
  'pending',
  'quote_sent',
  'confirmed',
  'pickup_started',
  'pickup_completed',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'rejected',
  'cancelled',
  'completed',
];

const TERMINAL_STATUSES = ['rejected', 'cancelled', 'completed', 'delivered'];

const ALLOWED_TRANSITIONS = {
  pending: ['quote_sent', 'cancelled'],
  quote_sent: ['confirmed', 'rejected', 'pending', 'cancelled'],
  confirmed: ['pickup_started', 'cancelled'],
  pickup_started: ['pickup_completed', 'cancelled'],
  pickup_completed: ['in_transit', 'cancelled'],
  in_transit: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['completed'],
  rejected: [], // terminal
  cancelled: [], // terminal
  completed: [], // terminal
};

/**
 * Validate a status transition.
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {ValidationError} if transition is not allowed
 */
function validateTransition(fromStatus, toStatus) {
  if (!BOOKING_STATUSES.includes(fromStatus)) {
    throw new ValidationError({ message: `Invalid fromStatus: ${fromStatus}` });
  }
  if (!BOOKING_STATUSES.includes(toStatus)) {
    throw new ValidationError({ message: `Invalid toStatus: ${toStatus}` });
  }

  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ValidationError({
      message: `Cannot transition from ${fromStatus} to ${toStatus}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
    });
  }
}

/**
 * Check if a status is terminal (no further transitions allowed).
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check if a booking can be cancelled from its current status.
 * @param {string} status
 * @returns {boolean}
 */
function canCancel(status) {
  return ALLOWED_TRANSITIONS[status]?.includes('cancelled') || false;
}

/**
 * Check if a booking can be confirmed from its current status.
 * @param {string} status
 * @returns {boolean}
 */
function canConfirm(status) {
  return ALLOWED_TRANSITIONS[status]?.includes('confirmed') || false;
}

/**
 * Check if a quote can be sent from the current status.
 * @param {string} status
 * @returns {boolean}
 */
function canSendQuote(status) {
  return ALLOWED_TRANSITIONS[status]?.includes('quote_sent') || false;
}

/**
 * Check if a booking can be rejected from its current status.
 * @param {string} status
 * @returns {boolean}
 */
function canReject(status) {
  return ALLOWED_TRANSITIONS[status]?.includes('rejected') || false;
}

/**
 * Check if a driver can be assigned from the current status.
 * Requires quote_status === 'ACCEPTED' and status allows confirmed.
 * @param {string} status
 * @param {string} quoteStatus
 * @returns {boolean}
 */
function canAssignDriver(status, quoteStatus) {
  if (quoteStatus !== 'ACCEPTED') return false;
  return ALLOWED_TRANSITIONS[status]?.includes('confirmed') || false;
}

/**
 * Check if pickup can be started from the current status.
 * @param {string} status
 * @returns {boolean}
 */
function canStartPickup(status) {
  return ALLOWED_TRANSITIONS[status]?.includes('pickup_started') || false;
}

/**
 * Get the delivery status that corresponds to a booking status.
 * @param {string} bookingStatus
 * @returns {string}
 */
function toDeliveryStatus(bookingStatus) {
  const mapping = {
    pending: 'booking_confirmed',
    quote_sent: 'booking_confirmed',
    confirmed: 'booking_confirmed',
    pickup_started: 'pickup_in_progress',
    pickup_completed: 'pickup_completed',
    in_transit: 'in_transit',
    out_for_delivery: 'out_for_delivery',
    delivered: 'delivered',
    rejected: 'booking_confirmed',
    cancelled: 'booking_confirmed',
    completed: 'delivered',
  };
  return mapping[bookingStatus] || 'booking_confirmed';
}

/**
 * Get the next expected status in the lifecycle.
 * @param {string} status
 * @returns {string|null}
 */
function getNextStatus(status) {
  const transitions = ALLOWED_TRANSITIONS[status] || [];
  // Return the first non-cancelled/non-rejected transition as the "normal" next step
  const next = transitions.find((s) => s !== 'cancelled' && s !== 'rejected');
  return next || null;
}

module.exports = {
  BOOKING_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  validateTransition,
  isTerminal,
  canCancel,
  canConfirm,
  canSendQuote,
  canReject,
  canAssignDriver,
  canStartPickup,
  toDeliveryStatus,
  getNextStatus,
};
