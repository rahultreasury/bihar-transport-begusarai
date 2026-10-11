/**
 * phase3VendorPayment.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE 3 — INTEGRATION TESTS AGAINST A LIVE POSTGRESQL DATABASE
 * ---------------------------------------------------------------------------
 *
 * The unit suite (tests/phase3VendorPayment.test.js) proves the arithmetic and
 * the branching. This suite proves the same contract against the real
 * Express → Service → Prisma → PostgreSQL path: real tables, real foreign
 * keys, real transactions, real rollbacks.
 *
 * Nothing here is mocked. Every row is created for the test and deleted again
 * in `after()`, so the suite leaves the database exactly as it found it. The
 * only records it touches are the ones it inserts itself, tracked by id.
 *
 * IF NO LIVE POSTGRESQL IS AVAILABLE the tests report themselves as SKIPPED
 * with the reason. They never pretend to have passed.
 *
 * Run explicitly with:
 *   DATABASE_URL=postgresql://... node --test tests/phase3VendorPayment.db.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const VendorLedgerService = require('../services/VendorLedgerService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');
const VehicleHireService = require('../services/VehicleHireService');
const { ValidationError } = require('../utils/AppError');

const ADMIN = { user_id: null, role: 'admin' };

// A unique-ish tag so nothing this suite creates can collide with real data.
const TAG = `P3T${process.pid}`;
const created = {
  users: [], drivers: [], vehicleOwners: [], transportVehicles: [], trips: [],
  tripFinancials: [], tripAdvances: [], tripSettlements: [], financialTransactions: [],
};

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

before(async () => {
  if (!process.env.DATABASE_URL) {
    skipReason = 'DATABASE_URL is not set';
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    ready = true;
    skipReason = null;
  } catch (error) {
    skipReason = `live PostgreSQL unavailable: ${String(error.message).split('\n')[0]}`;
  }
});

after(async () => {
  if (!ready) return;
  // Reverse dependency order; each delete is scoped to rows this file made.
  await prisma.financialTransaction.deleteMany({ where: { transaction_id: { in: created.financialTransactions } } });
  await prisma.tripSettlement.deleteMany({ where: { settlement_id: { in: created.tripSettlements } } });
  await prisma.tripAdvance.deleteMany({ where: { advance_id: { in: created.tripAdvances } } });
  await prisma.tripFinancial.deleteMany({ where: { trip_financial_id: { in: created.tripFinancials } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

/**
 * Build one vendor → vehicle → driver → trip chain.
 * @returns {Promise<{ownerId:number, tripId:number, driverId:number, vehicleId:number}>}
 */
async function seedTrip({ freight, commissionType = null, commissionPct = null, suffix, tripDate = '2026-09-01' }) {
  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `P3 Owner ${suffix}`, mobile: `999${suffix}`.slice(0, 10), owner_type: 'TRANSPORT_COMPANY' },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: { vehicle_number: `P3${suffix}`.padEnd(12, 'X').slice(0, 14), vehicle_type: 'TRUCK', owner_id: owner.owner_id },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const user = await prisma.user.create({
    data: {
      first_name: 'P3', last_name: 'Driver',
      email: `p3.driver.${suffix}@example.test`,
      phone: `88${suffix}0000`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(user.user_id);

  const driver = await prisma.driver.create({
    data: { user_id: user.user_id, driver_name: `P3 Driver ${suffix}`, mobile: `77${suffix}0000`.slice(0, 10), transport_owner_id: owner.owner_id },
  });
  created.drivers.push(driver.driver_id);

  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-P3-${suffix}`,
      source_type: 'DIRECT',
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Begusarai',
      pickup_city: 'Begusarai',
      drop_location: 'Patna',
      drop_city: 'Patna',
      freight_amount: freight,
      driver_payment: 0,
      commission_type: commissionType,
      commission_percentage: commissionPct,
      trip_date: new Date(`${tripDate}T00:00:00.000Z`),
      status: 'IN_TRANSIT',
    },
  });
  created.trips.push(trip.trip_id);

  return {
    ownerId: owner.owner_id,
    tripId: trip.trip_id,
    driverId: driver.driver_id,
    vehicleId: vehicle.vehicle_id,
  };
}

/** Remember rows the services created so `after()` can remove them. */
async function track(ctx) {
  const [adv, set, fin, tx] = await Promise.all([
    prisma.tripAdvance.findMany({ where: { trip_id: ctx.tripId }, select: { advance_id: true } }),
    prisma.tripSettlement.findMany({ where: { trip_id: ctx.tripId }, select: { settlement_id: true } }),
    prisma.tripFinancial.findMany({ where: { trip_id: ctx.tripId }, select: { trip_financial_id: true } }),
    prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId }, select: { transaction_id: true } }),
  ]);
  created.tripAdvances.push(...adv.map((r) => r.advance_id));
  created.tripSettlements.push(...set.map((r) => r.settlement_id));
  created.tripFinancials.push(...fin.map((r) => r.trip_financial_id));
  created.financialTransactions.push(...tx.map((r) => r.transaction_id));
}

const guard = async (t) => {
  if (!ready) return t.skip(skipReason);
  return null;
};

// ===========================================================================
// Live: the whole Phase 3 flow against PostgreSQL
// ===========================================================================

test('DB · full vendor money flow: payable → advance → partial payments → settled', async (t) => {
  if (await guard(t)) return;

  // 42,000 gross with a fixed 2,000 commission ⇒ 40,000 net vendor payable.
  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10101' });
  const ledger = new VendorLedgerService({ prisma });
  const advances = new TripAdvanceService({ prisma });
  const settle = new TripSettlementService({ prisma });

  // --- the Phase 2 identity, read from the persisted hire ------------------
  const start = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(start.grossHire, 42000);
  assert.equal(start.commissionAmount, 2000);
  assert.equal(start.netVendorPayable, 40000);
  assert.equal(start.outstanding, 40000);
  assert.equal(start.paymentStatus, 'PENDING');
  await track(ctx);

  // --- advance -------------------------------------------------------------
  await advances.createAdvance(null, {
    trip_id: ctx.tripId,
    amount: 10000,
    advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash',
    reference_number: `${TAG}-ADV-1`,
    advance_date: '2026-10-06',
  }, ADMIN);
  await track(ctx);

  const afterAdvance = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(afterAdvance.grossHire, 42000, 'gross unchanged');
  assert.equal(afterAdvance.commissionAmount, 2000, 'commission unchanged');
  assert.equal(afterAdvance.netVendorPayable, 40000, 'net payable unchanged');
  assert.equal(afterAdvance.advancePaid, 10000);
  assert.equal(afterAdvance.outstanding, 30000, 'advance reduced the outstanding');

  // The advance really is a canonical money row, linked to the trip's vendor.
  const advanceTx = await prisma.financialTransaction.findFirst({
    where: { trip_id: ctx.tripId, transaction_type: 'OWNER_ADVANCE' },
  });
  assert.ok(advanceTx, 'a standalone-trip advance must still create a FinancialTransaction');
  assert.equal(advanceTx.transport_owner_id, ctx.ownerId);
  assert.equal(advanceTx.direction, 'DEBIT');
  assert.equal(advanceTx.to_party, 'TRANSPORT_OWNER');
  assert.equal(advanceTx.reference_number, `${TAG}-ADV-1`);

  // The Trip row itself was never touched by the money movement.
  const tripRow = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(tripRow.freight_amount, 42000);

  // --- partial payments ----------------------------------------------------
  const pay = async (amount, ref, date) => {
    const result = await settle.recordOwnerSettlementByTripId(ctx.tripId, {
      amount, payment_method: 'bank_transfer', reference_number: ref, settlement_date: date,
    }, ADMIN);
    await track(ctx);
    return result;
  };

  const p1 = await pay(10000, `${TAG}-PAY-1`, '2026-10-08');
  assert.equal(p1.owner_settlement_amount, 10000);
  assert.equal(p1.owner_settlement_status, 'PARTIAL');
  assert.equal((await ledger.getOwnerPosition(ctx.tripId)).outstanding, 20000);

  const p2 = await pay(15000, `${TAG}-PAY-2`, '2026-10-09');
  assert.equal(p2.owner_settlement_amount, 25000, 'cumulative across partial payments');
  assert.equal(p2.owner_settlement_status, 'PARTIAL');
  assert.equal((await ledger.getOwnerPosition(ctx.tripId)).outstanding, 5000);

  const p3 = await pay(5000, `${TAG}-PAY-3`, '2026-10-10');
  assert.equal(p3.owner_settlement_amount, 30000);
  assert.equal(p3.owner_settlement_status, 'PAID', 'status follows the REMAINING balance');
  assert.equal(p3.owner_settlement_paid_at instanceof Date, true);

  const final = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(final.outstanding, 0);
  assert.equal(final.settled, true);
  assert.equal(final.paymentStatus, 'PAID');
  assert.equal(final.netVendorPayable, 40000, 'the obligation was never rewritten');

  // All three payments remain individually visible.
  const payments = await prisma.financialTransaction.findMany({
    where: { trip_id: ctx.tripId, transaction_type: 'OWNER_SETTLEMENT' },
    orderBy: { transaction_date: 'asc' },
  });
  assert.equal(payments.length, 3);
  assert.deepEqual(payments.map((p) => p.amount), [10000, 15000, 5000]);
  assert.deepEqual(payments.map((p) => p.reference_number), [`${TAG}-PAY-1`, `${TAG}-PAY-2`, `${TAG}-PAY-3`]);
});

test('DB · the vendor ledger shows the whole account chronologically', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10102', tripDate: '2026-09-01' });
  const ledger = new VendorLedgerService({ prisma });
  const advances = new TripAdvanceService({ prisma });
  const settle = new TripSettlementService({ prisma });

  await advances.createAdvance(null, {
    trip_id: ctx.tripId, amount: 10000, advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash', reference_number: `${TAG}-L-ADV`,
    advance_date: '2026-09-10',
  }, ADMIN);
  await settle.recordOwnerSettlementByTripId(ctx.tripId, {
    amount: 15000, payment_method: 'upi', reference_number: `${TAG}-L-PAY`,
    settlement_date: '2026-09-20',
  }, ADMIN);
  await track(ctx);

  const statement = await ledger.getOwnerLedger(ctx.ownerId);

  assert.equal(statement.owner.owner_id, ctx.ownerId);
  assert.equal(statement.openingBalance, 0);
  assert.equal(statement.totalObligations, 40000);
  assert.equal(statement.totalAdvances, 10000);
  assert.equal(statement.totalPayments, 15000);
  assert.equal(statement.closingBalance, 15000);
  assert.equal(statement.outstanding, 15000);
  assert.equal(statement.settled, false);

  // Chronological, with a running balance on every line.
  const dates = statement.entries.map((e) => new Date(e.date).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b));
  assert.deepEqual(statement.entries.map((e) => e.balance), [40000, 30000, 15000]);

  // Every ledger field STEP 9 asks for is present on each line.
  for (const entry of statement.entries) {
    for (const field of ['date', 'trip_number', 'transaction_type', 'direction', 'amount', 'reference', 'balance']) {
      assert.ok(field in entry, `ledger entry is missing ${field}`);
    }
  }
  assert.equal(statement.entries[0].trip_number, `BTBT-P3-10102`);
});

test('DB · a repeated request with the same reference records nothing twice', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10103' });
  const advances = new TripAdvanceService({ prisma });
  const settle = new TripSettlementService({ prisma });
  const ledger = new VendorLedgerService({ prisma });

  const advancePayload = {
    trip_id: ctx.tripId, amount: 10000, advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash', reference_number: `${TAG}-DUP`,
  };
  const first = await advances.createAdvance(null, advancePayload, ADMIN);
  const second = await advances.createAdvance(null, advancePayload, ADMIN);
  await track(ctx);

  assert.equal(second.already_recorded, true);
  assert.equal(second.advance_id, first.advance_id);

  const payPayload = { amount: 5000, payment_method: 'upi', reference_number: `${TAG}-DUP-PAY` };
  const payFirst = await settle.recordOwnerSettlementByTripId(ctx.tripId, payPayload, ADMIN);
  const paySecond = await settle.recordOwnerSettlementByTripId(ctx.tripId, payPayload, ADMIN);

  assert.equal(paySecond.already_recorded, true);
  assert.equal(paySecond.owner_settlement_amount, payFirst.owner_settlement_amount);

  const advances2 = await prisma.tripAdvance.count({ where: { trip_id: ctx.tripId } });
  const settlements = await prisma.financialTransaction.count({
    where: { trip_id: ctx.tripId, transaction_type: 'OWNER_SETTLEMENT' },
  });
  assert.equal(advances2, 1);
  assert.equal(settlements, 1);
  assert.equal((await ledger.getOwnerPosition(ctx.tripId)).outstanding, 25000, 'charged once');
});

test('DB · over-payment is rejected and leaves no trace', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10104' });
  const settle = new TripSettlementService({ prisma });

  await assert.rejects(
    () => settle.recordOwnerSettlementByTripId(ctx.tripId, {
      amount: 99999,
      payment_method: 'cash',
      net_vendor_payable: 999999, // must be ignored
      owner_payable: 999999,
    }, ADMIN),
    (e) => e instanceof ValidationError
  );

  assert.equal(await prisma.financialTransaction.count({ where: { trip_id: ctx.tripId } }), 0);
  assert.equal(await prisma.tripSettlement.count({ where: { trip_id: ctx.tripId } }), 0);
  assert.equal(await prisma.tripAdvance.count({ where: { trip_id: ctx.tripId } }), 0);
});

test('DB · two trips for one vendor aggregate into a single outstanding', async (t) => {
  if (await guard(t)) return;

  const first = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10105' });
  const second = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10106' });

  // Move the second trip onto the SAME vendor so the roll-up is meaningful.
  await prisma.trip.update({
    where: { trip_id: second.tripId },
    data: { transport_owner_id: first.ownerId },
  });
  await prisma.driver.update({
    where: { driver_id: second.driverId },
    data: { transport_owner_id: first.ownerId },
  });

  const ledger = new VendorLedgerService({ prisma });
  const settle = new TripSettlementService({ prisma });

  await settle.recordOwnerSettlementByTripId(first.tripId, {
    amount: 40000, payment_method: 'bank_transfer', reference_number: `${TAG}-M1`,
  }, ADMIN);
  await track(first);
  await track(second);

  const statement = await ledger.getOwnerLedger(first.ownerId);
  assert.equal(statement.tripCount, 2);
  assert.equal(statement.totalObligations, 80000);
  assert.equal(statement.totalPayments, 40000);
  assert.equal(statement.outstanding, 40000);

  const perTrip = await ledger.getOwnerTripPositions(first.ownerId);
  const byId = Object.fromEntries(perTrip.map((p) => [p.trip_id, p]));
  assert.equal(byId[first.tripId].outstanding, 0);
  assert.equal(byId[second.tripId].outstanding, 40000);
  assert.equal(perTrip.reduce((s, p) => s + p.outstanding, 0), statement.outstanding);
});

test('DB · fuel records never reduce the vendor payable', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10107' });
  const ledger = new VendorLedgerService({ prisma });
  const advances = new TripAdvanceService({ prisma });

  const before = await ledger.getOwnerPosition(ctx.tripId);

  await prisma.tripExpense.create({
    data: { trip_id: ctx.tripId, expense_type: 'DIESEL', amount: 8000, paid_by: 'TRANSPORT_OWNER', payment_method: 'cash' },
  });
  await advances.createAdvance(null, {
    trip_id: ctx.tripId, amount: 5000, advance_type: 'FUEL_ADVANCE',
    payment_method: 'cash', reference_number: `${TAG}-FUEL`,
  }, ADMIN);
  await track(ctx);

  const after = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(after.netVendorPayable, before.netVendorPayable);
  assert.equal(after.outstanding, before.outstanding);
  assert.equal(after.paidTotal, 0);

  const fuelTx = await prisma.financialTransaction.findFirst({
    where: { trip_id: ctx.tripId, transaction_type: 'FUEL_ADVANCE' },
  });
  assert.equal(fuelTx.to_party, 'DRIVER');

  await prisma.tripExpense.deleteMany({ where: { trip_id: ctx.tripId } });
});

test('DB · creating the hire creates no money', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 42000, commissionType: 'fixed', commissionPct: 2000, suffix: '10108' });
  const hire = new VehicleHireService({ prisma });

  const first = await hire.getVehicleHire(ctx.tripId);
  const second = await hire.getVehicleHire(ctx.tripId);

  assert.equal(first.netVendorPayable, 40000);
  assert.deepEqual(
    { ...first, payments: undefined },
    { ...second, payments: undefined },
    'reading the hire twice is stable'
  );

  for (const model of ['financialTransaction', 'tripAdvance', 'tripSettlement', 'tripPayment']) {
    const count = await prisma[model].count({ where: { trip_id: ctx.tripId } });
    assert.equal(count, 0, `${model} must stay empty after creating/reading a hire`);
  }
});
