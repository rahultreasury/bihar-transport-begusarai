/**
 * TripAdvanceRepository
 * Database-only repository for TripAdvance model.
 */

const { prisma } = require('../config/prisma');
const { NotFoundError } = require('../utils/AppError');

class TripAdvanceRepository {
  /**
   * Create a trip advance.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.tripAdvance.create({
      data,
      include: {
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });
  }

  /**
   * Find advance by ID.
   * @param {number} advanceId
   * @returns {Promise<Object|null>}
   */
  async findById(advanceId) {
    return await prisma.tripAdvance.findUnique({
      where: { advance_id: advanceId },
      include: {
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
  }

  /**
   * Find all advances for a trip financial.
   * @param {number} tripFinancialId
   * @returns {Promise<Array>}
   */
  async findByTripFinancialId(tripFinancialId) {
    return await prisma.tripAdvance.findMany({
      where: { trip_financial_id: tripFinancialId },
      orderBy: { given_at: 'desc' },
    });
  }

  /**
   * Find all advances for a booking.
   * @param {number} bookingId
   * @returns {Promise<Array>}
   */
  async findByBookingId(bookingId) {
    return await prisma.tripAdvance.findMany({
      where: { booking_id: bookingId },
      orderBy: { given_at: 'desc' },
    });
  }

  /**
   * Find all advances for a driver.
   * @param {number} driverId
   * @returns {Promise<Array>}
   */
  async findByDriverId(driverId) {
    return await prisma.tripAdvance.findMany({
      where: { driver_id: driverId },
      orderBy: { given_at: 'desc' },
    });
  }

  /**
   * Update advance.
   * @param {number} advanceId
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async update(advanceId, data, tx = null) {
    const client = tx || prisma;
    return await client.tripAdvance.update({
      where: { advance_id: advanceId },
      data,
    });
  }

  /**
   * Delete advance (only if pending).
   * @param {number} advanceId
   * @returns {Promise<Object>}
   */
  async delete(advanceId) {
    return await prisma.tripAdvance.delete({
      where: { advance_id: advanceId },
    });
  }

  /**
   * Sum advances for a trip financial.
   * @param {number} tripFinancialId
   * @param {string} advanceType - Optional filter by type
   * @returns {Promise<number>}
   */
  async sumAmount(tripFinancialId, advanceType = null) {
    const where = { trip_financial_id: tripFinancialId };
    if (advanceType) where.advance_type = advanceType;

    const result = await prisma.tripAdvance.aggregate({
      where,
      _sum: { amount: true },
    });

    return result._sum.amount || 0;
  }
}

module.exports = TripAdvanceRepository;
