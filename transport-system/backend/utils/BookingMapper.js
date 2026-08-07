/**
 * BookingMapper
 * Centralized mapping from Prisma Booking rows (with relations) to
 * the flattened API response shape.
 *
 * This is the SINGLE source of truth for booking response formatting.
 * No route or service should build booking response objects inline.
 */

/**
 * Flatten a Booking row (fetched with BookingInclude) into the standard
 * API response shape.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBooking(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    user_id: b.user_id,
    driver_id: b.driver_id,
    pickup_location: b.pickup_location,
    pickup_address: b.pickup_address,
    pickup_city: b.pickup_city,
    pickup_state: b.pickup_state,
    pickup_pincode: b.pickup_pincode,
    pickup_date: b.pickup_date,
    pickup_time: b.pickup_time,
    drop_location: b.drop_location,
    drop_address: b.drop_address,
    drop_city: b.drop_city,
    drop_state: b.drop_state,
    drop_pincode: b.drop_pincode,
    goods_description: b.goods_description,
    goods_type: b.goods_type,
    goods_weight_kg: b.goods_weight_kg,
    goods_volume: b.goods_volume,
    number_of_items: b.number_of_items,
    fragile: b.fragile,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    final_price: b.final_price,
    status: b.status,
    quote_status: b.quote_status,
    confirmation_source: b.confirmation_source ?? null,
    quote_remarks: b.quote_remarks,
    quote_sent_at: b.quote_sent_at,
    quote_accepted_at: b.quote_accepted_at,
    quote_rejected_at: b.quote_rejected_at,
    quote_valid_until: b.quote_valid_until,
    created_at: b.created_at,
    updated_at: b.updated_at,
    confirmed_at: b.confirmed_at,
    driver_assigned_at: b.driver_assigned_at,
    pickup_completed_at: b.pickup_completed_at,
    delivered_at: b.delivered_at,
    // Vehicle info from assigned TransportVehicle relation.
    vehicle_id: b.vehicle?.vehicle_id ?? null,
    vehicle_number: b.vehicle?.vehicle_number ?? null,
    vehicle_name: b.vehicle?.vehicle_name ?? null,
    vehicle_type: b.vehicle?.vehicle_type ?? null,
    // Driver info
    driver_name_snapshot: b.driver_name_snapshot ?? null,
    truck_number_snapshot: b.truck_number_snapshot ?? null,
    owner_name_snapshot: b.partner_name_snapshot ?? null,
    mobile_snapshot: b.mobile_snapshot ?? null,
    customer_first_name: b.user?.first_name ?? null,
    customer_last_name: b.user?.last_name ?? null,
    customer_email: b.user?.email ?? null,
    customer_phone: b.user?.phone ?? null,
    customer_address: b.user?.address ?? null,
    driver_user_id: b.driver?.user_id ?? null,
    driver_first_name: b.driver?.user?.first_name ?? null,
    driver_last_name: b.driver?.user?.last_name ?? null,
    driver_phone: b.driver?.user?.phone ?? null,
    // Delivery info
    delivery_current_status: b.delivery?.current_status ?? null,
    delivery_status_description: b.delivery?.status_description ?? null,
    current_status: b.delivery?.current_status ?? null,
    status_description: b.delivery?.status_description ?? null,
    estimated_pickup_time: b.delivery?.estimated_pickup_time ?? null,
    estimated_delivery_time: b.delivery?.estimated_delivery_time ?? null,
    actual_pickup_time: b.delivery?.actual_pickup_time ?? null,
    actual_delivery_time: b.delivery?.actual_delivery_time ?? null,
    delivery_otp: b.delivery?.delivery_otp ?? null,
    otp_verified: b.delivery?.otp_verified ?? null,
    recipient_name: b.delivery?.recipient_name ?? null,
    delivery_notes: b.delivery?.delivery_notes ?? null,
  };
}

/**
 * Flatten a Booking row for the admin booking detail view.
 * Includes additional fields like driver user info.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBookingAdminDetail(b) {
  const base = flattenBooking(b);
  return {
    ...base,
    driver_id: b.driver?.driver_id ?? null,
    license_number: b.driver?.license_number ?? null,
    rating: b.driver?.rating ?? null,
    total_deliveries: b.driver?.total_deliveries ?? null,
    vehicle_make: null,
    vehicle_model: null,
    capacity_kg: null,
    per_km_rate: null,
  };
}

/**
 * Flatten a Booking row for the driver's available jobs view.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBookingForDriver(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    user_id: b.user_id,
    driver_id: b.driver_id,
    vehicle_id: b.vehicle_id,
    pickup_location: b.pickup_location,
    pickup_address: b.pickup_address,
    pickup_city: b.pickup_city,
    pickup_state: b.pickup_state,
    pickup_pincode: b.pickup_pincode,
    pickup_date: b.pickup_date,
    pickup_time: b.pickup_time,
    drop_location: b.drop_location,
    drop_address: b.drop_address,
    drop_city: b.drop_city,
    drop_state: b.drop_state,
    drop_pincode: b.drop_pincode,
    goods_description: b.goods_description,
    goods_type: b.goods_type,
    goods_weight_kg: b.goods_weight_kg,
    goods_volume: b.goods_volume,
    number_of_items: b.number_of_items,
    fragile: b.fragile,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    final_price: b.final_price,
    status: b.status,
    created_at: b.created_at,
    updated_at: b.updated_at,
    confirmed_at: b.confirmed_at,
    driver_assigned_at: b.driver_assigned_at,
    pickup_completed_at: b.pickup_completed_at,
    delivered_at: b.delivered_at,
    customer_first_name: b.user?.first_name ?? null,
    customer_last_name: b.user?.last_name ?? null,
    customer_phone: b.user?.phone ?? null,
    customer_address: b.user?.address ?? null,
    vehicle_number: b.vehicle?.vehicle_number ?? null,
    vehicle_name: b.vehicle?.vehicle_name ?? null,
    vehicle_type: b.vehicle?.vehicle_type ?? null,
    vehicle_make: b.vehicle?.vehicle_make ?? null,
    vehicle_model: b.vehicle?.vehicle_model ?? null,
    current_status: b.delivery?.current_status ?? null,
    status_description: b.delivery?.status_description ?? null,
    estimated_pickup_time: b.delivery?.estimated_pickup_time ?? null,
    estimated_delivery_time: b.delivery?.estimated_delivery_time ?? null,
    actual_pickup_time: b.delivery?.actual_pickup_time ?? null,
    actual_delivery_time: b.delivery?.actual_delivery_time ?? null,
    delivery_otp: b.delivery?.delivery_otp ?? null,
  };
}

module.exports = {
  flattenBooking,
  flattenBookingAdminDetail,
  flattenBookingForDriver,
};
