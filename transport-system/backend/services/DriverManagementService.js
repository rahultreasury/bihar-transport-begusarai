/**
 * DriverManagementService
 * Business logic for driver management operations.
 * Uses DriverRepository for all database access.
 */

const DriverRepository = require('../repositories/DriverRepository');
const { prisma } = require('../config/prisma');

class DriverManagementService {
  constructor() {
    this.repo = new DriverRepository();
  }

  /**
   * Register a new driver.
   * Auto-generates driver code, creates user account, records timeline.
   */
  async registerDriver(data) {
    const {
      driver_name,
      mobile,
      alternate_mobile,
      address,
      city,
      state,
      pincode,
      license_number,
      license_expiry,
      license_class,
      joining_date,
      profile_image,
    } = data;

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
      address: address || null,
      city: city || null,
      state: state || 'Bihar',
      pincode: pincode || null,
      license_number,
      license_expiry,
      license_class: license_class || null,
      joining_date: joining_date || new Date().toISOString().split('T')[0],
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
      'driver_name', 'mobile', 'alternate_mobile', 'address', 'city',
      'state', 'pincode', 'license_number', 'license_expiry', 'license_class',
      'joining_date', 'status', 'profile_image',
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
   * Delete a driver.
   */
  async deleteDriver(driverId) {
    return await this.repo.delete(driverId);
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
   * Get vehicle assignment history.
   */
  async getDriverVehicles(driverId) {
    const currentVehicle = await prisma.transportVehicle.findFirst({
      where: { driver_id: driverId, is_available: false },
      orderBy: { updated_at: 'desc' },
    });

    const vehicleHistory = await this.repo.getVehicleHistory(driverId);

    return { currentVehicle, vehicleHistory };
  }

  /**
   * Get financial transactions (ledger) for a driver.
   */
  async getDriverFinance(driverId, filters = {}) {
    return await this.repo.getTransactions(driverId, filters);
  }

  /**
   * Record an advance payment to a driver.
   * Creates transaction and updates driver balance.
   */
  async recordAdvance(driverId, data) {
    const { amount, description, payment_mode, recorded_by, notes } = data;

    const driver = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true, total_advance: true, current_balance: true, driver_name: true },
    });

    if (!driver) throw new Error('Driver not found');

    const balanceBefore = driver.current_balance;
    // Advance is positive (driver receives money), so balance goes up
    const balanceAfter = balanceBefore + parseFloat(amount);

    return await prisma.$transaction(async (tx) => {
      // Create transaction record
      const transaction = await tx.driverTransaction.create({
        data: {
          driver_id: driverId,
          transaction_type: 'advance',
          amount: parseFloat(amount),
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          description: description || `Advance payment of ₹${amount}`,
          payment_mode: payment_mode || 'cash',
          recorded_by: recorded_by || null,
          notes: notes || null,
        },
      });

      // Update driver balance
      await tx.driver.update({
        where: { driver_id: driverId },
        data: {
          total_advance: { increment: parseFloat(amount) },
          current_balance: balanceAfter,
        },
      });

      // Record timeline
      await tx.driverTimeline.create({
        data: {
          driver_id: driverId,
          event_type: 'advance_given',
          description: `Advance of ₹${amount} given to ${driver.driver_name}`,
          reference_type: 'transaction',
          reference_id: transaction.transaction_id,
        },
      });

      return transaction;
    });
  }

  /**
   * Record a trip payment to a driver.
   */
  async recordPayment(driverId, data) {
    const { amount, description, booking_id, payment_mode, recorded_by, notes } = data;

    const driver = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true, total_paid: true, current_balance: true, driver_name: true },
    });

    if (!driver) throw new Error('Driver not found');

    const balanceBefore = driver.current_balance;
    // Payment reduces the balance (company pays driver)
    const balanceAfter = balanceBefore - parseFloat(amount);

    return await prisma.$transaction(async (tx) => {
      const transaction = await tx.driverTransaction.create({
        data: {
          driver_id: driverId,
          transaction_type: 'trip_payment',
          amount: parseFloat(amount),
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          description: description || `Trip payment of ₹${amount}`,
          reference_type: 'booking',
          reference_id: booking_id || null,
          payment_mode: payment_mode || 'cash',
          recorded_by: recorded_by || null,
          notes: notes || null,
        },
      });

      await tx.driver.update({
        where: { driver_id: driverId },
        data: {
          total_paid: { increment: parseFloat(amount) },
          current_balance: balanceAfter,
        },
      });

      await tx.driverTimeline.create({
        data: {
          driver_id: driverId,
          event_type: 'payment_recorded',
          description: `Payment of ₹${amount} recorded for ${driver.driver_name}`,
          reference_type: 'transaction',
          reference_id: transaction.transaction_id,
        },
      });

      return transaction;
    });
  }

  /**
   * Record an expense (fuel, toll, other) for a driver.
   */
  async recordExpense(driverId, data) {
    const { expense_type, amount, description, booking_id, payment_mode, recorded_by, notes } = data;

    const driver = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true, total_expenses: true, current_balance: true, driver_name: true },
    });

    if (!driver) throw new Error('Driver not found');

    const balanceBefore = driver.current_balance;
    // Expenses increase the balance (driver spends company money)
    const balanceAfter = balanceBefore + parseFloat(amount);

    const typeMap = {
      fuel: 'fuel_expense',
      toll: 'toll_expense',
      other: 'other_expense',
    };

    const transactionType = typeMap[expense_type] || 'other_expense';

    return await prisma.$transaction(async (tx) => {
      const transaction = await tx.driverTransaction.create({
        data: {
          driver_id: driverId,
          transaction_type: transactionType,
          amount: parseFloat(amount),
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          description: description || `${expense_type} expense of ₹${amount}`,
          reference_type: 'booking',
          reference_id: booking_id || null,
          payment_mode: payment_mode || 'cash',
          recorded_by: recorded_by || null,
          notes: notes || null,
        },
      });

      await tx.driver.update({
        where: { driver_id: driverId },
        data: {
          total_expenses: { increment: parseFloat(amount) },
          current_balance: balanceAfter,
        },
      });

      const eventType = expense_type === 'fuel' ? 'fuel_added' : 'expense_recorded';
      await tx.driverTimeline.create({
        data: {
          driver_id: driverId,
          event_type: eventType,
          description: `${expense_type.charAt(0).toUpperCase() + expense_type.slice(1)} expense of ₹${amount} for ${driver.driver_name}`,
          reference_type: 'transaction',
          reference_id: transaction.transaction_id,
        },
      });

      return transaction;
    });
  }

  /**
   * Get timeline for a driver.
   */
  async getDriverTimeline(driverId) {
    return await this.repo.getTimeline(driverId);
  }

  /**
   * Get dashboard stats.
   */
  async getDashboardStats() {
    return await this.repo.getDashboardStats();
  }
}

module.exports = DriverManagementService;

