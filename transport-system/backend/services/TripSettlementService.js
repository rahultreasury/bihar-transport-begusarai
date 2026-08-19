/**
 * TripSettlementService
 * Business logic for trip settlements.
 *
 * Handles both driver and owner settlements independently.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripSettlementRepository = require('../repositories/TripSettlementRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripSettlementService {
  constructor() {
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripSettlementRepo = new TripSettlementRepository();
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Record driver settlement payment.
   * @param {number} bookingId
   * @param {Object} settlementData
   * @param {Object} admin - Admin performing the action
   * @returns {Promise<Object>}
   */
  async recordDriverSettlement(bookingId, settlementData, admin = null) {
    const { amount, payment_method, reference_number, notes } = settlementData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      throw new NotFoundError('Trip financial record not found');
    }

    // Get or create settlement
    const settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
      bookingId,
      tripFinancial.trip_financial_id
    );

    // Validate amount against remaining settlement
    const remaining = tripFinancial.remaining_driver_settlement || 0;
    if (amount > remaining && settlement.driver_settlement_status !== 'PARTIAL') {
      throw new ValidationError(`Settlement amount (${amount}) exceeds remaining driver settlement (${remaining})`);
    }

    // Determine new status
    let newStatus = 'PAID';
    if (amount < remaining) {
      newStatus = 'PARTIAL';
    }

    // Update settlement
    const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
      driver_settlement_amount: amount,
      driver_settlement_status: newStatus,
      driver_settlement_paid_at: new Date(),
      driver_settlement_payment_method: payment_method || 'cash',
      driver_settlement_reference: reference_number || null,
      driver_settlement_notes: notes || null,
    });

    // Create financial transaction
    await this.financialTxRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      transaction_type: 'DRIVER_SETTLEMENT',
      amount,
      direction: 'DEBIT',
      payment_method: payment_method || 'cash',
      reference_number: reference_number || null,
      status: newStatus === 'PAID' ? 'PAID' : 'PARTIAL',
      created_by: admin?.user_id || null,
      metadata: JSON.stringify({ settlement_id: updated.settlement_id }),
    });

    // Recalculate trip financial
    await this.tripFinancialRepo.calculateTripFinancial(bookingId);

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'driver_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: updated.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return updated;
  }

  /**
   * Record owner settlement payment.
   * @param {number} bookingId
   * @param {Object} settlementData
   * @param {Object} admin - Admin performing the action
   * @returns {Promise<Object>}
   */
  async recordOwnerSettlement(bookingId, settlementData, admin = null) {
    const { amount, payment_method, reference_number, notes } = settlementData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      throw new NotFoundError('Trip financial record not found');
    }

    // Get or create settlement
    const settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
      bookingId,
      tripFinancial.trip_financial_id
    );

    // Validate amount against remaining settlement
    const remaining = tripFinancial.remaining_owner_settlement || 0;
    if (amount > remaining && settlement.owner_settlement_status !== 'PARTIAL') {
      throw new ValidationError(`Settlement amount (${amount}) exceeds remaining owner settlement (${remaining})`);
    }

    // Determine new status
    let newStatus = 'PAID';
    if (amount < remaining) {
      newStatus = 'PARTIAL';
    }

    // Update settlement
    const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
      owner_settlement_amount: amount,
      owner_settlement_status: newStatus,
      owner_settlement_paid_at: new Date(),
      owner_settlement_payment_method: payment_method || 'cash',
      owner_settlement_reference: reference_number || null,
      owner_settlement_notes: notes || null,
    });

    // Create financial transaction
    await this.financialTxRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      transaction_type: 'OWNER_SETTLEMENT',
      amount,
      direction: 'DEBIT',
      payment_method: payment_method || 'cash',
      reference_number: reference_number || null,
      status: newStatus === 'PAID' ? 'PAID' : 'PARTIAL',
      created_by: admin?.user_id || null,
      metadata: JSON.stringify({ settlement_id: updated.settlement_id }),
    });

    // Recalculate trip financial
    await this.tripFinancialRepo.calculateTripFinancial(bookingId);

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'owner_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: updated.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return updated;
  }

  /**
   * Get settlement details for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object>}
   */
  async getSettlement(bookingId) {
    const settlement = await this.tripSettlementRepo.findByBookingId(bookingId);
    if (!settlement) {
      return null;
    }

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);

    return {
      ...settlement,
      remainingDriverSettlement: tripFinancial?.remaining_driver_settlement || 0,
      remainingOwnerSettlement: tripFinancial?.remaining_owner_settlement || 0,
    };
  }
}

module.exports = TripSettlementService;
