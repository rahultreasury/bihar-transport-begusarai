/**
 * TripNumberService
 * ------------------------------------------------------------------
 * THE single canonical trip-number generator for Bihar Transport.
 *
 * Format: BTBT-YYYY-NNNNN
 *
 *   BTBT          → brand prefix (Bihar Transport Booking Trip)
 *   YYYY          → year the trip was created (e.g. 2026)
 *   NNNNN         → zero-padded trip_id (the DB autoincrement PK)
 *
 * The trip number is DERIVED from the database primary key
 * (trip_id). It is deterministic, sequential, unique, human-readable
 * and safe under concurrent trip creation — because the sequence is
 * the AUTOINCREMENT column itself, not a SELECT MAX() + 1 race.
 *
 * IMPORTANT RULES:
 * - NEVER use UUID / Math.random() / Date.now() / random strings here.
 * - NEVER generate trip numbers in the frontend.
 * - The backend owns the value using the database as source of truth.
 */

/**
 * Build the canonical trip number from a trip_id and its creation date.
 *
 * @param {number} tripId - the DB autoincrement PK (sequence source)
 * @param {Date|string} [createdAt] - trip creation date (for the year)
 * @returns {string} e.g. "BTBT-2026-00032"
 */
function buildTripNumber(tripId, createdAt) {
  if (!tripId || !Number.isFinite(Number(tripId)) || Number(tripId) <= 0) {
    throw new Error('tripId is required to build a canonical trip number');
  }

  const id = Number(tripId);
  let year = new Date().getFullYear();
  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) year = d.getFullYear();
  }

  const paddedId = String(id).padStart(5, '0');
  return `BTBT-${year}-${paddedId}`;
}

/**
 * Validate whether a string is a canonical trip number in the format
 * BTBT-YYYY-NNNNN.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isCanonicalTripNumber(value) {
  if (!value || typeof value !== 'string') return false;
  return /^BTBT-\d{4}-\d{5}$/i.test(value.trim());
}

/**
 * Normalize a user-supplied trip identifier for lookup.
 * Accepts both the canonical BTBT-YYYY-NNNNN and legacy formats, and
 * returns the canonical form when possible. Used by tracking/admin detail
 * routes so a customer can paste a legacy reference or the canonical number.
 *
 * @param {string} value
 * @returns {string} normalized value (trimmed, uppercased)
 */
function normalizeTripIdentifier(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase().replace(/^#/, '');
}

module.exports = {
  buildTripNumber,
  isCanonicalTripNumber,
  normalizeTripIdentifier,
};