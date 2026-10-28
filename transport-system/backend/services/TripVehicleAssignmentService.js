/**
 * TripVehicleAssignmentService
 * ============================================================================
 * THE ONE place a vehicle/driver/vendor is assigned to a consignment.
 *
 * WHY THIS FILE EXISTS
 *   The specification requires ONE universal vehicle-hire workflow reached
 *   from two entry points — the Enquiry page and the Vehicle Hire page — both
 *   operating on the SAME Trip. Before this service those two screens wrote to
 *   DIFFERENT columns through DIFFERENT code paths, which is why an enquiry
 *   with an assigned vehicle could be invisible to Vehicle Hire.
 *
 *   This module is the single writer. `EnquiryService.adminAssign()` and the
 *   vehicle-hire routes both call it. Neither re-implements any of it.
 *
 * THE SINGLE SOURCE OF TRUTH
 *   The canonical CURRENT assignment is the `trips` row:
 *
 *       trips.vehicle_id          the truck currently engaged
 *       trips.driver_id           the driver currently engaged
 *       trips.transport_owner_id  the vendor / vehicle owner
 *
 *   `enquiries.assigned_*` and `bookings.vehicle_id/driver_id` are MIRRORS,
 *   written in the same transaction so the customer-facing screens keep working.
 *   They are never read as the authority for vehicle hire.
 *
 *   Consequence — the guarantee that matters:
 *     • ONE current vehicle assignment per trip (the Trip row holds one).
 *     • Re-assignment UPDATES that row. It never inserts a second one.
 *     • Changing vehicle or driver from either screen is immediately visible
 *       from the other, because both screens read this same row.
 *
 * HISTORY IS PRESERVED, NEVER DESTROYED (spec §28)
 *   Every change appends an immutable `trip_timelines` row recording what the
 *   previous vehicle/driver was and why it changed, so "Vehicle A → Vehicle B"
 *   is auditable. The previous assignment is never deleted — only superseded.
 *
 * IT NEVER TOUCHES MONEY
 *   Assigning a vehicle establishes WHO is driving. It does not agree a price.
 *   Gross / commission / net belong to `vehicle_hires`, written exclusively by
 *   VehicleHireWorkflowService.hireVehicle(). This service never writes those
 *   columns, so "vehicle assigned" can never silently become "vehicle hired".
 */

'use strict';

const { prisma: defaultPrisma } = require('../config/prisma');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const tripStateMachine = require('../utils/TripStateMachine');
// The EXISTING availability / conflict rules (rules 1-8), reused rather than
// reimplemented. Injectable so a test can supply its own.
const defaultAvailabilityService = require('./EnquiryAssignmentService');
const ResourceAvailabilityService = require('./ResourceAvailabilityService');
// Recognises a placeholder owner row so the UI can say "not recorded" instead of
// printing "Orphan Driver Owner". It NEVER rewrites data and never substitutes a
// different owner — payouts route on `owner_id`, and that must stay untouched.
const { presentOwner } = require('../utils/vehicleOwnerPlaceholder');

/**
 * Trip statuses at which a vehicle may still be (re)assigned.
 *
 * Deliberately narrow. A consignment that has already been dispatched must not
 * have its truck swapped underneath it by an assignment screen — that is a
 * dispatch-time correction, not a hiring action, and the loading/transit
 * modules already own it.
 */
const ASSIGNABLE_TRIP_STATUSES = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
]);

class TripVehicleAssignmentService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {object} [deps.availability] — the EXISTING EnquiryAssignmentService,
   *   injected so the conflict/coherence rules stay in ONE place. A second
   *   availability algorithm is exactly what this refactor must not create, so
   *   this service never computes availability itself; it asks the module that
   *   already does and only adapts the arguments.
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.availability = deps.availability || defaultAvailabilityService;
    this.resourceAvailability = new ResourceAvailabilityService({ prisma: this.prisma });
  }

  // ==========================================================================
  // RESOLUTION — find the canonical Trip for whatever the caller has
  // ==========================================================================

  /**
   * Resolve the ONE canonical Trip for a consignment, from a trip id, a
   * booking, or an enquiry — whichever the caller holds.
   *
   * This is what lets the Enquiry page and the Vehicle Hire page meet. Neither
   * needs to know how the other is keyed.
   *
   * @param {{tripId?:number, bookingId?:number, enquiryId?:number}} ref
   * @returns {Promise<Object>} the Trip row (with its current relations)
   * @throws {NotFoundError} when no Trip exists for the consignment
   */
  async resolveTrip(ref = {}) {
    const tripId = Number(ref.tripId);
    const bookingId = Number(ref.bookingId);
    const enquiryId = Number(ref.enquiryId);

    if (![tripId, bookingId, enquiryId].some((n) => Number.isInteger(n) && n > 0)) {
      throw new ValidationError('A trip, booking or enquiry reference is required');
    }

    let trip = null;

    if (Number.isInteger(tripId) && tripId > 0) {
      trip = await this.prisma.trip.findUnique({
        where: { trip_id: tripId },
        include: this._tripInclude(),
      });
    }

    // Fall back through booking → enquiry so a screen holding only an enquiry
    // id still reaches the same operational record.
    if (!trip && Number.isInteger(bookingId) && bookingId > 0) {
      trip = await this.prisma.trip.findFirst({
        where: { booking_id: bookingId },
        orderBy: { trip_id: 'asc' },
        include: this._tripInclude(),
      });
    }

    if (!trip && Number.isInteger(enquiryId) && enquiryId > 0) {
      // THE RESERVATION LINK. A vehicle and driver are now reserved BEFORE the
      // customer accepts, and the Booking does not exist at that point — so the
      // reservation is anchored on `trips.enquiry_id` (migration
      // 20261003120000). Looked up first, because it is the EARLIER state: the
      // booking lookup is kept below purely for historical consignments whose
      // trip predates the link and is only reachable through their order.
      trip = await this.prisma.trip.findFirst({
        where: { enquiry_id: enquiryId },
        orderBy: { trip_id: 'asc' },
        include: this._tripInclude(),
      });

      if (!trip) {
        const enquiry = await this.prisma.enquiry.findUnique({
          where: { enquiry_id: enquiryId },
          select: { booking_id: true },
        });
        if (enquiry?.booking_id) {
          trip = await this.prisma.trip.findFirst({
            where: { booking_id: enquiry.booking_id },
            orderBy: { trip_id: 'asc' },
            include: this._tripInclude(),
          });
        }
      }
    }

    if (!trip) {
      throw new NotFoundError(
        'No operational trip exists for this consignment yet. It appears in Vehicle Hire once the order is confirmed.'
      );
    }

    return trip;
  }

  /**
   * The same resolution, but returns null instead of throwing — for read paths
   * that must not fail when a consignment has no trip yet.
   * @param {{tripId?:number, bookingId?:number, enquiryId?:number}} ref
   * @returns {Promise<Object|null>}
   */
  async findTrip(ref = {}) {
    try {
      return await this.resolveTrip(ref);
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  // ==========================================================================
  // THE CURRENT ASSIGNMENT — what both screens read
  // ==========================================================================

  /**
   * The canonical current assignment for a consignment, in the shape BOTH the
   * Enquiry page and the Vehicle Hire page render.
   *
   * `hire_status` is derived from real database state — never hardcoded by a
   * client — and distinguishes the three business states:
   *
   *   WAITING_FOR_VEHICLE  no vehicle on the trip
   *   VEHICLE_ASSIGNED     vehicle + driver chosen, hire money not yet agreed
   *   VEHICLE_HIRED        a `vehicle_hires` row exists (gross/commission/net)
   *
   * @param {{tripId?:number, bookingId?:number, enquiryId?:number}} ref
   * @returns {Promise<Object|null>}
   */
  async getCurrentAssignment(ref = {}) {
    const trip = await this.findTrip(ref);
    if (!trip) return null;

    const hire = await this.prisma.vehicleHire.findUnique({
      where: { trip_id: trip.trip_id },
      select: {
        hire_id: true,
        vehicle_id: true,
        driver_id: true,
        vendor_id: true,
        billing_to: true,
        business_model: true,
        gross_hire: true,
        commission_amount: true,
        net_vendor_payable: true,
        challan_number: true,
        status: true,
      },
    });

    // A hire is the authority for the CURRENT assignment when one exists:
    // it is the record the operator actually agreed money against.
    const vehicle = trip.vehicle;
    const driver = trip.driver;
    const vendor = trip.transportOwner;

    const hireStatus = hire
      ? 'VEHICLE_HIRED'
      : (trip.vehicle_id && trip.driver_id)
        ? 'VEHICLE_ASSIGNED'
        : (trip.vehicle_id ? 'VEHICLE_ASSIGNED' : 'WAITING_FOR_VEHICLE');

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      booking_id: trip.booking_id,
      trip_status: trip.status,

      hire_status: hireStatus,
      hire_completed: Boolean(hire),

      vehicle: vehicle
        ? {
            vehicle_id: vehicle.vehicle_id,
            vehicle_number: vehicle.vehicle_number,
            vehicle_name: vehicle.vehicle_name,
            vehicle_type: vehicle.vehicle_type,
          }
        : null,
      driver: driver
        ? {
            driver_id: driver.driver_id,
            driver_name: driver.driver_name,
            mobile: driver.mobile,
          }
        : null,
      vendor: vendor
        ? {
            ...presentOwner(vendor),
            mobile: vendor.mobile,
          }
        : null,

      // Only present once a hire exists — three separate figures, never
      // collapsed. The gross is never overwritten by the net.
      hire: hire
        ? {
            hire_id: hire.hire_id,
            challan_number: hire.challan_number,
            billing_to: hire.billing_to,
            business_model: hire.business_model,
            gross_hire: Number(hire.gross_hire),
            commission_amount: Number(hire.commission_amount),
            net_vendor_payable: Number(hire.net_vendor_payable),
            status: hire.status,
          }
        : null,
    };
  }

  // ==========================================================================
  // AVAILABILITY — delegated, never reimplemented
  // ==========================================================================

  /**
   * Ask the EXISTING availability rules whether this consignment may engage
   * `vehicleId` / `driverId`.
   *
   * WHY A BRIDGE AND NOT A NEW CHECK
   *   `EnquiryAssignmentService` already implements the full rule set (1-8),
   *   including the pickup-window overlap maths that decides whether a truck
   *   committed to another job can be re-used. Writing a second version of that
   *   maths here is precisely the duplication this module must not introduce, so
   *   this method only translates "a Trip plus two ids" into the `enquiry`
   *   argument that module already expects, and lets it answer.
   *
   * FAIL-SAFE
   *   A trip with no linked enquiry has no enquiry-shaped load to validate, so
   *   there is nothing to check and the assignment proceeds under the rules
   *   this service already applied (existence + driver↔vendor coherence). It
   *   never throws merely because it could not find context to validate against.
   *
   * @param {object} trip
   * @param {number|null} vehicleId
   * @param {number|null} driverId
   * @param {object} [tx]
   */
  async _assertResourcesAvailable(trip, vehicleId, driverId, tx = null) {
    const enquiryId = trip?.enquiry_id ?? null;
    if (!enquiryId) return null;
    if (vehicleId == null && driverId == null) return null;

    const client = tx || this.prisma;
    // The load facts the capacity rule needs, plus the consignment's own id —
    // which is how the conflict scan excludes THIS consignment from itself.
    const enquiry = await client.enquiry.findUnique({
      where: { enquiry_id: enquiryId },
      select: {
        enquiry_id: true,
        pickup_date: true,
        pickup_time: true,
        weight: true,
        weight_unit: true,
      },
    });
    if (!enquiry) return null;

    await this.availability.validateAssignment(
      {
        enquiry,
        vehicleId,
        driverId,
        partnerId: null,
        ownerId: trip.transport_owner_id ?? null,
        // A REPLACEMENT is judged against the consignment's own current pick,
        // which `validateAssignment` already excludes via `enquiry_id`.
        isReassignment: true,
        // And against every trip EXCEPT this one. Without this a re-assignment
        // that carries a resource forward would report the consignment's own
        // trip as the conflict — the consignment blocking itself.
        excludeTripId: trip.trip_id,
      },
      tx,
    );

    return true;
  }

  // ==========================================================================
  // THE WRITE — one assignment, one transaction, everywhere
  // ==========================================================================

  /**
   * Assign (or re-assign) the vehicle, driver and vendor on a consignment.
   *
   * This is the ONLY writer of the current assignment. The Enquiry page and
   * the Vehicle Hire page both funnel through here, so they cannot disagree.
   *
   * Behaviour:
   *   • Partial input is carried forward — assigning only the driver keeps the
   *     vehicle already on the trip.
   *   • The vehicle's owner is adopted as the vendor when none is given, so
   *     payouts always route to the owner of the truck actually engaged.
   *   • The Trip row is UPDATED in place. There is only ever one current
   *     assignment, and a double-click cannot create a second.
   *   • Enquiry + Booking mirrors are updated in the SAME transaction, so the
   *     customer-facing screens agree with operations immediately.
   *   • The previous assignment is written to the append-only trip timeline
   *     before it is superseded, so history is never lost.
   *
   * @param {{tripId?:number, bookingId?:number, enquiryId?:number}} ref
   * @param {{vehicle_id?:number, driver_id?:number, vendor_id?:number}} input
   * @param {{userId?:number, role?:string}} [user]
   * @returns {Promise<Object>} the canonical current assignment (see above)
   */
  async assign(ref, input = {}, user = null) {
    const requestedVehicle = toId(input.vehicle_id);
    const requestedDriver = toId(input.driver_id);
    const requestedVendor = toId(input.vendor_id);

    if (requestedVehicle === null && requestedDriver === null && requestedVendor === null) {
      throw new ValidationError(
        'Provide at least one of vehicle_id, driver_id or vendor_id'
      );
    }

    const trip = await this.resolveTrip(ref);

    if (!ASSIGNABLE_TRIP_STATUSES.includes(String(trip.status))) {
      throw new ValidationError(
        `A vehicle cannot be assigned to a trip that is ${String(trip.status).toLowerCase()}.`
      );
    }

    // Carry forward whatever is already engaged; only the supplied parts change.
    const vehicleId = requestedVehicle !== null ? requestedVehicle : trip.vehicle_id;
    const driverId = requestedDriver !== null ? requestedDriver : trip.driver_id;
    let vendorId = requestedVendor !== null ? requestedVendor : trip.transport_owner_id;

    // ── Resolve the vehicle, and adopt its owner as the vendor by default ────
    let vehicle = null;
    if (vehicleId !== null && vehicleId !== undefined) {
      vehicle = await this.prisma.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        select: {
          vehicle_id: true,
          vehicle_number: true,
          vehicle_name: true,
          vehicle_type: true,
          owner_id: true,
        },
      });
      if (!vehicle) throw new ValidationError(`Vehicle ${vehicleId} was not found`);

      // Adopting the truck's own owner keeps vendor payments routed correctly
      // and avoids a vendor that does not own the engaged vehicle.
      if (requestedVendor === null) {
        vendorId = vehicle.owner_id ?? vendorId;
      }
    }

    // ── Resolve the driver and enforce vehicle/driver coherence ─────────────
    let driver = null;
    if (driverId !== null && driverId !== undefined) {
      driver = await this.prisma.driver.findUnique({
        where: { driver_id: driverId },
        select: {
          driver_id: true,
          driver_name: true,
          mobile: true,
          status: true,
          transport_owner_id: true,
        },
      });
      if (!driver) throw new ValidationError(`Driver ${driverId} was not found`);

      // A driver must belong to the vendor being engaged. One rule, applied
      // here, so the Enquiry screen and the Vehicle Hire screen cannot each
      // invent their own version of it.
      if (vendorId !== null && vendorId !== undefined && driver.transport_owner_id
          && driver.transport_owner_id !== vendorId) {
        throw new ValidationError(
          `Driver ${driver.driver_name} does not belong to the selected vehicle vendor`
        );
      }
    }

    // ── Resolve the vendor ─────────────────────────────────────────────────
    let vendor = null;
    if (vendorId !== null && vendorId !== undefined) {
      vendor = await this.prisma.vehicleOwner.findUnique({
        where: { owner_id: vendorId },
        select: { owner_id: true, owner_name: true, mobile: true, owner_type: true },
      });
      if (!vendor) throw new ValidationError(`Vehicle vendor ${vendorId} was not found`);
    }

    const previousVehicleId = trip.vehicle_id;
    const previousDriverId = trip.driver_id;
    const previousVendorId = trip.transport_owner_id;

    const vehicleChanged = vehicle && vehicle.vehicle_id !== previousVehicleId;
    const driverChanged = driver && driver.driver_id !== previousDriverId;
    const vendorChanged = vendor && vendor.owner_id !== previousVendorId;

    if (!vehicleChanged && !driverChanged && !vendorChanged) {
      // Idempotent: re-saving the same assignment is a harmless no-op rather
      // than a duplicate record or a misleading history entry.
      return this.getCurrentAssignment({ tripId: trip.trip_id });
    }

    // A vehicle change while the trip already holds a hire must not silently
    // repoint an agreed obligation at a different truck. The hire module owns
    // that decision (cancel/re-hire), so it is refused here with a clear reason.
    if (vehicleChanged) {
      const existingHire = await this.prisma.vehicleHire.findUnique({
        where: { trip_id: trip.trip_id },
        select: { hire_id: true, vehicle_id: true, challan_number: true },
      });
      if (existingHire && existingHire.vehicle_id !== vehicle.vehicle_id) {
        throw new ValidationError(
          `This trip's hire is already agreed against another vehicle. Edit or cancel the existing hire (${existingHire.challan_number || `hire #${existingHire.hire_id}`}) instead of reassigning it here.`
        );
      }
    }

    const assignmentPatch = {
      vehicle_id: vehicleId ?? null,
      driver_id: driverId ?? null,
      transport_owner_id: vendorId ?? null,
      updated_at: new Date(),
    };

    // ── AVAILABILITY, RE-USED (never re-invented) ──────────────────────────
    // A reservation can now be made BEFORE the customer accepts, so the vehicle
    // and driver must be checked against the consignment's OWN load, date and
    // existing commitments at the moment they are engaged — not only later.
    //
    // The rules themselves are NOT written here. `EnquiryAssignmentService`
    // already owns rules 1-8 (active vehicle/driver, driver↔vendor coherence,
    // capacity, and no conflicting commitment on an overlapping pickup day), and
    // this call is that module unchanged. The only thing added here is argument
    // adaptation — turning a trip into the `enquiry` shape that module expects.
    await this._assertResourcesAvailable(trip, vehicleId, driverId);

    await this.prisma.$transaction(async (tx) => {
      // 1. THE canonical write — update the existing Trip row. Never insert a
      //    second assignment: `trips.trip_id` is the primary key, so a second
      //    "current assignment" row is not even representable.
      await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: assignmentPatch,
      });

      // 2. HISTORY — append-only. The outgoing vehicle/driver are recorded
      //    BEFORE being superseded, so an old vehicle stays in the movement
      //    history instead of silently vanishing.
      if (vehicleChanged || driverChanged || vendorChanged) {
        await this.timelineRepo.create(
          {
            trip_id: trip.trip_id,
            event_type: 'vehicle_assignment_changed',
            description: [
              vehicleChanged
                ? `Vehicle changed: ${trip.vehicle?.vehicle_number || previousVehicleId || 'none'} → ${vehicle.vehicle_number}`
                : null,
              driverChanged
                ? `Driver changed: ${trip.driver?.driver_name || previousDriverId || 'none'} → ${driver.driver_name}`
                : null,
              vendorChanged
                ? `Vendor changed: ${trip.transportOwner?.owner_name || previousVendorId || 'none'} → ${vendor.owner_name}`
                : null,
            ]
              .filter(Boolean)
              .join(' · '),
            reference_type: 'vehicle_assignment',
            metadata: {
              from: {
                vehicle_id: previousVehicleId,
                vehicle_number: trip.vehicle?.vehicle_number || null,
                driver_id: previousDriverId,
                driver_name: trip.driver?.driver_name || null,
                vendor_id: previousVendorId,
                vendor_name: trip.transportOwner?.owner_name || null,
              },
              to: {
                vehicle_id: vehicleId ?? null,
                vehicle_number: vehicle?.vehicle_number || trip.vehicle?.vehicle_number || null,
                driver_id: driverId ?? null,
                driver_name: driver?.driver_name || trip.driver?.driver_name || null,
                vendor_id: vendorId ?? null,
                vendor_name: vendor?.owner_name || trip.transportOwner?.owner_name || null,
              },
            },
            created_by: user?.userId ?? null,
          },
          tx
        );
      }

      // 3. MIRRORS — kept in step in the SAME transaction, so the Enquiry and
      //    Booking screens can never show a stale assignment. They are mirrors,
      //    not authorities: vehicle hire always reads the Trip.
      //
      //    A RESERVATION trip is anchored on `enquiry_id`, because a vehicle is
      //    now assigned BEFORE the customer accepts and the Booking therefore
      //    does not exist yet. Resolving only through `booking_id` would leave
      //    that reservation invisible to the enquiry — and to the customer
      //    quote, which is read from the enquiry. The direct link is tried first
      //    and the booking lookup is the fallback for historical trips.
      const enquiryId =
        trip.enquiry_id ??
        (trip.booking_id
          ? (await tx.enquiry.findUnique({
              where: { booking_id: trip.booking_id },
              select: { enquiry_id: true },
            }))?.enquiry_id
          : null);

      if (enquiryId) {
        const enquiryPatch = {};
        if (vehicleChanged) {
          enquiryPatch.assigned_vehicle_id = vehicle.vehicle_id;
          enquiryPatch.assigned_vehicle_number = vehicle.vehicle_number;
          enquiryPatch.assigned_vehicle_type = vehicle.vehicle_name || vehicle.vehicle_type;
          enquiryPatch.vehicle_assigned_at = new Date();
        }
        if (driverChanged) {
          enquiryPatch.assigned_driver_id = driver.driver_id;
          enquiryPatch.assigned_driver_name = driver.driver_name;
          enquiryPatch.driver_assigned_at = new Date();
        }
        if (vendorChanged) {
          enquiryPatch.assigned_owner_id = vendor.owner_id;
        }
        if (Object.keys(enquiryPatch).length > 0) {
          await tx.enquiry.update({ where: { enquiry_id: enquiryId }, data: enquiryPatch });
        }
      }

      if (trip.booking_id) {
        const bookingPatch = {};
        if (vehicleChanged) bookingPatch.vehicle_id = vehicle.vehicle_id;
        if (driverChanged) bookingPatch.driver_id = driver.driver_id;
        if (vendorChanged) bookingPatch.vehicle_owner_id = vendor.owner_id;
        if (Object.keys(bookingPatch).length > 0) {
          await tx.booking.update({ where: { booking_id: trip.booking_id }, data: bookingPatch });
        }
      }
    }, { timeout: 60000 });

    // 4. Trip status follows the assignment, through the EXISTING state
    //    machine. A trip that gained a vehicle while still PENDING becomes
    //    ASSIGNED — the repository's existing "vehicle engaged" state — which
    //    is also what VehicleHirePolicy reads as VEHICLE HIRED territory. The
    //    distinction between "assigned" and "hired" is carried by the
    //    `vehicle_hires` row, never by overloading this status.
    const updatedTrip = await this.prisma.trip.findUnique({ where: { trip_id: trip.trip_id } });
    if (updatedTrip && updatedTrip.status === 'PENDING' && vehicleId && driverId) {
      tripStateMachine.validateOperationalTransition(updatedTrip.status, 'ASSIGNED');
      await this.prisma.trip.update({
        where: { trip_id: trip.trip_id },
        data: { status: 'ASSIGNED' },
      });
    }

    // 5. Handle resource availability on reassignment
    // After successful assignment, release old resources if they changed and are no longer on active trips
    // Mark new resources as busy if the trip is in active state
    const finalTrip = await this.prisma.trip.findUnique({ where: { trip_id: trip.trip_id } });
    const isActiveTrip = finalTrip && tripStateMachine.ACTIVE_TRIP_STATUSES.includes(finalTrip.status);
    
    // Release old resources if they changed
    if (vehicleChanged && previousVehicleId) {
      await this.resourceAvailability.releaseVehicleIfNoActiveTrip(previousVehicleId, trip.trip_id);
    }
    if (driverChanged && previousDriverId) {
      await this.resourceAvailability.releaseDriverIfNoActiveTrip(previousDriverId, trip.trip_id);
    }
    
    // Mark new resources as busy if trip is active
    if (isActiveTrip) {
      if (vehicleId) {
        await this.resourceAvailability.markVehicleBusy(vehicleId);
      }
      if (driverId) {
        await this.resourceAvailability.markDriverBusy(driverId);
      }
    }

    return this.getCurrentAssignment({ tripId: trip.trip_id });
  }

  // ==========================================================================
  // INTERNAL
  // ==========================================================================

  /** Relations loaded with a trip for assignment decisions. */
  _tripInclude() {
    return {
      vehicle: {
        select: { vehicle_id: true, vehicle_number: true, vehicle_name: true, vehicle_type: true, owner_id: true },
      },
      driver: { select: { driver_id: true, driver_name: true, mobile: true } },
      transportOwner: { select: { owner_id: true, owner_name: true, mobile: true, owner_type: true } },
    };
  }
}

/**
 * Parse a possibly-missing id into `number | null`.
 * `undefined` and `null` both mean "not supplied" (carry forward); `0`, `NaN`
 * and non-numeric strings are rejected rather than silently treated as absent.
 *
 * @param {*} v
 * @returns {number|null}
 */
function toId(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`"${v}" is not a valid id`);
  }
  return n;
}

module.exports = TripVehicleAssignmentService;
module.exports.TripVehicleAssignmentService = TripVehicleAssignmentService;
module.exports.ASSIGNABLE_TRIP_STATUSES = ASSIGNABLE_TRIP_STATUSES;
module.exports.toId = toId;