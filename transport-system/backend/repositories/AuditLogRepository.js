/**
 * AuditLogRepository
 * Database-only repository for AuditLog model.
 */

const { prisma } = require('../config/prisma');

class AuditLogRepository {
  /**
   * Create an audit log entry.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
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
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
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
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
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
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }
}

module.exports = AuditLogRepository;
