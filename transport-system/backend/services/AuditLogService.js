/**
 * AuditLogService
 * Business logic for audit logging.
 *
 * Every sensitive financial action must create an audit record.
 */

const AuditLogRepository = require('../repositories/AuditLogRepository');

class AuditLogService {
  constructor() {
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create an audit log entry.
   * @param {Object} auditData
   * @returns {Promise<Object>}
   */
  async log(auditData) {
    const {
      user_id,
      user_role,
      action,
      entity_type,
      entity_id,
      previous_value,
      new_value,
      reason,
      ip_address,
      user_agent,
    } = auditData;

    if (!action || !entity_type || !entity_id) {
      throw new Error('action, entity_type, and entity_id are required for audit logging');
    }

    return await this.auditRepo.create({
      user_id: user_id || null,
      user_role: user_role || 'system',
      action,
      entity_type,
      entity_id: parseInt(entity_id),
      previous_value: previous_value ? JSON.stringify(previous_value) : null,
      new_value: new_value ? JSON.stringify(new_value) : null,
      reason: reason || null,
      ip_address: ip_address || null,
      user_agent: user_agent || null,
    });
  }

  /**
   * Get audit logs for an entity.
   * @param {string} entityType
   * @param {number} entityId
   * @param {Object} filters
   * @returns {Promise<Object>}
   */
  async getEntityLogs(entityType, entityId, filters = {}) {
    return await this.auditRepo.findByEntity(entityType, entityId, filters);
  }

  /**
   * Get audit logs for a user.
   * @param {number} userId
   * @param {Object} filters
   * @returns {Promise<Object>}
   */
  async getUserLogs(userId, filters = {}) {
    return await this.auditRepo.findByUser(userId, filters);
  }

  /**
   * Get all audit logs with filters.
   * @param {Object} filters
   * @returns {Promise<Object>}
   */
  async getAllLogs(filters = {}) {
    return await this.auditRepo.findAll(filters);
  }
}

module.exports = AuditLogService;
