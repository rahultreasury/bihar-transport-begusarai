/**
 * TripTrackingService
 * ---------------------------------------------------------------------------
 * The transit stage:
 *
 *     DISPATCHED ─► IN_TRANSIT ─► MOVEMENT UPDATES ─► DESTINATION APPROACH
 *                                                          ─► DELIVERY READY
 *
 * Delivery / POD completion is deliberately NOT here — that is Phase 6.
 *
 * REUSES, DOES NOT REBUILD (this is the whole point of the file)
 *   • TripTimeline        — every movement milestone is an append-only timeline
 *                            event. No TripMovement2, no MovementHistory2, no
 *                            TripTrackingHistory2.
 *   • TripStateMachine    — the same transition table Phase 4 wrote.
 *   • TripOperationalService._perform — the same atomic status+timeline+audit
 *                            engine, reached through the public `startTransit`.
 *   • services/distanceMatrix — the Google Distance Matrix integration that
 *                            already existed for pricing, now the ONLY Google
 *                            integration in the codebase.
 *   • realtime/enquiryRealtime — the existing authenticated Socket.IO server.
 *                            Trip rooms are added to it; no second WebSocket.
 *   • Delivery's vocabulary — current_latitude / current_longitude /
 *     last_location_update. The Trip gets the SAME column names so there is
 *     one shape of "where is this vehicle" in this repository.
 *
 * THE DATABASE IS THE SOURCE OF TRUTH
 *   Every emit to realtime happens AFTER the transaction commits. A socket can
 *   therefore never report a movement that was rolled back; if realtime is
 *   unavailable the write still stands and a later read is correct.
 *
 * ETA IS NEVER FAKED
 *   `estimated_arrival_at` is written only from a real Google Distance Matrix
 *   call between the vehicle's last known position and the drop point. When the
 *   key is missing, the position is unknown, the drop point has no coordinates,
 *   or the call fails, the ETA is null and the reason is reported. There is no
 *   fallback number anywhere in this file.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripOperationalService = require('./TripOperationalService');
const tripStateMachine = require('../utils/TripStateMachine');
const distanceMatrix = require('./distanceMatrix');
// `isValidLatLng` is a pure validator with no I/O, so it is taken straight from
// the module. The two functions that DO talk to Google are reached through
// `this.maps`, so a test can substitute them.
const { isValidLatLng } = distanceMatrix;
const realtime = require('../realtime/enquiryRealtime');

/**
 * The movement milestones this phase supports.
 *
 * Only the two the specification names are implemented. DRIVER_STARTED,
 * VEHICLE_MOVING, ARRIVED_AT_CHECKPOINT, DELAY and BREAKDOWN are deliberately
 * NOT here: nothing in the repository or the specification requires them, and
 * inventing them would create status vocabulary nobody asked for. DELAY and
 * BREAKDOWN belong to the Incident phase, which is explicitly out of scope.
 */
const MOVEMENT_MILESTONES = Object.freeze({
  DESTINATION_APPROACH: 'DESTINATION_APPROACH',
  DELIVERY_READY: 'DELIVERY_READY',
});

/**
 * The exact `event_type` written to `trip_timeline` for each milestone.
 *
 * PHASE 5 FIX (D4). Movement events used to be found with
 * `event_type: { startsWith: 'movement_' }`. Prisma compiles `startsWith` to
 * SQL `LIKE 'movement_%'`, and in LIKE the `_` is a single-character wildcard,
 * so that filter also matches any event type spelled `movementX…`. Querying the
 * exact list removes the wildcard entirely and is index-friendly. There are
 * only ever these two values, so nothing is lost.
 */
const MOVEMENT_EVENT_TYPE = Object.freeze({
  DESTINATION_APPROACH: 'movement_DESTINATION_APPROACH',
  DELIVERY_READY: 'movement_DELIVERY_READY',
});

/** The `event_type` values that count as a movement, for exact-match queries. */
const MOVEMENT_EVENT_TYPES = Object.freeze(Object.values(MOVEMENT_EVENT_TYPE));

/** Where a reported position came from. */
const LOCATION_SOURCES = Object.freeze(['DRIVER_APP', 'ADMIN', 'INTEGRATION']);

const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];

/** How long a reported position is considered current. */
const LOCATION_STALE_AFTER_MINUTES = 60;

class TripTrackingService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {Object} [deps.distanceMatrix] - the Google Distance Matrix module.
   *        Defaults to the real one. Injected only by the unit tests, so that
   *        the ETA assertions can prove WHERE the number comes from without
   *        depending on whether GOOGLE_MAPS_API_KEY happens to be set in the
   *        developer's environment.
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    // PHASE 5 FIX: propagate the injected client. Built with no arguments these
    // repositories fell back to the module-level `prisma` singleton, which meant
    // this service's audit rows were written to the REAL database even when it
    // was constructed with a test double — and were committed outside the
    // transaction, so they could not roll back with the movement they record.
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
    this.operationalService = new TripOperationalService(deps);

    this.maps = deps.distanceMatrix || distanceMatrix;
  }

  // =========================================================================
  // TRANSIT STATE  (STEP 3)
  // =========================================================================

  /**
   * DISPATCHED → IN_TRANSIT. The CANONICAL operational path.
   *
   * The Phase 4 legacy short-cut (`PATCH /trips/:id/status` straight from
   * PENDING/ASSIGNED) is untouched and still audited — this is the additional
   * strict path, not a replacement.
   *
   * @param {number} tripId
   * @param {Object} [input]
   * @param {Object|null} user
   * @returns {Promise<{trip:Object, idempotent:boolean, status:string}>}
   */
  async startTransit(tripId, input = {}, user = null) {
    // `startTransit` is the Phase 4 engine's own entry point: it validates the
    // transition, writes the timeline event and the audit entry in one
    // transaction, and is idempotent by target state.
    const result = await this.operationalService.startTransit(tripId, input, user);

    // Only after the transaction committed.
    this._emit(tripId, 'trip:transit', { trip_id: tripId, status: result.status });

    return result;
  }

  // =========================================================================
  // MOVEMENT  (STEP 4 / 5)
  // =========================================================================

  /**
   * Record one movement milestone on the existing append-only timeline.
   *
   * IDEMPOTENCY: re-sending a milestone that is ALREADY in this trip's movement
   * history with the same notes is a no-op — a double click, a retry, or a
   * client alternating two milestones cannot manufacture history. A genuinely
   * new milestone, or the same milestone carrying new notes, appends a new
   * event: that is real history and is never rewritten or deleted.
   *
   * @param {number} tripId
   * @param {string} milestone - one of MOVEMENT_MILESTONES
   * @param {Object} [data]
   * @param {Object|null} user
   * @returns {Promise<{event:Object, idempotent:boolean}>}
   */
  async recordMovement(tripId, milestone, data = {}, user = null) {
    const name = String(milestone || '').toUpperCase();
    if (!MOVEMENT_MILESTONES[name]) {
      throw new ValidationError(
        `Invalid movement milestone "${milestone}". Supported: ${Object.keys(MOVEMENT_MILESTONES).join(', ')}`
      );
    }

    const trip = await this._loadTrip(tripId);

    // A milestone is an in-transit fact. Recording one before the vehicle is
    // actually moving would put a false movement in the history.
    if (!tripStateMachine.hasPassedDispatch(trip.status)) {
      throw new ValidationError(
        `Cannot record movement "${name}": trip is ${trip.status}. The vehicle must be dispatched first.`
      );
    }

    const notes = data.notes || null;
    const metadata = { milestone: name, notes, recorded_at: new Date().toISOString() };
    if (isValidLatLng(data.latitude, data.longitude)) {
      metadata.latitude = data.latitude;
      metadata.longitude = data.longitude;
    }

    // ── Idempotency against the trip's movement history ────────────────────
    // PHASE 5 FIX. This used to compare only against the LATEST movement event.
    // That only catches a back-to-back double click: record A, record B, then
    // the same A again looks new because B intervened, so a client that
    // alternated two milestones grew the timeline without bound — precisely the
    // "uncontrolled duplicate records" the specification forbids.
    //
    // An event is now a no-op when the SAME milestone with the SAME notes is
    // ALREADY in the history. Anything else is a genuinely new fact and is
    // appended, so real history is still never rewritten or lost.
    const previous = await this._movementHistory(trip.trip_id);
    for (const row of previous) {
      const rowMeta = this._parseMetadata(row.metadata);
      if (rowMeta.milestone === name && (rowMeta.notes || null) === notes) {
        return { event: row, idempotent: true };
      }
    }

    // PHASE 5 FIX — the movement event and its audit entry are now written in
    // ONE transaction. Previously the audit row was written outside it, so a
    // failure between the two left a movement with no audit trail, and the
    // audit could survive a movement that rolled back.
    const event = await this.prisma.$transaction(async (tx) => {
      const created = await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: MOVEMENT_EVENT_TYPE[name],
        description: this._describeMovement(name, notes),
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata,
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'trip_movement_recorded',
        entity_type: 'TripTimeline',
        entity_id: created.timeline_id,
        new_value: JSON.stringify({ trip_id: trip.trip_id, ...metadata }),
        reason: notes,
      }, tx);

      return created;
    });

    this._emit(trip.trip_id, 'trip:movement', {
      trip_id: trip.trip_id,
      milestone: name,
      status: trip.status,
    });

    return { event, idempotent: false };
  }

  /**
   * Every movement milestone on a trip, oldest first.
   * @param {number} tripId
   * @returns {Promise<Array>}
   */
  async getMovementHistory(tripId) {
    const events = await this.prisma.tripTimeline.findMany({
      where: { trip_id: Number(tripId), event_type: { in: [...MOVEMENT_EVENT_TYPES] } },
      orderBy: { timeline_id: 'asc' },
    });
    return events.map((e) => ({
      timeline_id: e.timeline_id,
      milestone: this._parseMetadata(e.metadata).milestone,
      notes: this._parseMetadata(e.metadata).notes,
      at: e.created_at,
      created_by: e.created_by,
    }));
  }

  // =========================================================================
  // LOCATION  (STEP 6)
  // =========================================================================

  /**
   * Record the vehicle's current position on this trip.
   *
   * The Trip row holds the LAST KNOWN position, in the same column names the
   * repository already uses on `Delivery`. History is not stored here — the
   * movement timeline is the history.
   *
   * @param {number} tripId
   * @param {Object} input - { latitude, longitude, source, accuracy_m }
   * @param {Object|null} user
   * @returns {Promise<Object>} the updated trip row
   */
  async updateLocation(tripId, input = {}, user = null) {
    // PHASE 5 FIX — reject a MISSING coordinate before coercing it.
    // `Number(null)`, `Number('')`, `Number(undefined)` are all 0, so a body of
    // `{"latitude":null,"longitude":null}` used to sail through the range check
    // and silently store the vehicle in the Gulf of Guinea (0, 0) as though it
    // had reported a real position. A coordinate must be actually present.
    if (input.latitude === undefined || input.latitude === null || input.latitude === ''
      || input.longitude === undefined || input.longitude === null || input.longitude === '') {
      throw new ValidationError(
        'Both latitude and longitude are required and must be numbers.'
      );
    }

    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);

    if (!isValidLatLng(latitude, longitude)) {
      throw new ValidationError(
        `Invalid coordinates (latitude: ${input.latitude}, longitude: ${input.longitude}). Latitude must be -90..90 and longitude -180..180.`
      );
    }

    let source = String(input.source || '').toUpperCase();
    if (!source) source = user?.role === 'driver' ? 'DRIVER_APP' : 'ADMIN';
    if (!LOCATION_SOURCES.includes(source)) {
      throw new ValidationError(
        `Invalid location source "${input.source}". Expected one of: ${LOCATION_SOURCES.join(', ')}`
      );
    }

    let accuracy = null;
    if (input.accuracy_m !== undefined && input.accuracy_m !== null && input.accuracy_m !== '') {
      accuracy = Number(input.accuracy_m);
      if (!Number.isFinite(accuracy) || accuracy < 0) {
        throw new ValidationError(`Invalid accuracy_m "${input.accuracy_m}" (expected a number >= 0)`);
      }
    }

    const trip = await this._loadTrip(tripId);
    const now = new Date();

    // Movement is a transit fact. Recording a position for a trip that has not
    // been dispatched would assert the vehicle is on the road when it is not.
    if (!tripStateMachine.hasPassedDispatch(trip.status)) {
      throw new ValidationError(
        `Cannot record a location: trip is ${trip.status}. The vehicle must be dispatched first.`
      );
    }

    const updated = await this.prisma.trip.update({
      where: { trip_id: trip.trip_id },
      data: {
        current_latitude: latitude,
        current_longitude: longitude,
        location_updated_at: now,
        location_source: source,
        location_accuracy_m: accuracy,
      },
    });

    // A new position makes any previously calculated ETA stale. Recompute from
    // the real source; if that is not possible the old figure is CLEARED rather
    // than left to look live.
    const eta = await this.refreshEta(trip.trip_id);

    this._emit(trip.trip_id, 'trip:location', {
      trip_id: trip.trip_id,
      // Only the position is broadcast. Accuracy and source are internal.
      latitude: Number(latitude.toFixed ? Number(latitude.toFixed(5)) : latitude),
      longitude: Number(longitude.toFixed ? Number(longitude.toFixed(5)) : longitude),
      at: now,
    });

    void eta;
    return { ...updated, eta: eta.value, eta_reason: eta.reason };
  }

  /**
   * Recompute the ETA from a real Google Distance Matrix call.
   *
   * Returns `{ value, reason }`. `value` is null whenever no honest ETA can be
   * produced, and `reason` says which of those cases applied. It never invents
   * a number.
   *
   * @param {number} tripId
   * @returns {Promise<{value:Object|null, reason:string|null}>}
   */
  async refreshEta(tripId) {
    const trip = await this._loadTrip(tripId, true);

    const lat = trip.current_latitude;
    const lng = trip.current_longitude;
    if (!isValidLatLng(lat, lng)) {
      return await this._clearEta(trip.trip_id, 'NO_KNOWN_LOCATION');
    }

    // Drop coordinates live on the Enquiry behind the Booking (see _loadTrip).
    const drop = (trip.booking && trip.booking.enquiry) || {};
    if (!isValidLatLng(drop.drop_latitude, drop.drop_longitude)) {
      return await this._clearEta(trip.trip_id, 'NO_DROP_COORDINATES');
    }

    if (!this.maps.isGoogleConfigured()) {
      return await this._clearEta(trip.trip_id, 'NO_MAPS_KEY');
    }

    let result;
    try {
      result = await this.maps.calculateDistanceMatrix({
        pickup: { lat: Number(lat), lng: Number(lng) },
        drop: { lat: Number(drop.drop_latitude), lng: Number(drop.drop_longitude) },
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      });
    } catch (err) {
      // A provider failure is not an ETA. Say so rather than inventing one.
      return await this._clearEta(trip.trip_id, 'DISTANCE_MATRIX_FAILED');
    }

    const now = new Date();
    const etaAt = new Date(now.getTime() + result.durationSeconds * 1000);

    await this.prisma.trip.update({
      where: { trip_id: trip.trip_id },
      data: {
        estimated_arrival_at: etaAt,
        eta_calculated_at: now,
        distance_remaining_km: result.distanceKm,
      },
    });

    return {
      value: {
        estimated_arrival_at: etaAt,
        distance_remaining_km: result.distanceKm,
        duration: result.duration,
      },
      reason: null,
    };
  }

  // =========================================================================
  // TRACKING READ  (STEP 7 / 12)
  // =========================================================================

  /**
   * The customer-safe tracking view of a trip.
   *
   * WHAT IS DELIBERATELY ABSENT — by construction, not by filtering afterwards:
   *   • the driver's phone / mobile number
   *   • every financial field: freight, commission, net vendor payable,
   *     advances, payments, settlements, BT margin, the owner's identity
   *   • internal document metadata and staff identifiers
   *
   * The driver NAME and the vehicle number are included because the customer
   * needs to know whose truck is carrying their goods; the driver's contact
   * details are not, and this repository has never published them to customers.
   *
   * @param {number} tripId
   * @param {Object} principal - the authenticated caller
   * @returns {Promise<Object>}
   */
  async getTracking(tripId, principal) {
    const trip = await this._loadTripForViewer(tripId, principal);

    const locationKnown = isValidLatLng(trip.current_latitude, trip.current_longitude);
    const ageMinutes = locationKnown && trip.location_updated_at
      ? (Date.now() - new Date(trip.location_updated_at).getTime()) / 60000
      : null;

    const etaStale = trip.eta_calculated_at
      ? (Date.now() - new Date(trip.eta_calculated_at).getTime()) > LOCATION_STALE_AFTER_MINUTES * 60000
      : false;

    const timeline = await this.prisma.tripTimeline.findMany({
      where: { trip_id: trip.trip_id },
      orderBy: { timeline_id: 'asc' },
      select: { timeline_id: true, event_type: true, description: true, created_at: true },
    });

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,
      // The operational milestone, reported SEPARATELY from the status, exactly
      // as Phase 4 kept documents separate from status.
      milestone: this._latestMilestone(timeline),

      route: {
        origin: { city: trip.pickup_city, location: trip.pickup_location },
        destination: { city: trip.drop_city, location: trip.drop_location },
      },

      vehicle: trip.vehicle
        ? { vehicle_number: trip.vehicle.vehicle_number, vehicle_type: trip.vehicle.vehicle_type }
        : null,
      // Name only. `mobile` is intentionally not selected anywhere in this
      // method, so there is nothing to leak.
      driver: trip.driver ? { driver_name: trip.driver.driver_name } : null,

      location: locationKnown
        ? {
          latitude: trip.current_latitude,
          longitude: trip.current_longitude,
          updated_at: trip.location_updated_at,
          age_minutes: ageMinutes === null ? null : Math.round(ageMinutes),
          // A stale position is labelled, never presented as live.
          is_stale: ageMinutes !== null && ageMinutes > LOCATION_STALE_AFTER_MINUTES,
        }
        : null,

      eta: trip.estimated_arrival_at
        ? {
          estimated_arrival_at: trip.estimated_arrival_at,
          distance_remaining_km: trip.distance_remaining_km,
          calculated_at: trip.eta_calculated_at,
          is_stale: etaStale,
        }
        : null,

      timeline,
    };
  }

  // =========================================================================
  // AUTHORIZATION
  // =========================================================================

  /**
   * Load a trip and prove the caller is allowed to SEE it.
   *
   * Admin, the trip's own driver, the transport owner, the trip's customer, and
   * a linked partner may read. Nobody else, and a driver can never read a trip
   * assigned to a different driver.
   *
   * @param {number} tripId
   * @param {Object} principal
   * @returns {Promise<Object>}
   */
  async _loadTripForViewer(tripId, principal) {
    const trip = await this._loadTrip(tripId, true);

    if (!principal) throw new NotFoundError({ message: 'Trip not found' });

    if (principal.kind === 'admin' && ADMIN_ROLES.includes(principal.role)) return trip;

    if (principal.kind === 'driver') {
      if (trip.driver_id !== principal.driverId) {
        throw new ForbiddenError({ message: 'This trip is not assigned to you' });
      }
      return trip;
    }

    if (principal.kind === 'owner') {
      if (trip.transport_owner_id !== principal.ownerId) {
        throw new ForbiddenError({ message: 'This trip does not belong to your fleet' });
      }
      return trip;
    }

    if (principal.kind === 'customer') {
      // A Trip belongs to a customer through `user_id`. `client_id` points at a
      // corporate Client account, which has no login of its own.
      if (trip.user_id !== principal.userId) {
        throw new ForbiddenError({ message: 'This trip is not yours' });
      }
      return trip;
    }

    if (principal.kind === 'partner') {
      const linked = principal.partnerId && trip.booking?.partner_id === principal.partnerId;
      if (!linked) throw new ForbiddenError({ message: 'This trip is not in your network' });
      return trip;
    }

    throw new ForbiddenError({ message: 'Not permitted to view this trip' });
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Load a trip with the relations the tracker needs. Deliberately selects the
   * driver's NAME only.
   */
  async _loadTrip(tripId, withRelations = false) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: withRelations
        ? {
          // No `mobile`, no `license_number`: the driver DTO is name-only.
          driver: { select: { driver_id: true, driver_name: true } },
          vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
          client: { select: { client_id: true, company_name: true } },
          // PHASE 5 FIX (D10). The drop coordinates are on `Enquiry`, NOT on
          // `Booking`. This select asked `Booking` for `drop_latitude` /
          // `drop_longitude`, which do not exist on that model, so Prisma threw
          // `Unknown field 'drop_latitude'` on EVERY call — meaning
          // `getTracking`, `updateLocation` and `refreshEta` all 500'd against
          // the real database. The unit tests never caught it because the
          // in-memory Prisma double ignores `select`.
          booking: {
            select: {
              booking_id: true,
              partner_id: true,
              // A Trip may be standalone, and a Booking may have no Enquiry.
              enquiry: { select: { drop_latitude: true, drop_longitude: true } },
            },
          },
        }
        : undefined,
    });

    if (!trip) throw new NotFoundError({ message: 'Trip not found' });
    return trip;
  }

  /**
   * Every movement event on a trip, oldest first.
   *
   * Used for the idempotency check, which must consider the WHOLE history and
   * not merely the most recent event — see `recordMovement`.
   *
   * @param {number} tripId
   * @returns {Promise<Array>}
   */
  async _movementHistory(tripId) {
    return this.prisma.tripTimeline.findMany({
      where: { trip_id: Number(tripId), event_type: { in: [...MOVEMENT_EVENT_TYPES] } },
      orderBy: { timeline_id: 'asc' },
    });
  }

  /**
   * The most recent movement milestone on a trip, or null.
   *
   * PHASE 5 FIX. This method was declared `async` while containing no `await`,
   * so it returned a PROMISE. `getTracking()` assigned that promise straight to
   * the `milestone` field, and JSON.stringify turns a Promise into `{}` — which
   * means every `GET /api/trips/:id/tracking` response ever sent has reported
   * `milestone: {}`. The operational milestone was silently absent from the
   * whole customer/admin tracking surface. It is a pure function over an array
   * that is already in memory, so it is simply synchronous.
   *
   * @param {Array} timeline
   * @returns {{code:string, at:*, description:string}|null}
   */
  _latestMilestone(timeline) {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const t = timeline[i];
      if (t.event_type && t.event_type.startsWith('movement_')) {
        return { code: t.event_type.replace(/^movement_/, ''), at: t.created_at, description: t.description };
      }
    }
    return null;
  }

  /** Timeline metadata is a TEXT column holding JSON. Never let that throw. */
  _parseMetadata(raw) {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _describeMovement(name, notes) {
    const label = {
      DESTINATION_APPROACH: 'Approaching destination',
      DELIVERY_READY: 'Ready for delivery',
    }[name] || name;
    return notes ? `${label}: ${notes}` : label;
  }

  /**
   * Clear an ETA rather than leave a stale one looking live.
   * @private
   */
  async _clearEta(tripId, reason) {
    await this.prisma.trip.update({
      where: { trip_id: Number(tripId) },
      data: { estimated_arrival_at: null, eta_calculated_at: null, distance_remaining_km: null },
    });
    return { value: null, reason };
  }

  /**
   * Emit a realtime event, but only once the database work is done.
   *
   * Realtime is best-effort: if the socket server is unavailable (the enquiry
   * realtime module degrades to a no-op in that case) this simply does nothing,
   * because the database is the source of truth and every read reflects it.
   *
   * @private
   */
  _emit(tripId, event, payload) {
    try {
      if (typeof realtime.emitToTrip === 'function') {
        realtime.emitToTrip(tripId, event, payload);
      }
    } catch {
      // Never let a socket problem fail a committed write.
    }
  }
}

module.exports = TripTrackingService;
module.exports.TripTrackingService = TripTrackingService;
module.exports.MOVEMENT_MILESTONES = MOVEMENT_MILESTONES;
module.exports.MOVEMENT_EVENT_TYPE = MOVEMENT_EVENT_TYPE;
module.exports.MOVEMENT_EVENT_TYPES = MOVEMENT_EVENT_TYPES;
module.exports.LOCATION_SOURCES = LOCATION_SOURCES;
module.exports.LOCATION_STALE_AFTER_MINUTES = LOCATION_STALE_AFTER_MINUTES;
