/**
 * TripDispatchService
 * ============================================================================
 * The DISPATCH WORKSPACE: "is this vehicle actually ready to leave the loading
 * point, and if not, exactly what is missing?"
 *
 * WHY THIS EXISTS SEPARATELY FROM TripOperationalService
 *   `TripOperationalService` already owns the LOADED → DISPATCHED edge and its
 *   own readiness check. It is kept, untouched, and still used by the loading
 *   and transit steps, because Phase 4's tests assert on it directly.
 *
 *   What it could not answer is the OPERATOR's question. Its blockers are
 *   generic strings ("Required document E_WAY_BILL is not present"), it has no
 *   concept of an LR/GR number, an e-way bill, transit insurance, a delivery
 *   contact, vehicle-document expiry, or a POD decision, and it has no place to
 *   write the record OF the dispatch act. This service is that missing half:
 *   it produces a structured, per-check readiness report AND performs the
 *   dispatch as one transaction that writes the act, the paperwork snapshot,
 *   the movement-history event and the audit entry together.
 *
 * IT IS SERVER-AUTHORITATIVE (STEP 11)
 *   The browser can only ASK to dispatch a trip. It cannot send a status, and
 *   it cannot send a readiness result. Every truth below is read from
 *   PostgreSQL at the moment of the request.
 *
 * EVERYTHING HAPPENS OR NOTHING HAPPENS (STEP 12)
 *   One `prisma.$transaction` covers: the dispatch record, the trip status and
 *   `dispatched_at`, the POD decision, the movement-history event and the audit
 *   entry. A timeline event can therefore never describe a change that rolled
 *   back, and a dispatch can never land without its history. Validation runs
 *   BEFORE the transaction opens, so a refused dispatch writes nothing at all.
 *
 * IDEMPOTENCY IS ENFORCED TWICE
 *   In code: a trip already at or past DISPATCHED returns the current state
 *   with `idempotent: true` and writes nothing. In the DATABASE:
 *   `trip_dispatches.trip_id` is UNIQUE, so even a race between two concurrent
 *   requests cannot produce two dispatch records.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripDocumentService = require('./TripDocumentService');
const dispatchPolicy = require('../config/dispatchPolicy');
const tripStateMachine = require('../utils/TripStateMachine');

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Statuses that prove a vehicle has already left the loading point. */
const ALREADY_DISPATCHED_STATUSES = Object.freeze([
  'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
]);

/** Mirrors the predicates TripOperationalService already enforces. */
function isVehicleUsable(vehicle) {
  if (!vehicle) return false;
  if (vehicle.is_available === false) return false;
  if (vehicle.current_status === 'off_road') return false;
  if (vehicle.current_status === 'maintenance') return false;
  return true;
}

function isDriverUsable(driver) {
  if (!driver) return false;
  if (driver.is_available === false) return false;
  if (driver.status === 'inactive') return false;
  return true;
}

/** Parse the loose date strings `TransportVehicle` stores its expiries as. */
function parseLooseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumberOrNull(value, label, errors) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`"${label}" must be a number (received "${value}")`);
    return null;
  }
  if (n < 0) {
    errors.push(`"${label}" must not be negative (received ${n})`);
    return null;
  }
  return n;
}

function toDateOrNull(value, label, errors) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    errors.push(`"${label}" is not a valid date (received "${value}")`);
    return null;
  }
  return d;
}

function toBoolOrNull(value, label, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (['true', 'yes', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  errors.push(`"${label}" must be true or false (received "${value}")`);
  return null;
}

/**
 * Join a place and its city WITHOUT repeating the city.
 *
 * Real `pickup_location` values are frequently the full address INCLUDING the
 * city ("Indira IVF Fertility Centre in Patna Sahib"), and naively joining the
 * two columns printed the tail twice on the header, in the loading location and
 * in the dispatch timeline entry. When one string already contains the other,
 * the shorter one adds nothing.
 *
 * @param {string|null} location
 * @param {string|null} city
 * @returns {string|null}
 */
function placeLine(location, city) {
  const loc = String(location || '').trim();
  const cty = String(city || '').trim();
  if (!loc) return cty || null;
  if (!cty) return loc;
  return loc.toLowerCase().includes(cty.toLowerCase()) ? loc : `${loc}, ${cty}`;
}

// ═══════════════════════════════════════════════════════════════════════════

class TripDispatchService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    // The injected client MUST reach the repositories: built with no arguments
    // they fall back to the module-level singleton, which would write a unit
    // test's timeline rows to the real database and, worse, commit outside the
    // caller's transaction.
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
    this.documentService = new TripDocumentService(deps);
  }

  // =========================================================================
  // CONTEXT
  // =========================================================================

  /**
   * Everything the dispatch screen needs about one trip, in ONE round trip.
   *
   * Every relation selected here already exists in the schema; nothing is
   * invented and nothing is a copy. A caller whose client is an older test
   * double may not expose one of the Phase 9 models, so each is looked up
   * defensively and reported as null — a true statement about a trip that has
   * no e-way bill, not an error.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async loadContext(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: {
        vehicle: true,
        driver: true,
        transportOwner: true,
        // `Booking` has NO `client` relation — an offline corporate client is
        // linked to the TRIP (`trips.client_id`), not to the booking. Naming a
        // relation the schema does not define makes Prisma throw before the
        // query ever runs, which is exactly the kind of failure an in-memory
        // test double can never surface.
        booking: { include: { user: true } },
        user: true,
        client: true,
        documents: { orderBy: { document_id: 'asc' } },
      },
    });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    // Phase 9 records. Each is optional in the client so a legacy double works.
    const one = async (model, where) => (this.prisma[model]
      ? this.prisma[model].findFirst({ where })
      : null);

    const [dispatch, ewayBill, insurance] = await Promise.all([
      one('tripDispatch', { trip_id: id }),
      one('ewayBill', { trip_id: id }),
      one('tripInsurance', { trip_id: id }),
    ]);

    const invoice = this.prisma.invoice
      ? await this.prisma.invoice.findFirst({
        where: { trip_id: id },
        orderBy: [{ invoice_id: 'desc' }],
      })
      : null;

    return { trip, dispatch, ewayBill, insurance, invoice };
  }

  // =========================================================================
  // READINESS
  // =========================================================================

  /**
   * The dispatch readiness report.
   *
   * Returns the FULL picture rather than throwing on the first problem, so the
   * operator sees every blocker at once and can fix them in one pass. Each
   * entry in `checks` is independently `passed | failed | warning | pending`
   * and carries the machine-readable reason it is in that state.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getReadiness(tripId) {
    const ctx = await this.loadContext(tripId);
    return this.buildReadiness(ctx);
  }

  /**
   * Build the readiness report from an already-loaded context.
   * @param {Object} ctx  the object returned by `loadContext`
   * @returns {Object}
   */
  buildReadiness(ctx) {
    const { trip, dispatch, ewayBill, insurance } = ctx;
    const checks = [];
    const blockers = [];
    const now = new Date();

    const addCheck = (check) => {
      checks.push(check);
      if (check.state === 'failed' && check.blocking) {
        blockers.push({
          code: check.code,
          // The BLOCKER's own wording is the headline, not the check's. A
          // blocker list reading "Trip status is LOADED" tells an operator
          // nothing; "Loading not completed" tells them exactly what to go and
          // do. The check keeps its precise label; the blocker gets the plain
          // one from config/dispatchPolicy.js.
          label: dispatchPolicy.BLOCKER_META[check.code]?.label || check.label,
          message: check.message,
          ...(check.context ? { context: check.context } : {}),
        });
      }
      return check;
    };

    // ── A. OPERATIONAL POSITION ────────────────────────────────────────────
    const alreadyDispatched = ALREADY_DISPATCHED_STATUSES.includes(trip.status);

    if (trip.status === 'CANCELLED') {
      addCheck({
        key: 'trip_active',
        code: dispatchPolicy.BLOCKER.TRIP_CANCELLED,
        label: 'Consignment active',
        state: 'failed',
        blocking: true,
        message: 'This consignment has been cancelled.',
        detail: `Current status: ${trip.status}`,
      });
    } else {
      addCheck({
        key: 'trip_active',
        code: alreadyDispatched ? 'TRIP_ALREADY_DISPATCHED' : 'TRIP_ACTIVE',
        label: 'Consignment active',
        state: alreadyDispatched ? 'passed' : 'passed',
        blocking: false,
        message: alreadyDispatched
          ? 'This vehicle has already left the loading point.'
          : `Consignment is ${trip.status}.`,
        detail: `Current status: ${trip.status}`,
      });
    }

    // The one status rule that matters: a vehicle may only be dispatched once
    // the loading requirements have actually been completed.
    if (!alreadyDispatched) {
      const statusMessage = dispatchPolicy.STATUS_BLOCKER_MESSAGE[trip.status]
        || 'The trip has not reached the loaded state.';
      const statusOk = trip.status === dispatchPolicy.DISPATCHABLE_STATUS;

      addCheck({
        key: 'trip_status',
        code: statusOk ? 'TRIP_STATUS_LOADED' : dispatchPolicy.BLOCKER.TRIP_NOT_LOADED,
        label: `Trip status is ${dispatchPolicy.DISPATCHABLE_STATUS}`,
        state: statusOk ? 'passed' : 'failed',
        blocking: true,
        message: statusOk
          ? 'The consignment is loaded and awaiting dispatch.'
          : statusMessage,
        detail: `Current status: ${trip.status}`,
        context: { current_status: trip.status, required_status: dispatchPolicy.DISPATCHABLE_STATUS },
      });

      // A LOADED status is only trustworthy if the loading FACT was recorded.
      // This catches a trip that reached LOADED through a legacy path without
      // anyone actually writing down what went on the truck.
      const loadingRecorded = Boolean(trip.loading_completed_at);
      addCheck({
        key: 'loading_completed',
        code: loadingRecorded ? 'LOADING_COMPLETED' : dispatchPolicy.BLOCKER.LOADING_NOT_COMPLETED,
        label: 'Loading completed',
        state: loadingRecorded ? 'passed' : 'failed',
        blocking: true,
        message: loadingRecorded
          ? 'Loading has been completed and recorded.'
          : 'Loading completion has not been recorded for this consignment.',
        detail: trip.loading_completed_at
          ? `Loading completed: ${new Date(trip.loading_completed_at).toISOString()}`
          : 'No loading completion timestamp exists.',
        context: { loading_completed_at: trip.loading_completed_at },
      });
    } else {
      addCheck({
        key: 'trip_status',
        code: 'TRIP_ALREADY_DISPATCHED',
        label: 'Trip status is LOADED',
        state: 'passed',
        blocking: false,
        message: 'Already dispatched.',
        detail: `Current status: ${trip.status}`,
      });
      addCheck({
        key: 'loading_completed',
        code: 'LOADING_COMPLETED',
        label: 'Loading completed',
        state: 'passed',
        blocking: false,
        message: 'Loading was completed before dispatch.',
        detail: trip.loading_completed_at
          ? `Loading completed: ${new Date(trip.loading_completed_at).toISOString()}`
          : null,
      });
    }

    // ── B. VEHICLE ─────────────────────────────────────────────────────────
    const vehicleDocs = this.evaluateVehicleDocuments(trip.vehicle, now);
    const expiredBlockingDocs = vehicleDocs.filter((d) => d.blocking && d.state === 'EXPIRED');

    if (!trip.vehicle_id || !trip.vehicle) {
      addCheck({
        key: 'vehicle_assigned',
        code: dispatchPolicy.BLOCKER.NO_VEHICLE,
        label: 'Vehicle assigned',
        state: 'failed',
        blocking: true,
        message: 'No vehicle is assigned to this consignment.',
        action: 'Hire a vehicle from the Vehicle Hire workspace.',
      });
    } else {
      addCheck({
        key: 'vehicle_assigned',
        code: 'VEHICLE_ASSIGNED',
        label: 'Vehicle assigned',
        state: 'passed',
        blocking: false,
        message: `${trip.vehicle.vehicle_number} is assigned to this consignment.`,
      });
      addCheck({
        key: 'vehicle_available',
        code: isVehicleUsable(trip.vehicle) ? 'VEHICLE_AVAILABLE' : dispatchPolicy.BLOCKER.VEHICLE_UNAVAILABLE,
        label: 'Vehicle available',
        state: isVehicleUsable(trip.vehicle) ? 'passed' : 'failed',
        blocking: true,
        message: isVehicleUsable(trip.vehicle)
          ? 'The assigned vehicle is available for this trip.'
          : `Vehicle ${trip.vehicle.vehicle_number} is marked "${trip.vehicle.current_status || 'unavailable'}".`,
      });
      addCheck({
        key: 'vehicle_documents',
        code: expiredBlockingDocs.length
          ? dispatchPolicy.BLOCKER.VEHICLE_DOCUMENT_EXPIRED
          : 'VEHICLE_DOCUMENTS_OK',
        label: 'Vehicle documents valid',
        state: expiredBlockingDocs.length ? 'failed' : 'passed',
        blocking: Boolean(expiredBlockingDocs.length),
        message: expiredBlockingDocs.length
          ? `Expired vehicle document(s): ${expiredBlockingDocs.map((d) => d.label).join(', ')}.`
          : 'No blocking vehicle document has expired.',
        detail: vehicleDocs.map((d) => `${d.label}: ${d.state}`).join(' · '),
        context: { documents: vehicleDocs },
      });
    }

    // ── C. DRIVER ──────────────────────────────────────────────────────────
    if (!trip.driver_id || !trip.driver) {
      addCheck({
        key: 'driver_assigned',
        code: dispatchPolicy.BLOCKER.NO_DRIVER,
        label: 'Driver assigned',
        state: 'failed',
        blocking: true,
        message: 'No driver is assigned to this consignment.',
        action: 'Assign a driver from the Vehicle Hire workspace.',
      });
    } else {
      addCheck({
        key: 'driver_assigned',
        code: 'DRIVER_ASSIGNED',
        label: 'Driver assigned',
        state: 'passed',
        blocking: false,
        message: `${trip.driver.driver_name} is assigned to this consignment.`,
      });
      addCheck({
        key: 'driver_available',
        code: isDriverUsable(trip.driver) ? 'DRIVER_AVAILABLE' : dispatchPolicy.BLOCKER.DRIVER_UNAVAILABLE,
        label: 'Driver available',
        state: isDriverUsable(trip.driver) ? 'passed' : 'failed',
        blocking: true,
        message: isDriverUsable(trip.driver)
          ? 'The assigned driver is available.'
          : `Driver ${trip.driver.driver_name} is marked "${trip.driver.status || 'unavailable'}".`,
      });
    }

    // ── D. REQUIRED DOCUMENTS (config/tripDocumentPolicy.js owns the set) ───
    const checklist = this._checklistFrom(trip);
    for (const item of checklist) {
      if (!item.required) continue;
      addCheck({
        key: `document_${item.document_type.toLowerCase()}`,
        code: item.satisfied ? `DOCUMENT_${item.document_type}_OK` : dispatchPolicy.BLOCKER.DOCUMENT_MISSING,
        label: this._documentLabel(item.document_type),
        state: item.satisfied ? 'passed' : 'failed',
        blocking: true,
        message: item.satisfied
          ? `${this._documentLabel(item.document_type)} is on file (${item.document_status}).`
          : `${this._documentLabel(item.document_type)} is required for this consignment and is not on file.`,
        context: { document_type: item.document_type, document_status: item.document_status },
      });
    }

    // ── E. LR/GR — the NUMBER, not merely the row ──────────────────────────
    const lrGrNumber = dispatch?.lr_gr_number
      || this._documentNumber(trip.documents, ['LR', 'GR'])
      || null;
    const lrGrDoc = this._document(trip.documents, ['LR', 'GR']);
    addCheck({
      key: 'lr_gr',
      code: lrGrNumber ? 'LR_GR_PRESENT' : dispatchPolicy.BLOCKER.LR_GR_REQUIRED,
      label: 'LR/GR number',
      state: lrGrNumber ? 'passed' : 'failed',
      blocking: Boolean(dispatchPolicy.LR_GR_REQUIRED_DEFAULT),
      message: lrGrNumber
        ? `LR/GR ${lrGrNumber} is on file.`
        : 'An LR/GR number is required before this vehicle can be dispatched.',
      context: { lr_gr_number: lrGrNumber, document_id: lrGrDoc?.document_id || null },
    });

    // ── F. E-WAY BILL — INTERNAL record, honestly labelled ─────────────────
    const eway = this.evaluateEwayBill(trip, ewayBill, now);
    if (eway.required) {
      addCheck({
        key: 'eway_bill',
        code: eway.state === 'passed'
          ? 'EWAY_BILL_PRESENT'
          : eway.state === 'expired'
            ? dispatchPolicy.BLOCKER.EWAY_BILL_EXPIRED
            : dispatchPolicy.BLOCKER.EWAY_BILL_REQUIRED,
        label: 'E-Way Bill',
        state: eway.state === 'passed' || eway.state === 'warning' ? 'passed' : 'failed',
        blocking: true,
        message: eway.message,
        detail: eway.detail,
        context: eway.context,
      });
    } else {
      addCheck({
        key: 'eway_bill',
        code: 'EWAY_BILL_NOT_APPLICABLE',
        label: 'E-Way Bill',
        state: 'warning',
        blocking: false,
        message: eway.message,
        detail: eway.detail,
        context: eway.context,
      });
    }

    // ── G. TRANSIT INSURANCE ───────────────────────────────────────────────
    const ins = this.evaluateInsurance(trip, insurance, now);
    addCheck({
      key: 'insurance',
      code: ins.satisfied ? 'INSURANCE_OK' : dispatchPolicy.BLOCKER.INSURANCE_REQUIRED,
      label: 'Transit insurance',
      // A MISSING policy is only blocking when the policy says it is
      // required. Otherwise it is a warning and dispatch proceeds.
      state: ins.satisfied ? 'passed' : ins.required ? 'failed' : 'warning',
      blocking: ins.required,
      message: ins.message,
      detail: ins.detail,
      context: ins.context,
    });

    // ── H. DELIVERY INFORMATION ────────────────────────────────────────────
    const delivery = this.evaluateDeliveryInfo(trip, dispatch);
    addCheck({
      key: 'delivery_information',
      code: delivery.complete ? 'DELIVERY_INFO_COMPLETE' : dispatchPolicy.BLOCKER.DELIVERY_INFORMATION_INCOMPLETE,
      label: 'Delivery information',
      state: delivery.complete ? 'passed' : 'failed',
      blocking: true,
      message: delivery.message,
      detail: delivery.missing.map((m) => m).join(', ') || null,
      context: { missing: delivery.missing },
    });

    // ── I. THE VERDICT ─────────────────────────────────────────────────────
    const ready = blockers.length === 0;

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,
      ready,
      already_dispatched: alreadyDispatched,
      /** The dispatch record, if this consignment has already been dispatched. */
      dispatch: dispatch || null,
      blockers,
      /** Unique, stable codes — the machine-readable form of `blockers`. */
      blocker_codes: [...new Set(blockers.map((b) => b.code))],
      checks,
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.state === 'passed').length,
        failed: checks.filter((c) => c.state === 'failed').length,
        warning: checks.filter((c) => c.state === 'warning').length,
      },
      eway_bill_integration: EWAY_BILL_INTEGRATION_NOTICE,
    };
  }

  // =========================================================================
  // POLICY EVALUATORS (pure)
  // =========================================================================

  /**
   * The vehicle's statutory papers, read from the columns Phase 8 already
   * added. Read-only: the Vehicle Hire page owns writing them.
   *
   * @param {Object|null} vehicle
   * @param {Date} [now]
   * @returns {Array<{key,label,number,expiry,state,blocking}>}
   */
  evaluateVehicleDocuments(vehicle, now = new Date()) {
    if (!vehicle) return [];
    return dispatchPolicy.VEHICLE_DOCUMENTS.map((spec) => {
      const raw = vehicle[spec.expiry_field];
      const expiry = parseLooseDate(raw);
      const state = expiry
        ? dispatchPolicy.classifyExpiry(expiry, dispatchPolicy.VEHICLE_DOCUMENT_EXPIRING_WITHIN_DAYS, now)
        : 'NOT_RECORDED';
      return {
        key: spec.key,
        label: spec.label,
        number: vehicle[spec.number_field] || null,
        expiry: raw || null,
        state,
        blocking: Boolean(spec.blocking),
      };
    });
  }

  /**
   * The internal e-way bill record, and — stated plainly — the fact that no
   * government API is connected.
   *
   * @param {Object} trip
   * @param {Object|null} ewayBill
   * @param {Date} [now]
   * @returns {Object}
   */
  evaluateEwayBill(trip, ewayBill, now = new Date()) {
    const required = dispatchPolicy.isEwayBillRequired(trip);
    const value = dispatchPolicy.consignmentValueFor(trip);
    const vehicleNumber = trip.vehicle?.vehicle_number || null;

    const context = {
      required,
      government_api_connected: false,
      integration_notice: EWAY_BILL_INTEGRATION_NOTICE,
      consignment_value: value.value,
      consignment_value_source: value.source,
    };

    if (!ewayBill || !ewayBill.eway_bill_number) {
      return {
        required,
        state: required ? 'missing' : 'not_applicable',
        message: required
          ? `An E-Way Bill is required for a consignment valued above ₹${dispatchPolicy.E_WAY_BILL_REQUIRED_ABOVE.toLocaleString('en-IN')} and none has been recorded.`
          : `An E-Way Bill is not required for a consignment valued at ₹${value.value.toLocaleString('en-IN')}.`,
        detail: EWAY_BILL_INTEGRATION_NOTICE,
        context,
      };
    }

    const expiry = ewayBill.expiry_at ? new Date(ewayBill.expiry_at) : null;
    const classification = dispatchPolicy.classifyExpiry(
      expiry,
      dispatchPolicy.E_WAY_BILL_EXPIRING_WITHIN_DAYS,
      now,
    );

    // A vehicle change on the road leaves the paper describing a truck that is
    // no longer on this load. That is an INTERNAL "amend the paper" flag — it
    // is emphatically NOT a claim that the government record was updated.
    const vehicleMismatch = Boolean(
      ewayBill.current_vehicle_number && vehicleNumber && ewayBill.current_vehicle_number !== vehicleNumber,
    );

    context.eway_bill_number = ewayBill.eway_bill_number;
    context.eway_bill_date = ewayBill.eway_bill_date;
    context.expiry_at = ewayBill.expiry_at;
    context.current_vehicle_number = ewayBill.current_vehicle_number;
    context.previous_vehicle_number = ewayBill.previous_vehicle_number;
    context.vehicle_update_required = Boolean(ewayBill.vehicle_update_required || vehicleMismatch);
    context.gov_sync_status = ewayBill.gov_sync_status;
    context.gov_eway_bill_number = ewayBill.gov_eway_bill_number;
    context.gov_synced_at = ewayBill.gov_synced_at;

    if (classification === 'EXPIRED') {
      return {
        required,
        state: 'expired',
        message: `The recorded E-Way Bill ${ewayBill.eway_bill_number} expired on ${new Date(ewayBill.expiry_at).toLocaleDateString('en-IN')}.`,
        detail: EWAY_BILL_INTEGRATION_NOTICE,
        context,
      };
    }

    return {
      required,
      state: classification === 'EXPIRING_SOON' ? 'warning' : 'passed',
      message: `E-Way Bill ${ewayBill.eway_bill_number} is recorded (internal record).`,
      detail: vehicleMismatch
        ? `The recorded vehicle (${ewayBill.current_vehicle_number}) no longer matches the vehicle on this trip (${vehicleNumber}). The paper must be amended.`
        : EWAY_BILL_INTEGRATION_NOTICE,
      context,
    };
  }

  /**
   * Transit insurance for this trip.
   *
   * @param {Object} trip
   * @param {Object|null} insurance
   * @param {Date} [now]
   * @returns {Object}
   */
  evaluateInsurance(trip, insurance, now = new Date()) {
    const requirement = dispatchPolicy.resolveInsuranceRequirement(trip);
    const required = requirement.required;
    const context = {
      required,
      requirement_source: requirement.source,
      insured: Boolean(insurance?.insured),
      insurance_company: insurance?.insurance_company || null,
      policy_number: insurance?.policy_number || null,
      sum_insured: insurance?.sum_insured ?? null,
      goods_value: insurance?.goods_value ?? null,
      valid_to: insurance?.valid_to || null,
      document_id: insurance?.document_id || null,
    };

    if (!insurance || !insurance.insured) {
      return {
        required,
        satisfied: false,
        message: required
          ? 'Transit insurance is required for this consignment and has not been recorded.'
          : 'Transit insurance has not been taken for this consignment. Dispatch may proceed.',
        detail: required ? null : 'This is a warning only: the policy does not require insurance for this consignment.',
        context,
      };
    }

    const classification = dispatchPolicy.classifyExpiry(
      insurance.valid_to,
      dispatchPolicy.INSURANCE_EXPIRING_WITHIN_DAYS,
      now,
    );
    context.status = classification;

    if (classification === 'EXPIRED') {
      return {
        required,
        satisfied: false,
        message: `Transit insurance policy ${insurance.policy_number || ''} expired on ${new Date(insurance.valid_to).toLocaleDateString('en-IN')}.`.trim(),
        detail: null,
        context,
      };
    }

    return {
      required,
      satisfied: true,
      message: classification === 'EXPIRING_SOON'
        ? `Transit insurance ${insurance.policy_number || ''} is valid but expires on ${new Date(insurance.valid_to).toLocaleDateString('en-IN')}.`
        : `Transit insurance ${insurance.policy_number || ''} is valid${insurance.insurance_company ? ` with ${insurance.insurance_company}` : ''}.`,
      detail: null,
      context,
    };
  }

  /**
   * What must be known about the delivery before the vehicle leaves.
   *
   * @param {Object} trip
   * @param {Object|null} dispatch
   * @returns {Object}
   */
  evaluateDeliveryInfo(trip, dispatch) {
    // The consignee is a PERSON AT THE OTHER END, and this schema has never
    // captured one: `Booking` stores the drop PLACE (drop_location / drop_city /
    // drop_address) but no consignee contact. Substituting the customer's own
    // name would be inventing the single most operationally important fact on
    // this screen, so the value comes from the dispatch record only — which is
    // precisely why it is a field captured before the vehicle departs.
    const consigneeName = dispatch?.consignee_name || null;
    const consigneeContact = dispatch?.consignee_contact || null;
    const pod = dispatchPolicy.resolvePodRequirement(trip);

    const missing = [];
    if (!consigneeName) missing.push('consignee_name');
    if (!consigneeContact) missing.push('consignee_contact');

    return {
      complete: missing.length === 0,
      missing,
      consignee_name: consigneeName,
      consignee_contact: consigneeContact,
      // `consignee_address` records a DIFFERENT unloading point; the ordinary
      // drop address stays on the Booking, where it has always lived.
      consignee_address: dispatch?.consignee_address || null,
      drop_address: trip.booking?.drop_address || null,
      delivery_number: dispatch?.delivery_number || null,
      expected_delivery_date: trip.expected_delivery_date || null,
      pod_required: pod.required,
      pod_source: pod.source,
      message: missing.length === 0
        ? `Delivery is booked to ${consigneeName}${pod.required ? ' and proof of delivery is required' : ''}.`
        : `Delivery information is incomplete: ${missing.join(', ')}.`,
    };
  }

  // =========================================================================
  // THE WORKSPACE PAYLOAD
  // =========================================================================

  /**
   * Everything the Dispatch page renders, in one response.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getWorkspace(tripId) {
    const ctx = await this.loadContext(tripId);
    const { trip, dispatch, ewayBill, insurance, invoice } = ctx;
    const readiness = this.buildReadiness(ctx);
    const now = new Date();

    const customer = this._resolveCustomer(trip);
    const charges = await this._resolveCharges(trip);
    const billing = await this._resolveBilling(trip, invoice);

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,

      header: {
        trip_number: trip.trip_number,
        customer,
        route: {
          from: placeLine(trip.pickup_location, trip.pickup_city),
          to: placeLine(trip.drop_location, trip.drop_city),
          distance_km: trip.distance_km ?? null,
        },
        vehicle: trip.vehicle
          ? { vehicle_number: trip.vehicle.vehicle_number, vehicle_type: trip.vehicle.vehicle_type }
          : null,
        driver: trip.driver ? { driver_name: trip.driver.driver_name } : null,
        vendor: trip.transportOwner
          ? { owner_name: trip.transportOwner.owner_name }
          : null,
        current_status: trip.status,
        expected_delivery_date: trip.expected_delivery_date,
      },

      readiness,

      shipment: {
        consignor: trip.client?.company_name || customer?.name || null,
        consignee_name: dispatch?.consignee_name || null,
        consignee_contact: dispatch?.consignee_contact || null,
        pickup: trip.pickup_location,
        pickup_city: trip.pickup_city,
        drop: trip.drop_location,
        drop_city: trip.drop_city,
        goods_description: trip.booking?.goods_description || null,
        planned_quantity: trip.booking?.number_of_items ?? null,
        planned_quantity_unit: trip.booking?.quantity_unit ?? null,
        planned_weight_kg: trip.booking?.goods_weight_kg ?? null,
        actual_quantity: trip.actual_quantity ?? null,
        actual_quantity_unit: trip.actual_quantity_unit ?? null,
        actual_weight_kg: trip.actual_weight_kg ?? null,
        trip_type: trip.source_type,
        distance_km: trip.distance_km ?? null,
        expected_delivery_date: trip.expected_delivery_date,
        value_of_goods: trip.value_of_goods ?? null,
        value_of_goods_source: dispatchPolicy.consignmentValueFor(trip).source,
      },

      vehicle: trip.vehicle
        ? {
          vehicle_number: trip.vehicle.vehicle_number,
          vehicle_type: trip.vehicle.vehicle_type,
          vehicle_name: trip.vehicle.vehicle_name,
          body_type: trip.vehicle.body_type,
          capacity_kg: trip.vehicle.capacity_kg,
          owner: trip.transportOwner?.owner_name || null,
          documents: this.evaluateVehicleDocuments(trip.vehicle, now),
        }
        : null,

      // Admin operational page: the driver's mobile is here on purpose so
      // dispatch can reach them. This payload is never returned by any
      // customer-facing endpoint.
      driver: trip.driver
        ? {
          driver_id: trip.driver.driver_id,
          driver_name: trip.driver.driver_name,
          mobile: trip.driver.mobile ?? null,
          status: trip.driver.status ?? null,
        }
        : null,

      loading: {
        completed: Boolean(trip.loading_completed_at),
        loading_started_at: trip.loading_started_at,
        completed_at: trip.loading_completed_at,
        remarks: trip.loading_remarks,
        loaded_by: trip.loaded_by,
        actual_quantity: trip.actual_quantity ?? null,
        actual_quantity_unit: trip.actual_quantity_unit ?? null,
        actual_weight_kg: trip.actual_weight_kg ?? null,
        location: placeLine(trip.pickup_location, trip.pickup_city),
        sent_to_loading_at: trip.sent_to_loading_at,
        arrived_at_loading_at: trip.arrived_at_loading_at,
      },

      documents: this._documentChecklist(trip),

      lr_gr: {
        required: dispatchPolicy.LR_GR_REQUIRED_DEFAULT,
        number: dispatch?.lr_gr_number || this._documentNumber(trip.documents, ['LR', 'GR']) || null,
        date: lrGrDate(trip),
        document: this._documentSummary(this._document(trip.documents, ['LR', 'GR'])),
        remarks: dispatch?.lr_gr_remarks || null,
      },

      eway_bill: {
        // Explicitly separated: `internal` is what our office has on paper;
        // `government` is what the NIC portal would confirm, and it is empty.
        internal: ewayBill
          ? {
            eway_bill_id: ewayBill.eway_bill_id,
            number: ewayBill.eway_bill_number,
            date: ewayBill.eway_bill_date,
            expiry_at: ewayBill.expiry_at,
            status: ewayBill.internal_status,
            current_vehicle_number: ewayBill.current_vehicle_number,
            previous_vehicle_number: ewayBill.previous_vehicle_number,
            vehicle_update_required: Boolean(ewayBill.vehicle_update_required),
            document: this._documentSummary(
              this._document(trip.documents, ['E_WAY_BILL']),
            ),
            remarks: ewayBill.remarks,
          }
          : null,
        government: ewayBill
          ? {
            sync_status: ewayBill.gov_sync_status,
            eway_bill_number: ewayBill.gov_eway_bill_number,
            synced_at: ewayBill.gov_synced_at,
          }
          : { sync_status: 'NOT_CONNECTED', eway_bill_number: null, synced_at: null },
        api_connected: false,
        integration_notice: EWAY_BILL_INTEGRATION_NOTICE,
      },

      delivery: {
        delivery_number: dispatch?.delivery_number || null,
        consignee_name: dispatch?.consignee_name || null,
        consignee_contact: dispatch?.consignee_contact || null,
        // The ordinary drop address is a pre-existing Booking fact and is READ
        // from there; `consignee_address` records only a different unloading
        // point.
        drop_address: trip.booking?.drop_address || null,
        alternate_unload_address: dispatch?.consignee_address || null,
        expected_delivery_date: trip.expected_delivery_date,
        pod_required: dispatch?.pod_required ?? trip.pod_required ?? dispatchPolicy.POD_REQUIRED_DEFAULT,
      },

      insurance: insurance
        ? {
          insured: Boolean(insurance.insured),
          insurance_company: insurance.insurance_company,
          policy_number: insurance.policy_number,
          sum_insured: insurance.sum_insured,
          goods_value: insurance.goods_value,
          claim_contact: insurance.claim_contact,
          valid_from: insurance.valid_from,
          valid_to: insurance.valid_to,
          status: insurance.status,
          document: this._documentSummary(this._document(trip.documents, ['INSURANCE'])),
          requirement: dispatchPolicy.resolveInsuranceRequirement(trip),
        }
        : {
          insured: false,
          requirement: dispatchPolicy.resolveInsuranceRequirement(trip),
        },

      billing,

      charges,

      dispatch: dispatch
        ? {
          dispatched_at: dispatch.dispatched_at,
          lr_gr_number: dispatch.lr_gr_number,
          invoice_id: dispatch.invoice_id,
          eway_bill_id: dispatch.eway_bill_id,
          pod_required: dispatch.pod_required,
          value_of_goods: dispatch.value_of_goods,
          actual_quantity: dispatch.actual_quantity,
          actual_weight_kg: dispatch.actual_weight_kg,
          created_by: dispatch.created_by,
          created_at: dispatch.created_at,
        }
        : null,

      movement_history: this.prisma.tripTimeline
        ? await this.prisma.tripTimeline.findMany({
          where: { trip_id: trip.trip_id },
          orderBy: [{ created_at: 'desc' }],
          take: 50,
        })
        : [],
    };
  }

  // =========================================================================
  // WRITES — paperwork (no status change)
  // =========================================================================

  /**
   * Record the LR/GR. Delegates to `TripDocumentService`, so there is ONE
   * document module in this system and the LR/GR row is the same row the
   * checklist, the verification and the deletion endpoints already use.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async saveLrGr(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);
    const type = String(input.document_type || 'LR').toUpperCase();
    if (!['LR', 'GR'].includes(type)) {
      throw new ValidationError(`LR/GR document_type must be LR or GR (received "${input.document_type}")`);
    }

    const doc = await this.documentService.recordDocument(tripId, {
      document_type: type,
      document_status: input.document_status || 'PRESENT',
      reference_number: input.reference_number || input.lr_gr_number || null,
      issued_at: input.issued_at || input.date || null,
      file_url: input.file_url || null,
      remarks: input.remarks || null,
    }, user);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const dispatch = await this._upsertDraftDispatch(trip, {
        lr_gr_number: input.reference_number || input.lr_gr_number || doc.reference_number || null,
        lr_gr_document_id: doc.document_id,
        lr_gr_remarks: input.remarks || null,
      }, user, tx);

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'lr_gr_recorded',
        description: `${type} ${doc.reference_number || ''} recorded`.trim(),
        reference_type: 'trip_document',
        reference_id: doc.document_id,
        metadata: { document_type: type, reference_number: doc.reference_number },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_lr_gr_recorded',
        entity_type: 'TripDispatch',
        entity_id: dispatch?.dispatch_id ?? trip.trip_id,
        previous_value: JSON.stringify({ lr_gr_number: dispatch?.previous?.lr_gr_number ?? null }),
        new_value: JSON.stringify({ lr_gr_number: doc.reference_number, document_type: type }),
      }, tx);

      void now;
      return dispatch;
    });

    return { document: doc, dispatch: updated, lr_gr_number: doc.reference_number };
  }

  /**
   * Record or update the INTERNAL e-way bill.
   *
   * This method is explicitly incapable of asserting a government
   * confirmation: `gov_sync_status` is only ever set to NOT_CONNECTED or
   * FAILED here, and the government columns are never written.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async saveEwayBill(tripId, input = {}, user = null) {
    const ctx = await this.loadContext(tripId);
    const { trip, ewayBill } = ctx;

    const errors = [];
    const number = input.eway_bill_number ?? input.reference_number ?? ewayBill?.eway_bill_number ?? null;
    const date = toDateOrNull(input.eway_bill_date ?? input.issued_at, 'eway_bill_date', errors);
    const expiry = toDateOrNull(input.expiry_at ?? input.expires_at, 'expiry_at', errors);
    if (errors.length) throw new ValidationError(`Invalid e-way bill details: ${errors.join('; ')}`);
    if (expiry && date && expiry < date) {
      throw new ValidationError('Invalid e-way bill details: expiry_at cannot be earlier than eway_bill_date');
    }

    const vehicleNumber = input.current_vehicle_number ?? trip.vehicle?.vehicle_number ?? ewayBill?.current_vehicle_number ?? null;

    // A vehicle change is RECORDED, never applied silently: the previous
    // vehicle is kept and an "amendment required" flag is raised. Nothing here
    // says the government paper was updated, because it was not.
    const previousVehicleNumber = ewayBill?.current_vehicle_number
      ?? ewayBill?.previous_vehicle_number
      ?? null;
    const vehicleChanged = Boolean(
      previousVehicleNumber && vehicleNumber && previousVehicleNumber !== vehicleNumber,
    );
    const updateRequired = Boolean(
      vehicleChanged || ewayBill?.vehicle_update_required
      || (input.vehicle_update_required === true),
    );

    const classification = expiry
      ? dispatchPolicy.classifyExpiry(expiry, dispatchPolicy.E_WAY_BILL_EXPIRING_WITHIN_DAYS)
      : 'PENDING';

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const data = {
        trip_id: trip.trip_id,
        eway_bill_number: number,
        eway_bill_date: date ?? ewayBill?.eway_bill_date ?? null,
        expiry_at: expiry ?? ewayBill?.expiry_at ?? null,
        internal_status: classification,
        current_vehicle_number: vehicleNumber,
        previous_vehicle_number: vehicleChanged
          ? previousVehicleNumber
          : (ewayBill?.previous_vehicle_number ?? null),
        vehicle_update_required: updateRequired,
        remarks: input.remarks ?? ewayBill?.remarks ?? null,
        updated_at: now,
        // The government columns are written EXPLICITLY as NULL on create, not
        // merely omitted. "Undefined" and "we have no government confirmation"
        // are different states, and a record that leaves the distinction open
        // is exactly the record that later gets misread as "synced".
        gov_sync_status: ewayBill?.gov_sync_status || 'NOT_CONNECTED',
        gov_eway_bill_number: ewayBill?.gov_eway_bill_number ?? null,
        gov_synced_at: ewayBill?.gov_synced_at ?? null,
        gov_response: ewayBill?.gov_response ?? null,
        created_by: ewayBill?.created_by ?? user?.user_id ?? null,
        created_at: ewayBill?.created_at ?? now,
      };

      const saved = ewayBill
        ? await tx.ewayBill.update({ where: { eway_bill_id: ewayBill.eway_bill_id }, data })
        : await tx.ewayBill.create({ data });

      // The e-way bill PAPER is the same document store as everything else, and
      // recording the row is what satisfies the `E_WAY_BILL` entry in
      // `config/tripDocumentPolicy.REQUIRED_BEFORE_DISPATCH`.
      //
      // It is written whenever a NUMBER exists — not only when a file was
      // attached. An operator who types the e-way bill number into this form
      // HAS the paper (it was issued to them); insisting on a scan before the
      // requirement is satisfied would mean the dispatch gate is really asking
      // "has this been photographed?", which is a different question and not
      // the one the policy asks.
      let document = null;
      if (number || input.file_url || input.document_status) {
        document = await this.documentService.recordDocument(trip.trip_id, {
          document_type: 'E_WAY_BILL',
          document_status: input.document_status || 'PRESENT',
          reference_number: number,
          issued_at: date,
          expires_at: expiry,
          file_url: input.file_url || null,
          remarks: input.remarks || null,
        }, user);
        saved.document_id = document.document_id;
      }

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: ewayBill ? 'eway_bill_updated' : 'eway_bill_recorded',
        description: ewayBill
          ? `Internal E-Way Bill ${number || ''} updated`.trim()
          : `Internal E-Way Bill ${number || ''} recorded`.trim(),
        reference_type: 'eway_bill',
        reference_id: saved.eway_bill_id,
        metadata: {
          eway_bill_number: number,
          vehicle_changed: vehicleChanged,
          previous_vehicle_number: vehicleChanged ? previousVehicleNumber : null,
          government_api_connected: false,
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: ewayBill ? 'trip_eway_bill_updated' : 'trip_eway_bill_recorded',
        entity_type: 'EwayBill',
        entity_id: saved.eway_bill_id,
        previous_value: JSON.stringify({
          eway_bill_number: ewayBill?.eway_bill_number ?? null,
          current_vehicle_number: ewayBill?.current_vehicle_number ?? null,
        }),
        new_value: JSON.stringify({
          eway_bill_number: number,
          current_vehicle_number: vehicleNumber,
          previous_vehicle_number: vehicleChanged ? previousVehicleNumber : null,
          gov_sync_status: 'NOT_CONNECTED',
        }),
      }, tx);

      return { saved, document };
    });

    return {
      eway_bill: result.saved,
      document: result.document,
      government: {
        sync_status: result.saved.gov_sync_status,
        eway_bill_number: result.saved.gov_eway_bill_number,
        synced_at: result.saved.gov_synced_at,
        notice: EWAY_BILL_INTEGRATION_NOTICE,
      },
    };
  }

  /**
   * Record or update the transit insurance for this trip.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async saveInsurance(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);
    const existing = this.prisma.tripInsurance
      ? await this.prisma.tripInsurance.findFirst({ where: { trip_id: trip.trip_id } })
      : null;

    const errors = [];
    const insured = input.insured === undefined
      ? Boolean(existing?.insured)
      : toBoolOrNull(input.insured, 'insured', errors);
    const sumInsured = toNumberOrNull(input.sum_insured ?? existing?.sum_insured, 'sum_insured', errors);
    const goodsValue = toNumberOrNull(input.goods_value ?? existing?.goods_value, 'goods_value', errors);
    const validFrom = toDateOrNull(input.valid_from ?? existing?.valid_from, 'valid_from', errors);
    const validTo = toDateOrNull(input.valid_to ?? existing?.valid_to, 'valid_to', errors);
    if (errors.length) throw new ValidationError(`Invalid insurance details: ${errors.join('; ')}`);
    if (validFrom && validTo && validTo < validFrom) {
      throw new ValidationError('Invalid insurance details: valid_to cannot be earlier than valid_from');
    }
    if (insured && !input.insurance_company && !existing?.insurance_company) {
      throw new ValidationError('Insurance company is required when the consignment is insured');
    }

    const classification = validTo
      ? dispatchPolicy.classifyExpiry(validTo, dispatchPolicy.INSURANCE_EXPIRING_WITHIN_DAYS)
      : 'PENDING';

    const now = new Date();
    const data = {
      trip_id: trip.trip_id,
      insured: Boolean(insured),
      insurance_company: input.insurance_company ?? existing?.insurance_company ?? null,
      policy_number: input.policy_number ?? existing?.policy_number ?? null,
      sum_insured: sumInsured,
      goods_value: goodsValue,
      claim_contact: input.claim_contact ?? existing?.claim_contact ?? null,
      valid_from: validFrom,
      valid_to: validTo,
      status: insured ? classification : 'NOT_APPLICABLE',
      remarks: input.remarks ?? existing?.remarks ?? null,
      created_by: existing?.created_by ?? user?.user_id ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    const saved = await this.prisma.$transaction(async (tx) => {
      let document = null;
      if (input.file_url || input.document_status) {
        document = await this.documentService.recordDocument(trip.trip_id, {
          document_type: 'INSURANCE',
          document_status: input.document_status || 'PRESENT',
          reference_number: input.policy_number ?? null,
          issued_at: validFrom,
          expires_at: validTo,
          file_url: input.file_url || null,
          remarks: input.remarks || null,
        }, user);
        data.document_id = document.document_id;
      }

      const row = existing
        ? await tx.tripInsurance.update({ where: { insurance_id: existing.insurance_id }, data })
        : await tx.tripInsurance.create({ data });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: existing ? 'insurance_updated' : 'insurance_recorded',
        description: existing
          ? `Transit insurance ${row.policy_number || ''} updated`.trim()
          : `Transit insurance ${row.policy_number || ''} recorded`.trim(),
        reference_type: 'trip_insurance',
        reference_id: row.insurance_id,
        metadata: { insured: row.insured, policy_number: row.policy_number, status: row.status },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: existing ? 'trip_insurance_updated' : 'trip_insurance_recorded',
        entity_type: 'TripInsurance',
        entity_id: row.insurance_id,
        previous_value: JSON.stringify({
          insured: existing?.insured ?? null,
          policy_number: existing?.policy_number ?? null,
          sum_insured: existing?.sum_insured ?? null,
        }),
        new_value: JSON.stringify({
          insured: row.insured,
          policy_number: row.policy_number,
          sum_insured: row.sum_insured,
        }),
      }, tx);

      return { row, document };
    });

    return saved;
  }

  /**
   * Save the delivery facts and the POD decision WITHOUT dispatching.
   *
   * These are captured before the vehicle leaves precisely because they cannot
   * be recovered from a truck that has already gone.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async saveDeliveryInfo(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);
    const existing = this.prisma.tripDispatch
      ? await this.prisma.tripDispatch.findFirst({ where: { trip_id: trip.trip_id } })
      : null;

    const errors = [];
    const podRequired = input.pod_required === undefined
      ? (existing?.pod_required ?? trip.pod_required ?? null)
      : toBoolOrNull(input.pod_required, 'pod_required', errors);
    const valueOfGoods = toNumberOrNull(
      input.value_of_goods === undefined
        ? (existing?.value_of_goods ?? trip.value_of_goods)
        : input.value_of_goods,
      'value_of_goods',
      errors,
    );
    if (errors.length) throw new ValidationError(`Invalid delivery information: ${errors.join('; ')}`);

    /**
     * THREE-STATE FIELD SEMANTICS, AND WHY THEY DIFFER HERE
     *
     * Everywhere else on this service "null means keep what was there" is the
     * right rule, because a paperwork save must never blank a field another
     * operator typed earlier. It is the WRONG rule for the delivery block,
     * which exists to be EDITED: an operator who clears the consignee field is
     * removing a fact, and if that silently did nothing the screen would appear
     * to save and the readiness report would still say "complete".
     *
     * So here, and only here:
     *   key absent (undefined) → keep the stored value
     *   key = null              → CLEAR it
     *   key = anything else     → set it
     */
    const field = (key) => {
      if (input[key] === undefined) return existing?.[key] ?? null;
      return input[key] || null;
    };

    const patch = {
      delivery_number: field('delivery_number'),
      consignee_name: field('consignee_name'),
      consignee_contact: field('consignee_contact'),
      consignee_address: field('consignee_address'),
      value_of_goods: valueOfGoods,
      pod_required: podRequired === null ? false : podRequired,
    };

    const dispatch = await this._upsertDraftDispatch(trip, patch, user, null, { allowClear: true });
    if (valueOfGoods !== null) {
      await this.prisma.trip.update({ where: { trip_id: trip.trip_id }, data: { value_of_goods: valueOfGoods } });
    }
    if (podRequired !== null) {
      await this.prisma.trip.update({ where: { trip_id: trip.trip_id }, data: { pod_required: podRequired } });
    }

    return dispatch;
  }

  // =========================================================================
  // THE DISPATCH
  // =========================================================================

  /**
   * Dispatch the vehicle.
   *
   * The order below is deliberate and is the whole safety argument:
   *   1. load the trip
   *   2. refuse a repeat (idempotent)
   *   3. compute readiness and refuse if blocked
   *   4. validate every supplied field
   *   5. ONLY THEN open a transaction that writes the act, the status, the
   *      movement-history event and the audit entry together
   *
   * Steps 1–4 write nothing, so a refused dispatch leaves the database exactly
   * as it was — not a status change without paperwork, and not a paperwork
   * record for a dispatch that never happened.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<{trip:Object, dispatch:Object, idempotent:boolean}>}
   */
  async dispatch(tripId, input = {}, user = null) {
    // ── 1–2. Load, then refuse a repeat ─────────────────────────────────────
    const ctx = await this.loadContext(tripId);
    const { trip, dispatch: existingDispatch } = ctx;

    // A `trip_dispatches` row with status PENDING is a DRAFT: the paperwork was
    // captured while the truck was still at the loading point, and the vehicle
    // has NOT left. Treating that as "already dispatched" would make the whole
    // "save the LR before departure" flow permanently unable to dispatch.
    //
    // Idempotency is therefore keyed on the trip having actually LEFT, which is
    // what the DISPATCHED row status and the trip status both record.
    const leftTheLoadingPoint = (existingDispatch?.status === 'DISPATCHED')
      || ALREADY_DISPATCHED_STATUSES.includes(trip.status);

    if (leftTheLoadingPoint) {
      return {
        trip,
        dispatch: existingDispatch,
        idempotent: true,
        status: trip.status,
        message: 'This consignment has already been dispatched.',
      };
    }

    // ── 3. Readiness ────────────────────────────────────────────────────────
    const readiness = this.buildReadiness(ctx);
    if (!readiness.ready) {
      // Deduplicated on purpose. Three missing documents produce three blockers
      // whose plain-language label is the same sentence, and "Required document
      // missing, Required document missing, Required document missing" reads
      // like a bug in the report rather than a list of three papers to fetch.
      // The FULL list is still returned in `details` for the UI to itemise.
      const labels = [...new Set(readiness.blockers.map((b) => b.label))];
      throw new ValidationError({
        message: 'Dispatch cannot be completed because the following requirement is missing: '
          + `${labels.join(', ')}.`,
        details: readiness.blockers,
      });
    }

    // ── 4. Validate the operator's input ───────────────────────────────────
    const clean = this.validateDispatchInput(input, trip);

    // The state machine is the last word on the edge itself, so the rule
    // "LOADED → DISPATCHED, and nothing else" is enforced by the same module
    // that governs every other trip transition.
    tripStateMachine.validateOperationalTransition(trip.status, 'DISPATCHED');

    // ── 5. ONE transaction ──────────────────────────────────────────────────
    const now = new Date();

    // The paperwork the vehicle actually LEAVES with is what the body supplies,
    // falling back to what is already on file. Without the fallback, an operator
    // who recorded the e-way bill yesterday and dispatched today would get a
    // movement-history entry claiming no e-way bill — a record of the trip that
    // contradicts the record of the paperwork.
    const lrGrNumber = clean.lr_gr_number || ctx.dispatch?.lr_gr_number || null;
    const ewayBillNumber = clean.eway_bill_number || ctx.ewayBill?.eway_bill_number || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const dispatchRow = await this._upsertDispatchRow(trip, clean, user, now, tx);

      const updatedTrip = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          status: 'DISPATCHED',
          dispatched_at: now,
          updated_at: now,
          // The POD decision is written to the TRIP as well as the dispatch
          // record, because the delivery and completion workflows read a trip
          // column and must not have to join the dispatch act to know whether
          // proof of delivery is being collected.
          ...(clean.pod_required === null ? {} : { pod_required: clean.pod_required }),
          ...(clean.value_of_goods === null ? {} : { value_of_goods: clean.value_of_goods }),
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'vehicle_dispatched',
        description: 'Vehicle dispatched',
        reference_type: 'trip_dispatch',
        reference_id: dispatchRow.dispatch_id,
        metadata: {
          from: trip.status,
          to: 'DISPATCHED',
          vehicle_number: trip.vehicle?.vehicle_number || null,
          driver_name: trip.driver?.driver_name || null,
          lr_gr_number: lrGrNumber,
          eway_bill_number: ewayBillNumber,
          // Recorded on the event so a reader years later knows the number in
          // this entry was OUR office record, not a government confirmation.
          eway_bill_source: 'INTERNAL_RECORD',
          government_eway_bill_api_connected: false,
          invoice_id: clean.invoice_id || null,
          pod_required: dispatchRow.pod_required,
          location: placeLine(trip.pickup_location, trip.pickup_city),
          trip_number: trip.trip_number,
          recorded_by: user?.name || user?.email || null,
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_dispatched',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: trip.status, dispatched_at: null }),
        new_value: JSON.stringify({
          status: 'DISPATCHED',
          dispatched_at: now,
          lr_gr_number: lrGrNumber,
          eway_bill_number: ewayBillNumber,
          eway_bill_source: 'INTERNAL_RECORD',
          pod_required: dispatchRow.pod_required,
          vehicle_number: trip.vehicle?.vehicle_number || null,
        }),
      }, tx);

      return { dispatchRow, updatedTrip };
    });

    return {
      trip: result.updatedTrip,
      dispatch: result.dispatchRow,
      idempotent: false,
      status: 'DISPATCHED',
      movement_history_recorded: true,
    };
  }

  /**
   * Validate everything an operator may supply at dispatch.
   *
   * Nothing here has a default that invents a fact. An absent optional field
   * stays null and is simply not written, so a dispatch never writes an
   * invented LR number or a made-up e-way bill.
   *
   * @param {Object} input
   * @param {Object} trip
   * @returns {Object}
   */
  validateDispatchInput(input = {}, trip = {}) {
    const errors = [];

    const podRequired = toBoolOrNull(input.pod_required, 'pod_required', errors);
    const valueOfGoods = toNumberOrNull(input.value_of_goods, 'value_of_goods', errors);
    const actualQuantity = toNumberOrNull(
      input.actual_quantity ?? trip.actual_quantity, 'actual_quantity', errors,
    );
    const actualWeight = toNumberOrNull(
      input.actual_weight_kg ?? trip.actual_weight_kg, 'actual_weight_kg', errors,
    );
    const invoiceId = input.invoice_id === undefined || input.invoice_id === null || input.invoice_id === ''
      ? null
      : Number(input.invoice_id);
    if (invoiceId !== null && !Number.isInteger(invoiceId)) {
      errors.push(`"invoice_id" must be an integer (received "${input.invoice_id}")`);
    }

    const ewayBillNumber = input.eway_bill_number ? String(input.eway_bill_number).trim() : null;
    if (ewayBillNumber !== null && ewayBillNumber.length > 64) {
      errors.push('"eway_bill_number" must be 64 characters or fewer');
    }

    const lrGrNumber = input.lr_gr_number ? String(input.lr_gr_number).trim() : null;
    if (lrGrNumber !== null && lrGrNumber.length > 64) {
      errors.push('"lr_gr_number" must be 64 characters or fewer');
    }

    if (errors.length) {
      throw new ValidationError(`Invalid dispatch details: ${errors.join('; ')}`);
    }

    return {
      lr_gr_number: lrGrNumber,
      lr_gr_document_id: input.lr_gr_document_id ? Number(input.lr_gr_document_id) : null,
      lr_gr_remarks: input.lr_gr_remarks || null,
      delivery_number: input.delivery_number || null,
      consignee_name: input.consignee_name || null,
      consignee_contact: input.consignee_contact || null,
      consignee_address: input.consignee_address || null,
      value_of_goods: valueOfGoods,
      actual_quantity: actualQuantity,
      actual_quantity_unit: input.actual_quantity_unit || trip.actual_quantity_unit || null,
      actual_weight_kg: actualWeight,
      eway_bill_number: ewayBillNumber,
      invoice_id: invoiceId,
      pod_required: podRequired,
      dispatch_origin: input.dispatch_origin || 'ADMIN',
      remarks: input.remarks || null,
    };
  }

  // =========================================================================
  // INTERNAL
  // =========================================================================

  /**
   * Create or update the dispatch row inside a transaction.
   *
   * `trip_dispatches.trip_id` is UNIQUE, so a second row is impossible; the
   * update branch exists for the paperwork being saved BEFORE the truck
   * leaves, which is exactly what the `status: 'PENDING'` draft is for.
   *
   * @private
   */
  async _upsertDispatchRow(trip, clean, user, now, tx) {
    const data = {
      trip_id: trip.trip_id,
      dispatched_at: now,
      dispatch_origin: clean.dispatch_origin || 'ADMIN',
      lr_gr_number: clean.lr_gr_number,
      lr_gr_document_id: clean.lr_gr_document_id,
      lr_gr_remarks: clean.lr_gr_remarks,
      delivery_number: clean.delivery_number,
      consignee_name: clean.consignee_name,
      consignee_contact: clean.consignee_contact,
      consignee_address: clean.consignee_address,
      value_of_goods: clean.value_of_goods,
      actual_quantity: clean.actual_quantity,
      actual_quantity_unit: clean.actual_quantity_unit,
      actual_weight_kg: clean.actual_weight_kg,
      invoice_id: clean.invoice_id,
      pod_required: clean.pod_required === null ? false : clean.pod_required,
      status: 'DISPATCHED',
      created_by: user?.user_id || null,
      updated_at: now,
    };

    const existing = tx.tripDispatch
      ? await tx.tripDispatch.findFirst({ where: { trip_id: trip.trip_id } })
      : null;

    if (existing) {
      // Only overwrite what the operator actually supplied: a dispatch that
      // says nothing about the LR must not blank an LR recorded earlier.
      const patch = { dispatched_at: now, status: 'DISPATCHED', updated_at: now };
      for (const key of Object.keys(data)) {
        if (key === 'trip_id' || key === 'status' || key === 'dispatched_at' || key === 'updated_at') continue;
        const value = data[key];
        if (value === null || value === undefined) continue;
        patch[key] = value;
      }
      return tx.tripDispatch.update({ where: { dispatch_id: existing.dispatch_id }, data: patch });
    }

    return tx.tripDispatch.create({
      data: { ...data, created_at: now },
    });
  }

  /**
   * Save paperwork as a DRAFT dispatch row — everything the dispatch will
   * eventually record, captured while the truck is still at the loading point.
   *
   * `allowClear` switches the update branch from "never blank a field another
   * operator typed" to "an explicit null clears it". Only the delivery block
   * asks for it; see `saveDeliveryInfo` for why that one field is different.
   * @private
   */
  async _upsertDraftDispatch(trip, patch, user, tx = null, { allowClear = false } = {}) {
    if (!this.prisma.tripDispatch) return null;
    const now = new Date();
    const run = tx || this.prisma;
    const existing = await run.tripDispatch.findFirst({ where: { trip_id: trip.trip_id } });
    const data = { ...patch, updated_at: now };

    if (existing) {
      const clean = {};
      for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined) {
          if (allowClear) clean[k] = null;
          continue;
        }
        clean[k] = v;
      }
      const updated = await run.tripDispatch.update({
        where: { dispatch_id: existing.dispatch_id },
        data: clean,
      });
      return { ...updated, previous: existing };
    }

    const created = await run.tripDispatch.create({
      data: {
        trip_id: trip.trip_id,
        dispatched_at: now,
        status: 'PENDING',
        created_by: user?.user_id || null,
        created_at: now,
        ...data,
      },
    });
    return { ...created, previous: null };
  }

  /** Load a trip or throw a user-facing 404. @private */
  async _loadTrip(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });
    const trip = await this.prisma.trip.findUnique({ where: { trip_id: id } });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });
    return trip;
  }

  /**
   * The document checklist, computed from an already-loaded trip.
   *
   * Mirrors `TripDocumentService.getChecklist` but works off the `documents`
   * relation so the workspace costs one query instead of two.
   * @private
   */
  _checklistFrom(trip) {
    // eslint-disable-next-line global-require
    const documentPolicy = require('../config/tripDocumentPolicy');
    const documents = trip.documents || [];
    const byType = new Map(documents.map((d) => [d.document_type, d]));
    const required = documentPolicy.requiredDocumentsFor(trip);

    return documentPolicy.DOCUMENT_TYPES.map((type) => {
      const doc = byType.get(type) || null;
      const expired = Boolean(
        doc && (doc.document_status === 'EXPIRED' || (doc.expires_at && new Date(doc.expires_at) < new Date())),
      );
      return {
        document_type: type,
        required: required.includes(type),
        document_status: doc ? doc.document_status : 'PENDING',
        is_present: Boolean(doc),
        // Expiry is judged HERE rather than trusting the stored status, so a
        // document whose date has passed can never satisfy a requirement
        // simply because nobody has updated its row.
        satisfied: Boolean(doc) && !expired && documentPolicy.SATISFIES_REQUIREMENT.includes(doc.document_status),
      };
    });
  }

  /** The document checklist WITH upload metadata, for the UI. @private */
  _documentChecklist(trip) {
    return this._checklistFrom(trip).map((item) => {
      const doc = (trip.documents || []).find((d) => d.document_type === item.document_type) || null;
      return {
        ...item,
        reference_number: doc?.reference_number || null,
        issued_at: doc?.issued_at || null,
        expires_at: doc?.expires_at || null,
        file_url: doc?.file_url || null,
        is_uploaded: Boolean(doc?.is_uploaded),
        verified: Boolean(doc?.is_verified),
        verified_by: doc?.verified_by || null,
        verified_at: doc?.verified_at || null,
        remarks: doc?.remarks || null,
        uploaded_at: doc?.created_at || null,
        created_by: doc?.created_by || null,
        document_id: doc?.document_id || null,
      };
    });
  }

  /** @private */
  _document(documents = [], types = []) {
    return types.map((t) => documents.find((d) => d.document_type === t)).find(Boolean) || null;
  }

  /** @private */
  _documentNumber(documents = [], types = []) {
    return this._document(documents, types)?.reference_number || null;
  }

  /** @private */
  _documentLabel(type) {
    const LABELS = {
      LR: 'LR / GR',
      GR: 'LR / GR',
      INVOICE: 'Party Invoice / Bill',
      E_WAY_BILL: 'E-Way Bill',
      INSURANCE: 'Insurance Certificate',
      PERMIT: 'Permit',
      FITNESS: 'Fitness Certificate',
      RC: 'RC',
      POD: 'Proof of Delivery',
      OTHER: 'Other Document',
    };
    return LABELS[type] || type;
  }

  /** @private */
  _documentSummary(doc) {
    if (!doc) return null;
    return {
      document_id: doc.document_id,
      status: doc.document_status,
      reference_number: doc.reference_number,
      file_url: doc.file_url,
      is_uploaded: Boolean(doc.is_uploaded),
      verified: Boolean(doc.is_verified),
      uploaded_at: doc.created_at,
      uploaded_by: doc.created_by,
    };
  }

  /** @private */
  _resolveCustomer(trip) {
    if (trip.client) {
      return {
        kind: 'CLIENT',
        id: trip.client.client_id,
        name: trip.client.company_name,
        contact_person: trip.client.contact_person,
        phone: trip.client.phone,
        email: trip.client.email,
        address: trip.client.address,
        city: trip.client.city,
        gst_number: trip.client.gst_number,
      };
    }
    const user = trip.booking?.user || trip.user;
    if (user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
      return {
        kind: 'USER',
        id: user.user_id,
        name,
        contact_person: user.first_name || null,
        phone: user.phone ?? null,
        email: user.email ?? null,
        address: null,
        city: null,
        gst_number: null,
      };
    }
    return null;
  }

  /**
   * The ADDITIONAL CHARGES, read from the one commercial source that already
   * exists — the confirmed Quotation. No second charge table, and no
   * recalculation of the freight on the dispatch screen.
   * @private
   */
  async _resolveCharges(trip) {
    const bookingId = trip.booking_id;
    if (!bookingId || !this.prisma.quotation) {
      return { source: 'NONE', lines: [], total: 0 };
    }

    let booking = trip.booking;
    if (!booking) {
      booking = await this.prisma.booking.findUnique({
        where: { booking_id: bookingId },
        include: { quotationSnapshot: true },
      });
    }

    // The Booking snapshot is preferred: it is the frozen commercial decision
    // taken at confirmation, so it is what the customer agreed to pay.
    const snapshot = booking?.quotationSnapshot;
    if (!snapshot) {
      return { source: 'BOOKING', lines: [], total: Number(trip.freight_amount || 0) };
    }

    const lines = [];
    if (this.prisma.quotationCharge && snapshot.quotation_id) {
      const charges = await this.prisma.quotationCharge.findMany({
        where: { quotation_id: snapshot.quotation_id },
        orderBy: [{ sort_order: 'asc' }],
      });
      for (const c of charges) {
        lines.push({
          charge_name: c.charges_name,
          rate: c.rate,
          quantity: c.quantity,
          quantity_unit: c.quantity_unit,
          total: c.total,
        });
      }
    }

    return {
      source: 'QUOTATION_SNAPSHOT',
      freight: Number(trip.freight_amount || 0),
      additional_charges_total: Number(snapshot.total_additional_charges || 0),
      additional_charges_tax: Number(snapshot.additional_charges_tax || 0),
      gst_type: snapshot.gst_type,
      gst_percentage: snapshot.gst_percentage,
      gst_amount: snapshot.gst_amount,
      total_billing_amount: Number(snapshot.total_billing_amount || 0),
      lines,
    };
  }

  /**
   * The CUSTOMER BILLING section, read from the existing ledger.
   *
   * The invoice is a document; the money is `FinancialTransaction`. Both are
   * reported, and neither is inferred from the other. Nothing here can mark an
   * invoice paid because a trip was dispatched — dispatch has no effect on this
   * object at all, which is the point.
   * @private
   */
  async _resolveBilling(trip, invoice) {
    const customerPayments = this.prisma.financialTransaction
      ? await this.prisma.financialTransaction.findMany({
        where: {
          trip_id: trip.trip_id,
          transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
          status: { not: 'CANCELLED' },
        },
        orderBy: [{ transaction_date: 'desc' }],
      })
      : [];

    const received = customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const invoiceTotal = invoice
      ? Number(invoice.grand_total ?? invoice.total_amount ?? invoice.final_price ?? 0)
      : null;

    return {
      customer: this._resolveCustomer(trip),
      invoice: invoice
        ? {
          invoice_id: invoice.invoice_id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date || invoice.issued_at || invoice.created_at,
          status: invoice.status,
          payment_status: invoice.payment_status,
          document_kind: invoice.document_kind,
          // Stated, not implied: this is NOT a government e-invoice.
          is_government_e_invoice: false,
          irn: invoice.irn || null,
          freight: Number(invoice.goods_amount ?? trip.freight_amount ?? 0),
          additional_charges: Number(invoice.extra_charges ?? 0),
          taxable_amount: invoice.taxable_amount ?? null,
          gst_type: invoice.gst_type ?? null,
          gst_percentage: invoice.gst_percentage ?? null,
          cgst: invoice.cgst ?? null,
          sgst: invoice.sgst ?? null,
          igst: invoice.igst ?? null,
          tax_total: invoice.tax_amount ?? null,
          total: invoiceTotal,
          billing_to: invoice.billing_to ?? null,
          gst_number: invoice.gst_number ?? null,
          pdf_generated_at: invoice.pdf_generated_at ?? null,
        }
        : null,
      // Derived from the LEDGER, never from the invoice's own status column,
      // so a document state and a cash state can never contradict each other.
      //
      // `balance` is NULL — not zero, and not a negative number — when no
      // invoice has been raised. There is no "balance" against no bill, and
      // printing a negative figure because cash arrived before the invoice did
      // would be actively misleading.
      total_received: received,
      invoice_total: invoiceTotal,
      balance: invoiceTotal === null ? null : Math.round((invoiceTotal - received) * 100) / 100,
      billing_status: invoiceTotal === null ? 'UNBILLED' : 'BILLED',
      note: invoiceTotal === null
        ? 'No customer invoice has been raised for this consignment yet. Cash already in the ledger is shown above.'
        : null,
      payments: customerPayments.map((p) => ({
        transaction_id: p.transaction_id,
        amount: p.amount,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        transaction_date: p.transaction_date,
        status: p.status,
        invoice_id: p.invoice_id,
      })),
    };
  }
}

/**
 * The honest, single sentence the UI shows wherever an e-way bill appears.
 *
 * It is a CONSTANT rather than a per-trip string so that no screen can ever
 * drift into implying that the government portal was contacted. There is no
 * government e-way bill API in this system.
 */
const EWAY_BILL_INTEGRATION_NOTICE =
  'Internal record only — Government E-Way Bill API not connected.';

/**
 * The date an LR/GR was issued.
 *
 * Read from the `trip_documents` row, which is where the issue date actually
 * lives. The dispatch record holds the NUMBER and the act; it deliberately does
 * not duplicate a date the document store already owns.
 */
function lrGrDate(trip) {
  const doc = (trip.documents || [])
    .find((d) => d.document_type === 'LR' || d.document_type === 'GR');
  return doc?.issued_at || null;
}

module.exports = TripDispatchService;
module.exports.TripDispatchService = TripDispatchService;
module.exports.EWAY_BILL_INTEGRATION_NOTICE = EWAY_BILL_INTEGRATION_NOTICE;
module.exports.isVehicleUsable = isVehicleUsable;
module.exports.isDriverUsable = isDriverUsable;
module.exports.ALREADY_DISPATCHED_STATUSES = ALREADY_DISPATCHED_STATUSES;
