/**
 * TripService
 * Business logic for trip management.
 *
 * This is the single source of truth for all trip operations.
 * All trip CRUD, expense, payment, and financial calculations flow through this service.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError, ConflictError } = require('../utils/AppError');
const TripRepository = require('../repositories/TripRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripTimelineService = require('./TripTimelineService');
const TripFinancialCalculationService = require('./TripFinancialCalculationService');
const CanonicalFinancialService = require('./CanonicalFinancialService');

class TripService {
  constructor() {
    this.tripRepo = new TripRepository();
    this.auditRepo = new AuditLogRepository();
    this.timelineService = new TripTimelineService();
    this.financialService = new TripFinancialCalculationService();
    this.canonicalFinancialService = new CanonicalFinancialService();
  }

  /**
   * Get all trips with pagination, filters, and search.
   */
  async getAllTrips(filters = {}, user = null) {
    const trips = await this.tripRepo.findAll(filters);

    // Calculate financial data for each trip using the authoritative financial service
    // This ensures consistency with the trip detail financial API
    const tripsWithFinancials = await Promise.all(
      trips.trips.map(async (trip) => {
        const financials = await this.financialService.calculateTripFinancials(trip.trip_id);

        return {
          ...trip,
          // Legacy fields for backward compatibility
          totalExpenses: 0, // Expenses removed from trip financial workflow
          totalPayments: financials.customerCollected,
          profit: financials.btNetProfit,
          outstanding: financials.customerDue,
          // New consistent financial fields
          financials: {
            client: {
              freight: financials.freight,
              paid: financials.customerCollected,
              due: financials.customerDue,
            },
            provider: {
              agreedAmount: financials.ownerPayable,
              paid: financials.ownerPaid,
              due: financials.ownerPayableRemaining,
            },
            commission: {
              amount: financials.btCommission,
              rate: financials.commissionRate,
            },
          },
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

    // Check for financial records that would block deletion
    const [expenseCount, paymentCount, advanceCount, financialCount, transactionCount, timelineCount] =
      await Promise.all([
        prisma.tripExpense.count({ where: { trip_id: id } }),
        prisma.tripPayment.count({ where: { trip_id: id } }),
        prisma.tripAdvance.count({ where: { trip_id: id } }),
        prisma.tripFinancial.count({ where: { trip_id: id } }),
        prisma.financialTransaction.count({ where: { trip_id: id } }),
        prisma.tripTimeline.count({ where: { trip_id: id } }),
      ]);

    const totalRecords = expenseCount + paymentCount + advanceCount + financialCount + transactionCount + timelineCount;

    if (totalRecords > 0) {
      const parts = [];
      if (expenseCount > 0) parts.push(`${expenseCount} expense(s)`);
      if (paymentCount > 0) parts.push(`${paymentCount} payment(s)`);
      if (advanceCount > 0) parts.push(`${advanceCount} advance(s)`);
      if (financialCount > 0) parts.push(`${financialCount} financial record(s)`);
      if (transactionCount > 0) parts.push(`${transactionCount} transaction(s)`);
      if (timelineCount > 0) parts.push(`${timelineCount} timeline event(s)`);

      throw new ConflictError({
        message: `Cannot delete trip with existing financial records: ${parts.join(', ')}. ` +
                 'Please settle all financial activity before deleting this trip.',
      });
    }

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

    // COMPLETION RULE: A trip MUST NOT be marked COMPLETED while Customer Due > 0
    if (status === 'COMPLETED') {
      const financials = await this.canonicalFinancialService.calculateTripFinancials(id);
      const customerDue = financials.customerDue || 0;
      if (customerDue > 0) {
        throw new ValidationError(`Cannot complete trip. Customer payment pending: ₹${customerDue.toLocaleString('en-IN')}`);
      }
    }

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
    const trip = await this.tripRepo.findById(tripId);

    // Validate payment type
    const validTypes = ['ADVANCE', 'PARTIAL', 'FULL', 'SETTLEMENT', 'OTHER'];
    if (!validTypes.includes(data.payment_type)) {
      throw new ValidationError(`Invalid payment type: ${data.payment_type}`);
    }

    const amount = parseFloat(data.amount);
    if (!amount || amount <= 0) {
      throw new ValidationError('Valid payment amount is required');
    }

    // Calculate current customer due using canonical financial service
    const tripFinancials = await this.canonicalFinancialService.calculateTripFinancials(tripId);
    const customerDue = tripFinancials.customerDue || 0;

    // Reject payment that exceeds outstanding customer due
    if (amount > customerDue) {
      throw new ValidationError(
        `Payment cannot exceed the remaining customer due of ₹${customerDue.toLocaleString('en-IN')}`
      );
    }

    // Find or create trip financial record for canonical ledger
    let tripFinancial = await prisma.tripFinancial.findFirst({
      where: { trip_id: tripId },
    });
    if (!tripFinancial) {
      tripFinancial = await prisma.tripFinancial.create({
        data: {
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          status: 'CALCULATED',
          customer_fare: trip.freight_amount || 0,
          calculated_at: new Date(),
        },
      });
    }

    // Determine transaction type based on trip source
    const isClientTrip = trip.source_type === 'OFFLINE_CLIENT' && trip.client_id;
    const transactionType = isClientTrip ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT';
    const fromParty = isClientTrip ? 'CLIENT' : 'CUSTOMER';

    // Use a transaction to ensure TripPayment + FinancialTransaction are atomic
    const result = await prisma.$transaction(async (tx) => {
      // Create TripPayment record
      const payment = await tx.tripPayment.create({
        data: {
          trip_id: tripId,
          amount: amount,
          payment_type: data.payment_type,
          payment_category: 'CLIENT_PAYMENT',
          payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
          payment_method: data.payment_method || null,
          reference: data.reference || null,
          notes: data.notes || null,
        },
      });

      // Create FinancialTransaction for canonical financial system
      // Use tripFinancial relation connect (required by Prisma schema)
      await tx.financialTransaction.create({
        data: {
          tripFinancial: { connect: { trip_financial_id: tripFinancial.trip_financial_id } },
          trip: { connect: { trip_id: tripId } },
          booking: trip.booking_id ? { connect: { booking_id: trip.booking_id } } : undefined,
          client_id: trip.client_id || null,
          transaction_type: transactionType,
          amount: amount,
          direction: 'CREDIT',
          from_party: fromParty,
          to_party: 'BIHAR_TRANSPORT',
          purpose: 'Freight Payment',
          payment_method: data.payment_method || null,
          reference_number: data.reference || null,
          transaction_date: data.payment_date ? new Date(data.payment_date) : new Date(),
          status: 'PAID',
          notes: data.notes || null,
          created_by: user?.user_id || null,
          metadata: JSON.stringify({
            source_type: trip.source_type,
            client_id: trip.client_id || null,
            payment_id: payment.payment_id,
          }),
        },
      });

      return payment;
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_payment_added',
        entity_type: 'TripPayment',
        entity_id: result.payment_id,
        new_value: JSON.stringify(result),
      });
    }

    return result;
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
   * Get offline clients (business accounts) for trip creation lookup.
   * Includes trip count and outstanding stats.
   * @param {string} search - Optional search term
   * @returns {Promise<Array>}
   */
  async getOfflineClients(search = '') {
    const clients = await this.tripRepo.getOfflineClients(search);

    // Enrich with financial stats using the canonical service
    const enriched = await Promise.all(
      clients.map(async (client) => {
        try {
          const financials = await this.canonicalFinancialService.calculateClientFinancials(client.client_id);
          return {
            ...client,
            totalTrips: financials.totalTrips,
            totalFreight: financials.totalFreight,
            totalPaid: financials.totalPaid,
            outstanding: financials.totalOutstanding,
            paymentStatus: financials.paymentStatus,
          };
        } catch {
          return {
            ...client,
            totalTrips: client._count?.trips || 0,
            totalFreight: 0,
            totalPaid: 0,
            outstanding: 0,
            paymentStatus: 'PENDING',
          };
        }
      })
    );

    return enriched;
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
