/**
 * TripProvisioningService
 * ============================================================================
 * Closes the ONE gap in the Enquiry → Booking → Trip → Vehicle Hire chain.
 *
 * THE GAP, AS FOUND IN PRODUCTION
 *   Enquiry `BTB-20260930-001430` was CONFIRMED with vehicle 4 and driver 3.
 *   Its Booking (`BTB-2026-00203`) was `confirmed` with `quote_status =
 *   ACCEPTED` and driver/vehicle set. But there was NO `trips` row for it at
 *   all. Trip creation had only ever been reachable through a manual admin
 *   "Create Trip" action, so a confirmed order simply sat outside the Vehicle
 *   Hire page — regardless of what had been assigned on the enquiry.
 *
 *   That is the root cause of the reported bug, and it is a provisioning gap,
 *   not a display bug. Querying Vehicle Hire correctly cannot show a
 *   consignment whose operational record was never created.
 *
 * WHAT THIS SERVICE DOES
 *   `ensureTripForBooking()` returns the ONE operational Trip for a confirmed
 *   order, creating it if it does not already exist.
 *
 *   It is IDEMPOTENT and safe to call from anywhere:
 *     • One trip per booking. `trips.booking_id` is guarded by the existing
 *       "exactly one trip per order" rule, and the service re-reads inside the
 *       transaction so two concurrent confirmations cannot both create one.
 *     • It NEVER overwrites an existing assignment. If the trip already has a
 *       vehicle, that vehicle is kept — provisioning must not silently undo an
 *       operator's decision.
 *     • It creates the trip in the TRUE starting state: no vehicle, no driver,
 *       `PENDING`. That is what `WAITING FOR VEHICLE` means, and it is
 *       representable only because `trips.vehicle_id/driver_id/transport_owner_id`
 *       are nullable (migration 20261001120000).
 *     • Where the order already carries a vehicle and driver, they are copied
 *       ON, so an enquiry-assigned consignment reaches Vehicle Hire already
 *       showing VEHICLE ASSIGNED rather than as a blank waiting row.
 *
 * IT DOES NOT INVENT COMMERCIAL FACTS
 *   Route and dates come from the order. Money comes from the order. If the
 *   order has no customer freight recorded, the trip records none — an honest
 *   NULL rather than a fabricated zero that would later read as "free goods".
 */

'use strict';

const { prisma: defaultPrisma } = require('../config/prisma');
const TripRepository = require('../repositories/TripRepository');
const TripFinancialService = require('./TripFinancialService');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const { ValidationError, NotFoundError } = require('../utils/AppError');

class TripProvisioningService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {TripRepository} [deps.tripRepo]
   * @param {TripFinancialService} [deps.tripFinancialService]
   * @param {TripTimelineRepository} [deps.timelineRepo]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.tripRepo = deps.tripRepo || new TripRepository(this.prisma);
    this.tripFinancialService =
      deps.tripFinancialService || new TripFinancialService({ prisma: this.prisma });
    this.timelineRepo =
      deps.timelineRepo || new TripTimelineRepository({ prisma: this.prisma });
  }

  /**
   * Resolve the Prisma client to use: an externally managed transaction client
   * takes precedence, otherwise the injected/default singleton.
   *
   * @param {Object|null} tx - Optional Prisma transaction client
   * @returns {import('@prisma/client').PrismaClient}
   * @private
   */
  _client(tx = null) {
    return tx || this.prisma;
  }

  /**
   * The ONE operational Trip for a booking — created on demand.
   *
   * IDEMPOTENT: if a Trip already exists for this booking, it is returned
   * exactly as-is. Nothing on the existing row is overwritten — not vehicle,
   * not driver, not status, not source_type, not customer relationships.
   *
   * CONCURRENCY: the existence check is re-issued inside the same transaction
   * as the create, so two concurrent calls converge on one row. Note that
   * `trips.booking_id` has NO database unique constraint (it is nullable Int?),
   * so the transactional re-check is the only guard against a double-create.
   * A migration adding `@@unique([booking_id])` on `Trip` would close this
   * gap at the database level (see migration requirements).
   *
   * @param {number} bookingId
   * @param {Object} [options]
   * @param {Object} [options.tx] - Optional Prisma transaction client
   * @param {string} [options.sourceType] - Trip source type (defaults to ONLINE_BOOKING)
   * @param {number} [options.actorId] - User ID who triggered provisioning (for timeline)
   * @returns {Promise<{trip:Object, created:boolean}>}
   */
  async ensureTripForBooking(bookingId, options = {}) {
    const id = Number(bookingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError('A valid bookingId is required');
    }

    const { tx, sourceType, actorId } = options;
    const client = this._client(tx);

    const booking = await client.booking.findUnique({
      where: { booking_id: id },
    });
    if (!booking) throw new NotFoundError('Booking not found');

    // Fast path: the trip already exists. Return it untouched.
    const existing = await client.trip.findFirst({
      where: { booking_id: id },
      orderBy: { trip_id: 'asc' },
    });
    if (existing) return { trip: existing, created: false };

    // Only a CONFIRMED order may carry an operational trip.
    if (String(booking.quote_status || '').toUpperCase() !== 'ACCEPTED') {
      throw new ValidationError(
        'The customer must accept the quote before an operational trip exists'
      );
    }

    const vehicleId = booking.vehicle_id ?? null;
    const driverId = booking.driver_id ?? null;

    let vendorId = booking.vehicle_owner_id ?? null;
    if (!vendorId && vehicleId) {
      const vehicle = await client.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        select: { owner_id: true },
      });
      vendorId = vehicle?.owner_id ?? null;
    }
    if (!vendorId && driverId) {
      const driver = await client.driver.findUnique({
        where: { driver_id: driverId },
        select: { transport_owner_id: true },
      });
      vendorId = driver?.transport_owner_id ?? null;
    }

    const data = {
      booking_id: id,
      source_type: sourceType ?? 'ONLINE_BOOKING',
      user_id: booking.user_id,
      client_id: null,
      transport_owner_id: vendorId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      pickup_location: booking.pickup_location,
      pickup_city: booking.pickup_city || booking.pickup_location,
      drop_location: booking.drop_location,
      drop_city: booking.drop_city || booking.drop_location,
      distance_km: Number.isFinite(Number(booking.estimated_distance_km))
        ? Number(booking.estimated_distance_km)
        : null,
      trip_date: this._parsePickupDate(booking.pickup_date),
      freight_amount: Number.isFinite(Number(booking.final_price))
        ? Number(booking.final_price)
        : 0,
      notes: booking.special_instructions || booking.quote_remarks || null,
      status: vehicleId && driverId ? 'ASSIGNED' : 'PENDING',
    };

    const trip = await client.$transaction(async (txClient) => {
      // Re-check inside the transaction: a concurrent confirmation may have
      // created the trip between our read and this write.
      const raced = await txClient.trip.findFirst({
        where: { booking_id: id },
        orderBy: { trip_id: 'asc' },
      });
      if (raced) return raced;

      return this.tripRepo.createTripWithCanonicalNumber(data, txClient);
    });

    // --- Post-creation side effects (outside the trip-creation transaction) ---
    // These are idempotent and safe to retry. They are deliberately NOT inside
    // the trip-creation transaction so a financial/timeline failure never rolls
    // back an already-committed Trip.

    // TripFinancial: one DRAFT record per booking, idempotent.
    try {
      await this.tripFinancialService.initializeTripFinancial(id, {
        user_id: actorId ?? booking.user_id,
        role: 'system',
      });
    } catch (finErr) {
      // Financial init failure must not orphan the Trip. Log and continue;
      // the caller can retry financial initialization independently.
      // eslint-disable-next-line no-console
      console.error(
        `[TripProvisioningService] TripFinancial init failed for booking ${id}:`,
        finErr.message
      );
    }

    // Timeline: record trip creation exactly once.
    try {
      await this.timelineRepo.create(
        {
          trip_id: trip.trip_id,
          event_type: 'trip_created',
          description: `Trip ${trip.trip_number} provisioned for booking ${id}`,
          reference_type: 'trip',
          reference_id: trip.trip_id,
          metadata: {
            booking_id: id,
            source_type: data.source_type,
            status: data.status,
            actor_id: actorId ?? null,
          },
          created_by: actorId ?? null,
        },
        tx
      );
    } catch (tlErr) {
      // Timeline failure must not orphan the Trip.
      // eslint-disable-next-line no-console
      console.error(
        `[TripProvisioningService] Timeline event failed for booking ${id}:`,
        tlErr.message
      );
    }

    return { trip, created: true };
  }

  /**
   * Same, but for an ENQUIRY — including one that has no order yet.
   *
   * WHY AN ENQUIRY WITHOUT A BOOKING STILL GETS A TRIP
   *   Vehicle and driver are now reserved BEFORE the customer accepts, so the
   *   admin can send one quote that already carries the truck and the driver.
   *   The Booking does not exist at that point — it is created at acceptance —
   *   so `trips.booking_id` cannot be the anchor. `trips.enquiry_id` (migration
   *   20261003120000) carries the reservation instead, and this method is what
   *   links it to the Booking the moment acceptance creates one.
   *
   * IDEMPOTENCE
   *   Looked up by `enquiry_id` FIRST, then by `booking_id`. Whichever trip
   *   already exists is returned untouched — with one exception: a reservation
   *   that has no booking yet is LINKED to the order if one has since been
   *   created. Linking never overwrites vehicle, driver, vendor or status, so
   *   provisioning cannot undo an operator's decision.
   *
   * @param {number} enquiryId
   * @param {Object} [options]
   * @param {Object} [options.tx] - Optional Prisma transaction client
   * @returns {Promise<{trip:Object, created:boolean, linked:boolean}|null>}
   *   null when the enquiry does not exist.
   */
  async ensureTripForEnquiry(enquiryId, options = {}) {
    const id = Number(enquiryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError('A valid enquiryId is required');
    }

    const { tx } = options;
    const client = this._client(tx);

    const enquiry = await client.enquiry.findUnique({
      where: { enquiry_id: id },
    });
    if (!enquiry) throw new NotFoundError('Enquiry not found');

    // ── Already reserved, or already operational? Either way: return it. ────
    const existing =
      (await client.trip.findFirst({
        where: { enquiry_id: id },
        orderBy: { trip_id: 'asc' },
      })) ||
      (enquiry.booking_id
        ? await client.trip.findFirst({
            where: { booking_id: enquiry.booking_id },
            orderBy: { trip_id: 'asc' },
          })
        : null);

    if (existing) {
      // The acceptance hand-off: the Booking now exists, so bind it to the
      // reservation trip. Narrowly scoped — only a NULL booking_id is filled,
      // so it can never repoint a trip that already belongs to an order.
      if (enquiry.booking_id && existing.booking_id == null) {
        const linked = await client.trip.update({
          where: { trip_id: existing.trip_id },
          data: { booking_id: enquiry.booking_id },
        });
        return { trip: linked, created: false, linked: true };
      }
      return { trip: existing, created: false, linked: false };
    }

    // ── No trip at all: create the ONE reservation trip for this enquiry. ───
    // The route/dates come from the ENQUIRY (the booking may not exist yet),
    // never invented. No vehicle, no driver, PENDING — which is precisely what
    // "waiting for a vehicle" means.
    const trip = await client.$transaction(async (txClient) => {
      // Re-check inside the transaction: a concurrent provision may have won
      // between our read and this write. The UNIQUE partial index on
      // trips.enquiry_id is the backstop that makes a double-create impossible.
      const raced = await txClient.trip.findFirst({
        where: { enquiry_id: id },
        orderBy: { trip_id: 'asc' },
      });
      if (raced) return raced;

      const data = {
        enquiry_id: id,
        booking_id: enquiry.booking_id ?? null,
        transport_owner_id: null,
        vehicle_id: null,
        driver_id: null,

        pickup_location: enquiry.pickup_location || '',
        pickup_city: enquiry.pickup_location || '',
        drop_location: enquiry.drop_location || '',
        drop_city: enquiry.drop_location || '',
        distance_km: Number.isFinite(Number(enquiry.distance_km))
          ? Number(enquiry.distance_km)
          : null,

        trip_date: this._parsePickupDate(enquiry.pickup_date),
        // The CUSTOMER freight, when the admin has already priced it. NOT a
        // vehicle-hire figure: the gross hire is agreed on the Vehicle Hire
        // page. Zero before a price exists is honest, and is overwritten by
        // the real customer price the moment the quote is saved.
        freight_amount: Number.isFinite(Number(enquiry.final_quoted_price))
          ? Number(enquiry.final_quoted_price)
          : 0,
        notes: enquiry.special_instructions || null,

        status: 'PENDING',
      };

      return this.tripRepo.createTripWithCanonicalNumber(data, txClient);
    });

    return { trip, created: true, linked: false };
  }

  /**
   * `Bookings.pickup_date` is a String in this schema, not a DateTime. Parse
   * defensively: an unparseable date becomes "now", never an Invalid Date that
   * would break every downstream date comparison.
   *
   * @param {string|Date|null} value
   * @returns {Date}
   * @private
   */
  _parsePickupDate(value) {
    if (!value) return new Date();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
}

module.exports = TripProvisioningService;
module.exports.TripProvisioningService = TripProvisioningService;