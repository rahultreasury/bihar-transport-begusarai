/**
 * DriverManagementService
 * Business logic for market driver management (brokerage model).
 * Drivers are independent market resources, not employees.
 * Uses DriverRepository for all database access.
 */

const DriverRepository = require('../repositories/DriverRepository');
const { prisma } = require('../config/prisma');

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
      city,
      state,
      address,
      notes,
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
      city: city || null,
      state: state || 'Bihar',
      address: address || null,
      notes: notes || null,
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
   * Update driver information.
   */
  async updateDriver(driverId, data) {
const allowedFields = [
      'driver_name', 'mobile', 'alternate_mobile', 'city',
      'state', 'address', 'notes',
      'status', 'profile_image',
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
   * Delete a driver (soft delete).
   */
  async deleteDriver(driverId) {
    const driver = await this.repo.findById(driverId);
    if (!driver) throw new Error('Driver not found');

    const updated = await this.repo.softDelete(driverId);

    await this.repo.createTimelineEvent({
      driver_id: driverId,
      event_type: 'status_changed',
      description: `Driver ${driver.driver_name} marked as inactive`,
    });

    return updated;
  }

  /**
   * Toggle driver status.
   */
  async toggleStatus(driverId) {
    const driver = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { status: true },
    });

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
   * Assign a vehicle to a driver.
   */
  async assignVehicle(driverId, vehicleId) {
    return await this.repo.assignVehicle(driverId, vehicleId);
  }

  /**
   * Get available vehicles for assignment.
   */
  async getAvailableVehicles() {
    return await this.repo.getAvailableVehicles();
  }

  /**
   * Get dashboard stats (simplified for market drivers).
   */
  async getDashboardStats() {
    return await this.repo.getDashboardStats();
  }
}

module.exports = DriverManagementService;

