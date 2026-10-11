/**
 * utils/money.js
 * ---------------------------------------------------------------------------
 * EXACT money arithmetic for the Vehicle Hire module.
 *
 * WHY THIS EXISTS
 *   The rest of the repository stores money as Prisma `Float` and calculates
 *   with JS doubles (services/CommissionCalculator.js). That is fine for a
 *   display-only figure, but the Vehicle Hire record is a CONTRACT: three
 *   stored amounts (gross hire, commission, net vendor payable) whose identity
 *   `gross − commission === net` must hold exactly, for every row, forever.
 *   Binary floats cannot promise that: 0.1 + 0.2 !== 0.3, and
 *   42000 * 0.05 lands on 2100.0000000000005.
 *
 *   So the hire does its arithmetic here, in INTEGER PAISE, and only converts
 *   back to a rupee value at the very edge — when handing a number to Prisma
 *   (which stores the hire columns as `Decimal(14,2)`) or to a JSON response.
 *   Integer maths has no representation error at all, so the identity is
 *   structural rather than something we have to remember to check.
 *
 * THE UNITS
 *   money      → integer paise      (₹1 = 100 paise)
 *   rate       → integer paise      (₹5,000/ton = 500000 paise)
 *   quantity   → integer thousandths ("milli-units"); 8 ton = 8000, 8.5 = 8500
 *   percentage → integer basis points (5% = 500 bps; 1 bp = 0.01%)
 *
 *   Everything is rounded HALF UP, which is the convention Indian commercial
 *   practice and `Intl.NumberFormat` both use, so a rupee figure the operator
 *   reads on screen is the rupee figure stored in the database.
 *
 * THIS IS ADDITIVE
 *   Nothing here replaces CommissionCalculator or the Float columns that already
 *   exist. It is the calculator for the NEW `vehicle_hires` money columns only.
 */

'use strict';

/** Number of decimal places a quantity is held to (thousandths). */
const QUANTITY_SCALE = 1000;

/** Number of decimal places a percentage is held to (basis points). */
const PERCENT_SCALE = 10000;

/**
 * Parse anything Prisma, JSON or a form can hand us into a plain decimal string.
 * Handles: number, numeric string, Date-free Decimal instances (anything with a
 * `toFixed`), and objects carrying `.toString()`.
 *
 * @param {*} value
 * @returns {number|null} a finite JS number, or null when the input is unusable
 */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  let numeric;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (cleaned === '') return null;
    numeric = Number(cleaned);
  } else if (typeof value === 'object' && typeof value.toFixed === 'function') {
    // Prisma.Decimal / decimal.js — read it at rupee precision, not through a
    // double, so a Decimal that is exactly 42000 never becomes 41999.99999.
    numeric = Number(value.toFixed(6));
  } else {
    numeric = Number(value);
  }

  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Round HALF UP to `places` decimals.
 * `Math.round` alone rounds -0.5 down and is famously wrong for .5 in binary,
 * so the epsilon nudge stands in for the missing precision.
 *
 * @param {number} value
 * @param {number} [places=2]
 * @returns {number}
 */
function roundHalfUp(value, places = 2) {
  if (!Number.isFinite(value)) return NaN;
  const factor = 10 ** places;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
}

/**
 * Rupees → integer paise.
 * @param {*} amount
 * @returns {number|null} integer paise, or null when the input is not a number
 */
function toPaise(amount) {
  const numeric = toFiniteNumber(amount);
  if (numeric === null) return null;
  return Math.round(numeric * 100);
}

/**
 * Integer paise → rupees as a JS number rounded to 2dp.
 * This is the ONLY place paise becomes a rupee value, and it is exact because
 * `paise / 100` is a value the double can represent to within a fraction of a
 * paisa and is then snapped to 2 decimals.
 *
 * @param {number} paise
 * @returns {number}
 */
function fromPaise(paise) {
  return roundHalfUp(Number(paise || 0) / 100, 2);
}

/**
 * A quantity (tons, kg, days, months) → integer thousandths.
 * @param {*} quantity
 * @returns {number|null}
 */
function toMilli(quantity) {
  const numeric = toFiniteNumber(quantity);
  if (numeric === null) return null;
  return Math.round(numeric * QUANTITY_SCALE);
}

/**
 * Integer thousandths → quantity as a JS number rounded to 3dp.
 * @param {number} milli
 * @returns {number}
 */
function fromMilli(milli) {
  return roundHalfUp(Number(milli || 0) / QUANTITY_SCALE, 3);
}

/**
 * A percentage → integer basis points.
 * 5 → 500 ; 5.25 → 525 ; 0.005 → 1 (rounded half up).
 * @param {*} percentage
 * @returns {number|null}
 */
function toBasisPoints(percentage) {
  const numeric = toFiniteNumber(percentage);
  if (numeric === null) return null;
  return Math.round(numeric * PERCENT_SCALE);
}

/**
 * Integer basis points → percentage rounded to 4dp.
 * @param {number} bps
 * @returns {number}
 */
function fromBasisPoints(bps) {
  return roundHalfUp(Number(bps || 0) / PERCENT_SCALE, 4);
}

/**
 * `a * b / scale` in pure integer maths, rounded half up.
 * Split out because every multiplication in this module is of that shape and the
 * whole point of the module is that this is the ONLY place the rounding happens.
 *
 * @param {number} a integer
 * @param {number} b integer
 * @param {number} scale positive integer
 * @returns {number} integer
 */
function scaledMul(a, b, scale) {
  const product = a * b;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(product) + scale / 2) / scale);
}

/**
 * Format a rupee amount the way the whole console shows money.
 * `en-IN` grouping, 2 decimals, no decimals when the amount is a whole rupee.
 *
 * @param {*} amount
 * @returns {string} e.g. "₹42,000" / "₹42,000.50"
 */
function formatRupees(amount) {
  const numeric = toFiniteNumber(amount);
  if (numeric === null) return '—';
  const isWhole = Math.abs(numeric - Math.round(numeric)) < 1e-9;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

/**
 * Normalise a rupee amount into the exact string Prisma writes into a
 * `Decimal(14,2)` column. Handing Prisma a JS number works, but a fixed 2dp
 * string makes the stored value independent of float printing.
 *
 * @param {*} amount
 * @param {number} [places=2]
 * @returns {string|null}
 */
function toDecimalString(amount, places = 2) {
  const numeric = toFiniteNumber(amount);
  if (numeric === null) return null;
  return roundHalfUp(numeric, places).toFixed(places);
}

module.exports = {
  QUANTITY_SCALE,
  PERCENT_SCALE,
  toFiniteNumber,
  roundHalfUp,
  toPaise,
  fromPaise,
  toMilli,
  fromMilli,
  toBasisPoints,
  fromBasisPoints,
  scaledMul,
  formatRupees,
  toDecimalString,
};
