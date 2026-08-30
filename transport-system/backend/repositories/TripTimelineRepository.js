/**
 * TripTimelineRepository
 * Data access layer for trip timeline events.
 * Manages the unified timeline for trip events including
 * status changes, payments, expenses, and assignments.
 */

const { prisma } = require('../config/prisma');

class TripTimelineRepository {
  /**
   * Create a new timeline event for a trip.
   * @param {Object} data - Timeline event data
   * @param {number} data.trip_id - Trip ID
   * @param {string} data.event_type - Event type (trip_created, status_changed, client_payment, etc.)
   * @param {string} data.description - Human-readable description
   * @param {string} [data.reference_type] - Reference type (expense, payment, trip)
   * @param {number} [data.reference_id] - Reference ID
   * @param {Object} [data.metadata] - Additional JSON metadata
   * @param {number} [data.created_by] - User ID who created the event
   * @returns {Promise<Object>} Created timeline event
   */
  async create(data) {
    return prisma.tripTimeline.create({
      data: {
        trip_id: data.trip_id,
        event_type: data.event_type,
        description: data.description,
        reference_type: data.reference_type || null,
        reference_id: data.reference_id || null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_by: data.created_by || null,
      },
    });
  }

  /**
   * Get all timeline events for a trip, ordered chronologically.
   * @param {number} tripId - Trip ID
   * @returns {Promise<Array>} Array of timeline events
   */
  async findByTripId(tripId) {
    return prisma.tripTimeline.findMany({
      where: { trip_id: tripId },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Get timeline events for a trip with optional filtering.
   * @param {number} tripId - Trip ID
   * @param {Object} [filters] - Optional filters
   * @param {string} [filters.event_type] - Filter by event type
   * @returns {Promise<Array>} Array of timeline events
   */
  async findByTripIdWithFilters(tripId, filters = {}) {
    const where = { trip_id: tripId };

    if (filters.event_type) {
      where.event_type = filters.event_type;
    }

    return prisma.tripTimeline.findMany({
      where,
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Get the most recent timeline event for a trip.
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object|null>} Most recent timeline event
   */
  async findLatestByTripId(tripId) {
    return prisma.tripTimeline.findFirst({
      where: { trip_id: tripId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Delete all timeline events for a trip (cascade delete).
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Delete count
   */
  async deleteByTripId(tripId) {
    return prisma.tripTimeline.deleteMany({
      where: { trip_id: tripId },
    });
  }

  /**
   * Get timeline events for multiple trips (for entity views).
   * @param {Object} filters - Filter criteria
   * @param {number} [filters.user_id] - Client user ID
   * @param {number} [filters.owner_id] - Transport owner ID
   * @param {number} [filters.driver_id] - Driver ID
   * @param {number} [filters.vehicle_id] - Vehicle ID
   * @param {number} [filters.limit] - Limit results
   * @returns {Promise<Array>} Array of timeline events with trip info
   */
  async findEntityTimeline(filters = {}) {
    const where = {};

    if (filters.user_id) {
      where.trip = { user_id: filters.user_id };
    }
    if (filters.owner_id) {
      where.trip = { ...where.trip, transport_owner_id: filters.owner_id };
    }
    if (filters.driver_id) {
      where.trip = { ...where.trip, driver_id: filters.driver_id };
    }
    if (filters.vehicle_id) {
      where.trip = { ...where.trip, vehicle_id: filters.vehicle_id };
    }

    return prisma.tripTimeline.findMany({
      where,
      include: {
        trip: {
          select: {
            trip_id: true,
            trip_number: true,
            pickup_city: true,
            drop_city: true,
            status: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: filters.limit || 50,
    });
  }
}

module.exports = TripTimelineRepository;
