/**
 * TripAdvanceService
 * Business logic for managing trip advances.
 *
 * IMPORTANT: Never overwrite previous advances.
 * Every advance creates a new immutable record.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripAdvanceRepository = require('../repositories/TripAdvanceRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripAdvanceService {
  constructor() {
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripAdvanceRepo = new TripAdvanceRepository();
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create a new advance for a trip.
   * @param {number} bookingId
   * @param {Object} advanceData
   * @param {Object} admin - Admin performing the action
   * @returns {Promise<Object>}
   */
  async createAdvance(bookingId, advanceData, admin = null) {
    const {
      amount,
      advance_type,
      payment_method,
      reference_number,
      notes,
      driver_id,
      vehicle_id,
      transport_owner_id,
    } = advanceData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    if (!advance_type) {
      throw new ValidationError('Advance type is required');
    }

    // Get or create trip financial
    let tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(bookingId);
    }

    // Get booking for driver/owner info
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { driver_id: true, vehicle_owner_id: true, vehicle_id: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // Use provided IDs or fall back to booking IDs
    const effectiveDriverId = driver_id || booking.driver_id;
    const effectiveVehicleId = vehicle_id || booking.vehicle_id;
    const effectiveOwnerId = transport_owner_id || booking.vehicle_owner_id;

    // Create the advance record
    const advance = await this.tripAdvanceRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      driver_id: effectiveDriverId,
      vehicle_id: effectiveVehicleId,
      transport_owner_id: effectiveOwnerId,
      amount,
      advance_type,
      payment_method: payment_method || 'cash',
      reference_number: reference_number || null,
      given_by: admin?.user_id || null,
      given_at: new Date(),
      notes: notes || null,
      status: 'approved',
    });

    // Create corresponding financial transaction
    const txType = this._mapAdvanceTypeToTransactionType(advance_type);
    await this.financialTxRepo.create({
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: bookingId,
      vehicle_id: effectiveVehicleId,
      driver_id: effectiveDriverId,
      transport_owner_id: effectiveOwnerId,
      transaction_type: txType,
      amount,
      direction: 'DEBIT',
      payment_method: payment_method || 'cash',
      reference_number: reference_number || null,
      status: 'PAID',
      created_by: admin?.user_id || null,
      metadata: JSON.stringify({ advance_id: advance.advance_id }),
    });

    // Recalculate trip financial
    await this.tripFinancialRepo.calculateTripFinancial(bookingId);

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'advance_created',
      entity_type: 'TripAdvance',
      entity_id: advance.advance_id,
      new_value: JSON.stringify({ amount, advance_type, booking_id }),
      reason: notes || null,
    });

    return advance;
  }

  /**
   * Get all advances for a booking.
   * @param {number} bookingId
   * @param {string} role
   * @param {Object} user
   * @returns {Promise<Array>}
   */
  async getAdvances(bookingId, role, user = null) {
    const advances = await this.tripAdvanceRepo.findByBookingId(bookingId);

    // Filter based on role
    switch (role) {
      case 'ADMIN':
        return advances;
      case 'TRANSPORT_OWNER':
        return advances.filter(a => a.advance_type === 'OWNER_ADVANCE');
      case 'DRIVER':
        return advances.filter(a => a.advance_type === 'DRIVER_ADVANCE' || a.advance_type === 'FUEL_ADVANCE');
      default:
        return [];
    }
  }

  /**
   * Get advance summary for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object>}
   */
  async getAdvanceSummary(bookingId) {
    const advances = await this.tripAdvanceRepo.findByBookingId(bookingId);

    const totalDriverAdvance = advances
      .filter(a => a.advance_type === 'DRIVER_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    const totalFuelAdvance = advances
      .filter(a => a.advance_type === 'FUEL_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    const totalOwnerAdvance = advances
      .filter(a => a.advance_type === 'OWNER_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    return {
      totalDriverAdvance,
      totalFuelAdvance,
      totalOwnerAdvance,
      totalAll: totalDriverAdvance + totalFuelAdvance + totalOwnerAdvance,
      count: advances.length,
    };
  }

  /**
   * Map advance type to financial transaction type.
   */
  _mapAdvanceTypeToTransactionType(advanceType) {
    const map = {
      DRIVER_ADVANCE: 'DRIVER_ADVANCE',
      FUEL_ADVANCE: 'FUEL_ADVANCE',
      OWNER_ADVANCE: 'OWNER_ADVANCE',
      OTHER: 'ADJUSTMENT',
    };
    return map[advanceType] || 'ADJUSTMENT';
  }
}

module.exports = TripAdvanceService;
