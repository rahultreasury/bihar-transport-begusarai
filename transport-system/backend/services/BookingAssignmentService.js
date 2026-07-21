/**
 * BookingAssignmentService
 * Business logic for assignments.
 */

const BookingAssignmentRepository = require('../repositories/BookingAssignmentRepository');
const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');

class BookingAssignmentDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BookingAssignmentDomainError';
    this.code = code;
  }
}

class ValidationError extends BookingAssignmentDomainError {
  constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends BookingAssignmentDomainError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

class BookingAssignmentService {
  /**
   * @param {Object=} deps
   * @param {BookingAssignmentRepository=} deps.assignmentRepo
   * @param {BookingTimelineRepository=} deps.timelineRepo
   */
  constructor(deps = {}) {
    this.assignmentRepo = deps.assignmentRepo || new BookingAssignmentRepository();
    this.timelineRepo = deps.timelineRepo || new BookingTimelineRepository();
  }

  /**
   * Assign driver to a booking.
   */
  async assignDriver(bookingId, driverId, adminId, vehicleId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!driverId) throw new ValidationError('driverId is required');

    const current = await this.assignmentRepo.getCurrentAssignment(bookingId);

    const res = await this.assignmentRepo.assignDriver(bookingId, driverId, adminId, vehicleId);

    await this.timelineRepo.addEvent(
      bookingId,
      'driver_assigned',
      JSON.stringify({ fromDriverId: current?.assigned_driver_id ?? null, toDriverId: driverId, assignmentId: res.booking_assignment_id })
    );

    return res;
  }

  /**
   * Assign vehicle to a booking.
   */
  async assignVehicle(bookingId, vehicleId, adminId, driverId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!vehicleId) throw new ValidationError('vehicleId is required');

    const current = await this.assignmentRepo.getCurrentAssignment(bookingId);

    const res = await this.assignmentRepo.assignVehicle(bookingId, vehicleId, adminId, driverId);

    await this.timelineRepo.addEvent(
      bookingId,
      'vehicle_assigned',
      JSON.stringify({ fromVehicleId: current?.assigned_vehicle_id ?? null, toVehicleId: vehicleId, assignmentId: res.booking_assignment_id })
    );

    return res;
  }

  /**
   * Change assignment (generic wrapper).
   */
  async changeAssignment(bookingId, { driverId, vehicleId, adminId }) {
    if (!bookingId) throw new ValidationError('bookingId is required');

    if (driverId == null && vehicleId == null) {
      throw new ValidationError('driverId or vehicleId is required');
    }

    if (driverId != null) {
      return await this.assignDriver(bookingId, driverId, adminId, vehicleId ?? undefined);
    }

    return await this.assignVehicle(bookingId, vehicleId, adminId, undefined);
  }

  /**
   * Get current assignment.
   */
  async getCurrentAssignment(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    return await this.assignmentRepo.getCurrentAssignment(bookingId);
  }
}

module.exports = {
  BookingAssignmentService,
  BookingAssignmentDomainError,
  ValidationError,
  NotFoundError
};

