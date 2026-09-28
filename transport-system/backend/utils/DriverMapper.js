/**
 * DriverMapper
 * Centralized mapping from Prisma Driver rows (with relations) to
 * the flattened API response shape for Partner self-service.
 *
 * This is the SINGLE source of truth for driver response formatting for Partners.
 * No route or service should build driver response objects inline.
 *
 * SECURITY: Financial fields are role-specific.
 * - ADMIN: Sees all fields including financial balances
 * - PARTNER: Sees only fleet-relevant information
 */

const { prisma } = require('../config/prisma');

/**
 * Flatten a Driver row for the Partner's driver view.
 * SECURITY: Does NOT include internal Admin-only financial fields (current_balance, total_advance, total_paid, total_expenses).
 * Partner sees their driver-relevant information including vehicle assignment.
 *
 * @param {Object} d - Prisma Driver row with relations
 * @returns {Object}
 */
function flattenDriverForPartner(d) {
  return {
    driver_id: d.driver_id,
    driver_code: d.driver_code,
    driver_name: d.driver_name,
    mobile: d.mobile,
    alternate_mobile: d.alternate_mobile,
    address: d.address,
    city: d.city,
    state: d.state,
    pincode: d.pincode,
    license_number: d.license_number,
    license_expiry: d.license_expiry,
    license_class: d.license_class,
    joining_date: d.joining_date,
    status: d.status,
    profile_image: d.profile_image,
    is_available: d.is_available,
    is_verified: d.is_verified,
    rating: d.rating,
    total_deliveries: d.total_deliveries,
    performance_rating: d.performance_rating,
    // NO current_balance, total_advance, total_paid, total_expenses - Admin only
    created_at: d.created_at,
    updated_at: d.updated_at,
    // Current vehicle info (if assigned)
    current_vehicle_id: d.currentVehicle?.vehicle_id ?? null,
    current_vehicle_number: d.currentVehicle?.vehicle_number ?? null,
    current_vehicle_type: d.currentVehicle?.vehicle_type ?? null,
    current_vehicle_name: d.currentVehicle?.vehicle_name ?? null,
    current_vehicle_status: d.currentVehicle?.current_status ?? null,
    // Transport Owner info (if linked)
    transport_owner_id: d.transportOwner?.owner_id ?? null,
    transport_owner_name: d.transportOwner?.owner_name ?? null,
    transport_owner_company: d.transportOwner?.company_name ?? null,
  };
}

/**
 * Flatten a Driver row for the Admin view.
 * Includes all fields including financial balances.
 *
 * @param {Object} d - Prisma Driver row with relations
 * @returns {Object}
 */
function flattenDriverForAdmin(d) {
  return {
    driver_id: d.driver_id,
    driver_code: d.driver_code,
    driver_name: d.driver_name,
    mobile: d.mobile,
    alternate_mobile: d.alternate_mobile,
    address: d.address,
    city: d.city,
    state: d.state,
    pincode: d.pincode,
    license_number: d.license_number,
    license_expiry: d.license_expiry,
    license_class: d.license_class,
    joining_date: d.joining_date,
    status: d.status,
    profile_image: d.profile_image,
    is_available: d.is_available,
    is_verified: d.is_verified,
    rating: d.rating,
    total_deliveries: d.total_deliveries,
    total_advance: d.total_advance,
    total_paid: d.total_paid,
    total_expenses: d.total_expenses,
    current_balance: d.current_balance,
    performance_rating: d.performance_rating,
    created_at: d.created_at,
    updated_at: d.updated_at,
    current_vehicle_id: d.currentVehicle?.vehicle_id ?? null,
    current_vehicle_number: d.currentVehicle?.vehicle_number ?? null,
    current_vehicle_type: d.currentVehicle?.vehicle_type ?? null,
    current_vehicle_name: d.currentVehicle?.vehicle_name ?? null,
    current_vehicle_status: d.currentVehicle?.current_status ?? null,
    transport_owner_id: d.transportOwner?.owner_id ?? null,
    transport_owner_name: d.transportOwner?.owner_name ?? null,
    transport_owner_company: d.transportOwner?.company_name ?? null,
  };
}

module.exports = {
  flattenDriverForPartner,
  flattenDriverForAdmin,
};