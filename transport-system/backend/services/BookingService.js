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
const { prisma } = require('../config/prisma');

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

    const bookingResult = await prisma.$transaction(async (tx) => {
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
   * Admin sends a final quote for a booking.
   * Business rules:
   * - booking must exist
   * - only PENDING bookings can receive a quote (idempotent when already SENT with same price)
   * - final_price (the Final Transport Charge) is required
   * - moves quote_status PENDING → SENT and records quote_sent_at
   * The booking stays `pending` until the customer accepts or rejects the quote.
   *
   * @param {number} bookingId
   * @param {Object} input - { final_price, remarks }
   */
  async sendQuote(bookingId, input = {}) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (input.final_price == null) {
      throw new ValidationError('final_price (Final Transport Charge) is required');
    }

    const finalPrice = Number(input.final_price);
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      throw new ValidationError('final_price must be a positive number');
    }

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    if (['cancelled', 'completed', 'delivered'].includes(existing.status)) {
      throw new ValidationError(`Cannot send a quote for a booking with status: ${existing.status}`);
    }

    // Idempotent re-send: allow SENT → SENT (e.g., admin corrects price before acceptance).
    if (existing.quote_status === 'ACCEPTED' || existing.quote_status === 'REJECTED') {
      throw new ValidationError(`Quote already ${existing.quote_status.toLowerCase()} for this booking`);
    }

    const patch = {
      final_price: finalPrice,
      quote_status: 'SENT',
      quote_sent_at: new Date(),
      status: existing.status || 'pending',
    };
    if (input.remarks != null) patch.quote_remarks = String(input.remarks);

    const updated = await this.bookingRepo.update(bookingId, patch);

    await this.timelineRepo.addEvent(
      bookingId,
      'quote_sent',
      JSON.stringify({ final_price: finalPrice, remarks: input.remarks || null })
    );

    return updated;
  }

  /**
   * Customer responds to a sent quote.
   * Business rules:
   * - booking must exist
   * - quote must be SENT
   * - accept → quote_status = ACCEPTED, quote_accepted_at set, status = confirmed
   * - reject → quote_status = REJECTED
   *
   * @param {number} bookingId
   * @param {'ACCEPT'|'REJECT'} action
   */
  async respondToQuote(bookingId, action) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      throw new ValidationError("action must be 'ACCEPT' or 'REJECT'");
    }

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    if (existing.quote_status !== 'SENT') {
      throw new ValidationError(
        `Quote is not in SENT state (current: ${existing.quote_status || 'PENDING'})`
      );
    }

    if (action === 'ACCEPT') {
      const patch = {
        quote_status: 'ACCEPTED',
        quote_accepted_at: new Date(),
        status: 'confirmed',
        confirmed_at: new Date(),
      };
      await this.bookingRepo.update(bookingId, patch);

      await this.timelineRepo.addEvent(
        bookingId,
        'quote_accepted',
        JSON.stringify({ final_price: existing.final_price })
      );

      return { ok: true, quote_status: 'ACCEPTED', status: 'confirmed' };
    }

    const patch = { quote_status: 'REJECTED' };
    await this.bookingRepo.update(bookingId, patch);

    await this.timelineRepo.addEvent(bookingId, 'quote_rejected', JSON.stringify({}));

    return { ok: true, quote_status: 'REJECTED', status: existing.status };
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

