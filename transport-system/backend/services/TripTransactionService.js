/**
 * TripTransactionService
 * Core service for creating and managing trip financial transactions.
 *
 * This is the SINGLE SOURCE OF TRUTH for all trip financials.
 * Every financial event (advance, expense, payment, settlement) creates
 * a FinancialTransaction record with proper from_party → to_party tracking.
 *
 * BUSINESS RULES:
 * - CUSTOMER_PAYMENT / CLIENT_PAYMENT: Customer/Client → Bihar Transport (CREDIT)
 * - OWNER_ADVANCE: Bihar Transport → Transport Owner (DEBIT)
 * - DRIVER_ADVANCE: Bihar Transport → Driver (DEBIT)
 * - OWNER_SETTLEMENT: Bihar Transport → Transport Owner (DEBIT)
 * - DRIVER_SETTLEMENT: Bihar Transport → Driver (DEBIT)
 * - TRIP_EXPENSE: Bihar Transport → Vendor/Other (DEBIT)
 * - EXPENSE_REIMBURSEMENT: Bihar Transport → Driver/Owner (DEBIT)
 * - COMMISSION: Bihar Transport → Bihar Transport (internal, DEBIT from revenue)
 * - REFUND/REVERSAL: Reverse of original transaction
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const FinancialTransactionRepository = require('../repositories/FinancialTransactionRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

class TripTransactionService {
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
    this.financialTxRepo = new FinancialTransactionRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create a financial transaction with proper party tracking.
   * This is the ONLY way to create financial transactions.
   *
   * @param {Object} params
   * @param {number} params.trip_financial_id
   * @param {number} params.booking_id
   * @param {number} [params.trip_id]
   * @param {string} params.transaction_type - FinancialTransactionType
   * @param {number} params.amount
   * @param {string} params.direction - DEBIT or CREDIT
   * @param {string} params.from_party - TransactionParty
   * @param {string} params.to_party - TransactionParty
   * @param {string} params.purpose - Human-readable purpose
   * @param {string} [params.payment_method]
   * @param {string} [params.reference_number]
   * @param {DateTime} [params.transaction_date]
   * @param {string} [params.notes]
   * @param {number} [params.created_by]
   * @param {Object} [params.metadata]
   * @param {Object} [tx] - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async createTransaction(params, tx = null) {
    const client = tx || this.prisma;

    const {
      trip_financial_id,
      booking_id,
      trip_id,
      transaction_type,
      amount,
      direction,
      from_party,
      to_party,
      purpose,
      payment_method,
      reference_number,
      transaction_date,
      notes,
      created_by,
      metadata,
    } = params;

    if (!trip_financial_id || !booking_id || !transaction_type || !amount || !direction || !from_party || !to_party || !purpose) {
      throw new ValidationError('Missing required transaction fields');
    }

    const transaction = await this.financialTxRepo.create(
      {
        trip_financial_id,
        booking_id,
        trip_id: trip_id || null,
        transaction_type,
        amount,
        direction,
        from_party,
        to_party,
        purpose,
        payment_method: payment_method || null,
        reference_number: reference_number || null,
        transaction_date: transaction_date || new Date(),
        status: 'PAID',
        notes: notes || null,
        created_by: created_by || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
      client
    );

    // Create audit log
    if (created_by) {
      await this.auditRepo.create(
        {
          user_id: created_by,
          user_role: 'admin',
          action: 'transaction_created',
          entity_type: 'FinancialTransaction',
          entity_id: transaction.transaction_id,
          new_value: JSON.stringify({
            type: transaction_type,
            amount,
            direction,
            from_party,
            to_party,
            purpose,
          }),
          reason: notes || null,
        },
        client
      );
    }

    return transaction;
  }

  /**
   * Create a customer/client payment transaction.
   * Customer/Client → Bihar Transport (CREDIT)
   */
  async createCustomerPayment(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, payment_method, reference_number, transaction_date, notes, created_by, source_type, client_id } = params;

    const fromParty = source_type === 'OFFLINE_CLIENT' && client_id ? 'CLIENT' : 'CUSTOMER';
    const toParty = 'BIHAR_TRANSPORT';
    const purpose = 'Freight Payment';

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: source_type === 'OFFLINE_CLIENT' && client_id ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT',
        amount,
        direction: 'CREDIT',
        from_party: fromParty,
        to_party: toParty,
        purpose,
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { client_id: client_id || null, source_type: source_type || 'ONLINE_BOOKING' },
      },
      tx
    );
  }

  /**
   * Create an owner advance transaction.
   * Bihar Transport → Transport Owner (DEBIT)
   */
  async createOwnerAdvance(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, payment_method, reference_number, transaction_date, notes, created_by, transport_owner_id } = params;

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: 'OWNER_ADVANCE',
        amount,
        direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT',
        to_party: 'TRANSPORT_OWNER',
        purpose: 'Trip Advance',
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { transport_owner_id },
      },
      tx
    );
  }

  /**
   * Create a driver advance transaction.
   * Bihar Transport → Driver (DEBIT)
   */
  async createDriverAdvance(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, payment_method, reference_number, transaction_date, notes, created_by, driver_id, advance_type } = params;

    const purpose = advance_type === 'FUEL_ADVANCE' ? 'Fuel Advance' : 'Driver Advance';

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: advance_type === 'FUEL_ADVANCE' ? 'FUEL_ADVANCE' : 'DRIVER_ADVANCE',
        amount,
        direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT',
        to_party: 'DRIVER',
        purpose,
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { driver_id, advance_type },
      },
      tx
    );
  }

  /**
   * Create an owner settlement transaction.
   * Bihar Transport → Transport Owner (DEBIT)
   */
  async createOwnerSettlement(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, payment_method, reference_number, transaction_date, notes, created_by, transport_owner_id } = params;

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: 'OWNER_SETTLEMENT',
        amount,
        direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT',
        to_party: 'TRANSPORT_OWNER',
        purpose: 'Final Settlement',
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { transport_owner_id },
      },
      tx
    );
  }

  /**
   * Create a driver settlement transaction.
   * Bihar Transport → Driver (DEBIT)
   */
  async createDriverSettlement(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, payment_method, reference_number, transaction_date, notes, created_by, driver_id } = params;

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: 'DRIVER_SETTLEMENT',
        amount,
        direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT',
        to_party: 'DRIVER',
        purpose: 'Driver Payment',
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { driver_id },
      },
      tx
    );
  }

  /**
   * Create a trip expense transaction.
   * Bihar Transport → Vendor/Other (DEBIT)
   */
  async createTripExpense(params, tx = null) {
    const { trip_financial_id, booking_id, trip_id, amount, expense_type, paid_by, paid_to, payment_method, reference_number, transaction_date, notes, created_by } = params;

    const purpose = this._formatExpensePurpose(expense_type);

    return this.createTransaction(
      {
        trip_financial_id,
        booking_id,
        trip_id,
        transaction_type: 'TRIP_EXPENSE',
        amount,
        direction: 'DEBIT',
        from_party: paid_by === 'TRANSPORT_OWNER' ? 'TRANSPORT_OWNER' : 'BIHAR_TRANSPORT',
        to_party: paid_to || 'VENDOR',
        purpose,
        payment_method,
        reference_number,
        transaction_date,
        notes,
        created_by,
        metadata: { expense_type, paid_by, paid_to },
      },
      tx
    );
  }

  /**
   * Create a reversal transaction.
   * Reverses an existing transaction without deleting it.
   */
  async createReversal(params, tx = null) {
    const { original_transaction_id, amount, notes, created_by } = params;

    // Fetch original transaction
    const original = await this.financialTxRepo.findById(original_transaction_id, tx);
    if (!original) {
      throw new NotFoundError('Original transaction not found');
    }

    // Create reversal with opposite direction
    const reversal = await this.createTransaction(
      {
        trip_financial_id: original.trip_financial_id,
        booking_id: original.booking_id,
        trip_id: original.trip_id,
        transaction_type: 'REVERSAL',
        amount: amount || original.amount,
        direction: original.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        from_party: original.to_party,
        to_party: original.from_party,
        purpose: `Reversal: ${original.purpose}`,
        payment_method: original.payment_method,
        reference_number: original.reference_number,
        transaction_date: new Date(),
        notes: notes || `Reversal of transaction ${original_transaction_id}`,
        created_by,
        metadata: { original_transaction_id, original_type: original.transaction_type },
      },
      tx
    );

    return reversal;
  }

  /**
   * Get all transactions for a trip with proper ordering.
   */
  async getTripTransactions(tripId, filters = {}) {
    const where = { trip_id: tripId };
    if (filters.transaction_type) where.transaction_type = filters.transaction_type;
    if (filters.from_party) where.from_party = filters.from_party;
    if (filters.to_party) where.to_party = filters.to_party;

    return await this.prisma.financialTransaction.findMany({
      where,
      orderBy: { transaction_date: 'desc' },
      include: {
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });
  }

  /**
   * Get transaction ledger for a trip (all transactions sorted by date).
   */
  async getTripLedger(tripId) {
    const transactions = await this.getTripTransactions(tripId);
    return transactions.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
  }

  /**
   * Calculate party balances from transactions.
   * This is the SINGLE SOURCE OF TRUTH for all balances.
   */
  async calculatePartyBalances(tripId) {
    const transactions = await this.getTripTransactions(tripId);

    const balances = {
      customer: { received: 0, due: 0 },
      client: { received: 0, due: 0 },
      owner: { share: 0, advance: 0, settlement: 0, due: 0 },
      driver: { advance: 0, settlement: 0, due: 0 },
      expenses: { total: 0, byType: {} },
    };

    for (const tx of transactions) {
      const amount = tx.amount || 0;

      // Customer/Client payments (CREDIT = money in to BT)
      if (tx.transaction_type === 'CUSTOMER_PAYMENT' && tx.direction === 'CREDIT') {
        balances.customer.received += amount;
      } else if (tx.transaction_type === 'CLIENT_PAYMENT' && tx.direction === 'CREDIT') {
        balances.client.received += amount;
      }

      // Owner transactions
      if (tx.to_party === 'TRANSPORT_OWNER' || tx.from_party === 'TRANSPORT_OWNER') {
        if (tx.transaction_type === 'OWNER_ADVANCE') {
          balances.owner.advance += amount;
        } else if (tx.transaction_type === 'OWNER_SETTLEMENT') {
          balances.owner.settlement += amount;
        }
      }

      // Driver transactions
      if (tx.to_party === 'DRIVER' || tx.from_party === 'DRIVER') {
        if (tx.transaction_type === 'DRIVER_ADVANCE' || tx.transaction_type === 'FUEL_ADVANCE') {
          balances.driver.advance += amount;
        } else if (tx.transaction_type === 'DRIVER_SETTLEMENT') {
          balances.driver.settlement += amount;
        }
      }

      // Expenses
      if (tx.transaction_type === 'TRIP_EXPENSE') {
        balances.expenses.total += amount;
        const expenseType = tx.metadata?.expense_type || 'OTHER';
        balances.expenses.byType[expenseType] = (balances.expenses.byType[expenseType] || 0) + amount;
      }
    }

    return balances;
  }

  /**
   * Format expense type for display.
   */
  _formatExpensePurpose(expenseType) {
    const map = {
      DIESEL: 'Diesel Expense',
      FUEL: 'Fuel Expense',
      TOLL: 'Toll Expense',
      PARKING: 'Parking Expense',
      LOADING: 'Loading Expense',
      UNLOADING: 'Unloading Expense',
      REPAIR: 'Repair Expense',
      MAINTENANCE: 'Maintenance Expense',
      DOCUMENTATION: 'Documentation Expense',
      LOCAL_TRANSPORT: 'Local Transport Expense',
      CUSTOMER_RELATED: 'Customer Related Expense',
      COMMUNICATION: 'Communication Expense',
      DRIVER: 'Driver Expense',
      OWNER: 'Owner Expense',
      LABOUR: 'Labour Expense',
      OTHER: 'Other Expense',
    };
    return map[expenseType] || expenseType;
  }
}

module.exports = TripTransactionService;
