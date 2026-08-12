/**
 * BookingService
 * Business-logic layer for bookings.
 *
 * IMPORTANT:
 * - No Express req/res usage.
 * - Services call repositories only.
 * - Throws AppError exceptions.
 * - All state transitions go through BookingStateMachine.
 */

const BookingRepository = require('../repositories/BookingRepository');
const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');
const ReservationRepository = require('../repositories/ReservationRepository');
const InvoiceRepository = require('../repositories/InvoiceRepository');
const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const { buildBookingNumber } = require('./BookingNumberService');
const { validateTransition, isTerminal, canCancel, canConfirm, canSendQuote, canReject, canAssignDriver, canStartPickup, toDeliveryStatus } = require('../utils/BookingStateMachine');

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
   *
   * Canonical booking-number logic:
   *   - booking_number (BTB-YYYY-NNNNN) is DERIVED from the DB primary key
   *     (booking_id) by BookingNumberService — the single canonical
   *     customer/admin-facing identifier. It is deterministic, sequential,
   *     unique, and safe under concurrent creation (no MAX+1 race).
   *   - booking_reference is a legacy alias that mirrors booking_number for
   *     new bookings so existing tracking/email/WhatsApp links stay uniform.
   *
   * @param {Object} input
   * @returns {Promise<{booking_id: number}>}
   */
  async createBooking(input) {
    if (!input || !input.user_id) {
      throw new ValidationError('user_id is required');
    }
    if (!input.vehicle_type_required) {
      throw new ValidationError('vehicle_type_required is required');
    }

const bookingResult = await prisma.$transaction(async (tx) => {
      const booking = await this.bookingRepo.create(input, tx);

      // Derive the canonical booking number from the DB-assigned PK, then
      // persist it atomically inside the SAME transaction. booking_reference
      // mirrors booking_number for new bookings (legacy alias).
      const { buildBookingNumber } = require('./BookingNumberService');
      const canonicalNumber = buildBookingNumber(booking.booking_id, new Date());

      await this.bookingRepo.update(
        booking.booking_id,
        { booking_number: canonicalNumber, booking_reference: canonicalNumber },
        tx
      );

      // Ensure a delivery record always exists so the driver workflow
      // (pickup_started → pickup_completed → in_transit → delivered) can
      // proceed. This was previously duplicated inline in the booking routes;
      // it now lives in the single canonical create path.
      await tx.delivery.create({
        data: {
          booking_id: booking.booking_id,
          current_status: 'booking_confirmed',
          status_description: 'Booking confirmed, waiting for driver assignment',
        },
      });

      await this.timelineRepo.addEvent(
        booking.booking_id,
        'booking_created',
        JSON.stringify({ booking_reference: canonicalNumber, booking_number: canonicalNumber }),
        tx
      );

      return { ...booking, booking_number: canonicalNumber, booking_reference: canonicalNumber };
    });

    return bookingResult;
  }

  /**
   * Update a booking with status transitions.
   * @param {number} bookingId
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async updateBooking(bookingId, input) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!input || typeof input !== 'object') throw new ValidationError('input is required');

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    // Validate status transition if status is being changed
    if (input.status && input.status !== existing.status) {
      validateTransition(existing.status, input.status);

      // Additional business rules
      if (['delivered', 'completed'].includes(input.status) && (input.final_price == null && existing.final_price == null)) {
        throw new ValidationError('final_price is required when delivered/completed');
      }
    }

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
   * Bulk-update the status of multiple bookings inside a single transaction.
   * @param {number[]} bookingIds
   * @param {string} status
   * @returns {Promise<{updated: number}>}
   */
  async bulkUpdateStatus(bookingIds, status) {
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      throw new ValidationError('bookingIds must be a non-empty array');
    }

    const ids = [...new Set(bookingIds.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      throw new ValidationError('bookingIds must be a non-empty array of valid booking ids');
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findMany({
        where: { booking_id: { in: ids } },
        select: { booking_id: true, status: true, quote_status: true },
      });

      if (existing.length !== ids.length) {
        const found = new Set(existing.map((b) => b.booking_id));
        const missing = ids.filter((id) => !found.has(id));
        throw new NotFoundError(`Some bookings were not found: ${missing.join(', ')}`);
      }

      let updated = 0;
      for (const booking of existing) {
        if (booking.status === status) continue;

        // Enterprise rule: bookings can only be confirmed after the customer
        // has accepted the final quote. Admin cannot bypass this.
        if (status === 'confirmed' && booking.quote_status !== 'ACCEPTED') {
          throw new ValidationError(
            `Booking ${booking.booking_id} cannot be confirmed: customer must accept the final quote first (current quote_status: ${booking.quote_status || 'PENDING'})`
          );
        }

        // Validate transition
        validateTransition(booking.status, status);

        const data = { status };
        const now = new Date();

        if (status === 'confirmed') {
          data.confirmed_at = now;
        }

        await tx.booking.update({
          where: { booking_id: booking.booking_id },
          data,
        });

        await this.timelineRepo.addEvent(
          booking.booking_id,
          'booking_status_changed',
          JSON.stringify({ from: booking.status, to: status, bulk: true }),
          tx
        );

        updated += 1;
      }
      return updated;
    });

    return { updated: result };
  }

  /**
   * Manually confirm a booking (offline / phone / WhatsApp).
   *
   * Enterprise rule: A booking can ONLY be confirmed after the customer has
   * accepted the final quote (quote_status === 'ACCEPTED'). Admin cannot
   * bypass customer confirmation.
   *
   * @param {number} bookingId
   * @returns {Promise<{ok: boolean, status: string, quote_status: string, confirmation_source: string}>}
   */
  async confirmBooking(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    if (isTerminal(existing.status)) {
      throw new ValidationError(`Cannot confirm a booking with status: ${existing.status}`);
    }

    // Customer must have accepted the quote first.
    if (existing.quote_status !== 'ACCEPTED') {
      throw new ValidationError(
        `Cannot confirm booking ${bookingId}: customer must accept the final quote first (current quote_status: ${existing.quote_status || 'PENDING'})`
      );
    }

    // Already confirmed.
    if (existing.status === 'confirmed') {
      return { ok: true, status: existing.status, quote_status: 'ACCEPTED', confirmation_source: existing.confirmation_source || 'CUSTOMER' };
    }

    // Quote ACCEPTED but booking still in quote_sent → perform the confirmation
    // transition (idempotent, transactional).
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await this.bookingRepo.update(bookingId, {
        status: 'confirmed',
        confirmed_at: now,
      }, tx);

      await this.timelineRepo.addEvent(
        bookingId,
        'booking_status_changed',
        JSON.stringify({ from: existing.status, to: 'confirmed', source: 'admin_manual' }),
        tx
      );
      return { ok: true };
    });

    return { ok: result.ok, status: 'confirmed', quote_status: 'ACCEPTED', confirmation_source: existing.confirmation_source || 'CUSTOMER' };
  }

  /**
   * Cancel a booking.
   * @param {number} bookingId
   * @returns {Promise<Object>}
   */
  async cancelBooking(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');

    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking not found');

    if (!canCancel(booking.status)) {
      throw new ValidationError('This booking cannot be cancelled');
    }

    return await this.updateBooking(bookingId, { status: 'cancelled' });
  }

  /**
   * Complete a booking.
   * @param {number} bookingId
   * @returns {Promise<Object>}
   */
  async completeBooking(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    const booking = await this.bookingRepo.findById(bookingId);
    if (!booking) throw new NotFoundError('Booking not found');

    if (booking.status === 'cancelled') {
      throw new ValidationError('Cancelled booking cannot be completed');
    }

    if (booking.final_price == null) {
      throw new ValidationError('final_price is required');
    }

    return await this.updateBooking(bookingId, { status: 'completed' });
  }

  /**
   * Admin sends a final quote for a booking.
   * @param {number} bookingId
   * @param {Object} input - { final_price, remarks }
   * @returns {Promise<Object>}
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

    if (isTerminal(existing.status)) {
      throw new ValidationError(`Cannot send a quote for a booking with status: ${existing.status}`);
    }

    if (existing.quote_status === 'ACCEPTED' || existing.quote_status === 'REJECTED') {
      throw new ValidationError(`Quote already ${existing.quote_status.toLowerCase()} for this booking`);
    }

    const sentAt = new Date();
    const patch = {
      final_price: finalPrice,
      quote_status: 'SENT',
      quote_sent_at: sentAt,
      status: 'quote_sent',
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
   * @param {number} bookingId
   * @param {'ACCEPT'|'REJECT'} action
   * @returns {Promise<Object>}
   */
  async respondToQuote(bookingId, action) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      throw new ValidationError("action must be 'ACCEPT' or 'REJECT'");
    }

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    // Idempotency: if already accepted, return current state
    if (action === 'ACCEPT' && existing.quote_status === 'ACCEPTED') {
      return {
        ok: true,
        quote_status: 'ACCEPTED',
        status: existing.status,
        driver_id: existing.driver_id,
        vehicle_id: existing.vehicle_id,
        confirmation_source: existing.confirmation_source || 'CUSTOMER',
      };
    }

    // Idempotency: if already rejected, return current state
    if (action === 'REJECT' && existing.quote_status === 'REJECTED') {
      return {
        ok: true,
        quote_status: 'REJECTED',
        status: existing.status,
      };
    }

    // Normal path: quote must be in SENT state.
    // Edge case: admin assigned driver without sending a quote.
    // In that case, quote_status is PENDING but status is a confirmed state
    // (e.g. driver_assigned) and final_price exists. We allow the customer
    // to accept/reject in this scenario.
    const isEdgeCase =
      existing.quote_status === 'PENDING' &&
      ['driver_assigned', 'confirmed', 'pickup_started', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered', 'completed'].includes(existing.status) &&
      existing.final_price != null;

    if (existing.quote_status !== 'SENT' && !isEdgeCase) {
      throw new ValidationError(
        `Quote is not in SENT state (current: ${existing.quote_status || 'PENDING'})`
      );
    }

    // Quote expiry check (only for normal SENT state)
    if (existing.quote_status === 'SENT' && existing.quote_valid_until && new Date(existing.quote_valid_until) < new Date()) {
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
      return await this.acceptQuote(bookingId, existing, isEdgeCase);
    }

    return await this.rejectQuote(bookingId, existing, isEdgeCase);
  }

  /**
    * Atomically accept a quote and confirm the booking.
    * @private
    */
  async acceptQuote(bookingId, existing, isEdgeCase = false) {
    const finalPrice = existing.final_price != null ? Number(existing.final_price) : 0;

    let reservedDriverId = null;
    let reservedVehicleId = null;

    if (!isEdgeCase) {
      const activeReservation = await this.reservationRepo.getActiveByBooking(bookingId);
      reservedDriverId = activeReservation?.driver_id || null;
      reservedVehicleId = activeReservation?.vehicle_id || null;
    } else {
      // Edge case: no reservation exists because admin assigned driver directly.
      // Use the driver/vehicle already attached to the booking.
      reservedDriverId = existing.driver_id;
      reservedVehicleId = existing.vehicle_id;
    }

    const now = new Date();
    const invoiceNumber = `INV-${existing.booking_reference || bookingId}-${Date.now().toString().slice(-6)}`;

    const result = await prisma.$transaction(async (tx) => {
      // CONCURRENCY PROTECTION: conditional update ensures only one request
      // can transition from SENT/PENDING to ACCEPTED. If another request
      // already accepted, updated.count will be 0.
      const updated = await tx.booking.updateMany({
        where: {
          booking_id: bookingId,
          quote_status: isEdgeCase ? 'PENDING' : 'SENT',
          status: isEdgeCase
            ? { in: ['driver_assigned', 'confirmed', 'pickup_started', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered', 'completed'] }
            : { notIn: ['cancelled', 'completed', 'delivered', 'rejected'] },
        },
        data: {
          quote_status: 'ACCEPTED',
          quote_accepted_at: now,
          status: isEdgeCase ? existing.status : 'confirmed',
          confirmed_at: isEdgeCase ? existing.confirmed_at : now,
          confirmation_source: 'CUSTOMER',
          driver_id: reservedDriverId,
          vehicle_id: reservedVehicleId,
        },
      });

      if (updated.count === 0) {
        // Another request already accepted this quote, or booking is in an
        // invalid state. Re-read to determine the current state.
        const current = await tx.booking.findUnique({ where: { booking_id: bookingId } });
        if (current?.quote_status === 'ACCEPTED') {
          return { alreadyAccepted: true, status: current.status, quote_status: 'ACCEPTED' };
        }
        throw new ValidationError('Quote has already been accepted or is not in a valid state for acceptance.');
      }

      if (!isEdgeCase) {
        await this.reservationRepo.convertAllActive(bookingId, tx);

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
      }

      // Ensure a delivery record exists so the driver workflow can proceed
      // (pickup_started → pickup_completed → in_transit → out_for_delivery
      //  → delivered → completed). If one was created earlier (e.g. legacy
      //  flow), update it with the reserved driver/vehicle.
      const delivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
        select: { delivery_id: true },
      });

      const deliveryData = {
        booking_id: bookingId,
        driver_id: reservedDriverId,
        vehicle_id: reservedVehicleId,
        current_status: 'booking_confirmed',
        status_description: 'Booking confirmed',
      };

      if (delivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: reservedDriverId,
            vehicle_id: reservedVehicleId,
            current_status: 'booking_confirmed',
            status_description: 'Booking confirmed',
          },
        });
      } else {
        await tx.delivery.create({ data: deliveryData });
      }

      await this.invoiceRepo.create({
        booking_id: bookingId,
        invoice_number: invoiceNumber,
        amount: finalPrice,
        status: 'PENDING',
      }, tx);

      await this.timelineRepo.addEvent(
        bookingId,
        'booking_confirmed',
        JSON.stringify({ final_price: finalPrice, confirmed_at: now }),
        tx
      );
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
      await this.timelineRepo.addEvent(
        bookingId,
        'QUOTE_ACCEPTED_BY_CUSTOMER',
        JSON.stringify({ confirmation_source: 'CUSTOMER', confirmed_at: now }),
        tx
      );

      return { invoice_number: invoiceNumber };
    });

    if (result.alreadyAccepted) {
      return {
        ok: true,
        quote_status: 'ACCEPTED',
        status: result.status,
        driver_id: reservedDriverId,
        vehicle_id: reservedVehicleId,
        confirmation_source: 'CUSTOMER',
      };
    }

    return {
      ok: true,
      quote_status: 'ACCEPTED',
      status: isEdgeCase ? existing.status : 'confirmed',
      driver_id: reservedDriverId,
      vehicle_id: reservedVehicleId,
      invoice_number: result.invoice_number,
    };
  }

  /**
    * Reject a quote, release reserved driver/vehicle, and move the booking
    * to the terminal 'rejected' state.
    * @private
    */
  async rejectQuote(bookingId, existing, isEdgeCase = false) {
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // CONCURRENCY PROTECTION: conditional update ensures only one request
      // can transition from SENT/PENDING to REJECTED.
      const updated = await tx.booking.updateMany({
        where: {
          booking_id: bookingId,
          quote_status: isEdgeCase ? 'PENDING' : 'SENT',
        },
        data: {
          quote_status: 'REJECTED',
          quote_rejected_at: now,
          status: isEdgeCase ? existing.status : 'rejected',
        },
      });

      if (updated.count === 0) {
        const current = await tx.booking.findUnique({ where: { booking_id: bookingId } });
        if (current?.quote_status === 'REJECTED') {
          return { alreadyRejected: true, status: current.status, quote_status: 'REJECTED' };
        }
        throw new ValidationError('Quote has already been rejected or is not in a valid state for rejection.');
      }

      await this.reservationRepo.releaseAllActive(bookingId, tx);

      await this.timelineRepo.addEvent(
        bookingId,
        'quote_rejected',
        JSON.stringify({ booking_status: isEdgeCase ? existing.status : 'rejected', rejected_at: now }),
        tx
      );

      return { ok: true };
    });

    if (result.alreadyRejected) {
      return {
        ok: true,
        quote_status: 'REJECTED',
        status: result.status,
      };
    }

    return { ok: true, quote_status: 'REJECTED', status: isEdgeCase ? existing.status : 'rejected' };
  }

  /**
   * Admin sends a quote with reservation of driver + vehicle.
   * @param {number} bookingId
   * @param {Object} input - { final_price, remarks, driver_id, vehicle_id, quote_validity_hours, reserved_by }
   * @returns {Promise<Object>}
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

// Enterprise workflow: a driver is REQUIRED, but a vehicle is OPTIONAL.
    // The booking module automatically uses the driver's CURRENT ACTIVE VEHICLE.
    // Admin selects only the driver — never a vehicle separately.
    const reservedDriverId = input.driver_id ? parseInt(input.driver_id, 10) : null;
    const providedVehicleId = input.vehicle_id ? parseInt(input.vehicle_id, 10) : null;

    if (!reservedDriverId) {
      throw new ValidationError('driver_id is required to send a final quote');
    }

    const existing = await this.bookingRepo.findById(bookingId);
    if (!existing) throw new NotFoundError('Booking not found');

    if (isTerminal(existing.status)) {
      throw new ValidationError(`Cannot send a quote for a booking with status: ${existing.status}`);
    }
    if (existing.quote_status === 'ACCEPTED') {
      throw new ValidationError('Quote already accepted for this booking');
    }
    if (existing.quote_status === 'SENT' && !input.force_resend) {
      throw new ValidationError('A quote is already sent and awaiting customer approval. Use force_resend to send a new one.');
    }

    // Load the driver from the existing Driver record.
    const driver = await prisma.driver.findUnique({
      where: { driver_id: reservedDriverId },
      select: {
        driver_id: true,
        is_available: true,
        vehicle_number: true,
        vehicle_type: true,
      },
    });
    if (!driver) throw new NotFoundError('Reserved driver not found');

    const driverAlreadyAssignedToThisBooking = existing.driver_id === reservedDriverId;

    // If the driver is already assigned to THIS booking, skip the availability
    // and active-booking checks. The assignment was validated earlier; we are
    // only sending a quote, not making a new reservation.
    if (!driverAlreadyAssignedToThisBooking) {
      if (!driver.is_available) {
        throw new ValidationError('Reserved driver is not available');
      }

      // Prevent reserving a driver who is already assigned to another active booking.
      const activeBooking = await prisma.booking.findFirst({
        where: {
          driver_id: reservedDriverId,
          status: { notIn: ['cancelled', 'completed', 'delivered'] },
        },
        select: { booking_id: true },
      });
      if (activeBooking) {
        throw new ValidationError('Driver is already assigned to another active booking');
      }
    }

    // vehicle_id is OPTIONAL. If provided, validate the fleet vehicle path.
    // If missing, auto-resolve the driver's current active vehicle from the
    // Driver record. Validate ONLY that driver.vehicle_number exists.
    // There is ONE validation path — no duplication.
    let reservedVehicleId = providedVehicleId;

    if (providedVehicleId) {
      const vehicle = await prisma.transportVehicle.findUnique({
        where: { vehicle_id: providedVehicleId },
        select: { vehicle_id: true, driver_id: true, is_available: true },
      });
      if (!vehicle) throw new NotFoundError('Reserved vehicle not found');
      if (!vehicle.is_available) {
        throw new ValidationError('Reserved vehicle is not available');
      }
      if (vehicle.driver_id !== reservedDriverId) {
        throw new ValidationError('The selected vehicle does not belong to the selected driver');
      }
      reservedVehicleId = providedVehicleId;
    } else {
      // Auto-resolve from the Driver record.
      // If the driver is already assigned to this booking, trust the
      // existing assignment and skip the vehicle_number check.
      // Otherwise validate that the driver has a registered vehicle.
      if (!driverAlreadyAssignedToThisBooking && !driver.vehicle_number) {
        throw new ValidationError('This driver does not have an active vehicle.');
      }
      // reservedVehicleId stays null — the driver's registered vehicle
      // is not a fleet TransportVehicle record.
    }

    const validityHours = Number(input.quote_validity_hours) || 2;
    const quoteValidUntil = new Date(Date.now() + validityHours * 60 * 60 * 1000);
    const sentAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const patch = {
        final_price: finalPrice,
        quote_status: 'SENT',
        quote_sent_at: new Date(),
        quote_valid_until: quoteValidUntil,
        status: 'quote_sent',
      };
      if (input.remarks != null) patch.quote_remarks = String(input.remarks);

      // Set driver/vehicle snapshots so the admin drawer can display the
      // reserved driver immediately after sending the quote. These are
      // immutable snapshots that persist until the quote is rejected or
      // a new quote is sent with a different driver.
      if (reservedDriverId) {
        patch.driver_id = reservedDriverId;
        patch.driver_name_snapshot = driver.driver_name || `${driver.user?.first_name || ''} ${driver.user?.last_name || ''}`.trim() || null;
        patch.mobile_snapshot = driver.mobile || driver.user?.phone || null;
        patch.truck_number_snapshot = driver.vehicle_number || null;
        patch.partner_name_snapshot = driver.currentPartner?.partner_name || null;
      }
      if (reservedVehicleId) {
        patch.vehicle_id = reservedVehicleId;
      }

      await this.bookingRepo.update(bookingId, patch, tx);

      await this.reservationRepo.releaseAllActive(bookingId, tx);

      await this.reservationRepo.create({
        booking_id: bookingId,
        driver_id: reservedDriverId,
        vehicle_id: reservedVehicleId,
        status: 'ACTIVE',
        expires_at: quoteValidUntil,
        reserved_by: input.reserved_by || null,
      }, tx);

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

      return { quote_valid_until: quoteValidUntil, quote_sent_at: sentAt };
    });

    return {
      ok: true,
      quote_status: 'SENT',
      status: 'quote_sent',
      final_price: finalPrice,
      quote_sent_at: sentAt,
      quote_valid_until: result.quote_valid_until,
      driver_id: reservedDriverId,
      vehicle_id: reservedVehicleId,
    };
  }

  /**
   * Check a booking's quote and auto-expire if past validity.
   * @param {number} bookingId
   * @returns {Promise<{expired: boolean}>}
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
   * @param {string} reference
   * @returns {Promise<Object>}
   */
  async getBookingForTracking(reference) {
    if (!reference) throw new ValidationError('reference is required');

    // Normalize the identifier (trim + uppercase) and look it up by the
    // CANONICAL booking_number (BTB-YYYY-NNNNN) OR the legacy booking_reference
    // alias. This keeps tracking working for both new canonical numbers and
// pre-existing random references (backward compatibility).
    const { normalizeBookingIdentifier } = require('./BookingNumberService');
    const identifier = normalizeBookingIdentifier(reference);

    const found = await this.bookingRepo.findByIdentifier(identifier);
    if (!found) throw new NotFoundError('Booking not found');

    // Re-fetch with full relations for the tracking contract.
    const booking = await prisma.booking.findUnique({
      where: { booking_id: found.booking_id },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        vehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            capacity_kg: true,
            current_status: true,
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

    // NOTE: Auto-expiry is handled by a scheduled job or explicit admin action,
    // NOT in this read-only tracking endpoint. Mutating quote_status here causes
    // the customer tracking page to never show the QuoteCard (BUG 2 / BUG 3).
    const activeReservation = booking.reservations?.[0] || null;

    // ============================================================
    // ENTERPRISE DRIVER INFO GATING
    // ------------------------------------------------------------
    // Driver + vehicle details are ONLY exposed to the customer after
    // the quote has been ACCEPTED (booking confirmed). Before that:
    //   - driver / vehicle / reservation are null (hidden from tracking)
    //   - a `driver_quote` object is returned with the driver name,
    //     phone, vehicle number, vehicle type, final price and remarks
    //     so the QuoteCard can display them for the Accept/Reject step.
    // ============================================================
    const isConfirmed = booking.quote_status === 'ACCEPTED' ||
      ['confirmed', 'pickup_started', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered', 'completed']
        .includes(booking.status);

    const driverInfo = isConfirmed && booking.driver
      ? {
          driver_id: booking.driver.driver_id,
          rating: booking.driver.rating,
          total_deliveries: booking.driver.total_deliveries,
          profile_image: booking.driver.profile_image,
          first_name: booking.driver.user?.first_name || null,
          last_name: booking.driver.user?.last_name || null,
          phone: booking.driver.user?.phone || null,
        }
      : null;

    const snapshotDriverInfo = isConfirmed && booking.driver_name_snapshot
      ? {
          driver_name: booking.driver_name_snapshot,
          phone: booking.mobile_snapshot,
          vehicle_number: booking.truck_number_snapshot,
          vehicle_type: null,
          owner_name: booking.partner_name_snapshot,
        }
      : null;

    // Quote preview info — shown to the customer while awaiting approval.
    // Contains driver name, phone, vehicle number/type, price and remarks
    // so the customer can make an informed Accept/Reject decision.
    // Vehicle info falls back to the driver's registered vehicle when the
    // reservation's vehicle record is null (driver's own vehicle, not fleet).
    const driverQuoteInfo = activeReservation
      ? {
          driver_name: activeReservation.driver?.driver_name || null,
          driver_phone: activeReservation.driver?.mobile || null,
          driver_rating: activeReservation.driver?.rating || null,
          vehicle_number: activeReservation.vehicle?.vehicle_number || activeReservation.driver?.vehicle_number || null,
          vehicle_name: activeReservation.vehicle?.vehicle_name || null,
          vehicle_type: activeReservation.vehicle?.vehicle_type || activeReservation.driver?.vehicle_type || null,
          final_price: booking.final_price != null ? Number(booking.final_price) : null,
          remarks: booking.quote_remarks || null,
          quote_valid_until: booking.quote_valid_until || null,
        }
      : null;

// ============================================================
    // TRACKING DATA CONTRACT
    // ------------------------------------------------------------
    // The tracking components (BookingHeader, BookingDetails, StatusCard,
    // QuoteCard, ActivityFeed, ProgressTimeline, DriverVehicleCard) read a
    // specific set of fields. Every field they reference MUST be returned
    // here so the tracking page never white-screens due to a missing key.
    // ============================================================
    return {
      booking_id: booking.booking_id,
      booking_reference: booking.booking_reference,
      booking_number: booking.booking_number || null,
      user_id: booking.user_id,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      customer_first_name: booking.user?.first_name || null,
      customer_last_name: booking.user?.last_name || null,
      customer_phone: booking.user?.phone || null,
      pickup_location: booking.pickup_location,
      pickup_address: booking.pickup_address || null,
      pickup_city: booking.pickup_city,
      pickup_state: booking.pickup_state || null,
      pickup_pincode: booking.pickup_pincode || null,
      drop_location: booking.drop_location,
      drop_address: booking.drop_address || null,
      drop_city: booking.drop_city,
      drop_state: booking.drop_state || null,
      drop_pincode: booking.drop_pincode || null,
      goods_description: booking.goods_description,
      goods_type: booking.goods_type || null,
      goods_weight_kg: booking.goods_weight_kg != null ? Number(booking.goods_weight_kg) : null,
      goods_volume: booking.goods_volume != null ? Number(booking.goods_volume) : null,
      number_of_items: booking.number_of_items != null ? Number(booking.number_of_items) : null,
      fragile: booking.fragile == null ? false : Boolean(booking.fragile),
      vehicle_type_required: booking.vehicle_type_required || null,
      estimated_distance_km: booking.estimated_distance_km != null ? Number(booking.estimated_distance_km) : null,
      status: booking.status,
      estimated_price: booking.estimated_price,
      final_price: booking.final_price,
      quote_status: booking.quote_status,
      confirmation_source: booking.confirmation_source || null,
      quote_remarks: booking.quote_remarks,
      quote_message: booking.quote_remarks,
      sent_quote_at: booking.quote_sent_at,
      quote_sent_at: booking.quote_sent_at,
      quote_accepted_at: booking.quote_accepted_at,
      quote_rejected_at: booking.quote_rejected_at,
      quote_valid_until: booking.quote_valid_until,
      pickup_date: booking.pickup_date,
      pickup_time: booking.pickup_time,
      driver_id: isConfirmed ? booking.driver_id : null,
      vehicle_id: isConfirmed ? (booking.vehicle?.vehicle_id ?? null) : null,
      vehicle_number: isConfirmed ? ((booking.vehicle?.vehicle_number ?? booking.truck_number_snapshot) || null) : null,
      vehicle_name: isConfirmed ? (booking.vehicle?.vehicle_name ?? null) : null,
      vehicle_type: isConfirmed ? (booking.vehicle?.vehicle_type ?? null) : null,
      current_status: booking.delivery?.current_status || null,
      status_description: booking.delivery?.status_description || null,
      estimated_pickup_time: booking.delivery?.estimated_pickup_time || null,
      estimated_delivery_time: booking.delivery?.estimated_delivery_time || null,
      driver: driverInfo,
      snapshot_driver: snapshotDriverInfo,
      driver_quote: driverQuoteInfo,
      bookingEvents: booking.bookingEvents || [],
      reservation: isConfirmed && activeReservation
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
   * @returns {Promise<Object[]>}
   */
  async searchBookings(filters) {
    return await this.bookingRepo.search(filters);
  }

  /**
   * Get a booking by its CANONICAL booking_number OR legacy booking_reference
   * alias, with full relations, flattened for the admin read-only detail page.
   *
   * @param {string} identifier - canonical booking_number (BTB-YYYY-NNNNN) or legacy reference
   * @returns {Promise<Object>} flattened booking
   */
  async getBookingByIdentifier(identifier) {
    if (!identifier || typeof identifier !== 'string') {
      throw new ValidationError('booking identifier is required');
    }
    const booking = await this.bookingRepo.findByIdentifier(identifier);
    if (!booking) throw new NotFoundError('Booking not found');
    return require('../utils/BookingMapper').flattenBooking(booking);
  }
}

module.exports = BookingService;
