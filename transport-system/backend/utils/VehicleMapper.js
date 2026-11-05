/**
 * VehicleMapper
 * Centralized mapping from Prisma TransportVehicle rows (with relations) to
 * the flattened API response shape for Partner self-service.
 *
 * This is the SINGLE source of truth for vehicle response formatting for Partners.
 * No route or service should build vehicle response objects inline.
 *
 * SECURITY: Financial fields are role-specific.
 * - ADMIN: Sees all fields including hourly_rate, per_km_rate
 * - PARTNER: Sees only fleet-relevant information
 */

const { prisma } = require('../config/prisma');

/**
 * Flatten a TransportVehicle row for the Partner's fleet view.
 * SECURITY: Does NOT include internal Admin-only financial fields (hourly_rate, per_km_rate).
 * Partner sees their fleet-relevant information including driver assignment.
 *
 * @param {Object} v - Prisma TransportVehicle row with relations
 * @returns {Object}
 */
function flattenVehicleForPartner(v) {
  return {
    vehicle_id: v.vehicle_id,
    vehicle_code: v.vehicle_code,
    vehicle_number: v.vehicle_number,
    vehicle_type: v.vehicle_type,
    vehicle_name: v.vehicle_name,
    capacity_kg: v.capacity_kg,
    capacity_volume: v.capacity_volume,
    body_type: v.body_type,
    vehicle_make: v.vehicle_make,
    vehicle_model: v.vehicle_model,
    manufacturing_year: v.manufacturing_year,
    registration_date: v.registration_date,
    insurance_number: v.insurance_number,
    insurance_expiry: v.insurance_expiry,
    permit_number: v.permit_number,
    permit_expiry: v.permit_expiry,
    pollution_certificate: v.pollution_certificate,
    pollution_expiry: v.pollution_expiry,
    is_available: v.is_available,
    is_verified: v.is_verified,
    current_status: v.current_status,
    base_location: v.base_location,
    // NO hourly_rate, per_km_rate - Admin only
    created_at: v.created_at,
    updated_at: v.updated_at,
    // Driver info (if assigned)
    driver_id: v.driver?.driver_id ?? null,
    driver_name: v.driver?.driver_name ?? null,
    driver_mobile: v.driver?.mobile ?? null,
    driver_user_id: v.driver?.user_id ?? null,
    driver_first_name: v.driver?.user?.first_name ?? null,
    driver_last_name: v.driver?.user?.last_name ?? null,
    driver_phone: v.driver?.user?.phone ?? null,
    // Owner info (if available and relevant)
    owner_id: v.owner?.owner_id ?? null,
    owner_name: v.owner?.owner_name ?? null,
    owner_company: v.owner?.company_name ?? null,
  };
}

/**
 * Flatten a TransportVehicle row for the Admin view.
 * Includes all fields including financial rates.
 *
 * @param {Object} v - Prisma TransportVehicle row with relations
 * @returns {Object}
 */
function flattenVehicleForAdmin(v) {
  return {
    vehicle_id: v.vehicle_id,
    vehicle_code: v.vehicle_code,
    vehicle_number: v.vehicle_number,
    vehicle_type: v.vehicle_type,
    vehicle_name: v.vehicle_name,
    capacity_kg: v.capacity_kg,
    capacity_volume: v.capacity_volume,
    body_type: v.body_type,
    vehicle_make: v.vehicle_make,
    vehicle_model: v.vehicle_model,
    manufacturing_year: v.manufacturing_year,
    registration_date: v.registration_date,
    insurance_number: v.insurance_number,
    insurance_expiry: v.insurance_expiry,
    permit_number: v.permit_number,
    permit_expiry: v.permit_expiry,
    pollution_certificate: v.pollution_certificate,
    pollution_expiry: v.pollution_expiry,
    is_available: v.is_available,
    is_verified: v.is_verified,
    current_status: v.current_status,
    base_location: v.base_location,
    hourly_rate: v.hourly_rate,
    per_km_rate: v.per_km_rate,
    created_at: v.created_at,
    updated_at: v.updated_at,
    driver_id: v.driver?.driver_id ?? null,
    driver_name: v.driver?.driver_name ?? null,
    driver_mobile: v.driver?.mobile ?? null,
    driver_user_id: v.driver?.user_id ?? null,
    driver_first_name: v.driver?.user?.first_name ?? null,
    driver_last_name: v.driver?.user?.last_name ?? null,
    driver_phone: v.driver?.user?.phone ?? null,
    owner_id: v.owner?.owner_id ?? null,
    owner_name: v.owner?.owner_name ?? null,
    owner_company: v.owner?.company_name ?? null,
  };
}

module.exports = {
  flattenVehicleForPartner,
  flattenVehicleForAdmin,
};