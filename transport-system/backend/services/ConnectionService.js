/**
 * ConnectionService
 * Business logic for connecting orphan records.
 * Handles vehicle-owner-driver connection workflows.
 */

const VehicleOwnerRepository = require('../repositories/VehicleOwnerRepository');

class ConnectionService {
  constructor() {
    this.repo = new VehicleOwnerRepository();
  }

  /**
   * Connect a vehicle to an owner and driver.
   * Validates that the driver belongs to the same owner as the vehicle.
   */
  async connectVehicle(vehicleId, ownerId, driverId) {
    // Validate vehicle exists
    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Validate owner exists
    const owner = await this.repo.findById(ownerId);
    if (!owner) {
      throw new Error('Transport Owner not found');
    }

    // Driver is required
    if (!driverId) {
      throw new Error('Driver is required to connect a vehicle');
    }

    // Validate driver exists and belongs to the same owner
    const driver = await this.repo.findDriverById(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }
    if (driver.transport_owner_id !== ownerId) {
      throw new Error(`Driver belongs to a different transport owner. Vehicle and driver must belong to the same owner.`);
    }

    // Connect vehicle to owner and driver atomically
    const result = await this.repo.createOwnerVehicleWithDriver(ownerId, {
      ...vehicle,
      owner_id: ownerId,
      driver_id: driverId,
    }, driverId);

    return result;
  }

  /**
   * Connect a driver to an owner.
   * For DRIVER_OWNER type, the driver becomes the owner.
   */
  async connectDriver(driverId, ownerId, isDriverOwner = false) {
    // Validate driver exists
    const driver = await this.repo.findDriverById(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }

    // Validate owner exists
    const owner = await this.repo.findById(ownerId);
    if (!owner) {
      throw new Error('Transport Owner not found');
    }

    if (isDriverOwner) {
      // For DRIVER_OWNER, validate owner type
      if (owner.owner_type !== 'DRIVER_OWNER') {
        throw new Error('Owner must be of type DRIVER_OWNER for driver-owner connection');
      }
    }

    // Update driver's transport owner
    const { prisma } = require('../config/prisma');
    const updatedDriver = await prisma.driver.update({
      where: { driver_id: driverId },
      data: { transport_owner_id: ownerId },
      include: {
        transportOwner: {
          select: {
            owner_id: true,
            owner_name: true,
            owner_type: true,
          },
        },
      },
    });

    return updatedDriver;
  }

  /**
   * Get orphan vehicles (vehicles without owner or driver).
   */
  async getOrphanVehicles() {
    const { prisma } = require('../config/prisma');
    
    const vehicles = await prisma.transportVehicle.findMany({
      where: {
        OR: [
          { owner_id: null },
          { driver_id: null },
        ],
      },
      include: {
        owner: {
          select: {
            owner_id: true,
            owner_name: true,
            owner_type: true,
          },
        },
        driver: {
          select: {
            driver_id: true,
            driver_name: true,
            transport_owner_id: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return vehicles;
  }

  /**
   * Get orphan drivers (drivers without owner).
   */
  async getOrphanDrivers() {
    const { prisma } = require('../config/prisma');
    
    const drivers = await prisma.driver.findMany({
      where: {
        transport_owner_id: null,
      },
      include: {
        transportOwner: {
          select: {
            owner_id: true,
            owner_name: true,
            owner_type: true,
          },
        },
        currentVehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_type: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return drivers;
  }

  /**
   * Get orphan owners (owners without vehicles or drivers).
   */
  async getOrphanOwners() {
    const { prisma } = require('../config/prisma');
    
    const owners = await prisma.vehicleOwner.findMany({
      where: {
        deleted_at: null,
      },
      include: {
        _count: {
          select: {
            vehicles: true,
            drivers: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Filter owners with no vehicles AND no drivers
    return owners.filter(owner => 
      owner._count.vehicles === 0 && owner._count.drivers === 0
    );
  }

  /**
   * Get connection statistics.
   */
  async getConnectionStats() {
    const { prisma } = require('../config/prisma');
    
    const [
      totalVehicles,
      vehiclesWithoutOwner,
      vehiclesWithoutDriver,
      totalDrivers,
      driversWithoutOwner,
      totalOwners,
      ownersWithoutVehicles,
      ownersWithoutDrivers,
    ] = await Promise.all([
      prisma.transportVehicle.count(),
      prisma.transportVehicle.count({ where: { owner_id: null } }),
      prisma.transportVehicle.count({ where: { driver_id: null } }),
      prisma.driver.count(),
      prisma.driver.count({ where: { transport_owner_id: null } }),
      prisma.vehicleOwner.count({ where: { deleted_at: null } }),
      prisma.vehicleOwner.count({ 
        where: { 
          deleted_at: null,
          vehicles: { none: {} },
        } 
      }),
      prisma.vehicleOwner.count({ 
        where: { 
          deleted_at: null,
          drivers: { none: {} },
        } 
      }),
    ]);

    return {
      totalVehicles,
      vehiclesWithoutOwner,
      vehiclesWithoutDriver,
      totalDrivers,
      driversWithoutOwner,
      totalOwners,
      ownersWithoutVehicles,
      ownersWithoutDrivers,
    };
  }
}

module.exports = ConnectionService;
