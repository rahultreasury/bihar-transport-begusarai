/**
 * BookingTimelineService
 * Business logic for booking timeline events.
 */

const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');

class BookingTimelineDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BookingTimelineDomainError';
    this.code = code;
  }
}

class ValidationError extends BookingTimelineDomainError {
  constructor(message = 'Validation failed') {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

class BookingTimelineService {
  /**
   * @param {Object=} deps
   * @param {BookingTimelineRepository=} deps.timelineRepo
   */
  constructor(deps = {}) {
    this.timelineRepo = deps.timelineRepo || new BookingTimelineRepository();
  }

  /**
   * Record a timeline event.
   * Business rules:
   * - bookingId and eventType required
   * - eventPayload is stored as-is (stringified JSON recommended)
   */
  async recordEvent(bookingId, eventType, eventPayload) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    if (!eventType) throw new ValidationError('eventType is required');

    const payloadString =
      eventPayload === undefined ? null : (typeof eventPayload === 'string' ? eventPayload : JSON.stringify(eventPayload));

    return await this.timelineRepo.addEvent(bookingId, eventType, payloadString);
  }

  /**
   * Get timeline.
   */
  async getTimeline(bookingId) {
    if (!bookingId) throw new ValidationError('bookingId is required');
    return await this.timelineRepo.getTimeline(bookingId);
  }
}

module.exports = BookingTimelineService;

