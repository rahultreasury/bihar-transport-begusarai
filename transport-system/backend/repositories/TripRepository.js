/**
 * TripRepository
 * Database-only repository for interacting with the `trips` table.
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 */

const { prisma } = require('../config/prisma');
const { NotFoundError } = require('../utils/AppError');

/**
 * Shared Prisma `include` shape for fetching a trip with its relations.
 */
const TripInclude = {
  user: {
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  transportOwner: {
    select: {
      owner_id: true,
      owner_code: true,
      owner_name: true,
      company_name: true,
      mobile: true,
    },
  },
  vehicle: {
    select: {
      vehicle_id: true,
      vehicle_code: true,
      vehicle_number: true,
      vehicle_name: true,
      vehicle_type: true,
    },
  },
  driver: {
    select: {
      driver_id: true,
      driver_code: true,
      driver_name: true,
      mobile: true,
      license_number: true,
    },
  },
  booking: {
    select: {
      booking_id: true,
      booking_number: true,
      booking_reference: true,
      status: true,
    },
  },
  expenses: true,
  payments: true,
};

class TripRepository {
  constructor(tx = null) {
    this.tx = tx || prisma;
  }

  /**
   * Find all trips with pagination, filters, and search.
   */
  async findAll(filters = {}) {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      clientId = '',
      driverId = '',
      vehicleId = '',
      ownerId = '',
      dateFrom = '',
      dateTo = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = filters;

    const where = {};

    // Search filter
    if (search) {
      where.OR = [
        { trip_number: { contains: search, mode: 'insensitive' } },
        { pickup_city: { contains: search, mode: 'insensitive' } },
        { drop_city: { contains: search, mode: 'insensitive' } },
        { pickup_location: { contains: search, mode: 'insensitive' } },
        { drop_location: { contains: search, mode: 'insensitive' } },
        {
          user: {
            first_name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          user: {
            last_name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          driver: {
            driver_name: { contains: search, mode: 'insensitive' },
          },
        },
        {
          vehicle: {
            vehicle_number: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Client filter
    if (clientId) {
      where.user_id = parseInt(clientId);
    }

    // Driver filter
    if (driverId) {
      where.driver_id = parseInt(driverId);
    }

    // Vehicle filter
    if (vehicleId) {
      where.vehicle_id = parseInt(vehicleId);
    }

    // Owner filter
    if (ownerId) {
      where.transport_owner_id = parseInt(ownerId);
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.trip_date = {};
      if (dateFrom) {
        where.trip_date.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.trip_date.lte = new Date(dateTo + 'T23:59:59');
      }
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      this.tx.trip.findMany({
        where,
        include: TripInclude,
        skip,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.tx.trip.count({ where }),
    ]);

    return {
      trips,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find trip by ID.
   */
  async findById(id) {
    const trip = await this.tx.trip.findUnique({
      where: { trip_id: id },
      include: TripInclude,
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    return trip;
  }

  /**
   * Find trip by trip number.
   */
  async findByTripNumber(tripNumber) {
    const trip = await this.tx.trip.findUnique({
      where: { trip_number: tripNumber },
      include: TripInclude,
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    return trip;
  }

  /**
   * Create a new trip.
   */
  async create(data) {
    const trip = await this.tx.trip.create({
      data,
      include: TripInclude,
    });

    return trip;
  }

  /**
   * Update a trip.
   */
  async update(id, data) {
    const trip = await this.tx.trip.update({
      where: { trip_id: id },
      data,
      include: TripInclude,
    });

    return trip;
  }

  /**
   * Delete a trip.
   */
  async delete(id) {
    const trip = await this.tx.trip.delete({
      where: { trip_id: id },
    });

    return trip;
  }

  /**
   * Get trip summary statistics.
   */
  async getSummary() {
    const [
      totalTrips,
      inTransitTrips,
      completedTrips,
      cancelledTrips,
      pendingTrips,
      totalFreight,
      totalExpenses,
      totalPayments,
    ] = await Promise.all([
      this.tx.trip.count(),
      this.tx.trip.count({ where: { status: 'IN_TRANSIT' } }),
      this.tx.trip.count({ where: { status: 'COMPLETED' } }),
      this.tx.trip.count({ where: { status: 'CANCELLED' } }),
      this.tx.trip.count({ where: { status: 'PENDING' } }),
      this.tx.trip.aggregate({
        _sum: { freight_amount: true },
      }),
      this.tx.tripExpense.aggregate({
        _sum: { amount: true },
      }),
      this.tx.tripPayment.aggregate({
        _sum: { amount: true },
      }),
    ]);

    const totalProfit = (totalFreight._sum.freight_amount || 0) - (totalExpenses._sum.amount || 0);
    const outstanding = (totalFreight._sum.freight_amount || 0) - (totalPayments._sum.amount || 0);

    return {
      totalTrips,
      inTransit: inTransitTrips,
      completed: completedTrips,
      cancelled: cancelledTrips,
      pending: pendingTrips,
      totalFreight: totalFreight._sum.freight_amount || 0,
      totalExpenses: totalExpenses._sum.amount || 0,
      totalProfit,
      totalPayments: totalPayments._sum.amount || 0,
      outstanding,
    };
  }

  /**
   * Get top clients by trip count and freight.
   */
  async getTopClients(limit = 5) {
    const clients = await this.tx.trip.groupBy({
      by: ['user_id'],
      _count: { trip_id: true },
      _sum: { freight_amount: true },
      orderBy: {
        _count: {
          trip_id: 'desc',
        },
      },
      take: limit,
    });

    // Fetch user details for each client
    const userIds = clients.map((c) => c.user_id);
    const users = await this.tx.user.findMany({
      where: { user_id: { in: userIds } },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.user_id, u]));

    return clients.map((c) => ({
      user: userMap.get(c.user_id),
      tripCount: c._count.trip_id,
      totalFreight: c._sum.freight_amount || 0,
    }));
  }

  /**
   * Get trips by client ID.
   */
  async findByClientId(clientId, filters = {}) {
    const { page = 1, limit = 10 } = filters;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      this.tx.trip.findMany({
        where: { user_id: clientId },
        include: TripInclude,
        skip,
        take: limitNum,
        orderBy: { created_at: 'desc' },
      }),
      this.tx.trip.count({ where: { user_id: clientId } }),
    ]);

    return {
      trips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get trips by driver ID.
   */
  async findByDriverId(driverId, filters = {}) {
    const { page = 1, limit = 10 } = filters;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      this.tx.trip.findMany({
        where: { driver_id: driverId },
        include: TripInclude,
        skip,
        take: limitNum,
        orderBy: { created_at: 'desc' },
      }),
      this.tx.trip.count({ where: { driver_id: driverId } }),
    ]);

    return {
      trips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get trips by vehicle ID.
   */
  async findByVehicleId(vehicleId, filters = {}) {
    const { page = 1, limit = 10 } = filters;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      this.tx.trip.findMany({
        where: { vehicle_id: vehicleId },
        include: TripInclude,
        skip,
        take: limitNum,
        orderBy: { created_at: 'desc' },
      }),
      this.tx.trip.count({ where: { vehicle_id: vehicleId } }),
    ]);

    return {
      trips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get trips by transport owner ID.
   */
  async findByOwnerId(ownerId, filters = {}) {
    const { page = 1, limit = 10 } = filters;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [trips, total] = await Promise.all([
      this.tx.trip.findMany({
        where: { transport_owner_id: ownerId },
        include: TripInclude,
        skip,
        take: limitNum,
        orderBy: { created_at: 'desc' },
      }),
      this.tx.trip.count({ where: { transport_owner_id: ownerId } }),
    ]);

    return {
      trips,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Generate next trip number.
   */
  async generateTripNumber() {
    const year = new Date().getFullYear();
    const prefix = `BTBT-${year}-`;

    const lastTrip = await this.tx.trip.findFirst({
      where: {
        trip_number: {
          startsWith: prefix,
        },
      },
      orderBy: { trip_number: 'desc' },
    });

    let nextNumber = 1;
    if (lastTrip) {
      const lastNumber = parseInt(lastTrip.trip_number.replace(prefix, ''));
      nextNumber = lastNumber + 1;
    }

    return `${prefix}${String(nextNumber).padStart(5, '0')}`;
  }

  /**
   * Get available clients (users with customer role).
   */
  async getAvailableClients(search = '') {
    const where = { role: 'customer' };

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.tx.user.findMany({
      where,
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
      },
      take: 50,
    });
  }

  /**
   * Get available drivers with owner and vehicle details.
   * Used for trip creation wizard — ensures owner-vehicle-driver consistency.
   */
  async getAvailableDrivers(search = '') {
    // The Driver model has no `deleted_at` column, so "non-deleted" is implicit.
    // The canonical active flag is `status` (available / on_trip / inactive);
    // exclude `inactive` drivers so only active records are returned.
    const where = {
      status: { not: 'inactive' },
    };

    if (search) {
      where.OR = [
        { driver_name: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.tx.driver.findMany({
      where,
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        license_number: true,
        status: true,
        transport_owner_id: true,
        current_vehicle_id: true,
        transportOwner: {
          select: {
            owner_id: true,
            owner_name: true,
            company_name: true,
          },
        },
        currentVehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
          },
        },
      },
      take: 500,
    });
  }

  /**
   * Get available vehicles.
   */
  async getAvailableVehicles(search = '') {
    const where = {};

    if (search) {
      where.OR = [
        { vehicle_number: { contains: search, mode: 'insensitive' } },
        { vehicle_name: { contains: search, mode: 'insensitive' } },
        { vehicle_type: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.tx.transportVehicle.findMany({
      where,
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_name: true,
        vehicle_type: true,
        current_status: true,
      },
      take: 50,
    });
  }

  /**
   * Get available transport owners.
   */
  async getAvailableOwners(search = '') {
    // NOTE: The canonical "active" flag for vehicle owners across the app is
    // `status: 'active'` (see VehicleOwnerRepository.findAll / stats). The
    // previous implementation filtered on `is_active`, which is inconsistent
    // with the rest of the codebase and is not reliably present on the
    // `vehicle_owners` table — causing the lookup to return an empty set (or
    // error) and the UI to show "No transport owners found".
    const where = {
      status: 'active',
      deleted_at: null,
    };

    if (search) {
      where.OR = [
        { owner_code: { contains: search, mode: 'insensitive' } },
        { owner_name: { contains: search, mode: 'insensitive' } },
        { company_name: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.tx.vehicleOwner.findMany({
      where,
      select: {
        owner_id: true,
        owner_code: true,
        owner_name: true,
        company_name: true,
        mobile: true,
        city: true,
        status: true,
        owner_type: true,
      },
      orderBy: {
        owner_name: 'asc',
      },
      take: 500,
    });
  }

  /**
   * Get drivers belonging to a specific transport owner.
   * Used for trip creation wizard — ensures owner-vehicle-driver consistency.
   */
  async getDriversByOwner(ownerId, search = '') {
    const where = {
      transport_owner_id: ownerId,
    };

    if (search && search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      where.OR = [
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm, mode: 'insensitive' } },
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { license_number: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    return this.tx.driver.findMany({
      where,
      select: {
        driver_id: true,
        driver_name: true,
        mobile: true,
        license_number: true,
        status: true,
        current_vehicle_id: true,
      },
      orderBy: {
        driver_name: 'asc',
      },
    });
  }
}

module.exports = TripRepository;
