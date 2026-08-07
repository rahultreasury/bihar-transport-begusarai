  /**
 * DriverRepository
 * Database-only repository for driver-related operations.
 * Uses Prisma Client for all database operations.
 * Simplified for market driver model (brokerage - no employee finance tracking).
 */

const { prisma } = require('../config/prisma');

  /**
 * Retry wrapper for transient Prisma connection errors (e.g., pool exhausted, Closed connection).
 * Retries up to 3 times with 500ms delay between attempts.
 * Only retries on PrismaClientKnownRequestError or errors containing 'Closed' in the message.
 */
async function withRetry(fn, context = 'operation', maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isPrismaConnectionError =
        err?.code === 'P1001' || // Can't reach database
        err?.code === 'P1002' || // Timed out
        err?.code === 'P2024' || // Connection pool timeout
        (err?.message && (
          err.message.includes('Closed') ||
          err.message.includes('Can\'t reach database') ||
          err.message.includes('Connection pool') ||
          err.message.includes('timed out') ||
          err.message.includes('already disconnected')
        ));

      if (isPrismaConnectionError && attempt < maxRetries) {
        console.warn(`[prisma] ${context} attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in 500ms...`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

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
   * Find driver by ID with relations.
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
   * Find driver by mobile number.
   */
  async findByMobile(mobile, tx = null) {
    const client = tx || prisma;
    return await client.driver.findFirst({
      where: { mobile: mobile },
    });
  }

  /**
   * Find driver by vehicle number (case-insensitive, normalized).
   * NOTE: vehicle fields are temporary MVP storage on Driver; when a
   * dedicated Vehicle entity is introduced this lookup moves there.
   */
  async findByVehicleNumber(vehicleNumber, tx = null) {
    const client = tx || prisma;
    const normalized = String(vehicleNumber || '').trim().toUpperCase();
    if (!normalized) return null;
    return await client.driver.findFirst({
      where: { vehicle_number: normalized },
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
      sort_by = 'created_at',
      sort_order = 'desc',
      sortBy,
      sortOrder,
    } = filters;

    // Support both camelCase (internal) and snake_case (query params)
    const effectiveSortBy = sortBy || sort_by || 'created_at';
    const effectiveSortOrder = sortOrder || sort_order || 'desc';

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = {};

    // Search across multiple fields
    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { alternate_mobile: { contains: searchTerm } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
        { state: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_number: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_type: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

// Determine sort field (whitelist allowed fields)
    const allowedSortFields = ['driver_code', 'driver_name', 'status', 'created_at', 'total_deliveries'];
    const field = allowedSortFields.includes(effectiveSortBy) ? effectiveSortBy : 'created_at';
    const order = effectiveSortOrder === 'asc' ? 'asc' : 'desc';

    const result = await withRetry(async () => {
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
            // Needed by the Booking Details "Assign Driver / Send Quote" UX,
            // which surfaces each driver's vehicle count in the dropdown.
            _count: {
              select: { transportVehicles: true },
            },
          },
          orderBy: { [field]: order },
          skip,
          take,
        }),
        prisma.driver.count({ where }),
      ]);
      return { drivers, total };
    }, 'findAll drivers');

return {
      drivers: result.drivers,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

  /**
   * List available drivers with their vehicles for the booking assignment UX.
   * Returns each driver plus an array of their vehicles (with availability),
   * so the frontend renders Search → Expandable Driver Card → Assign without
   * a second API call. Supports pagination + search + availability filter.
   *
   * @param {Object} filters { page, limit, search, onlyAvailable }
   * @returns {Promise<{drivers: Array, pagination: Object}>}
   */
  async findAllWithVehicles(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      onlyAvailable = false,
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = {};

    // Only return drivers that can be assigned now (available + active)
    if (onlyAvailable) {
      where.is_available = true;
      where.status = 'available';
    }

    // Search across driver identity fields
    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_number: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const result = await withRetry(async () => {
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
            // Critical missing join from before: the driver's vehicles.
            transportVehicles: {
              select: {
                vehicle_id: true,
                vehicle_number: true,
                vehicle_type: true,
                vehicle_name: true,
                capacity_kg: true,
                capacity_volume: true,
                is_available: true,
                current_status: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          skip,
          take,
        }),
        prisma.driver.count({ where }),
      ]);
      return { drivers, total };
    }, 'findAllWithVehicles drivers');

    return {
      drivers: result.drivers,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

/**
   * Scalable driver lookup for the Booking Assignment picker (10,000+ drivers).
   * Server-side pagination + search + filters + trip stats. Only a bounded
   * page of drivers is ever loaded into memory — never the full table.
   *
   * Each returned driver includes:
   *   - assigned vehicle (first transportVehicle) — one-driver-one-vehicle rule
   *   - todayTrips (bookings created today for this driver)
   *   - lifetime trips (total_deliveries)
   *
   * @param {Object} filters
   *   page, limit, search, status, vehicle_type, min_rating
   * @returns {Promise<{drivers: Array, pagination: Object}>}
   */
  async findAssignable(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      vehicle_type = '',
      min_rating = 0,
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = {};

    // Filter by status (available / on_trip / inactive)
    if (status) {
      where.status = status;
      // Keep is_available in sync with status for the picker's availability
      if (status === 'available') where.is_available = true;
      else if (status === 'on_trip' || status === 'inactive') where.is_available = false;
    }

    // Filter by vehicle type
    if (vehicle_type) {
      where.vehicle_type = { contains: String(vehicle_type).trim(), mode: 'insensitive' };
    }

    // Filter by minimum rating (drivers with rating >= min_rating)
    if (min_rating && Number(min_rating) > 0) {
      where.rating = { gte: Number(min_rating) };
    }

// Server-side search across identity + vehicle fields (indexed on
    // driver_code, mobile, vehicle_number, vehicle_type, driver_name).
    // The driver's permanent vehicle is stored directly on the Driver
    // (vehicle_type / vehicle_number at registration), so we search the
    // denormalized driver fields — no separate assignment-table join.
    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { vehicle_number: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_type: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const result = await withRetry(async () => {
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
            // Today's trips: bookings created today for this driver.
            _count: {
              select: {
                bookings: {
                  where: {
                    created_at: { gte: todayStart },
                  },
                },
              },
            },
            // Linked TransportVehicle (one-driver-one-vehicle) so the picker
            // can surface a real vehicle_id when one exists.
            transportVehicles: {
              select: {
                vehicle_id: true,
                vehicle_number: true,
                vehicle_type: true,
                capacity_kg: true,
                capacity_volume: true,
              },
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
          orderBy: { created_at: 'desc' },
          skip,
          take,
        }),
        prisma.driver.count({ where }),
      ]);
      return { drivers, total };
    }, 'findAssignable drivers');

// Flatten the shape for the picker: expose `vehicle` built from the
    // driver's OWN registered vehicle (vehicle_type / vehicle_number stored at
    // registration — one-driver-one-vehicle). If a TransportVehicle is linked
    // to the driver, we also expose its vehicle_id (so reservations can still
    // hold a real vehicle when available); otherwise vehicle_id is null.
    // No separate assignment-table lookup is consulted.
// `todayTrips` comes from _count.bookings; lifetime trips from total_deliveries.
    const drivers = result.drivers.map((d) => {
      const tv = d.transportVehicles?.[0] || null;
      if (d.vehicle_number) {
        return {
          driver_id: d.driver_id,
          driver_code: d.driver_code,
          driver_name: d.driver_name,
          mobile: d.mobile,
          status: d.status,
          is_available: d.is_available,
          rating: d.rating,
          total_deliveries: d.total_deliveries || 0,
          todayTrips: d._count?.bookings ?? 0,
          vehicle: {
            vehicle_id: tv?.vehicle_id ?? null,
            vehicle_number: d.vehicle_number,
            vehicle_type: d.vehicle_type || tv?.vehicle_type || null,
            capacity_kg: tv?.capacity_kg ?? null,
            capacity_volume: tv?.capacity_volume ?? null,
          },
        };
      }
      // No driver vehicle_number — but a linked TransportVehicle may still exist.
      if (tv) {
        return {
          driver_id: d.driver_id,
          driver_code: d.driver_code,
          driver_name: d.driver_name,
          mobile: d.mobile,
          status: d.status,
          is_available: d.is_available,
          rating: d.rating,
          total_deliveries: d.total_deliveries || 0,
          todayTrips: d._count?.bookings ?? 0,
          vehicle: {
            vehicle_id: tv.vehicle_id,
            vehicle_number: tv.vehicle_number,
            vehicle_type: tv.vehicle_type || null,
            capacity_kg: tv.capacity_kg ?? null,
            capacity_volume: tv.capacity_volume ?? null,
          },
        };
      }
      return {
        driver_id: d.driver_id,
        driver_code: d.driver_code,
        driver_name: d.driver_name,
        mobile: d.mobile,
        status: d.status,
        is_available: d.is_available,
        rating: d.rating,
        total_deliveries: d.total_deliveries || 0,
        todayTrips: d._count?.bookings ?? 0,
        vehicle: null,
      };
    });

    return {
      drivers,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

  /**
   * Get a driver's current status (available / on_trip / inactive).
   */
  async findStatus(driverId, tx = null) {
    const client = tx || prisma;
    return await client.driver.findUnique({
      where: { driver_id: driverId },
      select: { status: true },
    });
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
          delivery: {
            select: {
              current_status: true,
              status_description: true,
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
   * Get driver KPIs for dashboard (simplified - no employee finance).
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

    return {
      total,
      available,
      onTrip,
      inactive,
      todaysTrips,
    };
  }

  /**
   * Record a transaction for a driver (advance, trip_payment, fuel, toll, recovery, other_expense).
   */
  async createTransaction(data) {
    const driver = await prisma.driver.findUnique({
      where: { driver_id: data.driver_id },
      select: { current_balance: true },
    });

    const balanceBefore = driver?.current_balance || 0;
    let balanceAfter = balanceBefore;

    const debitTypes = ['advance', 'fuel_expense', 'toll_expense', 'other_expense'];
    const isDebit = debitTypes.includes(data.transaction_type);

    if (isDebit) {
      balanceAfter = balanceBefore + parseFloat(data.amount);
    } else {
      balanceAfter = balanceBefore - parseFloat(data.amount);
    }

    const transaction = await prisma.driverTransaction.create({
      data: {
        driver_id: data.driver_id,
        transaction_type: data.transaction_type,
        amount: parseFloat(data.amount),
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description: data.description || null,
        reference_type: data.reference_type || null,
        reference_id: data.reference_id ? parseInt(data.reference_id) : null,
        payment_mode: data.payment_mode || 'cash',
        notes: data.notes || null,
        recorded_by: data.recorded_by || null,
      },
    });

    // Update driver balance
    await prisma.driver.update({
      where: { driver_id: data.driver_id },
      data: { current_balance: balanceAfter },
    });

    return transaction;
  }

  /**
   * Get transactions for a driver.
   */
  async getTransactions(driverId, filters = {}) {
    const { page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.driverTransaction.findMany({
        where: { driver_id: driverId },
        orderBy: { transaction_date: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.driverTransaction.count({ where: { driver_id: driverId } }),
    ]);

    const debitAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: { in: ['advance', 'fuel_expense', 'toll_expense', 'other_expense'] } },
      _sum: { amount: true },
    });

    const creditAgg = await prisma.driverTransaction.aggregate({
      where: { driver_id: driverId, transaction_type: { in: ['trip_payment', 'recovery'] } },
      _sum: { amount: true },
    });

    // Get current balance
    const driver = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { current_balance: true },
    });

    return {
      transactions,
      summary: {
        totalDebit: debitAgg._sum.amount || 0,
        totalCredit: creditAgg._sum.amount || 0,
        currentBalance: driver?.current_balance || 0,
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
   * Soft delete a driver (set as inactive).
   */
  async softDelete(driverId, tx = null) {
    const client = tx || prisma;
    return await client.driver.update({
      where: { driver_id: driverId },
      data: { status: 'inactive', is_available: false },
    });
  }

  /**
   * Soft delete multiple drivers in one atomic statement (set as inactive).
   * Used by the bulk-delete endpoint so the frontend sends ONE request.
   */
  async bulkSoftDelete(driverIds, tx = null) {
    const client = tx || prisma;
    return await client.driver.updateMany({
      where: { driver_id: { in: driverIds } },
      data: { status: 'inactive', is_available: false },
    });
  }
}

module.exports = DriverRepository;
