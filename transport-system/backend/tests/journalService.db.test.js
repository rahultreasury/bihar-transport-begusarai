const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const JournalService = require('../services/JournalService');

const ADMIN = { user_id: null, role: 'admin' };
const created = { accounts: [], journals: [] };

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

before(async () => {
  if (!process.env.DATABASE_URL) { skipReason = 'DATABASE_URL is not set'; return; }
  try { await prisma.$queryRaw`SELECT 1`; ready = true; skipReason = null; }
  catch (e) { skipReason = `live PostgreSQL unavailable: ${String(e.message).split('\n')[0]}`; }
});

after(async () => {
  if (!ready) return;
  // Clean up any journal entries created by tests
  for (const jid of created.journals) {
    try { await prisma.journalLine.deleteMany({ where: { journal_id: jid } }); } catch {}
    try { await prisma.journalEntry.delete({ where: { journal_id: jid } }); } catch {}
  }
  await prisma.$disconnect();
});

function skip() { return { skip: skipReason }; }

const journalService = new JournalService({ prisma });

describe('JournalService regression', () => {
  test('ensureDefaultAccounts is idempotent', async () => {
    if (!ready) return skip();

    // Call twice — no duplicate accounts should be created
    await journalService.ensureDefaultAccounts();
    await journalService.ensureDefaultAccounts();

    const accounts = await prisma.accountingAccount.findMany({
      where: { account_code: { in: ['CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'VENDOR_PAYABLE', 'PETROL_PUMP_PAYABLE', 'ADVANCE_ASSET', 'COMMISSION_INCOME', 'CUSTOMER_ADVANCE_PAYABLE', 'FUEL_EXPENSE', 'SETTLEMENT_ADJUSTMENT'] } },
    });
    assert.equal(accounts.length, 10, 'Expected 10 default accounts, got ' + accounts.length);

    // Each account code should appear exactly once
    const codes = accounts.map(a => a.account_code);
    for (const code of ['CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'VENDOR_PAYABLE', 'PETROL_PUMP_PAYABLE', 'ADVANCE_ASSET', 'COMMISSION_INCOME', 'CUSTOMER_ADVANCE_PAYABLE', 'FUEL_EXPENSE', 'SETTLEMENT_ADJUSTMENT']) {
      const count = codes.filter(c => c === code).length;
      assert.equal(count, 1, 'Account code ' + code + ' should appear exactly once, appeared ' + count + ' times');
    }
  });

  test('postJournal works with external transaction (nested)', async () => {
    if (!ready) return skip();

    // Ensure default accounts exist first
    await journalService.ensureDefaultAccounts();

    const result = await prisma.$transaction(async (tx) => {
      const entry = await journalService.postJournal({
        reference: 'JRN-REGRESS-TEST-001',
        posting_date: new Date(),
        source_type: 'TEST',
        source_id: null,
        created_by: null,
        tx,
        lines: [
          { account_code: 'CASH', direction: 'DEBIT', amount: 100.00 },
          { account_code: 'COMMISSION_INCOME', direction: 'CREDIT', amount: 100.00 },
        ],
      });
      created.journals.push(entry.journal_id);
      return entry;
    }, { max_wait: 15000, timeout: 15000 });

    assert.equal(result.reference, 'JRN-REGRESS-TEST-001');
    assert.equal(result.lines.length, 2);
    assert.ok(result.journal_id > 0);
  });

  test('postJournal works without external transaction (standalone)', async () => {
    if (!ready) return skip();

    const entry = await journalService.postJournal({
      reference: 'JRN-REGRESS-TEST-002',
      posting_date: new Date(),
      source_type: 'TEST',
      source_id: null,
      created_by: null,
      lines: [
        { account_code: 'CASH', direction: 'DEBIT', amount: 50.00 },
        { account_code: 'COMMISSION_INCOME', direction: 'CREDIT', amount: 50.00 },
      ],
    });
    created.journals.push(entry.journal_id);

    assert.equal(entry.reference, 'JRN-REGRESS-TEST-002');
    assert.equal(entry.lines.length, 2);
  });

  test('postJournal rejects unbalanced journal', async () => {
    if (!ready) return skip();

    await assert.rejects(
      () => journalService.postJournal({
        reference: 'JRN-REGRESS-TEST-003',
        posting_date: new Date(),
        source_type: 'TEST',
        source_id: null,
        created_by: null,
        lines: [
          { account_code: 'CASH', direction: 'DEBIT', amount: 100.00 },
          { account_code: 'COMMISSION_INCOME', direction: 'CREDIT', amount: 50.00 },
        ],
      }),
      /Unbalanced journal/
    );
  });
});
