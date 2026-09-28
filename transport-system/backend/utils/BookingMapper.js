/**
 * BookingMapper
 * Centralized mapping from Prisma Booking rows (with relations) to
 * the flattened API response shape.
 *
 * This is the SINGLE source of truth for booking response formatting.
 * No route or service should build booking response objects inline.
 *
 * SECURITY: Financial fields are role-specific.
 * - ADMIN: Sees final_price (customer fare)
 * - TRANSPORT_OWNER: Does NOT see final_price
 * - DRIVER: Does NOT see final_price
 */

/**
 * Flatten a Booking row (fetched with BookingInclude) into the standard
 * API response shape.
 * WARNING: This includes final_price which is customer fare.
 * Only use this for ADMIN views or when financial visibility is authorized.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBooking(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    // Canonical frontend-facing field (camelCase). booking_number /
    // booking_reference are kept for backward compatibility.
    bookingNumber: b.booking_number,
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
    quantity_unit: b.quantity_unit,
    weight_unit: b.weight_unit,
    special_instructions: b.special_instructions ?? null,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    final_price: b.final_price, // ADMIN ONLY - customer fare
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
    // Vehicle info from the assigned TransportVehicle relation.
    //
    // These are read from the RELATION, not from the booking column, so a
    // driver assignment is only visible here if `bookings.vehicle_id` was
    // actually persisted. Falling back to the snapshot keeps legacy rows that
    // predate that column readable.
    vehicle_id: b.vehicle_id ?? b.vehicle?.vehicle_id ?? null,
    vehicle_number: b.vehicle?.vehicle_number ?? b.truck_number_snapshot ?? null,
    vehicle_name: b.vehicle?.vehicle_name ?? null,
    vehicle_type: b.vehicle?.vehicle_type ?? null,
    // Driver info (immutable snapshots taken at assignment time)
    driver_name_snapshot: b.driver_name_snapshot ?? null,
    truck_number_snapshot: b.truck_number_snapshot ?? null,
    owner_name_snapshot: b.partner_name_snapshot ?? null,
    mobile_snapshot: b.mobile_snapshot ?? null,

    /* ── The PERSISTED owner / partner of the assignment ────────────────
     * The admin ENQUIRY workspace shows "Owner / Partner" for the assigned
     * vehicle. Returning only `owner_name_snapshot` meant a booking assigned to
     * a self-owned driver (or to a VehicleOwner rather than a Partner) showed
     * "—". These relations are read straight from the live schema relations so
     * the page always has the real owner, with the snapshot as a fallback.
     */
    vehicle_owner_id: b.vehicleOwner?.owner_id ?? null,
    vehicle_owner_name: b.vehicleOwner?.company_name || b.vehicleOwner?.owner_name || null,
    vehicle_owner_phone: b.vehicleOwner?.mobile ?? null,
    partner_id: b.partner?.partner_id ?? null,
    partner_name: b.partner?.partner_name ?? null,
    partner_owner_name: b.partner?.owner_name ?? null,
    // One resolved label the UI can render without guessing.
    assigned_owner_name:
      b.partner_name_snapshot ||
      b.vehicleOwner?.company_name ||
      b.vehicleOwner?.owner_name ||
      b.partner?.partner_name ||
      b.partner?.owner_name ||
      null,
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
 * SECURITY: Does NOT include final_price (customer fare) or any BT margin data.
 * Driver sees only trip/payment information relevant to them.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBookingForDriver(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    // Canonical frontend-facing field (camelCase). booking_number /
    // booking_reference are kept for backward compatibility.
    bookingNumber: b.booking_number,
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
    quantity_unit: b.quantity_unit,
    weight_unit: b.weight_unit,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    // NO final_price - driver must NOT see customer fare
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

/**
 * Flatten a Booking row for transport owner view.
 * SECURITY: Does NOT include final_price (customer fare) or any BT margin data.
 * Owner sees only their business/settlement information.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBookingForTransportOwner(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    bookingNumber: b.booking_number,
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
    quantity_unit: b.quantity_unit,
    weight_unit: b.weight_unit,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    // NO final_price - owner must NOT see customer fare
    status: b.status,
    created_at: b.created_at,
    updated_at: b.updated_at,
    confirmed_at: b.confirmed_at,
    driver_assigned_at: b.driver_assigned_at,
    pickup_completed_at: b.pickup_completed_at,
    delivered_at: b.delivered_at,
    vehicle_number: b.vehicle?.vehicle_number ?? null,
    vehicle_name: b.vehicle?.vehicle_name ?? null,
    vehicle_type: b.vehicle?.vehicle_type ?? null,
    driver_name: b.driver?.driver_name ?? null,
    driver_mobile: b.driver?.mobile ?? null,
    current_status: b.delivery?.current_status ?? null,
    status_description: b.delivery?.status_description ?? null,
  };
}

/**
 * Flatten a Booking row for the Partner's trips view.
 * SECURITY: Does NOT include final_price (customer fare) or any BT margin data.
 * Partner sees their business-relevant information including commission.
 *
 * @param {Object} b - Prisma Booking row with relations
 * @returns {Object}
 */
function flattenBookingForPartner(b) {
  return {
    booking_id: b.booking_id,
    booking_reference: b.booking_reference,
    booking_number: b.booking_number,
    bookingNumber: b.booking_number,
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
    quantity_unit: b.quantity_unit,
    weight_unit: b.weight_unit,
    vehicle_type_required: b.vehicle_type_required,
    estimated_distance_km: b.estimated_distance_km,
    estimated_price: b.estimated_price,
    // NO final_price - partner must NOT see customer fare
    status: b.status,
    quote_status: b.quote_status,
    confirmation_source: b.confirmation_source ?? null,
    created_at: b.created_at,
    updated_at: b.updated_at,
    confirmed_at: b.confirmed_at,
    driver_assigned_at: b.driver_assigned_at,
    pickup_completed_at: b.pickup_completed_at,
    delivered_at: b.delivered_at,
    // Vehicle info from assigned TransportVehicle relation.
    vehicle_number: b.vehicle?.vehicle_number ?? null,
    vehicle_name: b.vehicle?.vehicle_name ?? null,
    vehicle_type: b.vehicle?.vehicle_type ?? null,
    // Driver info
    driver_name: b.driver?.driver_name ?? null,
    driver_mobile: b.driver?.mobile ?? null,
    // Partner commission info (their earnings)
    commission_percentage: b.commission_percentage ?? 0,
    commission_amount: b.commission_amount ?? 0,
    commission_type: b.commission_type ?? 'percentage',
    // Settlement info
    settlement_status: b.settlement_status ?? 'pending',
    // Delivery info
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
 * Flatten a Trip row (with relations) into a partner-safe shape.
 *
 * A Trip is a first-class trip record (the "Booking as the trip record"
 * architecture). The partner can only see trips whose transport owner is
 * linked to their own partner account — this mapper is only ever applied to
 * trips that have already been scoped by ownership.
 *
 * SECURITY: excludes BT-internal margin fields (bt_commission, bt_margin)
 * and customer-only financial fields (freight_amount is the customer fare,
 * so it is excluded from the partner view; the partner sees only their
 * commission share).
 *
 * @param {Object} t - Prisma Trip row with relations
 * @returns {Object}
 */
function flattenTripForPartner(t) {
  return {
    trip_id: t.trip_id,
    trip_number: t.trip_number,
    booking_id: t.booking_id ?? null,
    source_type: t.source_type ?? null,
    pickup_location: t.pickup_location ?? null,
    pickup_city: t.pickup_city ?? null,
    drop_location: t.drop_location ?? null,
    drop_city: t.drop_city ?? null,
    distance_km: t.distance_km ?? null,
    trip_date: t.trip_date ?? null,
    expected_delivery_date: t.expected_delivery_date ?? null,
    trip_delivered_date: t.trip_delivered_date ?? null,
    status: t.status ?? null,
    created_at: t.created_at ?? null,
    updated_at: t.updated_at ?? null,
    completed_at: t.completed_at ?? null,
    cancelled_at: t.cancelled_at ?? null,
    notes: t.notes ?? null,
    // Route convenience
    route: [t.pickup_city, t.drop_city].filter(Boolean).join(' → ') || null,
    // Vehicle info from assigned TransportVehicle relation.
    vehicle_id: t.vehicle?.vehicle_id ?? null,
    vehicle_number: t.vehicle?.vehicle_number ?? null,
    vehicle_name: t.vehicle?.vehicle_name ?? null,
    vehicle_type: t.vehicle?.vehicle_type ?? null,
    // Driver info
    driver_id: t.driver?.driver_id ?? null,
    driver_name: t.driver?.driver_name ?? null,
    driver_mobile: t.driver?.mobile ?? null,
    driver_license: t.driver?.license_number ?? null,
    // Transport Owner (linked to this partner)
    transport_owner_id: t.transportOwner?.owner_id ?? t.transport_owner_id ?? null,
    transport_owner_name: t.transportOwner?.owner_name ?? null,
    transport_owner_company: t.transportOwner?.company_name ?? null,
    // Client / customer info (read-only, no financials)
    user_id: t.user?.user_id ?? null,
    customer_name: [t.user?.first_name, t.user?.last_name]
      .filter(Boolean)
      .join(' ') || null,
    customer_phone: t.user?.phone ?? null,
    client_id: t.client?.client_id ?? null,
    offline_client_name: t.client?.company_name ?? null,
    // Linked booking (if any)
    booking_number: t.booking?.booking_number ?? null,
    booking_status: t.booking?.status ?? null,
  };
}

/**
 * Flatten a Trip row for the authenticated driver's trips view.
 * SECURITY: excludes customer-only financial fields (freight_amount is the
 * customer fare, so it is excluded). Driver sees only their operational
 * trip data — route, vehicle, status, and their own payout.
 *
 * @param {Object} t - Prisma Trip row with relations
 * @returns {Object}
 */
function flattenTripForDriver(t) {
  return {
    trip_id: t.trip_id,
    trip_number: t.trip_number,
    booking_id: t.booking_id ?? null,
    source_type: t.source_type ?? null,
    pickup_location: t.pickup_location ?? null,
    pickup_city: t.pickup_city ?? null,
    drop_location: t.drop_location ?? null,
    drop_city: t.drop_city ?? null,
    distance_km: t.distance_km ?? null,
    trip_date: t.trip_date ?? null,
    expected_delivery_date: t.expected_delivery_date ?? null,
    trip_delivered_date: t.trip_delivered_date ?? null,
    status: t.status ?? null,
    created_at: t.created_at ?? null,
    updated_at: t.updated_at ?? null,
    completed_at: t.completed_at ?? null,
    cancelled_at: t.cancelled_at ?? null,
    notes: t.notes ?? null,
    // Route convenience
    route: [t.pickup_city, t.drop_city].filter(Boolean).join(' → ') || null,
    // Vehicle info from assigned TransportVehicle relation.
    vehicle_id: t.vehicle?.vehicle_id ?? null,
    vehicle_number: t.vehicle?.vehicle_number ?? null,
    vehicle_name: t.vehicle?.vehicle_name ?? null,
    vehicle_type: t.vehicle?.vehicle_type ?? null,
    // Driver info (this IS the authenticated driver)
    driver_id: t.driver?.driver_id ?? null,
    driver_name: t.driver?.driver_name ?? null,
    driver_mobile: t.driver?.mobile ?? null,
    // Transport Owner (read-only, for context)
    transport_owner_id: t.transportOwner?.owner_id ?? t.transport_owner_id ?? null,
    transport_owner_name: t.transportOwner?.owner_name ?? null,
    // Client / customer info (read-only, no financials)
    user_id: t.user?.user_id ?? null,
    customer_name: [t.user?.first_name, t.user?.last_name]
      .filter(Boolean)
      .join(' ') || null,
    customer_phone: t.user?.phone ?? null,
    client_id: t.client?.client_id ?? null,
    offline_client_name: t.client?.company_name ?? null,
    // Linked booking (if any)
    booking_number: t.booking?.booking_number ?? null,
    booking_status: t.booking?.status ?? null,
  };
}

module.exports = {
  flattenBooking,
  flattenBookingAdminDetail,
  flattenBookingForDriver,
  flattenBookingForTransportOwner,
  flattenBookingForPartner,
  flattenTripForPartner,
  flattenTripForDriver,
};
