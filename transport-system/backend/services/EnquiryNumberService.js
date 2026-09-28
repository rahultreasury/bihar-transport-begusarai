/**
 * EnquiryNumberService
 * ---------------------------------------------------------------------------
 * THE single canonical enquiry-number generator for Bihar Transport.
 *
 * Format: BTB-YYYYMMDD-NNNNNN
 *
 *   BTB        → brand prefix
 *   YYYYMMDD   → calendar day the enquiry was created (Asia/agnostic UTC date)
 *   NNNNNN     → zero-padded enquiry_id (the DB autoincrement PK)
 *
 * WHY DERIVED FROM THE PRIMARY KEY
 * The identifier is built from the database sequence, not from
 * UUID / Math.random() / Date.now(). That makes it:
 *   • deterministic  — same enquiry always renders the same number
 *   • collision-free — a unique index on enquiry_number is the guarantee
 *   • race-safe      — the sequence is the AUTOINCREMENT column itself, so two
 *                       concurrent submissions can never compute the same value
 *   • human-readable — the date segment makes the request self-describing
 *
 * IMPORTANT RULES
 *   - NEVER generate an enquiry number in the frontend.
 *   - NEVER use Math.random()/UUID here.
 *   - The backend owns the value; the database is the source of truth.
 *   - Booking numbers are a SEPARATE namespace (BookingNumberService,
 *     BTB-YYYY-NNNNN). Never conflate the two.
 */

const ENQUIRY_NUMBER_PATTERN = /^BTB-\d{8}-\d{6}$/i;

/**
 * Build the canonical enquiry number from an enquiry_id and its creation date.
 *
 * @param {number} enquiryId  - DB autoincrement PK (sequence source)
 * @param {Date|string} [createdAt] - creation date (supplies the YYYYMMDD part)
 * @returns {string} e.g. "BTB-20260926-000123"
 */
function buildEnquiryNumber(enquiryId, createdAt) {
  if (!enquiryId || !Number.isFinite(Number(enquiryId)) || Number(enquiryId) <= 0) {
    throw new Error('enquiryId is required to build a canonical enquiry number');
  }

  let date = new Date();
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  // Manual UTC formatting: toISOString() would also work but being explicit
  // keeps the segment order obvious to the next reader.
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  const paddedId = String(enquiryId).padStart(6, '0');

  return `BTB-${yyyy}${mm}${dd}-${paddedId}`;
}

/**
 * Validate whether a string is a canonical enquiry number.
 * @param {string} value
 * @returns {boolean}
 */
function isCanonicalEnquiryNumber(value) {
  if (!value || typeof value !== 'string') return false;
  return ENQUIRY_NUMBER_PATTERN.test(value.trim());
}

/**
 * Normalize a user-supplied enquiry identifier for lookup.
 * Accepts a canonical number and returns the upper-cased, trimmed form so a
 * customer can paste it from an email/SMS without worrying about case.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeEnquiryIdentifier(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase();
}

module.exports = {
  ENQUIRY_NUMBER_PATTERN,
  buildEnquiryNumber,
  isCanonicalEnquiryNumber,
  normalizeEnquiryIdentifier,
};
