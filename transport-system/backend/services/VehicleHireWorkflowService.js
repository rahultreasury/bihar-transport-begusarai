/**
 * VehicleHireWorkflowService
 * ---------------------------------------------------------------------------
 * THE WRITE PATH FOR THE UNIVERSAL VEHICLE HIRE PAGE.
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *
 * ONE MODULE. There is deliberately no "Contract Hire" page and no "Commission
 * Hire" page. Both models are the same screen; "Billing To" decides which one a
 * hire is, and the business model is DERIVED from it rather than chosen. That is
 * the whole reason this is a single service rather than two.
 *
 * WHAT IT REUSES (nothing here is a second implementation of anything)
 *   • services/VehicleHireService.js   — the existing canonical hire maths
 *                                        (gross − commission = net), its terms
 *                                        validation and its Trip-shaped reader.
 *   • config/vehicleHirePolicy.js      — billing→model, rate bases, commission
 *                                        types, document expiry rules, warning
 *                                        window, hire-ready / hired statuses.
 *   • services/CommissionCalculator.js  — the single commission calculator.
 *   • services/TripOperationalService.js — the existing `isVehicleUsable` /
 *                                        `isDriverUsable` readiness predicates,
 *                                        re-derived here from the same vocabulary
 *                                        rather than inventing new rules.
 *   • repositories/TripTimelineRepository + repositories/AuditLogRepository —
 *                                        the ONE history system. A hire writes
 *                                        to it; it does not create a parallel log.
 *   • Prisma models TransportVehicle / VehicleOwner / Driver / Trip / Booking —
 *                                        the existing masters, referenced by FK.
 *
 * THE THREE MONEY FIGURES ARE STORED SEPARATELY AND ALWAYS
 *       GROSS VEHICLE HIRE   −   COMMISSION   =   NET VENDOR PAYABLE
 *   `gross_hire` is never overwritten with the net. PostgreSQL enforces the
 *   identity too (migration 20260930120100), so the service and the database
 *   cannot disagree.
 *
 * HIRE IS NOT PAYMENT
 *   Nothing in this file writes a FinancialTransaction, a TripAdvance or a
 *   TripSettlement, and nothing marks a vendor as paid. Hiring a vehicle creates
 *   an OBLIGATION; the money leaves later through the existing payment system.
 *   Partial payments therefore work with no special support here: whatever the
 *   ledger later records is simply a settlement of the net payable.
 *
 * ATOMIC
 *   The hire row, the Trip status transition, the commercial-terms write-back,
 *   the timeline event and the audit entry all commit in one transaction. A
 *   hire can therefore never exist for a trip whose status never moved, and a
 *   status change can never land without its history.
 *
 * SERVER-AUTHORITATIVE
 *   The client never sends `gross_hire`, `commission_amount` or
 *   `net_vendor_payable`. It sends the rate INPUTS; this service computes the
 *   three money figures from those inputs and the stored rate basis.
 */

'use strict';

const { prisma: defaultPrisma } = require('../config/prisma');
const VehicleHireService = require('./VehicleHireService');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const policy = require('../config/vehicleHirePolicy');
const tripStateMachine = require('../utils/TripStateMachine');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/AppError');
// The EXISTING availability / conflict rules, reused for the "vacant first"
// ordering of the selectors. The overlap maths below is the SAME maths that
// decides whether an assignment is permitted, so the screen can never offer a
// resource the assignment endpoint would reject.
const {
  pickupWindow,
  tripWindow,
  rangesOverlap,
  ACTIVE_TRIP_STATUSES,
  ENQUIRY_HOLD_STATUSES,
} = require('./EnquiryAssignmentService');
const { rankResources } = require('../utils/resourceAvailability');

const hireService = new VehicleHireService();
const { roundMoney } = VehicleHireService;

/* ══════════════════════════════════════════════════════════════════════════
   DATE HANDLING FOR VEHICLE DOCUMENTS
   ─────────────────────────────────────────────────────────────────────────
   `transport_vehicles` stores every document date as TEXT — that is the
   pre-existing type on insurance_expiry / permit_expiry / pollution_expiry, and
   the three columns Phase 8 added follow it deliberately so one concept has one
   parser. Operators have historically entered these in several formats
   ("2027-04-30", "30-04-2027", "30/04/2027", "2027-04-30T00:00:00.000Z"), so
   the parser accepts all of them. An unparseable value is reported as
   "not recorded" rather than silently treated as valid — inventing a date for a
   certificate the business never entered would let a truck with unknown papers
   pass the hire gate.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a stored vehicle-document date.
 * @param {*} value
 * @returns {Date|null} null when absent or unparseable
 */
function parseDocumentDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const text = String(value).trim();

  // A document expiry is a CALENDAR DATE, not an instant. Date-only values are
  // therefore anchored at UTC midnight, so the date that comes back out is
  // exactly the date that went in. Building them at local midnight instead
  // would shift the day backwards by one in any timezone ahead of UTC — in
  // IST (UTC+5:30) a stored "2027-04-30" would export as 2027-04-29.
  //
  // A value that DOES carry a time ("2027-04-30T18:45:00Z") is a real instant
  // and is parsed as such, unchanged.
  //
  // ISO-ish: 2027-04-30 and 2027-04-30T00:00:00(.000)Z
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (iso) {
    const [, y, m, d, hh, mm, ss] = iso;
    const parsed = hh === undefined
      ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
      : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss) || 0);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // Indian convention: 30-04-2027 or 30/04/2027
  const indian = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (indian) {
    const [, d, m, y] = indian;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Whole days from today to `date`, negative once the date has passed.
 * @param {Date} date
 * @param {Date} now
 * @returns {number}
 */
function daysUntil(date, now) {
  // Both sides are read through the UTC accessors, matching the UTC anchoring
  // `parseDocumentDate` uses for date-only values. Mixing UTC-anchored dates
  // with local calendar days would report "expires tomorrow" as expired in any
  // timezone behind UTC.
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfTarget = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/* ══════════════════════════════════════════════════════════════════════════
   READINESS PREDICATES
   ─────────────────────────────────────────────────────────────────────────
   Same vocabulary TripOperationalService already uses for dispatch readiness:
   neither `TransportVehicle` nor `Driver` has an `is_active` column, so
   availability is `is_available` plus `current_status` / `status`. Reusing the
   words means the hire gate and the dispatch gate cannot disagree about what
   "usable" means.
   ══════════════════════════════════════════════════════════════════════════ */

/** Vehicle statuses that are NOT off the road for a new hire. */
const VEHICLE_OFF_ROAD_STATUSES = Object.freeze(['off_road', 'maintenance', 'inactive']);

/** Driver statuses that mean the driver is retired. */
const DRIVER_INACTIVE_STATUSES = Object.freeze(['inactive', 'suspended', 'retired']);

/**
 * @param {Object|null} vehicle
 * @returns {{usable:boolean, reason:string|null}}
 */
function checkVehicleUsable(vehicle) {
  if (!vehicle) return { usable: false, reason: 'Vehicle was not found' };

  if (vehicle.is_available === false) {
    return { usable: false, reason: `Vehicle ${vehicle.vehicle_number} is marked not available` };
  }

  const status = String(vehicle.current_status || '').toLowerCase();
  if (VEHICLE_OFF_ROAD_STATUSES.includes(status)) {
    return {
      usable: false,
      reason: `Vehicle ${vehicle.vehicle_number} is ${status.replace('_', ' ')} and cannot be hired`,
    };
  }

  return { usable: true, reason: null };
}

/**
 * @param {Object|null} driver
 * @returns {{usable:boolean, reason:string|null}}
 */
function checkDriverUsable(driver) {
  if (!driver) return { usable: false, reason: 'Driver was not found' };

  if (driver.is_available === false) {
    return { usable: false, reason: `Driver ${driver.driver_name} is marked not available` };
  }

  const status = String(driver.status || '').toLowerCase();
  if (DRIVER_INACTIVE_STATUSES.includes(status)) {
    return {
      usable: false,
      reason: `Driver ${driver.driver_name} is ${status} and cannot be assigned`,
    };
  }

  return { usable: true, reason: null };
}

/**
 * Is this driver already committed to another ACTIVE trip?
 *
 * This is the existing conflict check the repository already relies on
 * (TripService's ACTIVE_TRIP_STATUSES double-booking protection), applied here
 * to the HIRE gate. A driver already carrying a live consignment cannot be
 * engaged on a second one, and a vehicle already on the road cannot be hired
 * for another trip. The trip being hired is excluded, so re-entering the page
 * for the same trip is not a self-conflict.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {Object} params
 * @returns {Promise<{vehicle_conflict:Object|null, driver_conflict:Object|null}>}
 */
async function findActiveTripConflicts(client, { vehicleId, driverId, excludeTripId }) {
  const activeStatuses = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'];

  const [vehicleConflict, driverConflict] = await Promise.all([
    client.trip.findFirst({
      where: {
        vehicle_id: vehicleId,
        status: { in: activeStatuses },
        ...(excludeTripId ? { trip_id: { not: excludeTripId } } : {}),
      },
      select: { trip_id: true, trip_number: true, status: true },
    }),
    client.trip.findFirst({
      where: {
        driver_id: driverId,
        status: { in: activeStatuses },
        ...(excludeTripId ? { trip_id: { not: excludeTripId } } : {}),
      },
      select: { trip_id: true, trip_number: true, status: true },
    }),
  ]);

  return { vehicleConflict, driverConflict };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SERVICE
   ══════════════════════════════════════════════════════════════════════════ */

class VehicleHireWorkflowService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
  }

  // =========================================================================
  // VEHICLE DOCUMENT EXPIRY
  // =========================================================================

  /**
   * Evaluate every tracked vehicle document against today and the configured
   * warning window (config/vehicleHirePolicy.DOCUMENT_WARNING_DAYS).
   *
   *   EXPIRED       — the date is in the past
   *   EXPIRING_SOON — still valid, but inside the warning window
   *   VALID         — valid beyond the warning window
   *   NOT_RECORDED  — the master has no date. Never counted as valid.
   *
   * Pure: no database access, so the gate and the page read the same answer.
   *
   * @param {Object} vehicle - a TransportVehicle row
   * @param {Date} [now]
   * @returns {{documents:Array, worst:Object|null, expired_critical:Array,
   *            expiring_soon:Array, has_blocking_issue:boolean}}
   */
  evaluateDocuments(vehicle, now = new Date()) {
    const documents = policy.VEHICLE_DOCUMENTS.map((doc) => {
      const rawExpiry = vehicle ? vehicle[doc.expiryField] : null;
      const rawNumber = vehicle ? vehicle[doc.numberField] : null;
      const parsed = parseDocumentDate(rawExpiry);
      const days = parsed === null ? null : daysUntil(parsed, now);

      let status = 'NOT_RECORDED';
      if (parsed !== null) {
        if (days < 0) status = 'EXPIRED';
        else if (days <= policy.DOCUMENT_WARNING_DAYS) status = 'EXPIRING_SOON';
        else status = 'VALID';
      }

      // NATIONAL_PERMIT is critical only when the vehicle actually holds one —
      // an intra-state truck does not need one, and an absent permit must not
      // read as an expired permit.
      const critical =
        doc.critical === 'conditional'
          ? Boolean(rawNumber) || Boolean(parsed)
          : Boolean(doc.critical);

      const blocking = critical && status === 'EXPIRED';

      return {
        key: doc.key,
        label: doc.label,
        document_number: rawNumber || null,
        expiry_raw: rawExpiry || null,
        expiry_date: parsed ? parsed.toISOString() : null,
        days_remaining: days,
        status,
        critical,
        blocking,
      };
    });

    const RANK = { EXPIRED: 3, EXPIRING_SOON: 2, VALID: 1, NOT_RECORDED: 0 };
    const worst = documents.reduce(
      (acc, doc) => (RANK[doc.status] > RANK[acc.status] ? doc : acc),
      { status: 'NOT_RECORDED' }
    );

    const expired_critical = documents.filter((d) => d.blocking);
    const expiring_soon = documents.filter((d) => d.status === 'EXPIRING_SOON');

    return {
      documents,
      worst: worst.status === 'NOT_RECORDED' ? null : worst,
      expired_critical,
      expiring_soon,
      has_blocking_issue: expired_critical.length > 0,
      warning_days: policy.DOCUMENT_WARNING_DAYS,
    };
  }

  // =========================================================================
  // THE ARITHMETIC
  // =========================================================================

  /**
   * Turn the operator's rate INPUTS into the gross vehicle hire.
   *
   * Per config/vehicleHirePolicy.RATE_BASIS_OPTIONS, each basis is one of
   * three modes:
   *   RATE           gross = rate                       (Per Trip, Transport Commission)
   *   RATE_QUANTITY  gross = rate × quantity            (Per Ton, Per Kg, Per Day, Monthly)
   *   NET            the operator enters the NET payable and the gross is SOLVED
   *                  so that gross − commission = net exactly (Net Freight)
   *
   * Worked example (Per Ton): rate 5,000 × 8 Ton = 40,000.
   *
   * @param {{rateBasis:string, rate:*, quantity:*, commissionType?:string,
   *          commissionRate?:*}} input
   * @returns {{rate_basis:string, mode:string, rate:number, quantity:number|null,
   *            unit:string|null, rate_label:string, quantity_label:string|null,
   *            gross_hire:number}}
   * @throws {ValidationError}
   */
  computeGrossHire({
    rateBasis,
    rate,
    quantity,
    commissionType = policy.DEFAULT_COMMISSION_TYPE,
    commissionRate = policy.DEFAULT_COMMISSION_PERCENTAGE,
  } = {}) {
    const descriptor = policy.getRateBasis(rateBasis);
    if (!descriptor) {
      throw new ValidationError(
        `Invalid rate_basis "${rateBasis}". Expected one of: ${policy.RATE_BASIS.join(', ')}`
      );
    }

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      throw new ValidationError(`Invalid hire rate "${rate}" (expected a number >= 0)`);
    }

    let gross;
    let storedQuantity = null;

    if (descriptor.mode === 'RATE_QUANTITY') {
      const numericQuantity = Number(quantity);
      if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
        throw new ValidationError(
          `${descriptor.quantityLabel || 'Quantity'} is required for "${descriptor.label}" (expected a number > 0)`
        );
      }
      storedQuantity = numericQuantity;
      gross = numericRate * numericQuantity;
    } else if (descriptor.mode === 'NET') {
      // The operator typed the amount payable to the vendor. The gross has to be
      // solved so that the identity gross − commission = net holds to the paisa.
      const net = numericRate;
      const isPercentage = String(commissionType).toUpperCase() === 'PERCENTAGE';
      const numericCommissionRate = Number(commissionRate);

      if (isPercentage) {
        const pct = Number.isFinite(numericCommissionRate) ? numericCommissionRate : 0;
        if (pct < 0 || pct > 100) {
          throw new ValidationError(`Invalid commission rate ${commissionRate}% (must be 0–100)`);
        }
        // net = gross × (1 − pct/100)  ⇒  gross = net / (1 − pct/100)
        if (pct >= 100) {
          throw new ValidationError(
            'A 100% commission leaves no gross to solve from — use Percentage or Fixed instead'
          );
        }
        gross = net / (1 - pct / 100);
      } else {
        // Fixed commission: net = gross − fixed  ⇒  gross = net + fixed
        gross = net + (Number.isFinite(numericCommissionRate) ? numericCommissionRate : 0);
      }
    } else {
      // mode 'RATE'
      gross = numericRate;
      if (quantity !== undefined && quantity !== null && quantity !== '') {
        const numericQuantity = Number(quantity);
        if (Number.isFinite(numericQuantity)) storedQuantity = numericQuantity;
      }
    }

    return {
      rate_basis: descriptor.value,
      mode: descriptor.mode,
      rate: roundMoney(numericRate),
      quantity: storedQuantity,
      unit: descriptor.unit,
      rate_label: descriptor.rateLabel,
      quantity_label: descriptor.quantityLabel,
      hint: descriptor.hint,
      gross_hire: roundMoney(gross),
    };
  }

  /**
   * The full money picture for a set of hire terms, computed server-side.
   *
   * Delegates the commission arithmetic to the EXISTING canonical service, so
   * there is exactly one implementation of
   * `gross − commission = net` in the codebase.
   *
   * @param {Object} params
   * @returns {{gross_hire:number, commission_type:string, commission_rate:number,
   *            commission_amount:number, net_vendor_payable:number,
   *            commission_label:string}}
   */
  computeMoney({ billingTo, grossHire, commissionType, commissionRate }) {
    const businessModel = policy.businessModelForBillingTo(billingTo);
    if (!businessModel) {
      throw new ValidationError(
        `Invalid billing_to "${billingTo}". Expected one of: ${policy.BILLING_TO_OPTIONS
          .map((o) => o.value)
          .join(', ')}`
      );
    }

    const typeDescriptor = policy.getCommissionType(commissionType || policy.DEFAULT_COMMISSION_TYPE);
    if (!typeDescriptor) {
      throw new ValidationError(
        `Invalid commission_type "${commissionType}". Expected one of: ${policy.COMMISSION_TYPES.join(', ')}`
      );
    }

    // "No Commission" is a real stored state (percentage @ 0%), not a missing value.
    const rate = typeDescriptor.zero ? 0 : Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new ValidationError(`Invalid commission rate "${commissionRate}" (expected a number >= 0)`);
    }

    const money = hireService.computeCommissionAmount({
      grossHire,
      rate,
      type: typeDescriptor.stored,
    });

    return {
      business_model: businessModel,
      business_model_overridden: false,
      gross_hire: money.grossHire,
      commission_type: money.commissionType,
      commission_type_option: typeDescriptor.value,
      commission_rate: money.commissionRate,
      commission_amount: money.commissionAmount,
      net_vendor_payable: money.netVendorPayable,
      commission_label: typeDescriptor.label,
    };
  }

  // =========================================================================
  // PAGE CONTEXT
  // =========================================================================

  /**
   * Everything the Vehicle Hire page needs to open, in one round trip.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getHireContext(tripId) {
    const trip = await this._loadTripForHire(tripId);

    // `trips.enquiry_id` is a SCALAR by design (see migration
    // 20261003120000_enquiry_trip_reservation) — there is no Prisma relation to
    // include, so the enquiry behind an enquiry-raised Trip has to be read
    // explicitly. Without it a Trip with no User and no Client shows
    // "Customer: —" even though its enquiry names the customer.
    const enquiry = trip.enquiry_id
      ? await this.prisma.enquiry
          .findUnique({
            where: { enquiry_id: trip.enquiry_id },
            select: { enquiry_id: true, enquiry_number: true, customer_name: true, customer_mobile: true },
          })
          .catch(() => null)
      : null;

    const existingHire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: trip.trip_id },
      include: this._hireInclude(),
    });

    const documents = this.evaluateDocuments(trip.vehicle);

    return {
      trip: {
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        status: trip.status,
        booking_id: trip.booking_id,
        pickup_location: trip.pickup_location,
        pickup_city: trip.pickup_city,
        drop_location: trip.drop_location,
        drop_city: trip.drop_city,
        distance_km: trip.distance_km,
        trip_date: trip.trip_date,
        created_at: trip.created_at,
        freight_amount: Number(trip.freight_amount) || 0,
      },
      // THE PARTY BEHIND THE CONSIGNMENT.
      //
      // A Trip can reach this workspace without a User or a Client: one raised
      // from an Enquiry before acceptance carries `enquiry_id` and no
      // `user_id`/`client_id`. Reading only those two made the page show
      // "Customer: —" for a trip that DOES have a named customer, because the
      // name was sitting on the enquiry. So the enquiry is the last fallback,
      // after the two real master relations.
      customer: {
        client_id: trip.client?.client_id ?? null,
        name:
          trip.client?.company_name
          || trip.client?.client_name
          || [trip.client?.first_name, trip.client?.last_name].filter(Boolean).join(' ')
          || trip.user?.full_name
          || [trip.user?.first_name, trip.user?.last_name].filter(Boolean).join(' ')
          || enquiry?.customer_name
          || null,
        user_id: trip.user?.user_id ?? null,
        // Which relation actually answered, so the UI can label it honestly
        // instead of guessing from the name's shape.
        source: trip.client
          ? 'client'
          : trip.user
            ? 'user'
            : enquiry?.customer_name
              ? 'enquiry'
              : null,
        enquiry_id: enquiry?.enquiry_id ?? null,
        enquiry_number: enquiry?.enquiry_number ?? null,
        mobile:
          trip.client?.mobile
          || trip.client?.phone
          || trip.user?.phone
          || enquiry?.customer_mobile
          || null,
      },
      // The vehicle/vendor/driver the trip already carries. The page opens with
      // these selected and lets the operator change them — the trip row is the
      // existing assignment, not an invented default.
      assignment: {
        vehicle_id: trip.vehicle_id,
        vendor_id: trip.transport_owner_id,
        driver_id: trip.driver_id,
        vehicle: trip.vehicle
          ? {
            vehicle_id: trip.vehicle.vehicle_id,
            vehicle_number: trip.vehicle.vehicle_number,
            vehicle_type: trip.vehicle.vehicle_type,
            vehicle_name: trip.vehicle.vehicle_name,
            body_type: trip.vehicle.body_type,
            capacity_kg: trip.vehicle.capacity_kg,
            current_status: trip.vehicle.current_status,
            is_available: trip.vehicle.is_available,
          }
          : null,
        vendor: trip.transportOwner
          ? {
            owner_id: trip.transportOwner.owner_id,
            owner_name: trip.transportOwner.owner_name,
            owner_type: trip.transportOwner.owner_type,
            mobile: trip.transportOwner.mobile,
            city: trip.transportOwner.city,
          }
          : null,
        driver: trip.driver
          ? {
            driver_id: trip.driver.driver_id,
            driver_name: trip.driver.driver_name,
            mobile: trip.driver.mobile,
            status: trip.driver.status,
            is_available: trip.driver.is_available,
          }
          : null,
      },
      documents,
      existing_hire: existingHire ? this.serializeHire(existingHire) : null,
      can_hire: this.canHireTripStatus(trip.status) && !existingHire,
      blocked_reason: existingHire
        ? `This trip already has a hire (${existingHire.challan_number || `hire #${existingHire.hire_id}`})`
        : this.canHireTripStatus(trip.status)
          ? null
          : `A vehicle can be hired only when the trip is ${policy.HIRE_READY_TRIP_STATUSES.join(' or ')} (currently ${trip.status})`,
      next_operational: {
        status: policy.NEXT_OPERATIONAL_TRIP_STATUS,
        label: policy.NEXT_OPERATIONAL_LABEL,
      },
      // The previous trip terms, offered as a starting point — never applied
      // automatically, because a prior trip's rate is not this trip's rate.
      previous_terms: {
        billing_to: trip.billing_to,
        business_model: trip.business_model,
        rate_basis: trip.rate_basis,
        commission_type: trip.commission_type,
        commission_percentage: trip.commission_percentage,
      },
    };
  }

  /**
   * The catalogue the page renders, taken from the single policy module so the
   * page can never offer an option the backend would reject.
   * @param {Object} [extra]
   * @returns {Object}
   */
  getCatalogue(extra = {}) {
    return {
      billing_to: policy.BILLING_TO_OPTIONS,
      business_model_by_billing_to: policy.BILLING_TO_BUSINESS_MODEL,
      rate_basis: policy.RATE_BASIS_OPTIONS,
      default_rate_basis: policy.DEFAULT_RATE_BASIS,
      commission_types: policy.COMMISSION_TYPE_OPTIONS,
      default_commission_type: policy.DEFAULT_COMMISSION_TYPE,
      default_commission_percentage: policy.DEFAULT_COMMISSION_PERCENTAGE,
      documents: policy.VEHICLE_DOCUMENTS,
      document_warning_days: policy.DOCUMENT_WARNING_DAYS,
      business_model_override_roles: policy.BUSINESS_MODEL_OVERRIDE_ROLES,
      expired_document_override_roles: policy.EXPIRED_DOCUMENT_OVERRIDE_ROLES,
      hire_ready_statuses: policy.HIRE_READY_TRIP_STATUSES,
      hired_status: policy.HIRED_TRIP_STATUS,
      next_operational_status: policy.NEXT_OPERATIONAL_TRIP_STATUS,
      ...extra,
    };
  }

  /**
   * Lookup lists for the searchable selectors. Real database rows only — the
   * page never carries a hardcoded vehicle, vendor or driver.
   *
   * VACANT FIRST
   *   When a `tripId` is supplied, every vehicle and driver is annotated with
   *   AVAILABLE / BUSY / CONFLICT / UNAVAILABLE **for that consignment's own
   *   pickup** and the list is ordered vacant-first. The operator therefore sees
   *   what they can actually use at the top, with a stated reason for everything
   *   below it.
   *
   *   The classification is `utils/resourceAvailability.js`, which reuses the
   *   SAME pickup-window overlap helpers that decide whether an assignment is
   *   permitted. So what is displayed and what is allowed cannot disagree — this
   *   is a presentation of the existing rules, not a second set of rules.
   *
   * @param {Object} params
   * @param {string} [params.search]
   * @param {number} [params.ownerId]
   * @param {number} [params.limit]
   * @param {number} [params.tripId]  when present, annotate + rank for this trip
   * @returns {Promise<Object>}
   */
  async getLookups({ search = '', ownerId = null, limit = 25, tripId = null } = {}) {
    const take = Math.min(Number(limit) || 25, 100);
    const term = String(search || '').trim();

    const vehiclesWhere = {
      AND: [
        term
          ? {
            OR: [
              { vehicle_number: { contains: term, mode: 'insensitive' } },
              { vehicle_type: { contains: term, mode: 'insensitive' } },
              { vehicle_name: { contains: term, mode: 'insensitive' } },
            ],
          }
          : {},
        ownerId ? { owner_id: ownerId } : {},
      ],
    };

    const driversWhere = {
      AND: [
        term
          ? {
            OR: [
              { driver_name: { contains: term, mode: 'insensitive' } },
              { mobile: { contains: term } },
            ],
          }
          : {},
        ownerId ? { transport_owner_id: ownerId } : {},
      ],
    };

    const vendorsWhere = {
      AND: [
        term
          ? {
            OR: [
              { owner_name: { contains: term, mode: 'insensitive' } },
              { mobile: { contains: term } },
              { owner_code: { contains: term, mode: 'insensitive' } },
            ],
          }
          : {},
      ],
    };

    const [vehicles, vendors, drivers] = await Promise.all([
      this.prisma.transportVehicle.findMany({
        where: vehiclesWhere,
        take,
        orderBy: { vehicle_number: 'asc' },
        select: {
          vehicle_id: true,
          vehicle_number: true,
          vehicle_type: true,
          vehicle_name: true,
          body_type: true,
          capacity_kg: true,
          current_status: true,
          is_available: true,
          owner_id: true,
          owner: { select: { owner_id: true, owner_name: true, mobile: true } },
          driver: {
            select: {
              driver_id: true,
              driver_name: true,
              mobile: true,
              status: true,
              is_available: true,
            },
          },
        },
      }),
      this.prisma.vehicleOwner.findMany({
        where: vendorsWhere,
        take,
        orderBy: { owner_name: 'asc' },
        select: {
          owner_id: true,
          owner_name: true,
          owner_type: true,
          mobile: true,
          city: true,
          state: true,
          status: true,
          is_active: true,
        },
      }),
      this.prisma.driver.findMany({
        where: driversWhere,
        take,
        orderBy: { driver_name: 'asc' },
        select: {
          driver_id: true,
          driver_name: true,
          mobile: true,
          alternate_mobile: true,
          status: true,
          is_available: true,
          transport_owner_id: true,
          current_vehicle_id: true,
        },
      }),
    ]);

    const vehicleRows = vehicles.map((v) => ({
      ...v,
      documents: this.evaluateDocuments(v),
      // Auto-populated vendor fields, so selecting a vehicle fills the vendor
      // block without a second lookup — read from the EXISTING master.
      vendor: v.owner
        ? { owner_id: v.owner.owner_id, owner_name: v.owner.owner_name, mobile: v.owner.mobile }
        : null,
      assigned_driver: v.driver || null,
    }));
    const driverRows = drivers.map((d) => ({ ...d, label: d.driver_name }));

    if (!tripId) {
      return {
        vehicles: vehicleRows,
        vendors: vendors.map((v) => ({ ...v, label: v.owner_name })),
        drivers: driverRows,
      };
    }

    // ── Annotated for THIS consignment, vacant first ──────────────────────
    const ctx = await this._availabilityContext(tripId);
    if (!ctx) {
      // The trip could not be resolved — return the plain lists rather than
      // guessing a date and mislabelling resources as available.
      return {
        vehicles: vehicleRows,
        vendors: vendors.map((v) => ({ ...v, label: v.owner_name })),
        drivers: driverRows,
      };
    }

    return {
      vehicles: rankResources(vehicleRows, 'vehicle', ctx, 'vehicle_number'),
      vendors: vendors.map((v) => ({ ...v, label: v.owner_name })),
      drivers: rankResources(driverRows, 'driver', ctx, 'driver_name'),
    };
  }

  /**
   * The context `resourceAvailability` needs: this trip's own pickup window,
   * its own trip id, and every OTHER live consignment competing for the same
   * date.
   *
   * The competing set is read from the SAME two sources the existing conflict
   * rules already consult — active trips and holding enquiries — so the screen
   * cannot show "available" for something that is in fact committed.
   */
  async _availabilityContext(tripId) {
    const id = Number.parseInt(tripId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      select: { trip_id: true, trip_date: true },
    });
    if (!trip) return null;

    const window = tripWindow(trip.trip_date || new Date());
    const ownTripId = trip.trip_id;

    const [otherTrips, holdingEnquiries] = await Promise.all([
      this.prisma.trip.findMany({
        where: {
          trip_id: { not: ownTripId },
          status: { in: ACTIVE_TRIP_STATUSES },
          OR: [{ vehicle_id: { not: null } }, { driver_id: { not: null } }],
        },
        select: { trip_id: true, trip_date: true, vehicle_id: true, driver_id: true },
      }),
      this.prisma.enquiry.findMany({
        where: {
          status: { in: ENQUIRY_HOLD_STATUSES },
          OR: [{ assigned_vehicle_id: { not: null } }, { assigned_driver_id: { not: null } }],
        },
        select: {
          enquiry_id: true,
          pickup_date: true,
          assigned_vehicle_id: true,
          assigned_driver_id: true,
        },
      }),
    ]);

    const commitments = [
      ...otherTrips.map((t) => ({
        tripId: t.trip_id,
        window: t.trip_date ? tripWindow(t.trip_date) : null,
        vehicleIds: t.vehicle_id ? [t.vehicle_id] : [],
        driverIds: t.driver_id ? [t.driver_id] : [],
      })),
      // An enquiry that already holds resources is a commitment in its own
      // right — this is exactly how a RESERVATION blocks another consignment.
      ...holdingEnquiries.map((e) => ({
        tripId: null,
        enquiryId: e.enquiry_id,
        window: e.pickup_date ? pickupWindow(e.pickup_date, null) : null,
        vehicleIds: e.assigned_vehicle_id ? [e.assigned_vehicle_id] : [],
        driverIds: e.assigned_driver_id ? [e.assigned_driver_id] : [],
      })),
    ];

    return { commitments, window, ownTripId, overlaps: rangesOverlap };
  }

  /**
   * Everything the page needs about ONE vehicle, including its real document
   * expiries — used when the operator picks a vehicle so the document panel and
   * the vendor auto-population update together.
   *
   * @param {number} vehicleId
   * @returns {Promise<Object>}
   */
  async getVehicleDetail(vehicleId) {
    const vehicle = await this.prisma.transportVehicle.findUnique({
      where: { vehicle_id: Number(vehicleId) },
      include: {
        owner: {
          select: { owner_id: true, owner_name: true, owner_type: true, mobile: true, city: true, status: true },
        },
        driver: {
          select: {
            driver_id: true,
            driver_name: true,
            mobile: true,
            alternate_mobile: true,
            status: true,
            is_available: true,
            license_number: true,
            license_expiry: true,
            license_class: true,
            current_vehicle_id: true,
          },
        },
      },
    });

    if (!vehicle) throw new NotFoundError('Vehicle not found');

    const usability = checkVehicleUsable(vehicle);

    return {
      vehicle: {
        vehicle_id: vehicle.vehicle_id,
        vehicle_number: vehicle.vehicle_number,
        vehicle_type: vehicle.vehicle_type,
        vehicle_name: vehicle.vehicle_name,
        body_type: vehicle.body_type,
        capacity_kg: vehicle.capacity_kg,
        make: vehicle.vehicle_make,
        model: vehicle.vehicle_model,
        manufacturing_year: vehicle.manufacturing_year,
        current_status: vehicle.current_status,
        is_available: vehicle.is_available,
      },
      vendor: vehicle.owner
        ? {
            owner_id: vehicle.owner.owner_id,
            owner_name: vehicle.owner.owner_name,
            owner_type: vehicle.owner.owner_type,
            mobile: vehicle.owner.mobile,
            city: vehicle.owner.city,
            status: vehicle.owner.status,
          }
        : null,
      driver: vehicle.driver
        ? {
            driver_id: vehicle.driver.driver_id,
            driver_name: vehicle.driver.driver_name,
            mobile: vehicle.driver.mobile,
            alternate_mobile: vehicle.driver.alternate_mobile,
            status: vehicle.driver.status,
            is_available: vehicle.driver.is_available,
            license_number: vehicle.driver.license_number,
            license_expiry: vehicle.driver.license_expiry,
            license_class: vehicle.driver.license_class,
            current_vehicle_id: vehicle.driver.current_vehicle_id,
          }
        : null,
      documents: this.evaluateDocuments(vehicle),
      usable: usability.usable,
      unusable_reason: usability.reason,
    };
  }

  /**
   * Everything the page needs about ONE driver.
   * @param {number} driverId
   * @returns {Promise<Object>}
   */
  async getDriverDetail(driverId) {
    const driver = await this.prisma.driver.findUnique({
      where: { driver_id: Number(driverId) },
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        alternate_mobile: true,
        status: true,
        is_available: true,
        license_number: true,
        license_expiry: true,
        license_class: true,
        transport_owner_id: true,
        current_vehicle_id: true,
        transportOwner: { select: { owner_id: true, owner_name: true, mobile: true } },
      },
    });

    if (!driver) throw new NotFoundError('Driver not found');

    const usability = checkDriverUsable(driver);

    return {
      driver: {
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        mobile: driver.mobile,
        alternate_mobile: driver.alternate_mobile,
        status: driver.status,
        is_available: driver.is_available,
        license_number: driver.license_number,
        license_expiry: driver.license_expiry,
        license_class: driver.license_class,
        current_vehicle_id: driver.current_vehicle_id,
      },
      vendor: driver.transportOwner
        ? {
          owner_id: driver.transportOwner.owner_id,
          owner_name: driver.transportOwner.owner_name,
          mobile: driver.transportOwner.mobile,
        }
        : null,
      usable: usability.usable,
      unusable_reason: usability.reason,
    };
  }

  /**
   * Everything the page needs about ONE vendor.
   * @param {number} vendorId
   * @returns {Promise<Object>}
   */
  async getVendorDetail(vendorId) {
    const vendor = await this.prisma.vehicleOwner.findUnique({
      where: { owner_id: Number(vendorId) },
      select: {
        owner_id: true,
        owner_name: true,
        owner_type: true,
        mobile: true,
        city: true,
        state: true,
        address: true,
        status: true,
        is_active: true,
      },
    });

    if (!vendor) throw new NotFoundError('Vehicle owner / vendor not found');

    const vehicles = await this.prisma.transportVehicle.findMany({
      where: { owner_id: vendor.owner_id },
      take: 50,
      orderBy: { vehicle_number: 'asc' },
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_type: true,
        vehicle_name: true,
        current_status: true,
        is_available: true,
      },
    });

    const drivers = await this.prisma.driver.findMany({
      where: { transport_owner_id: vendor.owner_id },
      take: 50,
      orderBy: { driver_name: 'asc' },
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        status: true,
        is_available: true,
        current_vehicle_id: true,
      },
    });

    return {
      vendor: {
        owner_id: vendor.owner_id,
        owner_name: vendor.owner_name,
        owner_type: vendor.owner_type,
        mobile: vendor.mobile,
        city: vendor.city,
        state: vendor.state,
        address: vendor.address,
        status: vendor.status,
        is_active: vendor.is_active,
      },
      vehicles: vehicles.map((v) => ({ ...v, documents: this.evaluateDocuments(v) })),
      drivers,
    };
  }

  // =========================================================================
  // THE OPERATIONAL LIST — every trip, and where it stands on hiring
  // =========================================================================

  /**
   * The list behind the Vehicle Hire page: every confirmed consignment, what
   * stage of HIRING it is at, and what vehicle / driver / vendor / money is
   * attached to it.
   *
   * ── WHY THIS QUERY CHANGED ──────────────────────────────────────────────
   * It previously read `vehicleHire === null` as "waiting". That made the page
   * answer the wrong question: a consignment whose vehicle an admin had already
   * assigned from the ENQUIRY page was returned as "waiting for a vehicle" and
   * rendered with no vehicle at all, because the assignment had been written to
   * `enquiries.assigned_vehicle_id` while this page read `trips.vehicle_id`.
   * The two screens were reading two different columns through two different
   * code paths — that was the bug.
   *
   * It now derives the hire state from stored data via `policy.hireStateFor()`:
   *
   *      vehicle_id NULL, no hire   → WAITING FOR VEHICLE
   *      vehicle_id SET,  no hire   → VEHICLE_ASSIGNED (waiting for hire)
   *      a `vehicle_hires` row     → VEHICLE_HIRED
   *
   * so a consignment assigned from EITHER screen appears exactly once, with its
   * real vehicle, under the correct heading. There is still ONE query over ONE
   * table (`trips`) joined to the ONE hire table — no second system.
   *
   * @param {Object} [filters]
   * @param {string} [filters.view] 'waiting' | 'hired' | 'all'
   * @param {string} [filters.search]
   * @param {string} [filters.trip_date] ISO date — filter by trip date
   * @param {string} [filters.vehicle_type]
   * @param {string} [filters.business_model]
   * @param {number} [filters.page]
   * @param {number} [filters.limit]
   * @returns {Promise<{rows:Array, counts:Object, pagination:Object}>}
   */
  async listTrips(filters = {}) {
    const {
      view = 'waiting',
      search = '',
      trip_date: tripDate = '',
      vehicle_type: vehicleType = '',
      business_model: businessModel = '',
      page = 1,
      limit = 25,
    } = filters;

    const take = Math.min(Number(limit) || 25, 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const skip = (currentPage - 1) * take;
    const term = String(search || '').trim();

    // Every consignment that can still be actioned in Vehicle Hire. The hire
    // state (waiting / assigned / hired) is then narrowed from real columns,
    // NOT from the presence of a hire row alone.
    const hireReady = { in: policy.HIRE_LIST_TRIP_STATUSES };

    const where = { status: hireReady };

    // `view` narrows by the DERIVED hire state, which cannot be expressed as a
    // simple Prisma relation filter. It is therefore applied after the rows are
    // read, against the same `hireStateFor` rule the serializer uses. To keep
    // pagination honest, the counts below are computed with the same predicate.
    if (businessModel) {
      where.OR = [
        { business_model: String(businessModel).toUpperCase() },
        { vehicleHire: { business_model: String(businessModel).toUpperCase() } },
      ];
    }

    const searchClauses = [];
    if (term) {
      searchClauses.push(
        { trip_number: { contains: term, mode: 'insensitive' } },
        { pickup_city: { contains: term, mode: 'insensitive' } },
        { drop_city: { contains: term, mode: 'insensitive' } },
        { pickup_location: { contains: term, mode: 'insensitive' } },
        { drop_location: { contains: term, mode: 'insensitive' } },
        { booking: { booking_number: { contains: term, mode: 'insensitive' } } },
        { booking: { goods_description: { contains: term, mode: 'insensitive' } } },
        { client: { company_name: { contains: term, mode: 'insensitive' } } },
        { vehicle: { vehicle_number: { contains: term, mode: 'insensitive' } } },
        { driver: { driver_name: { contains: term, mode: 'insensitive' } } },
        { transportOwner: { owner_name: { contains: term, mode: 'insensitive' } } }
      );
    }
    if (vehicleType) {
      searchClauses.push({
        OR: [
          { vehicle: { vehicle_type: { contains: vehicleType, mode: 'insensitive' } } },
          { booking: { vehicle_type_required: { contains: vehicleType, mode: 'insensitive' } } },
        ],
      });
    }
    if (term || vehicleType) {
      where.AND = searchClauses;
    }
    if (tripDate) {
      const from = new Date(tripDate);
      if (!Number.isNaN(from.getTime())) {
        const to = new Date(from);
        to.setDate(to.getDate() + 1);
        where.trip_date = { gte: from, lt: to };
      }
    }

    const [allRows, waitingCount, assignedCount, hiredCount, toLoadingCount] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        orderBy: [{ trip_date: 'desc' }, { trip_id: 'desc' }],
        select: {
          trip_id: true,
          trip_number: true,
          status: true,
          trip_date: true,
          expected_delivery_date: true,
          pickup_location: true,
          pickup_city: true,
          drop_location: true,
          drop_city: true,
          distance_km: true,
          // THE CURRENT ASSIGNMENT. Selected because the hire state is derived
          // from these three columns — a consignment assigned from the Enquiry
          // page is visible here exactly as one assigned from this page.
          vehicle_id: true,
          driver_id: true,
          transport_owner_id: true,
          // The CUSTOMER freight — a different concept from the vehicle-side
          // gross hire. Kept separate and never overwritten by a hire.
          freight_amount: true,
          billing_to: true,
          business_model: true,
          rate_basis: true,
          booking: {
            select: {
              booking_id: true,
              booking_number: true,
              goods_description: true,
              goods_type: true,
              number_of_items: true,
              quantity_unit: true,
              goods_weight_kg: true,
              weight_unit: true,
              vehicle_type_required: true,
            },
          },
          client: { select: { client_id: true, company_name: true, contact_person: true } },
          user: { select: { first_name: true, last_name: true } },
          vehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_type: true,
              vehicle_name: true,
              capacity_kg: true,
              body_type: true,
              current_status: true,
              is_available: true,
            },
          },
          driver: { select: { driver_id: true, driver_name: true, mobile: true, status: true } },
          transportOwner: {
            select: { owner_id: true, owner_name: true, mobile: true, owner_type: true },
          },
          vehicleHire: {
            select: {
              hire_id: true,
              challan_number: true,
              billing_to: true,
              business_model: true,
              rate_basis: true,
              rate_value: true,
              rate_quantity: true,
              gross_hire: true,
              commission_type: true,
              commission_rate: true,
              commission_amount: true,
              net_vendor_payable: true,
              status: true,
              created_at: true,
              created_by: true,
            },
          },
        },
      }),
      // The headline counts, each computed with the SAME predicate the
      // table uses, so the KPI cards can never disagree with the rows beneath
      // them. Counts deliberately ignore the `view` filter — they describe the
      // whole queue, which is what an operator switching tabs expects to see.
      this.prisma.trip.count({ where: { status: hireReady, vehicle_id: null } }),
      this.prisma.trip.count({ where: { status: hireReady, vehicle_id: { not: null } } }),
      this.prisma.trip.count({
        where: { status: hireReady, vehicleHire: { isNot: null } },
      }),
      this.prisma.trip.count({
        where: { status: hireReady, OR: [{ status: 'TO_LOADING_POINT' }, { status: 'AT_LOADING_POINT' }] },
      }),
    ]);

    // ── Derive the hire state of every candidate row, then narrow by `view` ──
    //
    // The state cannot be filtered in SQL (it is a three-way comparison across
    // a nullable column and a left-joined relation), so it is derived from the
    // SAME pure rule the serializer uses. One rule, one answer — never a second
    // copy of the logic in a different place.
    const decorated = allRows.map((t) => {
      const hireState = policy.hireStateFor({
        vehicleId: t.vehicle_id,
        driverId: t.driver_id,
        hasHire: Boolean(t.vehicleHire),
      });
      return { trip: t, hireState };
    });

    // Only rows that actually carry a hire contribute money. `sumDecimal`
    // receives the unwrapped trip, because the picker reads the hire relation
    // straight off it.
    const hiredTrips = decorated.filter((d) => d.trip.vehicleHire).map((d) => d.trip);

    const counts = {
      waiting: waitingCount,
      assigned: assignedCount,
      hired: hiredCount,
      to_loading: toLoadingCount,
      // "shown" drives the list total; the three above drive the KPI cards.
      shown: decorated.length,
      // Headline money, summed from the STORED hire columns across the whole
      // queue. Gross is never replaced by net — they are summed separately, so
      // the KPI row can never imply that the commission was taken off the gross.
      gross_hire: sumDecimal(hiredTrips, (t) => t.vehicleHire.gross_hire),
      commission_amount: sumDecimal(hiredTrips, (t) => t.vehicleHire.commission_amount),
      net_vendor_payable: sumDecimal(hiredTrips, (t) => t.vehicleHire.net_vendor_payable),
    };

    const filtered =
      view === 'waiting'
        ? decorated.filter(
            (d) =>
              d.hireState === policy.HIRE_STATE.WAITING_FOR_VEHICLE
              || d.hireState === policy.HIRE_STATE.VEHICLE_ASSIGNED
          )
        : view === 'hired'
          ? decorated.filter((d) => d.hireState === policy.HIRE_STATE.VEHICLE_HIRED)
          : decorated;

    const total = filtered.length;
    const pageRows = filtered.slice(skip, skip + take);

    return {
      rows: pageRows.map(({ trip: t, hireState }) =>
        this.serializeListRow(t, hireState)
      ),
      counts,
      pagination: {
        page: currentPage,
        limit: take,
        total,
        totalPages: Math.max(Math.ceil(total / take), 1),
      },
    };
  }

  /**
   * One list row, shaped for the table.
   *
   * Every money figure is read from the STORED hire columns — gross, commission
   * and net are three separate values that are never collapsed into one.
   *
   * `hireState` is passed in from the caller so the rendered row and the `view`
   * filter are guaranteed to agree: both come from `policy.hireStateFor()`.
   * When omitted it is derived here, so the serializer stays safe to call
   * directly from anywhere.
   *
   * @param {Object} t - a Trip row with the relations the list selects
   * @param {string} [hireState] - one of policy.HIRE_STATE
   * @returns {Object}
   */
  serializeListRow(t, hireState = null) {
    const n = (v) => (v === null || v === undefined ? null : Number(v));
    const hire = t.vehicleHire;

    const state = hireState || policy.hireStateFor({
      vehicleId: t.vehicle_id,
      driverId: t.driver_id,
      hasHire: Boolean(hire),
    });

    // The action is a pure function of the derived state, so "Hire Vehicle" can
    // never be offered for a consignment that is already hired (spec §19).
    const action = policy.actionForHireState(state);
    const hireReady = policy.HIRE_READY_TRIP_STATUSES.includes(String(t.status));

    const customer =
      t.client?.company_name
      || [t.user?.first_name, t.user?.last_name].filter(Boolean).join(' ')
      || null;

    return {
      trip_id: t.trip_id,
      trip_number: t.trip_number,
      booking_id: t.booking?.booking_id ?? null,
      booking_number: t.booking?.booking_number || null,
      status: t.status,

      // THE VEHICLE-HIRE STATE, derived from stored data — never guessed by the
      // client. This is the value the table renders, so a consignment assigned
      // from the Enquiry page reads VEHICLE_ASSIGNED here rather than
      // "waiting for a vehicle" above an empty vehicle column.
      hire_status: state,
      hire_completed: state === policy.HIRE_STATE.VEHICLE_HIRED,

      // Which control the operator gets. One rule, shared with the row.
      action: action.action,
      action_label: action.label,
      requires_hire_form: action.requires_hire_form,
      can_hire: state !== policy.HIRE_STATE.VEHICLE_HIRED && hireReady,

      customer,
      customer_type: t.client ? 'CLIENT' : 'ONLINE',
      client: t.client,

      route: {
        pickup: [t.pickup_location, t.pickup_city].filter(Boolean).join(', '),
        pickup_city: t.pickup_city,
        drop: [t.drop_location, t.drop_city].filter(Boolean).join(', '),
        drop_city: t.drop_city,
        distance_km: t.distance_km,
      },

      trip_date: t.trip_date,
      expected_delivery_date: t.expected_delivery_date,

      goods: {
        description: t.booking?.goods_description || null,
        type: t.booking?.goods_type || null,
        quantity: t.booking?.number_of_items ?? null,
        quantity_unit: t.booking?.quantity_unit || null,
        weight_kg: t.booking?.goods_weight_kg ?? null,
        weight_unit: t.booking?.weight_unit || null,
      },

      // What the consignment requires. The trip's assigned vehicle is shown
      // separately — they are different things until the operator confirms one.
      required_vehicle_type: t.booking?.vehicle_type_required || null,

      vehicle: t.vehicle
        ? {
          vehicle_id: t.vehicle.vehicle_id,
          vehicle_number: t.vehicle.vehicle_number,
          vehicle_type: t.vehicle.vehicle_type,
          vehicle_name: t.vehicle.vehicle_name,
          capacity_kg: t.vehicle.capacity_kg,
          body_type: t.vehicle.body_type,
          current_status: t.vehicle.current_status,
          is_available: t.vehicle.is_available,
        }
        : null,

      driver: t.driver
        ? {
          driver_id: t.driver.driver_id,
          driver_name: t.driver.driver_name,
          mobile: t.driver.mobile,
          status: t.driver.status,
        }
        : null,

      vendor: t.transportOwner
        ? {
          owner_id: t.transportOwner.owner_id,
          owner_name: t.transportOwner.owner_name,
          mobile: t.transportOwner.mobile,
          owner_type: t.transportOwner.owner_type,
        }
        : null,

      // Customer freight — deliberately NOT the vehicle-side gross.
      customer_freight: n(t.freight_amount),

      vehicleHire: hire
        ? {
            hire_id: hire.hire_id,
            challan_number: hire.challan_number,
            billing_to: hire.billing_to,
            business_model: hire.business_model,
            rate_basis: hire.rate_basis,
            rate_value: n(hire.rate_value),
            rate_quantity: n(hire.rate_quantity),
            commission_type: hire.commission_type,
            commission_rate: n(hire.commission_rate),
            // THREE SEPARATE FIGURES, read straight from their own columns.
            gross_hire: n(hire.gross_hire),
            commission_amount: n(hire.commission_amount),
            net_vendor_payable: n(hire.net_vendor_payable),
            status: hire.status,
            hired_at: hire.created_at,
            hired_by: hire.created_by,
          }
        : null,
    };
  }

  // =========================================================================
  // PREVIEW — the server-side calculator behind the summary card
  // =========================================================================

  /**
   * Compute the whole hire without writing anything.
   *
   * The page calls this so the "Vehicle Hire Summary" card and the stored
   * record are produced by the SAME code path. A browser-side preview that
   * disagreed with the save would be worse than no preview at all.
   *
   * @param {number} tripId
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async previewHire(tripId, input = {}) {
    const trip = await this._loadTripForHire(tripId);
    return this._resolveTerms(trip, input, { preview: true });
  }

  // =========================================================================
  // SAVE — the one write path
  // =========================================================================

  /**
   * Validate, calculate and save a vehicle hire, then move the trip to
   * VEHICLE HIRED. Everything commits in ONE transaction.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object} [user] - the admin performing the hire
   * @returns {Promise<{hire:Object, trip:Object, status_before:string,
   *                    status_after:string, next_operational:Object}>}
   */
  async hireVehicle(tripId, input = {}, user = null) {
    const trip = await this._loadTripForHire(tripId);

    // ── One hire per trip. Checked before anything is computed so a double
    //    click cannot produce two obligations for one consignment. The UNIQUE
    //    constraint on trip_id is the backstop if two requests race.
    const existing = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: trip.trip_id },
      select: { hire_id: true, challan_number: true },
    });
    if (existing) {
      // ConflictError takes an OBJECT ({ message }) — see utils/AppError. Passing
      // a bare string silently fell back to the default "Conflict", so the
      // operator never learned WHICH hire already existed.
      throw new ConflictError({
        message: `This trip already has a vehicle hire${existing.challan_number ? ` (${existing.challan_number})` : ''}`,
      });
    }

    // ── Trip must be in a hire-ready state (WAITING FOR VEHICLE = PENDING). ──
    if (!this.canHireTripStatus(trip.status)) {
      throw new ValidationError(
        `A vehicle can be hired only when the trip is ${policy.HIRE_READY_TRIP_STATUSES.join(' or ')}. This trip is ${trip.status}.`
      );
    }

    // ── Validate, calculate and check documents. ───────────────────────────
    const resolved = await this._resolveTerms(trip, input, { preview: false, user });

    // ── Confirm the status transition the existing state machine allows. ────
    // Skipped when the trip is ALREADY in the hired state. A vehicle can be
    // assigned from the Enquiry page before the hire money is agreed, which
    // moves the trip to ASSIGNED; completing the hire afterwards would then be
    // an ASSIGNED → ASSIGNED "transition", which the state machine correctly
    // refuses. Nothing needs to change in that case, so it is not attempted.
    if (trip.status !== policy.HIRED_TRIP_STATUS) {
      tripStateMachine.validateOperationalTransition(trip.status, policy.HIRED_TRIP_STATUS);
    }

    const challanNumber = this.buildChallanNumber(trip);
    const statusBefore = trip.status;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. The hire record. Money is written as Decimal strings, never floats.
      const hire = await tx.vehicleHire.create({
        data: {
          trip_id: trip.trip_id,
          booking_id: trip.booking_id ?? null,
          vehicle_id: resolved.vehicle_id,
          vendor_id: resolved.vendor_id,
          driver_id: resolved.driver_id,

          billing_to: resolved.billing_to,
          business_model: resolved.business_model,
          business_model_overridden: resolved.business_model_overridden,

          rate_basis: resolved.rate_basis,
          rate_value: resolved.rate_value.toFixed(2),
          rate_quantity: resolved.rate_quantity === null ? null : resolved.rate_quantity.toFixed(3),
          rate_unit: resolved.rate_unit,

          gross_hire: resolved.gross_hire.toFixed(2),
          commission_type: resolved.commission_type,
          commission_rate: resolved.commission_rate.toFixed(4),
          commission_amount: resolved.commission_amount.toFixed(2),
          net_vendor_payable: resolved.net_vendor_payable.toFixed(2),

          remarks: resolved.remarks,

          documents_snapshot: resolved.documents_snapshot,
          documents_expired_ack: resolved.documents_expired_ack,
          documents_expired_ack_by: resolved.documents_expired_ack ? (user?.user_id ?? null) : null,
          documents_expired_ack_at: resolved.documents_expired_ack ? new Date() : null,

          challan_number: challanNumber,
          status: 'ACTIVE',
          created_by: user?.user_id ?? null,
        },
      });

      // 2. The Trip: status moves to VEHICLE HIRED, and the commercial terms are
      //    written back to the columns Phase 2 added, so existing reporting keeps
      //    reading the same numbers from the same place.
      const updatedTrip = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          status: policy.HIRED_TRIP_STATUS,
          vehicle_id: resolved.vehicle_id,
          transport_owner_id: resolved.vendor_id,
          driver_id: resolved.driver_id,
          billing_to: resolved.billing_to,
          business_model: resolved.business_model,
          rate_basis: resolved.rate_basis,
          commission_type: resolved.commission_type,
          commission_percentage: Number(resolved.commission_rate.toFixed(4)),
        },
      });

      // 3. The ONE history system — an append-only timeline event carrying the
      //    money figures, so a dispute months later can be settled from the record.
      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'vehicle_hired',
        description: [
          'Vehicle hired',
          resolved.vehicle_number,
          `· ${resolved.business_model}`,
          `· Gross ₹${resolved.gross_hire.toLocaleString('en-IN')}`,
          `· Commission ₹${resolved.commission_amount.toLocaleString('en-IN')}`,
          `· Net Vendor Payable ₹${resolved.net_vendor_payable.toLocaleString('en-IN')}`,
        ].join(' '),
        reference_type: 'vehicle_hire',
        reference_id: hire.hire_id,
        metadata: {
          hire_id: hire.hire_id,
          challan_number: challanNumber,
          from: statusBefore,
          to: policy.HIRED_TRIP_STATUS,
          vehicle_id: resolved.vehicle_id,
          vehicle_number: resolved.vehicle_number,
          vendor_id: resolved.vendor_id,
          vendor_name: resolved.vendor_name,
          driver_id: resolved.driver_id,
          driver_name: resolved.driver_name,
          billing_to: resolved.billing_to,
          business_model: resolved.business_model,
          rate_basis: resolved.rate_basis,
          rate_value: resolved.rate_value,
          rate_quantity: resolved.rate_quantity,
          gross_hire: resolved.gross_hire,
          commission_type: resolved.commission_type,
          commission_rate: resolved.commission_rate,
          commission_amount: resolved.commission_amount,
          net_vendor_payable: resolved.net_vendor_payable,
        },
        created_by: user?.user_id ?? null,
      }, tx);

      // 4. The existing audit log.
      await this.auditRepo.create({
        user_id: user?.user_id ?? null,
        user_role: user?.role || 'system',
        action: 'vehicle_hire_created',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: statusBefore, vehicle_hired: false }),
        new_value: JSON.stringify({
          status: policy.HIRED_TRIP_STATUS,
          vehicle_hired: true,
          hire_id: hire.hire_id,
          challan_number: challanNumber,
          gross_hire: resolved.gross_hire,
          commission_amount: resolved.commission_amount,
          net_vendor_payable: resolved.net_vendor_payable,
          business_model: resolved.business_model,
          billing_to: resolved.billing_to,
          documents_expired_ack: resolved.documents_expired_ack,
        }),
        reason: resolved.remarks || null,
      }, tx);

      // 5. MIRRORS — keep booking mirrors in step so the Order Master agrees immediately.
      //    Same pattern as TripVehicleAssignmentService.assign: update booking/enquiry mirrors
      //    in the SAME transaction so the Order Master and Enquiry screens agree with operations.
      if (trip.booking_id) {
        const bookingPatch = {
          vehicle_id: resolved.vehicle_id,
          driver_id: resolved.driver_id,
          vehicle_owner_id: resolved.vendor_id,
        };
        await tx.booking.update({
          where: { booking_id: trip.booking_id },
          data: bookingPatch,
        });
      }

      // Also update enquiry mirrors if this trip was created from an enquiry
      if (trip.enquiry_id) {
        const enquiryPatch = {
          assigned_vehicle_id: resolved.vehicle_id,
          assigned_driver_id: resolved.driver_id,
          assigned_owner_id: resolved.vendor_id,
          vehicle_assigned_at: new Date(),
          driver_assigned_at: new Date(),
        };
        await tx.enquiry.update({
          where: { enquiry_id: trip.enquiry_id },
          data: enquiryPatch,
        });
      }

      return { hire, trip: updatedTrip };
    });

    // 5. Read the hire back with its masters so the success state shows the real
    //    vehicle, vendor and driver rather than echoing the request.
    const hire = await this.prisma.vehicleHire.findUnique({
      where: { hire_id: result.hire.hire_id },
      include: this._hireInclude(),
    });

    return {
      hire: this.serializeHire(hire),
      trip: result.trip,
      status_before: statusBefore,
      status_after: result.trip.status,
      next_operational: {
        status: policy.NEXT_OPERATIONAL_TRIP_STATUS,
        label: policy.NEXT_OPERATIONAL_LABEL,
      },
    };
  }

  /**
   * EDIT an existing hire — "Edit Vehicle Hire".
   *
   * WHY THIS EXISTS SEPARATELY FROM `hireVehicle()`
   *   A hire is a contractual obligation. Correcting it must not create a second
   *   one: the same truck would then be owed twice, and `vehicle_hires.trip_id`
   *   is UNIQUE so a duplicate is not even representable. This method therefore
   *   ONLY ever UPDATEs the existing row.
   *
   * WHAT IS THE SAME AS CREATING
   *   The money. `updateVehicleHire` runs the IDENTICAL `_resolveTerms()` used
   *   by `hireVehicle()` and by `previewHire()`, so gross, commission and net
   *   are computed by the one existing calculator. There is no second formula
   *   here, and the browser never computes money at all.
   *
   * WHAT IS PRESERVED
   *   `challan_number` is NOT regenerated — a challan already handed to a
   *   driver must keep identifying the same hire. The previous figures are
   *   written to the audit log and the trip timeline before being superseded,
   *   so the change is reconstructable months later.
   *
   * @param {number} tripId
   * @param {Object} input - the same operator inputs `hireVehicle` accepts
   * @param {Object} [user]
   * @returns {Promise<{hire:Object, trip:Object, updated:true}>}
   */
  async updateVehicleHire(tripId, input = {}, user = null) {
    const trip = await this._loadTripForHire(tripId);

    // ── The hire MUST already exist. This is an edit, never a create. ────────
    const existing = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: trip.trip_id },
      select: {
        hire_id: true,
        challan_number: true,
        vehicle_id: true,
        driver_id: true,
        vendor_id: true,
        gross_hire: true,
        commission_amount: true,
        net_vendor_payable: true,
        rate_basis: true,
        status: true,
        documents_expired_ack_by: true,
      },
    });
    if (!existing) {
      // NotFoundError takes an OBJECT ({ message }) — see utils/AppError. Passing
      // a bare string would silently fall back to the default "Not Found" and
      // the operator would never learn why the edit was refused.
      throw new NotFoundError({
        message: 'This trip has no vehicle hire to edit yet. Use "Hire Vehicle" to create one.',
      });
    }
    if (existing.status === 'CANCELLED') {
      throw new ValidationError(
        `This hire is cancelled (${existing.challan_number || `hire #${existing.hire_id}`}) and can no longer be edited.`
      );
    }

    // ── The SAME validation + calculation the create path uses ──────────────
    const resolved = await this._resolveTerms(trip, input, { preview: false, user });

    // A hire already agreed against a different truck must not be silently
    // repointed by an edit. Changing the vehicle is a reassignment, which
    // TripVehicleAssignmentService owns.
    if (existing.vehicle_id !== resolved.vehicle_id) {
      throw new ValidationError(
        'This hire is agreed against a different vehicle. Reassign the vehicle on the trip first, then edit the hire.'
      );
    }

    const previous = {
      vehicle_id: existing.vehicle_id,
      driver_id: existing.driver_id,
      vendor_id: existing.vendor_id,
      rate_basis: existing.rate_basis,
      gross_hire: Number(existing.gross_hire),
      commission_amount: Number(existing.commission_amount),
      net_vendor_payable: Number(existing.net_vendor_payable),
    };

    const result = await this.prisma.$transaction(async (tx) => {
      // The single write: UPDATE the one hire. No INSERT is reachable from
      // this method, so editing can never fork the obligation.
      const hire = await tx.vehicleHire.update({
        where: { hire_id: existing.hire_id },
        data: {
          vehicle_id: resolved.vehicle_id,
          vendor_id: resolved.vendor_id,
          driver_id: resolved.driver_id,

          billing_to: resolved.billing_to,
          business_model: resolved.business_model,
          business_model_overridden: resolved.business_model_overridden,

          rate_basis: resolved.rate_basis,
          rate_value: resolved.rate_value.toFixed(2),
          rate_quantity: resolved.rate_quantity === null ? null : resolved.rate_quantity.toFixed(3),
          rate_unit: resolved.rate_unit,

          // THREE SEPARATE FIGURES, recalculated by the existing calculator.
          gross_hire: resolved.gross_hire.toFixed(2),
          commission_type: resolved.commission_type,
          commission_rate: resolved.commission_rate.toFixed(4),
          commission_amount: resolved.commission_amount.toFixed(2),
          net_vendor_payable: resolved.net_vendor_payable.toFixed(2),

          remarks: resolved.remarks,

          documents_snapshot: resolved.documents_snapshot,
          documents_expired_ack: resolved.documents_expired_ack,
          documents_expired_ack_by: resolved.documents_expired_ack
            ? (user?.user_id ?? existing.documents_expired_ack_by ?? null)
            : null,
          documents_expired_ack_at: resolved.documents_expired_ack ? new Date() : null,

          // challan_number is deliberately NOT touched — see the note above.
          updated_at: new Date(),
        },
      });

      // The trip's own commercial columns follow, so existing reporting keeps
      // reading the same numbers from the same place.
      const updatedTrip = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          transport_owner_id: resolved.vendor_id,
          driver_id: resolved.driver_id,
          billing_to: resolved.billing_to,
          business_model: resolved.business_model,
          rate_basis: resolved.rate_basis,
          commission_type: resolved.commission_type,
          commission_percentage: Number(resolved.commission_rate.toFixed(4)),
        },
      });

      // The append-only timeline keeps the superseded figures.
      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'vehicle_hire_updated',
        description: [
          'Vehicle hire edited',
          `· Gross ₹${previous.gross_hire.toLocaleString('en-IN')} → ₹${resolved.gross_hire.toLocaleString('en-IN')}`,
          `· Commission ₹${previous.commission_amount.toLocaleString('en-IN')} → ₹${resolved.commission_amount.toLocaleString('en-IN')}`,
          `· Net ₹${previous.net_vendor_payable.toLocaleString('en-IN')} → ₹${resolved.net_vendor_payable.toLocaleString('en-IN')}`,
        ].join(' '),
        reference_type: 'vehicle_hire',
        reference_id: existing.hire_id,
        metadata: {
          hire_id: existing.hire_id,
          challan_number: existing.challan_number,
          from: previous,
          to: {
            vehicle_id: resolved.vehicle_id,
            driver_id: resolved.driver_id,
            vendor_id: resolved.vendor_id,
            rate_basis: resolved.rate_basis,
            rate_value: resolved.rate_value,
            rate_quantity: resolved.rate_quantity,
            gross_hire: resolved.gross_hire,
            commission_type: resolved.commission_type,
            commission_rate: resolved.commission_rate,
            commission_amount: resolved.commission_amount,
            net_vendor_payable: resolved.net_vendor_payable,
            business_model: resolved.business_model,
            billing_to: resolved.billing_to,
          },
        },
        created_by: user?.user_id ?? null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id ?? null,
        user_role: user?.role || 'system',
        action: 'vehicle_hire_updated',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify(previous),
        new_value: JSON.stringify({
          hire_id: existing.hire_id,
          gross_hire: resolved.gross_hire,
          commission_amount: resolved.commission_amount,
          net_vendor_payable: resolved.net_vendor_payable,
          business_model: resolved.business_model,
          billing_to: resolved.billing_to,
        }),
        reason: resolved.remarks || null,
      }, tx);

      return { hire, trip: updatedTrip };
    });

    const hire = await this.prisma.vehicleHire.findUnique({
      where: { hire_id: result.hire.hire_id },
      include: this._hireInclude(),
    });

    return {
      hire: this.serializeHire(hire),
      trip: result.trip,
      updated: true,
      status_before: trip.status,
      status_after: result.trip.status,
    };
  }

  /**
   * Load the hire for a trip, or null. Used by the success state and the challan.
   * @param {number} tripId
   * @returns {Promise<Object|null>}
   */
  async getHire(tripId) {
    const hire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: Number(tripId) },
      include: this._hireInclude(),
    });
    return hire ? this.serializeHire(hire) : null;
  }

  /**
   * Load a hire together with its trip, for the printable challan.
   * @param {number} tripId
   * @returns {Promise<{hire:Object, trip:Object}>}
   */
  async getHireWithTrip(tripId) {
    const hire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: Number(tripId) },
      include: {
        ...this._hireInclude(),
        trip: {
          include: {
            vehicle: true,
            driver: true,
            transportOwner: true,
            client: true,
            user: true,
            booking: true,
          },
        },
      },
    });
    if (!hire) throw new NotFoundError('No vehicle hire exists for this trip');
    return hire;
  }

  // =========================================================================
  // INTERNAL
  // =========================================================================

  /** Is a trip in a status a vehicle may be hired on? */
  canHireTripStatus(status) {
    return policy.HIRE_READY_TRIP_STATUSES.includes(String(status || '').toUpperCase());
  }

  /**
   * The relations loaded with a hire. Deliberately the minimum needed for the
   * page and the challan — the hire stores FKs, never copies of these.
   */
  _hireInclude() {
    return {
      vehicle: {
        select: {
          vehicle_id: true,
          vehicle_number: true,
          vehicle_type: true,
          vehicle_name: true,
          body_type: true,
        },
      },
      vendor: {
        select: { owner_id: true, owner_name: true, owner_type: true, mobile: true, city: true },
      },
      driver: {
        select: { driver_id: true, driver_name: true, mobile: true, license_number: true },
      },
      trip: {
        select: {
          trip_id: true,
          trip_number: true,
          status: true,
          pickup_location: true,
          pickup_city: true,
          drop_location: true,
          drop_city: true,
          trip_date: true,
          booking_id: true,
        },
      },
    };
  }

  /**
   * Normalise a Prisma hire row (Decimal objects) into the JSON shape the API
   * and the page use. Decimals become numbers here, once, at the edge.
   * @param {Object} hire
   * @returns {Object}
   */
  serializeHire(hire) {
    if (!hire) return null;
    const n = (v) => (v === null || v === undefined ? null : Number(v));
    return {
      hire_id: hire.hire_id,
      trip_id: hire.trip_id,
      booking_id: hire.booking_id,
      challan_number: hire.challan_number,
      status: hire.status,

      vehicle: hire.vehicle,
      vendor: hire.vendor,
      driver: hire.driver,
      trip: hire.trip || null,

      billing_to: hire.billing_to,
      business_model: hire.business_model,
      business_model_overridden: hire.business_model_overridden,

      rate_basis: hire.rate_basis,
      rate_value: n(hire.rate_value),
      rate_quantity: n(hire.rate_quantity),
      rate_unit: hire.rate_unit,

      gross_hire: n(hire.gross_hire),
      commission_type: hire.commission_type,
      commission_rate: n(hire.commission_rate),
      commission_amount: n(hire.commission_amount),
      net_vendor_payable: n(hire.net_vendor_payable),

      remarks: hire.remarks,
      documents_snapshot: hire.documents_snapshot || null,
      documents_expired_ack: hire.documents_expired_ack,
      documents_expired_ack_by: hire.documents_expired_ack_by,
      documents_expired_ack_at: hire.documents_expired_ack_at,

      created_by: hire.created_by,
      created_at: hire.created_at,
      updated_at: hire.updated_at,

      // Stated explicitly so no caller can mistake a hire for a settlement.
      payments: paymentSeparation(hire),
    };
  }

  /**
   * The trip row with everything the hire gate inspects.
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async _loadTripForHire(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError('Trip not found');

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: {
        vehicle: true,
        driver: true,
        transportOwner: true,
        client: true,
        user: true,
        booking: true,
      },
    });

    if (!trip) throw new NotFoundError('Trip not found');
    return trip;
  }

  /**
   * The single validation + calculation path, shared by preview and save.
   *
   * @param {Object} trip
   * @param {Object} input
   * @param {{preview:boolean, user?:Object}} options
   * @returns {Promise<Object>}
   */
  async _resolveTerms(trip, input = {}, { preview, user = null } = {}) {
    // ── 1. Vehicle ─────────────────────────────────────────────────────────
    const vehicleId = Number(input.vehicle_id ?? trip.vehicle_id);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      throw new ValidationError('Select a vehicle before hiring');
    }

    const vehicle = await this.prisma.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      include: { owner: { select: { owner_id: true, owner_name: true, mobile: true, status: true } } },
    });
    if (!vehicle) throw new ValidationError(`Vehicle ${vehicleId} was not found`);

    const vehicleUsability = checkVehicleUsable(vehicle);
    if (!vehicleUsability.usable) throw new ValidationError(vehicleUsability.reason);

    // ── 2. Vendor ──────────────────────────────────────────────────────────
    // Defaults to the vehicle's OWNER, which is the vendor the vehicle belongs
    // to — read from the existing master, never invented.
    const vendorId = Number(input.vendor_id ?? vehicle.owner_id ?? trip.transport_owner_id);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      throw new ValidationError('Select a vehicle vendor before hiring');
    }

    const vendor = await this.prisma.vehicleOwner.findUnique({
      where: { owner_id: vendorId },
      select: { owner_id: true, owner_name: true, mobile: true, status: true, is_active: true },
    });
    if (!vendor) throw new ValidationError(`Vehicle vendor ${vendorId} was not found`);

    if (vendor.status && String(vendor.status).toLowerCase() === 'inactive') {
      throw new ValidationError(`Vehicle vendor ${vendor.owner_name} is inactive and cannot be hired`);
    }

    // ── 3. Driver ──────────────────────────────────────────────────────────
    const driverId = Number(input.driver_id ?? trip.driver_id);
    if (!Number.isInteger(driverId) || driverId <= 0) {
      throw new ValidationError('Select a driver before hiring');
    }

    const driver = await this.prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        status: true,
        is_available: true,
        transport_owner_id: true,
        current_vehicle_id: true,
      },
    });
    if (!driver) throw new ValidationError(`Driver ${driverId} was not found`);

    const driverUsability = checkDriverUsable(driver);
    if (!driverUsability.usable) throw new ValidationError(driverUsability.reason);

    // ── 4. Existing conflict check, reused ─────────────────────────────────
    // A driver/vehicle already carrying a live consignment cannot be engaged on
    // a second one. The trip being hired is excluded so re-entry is safe.
    if (!preview) {
      const { vehicleConflict, driverConflict } = await findActiveTripConflicts(this.prisma, {
        vehicleId,
        driverId,
        excludeTripId: trip.trip_id,
      });
      if (vehicleConflict) {
        throw new ValidationError(
          `Vehicle ${vehicle.vehicle_number} is already engaged on trip ${vehicleConflict.trip_number} (${vehicleConflict.status})`
        );
      }
      if (driverConflict) {
        throw new ValidationError(
          `Driver ${driver.driver_name} is already engaged on trip ${driverConflict.trip_number} (${driverConflict.status})`
        );
      }
    }

    // ── 5. Billing To → Business Model ─────────────────────────────────────
    const billingTo = String(input.billing_to || '').toUpperCase();
    if (!billingTo) throw new ValidationError('Select who the hire is billed to');

    const derivedModel = policy.businessModelForBillingTo(billingTo);
    if (!derivedModel) {
      throw new ValidationError(
        `Invalid billing_to "${input.billing_to}". Expected one of: ${policy.BILLING_TO_OPTIONS
          .map((o) => o.value)
          .join(', ')}`
      );
    }

    // An authorised override is possible and is RECORDED, never silent.
    let businessModel = derivedModel;
    let businessModelOverridden = false;
    const requestedModel = input.business_model
      ? String(input.business_model).toUpperCase()
      : null;

    if (requestedModel && requestedModel !== derivedModel) {
      const role = String(user?.role || '');
      if (!policy.BUSINESS_MODEL_OVERRIDE_ROLES.includes(role)) {
        throw new ForbiddenError(
          `Only ${policy.BUSINESS_MODEL_OVERRIDE_ROLES.join(' or ')} may override the business model derived from Billing To`
        );
      }
      if (!['CONTRACT', 'COMMISSION'].includes(requestedModel)) {
        throw new ValidationError(
          `Invalid business_model "${input.business_model}". Expected CONTRACT or COMMISSION`
        );
      }
      businessModel = requestedModel;
      businessModelOverridden = true;
    }

    // ── 6. Rate As Per → Gross ─────────────────────────────────────────────
    const rateBasis = String(input.rate_basis || policy.DEFAULT_RATE_BASIS).toUpperCase();
    const commissionOption = String(
      input.commission_type || policy.DEFAULT_COMMISSION_TYPE
    ).toUpperCase();

    const rateCalc = this.computeGrossHire({
      rateBasis,
      rate: input.rate_value ?? input.rate,
      quantity: input.rate_quantity ?? input.quantity,
      commissionType: commissionOption,
      commissionRate: input.commission_rate ?? input.commission_percentage
        ?? policy.DEFAULT_COMMISSION_PERCENTAGE,
    });

    // ── 7. Commission → Net ────────────────────────────────────────────────
    const money = this.computeMoney({
      billingTo,
      grossHire: rateCalc.gross_hire,
      commissionType: commissionOption,
      commissionRate: typeDescriptorRate(input, commissionOption),
    });

    // ── 8. Vehicle documents ───────────────────────────────────────────────
    const documents = this.evaluateDocuments(vehicle);
    const expiredCritical = documents.expired_critical;

    if (expiredCritical.length > 0) {
      const acknowledged = input.documents_expired_ack === true;
      const role = String(user?.role || '');
      const mayOverride = policy.EXPIRED_DOCUMENT_OVERRIDE_ROLES.includes(role);

      if (!acknowledged) {
        throw new ValidationError(
          `Vehicle document expired: ${expiredCritical
            .map((d) => `${d.label} ${formatExpiry(d)}`)
            .join(', ')}. Acknowledge the expiry before hiring.`,
          expiredCritical.map((d) => ({
            document: d.label,
            expiry_date: d.expiry_date,
            days_remaining: d.days_remaining,
          }))
        );
      }
      if (!mayOverride && !preview) {
        throw new ForbiddenError(
          `Hiring a vehicle with an expired critical document requires a ${policy.EXPIRED_DOCUMENT_OVERRIDE_ROLES.join(' or ')} account`
        );
      }
    }

    const remarks = input.remarks ? String(input.remarks).trim().slice(0, 2000) : null;

    return {
      // Masters
      vehicle_id: vehicle.vehicle_id,
      vehicle_number: vehicle.vehicle_number,
      vehicle_type: vehicle.vehicle_type,
      vendor_id: vendor.owner_id,
      vendor_name: vendor.owner_name,
      vendor_mobile: vendor.mobile,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      driver_mobile: driver.mobile,

      // Commercial terms
      billing_to: billingTo,
      business_model: businessModel,
      business_model_derived_from: derivedModel,
      business_model_overridden: businessModelOverridden,
      rate_basis: rateCalc.rate_basis,
      rate_value: rateCalc.rate,
      rate_quantity: rateCalc.quantity,
      rate_unit: rateCalc.unit,
      rate_label: rateCalc.rate_label,
      quantity_label: rateCalc.quantity_label,
      commission_type: money.commission_type,
      commission_type_option: money.commission_type_option,
      commission_rate: money.commission_rate,
      commission_label: money.commission_label,
      remarks,

      // Money — always three separate figures
      gross_hire: money.gross_hire,
      commission_amount: money.commission_amount,
      net_vendor_payable: money.net_vendor_payable,

      // Compliance
      documents,
      documents_expired_ack: input.documents_expired_ack === true && expiredCritical.length > 0,
      documents_snapshot: {
        warning_days: documents.warning_days,
        evaluated_at: new Date().toISOString(),
        documents: documents.documents,
      },
    };
  }

  /**
   * The stable printable identifier, derived ONCE from the trip so
   * re-downloading the challan produces the same document.
   * @param {Object} trip
   * @returns {string}
   */
  buildChallanNumber(trip) {
    const year = new Date().getFullYear();
    return `BTVH/${year}/${String(trip.trip_id).padStart(5, '0')}`;
  }

  /**
   * Confirm a vehicle hire — marks the hire as CONFIRMED and updates the trip
   * status to TO_LOADING_POINT, making it operationally ready for loading.
   * Creates a timeline event and audit log entry.
   * @param {number} tripId
   * @param {Object} user
   * @returns {Object}
   */
  async confirmHire(tripId, user = null) {
    const hire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: tripId },
      include: { trip: true },
    });

    if (!hire) {
      throw new NotFoundError('No vehicle hire found for this trip');
    }

    if (hire.status === 'CONFIRMED') {
      throw new ValidationError('Hire is already confirmed');
    }

    if (hire.status === 'CANCELLED') {
      throw new ValidationError('Cannot confirm a cancelled hire');
    }

    // Update hire status to CONFIRMED
    const updatedHire = await this.prisma.vehicleHire.update({
      where: { hire_id: hire.hire_id },
      data: { status: 'CONFIRMED' },
    });

    // Update trip status to TO_LOADING_POINT (operationally ready for loading)
    const updatedTrip = await this.prisma.trip.update({
      where: { trip_id: tripId },
      data: { status: 'TO_LOADING_POINT' },
    });

    // Create timeline event
    await this.prisma.tripTimeline.create({
      data: {
        trip_id: tripId,
        event_type: 'VEHICLE_HIRED',
        description: `Vehicle hire confirmed: ${hire.challan_number || `hire #${hire.hire_id}`}`,
        reference_type: 'VEHICLE_HIRE',
        reference_id: hire.hire_id,
        created_by: user?.id || null,
      },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'VEHICLE_HIRE',
        entity_id: hire.hire_id,
        action: 'CONFIRM',
        user_id: user?.id || null,
        user_role: user?.role || 'system',
        new_value: JSON.stringify({ status: 'CONFIRMED', trip_status: 'TO_LOADING_POINT' }),
        previous_value: JSON.stringify({ status: hire.status, trip_status: hire.trip?.status }),
      },
    });

    return {
      hire: updatedHire,
      trip: updatedTrip,
      message: 'Vehicle hire confirmed successfully',
    };
  }

  /**
   * Cancel a vehicle hire — marks the hire as CANCELLED and reverts the trip
   * status to ASSIGNED (waiting for vehicle). Creates a timeline event and
   * audit log entry with cancellation reason.
   * @param {number} tripId
   * @param {Object} input - { reason }
   * @param {Object} user
   * @returns {Object}
   */
  async cancelHire(tripId, input = {}, user = null) {
    const hire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: tripId },
      include: { trip: true },
    });

    if (!hire) {
      throw new NotFoundError('No vehicle hire found for this trip');
    }

    if (hire.status === 'CANCELLED') {
      throw new ValidationError('Hire is already cancelled');
    }

    const reason = input.reason || 'Cancelled by operator';

    // Update hire status to CANCELLED
    const updatedHire = await this.prisma.vehicleHire.update({
      where: { hire_id: hire.hire_id },
      data: { status: 'CANCELLED' },
    });

    // Revert trip status to ASSIGNED (waiting for vehicle)
    const updatedTrip = await this.prisma.trip.update({
      where: { trip_id: tripId },
      data: { status: 'ASSIGNED' },
    });

    // Create timeline event
    await this.prisma.tripTimeline.create({
      data: {
        trip_id: tripId,
        event_type: 'VEHICLE_HIRE_CANCELLED',
        description: `Vehicle hire cancelled: ${hire.challan_number || `hire #${hire.hire_id}`}. Reason: ${reason}`,
        reference_type: 'VEHICLE_HIRE',
        reference_id: hire.hire_id,
        created_by: user?.id || null,
      },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'VEHICLE_HIRE',
        entity_id: hire.hire_id,
        action: 'CANCEL',
        user_id: user?.id || null,
        user_role: user?.role || 'system',
        new_value: JSON.stringify({ status: 'CANCELLED', trip_status: 'ASSIGNED', reason }),
        previous_value: JSON.stringify({ status: hire.status, trip_status: hire.trip?.status }),
      },
    });

    return {
      hire: updatedHire,
      trip: updatedTrip,
      message: 'Vehicle hire cancelled successfully',
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The commission rate the operator actually entered, interpreted for the
 * selected commission TYPE. `no_commission` is a real stored state (percentage
 * @ 0%), not a missing value, so it never falls back to the policy default.
 *
 * @param {Object} input
 * @param {string} commissionOption - the upper-cased commission TYPE
 * @returns {number}
 */
function typeDescriptorRate(input, commissionOption) {
  if (commissionOption === 'NO_COMMISSION') return 0;

  const descriptor = policy.getCommissionType(commissionOption);
  if (descriptor && descriptor.zero) return 0;

  const raw = input.commission_rate ?? input.commission_percentage;
  if (raw === undefined || raw === null || raw === '') {
    return policy.DEFAULT_COMMISSION_PERCENTAGE;
  }
  return Number(raw);
}

/**
 * Format a document expiry for an error message.
 * @param {Object} doc
 * @returns {string}
 */
function formatExpiry(doc) {
  if (!doc.expiry_date) return 'not recorded';
  return new Date(doc.expiry_date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Payment separation, stated on every serialised hire.
 * A hire creates an obligation; the existing ledger answers "has it been paid".
 * @param {Object} hire
 * @returns {Object}
 */
function paymentSeparation(hire) {
  return {
    // Nothing here is a cash movement. Deliberately no paid_amount / status:
    // duplicating the ledger onto the hire would create two answers that
    // eventually disagree.
    settled: false,
    note: 'Hiring a vehicle creates an obligation. Payment is recorded separately in the vendor ledger.',
    net_payable: hire ? Number(hire.net_vendor_payable) : null,
  };
}

/**
 * Sum one stored hire money column across a set of list rows.
 *
 * Uses the EXISTING `roundMoney` from VehicleHireService — the single canonical
 * money-rounding rule in the repository — rather than a second rounding
 * convention here. Gross, commission and net are summed SEPARATELY by the
 * caller, so the gross is never reduced by the commission on this page; the
 * identity gross − commission = net continues to hold per row, not across a
 * total that mixes unrelated trips.
 *
 * @param {Array<Object>} rows
 * @param {(row:Object)=>*} pick - reads the Decimal column off a row
 * @returns {number}
 */
function sumDecimal(rows, pick) {
  return roundMoney(
    rows.reduce((acc, row) => {
      const v = Number(pick(row));
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0)
  );
}

module.exports = VehicleHireWorkflowService;
module.exports.VehicleHireWorkflowService = VehicleHireWorkflowService;
module.exports.parseDocumentDate = parseDocumentDate;
module.exports.sumDecimal = sumDecimal;