const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const FinanceReconciliationService = require('../services/FinanceReconciliationService');

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';
const created = { invoices: [], journals: [] };

before(async () => {
  if (!process.env.DATABASE_URL) { skipReason = 'DATABASE_URL is not set'; return; }
  try { await prisma.$queryRaw`SELECT 1`; ready = true; skipReason = null; }
  catch (e) { skipReason = `live PostgreSQL unavailable: ${String(e.message).split('\n')[0]}`; }
});

after(async () => {
  if (!ready) return;
  await prisma.journalLine.deleteMany({ where: { journal_id: { in: created.journals } } });
  await prisma.journalEntry.deleteMany({ where: { journal_id: { in: created.journals } } });
  await prisma.invoice.deleteMany({ where: { invoice_id: { in: created.invoices } } });
  await prisma.$disconnect();
});

function skip() { return { skip: skipReason }; }

describe('RECON DB', () => {
  test('detects inconsistent invoice payment status', async () => {
    if (!ready) return skip();
    const inv = await prisma.invoice.create({ data: {
      invoice_number: `RECON-INV-${Date.now()}`,
      final_price: 10000, grand_total: 10000, total_amount: 10000,
      status: 'GENERATED', payment_status: 'PAID',
    } });
    created.invoices.push(inv.invoice_id);
    const recon = new FinanceReconciliationService({ prisma });
    const result = await recon.run({ limit: 1000 });
    assert.ok(result.discrepancy_count > 0, 'reconciliation detects discrepancy');
  });

  test('detects unbalanced journal', async () => {
    if (!ready) return skip();
    const acc = await prisma.accountingAccount.findFirst({ where: { account_code: 'CASH' } });
    const je = await prisma.journalEntry.create({ data: {
      reference: `RECON-JRN-${Date.now()}`,
      posting_date: new Date(),
      source_type: 'TEST',
      status: 'POSTED',
      lines: { create: [
        { account_id: acc.account_id, direction: 'DEBIT', amount: 100 },
        { account_id: acc.account_id, direction: 'CREDIT', amount: 90 },
      ] },
    } });
    created.journals.push(je.journal_id);
    const recon = new FinanceReconciliationService({ prisma });
    const result = await recon.run({ limit: 1000 });
    assert.ok(result.discrepancy_count > 0, 'reconciliation detects unbalanced journal');
  });
});
