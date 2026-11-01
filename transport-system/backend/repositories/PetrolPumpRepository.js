/**
 * PetrolPumpRepository
 * Hardened repository for Petrol Pump Ledger with transactional operations
 */

const { prisma } = require('../config/prisma');
const { Decimal } = require('@prisma/client/runtime/library');

class PetrolPumpRepository {
  _client(tx = null) {
    return tx || prisma;
  }

  async _withRetry(fn, maxRetries = 3, baseDelay = 50) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        // Retry only on serialization failures (P2034) and deadlocks
        if ((err.code === 'P2034' || err.code === 'P2037' || err.message?.includes('could not serialize')) && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  _toDecimal(val) {
    if (val === null || val === undefined) return new Decimal(0);
    if (val instanceof Decimal) return val;
    return new Decimal(String(val));
  }

  _sumDecimals(values) {
    let sum = new Decimal(0);
    for (const v of values) {
      sum = sum.add(this._toDecimal(v));
    }
    return sum;
  }

  _generateReference(prefix) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  async createPump(data, tx = null) {
    const client = this._client(tx);
    const pumpData = {
      pump_name: data.pump_name,
      pump_code: data.pump_code || null,
      owner_name: data.owner_name || null,
      contact_number: data.contact_number || null,
      address: data.address || null,
      city: data.city || null,
      state: data.state || 'Bihar',
      gst_number: data.gst_number || null,
      pan_number: data.pan_number || null,
      bank_name: data.bank_name || null,
      bank_account: data.bank_account || null,
      bank_ifsc: data.bank_ifsc || null,
      credit_limit: this._toDecimal(data.credit_limit),
      opening_balance: this._toDecimal(data.opening_balance),
      current_balance: this._toDecimal(data.opening_balance || 0),
      status: data.status || 'active',
      is_active: data.is_active !== undefined ? data.is_active : true,
      notes: data.notes || null,
    };
    return await client.petrolPump.create({ data: pumpData });
  }

  async findPumpById(pumpId, tx = null) {
    const client = this._client(tx);
    return await client.petrolPump.findUnique({
      where: { pump_id: parseInt(pumpId) },
      include: {
        fuel_transactions: { orderBy: { fuel_date: 'desc' }, take: 50 },
        bills: { orderBy: { bill_date: 'desc' }, take: 20 },
        payments: { orderBy: { payment_date: 'desc' }, take: 20 },
      },
    });
  }

  async findPumpByCode(pumpCode, tx = null) {
    const client = this._client(tx);
    return await client.petrolPump.findUnique({ where: { pump_code: pumpCode } });
  }

  async listPumps(filters = {}, tx = null) {
    const client = this._client(tx);
    const { search, status, is_active, page = 1, limit = 50 } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (status) where.status = status;
    if (typeof is_active !== 'undefined') where.is_active = is_active === 'true' || is_active === true;
    if (search) {
      where.OR = [
        { pump_name: { contains: search, mode: 'insensitive' } },
        { pump_code: { contains: search, mode: 'insensitive' } },
        { contact_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [pumps, total] = await Promise.all([
      client.petrolPump.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { pump_name: 'asc' },
      }),
      client.petrolPump.count({ where }),
    ]);

    return {
      pumps,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  async updatePump(pumpId, data, tx = null) {
    const client = this._client(tx);
    const updateData = { updated_at: new Date() };
    if (data.pump_name !== undefined) updateData.pump_name = data.pump_name;
    if (data.owner_name !== undefined) updateData.owner_name = data.owner_name;
    if (data.contact_number !== undefined) updateData.contact_number = data.contact_number;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.gst_number !== undefined) updateData.gst_number = data.gst_number;
    if (data.pan_number !== undefined) updateData.pan_number = data.pan_number;
    if (data.bank_name !== undefined) updateData.bank_name = data.bank_name;
    if (data.bank_account !== undefined) updateData.bank_account = data.bank_account;
    if (data.bank_ifsc !== undefined) updateData.bank_ifsc = data.bank_ifsc;
    if (data.credit_limit !== undefined) updateData.credit_limit = this._toDecimal(data.credit_limit);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return await client.petrolPump.update({
      where: { pump_id: parseInt(pumpId) },
      data: updateData,
    });
  }

  async createFuelTransaction(data, tx = null) {
    const client = this._client(tx);
    const litres = this._toDecimal(data.litres);
    const rate = this._toDecimal(data.rate_per_litre);
    if (litres.lte(0)) throw new Error('Litres must be positive');
    if (rate.lte(0)) throw new Error('Rate per litre must be positive');

    const total_amount = data.total_amount
      ? this._toDecimal(data.total_amount)
      : litres.mul(rate);

    const fuel_date = data.fuel_date ? new Date(data.fuel_date) : new Date();
    if (isNaN(fuel_date.getTime())) throw new Error('Invalid fuel date');

    if (data.pump_id) {
      const pump = await client.petrolPump.findUnique({ where: { pump_id: parseInt(data.pump_id) } });
      if (!pump) throw new Error('Pump not found');
    }

    if (data.receipt_number) {
      const existing = await client.petrolPumpFuelTransaction.findFirst({
        where: {
          pump_id: parseInt(data.pump_id),
          receipt_number: data.receipt_number,
        },
      });
      if (existing) throw new Error('Duplicate receipt number for this pump');
    }

    return await client.petrolPumpFuelTransaction.create({
      data: {
        pump_id: parseInt(data.pump_id),
        trip_id: data.trip_id ? parseInt(data.trip_id) : null,
        vehicle_id: data.vehicle_id ? parseInt(data.vehicle_id) : null,
        driver_id: data.driver_id ? parseInt(data.driver_id) : null,
        fuel_date: fuel_date,
        fuel_type: data.fuel_type || 'DIESEL',
        litres: litres,
        rate_per_litre: rate,
        total_amount: total_amount,
        invoice_number: data.invoice_number || null,
        receipt_number: data.receipt_number || null,
        remarks: data.remarks || null,
        supporting_doc: data.supporting_doc || null,
        created_by: data.created_by || null,
        is_billed: false,
      },
    });
  }

  async findFuelTransactionById(transactionId, tx = null) {
    const client = this._client(tx);
    return await client.petrolPumpFuelTransaction.findUnique({
      where: { transaction_id: parseInt(transactionId) },
      include: { pump: true, trip: true, vehicle: true, driver: true, bill: true },
    });
  }

  async listFuelTransactions(filters = {}, tx = null) {
    const client = this._client(tx);
    const { pump_id, trip_id, vehicle_id, driver_id, from_date, to_date, is_billed, page = 1, limit = 100 } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (pump_id) where.pump_id = parseInt(pump_id);
    if (trip_id) where.trip_id = parseInt(trip_id);
    if (vehicle_id) where.vehicle_id = parseInt(vehicle_id);
    if (driver_id) where.driver_id = parseInt(driver_id);
    if (typeof is_billed !== 'undefined') where.is_billed = is_billed === 'true' || is_billed === true;
    if (from_date || to_date) {
      where.fuel_date = {};
      if (from_date) where.fuel_date.gte = new Date(from_date);
      if (to_date) where.fuel_date.lte = new Date(to_date);
    }

    const [transactions, total] = await Promise.all([
      client.petrolPumpFuelTransaction.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { fuel_date: 'desc', transaction_id: 'desc' },
        include: { pump: true, trip: true, vehicle: true, driver: true },
      }),
      client.petrolPumpFuelTransaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    };
  }

  async generateBillNumber(tx = null) {
    const client = this._client(tx);
    const year = new Date().getFullYear();
    // Use timestamp-based unique generation
    const count = await client.petrolPumpBill.count({
      where: {
        bill_number: {
          startsWith: `PPB-${year}-`,
        },
      },
    });
    return `PPB-${year}-${String(count + 1).padStart(6, '0')}-${Date.now().toString().slice(-6)}`;
  }

  async generatePaymentNumber(tx = null) {
    const client = this._client(tx);
    const year = new Date().getFullYear();
    const count = await client.petrolPumpPayment.count({
      where: {
        payment_number: {
          startsWith: `PPP-${year}-`,
        },
      },
    });
    return `PPP-${year}-${String(count + 1).padStart(6, '0')}-${Date.now().toString().slice(-6)}`;
  }

  async createBill(data, tx = null) {
    // This should be called within a transaction context from service
    const client = this._client(tx);
    
    if (!data.pump_id) throw new Error('pump_id required');
    if (!data.period_start || !data.period_end) throw new Error('Billing period required');
    
    const periodStart = new Date(data.period_start);
    const periodEnd = new Date(data.period_end);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) throw new Error('Invalid billing period');
    if (periodEnd < periodStart) throw new Error('Invalid billing period range');

    const pumpId = parseInt(data.pump_id);
    const pump = await client.petrolPump.findUnique({ where: { pump_id: pumpId } });
    if (!pump) throw new Error('Pump not found');

    // Check for duplicate bill for same period first
    const existingBill = await client.petrolPumpBill.findFirst({
      where: {
        pump_id: pumpId,
        period_start: periodStart,
        period_end: periodEnd,
      },
    });
    if (existingBill) throw new Error('Bill already exists for this period');

    // Find unbilled transactions in period
    const unbilledTxs = await client.petrolPumpFuelTransaction.findMany({
      where: {
        pump_id: pumpId,
        is_billed: false,
        fuel_date: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      orderBy: { fuel_date: 'asc', transaction_id: 'asc' },
    });

    if (unbilledTxs.length === 0) throw new Error('No unbilled transactions found for the period');

    // Calculate total
    let fuel_total = new Decimal(0);
    for (const tx of unbilledTxs) {
      fuel_total = fuel_total.add(this._toDecimal(tx.total_amount));
    }

    const adjustment_amount = this._toDecimal(data.adjustment_amount || 0);
    const bill_amount = fuel_total.add(adjustment_amount);

    const bill_number = data.bill_number || await this.generateBillNumber(client);

    let bill;
    try {
      bill = await client.petrolPumpBill.create({
        data: {
          bill_number,
          pump_id: pumpId,
          bill_date: data.bill_date ? new Date(data.bill_date) : new Date(),
          period_start: periodStart,
          period_end: periodEnd,
          fuel_total: fuel_total,
          adjustment_amount: adjustment_amount,
          bill_amount: bill_amount,
          paid_amount: new Decimal(0),
          outstanding_amount: bill_amount,
          status: 'PENDING',
          due_date: data.due_date ? new Date(data.due_date) : null,
          remarks: data.remarks || null,
          created_by: data.created_by || null,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        throw new Error('Bill already exists for this period');
      }
      throw err;
    }

    // Link transactions to bill - update only if still unbilled
    for (const tx of unbilledTxs) {
      const result = await client.petrolPumpFuelTransaction.updateMany({
        where: {
          transaction_id: tx.transaction_id,
          is_billed: false,
        },
        data: {
          bill_id: bill.bill_id,
          is_billed: true,
          updated_at: new Date(),
        },
      });
      if (result.count === 0) {
        // Transaction was already billed by concurrent request - rollback
        throw new Error('Transaction already billed by concurrent request');
      }
    }

    return await client.petrolPumpBill.findUnique({
      where: { bill_id: bill.bill_id },
      include: { transactions: true, pump: true },
    });
  }

  async createBillWithTransaction(data) {
    return await this._withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const repo = new PetrolPumpRepository();
        repo._client = () => tx;
        return await repo.createBill(data, tx);
      }, { isolationLevel: 'Serializable' });
    });
  }

  async getBillById(billId, tx = null) {
    const client = this._client(tx);
    return await client.petrolPumpBill.findUnique({
      where: { bill_id: parseInt(billId) },
      include: { pump: true, transactions: true, payments: true },
    });
  }

  async listBills(filters = {}, tx = null) {
    const client = this._client(tx);
    const { pump_id, status, from_date, to_date, page = 1, limit = 50 } = filters;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (pump_id) where.pump_id = parseInt(pump_id);
    if (status) where.status = status;
    if (from_date || to_date) {
      where.bill_date = {};
      if (from_date) where.bill_date.gte = new Date(from_date);
      if (to_date) where.bill_date.lte = new Date(to_date);
    }

    const [bills, total] = await Promise.all([
      client.petrolPumpBill.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { bill_date: 'desc' },
        include: { pump: true, transactions: true },
      }),
      client.petrolPumpBill.count({ where }),
    ]);

    return {
      bills,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    };
  }

  async updateBill(billId, data, tx = null) {
    const client = this._client(tx);
    const updateData = { updated_at: new Date() };
    if (data.status) updateData.status = data.status;
    if (data.remarks !== undefined) updateData.remarks = data.remarks;
    if (data.approved_by) {
      updateData.approved_by = data.approved_by;
      updateData.approved_at = new Date();
    }
    return await client.petrolPumpBill.update({
      where: { bill_id: parseInt(billId) },
      data: updateData,
    });
  }

  async recordPayment(data) {
    const repo = new PetrolPumpRepository();
    
    if (!data.pump_id) throw new Error('pump_id required');
    if (!data.amount || this._toDecimal(data.amount).lte(0)) throw new Error('Positive payment amount required');

    return await this._withRetry(async () => {
      return await this._recordPaymentInternal(data, repo);
    });
  }

  async _recordPaymentInternal(data, repo) {

    const amount = this._toDecimal(data.amount);
    const pumpId = parseInt(data.pump_id);
    const billId = data.bill_id ? parseInt(data.bill_id) : null;
    const paymentMethod = data.payment_method || 'BANK_TRANSFER';

    // Check idempotency before transaction
    if (data.idempotency_key) {
      const existing = await prisma.petrolPumpPayment.findUnique({
        where: { idempotency_key: data.idempotency_key },
        include: { pump: true, bill: true },
      });
      if (existing) {
        // Validate payload matches
        const matches = existing.pump_id === pumpId &&
          existing.bill_id === billId &&
          this._toDecimal(existing.amount).eq(amount) &&
          existing.payment_method === paymentMethod &&
          (existing.reference_number || null) === (data.reference_number || null);
        if (!matches) {
          throw new Error('Idempotency key reused with different payment payload');
        }
        return existing;
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const client = tx;

        // Check duplicate by reference
        if (data.reference_number) {
          const existingRef = await client.petrolPumpPayment.findFirst({
            where: {
              pump_id: pumpId,
              reference_number: data.reference_number,
              payment_method: paymentMethod,
            },
          });
          if (existingRef) throw new Error('Duplicate payment reference');
        }

        const pump = await client.petrolPump.findUnique({ where: { pump_id: pumpId } });
        if (!pump) throw new Error('Pump not found');

        let bill = null;
        if (billId) {
          // Lock the bill row for update
          bill = await client.petrolPumpBill.findUnique({
            where: { bill_id: billId },
          });
          if (!bill) throw new Error('Bill not found');
          if (bill.pump_id !== pumpId) throw new Error('Bill does not belong to pump');

          const outstanding = this._toDecimal(bill.outstanding_amount);
          if (amount.gt(outstanding)) throw new Error('Payment amount exceeds outstanding amount');
        }

        const payment_number = data.payment_number || await repo.generatePaymentNumber(client);

        let payment;
        try {
          payment = await client.petrolPumpPayment.create({
            data: {
              payment_number,
              pump_id: pumpId,
              bill_id: billId,
              amount: amount,
              payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
              payment_method: paymentMethod,
              reference_number: data.reference_number || null,
              bank_name: data.bank_name || null,
              voucher_number: data.voucher_number || null,
              remarks: data.remarks || null,
              idempotency_key: data.idempotency_key || null,
              created_by: data.created_by || null,
            },
          });
        } catch (err) {
          // Handle P2002 unique constraint violation
          if (err.code === 'P2002') {
            if (data.idempotency_key && err.meta?.target?.includes('idempotency_key')) {
              const existing = await client.petrolPumpPayment.findUnique({
                where: { idempotency_key: data.idempotency_key },
                include: { pump: true, bill: true },
              });
              if (existing) {
                const matches = existing.pump_id === pumpId &&
                  existing.bill_id === billId &&
                  this._toDecimal(existing.amount).eq(amount) &&
                  existing.payment_method === paymentMethod &&
                  (existing.reference_number || null) === (data.reference_number || null);
                if (matches) return existing;
                throw new Error('Idempotency key reused with different payment payload');
              }
            }
            throw err;
          }
          throw err;
        }

        if (bill) {
          // Re-read bill to get latest state
          const currentBill = await client.petrolPumpBill.findUnique({
            where: { bill_id: billId },
          });
          const newPaidAmount = this._toDecimal(currentBill.paid_amount).add(amount);
          const newOutstanding = this._toDecimal(currentBill.bill_amount).sub(newPaidAmount);
          let newStatus = currentBill.status;
          if (newOutstanding.lte(0)) {
            newStatus = 'PAID';
          } else if (newPaidAmount.gt(0)) {
            newStatus = 'PARTIALLY_PAID';
          }

          await client.petrolPumpBill.update({
            where: { bill_id: billId },
            data: {
              paid_amount: newPaidAmount,
              outstanding_amount: newOutstanding.gt(0) ? newOutstanding : new Decimal(0),
              status: newStatus,
              updated_at: new Date(),
            },
          });
        }

        // Update pump balance atomically
        const currentPump = await client.petrolPump.findUnique({ where: { pump_id: pumpId } });
        const pumpBalance = this._toDecimal(currentPump.current_balance).sub(amount);
        await client.petrolPump.update({
          where: { pump_id: pumpId },
          data: {
            current_balance: pumpBalance,
            updated_at: new Date(),
          },
        });

        return await client.petrolPumpPayment.findUnique({
          where: { payment_id: payment.payment_id },
          include: { pump: true, bill: true },
        });
      }, { isolationLevel: 'Serializable' });
    } catch (err) {
      throw err;
    }
  }

  async getPumpLedger(pumpId, filters = {}) {
    const client = prisma;
    const pid = parseInt(pumpId);
    const { from_date, to_date } = filters;

    const pump = await client.petrolPump.findUnique({ where: { pump_id: pid } });
    if (!pump) throw new Error('Pump not found');

    const txWhere = { pump_id: pid };
    const payWhere = { pump_id: pid };
    const billWhere = { pump_id: pid };

    if (from_date || to_date) {
      txWhere.fuel_date = {};
      if (from_date) txWhere.fuel_date.gte = new Date(from_date);
      if (to_date) txWhere.fuel_date.lte = new Date(to_date);
      payWhere.payment_date = {};
      if (from_date) payWhere.payment_date.gte = new Date(from_date);
      if (to_date) payWhere.payment_date.lte = new Date(to_date);
      billWhere.bill_date = {};
      if (from_date) billWhere.bill_date.gte = new Date(from_date);
      if (to_date) billWhere.bill_date.lte = new Date(to_date);
    }

    const [transactions, payments, bills] = await Promise.all([
      client.petrolPumpFuelTransaction.findMany({
        where: txWhere,
        orderBy: { fuel_date: 'asc', transaction_id: 'asc' },
        include: { trip: true, vehicle: true, bill: true },
      }),
      client.petrolPumpPayment.findMany({
        where: payWhere,
        orderBy: { payment_date: 'asc' },
        include: { bill: true },
      }),
      client.petrolPumpBill.findMany({
        where: billWhere,
        orderBy: { bill_date: 'asc' },
        include: { payments: true },
      }),
    ]);

    const openingBalance = this._toDecimal(pump.opening_balance);
    let runningBalance = openingBalance;
    const ledgerEntries = [];

    // Process fuel transactions as debits (purchases)
    for (const tx of transactions) {
      const amount = this._toDecimal(tx.total_amount);
      runningBalance = runningBalance.add(amount); // Debit increases liability
      ledgerEntries.push({
        date: tx.fuel_date,
        type: 'FUEL_PURCHASE',
        transaction_id: tx.transaction_id,
        reference: tx.receipt_number || tx.invoice_number || `FUEL-${tx.transaction_id}`,
        description: `Fuel purchase - ${tx.fuel_type} ${tx.litres}L @ ${tx.rate_per_litre}/L`,
        debit: amount.toString(),
        credit: '0',
        running_balance: runningBalance.toString(),
        bill_id: tx.bill_id,
        is_billed: tx.is_billed,
      });
    }

    // Process payments as credits
    for (const payment of payments) {
      const amount = this._toDecimal(payment.amount);
      runningBalance = runningBalance.sub(amount); // Credit reduces liability
      ledgerEntries.push({
        date: payment.payment_date,
        type: 'PAYMENT',
        transaction_id: payment.payment_id,
        reference: payment.payment_number || payment.reference_number,
        description: `Payment - ${payment.payment_method}`,
        debit: '0',
        credit: amount.toString(),
        running_balance: runningBalance.toString(),
        bill_id: payment.bill_id,
      });
    }

    // Sort by date
    ledgerEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Recalculate running balance in sorted order
    runningBalance = openingBalance;
    for (let i = 0; i < ledgerEntries.length; i++) {
      const entry = ledgerEntries[i];
      const debit = new Decimal(entry.debit);
      const credit = new Decimal(entry.credit);
      runningBalance = runningBalance.add(debit).sub(credit);
      ledgerEntries[i].running_balance = runningBalance.toString();
    }

    const totalDebits = transactions.reduce((sum, tx) => sum.add(this._toDecimal(tx.total_amount)), new Decimal(0));
    const totalCredits = payments.reduce((sum, p) => sum.add(this._toDecimal(p.amount)), new Decimal(0));
    const closingBalance = runningBalance;

    return {
      pump,
      opening_balance: openingBalance.toString(),
      fuel_purchases: {
        count: transactions.length,
        total_debits: totalDebits.toString(),
        transactions: transactions,
      },
      payments: {
        count: payments.length,
        total_credits: totalCredits.toString(),
        payments: payments,
      },
      bills: bills,
      ledger_entries: ledgerEntries,
      summary: {
        opening_balance: openingBalance.toString(),
        total_debits: totalDebits.toString(),
        total_credits: totalCredits.toString(),
        closing_balance: closingBalance.toString(),
        outstanding: closingBalance.gte(0) ? closingBalance.toString() : '0',
      },
    };
  }
}

module.exports = PetrolPumpRepository;
