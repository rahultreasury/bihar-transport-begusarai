/**
 * TripFinancialDTO
 * Role-based serialization for trip financial data.
 *
 * SECURITY RULES:
 * - ADMIN: Sees everything including BT Margin
 * - TRANSPORT_OWNER: Sees only owner-specific financials (NO BT Margin, NO customer fare)
 * - DRIVER: Sees only driver-specific financials (NO BT Margin, NO customer fare, NO commission)
 */

/**
 * Serialize trip financial for ADMIN role.
 * Admin sees the complete financial picture.
 *
 * @param {Object} tripFinancial - Prisma TripFinancial row with relations
 * @returns {Object}
 */
function serializeForAdmin(tripFinancial) {
  if (!tripFinancial) return null;

  const booking = tripFinancial.booking;
  const advances = tripFinancial.advances || [];
  const settlements = tripFinancial.settlements || [];
  const commissions = tripFinancial.commissions || [];
  const transactions = tripFinancial.transactions || [];

  const driverAdvances = advances.filter(a => a.advance_type === 'DRIVER_ADVANCE');
  const fuelAdvances = advances.filter(a => a.advance_type === 'FUEL_ADVANCE');
  const ownerAdvances = advances.filter(a => a.advance_type === 'OWNER_ADVANCE');

  const totalPaid = transactions
    .filter(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID')
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    // Booking Info
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Customer Financials
    customerFare: tripFinancial.customer_fare,
    amountReceived: totalPaid,
    paymentStatus: totalPaid >= tripFinancial.customer_fare ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'PENDING',
    paymentMethod: transactions.find(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID')?.payment_method || null,
    outstandingAmount: Math.max(0, tripFinancial.customer_fare - totalPaid),

    // Driver Financials
    driverPayout: tripFinancial.driver_payout,
    driverAdvance: tripFinancial.total_advance,
    fuelAdvance: tripFinancial.total_fuel_advance,
    remainingDriverSettlement: tripFinancial.remaining_driver_settlement,
    driverPaymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
    driverAdvances: driverAdvances.map(a => ({
      id: a.advance_id,
      amount: a.amount,
      date: a.given_at,
      method: a.payment_method,
      reference: a.reference_number,
      notes: a.notes,
    })),

    // Owner Financials
    ownerSettlement: tripFinancial.owner_settlement_amount,
    ownerAdvance: tripFinancial.total_owner_advance,
    remainingOwnerSettlement: tripFinancial.remaining_owner_settlement,
    ownerPaymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
    ownerAdvances: ownerAdvances.map(a => ({
      id: a.advance_id,
      amount: a.amount,
      date: a.given_at,
      method: a.payment_method,
      reference: a.reference_number,
      notes: a.notes,
    })),

    // Commission
    commissionRate: tripFinancial.commission_rate,
    commissionAmount: tripFinancial.commission_amount,
    commissionType: commissions[0]?.commission_type || 'percentage',

    // BT Internal Financials (ADMIN ONLY)
    btMargin: tripFinancial.bt_margin,
    totalOperationalCost: (tripFinancial.driver_payout || 0) + (tripFinancial.commission_amount || 0),

    // Meta
    calculatedAt: tripFinancial.calculated_at,
    calculatedBy: tripFinancial.calculated_by,
    notes: tripFinancial.notes,
  };
}

/**
 * Serialize trip financial for TRANSPORT_OWNER role.
 * Owner sees only their business/settlement information.
 * NO BT Margin, NO customer fare, NO internal BT cost.
 *
 * @param {Object} tripFinancial - Prisma TripFinancial row with relations
 * @param {number} ownerId - The requesting owner's ID
 * @returns {Object}
 */
function serializeForTransportOwner(tripFinancial, ownerId) {
  if (!tripFinancial) return null;

  const booking = tripFinancial.booking;
  const advances = tripFinancial.advances || [];
  const settlements = tripFinancial.settlements || [];

  // Verify ownership
  if (booking.vehicle_owner_id !== ownerId) {
    return { error: 'Access denied. You do not own this trip.' };
  }

  const ownerAdvances = advances.filter(a => a.advance_type === 'OWNER_ADVANCE');

  return {
    // Booking Info (no customer fare)
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Owner Financials ONLY
    tripAmount: tripFinancial.owner_settlement_amount,
    advance: tripFinancial.total_owner_advance,
    remainingSettlement: tripFinancial.remaining_owner_settlement,
    paymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
    advances: ownerAdvances.map(a => ({
      id: a.advance_id,
      amount: a.amount,
      date: a.given_at,
      method: a.payment_method,
      reference: a.reference_number,
      notes: a.notes,
    })),

    // NO btMargin
    // NO customerFare
    // NO commission
    // NO driverPayout
  };
}

/**
 * Serialize trip financial for DRIVER role.
 * Driver sees only their trip/payment information.
 * NO BT Margin, NO customer fare, NO commission.
 *
 * @param {Object} tripFinancial - Prisma TripFinancial row with relations
 * @param {number} driverId - The requesting driver's ID
 * @returns {Object}
 */
function serializeForDriver(tripFinancial, driverId) {
  if (!tripFinancial) return null;

  const booking = tripFinancial.booking;
  const advances = tripFinancial.advances || [];
  const settlements = tripFinancial.settlements || [];

  // Verify assignment
  if (booking.driver_id !== driverId) {
    return { error: 'Access denied. You are not assigned to this trip.' };
  }

  const driverAdvances = advances.filter(a => a.advance_type === 'DRIVER_ADVANCE');
  const fuelAdvances = advances.filter(a => a.advance_type === 'FUEL_ADVANCE');

  return {
    // Booking Info (no customer fare)
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Driver Financials ONLY
    tripAmount: tripFinancial.driver_payout,
    advanceReceived: tripFinancial.total_advance,
    fuelAdvance: tripFinancial.total_fuel_advance,
    remainingAmount: tripFinancial.remaining_driver_settlement,
    paymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
    advances: [...driverAdvances, ...fuelAdvances].map(a => ({
      id: a.advance_id,
      amount: a.amount,
      type: a.advance_type,
      date: a.given_at,
      method: a.payment_method,
      reference: a.reference_number,
      notes: a.notes,
    })),

    // NO customerFare
    // NO btMargin
    // NO commission
    // NO ownerSettlement
  };
}

/**
 * Main serializer function.
 * Routes to the appropriate role-based serializer.
 *
 * @param {Object} tripFinancial - Prisma TripFinancial row with relations
 * @param {string} role - 'ADMIN', 'TRANSPORT_OWNER', 'DRIVER'
 * @param {Object} user - The requesting user
 * @returns {Object}
 */
function serializeTripFinancial(tripFinancial, role, user = null) {
  switch (role) {
    case 'ADMIN':
      return serializeForAdmin(tripFinancial);
    case 'TRANSPORT_OWNER':
      return serializeForTransportOwner(tripFinancial, user?.owner_id);
    case 'DRIVER':
      return serializeForDriver(tripFinancial, user?.driver_id);
    default:
      throw new Error(`Invalid role: ${role}`);
  }
}

module.exports = {
  serializeTripFinancial,
  serializeForAdmin,
  serializeForTransportOwner,
  serializeForDriver,
};
