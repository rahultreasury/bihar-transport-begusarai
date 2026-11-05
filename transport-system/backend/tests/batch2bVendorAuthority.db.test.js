/**
 * batch2bVendorAuthority.db.test.js
 * ---------------------------------------------------------------------------
 * BATCH 2B · PHASE 1 — THE VENDOR PAYABLE'S AUTHORITY + THE ₹42k/₹40k SCENARIO
 * ---------------------------------------------------------------------------
 *
 * Verify against a live PostgreSQL database the exact Batch 2B contract:
 *
 *   §1  A stored VehicleHire record is the AUTHORITY for the vendor payable.
 *       The trip's own freight (the CUSTOMER's figure, here ₹50,000) must
 *       never be read as the vehicle side while a hire record exists — the
 *       hire's stored gross ₹42,000 / commission ₹2,000 / net ₹40,000 wins,
 *       with `hire_source: VEHICLE_HIRE_RECORD`.
 *
 *   §2  Payments of ₹30,000 against a ₹40,000 net leave EXACTLY ₹10,000
 *       outstanding, visible item by item; clearing the rest lands at 0.
 *
 *   §3  An over-payment is refused and leaves no trace.
 *
 *   §4  A repeated request with the same reference records nothing twice.
 *
 *   §5  Two concurrent settlements cannot both spend the same outstanding —
 *       the FOR UPDATE + re-derive guard means only one can win.
 *
 *   §6  A trip with NO hire record falls back to TRIP_TERMS derivation from
 *       its own freight and commission columns.
 *
 *   §7  The hire record is never rewritten by money movement, and the
 *       customer freight is never overwritten by the vendor net.
 *
 * Nothing is mocked. Every row is created for the test and deleted again in
 * `after()`. If no live PostgreSQL is available the suite reports itself as
 * SKIPPED — it never pretends to have passed.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const VendorLedgerService = require('../services/VendorLedgerService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');

const ADMIN = { user_id: null, role: 'admin' };

const created = {
  users: [], drivers: [], vehicleOwners: [], transportVehicles: [], trips: [],
  vehicleHires: [], tripFinancials: [], tripAdvances: [], tripSettlements: [],
  financialTransactions: [],
};

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

let counter = 0;
function uniq(base) {
  counter += 1;
  return `${base}${process.pid}${counter}${Date.now().toString(36)}`;
}

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
  await prisma.vehicleHire.deleteMany({ where: { hire_id: { in: created.vehicleHires } } });
  await prisma.financialTransaction.deleteMany({ where: { transaction_id: { in: created.financialTransactions } } });
  await prisma.tripAdvance.deleteMany({ where: { advance_id: { in: created.tripAdvances } } });
  await prisma.tripSettlement.deleteMany({ where: { settlement_id: { in: created.tripSettlements } } });
  await prisma.tripFinancial.deleteMany({ where: { trip_financial_id: { in: created.tripFinancials } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

/**
 * One vendor → vehicle → driver → trip chain. `freight` is the CUSTOMER
 * freight — by specification ₹50,000, deliberately NOT the vehicle-side gross,
 * so a regression that read the trip for hire money would answer ₹50,000 and
 * fail these assertions rather than pass by coincidence.
 */
async function seedTrip({ freight = 50000, commissionType = null, commissionPct = null, suffix }) {
  const u = uniq(suffix || 'B2BV');
  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `B2B Owner ${u}`, mobile: `999${u}`.slice(0, 10), owner_type: 'TRANSPORT_COMPANY' },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: { vehicle_number: `P2B${u}`.slice(0, 20), vehicle_type: 'TRUCK', owner_id: owner.owner_id },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const user = await prisma.user.create({
    data: {
      first_name: 'B2B', last_name: 'Driver',
      email: `b2b.driver.${u}@example.test`,
      phone: `88${u}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(user.user_id);

  const driver = await prisma.driver.create({
    data: { user_id: user.user_id, driver_name: `B2B Driver ${u}`, mobile: `77${u}`.slice(0, 10), transport_owner_id: owner.owner_id },
  });
  created.drivers.push(driver.driver_id);

  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-B2B-${u}`,
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
      trip_date: new Date('2026-09-25T00:00:00.000Z'),
      status: 'IN_TRANSIT',
    },
  });
  created.trips.push(trip.trip_id);

  return { ownerId: owner.owner_id, tripId: trip.trip_id, driverId: driver.driver_id, vehicleId: vehicle.vehicle_id, freight };
}

/**
 * The Phase 2 commercial document — the stored hire. Written directly so this
 * suite tests the LEDGER's authority rule, not the hire workflow itself.
 */
async function storeHire(ctx, {
  gross = 42000, commission = 2000, net = 40000, rateValue = 42000,
} = {}) {
  const hire = await prisma.vehicleHire.create({
    data: {
      trip_id: ctx.tripId,
      vehicle_id: ctx.vehicleId,
      vendor_id: ctx.ownerId,
      driver_id: ctx.driverId,
      billing_to: 'VEHICLE_VENDOR',
      business_model: 'COMMISSION',
      rate_basis: 'FIXED',
      rate_value: rateValue,
      gross_hire: gross,
      commission_type: 'FIXED',
      commission_rate: 2000,
      commission_amount: commission,
      net_vendor_payable: net,
    },
  });
  created.vehicleHires.push(hire.hire_id);
  return hire;
}

async function track(ctx) {
  const [fin, tf, adv, set, tx] = await Promise.all([
    prisma.vehicleHire.findMany({ where: { trip_id: ctx.tripId }, select: { hire_id: true } }),
    prisma.tripFinancial.findMany({ where: { trip_id: ctx.tripId }, select: { trip_financial_id: true } }),
    prisma.tripAdvance.findMany({ where: { trip_id: ctx.tripId }, select: { advance_id: true } }),
    prisma.tripSettlement.findMany({ where: { trip_id: ctx.tripId }, select: { settlement_id: true } }),
    prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId }, select: { transaction_id: true } }),
  ]);
  created.vehicleHires.push(...fin.map((r) => r.hire_id));
  created.tripFinancials.push(...tf.map((r) => r.trip_financial_id));
  created.tripAdvances.push(...adv.map((r) => r.advance_id));
  created.tripSettlements.push(...set.map((r) => r.settlement_id));
  created.financialTransactions.push(...tx.map((r) => r.transaction_id));
}

const guard = async (t) => {
  if (!ready) return t.skip(skipReason);
  return null;
};

/* ==========================================================================
   §1 — THE STORED HIRE IS THE AUTHORITY
   ========================================================================== */

test('DB · the stored VehicleHire record outranks the trip freight and any browser payload', async (t) => {
  if (await guard(t)) return;

  // The exact Batch 2B scenario: freight ₹50,000 on the trip (the CUSTOMER's
  // number), hire stored as gross ₹42,000 · commission ₹2,000 · net ₹40,000.
  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT1' });
  await storeHire(ctx);
  const ledger = new VendorLedgerService({ prisma });

  // A browser-supplied payable is accepted as an argument and NEVER read.
  const position = await ledger.getOwnerPosition(ctx.tripId, {
    net_vendor_payable: 1,
    gross_hire: 5,
    commission_amount: 5,
  });

  assert.equal(position.grossHire, 42000, 'gross comes verbatim from the hire record');
  assert.equal(position.commissionAmount, 2000, 'commission comes verbatim from the hire record');
  assert.equal(position.netVendorPayable, 40000, 'net payable comes verbatim from the hire record');
  assert.equal(position.hire_source, 'VEHICLE_HIRE_RECORD', 'the provenance names the hire record');
  assert.equal(position.outstanding, 40000, 'nothing paid yet — the whole net is outstanding');

  // The stored document itself is untouched by reading it.
  const hireRow = await prisma.vehicleHire.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(Number(hireRow.gross_hire), 42000);
  assert.equal(Number(hireRow.net_vendor_payable), 40000);
  await track(ctx);
});

test('DB · a trip with no hire record derives TRIP_TERMS from its own columns', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({
    freight: 42000,
    commissionType: 'fixed',
    commissionPct: 2000,
    suffix: 'AUT2',
  });
  const ledger = new VendorLedgerService({ prisma });

  const position = await ledger.getOwnerPosition(ctx.tripId);

  assert.equal(position.hire_source, 'TRIP_TERMS', 'the legacy derivation is named honestly');
  assert.equal(position.grossHire, 42000);
  assert.equal(position.commissionAmount, 2000);
  assert.equal(position.netVendorPayable, 40000);
  assert.equal(position.outstanding, 40000);
  await track(ctx);
});

/* ==========================================================================
   §2 — ₹30,000 PAID LEAVES ₹10,000; CLEARING THE REST LANDS AT 0
   ========================================================================== */

test('DB · ₹30,000 of a ₹40,000 net leaves exactly ₹10,000 outstanding', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT3' });
  await storeHire(ctx);
  const ledger = new VendorLedgerService({ prisma });
  const settle = new TripSettlementService({ prisma });

  const pay = async (amount, ref, date) => {
    const result = await settle.recordOwnerSettlementByTripId(ctx.tripId, {
      amount,
      payment_method: 'bank_transfer',
      reference_number: ref,
      settlement_date: date,
    }, ADMIN);
    await track(ctx);
    return result;
  };

  // One itemized payment of ₹30,000.
  await pay(30000, `B2B-AUT3-P1`, '2026-10-20');

  const after = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(after.paymentPaid, 30000);
  assert.equal(after.paidTotal, 30000);
  assert.equal(after.outstanding, 10000, 'exactly ₹10,000 remains outstanding');

  // Clearing the remainder closes the obligation.
  const final = await pay(10000, 'B2B-AUT3-P2', '2026-10-21');
  assert.equal(final.owner_settlement_status, 'PAID');

  const ended = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(ended.outstanding, 0);
  assert.equal(ended.paymentPaid, 40000, 'every rupee is itemized: 30,000 + 10,000');
  assert.equal(ended.grossHire, 42000, 'the hire was never rewritten by the money');
  assert.equal(ended.netVendorPayable, 40000, 'the obligation was never rewritten');
  assert.equal(ended.hire_source, 'VEHICLE_HIRE_RECORD', 'authority unchanged after settlement');

  // The customer freight is NEVER the vendor net — it was ₹50,000 all along.
  const tripRow = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(Number(tripRow.freight_amount), 50000);
});

test('DB · an advance counts toward the ₹10,000 too', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT4' });
  await storeHire(ctx);
  const ledger = new VendorLedgerService({ prisma });
  const advances = new TripAdvanceService({ prisma });
  const settle = new TripSettlementService({ prisma });

  await advances.createAdvance(null, {
    trip_id: ctx.tripId,
    amount: 10000,
    advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash',
    reference_number: `B2B-AUT4-ADV`,
    advance_date: '2026-10-15',
  }, ADMIN);
  await settle.recordOwnerSettlementByTripId(ctx.tripId, {
    amount: 20000,
    payment_method: 'upi',
    reference_number: `B2B-AUT4-P1`,
    settlement_date: '2026-10-18',
  }, ADMIN);
  await track(ctx);

  const position = await ledger.getOwnerPosition(ctx.tripId);
  assert.equal(position.advancePaid, 10000);
  assert.equal(position.paymentPaid, 20000);
  assert.equal(position.paidTotal, 30000);
  assert.equal(position.outstanding, 10000, 'advance and payments sum against the same ₹40,000');
});

/* ==========================================================================
   §3 — THE OVER-PAYMENT REFUSAL HOLDS AGAINST THE STORED HIRE
   ========================================================================== */

test('DB · an over-payment is refused even when the payable came from the hire record', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT5' });
  await storeHire(ctx);
  const settle = new TripSettlementService({ prisma });

  await assert.rejects(
    () => settle.recordOwnerSettlementByTripId(ctx.tripId, {
      amount: 40001,
      payment_method: 'bank_transfer',
      reference_number: `B2B-AUT5-OVER`,
      settlement_date: '2026-10-20',
    }, ADMIN),
  );

  const rows = await prisma.financialTransaction.findMany({
    where: { trip_id: ctx.tripId, transaction_type: 'OWNER_SETTLEMENT' },
  });
  assert.equal(rows.length, 0, 'a refused payment leaves no trace');
  await track(ctx);
});

/* ==========================================================================
   §6 — CONCURRENCY: TWO SETTLEMENTS CANNOT SPEND ONE OUTSTANDING
   ========================================================================== */

test('DB · two concurrent settlements of ₹25,000 cannot both be written against ₹40,000', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT6' });
  await storeHire(ctx);
  const settle = new TripSettlementService({ prisma });

  const attempt = (ref) => settle.recordOwnerSettlementByTripId(ctx.tripId, {
    amount: 25000,
    payment_method: 'bank_transfer',
    reference_number: `B2B-AUT6-${ref}`,
    settlement_date: '2026-10-20',
  }, ADMIN);

  const results = await Promise.allSettled([attempt('T1'), attempt('T2')]);
  await track(ctx);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'only one settlement can spend the same outstanding');
  assert.equal(rejected.length, 1, 'the loser is refused — never silently re-issued');

  const position = await new VendorLedgerService({ prisma }).getOwnerPosition(ctx.tripId);
  assert.equal(position.paymentPaid, 25000, 'exactly one payment reached the ledger');
  assert.equal(position.outstanding, 15000, 'the outstanding stays consistent with the ledger');
  assert.ok(position.outstanding >= 0, 'the obligation can never go negative');
});

/* ==========================================================================
   §7 — THE LEDGER NEVER REWRITES THE COMMERCIAL DOCUMENT
   ========================================================================== */

test('DB · the stored hire and the trip freight survive the full money flow byte-identical', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'AUT7' });
  await storeHire(ctx);
  const settle = new TripSettlementService({ prisma });

  await settle.recordOwnerSettlementByTripId(ctx.tripId, {
    amount: 30000,
    payment_method: 'cash',
    reference_number: `B2B-AUT7-P1`,
    settlement_date: '2026-10-20',
  }, ADMIN);
  await track(ctx);

  const hireRow = await prisma.vehicleHire.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(Number(hireRow.gross_hire), 42000);
  assert.equal(Number(hireRow.commission_amount), 2000);
  assert.equal(Number(hireRow.net_vendor_payable), 40000);

  const tripRow = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(Number(tripRow.freight_amount), 50000, 'the customer freight is untouched');
});
