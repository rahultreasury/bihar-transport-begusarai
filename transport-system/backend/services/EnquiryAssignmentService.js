/**
 * EnquiryAssignmentService
 * ---------------------------------------------------------------------------
 * Server-side validation for every admin assignment decision.
 *
 * THE PRINCIPLE
 * The browser is never trusted. An admin UI can post `driver_id: 42` and an
 * operator can call the endpoint directly with curl — so every rule below is
 * re-checked against the database at write time, inside the same transaction
 * that performs the assignment.
 *
 * THE EIGHT RULES
 *   1. Driver exists.
 *   2. Driver is active (not inactive/suspended).
 *   3. Vehicle exists.
 *   4. Vehicle is active.
 *   5. Driver ↔ vehicle/owner association is coherent.
 *   6. Vehicle capacity is sufficient for the load weight.
 *   7. Vehicle is not already committed to a conflicting active trip/enquiry.
 *   8. Pickup schedule does not conflict with that other commitment.
 *
 * Rules 7 and 8 are what stop a double-booked vehicle: a truck already on
 * another job with an overlapping pickup window cannot be assigned here.
 */

const { prisma } = require('../config/prisma');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/AppError');
const { logger } = require('../utils/logger');

/**
 * Trip/booking statuses that mean "this resource is committed right now".
 * Mirrors ResourceAvailabilityService.ACTIVE_TRIP_STATUSES plus the enquiry
 * statuses that hold a vehicle between assignment and acceptance.
 */
const ACTIVE_TRIP_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'];

/** Enquiry statuses that already hold a vehicle/driver. */
const ENQUIRY_HOLD_STATUSES = [
  'VEHICLE_ASSIGNED',
  'DRIVER_ASSIGNED',
  'QUOTE_READY',
  'AWAITING_CUSTOMER_ACCEPTANCE',
  'CUSTOMER_ACCEPTED',
  'CONFIRMED',
  'IN_PROGRESS',
];

/**
 * Convert a weight to kilograms for capacity comparison.
 *
 * The booking form lets a customer pick KG / Tons / Quintal / Metric Ton / FTL.
 * Capacity is stored in kg, so every supported unit must be normalised before
 * comparing — otherwise "8 Tons" against a "capacity_kg: 12000" truck would
 * look like 8 kg and pass a check that should have failed.
 *
 * @param {number|null|undefined} value
 * @param {string|null|undefined} unit
 * @returns {number|null} kilograms, or null when the value is unusable
 */
function toKilograms(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

  const u = String(unit || 'KG').trim().toUpperCase();

  switch (u) {
    case 'TON':
    case 'TONS':
    case 'MT':
    case 'METRIC TON':
    case 'METRIC TONNE':
      return n * 1000;
    case 'QUINTAL':
    case 'Q':
    case 'QNTL':
      return n * 100;
    case 'FTL':
      // Full Truck Load — the capacity IS the load. Treated as "cannot verify"
      // by the capacity check rather than a hard number.
      return null;
    case 'KG':
    case 'KGS':
    default:
      return n;
  }
}

/**
 * Does a pickup datetime range overlap another commitment?
 *
 * A commitment is treated as a same-day window centred on its pickup datetime
 * (±1 day) because an enquiry has no defined return leg. Two loads whose
 * pickup datetimes fall on the same calendar day always conflict — a truck
 * cannot be in two places at once.
 *
 * @param {Date} aStart
 * @param {Date} aEnd
 * @param {Date} bStart
 * @param {Date} bEnd
 * @returns {boolean}
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Build the pickup window used for conflict detection.
 *
 * The window is the pickup's CALENDAR DAY (local midnight → end of day), not a
 * rolling 24 hours from the requested pickup time. That distinction matters: a
 * rolling 24h window starting at 26 Sep 10:00 ends at 27 Sep 10:00, so a load
 * scheduled for 27 Sep 10:00 would be reported as conflicting with the 26th
 * one — wrong, and it would block legitimate back-to-back bookings. A
 * same-calendar-day window makes two loads on the same day conflict (correct,
 * a truck cannot be in two places) and leaves adjacent days free.
 *
 * @param {Date} pickupDate
 * @param {string} pickupTime
 * @returns {{start: Date, end: Date}}
 */
function pickupWindow(pickupDate, pickupTime) {
  const base = new Date(pickupDate);
  if (Number.isNaN(base.getTime())) {
    const now = new Date();
    return { start: now, end: now };
  }

  const start = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0);
  const end = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 59, 59, 999);
  return { start, end };
}

/**
 * Build the same calendar-day window for an existing Trip's trip_date, so an
 * active trip conflicts on the same rule an enquiry does.
 * @param {Date} tripDate
 * @returns {{start: Date, end: Date}}
 */
function tripWindow(tripDate) {
  const base = new Date(tripDate);
  if (Number.isNaN(base.getTime())) {
    const now = new Date();
    return { start: now, end: now };
  }
  const start = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0);
  const end = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 59, 59, 999);
  return { start, end };
}

class EnquiryAssignmentService {
  /**
   * @param {Object=} deps
   * @param {import('@prisma/client').PrismaClient=} deps.prisma
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || prisma;
  }

  // ── Rule 1 + 2: driver exists and is active ──────────────────────────
  /**
   * @param {number} driverId
   * @param {import('@prisma/client').PrismaClient} [tx]
   * @returns {Promise<object>} the Driver row
   * @throws {NotFoundError|ValidationError}
   */
  async loadActiveDriver(driverId, tx) {
    const client = tx || this.prisma;
    const id = Number(driverId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError({ message: 'A valid driver_id is required' });
    }

    const driver = await client.driver.findUnique({
      where: { driver_id: id },
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        status: true,
        is_available: true,
        rating: true,
        transport_owner_id: true,
        partner_id: true,
        current_vehicle_id: true,
        license_expiry: true,
      },
    });

    if (!driver) {
      throw new NotFoundError({ message: 'Driver not found' });
    }
    if (String(driver.status || '').toLowerCase() === 'inactive') {
      throw new ValidationError({
        message: `Driver ${driver.driver_name} is inactive and cannot be assigned`,
      });
    }
    return driver;
  }

  // ── Rule 3 + 4: vehicle exists and is active ─────────────────────────
  /**
   * @param {number} vehicleId
   * @param {import('@prisma/client').PrismaClient} [tx]
   * @returns {Promise<object>} the TransportVehicle row
   * @throws {NotFoundError|ValidationError}
   */
  async loadActiveVehicle(vehicleId, tx) {
    const client = tx || this.prisma;
    const id = Number(vehicleId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError({ message: 'A valid vehicle_id is required' });
    }

    const vehicle = await client.transportVehicle.findUnique({
      where: { vehicle_id: id },
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_type: true,
        vehicle_name: true,
        capacity_kg: true,
        body_type: true,
        current_status: true,
        is_available: true,
        owner_id: true,
        partner_id: true,
        driver_id: true,
        insurance_expiry: true,
        permit_expiry: true,
      },
    });

    if (!vehicle) {
      throw new NotFoundError({ message: 'Vehicle not found' });
    }

    const status = String(vehicle.current_status || '').toLowerCase();
    if (status === 'off_road' || status === 'maintenance' || status === 'scrapped') {
      throw new ValidationError({
        message: `Vehicle ${vehicle.vehicle_number} is ${status.replace('_', ' ')} and cannot be assigned`,
      });
    }
    return vehicle;
  }

  // ── Rule 5: driver ↔ vehicle / owner coherence ───────────────────────
  /**
   * A driver who is permanently paired to one vehicle (Driver.current_vehicle_id)
   * must not be assigned to a different vehicle for the same load, and a vehicle
   * that is exclusively crewed (TransportVehicle.driver_id) must not be paired
   * with a different driver without dispatch overriding it.
   *
   * @param {object} driver
   * @param {object} vehicle
   * @param {object} [opts]
   * @param {boolean} [opts.isReassignment] - allow a documented override
   */
  assertDriverVehicleCoherence(driver, vehicle, opts = {}) {
    if (driver.current_vehicle_id && driver.current_vehicle_id !== vehicle.vehicle_id) {
      throw new ConflictError({
        message:
          `Driver ${driver.driver_name} is permanently paired with another vehicle. ` +
          'Free the pairing or pick a different driver.',
      });
    }

    if (vehicle.driver_id && vehicle.driver_id !== driver.driver_id && !opts.isReassignment) {
      throw new ConflictError({
        message:
          `Vehicle ${vehicle.vehicle_number} is already crewed by another driver. ` +
          'Reassign the vehicle first, or use the reassign endpoint.',
      });
    }

    // When both sides declare an owner they must agree, otherwise the payout
    // would be routed to the wrong Transport Owner in the financial system.
    if (driver.transport_owner_id && vehicle.owner_id && driver.transport_owner_id !== vehicle.owner_id) {
      throw new ConflictError({
        message:
          'Driver and vehicle belong to different Transport Owners. ' +
          'Assign a driver and vehicle from the same owner, or reassign the vehicle.',
      });
    }
  }

  // ── Rule 6: capacity sufficiency ─────────────────────────────────────
  /**
   * @param {object} vehicle
   * @param {number|null} weight
   * @param {string|null} weightUnit
   */
  assertCapacitySufficient(vehicle, weight, weightUnit) {
    const capacityKg = Number(vehicle.capacity_kg);
    if (!Number.isFinite(capacityKg) || capacityKg <= 0) {
      // No declared capacity — the admin is on their own; do not block the
      // assignment on missing reference data.
      return;
    }

    const loadKg = toKilograms(weight, weightUnit);
    if (loadKg === null) {
      // FTL / unknown: capacity check is meaningless, allow it.
      return;
    }

    if (loadKg > capacityKg) {
      throw new ValidationError({
        message:
          `Vehicle ${vehicle.vehicle_number} capacity is ${Math.round(capacityKg).toLocaleString('en-IN')} kg, ` +
          `which is less than the requested load of ${Math.round(loadKg).toLocaleString('en-IN')} kg.`,
      });
    }
  }

  // ── Rules 7 + 8: no conflicting vehicle / driver commitment ──────────
  /**
   * Reject an assignment when the vehicle is already held by another live
   * enquiry or trip whose pickup window overlaps this one.
   *
   * @param {object} params
   * @param {number} params.vehicleId
   * @param {Date} params.pickupDate
   * @param {string} params.pickupTime
   * @param {number} params.excludeEnquiryId - the enquiry being assigned
   * @param {import('@prisma/client').PrismaClient} [params.tx]
   */
  async assertVehicleFree(params, tx) {
    const client = tx || this.prisma;
    const { vehicleId, pickupDate, pickupTime, excludeEnquiryId } = params;
    const { start, end } = pickupWindow(pickupDate, pickupTime);

    // (a) Another live ENQUIRY already holds this vehicle.
    const otherEnquiry = await client.enquiry.findFirst({
      where: {
        enquiry_id: excludeEnquiryId ? { not: Number(excludeEnquiryId) } : undefined,
        assigned_vehicle_id: Number(vehicleId),
        status: { in: ENQUIRY_HOLD_STATUSES },
      },
      select: { enquiry_id: true, enquiry_number: true, pickup_date: true, pickup_time: true, status: true },
    });

    if (otherEnquiry) {
      const ow = pickupWindow(otherEnquiry.pickup_date, otherEnquiry.pickup_time);
      if (rangesOverlap(start, end, ow.start, ow.end)) {
        throw new ConflictError({
          message:
            `This vehicle is already assigned to enquiry ${otherEnquiry.enquiry_number} ` +
            'for an overlapping pickup schedule. Resolve that assignment first.',
        });
      }
    }

    // (b) An active TRIP already uses this vehicle.
    const activeTrip = await client.trip.findFirst({
      where: {
        vehicle_id: Number(vehicleId),
        status: { in: ACTIVE_TRIP_STATUSES },
      },
      select: { trip_id: true, trip_number: true, trip_date: true, status: true },
    });

// An active trip blocks this enquiry when it falls on the SAME calendar day.
    if (activeTrip && activeTrip.trip_date) {
      const tw = tripWindow(activeTrip.trip_date);
      if (rangesOverlap(start, end, tw.start, tw.end)) {
        throw new ConflictError({
          message:
            `This vehicle is already on active trip ${activeTrip.trip_number}. ` +
            'Choose another vehicle or complete that trip first.',
        });
      }
    }
  }

  /**
   * Reject an assignment when the driver is already committed elsewhere.
   * @param {object} params
   * @param {number} params.driverId
   * @param {Date} params.pickupDate
   * @param {string} params.pickupTime
   * @param {number} params.excludeEnquiryId
   * @param {import('@prisma/client').PrismaClient} [params.tx]
   */
  async assertDriverFree(params, tx) {
    const client = tx || this.prisma;
    const { driverId, pickupDate, pickupTime, excludeEnquiryId } = params;
    const { start, end } = pickupWindow(pickupDate, pickupTime);

    const otherEnquiry = await client.enquiry.findFirst({
      where: {
        enquiry_id: excludeEnquiryId ? { not: Number(excludeEnquiryId) } : undefined,
        assigned_driver_id: Number(driverId),
        status: { in: ENQUIRY_HOLD_STATUSES },
      },
      select: { enquiry_id: true, enquiry_number: true, pickup_date: true, pickup_time: true, status: true },
    });

    if (otherEnquiry) {
      const ow = pickupWindow(otherEnquiry.pickup_date, otherEnquiry.pickup_time);
      if (rangesOverlap(start, end, ow.start, ow.end)) {
        throw new ConflictError({
          message:
            `This driver is already assigned to enquiry ${otherEnquiry.enquiry_number} ` +
            'for an overlapping pickup schedule.',
        });
      }
    }

    const activeTrip = await client.trip.findFirst({
      where: { driver_id: Number(driverId), status: { in: ACTIVE_TRIP_STATUSES } },
      select: { trip_id: true, trip_number: true, trip_date: true, status: true },
    });

// Same calendar-day rule as the vehicle check.
    if (activeTrip && activeTrip.trip_date) {
      const tw = tripWindow(activeTrip.trip_date);
      if (rangesOverlap(start, end, tw.start, tw.end)) {
        throw new ConflictError({
          message: `This driver is already on active trip ${activeTrip.trip_number}.`,
        });
      }
    }
  }

  /**
   * Validate a partner / transport owner reference.
   * @param {number} partnerId
   * @param {import('@prisma/client').PrismaClient} [tx]
   */
  async loadActivePartner(partnerId, tx) {
    const client = tx || this.prisma;
    const partner = await client.partner.findUnique({
      where: { partner_id: Number(partnerId) },
      select: { partner_id: true, partner_name: true, partner_code: true, status: true },
    });
    if (!partner) throw new NotFoundError({ message: 'Transport partner not found' });
    if (String(partner.status || '').toLowerCase() !== 'active') {
      throw new ValidationError({
        message: `Partner ${partner.partner_name} is not active (status: ${partner.status})`,
      });
    }
    return partner;
  }

  /**
   * Validate a transport owner (VehicleOwner) reference.
   * @param {number} ownerId
   * @param {import('@prisma/client').PrismaClient} [tx]
   */
  async loadActiveOwner(ownerId, tx) {
    const client = tx || this.prisma;
    const owner = await client.vehicleOwner.findUnique({
      where: { owner_id: Number(ownerId) },
      select: { owner_id: true, owner_name: true, company_name: true, status: true, is_active: true, deleted_at: true },
    });
    if (!owner) throw new NotFoundError({ message: 'Transport owner not found' });
    if (owner.deleted_at) {
      throw new ValidationError({ message: 'This transport owner has been deleted' });
    }
    if (owner.is_active === false || String(owner.status || '').toLowerCase() === 'inactive') {
      throw new ValidationError({ message: 'This transport owner is not active' });
    }
    return owner;
  }

  /**
   * Run every applicable rule for a combined vehicle+driver(+owner/partner)
   * assignment. This is the single entry point the admin assign endpoint uses.
   *
   * @param {Object} params
   * @param {object} params.enquiry - the enquiry row being assigned
   * @param {number} [params.vehicleId]
   * @param {number} [params.driverId]
   * @param {number} [params.partnerId]
   * @param {number} [params.ownerId]
   * @param {boolean} [params.isReassignment=false]
   * @param {import('@prisma/client').PrismaClient} [params.tx]
   * @returns {Promise<{vehicle?:object, driver?:object, partner?:object, owner?:object}>}
   */
  async validateAssignment(params, tx) {
    const { enquiry, vehicleId, driverId, partnerId, ownerId, isReassignment = false } = params;
    const client = tx || this.prisma;
    const out = {};

    if (vehicleId) out.vehicle = await this.loadActiveVehicle(vehicleId, client);
    if (driverId) out.driver = await this.loadActiveDriver(driverId, client);
    if (partnerId) out.partner = await this.loadActivePartner(partnerId, client);
    if (ownerId) out.owner = await this.loadActiveOwner(ownerId, client);

    if (out.vehicle && out.driver) {
      this.assertDriverVehicleCoherence(out.driver, out.vehicle, { isReassignment });
    }

    if (out.vehicle) {
      this.assertCapacitySufficient(out.vehicle, enquiry.weight, enquiry.weight_unit);
      await this.assertVehicleFree(
        {
          vehicleId: out.vehicle.vehicle_id,
          pickupDate: enquiry.pickup_date,
          pickupTime: enquiry.pickup_time,
          excludeEnquiryId: enquiry.enquiry_id,
        },
        client
      );
    }

    if (out.driver) {
      await this.assertDriverFree(
        {
          driverId: out.driver.driver_id,
          pickupDate: enquiry.pickup_date,
          pickupTime: enquiry.pickup_time,
          excludeEnquiryId: enquiry.enquiry_id,
        },
        client
      );
    }

    return out;
  }

  /**
   * Options for the admin assignment dropdowns.
   * Returned pre-filtered to assignable resources so the UI does not offer an
   * invalid option in the first place (server validation still runs regardless).
   *
   * @returns {Promise<{vehicles:object[], drivers:object[], partners:object[], owners:object[]}>}
   */
  async listAssignableOptions() {
    const [vehicles, drivers, partners, owners] = await Promise.all([
      this.prisma.transportVehicle.findMany({
        where: { current_status: { notIn: ['off_road', 'maintenance', 'scrapped'] } },
        select: {
          vehicle_id: true,
          vehicle_number: true,
          vehicle_type: true,
          vehicle_name: true,
          capacity_kg: true,
          body_type: true,
          current_status: true,
          owner_id: true,
          driver_id: true,
        },
        orderBy: { vehicle_number: 'asc' },
        take: 500,
      }),
      this.prisma.driver.findMany({
        where: { status: { not: 'inactive' } },
        select: {
          driver_id: true,
          driver_code: true,
          driver_name: true,
          status: true,
          is_available: true,
          rating: true,
          transport_owner_id: true,
          partner_id: true,
          current_vehicle_id: true,
        },
        orderBy: { driver_name: 'asc' },
        take: 500,
      }),
      this.prisma.partner.findMany({
        where: { status: 'active' },
        select: { partner_id: true, partner_name: true, partner_code: true, city: true },
        orderBy: { partner_name: 'asc' },
        take: 300,
      }),
      this.prisma.vehicleOwner.findMany({
        where: { deleted_at: null, is_active: { not: false } },
        select: { owner_id: true, owner_name: true, company_name: true, city: true, state: true, status: true },
        orderBy: { owner_name: 'asc' },
        take: 300,
      }),
    ]);

    return { vehicles, drivers, partners, owners };
  }
}

module.exports = new EnquiryAssignmentService();
module.exports.EnquiryAssignmentService = EnquiryAssignmentService;
module.exports.toKilograms = toKilograms;
module.exports.pickupWindow = pickupWindow;
module.exports.tripWindow = tripWindow;
module.exports.rangesOverlap = rangesOverlap;
module.exports.ACTIVE_TRIP_STATUSES = ACTIVE_TRIP_STATUSES;
module.exports.ENQUIRY_HOLD_STATUSES = ENQUIRY_HOLD_STATUSES;
