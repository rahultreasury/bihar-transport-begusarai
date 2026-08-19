/**
 * TripFinancialService
 * Business logic for trip financial calculations and management.
 *
 * This is the single source of truth for trip financials.
 * All financial calculations flow through this service.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError } = require('../utils/AppError');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const TripAdvanceRepository = require('../repositories/TripAdvanceRepository');
const TripSettlementRepository = require('../repositories/TripSettlementRepository');
const CommissionRecordRepository = require('../repositories/CommissionRecordRepository');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripFinancialService {
  constructor() {
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

      // Create initial financial transaction for customer payment
      const booking = await prisma.booking.findUnique({
        where: { booking_id: bookingId },
        select: { final_price: true, driver_payout: true, commission_percentage: true },
      });

      if (booking?.final_price) {
        await this.financialTxRepo.create({
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: bookingId,
          transaction_type: 'CUSTOMER_PAYMENT',
          amount: booking.final_price,
          direction: 'CREDIT',
          status: 'PAID',
          created_by: admin?.user_id || null,
        });
      }
    }

    return tripFinancial;
  }

  /**
   * Calculate and update trip financial summary.
   * This is the core calculation engine.
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

    const booking = await prisma.booking.findUnique({
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

    // Get all advances
    const advances = await this.tripAdvanceRepo.findByBookingId(bookingId);
    const totalDriverAdvance = advances
      .filter(a => a.advance_type === 'DRIVER_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);
    const totalFuelAdvance = advances
      .filter(a => a.advance_type === 'FUEL_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);
    const totalOwnerAdvance = advances
      .filter(a => a.advance_type === 'OWNER_ADVANCE')
      .reduce((sum, a) => sum + a.amount, 0);

    // Calculate commission
    const commissionRate = booking.commission_percentage || 5;
    const commissionBase = booking.final_price || 0;
    const commissionAmount = booking.commission_amount || (commissionBase * commissionRate / 100);

    // Calculate BT Margin (ADMIN ONLY)
    const customerFare = booking.final_price || 0;
    const driverPayout = booking.driver_payout || 0;
    const btMargin = customerFare - driverPayout - commissionAmount;

    // Calculate remaining settlements
    const remainingDriverSettlement = driverPayout - totalDriverAdvance - totalFuelAdvance;
    const remainingOwnerSettlement = (booking.owner_settlement_amount || 0) - totalOwnerAdvance;

    // Update trip financial
    const updated = await this.tripFinancialRepo.update(tripFinancial.trip_financial_id, {
      customer_fare: customerFare,
      driver_payout: driverPayout,
      owner_settlement_amount: booking.owner_settlement_amount,
      total_advance: totalDriverAdvance,
      total_fuel_advance: totalFuelAdvance,
      total_owner_advance: totalOwnerAdvance,
      remaining_driver_settlement: remainingDriverSettlement,
      remaining_owner_settlement: remainingOwnerSettlement,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      bt_margin: btMargin,
      status: 'CALCULATED',
    });

    // Create commission record if not exists
    const existingCommission = await this.commissionRepo.findLatestByBookingId(bookingId);
    if (!existingCommission && commissionAmount > 0) {
      await this.commissionRepo.create({
        trip_financial_id: tripFinancial.trip_financial_id,
        booking_id: bookingId,
        commission_rate: commissionRate,
        commission_type: booking.commission_type || 'percentage',
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
   * Get trip financial summary for a specific role.
   * This enforces role-based data visibility.
   *
   * @param {number} bookingId
   * @param {string} role - 'ADMIN', 'TRANSPORT_OWNER', 'DRIVER'
   * @param {Object} user - The requesting user
   * @returns {Promise<Object>}
   */
  async getTripFinancialSummary(bookingId, role, user = null) {
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      // Try to initialize if not exists
      await this.initializeTripFinancial(bookingId, user);
      return this.getTripFinancialSummary(bookingId, role, user);
    }

    const booking = tripFinancial.booking;
    const advances = tripFinancial.advances || [];
    const settlements = tripFinancial.settlements || [];
    const commissions = tripFinancial.commissions || [];
    const transactions = tripFinancial.transactions || [];

    // Base response (common to all roles)
    const base = {
      bookingId: booking.booking_id,
      bookingNumber: booking.booking_number,
      status: booking.status,
      tripStatus: tripFinancial.status,
    };

    // Role-specific responses
    switch (role) {
      case 'ADMIN':
        return {
          ...base,
          // Customer Financials
          customerFare: tripFinancial.customer_fare,
          amountReceived: transactions
            .filter(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID')
            .reduce((sum, t) => sum + t.amount, 0),
          paymentStatus: this._getPaymentStatus(booking.final_price, transactions),
          paymentMethod: this._getPaymentMethod(transactions),
          outstandingAmount: this._getOutstandingAmount(booking.final_price, transactions),

          // Driver Financials
          driverPayout: tripFinancial.driver_payout,
          driverAdvance: tripFinancial.total_advance,
          fuelAdvance: tripFinancial.total_fuel_advance,
          remainingDriverSettlement: tripFinancial.remaining_driver_settlement,
          driverPaymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
          driverAdvances: advances
            .filter(a => a.advance_type === 'DRIVER_ADVANCE')
            .map(a => ({ id: a.advance_id, amount: a.amount, date: a.given_at, method: a.payment_method })),

          // Owner Financials
          ownerSettlement: tripFinancial.owner_settlement_amount,
          ownerAdvance: tripFinancial.total_owner_advance,
          remainingOwnerSettlement: tripFinancial.remaining_owner_settlement,
          ownerPaymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
          ownerAdvances: advances
            .filter(a => a.advance_type === 'OWNER_ADVANCE')
            .map(a => ({ id: a.advance_id, amount: a.amount, date: a.given_at, method: a.payment_method })),

          // Commission
          commissionRate: tripFinancial.commission_rate,
          commissionAmount: tripFinancial.commission_amount,
          commissionType: commissions[0]?.commission_type || 'percentage',

          // BT Internal Financials (ADMIN ONLY)
          btMargin: tripFinancial.bt_margin,
          totalOperationalCost: tripFinancial.driver_payout + tripFinancial.commission_amount,
        };

      case 'TRANSPORT_OWNER':
        // Verify user owns this booking
        if (user && booking.vehicle_owner_id !== user.owner_id) {
          throw new ValidationError('Access denied. You do not own this trip.');
        }

        return {
          ...base,
          // Owner sees only their business info
          tripAmount: tripFinancial.owner_settlement_amount,
          advance: tripFinancial.total_owner_advance,
          remainingSettlement: tripFinancial.remaining_owner_settlement,
          paymentStatus: settlements[0]?.owner_settlement_status || 'PENDING',
          advances: advances
            .filter(a => a.advance_type === 'OWNER_ADVANCE')
            .map(a => ({ id: a.advance_id, amount: a.amount, date: a.given_at, method: a.payment_method })),
          // NO btMargin, NO customerFare, NO commission
        };

      case 'DRIVER':
        // Verify user is the driver for this booking
        if (user && booking.driver_id !== user.driver_id) {
          throw new ValidationError('Access denied. You are not assigned to this trip.');
        }

        return {
          ...base,
          // Driver sees only their payment info
          tripAmount: tripFinancial.driver_payout,
          advanceReceived: tripFinancial.total_advance,
          fuelAdvance: tripFinancial.total_fuel_advance,
          remainingAmount: tripFinancial.remaining_driver_settlement,
          paymentStatus: settlements[0]?.driver_settlement_status || 'PENDING',
          advances: advances
            .filter(a => a.advance_type === 'DRIVER_ADVANCE' || a.advance_type === 'FUEL_ADVANCE')
            .map(a => ({ id: a.advance_id, amount: a.amount, type: a.advance_type, date: a.given_at, method: a.payment_method })),
          // NO customerFare, NO btMargin, NO commission
        };

      default:
        throw new ValidationError('Invalid role specified');
    }
  }

  /**
   * Get trip financial timeline (chronological events).
   * @param {number} bookingId
   * @param {string} role
   * @param {Object} user
   * @returns {Promise<Array>}
   */
  async getTripFinancialTimeline(bookingId, role, user = null) {
    const tripFinancial = await this.tripFinancialRepo.findByBookingId(bookingId);
    if (!tripFinancial) {
      return [];
    }

    const events = [];
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

    // Advances
    for (const advance of tripFinancial.advances || []) {
      const visibleTo = advance.advance_type === 'DRIVER_ADVANCE' || advance.advance_type === 'FUEL_ADVANCE'
        ? ['ADMIN', 'DRIVER']
        : ['ADMIN', 'TRANSPORT_OWNER'];

      events.push({
        timestamp: advance.given_at,
        event: `${this._formatAdvanceType(advance.advance_type)}: ₹${advance.amount.toLocaleString()}`,
        type: 'advance',
        advanceType: advance.advance_type,
        amount: advance.amount,
        method: advance.payment_method,
        roleVisibility: visibleTo,
      });
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

    // Settlements
    const settlement = tripFinancial.settlements?.[0];
    if (settlement) {
      if (settlement.driver_settlement_paid_at) {
        events.push({
          timestamp: settlement.driver_settlement_paid_at,
          event: `Driver settlement paid: ₹${settlement.driver_settlement_amount?.toLocaleString() || 0}`,
          type: 'settlement',
          amount: settlement.driver_settlement_amount,
          roleVisibility: ['ADMIN', 'DRIVER'],
        });
      }
      if (settlement.owner_settlement_paid_at) {
        events.push({
          timestamp: settlement.owner_settlement_paid_at,
          event: `Owner settlement paid: ₹${settlement.owner_settlement_amount?.toLocaleString() || 0}`,
          type: 'settlement',
          amount: settlement.owner_settlement_amount,
          roleVisibility: ['ADMIN', 'TRANSPORT_OWNER'],
        });
      }
    }

    // BT Margin calculation
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
   * Helper: Get payment status.
   */
  _getPaymentStatus(totalAmount, transactions) {
    const paid = transactions
      .filter(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID')
      .reduce((sum, t) => sum + t.amount, 0);

    if (paid >= totalAmount) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return 'PENDING';
  }

  /**
   * Helper: Get payment method.
   */
  _getPaymentMethod(transactions) {
    const paidTx = transactions.find(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID');
    return paidTx?.payment_method || null;
  }

  /**
   * Helper: Get outstanding amount.
   */
  _getOutstandingAmount(totalAmount, transactions) {
    const paid = transactions
      .filter(t => t.transaction_type === 'CUSTOMER_PAYMENT' && t.status === 'PAID')
      .reduce((sum, t) => sum + t.amount, 0);

    return Math.max(0, totalAmount - paid);
  }

  /**
   * Helper: Format advance type for display.
   */
  _formatAdvanceType(type) {
    const map = {
      DRIVER_ADVANCE: 'Driver Advance',
      FUEL_ADVANCE: 'Fuel Advance',
      OWNER_ADVANCE: 'Owner Advance',
      OTHER: 'Other Advance',
    };
    return map[type] || type;
  }
}

module.exports = TripFinancialService;
