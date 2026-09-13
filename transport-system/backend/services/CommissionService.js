/**
 * CommissionService
 * Business logic for commission calculation and management.
 *
 * Phase 1B: Bihar Transport is a commission agent. The commission
 * rate is FIXED at 5%. See config/commissionPolicy.js. The rate is
 * always resolved from the policy, not from partner config, not
 * from per-trip overrides, and not from per-owner configuration.
 *
 * Historical data is preserved: existing commission_amount rows are
 * NEVER recomputed by changing this file.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const CommissionRecordRepository = require('../repositories/CommissionRecordRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const CommissionCalculator = require('./CommissionCalculator');
const commissionPolicy = require('../config/commissionPolicy');

class CommissionService {
  constructor() {
    this.tripFinancialRepo = new TripFinancialRepository();
    this.commissionRepo = new CommissionRecordRepository();
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Apply commission to a trip.
   *
   * Phase 1B: Bihar Transport is a broker. Commission is FIXED at 5%
   * (see config/commissionPolicy.js). Any caller-supplied rate that
   * is NOT 5 is silently coerced to 5 and recorded in the audit log.
   * Existing historical commission rows are never recomputed by this
   * method — it only writes NEW CommissionRecord rows.
   *
   * @param {number} bookingId
   * @param {Object} commissionData
   * @param {Object} admin - Admin performing the action
   * @returns {Promise<Object>}
   */
  async applyCommission(bookingId, commissionData, admin = null) {
    const { commission_rate, commission_type, commission_base, notes } = commissionData || {};

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      throw new NotFoundError('Trip financial record not found');
    }

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        final_price: true,
        commission_percentage: true,
        commission_amount: true,
        commission_type: true,
        partner_id: true,
      },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // ===== Phase 1B: resolve the rate through the policy module =====
    // The business rule is fixed 5%. We accept a caller-supplied rate
    // for backwards-compatible API surface, but anything other than
    // the policy value is overwritten here and audited.
    const policyRate = commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE;
    const policyType = commissionPolicy.DEFAULT_COMMISSION_TYPE;

    const callerRate = commission_rate === undefined || commission_rate === null
      ? null
      : Number(commission_rate);

    if (callerRate !== null && (Number.isNaN(callerRate) || callerRate < 0 || callerRate > 100)) {
      throw new ValidationError('Commission rate must be between 0 and 100');
    }

    const rate = policyRate;
    const rateWasOverridden =
      callerRate !== null && callerRate !== policyRate;

    const base = Number(commission_base ?? booking.final_price ?? 0);
    let commissionAmount;
    try {
      commissionAmount = CommissionCalculator.computeCommission({
        base,
        rate,
        type: commission_type || policyType,
      });
    } catch (calcErr) {
      // Map shared-calculator error codes to ValidationError so the route
      // handler treats them as 400-level, matching existing behaviour.
      throw new ValidationError(
        calcErr.message || 'Invalid commission inputs'
      );
    }

    // Create commission record (historical audit row, never overwritten).
    const commissionRecord = await this.commissionRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      commission_rate: rate,
      commission_type: commission_type || policyType,
      commission_base: base,
      commission_amount: commissionAmount,
      applied_by: admin?.user_id || null,
      notes: notes || null,
    });

    // Create financial transaction (status/direction semantics are preserved
    // exactly as before — out of scope for Phase 1A).
    await this.financialTxRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      transaction_type: 'COMMISSION',
      amount: commissionAmount,
      direction: 'DEBIT',
      status: 'PAID',
      created_by: admin?.user_id || null,
      metadata: JSON.stringify({ commission_id: commissionRecord.commission_id }),
    });

    // Update booking commission snapshot fields.
    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: {
        commission_percentage: rate,
        commission_amount: commissionAmount,
        commission_type: commission_type || policyType,
      },
    });

    // Recalculate trip financial.
    await this.tripFinancialRepo.calculateTripFinancial(bookingId);

    // Create audit log.
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'commission_applied',
      entity_type: 'CommissionRecord',
      entity_id: commissionRecord.commission_id,
      new_value: JSON.stringify({
        commission_rate: rate,
        commission_type: commission_type || policyType,
        commission_amount: commissionAmount,
        // Phase 1B: explicit record that the rate came from the
        // business policy, not from caller / partner configuration.
        policy_rate: policyRate,
        caller_supplied_rate: callerRate,
        policy_override: rateWasOverridden,
      }),
      reason: notes || null,
    });

    return commissionRecord;
  }

  /**
   * Get commission details for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object>}
   */
  async getCommission(bookingId) {
    const records = await this.commissionRepo.findByBookingId(bookingId);
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);

    // No hardcoded fallback rate — preserve original behaviour: use the stored
    // value if present, otherwise leave the rate as 0. Selecting a system
    // default rate is a separate Phase-1B task and is out of scope here.
    const currentRate =
      tripFinancial?.commission_rate !== null && tripFinancial?.commission_rate !== undefined
        ? tripFinancial.commission_rate
        : 0;

    return {
      records,
      currentRate,
      currentAmount: tripFinancial?.commission_amount || 0,
    };
  }
}

module.exports = CommissionService;
