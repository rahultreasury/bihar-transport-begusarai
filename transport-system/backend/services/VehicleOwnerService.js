/**
 * VehicleOwnerService
 * Business logic for vehicle owner management.
 * Handles vehicle owner CRUD, vehicles, bookings.
 */

const VehicleOwnerRepository = require('../repositories/VehicleOwnerRepository');

class VehicleOwnerService {
  constructor() {
    this.repo = new VehicleOwnerRepository();
  }

  /**
   * Register a new vehicle owner
   */
  async registerOwner(data) {
    const { mobile } = data;

    // Check unique mobile
    const existing = await this.repo.findByMobile(mobile);
    if (existing) {
      const err = new Error('A vehicle owner with this mobile number already exists');
      err.code = 'VEHICLE_OWNER_ALREADY_EXISTS';
      err.data = {
        owner_id: existing.owner_id,
        owner_name: existing.owner_name,
        owner_code: existing.owner_code,
      };
      throw err;
    }

    // Generate owner code
    const ownerCode = await this.repo.generateOwnerCode();

    const ownerData = {
      owner_code: ownerCode,
      owner_name: data.owner_name,
      company_name: data.company_name || null,
      email: data.email || null,
      mobile: data.mobile,
      alternate_mobile: data.alternate_mobile || null,
      city: data.city || null,
      state: data.state || 'Bihar',
      gst_number: data.gst_number || null,
      pan_number: data.pan_number || null,
      bank_account: data.bank_account || null,
      bank_ifsc: data.bank_ifsc || null,
      bank_name: data.bank_name || null,
      upi_id: data.upi_id || null,
      address: data.address || null,
      status: 'active',
      notes: data.notes || null,
      is_active: true,
    };

    const result = await this.repo.create(ownerData);
    return result;
  }

  async getOwnerProfile(ownerId) {
    return await this.repo.findById(ownerId);
  }

  async listOwners(filters = {}) {
    return await this.repo.findAll(filters);
  }

  async updateOwner(ownerId, data) {
    const allowedFields = [
      'owner_name', 'company_name',
      'email', 'mobile', 'alternate_mobile', 'city', 'state',
      'gst_number', 'pan_number',
      'bank_account', 'bank_ifsc', 'bank_name', 'upi_id',
      'address', 'notes', 'status',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    return await this.repo.update(ownerId, updateData);
  }

  async deleteOwner(ownerId) {
    const owner = await this.repo.findById(ownerId);
    if (!owner) throw new Error('Vehicle owner not found');
    return await this.repo.softDelete(ownerId);
  }

  async toggleStatus(ownerId, status) {
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    return await this.repo.update(ownerId, {
      status,
      is_active: status === 'active',
    });
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
    // Validate required fields
    const requiredFields = ['vehicle_number', 'vehicle_type', 'vehicle_name'];
    for (const field of requiredFields) {
      if (!data[field] || String(data[field]).trim() === '') {
        throw new Error(`${field.replace(/_/g, ' ')} is required`);
      }
    }

    // Normalize vehicle number
    const vehicleNumber = String(data.vehicle_number).trim().toUpperCase();

    const partnerId = data.partner_id ? parseInt(data.partner_id) : null;
    const driverId = data.driver_id ? parseInt(data.driver_id) : null;

    // Validate partner_id if provided
    if (partnerId) {
      const partner = await this.repo.findPartnerById(partnerId);
      if (!partner) {
        throw new Error('Partner not found');
      }
    }

    // Validate driver_id if provided
    if (driverId) {
      const driver = await this.repo.findDriverById(driverId);
      if (!driver) {
        throw new Error('Driver not found');
      }
    }

    const vehicleData = {
      vehicle_number: vehicleNumber,
      vehicle_type: data.vehicle_type,
      vehicle_name: data.vehicle_name,
      capacity_kg: data.capacity_kg ? parseFloat(data.capacity_kg) : null,
      capacity_volume: data.capacity_volume ? parseFloat(data.capacity_volume) : null,
      body_type: data.body_type || null,
      vehicle_make: data.vehicle_make || null,
      vehicle_model: data.vehicle_model || null,
      manufacturing_year: data.manufacturing_year ? parseInt(data.manufacturing_year) : null,
      registration_date: data.registration_date || null,
      insurance_number: data.insurance_number || null,
      insurance_expiry: data.insurance_expiry || null,
      permit_number: data.permit_number || null,
      permit_expiry: data.permit_expiry || null,
      pollution_certificate: data.pollution_certificate || null,
      pollution_expiry: data.pollution_expiry || null,
      base_location: data.base_location || null,
      hourly_rate: data.hourly_rate ? parseFloat(data.hourly_rate) : null,
      per_km_rate: data.per_km_rate ? parseFloat(data.per_km_rate) : null,
      owner_id: ownerId,
      partner_id: partnerId,
      driver_id: driverId,
      current_status: data.current_status || 'available',
      is_available: data.current_status === 'available',
      is_verified: false,
    };

    // Create vehicle and handle driver assignment atomically
    const vehicle = await this.repo.createOwnerVehicleWithDriver(ownerId, vehicleData, driverId);

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
    const allowedFields = [
      'vehicle_number', 'vehicle_type', 'vehicle_name',
      'capacity_kg', 'capacity_volume', 'body_type',
      'vehicle_make', 'vehicle_model', 'manufacturing_year',
      'registration_date', 'insurance_number', 'insurance_expiry',
      'permit_number', 'permit_expiry', 'pollution_certificate',
      'pollution_expiry', 'base_location', 'hourly_rate', 'per_km_rate',
      'current_status', 'is_available', 'is_verified', 'owner_id',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    // Validate vehicle number uniqueness if being updated
    if (updateData.vehicle_number) {
      const existing = await this.repo.findVehicleByNumber(updateData.vehicle_number);
      if (existing && existing.vehicle_id !== vehicleId) {
        const err = new Error('A vehicle with this number already exists');
        err.code = 'VEHICLE_ALREADY_EXISTS';
        err.data = { vehicle_id: existing.vehicle_id };
        throw err;
      }
    }

    // Validate numeric fields
    if (updateData.capacity_kg !== undefined && (isNaN(updateData.capacity_kg) || updateData.capacity_kg < 0)) {
      throw new Error('Capacity must be a positive number');
    }
    if (updateData.capacity_volume !== undefined && (isNaN(updateData.capacity_volume) || updateData.capacity_volume < 0)) {
      throw new Error('Capacity volume must be a positive number');
    }
    if (updateData.hourly_rate !== undefined && (isNaN(updateData.hourly_rate) || updateData.hourly_rate < 0)) {
      throw new Error('Hourly rate must be a positive number');
    }
    if (updateData.per_km_rate !== undefined && (isNaN(updateData.per_km_rate) || updateData.per_km_rate < 0)) {
      throw new Error('Per km rate must be a positive number');
    }
    if (updateData.manufacturing_year !== undefined) {
      const year = parseInt(updateData.manufacturing_year);
      if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
        throw new Error('Invalid manufacturing year');
      }
    }

    // Validate status
    if (updateData.current_status) {
      const validStatuses = ['available', 'on_trip', 'assigned', 'inactive', 'maintenance'];
      if (!validStatuses.includes(updateData.current_status)) {
        throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }
    }

    try {
      return await this.repo.updateVehicle(vehicleId, updateData);
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

  async getPartnerVehicles(partnerId, filters = {}) {
    return await this.repo.getPartnerVehicles(partnerId, filters);
  }
}

module.exports = VehicleOwnerService;
