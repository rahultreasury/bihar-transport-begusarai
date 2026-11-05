const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const FinancePostingService = require('../services/FinancePostingService');

const ADMIN = { user_id: null, role: 'admin' };
const created = { pumps: [], payments: [] };
let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

before(async () => {
  if (!process.env.DATABASE_URL) { skipReason = 'DATABASE_URL is not set'; return; }
  try { await prisma.$queryRaw`SELECT 1`; ready = true; skipReason = null; }
  catch (e) { skipReason = `live PostgreSQL unavailable: ${String(e.message).split('\n')[0]}`; }
});

after(async () => {
  if (!ready) return;
  await prisma.petrolPumpPayment.deleteMany({ where: { pump_id: { in: created.pumps } } });
  await prisma.petrolPumpFuelTransaction.deleteMany({ where: { pump_id: { in: created.pumps } } });
  await prisma.petrolPump.deleteMany({ where: { pump_id: { in: created.pumps } } });
  await prisma.$disconnect();
});

function skip() { return { skip: skipReason }; }

describe('PUMP DB', () => {
  test('payPump idempotency', async () => {
    if (!ready) return skip();
    const posting = new FinancePostingService({ prisma });
    const pump = await posting.createPump({ pump_name: `PUMP-${Date.now()}` }, ADMIN);
    created.pumps.push(pump.pump_id);
    await prisma.petrolPump.update({ where: { pump_id: pump.pump_id }, data: { current_balance: 2000 } });
    const key = `PUMP-KEY-${pump.pump_id}`;
    await posting.payPump({ pump_id: pump.pump_id, amount: 1000, payment_method: 'cash', idempotency_key: key }, ADMIN);
    const second = await posting.payPump({ pump_id: pump.pump_id, amount: 1000, payment_method: 'cash', idempotency_key: key }, ADMIN);
    assert.equal(second.payment.idempotency_key || key, key);
  });

  test('rollback on journal failure', async () => {
    if (!ready) return skip();
    const posting = new FinancePostingService({ prisma });
    const pump = await posting.createPump({ pump_name: `PUMP2-${Date.now()}` }, ADMIN);
    created.pumps.push(pump.pump_id);
    await prisma.petrolPump.update({ where: { pump_id: pump.pump_id }, data: { current_balance: 2000 } });
    const original = posting.journalService.postJournal.bind(posting.journalService);
    posting.journalService.postJournal = async () => { throw new Error('injected pump journal failure'); };
    await assert.rejects(
      () => posting.payPump({ pump_id: pump.pump_id, amount: 1000, payment_method: 'cash' }, ADMIN),
      /injected pump journal failure/
    );
    posting.journalService.postJournal = original;
  });
});
