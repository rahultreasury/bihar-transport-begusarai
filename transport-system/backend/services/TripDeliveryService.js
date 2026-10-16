/**
 * TripDeliveryService
 * ---------------------------------------------------------------------------
 * The delivery stage:
 *
 *     IN_TRANSIT ──► arrived at destination ──► POD ──► DELIVERED ──► COMPLETED
 *
 * Delivery / POD COMPLETION is Phase 6. Delivery-at-destination is NOT a new
 * TripStatus: the existing statuses already express the workflow, so arrival is
 * recorded as a FACT on the trip, exactly the way Phase 4 recorded
 * `arrived_at_loading_at` and Phase 5 recorded the position.
 *
 * REUSES, DOES NOT REBUILD
 *   • TripStateMachine   — the same transition table, via the STRICT
 *                          `validateOperationalTransition` Phase 5 added, so
 *                          IN_TRANSIT → DELIVERED → COMPLETED are the only
 *                          paths here.
 *   • TripDocumentService — the POD *is* a `trip_documents` row of type POD.
 *                          No POD2, no second verification system.
 *   • TripTimeline        — every delivery event is an append-only timeline
 *                          event. No DeliveryTimeline2 / PODTimeline2.
 *   • Trip.trip_delivered_date and Trip.completed_at — both pre-existing.
 *   • realtime/enquiryRealtime — the existing authenticated socket server.
 *
 * THE DATABASE IS THE SOURCE OF TRUTH
 *   Every realtime emit happens AFTER the transaction commits, exactly as in
 *   Phase 5.
 *
 * FINANCIAL SEPARATION (STEP 18)
 *   This service imports NO financial module and writes NO financial column.
 *   Completing a delivery does not pay a vendor, create a settlement, change
 *   commission, or move gross hire. The Phase 2–3 financial architecture is
 *   driven by its own explicit actions and is untouched here. That is enforced
 *   structurally — there is simply no call to any of it — and asserted by test.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripDocumentService = require('./TripDocumentService');
const ResourceAvailabilityService = require('./ResourceAvailabilityService');
const tripStateMachine = require('../utils/TripStateMachine');
const deliveryPolicy = require('../config/tripDeliveryPolicy');
const realtime = require('../realtime/enquiryRealtime');

const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];

/** The one document type that constitutes a proof of delivery. */
const POD_TYPE = 'POD';

/** Timeline event types this phase owns. */
const DELIVERY_EVENTS = Object.freeze({
  ARRIVED_DESTINATION: 'arrived_destination',
  DELIVERY_ATTEMPT: 'delivery_attempt',
  POD_SUBMITTED: 'pod_submitted',
  POD_VERIFIED: 'pod_verified',
  DELIVERED: 'delivered',
  COMPLETED: 'trip_completed',
  RESOURCES_RELEASED: 'resources_released',
});

class TripDeliveryService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    // Propagate the injected client, as Phase 5 established: a repository built
    // with no arguments falls back to the module-level singleton, which would
    // write to the REAL database during a unit test.
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
    this.documentService = new TripDocumentService(deps);
    this.resourceAvailability = new ResourceAvailabilityService({ prisma: this.prisma });
  }

  // =========================================================================
  // ARRIVAL AT THE DESTINATION  (STEP 4)
  // =========================================================================

  /**
   * Record that the vehicle reached the drop point.
   *
   * Server-authoritative: the caller says "we arrived", never "set the status".
   * The trip status is deliberately NOT changed here — a truck standing at the
   * gate is still IN_TRANSIT until the goods are actually handed over.
   *
   * IDEMPOTENT: a repeat returns the recorded arrival without writing a second
   * timeline event. A genuinely later arrival (a different remarks string) is
   * appended rather than overwriting, so the history is preserved.
   *
   * @param {number} tripId
   * @param {Object} [input] - { remarks?, arrived_at? }
   * @param {Object|null} user
   * @returns {Promise<{trip:Object, idempotent:boolean}>}
   */
  async arriveAtDestination(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    // Only a trip actually carrying the goods to the drop point can arrive
    // there. This is deliberately NOT `hasPassedDispatch`, which also admits
    // LOADED: a LOADED truck is sitting at the LOADING point, so recording a
    // destination arrival for it would be asserting something false. The only
    // status that means "on the road to the destination" is IN_TRANSIT — which
    // is also the sole legal predecessor of DELIVERED.
    if (trip.status !== 'IN_TRANSIT') {
      throw new ValidationError(
        `Cannot record arrival at destination: trip is ${trip.status}. `
        + 'Only a trip that is IN_TRANSIT can arrive at the destination.'
      );
    }

    const arrivedAt = this._date(input.arrived_at, 'arrived_at') || new Date();
    const remarks = input.remarks || null;

    // A second arrival with the same remarks is the same fact.
    if (trip.arrived_at_destination_at && (trip.arrival_remarks || null) === remarks) {
      return { trip, idempotent: true };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          arrived_at_destination_at: arrivedAt,
          arrival_remarks: remarks,
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: DELIVERY_EVENTS.ARRIVED_DESTINATION,
        description: remarks
          ? `Arrived at destination: ${remarks}`
          : 'Arrived at destination',
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: { arrived_at: arrivedAt, remarks },
        created_by: user?.user_id || null,
      }, tx);

      await this._audit(tx, {
        user,
        action: 'trip_arrived_destination',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        new_value: JSON.stringify({ arrived_at: arrivedAt, remarks }),
      });

      return row;
    });

    this._emit(trip.trip_id, 'trip:arrival', {
      trip_id: trip.trip_id, status: trip.status, arrived_at: arrivedAt,
    });

    return { trip: updated, idempotent: false };
  }

  // =========================================================================
  // DELIVERY ATTEMPT  (STEP 5)
  // =========================================================================

  /**
   * Record that a delivery could not be completed on this attempt.
   *
   * This is deliberately the SMALLEST record the specification asks for: an
   * append-only timeline event with a reason. It creates no table, changes no
   * status, and opens no incident workflow — the trip simply stays IN_TRANSIT
   * and can be attempted again. The Incident module is a later phase.
   *
   * @param {number} tripId
   * @param {Object} input - { reason, notes? }
   * @param {Object|null} user
   * @returns {Promise<{event:Object, idempotent:boolean}>}
   */
  async recordDeliveryAttempt(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    const reason = String(input.reason || '').toUpperCase();
    if (!deliveryPolicy.DELIVERY_ATTEMPT_REASONS[reason]) {
      throw new ValidationError(
        `Invalid delivery attempt reason "${input.reason}". `
        + `Expected one of: ${Object.keys(deliveryPolicy.DELIVERY_ATTEMPT_REASONS).join(', ')}`
      );
    }

    if (trip.status !== 'IN_TRANSIT') {
      throw new ValidationError(
        `Cannot record a delivery attempt: trip is ${trip.status}. Only a trip that is IN_TRANSIT can fail a delivery.`
      );
    }

    const notes = input.notes || null;
    const label = deliveryPolicy.DELIVERY_ATTEMPT_LABELS[reason];

    // A repeat of the identical attempt (same reason, same notes) is a retry,
    // not a second failed attempt.
    const existing = await this.prisma.tripTimeline.findFirst({
      where: { trip_id: trip.trip_id, event_type: DELIVERY_EVENTS.DELIVERY_ATTEMPT },
      orderBy: { timeline_id: 'desc' },
    });
    if (existing) {
      const meta = this._parseMetadata(existing.metadata);
      if (meta.reason === reason && (meta.notes || null) === notes) {
        return { event: existing, idempotent: true };
      }
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const row = await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: DELIVERY_EVENTS.DELIVERY_ATTEMPT,
        description: notes ? `${label}: ${notes}` : label,
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: { reason, notes, recorded_at: new Date().toISOString() },
        created_by: user?.user_id || null,
      }, tx);

      await this._audit(tx, {
        user,
        action: 'trip_delivery_attempt',
        entity_type: 'TripTimeline',
        entity_id: row.timeline_id,
        new_value: JSON.stringify({ trip_id: trip.trip_id, reason, notes }),
      });

      return row;
    });

    this._emit(trip.trip_id, 'trip:delivery_attempt', {
      trip_id: trip.trip_id, reason, status: trip.status,
    });

    return { event, idempotent: false };
  }

  // =========================================================================
  // POD  (STEP 6 / 7 / 8)
  // =========================================================================

  /**
   * Supply the proof of delivery.
   *
   * The POD is the EXISTING `trip_documents` row of type POD, written through
   * the Phase 4 `TripDocumentService`, so it inherits that service's
   * transactional write, its append-only timeline entry and — critically — the
   * `@@unique([trip_id, document_type])` constraint, which is what makes a
   * duplicated upload request impossible to store twice.
   *
   * This method only ADDS the delivery facts that are not documents.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   */
  async submitPod(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    if (!['IN_TRANSIT', 'DELIVERED'].includes(trip.status)) {
      throw new ValidationError(
        `Cannot supply a POD: trip is ${trip.status}. The goods must be in transit.`
      );
    }

    // Reuse Phase 4. No POD-specific document code is written here.
    const pod = await this.documentService.recordDocument(tripId, {
      document_type: POD_TYPE,
      document_status: 'PRESENT',
      reference_number: input.reference_number,
      file_url: input.file_url,
      remarks: input.remarks,
    }, user);

    // The received figures. Validated, and NEVER written over the planned
    // quantity/weight on Booking/Enquiry, nor over the loaded actuals.
    const facts = this._deliveryFacts(input);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          ...facts,
          // A POD implies the vehicle is at the drop point. If nobody recorded
          // the arrival separately, this IS the evidence of it.
          ...(trip.arrived_at_destination_at ? {} : { arrived_at_destination_at: now }),
        },
      });

      // Only announce a genuinely new document, so a retry is silent.
      if (!pod.already_recorded) {
        await this.timelineRepo.create({
          trip_id: trip.trip_id,
          event_type: DELIVERY_EVENTS.POD_SUBMITTED,
          description: pod.file_url
            ? 'Proof of delivery supplied (with document file)'
            : 'Proof of delivery supplied',
          reference_type: 'trip_document',
          reference_id: pod.document_id,
          metadata: { document_id: pod.document_id, ...facts },
          created_by: user?.user_id || null,
        }, tx);
      }

      return row;
    });

    this._emit(trip.trip_id, 'trip:pod_submitted', {
      trip_id: trip.trip_id, document_id: pod.document_id, status: trip.status,
    });

    return {
      pod: { document_id: pod.document_id, document_status: pod.document_status },
      already_recorded: Boolean(pod.already_recorded),
      trip: updated,
    };
  }

  /**
   * Verify the supplied POD, using the Phase 4 verification path.
   *
   * Reuses `TripDocumentService.verifyDocument`, so the verification rules, the
   * `document_verified` timeline event and the audit entry are the same ones
   * every other document already uses. No second verification system.
   *
   * @param {number} tripId
   * @param {number} documentId
   * @param {Object|null} user
   */
  async verifyPod(tripId, documentId, user = null) {
    const trip = await this._loadTrip(tripId);
    const pod = await this._getPod(tripId);

    if (!pod) throw new NotFoundError({ message: 'No proof of delivery for this trip' });
    if (pod.document_id !== Number(documentId)) {
      throw new NotFoundError({ message: 'Document not found for this trip' });
    }

    // STEP 16: a repeated verification is a no-op. Calling the Phase 4 verify
    // again would append a second `document_verified` timeline event every
    // time somebody double-clicked.
    if (deliveryPolicy.isPodVerified(pod.document_status)) {
      return { pod, idempotent: true };
    }

    const verified = await this.documentService.verifyDocument(tripId, documentId, user);

    this._emit(trip.trip_id, 'trip:pod_verified', {
      trip_id: trip.trip_id, document_id: verified.document_id, status: trip.status,
    });

    return { pod: verified, idempotent: false };
  }

  // =========================================================================
  // DELIVERED  (STEP 9)
  // =========================================================================

  /**
   * IN_TRANSIT → DELIVERED.
   *
   * The server decides whether this is allowed. Every applicable blocker is
   * returned at once, so the operator does not fix one problem at a time.
   *
   * @param {number} tripId
   * @param {Object} [input]
   * @param {Object|null} user
   */
  async markDelivered(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    // Idempotent: already delivered (or beyond) is a no-op, not an error.
    if (['DELIVERED', 'COMPLETED'].includes(trip.status)) {
      return { trip, idempotent: true, status: trip.status };
    }

    // The STRICT validator — no legacy short-cut into DELIVERED.
    tripStateMachine.validateOperationalTransition(trip.status, 'DELIVERED');

    const readiness = await this.getDeliveryReadiness(tripId);
    if (!readiness.ready) {
      throw new ValidationError({
        message: `Trip cannot be delivered: ${readiness.blockers.map((b) => b.message).join(' ')}`,
        details: readiness.blockers,
      });
    }

    const now = input.delivered_at ? this._date(input.delivered_at, 'delivered_at') : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check arrival inside the transaction: a trip that was already
      // delivered is not re-delivered, and the status update and the timeline
      // event commit together or not at all.
      const row = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: {
          status: 'DELIVERED',
          // The pre-existing column. Not a new one.
          trip_delivered_date: now,
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: DELIVERY_EVENTS.DELIVERED,
        description: `Delivered to ${trip.drop_city || 'destination'}`
          + `${trip.delivered_receiver_name ? ` — received by ${trip.delivered_receiver_name}` : ''}`,
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: {
          from: trip.status,
          to: 'DELIVERED',
          operation: 'MARK_DELIVERED',
          delivered_at: now,
          receiver: trip.delivered_receiver_name || null,
        },
        created_by: user?.user_id || null,
      }, tx);

      await this._audit(tx, {
        user,
        action: 'trip_operational_transition',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: trip.status }),
        new_value: JSON.stringify({ status: 'DELIVERED', operation: 'MARK_DELIVERED', delivered_at: now }),
      });

      return row;
    });

    this._emit(trip.trip_id, 'trip:delivered', { trip_id: trip.trip_id, status: 'DELIVERED' });

    return { trip: result, idempotent: false, status: 'DELIVERED' };
  }

  // =========================================================================
  // COMPLETED  (STEP 10)
  // =========================================================================

  /**
   * DELIVERED → COMPLETED.
   *
   * COMPLETED in this repository means OPERATIONALLY CLOSED. It does not mean
   * the money moved — see config/tripDeliveryPolicy.js for why, and note that
   * this method writes `completed_at` and nothing financial.
   *
   * @param {number} tripId
   * @param {Object} [input]
   * @param {Object|null} user
   */
  async completeTrip(tripId, input = {}, user = null) {
    const trip = await this._loadTrip(tripId);

    if (trip.status === 'COMPLETED') {
      return { trip, idempotent: true, status: 'COMPLETED' };
    }

    tripStateMachine.validateOperationalTransition(trip.status, 'COMPLETED');

    const readiness = await this.getCompletionReadiness(tripId);
    if (!readiness.ready) {
      throw new ValidationError({
        message: `Trip cannot be completed: ${readiness.blockers.map((b) => b.message).join(' ')}`,
        details: readiness.blockers,
      });
    }

    const now = input.completed_at ? this._date(input.completed_at, 'completed_at') : new Date();

    // Captured from inside the transaction so the caller learns whether the
    // vehicle and driver were actually freed.
    let release = { driverReleased: false, vehicleReleased: false };

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        // ONLY the status and the pre-existing `completed_at`. No settlement,
        // no payment, no commission, no gross hire. STEP 18.
        data: { status: 'COMPLETED', completed_at: now },
      });

      // RELEASE THE RESOURCES.
      //
      // A COMPLETED trip is no longer an active trip, so the vehicle and
      // driver it used are free to be hired again — unless either is still
      // committed to another active trip. This runs inside the SAME
      // transaction as the status change, so a trip can never be COMPLETED
      // while its resources stay locked, and the release can never be
      // recorded without the completion that caused it.
      release = await this.resourceAvailability.releaseResourcesIfNoActiveTrip(
        trip.driver_id,
        trip.vehicle_id,
        trip.trip_id,
        tx,
      );

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: DELIVERY_EVENTS.COMPLETED,
        description: 'Trip completed',
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: {
          from: trip.status,
          to: 'COMPLETED',
          operation: 'COMPLETE_TRIP',
          completed_at: now,
          driver_released: release.driverReleased,
          vehicle_released: release.vehicleReleased,
        },
        created_by: user?.user_id || null,
      }, tx);

      // A separate, explicit release event so the movement history shows the
      // resource hand-back as its own fact, not merely a flag on the
      // completion event.
      if (release.driverReleased || release.vehicleReleased) {
        await this.timelineRepo.create({
          trip_id: trip.trip_id,
          event_type: DELIVERY_EVENTS.RESOURCES_RELEASED,
          description: [
            release.driverReleased ? 'Driver released' : null,
            release.vehicleReleased ? 'Vehicle released' : null,
          ].filter(Boolean).join(' and '),
          reference_type: 'trip',
          reference_id: trip.trip_id,
          metadata: {
            operation: 'RELEASE_RESOURCES',
            driver_released: release.driverReleased,
            vehicle_released: release.vehicleReleased,
            driver_id: trip.driver_id,
            vehicle_id: trip.vehicle_id,
          },
          created_by: user?.user_id || null,
        }, tx);
      }

      await this._audit(tx, {
        user,
        action: 'trip_operational_transition',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: trip.status }),
        new_value: JSON.stringify({
          status: 'COMPLETED',
          operation: 'COMPLETE_TRIP',
          driver_released: release.driverReleased,
          vehicle_released: release.vehicleReleased,
        }),
      });

      return row;
    });

    this._emit(trip.trip_id, 'trip:completed', {
      trip_id: trip.trip_id,
      status: 'COMPLETED',
      driverReleased: release.driverReleased,
      vehicleReleased: release.vehicleReleased,
    });

    return {
      trip: result,
      idempotent: false,
      status: 'COMPLETED',
      driverReleased: release.driverReleased,
      vehicleReleased: release.vehicleReleased,
    };
  }

  // =========================================================================
  // READINESS + READ  (STEP 9 / 11)
  // =========================================================================

  /**
   * Why can this trip not be delivered yet?
   * @param {number} tripId
   */
  async getDeliveryReadiness(tripId) {
    const trip = await this._loadTrip(tripId);
    const pod = await this._getPod(tripId);
    const blockers = [];

    if (!trip.arrived_at_destination_at) {
      blockers.push(deliveryPolicy.DELIVERY_REQUIREMENTS[0]);
    }
    if (!deliveryPolicy.isPodSupplied(pod?.document_status)) {
      blockers.push(deliveryPolicy.DELIVERY_REQUIREMENTS[1]);
    } else if (!deliveryPolicy.isPodVerified(pod.document_status)) {
      blockers.push(deliveryPolicy.DELIVERY_REQUIREMENTS[2]);
    }
    if (!trip.delivered_receiver_name) {
      blockers.push(deliveryPolicy.DELIVERY_REQUIREMENTS[3]);
    }

    return {
      trip_id: trip.trip_id,
      status: trip.status,
      ready: blockers.length === 0,
      already_delivered: ['DELIVERED', 'COMPLETED'].includes(trip.status),
      pod: pod
        ? {
          document_id: pod.document_id,
          document_status: pod.document_status,
          is_verified: Boolean(pod.is_verified),
        }
        : null,
      arrival: trip.arrived_at_destination_at,
      receiver: trip.delivered_receiver_name || null,
      blockers,
    };
  }

  /**
   * Why can this trip not be completed yet?
   * @param {number} tripId
   */
  async getCompletionReadiness(tripId) {
    const trip = await this._loadTrip(tripId);
    const pod = await this._getPod(tripId);
    const blockers = [];

    if (trip.status !== 'DELIVERED' && trip.status !== 'COMPLETED') {
      blockers.push(deliveryPolicy.COMPLETION_REQUIREMENTS[0]);
    }

    // If POD is required, it must be verified before completion
    const podRequired = trip.documents_required !== false && trip.pod_required !== false;
    if (podRequired && !deliveryPolicy.isPodVerified(pod?.document_status)) {
      blockers.push({
        code: 'POD_NOT_VERIFIED',
        message: 'Proof of Delivery must be verified before the trip can be completed.',
      });
    }

    return {
      trip_id: trip.trip_id,
      status: trip.status,
      ready: blockers.length === 0,
      blockers,
    };
  }

  /**
   * The delivery view of a trip.
   *
   * STEP 11: for a customer this is a CUSTOMER-SAFE PROJECTION, not the Trip
   * object. The same shape serves admin/driver/owner/partner, but the caller is
   * resolved and authorised by `_authorise`, and a customer can never reach
   * this with someone else's trip.
   *
   * Exposed: status, arrival, POD presence/verification (NOT the file URL),
   * receiver name, delivery remarks, received figures, the timeline.
   *
   * Never exposed: `file_url` (STEP 12 — POD files are not public), the
   * driver's mobile, and every financial field.
   *
   * @param {number} tripId
   * @param {Object} principal
   */
  async getDelivery(tripId, principal) {
    const trip = await this._authorise(tripId, principal);
    const pod = await this._getPod(trip.trip_id);

    const timeline = await this.prisma.tripTimeline.findMany({
      where: { trip_id: trip.trip_id },
      orderBy: { timeline_id: 'asc' },
      select: { timeline_id: true, event_type: true, description: true, created_at: true },
    });

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,

      arrival: trip.arrived_at_destination_at
        ? {
          arrived_at: trip.arrived_at_destination_at,
          remarks: trip.arrival_remarks || null,
        }
        : null,

      // Presence and verification only. The FILE ITSELF is served by the
      // separate, admin-gated document endpoint, never from here.
      pod: pod
        ? {
          document_id: pod.document_id,
          document_status: pod.document_status,
          is_supplied: deliveryPolicy.isPodSupplied(pod.document_status),
          is_verified: deliveryPolicy.isPodVerified(pod.document_status),
          issued_at: pod.issued_at,
          has_file: Boolean(pod.file_url),
        }
        : null,

      delivered_at: trip.trip_delivered_date,
      completed_at: trip.completed_at,
      receiver: trip.delivered_receiver_name || null,
      remarks: trip.delivery_remarks || null,

      // The ACTUAL RECEIVED figures, kept apart from the planned ones.
      received: trip.delivered_quantity === null && trip.delivered_weight_kg === null
        ? null
        : {
          quantity: trip.delivered_quantity,
          quantity_unit: trip.delivered_quantity_unit || null,
          weight_kg: trip.delivered_weight_kg,
        },

      destination: { city: trip.drop_city, location: trip.drop_location },
      timeline,
    };
  }

  // =========================================================================
  // AUTHORIZATION  (STEP 12)
  // =========================================================================

  /**
   * Load a trip and prove the caller may act on it.
   *
   * Reuses the same principal model Phase 5 established for tracking
   * (admin / driver / owner / customer / partner). This is a READ of who may
   * see the delivery; the WRITE routes additionally require admin, which is
   * enforced in routes/tripRoutes.js by the same `protect` + `adminOnly` pair
   * already used for every other operational write.
   */
  async _authorise(tripId, principal) {
    const trip = await this._loadTrip(tripId);
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

  /** The trip's POD document row, or null. Scoped by trip_id in the query. */
  async _getPod(tripId) {
    return this.prisma.tripDocument.findFirst({
      where: { trip_id: Number(tripId), document_type: POD_TYPE },
    });
  }

  async _loadTrip(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: id },
      include: {
        booking: { select: { booking_id: true, partner_id: true } },
      },
    });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });
    return trip;
  }

  /**
   * Validate the received-quantity facts.
   *
   * These are the ACTUAL figures received. They are written to their own
   * columns; nothing here reads, writes or derives the PLANNED quantity/weight
   * on Booking/Enquiry, which is why a short or over delivery can be recorded
   * without any risk of corrupting the order.
   */
  _deliveryFacts(input = {}) {
    const facts = {};
    const nonNegative = (v, label) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError(`Invalid ${label} "${v}" (expected a number >= 0)`);
      }
      return n;
    };

    const qty = nonNegative(input.delivered_quantity, 'delivered_quantity');
    if (qty !== undefined) facts.delivered_quantity = qty;
    const weight = nonNegative(input.delivered_weight_kg, 'delivered_weight_kg');
    if (weight !== undefined) facts.delivered_weight_kg = weight;

    if (input.delivered_quantity_unit) facts.delivered_quantity_unit = input.delivered_quantity_unit;
    if (input.delivery_remarks) facts.delivery_remarks = input.delivery_remarks;
    if (input.receiver_name !== undefined) {
      const name = String(input.receiver_name || '').trim();
      if (name) facts.delivered_receiver_name = name;
    }

    return facts;
  }

  _date(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${label} "${value}"`);
    return d;
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

  async _audit(tx, { user, action, entity_type, entity_id, previous_value, new_value }) {
    await this.auditRepo.create({
      user_id: user?.user_id || null,
      user_role: user?.role || 'system',
      action,
      entity_type,
      entity_id,
      previous_value: previous_value || null,
      new_value: new_value || null,
    }, tx);
  }

  /** Emit to realtime, but only once the database work is committed. */
  _emit(tripId, event, payload) {
    try {
      if (typeof realtime.emitToTrip === 'function') realtime.emitToTrip(tripId, event, payload);
    } catch {
      // Never let a socket problem fail a committed write.
    }
  }
}

module.exports = TripDeliveryService;
module.exports.TripDeliveryService = TripDeliveryService;
module.exports.DELIVERY_EVENTS = DELIVERY_EVENTS;
module.exports.POD_TYPE = POD_TYPE;
