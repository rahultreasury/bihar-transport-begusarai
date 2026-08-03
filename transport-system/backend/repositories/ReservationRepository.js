/**
 * ReservationRepository
 * Database-only repository for reservations (driver/vehicle held before
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
   * @param {number=} data.vehicle_id
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
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async getActiveByBooking(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.reservation.findFirst({
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
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update a reservation by id.
   * @param {number} reservationId
   * @param {Object} data - partial fields to update (status, driver_id, vehicle_id, expires_at, released_at, converted_at)
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{changes:number}>}
   */
  async update(reservationId, data, tx = null) {
    const client = tx || prisma;
    const allowedFields = [
      'driver_id',
      'vehicle_id',
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

