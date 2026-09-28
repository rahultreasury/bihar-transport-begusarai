/**
 * EnquiryEventService
 * ---------------------------------------------------------------------------
 * The single writer of EnquiryEvent rows.
 *
 * EnquiryEvent is an append-only log that serves TWO audiences from ONE source:
 *   • the admin audit history  — "who did what, when, and why"
 *   • the customer timeline    — "Request received → team reviewing → vehicle
 *                                assigned → driver assigned → quote ready"
 *
 * Writing happens inside the same Prisma transaction as the state change it
 * describes, so an enquiry can never reach a status without a matching event.
 *
 * PRIVACY
 * `metadata` is customer-visible by default, so a caller MUST NOT put a driver
 * mobile number (or any other contact detail) into it. `scrubMetadata()` below
 * is the last line of defence: it strips forbidden keys before the write.
 */

const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');

/** Event metadata keys that must never be persisted (customer-visible). */
const FORBIDDEN_METADATA_KEYS = new Set([
  'mobile',
  'alternate_mobile',
  'phone',
  'phoneNumber',
  'driver_mobile',
  'driver_phone',
  'driver_phone_number',
]);

/**
 * Recursively strip forbidden contact keys from an event metadata object.
 * @param {*} node
 * @param {number} [depth]
 * @returns {*} a sanitised copy
 */
function scrubMetadata(node, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => scrubMetadata(item, depth + 1));

  const clean = {};
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      // Replace rather than drop, so the audit trail shows the field existed
      // and was deliberately redacted.
      clean[key] = '[redacted]';
      continue;
    }
    clean[key] = scrubMetadata(value, depth + 1);
  }
  return clean;
}

class EnquiryEventService {
  /**
   * @param {Object=} deps
   * @param {import('@prisma/client').PrismaClient=} deps.prisma
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || prisma;
  }

  /**
   * Append one event.
   *
   * @param {Object} params
   * @param {number} params.enquiryId
   * @param {string} params.eventType     - EnquiryEventType value
   * @param {string} params.message       - human-readable, shown to the customer
   * @param {string} [params.actorType]   - CUSTOMER | ADMIN | DRIVER | PARTNER | SYSTEM
   * @param {number} [params.actorId]
   * @param {string} [params.actorName]
   * @param {Object} [params.metadata]    - extra context (scrubbed)
   * @param {boolean} [params.customerVisible=true] - false for internal-only notes
   * @param {import('@prisma/client').PrismaClient} [params.tx] - transaction client
   * @returns {Promise<object>} the created event
   */
  async addEvent(params, tx) {
    const client = tx || this.prisma;
    const {
      enquiryId,
      eventType,
      message,
      actorType = 'SYSTEM',
      actorId = null,
      actorName = null,
      metadata = null,
      customerVisible = true,
    } = params || {};

    if (!enquiryId || !eventType || !message) {
      throw new Error('addEvent requires enquiryId, eventType and message');
    }

    const safeMetadata = metadata ? scrubMetadata(metadata) : null;

    try {
      return await client.enquiryEvent.create({
        data: {
          enquiry_id: Number(enquiryId),
          event_type: eventType,
          actor_type: actorType,
          actor_id: actorId ?? null,
          actor_name: actorName || null,
          message: String(message),
          metadata: safeMetadata,
          customer_visible: customerVisible,
        },
      });
    } catch (err) {
      // An event write must never mask the business operation that triggered
      // it, so failures are logged loudly but not rethrown.
      logger.error(
        { err: err.message, enquiryId, eventType },
        'enquiry.event_write_failed'
      );
      return null;
    }
  }

  /**
   * Read the full event history, newest first.
   *
   * @param {number} enquiryId
   * @param {{customerVisibleOnly?:boolean, limit?:number}} [opts]
   * @returns {Promise<object[]>}
   */
  async listEvents(enquiryId, opts = {}) {
    const { customerVisibleOnly = false, limit = 200 } = opts;

    return this.prisma.enquiryEvent.findMany({
      where: {
        enquiry_id: Number(enquiryId),
        ...(customerVisibleOnly ? { customer_visible: true } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { enquiry_event_id: 'desc' }],
      take: Math.min(Number(limit) || 200, 500),
    });
  }

  /**
   * Count events by type — used by the admin dashboard for funnel metrics.
   * @param {Date} [since]
   * @returns {Promise<Object<string, number>>}
   */
  async countsByType(since) {
    const rows = await this.prisma.enquiryEvent.groupBy({
      by: ['event_type'],
      where: since ? { created_at: { gte: since } } : undefined,
      _count: { _all: true },
    });
    return rows.reduce((acc, row) => {
      acc[row.event_type] = row._count._all;
      return acc;
    }, {});
  }
}

module.exports = new EnquiryEventService();
module.exports.EnquiryEventService = EnquiryEventService;
module.exports.scrubMetadata = scrubMetadata;
module.exports.FORBIDDEN_METADATA_KEYS = FORBIDDEN_METADATA_KEYS;
