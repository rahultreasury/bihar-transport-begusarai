/**
 * ReservationRepository
 * Database-only repository for reservations (driver held before
 * customer approval of a quote). Single source of truth for reserved resources.
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 */

const { prisma } = require('../config/prisma');

class ReservationRepository {
  /**
   * Create a reservation record.
   * @param {Object} data
   * @param {number} data.booking_id
   * @param {number=} data.driver_id
   * @param {string=} data.status
   * @param {Date=} data.expires_at
   * @param {number=} data.reserved_by
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{reservation_id:number}>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    try {
      const reservation = await client.reservation.create({
        data: {
          booking_id: data.booking_id,
          driver_id: data.driver_id || null,
          vehicle_id: data.vehicle_id || null,
          status: data.status || 'ACTIVE',
          expires_at: data.expires_at || null,
          reserved_by: data.reserved_by || null,
        },
      });
      return { reservation_id: reservation.reservation_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get current ACTIVE reservation for a booking.
   *
   * The reserved driver is returned with their REAL registered vehicle
   * resolved through the one-driver-one-vehicle relation
   * (Driver.current_vehicle_id → TransportVehicle).
   *
   * WHY THE FLATTENING BELOW
   *   `Driver` has no denormalized `vehicle_number` / `vehicle_type` columns.
   *   Selecting them made Prisma reject the query with "Unknown argument", so
   *   EVERY customer accept/reject 500'd at this line. The registered vehicle
   *   is fetched through the relation and then surfaced under the same
   *   `driver.vehicle_number` / `driver.vehicle_type` keys that
   *   BookingService.getBookingForTracking already reads, so the consumer
   *   contract is unchanged.
   *
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async getActiveByBooking(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      const reservation = await client.reservation.findFirst({
        where: { booking_id: bookingId, status: 'ACTIVE' },
        orderBy: [
          { created_at: 'desc' },
          { reservation_id: 'desc' },
        ],
        include: {
          driver: {
            select: {
              driver_id: true,
              driver_name: true,
              mobile: true,
              rating: true,
              total_deliveries: true,
              profile_image: true,
              currentVehicle: {
                select: {
                  vehicle_id: true,
                  vehicle_number: true,
                  vehicle_name: true,
                  vehicle_type: true,
                  capacity_kg: true,
                },
              },
              user: {
                select: { first_name: true, last_name: true, phone: true },
              },
            },
          },
          vehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_name: true,
              vehicle_type: true,
              capacity_kg: true,
            },
          },
        },
      });

      if (!reservation?.driver) return reservation;

      // Present the driver's registered vehicle under the flat keys consumers
      // expect, without pretending the Driver table owns those columns.
      return {
        ...reservation,
        driver: {
          ...reservation.driver,
          vehicle_id: reservation.driver.currentVehicle?.vehicle_id ?? null,
          vehicle_number: reservation.driver.currentVehicle?.vehicle_number ?? null,
          vehicle_name: reservation.driver.currentVehicle?.vehicle_name ?? null,
          vehicle_type: reservation.driver.currentVehicle?.vehicle_type ?? null,
        },
      };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update a reservation by id.
   * @param {number} reservationId
   * @param {Object} data - partial fields to update (status, driver_id, expires_at, released_at, converted_at)
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{changes:number}>}
   */
  async update(reservationId, data, tx = null) {
    const client = tx || prisma;
    const allowedFields = [
      'driver_id',
      'status',
      'expires_at',
      'released_at',
      'converted_at',
      'reserved_by',
    ];
    const updateData = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(data || {}, key)) {
        updateData[key] = data[key];
      }
    }
    if (Object.keys(updateData).length === 0) {
      throw new Error('ReservationRepository.update: no allowed fields provided');
    }
    try {
      await client.reservation.update({
        where: { reservation_id: reservationId },
        data: updateData,
      });
      return { changes: 1 };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Release all ACTIVE reservations for a booking (e.g. on reject/expiry).
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<number>} number of released reservations
   */
  async releaseAllActive(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      const result = await client.reservation.updateMany({
        where: { booking_id: bookingId, status: 'ACTIVE' },
        data: { status: 'RELEASED', released_at: new Date() },
      });
      return result.count;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Mark reservations for a booking as CONVERTED (on quote accept).
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<number>} number of converted reservations
   */
  async convertAllActive(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      const result = await client.reservation.updateMany({
        where: { booking_id: bookingId, status: 'ACTIVE' },
        data: { status: 'CONVERTED', converted_at: new Date() },
      });
      return result.count;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get all reservations for a booking (history).
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object[]>}
   */
  async getByBooking(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.reservation.findMany({
        where: { booking_id: bookingId },
        orderBy: [
          { created_at: 'desc' },
          { reservation_id: 'desc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }
}

module.exports = ReservationRepository;
