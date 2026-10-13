/**
 * TransportResourceRepository
 * Transactional combined registration of Transport Owner, Driver, and Vehicle.
 * All operations run inside a single Prisma $transaction so partial failures
 * roll back completely — no orphaned owners/drivers/vehicles.
 */

const { prisma } = require('../config/prisma');
const bcrypt = require('bcryptjs');

class TransportResourceRepository {
  /**
   * Register transport resources (owner, driver, vehicle) in a single transaction.
   *
   * @param {Object} payload
   * @param {Object|null} payload.owner - Owner data (owner_name, mobile, city, owner_type, ...)
   * @param {Object|null} payload.driver - Driver data (driver_name, mobile, license_number, vehicle_type, vehicle_number, transport_owner_id, is_self_owner, ...)
   * @param {Object|null} payload.vehicle - Vehicle data (vehicle_number, vehicle_type, vehicle_name, owner_id, driver_id, assign_owner_driver, ...)
   * @param {number|null} payload.owner_context_id - Pre-selected owner ID (if owner not being created)
   * @param {number|null} payload.driver_context_id - Pre-selected driver ID (if driver not being created)
   * @returns {Promise<Object>} { owner_id?, driver_id?, vehicle_id?, owner_code?, driver_code?, vehicle_number? }
   */
  async registerResources(payload) {
    const {
      owner,
      driver,
      vehicle,
      owner_context_id,
      driver_context_id,
    } = payload;

    // Validate at least one resource requested
    if (!owner && !driver && !vehicle) {
      const err = new Error('At least one resource (owner, driver, or vehicle) must be provided');
      err.code = 'NO_RESOURCES';
      throw err;
    }

    return await prisma.$transaction(async (tx) => {
      const result = {
        owner_id: null,
        driver_id: null,
        vehicle_id: null,
        owner_code: null,
        driver_code: null,
        vehicle_number: null,
      };

      // ===== 1. RESOLVE OWNER =====
      let resolvedOwnerId = null;
      if (owner) {
        // Create new owner
        const existing = await tx.vehicleOwner.findFirst({ where: { mobile: owner.mobile } });
        if (existing) {
          const err = new Error('A vehicle owner with this mobile number already exists');
          err.code = 'VEHICLE_OWNER_ALREADY_EXISTS';
          err.data = { owner_id: existing.owner_id, owner_name: existing.owner_name, owner_code: existing.owner_code };
          throw err;
        }

        const ownerCode = await this._generateOwnerCodeTx(tx);
        const ownerData = {
          owner_code: ownerCode,
          owner_name: owner.owner_name,
          company_name: owner.company_name || null,
          email: owner.email || null,
          mobile: owner.mobile,
          alternate_mobile: owner.alternate_mobile || null,
          city: owner.city || null,
          state: owner.state || 'Bihar',
          gst_number: owner.gst_number || null,
          pan_number: owner.pan_number || null,
          bank_account: owner.bank_account || null,
          bank_ifsc: owner.bank_ifsc || null,
          bank_name: owner.bank_name || null,
          upi_id: owner.upi_id || null,
          address: owner.address || null,
          status: 'active',
          notes: owner.notes || null,
          is_active: true,
          owner_type: owner.owner_type || 'TRANSPORT_COMPANY',
        };

        const createdOwner = await tx.vehicleOwner.create({ data: ownerData });
        resolvedOwnerId = createdOwner.owner_id;
        result.owner_id = createdOwner.owner_id;
        result.owner_code = createdOwner.owner_code;
      } else if (owner_context_id) {
        // Use pre-selected owner
        const existing = await tx.vehicleOwner.findUnique({
          where: { owner_id: owner_context_id },
          select: { owner_id: true, status: true, is_active: true, deleted_at: true },
        });
        if (!existing || existing.deleted_at !== null) {
          const err = new Error('Pre-selected transport owner does not exist or has been deleted');
          err.code = 'OWNER_NOT_FOUND';
          throw err;
        }
        if (existing.status !== 'active' || existing.is_active === false) {
          const err = new Error('Pre-selected transport owner is not active');
          err.code = 'OWNER_INACTIVE';
          throw err;
        }
        resolvedOwnerId = existing.owner_id;
        result.owner_id = existing.owner_id;
      }

      // ===== 2. RESOLVE DRIVER =====
      let resolvedDriverId = null;
      if (driver) {
        // Determine driver's transport_owner_id
        let driverOwnerId = null;
        let selfOwnerCreated = false;

        if (driver.is_self_owner) {
          // Self-owner: resolve/create DRIVER_OWNER by mobile
          const normalised = String(driver.mobile || '').replace(/\D/g, '');
          let selfOwner = await tx.vehicleOwner.findFirst({
            where: { mobile: { contains: normalised } },
            select: { owner_id: true, owner_type: true, status: true, is_active: true, deleted_at: true },
          });

          if (selfOwner) {
            // Reuse existing owner (any type) — do NOT flip owner_type
            driverOwnerId = selfOwner.owner_id;
          } else {
            // Create new DRIVER_OWNER
            const ownerCode = await this._generateOwnerCodeTx(tx);
            selfOwner = await tx.vehicleOwner.create({
              data: {
                owner_code: ownerCode,
                owner_name: driver.driver_name,
                mobile: driver.mobile,
                city: driver.city || null,
                state: driver.state || 'Bihar',
                address: driver.address || null,
                status: 'active',
                is_active: true,
                owner_type: 'DRIVER_OWNER',
              },
            });
            driverOwnerId = selfOwner.owner_id;
            selfOwnerCreated = true;
          }
        } else if (driver.transport_owner_id) {
          // Explicit owner provided
          const explicitOwner = await tx.vehicleOwner.findUnique({
            where: { owner_id: driver.transport_owner_id },
            select: { owner_id: true, status: true, is_active: true, deleted_at: true },
          });
          if (!explicitOwner || explicitOwner.deleted_at !== null) {
            const err = new Error('Transport Owner does not exist or has been deleted');
            err.code = 'OWNER_NOT_FOUND';
            throw err;
          }
          if (explicitOwner.status !== 'active' || explicitOwner.is_active === false) {
            const err = new Error('Transport Owner is not active');
            err.code = 'OWNER_INACTIVE';
            throw err;
          }
          driverOwnerId = explicitOwner.owner_id;
        } else if (resolvedOwnerId) {
          // Use owner created in this transaction
          driverOwnerId = resolvedOwnerId;
        } else {
          const err = new Error('Transport Owner is required. Every driver must belong to exactly one Transport Owner.');
          err.code = 'OWNER_REQUIRED';
          throw err;
        }

        // Check driver mobile uniqueness
        const existingDriver = await tx.driver.findFirst({ where: { mobile: driver.mobile } });
        if (existingDriver) {
          const err = new Error('Driver already exists');
          err.code = 'DRIVER_ALREADY_EXISTS';
          err.data = { driver_id: existingDriver.driver_id, driver_name: existingDriver.driver_name, driver_code: existingDriver.driver_code, mobile: existingDriver.mobile };
          throw err;
        }

        // Create User if not exists
        let user = await tx.user.findUnique({ where: { phone: driver.mobile } });
        if (!user) {
          const defaultPassword = 'driver123';
          const password_hash = await bcrypt.hash(defaultPassword, 10);
          user = await tx.user.create({
            data: {
              first_name: driver.driver_name.split(' ')[0] || driver.driver_name,
              last_name: driver.driver_name.split(' ').slice(1).join(' ') || '',
              email: `${driver.mobile}@driver.bihar-transport.com`,
              phone: driver.mobile,
              password_hash,
              role: 'driver',
            },
          });
        }

        // Generate driver code
        const driverCode = await this._generateDriverCodeTx(tx);

        // Create Driver
        const createdDriver = await tx.driver.create({
          data: {
            driver_code: driverCode,
            user_id: user.user_id,
            driver_name: driver.driver_name,
            mobile: driver.mobile,
            alternate_mobile: driver.alternate_mobile || null,
            license_number: driver.license_number || null,
            license_expiry: driver.license_expiry || null,
            city: driver.city || null,
            state: driver.state || 'Bihar',
            address: driver.address || null,
            transport_owner_id: driverOwnerId,
            status: 'available',
            is_available: true,
            is_verified: false,
            profile_image: driver.profile_image || null,
          },
        });

        // Timeline event
        await tx.driverTimeline.create({
          data: {
            driver_id: createdDriver.driver_id,
            event_type: 'driver_created',
            description: `Driver ${driver.driver_name} registered with code ${driverCode}`,
          },
        });

        resolvedDriverId = createdDriver.driver_id;
        result.driver_id = createdDriver.driver_id;
        result.driver_code = createdDriver.driver_code;
      } else if (driver_context_id) {
        // Use pre-selected driver
        const existing = await tx.driver.findUnique({
          where: { driver_id: driver_context_id },
          select: { driver_id: true, transport_owner_id: true },
        });
        if (!existing) {
          const err = new Error('Pre-selected driver does not exist');
          err.code = 'DRIVER_NOT_FOUND';
          throw err;
        }
        resolvedDriverId = existing.driver_id;
        result.driver_id = existing.driver_id;
      }

      // ===== 3. RESOLVE VEHICLE =====
      if (vehicle) {
        // Determine owner_id for vehicle
        let vehicleOwnerId = null;
        if (vehicle.owner_id) {
          vehicleOwnerId = vehicle.owner_id;
        } else if (resolvedOwnerId) {
          vehicleOwnerId = resolvedOwnerId;
        } else if (resolvedDriverId) {
          // Use driver's transport_owner_id
          const drv = await tx.driver.findUnique({
            where: { driver_id: resolvedDriverId },
            select: { transport_owner_id: true },
          });
          if (drv?.transport_owner_id) vehicleOwnerId = drv.transport_owner_id;
        }

        // Determine driver_id for vehicle
        let vehicleDriverId = null;
        if (vehicle.driver_id) {
          vehicleDriverId = vehicle.driver_id;
        } else if (resolvedDriverId) {
          vehicleDriverId = resolvedDriverId;
        }

        // Validate owner/driver consistency
        if (vehicleOwnerId && vehicleDriverId) {
          const drv = await tx.driver.findUnique({
            where: { driver_id: vehicleDriverId },
            select: { transport_owner_id: true },
          });
          if (drv?.transport_owner_id !== vehicleOwnerId) {
            const err = new Error('Driver belongs to a different transport owner. Vehicle and driver must belong to the same owner.');
            throw err;
          }
        }

        // Vehicle under an owner does NOT require a driver.
        // The canonical VehicleOwnerRepository.createOwnerVehicleWithDriver only
        // assigns a driver when one is supplied — the driver can be assigned
        // later through the vehicle assignment workflow. Both driver_id and
        // owner_id are nullable on TransportVehicle, so this is schema-supported.

        // Check vehicle_number uniqueness
        const existingVeh = await tx.transportVehicle.findFirst({ where: { vehicle_number: vehicle.vehicle_number } });
        if (existingVeh) {
          const err = new Error('A vehicle with this number already exists');
          err.code = 'VEHICLE_ALREADY_EXISTS';
          err.data = { vehicle_id: existingVeh.vehicle_id };
          throw err;
        }

        // Build vehicle data
        const vehicleData = {
          vehicle_number: vehicle.vehicle_number,
          vehicle_type: vehicle.vehicle_type,
          vehicle_name: vehicle.vehicle_name,
          capacity_kg: vehicle.capacity_kg ? parseFloat(vehicle.capacity_kg) : null,
          capacity_volume: vehicle.capacity_volume ? parseFloat(vehicle.capacity_volume) : null,
          body_type: vehicle.body_type || null,
          vehicle_make: vehicle.vehicle_make || null,
          vehicle_model: vehicle.vehicle_model || null,
          manufacturing_year: vehicle.manufacturing_year ? parseInt(vehicle.manufacturing_year) : null,
          registration_date: vehicle.registration_date || null,
          insurance_number: vehicle.insurance_number || null,
          insurance_expiry: vehicle.insurance_expiry || null,
          permit_number: vehicle.permit_number || null,
          permit_expiry: vehicle.permit_expiry || null,
          pollution_certificate: vehicle.pollution_certificate || null,
          pollution_expiry: vehicle.pollution_expiry || null,
          base_location: vehicle.base_location || null,
          hourly_rate: vehicle.hourly_rate ? parseFloat(vehicle.hourly_rate) : null,
          per_km_rate: vehicle.per_km_rate ? parseFloat(vehicle.per_km_rate) : null,
          owner_id: vehicleOwnerId,
          partner_id: vehicle.partner_id ? parseInt(vehicle.partner_id) : null,
          driver_id: vehicleDriverId,
          current_status: vehicle.current_status || 'available',
          is_available: vehicle.current_status === 'available',
          is_verified: false,
        };

        // Create vehicle and assign driver atomically
        const createdVehicle = await tx.transportVehicle.create({ data: vehicleData });

        // If driver assigned, update driver.current_vehicle_id and vehicle.driver_id
        if (vehicleDriverId) {
          // Clear any existing vehicle assignment for this driver
          const existingVehicle = await tx.transportVehicle.findFirst({ where: { driver_id: vehicleDriverId } });
          if (existingVehicle) {
            await tx.transportVehicle.update({
              where: { vehicle_id: existingVehicle.vehicle_id },
              data: { driver_id: null },
            });
          }
          await tx.driver.update({
            where: { driver_id: vehicleDriverId },
            data: { current_vehicle_id: createdVehicle.vehicle_id },
          });
          await tx.transportVehicle.update({
            where: { vehicle_id: createdVehicle.vehicle_id },
            data: { driver_id: vehicleDriverId },
          });
        }

        result.vehicle_id = createdVehicle.vehicle_id;
        result.vehicle_number = createdVehicle.vehicle_number;
      }

      return result;
    });
  }

  /**
   * Generate next owner code inside a transaction.
   */
  async _generateOwnerCodeTx(tx) {
    const rows = await tx.$queryRaw`
      SELECT owner_code
      FROM vehicle_owners
      WHERE owner_code IS NOT NULL
      ORDER BY owner_code DESC
      LIMIT 1
    `;
    let nextNum = 1;
    const lastCode = rows[0] && rows[0].owner_code;
    if (lastCode) {
      const match = String(lastCode).match(/VOW(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    return `VOW${String(nextNum).padStart(6, '0')}`;
  }

  /**
   * Generate next driver code inside a transaction.
   */
  async _generateDriverCodeTx(tx) {
    const rows = await tx.$queryRaw`
      SELECT driver_code
      FROM drivers
      WHERE driver_code IS NOT NULL
      ORDER BY driver_code DESC
      LIMIT 1
    `;
    let nextNum = 1;
    const lastCode = rows[0] && rows[0].driver_code;
    if (lastCode) {
      const match = String(lastCode).match(/DRV(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    return `DRV${String(nextNum).padStart(6, '0')}`;
  }
}

module.exports = TransportResourceRepository;
