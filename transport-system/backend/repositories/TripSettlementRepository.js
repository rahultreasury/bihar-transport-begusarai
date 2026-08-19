/**
 * TripSettlementRepository
 * Database-only repository for TripSettlement model.
 */

const { prisma } = require('../config/prisma');

class TripSettlementRepository {
  /**
   * Create a trip settlement.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.tripSettlement.create({
      data,
      include: {
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
  }

  /**
   * Find settlement by booking ID.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async findByBookingId(bookingId) {
    return await prisma.tripSettlement.findFirst({
      where: { booking_id: bookingId },
      include: {
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
  }

  /**
   * Find settlement by ID.
   * @param {number} settlementId
   * @returns {Promise<Object|null>}
   */
  async findById(settlementId) {
    return await prisma.tripSettlement.findUnique({
      where: { settlement_id: settlementId },
      include: {
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
  }

  /**
   * Update settlement.
   * @param {number} settlementId
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async update(settlementId, data, tx = null) {
    const client = tx || prisma;
    return await client.tripSettlement.update({
      where: { settlement_id: settlementId },
      data,
    });
  }

  /**
   * Find or create settlement for a booking.
   * @param {number} bookingId
   * @param {number} tripFinancialId
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async findOrCreateByBookingId(bookingId, tripFinancialId, tx = null) {
    const client = tx || prisma;
    const existing = await client.tripSettlement.findFirst({
      where: { booking_id: bookingId },
    });

    if (existing) {
      return existing;
    }

    return await client.tripSettlement.create({
      data: {
        booking_id: bookingId,
        trip_financial_id: tripFinancialId,
      },
    });
  }
}

module.exports = TripSettlementRepository;
