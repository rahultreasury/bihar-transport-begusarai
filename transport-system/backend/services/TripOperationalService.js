/**
 * TripOperationalService
 * ---------------------------------------------------------------------------
 * The operational lifecycle between "vehicle hired" and "in transit":
 *
 *     ASSIGNED ─► TO_LOADING_POINT ─► AT_LOADING_POINT ─► LOADED
 *                    ─► DISPATCHED ─► IN_TRANSIT
 *
 * This service is SERVER-AUTHORITATIVE. It loads the Trip from the database,
 * validates the CURRENT status itself, and then moves it. It never accepts a
 * status from the browser and stores it — the caller can only ASK for a named
 * operation ("dispatch this trip"), never TELL the service what the answer
 * should be (STEP 11).
 *
 * WHY THIS EXISTS SEPARATELY FROM TripService.updateTripStatus()
 *   `updateTripStatus` is the pre-existing administrative status control that
 *   the shipped admin UI calls. It stays where it is and keeps working. This
 *   service is the operational path, and it is strict: the full loading chain
 *   is mandatory and no legacy short-cut is available here. That separation is
 *   what lets Phase 4 add the workflow without redesigning the existing UI.
 *
 * EVERY TRANSITION IS ATOMIC AND RECORDED
 *   One database transaction covers: the Trip status change, the operational
 *   fact columns, the append-only TripTimeline event, and the AuditLog entry.
 *   A timeline event can therefore never exist for a change that rolled back,
 *   and a change can never land without its history.
 *
 * IDEMPOTENCY (STEP 12)
 *   Each operation is idempotent by TARGET STATE, not by a key: if the trip is
 *   already in (or has already passed through) the state the operation
 *   produces, the request succeeds and returns the current trip UNCHANGED,
 *   writing no second timeline event. That makes a double click, a browser
 *   retry and an API retry all safe without any client cooperation and without
 *   inventing an idempotency header contract the existing UI does not send.
 *
 * ACTUAL vs PLANNED (STEP 6)
 *   Loading records what was ACTUALLY weighed and counted, into
 *   trips.actual_*. The PLANNED material / quantity / weight stay on the
 *   Booking and are read-only here, so a variance is recorded and the
 *   customer's original declaration is never overwritten.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripDocumentService = require('./TripDocumentService');
const tripStateMachine = require('../utils/TripStateMachine');
const documentPolicy = require('../config/tripDocumentPolicy');
const stagePolicy = require('../config/tripStagePolicy');

/**
 * The operational transitions this service performs. Kept as data so the
 * route layer and the tests read from the same table the service enforces.
 */
const OPERATIONS = Object.freeze({
  SEND_TO_LOADING_POINT: 'SEND_TO_LOADING_POINT',
  ARRIVE_AT_LOADING_POINT: 'ARRIVE_AT_LOADING_POINT',
  START_LOADING: 'START_LOADING',
  COMPLETE_LOADING: 'COMPLETE_LOADING',
  DISPATCH: 'DISPATCH',
  // Phase 5 — the canonical DISPATCHED → IN_TRANSIT step.
  START_TRANSIT: 'START_TRANSIT',
});

/** What each operation sets the status to. */
const OPERATION_TARGET = Object.freeze({
  [OPERATIONS.SEND_TO_LOADING_POINT]: 'TO_LOADING_POINT',
  [OPERATIONS.ARRIVE_AT_LOADING_POINT]: 'AT_LOADING_POINT',
  [OPERATIONS.START_LOADING]: 'AT_LOADING_POINT',
  [OPERATIONS.COMPLETE_LOADING]: 'LOADED',
  [OPERATIONS.DISPATCH]: 'DISPATCHED',
  [OPERATIONS.START_TRANSIT]: 'IN_TRANSIT',
});

/** Human labels used in the timeline and audit entries. */
const OPERATION_LABEL = Object.freeze({
  [OPERATIONS.SEND_TO_LOADING_POINT]: 'Sent to loading point',
  [OPERATIONS.ARRIVE_AT_LOADING_POINT]: 'Arrived at loading point',
  [OPERATIONS.START_LOADING]: 'Loading started',
  [OPERATIONS.COMPLETE_LOADING]: 'Loaded',
  [OPERATIONS.DISPATCH]: 'Dispatched',
  [OPERATIONS.START_TRANSIT]: 'Started transit',
});

/**
 * Statuses that already prove an operation happened. Used for idempotency:
 * a trip in one of these has already been through the operation.
 */
const OPERATION_SATISFIED_BY = Object.freeze({
  [OPERATIONS.SEND_TO_LOADING_POINT]: [
    'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ],
  [OPERATIONS.ARRIVE_AT_LOADING_POINT]: [
    'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ],
  [OPERATIONS.COMPLETE_LOADING]: [
    'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ],
  [OPERATIONS.DISPATCH]: [
    'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ],
  [OPERATIONS.START_TRANSIT]: [
    'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ],
});

/**
 * Is this vehicle usable for a dispatch?
 *
 * Mirrors the predicates TripService.createTrip already applies when it
 * validates a vehicle assignment — same repository vocabulary, one definition.
 * `TransportVehicle` has no `is_active` column; availability is
 * `is_available` plus `current_status`.
 *
 * @param {Object} vehicle
 * @returns {boolean}
 */
function isVehicleUsable(vehicle) {
  if (!vehicle) return false;
  if (vehicle.is_available === false) return false;
  if (vehicle.current_status === 'off_road') return false;
  if (vehicle.current_status === 'maintenance') return false;
  return true;
}

/**
 * Is this driver usable for a dispatch?
 * `Driver` has no `is_active` column either: `is_available` plus `status`,
 * where `inactive` is the retired state.
 *
 * @param {Object} driver
 * @returns {boolean}
 */
function isDriverUsable(driver) {
  if (!driver) return false;
  if (driver.is_available === false) return false;
  if (driver.status === 'inactive') return false;
  return true;
}

class TripOperationalService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    // PHASE 5 FIX: propagate the injected client into the repositories. Built
    // with no arguments they fell back to the module-level `prisma` singleton,
    // so a service under unit test still wrote its timeline/audit rows to the
    // real database, and any caller that omitted the `tx` argument committed
    // outside the transaction.
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
    this.documentService = new TripDocumentService(deps);
  }

  // =========================================================================
  // LOADING
  // =========================================================================

  /**
   * Record the ACTUAL loading facts. Validation only — no status change, so
   * this can be called while the vehicle is still being loaded.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async recordLoadingFacts(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    const positive = (v, label) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError(`Invalid ${label} "${v}" (expected a number >= 0)`);
      }
      return n;
    };

    const data = {
      loading_started_at: this._date(input.loading_started_at, 'loading_started_at'),
      loading_completed_at: this._date(input.loading_completed_at, 'loading_completed_at'),
      loading_remarks: input.loading_remarks || null,
      loaded_by: input.loaded_by || null,
      // ACTUAL values only. Nothing here touches the Booking's planned
      // material / quantity / weight.
      actual_quantity: positive(input.actual_quantity, 'actual_quantity'),
      actual_quantity_unit: input.actual_quantity_unit || null,
      actual_weight_kg: positive(input.actual_weight_kg, 'actual_weight_kg'),
    };

    // Only write the fields the caller actually supplied, so recording one
    // fact never blanks another that was captured earlier.
    const patch = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new ValidationError('No loading information supplied');
    }

    const updated = await this.prisma.trip.update({
      where: { trip_id: trip.trip_id },
      data: patch,
    });

    await this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'loading_recorded',
      description: 'Loading information recorded',
      reference_type: 'trip',
      reference_id: trip.trip_id,
      metadata: { ...patch },
      created_by: user?.user_id || null,
    });

    return updated;
  }

  // =========================================================================
  // READINESS
  // =========================================================================

  /**
   * Everything that must be true before this trip may be dispatched.
   *
   * Returns the blockers rather than throwing, so the UI can show the full
   * list instead of one error at a time, and so a test can assert on the
   * exact reason a dispatch was refused.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getDispatchReadiness(tripId) {
    const trip = await this._loadTrip(tripId, true);
    const blockers = [];

    // ── 1. Operational position ────────────────────────────────────────────
    if (trip.status === 'DISPATCHED') {
      // Already done. Not a blocker, just already satisfied.
    } else if (trip.status !== 'LOADED') {
      blockers.push({
        code: 'NOT_LOADED',
        message: `Trip is ${trip.status}. Loading must be completed before dispatch.`,
      });
    }

    if (trip.status === 'CANCELLED') {
      blockers.push({ code: 'TRIP_CANCELLED', message: 'Trip has been cancelled.' });
    }

    // ── 2. Vehicle and driver assigned ─────────────────────────────────────
    // Neither TransportVehicle nor Driver has an `is_active` column. This
    // repository already expresses availability through `is_available` plus
    // the entity's own status, and TripService.createTrip uses exactly these
    // predicates when it validates an assignment — so dispatch uses the SAME
    // rules rather than inventing a second definition of "active".
    if (!trip.vehicle_id) {
      blockers.push({ code: 'NO_VEHICLE', message: 'No vehicle is assigned to this trip.' });
    } else if (trip.vehicle && !isVehicleUsable(trip.vehicle)) {
      blockers.push({ code: 'VEHICLE_INACTIVE', message: 'Assigned vehicle is not available.' });
    }

    if (!trip.driver_id) {
      blockers.push({ code: 'NO_DRIVER', message: 'No driver is assigned to this trip.' });
    } else if (trip.driver && !isDriverUsable(trip.driver)) {
      blockers.push({ code: 'DRIVER_INACTIVE', message: 'Assigned driver is not active.' });
    }

    // ── 3. Loading actually completed ──────────────────────────────────────
    // A LOADED status is only trustworthy if the loading fact was recorded;
    // this catches a trip that reached LOADED by the legacy short-cut path.
    if (!trip.loading_completed_at) {
      blockers.push({
        code: 'LOADING_NOT_RECORDED',
        message: 'Loading completion has not been recorded for this trip.',
      });
    }

    // ── 4. Mandatory documents ─────────────────────────────────────────────
    const checklist = await this.documentService.getChecklist(trip);
    for (const missing of checklist.missing) {
      blockers.push({
        code: 'MISSING_DOCUMENT',
        document_type: missing.document_type,
        message: `Required document ${missing.document_type} is not present (${missing.document_status}).`,
      });
    }

    return {
      trip_id: trip.trip_id,
      status: trip.status,
      ready: blockers.length === 0,
      already_dispatched: OPERATION_SATISFIED_BY[OPERATIONS.DISPATCH].includes(trip.status),
      checklist,
      blockers,
    };
  }

  /**
   * The whole operational picture for a trip: where it is, where it may go
   * next, and what its paperwork says. The status and the documents are
   * reported as two separate things, never merged.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getOperationalState(tripId) {
    const trip = await this._loadTrip(tripId, true);
    const checklist = await this.documentService.getChecklist(trip);
    const stage = await this._resolveStage(trip, checklist);

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,
      sequence: tripStateMachine.OPERATIONAL_SEQUENCE,
      step_index: tripStateMachine.stepIndex(trip.status),
      allowed_next: tripStateMachine.allowedNext(trip.status),
      is_terminal: tripStateMachine.isTerminal(trip.status),

      // The lifecycle view the Order / Trip Master renders: current stage, the
      // ONE next action, and the ten rail nodes with their states.
      //
      // It is a READ-ONLY projection of `Trip.status`. Nothing in it can change
      // a status — clicking a stage navigates, and only the named `action`
      // endpoint (all of which pre-exist) ever moves the trip.
      stage,

      loading: {
        // Reuses the existing pickup columns as the loading point — there is
        // deliberately no second location field.
        loading_point: trip.pickup_location,
        loading_city: trip.pickup_city,
        sent_to_loading_at: trip.sent_to_loading_at,
        arrived_at_loading_at: trip.arrived_at_loading_at,
        loading_started_at: trip.loading_started_at,
        loading_completed_at: trip.loading_completed_at,
        loading_remarks: trip.loading_remarks,
        loaded_by: trip.loaded_by,
        dispatched_at: trip.dispatched_at,
      },

      // Planned (from the booking, read-only) vs actual (recorded at loading).
      planned: {
        material: trip.booking?.goods_description ?? null,
        quantity: trip.booking?.number_of_items ?? null,
        quantity_unit: trip.booking?.quantity_unit ?? null,
        weight_kg: trip.booking?.goods_weight_kg ?? null,
        weight_unit: trip.booking?.weight_unit ?? null,
      },
      actual: {
        quantity: trip.actual_quantity,
        quantity_unit: trip.actual_quantity_unit,
        weight_kg: trip.actual_weight_kg,
      },

      // A separate object, on purpose. Not part of `status`.
      documents: checklist,
    };
  }

  /**
   * Build the lifecycle view for a trip.
   *
   * Reads the one hire fact the policy needs, then delegates to the PURE
   * `config/tripStagePolicy.resolveTripStage()` so the API, the page and the
   * tests all resolve the same stage from the same rule.
   *
   * POD is read from the EXISTING document checklist. It is a DOCUMENT state and
   * is deliberately never folded into `Trip.status`, so the operational status
   * and the POD state can never be mistaken for one another (§15).
   *
   * @private
   * @param {Object} trip
   * @param {Object} checklist - already-loaded document checklist
   * @returns {Promise<Object>}
   */
  async _resolveStage(trip, checklist) {
    // The hire is OPTIONAL context. A caller that supplies a client without a
    // `vehicleHire` model (older callers and unit-test doubles) must still get a
    // correct stage — it simply reads as "no hire", which is a true statement
    // about a trip nothing has hired yet, not an error.
    const hire = this.prisma.vehicleHire
      ? await this.prisma.vehicleHire.findUnique({
        where: { trip_id: trip.trip_id },
        select: { hire_id: true, status: true },
      })
      : null;

    const podItems = (checklist?.items || []).filter(
      (d) => String(d.document_type).toUpperCase() === 'POD',
    );
    // Whether POD is required is a per-trip decision the document policy
    // already owns. Absent a POD requirement, delivery completes directly.
    const podRequired = podItems.some((d) => d.required);
    const podReceived = podItems.some((d) => d.is_present);

    return stagePolicy.resolveTripStage({
      tripStatus: trip.status,
      hasVehicleHire: Boolean(hire) && hire.status !== 'CANCELLED',
      podRequired,
      podReceived,
      trip: { trip_id: trip.trip_id, trip_number: trip.trip_number },
    });
  }

  // =========================================================================
  // THE OPERATIONS
  // =========================================================================

  /** VEHICLE HIRED → TO LOADING POINT */
  async sendToLoadingPoint(tripId, input = {}, user = null) {
    return this._perform(tripId, OPERATIONS.SEND_TO_LOADING_POINT, input, user);
  }

  /** TO LOADING POINT → AT LOADING POINT */
  async arriveAtLoadingPoint(tripId, input = {}, user = null) {
    return this._perform(tripId, OPERATIONS.ARRIVE_AT_LOADING_POINT, input, user);
  }

  /** AT LOADING POINT → LOADED (records the actual loading facts) */
  async completeLoading(tripId, input = {}, user = null) {
    const facts = this.validateLoadingFacts(input);
    return this._perform(tripId, OPERATIONS.COMPLETE_LOADING, facts, user);
  }

  /** LOADED → DISPATCHED */
  async dispatch(tripId, input = {}, user = null) {
    const readiness = await this.getDispatchReadiness(tripId);

    // A repeat of a dispatch that already happened is a success, not an error.
    if (readiness.already_dispatched) {
      const trip = await this._loadTrip(tripId);
      return { trip, idempotent: true, readiness, status: trip.status };
    }

    if (!readiness.ready) {
      throw new ValidationError({
        message: `Trip cannot be dispatched: ${readiness.blockers.map((b) => b.message).join(' ')}`,
        details: readiness.blockers,
      });
    }

    return this._perform(tripId, OPERATIONS.DISPATCH, input, user);
  }

  /**
   * DISPATCHED → IN_TRANSIT. The CANONICAL transit step (Phase 5).
   *
   * Goes through the same `_perform` engine as every other operation, so it is
   * validated, atomic with its timeline event and audit entry, and idempotent
   * by target state. The Phase 4 legacy short-cut
   * (`PATCH /trips/:id/status` straight to IN_TRANSIT) is untouched and still
   * works; this is the strict path alongside it, not a replacement.
   *
   * @param {number} tripId
   * @param {Object} [input]
   * @param {Object|null} user
   * @returns {Promise<{trip:Object, idempotent:boolean, status:string}>}
   */
  async startTransit(tripId, input = {}, user = null) {
    return this._perform(tripId, OPERATIONS.START_TRANSIT, input, user);
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Validate the actual loading facts a caller supplied.
   * @param {Object} input
   * @returns {Object}
   */
  validateLoadingFacts(input = {}) {
    const positive = (v, label) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError(`Invalid ${label} "${v}" (expected a number >= 0)`);
      }
      return n;
    };

    return {
      loading_started_at: this._date(input.loading_started_at, 'loading_started_at'),
      loading_completed_at: this._date(input.loading_completed_at, 'loading_completed_at'),
      loading_remarks: input.loading_remarks || null,
      loaded_by: input.loaded_by || null,
      actual_quantity: positive(input.actual_quantity, 'actual_quantity'),
      actual_quantity_unit: input.actual_quantity_unit || null,
      actual_weight_kg: positive(input.actual_weight_kg, 'actual_weight_kg'),
    };
  }

  _date(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new ValidationError(`Invalid ${label} "${value}"`);
    }
    return d;
  }

  // =========================================================================
  // THE ENGINE
  // =========================================================================

  /**
   * Perform one operational transition.
   *
   * @param {number} tripId
   * @param {string} operation - one of OPERATIONS
   * @param {Object} input - operational facts supplied by the caller
   * @param {Object|null} user
   * @returns {Promise<{trip:Object, idempotent:boolean, status:string}>}
   */
  async _perform(tripId, operation, input, user) {
    const trip = await this._loadTrip(tripId, true);
    const target = OPERATION_TARGET[operation];
    const satisfiedBy = OPERATION_SATISFIED_BY[operation] || [];

    // ── Idempotency: already done? Return unchanged, write nothing. ────────
    if (satisfiedBy.includes(trip.status)) {
      return { trip, idempotent: true, status: trip.status };
    }

    // ── Server-side transition validation ──────────────────────────────────
    // The browser never says what the new status is; the operation decides it,
    // and this is the check that stops a backwards or illegal move.
    //
    // PHASE 5 FIX: this is `validateOperationalTransition`, not the permissive
    // `validateTransition`. These endpoints are the CANONICAL operational path,
    // so they must refuse the legacy short-cut edges (PENDING/ASSIGNED/DELIVERED
    // → IN_TRANSIT) that the shipped `PATCH /trips/:id/status` control still
    // allows. Without this, "Start Transit" was no stricter than the legacy
    // button it was supposed to sit alongside.
    tripStateMachine.validateOperationalTransition(trip.status, target);

    const now = new Date();
    const patch = { status: target };
    const metadata = {};

    switch (operation) {
      case OPERATIONS.SEND_TO_LOADING_POINT:
        patch.sent_to_loading_at = now;
        metadata.sent_to_loading_at = now;
        break;

      case OPERATIONS.ARRIVE_AT_LOADING_POINT:
        patch.arrived_at_loading_at = now;
        metadata.arrived_at_loading_at = now;
        break;

      case OPERATIONS.COMPLETE_LOADING: {
        // `loading_completed_at` defaults to now, which is also what makes the
        // trip dispatchable: the readiness check demands it.
        patch.loading_completed_at = input.loading_completed_at || now;
        if (input.loading_started_at) patch.loading_started_at = input.loading_started_at;
        if (input.loading_remarks) patch.loading_remarks = input.loading_remarks;
        if (input.loaded_by) patch.loaded_by = input.loaded_by;
        if (input.actual_quantity !== null && input.actual_quantity !== undefined) {
          patch.actual_quantity = input.actual_quantity;
        }
        if (input.actual_quantity_unit) patch.actual_quantity_unit = input.actual_quantity_unit;
        if (input.actual_weight_kg !== null && input.actual_weight_kg !== undefined) {
          patch.actual_weight_kg = input.actual_weight_kg;
        }
        Object.assign(metadata, {
          actual_quantity: patch.actual_quantity ?? null,
          actual_weight_kg: patch.actual_weight_kg ?? null,
          loaded_by: patch.loaded_by ?? null,
        });
        break;
      }

      case OPERATIONS.DISPATCH:
        patch.dispatched_at = now;
        metadata.dispatched_at = now;
        break;

      case OPERATIONS.START_TRANSIT:
        // Nothing extra to record: the vehicle's position and ETA live on
        // TripTrackingService, and the movement itself is the status change.
        break;

      default:
        throw new ValidationError(`Unknown operation: ${operation}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: patch,
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'status_changed',
        description: `${OPERATION_LABEL[operation]} (${trip.status} → ${target})`,
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: { from: trip.status, to: target, operation, ...metadata },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_operational_transition',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: trip.status }),
        new_value: JSON.stringify({ status: target, operation, ...metadata }),
      }, tx);

      return updated;
    });

    return { trip: result, idempotent: false, status: target };
  }

  /**
   * Load a trip, optionally with the relations readiness needs.
   * @param {number} tripId
   * @param {boolean} [withRelations]
   * @returns {Promise<Object>}
   */
  async _loadTrip(tripId, withRelations = false) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError('Trip not found');

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: withRelations
        ? {
          // Only columns that actually exist: TransportVehicle and Driver have
          // no `is_active`.
          vehicle: { select: { vehicle_id: true, vehicle_number: true, is_available: true, current_status: true } },
          driver: { select: { driver_id: true, driver_name: true, is_available: true, status: true } },
          booking: {
            select: {
              goods_description: true,
              number_of_items: true,
              quantity_unit: true,
              goods_weight_kg: true,
              weight_unit: true,
            },
          },
        }
        : undefined,
    });

    if (!trip) throw new NotFoundError('Trip not found');
    return trip;
  }
}

module.exports = TripOperationalService;
module.exports.TripOperationalService = TripOperationalService;
module.exports.OPERATIONS = OPERATIONS;
module.exports.OPERATION_TARGET = OPERATION_TARGET;
