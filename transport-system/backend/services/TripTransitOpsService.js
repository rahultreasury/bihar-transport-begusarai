/**
 * TripTransitOpsService
 * ============================================================================
 * The TRANSIT WORKSPACE and the two operational events that belong to it:
 * INCIDENTS and VEHICLE CHANGES.
 *
 * TRACKING vs MOVEMENT HISTORY (§25, §26)
 *   The client document defines these as two different questions and this
 *   service keeps them apart:
 *     • Tracking answers "where is my vehicle right now?" — a live POSITION.
 *     • Movement history answers "what happened to this load from beginning
 *       until now?" — the append-only `trip_timeline`.
 *   Position lives on the existing `trips.current_latitude` / `*_longitude` /
 *   `location_updated_at` columns, and the real pings are still written by
 *   `TripTrackingService`; this service only REPORTS them. It never invents a
 *   position, a distance or an arrival time, and the absence of a position is
 *   reported as "not connected" with a real timestamp, not as a map pin
 *   dropped in the middle of the Ganges.
 *
 * VEHICLE CHANGES ARE APPEND-ONLY (§27)
 *   "Do not overwrite the original vehicle." A change appends a row to
 *   `trip_vehicle_changes` and updates the trip's CURRENT assignment, so the
 *   question "which truck was on this load at 16:05" keeps a permanent answer
 *   even after the current assignment has moved on. The e-way bill is also
 *   flagged for amendment, because the paper now describes a truck that is no
 *   longer on the load — and the flag says exactly that, and nothing more.
 *
 * AN INCIDENT RAISED FROM A BREAKDOWN RAISES THE CHANGE TOO (§28)
 *   `resolveIncident()` will not mark a BREAKDOWN resolved without an explicit
 *   decision, and the "change vehicle" decision goes through
 *   `changeVehicle()`, which writes both rows in one transaction and links
 *   them. Neither can drift from the other.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const { EWAY_BILL_INTEGRATION_NOTICE } = require('./TripDispatchService');

/** §28 — the incident types the client document names, and nothing invented. */
const INCIDENT_TYPES = Object.freeze([
  'VEHICLE_MISSING',
  'DRIVER_UNREACHABLE',
  'ACCIDENT',
  'BREAKDOWN',
  'THEFT',
  'DELIVERY_PROBLEM',
  'OTHER',
]);

/** §27 — the reasons a vehicle may be changed. */
const VEHICLE_CHANGE_REASONS = Object.freeze([
  'BREAKDOWN',
  'TRANSSHIPMENT',
  'ACCIDENT',
  'OTHER',
]);

/** How an incident may be closed out. */
const INCIDENT_RESOLUTIONS = Object.freeze([
  'ONGOING',
  'CONTINUED_SAME_VEHICLE',
  'VEHICLE_CHANGED',
  'WAITING_REPAIR',
  'RESOLVED',
]);

/** The reasons a change must state, so an unexplained swap is impossible. */
const VEHICLE_CHANGE_REASON_LABEL = Object.freeze({
  BREAKDOWN: 'Breakdown',
  TRANSSHIPMENT: 'Transshipment',
  ACCIDENT: 'Accident',
  OTHER: 'Other',
});

class TripTransitOpsService {
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
  // DELEGATE RESOLUTION (Batch 2B)
  // =========================================================================
  // The schema names these two tables snake_case — `trip_incidents` and
  // `trip_vehicle_changes` (mixed in with camelCase models like `ewayBill`) —
  // so the generated Prisma client exposes ONLY those spellings. The unit-test
  // fakes expose camelCase delegates instead, and any future schema rename to
  // camelCase must not require hunting every call site down. Both spellings
  // are therefore accepted, snake_case first:
  //
  //   · a REAL client resolves through `trip_incidents` / `trip_vehicle_changes`
  //   · a FAKE (or a renamed schema) resolves through `tripIncident` /
  //     `tripVehicleChange`
  //
  // `null` means the underlying client genuinely has neither — and a call that
  // NEEDS the table then fails loudly instead of dying on "reading 'create' of
  // undefined" inside a transaction.

  /** The model handle for incident rows, or null when the client has neither spelling. */
  _incidentModel(db = this.prisma) {
    return db.trip_incidents || db.tripIncident || null;
  }

  /** The model handle for vehicle-change rows, or null when the client has neither spelling. */
  _vehicleChangeModel(db = this.prisma) {
    return db.trip_vehicle_changes || db.tripVehicleChange || null;
  }

  /** The incident model FOR WRITING — throws a clear error rather than "of undefined". */
  _requireIncidentModel(db = this.prisma) {
    const model = this._incidentModel(db);
    if (!model) {
      throw new Error('TripTransitOpsService: the Prisma client exposes neither `trip_incidents` nor `tripIncident`. Regenerate the client.');
    }
    return model;
  }

  /** The vehicle-change model FOR WRITING — throws a clear error rather than "of undefined". */
  _requireVehicleChangeModel(db = this.prisma) {
    const model = this._vehicleChangeModel(db);
    if (!model) {
      throw new Error('TripTransitOpsService: the Prisma client exposes neither `trip_vehicle_changes` nor `tripVehicleChange`. Regenerate the client.');
    }
    return model;
  }

  // =========================================================================
  // THE TRANSIT WORKSPACE
  // =========================================================================

  /**
   * Everything the Transit page shows: who, where to, which truck, since when,
   * where it is NOW, and what has happened to it.
   *
   * @param {number} tripId
   * @returns {Promise<Object>}
   */
  async getWorkspace(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: {
        vehicle: true,
        driver: true,
        transportOwner: true,
        // `Booking` has NO `client` relation — an offline corporate client hangs
        // off the TRIP (`trips.client_id`), not off the booking. Naming a
        // relation the schema does not define makes Prisma throw before the
        // query runs.
        booking: { include: { user: true } },
        user: true,
        client: true,
      },
    });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    const [dispatch, changes, incidents, timeline, ewayBill] = await Promise.all([
      this.prisma.tripDispatch
        ? this.prisma.tripDispatch.findFirst({ where: { trip_id: id } })
        : null,
      this._vehicleChangeModel()
        ? this._vehicleChangeModel().findMany({
          where: { trip_id: id },
          orderBy: [{ sequence: 'asc' }],
        })
        : [],
      this._incidentModel()
        ? this._incidentModel().findMany({
          where: { trip_id: id },
          orderBy: [{ reported_at: 'desc' }],
        })
        : [],
      this.prisma.tripTimeline
        ? this.prisma.tripTimeline.findMany({
          where: { trip_id: id },
          orderBy: [{ created_at: 'desc' }],
          take: 60,
        })
        : [],
      this.prisma.ewayBill
        ? this.prisma.ewayBill.findFirst({ where: { trip_id: id } })
        : null,
    ]);

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,

      trip: {
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        status: trip.status,
        pickup: [trip.pickup_location, trip.pickup_city].filter(Boolean).join(', '),
        drop: [trip.drop_location, trip.drop_city].filter(Boolean).join(', '),
        distance_km: trip.distance_km ?? null,
        expected_delivery_date: trip.expected_delivery_date,
        goods: trip.booking?.goods_description || null,
      },
      customer: this._resolveCustomer(trip),
      current_vehicle: trip.vehicle
        ? { vehicle_id: trip.vehicle.vehicle_id, vehicle_number: trip.vehicle.vehicle_number, vehicle_type: trip.vehicle.vehicle_type }
        : null,
      driver: trip.driver
        ? { driver_id: trip.driver.driver_id, driver_name: trip.driver.driver_name, mobile: trip.driver.mobile ?? null }
        : null,
      vendor: trip.transportOwner ? { owner_name: trip.transportOwner.owner_name } : null,
      dispatch: dispatch
        ? {
          dispatched_at: dispatch.dispatched_at,
          lr_gr_number: dispatch.lr_gr_number,
          eway_bill_id: dispatch.eway_bill_id,
          pod_required: dispatch.pod_required,
        }
        : null,

      tracking: this.buildTracking(trip),

      // The two are returned under separate keys on purpose.
      movement_history: timeline,
      vehicle_changes: changes,
      incidents,

      eway_bill: ewayBill
        ? {
          number: ewayBill.eway_bill_number,
          current_vehicle_number: ewayBill.current_vehicle_number,
          previous_vehicle_number: ewayBill.previous_vehicle_number,
          vehicle_update_required: Boolean(ewayBill.vehicle_update_required),
          integration_notice: 'E-Way Bill is maintained as an internal operational record. This information is stored against this Trip for operational and record-keeping purposes.',
        }
        : null,

      available_actions: this._availableActions(trip),
    };
  }

  /**
   * THE POSITION, reported honestly.
   *
   * There is no GPS device integration in this system, so a trip that has never
   * reported a position reports `connected: false` — not a fabricated pin and
   * not a distance of zero. When a position DOES exist (an admin recorded one,
   * or a future device wrote one) the real timestamp travels with it, so a
   * stale reading is visibly stale.
   *
   * @param {Object} trip
   * @returns {Object}
   */
  buildTracking(trip) {
    const hasPosition = trip.current_latitude !== null && trip.current_longitude !== null;
    const updatedAt = trip.location_updated_at || null;

    if (!hasPosition) {
      return {
        connected: false,
        gps_connected: false,
        status: 'NOT_CONNECTED',
        headline: 'GPS Not Connected',
        message: 'No GPS device is reporting a position for this vehicle. '
          + 'The location below is the last one recorded manually, or none at all.',
        current_location: null,
        last_updated: null,
        distance_travelled_km: null,
        distance_remaining_km: trip.distance_remaining_km ?? null,
        expected_arrival: trip.estimated_arrival_at || null,
        eta_calculated_at: trip.eta_calculated_at || null,
        source: null,
        // An honest "we do not know", not a zero.
        accuracy_m: null,
      };
    }

    const ageMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : null;
    const stale = ageMs !== null && ageMs > 6 * 60 * 60 * 1000; // 6 hours

    return {
      connected: true,
      gps_connected: true,
      status: stale ? 'STALE' : 'LIVE',
      headline: stale ? 'Last Known Location' : 'Current Location',
      message: stale
        ? 'This position was last reported more than six hours ago. Treat it as the last known location, not the current one.'
        : 'Position last reported from the trip record.',
      current_location: {
        latitude: trip.current_latitude,
        longitude: trip.current_longitude,
      },
      last_updated: updatedAt,
      distance_travelled_km: null,
      distance_remaining_km: trip.distance_remaining_km ?? null,
      expected_arrival: trip.estimated_arrival_at || null,
      eta_calculated_at: trip.eta_calculated_at || null,
      source: trip.location_source || null,
      accuracy_m: trip.location_accuracy_m ?? null,
    };
  }

  // =========================================================================
  // INCIDENTS
  // =========================================================================

  /**
   * Record an incident. Persistent, not a note: it survives the session, is
   * listed on the workspace, and can raise a vehicle change.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async reportIncident(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    const type = String(input.incident_type || '').toUpperCase();
    if (!INCIDENT_TYPES.includes(type)) {
      throw new ValidationError(
        `Invalid incident_type "${input.incident_type}". Expected one of: ${INCIDENT_TYPES.join(', ')}`,
      );
    }
    if (!input.description || String(input.description).trim() === '') {
      throw new ValidationError('An incident needs a description of what happened');
    }

    const repairAt = input.expected_repair_at ? new Date(input.expected_repair_at) : null;
    if (input.expected_repair_at && Number.isNaN(repairAt.getTime())) {
      throw new ValidationError(`Invalid expected_repair_at "${input.expected_repair_at}"`);
    }

    const now = new Date();
    const incident = await this.prisma.$transaction(async (tx) => {
      const created = await this._requireIncidentModel(tx).create({
        data: {
          trip_id: trip.trip_id,
          incident_type: type,
          description: String(input.description).trim(),
          location: input.location || null,
          vehicle_can_continue:
            input.vehicle_can_continue === undefined || input.vehicle_can_continue === null
              ? null
              : Boolean(input.vehicle_can_continue),
          expected_repair_at: repairAt,
          // The FILES live in the existing document store; this column only
          // points at the ids of the uploaded photos.
          photos: Array.isArray(input.photos) ? input.photos : null,
          resolution: 'ONGOING',
          reported_at: now,
          created_by: user?.user_id || null,
          created_at: now,
          updated_at: now,
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'incident_reported',
        description: `Incident reported: ${type.replace(/_/g, ' ').toLowerCase()}`,
        reference_type: 'trip_incident',
        reference_id: created.incident_id,
        metadata: {
          incident_type: type,
          location: input.location || null,
          vehicle_can_continue: created.vehicle_can_continue,
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_incident_reported',
        entity_type: 'TripIncident',
        entity_id: created.incident_id,
        new_value: JSON.stringify({ incident_type: type, description: created.description, location: created.location }),
      }, tx);

      return created;
    });

    return incident;
  }

  /**
   * List the trip's incidents, newest first.
   *
   * The transit workspace already embeds the incidents it loads; this is the
   * standalone read the incident list refreshes with.
   *
   * @param {number} tripId
   * @returns {Promise<Array>}
   */
  async listIncidents(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({ where: { trip_id: id }, select: { trip_id: true } });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    const listModel = this._incidentModel();
    if (!listModel) return [];
    return listModel.findMany({
      where: { trip_id: id },
      orderBy: [{ reported_at: 'desc' }, { incident_id: 'desc' }],
    });
  }

  /**
   * Close an incident out with an explicit decision.
   *
   * `VEHICLE_CHANGED` is refused unless a vehicle change actually exists for
   * this incident — otherwise the two records would be able to disagree, and a
   * breakdown would appear "handled" while the truck on the road was still the
   * broken one.
   *
   * @param {number} tripId
   * @param {number} incidentId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async resolveIncident(tripId, incidentId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);
    const incident = await this._incidentModel().findFirst({
      where: { incident_id: Number(incidentId), trip_id: trip.trip_id },
    });
    if (!incident) throw new NotFoundError({ message: 'Incident not found for this trip' });

    const resolution = String(input.resolution || '').toUpperCase();
    if (!INCIDENT_RESOLUTIONS.includes(resolution) || resolution === 'ONGOING') {
      throw new ValidationError(
        `Invalid resolution "${input.resolution}". Expected one of: ${INCIDENT_RESOLUTIONS.filter((r) => r !== 'ONGOING').join(', ')}`,
      );
    }

    if (resolution === 'VEHICLE_CHANGED') {
      const linked = await this._vehicleChangeModel().count({
        where: { incident_id: incident.incident_id },
      });
      if (linked === 0) {
        throw new ValidationError(
          'This incident cannot be marked as resolved with a vehicle change until the vehicle change '
          + 'has actually been recorded. Record the change first.',
        );
      }
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await this._requireIncidentModel(tx).update({
        where: { incident_id: incident.incident_id },
        data: {
          resolution,
          resolution_remarks: input.remarks || null,
          resolved_at: resolution === 'ONGOING' ? null : now,
          updated_at: now,
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'incident_resolved',
        description: `Incident ${resolution.replace(/_/g, ' ').toLowerCase()}`,
        reference_type: 'trip_incident',
        reference_id: incident.incident_id,
        metadata: { resolution, remarks: input.remarks || null },
        created_by: user?.user_id || null,
      }, tx);

      return updated;
    });
  }

  // =========================================================================
  // VEHICLE CHANGE
  // =========================================================================

  /**
   * Change the vehicle (and optionally the driver) on a trip already on the road.
   *
   * One transaction writes: the vehicle-change history row, the trip's new
   * current assignment, the e-way bill's "amendment required" flag, and the
   * movement-history entry. The ORIGINAL vehicle and driver are copied into the
   * change row before the trip row is updated, so nothing about the past is
   * lost even though the trip now points at the new truck.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async changeVehicle(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId, true);

    const reason = String(input.reason || '').toUpperCase();
    if (!VEHICLE_CHANGE_REASONS.includes(reason)) {
      throw new ValidationError(
        `Invalid reason "${input.reason}". Expected one of: ${VEHICLE_CHANGE_REASONS.join(', ')}`,
      );
    }
    if (!input.remarks || String(input.remarks).trim() === '') {
      throw new ValidationError('A vehicle change must state why it happened');
    }

    // The new vehicle is REQUIRED. "Change vehicle" with no replacement would
    // leave the consignment with no truck, which is a different operation
    // (cancellation or wait-for-repair) and is not what this button means.
    const newVehicleId = Number(input.new_vehicle_id);
    if (!Number.isInteger(newVehicleId) || newVehicleId <= 0) {
      throw new ValidationError('A vehicle change must name the replacement vehicle (new_vehicle_id)');
    }
    if (newVehicleId === trip.vehicle_id) {
      throw new ValidationError('The replacement vehicle is the vehicle already assigned to this trip');
    }

    const newVehicle = await this.prisma.transportVehicle.findUnique({
      where: { vehicle_id: newVehicleId },
    });
    if (!newVehicle) throw new NotFoundError({ message: 'Replacement vehicle not found' });
    if (newVehicle.is_available === false || ['off_road', 'maintenance'].includes(newVehicle.current_status)) {
      throw new ValidationError(
        `Vehicle ${newVehicle.vehicle_number} is not available for this trip `
        + `(status: ${newVehicle.current_status || 'unavailable'})`,
      );
    }

    let newDriver = null;
    if (input.new_driver_id) {
      newDriver = await this.prisma.driver.findUnique({
        where: { driver_id: Number(input.new_driver_id) },
      });
      if (!newDriver) throw new NotFoundError({ message: 'Replacement driver not found' });
      if (newDriver.is_available === false || newDriver.status === 'inactive') {
        throw new ValidationError(`Driver ${newDriver.driver_name} is not available for this trip`);
      }
    }

    // An incident link is OPTIONAL, but if one is supplied it must be real and
    // must belong to this trip.
    let incident = null;
    if (input.incident_id) {
      incident = await this._incidentModel().findFirst({
        where: { incident_id: Number(input.incident_id), trip_id: trip.trip_id },
      });
      if (!incident) throw new NotFoundError({ message: 'Incident not found for this trip' });
    }

    const existingCount = await this._vehicleChangeModel().count({ where: { trip_id: trip.trip_id } });
    const occurredAt = input.occurred_at ? new Date(input.occurred_at) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      throw new ValidationError(`Invalid occurred_at "${input.occurred_at}"`);
    }
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const change = await this._requireVehicleChangeModel(tx).create({
        data: {
          trip_id: trip.trip_id,
          sequence: existingCount + 1,
          // The ORIGINAL assignment is captured here BEFORE the trip row moves.
          old_vehicle_id: trip.vehicle_id,
          old_vehicle_number: trip.vehicle?.vehicle_number || null,
          new_vehicle_id: newVehicle.vehicle_id,
          new_vehicle_number: newVehicle.vehicle_number,
          old_driver_id: trip.driver_id,
          old_driver_name: trip.driver?.driver_name || null,
          new_driver_id: newDriver?.driver_id ?? null,
          new_driver_name: newDriver?.driver_name ?? null,
          reason,
          remarks: String(input.remarks).trim(),
          location: input.location || null,
          occurred_at: occurredAt,
          proof_document_id: input.proof_document_id ? Number(input.proof_document_id) : null,
          incident_id: incident?.incident_id ?? null,
          created_by: user?.user_id || null,
          created_at: now,
        },
      });

      await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          vehicle_id: newVehicle.vehicle_id,
          ...(newDriver ? { driver_id: newDriver.driver_id } : {}),
          updated_at: now,
        },
      });

      // The e-way bill now describes a truck that is not on this load. The
      // paper must be amended by an operator — and the flag says exactly that,
      // never that a government system was updated.
      const ewayBill = tx.ewayBill
        ? await tx.ewayBill.findFirst({ where: { trip_id: trip.trip_id } })
        : null;
      let updatedEway = null;
      if (ewayBill) {
        updatedEway = await tx.ewayBill.update({
          where: { eway_bill_id: ewayBill.eway_bill_id },
          data: {
            previous_vehicle_number: ewayBill.current_vehicle_number || trip.vehicle?.vehicle_number || null,
            current_vehicle_number: newVehicle.vehicle_number,
            vehicle_update_required: true,
            updated_at: now,
          },
        });
      }

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'vehicle_changed',
        description: `Vehicle changed: ${trip.vehicle?.vehicle_number || 'unassigned'} → ${newVehicle.vehicle_number} (${VEHICLE_CHANGE_REASON_LABEL[reason] || reason})`,
        reference_type: 'trip_vehicle_change',
        reference_id: change.change_id,
        metadata: {
          old_vehicle_number: trip.vehicle?.vehicle_number || null,
          new_vehicle_number: newVehicle.vehicle_number,
          old_driver_name: trip.driver?.driver_name || null,
          new_driver_name: newDriver?.driver_name || null,
          reason,
          location: input.location || null,
          incident_id: incident?.incident_id ?? null,
          eway_bill_amendment_required: Boolean(ewayBill),
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_vehicle_changed',
        entity_type: 'TripVehicleChange',
        entity_id: change.change_id,
        previous_value: JSON.stringify({
          vehicle_id: trip.vehicle_id,
          vehicle_number: trip.vehicle?.vehicle_number || null,
          driver_id: trip.driver_id,
        }),
        new_value: JSON.stringify({
          vehicle_id: newVehicle.vehicle_id,
          vehicle_number: newVehicle.vehicle_number,
          driver_id: newDriver?.driver_id ?? trip.driver_id,
          reason,
          remarks: change.remarks,
        }),
      }, tx);

      // A change raised from an incident closes that incident with the same
      // decision, in the same transaction, so the two can never disagree.
      if (incident && incident.resolution === 'ONGOING') {
        await this._requireIncidentModel(tx).update({
          where: { incident_id: incident.incident_id },
          data: {
            resolution: 'VEHICLE_CHANGED',
            resolution_remarks: `Vehicle changed to ${newVehicle.vehicle_number}: ${change.remarks}`,
            resolved_at: now,
            updated_at: now,
          },
        });
      }

      return {
        change,
        // The e-way bill, as THIS change left it: the operator must amend the
        // vehicle on the paper — `vehicle_update_required` names the duty,
        // and NO `gov_sync_status` key is produced because no government
        // synchronisation exists to report.
        eway_bill: updatedEway
          ? {
            eway_bill_id: updatedEway.eway_bill_id,
            eway_bill_number: updatedEway.eway_bill_number,
            previous_vehicle_number: updatedEway.previous_vehicle_number,
            current_vehicle_number: updatedEway.current_vehicle_number,
            vehicle_update_required: Boolean(updatedEway.vehicle_update_required),
          }
          : null,
        integration_notice: 'E-Way Bill is maintained as an internal operational record. '
          + 'The vehicle must be amended on it by an operator; no government system was updated.',
      };
    });

    return result;
  }

  /**
   * The vehicle this trip started with and every swap since, in order.
   *
   * @param {number} tripId
   * @returns {Promise<Array>}
   */
  async getVehicleHistory(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const changeModel = this._vehicleChangeModel();
    const changes = changeModel
      ? await changeModel.findMany({
        where: { trip_id: id },
        orderBy: [{ sequence: 'asc' }],
      })
      : [];

    if (changes.length === 0) {
      const trip = await this.prisma.trip.findUnique({
        where: { trip_id: id },
        include: { vehicle: true, driver: true },
      });
      if (!trip) throw new NotFoundError({ message: 'Trip not found' });
      return [{
        sequence: 0,
        original: true,
        reason: 'ORIGINAL_ASSIGNMENT',
        old_vehicle_number: null,
        new_vehicle_number: trip.vehicle?.vehicle_number || null,
        old_driver_name: null,
        new_driver_name: trip.driver?.driver_name || null,
        occurred_at: trip.dispatched_at || trip.created_at,
        remarks: 'The vehicle assigned at dispatch. No change has been recorded.',
      }];
    }

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: { vehicle: true, driver: true },
    });

    return [
      {
        sequence: 0,
        original: true,
        reason: 'ORIGINAL_ASSIGNMENT',
        old_vehicle_number: null,
        new_vehicle_number: changes[0].old_vehicle_number,
        old_driver_name: null,
        new_driver_name: changes[0].old_driver_name,
        occurred_at: trip?.dispatched_at || trip?.created_at || null,
        remarks: 'The vehicle dispatched with this consignment.',
      },
      ...changes,
    ];
  }

  // =========================================================================
  // INTERNAL
  // =========================================================================

  /** @private */
  async _loadTrip(tripId, withRelations = false) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: withRelations ? { vehicle: true, driver: true } : undefined,
    });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });
    return trip;
  }

  /**
   * What the operator may do from here, derived from the REAL status. Nothing
   * is offered that the backend would refuse.
   * @private
   */
  _availableActions(trip) {
    const actions = [];
    if (trip.status === 'DISPATCHED') {
      actions.push({ id: 'START_TRANSIT', label: 'Start Transit', endpoint: `/api/trips/${trip.trip_id}/transit/start`, method: 'POST' });
    }
    if (['DISPATCHED', 'IN_TRANSIT'].includes(trip.status)) {
      actions.push({ id: 'REPORT_INCIDENT', label: 'Report Incident', endpoint: `/api/trips/${trip.trip_id}/incidents`, method: 'POST' });
      actions.push({ id: 'CHANGE_VEHICLE', label: 'Change Vehicle', endpoint: `/api/trips/${trip.trip_id}/vehicle-changes`, method: 'POST' });
      actions.push({ id: 'ARRIVE_DELIVERY', label: 'Arrived at Delivery', endpoint: `/api/trips/${trip.trip_id}/arrival`, method: 'POST' });
    }
    if (['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(trip.status)) {
      actions.push({ id: 'VIEW_TRACKING', label: 'Track', endpoint: `/api/trips/${trip.trip_id}/transit`, method: 'GET' });
      actions.push({ id: 'VIEW_FINANCE', label: 'View Finance', endpoint: `/admin/trips/${trip.trip_id}/finance`, method: 'GET' });
      actions.push({ id: 'VIEW_MOVEMENT_HISTORY', label: 'Movement History', endpoint: `/api/trips/${trip.trip_id}/timeline`, method: 'GET' });
    }
    return actions;
  }

  /** @private */
  _resolveCustomer(trip) {
    if (trip.client) {
      return { kind: 'CLIENT', name: trip.client.company_name, phone: trip.client.phone, email: trip.client.email };
    }
    const user = trip.booking?.user || trip.user;
    if (user) {
      return {
        kind: 'USER',
        name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        phone: user.phone ?? null,
        email: user.email ?? null,
      };
    }
    return null;
  }
}

module.exports = TripTransitOpsService;
module.exports.TripTransitOpsService = TripTransitOpsService;
module.exports.INCIDENT_TYPES = INCIDENT_TYPES;
module.exports.VEHICLE_CHANGE_REASONS = VEHICLE_CHANGE_REASONS;
module.exports.INCIDENT_RESOLUTIONS = INCIDENT_RESOLUTIONS;
