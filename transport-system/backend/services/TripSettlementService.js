/**
 * TripSettlementService
 * Business logic for trip settlements.
 *
 * Handles both driver and owner settlements independently.
 *
 * PHASE 3 REDESIGN: Every settlement now creates a proper FinancialTransaction
 * with from_party → to_party tracking.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripFinancialService = require('./TripFinancialService');
const TripSettlementRepository = require('../repositories/TripSettlementRepository');
const TripTransactionService = require('./TripTransactionService');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripSettlementService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma] - Optional Prisma client (for transaction support)
   */
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripFinancialService = new TripFinancialService(options);
    this.tripSettlementRepo = new TripSettlementRepository();
    this.tripTransactionService = new TripTransactionService(options);
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

    // Pre-transaction: ensure trip financial exists and is calculated
    let tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(bookingId);
    if (tripFinancial.status === 'DRAFT' || tripFinancial.driver_payout === null) {
      tripFinancial = await this.tripFinancialService.calculateTripFinancial(bookingId);
    }

    // Get or create settlement (pre-transaction, read-only)
    let settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
      bookingId,
      tripFinancial.trip_financial_id
    );

    // Validate amount against remaining settlement
    const remaining = tripFinancial.remaining_driver_settlement || 0;
    if (amount > remaining) {
      throw new ValidationError(`Settlement amount (${amount}) exceeds remaining driver settlement (${remaining})`);
    }

    // Determine new status
    let newStatus = 'PAID';
    if (amount < remaining) {
      newStatus = 'PARTIAL';
    }

    // Find the trip for this booking
    const trip = await this.prisma.trip.findFirst({
      where: { booking_id: bookingId },
      select: { trip_id: true, driver_id: true },
    });

    // Use a transaction to ensure settlement + financial transaction are atomic
    return await this.prisma.$transaction(async (tx) => {
      // Update settlement
      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        driver_settlement_amount: amount,
        driver_settlement_status: newStatus,
        driver_settlement_paid_at: new Date(),
        driver_settlement_payment_method: payment_method || 'cash',
        driver_settlement_reference: reference_number || null,
        driver_settlement_notes: notes || null,
      }, tx);

      // Create financial transaction
      await this.tripTransactionService.createDriverSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: bookingId,
          trip_id: trip?.trip_id,
          amount,
          payment_method: payment_method || 'cash',
          reference_number: reference_number || null,
          transaction_date: new Date(),
          notes: notes || 'Driver Settlement',
          created_by: admin?.user_id || null,
          driver_id: trip?.driver_id,
        },
        tx
      );

      return updated;
    });

    // Recalculate trip financial (outside transaction to avoid long-running tx)
    await this.tripFinancialService.calculateTripFinancial(bookingId);

    // Create audit log
    settlement = await this.tripSettlementRepo.findByBookingId(bookingId);
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'driver_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: settlement.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return settlement;
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

    // Pre-transaction: ensure trip financial exists and is calculated
    let tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(bookingId);
    if (tripFinancial.status === 'DRAFT' || tripFinancial.owner_settlement_amount === null) {
      tripFinancial = await this.tripFinancialService.calculateTripFinancial(bookingId);
    }

    // Get or create settlement (pre-transaction, read-only)
    let settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
      bookingId,
      tripFinancial.trip_financial_id
    );

    // Validate amount against remaining settlement
    const remaining = tripFinancial.remaining_owner_settlement || 0;
    if (amount > remaining) {
      throw new ValidationError(`Settlement amount (${amount}) exceeds remaining owner settlement (${remaining})`);
    }

    // Determine new status
    let newStatus = 'PAID';
    if (amount < remaining) {
      newStatus = 'PARTIAL';
    }

    // Find the trip for this booking
    const trip = await this.prisma.trip.findFirst({
      where: { booking_id: bookingId },
      select: { trip_id: true, transport_owner_id: true },
    });

    // Use a transaction to ensure settlement + financial transaction are atomic
    return await this.prisma.$transaction(async (tx) => {
      // Update settlement
      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        owner_settlement_amount: amount,
        owner_settlement_status: newStatus,
        owner_settlement_paid_at: new Date(),
        owner_settlement_payment_method: payment_method || 'cash',
        owner_settlement_reference: reference_number || null,
        owner_settlement_notes: notes || null,
      }, tx);

      // Create financial transaction
      await this.tripTransactionService.createOwnerSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: bookingId,
          trip_id: trip?.trip_id,
          amount,
          payment_method: payment_method || 'cash',
          reference_number: reference_number || null,
          transaction_date: new Date(),
          notes: notes || 'Owner Settlement',
          created_by: admin?.user_id || null,
          transport_owner_id: trip?.transport_owner_id,
        },
        tx
      );

      return updated;
    });

    // Recalculate trip financial (outside transaction to avoid long-running tx)
    await this.tripFinancialService.calculateTripFinancial(bookingId);

    // Create audit log
    settlement = await this.tripSettlementRepo.findByBookingId(bookingId);
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'owner_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: settlement.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return settlement;
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

  // ============================================================
  // TRIP-ID BASED SETTLEMENTS (standalone trips / offline clients)
  // ============================================================

  /**
   * Record a driver settlement for a trip by trip_id.
   * Uses CanonicalFinancialService for due calculations.
   * @param {number} tripId
   * @param {Object} settlementData
   * @param {Object} admin
   * @returns {Promise<Object>}
   */
  async recordDriverSettlementByTripId(tripId, settlementData, admin = null) {
    const { amount, payment_method, reference_number, notes } = settlementData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    // Validate trip exists
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      select: { trip_id: true, booking_id: true, driver_id: true, transport_owner_id: true, source_type: true, client_id: true },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Use canonical financial service to calculate current driver due
    const canonicalFinancialService = new CanonicalFinancialService();
    const tripFinancials = await canonicalFinancialService.calculateTripFinancials(tripId);
    const driverDue = tripFinancials.driverDue || 0;

    if (amount > driverDue) {
      throw new ValidationError(`Settlement amount (₹${amount}) exceeds remaining driver due (₹${driverDue})`);
    }

    // Find or create trip financial record
    let tripFinancial = await this.tripFinancialRepo.findByTripId(tripId);
    if (!tripFinancial) {
      tripFinancial = await this.tripFinancialRepo.findOrCreateByTripId(tripId);
    }

    // Find or create settlement record for this trip
    let settlement = await this.tripSettlementRepo.findOrCreateByTripId(
      tripId,
      tripFinancial.trip_financial_id
    );

    // Determine new status
    let newStatus = 'PAID';
    if (amount < driverDue) {
      newStatus = 'PARTIAL';
    }

    // Use a transaction to ensure settlement + financial transaction are atomic
    const result = await this.prisma.$transaction(async (tx) => {
      // Update settlement
      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        driver_settlement_amount: amount,
        driver_settlement_status: newStatus,
        driver_settlement_paid_at: new Date(),
        driver_settlement_payment_method: payment_method || 'cash',
        driver_settlement_reference: reference_number || null,
        driver_settlement_notes: notes || null,
      }, tx);

      // Create financial transaction
      await this.tripTransactionService.createDriverSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          amount,
          payment_method: payment_method || 'cash',
          reference_number: reference_number || null,
          transaction_date: new Date(),
          notes: notes || 'Driver Settlement',
          created_by: admin?.user_id || null,
          driver_id: trip.driver_id,
        },
        tx
      );

      return updated;
    });

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'driver_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: result.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return result;
  }

  /**
   * Record an owner settlement for a trip by trip_id.
   * Uses CanonicalFinancialService for due calculations.
   * @param {number} tripId
   * @param {Object} settlementData
   * @param {Object} admin
   * @returns {Promise<Object>}
   */
  async recordOwnerSettlementByTripId(tripId, settlementData, admin = null) {
    const { amount, payment_method, reference_number, notes } = settlementData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    // Validate trip exists
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      select: { trip_id: true, booking_id: true, driver_id: true, transport_owner_id: true, source_type: true, client_id: true },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Use canonical financial service to calculate current owner due
    const canonicalFinancialService = new CanonicalFinancialService();
    const tripFinancials = await canonicalFinancialService.calculateTripFinancials(tripId);
    const ownerDue = tripFinancials.ownerDue || 0;

    if (amount > ownerDue) {
      throw new ValidationError(`Settlement amount (₹${amount}) exceeds remaining owner due (₹${ownerDue})`);
    }

    // Find or create trip financial record
    let tripFinancial = await this.tripFinancialRepo.findByTripId(tripId);
    if (!tripFinancial) {
      tripFinancial = await this.tripFinancialRepo.findOrCreateByTripId(tripId);
    }

    // Find or create settlement record for this trip
    let settlement = await this.tripSettlementRepo.findOrCreateByTripId(
      tripId,
      tripFinancial.trip_financial_id
    );

    // Determine new status
    let newStatus = 'PAID';
    if (amount < ownerDue) {
      newStatus = 'PARTIAL';
    }

    // Use a transaction to ensure settlement + financial transaction are atomic
    const result = await this.prisma.$transaction(async (tx) => {
      // Update settlement
      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        owner_settlement_amount: amount,
        owner_settlement_status: newStatus,
        owner_settlement_paid_at: new Date(),
        owner_settlement_payment_method: payment_method || 'cash',
        owner_settlement_reference: reference_number || null,
        owner_settlement_notes: notes || null,
      }, tx);

      // Create financial transaction
      await this.tripTransactionService.createOwnerSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          amount,
          payment_method: payment_method || 'cash',
          reference_number: reference_number || null,
          transaction_date: new Date(),
          notes: notes || 'Owner Settlement',
          created_by: admin?.user_id || null,
          transport_owner_id: trip.transport_owner_id,
        },
        tx
      );

      return updated;
    });

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'owner_settlement_recorded',
      entity_type: 'TripSettlement',
      entity_id: result.settlement_id,
      new_value: JSON.stringify({ amount, status: newStatus, payment_method }),
      reason: notes || null,
    });

    return result;
  }
}

module.exports = TripSettlementService;
