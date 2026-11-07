/**
 * VehicleOwnerService
 * Business logic for vehicle owner management.
 * Handles vehicle owner CRUD, vehicles, bookings.
 *
 * Hardening notes (resource-management stability pass):
 *   - Every user-supplied identity value is normalised to its canonical form
 *     before it is stored or compared (mobile → 10 digits, vehicle number →
 *     uppercase alphanumerics, licence/GST/PAN → uppercase alphanumerics).
 *   - Duplicate owner-mobile, driver-mobile and vehicle-number checks are
 *     performed both before and inside the database transaction.
 *   - Only explicitly whitelisted columns can be written by create/update
 *     endpoints, so a caller cannot smuggle in foreign keys or audit columns.
 *   - Invalid dates/numbers/statuses produce structured 400-class errors
 *     instead of being persisted verbatim.
 *   - Deleting an owner that still has vehicles, drivers or applications is
 *     rejected instead of silently orphaning operational resources.
 */

const VehicleOwnerRepository = require('../repositories/VehicleOwnerRepository');
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
  conflictError,
} = require('../utils/resourceValidation');

const OWNER_TYPES = ['TRANSPORT_COMPANY', 'INDIVIDUAL_OWNER', 'DRIVER_OWNER'];
const OWNER_STATUSES = ['active', 'inactive', 'suspended'];
const VEHICLE_STATUSES = ['available', 'on_trip', 'assigned', 'inactive', 'maintenance'];

const OWNER_UPDATE_FIELDS = [
  'owner_name', 'company_name',
  'email', 'mobile', 'alternate_mobile', 'city', 'state',
  'gst_number', 'pan_number',
  'bank_account', 'bank_ifsc', 'bank_name', 'upi_id',
  'address', 'notes', 'status',
];

const VEHICLE_UPDATE_FIELDS = [
  'vehicle_number', 'vehicle_type', 'vehicle_name',
  'capacity_kg', 'capacity_volume', 'body_type',
  'vehicle_make', 'vehicle_model', 'manufacturing_year',
  'registration_date', 'insurance_number', 'insurance_expiry',
  'permit_number', 'permit_expiry', 'pollution_certificate',
  'pollution_expiry', 'base_location', 'hourly_rate', 'per_km_rate',
  'current_status', 'is_available', 'is_verified', 'owner_id', 'driver_id',
  'tax_number', 'tax_expiry',
  'fitness_number', 'fitness_expiry',
  'national_permit_number', 'national_permit_expiry',
];

const VEHICLE_IDENTIFIER_FIELDS = [
  'insurance_number', 'permit_number', 'pollution_certificate',
  'tax_number', 'fitness_number', 'national_permit_number',
];

const VEHICLE_DATE_FIELDS = [
  'registration_date', 'insurance_expiry', 'permit_expiry', 'pollution_expiry',
  'tax_expiry', 'fitness_expiry', 'national_permit_expiry',
];

const VEHICLE_NUMERIC_FIELDS = ['capacity_kg', 'capacity_volume', 'hourly_rate', 'per_km_rate'];

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizeBoolean = (value, fallback = undefined) => {
  if (value === undefined) return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

class VehicleOwnerService {
  constructor() {
    this.repo = new VehicleOwnerRepository();
  }

  _notFound(message = 'Vehicle owner not found') {
    return conflictError('VEHICLE_OWNER_NOT_FOUND', message);
  }

  _normalizeOwnerFields(data, { partial = false } = {}) {
    const normalized = {};

    if (data.owner_name !== undefined) {
      const name = normalizeName(data.owner_name);
      if (!name) throw validationError('Owner name is required');
      normalized.owner_name = name;
    } else if (!partial) {
      throw validationError('Owner name is required');
    }

    if (data.mobile !== undefined) {
      const mobile = normalizeMobile(data.mobile);
      if (!isValidMobile(mobile)) {
        throw validationError('Enter a valid 10-digit mobile number');
      }
      normalized.mobile = mobile;
    } else if (!partial) {
      throw validationError('Mobile number is required');
    }

    if (data.alternate_mobile !== undefined) {
      const alternate = normalizeMobile(data.alternate_mobile);
      if (alternate && !isValidMobile(alternate)) {
        throw validationError('Enter a valid 10-digit alternate mobile number');
      }
      normalized.alternate_mobile = alternate || null;
    }

    if (data.email !== undefined) {
      if (data.email === null || data.email === '') {
        normalized.email = null;
      } else {
        const email = normalizeEmail(data.email);
        if (!isValidEmail(email)) {
          throw validationError('Enter a valid email address');
        }
        normalized.email = email;
      }
    }

    if (data.city !== undefined) {
      const city = normalizeName(data.city);
      if (!partial && !city) throw validationError('City is required');
      normalized.city = city || null;
    } else if (!partial) {
      throw validationError('City is required');
    }

    if (data.state !== undefined) {
      normalized.state = normalizeName(data.state) || 'Bihar';
    } else if (!partial) {
      normalized.state = 'Bihar';
    }

    if (data.company_name !== undefined) normalized.company_name = normalizeName(data.company_name) || null;
    if (data.gst_number !== undefined) normalized.gst_number = normalizeIdentifier(data.gst_number) || null;
    if (data.pan_number !== undefined) normalized.pan_number = normalizeIdentifier(data.pan_number) || null;
    if (data.bank_account !== undefined) normalized.bank_account = trimOrNull(data.bank_account);
    if (data.bank_ifsc !== undefined) normalized.bank_ifsc = normalizeIdentifier(data.bank_ifsc) || null;
    if (data.bank_name !== undefined) normalized.bank_name = normalizeName(data.bank_name) || null;
    if (data.upi_id !== undefined) normalized.upi_id = trimOrNull(data.upi_id);
    if (data.address !== undefined) normalized.address = trimOrNull(data.address);
    if (data.notes !== undefined) normalized.notes = trimOrNull(data.notes);

    if (normalized.alternate_mobile && normalized.alternate_mobile === normalized.mobile) {
      throw validationError('Alternate mobile number must be different from the primary mobile number');
    }

    return normalized;
  }

  _normalizeVehicleFields(data, { partial = false } = {}) {
    const normalized = {};

    if (data.vehicle_number !== undefined) {
      const vehicleNumber = normalizeVehicleNumber(data.vehicle_number);
      if (!vehicleNumber) throw validationError('Vehicle number is required');
      if (!isValidVehicleNumber(vehicleNumber)) {
        throw validationError('Enter a valid vehicle number (e.g. BR09AB1234)');
      }
      normalized.vehicle_number = vehicleNumber;
    } else if (!partial) {
      throw validationError('Vehicle number is required');
    }

    if (data.vehicle_type !== undefined) {
      const type = normalizeName(data.vehicle_type);
      if (!type) throw validationError('Vehicle type is required');
      normalized.vehicle_type = type;
    } else if (!partial) {
      throw validationError('Vehicle type is required');
    }

    if (data.vehicle_name !== undefined) {
      const name = normalizeName(data.vehicle_name);
      if (!name) throw validationError('Vehicle name is required');
      normalized.vehicle_name = name;
    } else if (!partial) {
      throw validationError('Vehicle name is required');
    }

    for (const field of VEHICLE_IDENTIFIER_FIELDS) {
      if (data[field] !== undefined) {
        normalized[field] = normalizeIdentifier(data[field]) || null;
      }
    }

    for (const field of VEHICLE_DATE_FIELDS) {
      if (data[field] !== undefined) {
        if (!isValidDateOnly(data[field])) {
          throw validationError(`${field.replace(/_/g, ' ')} must be a valid date (YYYY-MM-DD)`);
        }
        normalized[field] = normalizeDateOnly(data[field]);
      }
    }

    for (const field of VEHICLE_NUMERIC_FIELDS) {
      if (data[field] !== undefined) {
        if (data[field] === null || data[field] === '') {
          normalized[field] = null;
          continue;
        }
        const value = normalizeNumber(data[field]);
        if (value === null || value < 0) {
          throw validationError(`${field.replace(/_/g, ' ')} must be a non-negative number`);
        }
        normalized[field] = value;
      }
    }

    if (data.manufacturing_year !== undefined) {
      if (data.manufacturing_year === null || data.manufacturing_year === '') {
        normalized.manufacturing_year = null;
      } else {
        const year = Number.parseInt(data.manufacturing_year, 10);
        if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) {
          throw validationError('Invalid manufacturing year');
        }
        normalized.manufacturing_year = year;
      }
    }

    if (data.current_status !== undefined) {
      const status = normalizeEnum(data.current_status, VEHICLE_STATUSES, null);
      if (!status) {
        throw validationError(`Invalid status. Must be one of: ${VEHICLE_STATUSES.join(', ')}`);
      }
      normalized.current_status = status;
      normalized.is_available = status === 'available';
    }

    if (data.is_available !== undefined && data.current_status === undefined) {
      const isAvailable = normalizeBoolean(data.is_available, undefined);
      if (isAvailable === undefined) {
        throw validationError('is_available must be a boolean');
      }
      normalized.is_available = isAvailable;
    }

    if (data.is_verified !== undefined) {
      const isVerified = normalizeBoolean(data.is_verified, undefined);
      if (isVerified === undefined) {
        throw validationError('is_verified must be a boolean');
      }
      normalized.is_verified = isVerified;
    }

    for (const field of ['body_type', 'vehicle_make', 'vehicle_model', 'base_location']) {
      if (data[field] !== undefined) {
        normalized[field] = trimOrNull(data[field]);
      }
    }

    return normalized;
  }

  /**
   * Register a new vehicle owner.
   */
  async registerOwner(data) {
    const ownerFields = this._normalizeOwnerFields(data, { partial: false });

    let ownerType = 'TRANSPORT_COMPANY';
    if (data.owner_type !== undefined && data.owner_type !== null && data.owner_type !== '') {
      ownerType = String(data.owner_type).trim().toUpperCase();
      if (!OWNER_TYPES.includes(ownerType)) {
        throw validationError(`Invalid owner type. Must be one of: ${OWNER_TYPES.join(', ')}`);
      }
    }

    // Pre-flight duplicate check gives the common case a clean 409 before any
    // expensive work. The repository re-checks inside the transaction.
    const existing = await this.repo.findByMobile(ownerFields.mobile);
    if (existing) {
      throw conflictError(
        'VEHICLE_OWNER_ALREADY_EXISTS',
        'A vehicle owner with this mobile number already exists',
        {
          owner_id: existing.owner_id,
          owner_name: existing.owner_name,
          owner_code: existing.owner_code,
        }
      );
    }

    const ownerData = {
      ...ownerFields,
      status: 'active',
      is_active: true,
      owner_type: ownerType,
    };

    // Handle DRIVER_OWNER driver linking/creation
    let linkDriverId = null;
    let createDriverData = null;

    if (ownerType === 'DRIVER_OWNER') {
      if (data.driver_id !== undefined && data.driver_id !== null && data.driver_id !== '') {
        const parsedDriverId = Number.parseInt(data.driver_id, 10);
        if (!Number.isInteger(parsedDriverId) || parsedDriverId <= 0) {
          throw validationError('Valid driver ID is required');
        }
        linkDriverId = parsedDriverId;
      } else {
        const driver_name = normalizeName(data.driver_name);
        const driverMobile = normalizeMobile(data.mobile);
        const license_number = normalizeIdentifier(data.license_number);

        if (!driver_name || !isValidMobile(driverMobile) || !license_number) {
          throw validationError(
            'driver_name, mobile, and license_number are required when creating a DRIVER_OWNER without an existing driver_id'
          );
        }

        // A mobile number represents one driver. If it is already registered,
        // link/reuse is the only safe outcome; creating a second row would
        // duplicate a real person.
        const existingDriver = await this.repo.findDriverByMobile(driverMobile);
        if (existingDriver) {
          throw conflictError(
            'DRIVER_ALREADY_EXISTS',
            'A driver with this mobile number already exists',
            {
              driver_id: existingDriver.driver_id,
              driver_name: existingDriver.driver_name,
              driver_code: existingDriver.driver_code,
            }
          );
        }

        const existingLicense = await this.repo.findDriverByLicenseNumber(license_number);
        if (existingLicense) {
          throw conflictError(
            'DRIVER_LICENSE_EXISTS',
            'A driver with this licence number already exists',
            {
              driver_id: existingLicense.driver_id,
              driver_name: existingLicense.driver_name,
              driver_code: existingLicense.driver_code,
            }
          );
        }

        createDriverData = {
          driver_name,
          mobile: driverMobile,
          alternate_mobile: normalizeMobile(data.alternate_mobile) || null,
          license_number,
          license_expiry: normalizeDateOnly(data.license_expiry),
          license_class: normalizeName(data.license_class) || null,
          city: normalizeName(data.city) || null,
          state: normalizeName(data.state) || 'Bihar',
          address: trimOrNull(data.address),
          profile_image: trimOrNull(data.profile_image),
        };
      }
    }

    const result = await this.repo.createOwnerWithDriver(ownerData, linkDriverId, createDriverData);

    return {
      ...result.owner,
      linked_driver_id: result.linkedDriverId,
    };
  }

  async getOwnerProfile(ownerId) {
    const owner = await this.repo.findById(ownerId);
    if (!owner || owner.deleted_at) return null;
    return owner;
  }

  async listOwners(filters = {}) {
    return await this.repo.findAll(filters);
  }

  async updateOwner(ownerId, data) {
    const numericOwnerId = Number(ownerId);
    if (!Number.isInteger(numericOwnerId) || numericOwnerId <= 0) {
      throw validationError('Invalid vehicle owner ID');
    }

    const current = await this.repo.findById(numericOwnerId);
    if (!current || current.deleted_at) {
      throw this._notFound();
    }

    const updateData = {};
    for (const key of OWNER_UPDATE_FIELDS) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (Object.keys(updateData).length === 0) {
      throw validationError('No valid fields provided for update');
    }

    const normalized = this._normalizeOwnerFields(updateData, { partial: true });

    if (normalized.status !== undefined) {
      const status = normalizeEnum(normalized.status, OWNER_STATUSES, null);
      if (!status) {
        throw validationError(`Invalid status. Must be one of: ${OWNER_STATUSES.join(', ')}`);
      }
      normalized.status = status;
      normalized.is_active = status === 'active';
    }

    if (normalized.mobile !== undefined) {
      const existing = await this.repo.findByMobile(normalized.mobile, numericOwnerId);
      if (existing) {
        throw conflictError(
          'VEHICLE_OWNER_ALREADY_EXISTS',
          'A vehicle owner with this mobile number already exists',
          {
            owner_id: existing.owner_id,
            owner_name: existing.owner_name,
            owner_code: existing.owner_code,
          }
        );
      }
    }

    // Compare alternate mobile against the effective primary mobile.
    const effectiveMobile = normalized.mobile !== undefined ? normalized.mobile : current.mobile;
    if (normalized.alternate_mobile && normalized.alternate_mobile === normalizeMobile(effectiveMobile)) {
      throw validationError('Alternate mobile number must be different from the primary mobile number');
    }

    normalized.updated_at = new Date();

    try {
      return await this.repo.update(numericOwnerId, normalized);
    } catch (error) {
      if (error.code === 'P2025') throw this._notFound();
      throw error;
    }
  }

  async deleteOwner(ownerId) {
    const numericOwnerId = Number(ownerId);
    if (!Number.isInteger(numericOwnerId) || numericOwnerId <= 0) {
      throw validationError('Invalid vehicle owner ID');
    }

    const owner = await this.repo.findById(numericOwnerId);
    if (!owner || owner.deleted_at) throw this._notFound();

    const deps = await this.repo.findDependencyCounts(numericOwnerId);
    if (deps.hasDependencies) {
      throw conflictError(
        'VEHICLE_OWNER_HAS_DEPENDENCIES',
        'This transport owner cannot be deleted while vehicles, drivers, applications or active trips are linked. Reassign them first.',
        deps
      );
    }

    return await this.repo.softDelete(numericOwnerId);
  }

  async toggleStatus(ownerId, status) {
    const numericOwnerId = Number(ownerId);
    if (!Number.isInteger(numericOwnerId) || numericOwnerId <= 0) {
      throw validationError('Invalid vehicle owner ID');
    }
    const normalizedStatus = normalizeEnum(status, OWNER_STATUSES, null);
    if (!normalizedStatus) {
      throw validationError(`Invalid status. Must be one of: ${OWNER_STATUSES.join(', ')}`);
    }

    const owner = await this.repo.findById(numericOwnerId);
    if (!owner || owner.deleted_at) throw this._notFound();

    try {
      return await this.repo.update(numericOwnerId, {
        status: normalizedStatus,
        is_active: normalizedStatus === 'active',
        updated_at: new Date(),
      });
    } catch (error) {
      if (error.code === 'P2025') throw this._notFound();
      throw error;
    }
  }

  async getOwnerStats() {
    return await this.repo.getOwnerStats();
  }

  async getOwnerBookings(ownerId, filters = {}) {
    return await this.repo.getOwnerBookings(ownerId, filters);
  }

  async getOwnerDrivers(ownerId, filters = {}) {
    return await this.repo.findDriversByOwnerId(ownerId, filters);
  }

  async getOwnerVehicles(ownerId, filters = {}) {
    return await this.repo.getOwnerVehicles(ownerId, filters);
  }

  async createOwnerVehicle(ownerId, data) {
    const numericOwnerId = Number(ownerId);
    if (!Number.isInteger(numericOwnerId) || numericOwnerId <= 0) {
      throw validationError('Invalid vehicle owner ID');
    }

    const vehicleFields = this._normalizeVehicleFields(data, { partial: false });

    const partnerId = data.partner_id ? Number.parseInt(data.partner_id, 10) : null;
    if (data.partner_id && (!Number.isInteger(partnerId) || partnerId <= 0)) {
      throw validationError('Valid partner_id is required when provided');
    }
    let driverId = data.driver_id ? Number.parseInt(data.driver_id, 10) : null;
    if (data.driver_id && (!Number.isInteger(driverId) || driverId <= 0)) {
      throw validationError('Valid driver_id is required when provided');
    }

    // Validate the owner before touching anything else.
    const owner = await this.repo.findById(numericOwnerId);
    if (!owner || owner.deleted_at) throw this._notFound();

    // Pre-flight duplicate check (repository re-checks inside the transaction).
    const existingVehicle = await this.repo.findVehicleByNumber(vehicleFields.vehicle_number);
    if (existingVehicle) {
      throw conflictError(
        'VEHICLE_ALREADY_EXISTS',
        'A vehicle with this number already exists',
        { vehicle_id: existingVehicle.vehicle_id }
      );
    }

    // Validate partner_id if provided
    if (partnerId) {
      const partner = await this.repo.findPartnerById(partnerId);
      if (!partner) {
        throw conflictError('PARTNER_NOT_FOUND', 'Partner not found');
      }
    }

    // Handle DRIVER_OWNER auto-assignment
    const assignOwnerDriver = data.assign_owner_driver === true || data.assign_owner_driver === 'true';
    if (assignOwnerDriver) {
      if (owner.owner_type !== 'DRIVER_OWNER') {
        throw validationError('assign_owner_driver is only valid for DRIVER_OWNER type owners');
      }

      const linkedDriver = await this.repo.findDriverByOwnerId(numericOwnerId);
      if (!linkedDriver || linkedDriver.length === 0) {
        throw validationError('No driver is linked to this DRIVER_OWNER. Link a driver first or set assign_owner_driver to false.');
      }

      driverId = linkedDriver[0].driver_id;
    }

    // Driver is REQUIRED for all vehicle types unless DRIVER_OWNER with auto-assignment
    if (!driverId) {
      throw validationError('Driver is required. Please select a driver or enable "Assign owner as the current driver" for DRIVER_OWNER type.');
    }

    const driver = await this.repo.findDriverById(driverId);
    if (!driver) {
      throw conflictError('DRIVER_NOT_FOUND', 'Driver not found');
    }
    if (driver.transport_owner_id !== numericOwnerId) {
      throw conflictError(
        'DRIVER_OWNER_MISMATCH',
        'Driver belongs to a different transport owner. Vehicle and driver must belong to the same owner.'
      );
    }

    const vehicleData = {
      ...vehicleFields,
      owner_id: numericOwnerId,
      partner_id: partnerId,
      driver_id: driverId,
      is_verified: false,
    };

    // Create vehicle and handle driver assignment atomically
    const vehicle = await this.repo.createOwnerVehicleWithDriver(numericOwnerId, vehicleData, driverId);

    return vehicle;
  }

  async getVehicleById(vehicleId) {
    const vehicle = await this.repo.findVehicleById(vehicleId);
    if (!vehicle) {
      const err = new Error('Vehicle not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return vehicle;
  }

  async updateVehicle(vehicleId, data) {
    const numericVehicleId = Number(vehicleId);
    if (!Number.isInteger(numericVehicleId) || numericVehicleId <= 0) {
      throw validationError('Invalid vehicle ID');
    }

    const currentVehicle = await this.repo.findVehicleById(numericVehicleId);
    if (!currentVehicle) {
      const err = new Error('Vehicle not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const updateData = {};
    for (const key of VEHICLE_UPDATE_FIELDS) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (Object.keys(updateData).length === 0) {
      throw validationError('No valid fields provided for update');
    }

    const normalized = this._normalizeVehicleFields(updateData, { partial: true });
    let ownerChanged = false;

    // owner_id changes require dedicated validated flow
    if (data.owner_id !== undefined) {
      const newOwnerId = data.owner_id ? Number.parseInt(data.owner_id, 10) : null;

      if (newOwnerId !== currentVehicle.owner_id) {
        if (!newOwnerId || !Number.isInteger(newOwnerId) || newOwnerId <= 0) {
          throw validationError('Cannot remove vehicle owner through generic update');
        }
        await this.repo.updateVehicleOwnerValidated(numericVehicleId, newOwnerId);
        ownerChanged = true;
      }
    }

    // driver_id changes require owner consistency validation
    if (data.driver_id !== undefined) {
      const newDriverId = data.driver_id ? Number.parseInt(data.driver_id, 10) : null;
      if (data.driver_id && (!Number.isInteger(newDriverId) || newDriverId <= 0)) {
        throw validationError('Valid driver_id is required when provided');
      }

      if (!newDriverId) {
        await this.repo.removeDriverFromVehicle(numericVehicleId);
      } else {
        const driver = await this.repo.findDriverById(newDriverId);
        if (!driver) {
          throw conflictError('DRIVER_NOT_FOUND', 'Driver not found');
        }
        if (currentVehicle.owner_id && driver.transport_owner_id !== currentVehicle.owner_id) {
          throw conflictError(
            'DRIVER_OWNER_MISMATCH',
            'Driver belongs to a different transport owner. Vehicle and driver must belong to the same owner.'
          );
        }
        await this.repo.assignDriverToVehicle(numericVehicleId, newDriverId);
      }
    }

    // Re-check duplicate vehicle number if it is being changed.
    if (normalized.vehicle_number !== undefined) {
      const existing = await this.repo.findVehicleByNumber(normalized.vehicle_number, numericVehicleId);
      if (existing) {
        throw conflictError(
          'VEHICLE_ALREADY_EXISTS',
          'A vehicle with this number already exists',
          { vehicle_id: existing.vehicle_id }
        );
      }
    }

    if (Object.keys(normalized).length === 0 && !ownerChanged) {
      // owner/driver assignments above may still have changed something.
      if (data.owner_id === undefined && data.driver_id === undefined) {
        throw validationError('No valid fields provided for update');
      }
      return await this.repo.findVehicleById(numericVehicleId);
    }

    normalized.updated_at = new Date();

    try {
      return await this.repo.updateVehicle(numericVehicleId, normalized);
    } catch (error) {
      if (error.code === 'P2025') {
        const err = new Error('Vehicle not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      throw error;
    }
  }

  async assignDriverToVehicle(vehicleId, driverId) {
    return await this.repo.assignDriverToVehicle(vehicleId, driverId);
  }

  async removeDriverFromVehicle(vehicleId) {
    return await this.repo.removeDriverFromVehicle(vehicleId);
  }

  /**
   * Create a standalone vehicle (without owner).
   */
  async createStandaloneVehicle(data) {
    const vehicleFields = this._normalizeVehicleFields(data, { partial: false });

    const driverId = data.driver_id ? Number.parseInt(data.driver_id, 10) : null;
    if (data.driver_id && (!Number.isInteger(driverId) || driverId <= 0)) {
      throw validationError('Valid driver_id is required when provided');
    }

    const existingVehicle = await this.repo.findVehicleByNumber(vehicleFields.vehicle_number);
    if (existingVehicle) {
      throw conflictError(
        'VEHICLE_ALREADY_EXISTS',
        'A vehicle with this number already exists',
        { vehicle_id: existingVehicle.vehicle_id }
      );
    }

    const vehicleData = {
      ...vehicleFields,
      owner_id: null,
      partner_id: null,
      driver_id: driverId,
      is_verified: false,
    };

    // If driver_id is provided, validate driver exists
    if (vehicleData.driver_id) {
      const driver = await this.repo.findDriverById(vehicleData.driver_id);
      if (!driver) {
        throw conflictError('DRIVER_NOT_FOUND', 'Driver not found');
      }
    }

    return await this.repo.createStandaloneVehicle(vehicleData);
  }

  async getPartnerVehicles(partnerId, filters = {}) {
    return await this.repo.getPartnerVehicles(partnerId, filters);
  }
}

module.exports = VehicleOwnerService;
