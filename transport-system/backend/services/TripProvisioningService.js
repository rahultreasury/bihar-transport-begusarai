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
const { ValidationError, NotFoundError } = require('../utils/AppError');

class TripProvisioningService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    // TripRepository takes its client POSITIONALLY (constructor(tx = null)).
    this.tripRepo = deps.tripRepo || new TripRepository(this.prisma);
  }

  /**
   * The ONE operational Trip for a booking — created on demand.
   *
   * Safe to call repeatedly and from more than one place (order confirmation,
   * an assignment, the Vehicle Hire list). Every caller converges on the same
   * single row.
   *
   * @param {number} bookingId
   * @returns {Promise<{trip:Object, created:boolean}>}
   */
  async ensureTripForBooking(bookingId) {
    const id = Number(bookingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError('A valid bookingId is required');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { booking_id: id },
    });
    if (!booking) throw new NotFoundError('Booking not found');

    // Fast path: the trip already exists. The overwhelming majority of calls
    // land here, so the common case costs exactly one indexed read.
    const existing = await this.prisma.trip.findFirst({
      where: { booking_id: id },
      orderBy: { trip_id: 'asc' },
    });
    if (existing) return { trip: existing, created: false };

    // Only a CONFIRMED order may carry an operational trip. This is the same
    // rule TripService.createTrip enforces ("no trip before customer
    // acceptance"), restated rather than re-invented, so a provision call can
    // never let a truck be dispatched against an unagreed price.
    if (String(booking.quote_status || '').toUpperCase() !== 'ACCEPTED') {
      throw new ValidationError(
        'The customer must accept the quote before an operational trip exists'
      );
    }

    const vehicleId = booking.vehicle_id ?? null;
    const driverId = booking.driver_id ?? null;

    // Resolve the vendor the same way the rest of the repository does: the
    // vehicle's owner first, then the driver's fleet owner. Never invented.
    let vendorId = booking.vehicle_owner_id ?? null;
    if (!vendorId && vehicleId) {
      const vehicle = await this.prisma.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        select: { owner_id: true },
      });
      vendorId = vehicle?.owner_id ?? null;
    }
    if (!vendorId && driverId) {
      const driver = await this.prisma.driver.findUnique({
        where: { driver_id: driverId },
        select: { transport_owner_id: true },
      });
      vendorId = driver?.transport_owner_id ?? null;
    }

    const data = {
      // Reuse the EXISTING trip-number generator (BTBT-YYYY-NNNNN). Provisioning
      // must not introduce a second numbering scheme, or two trips could end up
      // carrying the same identifier.
      trip_number: await this.tripRepo.generateTripNumber(),
      booking_id: id,
      source_type: 'ONLINE_BOOKING',
      user_id: booking.user_id,
      client_id: null,
      // The assignment the order already carries, if any. NULL is the honest
      // representation of "waiting for a vehicle".
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
      // The CUSTOMER freight, copied from the order. It is not a vehicle hire
      // figure and is never treated as one.
      freight_amount: Number.isFinite(Number(booking.final_price))
        ? Number(booking.final_price)
        : 0,
      notes: booking.special_instructions || booking.quote_remarks || null,

      // A trip that already carries vehicle AND driver is operationally
      // ASSIGNED; one without them is WAITING FOR VEHICLE. Both are PENDING-
      // derived states the existing state machine already defines.
      status: vehicleId && driverId ? 'ASSIGNED' : 'PENDING',
    };

    const trip = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent confirmation may have
      // created the trip between our read and this write.
      const raced = await tx.trip.findFirst({
        where: { booking_id: id },
        orderBy: { trip_id: 'asc' },
      });
      if (raced) return raced;

      return tx.trip.create({ data });
    });

    const created = trip.booking_id === id && trip.trip_id !== existing?.trip_id;
    return { trip, created: created && !existing };
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
   * @returns {Promise<{trip:Object, created:boolean, linked:boolean}|null>}
   *   null when the enquiry does not exist.
   */
  async ensureTripForEnquiry(enquiryId) {
    const id = Number(enquiryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError('A valid enquiryId is required');
    }

    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: id },
    });
    if (!enquiry) throw new NotFoundError('Enquiry not found');

    // ── Already reserved, or already operational? Either way: return it. ────
    const existing =
      (await this.prisma.trip.findFirst({
        where: { enquiry_id: id },
        orderBy: { trip_id: 'asc' },
      })) ||
      (enquiry.booking_id
        ? await this.prisma.trip.findFirst({
            where: { booking_id: enquiry.booking_id },
            orderBy: { trip_id: 'asc' },
          })
        : null);

    if (existing) {
      // The acceptance hand-off: the Booking now exists, so bind it to the
      // reservation trip. Narrowly scoped — only a NULL booking_id is filled,
      // so it can never repoint a trip that already belongs to an order.
      if (enquiry.booking_id && existing.booking_id == null) {
        const linked = await this.prisma.trip.update({
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
    const trip = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent provision may have won
      // between our read and this write. The UNIQUE partial index on
      // trips.enquiry_id is the backstop that makes a double-create impossible.
      const raced = await tx.trip.findFirst({
        where: { enquiry_id: id },
        orderBy: { trip_id: 'asc' },
      });
      if (raced) return raced;

      return tx.trip.create({
        data: {
          // The EXISTING generator — provisioning must never introduce a second
          // numbering scheme, or two trips could carry the same identifier.
          trip_number: await this.tripRepo.generateTripNumber(),
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
        },
      });
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