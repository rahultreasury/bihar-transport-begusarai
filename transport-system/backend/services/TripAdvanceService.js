/**
 * TripAdvanceService
 * Business logic for managing trip advances.
 *
 * IMPORTANT: Never overwrite previous advances.
 * Every advance creates a new immutable record.
 *
 * Supports both booking-linked advances (legacy) and direct trip advances (Phase 1).
 *
 * PHASE 3 REDESIGN: Every advance now creates a proper FinancialTransaction
 * with from_party → to_party tracking.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripAdvanceRepository = require('../repositories/TripAdvanceRepository');
const TripTransactionService = require('./TripTransactionService');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripAdvanceService {
  constructor() {
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripAdvanceRepo = new TripAdvanceRepository();
    this.tripTransactionService = new TripTransactionService();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create a new advance for a trip.
   * @param {number} bookingId - Optional booking ID (legacy)
   * @param {number} tripId - Optional trip ID (Phase 1)
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
      trip_id,
    } = advanceData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    if (!advance_type) {
      throw new ValidationError('Advance type is required');
    }

    // Determine if this is a booking-linked or trip-linked advance
    const isBookingLinked = !!bookingId;
    const isTripLinked = !!trip_id;

    if (!isBookingLinked && !isTripLinked) {
      throw new ValidationError('Either booking_id or trip_id is required');
    }

    let tripFinancial = null;
    let effectiveBookingId = bookingId;
    let effectiveTripId = trip_id;

    if (isBookingLinked) {
      // Legacy flow: find or create trip financial by booking ID
      tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
      if (!tripFinancial) {
        tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(bookingId);
      }
    } else if (isTripLinked) {
      // Phase 1 flow: validate trip exists
      const trip = await prisma.trip.findUnique({
        where: { trip_id: effectiveTripId },
        select: { trip_id: true, booking_id: true, driver_id: true, vehicle_id: true, transport_owner_id: true, source_type: true, client_id: true },
      });
      if (!trip) {
        throw new NotFoundError('Trip not found');
      }
      effectiveBookingId = trip.booking_id;
      // Use trip's driver/vehicle/owner if not provided
      if (!driver_id) driver_id = trip.driver_id;
      if (!vehicle_id) vehicle_id = trip.vehicle_id;
      if (!transport_owner_id) transport_owner_id = trip.transport_owner_id;
    }

    // Get booking for driver/owner info (if available)
    let booking = null;
    if (effectiveBookingId) {
      booking = await prisma.booking.findUnique({
        where: { booking_id: effectiveBookingId },
        select: { driver_id: true, vehicle_owner_id: true, vehicle_id: true, source_type: true, client_id: true },
      });
    }

    // Use provided IDs or fall back to booking/trip IDs
    const effectiveDriverId = driver_id || booking?.driver_id;
    const effectiveVehicleId = vehicle_id || booking?.vehicle_id;
    const effectiveOwnerId = transport_owner_id || booking?.vehicle_owner_id;

    // Determine the recipient party
    let toParty = 'DRIVER';
    if (advance_type === 'OWNER_ADVANCE') {
      toParty = 'TRANSPORT_OWNER';
    } else if (advance_type === 'FUEL_ADVANCE') {
      toParty = 'DRIVER'; // Fuel advance goes to driver
    }

    // Create the advance record
    const advance = await this.tripAdvanceRepo.create(
      {
        trip_financial_id: tripFinancial?.trip_financial_id || null,
        booking_id: effectiveBookingId,
        trip_id: isTripLinked ? effectiveTripId : null,
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
      }
    );

    // Create corresponding financial transaction (if trip financial exists)
    if (tripFinancial) {
      const trip = isTripLinked
        ? await prisma.trip.findUnique({ where: { trip_id: effectiveTripId } })
        : await prisma.trip.findFirst({ where: { booking_id: effectiveBookingId } });

      if (advance_type === 'OWNER_ADVANCE') {
        await this.tripTransactionService.createOwnerAdvance(
          {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: effectiveBookingId,
            trip_id: effectiveTripId,
            amount,
            payment_method: payment_method || 'cash',
            reference_number: reference_number || null,
            transaction_date: new Date(),
            notes: notes || 'Trip Advance',
            created_by: admin?.user_id || null,
            transport_owner_id: effectiveOwnerId,
          }
        );
      } else if (advance_type === 'DRIVER_ADVANCE' || advance_type === 'FUEL_ADVANCE') {
        await this.tripTransactionService.createDriverAdvance(
          {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: effectiveBookingId,
            trip_id: effectiveTripId,
            amount,
            payment_method: payment_method || 'cash',
            reference_number: reference_number || null,
            transaction_date: new Date(),
            notes: notes || (advance_type === 'FUEL_ADVANCE' ? 'Fuel Advance' : 'Driver Advance'),
            created_by: admin?.user_id || null,
            driver_id: effectiveDriverId,
            advance_type,
          }
        );
      }
    }

    // Recalculate trip financial if booking-linked
    if (effectiveBookingId) {
      await this.tripFinancialRepo.calculateTripFinancial(effectiveBookingId);
    }

    // Create audit log
    await this.auditRepo.create({
      user_id: admin?.user_id || null,
      user_role: admin?.role || 'system',
      action: 'advance_created',
      entity_type: 'TripAdvance',
      entity_id: advance.advance_id,
      new_value: JSON.stringify({ amount, advance_type, booking_id: effectiveBookingId, trip_id: effectiveTripId }),
      reason: notes || null,
    });

    return advance;
  }

  /**
   * Get all advances for a booking or trip.
   * @param {number} bookingId - Optional booking ID
   * @param {number} tripId - Optional trip ID
   * @param {string} role
   * @param {Object} user
   * @returns {Promise<Array>}
   */
  async getAdvances(bookingId, tripId, role, user = null) {
    let where = {};

    if (bookingId) {
      where.booking_id = bookingId;
    } else if (tripId) {
      where.trip_id = tripId;
    } else {
      return [];
    }

    const advances = await this.tripAdvanceRepo.findMany(where);

    // Filter based on role
    switch (role) {
      case 'ADMIN':
        return advances;
      case 'TRANSPORT_OWNER':
        return advances.filter((a) => a.advance_type === 'OWNER_ADVANCE');
      case 'DRIVER':
        return advances.filter((a) => a.advance_type === 'DRIVER_ADVANCE' || a.advance_type === 'FUEL_ADVANCE');
      default:
        return [];
    }
  }

  /**
   * Get advance summary for a booking or trip.
   * @param {number} bookingId - Optional booking ID
   * @param {number} tripId - Optional trip ID
   * @returns {Promise<Object>}
   */
  async getAdvanceSummary(bookingId, tripId) {
    let where = {};

    if (bookingId) {
      where.booking_id = bookingId;
    } else if (tripId) {
      where.trip_id = tripId;
    } else {
      return {
        totalDriverAdvance: 0,
        totalFuelAdvance: 0,
        totalOwnerAdvance: 0,
        totalAll: 0,
        count: 0,
      };
    }

    const advances = await this.tripAdvanceRepo.findMany(where);

    const totalDriverAdvance = advances
      .filter((a) => a.advance_type === 'DRIVER_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    const totalFuelAdvance = advances
      .filter((a) => a.advance_type === 'FUEL_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    const totalOwnerAdvance = advances
      .filter((a) => a.advance_type === 'OWNER_ADVANCE')
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
   * Update the advance total on the trip record.
   * @param {number} tripId
   */
  async _updateTripAdvanceTotal(tripId) {
    const summary = await this.getAdvanceSummary(null, tripId);
    await prisma.trip.update({
      where: { trip_id: tripId },
      data: { advance: summary.totalAll },
    });
  }
}

module.exports = TripAdvanceService;
