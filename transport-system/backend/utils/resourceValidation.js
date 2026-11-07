/**
 * resourceValidation.js
 * ---------------------------------------------------------------------------
 * Shared input normalisation and validation for the transport-resource
 * modules (Drivers, Vehicles, Transport Owners).
 *
 * Why this exists
 *   The three resource modules previously normalised the same values in
 *   different ways:
 *     - driver mobile numbers were stored verbatim,
 *     - vehicle numbers kept internal spaces in some paths and stripped them
 *       in others,
 *     - document expiry dates were accepted as arbitrary strings,
 *     - pagination limits were unbounded.
 *   That produced duplicate records that looked different but were the same
 *   real-world value, and allowed expensive unbounded list queries.
 *
 * Design rules
 *   - Functions are pure and side-effect free.
 *   - Normalisation NEVER throws; validation is a separate explicit check.
 *   - Every normaliser returns `null` for empty input so callers can write
 *     nullable columns without sprinkling ternary expressions everywhere.
 *   - Nothing here changes a business rule; it only makes the stored value
 *     canonical.
 */

'use strict';

const MOBILE_REGEX = /^[6-9]\d{9}$/;
// The formats accepted by the existing admin UI/route validators:
// SS N A  NNNN (BR9A1234), SS NN A NNNN (BR09A1234) and
// SS NN AA NNNN (BR09AB1234). The district number and series length are
// intentionally permissive so legacy registrations still validate.
const VEHICLE_NUMBER_REGEX = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/;
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Normalise an Indian mobile number to its 10-digit canonical form.
 * Handles "+91 98765 43210", "098765-43210", "9876543210".
 * Returns null when no digits are present.
 */
function normalizeMobile(value) {
  if (value === null || value === undefined) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits || null;
}

function isValidMobile(value) {
  const normalized = normalizeMobile(value);
  return Boolean(normalized && MOBILE_REGEX.test(normalized));
}

/**
 * Normalise a vehicle registration number: uppercase and strip every
 * non-alphanumeric character. " br09 ab 1234 " -> "BR09AB1234".
 */
function normalizeVehicleNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized || null;
}

function isValidVehicleNumber(value) {
  const normalized = normalizeVehicleNumber(value);
  return Boolean(normalized && VEHICLE_NUMBER_REGEX.test(normalized));
}

/**
 * Normalise a licence / certificate / tax identifier for comparison and
 * storage: uppercase and strip separators. "br-01 2020/458796" ->
 * "BR012020458796".
 */
function normalizeIdentifier(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized || null;
}

/**
 * Trim and collapse internal whitespace in a human name.
 */
function normalizeName(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function normalizeEmail(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

/**
 * Validate an email address. Intentionally permissive: the backend only needs
 * to reject obvious garbage, not implement RFC 5322.
 */
function isValidEmail(value) {
  if (!value) return true; // email is optional on every resource
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

/**
 * Accept a date-only value (YYYY-MM-DD) or an ISO timestamp whose date part is
 * valid, and return the canonical YYYY-MM-DD string. Returns null for empty
 * input. Returns null for unparseable input — callers that require a valid
 * value must check `isValidDateOnly` first.
 */
function normalizeDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const match = raw.match(DATE_ONLY_REGEX) || raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!match) return null;
  const datePart = match[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return datePart;
}

function isValidDateOnly(value) {
  if (value === null || value === undefined || value === '') return true;
  return normalizeDateOnly(value) !== null;
}

/**
 * Coerce a value to a finite number. Returns null for empty/invalid input.
 */
function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Bound pagination parameters. Never returns a negative skip and never lets a
 * caller request an unbounded page. `maxLimit` defaults to 100 to match the
 * existing admin vehicle endpoint.
 */
function parsePagination(filters = {}, options = {}) {
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 100;
  const requestedPage = Number.parseInt(filters.page, 10);
  const requestedLimit = Number.parseInt(filters.limit, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limitCandidate = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : defaultLimit;
  const limit = Math.min(limitCandidate, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Return the canonical value when it is one of `allowed`, otherwise
 * `fallback`.
 */
function normalizeEnum(value, allowed, fallback) {
  const candidate = value === null || value === undefined ? '' : String(value).trim();
  return allowed.includes(candidate) ? candidate : fallback;
}

/**
 * Build a structured validation error understood by the route error mappers.
 */
function validationError(message, data) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  if (data) err.data = data;
  return err;
}

/**
 * Build a structured conflict error understood by the route error mappers.
 */
function conflictError(code, message, data) {
  const err = new Error(message);
  err.code = code;
  if (data) err.data = data;
  return err;
}

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

module.exports = {
  MOBILE_REGEX,
  VEHICLE_NUMBER_REGEX,
  normalizeMobile,
  isValidMobile,
  normalizeVehicleNumber,
  isValidVehicleNumber,
  normalizeIdentifier,
  normalizeName,
  normalizeEmail,
  isValidEmail,
  normalizeDateOnly,
  isValidDateOnly,
  normalizeNumber,
  parsePagination,
  normalizeEnum,
  validationError,
  conflictError,
  todayDateOnly,
};
