const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, ConflictError, NotFoundError } = require('../utils/AppError');
const money = require('./finance/money');

const DEFAULT_ACCOUNTS = Object.freeze([
  { account_code: 'CASH', account_name: 'Cash', account_type: 'ASSET' },
  { account_code: 'BANK', account_name: 'Bank', account_type: 'ASSET' },
  { account_code: 'ACCOUNTS_RECEIVABLE', account_name: 'Accounts Receivable', account_type: 'ASSET' },
  { account_code: 'VENDOR_PAYABLE', account_name: 'Vendor Payable', account_type: 'LIABILITY' },
  { account_code: 'PETROL_PUMP_PAYABLE', account_name: 'Petrol Pump Payable', account_type: 'LIABILITY' },
  { account_code: 'ADVANCE_ASSET', account_name: 'Advances', account_type: 'ASSET' },
  { account_code: 'COMMISSION_INCOME', account_name: 'Commission Income', account_type: 'INCOME' },
  { account_code: 'CUSTOMER_ADVANCE_PAYABLE', account_name: 'Customer Advances', account_type: 'LIABILITY' },
  { account_code: 'FUEL_EXPENSE', account_name: 'Fuel Expense', account_type: 'EXPENSE' },
  { account_code: 'SETTLEMENT_ADJUSTMENT', account_name: 'Settlement Adjustment', account_type: 'ASSET' },
]);

class JournalService {
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
  }

  db(tx) {
    return tx || this.prisma;
  }

  async ensureDefaultAccounts(tx) {
    const db = this.db(tx);
    for (const account of DEFAULT_ACCOUNTS) {
      const existing = await db.accountingAccount.findUnique({ where: { account_code: account.account_code } });
      if (!existing) {
        await db.accountingAccount.create({ data: account });
      }
    }
  }

  async postJournal(input = {}) {
    const tx = input.tx;
    const runner = async (db) => {
      await this.ensureDefaultAccounts(db);

      if (!input.reference) throw new ValidationError('A journal reference is required');
      if (!input.source_type) throw new ValidationError('A journal source_type is required');
      if (!Array.isArray(input.lines) || input.lines.length < 2) {
        throw new ValidationError('A journal requires at least two lines');
      }

      const existingSource = await db.journalEntry.findFirst({
        where: { source_type: input.source_type, source_id: input.source_id ?? null },
      });
      if (existingSource) {
        throw new ConflictError({ message: 'A journal has already been posted for this source' });
      }
      const existingRef = await db.journalEntry.findUnique({ where: { reference: input.reference } });
      if (existingRef) {
        throw new ConflictError({ message: 'Journal reference already exists' });
      }

      let debitPaise = 0;
      let creditPaise = 0;
      const prepared = [];
      for (const line of input.lines) {
        const direction = String(line.direction || '').toUpperCase();
        if (!['DEBIT', 'CREDIT'].includes(direction)) {
          throw new ValidationError('Journal line direction must be DEBIT or CREDIT');
        }
        const amount = money.toPaiseStrict(line.amount, { allowNegative: false });
        if (amount <= 0) throw new ValidationError('Journal line amount must be positive');
        if (!line.account_code) throw new ValidationError('Journal line account_code is required');

        const account = await db.accountingAccount.findUnique({ where: { account_code: line.account_code } });
        if (!account || !account.is_active) throw new ValidationError(`Invalid or inactive account ${line.account_code}`);

        if (direction === 'DEBIT') debitPaise += amount;
        else creditPaise += amount;

        prepared.push({
          account_id: account.account_id,
          direction,
          amount: money.fromPaise(amount),
          description: line.description || null,
        });
      }

      if (debitPaise !== creditPaise) {
        throw new ValidationError(`Unbalanced journal: debits ${money.fromPaise(debitPaise)} != credits ${money.fromPaise(creditPaise)}`);
      }

      const entry = await db.journalEntry.create({
        data: {
          reference: input.reference,
          posting_date: input.posting_date ? new Date(input.posting_date) : new Date(),
          source_type: input.source_type,
          source_id: input.source_id ?? null,
          currency: input.currency || 'INR',
          status: 'POSTED',
          created_by: input.created_by ?? null,
          lines: { create: prepared },
        },
        include: { lines: true },
      });

      return entry;
    };

    if (tx) {
      return runner(tx);
    }
    return this.prisma.$transaction(async (db) => runner(db));
  }

  async isBalanced(journalId) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { journal_id: Number(journalId) },
      include: { lines: true },
    });
    if (!entry) return false;
    let d = 0, c = 0;
    for (const l of entry.lines) {
      const p = money.toPaise(l.amount);
      if (l.direction === 'DEBIT') d += p; else c += p;
    }
    return d === c;
  }
}

module.exports = JournalService;
module.exports.JournalService = JournalService;
