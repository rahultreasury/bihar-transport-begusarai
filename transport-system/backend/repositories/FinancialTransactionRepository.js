/**
 * FinancialTransactionRepository
 * Database-only repository for FinancialTransaction model.
 */

const { prisma } = require('../config/prisma');

class FinancialTransactionRepository {
  /**
   * Create a financial transaction.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.financialTransaction.create({
      data,
      include: {
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });
  }

  /**
   * Find transactions by trip financial ID.
   * @param {number} tripFinancialId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async findByTripFinancialId(tripFinancialId, filters = {}) {
    const where = { trip_financial_id: tripFinancialId };
    if (filters.transaction_type) where.transaction_type = filters.transaction_type;
    if (filters.driver_id) where.driver_id = parseInt(filters.driver_id);
    if (filters.transport_owner_id) where.transport_owner_id = parseInt(filters.transport_owner_id);

    return await prisma.financialTransaction.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Find transactions by booking ID.
   * @param {number} bookingId
   * @returns {Promise<Array>}
   */
  async findByBookingId(bookingId) {
    return await prisma.financialTransaction.findMany({
      where: { booking_id: bookingId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Sum transactions by type for a trip financial.
   * @param {number} tripFinancialId
   * @param {string} transactionType
   * @param {string} direction
   * @returns {Promise<number>}
   */
  async sumAmount(tripFinancialId, transactionType, direction) {
    const result = await prisma.financialTransaction.aggregate({
      where: {
        trip_financial_id: tripFinancialId,
        transaction_type: transactionType,
        direction: direction,
        status: 'PAID',
      },
      _sum: { amount: true },
    });

    return result._sum.amount || 0;
  }
}

module.exports = FinancialTransactionRepository;
