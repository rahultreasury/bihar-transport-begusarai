/**
 * VehicleOwnerRepository
 * Database-only repository for vehicle owner operations.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');
const {
  normalizeMobile,
  normalizeIdentifier,
  normalizeVehicleNumber,
  parsePagination,
} = require('../utils/resourceValidation');

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
    // Order NULLs LAST. PostgreSQL returns NULLs first for DESC ordering,
    // so a naive orderBy: { owner_code: 'desc' } would always pick a NULL
    // row and keep regenerating VOW000001, colliding with the unique
    // constraint. Use a raw query with explicit NULLS LAST so the highest
    // existing non-null code is always used as the seed.
    //
    // The delegate fallback exists for the same reason as the driver one:
    // unit-double clients without $queryRaw still get a correct next code.
    let lastCode = null;
    if (typeof client.$queryRaw === 'function') {
      const rows = await client.$queryRaw`
        SELECT owner_code
        FROM vehicle_owners
        WHERE owner_code IS NOT NULL
        ORDER BY owner_code DESC
        LIMIT 1
      `;
      lastCode = rows[0] && rows[0].owner_code;
    } else if (typeof client.vehicleOwner?.findFirst === 'function') {
      const row = await client.vehicleOwner.findFirst({
        where: { owner_code: { not: null } },
        orderBy: { owner_code: 'desc' },
      });
      lastCode = row && row.owner_code;
    }

    let nextNum = 1;
    if (lastCode) {
      const match = String(lastCode).match(/VOW(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    return `VOW${String(nextNum).padStart(6, '0')}`;
  }

  /**
   * Find vehicle owner by mobile number
   */
  async findByMobile(mobile, excludeOwnerId = null, tx = null) {
    const client = tx || prisma;
    const canonical = normalizeMobile(mobile);
    if (!canonical) return null;
    const excludeId = Number.isInteger(Number(excludeOwnerId))
      ? Number(excludeOwnerId)
      : -1;

    if (typeof client.$queryRaw === 'function') {
      const rows = await client.$queryRaw`
        SELECT *
        FROM vehicle_owners
        WHERE owner_id <> ${excludeId}
          AND deleted_at IS NULL
          AND (
            CASE
              WHEN length(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')) = 12
               AND left(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 2) = '91'
                THEN substr(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 3)
              WHEN length(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')) = 11
               AND left(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 1) = '0'
                THEN substr(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 2)
              ELSE regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')
            END
          ) = ${canonical}
        ORDER BY owner_id ASC
        LIMIT 1
      `;
      return rows[0] || null;
    }

    return await client.vehicleOwner.findFirst({
      where: { owner_id: { not: excludeId }, mobile: canonical, deleted_at: null },
    });
  }

  /**
   * Find vehicle owner by ID with full relations
   */
  async findById(ownerId) {
    return await prisma.vehicleOwner.findUnique({
      where: { owner_id: ownerId },
      include: {
        linkedPartner: true,
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

    const { page: parsedPage, limit: take, skip } = parsePagination({ page, limit }, {
      defaultLimit: 20,
      maxLimit: 100,
    });

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
        page: parsedPage,
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

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
   * Create a new vehicle owner
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.vehicleOwner.create({ data });
  }

  /**
   * Create a VehicleOwner and optionally link/create a Driver atomically.
   * Used for DRIVER_OWNER type owners.
   */
  async createOwnerWithDriver(ownerData, driverId = null, driverData = null, tx = null) {
    const client = tx || prisma;

    return await client.$transaction(async (prismaTx) => {
      // Concurrency-safe duplicate owner re-check. The service already did a
      // pre-flight read; this closes the window between that read and the
      // insert. Only run the raw comparison when the client supports it so
      // lightweight unit doubles keep working (the DB trigger is the final
      // guard in production).
      if (typeof prismaTx.$queryRaw === 'function') {
        const duplicateOwner = await this.findByMobile(ownerData.mobile, null, prismaTx);
        if (duplicateOwner) {
          const err = new Error('A vehicle owner with this mobile number already exists');
          err.code = 'VEHICLE_OWNER_ALREADY_EXISTS';
          err.data = {
            owner_id: duplicateOwner.owner_id,
            owner_name: duplicateOwner.owner_name,
            owner_code: duplicateOwner.owner_code,
          };
          throw err;
        }
      }

      // Generate the code inside the transaction unless the caller supplied
      // one, so concurrent registrations serialize on the same seed.
      const ownerCode = ownerData.owner_code || await this.generateOwnerCode(prismaTx);

      // Create the owner
      const owner = await prismaTx.vehicleOwner.create({
        data: { ...ownerData, owner_code: ownerCode },
      });

      let linkedDriverId = null;

      if (driverId) {
        // Link existing driver
        const driver = await prismaTx.driver.findUnique({
          where: { driver_id: driverId },
          select: { driver_id: true, transport_owner_id: true, status: true },
        });
        if (!driver) {
          const err = new Error('Driver not found');
          err.code = 'DRIVER_NOT_FOUND';
          throw err;
        }
        if (driver.transport_owner_id && driver.transport_owner_id !== owner.owner_id) {
          const err = new Error('Driver is already linked to another transport owner');
          err.code = 'DRIVER_OWNER_MISMATCH';
          throw err;
        }
        if (driver.status === 'inactive') {
          const err = new Error('Driver is not active');
          err.code = 'DRIVER_INACTIVE';
          throw err;
        }

        await prismaTx.driver.update({
          where: { driver_id: driverId },
          data: { transport_owner_id: owner.owner_id },
        });
        linkedDriverId = driverId;
      } else if (driverData) {
        // Create new driver. Re-check inside the transaction with canonical
        // comparisons so concurrent owner+driver registrations cannot create
        // two drivers for the same mobile/licence.
        const duplicateMobile = await this.findDriverByMobile(driverData.mobile, prismaTx);
        if (duplicateMobile) {
          const err = new Error('A driver with this mobile number already exists');
          err.code = 'DRIVER_ALREADY_EXISTS';
          err.data = { driver_id: duplicateMobile.driver_id };
          throw err;
        }
        if (driverData.license_number) {
          const duplicateLicense = await this.findDriverByLicenseNumber(driverData.license_number, null, prismaTx);
          if (duplicateLicense) {
            const err = new Error('A driver with this licence number already exists');
            err.code = 'DRIVER_LICENSE_EXISTS';
            err.data = { driver_id: duplicateLicense.driver_id };
            throw err;
          }
        }

        let user = await prismaTx.user.findUnique({ where: { phone: driverData.mobile } });
        if (!user) {
          const bcrypt = require('bcryptjs');
          const defaultPassword = 'driver123';
          const password_hash = await bcrypt.hash(defaultPassword, 10);

          user = await prismaTx.user.create({
            data: {
              first_name: driverData.driver_name.split(' ')[0] || driverData.driver_name,
              last_name: driverData.driver_name.split(' ').slice(1).join(' ') || '',
              email: `${driverData.mobile}@driver.bihar-transport.com`,
              phone: driverData.mobile,
              password_hash,
              role: 'driver',
            },
          });
        }

        const driverCode = await this.generateDriverCode(prismaTx);

        const driver = await prismaTx.driver.create({
          data: {
            driver_code: driverCode,
            user_id: user.user_id,
            driver_name: driverData.driver_name,
            mobile: driverData.mobile,
            alternate_mobile: driverData.alternate_mobile || null,
            license_number: driverData.license_number || null,
            license_expiry: driverData.license_expiry || null,
            license_class: driverData.license_class || null,
            city: driverData.city || null,
            state: driverData.state || 'Bihar',
            address: driverData.address || null,
            transport_owner_id: owner.owner_id,
            status: 'available',
            profile_image: driverData.profile_image || null,
            is_available: true,
            is_verified: false,
          },
        });

        await prismaTx.driverTimeline.create({
          data: {
            driver_id: driver.driver_id,
            event_type: 'driver_created',
            description: `Driver ${driverData.driver_name} registered with code ${driverCode}`,
          },
        });

        linkedDriverId = driver.driver_id;
      }

      return { owner, linkedDriverId };
    });
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
   * Find dependency counts for a vehicle owner.
   *
   * `hasDependencies` blocks deletion when operational resources would be
   * orphaned. Historical rows (bookings, trips, vehicle hires) are counted
   * for visibility/audit but do NOT block a soft delete because a soft delete
   * preserves them and their owner link.
   */
  async findDependencyCounts(ownerId) {
    const [
      vehicles,
      drivers,
      applications,
      bookings,
      trips,
      vehicleHires,
      activeTrips,
    ] = await Promise.all([
      prisma.transportVehicle.count({ where: { owner_id: ownerId } }),
      prisma.driver.count({ where: { transport_owner_id: ownerId } }),
      prisma.partnerApplication.count({ where: { vehicle_owner_id: ownerId } }),
      prisma.booking.count({ where: { vehicle_owner_id: ownerId } }),
      prisma.trip.count({ where: { transport_owner_id: ownerId } }),
      prisma.vehicleHire.count({ where: { vendor_id: ownerId } }),
      prisma.trip.count({
        where: {
          transport_owner_id: ownerId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      }),
    ]);

    const hasDependencies = vehicles > 0 || drivers > 0 || applications > 0 || activeTrips > 0;

    return {
      vehicles,
      drivers,
      applications,
      bookings,
      trips,
      vehicleHires,
      activeTrips,
      hasDependencies,
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
    const { search = '' } = filters;
    const { page: parsedPage, limit: take, skip } = parsePagination(filters, {
      defaultLimit: 20,
      maxLimit: 100,
    });

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
        page: parsedPage,
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
    const { search = '' } = filters;
    const { page: parsedPage, limit: take, skip } = parsePagination(filters, {
      defaultLimit: 20,
      maxLimit: 100,
    });

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
        page: parsedPage,
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
      // transport_owner_id MUST be selected: VehicleOwnerService.createOwnerVehicle
      // compares driver.transport_owner_id against the owner id to enforce that
      // the vehicle and driver belong to the same owner. Without it the field is
      // undefined and every legitimate owner-scoped vehicle creation fails with
      // "Driver belongs to a different transport owner".
      select: { driver_id: true, driver_code: true, driver_name: true, partner_id: true, current_vehicle_id: true, transport_owner_id: true },
    });
  }

  /**
   * Find a driver by mobile number, optionally within a transaction.
   * Compares canonical 10-digit forms so legacy formatted values collide.
   */
  async findDriverByMobile(mobile, tx = null) {
    const client = tx || prisma;
    const canonical = normalizeMobile(mobile);
    if (!canonical) return null;

    if (typeof client.$queryRaw === 'function') {
      const rows = await client.$queryRaw`
        SELECT *
        FROM drivers
        WHERE (
          CASE
            WHEN length(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')) = 12
             AND left(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 2) = '91'
              THEN substr(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 3)
            WHEN length(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')) = 11
             AND left(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 1) = '0'
              THEN substr(regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g'), 2)
            ELSE regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g')
          END
        ) = ${canonical}
        ORDER BY driver_id ASC
        LIMIT 1
      `;
      return rows[0] || null;
    }

    return await client.driver.findFirst({ where: { mobile: canonical } });
  }

  /**
   * Find a driver by licence number, optionally excluding one row.
   */
  async findDriverByLicenseNumber(licenseNumber, excludeDriverId = null, tx = null) {
    const client = tx || prisma;
    const canonical = normalizeIdentifier(licenseNumber);
    if (!canonical) return null;
    const excludeId = Number.isInteger(Number(excludeDriverId))
      ? Number(excludeDriverId)
      : -1;

    if (typeof client.$queryRaw === 'function') {
      const rows = await client.$queryRaw`
        SELECT *
        FROM drivers
        WHERE driver_id <> ${excludeId}
          AND license_number IS NOT NULL
          AND regexp_replace(UPPER(license_number), '[^A-Z0-9]', '', 'g') = ${canonical}
        ORDER BY driver_id ASC
        LIMIT 1
      `;
      return rows[0] || null;
    }

    return await client.driver.findFirst({
      where: {
        driver_id: { not: excludeId },
        license_number: { equals: canonical, mode: 'insensitive' },
      },
    });
  }

  /**
   * Find drivers linked to a specific vehicle owner via transport_owner_id.
   */
  async findDriverByOwnerId(ownerId, tx = null) {
    const client = tx || prisma;
    return await client.driver.findMany({
      where: { transport_owner_id: ownerId },
      select: { driver_id: true, driver_name: true, mobile: true, current_vehicle_id: true },
    });
  }

  /**
   * Create a new vehicle for a specific vehicle owner with atomic driver assignment.
   */
  async createOwnerVehicleWithDriver(ownerId, data, driverId, tx = null) {
    const client = tx || prisma;

    // Create vehicle and handle driver assignment in a transaction.
    return await client.$transaction(async (prismaTx) => {
      // Serialise duplicate-number checks for the same registration number.
      if (typeof prismaTx.$queryRaw === 'function') {
        await prismaTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.vehicle_number})::bigint)`;
      }

      // Check for duplicate vehicle number inside the transaction so two
      // concurrent registrations cannot both pass a pre-flight read.
      const existing = await this.findVehicleByNumber(data.vehicle_number, null, prismaTx);
      if (existing) {
        const err = new Error('A vehicle with this number already exists');
        err.code = 'VEHICLE_ALREADY_EXISTS';
        err.data = { vehicle_id: existing.vehicle_id };
        throw err;
      }

      // Validate the driver belongs to the owner inside the transaction so a
      // concurrent owner change cannot slip a mismatched pair through.
      if (driverId) {
        const driver = await prismaTx.driver.findUnique({
          where: { driver_id: driverId },
          select: { driver_id: true, transport_owner_id: true, status: true },
        });
        if (!driver) {
          const err = new Error('Driver not found');
          err.code = 'DRIVER_NOT_FOUND';
          throw err;
        }
        if (driver.transport_owner_id !== ownerId) {
          const err = new Error('Driver belongs to a different transport owner. Vehicle and driver must belong to the same owner.');
          err.code = 'DRIVER_OWNER_MISMATCH';
          throw err;
        }
      }

      // Create the vehicle
      const vehicle = await prismaTx.transportVehicle.create({
        data: {
          ...data,
          owner_id: ownerId,
        },
      });

      let finalVehicle = vehicle;

      // If driver is provided, assign them to the vehicle
      if (driverId) {
        // Clear any existing vehicle assignment for this driver
        const existingVehicle = await prismaTx.transportVehicle.findFirst({
          where: { driver_id: driverId, vehicle_id: { not: vehicle.vehicle_id } },
        });
        if (existingVehicle) {
          await prismaTx.transportVehicle.update({
            where: { vehicle_id: existingVehicle.vehicle_id },
            data: { driver_id: null, is_available: true, current_status: 'available' },
          });
          await prismaTx.vehicleAssignment.updateMany({
            where: { vehicle_id: existingVehicle.vehicle_id, driver_id: driverId, status: 'active' },
            data: { unassigned_at: new Date(), status: 'inactive' },
          });
        }

        // Update driver's current vehicle
        await prismaTx.driver.update({
          where: { driver_id: driverId },
          data: { current_vehicle_id: vehicle.vehicle_id },
        });

        // Update vehicle's driver
        finalVehicle = await prismaTx.transportVehicle.update({
          where: { vehicle_id: vehicle.vehicle_id },
          data: { driver_id: driverId, is_available: false },
        });

        await prismaTx.vehicleAssignment.create({
          data: {
            vehicle_id: vehicle.vehicle_id,
            driver_id: driverId,
            status: 'active',
          },
        });
      }

      return finalVehicle;
    });
  }

  /**
   * Assign a driver to a vehicle atomically.
   */
  async assignDriverToVehicle(vehicleId, driverId, tx = null) {
    const client = tx || prisma;

    return await client.$transaction(async (prismaTx) => {
      // Serialise concurrent assignments. Vehicle first, then driver, so every
      // caller acquires the locks in the same order.
      if (typeof prismaTx.$queryRaw === 'function') {
        await prismaTx.$queryRaw`SELECT vehicle_id FROM transport_vehicles WHERE vehicle_id = ${vehicleId} FOR UPDATE`;
        await prismaTx.$queryRaw`SELECT driver_id FROM drivers WHERE driver_id = ${driverId} FOR UPDATE`;
      }

      // Re-read both rows inside the transaction. The previous version read
      // them before opening the transaction, so two concurrent requests could
      // both pass validation and leave the loser's pointer stale.
      const vehicle = await prismaTx.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        select: {
          vehicle_id: true,
          driver_id: true,
          partner_id: true,
          owner_id: true,
          current_status: true,
        },
      });
      if (!vehicle) {
        const err = new Error('Vehicle not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      const driver = await prismaTx.driver.findUnique({
        where: { driver_id: driverId },
        select: {
          driver_id: true,
          current_vehicle_id: true,
          partner_id: true,
          transport_owner_id: true,
          status: true,
        },
      });
      if (!driver) {
        const err = new Error('Driver not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      // A vehicle flagged unavailable/on-trip/maintenance must not be
      // assigned through the direct API. Legacy rows with a null status are
      // allowed (they predate the status column).
      if (['on_trip', 'maintenance', 'inactive'].includes(vehicle.current_status)) {
        const err = new Error(
          `This vehicle is currently ${String(vehicle.current_status).replace(/_/g, ' ')} and cannot be assigned.`
        );
        err.code = 'VEHICLE_NOT_ASSIGNABLE';
        throw err;
      }

      if (driver.status === 'inactive') {
        const err = new Error('This driver is inactive and cannot be assigned a vehicle.');
        err.code = 'DRIVER_INACTIVE';
        throw err;
      }

      // A driver on an operational trip cannot be moved to a different
      // vehicle mid-trip.
      if (typeof prismaTx.trip?.findFirst === 'function') {
        const { getOperationalActiveTripWhere } = require('../utils/operationalTripStatus');
        const activeTrip = await prismaTx.trip.findFirst({
          where: {
            driver_id: Number(driverId),
            ...getOperationalActiveTripWhere(),
          },
          select: { trip_id: true },
        });
        if (activeTrip && Number(driver.current_vehicle_id) !== Number(vehicleId)) {
          const err = new Error(
            'This driver has an active trip and cannot be assigned a different vehicle until the trip is completed or cancelled.'
          );
          err.code = 'DRIVER_HAS_ACTIVE_TRIP';
          throw err;
        }
      }

      // Idempotent: nothing to change.
      if (vehicle.driver_id === driverId && driver.current_vehicle_id === vehicleId) {
        return prismaTx.transportVehicle.findUnique({
          where: { vehicle_id: vehicleId },
          include: {
            driver: {
              include: {
                user: { select: { first_name: true, last_name: true, phone: true } },
              },
            },
            owner: {
              select: { owner_id: true, owner_name: true, company_name: true, mobile: true },
            },
          },
        });
      }

      // Phase 7: Driver/Partner consistency check
      if (vehicle.partner_id && driver.partner_id && vehicle.partner_id !== driver.partner_id) {
        const partner = await prismaTx.partner.findUnique({
          where: { partner_id: vehicle.partner_id },
          select: { partner_name: true },
        });
        const driverPartner = await prismaTx.partner.findUnique({
          where: { partner_id: driver.partner_id },
          select: { partner_name: true },
        });
        const err = new Error(
          `Driver belongs to partner "${driverPartner?.partner_name || driver.partner_id}" but vehicle belongs to partner "${partner?.partner_name || vehicle.partner_id}". Driver cannot be assigned to a vehicle operated by a different transport partner.`
        );
        err.code = 'DRIVER_PARTNER_MISMATCH';
        throw err;
      }

      // CRITICAL: Vehicle/Owner/Driver consistency check
      // A vehicle and its driver must belong to the same transport owner
      if (vehicle.owner_id && driver.transport_owner_id && vehicle.owner_id !== driver.transport_owner_id) {
        const vehicleOwner = await prismaTx.vehicleOwner.findUnique({
          where: { owner_id: vehicle.owner_id },
          select: { owner_name: true },
        });
        const driverOwner = await prismaTx.vehicleOwner.findUnique({
          where: { owner_id: driver.transport_owner_id },
          select: { owner_name: true },
        });
        const err = new Error(
          `Driver belongs to transport owner "${driverOwner?.owner_name || driver.transport_owner_id}" but vehicle belongs to "${vehicleOwner?.owner_name || vehicle.owner_id}". Driver cannot be assigned to a vehicle owned by a different transport owner.`
        );
        err.code = 'DRIVER_OWNER_MISMATCH';
        throw err;
      }

      // If vehicle already has a driver, clear that driver's current_vehicle_id
      if (vehicle.driver_id && vehicle.driver_id !== driverId) {
        await prismaTx.driver.update({
          where: { driver_id: vehicle.driver_id },
          data: { current_vehicle_id: null },
        });
        await prismaTx.vehicleAssignment.updateMany({
          where: { vehicle_id: vehicleId, driver_id: vehicle.driver_id, status: 'active' },
          data: { unassigned_at: new Date(), status: 'inactive' },
        });
      }

      // If driver is assigned to another vehicle, clear that vehicle's driver_id
      if (driver.current_vehicle_id && driver.current_vehicle_id !== vehicleId) {
        await prismaTx.transportVehicle.update({
          where: { vehicle_id: driver.current_vehicle_id },
          data: { driver_id: null, is_available: true, current_status: 'available' },
        });
        await prismaTx.vehicleAssignment.updateMany({
          where: { vehicle_id: driver.current_vehicle_id, driver_id: driverId, status: 'active' },
          data: { unassigned_at: new Date(), status: 'inactive' },
        });
      }

      // Assign driver to vehicle
      await prismaTx.driver.update({
        where: { driver_id: driverId },
        data: { current_vehicle_id: vehicleId },
      });

      const updatedVehicle = await prismaTx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: { driver_id: driverId, is_available: false },
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

      // Record assignment history so the audit trail matches the state.
      await prismaTx.vehicleAssignment.create({
        data: { vehicle_id: vehicleId, driver_id: driverId, status: 'active' },
      });

      return updatedVehicle;
    });
  }

  /**
   * Remove driver from a vehicle atomically.
   */
  async removeDriverFromVehicle(vehicleId, tx = null) {
    const client = tx || prisma;

    return await client.$transaction(async (prismaTx) => {
      if (typeof prismaTx.$queryRaw === 'function') {
        await prismaTx.$queryRaw`SELECT vehicle_id FROM transport_vehicles WHERE vehicle_id = ${vehicleId} FOR UPDATE`;
      }

      const vehicle = await prismaTx.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        select: {
          vehicle_id: true,
          driver_id: true,
          current_status: true,
        },
      });
      if (!vehicle) {
        const err = new Error('Vehicle not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      if (!vehicle.driver_id) {
        return prismaTx.transportVehicle.findUnique({
          where: { vehicle_id: vehicleId },
          include: {
            driver: {
              include: {
                user: {
                  select: { first_name: true, last_name: true, phone: true },
                },
              },
            },
            owner: {
              select: { owner_id: true, owner_name: true, company_name: true, mobile: true },
            },
          },
        });
      }

      // Clear driver's current vehicle
      await prismaTx.driver.update({
        where: { driver_id: vehicle.driver_id },
        data: { current_vehicle_id: null },
      });

      // Close the active assignment-history row.
      await prismaTx.vehicleAssignment.updateMany({
        where: { vehicle_id: vehicleId, driver_id: vehicle.driver_id, status: 'active' },
        data: { unassigned_at: new Date(), status: 'inactive' },
      });

      // Clear vehicle's driver. Keep an on-trip vehicle's operational status
      // untouched so the trip state remains the source of truth.
      const updatedVehicle = await prismaTx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: {
          driver_id: null,
          ...(vehicle.current_status === 'on_trip'
            ? {}
            : { is_available: true, current_status: 'available' }),
        },
        include: {
          driver: {
            include: {
              user: {
                select: { first_name: true, last_name: true, phone: true },
              },
            },
          },
          owner: {
            select: { owner_id: true, owner_name: true, company_name: true, mobile: true },
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
    const { search = '' } = filters;
    const { page: parsedPage, limit: take, skip } = parsePagination(filters, {
      defaultLimit: 20,
      maxLimit: 100,
    });

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
        page: parsedPage,
        limit: take,
        total: total,
        pages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Find a vehicle by vehicle number.
   */
  async findVehicleByNumber(vehicleNumber, excludeVehicleId = null, tx = null) {
    const client = tx || prisma;
    const canonical = normalizeVehicleNumber(vehicleNumber);
    if (!canonical) return null;
    const excludeId = Number.isInteger(Number(excludeVehicleId))
      ? Number(excludeVehicleId)
      : -1;

    if (typeof client.$queryRaw === 'function') {
      const rows = await client.$queryRaw`
        SELECT *
        FROM transport_vehicles
        WHERE vehicle_id <> ${excludeId}
          AND regexp_replace(UPPER(COALESCE(vehicle_number, '')), '[^A-Z0-9]', '', 'g') = ${canonical}
        ORDER BY vehicle_id ASC
        LIMIT 1
      `;
      return rows[0] || null;
    }

    return await client.transportVehicle.findFirst({
      where: { vehicle_id: { not: excludeId }, vehicle_number: canonical },
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
   * Create a standalone vehicle (without owner).
   */
  async createStandaloneVehicle(data, tx = null) {
    const client = tx || prisma;

    // Check for duplicate vehicle number on its canonical form.
    const existing = await this.findVehicleByNumber(data.vehicle_number, null, tx);
    if (existing) {
      const err = new Error('A vehicle with this number already exists');
      err.code = 'VEHICLE_ALREADY_EXISTS';
      err.data = { vehicle_id: existing.vehicle_id };
      throw err;
    }

    // Create vehicle without owner
    const vehicle = await client.transportVehicle.create({
      data: {
        ...data,
        owner_id: null,
      },
    });

    return vehicle;
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
   * Update a vehicle's owner_id with full validation inside a transaction.
   * Checks that the new owner exists, is active, and that any assigned driver
   * does not have a conflicting transport_owner_id.
   */
  async updateVehicleOwnerValidated(vehicleId, newOwnerId, tx = null) {
    const client = tx || prisma;

    return await client.$transaction(async (prismaTx) => {
      // Get current vehicle with assigned driver
      const vehicle = await prismaTx.transportVehicle.findUnique({
        where: { vehicle_id: vehicleId },
        include: {
          driver: {
            select: {
              driver_id: true,
              driver_name: true,
              transport_owner_id: true,
            },
          },
        },
      });

      if (!vehicle) {
        throw new Error('Vehicle not found');
      }

      // Validate new owner exists and is active
      const newOwner = await prismaTx.vehicleOwner.findUnique({
        where: { owner_id: newOwnerId },
        select: { owner_id: true, status: true, is_active: true },
      });

      if (!newOwner) {
        throw new Error('Transport Owner not found');
      }
      if (newOwner.status !== 'active' || !newOwner.is_active) {
        throw new Error('Transport Owner is not active');
      }

      // CRITICAL: If vehicle has an assigned driver, validate that the driver
      // belongs to the new owner. A vehicle and its driver must belong to the same owner.
      if (vehicle.driver && vehicle.driver.transport_owner_id !== newOwnerId) {
        const driverOwner = await prismaTx.vehicleOwner.findUnique({
          where: { owner_id: vehicle.driver.transport_owner_id },
          select: { owner_name: true },
        });
        const newOwnerName = await prismaTx.vehicleOwner.findUnique({
          where: { owner_id: newOwnerId },
          select: { owner_name: true },
        });
        throw new Error(
          `Cannot change vehicle owner: assigned driver ${vehicle.driver.driver_name} belongs to "${driverOwner?.owner_name || vehicle.driver.transport_owner_id}". ` +
          `Vehicle can only be assigned to "${newOwnerName?.owner_name || newOwnerId}". ` +
          `Reassign the driver first or choose a different owner.`
        );
      }

      // Perform the ownership update
      return await prismaTx.transportVehicle.update({
        where: { vehicle_id: vehicleId },
        data: { owner_id: newOwnerId },
      });
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
    const { status = '' } = filters;
    const { page: parsedPage, limit: take, skip } = parsePagination(filters, {
      defaultLimit: 20,
      maxLimit: 100,
    });

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
        take,
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: {
        page: parsedPage,
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    };
  }
}

module.exports = VehicleOwnerRepository;
