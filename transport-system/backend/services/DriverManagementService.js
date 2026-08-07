/**
 * DriverManagementService
 * Business logic for market driver management (brokerage model).
 * Drivers are independent market resources, not employees.
 * Uses DriverRepository for all database access.
 */

const DriverRepository = require('../repositories/DriverRepository');
const { prisma } = require('../config/prisma');

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
   * Check that a vehicle number is not already registered to another driver.
   * Throws a VEHICLE_ALREADY_EXISTS error (maps to HTTP 409) if found.
   * `excludeDriverId` is used on update so a driver can keep their own vehicle.
   */
  async assertVehicleNumberUnique(vehicleNumber, excludeDriverId = null) {
    const normalized = normalizeVehicleNumber(vehicleNumber);
    if (!normalized) return;

    const existing = await this.repo.findByVehicleNumber(normalized);
    if (existing && existing.driver_id !== excludeDriverId) {
      const err = new Error('Vehicle number already registered.');
      err.code = 'VEHICLE_ALREADY_EXISTS';
      err.data = {
        vehicle_number: normalized,
        driver_id: existing.driver_id,
        driver_name: existing.driver_name,
        driver_code: existing.driver_code,
      };
      throw err;
    }
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
      vehicle_type,
      vehicle_number,
      city,
      state,
      address,
      profile_image,
    } = data;

    // Check if driver with this mobile already exists
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

    // Check vehicle number uniqueness (if provided)
    const normalizedVehicleNumber = normalizeVehicleNumber(vehicle_number);
    if (normalizedVehicleNumber) {
      await this.assertVehicleNumberUnique(normalizedVehicleNumber);
    }

    // Check if mobile already has a user
    let user = await prisma.user.findUnique({ where: { phone: mobile } });

    // Create user if not exists (as driver role)
    if (!user) {
      const bcrypt = require('bcryptjs');
      const defaultPassword = 'driver123';
      const password_hash = await bcrypt.hash(defaultPassword, 10);

      user = await prisma.user.create({
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

    const driverCode = await this.repo.generateDriverCode();

const driver = await this.repo.create({
      driver_code: driverCode,
      user_id: user.user_id,
      driver_name,
      mobile,
      alternate_mobile: alternate_mobile || null,
      vehicle_type: vehicle_type || null,
      vehicle_number: normalizedVehicleNumber,
      city: city || null,
      state: state || 'Bihar',
      address: address || null,
      status: 'available',
      profile_image: profile_image || null,
      is_available: true,
      is_verified: false,
    });

    // Record timeline event
    await this.repo.createTimelineEvent({
      driver_id: driver.driver_id,
      event_type: 'driver_created',
      description: `Driver ${driver_name} registered with code ${driverCode}`,
    });

    return driver;
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
   * List drivers with their vehicles for the booking assignment UX.
   * Single endpoint — returns driver + all their vehicles (with availability)
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
   * assigned vehicle so the frontend never makes a second API call.
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
      'vehicle_type', 'vehicle_number',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        updateData[key] = data[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    // Normalize + validate vehicle number uniqueness when it changes
    if (data.vehicle_number !== undefined) {
      const normalized = normalizeVehicleNumber(data.vehicle_number);
      updateData.vehicle_number = normalized;
      if (normalized) {
        await this.assertVehicleNumberUnique(normalized, driverId);
      }
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
   * Delete a driver (soft delete) inside a single DB transaction so the
   * status update and timeline event are atomic — no partial state, no
   * foreign-key failures, and only one round-trip to the database.
   */
  async deleteDriver(driverId) {
    const driver = await this.repo.findById(driverId);
    if (!driver) throw new Error('Driver not found');

    const updated = await prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { driver_id: driverId },
        data: { status: 'inactive', is_available: false },
      });
      await tx.driverTimeline.create({
        data: {
          driver_id: driverId,
          event_type: 'status_changed',
          description: `Driver ${driver.driver_name} marked as inactive`,
        },
      });
      return { driver_id: driverId, status: 'inactive' };
    });

    return updated;
  }

  /**
   * Bulk soft-delete multiple drivers in ONE database transaction.
   * The frontend sends a single request for N drivers — this eliminates the
   * N-request loop that previously caused duplicate deletes and HTTP 429.
   */
  async bulkDeleteDrivers(driverIds) {
    const ids = Array.isArray(driverIds) ? driverIds.map(Number).filter(Number.isFinite) : [];
    if (ids.length === 0) throw new Error('No valid driver IDs provided');

    const result = await prisma.$transaction(async (tx) => {
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
}

module.exports = DriverManagementService;

