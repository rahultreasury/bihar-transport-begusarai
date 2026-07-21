/**
 * BookingAnalyticsRepository
 * Database-only repository for booking analytics.
 */

const { query, run, get } = require('../config/database');

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
    try {
      let where = '1=1';
      const params = [];

      if (dateFrom) {
        where += ' AND DATE(created_at) >= DATE(?)';
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ' AND DATE(created_at) <= DATE(?)';
        params.push(dateTo);
      }

      return await query(
        `SELECT status, COUNT(*) as count
         FROM bookings
         WHERE ${where}
         GROUP BY status
         ORDER BY count DESC`,
        params
      );
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
    try {
      let where = 'status IN (?, ?)';
      const params = ['delivered', 'completed'];

      if (dateFrom) {
        where += ' AND DATE(delivered_at) >= DATE(?)';
        params.push(dateFrom);
      }
      if (dateTo) {
        where += ' AND DATE(delivered_at) <= DATE(?)';
        params.push(dateTo);
      }

      const row = await get(
        `SELECT
          COALESCE(SUM(final_price), 0) as totalRevenue,
          COUNT(*) as deliveredCount
         FROM bookings
         WHERE ${where}`,
        params
      );

      return row || { totalRevenue: 0, deliveredCount: 0 };
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
      return await query(
        `SELECT pickup_city, drop_city, COUNT(*) as count
         FROM bookings
         WHERE status IN ('delivered', 'completed')
         GROUP BY pickup_city, drop_city
         ORDER BY count DESC
         LIMIT ?`,
        [topN]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Vehicle utilization: number of bookings per vehicle.
   * @param {Object=} opts
   * @param {number=} opts.limit
   * @returns {Promise<Object[]>} rows: { vehicle_id, bookingCount }
   */
  async getVehicleUtilization(opts = {}) {
    const { limit = 20 } = opts;
    try {
      return await query(
        `SELECT vehicle_id, COUNT(*) as bookingCount
         FROM bookings
         WHERE vehicle_id IS NOT NULL
         GROUP BY vehicle_id
         ORDER BY bookingCount DESC
         LIMIT ?`,
        [limit]
      );
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
      return await query(
        `SELECT
          driver_id,
          COUNT(*) as completedCount,
          COALESCE(SUM(final_price), 0) as earnings
         FROM bookings
         WHERE driver_id IS NOT NULL
           AND status IN ('delivered', 'completed')
         GROUP BY driver_id
         ORDER BY earnings DESC
         LIMIT ?`,
        [limit]
      );
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingAnalyticsRepository;

