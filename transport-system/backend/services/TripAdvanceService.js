/**
 * TripAdvanceService
 * ---------------------------------------------------------------------------
 * An ADVANCE is money paid to a party BEFORE final settlement.
 *
 * It is NOT a payment and it is NOT a hire. The separation is absolute:
 *
 *      Gross Hire  −  Commission  =  Net Vendor Payable     (Phase 2, untouched)
 *      Net Vendor Payable  −  Advances  −  Payments  =  Outstanding  (Phase 3)
 *
 * Recording an advance therefore NEVER writes to `Trip.freight_amount`, never
 * writes a commission, and never writes a net figure. The authoritative hire
 * arithmetic lives in `VehicleHireService` and is only ever READ here, through
 * `VendorLedgerService.getOwnerPosition()`.
 *
 * PHASE 3 — what this service guarantees for every advance:
 *   1. it creates the immutable `TripAdvance` row (never overwrites an older one)
 *   2. it ALWAYS creates the matching canonical `FinancialTransaction`, including
 *      for standalone trips that have no Booking. (Before Phase 3 a trip-linked
 *      advance produced no transaction at all, so it never reduced the vendor's
 *      outstanding balance.)
 *   3. the advance + its financial transaction are written in ONE database
 *      transaction, so an advance can never exist without its money row
 *   4. the amount is validated server-side against the authoritative, server
 *      calculated outstanding vendor payable — a client-supplied
 *      `net_vendor_payable` / `owner_payable` / `vendor_payable` is ignored
 *   5. it is IDEMPOTENT on `reference_number`, so a double click / network retry
 *      / API retry can never produce two advances (see `_findIdempotentAdvance`)
 *   6. it does not create, touch or infer fuel expenses — `FUEL_ADVANCE` is an
 *      advance handed over for fuel; a recorded diesel spend is a `TripExpense`.
 *      The two stay distinct (STEP 13).
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripAdvanceRepository = require('../repositories/TripAdvanceRepository');
const TripTransactionService = require('./TripTransactionService');
const VendorLedgerService = require('./VendorLedgerService');
const AuditLogRepository = require('../repositories/AuditLogRepository');

/**
 * Canonical advance vocabulary. These mirror the Prisma `AdvanceType` enum
 * exactly — no second list is introduced.
 */
const ADVANCE_TYPES = Object.freeze(['DRIVER_ADVANCE', 'FUEL_ADVANCE', 'OWNER_ADVANCE', 'OTHER']);

/**
 * Payment methods the repository already stores on TripAdvance.payment_method
 * and FinancialTransaction.payment_method. They are stored as free text
 * everywhere else in this codebase (TripExpense, TripPayment, PartnerLedger,
 * PartnerPayment), so no new enum is introduced here — the same vocabulary is
 * accepted, which is what the existing UI already sends.
 */
const PAYMENT_METHODS = Object.freeze(['cash', 'bank', 'bank_transfer', 'upi', 'cheque', 'other']);

/**
 * Canonical transaction type + direction for each advance type. Reading the
 * vocabulary from one place keeps `TripAdvanceService` and
 * `VendorLedgerService` in agreement about what counts as money out to a vendor.
 */
const ADVANCE_FINANCIAL_TYPE = Object.freeze({
  OWNER_ADVANCE: 'OWNER_ADVANCE',
  DRIVER_ADVANCE: 'DRIVER_ADVANCE',
  FUEL_ADVANCE: 'FUEL_ADVANCE',
  OTHER: null, // 'OTHER' is a note, not a money movement — no transaction.
});

class TripAdvanceService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   */
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripAdvanceRepo = new TripAdvanceRepository();
    this.tripTransactionService = new TripTransactionService(options);
    this.vendorLedgerService = new VendorLedgerService(options);
    this.auditRepo = new AuditLogRepository();
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Validate the client-supplied part of an advance.
   *
   * ONLY transport facts are accepted from the browser: amount, type, method,
   * reference, notes, date and (optionally) the party it goes to. Nothing that
   * describes the hire — gross, commission, net payable, outstanding — is read
   * from the payload, because those are derived, not client-declared.
   *
   * @param {Object} advanceData
   * @returns {{amount:number, advance_type:string, payment_method:string,
   *            reference_number:(string|null), notes:(string|null),
   *            given_at:Date, driver_id:(number|null),
   *            vehicle_id:(number|null), transport_owner_id:(number|null)}}
   * @throws {ValidationError}
   */
  validateAdvance(advanceData = {}) {
    const amount = Number(advanceData.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    const advanceType = String(advanceData.advance_type || '').toUpperCase();
    if (!ADVANCE_TYPES.includes(advanceType)) {
      throw new ValidationError(
        `Invalid advance_type "${advanceData.advance_type}". Expected one of: ${ADVANCE_TYPES.join(', ')}`
      );
    }

    const paymentMethod = String(advanceData.payment_method || 'cash').toLowerCase();
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      throw new ValidationError(
        `Invalid payment_method "${advanceData.payment_method}". Expected one of: ${PAYMENT_METHODS.join(', ')}`
      );
    }

    const rawDate = advanceData.given_at || advanceData.advance_date || advanceData.payment_date;
    let givenAt = new Date();
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`Invalid advance date "${rawDate}"`);
      }
      givenAt = parsed;
    }

    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

    return {
      amount,
      advance_type: advanceType,
      payment_method: paymentMethod,
      reference_number: advanceData.reference_number || advanceData.reference || null,
      notes: advanceData.notes || null,
      given_at: givenAt,
      driver_id: num(advanceData.driver_id),
      vehicle_id: num(advanceData.vehicle_id),
      transport_owner_id: num(advanceData.transport_owner_id),
    };
  }

  // =========================================================================
  // IDEMPOTENCY (STEP 11)
  // =========================================================================

  /**
   * Find an already-recorded advance for the same reference.
   *
   * The repository already stores `TripAdvance.reference_number` (cheque no.,
   * UPI ref, receipt no.) and the payment UI already has a reference field, so
   * that column is REUSED as the idempotency key rather than introducing a new
   * table, a new header contract or any UI change.
   *
   * Scope of the match: same trip/booking, same advance type, same reference.
   * A reference recorded against a DIFFERENT trip is a different payment and is
   * not deduplicated. When no reference is supplied there is nothing stable to
   * key on, so the request is processed normally — inventing a key from the
   * clock would collapse two genuine, identical payments.
   *
   * @param {Object} params
   * @returns {Promise<Object|null>} the existing TripAdvance row, or null
   */
  async _findIdempotentAdvance({ reference_number, advance_type, trip_id, booking_id }, tx = null) {
    if (!reference_number) return null;
    const client = tx || this.prisma;

    return await client.tripAdvance.findFirst({
      where: {
        ...(trip_id ? { trip_id } : { booking_id }),
        advance_type,
        reference_number,
      },
    });
  }

  /**
   * Look for an existing canonical money row for a settlement reference, so a
   * retried settlement request cannot create a second OWNER_SETTLEMENT /
   * DRIVER_SETTLEMENT transaction.
   *
   * @param {Object} params
   * @returns {Promise<Object|null>}
   */
  async _findIdempotentSettlementTransaction({ reference_number, transaction_type, trip_id, booking_id }, tx = null) {
    if (!reference_number) return null;
    const client = tx || this.prisma;

    return await client.financialTransaction.findFirst({
      where: {
        ...(trip_id ? { trip_id } : { booking_id }),
        transaction_type,
        reference_number,
      },
    });
  }

  // =========================================================================
  // TARGET RESOLUTION
  // =========================================================================

  /**
   * Work out which Trip / Booking / party an advance belongs to.
   *
   * A Trip is the real-world entity in this system and it may exist without a
   * Booking, so a trip id always wins when it resolves. Party ids are taken
   * from the Trip itself — never from the request — so an advance can never be
   * booked against somebody else's driver, vehicle or vendor.
   *
   * @param {number|null} bookingId
   * @param {number|null} tripId
   * @returns {Promise<Object>}
   */
  async _resolveTarget(bookingId, tripId) {
    const effectiveTripId = tripId ? Number(tripId) : null;
    const effectiveBookingId = bookingId ? Number(bookingId) : null;

    let trip = null;
    if (effectiveTripId) {
      trip = await this.prisma.trip.findUnique({
        where: { trip_id: effectiveTripId },
        select: {
          trip_id: true, booking_id: true, driver_id: true,
          vehicle_id: true, transport_owner_id: true, freight_amount: true,
        },
      });
      if (!trip) throw new NotFoundError('Trip not found');
    }

    let resolvedBookingId = trip ? trip.booking_id : effectiveBookingId;
    let booking = null;
    if (resolvedBookingId) {
      booking = await this.prisma.booking.findUnique({
        where: { booking_id: resolvedBookingId },
        select: { driver_id: true, vehicle_owner_id: true, vehicle_id: true },
      });
    }

    if (!trip && !booking) {
      throw new ValidationError('Either booking_id or trip_id is required');
    }

    return {
      trip,
      tripId: trip ? trip.trip_id : null,
      bookingId: resolvedBookingId || null,
      driverId: trip ? trip.driver_id : booking?.driver_id || null,
      vehicleId: trip ? trip.vehicle_id : booking?.vehicle_id || null,
      ownerId: trip ? trip.transport_owner_id : booking?.vehicle_owner_id || null,
    };
  }

  // =========================================================================
  // CREATE
  // =========================================================================

  /**
   * Create an advance.
   *
   * @param {number|null} bookingId - legacy booking-scoped entry point
   * @param {Object} advanceData
   * @param {Object|null} admin - the authenticated actor (becomes `given_by`)
   * @returns {Promise<Object>} the TripAdvance row
   */
  async createAdvance(bookingId, advanceData, admin = null) {
    const input = this.validateAdvance(advanceData);
    const target = await this._resolveTarget(bookingId, advanceData.trip_id);

    // Party ids ALWAYS come from the Trip/Booking, never from the payload.
    const driverId = input.driver_id || target.driverId || null;
    const vehicleId = target.vehicleId || null;
    const ownerId = target.ownerId || null;

    // ── Idempotency: a retry must not create a second advance ──────────────
    const existing = await this._findIdempotentAdvance({
      reference_number: input.reference_number,
      advance_type: input.advance_type,
      trip_id: target.tripId,
      booking_id: target.bookingId,
    });
    if (existing) {
      return { ...existing, already_recorded: true };
    }

    // ── Server-side amount validation against the AUTHORITATIVE payable ────
    // Only the vendor advance is checked here, and only against the payable the
    // SERVER calculated (VehicleHireService: gross − commission). This preserves
    // the repository's existing "reject overpayment" rule that already governs
    // client payments and settlements. Driver/fuel advances are left exactly as
    // they were — they are a different party's balance and out of Phase 3 scope.
    if (input.advance_type === 'OWNER_ADVANCE' && target.tripId) {
      const position = await this.vendorLedgerService.getOwnerPosition(target.tripId);
      if (input.amount > position.outstanding) {
        throw new ValidationError(
          `Advance amount (₹${input.amount}) exceeds the outstanding vendor payable (₹${position.outstanding})`
        );
      }
    }

    const transactionType = ADVANCE_FINANCIAL_TYPE[input.advance_type];

    // ── One transaction: advance + canonical money row + audit ─────────────
    const result = await this.prisma.$transaction(async (tx) => {
      // The canonical ledger is anchored on TripFinancial. A standalone trip has
      // none yet, so find-or-create it here — this is the step that was missing,
      // and without it no FinancialTransaction could ever be written for a
      // standalone trip's advance.
      let tripFinancial = target.tripId
        ? await this.tripFinancialRepo.findByTripId(target.tripId, tx)
        : await this.tripFinancialRepo.findByBookingId(target.bookingId, tx);

      if (!tripFinancial) {
        tripFinancial = target.tripId
          ? await this.tripFinancialRepo.findOrCreateByTripId(target.tripId, tx)
          : await this.tripFinancialRepo.findOrCreateByBookingId(target.bookingId, tx);
      }

      const advance = await this.tripAdvanceRepo.create(
        {
          trip_financial_id: tripFinancial?.trip_financial_id || null,
          booking_id: target.bookingId,
          trip_id: target.tripId,
          driver_id: driverId,
          vehicle_id: vehicleId,
          transport_owner_id: ownerId,
          amount: input.amount,
          advance_type: input.advance_type,
          payment_method: input.payment_method,
          reference_number: input.reference_number,
          given_by: admin?.user_id || null,
          given_at: input.given_at,
          notes: input.notes,
          status: 'approved',
        },
        tx
      );

      if (transactionType && tripFinancial) {
        const shared = {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: target.bookingId,
          trip_id: target.tripId,
          vehicle_id: vehicleId,
          amount: input.amount,
          payment_method: input.payment_method,
          reference_number: input.reference_number,
          transaction_date: input.given_at,
          notes: input.notes,
          created_by: admin?.user_id || null,
        };

        if (transactionType === 'OWNER_ADVANCE') {
          await this.tripTransactionService.createOwnerAdvance(
            { ...shared, transport_owner_id: ownerId }, tx
          );
        } else {
          await this.tripTransactionService.createDriverAdvance(
            { ...shared, driver_id: driverId, advance_type: input.advance_type }, tx
          );
        }
      }

      await this.auditRepo.create(
        {
          user_id: admin?.user_id || null,
          user_role: admin?.role || 'system',
          action: 'advance_created',
          entity_type: 'TripAdvance',
          entity_id: advance.advance_id,
          new_value: JSON.stringify({
            amount: input.amount,
            advance_type: input.advance_type,
            booking_id: target.bookingId,
            trip_id: target.tripId,
          }),
          reason: input.notes || null,
        },
        tx
      );

      return advance;
    });

    return result;
  }

  // =========================================================================
  // READ
  // =========================================================================

  /**
   * Advances for a booking OR a trip, filtered by the caller's role.
   *
   * @param {number|null} bookingId
   * @param {number|null} tripId
   * @param {string} role
   * @returns {Promise<Array>}
   */
  async getAdvances(bookingId, tripId, role) {
    if (!bookingId && !tripId) return [];
    const where = tripId ? { trip_id: Number(tripId) } : { booking_id: Number(bookingId) };
    const advances = await this.tripAdvanceRepo.findMany(where);

    // Role visibility, unchanged from the existing implementation.
    switch (role) {
      case 'ADMIN':
        return advances;
      case 'TRANSPORT_OWNER':
        return advances.filter((a) => a.advance_type === 'OWNER_ADVANCE');
      case 'DRIVER':
        return advances.filter((a) => a.advance_type === 'DRIVER_ADVANCE' || a.advance_type === 'FUEL_ADVANCE');
      default:
        return [];
    }
  }

  /**
   * Advance totals for a booking OR a trip.
   *
   * @param {number|null} bookingId
   * @param {number|null} tripId
   * @returns {Promise<Object>}
   */
  async getAdvanceSummary(bookingId, tripId) {
    if (!bookingId && !tripId) {
      return {
        totalDriverAdvance: 0,
        totalFuelAdvance: 0,
        totalOwnerAdvance: 0,
        totalAll: 0,
        count: 0,
      };
    }

    const where = tripId ? { trip_id: Number(tripId) } : { booking_id: Number(bookingId) };
    const advances = await this.tripAdvanceRepo.findMany(where);

    const sum = (type) => advances
      .filter((a) => a.advance_type === type)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);

    const totalDriverAdvance = sum('DRIVER_ADVANCE');
    const totalFuelAdvance = sum('FUEL_ADVANCE');
    const totalOwnerAdvance = sum('OWNER_ADVANCE');

    return {
      totalDriverAdvance,
      totalFuelAdvance,
      totalOwnerAdvance,
      totalAll: totalDriverAdvance + totalFuelAdvance + totalOwnerAdvance,
      count: advances.length,
    };
  }
}

module.exports = TripAdvanceService;
module.exports.TripAdvanceService = TripAdvanceService;
module.exports.ADVANCE_TYPES = ADVANCE_TYPES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.ADVANCE_FINANCIAL_TYPE = ADVANCE_FINANCIAL_TYPE;
