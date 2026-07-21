/**
 * BookingService
 * Business-logic layer for bookings.
 *
 * IMPORTANT:
 * - No Express req/res usage.
 * - Services call repositories only.
 * - Throws typed exceptions.
 */

const BookingRepository = require('../repositories/BookingRepository');
const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');

/**
 * @typedef {Object} ServiceResult
 * @property {boolean} ok
 * @property {string=} code
 * @property {any=} data
 */

class BookingDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BookingDomainError';
    this.code = code;
  }
}

class NotFoundError extends BookingDomainError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

class ValidationError extends BookingDomainError {
  constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class BookingService {
  /**
   * @param {Object=} deps
   * @param {BookingRepository=} deps.bookingRepo
   * @param {BookingTimelineRepository=} deps.timelineRepo
   */
  constructor(deps = {}) {
    this.bookingRepo = deps.bookingRepo || new BookingRepository();
    this.timelineRepo = deps.timelineRepo || new BookingTimelineRepository();
  }

  /**
   * Create a new booking.
   * Business rules:
   * - booking_reference must be present
   * - user_id must be present
   * - vehicle_type_required must be present
   * @param {Object} input
   */
  async createBooking(input) {
    if (!input || !input.booking_reference) {
      throw new ValidationError('booking_reference is required');
    }
    if (!input.user_id) {
      throw new ValidationError('user_id is required');
    }
    if (!input.vehicle_type_required) {
      throw new ValidationError('vehicle_type_required is required');
    }

    const bookingResult = await require('../config/database').transaction(async (tx) => {
      const booking = await this.bookingRepo.create(input, tx);
      await this.timelineRepo.addEvent(
        booking.booking_id,
        'booking_created',
        JSON.stringify({ booking_reference: input.booking_reference }),
        tx
      );
      return booking;
    });

    // Transactional lifecycle is handled upstream after repository tx support is enabled.
    // (API contract: createBooking returns the booking_id wrapper from repository.)
    return bookingResult;
  }

  /**
   * Update a booking with status transitions.
   * Business rules (basic):
   * - status can be updated only to an allowed set
   * - delivered/completed require final_price present (soft rule)
   */
  async updateBooking(bookingId, input) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!input || typeof input !== 'object') throw new ValidationError('input is required');

    const allowedStatuses = [
      'pending',
      'confirmed',
      'driver_assigned',
      'pickup_completed',
      'in_transit',
      'delivered',
      'cancelled',
      'completed'
    ];

    if (input.status && !allowedStatuses.includes(input.status)) {
      throw new ValidationError('Invalid status');
    }

    if (['delivered', 'completed'].includes(input.status) && (input.final_price == null)) {
      // soft business validation to prevent inconsistent analytics
      throw new ValidationError('final_price is required when delivered/completed');
    }

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    const updated = await this.bookingRepo.update(bookingId, input);

    if (input.status && input.status !== existing.status) {
      await this.timelineRepo.addEvent(
        bookingId,
        'booking_status_changed',
        JSON.stringify({ from: existing.status, to: input.status })
      );
    }

    return updated;
  }

  /**
   * Cancel a booking.
   */
  async cancelBooking(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');

    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking not found');

    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      throw new ValidationError('This booking cannot be cancelled');
    }

    return await this.updateBooking(bookingId, { status: 'cancelled' });
  }

  /**
   * Complete a booking.
   */
  async completeBooking(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking not found');

    if (booking.status === 'cancelled') {
      throw new ValidationError('Cancelled booking cannot be completed');
    }

    // Business validation: ensure price exists
    if (booking.final_price == null) {
      throw new ValidationError('final_price is required');
    }

    return await this.updateBooking(bookingId, { status: 'completed' });
  }

  /**
   * Search bookings.
   * @param {Object} filters
   */
  async searchBookings(filters) {
    return await this.bookingRepo.search(filters);
  }
}

module.exports = {
  BookingService,
  BookingDomainError,
  NotFoundError,
  ValidationError
};

