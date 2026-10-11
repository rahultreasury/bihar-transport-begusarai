/**
 * TripSettlementService
 * ---------------------------------------------------------------------------
 * SETTLEMENT SEMANTICS IN THIS REPOSITORY (documented before changing it)
 * =========================================================================
 * There are two different "settlement" records and they are NOT interchangeable:
 *
 * 1. `TripSettlement`  (per trip, per party) — this service.
 *    `driver_settlement_amount` / `owner_settlement_amount` is MONEY ACTUALLY
 *    PAID to that party, and `recordDriverSettlement` /
 *    `recordOwnerSettlement` write a matching `FinancialTransaction`
 *    (`DRIVER_SETTLEMENT` / `OWNER_SETTLEMENT`, direction DEBIT). So a
 *    settlement here is a REAL CASH MOVEMENT, not a reconciliation mark.
 *
 * 2. `Settlement` (Partner module, monthly) — an ACCOUNTING RECONCILIATION of
 *    a partner's month. `amount_paid` there is a carried figure, and
 *    routes/partnerSelfServiceRoutes.js explicitly refuses to present it as an
 *    actual. Phase 3 does not touch it.
 *
 * Because a `TripSettlement` IS the payment, it must never silently duplicate
 * one. Two guarantees here:
 *   • exactly ONE canonical `FinancialTransaction` is written per accepted
 *     settlement request — no `TripPayment` row, no second transaction type;
 *   • a retried request carrying the same `reference_number` returns the
 *     original instead of moving money again (idempotency, STEP 11).
 *
 * WHAT SETTLEMENT DOES NOT TOUCH
 *   Recording a settlement never writes `Trip.freight_amount` (gross hire),
 *   never writes a commission, and never writes a net figure. The hire stays
 *   exactly where Phase 2 put it and only the outstanding balance moves.
 *
 * PARTIAL PAYMENTS
 *   `*_settlement_amount` is the CUMULATIVE amount settled so far, and
 *   `*_settlement_status` is judged against the outstanding balance AFTER this
 *   payment. Before Phase 3 each request overwrote the amount with the latest
 *   payment and judged the status against the balance from BEFORE it, so a
 *   sequence of partial payments lost both the total and the true status.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripSettlementRepository = require('../repositories/TripSettlementRepository');
const TripTransactionService = require('./TripTransactionService');
const VendorLedgerService = require('./VendorLedgerService');
const CanonicalFinancialService = require('./CanonicalFinancialService');
const AuditLogRepository = require('../repositories/AuditLogRepository');

/**
 * Payment methods the repository already stores on
 * `TripSettlement.*_settlement_payment_method` and
 * `FinancialTransaction.payment_method`. These are free-text columns
 * everywhere else, so the existing vocabulary is accepted and NO new enum is
 * introduced.
 */
const PAYMENT_METHODS = Object.freeze(['cash', 'bank', 'bank_transfer', 'upi', 'cheque', 'other']);

class TripSettlementService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   */
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripSettlementRepo = new TripSettlementRepository();
    this.tripTransactionService = new TripTransactionService(options);
    this.vendorLedgerService = new VendorLedgerService(options);
    this.canonicalFinancialService = new CanonicalFinancialService(options);
    this.auditRepo = new AuditLogRepository();
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Validate the client-supplied part of a settlement.
   *
   * Only the amount, how it was paid and a reference are accepted. The payable
   * it is measured against is always calculated by the server from the Trip —
   * a posted `owner_payable` / `net_vendor_payable` is ignored.
   *
   * @param {Object} data
   * @returns {{amount:number, payment_method:string,
   *            reference_number:(string|null), notes:(string|null),
   *            paidAt:Date}}
   * @throws {ValidationError}
   */
  validateSettlement(data = {}) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }

    const paymentMethod = String(data.payment_method || 'cash').toLowerCase();
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      throw new ValidationError(
        `Invalid payment_method "${data.payment_method}". Expected one of: ${PAYMENT_METHODS.join(', ')}`
      );
    }

    const rawDate = data.settlement_date || data.paid_at || data.payment_date;
    let paidAt = new Date();
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`Invalid settlement date "${rawDate}"`);
      }
      paidAt = parsed;
    }

    return {
      amount,
      payment_method: paymentMethod,
      reference_number: data.reference_number || data.reference || null,
      notes: data.notes || null,
      paidAt,
    };
  }

  /**
   * Status of a party after a settlement, from the balance that will REMAIN.
   * Mirrors the repository's existing `PaymentStatus` vocabulary.
   *
   * @param {number} remainingAfter
   * @returns {'PAID'|'PARTIAL'}
   */
  _statusFromRemaining(remainingAfter) {
    return remainingAfter <= 0 ? 'PAID' : 'PARTIAL';
  }

  // =========================================================================
  // TRIP-SCOPED SETTLEMENTS (what the UI calls)
  // =========================================================================

  /**
   * Record a payment to the trip's VENDOR / transport owner.
   *
   * @param {number} tripId
   * @param {Object} settlementData
   * @param {Object|null} admin
   * @returns {Promise<Object>} the TripSettlement row
   */
  async recordOwnerSettlementByTripId(tripId, settlementData, admin = null) {
    const input = this.validateSettlement(settlementData);

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      select: {
        trip_id: true, booking_id: true, trip_number: true,
        driver_id: true, vehicle_id: true, transport_owner_id: true,
      },
    });
    if (!trip) throw new NotFoundError('Trip not found');

    // ── Idempotency: a retried request must not move money twice ──────────
    if (input.reference_number) {
      const existingTx = await this.prisma.financialTransaction.findFirst({
        where: {
          trip_id: trip.trip_id,
          transaction_type: 'OWNER_SETTLEMENT',
          reference_number: input.reference_number,
        },
      });
      if (existingTx) {
        const existing = await this.tripSettlementRepo.findOrCreateByTripId(
          trip.trip_id,
          existingTx.trip_financial_id,
          this.prisma
        );
        return { ...existing, already_recorded: true };
      }
    }

    // ── Authoritative outstanding, calculated by the server ───────────────
    const position = await this.vendorLedgerService.getOwnerPosition(trip.trip_id);
    const outstandingBefore = position.outstanding;

    // Existing rule, preserved: this repository REJECTS overpayment rather
    // than carrying a credit balance with the vendor.
    if (input.amount > outstandingBefore) {
      throw new ValidationError(
        `Settlement amount (₹${input.amount}) exceeds the outstanding vendor payable (₹${outstandingBefore})`
      );
    }

    const outstandingAfter = Math.max(0, outstandingBefore - input.amount);
    const newStatus = this._statusFromRemaining(outstandingAfter);

    const result = await this.prisma.$transaction(async (tx) => {
      let tripFinancial = await this.tripFinancialRepo.findByTripId(trip.trip_id, tx);
      if (!tripFinancial) {
        tripFinancial = await this.tripFinancialRepo.findOrCreateByTripId(trip.trip_id, tx);
      }

      const settlement = await this.tripSettlementRepo.findOrCreateByTripId(
        trip.trip_id,
        tripFinancial.trip_financial_id,
        tx
      );

      // Cumulative, never "the last payment".
      const cumulative = Number(settlement.owner_settlement_amount || 0) + input.amount;

      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        owner_settlement_amount: cumulative,
        owner_settlement_status: newStatus,
        owner_settlement_paid_at: input.paidAt,
        owner_settlement_payment_method: input.payment_method,
        owner_settlement_reference: input.reference_number,
        owner_settlement_notes: input.notes,
      }, tx);

      await this.tripTransactionService.createOwnerSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: trip.trip_id,
          vehicle_id: trip.vehicle_id,
          transport_owner_id: trip.transport_owner_id,
          amount: input.amount,
          payment_method: input.payment_method,
          reference_number: input.reference_number,
          transaction_date: input.paidAt,
          notes: input.notes || 'Owner Settlement',
          created_by: admin?.user_id || null,
        },
        tx
      );

      await this.auditRepo.create(
        {
          user_id: admin?.user_id || null,
          user_role: admin?.role || 'system',
          action: 'owner_settlement_recorded',
          entity_type: 'TripSettlement',
          entity_id: updated.settlement_id,
          new_value: JSON.stringify({
            amount: input.amount,
            cumulative,
            status: newStatus,
            payment_method: input.payment_method,
            outstanding_after: outstandingAfter,
          }),
          reason: input.notes || null,
        },
        tx
      );

      return updated;
    });

    return result;
  }

  /**
   * Record a payment to the trip's DRIVER.
   *
   * The driver's outstanding is read from the repository's existing canonical
   * calculation (`CanonicalFinancialService.driverDue`), so this path behaves
   * exactly as it did before Phase 3.
   *
   * @param {number} tripId
   * @param {Object} settlementData
   * @param {Object|null} admin
   * @returns {Promise<Object>}
   */
  async recordDriverSettlementByTripId(tripId, settlementData, admin = null) {
    const input = this.validateSettlement(settlementData);

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      select: {
        trip_id: true, booking_id: true, trip_number: true,
        driver_id: true, vehicle_id: true, transport_owner_id: true,
      },
    });
    if (!trip) throw new NotFoundError('Trip not found');

    if (input.reference_number) {
      const existingTx = await this.prisma.financialTransaction.findFirst({
        where: {
          trip_id: trip.trip_id,
          transaction_type: 'DRIVER_SETTLEMENT',
          reference_number: input.reference_number,
        },
      });
      if (existingTx) {
        const existing = await this.tripSettlementRepo.findOrCreateByTripId(
          trip.trip_id,
          existingTx.trip_financial_id,
          this.prisma
        );
        return { ...existing, already_recorded: true };
      }
    }

    const financials = await this.canonicalFinancialService.calculateTripFinancials(trip.trip_id);
    const outstandingBefore = financials.driverDue || 0;

    if (input.amount > outstandingBefore) {
      throw new ValidationError(
        `Settlement amount (₹${input.amount}) exceeds the remaining driver due (₹${outstandingBefore})`
      );
    }

    const outstandingAfter = Math.max(0, outstandingBefore - input.amount);
    const newStatus = this._statusFromRemaining(outstandingAfter);

    return await this.prisma.$transaction(async (tx) => {
      let tripFinancial = await this.tripFinancialRepo.findByTripId(trip.trip_id, tx);
      if (!tripFinancial) {
        tripFinancial = await this.tripFinancialRepo.findOrCreateByTripId(trip.trip_id, tx);
      }

      const settlement = await this.tripSettlementRepo.findOrCreateByTripId(
        trip.trip_id,
        tripFinancial.trip_financial_id,
        tx
      );

      const cumulative = Number(settlement.driver_settlement_amount || 0) + input.amount;

      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, {
        driver_settlement_amount: cumulative,
        driver_settlement_status: newStatus,
        driver_settlement_paid_at: input.paidAt,
        driver_settlement_payment_method: input.payment_method,
        driver_settlement_reference: input.reference_number,
        driver_settlement_notes: input.notes,
      }, tx);

      await this.tripTransactionService.createDriverSettlement(
        {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: trip.trip_id,
          vehicle_id: trip.vehicle_id,
          driver_id: trip.driver_id,
          amount: input.amount,
          payment_method: input.payment_method,
          reference_number: input.reference_number,
          transaction_date: input.paidAt,
          notes: input.notes || 'Driver Settlement',
          created_by: admin?.user_id || null,
        },
        tx
      );

      await this.auditRepo.create(
        {
          user_id: admin?.user_id || null,
          user_role: admin?.role || 'system',
          action: 'driver_settlement_recorded',
          entity_type: 'TripSettlement',
          entity_id: updated.settlement_id,
          new_value: JSON.stringify({
            amount: input.amount,
            cumulative,
            status: newStatus,
            payment_method: input.payment_method,
            outstanding_after: outstandingAfter,
          }),
          reason: input.notes || null,
        },
        tx
      );

      return updated;
    });
  }

  // =========================================================================
  // BOOKING-SCOPED SETTLEMENTS (legacy entry points)
  // =========================================================================

  /**
   * Legacy booking-scoped owner settlement.
   *
   * Kept because callers still exist, and given the same Phase 3 treatment as
   * the trip-scoped path (server-side validation against the canonical
   * outstanding, cumulative amount, status from the remaining balance, and
   * reference idempotency). Behaviour for a caller that was within the limit is
   * unchanged.
   *
   * @param {number} bookingId
   * @param {Object} settlementData
   * @param {Object|null} admin
   * @returns {Promise<Object>}
   */
  async recordOwnerSettlement(bookingId, settlementData, admin = null) {
    return this._recordBookingSettlement(bookingId, settlementData, admin, 'owner');
  }

  /**
   * Legacy booking-scoped driver settlement. @see recordOwnerSettlement
   * @param {number} bookingId
   * @param {Object} settlementData
   * @param {Object|null} admin
   * @returns {Promise<Object>}
   */
  async recordDriverSettlement(bookingId, settlementData, admin = null) {
    return this._recordBookingSettlement(bookingId, settlementData, admin, 'driver');
  }

  /**
   * @param {'owner'|'driver'} party
   */
  async _recordBookingSettlement(bookingId, settlementData, admin, party) {
    const input = this.validateSettlement(settlementData);
    const id = Number(bookingId);

    const booking = await this.prisma.booking.findUnique({
      where: { booking_id: id },
      select: { booking_id: true, driver_id: true, vehicle_owner_id: true, vehicle_id: true },
    });
    if (!booking) throw new NotFoundError('Booking not found');

    const trip = await this.prisma.trip.findFirst({
      where: { booking_id: booking.booking_id },
      select: {
        trip_id: true, driver_id: true, vehicle_id: true,
        transport_owner_id: true, driver_payment: true,
      },
    });

    const txType = party === 'owner' ? 'OWNER_SETTLEMENT' : 'DRIVER_SETTLEMENT';

    // ── Idempotency ───────────────────────────────────────────────────────
    if (input.reference_number) {
      const existingTx = await this.prisma.financialTransaction.findFirst({
        where: {
          booking_id: booking.booking_id,
          transaction_type: txType,
          reference_number: input.reference_number,
        },
      });
      if (existingTx) {
        const existing = await this.tripSettlementRepo.findByBookingId(booking.booking_id);
        return existing
          ? { ...existing, already_recorded: true }
          : { already_recorded: true, trip_financial_id: existingTx.trip_financial_id };
      }
    }

    // ── Authoritative outstanding ─────────────────────────────────────────
    let outstandingBefore;
    if (party === 'owner' && trip) {
      outstandingBefore = (await this.vendorLedgerService.getOwnerPosition(trip.trip_id)).outstanding;
    } else {
      const tripFinancial = await this.tripFinancialRepo.findByBookingId(booking.booking_id);
      outstandingBefore = party === 'owner'
        ? Number(tripFinancial?.remaining_owner_settlement || 0)
        : Number(tripFinancial?.remaining_driver_settlement || 0);
    }

    if (input.amount > outstandingBefore) {
      const label = party === 'owner' ? 'vendor payable' : 'remaining settlement';
      throw new ValidationError(
        `Settlement amount (₹${input.amount}) exceeds the ${label} (₹${outstandingBefore})`
      );
    }

    const outstandingAfter = Math.max(0, outstandingBefore - input.amount);
    const newStatus = this._statusFromRemaining(outstandingAfter);

    return await this.prisma.$transaction(async (tx) => {
      let tripFinancial = await this.tripFinancialRepo.findByBookingId(booking.booking_id, tx);
      if (!tripFinancial) {
        tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(booking.booking_id, tx);
      }

      const settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
        booking.booking_id,
        tripFinancial.trip_financial_id,
        tx
      );

      const amountField = party === 'owner' ? 'owner_settlement_amount' : 'driver_settlement_amount';
      const cumulative = Number(settlement[amountField] || 0) + input.amount;

      const patch = {
        [`${party}_settlement_amount`]: cumulative,
        [`${party}_settlement_status`]: newStatus,
        [`${party}_settlement_paid_at`]: input.paidAt,
        [`${party}_settlement_payment_method`]: input.payment_method,
        [`${party}_settlement_reference`]: input.reference_number,
        [`${party}_settlement_notes`]: input.notes,
      };

      const updated = await this.tripSettlementRepo.update(settlement.settlement_id, patch, tx);

      const shared = {
        trip_financial_id: tripFinancial.trip_financial_id,
        booking_id: booking.booking_id,
        trip_id: trip?.trip_id || null,
        vehicle_id: trip?.vehicle_id || booking.vehicle_id || null,
        amount: input.amount,
        payment_method: input.payment_method,
        reference_number: input.reference_number,
        transaction_date: input.paidAt,
        notes: input.notes || `${party === 'owner' ? 'Owner' : 'Driver'} Settlement`,
        created_by: admin?.user_id || null,
      };

      if (party === 'owner') {
        await this.tripTransactionService.createOwnerSettlement(
          { ...shared, transport_owner_id: trip?.transport_owner_id || booking.vehicle_owner_id || null },
          tx
        );
      } else {
        await this.tripTransactionService.createDriverSettlement(
          { ...shared, driver_id: trip?.driver_id || booking.driver_id || null },
          tx
        );
      }

      await this.auditRepo.create(
        {
          user_id: admin?.user_id || null,
          user_role: admin?.role || 'system',
          action: `${party}_settlement_recorded`,
          entity_type: 'TripSettlement',
          entity_id: updated.settlement_id,
          new_value: JSON.stringify({
            amount: input.amount,
            cumulative,
            status: newStatus,
            payment_method: input.payment_method,
            outstanding_after: outstandingAfter,
          }),
          reason: input.notes || null,
        },
        tx
      );

      return updated;
    });
  }

  // =========================================================================
  // READ
  // =========================================================================

  /**
   * Settlement record + the money position behind it, for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async getSettlement(bookingId) {
    const settlement = await this.tripSettlementRepo.findByBookingId(bookingId);
    if (!settlement) return null;

    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    const trip = await this.prisma.trip.findFirst({
      where: { booking_id: Number(bookingId) },
      select: { trip_id: true },
    });

    let ownerPosition = null;
    if (trip) ownerPosition = await this.vendorLedgerService.getOwnerPosition(trip.trip_id);

    return {
      ...settlement,
      remainingDriverSettlement: tripFinancial?.remaining_driver_settlement || 0,
      remainingOwnerSettlement: tripFinancial?.remaining_owner_settlement || 0,
      ownerPosition,
    };
  }
}

module.exports = TripSettlementService;
module.exports.TripSettlementService = TripSettlementService;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
