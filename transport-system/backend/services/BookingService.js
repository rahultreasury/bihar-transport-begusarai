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
const ReservationRepository = require('../repositories/ReservationRepository');
const InvoiceRepository = require('../repositories/InvoiceRepository');
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
   * @param {ReservationRepository=} deps.reservationRepo
   * @param {InvoiceRepository=} deps.invoiceRepo
   */
  constructor(deps = {}) {
    this.bookingRepo = deps.bookingRepo || new BookingRepository();
    this.timelineRepo = deps.timelineRepo || new BookingTimelineRepository();
    this.reservationRepo = deps.reservationRepo || new ReservationRepository();
    this.invoiceRepo = deps.invoiceRepo || new InvoiceRepository();
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
   * - quote must not be expired
   * - accept → within ONE transaction: quote_status = ACCEPTED, status = confirmed,
   *   reserved driver/vehicle assigned, booking_assignment created, delivery updated,
   *   invoice generated, timeline updated, ETA computed.
   * - reject → quote_status = REJECTED, reserved driver/vehicle released.
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

    // Quote expiry check
    if (existing.quote_valid_until && new Date(existing.quote_valid_until) < new Date()) {
      // Auto-expire: release reservations and mark quote expired
      await prisma.$transaction(async (tx) => {
        await this.reservationRepo.releaseAllActive(bookingId, tx);
        await this.bookingRepo.update(bookingId, { quote_status: 'EXPIRED' }, tx);
        await this.timelineRepo.addEvent(
          bookingId,
          'quote_expired',
          JSON.stringify({ quote_valid_until: existing.quote_valid_until }),
          tx
        );
      });
      throw new ValidationError('Quote has expired. Please request a new quote.');
    }

    if (action === 'ACCEPT') {
      return await this.acceptQuote(bookingId, existing);
    }

    return await this.rejectQuote(bookingId, existing);
  }

  /**
   * Atomically accept a quote and confirm the booking.
   * All write operations happen in ONE Prisma transaction.
   * @private
   */
  async acceptQuote(bookingId, existing) {
    const finalPrice = existing.final_price != null ? Number(existing.final_price) : 0;

    // Load active reservation (driver + vehicle) created when the quote was sent.
    const activeReservation = await this.reservationRepo.getActiveByBooking(bookingId);
    const reservedDriverId = activeReservation?.driver_id || null;
    const reservedVehicleId = activeReservation?.vehicle_id || null;

    const now = new Date();
    const invoiceNumber = `INV-${existing.booking_reference || bookingId}-${Date.now().toString().slice(-6)}`;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Confirm booking + mark quote accepted
      await this.bookingRepo.update(bookingId, {
        quote_status: 'ACCEPTED',
        quote_accepted_at: now,
        status: 'confirmed',
        confirmed_at: now,
        driver_id: reservedDriverId,
        vehicle_id: reservedVehicleId,
      }, tx);

      // 2. Convert reservations ACTIVE → CONVERTED
      await this.reservationRepo.convertAllActive(bookingId, tx);

      // 3. Create booking_assignment with reserved driver + vehicle
      if (reservedDriverId || reservedVehicleId) {
        await tx.bookingAssignment.create({
          data: {
            booking_id: bookingId,
            assigned_driver_id: reservedDriverId,
            assigned_vehicle_id: reservedVehicleId,
            assignment_status: 'active',
          },
        });
      }

      // 4. Mark driver + vehicle as unavailable (assigned)
      if (reservedDriverId) {
        await tx.driver.update({
          where: { driver_id: reservedDriverId },
          data: { is_available: false },
        });
      }
      if (reservedVehicleId) {
        await tx.transportVehicle.update({
          where: { vehicle_id: reservedVehicleId },
          data: { is_available: false, current_status: 'on_trip' },
        });
      }

      // 5. Update delivery record
      const delivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
        select: { delivery_id: true },
      });
      if (delivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: reservedDriverId,
            vehicle_id: reservedVehicleId,
            current_status: 'booking_confirmed',
            status_description: 'Booking confirmed, driver and vehicle assigned',
          },
        });
      }

      // 6. Generate invoice
      await this.invoiceRepo.create({
        booking_id: bookingId,
        invoice_number: invoiceNumber,
        amount: finalPrice,
        status: 'PENDING',
      }, tx);

      // 7. Timeline event
      await this.timelineRepo.addEvent(
        bookingId,
        'quote_accepted',
        JSON.stringify({
          final_price: finalPrice,
          driver_id: reservedDriverId,
          vehicle_id: reservedVehicleId,
          invoice_number: invoiceNumber,
        }),
        tx
      );

      return { invoice_number: invoiceNumber };
    });

    return {
      ok: true,
      quote_status: 'ACCEPTED',
      status: 'confirmed',
      driver_id: reservedDriverId,
      vehicle_id: reservedVehicleId,
      invoice_number: result.invoice_number,
    };
  }

  /**
   * Reject a quote and release reserved driver/vehicle.
   * @private
   */
  async rejectQuote(bookingId, existing) {
    await prisma.$transaction(async (tx) => {
      await this.bookingRepo.update(bookingId, {
        quote_status: 'REJECTED',
        quote_rejected_at: new Date(),
      }, tx);

      // Release reserved driver + vehicle
      await this.reservationRepo.releaseAllActive(bookingId, tx);

      await this.timelineRepo.addEvent(bookingId, 'quote_rejected', JSON.stringify({}));
    });

    return { ok: true, quote_status: 'REJECTED', status: existing.status };
  }

  /**
   * Admin sends a quote with reservation of driver + vehicle.
   * This is the core of the enterprise workflow:
   *   driver/vehicle are RESERVED (not assigned) before the quote is sent.
   *   The booking is NOT confirmed until the customer accepts.
   *
   * Business rules:
   * - booking must exist
   * - final_price required
   * - driver_id and vehicle_id (reserved) required, or at least one
   * - quote_validity_hours (default 2) sets quote_valid_until
   * - sets quote_status → SENT, status → (stays pending / quote_requested)
   *
   * @param {number} bookingId
   * @param {Object} input - { final_price, remarks, driver_id, vehicle_id, quote_validity_hours, reserved_by }
   */
  async sendQuoteWithReservation(bookingId, input = {}) {
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
    if (existing.quote_status === 'ACCEPTED') {
      throw new ValidationError('Quote already accepted for this booking');
    }

    const reservedDriverId = input.driver_id ? parseInt(input.driver_id, 10) : null;
    const reservedVehicleId = input.vehicle_id ? parseInt(input.vehicle_id, 10) : null;

    if (!reservedDriverId && !reservedVehicleId) {
      throw new ValidationError('At least one of driver_id or vehicle_id must be reserved');
    }

    // Validate driver + vehicle availability
    if (reservedDriverId) {
      const driver = await prisma.driver.findUnique({
        where: { driver_id: reservedDriverId },
        select: { driver_id: true, is_available: true },
      });
      if (!driver) throw new NotFoundError('Reserved driver not found');
      if (!driver.is_available) {
        throw new ValidationError('Reserved driver is not available');
      }
    }
    if (reservedVehicleId) {
      const vehicle = await prisma.transportVehicle.findUnique({
        where: { vehicle_id: reservedVehicleId },
        select: { vehicle_id: true, is_available: true },
      });
      if (!vehicle) throw new NotFoundError('Reserved vehicle not found');
      if (!vehicle.is_available) {
        throw new ValidationError('Reserved vehicle is not available');
      }
    }

    const validityHours = Number(input.quote_validity_hours) || 2;
    const quoteValidUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Persist quote + validity
      const patch = {
        final_price: finalPrice,
        quote_status: 'SENT',
        quote_sent_at: new Date(),
        quote_valid_until: quoteValidUntil,
        status: existing.status || 'pending',
      };
      if (input.remarks != null) patch.quote_remarks = String(input.remarks);
      await this.bookingRepo.update(bookingId, patch, tx);

      // 2. Release any stale ACTIVE reservations (re-send / re-quote)
      await this.reservationRepo.releaseAllActive(bookingId, tx);

      // 3. Create reservation (driver + vehicle held)
      await this.reservationRepo.create({
        booking_id: bookingId,
        driver_id: reservedDriverId,
        vehicle_id: reservedVehicleId,
        status: 'ACTIVE',
        expires_at: quoteValidUntil,
        reserved_by: input.reserved_by || null,
      }, tx);

      // 4. Timeline
      await this.timelineRepo.addEvent(
        bookingId,
        'quote_sent',
        JSON.stringify({
          final_price: finalPrice,
          driver_id: reservedDriverId,
          vehicle_id: reservedVehicleId,
          quote_valid_until: quoteValidUntil,
          remarks: input.remarks || null,
        }),
        tx
      );

      return { quote_valid_until: quoteValidUntil };
    });

    return {
      ok: true,
      quote_status: 'SENT',
      status: existing.status || 'pending',
      final_price: finalPrice,
      quote_valid_until: result.quote_valid_until,
      driver_id: reservedDriverId,
      vehicle_id: reservedVehicleId,
    };
  }

  /**
   * Check a booking's quote and auto-expire if past validity.
   * Safe to call on every tracking read.
   * @param {number} bookingId
   */
  async checkAndExpireQuote(bookingId) {
    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    if (existing.quote_status === 'SENT' && existing.quote_valid_until) {
      if (new Date(existing.quote_valid_until) < new Date()) {
        await prisma.$transaction(async (tx) => {
          await this.reservationRepo.releaseAllActive(bookingId, tx);
          await this.bookingRepo.update(bookingId, { quote_status: 'EXPIRED' }, tx);
          await this.timelineRepo.addEvent(
            bookingId,
            'quote_expired',
            JSON.stringify({ quote_valid_until: existing.quote_valid_until }),
            tx
          );
        });
        return { expired: true };
      }
    }
    return { expired: false };
  }

  /**
   * Get a booking with full quote context for the tracking page.
   * Includes active reservation, driver + vehicle details, ETA.
   * @param {string} reference
   */
  async getBookingForTracking(reference) {
    if (!reference) throw new ValidationError('reference is required');

    const booking = await prisma.booking.findUnique({
      where: { booking_reference: reference },
      include: {
        vehicle: {
          select: {
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            capacity_kg: true,
          },
        },
        delivery: {
          select: {
            current_status: true,
            status_description: true,
            estimated_pickup_time: true,
            estimated_delivery_time: true,
          },
        },
        driver: {
          select: {
            driver_id: true,
            rating: true,
            total_deliveries: true,
            profile_image: true,
            user: {
              select: {
                user_id: true,
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
reservations: {
          where: { status: 'ACTIVE' },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: {
            driver: {
              select: {
                driver_id: true,
                driver_name: true,
                mobile: true,
                rating: true,
                profile_image: true,
              },
            },
            vehicle: {
              select: {
                vehicle_id: true,
                vehicle_number: true,
                vehicle_name: true,
                vehicle_type: true,
              },
            },
          },
        },
        bookingEvents: {
          orderBy: { created_at: 'asc' },
          select: {
            event_type: true,
            event_payload: true,
            created_at: true,
          },
        },
      },
    });

    if (!booking) throw new NotFoundError('Booking not found');

    // Auto-expire if needed
    if (booking.quote_status === 'SENT' && booking.quote_valid_until) {
      if (new Date(booking.quote_valid_until) < new Date()) {
        await this.checkAndExpireQuote(booking.booking_id);
        booking.quote_status = 'EXPIRED';
      }
    }

    const activeReservation = booking.reservations?.[0] || null;
    const driverInfo = booking.driver
      ? {
          driver_id: booking.driver.driver_id,
          rating: booking.driver.rating,
          total_deliveries: booking.driver.total_deliveries,
          profile_image: booking.driver.profile_image,
          first_name: booking.driver.user.first_name,
          last_name: booking.driver.user.last_name,
          phone: booking.driver.user.phone,
        }
      : null;

    const snapshotDriverInfo = booking.driver_name_snapshot
      ? {
          driver_name: booking.driver_name_snapshot,
          phone: booking.mobile_snapshot,
          vehicle_number: booking.truck_number_snapshot,
          vehicle_type: booking.vehicle?.vehicle_type || null,
          owner_name: booking.partner_name_snapshot,
        }
      : null;

    return {
      booking_id: booking.booking_id,
      booking_reference: booking.booking_reference,
      pickup_location: booking.pickup_location,
      pickup_city: booking.pickup_city,
      drop_location: booking.drop_location,
      drop_city: booking.drop_city,
      goods_description: booking.goods_description,
      status: booking.status,
      estimated_price: booking.estimated_price,
      final_price: booking.final_price,
      quote_status: booking.quote_status,
      quote_remarks: booking.quote_remarks,
      quote_sent_at: booking.quote_sent_at,
      quote_accepted_at: booking.quote_accepted_at,
      quote_rejected_at: booking.quote_rejected_at,
      quote_valid_until: booking.quote_valid_until,
      pickup_date: booking.pickup_date,
      pickup_time: booking.pickup_time,
      driver_id: booking.driver_id,
      vehicle_id: booking.vehicle_id,
      vehicle_number: booking.vehicle?.vehicle_number || booking.truck_number_snapshot || null,
      vehicle_name: booking.vehicle?.vehicle_name || null,
      vehicle_type: booking.vehicle?.vehicle_type || null,
current_status: booking.delivery?.current_status || null,
      status_description: booking.delivery?.status_description || null,
      estimated_pickup_time: booking.delivery?.estimated_pickup_time || null,
      estimated_delivery_time: booking.delivery?.estimated_delivery_time || null,
      driver: driverInfo,
      snapshot_driver: snapshotDriverInfo,
      bookingEvents: booking.bookingEvents || [],
      reservation: activeReservation
        ? {
            driver_id: activeReservation.driver_id,
            vehicle_id: activeReservation.vehicle_id,
            expires_at: activeReservation.expires_at,
            driver: activeReservation.driver
              ? {
                  driver_id: activeReservation.driver.driver_id,
                  driver_name: activeReservation.driver.driver_name,
                  mobile: activeReservation.driver.mobile,
                  rating: activeReservation.driver.rating,
                  profile_image: activeReservation.driver.profile_image,
                }
              : null,
            vehicle: activeReservation.vehicle
              ? {
                  vehicle_id: activeReservation.vehicle.vehicle_id,
                  vehicle_number: activeReservation.vehicle.vehicle_number,
                  vehicle_name: activeReservation.vehicle.vehicle_name,
                  vehicle_type: activeReservation.vehicle.vehicle_type,
                }
              : null,
          }
        : null,
    };
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

