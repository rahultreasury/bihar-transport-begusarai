/**
 * commissionPolicy.js
 * ------------------------------------------------------------------
 * Single source of truth for Bihar Transport's COMMISSION POLICY.
 *
 * BUSINESS RULE (permanent, Phase 1B):
 *   Bihar Transport is a commission agent / transport broker.
 *   The commission rate is FIXED at 5%.
 *
 *   It does NOT vary by:
 *     - Transport Owner
 *     - Vehicle
 *     - Driver
 *     - Customer
 *     - Route
 *     - Trip
 *     - Date
 *
 * Examples:
 *   freight = ₹5,000   →  commission = ₹250   →  owner share = ₹4,750
 *   freight = ₹10,000  →  commission = ₹500   →  owner share = ₹9,500
 *   freight = ₹100,000 →  commission = ₹5,000 →  owner share = ₹95,000
 *
 * Where this constant is consumed:
 *   - services/CommissionService.applyCommission (rate resolution)
 *   - services/TripFinancialService.calculateTripFinancial (rate fallback
 *     when booking has no commission_percentage snapshotted yet)
 *
 * Where this constant is NOT consumed (intentionally):
 *   - CommissionCalculator.computeCommission (pure math, no defaults)
 *   - Partner.commission_percentage (legacy field, see Phase 1B report
 *     for the deprecation plan — out of scope here)
 *   - Schema column defaults (would require a destructive migration)
 *
 * Historical safety:
 *   This module affects only NEW / FUTURE writes. Existing stored
 *   commission_amount rows are NEVER recomputed by changing this file.
 *
 * To change the business rule in the future:
 *   1. Update DEFAULT_COMMISSION_PERCENTAGE below.
 *   2. Update the corresponding tests in tests/commissionPolicy.test.js
 *      (and tests/commissionCalculator.test.js if math is being touched).
 *   3. Do NOT touch schema defaults in the same change.
 */

'use strict';

/**
 * The fixed commission percentage Bihar Transport charges on every
 * booking it intermediates. Expressed as a percentage value (5 = 5%).
 */
const DEFAULT_COMMISSION_PERCENTAGE = 5;

/**
 * Default commission calculation type. Bihar Transport charges a
 * percentage of freight; this constant is exported only so other
 * modules never need to hardcode the string 'percentage'.
 */
const DEFAULT_COMMISSION_TYPE = 'percentage';

/**
 * Convenience wrapper that delegates to CommissionCalculator.
 * Keep CommissionCalculator free of defaults; let THIS module own
 * the business default.
 *
 * @param {Object} params
 * @param {number} params.base  - Freight / base amount in rupees.
 * @param {number} [params.rate] - Override rate. Defaults to
 *                                  DEFAULT_COMMISSION_PERCENTAGE.
 * @param {string} [params.type] - Override type. Defaults to
 *                                  DEFAULT_COMMISSION_TYPE.
 * @returns {number} commissionAmount rounded to 2 decimal places.
 */
function computeWithPolicy({ base, rate, type } = {}) {
  // Lazy-require to avoid a require cycle in tests that mock the
  // calculator; production code uses the real one.
  const { computeCommission } = require('../services/CommissionCalculator');
  return computeCommission({
    base,
    rate: rate === undefined || rate === null ? DEFAULT_COMMISSION_PERCENTAGE : rate,
    type: type === undefined || type === null ? DEFAULT_COMMISSION_TYPE : type,
  });
}

module.exports = {
  DEFAULT_COMMISSION_PERCENTAGE,
  DEFAULT_COMMISSION_TYPE,
  computeWithPolicy,
};