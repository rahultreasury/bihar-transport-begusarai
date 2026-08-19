/**
 * VehicleOwnerRepository
 * Database-only repository for vehicle owner operations.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

/**
 * Retry wrapper for transient Prisma connection errors
 */
async function withRetry(fn, context = 'operation', maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isPrismaConnectionError =
        err?.code === 'P1001' ||
        err?.code === 'P1002' ||
        err?.code === 'P2024' ||
        (err?.message && (
          err.message.includes('Closed') ||
          err.message.includes('Can\'t reach database') ||
          err.message.includes('Connection pool') ||
          err.message.includes('timed out') ||
          err.message.includes('already disconnected')
        ));

      if (isPrismaConnectionError && attempt < maxRetries) {
        console.warn(`[prisma] ${context} attempt ${attempt}/${maxRetries} failed. Retrying...`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

class VehicleOwnerRepository {
  /**
   * Generate next vehicle owner code (VOW000001, VOW000002, etc.)
   */
  async generateOwnerCode(tx = null) {
    const client = tx || prisma;
    const lastOwner = await client.vehicleOwner.findFirst({
      orderBy: { owner_code: 'desc' },
      select: { owner_code: true },
    });

    let nextNum = 1;
    if (lastOwner && lastOwner.owner_code) {
      const match = lastOwner.owner_code.match(/VOW(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    return `VOW${String(nextNum).padStart(6, '0')}`;
  }

  /**
   * Find vehicle owner by mobile number
   */
  async findByMobile(mobile) {
    return await prisma.vehicleOwner.findFirst({
      where: { mobile },
    });
  }

  /**
   * Find vehicle owner by ID with full relations
   */
  async findById(ownerId) {
    return await prisma.vehicleOwner.findUnique({
      where: { owner_id: ownerId },
      include: {
        vehicles: {
          orderBy: { created_at: 'desc' },
        },
        drivers: {
          orderBy: { created_at: 'desc' },
        },
        applications: {
          where: { status: 'pending' },
          orderBy: { created_at: 'desc' },
        },
        _count: {
          select: {
            vehicles: true,
            bookings: true,
            applications: true,
            drivers: true,
          },
        },
      },
    });
  }

  /**
   * List vehicle owners with search, filter, sort, pagination
   */
  async findAll(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      city = '',
      state = '',
      sort_by = 'created_at',
      sort_order = 'desc',
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = { deleted_at: null };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { owner_code: { contains: searchTerm, mode: 'insensitive' } },
        { owner_name: { contains: searchTerm, mode: 'insensitive' } },
        { company_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (state) {
      where.state = { contains: state, mode: 'insensitive' };
    }

    const allowedSortFields = ['owner_code', 'owner_name', 'status', 'created_at', 'city', 'state'];
    const field = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'asc' ? 'asc' : 'desc';

    const result = await withRetry(async () => {
      const [owners, total] = await Promise.all([
        prisma.vehicleOwner.findMany({
          where,
          include: {
            _count: {
              select: {
                vehicles: true,
                bookings: true,
                drivers: true,
              },
            },
          },
          orderBy: { [field]: order },
          skip,
          take,
        }),
        prisma.vehicleOwner.count({ where }),
      ]);
      return { owners, total };
    }, 'findAll vehicle owners');

    return {
      owners: result.owners,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

  /**
   * Create a new vehicle owner
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.vehicleOwner.create({ data });
  }

  /**
   * Update a vehicle owner
   */
  async update(ownerId, data, tx = null) {
    const client = tx || prisma;
    return await client.vehicleOwner.update({
      where: { owner_id: ownerId },
      data,
    });
  }

  /**
   * Soft delete a vehicle owner
   */
  async softDelete(ownerId, tx = null) {
    const client = tx || prisma;
    return await client.vehicleOwner.update({
      where: { owner_id: ownerId },
      data: { deleted_at: new Date() },
    });
  }

  /**
   * Hard delete a vehicle owner
   */
  async hardDelete(ownerId, tx = null) {
    const client = tx || prisma;
    return await client.vehicleOwner.delete({
      where: { owner_id: ownerId },
    });
  }

  /**
   * Find dependency counts for a vehicle owner
   */
  async findDependencyCounts(ownerId) {
    const [vehicles, bookings, applications] = await Promise.all([
      prisma.transportVehicle.count({ where: { owner_id: ownerId } }),
      prisma.booking.count({ where: { vehicle_owner_id: ownerId } }),
      prisma.partnerApplication.count({ where: { vehicle_owner_id: ownerId } }),
    ]);

    return {
      vehicles,
      bookings,
      applications,
      hasDependencies: vehicles > 0 || bookings > 0 || applications > 0,
    };
  }

  /**
   * Get vehicle owner stats
   */
  async getOwnerStats() {
    const [totalOwners, activeOwners, totalVehicles, totalBookings, totalDrivers] = await Promise.all([
      prisma.vehicleOwner.count({ where: { deleted_at: null } }),
      prisma.vehicleOwner.count({ where: { deleted_at: null, status: 'active' } }),
      prisma.transportVehicle.count(),
      prisma.booking.count(),
      prisma.driver.count(),
    ]);

    return {
      totalOwners,
      activeOwners,
      inactiveOwners: totalOwners - activeOwners,
      totalVehicles,
      totalBookings,
      totalDrivers,
    };
  }

  /**
   * Find drivers belonging to a specific vehicle owner (transport owner).
   */
  async findDriversByOwnerId(ownerId, filters = {}) {
    const { page = 1, limit = 20, search = '' } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = { transport_owner_id: ownerId };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
      ];
    }

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
          currentVehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_type: true,
              vehicle_name: true,
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
   * Get vehicles belonging to a specific vehicle owner (transport owner).
   */
  async getOwnerVehicles(ownerId, filters = {}) {
    const { page = 1, limit = 20, search = '' } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = { owner_id: ownerId };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { vehicle_number: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_type: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_name: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [vehicles, total] = await Promise.all([
      prisma.transportVehicle.findMany({
        where,
        include: {
          driver: {
            select: {
              driver_id: true,
              driver_name: true,
              driver_code: true,
              mobile: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.transportVehicle.count({ where }),
    ]);

    return {
      vehicles,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Find partner by ID.
   */
  async findPartnerById(partnerId, tx = null) {
    const client = tx || prisma;
    return await client.partner.findUnique({
      where: { partner_id: partnerId },
      select: { partner_id: true, partner_code: true, partner_name: true },
    });
  }

  /**
   * Find driver by ID.
   */
  async findDriverById(driverId, tx = null) {
    const client = tx || prisma;
    return await client.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true, driver_code: true, driver_name: true, partner_id: true, current_vehicle_id: true },
    });
  }

  /**
   * Create a new vehicle for a specific vehicle owner with atomic driver assignment.
   */
  async createOwnerVehicleWithDriver(ownerId, data, driverId, tx = null) {
    const client = tx || prisma;

    // Check for duplicate vehicle number
    const existing = await client.transportVehicle.findFirst({
      where: { vehicle_number: data.vehicle_number },
    });
    if (existing) {
      const err = new Error('A vehicle with this number already exists');
      err.code = 'VEHICLE_ALREADY_EXISTS';
      err.data = { vehicle_id: existing.vehicle_id };
      throw err;
    }

    // Create vehicle and handle driver assignment in a transaction
    const result = await client.$transaction(async (prismaTx) => {
      // Create the vehicle
      const vehicle = await prismaTx.transportVehicle.create({
        data: {
          ...data,
          owner_id: ownerId,
        },
      });

      // If driver is provided, assign them to the vehicle
      if (driverId) {
        // Clear any existing vehicle assignment for this driver
        const existingVehicle = await prismaTx.transportVehicle.findFirst({
          where: { driver_id: driverId },
        });
        if (existingVehicle) {
          await prismaTx.transportVehicle.update({
            where: { vehicle_id: existingVehicle.vehicle_id },
            data: { driver_id: null },
          });
        }

        // Update driver's current vehicle
        await prismaTx.driver.update({
          where: { driver_id: driverId },
          data: { current_vehicle_id: vehicle.vehicle_id },
        });

        // Update vehicle's driver
        await prismaTx.transportVehicle.update({
          where: { vehicle_id: vehicle.vehicle_id },
          data: { driver_id: driverId },
        });
      }

      return vehicle;
    });

    return result;
  }

  /**
   * Assign a driver to a vehicle atomically.
   */
  async assignDriverToVehicle(vehicleId, driverId, tx = null) {
    const client = tx || prisma;

    // Get current vehicle and driver
    const vehicle = await client.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      select: { vehicle_id: true, driver_id: true, partner_id: true },
    });
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    const driver = await client.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true, current_vehicle_id: true, partner_id: true },
    });
    if (!driver) {
      throw new Error('Driver not found');
    }

    // Phase 7: Driver/Partner consistency check
    if (vehicle.partner_id && driver.partner_id && vehicle.partner_id !== driver.partner_id) {
      const partner = await client.partner.findUnique({
        where: { partner_id: vehicle.partner_id },
        select: { partner_name: true },
      });
      const driverPartner = await client.partner.findUnique({
        where: { partner_id: driver.partner_id },
        select: { partner_name: true },
      });
      throw new Error(
        `Driver belongs to partner "${driverPartner?.partner_name || driver.partner_id}" but vehicle belongs to partner "${partner?.partner_name || vehicle.partner_id}". Driver cannot be assigned to a vehicle operated by a different transport partner.`
      );
    }

    return await client.$transaction(async (prismaTx) => {
      // If vehicle already has a driver, clear that driver's current_vehicle_id
      if (vehicle.driver_id && vehicle.driver_id !== driverId) {
        await prismaTx.driver.update({
          where: { driver_id: vehicle.driver_id },
          data: { current_vehicle_id: null },
        });
      }

      // If driver is assigned to another vehicle, clear that vehicle's driver_id
      if (driver.current_vehicle_id && driver.current_vehicle_id !== vehicleId) {
        await prismaTx.transportVehicle.update({
          where: { vehicle_id: driver.current_vehicle_id },
          data: { driver_id: null },
        });
      }

      // Assign driver to vehicle
      await prismaTx.driver.update({
        where: { driver_id: driverId },
        data: { current_vehicle_id: vehicleId },
      });

      const updatedVehicle = await prismaTx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: { driver_id: driverId },
        include: {
          driver: {
            include: {
              user: {
                select: {
                  first_name: true,
                  last_name: true,
                  phone: true,
                },
              },
            },
          },
          owner: {
            select: {
              owner_id: true,
              owner_name: true,
              company_name: true,
              mobile: true,
            },
          },
        },
      });

      return updatedVehicle;
    });
  }

  /**
   * Remove driver from a vehicle atomically.
   */
  async removeDriverFromVehicle(vehicleId, tx = null) {
    const client = tx || prisma;

    const vehicle = await client.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      select: { vehicle_id: true, driver_id: true },
    });
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    if (!vehicle.driver_id) {
      return vehicle; // No driver to remove
    }

    return await client.$transaction(async (prismaTx) => {
      // Clear driver's current vehicle
      await prismaTx.driver.update({
        where: { driver_id: vehicle.driver_id },
        data: { current_vehicle_id: null },
      });

      // Clear vehicle's driver
      const updatedVehicle = await prismaTx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: { driver_id: null },
        include: {
          driver: {
            include: {
              user: {
                select: {
                  first_name: true,
                  last_name: true,
                  phone: true,
                },
              },
            },
          },
          owner: {
            select: {
              owner_id: true,
              owner_name: true,
              company_name: true,
              mobile: true,
            },
          },
        },
      });

      return updatedVehicle;
    });
  }

  /**
   * Get all vehicles for a specific partner.
   */
  async getPartnerVehicles(partnerId, filters = {}, tx = null) {
    const client = tx || prisma;
    const { page = 1, limit = 20, search = '' } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = { partner_id: partnerId };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { vehicle_number: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_type: { contains: searchTerm, mode: 'insensitive' } },
        { vehicle_name: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [vehicles, total] = await Promise.all([
      client.transportVehicle.findMany({
        where,
        include: {
          driver: {
            include: {
              user: {
                select: {
                  first_name: true,
                  last_name: true,
                  phone: true,
                },
              },
            },
          },
          owner: {
            select: {
              owner_id: true,
              owner_name: true,
              company_name: true,
              mobile: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      client.transportVehicle.count({ where }),
    ]);

    return {
      vehicles,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: total,
        pages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Find a vehicle by vehicle number.
   */
  async findVehicleByNumber(vehicleNumber) {
    return await prisma.transportVehicle.findFirst({
      where: { vehicle_number: vehicleNumber },
    });
  }

  /**
   * Find a single vehicle by ID with owner and driver relations.
   */
  async findVehicleById(vehicleId) {
    return await prisma.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      include: {
        owner: {
          select: {
            owner_id: true,
            owner_name: true,
            company_name: true,
            mobile: true,
            email: true,
            city: true,
            state: true,
          },
        },
        driver: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Update a vehicle by ID.
   */
  async updateVehicle(vehicleId, data, tx = null) {
    const client = tx || prisma;
    return await client.transportVehicle.update({
      where: { vehicle_id: vehicleId },
      data,
    });
  }

  /**
   * Update a driver's current_vehicle_id.
   */
  async updateDriverCurrentVehicle(driverId, vehicleId, tx = null) {
    const client = tx || prisma;
    return await client.driver.update({
      where: { driver_id: driverId },
      data: { current_vehicle_id: vehicleId },
    });
  }

  /**
   * Get bookings for a vehicle owner
   */
  async getOwnerBookings(ownerId, filters = {}) {
    const { page = 1, limit = 20, status = '' } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { vehicle_owner_id: ownerId };
    if (status) {
      where.status = status;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              phone: true,
            },
          },
          driver: {
            select: {
              driver_id: true,
              driver_name: true,
              mobile: true,
            },
          },
          vehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_type: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }
}

module.exports = VehicleOwnerRepository;
