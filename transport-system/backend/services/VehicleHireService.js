/**
 * VehicleHireService
 * ---------------------------------------------------------------------------
 * THE canonical vehicle-hire record for Bihar Transport. One implementation,
 * one set of numbers, one place the arithmetic happens.
 *
 * THE RELATIONSHIP IT REPRESENTS
 *   TRIP  →  VEHICLE  →  VEHICLE OWNER / VENDOR  →  DRIVER
 *   A `Trip` already owns all four (vehicle_id, transport_owner_id, driver_id,
 *   user_id/client_id) plus the freight. There is no separate "hire" table in
 *   this repository and none is introduced: the Trip IS the hire record, and
 *   the commercial terms of that hire live on the Trip row
 * (billing_to / business_model / rate_basis / commission_type /
 * commission_percentage). This service only READS and COMPUTES it.
 *
 * THE ARITHMETIC (server-authoritative, always)
 *      GROSS VEHICLE HIRE          = Trip.freight_amount
 *    − COMMISSION                  = CommissionCalculator
 *    ─────────────────────────────────────────────
 *    = NET VENDOR PAYABLE
 *
 *   Worked examples, all produced by this service:
 *     gross 42,000 · 5%      → commission 2,100 → net 39,900
 *     gross 42,000 · fixed 2,000 → commission 2,000 → net 40,000
 *     gross 42,000 · 0%      → commission     0 → net 42,000
 *
 * GROSS IS NEVER OVERWRITTEN BY NET.
 *   `freight_amount` is the single stored gross and nothing in this codebase
 *   writes a net figure back into it. Net is DERIVED on every read, so the
 *   identity `gross − commission === net` is true for every trip — historical
 *   and new — by construction rather than by discipline.
 *
 * COMMISSION IS NEVER TRUSTED FROM A BROWSER.
 *   There is no column a client can post `commission_amount` or
 *   `net_vendor_payable` into. The only client-supplied inputs are the TERMS
 *   (rate + type), and the amount is always computed here from the persisted
 *   gross. `computeCommissionAmount()` validates those terms before using them.
 *
 * REUSES, DOES NOT DUPLICATE
 *   The money maths is delegated to services/CommissionCalculator.js — the
 *   single existing calculator — and the rate default to
 *   config/commissionPolicy.js. No second commission calculator exists here.
 *
 * HIRE IS NOT PAYMENT (Phase 2 separation)
 *   Nothing in this file writes a payment, an advance or a settlement, and
 *   creating/updating a hire never marks a vendor as paid. Money movement
 *   lives exclusively in FinancialTransaction / TripAdvance / TripSettlement /
 *   PartnerLedger, which this service only READS through
 *   `buildVehicleHire()`'s optional `payments` summary.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const CommissionCalculator = require('./CommissionCalculator');
const commissionPolicy = require('../config/commissionPolicy');
const { ValidationError, NotFoundError } = require('../utils/AppError');

/**
 * Canonical vocabularies. These mirror the Prisma enums exactly.
 *
 * `BILLING_TO` and `BUSINESS_MODEL` are new — no prior implementation existed.
 * `RATE_BASIS` deliberately REUSES the rate catalogue the booking form already
 * ships (frontend/src/utils/bookingForm.js → RATE_AS_PER_OPTIONS) rather than
 * inventing a parallel list, so a hire stored from the booking form and a hire
 * stored from the trip form can never disagree. `FIXED` is that catalogue's
 * "quotes the whole trip" mode, i.e. the per-trip basis.
 */
const BILLING_TO = Object.freeze(['CONSIGNOR', 'CONSIGNEE', 'THIRD_PARTY', 'VEHICLE_VENDOR']);
const BUSINESS_MODEL = Object.freeze(['COMMISSION', 'CONTRACT']);
const RATE_BASIS = Object.freeze(['FIXED', 'PER_TON', 'PER_KG', 'PER_DAY', 'MONTHLY']);

/**
 * Round to paise, absorbing binary-float drift.
 * Matches the money convention already used by CommissionCalculator and by
 * frontend/src/utils/bookingForm.js → roundMoney, so the same rupee value
 * produces the same rupee everywhere in the system.
 * @param {number} amount
 * @returns {number}
 */
function roundMoney(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

class VehicleHireService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
  }

  // =========================================================================
  // VALIDATION OF THE COMMERCIAL TERMS
  // =========================================================================

  /**
   * Validate a client-supplied patch of hire terms.
   *
   * Only the KEYS PRESENT are validated, so a partial PATCH is legal. An
   * absent key means "leave the stored value alone" — it is never reset to a
   * default, because a default would be an invented fact about a hire.
   *
   * The SAME column, `commission_percentage`, carries two different kinds of
   * value depending on the commission type — a percentage when the type is
   * 'percentage', and an absolute rupee amount when the type is 'fixed'. That
   * mirrors `CommissionRecord`, which stores the rupee figure in
   * `commission_rate` for a fixed deal. So the 0–100 ceiling may only be
   * applied when the value really is a percentage. `existingType` lets a
   * caller supply the trip's currently-stored type so a PATCH that changes
   * only the amount is judged against the right rule.
   *
   * @param {Object} input - raw request body slice
   * @param {{commission_type?: string|null}} [context] - the terms already
   *        stored on the row, used to interpret a bare amount PATCH
   * @returns {Object} a clean object containing ONLY the validated keys
   * @throws {ValidationError}
   */
  validateHireTerms(input = {}, context = {}) {
    const patch = {};

    if (input.billing_to !== undefined && input.billing_to !== null && input.billing_to !== '') {
      const value = String(input.billing_to).toUpperCase();
      if (!BILLING_TO.includes(value)) {
        throw new ValidationError(
          `Invalid billing_to "${input.billing_to}". Expected one of: ${BILLING_TO.join(', ')}`
        );
      }
      patch.billing_to = value;
    }

    if (input.business_model !== undefined && input.business_model !== null && input.business_model !== '') {
      const value = String(input.business_model).toUpperCase();
      if (!BUSINESS_MODEL.includes(value)) {
        throw new ValidationError(
          `Invalid business_model "${input.business_model}". Expected one of: ${BUSINESS_MODEL.join(', ')}`
        );
      }
      patch.business_model = value;
    }

    if (input.rate_basis !== undefined && input.rate_basis !== null && input.rate_basis !== '') {
      const value = String(input.rate_basis).toUpperCase();
      if (!RATE_BASIS.includes(value)) {
        throw new ValidationError(
          `Invalid rate_basis "${input.rate_basis}". Expected one of: ${RATE_BASIS.join(', ')}`
        );
      }
      patch.rate_basis = value;
    }

    if (input.commission_type !== undefined && input.commission_type !== null && input.commission_type !== '') {
      const value = String(input.commission_type).toLowerCase();
      if (!CommissionCalculator.SUPPORTED_TYPES.includes(value)) {
        throw new ValidationError(
          `Invalid commission_type "${input.commission_type}". Expected one of: ${CommissionCalculator.SUPPORTED_TYPES.join(', ')}`
        );
      }
      patch.commission_type = value;
    }

    if (input.commission_percentage !== undefined && input.commission_percentage !== null && input.commission_percentage !== '') {
      const value = Number(input.commission_percentage);
      if (!Number.isFinite(value) || value < 0) {
        throw new ValidationError(
          `Invalid commission_percentage "${input.commission_percentage}" (expected a number >= 0)`
        );
      }
      // The type the stored value will actually be judged under: the one in
      // this payload if given, otherwise the one already on the row,
      // otherwise the policy default.
      const effectiveType = patch.commission_type
        || (context.commission_type ? String(context.commission_type).toLowerCase() : null)
        || commissionPolicy.DEFAULT_COMMISSION_TYPE;

      if (effectiveType === 'percentage' && value > 100) {
        throw new ValidationError(
          `Invalid commission_percentage ${value}% (percentage must be between 0 and 100)`
        );
      }
      patch.commission_percentage = value;
    }

    return patch;
  }

  // =========================================================================
  // THE CALCULATION
  // =========================================================================

  /**
   * Resolve which commission rate applies to a hire, and from where.
   *
   * Precedence:
   *   1. `commission_type = 'fixed'`      → the RATE ITSELF is the rupee
   *                                        commission, read from
   *                                        commission_percentage (the column
   *                                        CommissionRecord already reuses
   *                                        for `commission_rate`).
   *   2. `commission_percentage` present → that per-trip percentage.
   *   3. neither recorded                → config/commissionPolicy.js
   *                                        (the existing business default).
   *
   * @param {Object} hire - a Trip row (or Trip-shaped object)
   * @returns {{rate:number, type:string, source:string}}
   */
  resolveCommissionTerms(hire = {}) {
    const type = hire.commission_type
      ? String(hire.commission_type).toLowerCase()
      : commissionPolicy.DEFAULT_COMMISSION_TYPE;

    const hasRate = hire.commission_percentage !== null && hire.commission_percentage !== undefined;

    if (type === 'fixed') {
      // A fixed commission is an absolute amount. An unrecorded fixed amount is
      // ₹0 — zero commission — not a guess at some historical rate.
      return {
        rate: hasRate ? Number(hire.commission_percentage) : 0,
        type,
        source: hasRate ? 'trip_fixed' : 'trip_fixed_default_zero',
      };
    }

    if (hasRate) {
      return { rate: Number(hire.commission_percentage), type, source: 'trip_percentage' };
    }

    return {
      rate: commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE,
      type,
      source: 'policy_default',
    };
  }

  /**
   * Compute the hire's money, server-side, from the persisted gross.
   *
   * VALIDATION (per Phase 2):
   *   • gross must be a finite number >= 0
   *   • rate must be a finite number >= 0
   *   • a percentage rate must be <= 100
   *   • commission must not exceed gross — otherwise `gross − commission`
   *     would be negative and the identity the whole module rests on
   *     (gross − commission = net) would not hold. This is rejected loudly
   *     rather than silently clamped, because silently clamping would report a
   *     commission the vendor never agreed to.
   *
   * @param {Object} params
   * @param {number} params.grossHire
   * @param {number} [params.rate]
   * @param {string} [params.type]
   * @returns {{grossHire:number, commissionAmount:number, netVendorPayable:number,
   *            commissionRate:number, commissionType:string, commissionSource:string}}
   * @throws {ValidationError}
   */
  computeCommissionAmount({ grossHire, rate, type } = {}) {
    const gross = Number(grossHire);
    if (!Number.isFinite(gross) || gross < 0) {
      throw new ValidationError(
        `Invalid gross vehicle hire "${grossHire}" (expected a number >= 0)`
      );
    }

    const resolvedType = type === undefined || type === null
      ? commissionPolicy.DEFAULT_COMMISSION_TYPE
      : String(type).toLowerCase();

    if (!CommissionCalculator.SUPPORTED_TYPES.includes(resolvedType)) {
      throw new ValidationError(
        `Invalid commission_type "${type}". Expected one of: ${CommissionCalculator.SUPPORTED_TYPES.join(', ')}`
      );
    }

    const resolvedRate = rate === undefined || rate === null
      ? commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE
      : Number(rate);

    if (!Number.isFinite(resolvedRate) || resolvedRate < 0) {
      throw new ValidationError(
        `Invalid commission rate "${rate}" (expected a number >= 0)`
      );
    }
    if (resolvedType === 'percentage' && resolvedRate > 100) {
      throw new ValidationError(
        `Invalid commission rate ${resolvedRate}% (percentage must be between 0 and 100)`
      );
    }

    // The existing calculator owns the maths. This service owns the hire.
    const commissionAmount = CommissionCalculator.computeCommission({
      base: gross,
      rate: resolvedRate,
      type: resolvedType,
    });

    if (commissionAmount > gross) {
      throw new ValidationError(
        `Commission ₹${commissionAmount} cannot exceed the gross vehicle hire ₹${gross}`
      );
    }

    const netVendorPayable = roundMoney(gross - commissionAmount);

    return {
      grossHire: roundMoney(gross),
      commissionAmount: roundMoney(commissionAmount),
      netVendorPayable,
      commissionRate: resolvedRate,
      commissionType: resolvedType,
    };
  }

  // =========================================================================
  // THE HIRE RECORD
  // =========================================================================

  /**
   * Build the complete vehicle-hire record for a Trip-shaped object.
   * Pure: no database access, so it is directly unit-testable and safe to call
   * from any read path.
   *
   * @param {Object} trip - a Trip row, ideally with vehicle/transportOwner/
   *                         driver/user/client/booking relations loaded
   * @param {{payments?: Object}} [opts] - optional read-only payment summary,
   *        kept strictly separate from the hire calculation
   * @returns {Object} the canonical hire payload
   */
  buildVehicleHire(trip, opts = {}) {
    if (!trip) throw new NotFoundError('Trip not found');

    const grossHire = Number(trip.freight_amount) || 0;
    const terms = this.resolveCommissionTerms(trip);
    const money = this.computeCommissionAmount({
      grossHire,
      rate: terms.rate,
      type: terms.type,
    });

    const vehicle = trip.vehicle || null;
    const vendor = trip.transportOwner || null;
    const driver = trip.driver || null;
    const customer = trip.client || trip.user || null;

    return {
      // ── Hire identity ──────────────────────────────────────────────
      trip_id: trip.trip_id ?? null,
      trip_number: trip.trip_number ?? null,
      booking_id: trip.booking_id ?? null,
      source_type: trip.source_type ?? null,
      status: trip.status ?? null,

      // ── Trip context (never invented) ──────────────────────────────
      trip_date: trip.trip_date ?? null,
      pickup_location: trip.pickup_location ?? null,
      pickup_city: trip.pickup_city ?? null,
      drop_location: trip.drop_location ?? null,
      drop_city: trip.drop_city ?? null,

      // ── Customer ───────────────────────────────────────────────────
      customer: customer
        ? {
            user_id: trip.client_id ?? null,
            client_id: trip.client_id ?? null,
            name: customer.company_name
              || [customer.first_name, customer.last_name].filter(Boolean).join(' ')
              || null,
          }
        : null,

      // ── Vehicle ────────────────────────────────────────────────────
      vehicle: vehicle
        ? {
            vehicle_id: vehicle.vehicle_id,
            vehicle_number: vehicle.vehicle_number ?? null,
            vehicle_type: vehicle.vehicle_type ?? null,
            vehicle_name: vehicle.vehicle_name ?? null,
          }
        : null,

      // ── Vendor / owner ─────────────────────────────────────────────
      vendor: vendor
        ? {
            owner_id: vendor.owner_id,
            owner_name: vendor.owner_name ?? null,
            owner_type: vendor.owner_type ?? null,
            mobile: vendor.mobile ?? null,
          }
        : null,

      // ── Driver ─────────────────────────────────────────────────────
      driver: driver
        ? {
            driver_id: driver.driver_id,
            driver_name: driver.driver_name ?? null,
            mobile: driver.mobile ?? null,
          }
        : null,

      // ── Commercial terms (stored, never inferred) ───────────────────
      billing_to: trip.billing_to ?? null,
      business_model: trip.business_model ?? null,
      rate_basis: trip.rate_basis ?? null,

      // ── Money (computed, never trusted from a client) ──────────────
      ...money,
      commission_source: terms.source,

      // ── Payment status: a SEPARATE concern ─────────────────────────
      // Creating or reading a hire never implies money moved. These are
      // whatever the existing ledger says, or zero when nothing was recorded.
      payments: {
        ...(opts.payments || {}),
        // Explicit statement of the separation, so no caller can mistake a
        // hire for a settlement.
        settled: Boolean(opts.payments && opts.payments.settled),
      },
    };
  }

  /**
   * Load one trip and return its canonical vehicle-hire record.
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getVehicleHire(tripId) {
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      include: {
        vehicle: {
          select: {
            vehicle_id: true, vehicle_number: true, vehicle_type: true, vehicle_name: true,
          },
        },
        transportOwner: {
          select: { owner_id: true, owner_name: true, owner_type: true, mobile: true },
        },
        driver: { select: { driver_id: true, driver_name: true, mobile: true } },
        user: { select: { user_id: true, first_name: true, last_name: true } },
        client: { select: { client_id: true, company_name: true } },
      },
    });

    if (!trip) throw new NotFoundError('Trip not found');

    return this.buildVehicleHire(trip);
  }
}

module.exports = VehicleHireService;
module.exports.VehicleHireService = VehicleHireService;
module.exports.BILLING_TO = BILLING_TO;
module.exports.BUSINESS_MODEL = BUSINESS_MODEL;
module.exports.RATE_BASIS = RATE_BASIS;
module.exports.roundMoney = roundMoney;
