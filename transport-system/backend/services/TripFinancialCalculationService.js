/**
 * TripFinancialCalculationService
 * Centralized financial calculations for trips.
 * All financial values are calculated from the Trip and its related records.
 *
 * This service ensures:
 * - Single source of truth for trip financials
 * - Consistent calculations across the application
 * - No disconnected finance systems
 */

const { prisma } = require('../config/prisma');

class TripFinancialCalculationService {
  /**
   * Calculate complete financial summary for a trip.
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Complete financial summary
   */
  async calculateTripFinancials(tripId) {
    // Get the trip with all related data
    const trip = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: {
        expenses: true,
        payments: true,
      },
    });

    if (!trip) {
      throw new Error('Trip not found');
    }

    // Calculate total expenses
    const totalExpenses = trip.expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

    // Calculate expenses by type
    const expensesByType = {};
    for (const expense of trip.expenses) {
      const type = expense.expense_type;
      expensesByType[type] = (expensesByType[type] || 0) + (expense.amount || 0);
    }

    // Calculate payments by category
    const clientPayments = trip.payments.filter(p => p.payment_category === 'CLIENT_PAYMENT');
    const ownerPayments = trip.payments.filter(p => p.payment_category === 'OWNER_PAYMENT');
    const driverPayments = trip.payments.filter(p => p.payment_category === 'DRIVER_PAYMENT');

    const totalClientPayments = clientPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalOwnerPayments = ownerPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalDriverPayments = driverPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Calculate financial values
    const freightAmount = trip.freight_amount || 0;
    const ownerPayable = trip.owner_payment || 0;
    const driverPayable = trip.driver_payment || 0;

    // Profit calculation
    const tripProfit = freightAmount - totalExpenses;

    // Outstanding calculations
    const clientOutstanding = freightAmount - totalClientPayments;
    const ownerOutstanding = ownerPayable - totalOwnerPayments;
    const driverOutstanding = driverPayable - totalDriverPayments;

    return {
      tripId: trip.trip_id,
      tripNumber: trip.trip_number,
      status: trip.status,
      freightAmount,
      totalExpenses,
      tripProfit,
      clientSide: {
        freight: freightAmount,
        received: totalClientPayments,
        outstanding: clientOutstanding,
      },
      ownerSide: {
        payable: ownerPayable,
        paid: totalOwnerPayments,
        outstanding: ownerOutstanding,
      },
      driverSide: {
        payable: driverPayable,
        paid: totalDriverPayments,
        outstanding: driverOutstanding,
      },
      expenses: {
        diesel: expensesByType.DIESEL || 0,
        toll: expensesByType.TOLL || 0,
        loading: expensesByType.LOADING || 0,
        unloading: expensesByType.UNLOADING || 0,
        maintenance: expensesByType.MAINTENANCE || 0,
        other: expensesByType.OTHER || 0,
        driver: expensesByType.DRIVER || 0,
        owner: expensesByType.OWNER || 0,
        total: totalExpenses,
      },
      paymentSummary: {
        clientPayments: clientPayments.length,
        ownerPayments: ownerPayments.length,
        driverPayments: driverPayments.length,
        totalPayments: trip.payments.length,
      },
    };
  }

  /**
   * Get financial summary for multiple trips (for entity views).
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Object>} Aggregated financial summary
   */
  async calculateEntityFinancials(filters = {}) {
    const where = {};

    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.owner_id) where.transport_owner_id = filters.owner_id;
    if (filters.driver_id) where.driver_id = filters.driver_id;
    if (filters.vehicle_id) where.vehicle_id = filters.vehicle_id;

    const trips = await prisma.trip.findMany({
      where,
      include: {
        expenses: true,
        payments: true,
      },
    });

    let totalFreight = 0;
    let totalExpenses = 0;
    let totalClientPayments = 0;
    let totalOwnerPayments = 0;
    let totalDriverPayments = 0;
    let totalOwnerPayable = 0;
    let totalDriverPayable = 0;

    for (const trip of trips) {
      const tripExpenses = trip.expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
      const tripClientPayments = trip.payments
        .filter(p => p.payment_category === 'CLIENT_PAYMENT')
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      const tripOwnerPayments = trip.payments
        .filter(p => p.payment_category === 'OWNER_PAYMENT')
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      const tripDriverPayments = trip.payments
        .filter(p => p.payment_category === 'DRIVER_PAYMENT')
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      totalFreight += trip.freight_amount || 0;
      totalExpenses += tripExpenses;
      totalClientPayments += tripClientPayments;
      totalOwnerPayments += tripOwnerPayments;
      totalDriverPayments += tripDriverPayments;
      totalOwnerPayable += trip.owner_payment || 0;
      totalDriverPayable += trip.driver_payment || 0;
    }

    return {
      totalTrips: trips.length,
      totalFreight,
      totalExpenses,
      totalProfit: totalFreight - totalExpenses,
      clientSide: {
        totalFreight,
        totalReceived: totalClientPayments,
        totalOutstanding: totalFreight - totalClientPayments,
      },
      ownerSide: {
        totalPayable: totalOwnerPayable,
        totalPaid: totalOwnerPayments,
        totalOutstanding: totalOwnerPayable - totalOwnerPayments,
      },
      driverSide: {
        totalPayable: totalDriverPayable,
        totalPaid: totalDriverPayments,
        totalOutstanding: totalDriverPayable - totalDriverPayments,
      },
    };
  }

  /**
   * Update trip's cached payment totals.
   * Call this after adding/updating/deleting payments.
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Updated trip
   */
  async updateTripPaymentTotals(tripId) {
    const trip = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: { payments: true },
    });

    if (!trip) {
      throw new Error('Trip not found');
    }

    const clientReceived = trip.payments
      .filter(p => p.payment_category === 'CLIENT_PAYMENT')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const ownerPaid = trip.payments
      .filter(p => p.payment_category === 'OWNER_PAYMENT')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const driverPaid = trip.payments
      .filter(p => p.payment_category === 'DRIVER_PAYMENT')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    return prisma.trip.update({
      where: { trip_id: tripId },
      data: {
        client_received: clientReceived,
        owner_paid: ownerPaid,
        driver_paid: driverPaid,
      },
    });
  }
}

module.exports = TripFinancialCalculationService;
