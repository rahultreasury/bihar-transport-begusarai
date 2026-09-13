/**
 * selfOwner.js
 * ------------------------------------------------------------------
 * Detection helper for the "Self Owner" pattern.
 *
 * Business definition (Phase 2):
 *   A "Self Owner" is a Transport Owner whose primary activity is
 *   driving their own vehicle. The application does NOT have a
 *   separate "SelfOwner" table — instead the existing VehicleOwner
 *   table represents them via:
 *
 *     owner_type = 'DRIVER_OWNER'
 *
 * and the matching Driver row carries:
 *
 *     transport_owner_id = <that same owner_id>
 *
 * Why this file exists:
 *   Centralising the "is this owner also a driver / self-owned?" check
 *   keeps the rule in ONE place. Frontend components and backend
 *   services can both rely on the same logic without re-implementing
 *   it. If the definition ever changes (e.g. an additional flag,
 *   separate User row), only this file changes.
 */

'use strict';

const SELF_OWNER_TYPES = new Set(['DRIVER_OWNER']);

/**
 * Look up an existing VehicleOwner by mobile number.
 *
 * Phase 2.1 — used by the Self-Owner registration path so we NEVER
 * create a duplicate owner for a person who is already registered
 * with our system under any owner_type. The caller may then decide
 * whether to upgrade the owner_type to DRIVER_OWNER.
 *
 * @param {string} mobile  E.164 or 10-digit national number.
 * @returns {Promise<Object|null>}  Existing VehicleOwner row or null.
 */
async function findExistingOwnerByMobile(mobile) {
  if (!mobile) return null;
  // Lazy require — avoids circular dep at module load.
  const { prisma } = require('../config/prisma');
  const normalised = String(mobile).replace(/\D/g, '');
  if (!normalised) return null;
  return await prisma.vehicleOwner.findFirst({
    where: {
      mobile: { contains: normalised },
      deleted_at: null,
    },
  });
}

/**
 * Returns true if a VehicleOwner record represents a Self Owner.
 *
 * @param {Object|null|undefined} owner  VehicleOwner row (with owner_type).
 * @returns {boolean}
 */
function isSelfOwner(owner) {
  if (!owner || typeof owner !== 'object') return false;
  return SELF_OWNER_TYPES.has(String(owner.owner_type || '').toUpperCase());
}

/**
 * Returns a display label for the owner cell. Always includes
 * "Self Owner" badge text when applicable so the UI can render it.
 *
 * @param {Object|null|undefined} owner
 * @returns {{label: string, isSelfOwner: boolean}}
 */
function describeOwner(owner) {
  if (!owner) {
    return { label: '', isSelfOwner: false };
  }
  return {
    label: owner.owner_name || `Owner #${owner.owner_id}`,
    isSelfOwner: isSelfOwner(owner),
  };
}

module.exports = {
  SELF_OWNER_TYPES: Array.from(SELF_OWNER_TYPES),
  isSelfOwner,
  describeOwner,
  findExistingOwnerByMobile,
};