/**
 * TripTimelineService
 * Business logic for managing the unified trip timeline.
 * Handles creation of timeline events for all trip-related actions.
 */

const TripTimelineRepository = require('../repositories/TripTimelineRepository');

class TripTimelineService {
  constructor() {
    this.timelineRepo = new TripTimelineRepository();
  }

  /**
   * Create a timeline event for trip creation.
   * @param {Object} trip - Trip object
   * @param {Object} [user] - User who created the trip
   * @returns {Promise<Object>} Created timeline event
   */
  async createTripCreatedEvent(trip, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'trip_created',
      description: `Trip ${trip.trip_number} created`,
      reference_type: 'trip',
      reference_id: trip.trip_id,
      metadata: {
        pickup: `${trip.pickup_city}`,
        drop: `${trip.drop_city}`,
        freight: trip.freight_amount,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for status change.
   * @param {Object} trip - Trip object
   * @param {string} previousStatus - Previous status
   * @param {string} newStatus - New status
   * @param {Object} [user] - User who changed the status
   * @returns {Promise<Object>} Created timeline event
   */
  async createStatusChangeEvent(trip, previousStatus, newStatus, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'status_changed',
      description: `Status changed from ${previousStatus} to ${newStatus}`,
      reference_type: 'trip',
      reference_id: trip.trip_id,
      metadata: {
        previousStatus,
        newStatus,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for client payment.
   * @param {Object} trip - Trip object
   * @param {Object} payment - Payment object
   * @param {Object} [user] - User who recorded the payment
   * @returns {Promise<Object>} Created timeline event
   */
  async createClientPaymentEvent(trip, payment, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'client_payment',
      description: `₹${payment.amount?.toLocaleString('en-IN')} received from client`,
      reference_type: 'payment',
      reference_id: payment.payment_id,
      metadata: {
        amount: payment.amount,
        payment_type: payment.payment_type,
        payment_method: payment.payment_method,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for owner payment.
   * @param {Object} trip - Trip object
   * @param {Object} payment - Payment object
   * @param {Object} [user] - User who recorded the payment
   * @returns {Promise<Object>} Created timeline event
   */
  async createOwnerPaymentEvent(trip, payment, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'owner_payment',
      description: `₹${payment.amount?.toLocaleString('en-IN')} paid to transport owner`,
      reference_type: 'payment',
      reference_id: payment.payment_id,
      metadata: {
        amount: payment.amount,
        payment_type: payment.payment_type,
        payment_method: payment.payment_method,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for driver payment.
   * @param {Object} trip - Trip object
   * @param {Object} payment - Payment object
   * @param {Object} [user] - User who recorded the payment
   * @returns {Promise<Object>} Created timeline event
   */
  async createDriverPaymentEvent(trip, payment, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'driver_payment',
      description: `₹${payment.amount?.toLocaleString('en-IN')} paid to driver`,
      reference_type: 'payment',
      reference_id: payment.payment_id,
      metadata: {
        amount: payment.amount,
        payment_type: payment.payment_type,
        payment_method: payment.payment_method,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for expense.
   * @param {Object} trip - Trip object
   * @param {Object} expense - Expense object
   * @param {Object} [user] - User who added the expense
   * @returns {Promise<Object>} Created timeline event
   */
  async createExpenseEvent(trip, expense, user = null) {
    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'expense_added',
      description: `${expense.expense_type}: ₹${expense.amount?.toLocaleString('en-IN')}`,
      reference_type: 'expense',
      reference_id: expense.expense_id,
      metadata: {
        amount: expense.amount,
        expense_type: expense.expense_type,
        description: expense.description,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Create a timeline event for assignment (owner, vehicle, driver).
   * @param {Object} trip - Trip object
   * @param {string} assignmentType - Type of assignment (owner, vehicle, driver)
   * @param {string} assignmentName - Name of the assigned entity
   * @param {Object} [user] - User who made the assignment
   * @returns {Promise<Object>} Created timeline event
   */
  async createAssignmentEvent(trip, assignmentType, assignmentName, user = null) {
    const typeLabels = {
      owner: 'Transport Owner',
      vehicle: 'Vehicle',
      driver: 'Driver',
    };

    return this.timelineRepo.create({
      trip_id: trip.trip_id,
      event_type: 'assignment_changed',
      description: `${typeLabels[assignmentType] || assignmentType} assigned: ${assignmentName}`,
      reference_type: 'trip',
      reference_id: trip.trip_id,
      metadata: {
        assignmentType,
        assignmentName,
      },
      created_by: user?.user_id || user?.admin_id || null,
    });
  }

  /**
   * Get the complete timeline for a trip.
   * @param {number} tripId - Trip ID
   * @returns {Promise<Array>} Array of timeline events
   */
  async getTripTimeline(tripId) {
    return this.timelineRepo.findByTripId(tripId);
  }

  /**
   * Get timeline events for an entity (client, owner, driver, vehicle).
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Array of timeline events
   */
  async getEntityTimeline(filters) {
    return this.timelineRepo.findEntityTimeline(filters);
  }
}

module.exports = TripTimelineService;
