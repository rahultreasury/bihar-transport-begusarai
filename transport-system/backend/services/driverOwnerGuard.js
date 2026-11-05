/**
 * driverOwnerGuard.js
 * ------------------------------------------------------------------
 * Tiny validation helper that enforces the Phase 2 business rule:
 *
 *   "Every Driver MUST belong to exactly one Transport Owner."
 *
 * Centralising the rule here lets:
 *   - driverManagementRoutes (admin POST/PUT)
 *   - authRoutes (public driver-signup)
 *   - VehicleOwnerRepository (Self-Owner flow)
 *   - DriverManagementService
 *   - DriverRepository
 * share ONE source of truth for the owner requirement, without each
 * caller re-implementing the lookup.
 *
 * The helper does NOT mutate the database. It only validates inputs
 * and throws a typed error if the rule is violated.
 */

'use strict';

// IMPORTANT: do NOT destructure prisma here. We keep a reference to
// the *module exports* so tests can swap `config/prisma.prisma` for a
// stub and our helper picks up the new instance automatically.
const prismaModule = require('../config/prisma');
const prisma = new Proxy({}, {
  get(_target, prop) {
    return prismaModule.prisma[prop];
  },
});

/**
 * Resolve a transport owner by id and verify it is active / not
 * soft-deleted.
 *
 * @param {number|string|null|undefined} ownerId
 * @returns {Promise<{owner_id:number, owner_name:string, owner_code:string|null, status:string|null, is_active:boolean|null}>}
 * @throws  {Error} with .code = 'OWNER_REQUIRED' | 'OWNER_NOT_FOUND' | 'OWNER_INACTIVE'
 */
async function resolveActiveOwner(ownerId) {
  if (ownerId === null || ownerId === undefined || ownerId === '' ||
      (typeof ownerId === 'number' && Number.isNaN(ownerId))) {
    const err = new Error(
      'Transport Owner is required. A driver must always belong to exactly one Transport Owner.'
    );
    err.code = 'OWNER_REQUIRED';
    throw err;
  }

  const numericId = Number(ownerId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    const err = new Error(
      `Transport Owner id must be a positive integer (received: ${ownerId}).`
    );
    err.code = 'OWNER_INVALID';
    throw err;
  }

  const owner = await prisma.vehicleOwner.findUnique({
    where: { owner_id: numericId },
    select: {
      owner_id: true,
      owner_name: true,
      owner_code: true,
      status: true,
      is_active: true,
      deleted_at: true,
    },
  });

  if (!owner || owner.deleted_at !== null) {
    const err = new Error(
      `Transport Owner (id=${numericId}) does not exist or has been deleted.`
    );
    err.code = 'OWNER_NOT_FOUND';
    throw err;
  }

  // Treat either status=active OR is_active=true as active.
  const statusInactive =
    owner.status !== null &&
    owner.status !== undefined &&
    owner.status !== 'active';
  const isActiveFalse = owner.is_active === false;

  if (statusInactive || isActiveFalse) {
    const err = new Error(
      `Transport Owner "${owner.owner_name}" (id=${owner.owner_id}) is not active.`
    );
    err.code = 'OWNER_INACTIVE';
    throw err;
  }

  return owner;
}

/**
 * Block any update that would null out an existing transport_owner_id.
 * Called from driver PUT/POST paths.
 *
 * @param {Object} updateData  Payload from the request.
 * @throws {Error} with .code = 'OWNER_REQUIRED'
 */
function assertUpdateDoesNotRemoveOwner(updateData) {
  if (
    Object.prototype.hasOwnProperty.call(updateData, 'transport_owner_id') &&
    (updateData.transport_owner_id === null ||
     updateData.transport_owner_id === '' ||
     updateData.transport_owner_id === undefined)
  ) {
    const err = new Error(
      'Cannot remove the Transport Owner from an existing Driver. Every driver must always have exactly one Transport Owner.'
    );
    err.code = 'OWNER_REQUIRED';
    throw err;
  }
}

/**
 * Convenience: given the body of a create payload, throw if no
 * transport_owner_id is present.
 *
 * Phase 2.1 update — Self-Owner path:
 *   The Phase 2.1 Self-Owner flow does NOT supply a transport_owner_id
 *   in the request body; the backend resolves or creates a
 *   DRIVER_OWNER from the driver's mobile. When `is_self_owner === true`
 *   we skip the explicit id check and rely on the service layer to
 *   resolve a valid owner before the Driver is persisted.
 */
function assertCreateHasOwner(payload) {
  const hasOwnerId =
    payload !== null &&
    payload !== undefined &&
    payload.transport_owner_id !== null &&
    payload.transport_owner_id !== undefined &&
    payload.transport_owner_id !== '';
  if (hasOwnerId) return;

  const isSelfOwner =
    payload &&
    (payload.is_self_owner === true ||
     payload.is_self_owner === 'true' ||
     payload.is_self_owner === 1 ||
     payload.is_self_owner === '1');

  if (isSelfOwner) return; // Self-Owner path resolves owner internally.

  const err = new Error(
    'transport_owner_id is required (or set is_self_owner=true to register a Self-Owner Driver). Every Driver must be registered with exactly one Transport Owner.'
  );
  err.code = 'OWNER_REQUIRED';
  throw err;
}

module.exports = {
  resolveActiveOwner,
  assertUpdateDoesNotRemoveOwner,
  assertCreateHasOwner,
};