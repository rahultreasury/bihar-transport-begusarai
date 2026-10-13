/**
 * TransportResourceService
 * Business logic for combined transport resource registration.
 * Orchestrates owner/driver/vehicle creation in a single transaction.
 */

const TransportResourceRepository = require('../repositories/TransportResourceRepository');

class TransportResourceService {
  constructor() {
    this.repo = new TransportResourceRepository();
  }

  /**
   * Register transport resources (owner, driver, vehicle) in a single transaction.
   *
   * @param {Object} payload
   * @param {Object|null} payload.owner - Owner data
   * @param {Object|null} payload.driver - Driver data
   * @param {Object|null} payload.vehicle - Vehicle data
   * @param {number|null} payload.owner_context_id - Pre-selected owner ID
   * @param {number|null} payload.driver_context_id - Pre-selected driver ID
   * @returns {Promise<Object>} Created resource IDs and codes
   */
  async registerResources(payload) {
    // Validate at least one resource
    if (!payload.owner && !payload.driver && !payload.vehicle) {
      const err = new Error('At least one resource (owner, driver, or vehicle) must be provided');
      err.code = 'NO_RESOURCES';
      throw err;
    }

    // Validate owner fields if provided
    if (payload.owner) {
      const requiredOwner = ['owner_name', 'mobile', 'city'];
      for (const field of requiredOwner) {
        if (!payload.owner[field] || String(payload.owner[field]).trim() === '') {
          const err = new Error(`${field.replace(/_/g, ' ')} is required for owner`);
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
      }
      // Mobile format
      if (!/^[6-9]\d{9}$/.test(payload.owner.mobile)) {
        const err = new Error('Enter a valid 10-digit mobile number for owner');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    }

    // Validate driver fields if provided.
    // The Driver table has NO vehicle_type/vehicle_number columns — those
    // live on TransportVehicle and are reached through Driver.current_vehicle_id.
    // A driver can be registered independently without a vehicle.
    if (payload.driver) {
      const requiredDriver = ['driver_name', 'mobile', 'license_number'];
      for (const field of requiredDriver) {
        if (!payload.driver[field] || String(payload.driver[field]).trim() === '') {
          const err = new Error(`${field.replace(/_/g, ' ')} is required for driver`);
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
      }
      if (!/^[6-9]\d{9}$/.test(payload.driver.mobile)) {
        const err = new Error('Enter a valid 10-digit mobile number for driver');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    }

    // Validate vehicle fields if provided
    if (payload.vehicle) {
      const requiredVehicle = ['vehicle_number', 'vehicle_type', 'vehicle_name'];
      for (const field of requiredVehicle) {
        if (!payload.vehicle[field] || String(payload.vehicle[field]).trim() === '') {
          const err = new Error(`${field.replace(/_/g, ' ')} is required for vehicle`);
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
      }
      if (!/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/i.test(payload.vehicle.vehicle_number)) {
        const err = new Error('Enter a valid vehicle number (e.g. BR09AB1234)');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    }

    // Delegate to repository (runs in single transaction)
    return await this.repo.registerResources(payload);
  }
}

module.exports = TransportResourceService;
