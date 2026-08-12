/**
 * BookingNumberService
 * ------------------------------------------------------------------
 * THE single canonical booking-number generator for Bihar Transport.
 *
 * Format: BTB-YYYY-NNNNN
 *
 *   BTB           → brand prefix
 *   YYYY          → year the booking was created (e.g. 2026)
 *   NNNNN         → zero-padded booking_id (the DB autoincrement PK)
 *
 * The booking number is DERIVED from the database primary key
 * (booking_id). It is deterministic, sequential, unique, human-readable
 * and safe under concurrent booking creation — because the sequence is
 * the AUTOINCREMENT column itself, not a SELECT MAX() + 1 race.
 *
 * IMPORTANT RULES:
 * - NEVER use UUID / Math.random() / Date.now() / random strings here.
 * - NEVER generate booking numbers in the frontend.
 * - The backend owns the value using the database as source of truth.
 */

/**
 * Build the canonical booking number from a booking_id and its creation date.
 *
 * @param {number} bookingId - the DB autoincrement PK (sequence source)
 * @param {Date|string} [createdAt] - booking creation date (for the year)
 * @returns {string} e.g. "BTB-2026-00032"
 */
function buildBookingNumber(bookingId, createdAt) {
  if (!bookingId || !Number.isFinite(Number(bookingId)) || Number(bookingId) <= 0) {
    throw new Error('bookingId is required to build a canonical booking number');
  }

  const id = Number(bookingId);
  let year = new Date().getFullYear();
  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) year = d.getFullYear();
  }

  const paddedId = String(id).padStart(5, '0');
  return `BTB-${year}-${paddedId}`;
}

/**
 * Validate whether a string is a canonical booking number in the format
 * BTB-YYYY-NNNNN.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isCanonicalBookingNumber(value) {
  if (!value || typeof value !== 'string') return false;
  return /^BTB-\d{4}-\d{5}$/i.test(value.trim());
}

/**
 * Normalize a user-supplied booking identifier for lookup.
 * Accepts both the canonical BTB-YYYY-NNNNN and legacy formats, and
 * returns the canonical form when possible. Used by tracking/admin detail
 * routes so a customer can paste a legacy reference or the canonical number.
 *
 * @param {string} value
 * @returns {string} normalized value (trimmed, uppercased)
 */
function normalizeBookingIdentifier(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase();
}

module.exports = {
  buildBookingNumber,
  isCanonicalBookingNumber,
  normalizeBookingIdentifier,
};
