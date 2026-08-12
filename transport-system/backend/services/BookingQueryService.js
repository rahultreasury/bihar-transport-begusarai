/**
 * BookingQueryService
 * Read-only query concerns for the Admin Bookings page.
 *
 * This service sits between the Controller and the Repository. It contains
 * NO Prisma access and NO Express req/res. It delegates every read to the
 * BookingRepository (the ONLY layer allowed to touch Prisma).
 */

const BookingRepository = require('../repositories/BookingRepository');

class BookingQueryService {
  /**
   * @param {Object=} deps
   * @param {BookingRepository=} deps.bookingRepo
   */
  constructor(deps = {}) {
    this.bookingRepo = deps.bookingRepo || new BookingRepository();
  }

  /**
   * List bookings with filters, pagination, sorting, and full relation data.
   * @param {Object} filters - pre-validated query params (see validators/bookingQuery.js)
   * @returns {Promise<{data: Object[], pagination: Object}>}
   */
  async listBookings(filters) {
    return await this.bookingRepo.listBookings(filters);
  }
}

module.exports = BookingQueryService;
