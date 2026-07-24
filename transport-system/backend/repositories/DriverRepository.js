/**
 * DriverRepository
 * Database-only repository for driver-related operations.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

class DriverRepository {
  /**
   * Generate next driver code (DRV000001, DRV000002, etc.)
   */
  async generateDriverCode(tx = null) {
    const client = tx || prisma;
    const lastDriver = await client.driver.findFirst({
      orderBy: { driver_code: 'desc' },
      select: { driver_code: true },
    });
    
    let nextNum = 1;
    if (lastDriver && lastDriver.driver_code) {
      const match = lastDriver.driver_code.match(/DRV(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    return `DRV${String(nextNum).padStart(6, '0')}`;
  }

  /**
   * Create a new driver.
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.driver.create({ data });
  }

  /**
   * Find driver by ID with full relations.
   */
  async findById(driverId, tx = null) {
    const client = tx || prisma;
    return await client.driver.findUnique({
      where: { driver_id: driverId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
        transportVehicles: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
        bookingAssignments: {
          include: {
            booking: {
              select: {
                booking_reference: true,
                pickup_city: true,
                drop_city: true,
                status: true,
                created_at: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            bookings: true,
            transactions: true,
            timelineEvents: true,
          },
        },
      },
    });
  }

  /**
   * Find driver by driver_code.
   */
  async findByCode(code, tx = null) {
    const client = tx || prisma;
    return await client.driver.findUnique({
      where: { driver_code: code },
    });
  }

  /**
   * List drivers with search, filter, sort, pagination.
   */
  async findAll(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      vehicleType = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = {};

    // Search across multiple fields
    if (search) {
      where.OR = [
        { driver_code: { contains: search, mode: 'insensitive' } },
        { driver_name: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
        { license_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Determine sort field (whitelist allowed fields)
    const allowedSortFields = ['driver_code', 'driver_name', 'status', 'joining_date', 'created_at', 'total_deliveries', 'current_balance'];
    const field = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder === 'asc' ? 'asc' : 'desc';

    const [drivers, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              phone: true,
            },
          },
          transportVehicles: {
            where: { is_available: true },
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_name: true,
              vehicle_type: true,
            },
            take: 3,
            orderBy: { created_at: 'desc' },
          },
          bookings: {
            where: { status: { in: ['confirmed', 'pickup_completed', 'in_transit'] } },
            select: {
              booking_id: true,
              booking_reference: true,
              pickup_city: true,
              drop_city: true,
              status: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
        orderBy: { [field]: order },
        skip,
        take,
      }),
      prisma.driver.count({ where }),
    ]);

    return {
      drivers,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Update driver by ID.
   */
  async update(driverId, data, tx = null) {
    const client = tx || prisma;
    return await client.driver.update({
      where: { driver_id: driverId },
      data,
    });
  }

  /**
   * Delete driver by ID.
   */
  async delete(driverId, tx = null) {
    const client = tx || prisma;
    return await client.driver.delete({
      where: { driver_id: driverId },
    });
  }

  /**
   * Get driver status counts for dashboard KPIs.
   */
  async getStatusCounts() {
    const [total, available, onTrip, inactive] = await Promise.all([
      prisma.driver.count(),
      prisma.driver.count({ where: { status: 'available' } }),
      prisma.driver.count({ where: { status: 'on_trip' } }),
      prisma.driver.count({ where: { status: 'inactive' } }),
    ]);

    return { total, available, onTrip, inactive };
  }

  /**
   * Get trip history for a driver.
   */
  async getTrips(driverId, filters = {}) {
    const { page = 1, limit = 20, status = '' } = filters;
    const skip = (page - 1) * limit;

    const where = { driver_id: driverId };
    if (status) {
      where.status = status;
    }

    const [trips, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          vehicle: {
            select: {
              vehicle_number: true,
              vehicle_name: true,
            },
          },
          delivery: {
            select: {
              estimated_distance_km: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    // Calculate totals
    const revenueAgg = await prisma.booking.aggregate({
      where: {
        driver_id: driverId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { final_price: true },
    });

    const distanceAgg = await prisma.booking.aggregate({
      where: {
        driver_id: driverId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { estimated_distance_km: true },
    });

    return {
      trips,
      revenue: revenueAgg._sum.final_price || 0,
      totalDistance: distanceAgg._sum.estimated_distance_km || 0,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get vehicle assignment history for a driver.
   */
  async getVehicleHistory(driverId) {
    return await prisma.transportVehicle.findMany({
      where: { driver_id: driverId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Get financial transactions (ledger) for a driver.
   */
  async getTransactions(driverId, filters = {}) {
    const { page = 1, limit = 50, type = '', dateFrom = '', dateTo = '' } = filters;
    const skip = (page - 1) * limit;

    const where = { driver_id: driverId };
    if (type) {
      where.transaction_type = type;
    }
    if (dateFrom || dateTo) {
      where.transaction_date = {};
      if (dateFrom) where.transaction_date.gte = new Date(dateFrom);
      if (dateTo) where.transaction_date.lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const [transactions, total] = await Promise.all([
      prisma.driverTransaction.findMany({
        where,
        orderBy: { transaction_date: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.driverTransaction.count({ where }),
    ]);

    // Get financial summary
    const advanceAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: 'advance' },
      _sum: { amount: true },
    });

    const paymentsAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: 'trip_payment' },
      _sum: { amount: true },
    });

    const fuelAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: 'fuel_expense' },
      _sum: { amount: true },
    });

    const tollAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: 'toll_expense' },
      _sum: { amount: true },
    });

    const otherAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: 'other_expense' },
      _sum: { amount: true },
    });

    return {
      transactions,
      summary: {
        totalAdvance: advanceAgg._sum.amount || 0,
        totalPayments: paymentsAgg._sum.amount || 0,
        totalFuel: fuelAgg._sum.amount || 0,
        totalToll: tollAgg._sum.amount || 0,
        totalOtherExpenses: otherAgg._sum.amount || 0,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Create a financial transaction (ledger entry).
   */
  async createTransaction(data, tx = null) {
    const client = tx || prisma;
    return await client.driverTransaction.create({ data });
  }

  /**
   * Get timeline events for a driver.
   */
  async getTimeline(driverId) {
    return await prisma.driverTimeline.findMany({
      where: { driver_id: driverId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  /**
   * Create a timeline event.
   */
  async createTimelineEvent(data, tx = null) {
    const client = tx || prisma;
    return await client.driverTimeline.create({ data });
  }

  /**
   * Get driver count with status breakdowns.
   */
  async getDashboardStats() {
    const [total, available, onTrip, inactive] = await Promise.all([
      prisma.driver.count(),
      prisma.driver.count({ where: { status: 'available' } }),
      prisma.driver.count({ where: { status: 'on_trip' } }),
      prisma.driver.count({ where: { status: 'inactive' } }),
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysTrips = await prisma.booking.count({
      where: {
        driver_id: { not: null },
        created_at: { gte: todayStart, lte: todayEnd },
      },
    });

    const advanceAgg = await prisma.driverTransaction.aggregate({
      where: { transaction_type: 'advance' },
      _sum: { amount: true },
    });

    const pendingPayments = await prisma.driver.count({
      where: {
        current_balance: { gt: 0 },
      },
    });

    return {
      total,
      available,
      onTrip,
      inactive,
      todaysTrips,
      pendingPayments,
      advanceOutstanding: advanceAgg._sum.amount || 0,
    };
  }
}

module.exports = DriverRepository;

