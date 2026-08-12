  /**
 * BookingAnalyticsRepository
 * Database-only repository for booking analytics.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

class BookingAnalyticsRepository {
  /**
   * Get booking counts grouped by status.
   * @param {Object=} opts
   * @param {string=} opts.dateFrom
   * @param {string=} opts.dateTo
   * @returns {Promise<Object[]>} rows: { status, count }
   */
  async getBookingCounts(opts = {}) {
    const { dateFrom, dateTo } = opts;
    const where = {};

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) {
        where.created_at.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.created_at.lte = new Date(dateTo);
      }
    }

    try {
      const rows = await prisma.booking.groupBy({
        by: ['status'],
        _count: { status: true },
        where,
        orderBy: { _count: { status: 'desc' } },
      });

      return rows.map((r) => ({
        status: r.status,
        count: r._count.status,
      }));
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get revenue summary for delivered/completed bookings.
   * @param {Object=} opts
   * @param {string=} opts.dateFrom
   * @param {string=} opts.dateTo
   * @returns {Promise<Object>} { totalRevenue, deliveredCount }
   */
  async getRevenueSummary(opts = {}) {
    const { dateFrom, dateTo } = opts;
    const where = {
      status: { in: ['delivered', 'completed'] },
    };

    if (dateFrom || dateTo) {
      where.delivered_at = {};
      if (dateFrom) {
        where.delivered_at.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.delivered_at.lte = new Date(dateTo);
      }
    }

    try {
      const agg = await prisma.booking.aggregate({
        where,
        _sum: { final_price: true },
        _count: true,
      });

      return {
        totalRevenue: agg._sum.final_price || 0,
        deliveredCount: agg._count,
      };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get top routes by frequency (top N).
   * Route is computed as pickup_city -> drop_city.
   * @param {number=} topN
   * @returns {Promise<Object[]>} rows: { pickup_city, drop_city, count }
   */
  async getTopRoutes(topN = 10) {
    try {
      const rows = await prisma.booking.groupBy({
        by: ['pickup_city', 'drop_city'],
        where: {
          status: { in: ['delivered', 'completed'] },
        },
        _count: { booking_id: true },
        orderBy: { _count: { booking_id: 'desc' } },
        take: topN,
      });

      return rows.map((r) => ({
        pickup_city: r.pickup_city,
        drop_city: r.drop_city,
        count: r._count.booking_id,
      }));
    } catch (err) {
      throw err;
    }
  }

  /**
   * Driver performance: completed/delivered counts and earnings.
   * @param {Object=} opts
   * @param {number=} opts.limit
   * @returns {Promise<Object[]>}
   */
  async getDriverPerformance(opts = {}) {
    const { limit = 20 } = opts;
    try {
      const rows = await prisma.booking.groupBy({
        by: ['driver_id'],
        where: {
          driver_id: { not: null },
          status: { in: ['delivered', 'completed'] },
        },
        _count: { booking_id: true },
        _sum: { final_price: true },
        orderBy: { _sum: { final_price: 'desc' } },
        take: limit,
      });

      return rows.map((r) => ({
        driver_id: r.driver_id,
        completedCount: r._count.booking_id,
        earnings: r._sum.final_price || 0,
      }));
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingAnalyticsRepository;

