/**
 * BookingAssignmentRepository
 * Database-only repository for tracking assignments (driver/vehicle) history.
 */

const { query, run, get } = require('../config/database');

class BookingAssignmentRepository {
  /**
   * Assign a driver to a booking (creates a new assignment record).
   * @param {number} bookingId
   * @param {number} driverId
   * @param {number=} adminId
   * @param {number=} vehicleId - Optional vehicle assignment at the same time.
   * @returns {Promise<{booking_assignment_id:number}>}
   */
  async assignDriver(bookingId, driverId, adminId, vehicleId, tx = null) {
    try {
      const runner = tx?.run ?? run;
      const result = await runner(
        `INSERT INTO booking_assignments (booking_id, assigned_driver_id, assigned_vehicle_id, assigned_by_admin_id, assignment_status)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, driverId, vehicleId ?? null, adminId ?? null, 'active']
      );
      return { booking_assignment_id: result.lastID };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Assign a vehicle to a booking (creates a new assignment record).
   * @param {number} bookingId
   * @param {number} vehicleId
   * @param {number=} adminId
   * @param {number=} driverId - Optional driver assignment at the same time.
   * @returns {Promise<{booking_assignment_id:number}>}
   */
  async assignVehicle(bookingId, vehicleId, adminId, driverId, tx = null) {
    try {
      const runner = tx?.run ?? run;
      const result = await runner(
        `INSERT INTO booking_assignments (booking_id, assigned_driver_id, assigned_vehicle_id, assigned_by_admin_id, assignment_status)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, driverId ?? null, vehicleId, adminId ?? null, 'active']
      );
      return { booking_assignment_id: result.lastID };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get current (latest active) assignment.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async getCurrentAssignment(bookingId, tx = null) {
    try {
      const getter = tx?.get ?? get;
      return await getter(
        `SELECT booking_assignment_id, booking_id, assigned_driver_id, assigned_vehicle_id, assigned_by_admin_id, assignment_status, created_at
         FROM booking_assignments
         WHERE booking_id = ? AND assignment_status = 'active'
         ORDER BY created_at DESC, booking_assignment_id DESC
         LIMIT 1`,
        [bookingId]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get full assignment history for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object[]>}
   */
  async getAssignmentHistory(bookingId, tx = null) {
    try {
      const runner = tx?.query ?? query;
      return await runner(
        `SELECT booking_assignment_id, booking_id, assigned_driver_id, assigned_vehicle_id, assigned_by_admin_id, assignment_status, created_at
         FROM booking_assignments
         WHERE booking_id = ?
         ORDER BY created_at DESC, booking_assignment_id DESC`,
        [bookingId]
      );
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingAssignmentRepository;

