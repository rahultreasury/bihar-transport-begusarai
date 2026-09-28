/**
 * EnquiryService
 * ---------------------------------------------------------------------------
 * Business-logic layer for the pre-booking enquiry module.
 *
 * RESPONSIBILITIES
 *   • create an enquiry from the booking form (NO login wall)
 *   • keep the enquiry number, status machine, price status and audit events in
 *     lockstep inside Prisma transactions
 *   • validate + apply admin assignment, quotation and cancellation
 *   • accept / reject / cancel from the customer side, SERVER- AUTHORITATIVELY
 *   • hand the accepted enquiry to the EXISTING BookingService, which owns the
 *     Booking → Trip → financial pipeline
 *
 * BOUNDARIES
 *   • No Express req/res in this file.
 *   • No client-supplied status, price or id is ever trusted: the persisted row
 *     is re-read, transitions go through EnquiryStateMachine, and ids are
 *     re-validated by EnquiryAssignmentService.
 *   • The driver mobile never leaves the admin boundary (see dtos/EnquiryDTO.js).
 *
 * WHY THERE IS NO SECOND BOOKING SYSTEM HERE
 * On acceptance we call the existing BookingService.createBooking(). The Booking
 * row it produces is the canonical operational record; the enquiry keeps the
 * request/quote/acceptance history and points at it via booking_id. Nothing
 * here re-implements pricing, commission, settlement or trip execution.
 */

const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const {
  AppError, ValidationError, NotFoundError, ForbiddenError, ConflictError,
} = require('../utils/AppError');
const { logger } = require('../utils/logger');
const { buildEnquiryNumber } = require('./EnquiryNumberService');
const { issueEnquiryAccessToken, verifyEnquiryAccessToken } = require('../utils/EnquiryAccessToken');
const {
  assertTransition, canTransition, canCancel, isTerminal, isCustomerCommitted, shortestPath,
  isQuoteVisibleToCustomer, hasRequiredAssignment,
} = require('../utils/EnquiryStateMachine');
const eventService = require('./EnquiryEventService');
const assignmentService = require('./EnquiryAssignmentService');
const realtime = require('../realtime/enquiryRealtime');
const { adminRelationSelect, customerRelationSelect } = require('../dtos/EnquiryDTO');

const BookingService = require('./BookingService');

/** Guards against a pathological quote that would let an admin "sell" a ₹1 trip. */
const MIN_QUOTE_AMOUNT = 1;
const MAX_QUOTE_AMOUNT = 10_000_000; // ₹1 crore — a realistic upper bound for a road trip

/** Admin roles permitted to act on enquiries. */
const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];

/** Normalise an Indian mobile to 10 digits, or return null. */
function normalizeMobile(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** Parse a finite number from untrusted input, or return null. */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Trim a string, returning null for empty/whitespace-only values. */
function clean(value, maxLength = 500) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

/**
 * Format a date as a "YYYY-MM-DD" string in LOCAL time.
 *
 * The existing Booking.pickup_date column is a String, not a DateTime, so an
 * accepted enquiry has to be converted on its way into the Booking row.
 * Local (not UTC) formatting is deliberate: `toISOString()` on a date stored as
 * local midnight shifts back a day in IST, which would move every booking a
 * customer makes to the previous day.
 *
 * @param {Date|string} value
 * @returns {string|null}
 */
function formatISODate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Coerce a pickup date into a Date pinned to UTC MIDNIGHT.
 *
 * WHY UTC MIDNIGHT, NOT LOCAL MIDNIGHT
 * The column is `TIMESTAMP(3)` (no time zone), and Prisma writes a JS Date by
 * taking its UTC components. If "2026-10-02" were parsed as local midnight it
 * would be 2026-10-02T00:00+05:30 = 2026-10-01T18:30Z, so the stored row would
 * read `2026-10-01 18:30:00` — a calendar date that disagrees with the date the
 * customer actually chose, and one that shifts again for any server code
 * formatting in UTC.
 *
 * Pinning to UTC midnight makes the stored value the literal calendar date
 * (`2026-10-02 00:00:00`). It then renders correctly whether the consumer
 * formats in UTC or in any local zone east of UTC — which is the only way this
 * column is safe to read.
 *
 * @param {string|Date} value
 * @returns {Date|null}
 */
function parsePickupDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Re-pin an existing Date to the UTC midnight of its own UTC calendar day
    // so a round trip never drifts.
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0)
    );
  }

  const str = String(value).trim();

  // Explicit ISO calendar date — the format the booking form submits.
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0));
    return Number.isNaN(utc.getTime()) ? null : utc;
  }

  // A full ISO timestamp ("2026-10-02T10:00:00Z") — take its UTC calendar day.
  const isoTsMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoTsMatch) {
    const [, y, m, d] = isoTsMatch;
    const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0));
    return Number.isNaN(utc.getTime()) ? null : utc;
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0, 0)
  );
}

/** Coerce a time-of-day into a canonical "HH:MM" / "HH:MM:SS" string. */
function normalizePickupTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();

  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2];
  const second = match[3] || '00';
  const meridiem = match[4] ? match[4].toLowerCase() : null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (hour > 23 || Number(minute) > 59) return null;

  return `${String(hour).padStart(2, '0')}:${minute}:${second}`;
}

class EnquiryService {
  /**
   * @param {Object=} deps
   * @param {import('@prisma/client').PrismaClient=} deps.prisma
   * @param {BookingService=} deps.bookingService
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || prisma;
    this.bookingService = deps.bookingService || new BookingService();
    this.events = deps.events || eventService;
    this.assignments = deps.assignments || assignmentService;
    this.realtime = deps.realtime || realtime;
  }

  // =========================================================================
  // CREATE
  // =========================================================================

  /**
   * Create an enquiry from the booking form.
   *
   * Works with or without a logged-in customer. `ctx.user` (from `protect`) is
   * attached as customer_id when present; otherwise the enquiry is created as a
   * guest and a scoped access token is minted so the customer lands straight on
   * the confirmation page — no login redirect, no lost form data.
   *
   * @param {Object} input - validated request body
   * @param {{user?:object, sessionKey?:string}} [ctx]
   * @returns {Promise<{enquiry:object, accessToken:object|null}>}
   */
  async createEnquiry(input, ctx = {}) {
    // ── Validate the fields that make an enquiry meaningful ──────────────
    //
    // A request is only meaningful once we know WHERE it goes, WHEN, in WHAT,
    // and WHO to call. The load description (material) is deliberately NOT in
    // that list: customers regularly book a vehicle before they know what is
    // going in it, and the transport team captures it on the call. It is stored
    // as NULL when unanswered — never as a placeholder string.
    const pickupLocation = clean(input.pickup_location || input.pickup, 200);
    const dropLocation = clean(input.drop_location || input.drop, 200);
    const material = clean(input.material || input.goods_description, 200);
    const customerName = clean(input.customer_name || input.customerName, 120);
    const customerMobile = normalizeMobile(
      input.customer_mobile || input.customerMobile || input.mobile
    );

    const errors = [];
    if (!pickupLocation) errors.push({ field: 'pickup_location', message: 'Pickup location is required' });
    if (!dropLocation) errors.push({ field: 'drop_location', message: 'Drop location is required' });
    if (!customerName) errors.push({ field: 'customer_name', message: 'Customer name is required' });
    if (!customerMobile) {
      errors.push({ field: 'customer_mobile', message: 'A valid 10-digit Indian mobile number is required' });
    }

    const pickupDate = parsePickupDate(input.pickup_date);
    if (!pickupDate) {
      errors.push({ field: 'pickup_date', message: 'A valid pickup date is required' });
    }

    const pickupTime = normalizePickupTime(input.pickup_time);
    if (!pickupTime) {
      errors.push({ field: 'pickup_time', message: 'A valid pickup time is required' });
    }

    const requestedVehicleName = clean(
      input.requested_vehicle_name || input.requested_vehicle || input.vehicle,
      120
    );
    if (!requestedVehicleName) {
      errors.push({ field: 'requested_vehicle_name', message: 'Please select a vehicle' });
    }

    if (errors.length) {
      throw new ValidationError({ message: 'Enquiry validation failed', details: errors });
    }

    // A pickup date in the past is always a customer typo, never a real request.
    // Compared in the SAME UTC frame as parsePickupDate, so "today" is never
    // judged against a shifted boundary.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (pickupDate.getTime() < todayStart.getTime()) {
      throw new ValidationError({
        message: 'Pickup date cannot be in the past',
        details: [{ field: 'pickup_date', message: 'Pickup date cannot be in the past' }],
      });
    }

    const weight = toFiniteNumber(input.weight);
    if (weight !== null && weight < 0) {
      throw new ValidationError({
        message: 'Weight cannot be negative',
        details: [{ field: 'weight', message: 'Weight cannot be negative' }],
      });
    }
    const quantity = toFiniteNumber(input.quantity);
    if (quantity !== null && quantity < 0) {
      throw new ValidationError({
        message: 'Quantity cannot be negative',
        details: [{ field: 'quantity', message: 'Quantity cannot be negative' }],
      });
    }

    // ── Identity ─────────────────────────────────────────────────────────
    let customerId = null;
    if (ctx.user && ctx.user.user_id && !ADMIN_ROLES.includes(ctx.user.role)) {
      const user = await this.prisma.user.findUnique({
        where: { user_id: ctx.user.user_id },
        select: { user_id: true, is_active: true },
      });
      if (user && user.is_active !== false) customerId = user.user_id;
    }

    // A logged-in customer's own name/number wins over anything posted.
    let finalName = customerName;
    let finalMobile = customerMobile;
    let finalEmail = clean(input.customer_email || input.email, 160);
    if (customerId) {
      const user = await this.prisma.user.findUnique({
        where: { user_id: customerId },
        select: { first_name: true, last_name: true, phone: true, email: true },
      });
      if (user) {
        finalName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || finalName;
        finalMobile = normalizeMobile(user.phone) || finalMobile;
        finalEmail = user.email || finalEmail;
      }
    }

    // ── Requested vehicle reference (optional FK) ────────────────────────
    let requestedVehicleId = toFiniteNumber(input.requested_vehicle_id);
    if (requestedVehicleId) {
      const vehicle = await this.prisma.transportVehicle.findUnique({
        where: { vehicle_id: requestedVehicleId },
        select: { vehicle_id: true, vehicle_name: true, vehicle_type: true },
      });
      // Never trust a posted id: if it does not resolve, store NULL and keep
      // the human-readable name the customer actually chose.
      requestedVehicleId = vehicle ? vehicle.vehicle_id : null;
      if (vehicle) {
        requestedVehicleName = vehicle.vehicle_name || vehicle.vehicle_type || requestedVehicleName;
      }
    }

    const estimatedMin = toFiniteNumber(input.estimated_price_min ?? input.estimated_price);
    const estimatedMax = toFiniteNumber(input.estimated_price_max);

    // ── Persist ──────────────────────────────────────────────────────────
    // The enquiry_number is derived from the DB-assigned primary key and written
    // inside the SAME transaction, exactly like BookingNumberService does.
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiry.create({
        data: {
          // Placeholder first; replaced with the canonical value below once the
          // sequence has handed us an id. The unique index is the guarantee.
          enquiry_number: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          customer_id: customerId,
          customer_name: finalName,
          customer_mobile: finalMobile,
          customer_email: finalEmail,
          session_key: clean(ctx.sessionKey, 120),

          pickup_location: pickupLocation,
          pickup_address: clean(input.pickup_address, 400),
          pickup_latitude: toFiniteNumber(input.pickup_latitude),
          pickup_longitude: toFiniteNumber(input.pickup_longitude),
          drop_location: dropLocation,
          drop_address: clean(input.drop_address, 400),
          drop_latitude: toFiniteNumber(input.drop_latitude),
          drop_longitude: toFiniteNumber(input.drop_longitude),
          distance_km: toFiniteNumber(input.distance_km),

          requested_vehicle_id: requestedVehicleId,
          requested_vehicle_name: requestedVehicleName,

          material,
          quantity,
          quantity_unit: clean(input.quantity_unit, 40),
          weight,
          weight_unit: clean(input.weight_unit, 40),
          goods_category: clean(input.goods_category, 80),
          fragile: input.fragile === true || input.fragile === 'true',
          special_instructions: clean(input.special_instructions, 1000),

          pickup_date: pickupDate,
          pickup_time: pickupTime,

          estimated_price_min: estimatedMin,
          estimated_price_max: estimatedMax,
          price_status: estimatedMin !== null || estimatedMax !== null ? 'ESTIMATED' : 'NOT_QUOTED',
        },
      });

      const enquiryNumber = buildEnquiryNumber(row.enquiry_id, row.created_at);
      const finalRow = await tx.enquiry.update({
        where: { enquiry_id: row.enquiry_id },
        data: { enquiry_number: enquiryNumber },
      });

      await this.events.addEvent(
        {
          enquiryId: finalRow.enquiry_id,
          eventType: 'ENQUIRY_CREATED',
          actorType: customerId ? 'CUSTOMER' : 'CUSTOMER',
          actorId: customerId,
          actorName: finalName,
          message: 'Request received',
          metadata: {
            pickup: pickupLocation,
            drop: dropLocation,
            vehicle: requestedVehicleName,
            source: customerId ? 'logged_in' : 'guest',
          },
        },
        tx
      );

      return finalRow;
    });

    // Mint the guest access token AFTER commit, so a token is never handed out
    // for an enquiry that failed to save.
    let accessToken = null;
    if (!customerId) {
      try {
        accessToken = issueEnquiryAccessToken({
          enquiryId: created.enquiry_id,
          enquiryNumber: created.enquiry_number,
        });
      } catch (err) {
        // A missing JWT_SECRET must not lose a saved enquiry: log loudly, and
        // the customer can still track with an OTP later.
        logger.error({ err: err.message }, 'enquiry.access_token_issue_failed');
      }
    }

    logger.info(
      { enquiryId: created.enquiry_id, enquiryNumber: created.enquiry_number, customerId },
      'enquiry.created'
    );

    // Admin room gets it immediately so the enquiries table is live.
    this.realtime.emitEnquiryToAdmins(created.enquiry_id, 'enquiry:created');

    return { enquiry: created, accessToken };
  }

  // =========================================================================
  // READ + ACCESS CONTROL
  // =========================================================================

  /**
   * Load one enquiry with the customer-safe relation select.
   * @param {number} enquiryId
   * @returns {Promise<object>}
   */
  async loadForCustomer(enquiryId) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      include: customerRelationSelect,
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });
    return enquiry;
  }

  /**
   * Load one enquiry with the full admin relation select.
   * @param {number} enquiryId
   * @returns {Promise<object>}
   */
  async loadForAdmin(enquiryId) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      include: adminRelationSelect,
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });
    return enquiry;
  }

  /**
   * Resolve an enquiry by its canonical number (used by the confirmation page,
   * which is addressed as /booking/enquiry/:enquiryNumber).
   * @param {string} enquiryNumber
   * @returns {Promise<object>}
   */
  async loadByNumber(enquiryNumber) {
    const number = String(enquiryNumber || '').trim().toUpperCase();
    if (!number) throw new ValidationError({ message: 'Enquiry number is required' });

    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_number: number },
      include: customerRelationSelect,
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });
    return enquiry;
  }

  /**
   * Authorise a CUSTOMER request for one enquiry.
   *
   * Three accepted proofs of ownership, in priority order:
   *   1. A logged-in user whose user_id owns the enquiry.
   *   2. A signed enquiry-access token scoped to exactly this enquiry.
   *   3. Nothing → 401/403.
   *
   * The mobile number is deliberately NOT an accepted proof. A guessable
   * 10-digit number is not a credential, and accepting it would let anyone read
   * (or accept a quote on) someone else's transport request.
   *
   * @param {object} enquiry
   * @param {{user?:object, enquiryToken?:string}} ctx
   * @returns {{isOwner:boolean, via:'user'|'guest_token'}}
   * @throws {UnauthorizedError|ForbiddenError}
   */
  assertCustomerAccess(enquiry, ctx = {}) {
    if (ctx.user && ctx.user.user_id && enquiry.customer_id === ctx.user.user_id) {
      return { isOwner: true, via: 'user' };
    }

    const token = ctx.enquiryToken;
    if (token) {
      const result = verifyEnquiryAccessToken(token);
      if (result.valid && Number(result.payload.enquiryId) === Number(enquiry.enquiry_id)) {
        return { isOwner: true, via: 'guest_token' };
      }
    }

    if (!ctx.user && !token) {
      throw new AppError({
        message: 'Please verify your mobile number to view this enquiry',
        errorCode: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    throw new ForbiddenError({ message: 'You do not have access to this enquiry' });
  }

  // =========================================================================
  // ADMIN — ASSIGNMENT
  // =========================================================================

  /**
   * Assign vehicle / driver / partner / transport owner to an enquiry.
   *
   * All eight assignment rules run inside the transaction. Any partial value
   * already on the enquiry is carried forward and re-validated, so assigning a
   * driver without a vehicle still gets the coherence + capacity checks.
   *
   * @param {number} enquiryId
   * @param {{vehicle_id?:number, driver_id?:number, partner_id?:number, owner_id?:number, note?:string}} input
   * @param {{adminId:number, adminName:string}} admin
   * @param {{isReassignment?:boolean}} [opts]
   * @returns {Promise<object>} the updated enquiry
   */
  async adminAssign(enquiryId, input, admin, opts = {}) {
    const enquiry = await this.loadForAdmin(enquiryId);
    if (isTerminal(enquiry.status)) {
      throw new ConflictError({
        message: `Cannot assign resources to an enquiry that is ${enquiry.status.toLowerCase()}`,
      });
    }

    const vehicleId = toFiniteNumber(input.vehicle_id) ?? enquiry.assigned_vehicle_id;
    const driverId = toFiniteNumber(input.driver_id) ?? enquiry.assigned_driver_id;
    const partnerId = toFiniteNumber(input.partner_id) ?? enquiry.assigned_partner_id;
    const ownerId = toFiniteNumber(input.owner_id) ?? enquiry.assigned_owner_id;

    const hasAnyChange =
      toFiniteNumber(input.vehicle_id) !== null ||
      toFiniteNumber(input.driver_id) !== null ||
      toFiniteNumber(input.partner_id) !== null ||
      toFiniteNumber(input.owner_id) !== null;

    if (!hasAnyChange) {
      throw new ValidationError({
        message: 'Provide at least one of vehicle_id, driver_id, partner_id or owner_id',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read inside the transaction so a concurrent assignment cannot make
      // our validation stale.
      const fresh = await tx.enquiry.findUnique({
        where: { enquiry_id: enquiry.enquiry_id },
      });

      const validated = await this.assignments.validateAssignment(
        {
          enquiry: fresh,
          vehicleId,
          driverId,
          partnerId,
          ownerId,
          isReassignment: Boolean(opts.isReassignment),
        },
        tx
      );

      const vehicle = validated.vehicle;
      const driver = validated.driver;
      const partner = validated.partner;
      const owner = validated.owner;

      const data = {
        // Immutable customer-facing snapshots.
        assigned_vehicle_number: vehicle ? vehicle.vehicle_number : fresh.assigned_vehicle_number,
        assigned_vehicle_type: vehicle
          ? (vehicle.vehicle_name || vehicle.vehicle_type)
          : fresh.assigned_vehicle_type,
        assigned_driver_name: driver ? driver.driver_name : fresh.assigned_driver_name,
        vehicle_assigned_at: vehicle ? new Date() : fresh.vehicle_assigned_at,
        driver_assigned_at: driver ? new Date() : fresh.driver_assigned_at,
      };

      if (vehicle) data.assigned_vehicle_id = vehicle.vehicle_id;
      if (driver) data.assigned_driver_id = driver.driver_id;
      if (partner) data.assigned_partner_id = partner.partner_id;
      if (owner) data.assigned_owner_id = owner.owner_id;

      // If a vehicle was selected and it belongs to an owner, adopt that owner
      // automatically so the financial system routes payouts correctly.
      if (vehicle && vehicle.owner_id && !ownerId) {
        data.assigned_owner_id = vehicle.owner_id;
      }

      // ── Status advance ────────────────────────────────────────────────
      const nextStatus = this._nextStatusAfterAssignment(fresh.status, Boolean(vehicle), Boolean(driver));
      if (nextStatus && nextStatus !== fresh.status) {
        assertTransition(fresh.status, nextStatus);
        data.status = nextStatus;
      }

      const updated = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data,
      });

      // ── Audit ─────────────────────────────────────────────────────────
      if (vehicle && vehicle.vehicle_id !== fresh.assigned_vehicle_id) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: opts.isReassignment ? 'REASSIGNED' : 'VEHICLE_ASSIGNED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: opts.isReassignment
              ? `Vehicle changed to ${vehicle.vehicle_number} (${vehicle.vehicle_name || vehicle.vehicle_type})`
              : `${vehicle.vehicle_name || vehicle.vehicle_type} (${vehicle.vehicle_number}) assigned`,
            metadata: { vehicle_id: vehicle.vehicle_id, vehicle_number: vehicle.vehicle_number, vehicle_type: vehicle.vehicle_type },
          },
          tx
        );
      }

      if (driver && driver.driver_id !== fresh.assigned_driver_id) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: opts.isReassignment ? 'REASSIGNED' : 'DRIVER_ASSIGNED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            // PRIVACY: the driver's name is shown; their mobile number is not
            // part of the metadata and must never be added to it.
            message: opts.isReassignment
              ? `Driver changed to ${driver.driver_name}`
              : `Driver ${driver.driver_name} assigned`,
            metadata: { driver_id: driver.driver_id, driver_name: driver.driver_name },
          },
          tx
        );
      }

      if (partner && partner.partner_id !== fresh.assigned_partner_id) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'PARTNER_ASSIGNED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: `Transport partner ${partner.partner_name} assigned`,
            metadata: { partner_id: partner.partner_id, partner_name: partner.partner_name },
          },
          tx
        );
      }

      if (nextStatus && nextStatus !== fresh.status) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'STATUS_CHANGED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: `Status updated to ${nextStatus.replace(/_/g, ' ').toLowerCase()}`,
            metadata: { from: fresh.status, to: nextStatus },
          },
          tx
        );
      }

      if (input.note) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'NOTE_ADDED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: String(input.note).slice(0, 500),
            customerVisible: false,
          },
          tx
        );
      }

      return updated;
    });

    await this._broadcastAfterChange(result.enquiry_id, 'vehicle:assigned', {
      vehicle_assigned: Boolean(result.assigned_vehicle_id),
      driver_assigned: Boolean(result.assigned_driver_id),
    });

    return result;
  }

  /**
   * Decide the status an assignment should move the enquiry to.
   *
   * A driver without a vehicle is not yet dispatchable, so that combination
   * falls back to ASSIGNMENT_PENDING rather than claiming progress.
   *
   * @private
   * @param {string} currentStatus
   * @param {boolean} hasVehicle
   * @param {boolean} hasDriver
   * @returns {string|null} the next status, or null to leave status unchanged
   */
  _nextStatusAfterAssignment(currentStatus, hasVehicle, hasDriver) {
    if (hasDriver && !hasVehicle) {
      return canTransition(currentStatus, 'ASSIGNMENT_PENDING') ? 'ASSIGNMENT_PENDING' : null;
    }
    if (hasVehicle && hasDriver) {
      return canTransition(currentStatus, 'DRIVER_ASSIGNED') ? 'DRIVER_ASSIGNED' : null;
    }
    if (hasVehicle && !hasDriver) {
      return canTransition(currentStatus, 'VEHICLE_ASSIGNED') ? 'VEHICLE_ASSIGNED' : null;
    }
    return null;
  }

  // =========================================================================
  // ADMIN — QUOTATION
  // =========================================================================

  /**
   * Save (or update) the admin's final quote WITHOUT notifying the customer.
   *
   * @param {number} enquiryId
   * @param {{final_price:number, remarks?:string}} input
   * @param {{adminId:number, adminName:string}} admin
   * @returns {Promise<object>}
   */
  async adminSetQuote(enquiryId, input, admin) {
    const price = toFiniteNumber(input.final_price);
    if (price === null) {
      throw new ValidationError({ message: 'final_price is required' });
    }
    if (price < MIN_QUOTE_AMOUNT) {
      throw new ValidationError({
        message: `Final quote must be at least ₹${MIN_QUOTE_AMOUNT}`,
      });
    }
    if (price > MAX_QUOTE_AMOUNT) {
      throw new ValidationError({
        message: 'Final quote exceeds the maximum allowed amount',
      });
    }

    const enquiry = await this.loadForAdmin(enquiryId);
    if (isTerminal(enquiry.status)) {
      throw new ConflictError({
        message: `Cannot quote an enquiry that is ${enquiry.status.toLowerCase()}`,
      });
    }
    // Once the customer has accepted, the agreed price is the contract.
    if (isCustomerCommitted(enquiry.status) && enquiry.status !== 'CUSTOMER_ACCEPTED') {
      throw new ConflictError({
        message: 'This enquiry is already confirmed; the quoted price is locked',
      });
    }

    const isUpdate = enquiry.final_quoted_price !== null;

    // ── QUOTE PREPARED ──────────────────────────────────────────────────
    // A valid price is only half the condition. The quote is "prepared" — and
    // therefore publishable — only once a vehicle AND a driver are committed,
    // because a price for a load with no truck is not a quotation the company
    // can honour. Until both exist the price is stored as a draft exactly as
    // before, and the admin UI keeps offering "Send Quote" only when the
    // transition is genuinely available.
    const assignmentComplete = hasRequiredAssignment(enquiry);
    const canPrepare = assignmentComplete && canTransition(enquiry.status, 'QUOTE_READY');
    const nextStatus = canPrepare && enquiry.status !== 'QUOTE_READY' ? 'QUOTE_READY' : null;

    if (nextStatus) assertTransition(enquiry.status, nextStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          final_quoted_price: price,
          quote_remarks: clean(input.remarks, 1000),
          price_status: 'QUOTED',
          // QUOTE_READY is the existing "quote prepared" state. Setting it here
          // is what makes the Send Quote action available — the admin UI keys
          // that button off this status, so without this write the admin could
          // save a price and still have no way to publish it.
          ...(nextStatus ? { status: nextStatus } : {}),
          // quoted_at / quoted_by record the LAST admin edit; the moment the
          // quote is SENT to the customer is recorded separately by sendQuote().
        },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: isUpdate ? 'QUOTE_UPDATED' : 'QUOTE_CREATED',
          actorType: 'ADMIN',
          actorId: admin.adminId,
          actorName: admin.adminName,
          message: isUpdate
            ? `Quotation updated to ₹${Math.round(price).toLocaleString('en-IN')}`
            : `Quotation prepared: ₹${Math.round(price).toLocaleString('en-IN')}`,
          metadata: {
            final_quoted_price: price,
            previous: isUpdate ? enquiry.final_quoted_price : null,
          },
          // A draft quotation is internal: the customer must not see a price
          // that has not been deliberately sent to them.
          customerVisible: false,
        },
        tx
      );

      if (nextStatus) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'STATUS_CHANGED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: 'Final quote prepared and ready to send',
            metadata: { from: enquiry.status, to: nextStatus },
          },
          tx
        );
      }

      return row;
    });

    // Admins only — the customer is not told about an unsent quote.
    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'quote:created');

    return updated;
  }

  /**
   * Send the saved quotation to the customer.
   *
   * This is the moment the customer learns the final price, so it flips the
   * enquiry to AWAITING_CUSTOMER_ACCEPTANCE and stamps quoted_at/quoted_by.
   *
   * GUARDS, in order: a price exists, a vehicle AND a driver are committed, the
   * quote has not already been published, and the enquiry is not closed.
   *
   * IDEMPOTENT: a duplicate request (double-click, retry, two admins racing)
   * resolves to `{ enquiry, alreadySent: true }` rather than an error or a
   * second QUOTE_SENT event. The status move itself is claimed with a
   * conditional updateMany so concurrent sends cannot both win.
   *
   * @param {number} enquiryId
   * @param {{adminId:number, adminName:string}} admin
   * @returns {Promise<{enquiry:object, alreadySent:boolean}>}
   */
  async adminSendQuote(enquiryId, admin) {
    const enquiry = await this.loadForAdmin(enquiryId);

    // 1. A price must exist.
    if (enquiry.final_quoted_price === null) {
      throw new ValidationError({
        message: 'Save a final quote before sending it to the customer',
      });
    }

    // 2. A vehicle and a driver must be committed — the company cannot honour
    //    a price for a load that has no truck assigned to it.
    if (!hasRequiredAssignment(enquiry)) {
      const missing = [];
      if (!enquiry.assigned_vehicle_id) missing.push('a vehicle');
      if (!enquiry.assigned_driver_id) missing.push('a driver');
      throw new ValidationError({
        message: `Assign ${missing.join(' and ')} before sending this quote to the customer`,
      });
    }

    // 3. Duplicate-safe. A double-clicked button, a retried request, or two admins
    //    racing each other must never produce a second "sent" event or an error
    //    the operator has to dismiss — the quote is already published, so return
    //    the current state and tell the caller it was already sent.
    if (enquiry.status === 'AWAITING_CUSTOMER_ACCEPTANCE') {
      return { enquiry, alreadySent: true };
    }

    if (isTerminal(enquiry.status) || isCustomerCommitted(enquiry.status)) {
      throw new ConflictError({
        message: `Cannot send a quote for an enquiry that is ${enquiry.status.toLowerCase()}`,
      });
    }

    // An admin can send a quote from any pre-quote stage (they may have
    // assigned both resources in one action and never touched the intermediate
    // states). Resolve the legal path rather than forcing the row through each
    // step by hand — QUOTE_READY is still recorded, because a final price
    // genuinely exists at that point.
    const path = shortestPath(enquiry.status, 'AWAITING_CUSTOMER_ACCEPTANCE');
    if (!path || path.length === 0) {
      throw new ConflictError({
        message: `Cannot move a ${enquiry.status} enquiry to awaiting customer acceptance`,
      });
    }

    // CLAIM the move first, conditionally on the status we just read. If two
    // admins click Send at the same instant, exactly one updateMany matches; the
    // loser re-reads, sees AWAITING_CUSTOMER_ACCEPTANCE, and returns the
    // already-sent result instead of publishing a second time.
    const claimed = await this.prisma.enquiry.updateMany({
      where: { enquiry_id: enquiry.enquiry_id, status: enquiry.status },
      data: { status: 'AWAITING_CUSTOMER_ACCEPTANCE' },
    });

    if (claimed.count === 0) {
      const current = await this.loadForAdmin(enquiry.enquiry_id);
      if (current.status === 'AWAITING_CUSTOMER_ACCEPTANCE') {
        return { enquiry: current, alreadySent: true };
      }
      throw new ConflictError({
        message: `Cannot send a quote for an enquiry that is ${current.status.toLowerCase()}`,
      });
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          status: 'AWAITING_CUSTOMER_ACCEPTANCE',
          price_status: 'SENT',
          quoted_at: now,
          quoted_by_admin_id: admin.adminId,
        },
      });

      // Record the traversed stages so the timeline is honest about how the
      // enquiry got here (e.g. DRIVER_ASSIGNED → QUOTE_READY → AWAITING…).
      let previous = enquiry.status;
      for (const stage of path) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'STATUS_CHANGED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message:
              stage === 'QUOTE_READY'
                ? 'Final quote prepared'
                : `Status updated to ${stage.replace(/_/g, ' ').toLowerCase()}`,
            metadata: { from: previous, to: stage },
          },
          tx
        );
        previous = stage;
      }

      const amount = Math.round(Number(enquiry.final_quoted_price)).toLocaleString('en-IN');
      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'QUOTE_SENT',
          actorType: 'ADMIN',
          actorId: admin.adminId,
          actorName: admin.adminName,
          message: `Quotation of ₹${amount} sent to customer`,
          metadata: { final_quoted_price: enquiry.final_quoted_price },
        },
        tx
      );

      return row;
    });

    // The customer's live page reacts to this — no refresh.
    await this._broadcastAfterChange(enquiry.enquiry_id, 'quote:ready');

    return { enquiry: updated, alreadySent: false };
  }

  // =========================================================================
  // CUSTOMER — ACCEPT / REJECT / CANCEL
  // =========================================================================

  /**
   * Customer accepts the final quote.
   *
   * SERVER-AUTHORITATIVE, and deliberately ordered for safety:
   *   1. re-read the enquiry and verify ownership
   *   2. verify the status really is AWAITING_CUSTOMER_ACCEPTANCE
   *   3. verify a final quote actually exists — the client cannot assert a price
   *   4. ATOMICALLY claim the transition (updateMany on the expected status) so
   *      a double-click cannot create two bookings
   *   5. create the canonical Booking through the EXISTING BookingService
   *   6. link booking_id, advance to CONFIRMED, write the audit events
   *   7. notify admin + the assigned driver/partner, emit the live event
   *
   * Step 4's claim is released back to AWAITING_CUSTOMER_ACCEPTANCE if step 5
   * throws, so a transient booking failure never strands the customer.
   *
   * @param {number} enquiryId
   * @param {{user?:object, enquiryToken?:string}} ctx
   * @returns {Promise<{enquiry:object, booking:object}>}
   */
  async customerAccept(enquiryId, ctx) {
    const enquiry = await this.loadForCustomer(enquiryId);
    this.assertCustomerAccess(enquiry, ctx);

    if (enquiry.status === 'CUSTOMER_ACCEPTED' || enquiry.status === 'CONFIRMED') {
      // Idempotent: a repeated tap returns the same outcome, never a 2nd booking.
      const booking = enquiry.booking_id
        ? await this.prisma.booking.findUnique({
            where: { booking_id: enquiry.booking_id },
            select: { booking_id: true, booking_number: true, status: true },
          })
        : null;
      return { enquiry, booking, alreadyAccepted: true };
    }

    if (enquiry.status !== 'AWAITING_CUSTOMER_ACCEPTANCE') {
      throw new ConflictError({
        message: `This enquiry is not awaiting your approval (current status: ${enquiry.status})`,
      });
    }

    if (enquiry.final_quoted_price === null || !Number.isFinite(Number(enquiry.final_quoted_price))) {
      throw new ConflictError({ message: 'No final quote is available for this enquiry yet' });
    }

    const finalPrice = Number(enquiry.final_quoted_price);
    const acceptedAt = new Date();

    // ── Step 4: atomically claim ─────────────────────────────────────────
    const claim = await this.prisma.enquiry.updateMany({
      where: {
        enquiry_id: enquiry.enquiry_id,
        status: 'AWAITING_CUSTOMER_ACCEPTANCE',
      },
      data: {
        status: 'CUSTOMER_ACCEPTED',
        accepted_at: acceptedAt,
        price_status: 'ACCEPTED',
      },
    });

    if (claim.count === 0) {
      throw new ConflictError({
        message: 'This quote was just updated or already responded to. Please refresh.',
      });
    }

    // ── Step 5: create the canonical Booking via the EXISTING service ────
    let booking;
    try {
      booking = await this._createBookingFromEnquiry(enquiry, finalPrice, ctx);
    } catch (err) {
      // Release the claim so the customer can retry.
      await this.prisma.enquiry.updateMany({
        where: { enquiry_id: enquiry.enquiry_id, status: 'CUSTOMER_ACCEPTED' },
        data: { status: 'AWAITING_CUSTOMER_ACCEPTANCE', accepted_at: null, price_status: 'SENT' },
      });
      logger.error(
        { err: err.message, enquiryId: enquiry.enquiry_id },
        'enquiry.accept_booking_creation_failed_claim_released'
      );
      throw err instanceof AppError
        ? err
        : new AppError({
            message: 'We could not confirm your booking. Please try again in a moment.',
            errorCode: 'BOOKING_CREATION_FAILED',
            statusCode: 500,
          });
    }

    // ── Steps 6: link + advance to CONFIRMED + audit ─────────────────────
    const updated = await this.prisma.$transaction(async (tx) => {
      assertTransition('CUSTOMER_ACCEPTED', 'CONFIRMED');

      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          status: 'CONFIRMED',
          confirmed_at: acceptedAt,
          booking_id: booking.booking_id,
        },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'CUSTOMER_ACCEPTED',
          actorType: 'CUSTOMER',
          actorId: enquiry.customer_id,
          actorName: enquiry.customer_name,
          message: `You accepted the final quote of ₹${Math.round(finalPrice).toLocaleString('en-IN')}`,
          metadata: { final_quoted_price: finalPrice },
        },
        tx
      );

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'BOOKING_CREATED',
          actorType: 'SYSTEM',
          message: `Booking ${booking.booking_number} created`,
          metadata: { booking_id: booking.booking_id, booking_number: booking.booking_number },
        },
        tx
      );

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'STATUS_CHANGED',
          actorType: 'SYSTEM',
          message: 'Trip confirmed',
          metadata: { from: 'CUSTOMER_ACCEPTED', to: 'CONFIRMED' },
        },
        tx
      );

      return row;
    });

    // ── Step 7: notify + emit ────────────────────────────────────────────
    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'customer:accepted');
    await this._broadcastAfterChange(enquiry.enquiry_id, 'booking:confirmed');

    if (enquiry.assigned_driver_id) {
      this.realtime.emitToDriver(enquiry.assigned_driver_id, 'booking:confirmed', {
        enquiry_id: enquiry.enquiry_id,
        enquiry_number: enquiry.enquiry_number,
        pickup_location: enquiry.pickup_location,
        drop_location: enquiry.drop_location,
        pickup_date: enquiry.pickup_date,
        pickup_time: enquiry.pickup_time,
        // PRIVACY: no customer mobile, no final price.
      });
    }
    if (enquiry.assigned_partner_id) {
      this.realtime.emitToPartner(enquiry.assigned_partner_id, 'booking:confirmed', {
        enquiry_id: enquiry.enquiry_id,
        enquiry_number: enquiry.enquiry_number,
        booking_number: booking.booking_number,
      });
    }

    logger.info(
      { enquiryId: enquiry.enquiry_id, bookingId: booking.booking_id, finalPrice },
      'enquiry.accepted'
    );

    return { enquiry: updated, booking };
  }

  /**
   * Create the operational Booking for an accepted enquiry.
   * @private
   */
  async _createBookingFromEnquiry(enquiry, finalPrice, ctx) {
    // Booking.user_id is NOT NULL, so an accepted enquiry always needs a User.
    // A guest who accepts is linked to (or gets) a real account — the same
    // guest-account pattern the existing /api/booking endpoint already uses.
    const user = await this._resolveOrCreateUserForEnquiry(enquiry, ctx);

    const created = await this.bookingService.createBooking({
      user_id: user.user_id,
      driver_id: enquiry.assigned_driver_id || null,
      vehicle_id: enquiry.assigned_vehicle_id || null,
      partner_id: enquiry.assigned_partner_id || null,
      vehicle_owner_id: enquiry.assigned_owner_id || null,

      pickup_location: enquiry.pickup_location,
      pickup_address: enquiry.pickup_address || null,
      pickup_city: enquiry.pickup_location,
      pickup_state: 'Bihar',
      // NOTE: Booking.pickup_date is a String ("YYYY-MM-DD") in the existing
      // schema, while Enquiry.pickup_date is a proper DateTime. Convert here
      // rather than changing the Booking schema, which many other booking
      // paths depend on.
      pickup_date: formatISODate(enquiry.pickup_date),
      pickup_time: enquiry.pickup_time,
      drop_location: enquiry.drop_location,
      drop_address: enquiry.drop_address || null,
      drop_city: enquiry.drop_location,
      drop_state: 'Bihar',

// Enquiry.material is nullable (the customer may not have known it at
      // intake). Booking.goods_description is NOT NULL and is a field the whole
      // operational pipeline already treats as a plain string, so an unanswered
      // load becomes "" here — an empty operational note, not a fabricated one.
      goods_description: enquiry.material || '',
      goods_type: enquiry.goods_category || null,
      goods_weight_kg: null, // unit-aware weight stays on the enquiry
      number_of_items: enquiry.quantity !== null ? Math.round(enquiry.quantity) : 1,
      quantity_unit: enquiry.quantity_unit || null,
      weight_unit: enquiry.weight_unit || null,
      fragile: enquiry.fragile,
      special_instructions: enquiry.special_instructions || null,

      vehicle_type_required: enquiry.assigned_vehicle_type || enquiry.requested_vehicle_name,
      estimated_distance_km: enquiry.distance_km,
      estimated_price: enquiry.estimated_price_min,
      final_price: finalPrice,

      status: 'confirmed',
      quote_status: 'ACCEPTED',
      confirmation_source: 'CUSTOMER',
      quote_remarks: enquiry.quote_remarks || null,
      quote_sent_at: enquiry.quoted_at || null,
      quote_accepted_at: new Date(),

      driver_name_snapshot: enquiry.assigned_driver_name || null,
      truck_number_snapshot: enquiry.assigned_vehicle_number || null,
      mobile_snapshot: enquiry.customer_mobile,
    });

    // Bind the enquiry to the customer account now that one exists.
    if (!enquiry.customer_id) {
      await this.prisma.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: { customer_id: user.user_id },
      });
    }

    // BookingService.createBooking returns only the id/number it just wrote.
    // Echo back the state we persisted so the accept response is complete
    // (the confirmation page renders booking.status) rather than undefined.
    return {
      ...created,
      status: 'confirmed',
      quote_status: 'ACCEPTED',
    };
  }

  /**
   * Find or create the User that owns an enquiry.
   * @private
   */
  async _resolveOrCreateUserForEnquiry(enquiry, ctx) {
    if (enquiry.customer_id) {
      const user = await this.prisma.user.findUnique({
        where: { user_id: enquiry.customer_id },
        select: { user_id: true },
      });
      if (user) return user;
    }

    // Prefer the authenticated user when they are accepting their own enquiry.
    if (ctx.user && ctx.user.user_id && !ADMIN_ROLES.includes(ctx.user.role)) {
      const user = await this.prisma.user.findUnique({
        where: { user_id: ctx.user.user_id },
        select: { user_id: true },
      });
      if (user) return user;
    }

    const mobile = normalizeMobile(enquiry.customer_mobile);
    if (!mobile) {
      throw new ValidationError({
        message: 'This enquiry has no verified mobile number; please contact customer care',
      });
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone: mobile },
      select: { user_id: true },
    });
    if (existing) return existing;

    // Guest account: random, hashed, never disclosed. The customer continues to
    // reach their account via OTP on the mobile number they supplied.
    const passwordHash = await bcrypt.hash(
      `bt_guest_${mobile}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      10
    );

    const nameParts = String(enquiry.customer_name || 'Guest Customer').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Guest';
    const lastName = nameParts.slice(1).join(' ') || 'Customer';

    const created = await this.prisma.user.create({
      data: {
        first_name: firstName,
        last_name: lastName,
        email: enquiry.customer_email || `guest_${mobile}@btb.local`,
        phone: mobile,
        password_hash: passwordHash,
        role: 'customer',
        is_active: true,
      },
      select: { user_id: true },
    });

    return created;
  }

  /**
   * Customer declines the final quote.
   * @param {number} enquiryId
   * @param {{user?:object, enquiryToken?:string}} ctx
   * @param {{reason?:string}} [payload]
   */
  async customerReject(enquiryId, ctx, payload = {}) {
    const enquiry = await this.loadForCustomer(enquiryId);
    this.assertCustomerAccess(enquiry, ctx);

    if (enquiry.status === 'CUSTOMER_REJECTED') {
      return { enquiry, alreadyRejected: true };
    }
    if (enquiry.status !== 'AWAITING_CUSTOMER_ACCEPTANCE') {
      throw new ConflictError({
        message: `There is no pending quote to decline (current status: ${enquiry.status})`,
      });
    }

    const now = new Date();
    const reason = clean(payload.reason, 500);

    const updated = await this.prisma.$transaction(async (tx) => {
      assertTransition(enquiry.status, 'CUSTOMER_REJECTED');

      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          status: 'CUSTOMER_REJECTED',
          price_status: 'REJECTED',
          rejected_at: now,
        },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'CUSTOMER_REJECTED',
          actorType: 'CUSTOMER',
          actorId: enquiry.customer_id,
          actorName: enquiry.customer_name,
          message: reason
            ? `Quote declined — ${reason}`
            : 'Quote declined',
          metadata: reason ? { reason } : null,
        },
        tx
      );

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'STATUS_CHANGED',
          actorType: 'CUSTOMER',
          message: 'Request closed by customer',
          metadata: { from: enquiry.status, to: 'CUSTOMER_REJECTED' },
        },
        tx
      );

      return row;
    });

    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'customer:rejected');
    await this._broadcastAfterChange(enquiry.enquiry_id, 'customer:rejected');

    return { enquiry: updated };
  }

  /**
   * Customer cancels the enquiry.
   *
   * Self-service is only allowed BEFORE the trip is confirmed. Once a vehicle
   * and driver are committed, the customer must call customer care — that keeps
   * the "who owns this relationship" rule unambiguous.
   *
   * @param {number} enquiryId
   * @param {{user?:object, enquiryToken?:string}} ctx
   * @param {{reason?:string}} [payload]
   */
  async customerCancel(enquiryId, ctx, payload = {}) {
    const enquiry = await this.loadForCustomer(enquiryId);
    this.assertCustomerAccess(enquiry, ctx);

    if (enquiry.status === 'CANCELLED') {
      return { enquiry, alreadyCancelled: true };
    }

    if (!canCancel(enquiry.status, 'CUSTOMER')) {
      throw new ConflictError({
        message:
          'This trip is already confirmed. Please contact Bihar Transport customer care to make changes.',
      });
    }

    const reason = clean(payload.reason, 500) || 'Cancelled by customer';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          status: 'CANCELLED',
          price_status: 'CANCELLED',
          cancelled_at: new Date(),
          cancellation_reason: reason,
        },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'CUSTOMER_CANCELLED',
          actorType: 'CUSTOMER',
          actorId: enquiry.customer_id,
          actorName: enquiry.customer_name,
          message: 'Request cancelled by customer',
          metadata: { reason },
        },
        tx
      );

      return row;
    });

    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'booking:cancelled');
    await this._broadcastAfterChange(enquiry.enquiry_id, 'booking:cancelled');

    return { enquiry: updated };
  }

  // =========================================================================
  // ADMIN — REASSIGN / CANCEL
  // =========================================================================

  /**
   * Move an enquiry into a review state without assigning anything.
   *
   * This exists so "Start reviewing" is a real, audited action rather than a
   * cosmetic admin button. Only the two pre-assignment review markers are
   * reachable from here — every other status must go through assign / quote /
   * send-quote so the lifecycle cannot be short-circuited.
   *
   * @param {number} enquiryId
   * @param {'ADMIN_REVIEW'|'ASSIGNMENT_PENDING'} status
   * @param {{adminId:number, adminName:string}} admin
   * @param {{note?:string}} [payload]
   * @returns {Promise<object>}
   */
  async adminSetReviewStatus(enquiryId, status, admin, payload = {}) {
    const REACHABLE = ['ADMIN_REVIEW', 'ASSIGNMENT_PENDING'];
    if (!REACHABLE.includes(status)) {
      throw new ValidationError({
        message: `Status cannot be set directly to ${status}. Use the assign, quote or send-quote actions.`,
      });
    }

    const enquiry = await this.loadForAdmin(enquiryId);
    if (isTerminal(enquiry.status)) {
      throw new ConflictError({
        message: `Cannot change a ${enquiry.status.toLowerCase()} enquiry`,
      });
    }

    if (enquiry.status === status) {
      // Idempotent — clicking "Start reviewing" twice is not an error.
      return enquiry;
    }

    // "Start reviewing" must remain available once resources are assigned,
    // even though the row has already advanced past ADMIN_REVIEW. Allow a
    // single backward step (which the state machine allows) but never further.
    const isBackwardReview = status === 'ADMIN_REVIEW' && canTransition(enquiry.status, 'ADMIN_REVIEW');

    if (!canTransition(enquiry.status, status) && !isBackwardReview) {
      throw new ConflictError({
        message: `Cannot move this enquiry from ${enquiry.status} to ${status}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      assertTransition(enquiry.status, status);

      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: { status },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'STATUS_CHANGED',
          actorType: 'ADMIN',
          actorId: admin.adminId,
          actorName: admin.adminName,
          message: status === 'ADMIN_REVIEW' ? 'Transport team reviewing your request' : 'Preparing vehicle assignment',
          metadata: { from: enquiry.status, to: status },
        },
        tx
      );

      if (payload.note) {
        await this.events.addEvent(
          {
            enquiryId: enquiry.enquiry_id,
            eventType: 'NOTE_ADDED',
            actorType: 'ADMIN',
            actorId: admin.adminId,
            actorName: admin.adminName,
            message: String(payload.note).slice(0, 500),
            customerVisible: false,
          },
          tx
        );
      }

      return row;
    });

    await this._broadcastAfterChange(enquiry.enquiry_id, 'enquiry:updated');

    return updated;
  }

  /**
   * Reassign resources on a live enquiry.
   *
   * The same validation as assignAssignment runs, with `isReassignment: true`
   * so an operator can deliberately break a driver/vehicle pairing. Every
   * change is written to the audit log as REASSIGNED — a resource is never
   * silently removed.
   *
   * @param {number} enquiryId
   * @param {Object} input
   * @param {{adminId:number, adminName:string}} admin
   */
  async adminReassign(enquiryId, input, admin) {
    return this.adminAssign(enquiryId, input, admin, { isReassignment: true });
  }

  /**
   * Admin cancels an enquiry, including a confirmed trip.
   * @param {number} enquiryId
   * @param {{adminId:number, adminName:string}} admin
   * @param {{reason?:string}} [payload]
   */
  async adminCancel(enquiryId, admin, payload = {}) {
    const enquiry = await this.loadForAdmin(enquiryId);

    if (enquiry.status === 'CANCELLED') {
      return { enquiry, alreadyCancelled: true };
    }

    const reason = clean(payload.reason, 500) || 'Cancelled by Bihar Transport';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: {
          status: 'CANCELLED',
          price_status: 'CANCELLED',
          cancelled_at: new Date(),
          cancellation_reason: reason,
        },
      });

      await this.events.addEvent(
        {
          enquiryId: enquiry.enquiry_id,
          eventType: 'STATUS_CHANGED',
          actorType: 'ADMIN',
          actorId: admin.adminId,
          actorName: admin.adminName,
          message: `Enquiry cancelled by Bihar Transport — ${reason}`,
          metadata: { from: enquiry.status, to: 'CANCELLED', reason },
        },
        tx
      );

      return row;
    });

    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'booking:cancelled');
    await this._broadcastAfterChange(enquiry.enquiry_id, 'booking:cancelled');

    return { enquiry: updated };
  }

  // =========================================================================
  // DRIVER — REQUEST ONLY, NEVER ACT
  // =========================================================================

  /**
   * Driver asks to be replaced on an enquiry.
   *
   * THE WHOLE POINT: a driver can never cancel or silently unassign themselves
   * from a customer booking. They raise a request, an admin decides. This
   * method only ever writes an EnquiryEvent — it never touches status,
   * assignment or price.
   *
   * @param {number} enquiryId
   * @param {{driverId:number, driverName:string}} driver
   * @param {{reason:string, category?:string}} payload
   */
  async driverRequestReassignment(enquiryId, driver, payload) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      select: {
        enquiry_id: true,
        enquiry_number: true,
        assigned_driver_id: true,
        status: true,
      },
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });

    if (enquiry.assigned_driver_id !== driver.driverId) {
      throw new ForbiddenError({
        message: 'This enquiry is not assigned to you',
      });
    }
    if (isTerminal(enquiry.status)) {
      throw new ConflictError({
        message: `This enquiry is ${enquiry.status.toLowerCase()} and can no longer be changed`,
      });
    }

    const reason = clean(payload.reason, 500);
    if (!reason) {
      throw new ValidationError({ message: 'Please provide a reason for the reassignment request' });
    }
    const category = clean(payload.category, 60) || 'GENERAL';

    const event = await this.events.addEvent({
      enquiryId: enquiry.enquiry_id,
      eventType: 'DRIVER_REASSIGNMENT_REQUESTED',
      actorType: 'DRIVER',
      actorId: driver.driverId,
      actorName: driver.driverName,
      // Internal + admin-facing. The customer is NOT told a driver asked to be
      // swapped; customer care handles that conversation.
      customerVisible: false,
      message: `Reassignment requested by ${driver.driverName} (${category}) — ${reason}`,
      metadata: { reason, category },
    });

    // Admin acts on it; the driver gets no status change.
    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'driver:reassignment_requested');

    return { enquiry, event };
  }

  /**
   * Driver reports an issue with an assigned enquiry.
   * @param {number} enquiryId
   * @param {{driverId:number, driverName:string}} driver
   * @param {{description:string, category?:string, severity?:string}} payload
   */
  async driverReportIssue(enquiryId, driver, payload) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      select: { enquiry_id: true, enquiry_number: true, assigned_driver_id: true, status: true },
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });

    if (enquiry.assigned_driver_id !== driver.driverId) {
      throw new ForbiddenError({ message: 'This enquiry is not assigned to you' });
    }

    const description = clean(payload.description, 1000);
    if (!description) {
      throw new ValidationError({ message: 'Please describe the issue' });
    }
    const category = clean(payload.category, 60) || 'GENERAL';
    const severity = clean(payload.severity, 20) || 'NORMAL';

    const event = await this.events.addEvent({
      enquiryId: enquiry.enquiry_id,
      eventType: 'DRIVER_ISSUE_REPORTED',
      actorType: 'DRIVER',
      actorId: driver.driverId,
      actorName: driver.driverName,
      customerVisible: false,
      message: `Issue reported by ${driver.driverName} (${category}/${severity}) — ${description}`,
      metadata: { description, category, severity },
    });

    this.realtime.emitEnquiryToAdmins(enquiry.enquiry_id, 'driver:issue_reported');

    return { enquiry, event };
  }

  // =========================================================================
  // LISTS
  // =========================================================================

  /**
   * Admin enquiry list with search, filters and pagination.
   *
   * @param {Object} query
   * @returns {Promise<{rows:object[], total:number, page:number, pageSize:number}>}
   */
  async listForAdmin(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 25));
    const skip = (page - 1) * pageSize;

    const where = {};

    if (query.status && query.status !== 'ALL') {
      const mapped = this._mapStatusFilter(query.status);
      if (Array.isArray(mapped)) where.status = { in: mapped };
      else where.status = mapped;
    }

    if (query.price_status && query.price_status !== 'ALL') {
      where.price_status = query.price_status;
    }

    if (query.pickup_date) {
      const from = parsePickupDate(query.pickup_date_from);
      const to = parsePickupDate(query.pickup_date_to);
      if (from || to) {
        where.pickup_date = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };
      }
    }

    const search = clean(query.search, 120);
    if (search) {
      // Case-insensitive contains across the fields support actually search by.
      // enquiry_number is matched case-insensitively on the normalised uppercase
      // form the server generates.
      where.OR = [
        { enquiry_number: { contains: search.toUpperCase(), mode: 'insensitive' } },
        { customer_name: { contains: search, mode: 'insensitive' } },
        { customer_mobile: { contains: search.replace(/\D/g, ''), mode: 'insensitive' } },
        { pickup_location: { contains: search, mode: 'insensitive' } },
        { drop_location: { contains: search, mode: 'insensitive' } },
        { material: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        include: {
          assignedDriver: { select: { driver_id: true, driver_name: true } },
          assignedVehicle: { select: { vehicle_id: true, vehicle_number: true } },
          booking: { select: { booking_id: true, booking_number: true } },
        },
        orderBy: [{ created_at: 'desc' }, { enquiry_id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    const { toAdminEnquiryRow } = require('../dtos/EnquiryDTO');

    return {
      rows: rows.map(toAdminEnquiryRow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Map a UI filter chip to the underlying status set.
   * @private
   */
  _mapStatusFilter(filter) {
    switch (String(filter).toUpperCase()) {
      case 'NEW':
        return ['ENQUIRY_SUBMITTED'];
      case 'REVIEWING':
        return ['ADMIN_REVIEW', 'ASSIGNMENT_PENDING'];
      case 'ASSIGNMENT_PENDING':
        return ['ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED'];
      case 'QUOTE_PENDING':
        return ['QUOTE_READY'];
      case 'AWAITING_CUSTOMER':
        return ['AWAITING_CUSTOMER_ACCEPTANCE'];
      case 'ACCEPTED':
        return ['CUSTOMER_ACCEPTED'];
      case 'CONFIRMED':
        return ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
      case 'CANCELLED':
        return ['CANCELLED', 'CUSTOMER_REJECTED'];
      case 'ALL':
      default:
        return [];
    }
  }

  /**
   * A customer's own enquiries (logged-in or by guest session key).
   * @param {{userId?:number, sessionKey?:string, page?:number, pageSize?:number}} params
   */
  async listForCustomer(params = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const OR = [];
    if (params.userId) OR.push({ customer_id: params.userId });
    if (params.sessionKey) OR.push({ session_key: params.sessionKey });

    // Never fall back to "everyone's enquiries" — an unauthenticated list
    // request with neither identifier returns nothing.
    const where = OR.length ? { OR } : { enquiry_id: -1 };

    const [rows, total] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { enquiry_id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    const { toCustomerEnquirySummary } = require('../dtos/EnquiryDTO');

    return {
      rows: rows.map(toCustomerEnquirySummary),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Compact status payload for the polling fallback.
   * @param {number} enquiryId
   */
  async getStatus(enquiryId) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      select: {
        enquiry_id: true,
        enquiry_number: true,
        status: true,
        price_status: true,
        final_quoted_price: true,
        estimated_price_min: true,
        estimated_price_max: true,
        updated_at: true,
        quoted_at: true,
        accepted_at: true,
        cancelled_at: true,
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
    if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });

    const { toProgressStage } = require('../utils/EnquiryStateMachine');

    return {
      enquiry_id: enquiry.enquiry_id,
      enquiry_number: enquiry.enquiry_number,
      status: enquiry.status,
      price_status: enquiry.price_status,
      progress_stage: toProgressStage(enquiry.status),
      final_quoted_price: enquiry.final_quoted_price,
      estimated_price_min: enquiry.estimated_price_min,
      estimated_price_max: enquiry.estimated_price_max,
      booking: enquiry.booking,
      updated_at: enquiry.updated_at,
      quoted_at: enquiry.quoted_at,
      accepted_at: enquiry.accepted_at,
      cancelled_at: enquiry.cancelled_at,
    };
  }

  /**
   * Mark an enquiry as reviewed by an admin (audit only).
   * @param {number} enquiryId
   * @param {{adminId:number, adminName:string}} admin
   */
  async markAdminViewed(enquiryId, admin) {
    await this.events.addEvent({
      enquiryId: Number(enquiryId),
      eventType: 'ADMIN_VIEWED',
      actorType: 'ADMIN',
      actorId: admin.adminId,
      actorName: admin.adminName,
      message: 'Opened by Bihar Transport',
      customerVisible: false,
    });
  }

  /**
   * Fan a change out to the customer room and the admin room.
   * @private
   */
  async _broadcastAfterChange(enquiryId, primaryEvent, extra = {}) {
    await this.realtime.emitToEnquiry(enquiryId, primaryEvent, extra);
    // `enquiry:updated` is the generic "re-fetch me" signal the customer page
    // listens for, so any change refreshes the whole card.
    await this.realtime.emitToEnquiry(enquiryId, 'enquiry:updated', extra);
    await this.realtime.emitEnquiryToAdmins(enquiryId, 'enquiry:updated');
  }
}

module.exports = new EnquiryService();
module.exports.EnquiryService = EnquiryService;
module.exports.normalizeMobile = normalizeMobile;
module.exports.parsePickupDate = parsePickupDate;
module.exports.normalizePickupTime = normalizePickupTime;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
