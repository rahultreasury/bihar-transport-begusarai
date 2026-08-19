/**
 * CommissionService
 * Business logic for commission calculation and management.
 *
 * Commission rate is configurable and stored per booking/trip.
 * Default rate is 5% but can be overridden.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const CommissionRecordRepository = require('../repositories/CommissionRecordRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class CommissionService {
  constructor() {
    this.tripFinancialRepo = new TripFinancialRepository();
    this.commissionRepo = new CommissionRecordRepository();
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Apply commission to a trip.
   * @param {number} bookingId
   * @param {Object} commissionData
   * @param {Object} admin - Admin performing the action
   * @returns {Promise<Object>}
   */
  async applyCommission(bookingId, commissionData, admin = null) {
    const { commission_rate, commission_type, commission_base, notes } = commissionData;

    if (!commission_rate && commission_rate !== 0) {
      throw new ValidationError('Commission rate is required');
    }

    if (commission_rate < 0 || commission_rate > 100) {
      throw new ValidationError('Commission rate must be between 0 and 100');
    }

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      throw new NotFoundError('Trip financial record not found');
    }

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { final_price: true, commission_percentage: true, commission_amount: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // Calculate commission amount
    const base = commission_base || booking.final_price || 0;
    const rate = commission_rate;
    const amount = commission_type === 'fixed'
      ? (commission_rate || 0)
      : (base * rate / 100);

    // Create commission record
    const commissionRecord = await this.commissionRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      commission_rate: rate,
      commission_type: commission_type || 'percentage',
      commission_base: base,
      commission_amount: amount,
      applied_by: admin?.user_id || null,
      notes: notes || null,
    });

    // Create financial transaction
    await this.financialTxRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      transaction_type: 'COMMISSION',
      amount,
      direction: 'DEBIT',
      status: 'PAID',
      created_by: admin?.user_id || null,
      metadata: JSON.stringify({ commission_id: commissionRecord.commission_id }),
    });

    // Update booking commission fields
    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: {
        commission_percentage: rate,
        commission_amount: amount,
        commission_type: commission_type || 'percentage',
      },
    });

    // Recalculate trip financial
    await this.tripFinancialRepo.calculateTripFinancial(bookingId);

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'commission_applied',
      entity_type: 'CommissionRecord',
      entity_id: commissionRecord.commission_id,
      new_value: JSON.stringify({ commission_rate: rate, commission_type, commission_amount: amount }),
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

    return {
      records,
      currentRate: tripFinancial?.commission_rate || 5,
      currentAmount: tripFinancial?.commission_amount || 0,
    };
  }
}

module.exports = CommissionService;
