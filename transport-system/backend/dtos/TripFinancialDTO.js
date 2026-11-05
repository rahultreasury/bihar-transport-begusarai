/**
 * TripFinancialDTO
 * Role-based serialization for trip financial data.
 *
 * PHASE 3 REDESIGN: All values are derived from FinancialTransaction records.
 * FinancialTransaction is the SINGLE SOURCE OF TRUTH.
 *
 * SECURITY RULES:
 * - ADMIN: Sees everything including BT Margin
 * - TRANSPORT_OWNER: Sees only owner-specific financials (NO BT Margin, NO customer fare)
 * - DRIVER: Sees only driver-specific financials (NO BT Margin, NO customer fare, NO commission)
 */

/**
 * Calculate values from FinancialTransaction records.
 */
function calculateFromTransactions(transactions) {
  const result = {
    totalDriverAdvance: 0,
    totalFuelAdvance: 0,
    totalOwnerAdvance: 0,
    totalCustomerPayments: 0,
    totalClientPayments: 0,
    totalOwnerSettlements: 0,
    totalDriverSettlements: 0,
    totalExpenses: 0,
    expenseBreakdown: {},
  };

  for (const tx of transactions) {
    const amount = tx.amount || 0;

    switch (tx.transaction_type) {
      case 'DRIVER_ADVANCE':
        result.totalDriverAdvance += amount;
        break;
      case 'FUEL_ADVANCE':
        result.totalFuelAdvance += amount;
        break;
      case 'OWNER_ADVANCE':
        result.totalOwnerAdvance += amount;
        break;
      case 'CUSTOMER_PAYMENT':
        if (tx.direction === 'CREDIT') {
          result.totalCustomerPayments += amount;
        }
        break;
      case 'CLIENT_PAYMENT':
        if (tx.direction === 'CREDIT') {
          result.totalClientPayments += amount;
        }
        break;
      case 'OWNER_SETTLEMENT':
        result.totalOwnerSettlements += amount;
        break;
      case 'DRIVER_SETTLEMENT':
        result.totalDriverSettlements += amount;
        break;
      case 'TRIP_EXPENSE':
        result.totalExpenses += amount;
        const expenseType = tx.metadata?.expense_type || 'OTHER';
        result.expenseBreakdown[expenseType] = (result.expenseBreakdown[expenseType] || 0) + amount;
        break;
    }
  }

  return result;
}

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
  const transactions = tripFinancial.transactions || [];
  const settlements = tripFinancial.settlements || [];
  const commissions = tripFinancial.commissions || [];

  // Calculate from transactions - SINGLE SOURCE OF TRUTH
  const txCalc = calculateFromTransactions(transactions);
  const totalPaid = txCalc.totalCustomerPayments + txCalc.totalClientPayments;

  return {
    // Booking Info
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Customer Financials
    customerFare: tripFinancial.customer_fare,
    amountReceived: totalPaid,
    paymentStatus: totalPaid >= tripFinancial.customer_fare ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'PENDING',
    paymentMethod: transactions.find(t => (t.transaction_type === 'CUSTOMER_PAYMENT' || t.transaction_type === 'CLIENT_PAYMENT') && t.direction === 'CREDIT')?.payment_method || null,
    outstandingAmount: Math.max(0, tripFinancial.customer_fare - totalPaid),

    // Driver Financials
    driverPayout: tripFinancial.driver_payout,
    driverAdvance: txCalc.totalDriverAdvance,
    fuelAdvance: txCalc.totalFuelAdvance,
    remainingDriverSettlement: (tripFinancial.driver_payout || 0) - txCalc.totalDriverAdvance - txCalc.totalFuelAdvance,
    driverPaymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
    driverAdvances: transactions
      .filter(t => t.transaction_type === 'DRIVER_ADVANCE')
      .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method, reference: t.reference_number, notes: t.notes })),

    // Owner Financials
    ownerSettlement: tripFinancial.owner_settlement_amount,
    ownerAdvance: txCalc.totalOwnerAdvance,
    remainingOwnerSettlement: (tripFinancial.owner_settlement_amount || 0) - txCalc.totalOwnerAdvance,
    ownerPaymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
    ownerAdvances: transactions
      .filter(t => t.transaction_type === 'OWNER_ADVANCE')
      .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method, reference: t.reference_number, notes: t.notes })),

    // Commission
    commissionRate: tripFinancial.commission_rate,
    commissionAmount: tripFinancial.commission_amount,
    commissionType: commissions[0]?.commission_type || 'percentage',

    // BT Internal Financials (ADMIN ONLY)
    btMargin: tripFinancial.bt_margin,
    totalOperationalCost: (tripFinancial.driver_payout || 0) + (tripFinancial.commission_amount || 0),

    // Expenses
    totalExpenses: txCalc.totalExpenses,
    expenseBreakdown: txCalc.expenseBreakdown,

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
  const transactions = tripFinancial.transactions || [];
  const settlements = tripFinancial.settlements || [];

  // Verify ownership
  if (booking.vehicle_owner_id !== ownerId) {
    return { error: 'Access denied. You do not own this trip.' };
  }

  // Calculate from transactions
  const txCalc = calculateFromTransactions(transactions);

  return {
    // Booking Info (no customer fare)
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Owner Financials ONLY
    tripAmount: tripFinancial.owner_settlement_amount,
    advance: txCalc.totalOwnerAdvance,
    remainingSettlement: (tripFinancial.owner_settlement_amount || 0) - txCalc.totalOwnerAdvance,
    paymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
    advances: transactions
      .filter(t => t.transaction_type === 'OWNER_ADVANCE')
      .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method, reference: t.reference_number, notes: t.notes })),

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
  const transactions = tripFinancial.transactions || [];
  const settlements = tripFinancial.settlements || [];

  // Verify assignment
  if (booking.driver_id !== driverId) {
    return { error: 'Access denied. You are not assigned to this trip.' };
  }

  // Calculate from transactions
  const txCalc = calculateFromTransactions(transactions);

  return {
    // Booking Info (no customer fare)
    bookingId: booking.booking_id,
    bookingNumber: booking.booking_number,
    bookingStatus: booking.status,

    // Driver Financials ONLY
    tripAmount: tripFinancial.driver_payout,
    advanceReceived: txCalc.totalDriverAdvance + txCalc.totalFuelAdvance,
    fuelAdvance: txCalc.totalFuelAdvance,
    remainingAmount: (tripFinancial.driver_payout || 0) - txCalc.totalDriverAdvance - txCalc.totalFuelAdvance,
    paymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
    advances: transactions
      .filter(t => t.transaction_type === 'DRIVER_ADVANCE' || t.transaction_type === 'FUEL_ADVANCE')
      .map(t => ({ id: t.transaction_id, amount: t.amount, type: t.transaction_type, date: t.transaction_date, method: t.payment_method, reference: t.reference_number, notes: t.notes })),

    // NO customerFare
    // NO btMargin
    // NO commission
    // NO ownerSettlement
  };
}

/**
 * PHASE 7 — the trip transaction LEDGER projection.
 *
 * WHY THIS EXISTS
 *   `GET /api/trips/:tripId/transactions` was mounted behind `protect` alone,
 *   so ANY authenticated principal — a customer, a driver, a partner — could
 *   read the whole money ledger for a trip: the customer's freight, the
 *   driver's payout, the owner's share, advances, settlements and commission.
 *   That is exactly the "customer must NOT see vendor payable / commission /
 *   internal margins" rule.
 *
 *   Rather than change the shape admins get (the admin trip UI reads these
 *   rows directly), this is an explicit ALLOW-LIST projection: a caller sees
 *   only the money that concerns their own side of the trip, and nothing is
 *   returned by default. It is an allow list, not a deny list, so a new
 *   transaction type is invisible to a non-admin until someone consciously
 *   adds it.
 *
 * @param {Array} transactions - FinancialTransaction rows
 * @param {'ADMIN'|'TRANSPORT_OWNER'|'DRIVER'|'CUSTOMER'} role
 * @param {Object} user - requesting principal (for driver_id / owner_id)
 * @returns {Array} rows safe to serialise to this role
 */
function projectTransactionsForRole(transactions, role, user = null) {
  if (role === 'ADMIN') return transactions;

  // The columns a row legitimately needs to render. Nothing internal, no
  // trip_financial_id, no created_by, no free-text notes, no metadata.
  const shape = (tx) => ({
    transaction_id: tx.transaction_id,
    trip_id: tx.trip_id,
    transaction_date: tx.transaction_date,
    transaction_type: tx.transaction_type,
    direction: tx.direction,
    amount: tx.amount,
    from_party: tx.from_party,
    to_party: tx.to_party,
    payment_method: tx.payment_method,
    reference_number: tx.reference_number,
  });

  if (role === 'CUSTOMER') {
    // The customer sees their OWN money only: what they were billed and what
    // they paid. No vendor payable, no commission, no internal margin, no
    // driver or owner figures.
    return transactions
      .filter(
        (t) =>
          t.transaction_type === 'CUSTOMER_PAYMENT' ||
          t.transaction_type === 'CLIENT_PAYMENT' ||
          t.transaction_type === 'REVERSAL' ||
          t.transaction_type === 'REFUND'
      )
      .map((t) => ({
        ...shape(t),
        // A reversal is BT-side bookkeeping; the customer only needs that the
        // payment it points at was undone, not the internal link.
        transaction_type: t.transaction_type,
      }));
  }

  if (role === 'DRIVER') {
    // A driver sees only advances and settlements made to them. They are
    // checked against the trip's own driver id by the caller.
    return transactions
      .filter(
        (t) =>
          t.transaction_type === 'DRIVER_ADVANCE' ||
          t.transaction_type === 'FUEL_ADVANCE' ||
          t.transaction_type === 'DRIVER_SETTLEMENT'
      )
      .map(shape);
  }

  if (role === 'TRANSPORT_OWNER') {
    // An owner sees only money that moved to or for the owner. They never see
    // the customer's freight or BT commission.
    return transactions
      .filter(
        (t) =>
          t.transaction_type === 'OWNER_ADVANCE' ||
          t.transaction_type === 'OWNER_SETTLEMENT'
      )
      .map(shape);
  }

  return [];
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
  calculateFromTransactions,
  projectTransactionsForRole,
};
