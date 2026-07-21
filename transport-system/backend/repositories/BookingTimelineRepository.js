/**
 * BookingTimelineRepository
 * Database-only repository for booking timeline events.
 */

const { query, run, get } = require('../config/database');

class BookingTimelineRepository {
  /**
   * Add a timeline event for a booking.
   * @param {number} bookingId
   * @param {string} eventType
   * @param {string=} eventPayloadJson
   * @returns {Promise<{booking_event_id:number}>}
   */
  async addEvent(bookingId, eventType, eventPayloadJson, tx = null) {
    try {
      const runner = tx?.run ?? run;
      const result = await runner(
        `INSERT INTO booking_events (booking_id, event_type, event_payload)
         VALUES (?, ?, ?)`,
        [bookingId, eventType, eventPayloadJson ?? null]
      );

      return { booking_event_id: result.lastID };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get full timeline for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object[]>}
   */
  async getTimeline(bookingId, tx = null) {
    try {
      const runner = tx?.query ?? query;
      return await runner(
        `SELECT booking_event_id, booking_id, event_type, event_payload, created_at
         FROM booking_events
         WHERE booking_id = ?
         ORDER BY created_at ASC, booking_event_id ASC`,
        [bookingId]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get the latest timeline event for a booking.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async getLatestEvent(bookingId, tx = null) {
    try {
      const getter = tx?.get ?? get;
      return await getter(
        `SELECT booking_event_id, booking_id, event_type, event_payload, created_at
         FROM booking_events
         WHERE booking_id = ?
         ORDER BY created_at DESC, booking_event_id DESC
         LIMIT 1`,
        [bookingId]
      );
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingTimelineRepository;

