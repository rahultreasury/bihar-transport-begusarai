/**
 * BookingAssignmentRepository
 * Database-only repository for tracking driver assignment history.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

class BookingAssignmentRepository {
  /**
   * Assign a driver to a booking (creates a new assignment record).
   * @param {number} bookingId
   * @param {number} driverId
   * @param {number=} adminId
   * @param {number=} vehicleId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{booking_assignment_id:number}>}
   */
  async assignDriver(bookingId, driverId, adminId, vehicleId = null, tx = null) {
    const client = tx || prisma;
    try {
      const assignment = await client.bookingAssignment.create({
        data: {
          booking_id: bookingId,
          assigned_driver_id: driverId,
          assigned_vehicle_id: vehicleId,
          assigned_by_admin_id: adminId ?? null,
          assignment_status: 'active',
        },
      });

      // Sync to Trip if it exists and is in assignable state
      await this._syncToTrip(bookingId, { driverId }, client);

      return { booking_assignment_id: assignment.booking_assignment_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Assign a vehicle to a booking (creates or updates assignment record).
   * @param {number} bookingId
   * @param {number} vehicleId
   * @param {number=} adminId
   * @param {number=} driverId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{booking_assignment_id:number}>}
   */
  async assignVehicle(bookingId, vehicleId, adminId, driverId = null, tx = null) {
    const client = tx || prisma;
    try {
      const assignment = await client.bookingAssignment.create({
        data: {
          booking_id: bookingId,
          assigned_vehicle_id: vehicleId,
          assigned_driver_id: driverId,
          assigned_by_admin_id: adminId ?? null,
          assignment_status: 'active',
        },
      });

      // Sync to Trip if it exists and is in assignable state
      await this._syncToTrip(bookingId, { vehicleId }, client);

      return { booking_assignment_id: assignment.booking_assignment_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get current (latest active) assignment.
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async getCurrentAssignment(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.bookingAssignment.findFirst({
        where: {
          booking_id: bookingId,
          assignment_status: 'active',
        },
        orderBy: [
          { created_at: 'desc' },
          { booking_assignment_id: 'desc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get full assignment history for a booking.
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object[]>}
   */
  async getAssignmentHistory(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.bookingAssignment.findMany({
        where: { booking_id: bookingId },
        orderBy: [
          { created_at: 'desc' },
          { booking_assignment_id: 'desc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Sync assignment to Trip if it exists and is in an assignable state.
   * Uses the same assignable statuses as TripVehicleAssignmentService.
   * @private
   */
  async _syncToTrip(bookingId, { driverId, vehicleId } = {}, client) {
    if (!driverId && !vehicleId) return;

    // Find the Trip for this booking
    const trip = await client.trip.findFirst({
      where: { booking_id: bookingId },
      select: { trip_id: true, status: true },
    });

    if (!trip) return; // No Trip exists yet — nothing to sync

    // Only sync if Trip is in an assignable state (mirrors TripVehicleAssignmentService.ASSIGNABLE_TRIP_STATUSES)
    const assignableStatuses = ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT'];
    if (!assignableStatuses.includes(trip.status)) return;

    const updateData = { updated_at: new Date() };
    if (driverId) updateData.driver_id = driverId;
    if (vehicleId) updateData.vehicle_id = vehicleId;

    await client.trip.update({
      where: { trip_id: trip.trip_id },
      data: updateData,
    });
  }
}

module.exports = BookingAssignmentRepository;
