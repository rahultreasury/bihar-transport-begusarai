/**
 * ResourceAvailabilityService
 *
 * Centralized service for managing Driver and TransportVehicle operational
 * availability. All busy/available transitions flow through this service
 * to prevent inconsistent paired-field writes (e.g. is_available without
 * status, or vice-versa).
 *
 * ACTIVE_TRIP_STATUSES is imported from TripService so the release checks
 * remain consistent with STEP 2B double-booking protection.
 */

const { ValidationError } = require('../utils/AppError');

// Keep this in sync with TripService.ACTIVE_TRIP_STATUSES.
const ACTIVE_TRIP_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'];

class ResourceAvailabilityService {
  /**
   * @param {Object=} deps
   * @param {PrismaClient=} deps.prisma - Optional Prisma client (for testing).
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || require('../config/prisma').prisma;
  }

  /**
   * Mark a driver as busy (on_trip).
   * Updates BOTH status and is_available atomically.
   *
   * @param {number} driverId
   * @param {object} [tx] - Optional Prisma transaction client.
   */
  async markDriverBusy(driverId, tx = null) {
    const client = tx || this.prisma;
    await client.driver.update({
      where: { driver_id: driverId },
      data: {
        status: 'on_trip',
        is_available: false,
      },
    });
  }

  /**
   * Mark a vehicle as busy (on_trip).
   * Updates BOTH current_status and is_available atomically.
   *
   * @param {number} vehicleId
   * @param {object} [tx] - Optional Prisma transaction client.
   */
  async markVehicleBusy(vehicleId, tx = null) {
    const client = tx || this.prisma;
    await client.transportVehicle.update({
      where: { vehicle_id: vehicleId },
      data: {
        current_status: 'on_trip',
        is_available: false,
      },
    });
  }

  /**
   * Mark a driver as available.
   * Updates BOTH status and is_available atomically.
   *
   * @param {number} driverId
   * @param {object} [tx] - Optional Prisma transaction client.
   */
  async markDriverAvailable(driverId, tx = null) {
    const client = tx || this.prisma;
    await client.driver.update({
      where: { driver_id: driverId },
      data: {
        status: 'available',
        is_available: true,
      },
    });
  }

  /**
   * Mark a vehicle as available.
   * Updates BOTH current_status and is_available atomically.
   *
   * @param {number} vehicleId
   * @param {object} [tx] - Optional Prisma transaction client.
   */
  async markVehicleAvailable(vehicleId, tx = null) {
    const client = tx || this.prisma;
    await client.transportVehicle.update({
      where: { vehicle_id: vehicleId },
      data: {
        current_status: 'available',
        is_available: true,
      },
    });
  }

  /**
   * Release a driver ONLY if they have no other active Trip.
   *
   * Active = status in ACTIVE_TRIP_STATUSES (PENDING, ASSIGNED, IN_TRANSIT, DELIVERED).
   *
   * @param {number} driverId
   * @param {number|null} excludeTripId - Trip to exclude from the check
   *        (used when completing/cancelling a specific trip).
   * @param {object} [tx] - Optional Prisma transaction client.
   * @returns {boolean} true if driver was released, false if still busy.
   */
  async releaseDriverIfNoActiveTrip(driverId, excludeTripId = null, tx = null) {
    const client = tx || this.prisma;

    const where = {
      driver_id: driverId,
      status: { in: ACTIVE_TRIP_STATUSES },
    };
    if (excludeTripId) {
      where.NOT = { trip_id: excludeTripId };
    }

    const activeTrip = await client.trip.findFirst({
      where,
      select: { trip_id: true, status: true },
    });

    if (!activeTrip) {
      await this.markDriverAvailable(driverId, client);
      return true;
    }

    // Driver is still locked to another active trip.
    return false;
  }

  /**
   * Release a vehicle ONLY if it has no other active Trip.
   *
   * @param {number} vehicleId
   * @param {number|null} excludeTripId
   * @param {object} [tx] - Optional Prisma transaction client.
   * @returns {boolean} true if vehicle was released, false if still busy.
   */
  async releaseVehicleIfNoActiveTrip(vehicleId, excludeTripId = null, tx = null) {
    const client = tx || this.prisma;

    const where = {
      vehicle_id: vehicleId,
      status: { in: ACTIVE_TRIP_STATUSES },
    };
    if (excludeTripId) {
      where.NOT = { trip_id: excludeTripId };
    }

    const activeTrip = await client.trip.findFirst({
      where,
      select: { trip_id: true, status: true },
    });

    if (!activeTrip) {
      await this.markVehicleAvailable(vehicleId, client);
      return true;
    }

    return false;
  }

  /**
   * Release both driver and vehicle for a completed/cancelled trip,
   * but only if each has no other active trip.
   *
   * @param {number} driverId
   * @param {number} vehicleId
   * @param {number|null} excludeTripId
   * @param {object} [tx] - Optional Prisma transaction client.
   * @returns {object} { driverReleased, vehicleReleased }
   */
  async releaseResourcesIfNoActiveTrip(driverId, vehicleId, excludeTripId = null, tx = null) {
    const client = tx || this.prisma;

    const [driverReleased, vehicleReleased] = await Promise.all([
      driverId ? this.releaseDriverIfNoActiveTrip(driverId, excludeTripId, client) : Promise.resolve(true),
      vehicleId ? this.releaseVehicleIfNoActiveTrip(vehicleId, excludeTripId, client) : Promise.resolve(true),
    ]);

    return { driverReleased, vehicleReleased };
  }
}

module.exports = ResourceAvailabilityService;
