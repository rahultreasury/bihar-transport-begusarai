/**
 * TransportResourceService
 * Business logic for combined transport resource registration.
 * Orchestrates owner/driver/vehicle creation in a single transaction.
 */

const TransportResourceRepository = require('../repositories/TransportResourceRepository');
const {
  normalizeMobile,
  isValidMobile,
  normalizeVehicleNumber,
  isValidVehicleNumber,
  normalizeIdentifier,
  normalizeName,
  normalizeEmail,
  isValidEmail,
  normalizeDateOnly,
  isValidDateOnly,
  normalizeNumber,
  normalizeEnum,
  validationError,
} = require('../utils/resourceValidation');

const OWNER_TYPES = ['TRANSPORT_COMPANY', 'INDIVIDUAL_OWNER', 'DRIVER_OWNER'];
const VEHICLE_STATUSES = ['available', 'on_trip', 'assigned', 'inactive', 'maintenance'];

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizeDateField = (value, label) => {
  if (value === undefined) return undefined;
  if (!isValidDateOnly(value)) {
    throw validationError(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  return normalizeDateOnly(value);
};

const normalizeNumberField = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = normalizeNumber(value);
  if (parsed === null || parsed < 0) {
    throw validationError(`${label} must be a non-negative number`);
  }
  return parsed;
};

class TransportResourceService {
  constructor() {
    this.repo = new TransportResourceRepository();
  }

  _normalizeOwner(owner) {
    if (!owner) return null;

    const owner_name = normalizeName(owner.owner_name);
    const mobile = normalizeMobile(owner.mobile);
    const city = normalizeName(owner.city);

    if (!owner_name) throw validationError('owner_name is required for owner');
    if (!isValidMobile(mobile)) throw validationError('Enter a valid 10-digit mobile number for owner');
    if (!city) throw validationError('city is required for owner');

    const alternate_mobile = normalizeMobile(owner.alternate_mobile);
    if (alternate_mobile && !isValidMobile(alternate_mobile)) {
      throw validationError('Enter a valid 10-digit alternate mobile number for owner');
    }
    if (alternate_mobile && alternate_mobile === mobile) {
      throw validationError('Alternate mobile number must be different from the owner mobile number');
    }

    const email = owner.email ? normalizeEmail(owner.email) : null;
    if (!isValidEmail(email)) {
      throw validationError('Enter a valid email address for owner');
    }

    let owner_type = owner.owner_type;
    if (owner_type !== undefined && owner_type !== null && owner_type !== '') {
      owner_type = String(owner_type).trim().toUpperCase();
      if (!OWNER_TYPES.includes(owner_type)) {
        throw validationError(`Invalid owner type. Must be one of: ${OWNER_TYPES.join(', ')}`);
      }
    } else {
      owner_type = undefined;
    }

    return {
      ...owner,
      owner_name,
      mobile,
      city,
      alternate_mobile: alternate_mobile || null,
      email,
      state: normalizeName(owner.state) || 'Bihar',
      company_name: normalizeName(owner.company_name) || null,
      gst_number: normalizeIdentifier(owner.gst_number) || null,
      pan_number: normalizeIdentifier(owner.pan_number) || null,
      bank_account: trimOrNull(owner.bank_account),
      bank_ifsc: normalizeIdentifier(owner.bank_ifsc) || null,
      bank_name: normalizeName(owner.bank_name) || null,
      upi_id: trimOrNull(owner.upi_id),
      address: trimOrNull(owner.address),
      notes: trimOrNull(owner.notes),
      owner_type,
    };
  }

  _normalizeDriver(driver) {
    if (!driver) return null;

    const driver_name = normalizeName(driver.driver_name);
    const mobile = normalizeMobile(driver.mobile);
    const license_number = normalizeIdentifier(driver.license_number);

    if (!driver_name) throw validationError('driver_name is required for driver');
    if (!isValidMobile(mobile)) throw validationError('Enter a valid 10-digit mobile number for driver');
    if (!license_number) throw validationError('license_number is required for driver');

    const alternate_mobile = normalizeMobile(driver.alternate_mobile);
    if (alternate_mobile && !isValidMobile(alternate_mobile)) {
      throw validationError('Enter a valid 10-digit alternate mobile number for driver');
    }
    if (alternate_mobile && alternate_mobile === mobile) {
      throw validationError('Alternate mobile number must be different from the driver mobile number');
    }

    const is_self_owner = driver.is_self_owner === true ||
      driver.is_self_owner === 'true' ||
      driver.is_self_owner === 1 ||
      driver.is_self_owner === '1';

    return {
      ...driver,
      driver_name,
      mobile,
      alternate_mobile: alternate_mobile || null,
      license_number,
      license_expiry: normalizeDateField(driver.license_expiry, 'License expiry'),
      license_class: normalizeName(driver.license_class) || null,
      city: normalizeName(driver.city) || null,
      state: normalizeName(driver.state) || 'Bihar',
      address: trimOrNull(driver.address),
      profile_image: trimOrNull(driver.profile_image),
      is_self_owner,
    };
  }

  _normalizeVehicle(vehicle) {
    if (!vehicle) return null;

    const vehicle_number = normalizeVehicleNumber(vehicle.vehicle_number);
    const vehicle_type = normalizeName(vehicle.vehicle_type);
    const vehicle_name = normalizeName(vehicle.vehicle_name);

    if (!vehicle_number) throw validationError('vehicle_number is required for vehicle');
    if (!isValidVehicleNumber(vehicle_number)) {
      throw validationError('Enter a valid vehicle number (e.g. BR09AB1234)');
    }
    if (!vehicle_type) throw validationError('vehicle_type is required for vehicle');
    if (!vehicle_name) throw validationError('vehicle_name is required for vehicle');

    let current_status = 'available';
    if (vehicle.current_status !== undefined && vehicle.current_status !== null && vehicle.current_status !== '') {
      current_status = normalizeEnum(vehicle.current_status, VEHICLE_STATUSES, null);
      if (!current_status) {
        throw validationError(`Invalid vehicle status. Must be one of: ${VEHICLE_STATUSES.join(', ')}`);
      }
    }

    let manufacturing_year = null;
    if (vehicle.manufacturing_year !== undefined && vehicle.manufacturing_year !== null && vehicle.manufacturing_year !== '') {
      manufacturing_year = Number.parseInt(vehicle.manufacturing_year, 10);
      if (!Number.isInteger(manufacturing_year) || manufacturing_year < 1900 || manufacturing_year > new Date().getFullYear() + 1) {
        throw validationError('Invalid manufacturing year');
      }
    }

    const identifierFields = [
      'insurance_number', 'permit_number', 'pollution_certificate',
      'tax_number', 'fitness_number', 'national_permit_number',
    ];
    const identifiers = {};
    for (const field of identifierFields) {
      if (vehicle[field] !== undefined) identifiers[field] = normalizeIdentifier(vehicle[field]) || null;
    }

    const dateFields = [
      'registration_date', 'insurance_expiry', 'permit_expiry', 'pollution_expiry',
      'tax_expiry', 'fitness_expiry', 'national_permit_expiry',
    ];
    const dates = {};
    for (const field of dateFields) {
      if (vehicle[field] !== undefined) {
        const label = field.replace(/_/g, ' ');
        dates[field] = normalizeDateField(vehicle[field], label);
      }
    }

    return {
      ...vehicle,
      vehicle_number,
      vehicle_type,
      vehicle_name,
      current_status,
      manufacturing_year,
      ...identifiers,
      ...dates,
      capacity_kg: normalizeNumberField(vehicle.capacity_kg, 'Capacity'),
      capacity_volume: normalizeNumberField(vehicle.capacity_volume, 'Capacity volume'),
      hourly_rate: normalizeNumberField(vehicle.hourly_rate, 'Hourly rate'),
      per_km_rate: normalizeNumberField(vehicle.per_km_rate, 'Per km rate'),
      body_type: normalizeName(vehicle.body_type) || null,
      vehicle_make: normalizeName(vehicle.vehicle_make) || null,
      vehicle_model: normalizeName(vehicle.vehicle_model) || null,
      base_location: normalizeName(vehicle.base_location) || null,
    };
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
      throw validationError('At least one resource (owner, driver, or vehicle) must be provided');
    }

    const normalizedPayload = {
      ...payload,
      owner: this._normalizeOwner(payload.owner),
      driver: this._normalizeDriver(payload.driver),
      vehicle: this._normalizeVehicle(payload.vehicle),
    };

    // Delegate to repository (runs in single transaction)
    return await this.repo.registerResources(normalizedPayload);
  }
}

module.exports = TransportResourceService;
