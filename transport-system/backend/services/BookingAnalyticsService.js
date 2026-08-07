/**
 * BookingAnalyticsService
 * Business logic for analytics.
 */

const BookingAnalyticsRepository = require('../repositories/BookingAnalyticsRepository');

class BookingAnalyticsDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BookingAnalyticsDomainError';
    this.code = code;
  }
}

class ValidationError extends BookingAnalyticsDomainError {
  constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class BookingAnalyticsService {
  /**
   * @param {Object=} deps
   * @param {BookingAnalyticsRepository=} deps.analyticsRepo
   */
  constructor(deps = {}) {
    this.analyticsRepo = deps.analyticsRepo || new BookingAnalyticsRepository();
  }

  /**
   * Booking dashboard summary.
   */
  async bookingDashboard(opts = {}) {
    return await this.analyticsRepo.getBookingCounts(opts);
  }

  /**
   * Revenue summary.
   */
  async revenueSummary(opts = {}) {
    // business validation: dateFrom/dateTo format left to upstream
    return await this.analyticsRepo.getRevenueSummary(opts);
  }

  /**
   * Top routes.
   */
  async topRoutes(opts = {}) {
    const topN = opts.topN ?? 10;
    if (topN <= 0) throw new ValidationError('topN must be positive');
    return await this.analyticsRepo.getTopRoutes(topN);
  }

  /**
   * Driver performance.
   */
  async driverPerformance(opts = {}) {
    const limit = opts.limit ?? 20;
    if (limit <= 0) throw new ValidationError('limit must be positive');
    return await this.analyticsRepo.getDriverPerformance({ limit });
  }

  /**
   * Vehicle utilization.
   */
  async vehicleUtilization(opts = {}) {
    const limit = opts.limit ?? 20;
    if (limit <= 0) throw new ValidationError('limit must be positive');
    return await this.analyticsRepo.getVehicleUtilization({ limit });
  }
}

module.exports = BookingAnalyticsService;

