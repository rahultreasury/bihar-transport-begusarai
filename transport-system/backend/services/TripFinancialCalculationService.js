/**
 * TripFinancialCalculationService
 * Centralized financial calculations for trips.
 * All financial values are calculated from FinancialTransaction records.
 *
 * PHASE 3 REDESIGN: FinancialTransaction is the SINGLE SOURCE OF TRUTH.
 * All calculations derive from the transaction ledger.
 *
 * PHASE 3 — Bihar Transport broker model:
 *   Freight / GMV  →  5% BT Commission  →  95% Owner Share
 *   BT Net Profit  =  BT Commission  −  BT Expenses
 *   Owner Share is NOT a BT expense.
 *   Profit is NEVER computed as Freight − Expenses.
 *
 * The commission rate is resolved through the authoritative policy module
 * (config/commissionPolicy.js) via CommissionCalculator.deriveCommission.
 * 5% is never hardcoded here.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const CommissionCalculator = require('./CommissionCalculator');

// ExpensePaidBy values that count as Bihar Transport expenses.
// Only these reduce BT Net Profit.
const BT_EXPENSE_PAYER = 'BIHAR_TRANSPORT';

class TripFinancialCalculationService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma] - Optional Prisma client (for transaction support)
   */
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
  }

  /**
   * Calculate complete financial summary for a trip.
   * All values are derived from FinancialTransaction records.
   *
   * Returns the 9 canonical fields required by the Phase 3 model:
   *   1. freight          — Freight / GMV
   *   2. btCommission     — BT Commission (fixed 5%)
   *   3. ownerShare       — Owner Share (freight − commission)
   *   4. customerCollected — Customer Amount Collected
   *   5. customerDue      — Customer Amount Due
   *   6. ownerPaid        — Owner Amount Paid
   *   7. ownerPayable     — Owner Amount Payable
   *   8. btExpenses       — BT Expenses (only paid_by = BIHAR_TRANSPORT)
   *   9. btNetProfit      — BT Net Profit (commission − btExpenses)
   *
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Complete financial summary
   */
  async calculateTripFinancials(tripId) {
    // Get the trip with all related data
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: {
        financialTransactions: true,
        payments: true,
      },
    });

    if (!trip) {
      throw new Error('Trip not found');
    }

    return this._computeFinancials(trip);
  }

  /**
   * Internal: compute the full financial breakdown from a trip object
   * using FinancialTransaction records as the single source of truth.
   *
   * @param {Object} trip - Prisma trip row with `financialTransactions` include
   * @returns {Object} Financial summary
   */
  _computeFinancials(trip) {
    const freightAmount = Number(trip.freight_amount) || 0;

    // --- Commission (authoritative policy, never hardcoded) ---
    const derived = CommissionCalculator.deriveCommission({ trip });
    const btCommission = derived.commissionAmount;
    const ownerShare = derived.ownerShare;

    // --- Calculate from FinancialTransaction records ---
    const transactions = trip.financialTransactions || [];
    const txCalc = this._calculateFromTransactions(transactions);

    // --- ALSO include TripPayment records as fallback for payments that were
    // recorded before the FinancialTransaction ledger was populated.
    // This ensures the canonical calculation is the single source of truth.
    let tripPaymentFallback = 0;
    if (trip.payments && trip.payments.length > 0) {
      for (const p of trip.payments) {
        const cat = (p.payment_category || '').toUpperCase();
        if (cat === 'CLIENT_PAYMENT' || cat === 'CUSTOMER_PAYMENT' || cat === 'CUSTOMER') {
          tripPaymentFallback += Number(p.amount) || 0;
        }
      }
    }

    // --- Payments (from transactions, with TripPayment fallback) ---
    const ledgerCustomerCollected = txCalc.totalCustomerPayments + txCalc.totalClientPayments;
    const customerCollected = Math.max(ledgerCustomerCollected, tripPaymentFallback);
    const ownerPaid = txCalc.totalOwnerSettlements + txCalc.totalOwnerAdvances;
    const driverPaid = txCalc.totalDriverSettlements + txCalc.totalDriverAdvances + txCalc.totalFuelAdvances;

    // --- Derived financial fields (Phase 3 model) ---
    // Customer Due = Freight - Total Customer/Client Payments
    // NEVER affected by owner advances, driver advances, settlements, or expenses.
    const customerDue = Math.max(0, freightAmount - customerCollected);
    const ownerPayable = ownerShare; // Owner is entitled to freight − commission
    const ownerPayableRemaining = Math.max(0, ownerPayable - ownerPaid);
    // BT Net Profit = BT Commission (expenses removed from trip financial workflow)
    const btNetProfit = btCommission;

    // --- Payment status (SEPARATE from trip status) ---
    const customerPaymentStatus = this._paymentStatus(freightAmount, customerCollected);
    const ownerPaymentStatus = this._paymentStatus(ownerPayable, ownerPaid);

    return {
      tripId: trip.trip_id,
      tripNumber: trip.trip_number,
      status: trip.status, // Trip status (PENDING, IN_TRANSIT, COMPLETED, CANCELLED)

      // 1. Freight / GMV
      freight: freightAmount,
      // 2. BT Commission
      btCommission,
      commissionRate: derived.commissionRate,
      commissionType: derived.commissionType,
      // 3. Owner Share
      ownerShare,
      // 4. Customer Amount Collected
      customerCollected,
      // 5. Customer Amount Due
      customerDue,
      // 6. Owner Amount Paid
      ownerPaid,
      // 7. Owner Amount Payable
      ownerPayable,
      ownerPayableRemaining,
      // 8. BT Net Profit (expenses removed from trip workflow)
      btNetProfit,

      // Payment status (separate from trip status)
      customerPaymentStatus,
      ownerPaymentStatus,

      // Driver side
      driverPayable: Number(trip.driver_payment) || 0,
      driverPaid,
      driverOutstanding: Math.max(0, (Number(trip.driver_payment) || 0) - driverPaid),

      // Payment summary
      paymentSummary: {
        clientPayments: txCalc.totalClientPayments > 0 ? 1 : 0,
        ownerPayments: txCalc.totalOwnerSettlements > 0 ? 1 : 0,
        driverPayments: txCalc.totalDriverSettlements > 0 ? 1 : 0,
        totalPayments: transactions.length,
      },
    };
  }

  /**
   * Calculate financial values from FinancialTransaction records.
   * This is the SINGLE SOURCE OF TRUTH calculation.
   * Expenses are excluded from the trip financial workflow.
   */
  _calculateFromTransactions(transactions) {
    const result = {
      totalDriverAdvances: 0,
      totalFuelAdvances: 0,
      totalOwnerAdvances: 0,
      totalCustomerPayments: 0,
      totalClientPayments: 0,
      totalOwnerSettlements: 0,
      totalDriverSettlements: 0,
    };

    for (const tx of transactions) {
      const amount = tx.amount || 0;

      switch (tx.transaction_type) {
        case 'DRIVER_ADVANCE':
          result.totalDriverAdvances += amount;
          break;
        case 'FUEL_ADVANCE':
          result.totalFuelAdvances += amount;
          break;
        case 'OWNER_ADVANCE':
          result.totalOwnerAdvances += amount;
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
        // TRIP_EXPENSE is intentionally excluded from trip financial calculations
      }
    }

    return result;
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

    const trips = await this.prisma.trip.findMany({
      where,
      include: {
        financialTransactions: true,
      },
    });

    let totalFreight = 0;
    let totalBtCommission = 0;
    let totalOwnerShare = 0;
    let totalCustomerCollected = 0;
    let totalCustomerDue = 0;
    let totalOwnerPaid = 0;
    let totalOwnerPayable = 0;
    let totalBtNetProfit = 0;
    let totalOwnerPayableRemaining = 0;

    for (const trip of trips) {
      const f = this._computeFinancials(trip);
      totalFreight += f.freight;
      totalBtCommission += f.btCommission;
      totalOwnerShare += f.ownerShare;
      totalCustomerCollected += f.customerCollected;
      totalCustomerDue += f.customerDue;
      totalOwnerPaid += f.ownerPaid;
      totalOwnerPayable += f.ownerPayable;
      totalBtNetProfit += f.btNetProfit;
      totalOwnerPayableRemaining += f.ownerPayableRemaining;
    }

    return {
      totalTrips: trips.length,
      totalFreight,
      totalCommission: totalBtCommission,
      totalBtRevenue: totalBtCommission,
      totalOwnerShare,
      totalCustomerCollected,
      totalCustomerDue,
      totalOwnerPaid,
      totalOwnerPayable,
      totalOwnerPayableRemaining,
      totalBtNetProfit,
      totalProfit: totalBtNetProfit,
      clientSide: {
        totalFreight,
        totalReceived: totalCustomerCollected,
        totalOutstanding: totalCustomerDue,
      },
      ownerSide: {
        totalShare: totalOwnerShare,
        totalPayable: totalOwnerPayable,
        totalPaid: totalOwnerPaid,
        totalOutstanding: totalOwnerPayableRemaining,
      },
    };
  }

  /**
   * Helper: determine payment status from amount vs collected.
   * Returns 'PAID', 'PARTIAL', or 'PENDING'.
   * This is SEPARATE from the Trip status (PENDING, IN_TRANSIT, etc.).
   */
  _paymentStatus(totalAmount, collected) {
    if (collected >= totalAmount && totalAmount > 0) return 'PAID';
    if (collected > 0) return 'PARTIAL';
    return 'PENDING';
  }
}

module.exports = TripFinancialCalculationService;
