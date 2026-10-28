/**
 * operationalTripStatus.js
 * ---------------------------------------------------------------------------
 * Single source of truth for what constitutes an "operationally active trip".
 *
 * This module defines the authoritative criteria for a trip to be considered
 * operationally active (i.e., a real trip that engages driver/vehicle resources),
 * as opposed to placeholder/pre-operational trip records.
 *
 * Used by:
 * - DriverRepository.getDashboardStats() - for "onTrip" driver count
 * - BookingRepository.getLifecycleSummary() - for "activeTrips" count
 * - DriverManagementService.syncDriverStatusWithTrips() - for driver status sync
 * - Any other component needing consistent operational trip definition
 */

const { PrismaClient } = require('@prisma/client');

/**
 * Trip statuses that are terminal (trip is fully done)
 */
const TERMINAL_TRIP_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED']);

/**
 * Trip statuses that represent operational activity (non-terminal)
 * Matches TripStateMachine.ACTIVE_TRIP_STATUSES
 */
const OPERATIONAL_TRIP_STATUSES = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
  'LOADED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
]);

/**
 * Determines if a trip has "operational substance" - i.e., it's not just a
 * placeholder PENDING record but represents a real operational commitment.
 *
 * A trip has operational substance if it has at least ONE of:
 * - A linked booking (booking_id)
 * - A linked vehicle hire (vehicleHire relation)
 * - Both a driver AND a vehicle assigned (driver_id + vehicle_id)
 * - Status beyond PENDING (ASSIGNED or later implies operational commitment)
 *
 * @param {Object} trip - Trip record with relations
 * @returns {boolean}
 */
function hasOperationalSubstance(trip) {
  // Terminal trips are never operationally active
  if (TERMINAL_TRIP_STATUSES.includes(trip.status)) {
    return false;
  }

  // Trips beyond PENDING have operational substance by definition
  if (trip.status !== 'PENDING') {
    return true;
  }

  // PENDING trips need at least one operational link
  const hasBooking = !!trip.booking_id;
  const hasVehicleHire = !!trip.vehicleHire;
  const hasDriverAndVehicle = !!trip.driver_id && !!trip.vehicle_id;

  return hasBooking || hasVehicleHire || hasDriverAndVehicle;
}

/**
 * Builds a Prisma where clause for operationally active trips.
 * This is the authoritative definition used across the application.
 *
 * @returns {Object} Prisma where clause
 */
function getOperationalActiveTripWhere() {
  return {
    status: { in: OPERATIONAL_TRIP_STATUSES },
    OR: [
      // Has a booking link
      { booking_id: { not: null } },
      // Has a vehicle hire link
      { vehicleHire: { isNot: null } },
      // Has both driver and vehicle assigned
      { AND: [{ driver_id: { not: null } }, { vehicle_id: { not: null } }] },
      // Status beyond PENDING (ASSIGNED or later)
      { status: { not: 'PENDING' } },
    ],
  };
}

/**
 * Builds a Prisma where clause for drivers with operationally active trips.
 * Used for "onTrip" driver counts and status sync.
 *
 * @returns {Object} Prisma where clause for Driver model
 */
function getDriverWithOperationalActiveTripsWhere() {
  return {
    trips: {
      some: getOperationalActiveTripWhere(),
    },
  };
}

/**
 * Builds a Prisma where clause for bookings with operationally active trips.
 * Used for "activeTrips" booking counts.
 *
 * @param {Object} baseWhere - Additional base where conditions (e.g., archived_at: null)
 * @returns {Object} Prisma where clause for Booking model
 */
function getBookingWithOperationalActiveTripsWhere(baseWhere = {}) {
  return {
    ...baseWhere,
    trips: {
      some: getOperationalActiveTripWhere(),
    },
  };
}

module.exports = {
  TERMINAL_TRIP_STATUSES,
  OPERATIONAL_TRIP_STATUSES,
  hasOperationalSubstance,
  getOperationalActiveTripWhere,
  getDriverWithOperationalActiveTripsWhere,
  getBookingWithOperationalActiveTripsWhere,
};