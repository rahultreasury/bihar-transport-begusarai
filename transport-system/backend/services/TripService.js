/**
 * TripService
 * Business logic for trip management.
 *
 * This is the single source of truth for all trip operations.
 * All trip CRUD, expense, payment, and financial calculations flow through this service.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripRepository = require('../repositories/TripRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripTimelineService = require('./TripTimelineService');
const TripFinancialCalculationService = require('./TripFinancialCalculationService');

class TripService {
  constructor() {
    this.tripRepo = new TripRepository();
    this.auditRepo = new AuditLogRepository();
    this.timelineService = new TripTimelineService();
    this.financialService = new TripFinancialCalculationService();
  }

  /**
   * Get all trips with pagination, filters, and search.
   */
  async getAllTrips(filters = {}, user = null) {
    const trips = await this.tripRepo.findAll(filters);

    // Calculate financial data for each trip
    const tripsWithFinancials = await Promise.all(
      trips.trips.map(async (trip) => {
        const [totalExpenses, totalPayments] = await Promise.all([
          prisma.tripExpense.aggregate({
            where: { trip_id: trip.trip_id },
            _sum: { amount: true },
          }),
          prisma.tripPayment.aggregate({
            where: { trip_id: trip.trip_id },
            _sum: { amount: true },
          }),
        ]);

        const totalExpensesAmount = totalExpenses._sum.amount || 0;
        const totalPaymentsAmount = totalPayments._sum.amount || 0;
        const profit = trip.freight_amount - totalExpensesAmount;
        const outstanding = trip.freight_amount - totalPaymentsAmount;

        return {
          ...trip,
          totalExpenses: totalExpensesAmount,
          totalPayments: totalPaymentsAmount,
          profit,
          outstanding,
        };
      })
    );

    return {
      ...trips,
      trips: tripsWithFinancials,
    };
  }

  /**
   * Get trip by ID.
   */
  async getTripById(id, user = null) {
    const trip = await this.tripRepo.findById(id);

    // Calculate financial data
    const [totalExpenses, totalPayments, expenses, payments] = await Promise.all([
      prisma.tripExpense.aggregate({
        where: { trip_id: trip.trip_id },
        _sum: { amount: true },
      }),
      prisma.tripPayment.aggregate({
        where: { trip_id: trip.trip_id },
        _sum: { amount: true },
      }),
      prisma.tripExpense.findMany({
        where: { trip_id: trip.trip_id },
        orderBy: { expense_date: 'desc' },
      }),
      prisma.tripPayment.findMany({
        where: { trip_id: trip.trip_id },
        orderBy: { payment_date: 'desc' },
      }),
    ]);

    const totalExpensesAmount = totalExpenses._sum.amount || 0;
    const totalPaymentsAmount = totalPayments._sum.amount || 0;
    const profit = trip.freight_amount - totalExpensesAmount;
    const outstanding = trip.freight_amount - totalPaymentsAmount;

    return {
      ...trip,
      totalExpenses: totalExpensesAmount,
      totalPayments: totalPaymentsAmount,
      profit,
      outstanding,
      expenses,
      payments,
    };
  }

  /**
   * Create a new trip.
   */
  async createTrip(data, user = null) {
    // Validate required fields
    const requiredFields = [
      'user_id',
      'transport_owner_id',
      'vehicle_id',
      'driver_id',
      'pickup_location',
      'pickup_city',
      'drop_location',
      'drop_city',
      'freight_amount',
    ];

    for (const field of requiredFields) {
      if (!data[field]) {
        throw new ValidationError(`${field} is required`);
      }
    }

    // Validate that user exists
    const userExists = await prisma.user.findUnique({
      where: { user_id: data.user_id },
    });
    if (!userExists) {
      throw new ValidationError('Client not found');
    }

    // Validate that transport owner exists
    const ownerExists = await prisma.vehicleOwner.findUnique({
      where: { owner_id: data.transport_owner_id },
    });
    if (!ownerExists) {
      throw new ValidationError('Transport owner not found');
    }

    // Validate that vehicle exists and belongs to the selected owner
    const vehicleExists = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: data.vehicle_id },
    });
    if (!vehicleExists) {
      throw new ValidationError('Vehicle not found');
    }
    if (vehicleExists.owner_id !== data.transport_owner_id) {
      throw new ValidationError(`Vehicle ${vehicleExists.vehicle_number} does not belong to the selected transport owner`);
    }

    // Validate that driver exists
    const driverExists = await prisma.driver.findUnique({
      where: { driver_id: data.driver_id },
    });
    if (!driverExists) {
      throw new ValidationError('Driver not found');
    }

    // Validate driver-owner consistency:
    // - For TRANSPORT_COMPANY/INDIVIDUAL_OWNER: driver must belong to the selected owner
    // - For DRIVER_OWNER: driver can be the owner themselves or belong to the owner
    if (ownerExists.owner_type === 'DRIVER_OWNER') {
      // Driver-owner: driver can be the owner themselves (if driver has same person)
      // or belong to the owner. We allow it as long as the driver exists.
      // Additional check: if driver has transport_owner_id, it should match
      if (driverExists.transport_owner_id && driverExists.transport_owner_id !== data.transport_owner_id) {
        throw new ValidationError(`Driver ${driverExists.driver_name} is assigned to a different transport owner`);
      }
    } else {
      // For company/individual owners, driver must belong to the selected owner
      if (driverExists.transport_owner_id !== data.transport_owner_id) {
        throw new ValidationError(`Driver ${driverExists.driver_name} does not belong to the selected transport owner`);
      }
    }

    // Validate booking if provided
    if (data.booking_id) {
      const bookingExists = await prisma.booking.findUnique({
        where: { booking_id: data.booking_id },
      });
      if (!bookingExists) {
        throw new ValidationError('Booking not found');
      }
    }

    // Generate trip number
    const tripNumber = await this.tripRepo.generateTripNumber();

    // Create trip
    const trip = await this.tripRepo.create({
      ...data,
      trip_number: tripNumber,
      status: data.status || 'PENDING',
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_created',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        new_value: JSON.stringify(trip),
      });
    }

    return trip;
  }

  /**
   * Update a trip.
   */
  async updateTrip(id, data, user = null) {
    // Validate trip exists
    const existingTrip = await this.tripRepo.findById(id);

    // Validate booking if provided
    if (data.booking_id) {
      const bookingExists = await prisma.booking.findUnique({
        where: { booking_id: data.booking_id },
      });
      if (!bookingExists) {
        throw new ValidationError('Booking not found');
      }
    }

    const trip = await this.tripRepo.update(id, data);

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_updated',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify(existingTrip),
        new_value: JSON.stringify(trip),
      });
    }

    return trip;
  }

  /**
   * Delete a trip.
   */
  async deleteTrip(id, user = null) {
    const existingTrip = await this.tripRepo.findById(id);

    const trip = await this.tripRepo.delete(id);

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_deleted',
        entity_type: 'Trip',
        entity_id: id,
        previous_value: JSON.stringify(existingTrip),
      });
    }

    return trip;
  }

  /**
   * Update trip status.
   */
  async updateTripStatus(id, status, user = null) {
    const validStatuses = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status: ${status}`);
    }

    const existingTrip = await this.tripRepo.findById(id);

    const updateData = { status };

    // Set timestamps based on status
    if (status === 'COMPLETED') {
      updateData.completed_at = new Date();
    } else if (status === 'CANCELLED') {
      updateData.cancelled_at = new Date();
    }

    const trip = await this.tripRepo.update(id, updateData);

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_status_changed',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify({ status: existingTrip.status }),
        new_value: JSON.stringify({ status: trip.status }),
      });
    }

    return trip;
  }

  /**
   * Add expense to a trip.
   */
  async addExpense(tripId, data, user = null) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    // Validate expense type
    const validTypes = ['DRIVER', 'DIESEL', 'TOLL', 'LOADING', 'UNLOADING', 'OWNER', 'MAINTENANCE', 'OTHER'];
    if (!validTypes.includes(data.expense_type)) {
      throw new ValidationError(`Invalid expense type: ${data.expense_type}`);
    }

    const expense = await prisma.tripExpense.create({
      data: {
        trip_id: tripId,
        expense_type: data.expense_type,
        amount: parseFloat(data.amount),
        expense_date: data.expense_date ? new Date(data.expense_date) : new Date(),
        description: data.description || null,
      },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_added',
        entity_type: 'TripExpense',
        entity_id: expense.expense_id,
        new_value: JSON.stringify(expense),
      });
    }

    return expense;
  }

  /**
   * Update trip expense.
   */
  async updateExpense(tripId, expenseId, data, user = null) {
    // Validate expense exists and belongs to trip
    const existingExpense = await prisma.tripExpense.findFirst({
      where: { expense_id: expenseId, trip_id: tripId },
    });

    if (!existingExpense) {
      throw new NotFoundError('Expense not found');
    }

    const expense = await prisma.tripExpense.update({
      where: { expense_id: expenseId },
      data: {
        expense_type: data.expense_type || existingExpense.expense_type,
        amount: data.amount ? parseFloat(data.amount) : existingExpense.amount,
        expense_date: data.expense_date ? new Date(data.expense_date) : existingExpense.expense_date,
        description: data.description !== undefined ? data.description : existingExpense.description,
      },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_updated',
        entity_type: 'TripExpense',
        entity_id: expense.expense_id,
        previous_value: JSON.stringify(existingExpense),
        new_value: JSON.stringify(expense),
      });
    }

    return expense;
  }

  /**
   * Delete trip expense.
   */
  async deleteExpense(tripId, expenseId, user = null) {
    // Validate expense exists and belongs to trip
    const existingExpense = await prisma.tripExpense.findFirst({
      where: { expense_id: expenseId, trip_id: tripId },
    });

    if (!existingExpense) {
      throw new NotFoundError('Expense not found');
    }

    const expense = await prisma.tripExpense.delete({
      where: { expense_id: expenseId },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_deleted',
        entity_type: 'TripExpense',
        entity_id: expenseId,
        previous_value: JSON.stringify(existingExpense),
      });
    }

    return expense;
  }

  /**
   * Add payment to a trip.
   */
  async addPayment(tripId, data, user = null) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    // Validate payment type
    const validTypes = ['ADVANCE', 'PARTIAL', 'FULL', 'SETTLEMENT', 'OTHER'];
    if (!validTypes.includes(data.payment_type)) {
      throw new ValidationError(`Invalid payment type: ${data.payment_type}`);
    }

    const payment = await prisma.tripPayment.create({
      data: {
        trip_id: tripId,
        amount: parseFloat(data.amount),
        payment_type: data.payment_type,
        payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
        payment_method: data.payment_method || null,
        reference: data.reference || null,
        notes: data.notes || null,
      },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_payment_added',
        entity_type: 'TripPayment',
        entity_id: payment.payment_id,
        new_value: JSON.stringify(payment),
      });
    }

    return payment;
  }

  /**
   * Get trip expenses.
   */
  async getTripExpenses(tripId) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    return prisma.tripExpense.findMany({
      where: { trip_id: tripId },
      orderBy: { expense_date: 'desc' },
    });
  }

  /**
   * Get trip payments.
   */
  async getTripPayments(tripId) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    return prisma.tripPayment.findMany({
      where: { trip_id: tripId },
      orderBy: { payment_date: 'desc' },
    });
  }

  /**
   * Get trip summary statistics.
   */
  async getTripSummary() {
    return this.tripRepo.getSummary();
  }

  /**
   * Get top clients.
   */
  async getTopClients(limit = 5) {
    return this.tripRepo.getTopClients(limit);
  }

  /**
   * Get trips by client ID.
   */
  async getTripsByClientId(clientId, filters = {}) {
    return this.tripRepo.findByClientId(clientId, filters);
  }

  /**
   * Get trips by driver ID.
   */
  async getTripsByDriverId(driverId, filters = {}) {
    return this.tripRepo.findByDriverId(driverId, filters);
  }

  /**
   * Get trips by vehicle ID.
   */
  async getTripsByVehicleId(vehicleId, filters = {}) {
    return this.tripRepo.findByVehicleId(vehicleId, filters);
  }

  /**
   * Get trips by transport owner ID.
   */
  async getTripsByOwnerId(ownerId, filters = {}) {
    return this.tripRepo.findByOwnerId(ownerId, filters);
  }

  /**
   * Get available clients for dropdown.
   */
  async getAvailableClients(search = '') {
    return this.tripRepo.getAvailableClients(search);
  }

  /**
   * Get available drivers for dropdown.
   */
  async getAvailableDrivers(search = '') {
    return this.tripRepo.getAvailableDrivers(search);
  }

  /**
   * Get available vehicles for dropdown.
   */
  async getAvailableVehicles(search = '') {
    return this.tripRepo.getAvailableVehicles(search);
  }

  /**
   * Get available transport owners for dropdown.
   */
  async getAvailableOwners(search = '') {
    return this.tripRepo.getAvailableOwners(search);
  }

  /**
   * Get clients with stats (outstanding amount, trip count).
   * Used for trip creation wizard.
   */
  async getClientsWithStats() {
    const clients = await prisma.user.findMany({
      where: {
        role: 'customer',
      },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        phone: true,
        email: true,
        trips: {
          select: {
            trip_id: true,
            freight_amount: true,
            client_received: true,
            status: true,
          },
        },
      },
      orderBy: {
        first_name: 'asc',
      },
    });

    // Calculate stats for each client
    return clients.map(client => {
      const totalTrips = client.trips.length;
      const totalFreight = client.trips.reduce((sum, t) => sum + (t.freight_amount || 0), 0);
      const totalReceived = client.trips.reduce((sum, t) => sum + (t.client_received || 0), 0);
      const outstanding = totalFreight - totalReceived;

      return {
        user_id: client.user_id,
        first_name: client.first_name,
        last_name: client.last_name,
        phone: client.phone,
        email: client.email,
        totalTrips,
        totalFreight,
        totalReceived,
        outstanding,
      };
    });
  }

  /**
   * Get vehicles belonging to a specific transport owner.
   * Used for trip creation wizard.
   */
  async getVehiclesByOwner(ownerId) {
    return prisma.transportVehicle.findMany({
      where: {
        owner_id: ownerId,
      },
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_name: true,
        vehicle_type: true,
        owner_id: true,
      },
      orderBy: {
        vehicle_number: 'asc',
      },
    });
  }

  /**
   * Get drivers belonging to a specific transport owner.
   * Used for trip creation wizard — ensures owner-vehicle-driver consistency.
   */
  async getDriversByOwner(ownerId, search = '') {
    return this.tripRepo.getDriversByOwner(ownerId, search);
  }
}

module.exports = TripService;
