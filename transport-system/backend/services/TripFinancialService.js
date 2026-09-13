/**
 * TripFinancialService
 * Business logic for trip financial calculations and management.
 *
 * PHASE 3 REDESIGN: FinancialTransaction is the SINGLE SOURCE OF TRUTH.
 * All financial calculations are derived from FinancialTransaction records.
 * TripFinancial cached fields are updated from transactions.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripAdvanceRepository = require('../repositories/TripAdvanceRepository');
const TripSettlementRepository = require('../repositories/TripSettlementRepository');
const CommissionRecordRepository = require('../repositories/CommissionRecordRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const CommissionCalculator = require('./CommissionCalculator');
const commissionPolicy = require('../config/commissionPolicy');

class TripFinancialService {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma] - Optional Prisma client (for transaction support)
   */
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
    this.tripFinancialRepo = new TripFinancialRepository();
    this.tripAdvanceRepo = new TripAdvanceRepository();
    this.tripSettlementRepo = new TripSettlementRepository();
    this.commissionRepo = new CommissionRecordRepository();
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Initialize trip financial record when booking is confirmed.
   * @param {number} bookingId
   * @param {Object} admin - Admin user performing the action
   * @returns {Promise<Object>}
   */
  async initializeTripFinancial(bookingId, admin = null) {
    const tripFinancial = await this.tripFinancialRepo.findOrCreateByBookingId(bookingId);

    if (tripFinancial.status === 'DRAFT') {
      await this.tripFinancialRepo.update(tripFinancial.trip_financial_id, {
        status: 'CALCULATED',
        calculated_by: admin?.user_id || null,
        calculated_at: new Date(),
      });
    }

    return tripFinancial;
  }

  /**
   * Calculate and update trip financial summary from FinancialTransaction ledger.
   * This is the core calculation engine - ALL values come from transactions.
   *
   * @param {number} bookingId
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async calculateTripFinancial(bookingId, options = {}) {
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      throw new NotFoundError('Trip financial record not found');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        final_price: true,
        driver_payout: true,
        owner_settlement_amount: true,
        commission_percentage: true,
        commission_amount: true,
        commission_type: true,
      },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // Get all transactions for this trip financial - THE SINGLE SOURCE OF TRUTH
    const transactions = await this.financialTxRepo.findByBookingId(bookingId);

    // Calculate from transactions
    const txCalculations = this._calculateFromTransactions(transactions);

    // Commission calculation
    const policyRate = commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE;
    const policyType = commissionPolicy.DEFAULT_COMMISSION_TYPE;
    const hasSnapshot = booking.commission_percentage !== null && booking.commission_percentage !== undefined;
    const commissionRate = hasSnapshot ? booking.commission_percentage : policyRate;
    const commissionBase = booking.final_price || 0;
    let commissionAmount;
    try {
      commissionAmount = CommissionCalculator.computeCommission({
        base: commissionBase,
        rate: commissionRate,
        type: booking.commission_type || policyType,
      });
    } catch (calcErr) {
      commissionAmount = 0;
    }

    const ownerPayableShare = booking.owner_settlement_amount || (commissionBase - commissionAmount);
    const customerFare = booking.final_price || 0;
    const driverPayout = booking.driver_payout || 0;
    const btMargin = customerFare - driverPayout - commissionAmount;

    // Update trip financial with calculated values
    const updated = await this.tripFinancialRepo.update(tripFinancial.trip_financial_id, {
      customer_fare: customerFare,
      driver_payout: driverPayout,
      owner_settlement_amount: ownerPayableShare || booking.owner_settlement_amount,
      total_advance: txCalculations.totalDriverAdvance,
      total_fuel_advance: txCalculations.totalFuelAdvance,
      total_owner_advance: txCalculations.totalOwnerAdvance,
      remaining_driver_settlement: driverPayout - txCalculations.totalDriverAdvance - txCalculations.totalFuelAdvance,
      remaining_owner_settlement: (ownerPayableShare || 0) - txCalculations.totalOwnerAdvance,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      bt_margin: btMargin,
      status: 'CALCULATED',
    });

    // Create commission record only if missing
    const existingCommission = await this.commissionRepo.findLatestByBookingId(bookingId);
    if (!existingCommission && commissionAmount > 0) {
      await this.commissionRepo.create({
        trip_financial_id: tripFinancial.trip_financial_id,
        booking_id: bookingId,
        commission_rate: commissionRate,
        commission_type: booking.commission_type || policyType,
        commission_base: commissionBase,
        commission_amount: commissionAmount,
        applied_by: options.admin_id || null,
        notes: options.notes || null,
      });
    }

    // Create or update settlement record
    const settlement = await this.tripSettlementRepo.findOrCreateByBookingId(
      bookingId,
      tripFinancial.trip_financial_id
    );

    return updated;
  }

  /**
   * Calculate financial values from FinancialTransaction records.
   * This is the SINGLE SOURCE OF TRUTH calculation.
   * Expenses are excluded from the trip financial workflow.
   */
  _calculateFromTransactions(transactions) {
    const result = {
      totalDriverAdvance: 0,
      totalFuelAdvance: 0,
      totalOwnerAdvance: 0,
      totalCustomerPayments: 0,
      totalClientPayments: 0,
      totalOwnerSettlements: 0,
      totalDriverSettlements: 0,
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
        // TRIP_EXPENSE is intentionally excluded from trip financial calculations
      }
    }

    return result;
  }

  /**
   * Get trip financial summary for a specific role.
   * All values are derived from FinancialTransaction records.
   */
  async getTripFinancialSummary(bookingId, role, user = null) {
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      await this.initializeTripFinancial(bookingId, user);
      return this.getTripFinancialSummary(bookingId, role, user);
    }

    const booking = tripFinancial.booking;
    const transactions = tripFinancial.transactions || [];
    const settlements = tripFinancial.settlements || [];
    const commissions = tripFinancial.commissions || [];

    // Calculate from transactions - SINGLE SOURCE OF TRUTH
    const txCalc = this._calculateFromTransactions(transactions);

    const base = {
      bookingId: booking.booking_id,
      bookingNumber: booking.booking_number,
      status: booking.status,
      tripStatus: tripFinancial.status,
      tripId: tripFinancial.trip?.trip_id || null,
      tripFinancialId: tripFinancial.trip_financial_id,
    };

    switch (role) {
      case 'ADMIN':
        return {
          ...base,
          // Customer Financials
          customerFare: tripFinancial.customer_fare,
          amountReceived: txCalc.totalCustomerPayments + txCalc.totalClientPayments,
          paymentStatus: this._getPaymentStatus(booking.final_price, txCalc.totalCustomerPayments + txCalc.totalClientPayments),
          paymentMethod: this._getPaymentMethod(transactions),
          outstandingAmount: this._getOutstandingAmount(booking.final_price, txCalc.totalCustomerPayments + txCalc.totalClientPayments),

          // Driver Financials
          driverPayout: tripFinancial.driver_payout,
          driverAdvance: txCalc.totalDriverAdvance,
          fuelAdvance: txCalc.totalFuelAdvance,
          remainingDriverSettlement: (tripFinancial.driver_payout || 0) - txCalc.totalDriverAdvance - txCalc.totalFuelAdvance,
          driverPaymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
          driverAdvances: transactions
            .filter(t => t.transaction_type === 'DRIVER_ADVANCE')
            .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method })),

          // Owner Financials
          ownerSettlement: tripFinancial.owner_settlement_amount,
          ownerAdvance: txCalc.totalOwnerAdvance,
          remainingOwnerSettlement: (tripFinancial.owner_settlement_amount || 0) - txCalc.totalOwnerAdvance,
          ownerPaymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
          ownerAdvances: transactions
            .filter(t => t.transaction_type === 'OWNER_ADVANCE')
            .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method })),

          // Commission
          commissionRate: tripFinancial.commission_rate,
          commissionAmount: tripFinancial.commission_amount,
          commissionType: commissions[0]?.commission_type || 'percentage',

          // BT Internal Financials (ADMIN ONLY)
          btMargin: tripFinancial.bt_margin,
          btRevenue: tripFinancial.commission_amount,
          ownerShare: Math.max(0, (booking.final_price || 0) - (tripFinancial.commission_amount || 0)),
          totalOperationalCost: 0,

          // All transactions for money flow
          transactions: transactions,
          balances: {
            customer: { received: txCalc.totalCustomerPayments },
            client: { received: txCalc.totalClientPayments },
            owner: {
              advance: txCalc.totalOwnerAdvance,
              settlement: txCalc.totalOwnerSettlements,
              payout: tripFinancial.owner_settlement_amount || 0,
            },
            driver: {
              advance: txCalc.totalDriverAdvance + txCalc.totalFuelAdvance,
              settlement: txCalc.totalDriverSettlements,
              payout: tripFinancial.driver_payout || 0,
            },
          },
        };

      case 'TRANSPORT_OWNER':
        if (user && booking.vehicle_owner_id !== user.owner_id) {
          throw new ValidationError('Access denied. You do not own this trip.');
        }

        return {
          ...base,
          tripAmount: tripFinancial.owner_settlement_amount,
          advance: txCalc.totalOwnerAdvance,
          remainingSettlement: (tripFinancial.owner_settlement_amount || 0) - txCalc.totalOwnerAdvance,
          paymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
          advances: transactions
            .filter(t => t.transaction_type === 'OWNER_ADVANCE')
            .map(t => ({ id: t.transaction_id, amount: t.amount, date: t.transaction_date, method: t.payment_method })),
        };

      case 'DRIVER':
        if (user && booking.driver_id !== user.driver_id) {
          throw new ValidationError('Access denied. You are not assigned to this trip.');
        }

        return {
          ...base,
          tripAmount: tripFinancial.driver_payout,
          advanceReceived: txCalc.totalDriverAdvance + txCalc.totalFuelAdvance,
          fuelAdvance: txCalc.totalFuelAdvance,
          remainingAmount: (tripFinancial.driver_payout || 0) - txCalc.totalDriverAdvance - txCalc.totalFuelAdvance,
          paymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
          advances: transactions
            .filter(t => t.transaction_type === 'DRIVER_ADVANCE' || t.transaction_type === 'FUEL_ADVANCE')
            .map(t => ({ id: t.transaction_id, amount: t.amount, type: t.transaction_type, date: t.transaction_date, method: t.payment_method })),
        };

      default:
        throw new ValidationError('Invalid role specified');
    }
  }

  /**
   * Get trip financial timeline (chronological events from transactions).
   */
  async getTripFinancialTimeline(bookingId, role, user = null) {
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      return [];
    }

    const events = [];
    const transactions = tripFinancial.transactions || [];
    const booking = tripFinancial.booking;

    // Booking events
    if (booking.created_at) {
      events.push({
        timestamp: booking.created_at,
        event: 'Booking created',
        type: 'booking',
        roleVisibility: ['ADMIN', 'TRANSPORT_OWNER', 'DRIVER'],
      });
    }

    if (booking.confirmed_at) {
      events.push({
        timestamp: booking.confirmed_at,
        event: 'Trip confirmed',
        type: 'booking',
        roleVisibility: ['ADMIN', 'TRANSPORT_OWNER', 'DRIVER'],
      });
    }

    // Transactions
    for (const tx of transactions) {
      const event = {
        timestamp: tx.transaction_date || tx.created_at,
        event: `${this._formatTransactionType(tx.transaction_type)}: ₹${tx.amount.toLocaleString()}`,
        type: tx.transaction_type.toLowerCase(),
        amount: tx.amount,
        method: tx.payment_method,
        from_party: tx.from_party,
        to_party: tx.to_party,
        direction: tx.direction,
        roleVisibility: this._getTransactionVisibility(tx.transaction_type),
      };
      events.push(event);
    }

    // Commission
    for (const commission of tripFinancial.commissions || []) {
      events.push({
        timestamp: commission.applied_at,
        event: `Commission (${commission.commission_rate}%): ₹${commission.commission_amount.toLocaleString()}`,
        type: 'commission',
        amount: commission.commission_amount,
        rate: commission.commission_rate,
        roleVisibility: ['ADMIN'],
      });
    }

    // BT Margin
    if (tripFinancial.bt_margin !== null && tripFinancial.bt_margin !== undefined) {
      events.push({
        timestamp: tripFinancial.calculated_at,
        event: `BT Margin calculated: ₹${tripFinancial.bt_margin.toLocaleString()}`,
        type: 'bt_margin',
        amount: tripFinancial.bt_margin,
        roleVisibility: ['ADMIN'],
      });
    }

    // Filter by role
    return events
      .filter(e => e.roleVisibility.includes(role))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Get visibility for a transaction type.
   */
  _getTransactionVisibility(transactionType) {
    switch (transactionType) {
      case 'DRIVER_ADVANCE':
      case 'FUEL_ADVANCE':
      case 'DRIVER_SETTLEMENT':
        return ['ADMIN', 'DRIVER'];
      case 'OWNER_ADVANCE':
      case 'OWNER_SETTLEMENT':
        return ['ADMIN', 'TRANSPORT_OWNER'];
      case 'CUSTOMER_PAYMENT':
      case 'CLIENT_PAYMENT':
        return ['ADMIN'];
      case 'TRIP_EXPENSE':
        return ['ADMIN'];
      default:
        return ['ADMIN'];
    }
  }

  /**
   * Format transaction type for display.
   */
  _formatTransactionType(type) {
    const map = {
      CUSTOMER_PAYMENT: 'Customer Payment',
      CLIENT_PAYMENT: 'Client Payment',
      DRIVER_ADVANCE: 'Driver Advance',
      FUEL_ADVANCE: 'Fuel Advance',
      OWNER_ADVANCE: 'Owner Advance',
      DRIVER_SETTLEMENT: 'Driver Settlement',
      OWNER_SETTLEMENT: 'Owner Settlement',
      COMMISSION: 'Commission',
      TRIP_EXPENSE: 'Trip Expense',
      EXPENSE_REIMBURSEMENT: 'Expense Reimbursement',
      ADJUSTMENT: 'Adjustment',
      REFUND: 'Refund',
      REVERSAL: 'Reversal',
    };
    return map[type] || type;
  }

  /**
   * Helper: Get payment status.
   */
  _getPaymentStatus(totalAmount, paid) {
    if (paid >= totalAmount && totalAmount > 0) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return 'PENDING';
  }

  /**
   * Helper: Get payment method.
   */
  _getPaymentMethod(transactions) {
    const paidTx = transactions.find(t => (t.transaction_type === 'CUSTOMER_PAYMENT' || t.transaction_type === 'CLIENT_PAYMENT') && t.direction === 'CREDIT');
    return paidTx?.payment_method || null;
  }

  /**
   * Helper: Get outstanding amount.
   */
  _getOutstandingAmount(totalAmount, paid) {
    return Math.max(0, totalAmount - paid);
  }
}

module.exports = TripFinancialService;
