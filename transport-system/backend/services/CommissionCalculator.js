/**
 * CommissionCalculator.js
 * ------------------------------------------------------------------
 * Single, focused commission-amount calculator.
 *
 * IMPORTANT (Phase 1A scope):
 *   - This module ONLY performs the math:
 *         commissionAmount = base * rate / 100        (when type === 'percentage')
 *         commissionAmount = rate                     (when type === 'fixed')
 *   - It does NOT choose a default rate. The caller MUST supply
 *     the explicit rate (and optionally the type).
 *   - It does NOT touch the database, business defaults, or
 *     historical records.
 *   - It does NOT compute owner share / BT revenue / profit.
 *     Those are separate concerns (Phase 1B+).
 *
 * Historical safety:
 *   - Existing Booking.commission_amount, TripFinancial.commission_amount,
 *     Partner.commission_percentage, CommissionRecord rows remain
 *     unchanged. This calculator is used only at write-time, going
 *     forward, by CommissionService.applyCommission and
 *     TripFinancialService.calculateTripFinancial.
 *
 * Errors:
 *   - Throws a plain Error with a stable code property, matching the
 *     rest of the project's service-layer error convention
 *     (see utils/AppError.js). Callers may wrap with AppError if
 *     they prefer.
 *
 * Phase 3 (deriveCommission):
 *   - `deriveCommission` is the single entry point for deriving the
 *     full commission breakdown (commissionAmount + ownerShare) from
 *     a base amount. It delegates the pure math to `computeCommission`
 *     and resolves the rate through the business policy module
 *     (config/commissionPolicy.js) so that 5% is never hardcoded
 *     in multiple places.
 *   - Accepts either `{ base, rate, type }` for direct computation,
 *     or `{ booking }` / `{ trip }` for object-based computation
 *     (extracts base from `final_price` or `freight_amount`, and
 *     rate from `commission_percentage` or the policy default).
 */

const SUPPORTED_TYPES = new Set(['percentage', 'fixed']);

/**
 * Compute the commission amount for a given base, rate, and type.
 *
 * @param {Object}  params
 * @param {number}  params.base  - Amount the commission is calculated on
 *                                  (e.g. Booking.final_price). Required.
 * @param {number}  params.rate  - Commission rate. Required.
 *                                  For type='percentage', a percentage value
 *                                  in [0, 100] (e.g. 5 means 5%).
 *                                  For type='fixed', the literal commission
 *                                  amount in rupees.
 * @param {string} [params.type='percentage'] - 'percentage' or 'fixed'.
 *
 * @returns {number} commissionAmount rounded to 2 decimal places; never negative.
 *
 * @throws {Error} with `.code` set when inputs are invalid:
 *   - 'INVALID_BASE'      — base is missing / not a finite number / < 0
 *   - 'INVALID_RATE'      — rate is missing / not a finite number / < 0
 *                            (percentage type: also > 100)
 *   - 'INVALID_TYPE'      — type is not 'percentage' or 'fixed'
 */
function computeCommission({ base, rate, type } = {}) {
  const commissionType = type === undefined || type === null ? 'percentage' : String(type);

  if (!SUPPORTED_TYPES.has(commissionType)) {
    const err = new Error(`Unsupported commission type: ${type}`);
    err.code = 'INVALID_TYPE';
    throw err;
  }

  const numericBase = Number(base);
  if (base === null || base === undefined || Number.isNaN(numericBase) || numericBase < 0) {
    const err = new Error(
      `Invalid commission base: ${base} (expected a non-negative finite number)`
    );
    err.code = 'INVALID_BASE';
    throw err;
  }

  const numericRate = Number(rate);
  if (rate === null || rate === undefined || Number.isNaN(numericRate) || numericRate < 0) {
    const err = new Error(
      `Invalid commission rate: ${rate} (expected a non-negative finite number)`
    );
    err.code = 'INVALID_RATE';
    throw err;
  }
  if (commissionType === 'percentage' && numericRate > 100) {
    const err = new Error(
      `Invalid commission rate: ${rate}% (percentage must be between 0 and 100)`
    );
    err.code = 'INVALID_RATE';
    throw err;
  }

  let amount;
  if (commissionType === 'fixed') {
    amount = numericRate;
  } else {
    amount = (numericBase * numericRate) / 100;
  }

  if (amount < 0) amount = 0;
  return Math.round(amount * 100) / 100;
}

/**
 * Derive the full commission breakdown (commissionAmount + ownerShare)
 * from a base amount, using the business policy for the rate.
 *
 * This is the single entry point for the broker model:
 *   Freight / GMV  →  5% BT Commission  →  95% Owner Share
 *
 * The rate is resolved through config/commissionPolicy.js so that 5%
 * is never hardcoded in multiple places. The pure math is delegated
 * to `computeCommission`.
 *
 * Accepts two calling conventions:
 *
 * 1. Direct:  deriveCommission({ base, rate, type })
 *    - base: freight / GMV amount (required)
 *    - rate: optional override; defaults to policy rate (5)
 *    - type: optional; defaults to policy type ('percentage')
 *
 * 2. Object-based:  deriveCommission({ booking }) or deriveCommission({ trip })
 *    - Extracts base from `booking.final_price` or `booking.freight_amount`
 *    - Extracts rate from `booking.commission_percentage` (if present and
 *      non-null) or falls back to the policy default
 *    - Extracts type from `booking.commission_type` (if present) or policy default
 *
 * @param {Object} params
 * @returns {{ commissionAmount: number, ownerShare: number, commissionRate: number, commissionType: string }}
 */
function deriveCommission(params = {}) {
  // Lazy-require to avoid a require cycle (commissionPolicy requires
  // CommissionCalculator at module load).
  const commissionPolicy = require('../config/commissionPolicy');
  const policyRate = commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE;
  const policyType = commissionPolicy.DEFAULT_COMMISSION_TYPE;

  let base, rate, type;

  if (params.booking || params.trip) {
    const obj = params.booking || params.trip;
    base = Number(obj.final_price ?? obj.freight_amount ?? 0);
    // Use the snapshotted rate if present (Booking model), otherwise policy.
    const hasRate =
      obj.commission_percentage !== null &&
      obj.commission_percentage !== undefined;
    rate = hasRate ? Number(obj.commission_percentage) : policyRate;
    type = obj.commission_type || policyType;
  } else {
    base = Number(params.base);
    rate = params.rate === undefined || params.rate === null ? policyRate : Number(params.rate);
    type = params.type || policyType;
  }

  const commissionAmount = computeCommission({ base, rate, type });
  const ownerShare = Math.max(0, base - commissionAmount);

  return {
    commissionAmount,
    ownerShare,
    commissionRate: rate,
    commissionType: type,
  };
}

module.exports = {
  computeCommission,
  deriveCommission,
  SUPPORTED_TYPES: Array.from(SUPPORTED_TYPES),
};