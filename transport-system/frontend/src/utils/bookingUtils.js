/**
 * bookingUtils — Shared normalization and state helpers for booking UI.
 *
 * Single source of truth for:
 *   - quote_status casing/normalization
 *   - booking.status casing/normalization
 *   - derived state (isConfirmed, isQuoteSent, etc.)
 */

/**
 * Normalize quote_status to a canonical uppercase value.
 * Handles null/undefined/empty and trims whitespace.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeQuoteStatus(value) {
  if (!value || typeof value !== 'string') return 'PENDING';
  const trimmed = value.trim().toUpperCase();
  // Map known aliases to canonical values
  const aliasMap = {
    QUOTE_SENT: 'SENT',
    QUOTE_PENDING: 'PENDING',
    AWAITING_APPROVAL: 'SENT',
    DRIVER_RESERVED: 'SENT',
    VEHICLE_RESERVED: 'SENT',
    QUOTE_PREPARING: 'PENDING',
    QUOTE_REQUESTED: 'PENDING',
  };
  return aliasMap[trimmed] || trimmed;
}

/**
 * Normalize booking.status to lowercase.
 * Handles null/undefined/empty and trims whitespace.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeStatus(value) {
  if (!value || typeof value !== 'string') return 'pending';
  return value.trim().toLowerCase();
}

/**
 * Check if a status represents a confirmed/terminal booking state
 * where the customer should see driver/vehicle details OR a quote card.
 *
 * @param {string} status - normalized (lowercase) booking status
 * @returns {boolean}
 */
export function isConfirmedStatus(status) {
  return [
    'confirmed',
    'driver_assigned',
    'pickup_started',
    'pickup_completed',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'completed',
  ].includes(status);
}

/**
 * Derive the frontend quote state from raw API fields.
 * Handles the edge case where admin assigned a driver without sending a quote:
 *   status = 'driver_assigned' + quote_status = 'PENDING' + final_price exists
 * In that case, we treat it as if a quote is awaiting approval.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.quoteStatus
 * @param {string|null|undefined} params.status
 * @param {number|null|undefined} params.finalPrice
 * @returns {{ quoteStatus: string, status: string, isConfirmed: boolean, isQuoteSent: boolean, isEdgeCase: boolean }}
 */
export function deriveQuoteState({ quoteStatus, status, finalPrice }) {
  const q = normalizeQuoteStatus(quoteStatus);
  const s = normalizeStatus(status);

  const isConfirmed = q === 'ACCEPTED' || isConfirmedStatus(s);
  const isEdgeCase = !isConfirmed && isConfirmedStatus(s) && q === 'PENDING' && finalPrice != null;
  // QuoteCard (Accept/Reject) must ONLY show when admin has explicitly sent
  // a quote (quote_status === 'SENT'). The edge case (driver assigned without
  // sending a quote) must NOT show Accept/Reject buttons.
  const isQuoteSent = q === 'SENT' && !isConfirmed;

  return {
    quoteStatus: q,
    status: s,
    isConfirmed,
    isQuoteSent,
    isEdgeCase,
  };
}
