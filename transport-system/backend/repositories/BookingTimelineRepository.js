/**
 * BookingTimelineRepository
 * Database-only repository for booking timeline events.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

class BookingTimelineRepository {
  /**
   * Add a timeline event for a booking.
   * @param {number} bookingId
   * @param {string} eventType
   * @param {string=} eventPayloadJson
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{booking_event_id:number}>}
   */
  async addEvent(bookingId, eventType, eventPayloadJson, tx = null) {
    const client = tx || prisma;
    try {
      const event = await client.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: eventType,
          event_payload: eventPayloadJson ?? null,
        },
      });
      return { booking_event_id: event.booking_event_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get full timeline for a booking.
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object[]>}
   */
  async getTimeline(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.bookingEvent.findMany({
        where: { booking_id: bookingId },
        orderBy: [
          { created_at: 'asc' },
          { booking_event_id: 'asc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get the latest timeline event for a booking.
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async getLatestEvent(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.bookingEvent.findFirst({
        where: { booking_id: bookingId },
        orderBy: [
          { created_at: 'desc' },
          { booking_event_id: 'desc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingTimelineRepository;

