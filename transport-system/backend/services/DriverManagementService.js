/**
 * DriverManagementService
 * Business logic for market driver management (brokerage model).
 * Drivers are independent market resources, not employees.
 * Uses DriverRepository for all database access.
 */

const DriverRepository = require('../repositories/DriverRepository');
const prismaModule = require('../config/prisma');
const driverOwnerGuard = require('./driverOwnerGuard');
const selfOwner = require('./selfOwner');

// Lazy prisma accessor — keeps the binding fresh so tests can swap
// `config/prisma.prisma` for a stub without reloading this module.
function db() { return prismaModule.prisma; }

// ==================================================================
// VEHICLE FIELD HELPERS (TEMPORARY MVP SOLUTION)
// ------------------------------------------------------------------
// Vehicle fields currently live directly on the Driver model for the
// MVP. All vehicle-specific normalization / validation / uniqueness
// logic is isolated here so it can be lifted into a dedicated Vehicle
// entity + DriverAssignment relation in a future release without
// touching the rest of the driver module.
// ==================================================================

/**
 * Normalize an Indian vehicle number for storage.
 * - Trims surrounding whitespace
 * - Collapses internal whitespace
 * - Converts to uppercase
 * e.g. "  br09  ab1234 " → "BR09AB1234"
 */
function normalizeVehicleNumber(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized || null;
}

/**
 * Validate an Indian vehicle registration number format.
 * Supports the standard format: <2 letter state><2 digit rto><optional
 * 1-letter series><4 digits>, e.g. BR09AB1234, BR09A1234, BR01A1234.
 * Returns true when valid.
 */
function isValidIndianVehicleNumber(value) {
  if (!value) return false;
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, '');
  // Examples: BR09AB1234, BR09A1234, DL01C1234, MH12AB1234
  return /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(normalized);
}

class DriverManagementService {
  constructor() {
    this.repo = new DriverRepository();
  }

  /**
   * Register a new market driver.
   * Auto-generates driver code, creates user account, records timeline.
   * Throws DriverAlreadyExistsError if mobile is already registered.
   */
async registerDriver(data) {
    const {
      driver_name,
      mobile,
      alternate_mobile,
      license_number,
      city,
      state,
      address,
      profile_image,
      transport_owner_id,
      is_self_owner = false,
    } = data;

    // ===== Phase 2 — Driver <-> Transport Owner required =====
    // Defense-in-depth: even if the route validator allows a request
    // through, this service-level guard rejects drivers created without
    // an active Transport Owner.
    //
    // Phase 2.1 — Self-Owner path:
    //   When `is_self_owner` is true the caller is registering a Driver
    //   who IS ALSO the Transport Owner of their vehicle. We MUST still
    //   create / link a VehicleOwner — just with owner_type = DRIVER_OWNER.
    //   The Driver's transport_owner_id points back to that same owner.
    driverOwnerGuard.assertCreateHasOwner(data);

    // Pre-flight: Driver with this mobile must not already exist
    // (checked outside the txn for a clean 409 path).
    const existingDriver = await this.repo.findByMobile(mobile);
    if (existingDriver) {
      const err = new Error('Driver already exists');
      err.code = 'DRIVER_ALREADY_EXISTS';
      err.data = {
        driver_id: existingDriver.driver_id,
        driver_name: existingDriver.driver_name,
        driver_code: existingDriver.driver_code,
        status: existingDriver.status,
        mobile: existingDriver.mobile,
      };
      throw err;
    }

    // Phase 2.2 — the entire Self-Owner path (owner lookup + optional
    // owner creation + user + driver + timeline) runs inside ONE
    // database transaction so a partial Self-Owner registration can
    // never leave broken data.
    const driver = await db().$transaction(async (tx) => {
      // ---- 1. Resolve the Transport Owner. ----
      let resolvedOwnerId = null;
      let selfOwnerCreated = false;
      if (is_self_owner) {
        const resolved = await this._resolveOrCreateSelfOwnerTx({
          driver_name, mobile, city, state, address, tx,
        });
        resolvedOwnerId = resolved.owner_id;
        selfOwnerCreated = resolved.created;
      } else {
        const ownerId = parseInt(transport_owner_id, 10);
        const owner = await tx.vehicleOwner.findUnique({
          where: { owner_id: ownerId },
          select: { owner_id: true, status: true, is_active: true, deleted_at: true },
        });
        if (!owner || owner.deleted_at !== null) {
          const err = new Error(`Transport Owner (id=${ownerId}) does not exist or has been deleted.`);
          err.code = 'OWNER_NOT_FOUND';
          throw err;
        }
        if (owner.status !== null && owner.status !== undefined && owner.status !== 'active') {
          const err = new Error(`Transport Owner (id=${ownerId}) is not active.`);
          err.code = 'OWNER_INACTIVE';
          throw err;
        }
        if (owner.is_active === false) {
          const err = new Error(`Transport Owner (id=${ownerId}) is not active.`);
          err.code = 'OWNER_INACTIVE';
          throw err;
        }
        resolvedOwnerId = owner.owner_id;
      }

    // Check if mobile already has a user
    let user = await tx.user.findUnique({ where: { phone: mobile } });
      if (!user) {
        const bcrypt = require('bcryptjs');
        const defaultPassword = 'driver123';
        const password_hash = await bcrypt.hash(defaultPassword, 10);
        user = await tx.user.create({
          data: {
            first_name: driver_name.split(' ')[0] || driver_name,
            last_name: driver_name.split(' ').slice(1).join(' ') || '',
            email: `${mobile}@driver.bihar-transport.com`,
            phone: mobile,
            password_hash,
            role: 'driver',
          },
        });
      }

      // ---- 3. Generate driver code + create Driver row. ----
      const driverCode = await this.repo.generateDriverCode();
      const createdDriver = await tx.driver.create({
        data: {
          driver_code: driverCode,
          user_id: user.user_id,
          driver_name,
          mobile,
          alternate_mobile: alternate_mobile || null,
          license_number: license_number || null,
          city: city || null,
          state: state || 'Bihar',
          address: address || null,
          transport_owner_id: resolvedOwnerId,
          status: 'available',
          profile_image: profile_image || null,
          is_available: true,
          is_verified: false,
        },
      });

      // ---- 4. Record the timeline event. ----
      await tx.driverTimeline.create({
        data: {
          driver_id: createdDriver.driver_id,
          event_type: 'driver_created',
          description: is_self_owner
            ? (selfOwnerCreated
                ? `Driver ${driver_name} registered as Self-Owner; new VehicleOwner created (owner_id=${resolvedOwnerId}) with code ${driverCode}`
                : `Driver ${driver_name} registered as Self-Owner; reused existing VehicleOwner (owner_id=${resolvedOwnerId}) with code ${driverCode}`)
            : `Driver ${driver_name} registered with code ${driverCode}`,
        },
      });

      return createdDriver;
    });

    return driver;
  }

  /**
   * Internal helper for the Self-Owner registration path (txn-aware).
   *
   * Rules (Phase 2.2):
   *  - Look up an EXISTING VehicleOwner by mobile first (any owner_type).
   *  - If one exists, REUSE it — never create a duplicate.
   *  - If the existing owner is already DRIVER_OWNER → reuse as-is.
   *  - If the existing owner is a DIFFERENT owner_type (TRANSPORT_COMPANY
   *    / INDIVIDUAL_OWNER) → REUSE it WITHOUT changing the owner_type.
   *    The user explicitly asked us NOT to silently overwrite an
   *    existing owner's classification. The Driver will simply be
   *    linked to whatever owner exists for that mobile. (The Person
   *    is now both the Driver AND that owner; the owner_type just
   *    reflects how they were originally classified.)
   *  - If no owner exists → create a fresh VehicleOwner with
   *    owner_type=DRIVER_OWNER (the default for a NEW Self-Owner).
   *
   * Must be called WITHIN a prisma.$transaction so that a Driver
   * creation failure automatically rolls back the owner creation.
   *
   * @param {Object} params
   * @param {string} params.driver_name
   * @param {string} params.mobile
   * @param {string|null} [params.city]
   * @param {string|null} [params.state]
   * @param {string|null} [params.address]
   * @param {Object} params.tx  Prisma transaction client.
   * @returns {Promise<{owner_id:number, created:boolean}>}
   *          `created` is true iff a NEW VehicleOwner row was inserted.
   */
  async _resolveOrCreateSelfOwnerTx({ driver_name, mobile, city, state, address, tx }) {
    // Use the same lookup logic as selfOwner.findExistingOwnerByMobile
    // but routed through the transaction client so the read participates
    // in the same isolation window.
    const normalised = String(mobile || '').replace(/\D/g, '');
    const existing = await tx.vehicleOwner.findFirst({
      where: {
        mobile: { contains: normalised },
        deleted_at: null,
      },
    });

    if (existing) {
      // REUSE without touching owner_type. The Owner Type reflects
      // business classification; we never silently flip it.
      return { owner_id: existing.owner_id, created: false };
    }

    // No existing owner → create a fresh one inside the same txn.
    const VehicleOwnerRepository = require('../repositories/VehicleOwnerRepository');
    const ownerRepo = new VehicleOwnerRepository();
    // generateOwnerCode reads the last owner_code via prisma (outside
    // the tx). For a brand-new Self-Owner this is acceptable; if a
    // race occurs the UNIQUE constraint on owner_code would surface it.
    const ownerCode = await ownerRepo.generateOwnerCode();
    const created = await tx.vehicleOwner.create({
      data: {
        owner_code: ownerCode,
        owner_name: driver_name,
        mobile,
        owner_type: 'DRIVER_OWNER',
        city: city || null,
        state: state || 'Bihar',
        address: address || null,
        status: 'active',
        is_active: true,
      },
    });
    return { owner_id: created.owner_id, created: true };
  }

  /**
   * Get driver full profile with relations.
   */
  async getDriverProfile(driverId) {
    const driver = await this.repo.findById(driverId);
    if (!driver) return null;
    return driver;
  }

/**
   * List drivers with filters.
   */
  async listDrivers(filters = {}) {
    return await this.repo.findAll(filters);
  }

/**
 * List drivers with their current vehicle for the booking assignment UX.
 * Single endpoint — returns driver + current vehicle (with availability)
 * so the frontend never makes a second API call. Supports pagination,
 * search, and an availability-only filter.
 */
  async listDriversWithVehicles(filters = {}) {
    return await this.repo.findAllWithVehicles(filters);
  }

  /**
   * Scalable driver lookup for the Booking Assignment picker (10,000+ drivers).
   * Server-side pagination + search + filters + per-driver trip stats. Only a
   * bounded page is loaded — never the full table. Each driver carries its
   * current vehicle so the frontend never makes a second API call.
   */
  async listAssignableDrivers(filters = {}) {
    return await this.repo.findAssignable(filters);
  }

  /**
   * Update driver information.
   */
  async updateDriver(driverId, data) {
    const allowedFields = [
      'driver_name', 'mobile', 'alternate_mobile', 'city',
      'state', 'address',
      'status', 'profile_image',
      'license_number',
      'transport_owner_id',
    ];

    // ===== Phase 2 — never allow removing the owner =====
    // If the caller sent an explicit null/empty transport_owner_id, reject.
    driverOwnerGuard.assertUpdateDoesNotRemoveOwner(data);

    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    // If transport_owner_id is being CHANGED, verify the new owner is active.
    if (updateData.transport_owner_id !== undefined &&
        updateData.transport_owner_id !== null) {
      await driverOwnerGuard.resolveActiveOwner(updateData.transport_owner_id);
      updateData.transport_owner_id = parseInt(updateData.transport_owner_id, 10);
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    // If status is changing, also update is_available
    if (updateData.status === 'available') updateData.is_available = true;
    else if (updateData.status === 'on_trip') updateData.is_available = false;
    else if (updateData.status === 'inactive') updateData.is_available = false;

    const driver = await this.repo.update(driverId, updateData);

    // Record timeline for status change
    if (data.status) {
      await this.repo.createTimelineEvent({
        driver_id: driverId,
        event_type: 'status_changed',
        description: `Status changed to ${data.status}`,
      });
    }

    return driver;
  }

/**
 * Permanently delete a driver — but only when it is safe to do so.
 *
 * Business rule (from the approved delete-management plan):
 *   - If the driver has ACTIVE / protected operational dependencies
 *     (active bookings, active reservations, active assignments,
 *     active deliveries) → REJECT hard deletion with a structured error.
 *   - If the driver has historical bookings/deliveries/reservations,
 *     those records are RETAINED (FK SET NULL preserves booking
 *     snapshots + history). The driver's own transactions, timeline and
 *     driver_assignments are CASCADE-deleted by the DB (they are only
 *     meaningful while the driver exists).
 *   - If the driver has financial records that must be retained for
 *     history, we keep the driver (archive) instead of a hard delete.
 *
 * Only returns success AFTER the DB confirms the row is gone.
   *
   * @param {number} driverId
   * @param {number} adminId  admin performing the delete (for audit)
   * @returns {Promise<{driver_id:number}>}
   * @throws {Error} with `.code` set to a structured rejection code
   */
  async permanentlyDeleteDriver(driverId, adminId = null) {
    const driver = await this.repo.findById(driverId);
    if (!driver) {
      const err = new Error('Driver not found');
      err.code = 'DRIVER_NOT_FOUND';
      throw err;
    }

    const deps = await this.repo.findDependencySummary(driverId);

    // Protected / active operational dependencies → reject hard delete.
    if (deps.activeBookings > 0) {
      const err = new Error('This driver cannot be deleted because they are associated with active bookings.');
      err.code = 'DRIVER_HAS_ACTIVE_BOOKINGS';
      err.data = { activeBookings: deps.activeBookings };
      throw err;
    }
    if (deps.activeReservations > 0) {
      const err = new Error('This driver is reserved for a pending quote and cannot be deleted.');
      err.code = 'DRIVER_HAS_ACTIVE_RESERVATION';
      err.data = { activeReservations: deps.activeReservations };
      throw err;
    }
    if (deps.activeAssignments > 0) {
      const err = new Error('This driver is actively assigned to a booking and cannot be deleted.');
      err.code = 'DRIVER_IS_ASSIGNED';
      err.data = { activeAssignments: deps.activeAssignments };
      throw err;
    }
    if (deps.activeDeliveries > 0) {
      const err = new Error('This driver is assigned to an active delivery and cannot be deleted.');
      err.code = 'DRIVER_HAS_ACTIVE_DELIVERY';
      err.data = { activeDeliveries: deps.activeDeliveries };
      throw err;
    }

    // Financial records that must be retained → archive instead of hard delete.
    if (deps.hasFinancialRecords) {
      // Archive (deactivate) the driver rather than destroy financial history.
      const archived = await db().$transaction(async (tx) => {
        await tx.driver.update({
          where: { driver_id: driverId },
          data: { status: 'inactive', is_available: false },
        });
        await tx.driverTimeline.create({
          data: {
            driver_id: driverId,
            event_type: 'status_changed',
            description: `Driver ${driver.driver_name} archived (financial records retained)`,
          },
        });
        return { driver_id: driverId, status: 'inactive', archived: true };
      });
      return archived;
    }

    // Safe to hard delete. Use a transaction so the delete + verification
    // are atomic. Booking/delivery/reservation rows are SET NULL by
    // the DB (verified FK actions), preserving history snapshots.
    const result = await db().$transaction(async (tx) => {
      await this.repo.hardDelete(driverId, tx);
      // Verify the row is actually gone.
      const stillThere = await tx.driver.findUnique({
        where: { driver_id: driverId },
        select: { driver_id: true },
      });
      if (stillThere) {
        const err = new Error('Driver could not be fully removed from the database.');
        err.code = 'DRIVER_DELETE_FAILED';
        throw err;
      }
      return { driver_id: driverId };
    });

    return result;
  }

  /**
   * Bulk soft-delete multiple drivers in ONE database transaction.
   * The frontend sends a single request for N drivers — this eliminates the
   * N-request loop that previously caused duplicate deletes and HTTP 429.
   */
  async bulkDeleteDrivers(driverIds) {
    const ids = Array.isArray(driverIds) ? driverIds.map(Number).filter(Number.isFinite) : [];
    if (ids.length === 0) throw new Error('No valid driver IDs provided');

    const result = await db().$transaction(async (tx) => {
      const { count } = await tx.driver.updateMany({
        where: { driver_id: { in: ids } },
        data: { status: 'inactive', is_available: false },
      });
      // Record a single timeline event per deleted driver (atomic).
      const names = await tx.driver.findMany({
        where: { driver_id: { in: ids } },
        select: { driver_id: true, driver_name: true },
      });
      for (const d of names) {
        await tx.driverTimeline.create({
          data: {
            driver_id: d.driver_id,
            event_type: 'status_changed',
            description: `Driver ${d.driver_name} marked as inactive`,
          },
        });
      }
      return { count };
    });

    return result;
  }

/**
   * Toggle driver status.
   */
  async toggleStatus(driverId) {
    const driver = await this.repo.findStatus(driverId);

    if (!driver) throw new Error('Driver not found');

    const newStatus = driver.status === 'available' ? 'inactive' : 'available';

    const updated = await this.repo.update(driverId, {
      status: newStatus,
      is_available: newStatus === 'available',
    });

    await this.repo.createTimelineEvent({
      driver_id: driverId,
      event_type: 'status_changed',
      description: `Status changed from ${driver.status} to ${newStatus}`,
    });

    return updated;
  }

  /**
   * Get trip history for a driver.
   */
  async getDriverTrips(driverId, filters = {}) {
    return await this.repo.getTrips(driverId, filters);
  }

  /**
   * Get timeline for a driver.
   */
  async getDriverTimeline(driverId) {
    return await this.repo.getTimeline(driverId);
  }

  /**
   * Record a transaction for a driver.
   */
  async recordTransaction(driverId, data) {
    const driver = await this.repo.findById(driverId);
    if (!driver) throw new Error('Driver not found');

    const transaction = await this.repo.createTransaction({
      driver_id: driverId,
      ...data,
    });

    await this.repo.createTimelineEvent({
      driver_id: driverId,
      event_type: 'transaction_recorded',
      description: `${data.transaction_type.replace(/_/g, ' ')} of ₹${parseFloat(data.amount).toLocaleString('en-IN')} recorded`,
      reference_type: 'transaction',
      reference_id: transaction.transaction_id,
    });

    return transaction;
  }

  /**
   * Get transactions for a driver.
   */
  async getDriverTransactions(driverId, filters = {}) {
    return await this.repo.getTransactions(driverId, filters);
  }

  /**
   * Get dashboard stats (simplified for market drivers).
   */
  async getDashboardStats() {
    return await this.repo.getDashboardStats();
  }

  /**
   * Get available vehicles for a specific driver.
   * Returns vehicles belonging to the driver's transport owner that are
   * currently available for assignment.
   *
   * @param {number} driverId
   * @returns {Promise<Array>}
   */
  async getAvailableVehicles(driverId) {
    const driver = await this.repo.findById(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }

    const ownerId = driver.transport_owner_id;
    if (!ownerId) {
      // Driver has no transport owner — no vehicles can be assigned
      return [];
    }

    const vehicles = await db().transportVehicle.findMany({
      where: {
        owner_id: ownerId,
        is_available: true,
        current_status: 'available',
        OR: [
          { driver_id: null },
          { driver_id: driverId },
        ],
      },
      orderBy: { vehicle_id: 'asc' },
    });

    return vehicles;
  }

  /**
   * Assign a vehicle to a driver.
   * Validates that the vehicle belongs to the driver's transport owner,
   * then updates both the driver and vehicle records atomically.
   * Also creates a VehicleAssignment history record.
   *
   * @param {number} driverId
   * @param {number} vehicleId
   * @param {number|null} assignedBy - Admin user_id who performed the assignment
   * @returns {Promise<Object>}
   */
  async assignVehicle(driverId, vehicleId, assignedBy = null) {
    const driver = await this.repo.findById(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }

    const vehicle = await db().transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
    });
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Validate that the vehicle belongs to the driver's transport owner
    if (driver.transport_owner_id && vehicle.owner_id !== driver.transport_owner_id) {
      throw new Error('This vehicle does not belong to the driver\'s transport owner');
    }

    // If driver has no transport owner, only allow assignment to truly unassigned vehicles
    if (!driver.transport_owner_id && vehicle.driver_id !== null) {
      throw new Error('This vehicle is already assigned to another driver');
    }

    const result = await db().$transaction(async (tx) => {
      // Unassign previous vehicle if driver had one
      if (driver.current_vehicle_id && driver.current_vehicle_id !== vehicleId) {
        await tx.transportVehicle.update({
          where: { vehicle_id: driver.current_vehicle_id },
          data: {
            driver_id: null,
            is_available: true,
            current_status: 'available',
          },
        });

        // Mark previous assignment as inactive
        await tx.vehicleAssignment.updateMany({
          where: {
            vehicle_id: driver.current_vehicle_id,
            driver_id: driverId,
            status: 'active',
          },
          data: {
            unassigned_at: new Date(),
            status: 'inactive',
          },
        });
      }

      // Assign new vehicle to driver
      const updatedDriver = await tx.driver.update({
        where: { driver_id: driverId },
        data: { current_vehicle_id: vehicleId },
      });

      // Update vehicle to mark as assigned
      // NOTE: current_status remains 'available' — a vehicle with a driver
      // assigned is not necessarily "on_trip". 'on_trip' is set by the
      // trip service when a trip actually starts.
      const updatedVehicle = await tx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: {
          driver_id: driverId,
          is_available: false,
          current_status: 'available',
        },
      });

      // Create assignment history record
      await tx.vehicleAssignment.create({
        data: {
          vehicle_id: vehicleId,
          driver_id: driverId,
          assigned_by: assignedBy,
          status: 'active',
        },
      });

      return { driver: updatedDriver, vehicle: updatedVehicle };
    });

    return result;
  }
}

module.exports = DriverManagementService;

