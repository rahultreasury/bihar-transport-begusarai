/**
 * AuditLogRepository
 * Database-only repository for AuditLog model.
 */

const { prisma } = require('../config/prisma');

class AuditLogRepository {
  /**
   * PHASE 5 FIX — dependency injection.
   *
   * This repository used to reach for the module-level `prisma` singleton and
   * nothing else. Two things went wrong because of that:
   *
   *   1. TESTABILITY / SAFETY. A service constructed with an injected client
   *      (which is how every unit test in this repository runs) still wrote its
   *      audit rows to the REAL database, because the injected client was never
   *      consulted. Phase 5's unit test suite consequently wrote 77 junk
   *      `trip_movement_recorded` rows into production.
   *   2. ATOMICITY. Because the only way to reach a transaction client was the
   *      `tx` argument, any caller that forgot to pass one silently committed
   *      its audit entry OUTSIDE the transaction that carried the change it
   *      describes.
   *
   * The fix is to accept the client in the constructor so an injected service
   * propagates all the way down, while still defaulting to the shared singleton
   * for every existing caller that constructs this with no arguments.
   *
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || prisma;
  }

  /**
   * @param {Object} [tx] - Optional Prisma transaction client
   */
  _client(tx = null) {
    return tx || this.prisma;
  }

  /**
   * Create an audit log entry.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = this._client(tx);
    return await client.auditLog.create({
      data,
    });
  }

  /**
   * Find audit logs by entity.
   * @param {string} entityType
   * @param {number} entityId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async findByEntity(entityType, entityId, filters = {}) {
    const where = {
      entity_type: entityType,
      entity_id: entityId,
    };

    if (filters.action) where.action = filters.action;
    if (filters.user_id) where.user_id = parseInt(filters.user_id);

    const skip = filters.skip || 0;
    const take = filters.take || 50;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Find audit logs by user.
   * @param {number} userId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async findByUser(userId, filters = {}) {
    const where = { user_id: userId };
    if (filters.action) where.action = filters.action;

    const skip = filters.skip || 0;
    const take = filters.take || 50;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Find all audit logs with filters.
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async findAll(filters = {}) {
    const where = {};
    if (filters.entity_type) where.entity_type = filters.entity_type;
    if (filters.entity_id) where.entity_id = parseInt(filters.entity_id);
    if (filters.action) where.action = filters.action;
    if (filters.user_id) where.user_id = parseInt(filters.user_id);

    const skip = filters.skip || 0;
    const take = filters.take || 50;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }
}

module.exports = AuditLogRepository;
