/**
 * CommissionRecordRepository
 * Database-only repository for CommissionRecord model.
 */

const { prisma } = require('../config/prisma');

class CommissionRecordRepository {
  /**
   * Create a commission record.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.commissionRecord.create({
      data,
      include: {
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });
  }

  /**
   * Find commission records by trip financial ID.
   * @param {number} tripFinancialId
   * @returns {Promise<Array>}
   */
  async findByTripFinancialId(tripFinancialId) {
    return await prisma.commissionRecord.findMany({
      where: { trip_financial_id: tripFinancialId },
      orderBy: { applied_at: 'desc' },
    });
  }

  /**
   * Find commission records by booking ID.
   * @param {number} bookingId
   * @returns {Promise<Array>}
   */
  async findByBookingId(bookingId) {
    return await prisma.commissionRecord.findMany({
      where: { booking_id: bookingId },
      orderBy: { applied_at: 'desc' },
    });
  }

  /**
   * Find latest commission record for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async findLatestByBookingId(bookingId) {
    return await prisma.commissionRecord.findFirst({
      where: { booking_id: bookingId },
      orderBy: { applied_at: 'desc' },
    });
  }
}

module.exports = CommissionRecordRepository;
