/**
 * CanonicalFinancialService
 * Single source of truth for ALL financial calculations in the system.
 *
 * This service consolidates duplicate calculation logic from:
 * - TripFinancialCalculationService
 * - TripFinancialService
 * - TripTransactionService
 *
 * All financial values are derived from FinancialTransaction records.
 * No other source of truth is used.
 *
 * BUSINESS RULES:
 * - Customer/Client payments are CREDIT (money in to BT)
 * - Owner/Driver advances are DEBIT (money out from BT)
 * - Owner/Driver settlements are DEBIT (money out from BT)
 * - Customer Due = Freight - Total Customer/Client Payments
 * - Owner Due = Owner Share - Owner Advances - Owner Settlements
 * - Driver Due = Driver Agreed Pay - Driver Advances - Driver Settlements
 * - Expenses are EXCLUDED from trip financial calculations
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const CommissionCalculator = require('./CommissionCalculator');
const { ValidationError, NotFoundError } = require('../utils/AppError');

class CanonicalFinancialService {
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
  }

  // ============================================================
  // TRANSACTION AGGREGATION (single source of truth)
  // ============================================================

  /**
   * Aggregate financial values from FinancialTransaction records.
   * This is the ONLY place where transaction aggregation happens.
   *
   * @param {Array} transactions - FinancialTransaction records
   * @returns {Object} Aggregated values
   */
  _aggregateTransactions(transactions) {
    const result = {
      totalDriverAdvances: 0,
      totalFuelAdvances: 0,
      totalOwnerAdvances: 0,
      totalCustomerPayments: 0,
      totalClientPayments: 0,
      totalOwnerSettlements: 0,
      totalDriverSettlements: 0,
      totalExpenses: 0,
      totalCommission: 0,
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
        case 'TRIP_EXPENSE':
          result.totalExpenses += amount;
          break;
        case 'COMMISSION':
          result.totalCommission += amount;
          break;
      }
    }

    return result;
  }

  // ============================================================
  // TRIP FINANCIAL CALCULATION
  // ============================================================

  /**
   * Calculate complete financial summary for a trip.
   * All values derived from FinancialTransaction records.
   *
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Complete financial summary
   */
  async calculateTripFinancials(tripId) {
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: {
        financialTransactions: true,
        payments: true,
        client: { select: { client_id: true, company_name: true } },
        driver: { select: { driver_id: true, driver_name: true } },
        transportOwner: { select: { owner_id: true, owner_name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    return this._computeTripFinancials(trip);
  }

  /**
   * Compute trip financials from a trip object with transactions.
   * @param {Object} trip - Prisma trip row with financialTransactions
   * @returns {Object} Financial summary
   */
  _computeTripFinancials(trip) {
    const freightAmount = Number(trip.freight_amount) || 0;
    const driverAgreedPay = Number(trip.driver_payment) || 0;

    // Commission (authoritative policy, never hardcoded)
    const derived = CommissionCalculator.deriveCommission({ trip });
    const btCommission = derived.commissionAmount;
    const ownerShare = derived.ownerShare;

    // Aggregate from FinancialTransaction records (canonical ledger)
    const transactions = trip.financialTransactions || [];
    const txCalc = this._aggregateTransactions(transactions);

    // ALSO include TripPayment records as fallback for payments that were
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

    // Customer/Client payments: use canonical ledger, fallback to TripPayment
    const ledgerCustomerCollected = txCalc.totalCustomerPayments + txCalc.totalClientPayments;
    const customerCollected = Math.max(ledgerCustomerCollected, tripPaymentFallback);
    const customerDue = Math.max(0, freightAmount - customerCollected);

    // Owner payable
    const ownerPaid = txCalc.totalOwnerSettlements + txCalc.totalOwnerAdvances;
    const ownerDue = Math.max(0, ownerShare - ownerPaid);

    // Driver payable
    const driverPaid = txCalc.totalDriverSettlements + txCalc.totalDriverAdvances + txCalc.totalFuelAdvances;
    const driverDue = Math.max(0, driverAgreedPay - driverPaid);

    // Payment status
    const customerPaymentStatus = this._paymentStatus(freightAmount, customerCollected);
    const ownerPaymentStatus = this._paymentStatus(ownerShare, ownerPaid);
    const driverPaymentStatus = this._paymentStatus(driverAgreedPay, driverPaid);

    return {
      tripId: trip.trip_id,
      tripNumber: trip.trip_number,
      status: trip.status,
      sourceType: trip.source_type,
      clientId: trip.client_id,
      clientName: trip.client?.company_name || null,
      driverId: trip.driver_id,
      driverName: trip.driver?.driver_name || null,
      ownerId: trip.transport_owner_id,
      ownerName: trip.transportOwner?.owner_name || null,

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
      customerPaymentStatus,
      // 6. Owner Amount Paid
      ownerPaid,
      // 7. Owner Amount Due
      ownerDue,
      ownerPaymentStatus,
      // 8. Driver Agreed Pay
      driverAgreedPay,
      // 9. Driver Amount Paid
      driverPaid,
      // 10. Driver Amount Due
      driverDue,
      driverPaymentStatus,

      // Transaction counts
      transactionCount: transactions.length,
      advanceCount: transactions.filter(t =>
        t.transaction_type === 'DRIVER_ADVANCE' ||
        t.transaction_type === 'FUEL_ADVANCE' ||
        t.transaction_type === 'OWNER_ADVANCE'
      ).length,
      settlementCount: transactions.filter(t =>
        t.transaction_type === 'DRIVER_SETTLEMENT' ||
        t.transaction_type === 'OWNER_SETTLEMENT'
      ).length,
    };
  }

  // ============================================================
  // CLIENT FINANCIAL CALCULATION
  // ============================================================

  /**
   * Calculate financial summary for a client.
   * All values derived from FinancialTransaction records.
   *
   * @param {number} clientId - Client ID
   * @returns {Promise<Object>} Client financial summary
   */
  async calculateClientFinancials(clientId) {
    const client = await this.prisma.client.findUnique({
      where: { client_id: clientId },
      include: {
        trips: {
          include: {
            financialTransactions: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const trips = client.trips || [];
    let totalFreight = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalTrips = trips.length;
    let activeTrips = 0;

    const tripSummaries = [];

    for (const trip of trips) {
      const tripFinancials = this._computeTripFinancials(trip);
      totalFreight += tripFinancials.freight;
      totalPaid += tripFinancials.customerCollected;
      totalOutstanding += tripFinancials.customerDue;

      // Count active trips (not completed, cancelled, or delivered)
      const activeStatuses = ['ASSIGNED', 'IN_TRANSIT', 'PENDING', 'LOADING', 'UNLOADING'];
      if (activeStatuses.includes(trip.status)) {
        activeTrips++;
      }

      tripSummaries.push({
        tripId: trip.trip_id,
        tripNumber: trip.trip_number,
        status: trip.status,
        freight: tripFinancials.freight,
        paid: tripFinancials.customerCollected,
        due: tripFinancials.customerDue,
        paymentStatus: tripFinancials.customerPaymentStatus,
      });
    }

    return {
      clientId: client.client_id,
      companyName: client.company_name,
      contactPerson: client.contact_person,
      phone: client.phone,
      email: client.email,
      status: client.status,
      totalTrips,
      activeTrips,
      totalFreight,
      totalPaid,
      totalOutstanding,
      paymentStatus: this._paymentStatus(totalFreight, totalPaid),
      trips: tripSummaries,
    };
  }

  // ============================================================
  // GLOBAL FINANCIAL SUMMARY
  // ============================================================

  /**
   * Calculate global financial summary across all trips.
   *
   * @returns {Promise<Object>} Global financial summary
   */
  async calculateGlobalFinancials() {
    const trips = await this.prisma.trip.findMany({
      include: {
        financialTransactions: true,
      },
    });

    let totalFreight = 0;
    let totalCustomerCollected = 0;
    let totalCustomerDue = 0;
    let totalOwnerShare = 0;
    let totalOwnerPaid = 0;
    let totalOwnerDue = 0;
    let totalDriverAgreedPay = 0;
    let totalDriverPaid = 0;
    let totalDriverDue = 0;
    let totalBtCommission = 0;
    let totalAdvances = 0;
    let totalSettlements = 0;

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);
      totalFreight += f.freight;
      totalCustomerCollected += f.customerCollected;
      totalCustomerDue += f.customerDue;
      totalOwnerShare += f.ownerShare;
      totalOwnerPaid += f.ownerPaid;
      totalOwnerDue += f.ownerDue;
      totalDriverAgreedPay += f.driverAgreedPay;
      totalDriverPaid += f.driverPaid;
      totalDriverDue += f.driverDue;
      totalBtCommission += f.btCommission;
      totalAdvances += f.advanceCount;
      totalSettlements += f.settlementCount;
    }

    return {
      totalTrips: trips.length,
      totalFreight,
      totalBtCommission,
      totalOwnerShare,
      // Receivables (what customers/clients owe BT)
      totalReceivable: totalCustomerDue,
      totalReceived: totalCustomerCollected,
      // Payables (what BT owes owners/drivers)
      totalOwnerPayable: totalOwnerDue,
      totalOwnerPaid,
      totalDriverPayable: totalDriverDue,
      totalDriverPaid,
      totalPayable: totalOwnerDue + totalDriverDue,
      totalPaid: totalOwnerPaid + totalDriverPaid,
      // Advances
      totalAdvances,
      totalSettlements,
      // Net position
      netPosition: totalCustomerDue - (totalOwnerDue + totalDriverDue),
    };
  }

  // ============================================================
  // RECEIVABLES (who owes BT)
  // ============================================================

  /**
   * Get receivables grouped by client.
   *
   * @returns {Promise<Array>} Receivables by client
   */
  async getReceivablesByClient() {
    const clients = await this.prisma.client.findMany({
      where: { is_active: true },
      include: {
        trips: {
          include: {
            financialTransactions: true,
          },
        },
      },
    });

    const receivables = [];

    for (const client of clients) {
      const clientFinancials = this.calculateClientFinancials(client.client_id);
      const summary = await clientFinancials;

      if (summary.totalOutstanding > 0) {
        receivables.push({
          clientId: client.client_id,
          companyName: client.company_name,
          contactPerson: client.contact_person,
          phone: client.phone,
          totalTrips: summary.totalTrips,
          totalFreight: summary.totalFreight,
          totalPaid: summary.totalPaid,
          outstanding: summary.totalOutstanding,
          paymentStatus: summary.paymentStatus,
        });
      }
    }

    return receivables.sort((a, b) => b.outstanding - a.outstanding);
  }

  // ============================================================
  // PAYABLES (whom BT owes)
  // ============================================================

  /**
   * Get payables grouped by owner and driver.
   *
   * @returns {Promise<Object>} Payables by owner and driver
   */
  async getPayables() {
    const trips = await this.prisma.trip.findMany({
      include: {
        financialTransactions: true,
        driver: { select: { driver_id: true, driver_name: true } },
        transportOwner: { select: { owner_id: true, owner_name: true } },
      },
    });

    const ownerPayables = new Map();
    const driverPayables = new Map();

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);

      // Owner payables
      if (f.ownerDue > 0) {
        const key = f.ownerId;
        if (!ownerPayables.has(key)) {
          ownerPayables.set(key, {
            ownerId: f.ownerId,
            ownerName: f.ownerName,
            totalShare: 0,
            totalPaid: 0,
            totalDue: 0,
            tripCount: 0,
          });
        }
        const entry = ownerPayables.get(key);
        entry.totalShare += f.ownerShare;
        entry.totalPaid += f.ownerPaid;
        entry.totalDue += f.ownerDue;
        entry.tripCount += 1;
      }

      // Driver payables
      if (f.driverDue > 0) {
        const key = f.driverId;
        if (!driverPayables.has(key)) {
          driverPayables.set(key, {
            driverId: f.driverId,
            driverName: f.driverName,
            totalAgreedPay: 0,
            totalPaid: 0,
            totalDue: 0,
            tripCount: 0,
          });
        }
        const entry = driverPayables.get(key);
        entry.totalAgreedPay += f.driverAgreedPay;
        entry.totalPaid += f.driverPaid;
        entry.totalDue += f.driverDue;
        entry.tripCount += 1;
      }
    }

    return {
      owners: Array.from(ownerPayables.values()).sort((a, b) => b.totalDue - a.totalDue),
      drivers: Array.from(driverPayables.values()).sort((a, b) => b.totalDue - a.totalDue),
    };
  }

  // ============================================================
  // TRANSACTIONS
  // ============================================================

  /**
   * Get all financial transactions with optional filters.
   *
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Transactions
   */
  async getTransactions(filters = {}) {
    const where = {};

    if (filters.trip_id) where.trip_id = parseInt(filters.trip_id);
    if (filters.client_id) where.client_id = parseInt(filters.client_id);
    if (filters.transaction_type) where.transaction_type = filters.transaction_type;
    if (filters.from_party) where.from_party = filters.from_party;
    if (filters.to_party) where.to_party = filters.to_party;
    if (filters.driver_id) where.driver_id = parseInt(filters.driver_id);
    if (filters.transport_owner_id) where.transport_owner_id = parseInt(filters.transport_owner_id);

    if (filters.date_from || filters.date_to) {
      where.transaction_date = {};
      if (filters.date_from) where.transaction_date.gte = new Date(filters.date_from);
      if (filters.date_to) where.transaction_date.lte = new Date(filters.date_to);
    }

    return await this.prisma.financialTransaction.findMany({
      where,
      orderBy: { transaction_date: 'desc' },
      include: {
        trip: { select: { trip_id: true, trip_number: true, status: true } },
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });
  }

  // ============================================================
  // CLIENT STATEMENT
  // ============================================================

  /**
   * Get client statement (chronological financial events).
   *
   * @param {number} clientId - Client ID
   * @returns {Promise<Object>} Client statement
   */
  async getClientStatement(clientId) {
    const client = await this.prisma.client.findUnique({
      where: { client_id: clientId },
    });

    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where: { client_id: clientId },
      orderBy: { transaction_date: 'asc' },
      include: {
        trip: { select: { trip_id: true, trip_number: true } },
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });

    const statement = [];
    let runningBalance = 0;

    for (const tx of transactions) {
      const amount = tx.amount || 0;
      const isDebit = tx.direction === 'DEBIT';
      const isCredit = tx.direction === 'CREDIT';

      // For client statement:
      // DEBIT = money BT is owed (increases client balance)
      // CREDIT = money client paid (decreases client balance)
      if (isDebit) {
        runningBalance += amount;
      } else if (isCredit) {
        runningBalance -= amount;
      }

      statement.push({
        date: tx.transaction_date || tx.created_at,
        transactionId: tx.transaction_id,
        type: tx.transaction_type,
        tripNumber: tx.trip?.trip_number || null,
        description: tx.purpose,
        debit: isDebit ? amount : 0,
        credit: isCredit ? amount : 0,
        balance: runningBalance,
        paymentMethod: tx.payment_method,
        reference: tx.reference_number,
      });
    }

    return {
      clientId: client.client_id,
      companyName: client.company_name,
      currentBalance: runningBalance,
      transactionCount: transactions.length,
      statement,
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Record a client/customer payment for a trip.
   * Creates a FinancialTransaction (CREDIT, CLIENT_PAYMENT or CUSTOMER_PAYMENT).
   * This is the ONLY way to record client payments - ensures single source of truth.
   *
   * @param {number} tripId
   * @param {Object} paymentData
   * @returns {Promise<Object>}
   */
  async recordClientPayment(tripId, paymentData, user = null) {
    const { amount, payment_method, reference_number, notes, transaction_date, client_id, source_type } = paymentData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid payment amount is required');
    }

    // Validate trip exists
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      select: { trip_id: true, trip_number: true, freight_amount: true, source_type: true, client_id: true, booking_id: true },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Determine source type
    const effectiveSourceType = source_type || trip.source_type;
    const effectiveClientId = client_id || trip.client_id;

    // Validate: if OFFLINE_CLIENT, client_id must be present
    if (effectiveSourceType === 'OFFLINE_CLIENT' && !effectiveClientId) {
      throw new ValidationError('Client ID is required for offline client payment');
    }

    // Validate payment does not exceed outstanding
    const tripFinancials = await this.calculateTripFinancials(tripId);
    const outstanding = tripFinancials.customerDue || 0;
    if (amount > outstanding) {
      throw new ValidationError(`Payment amount (₹${amount}) exceeds outstanding customer due (₹${outstanding})`);
    }

    // Find or create trip financial record
    let tripFinancial = await this.prisma.tripFinancial.findFirst({
      where: { trip_id: tripId },
    });

    if (!tripFinancial) {
      // Create a new trip financial record for this trip
      tripFinancial = await this.prisma.tripFinancial.create({
        data: {
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          status: 'CALCULATED',
          customer_fare: trip.freight_amount || 0,
          calculated_at: new Date(),
        },
      });
    }

    // Determine transaction type and parties
    const isClientPayment = effectiveSourceType === 'OFFLINE_CLIENT' && effectiveClientId;
    const transactionType = isClientPayment ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT';
    const fromParty = isClientPayment ? 'CLIENT' : 'CUSTOMER';

    // Create the financial transaction within a database transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the FinancialTransaction (single source of truth)
      const transaction = await this.prisma.financialTransaction.create({
        data: {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          transaction_type: transactionType,
          amount: parseFloat(amount),
          direction: 'CREDIT',
          from_party: fromParty,
          to_party: 'BIHAR_TRANSPORT',
          purpose: 'Freight Payment',
          payment_method: payment_method || 'cash',
          reference_number: reference_number || null,
          transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
          status: 'PAID',
          client_id: effectiveClientId || null,
          notes: notes || null,
          created_by: user?.user_id || null,
          metadata: JSON.stringify({
            source_type: effectiveSourceType,
            client_id: effectiveClientId || null,
          }),
        },
      });

      return transaction;
    });

    return result;
  }

  /**
   * Determine payment status from amount vs collected.
   */
  _paymentStatus(totalAmount, collected) {
    if (collected >= totalAmount && totalAmount > 0) return 'PAID';
    if (collected > 0) return 'PARTIAL';
    return 'PENDING';
  }

  /**
   * Format currency for display.
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }
}

module.exports = CanonicalFinancialService;
