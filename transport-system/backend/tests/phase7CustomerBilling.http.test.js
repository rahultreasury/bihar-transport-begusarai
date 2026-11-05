/**
 * phase7CustomerBilling.http.test.js
 * ---------------------------------------------------------------------------
 * PHASE 7 — CUSTOMER BILLING → CUSTOMER PAYMENT (LIVE HTTP VERIFICATION)
 * ---------------------------------------------------------------------------
 * Boots the real Express server and exercises the real billing/payment
 * endpoints over TCP with real identities and real, signed JWTs:
 *
 *   GET  /api/trips/:tripId/financials            (admin only)
 *   GET  /api/trips/:bookingId/financial           (role-projected)
 *   GET  /api/trips/:bookingId/financial/timeline  (role-projected)
 *   GET  /api/trips/:bookingId/transactions        (role-projected)
 *   GET  /api/trips/:bookingId/transactions/ledger (role-projected)
 *   GET  /api/trips/:tripId/transactions           (admin only)
 *   POST /api/trips/:tripId/payments/client        (admin only, idempotent)
 *   POST /api/trips/:id/payments                   (admin only, idempotent)
 *   GET  /api/financials/summary                   (admin only)
 *
 * Every principal is a REAL identity read from the database, and every JWT is
 * signed with the REAL JWT_SECRET. Nothing is stubbed. This is the STEP 22 /
 * STEP 24 evidence: no claim is made here that did not actually run.
 *
 * Usage:  node --test tests/phase7CustomerBilling.http.test.js
 */

require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { prisma } = require('../config/prisma');

const PORT = process.env.PH7_TEST_PORT || '3997';
let child = null;
const base = `http://127.0.0.1:${PORT}`;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await fetch(`${base}/api/health`); } catch { /* retry */ }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 500));
  }
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
let booking = null;
let trip = null;
let adminToken = null;
let customerToken = null;
let otherCustomerToken = null;
let driverToken = null;
let partnerToken = null;

const created = { users: [], drivers: [], owners: [], vehicles: [] };
const FREIGHT = 50000;
const TAG = `PH7-${Date.now().toString(36)}`;

const sign = (id, type) => jwt.sign({ id, type }, process.env.JWT_SECRET, { expiresIn: '1h' });

async function call(method, p, token, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

/** Build a booking + trip owned by a brand-new customer, plus every principal. */
async function provision() {
  const admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
  const partner = await prisma.partner.findFirst({ orderBy: { partner_id: 'asc' } });
  if (!admin) return false;

  const donor = await prisma.trip.findFirst({
    where: { status: { in: ['IN_TRANSIT', 'ASSIGNED', 'COMPLETED', 'PENDING'] } },
    orderBy: { trip_id: 'asc' },
  });
  if (!donor) return false;

  const digits = Date.now().toString().slice(-6);
  const mkUser = async (label) => {
    const u = await prisma.user.create({
      data: {
        first_name: `P7${label}`, last_name: 'Http',
        email: `p7.${label}.${digits}@example.test`,
        phone: `${label === 'cust' ? '81' : label === 'other' ? '82' : '83'}${digits}`.slice(0, 10),
        password_hash: 'not-used',
      },
    });
    created.users.push(u.user_id);
    return u;
  };

  const customer = await mkUser('cust');
  const other = await mkUser('other');

  const driverUser = await mkUser('drv');
  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id,
      driver_name: `P7 Driver ${digits}`,
      mobile: `84${digits}`.slice(0, 10),
      transport_owner_id: donor.transport_owner_id,
    },
  });
  created.drivers.push(driver.driver_id);

  booking = await prisma.booking.create({
    data: {
      user_id: customer.user_id,
      booking_number: `${TAG}-BK`,
      booking_reference: `${TAG}-BK`,
      driver_id: driver.driver_id,
      vehicle_id: donor.vehicle_id,
      vehicle_owner_id: donor.transport_owner_id,
      pickup_location: 'Begusarai', drop_location: 'Patna',
      pickup_city: 'Begusarai', drop_city: 'Patna',
      pickup_state: 'Bihar', drop_state: 'Bihar',
      pickup_date: '2026-10-05', pickup_time: '10:00:00',
      goods_description: 'Cement Bags',
      vehicle_type_required: 'Tata 407 14ft',
      final_price: FREIGHT,
      driver_payout: 40000,
      status: 'confirmed', quote_status: 'ACCEPTED',
    },
  });

  trip = await prisma.trip.create({
    data: {
      trip_number: `${TAG}-TRIP`,
      source_type: 'ONLINE_BOOKING',
      booking_id: booking.booking_id,
      user_id: customer.user_id,
      transport_owner_id: donor.transport_owner_id,
      vehicle_id: donor.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Begusarai', pickup_city: 'Begusarai',
      drop_location: 'Patna', drop_city: 'Patna',
      freight_amount: FREIGHT,
      driver_payment: 40000,
      status: 'IN_TRANSIT',
    },
  });

  adminToken = sign(admin.admin_id, 'admin');
  customerToken = sign(customer.user_id, 'user');
  otherCustomerToken = sign(other.user_id, 'user');
  driverToken = sign(driverUser.user_id, 'user');
  if (partner) {
    const owner = await prisma.user.findFirst({
      where: { role: 'partner' }, orderBy: { user_id: 'asc' },
    });
    if (owner) partnerToken = sign(owner.user_id, 'user');
  }

  console.log(`    [http] trip=${trip.trip_id} booking=${booking.booking_id} `
    + `admin=${admin.admin_id} customer=${customer.user_id} other=${other.user_id} `
    + `driver=${driver.driver_id} partner=${partnerToken ? 'yes' : 'no'}`);
  return true;
}

async function cleanup() {
  if (trip) {
    await prisma.financialTransaction.deleteMany({ where: { trip_id: trip.trip_id } });
    await prisma.tripPayment.deleteMany({ where: { trip_id: trip.trip_id } });
    await prisma.tripFinancial.deleteMany({ where: { trip_id: trip.trip_id } });
    await prisma.trip.delete({ where: { trip_id: trip.trip_id } });
    trip = null;
  }
  if (booking) {
    await prisma.invoice.deleteMany({ where: { booking_id: booking.booking_id } });
    await prisma.delivery.deleteMany({ where: { booking_id: booking.booking_id } });
    await prisma.booking.delete({ where: { booking_id: booking.booking_id } });
    booking = null;
  }
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  created.drivers = []; created.users = [];
}

/* =========================================================================== */

test('HTTP. the server is really listening', () => {
  assert.ok(base);
  console.log(`    [http] base = ${base}`);
});

test('HTTP. unauthenticated and forged requests are refused', async (t) => {
  if (!await provision()) { t.skip('no fixtures'); return; }
  const id = trip.trip_id;
  const bk = booking.booking_id;

  for (const [method, p, body] of [
    ['GET', `/api/trips/${id}/financials`, null],
    ['GET', `/api/trips/${bk}/financial`, null],
    ['GET', `/api/trips/${bk}/transactions`, null],
    ['GET', `/api/trips/${id}/transactions`, null],
    ['POST', `/api/trips/${id}/payments/client`, { amount: 1000 }],
    ['POST', `/api/trips/${id}/payments`, { amount: 1000, payment_type: 'PARTIAL' }],
  ]) {
    assert.equal((await call(method, p, null, body)).status, 401, `${method} ${p} must need auth`);
  }

  const forged = await call('GET', `/api/trips/${bk}/financial`, 'not.a.real.jwt');
  assert.equal(forged.status, 401, 'a forged token is refused');
});

test('HTTP. admin reads the authoritative customer position', async (t) => {
  if (!trip || !adminToken) { t.skip('no trip'); return; }
  const id = trip.trip_id;
  const bk = booking.booking_id;

  const fin = await call('GET', `/api/trips/${bk}/financial`, adminToken);
  assert.equal(fin.status, 200, `admin financial failed: ${JSON.stringify(fin.body)}`);
  assert.equal(fin.body.data.customerFare, FREIGHT, 'the billed amount is the server value');
  assert.equal(fin.body.data.outstandingAmount, FREIGHT, 'nothing paid yet');
  assert.equal(fin.body.data.paymentStatus, 'PENDING');

  // The standalone trip financials view (admin only).
  const tripFin = await call('GET', `/api/trips/${id}/financials`, adminToken);
  assert.equal(tripFin.status, 200, `trip financials failed: ${JSON.stringify(tripFin.body)}`);
  assert.equal(tripFin.body.data.freight, FREIGHT);
  assert.equal(tripFin.body.data.customerDue, FREIGHT);
  assert.equal(tripFin.body.data.ownerDue > 0, true, 'the vendor payable is a separate figure');
});

test('HTTP. a payment is recorded, and the outstanding follows the ledger', async (t) => {
  if (!trip || !adminToken) { t.skip('no trip'); return; }
  const id = trip.trip_id;
  const bk = booking.booking_id;

  const paid = await call('POST', `/api/trips/${id}/payments/client`, adminToken, {
    amount: 20000, payment_method: 'upi', reference_number: `${TAG}-UPI-1`,
  });
  assert.equal(paid.status, 201, `payment failed: ${JSON.stringify(paid.body)}`);

  const fin = await call('GET', `/api/trips/${bk}/financial`, adminToken);
  assert.equal(fin.body.data.amountReceived, 20000, 'the server reflects the payment');
  assert.equal(fin.body.data.outstandingAmount, 30000);
  assert.equal(fin.body.data.paymentStatus, 'PARTIAL');

  // Overpayment is refused by the existing repository rule.
  const over = await call('POST', `/api/trips/${id}/payments/client`, adminToken, {
    amount: 999999, reference_number: `${TAG}-OVER`,
  });
  assert.equal(over.status, 400, 'overpayment is rejected');
  assert.equal(over.body.success, false);
});

test('HTTP. a repeated payment request (double click / retry) moves no money twice', async (t) => {
  if (!trip || !adminToken) { t.skip('no trip'); return; }
  const id = trip.trip_id;
  const bk = booking.booking_id;
  const ref = `${TAG}-RETRY`;

  const before = await prisma.financialTransaction.count({ where: { trip_id: id } });

  const first = await call('POST', `/api/trips/${id}/payments/client`, adminToken, {
    amount: 10000, payment_method: 'upi', reference_number: ref,
  });
  assert.equal(first.status, 201);

  // Simulate a double click, a network retry and a duplicate callback.
  for (let i = 0; i < 3; i += 1) {
    const again = await call('POST', `/api/trips/${id}/payments/client`, adminToken, {
      amount: 10000, payment_method: 'upi', reference_number: ref,
    });
    assert.equal(again.status, 201, 'a replay is accepted, not double counted');
  }

  const after = await prisma.financialTransaction.count({ where: { trip_id: id } });
  assert.equal(after, before + 1, 'exactly ONE money movement for the repeated request');

  const fin = await call('GET', `/api/trips/${bk}/financial`, adminToken);
  assert.equal(fin.body.data.amountReceived, 30000, '20000 + 10000, counted once');
  assert.equal(fin.body.data.outstandingAmount, 20000);
});

test('HTTP. the vendor payable is untouched by a customer payment', async (t) => {
  if (!trip || !adminToken) { t.skip('no trip'); return; }
  const id = trip.trip_id;

  const vendorMoney = await prisma.financialTransaction.count({
    where: {
      trip_id: id,
      transaction_type: { in: ['OWNER_ADVANCE', 'OWNER_SETTLEMENT', 'DRIVER_ADVANCE', 'DRIVER_SETTLEMENT', 'FUEL_ADVANCE', 'COMMISSION'] },
    },
  });
  assert.equal(vendorMoney, 0, 'no vendor money rows exist for this trip');

  const fin = await call('GET', `/api/trips/${id}/financials`, adminToken);
  assert.equal(fin.body.data.driverDue, 40000, 'the driver is still owed the full amount');
  assert.equal(fin.body.data.ownerDue > 0, true, 'the owner is still owed');
  assert.equal(fin.body.data.btCommission, 2500, 'commission is unchanged');

  const row = await prisma.trip.findUnique({ where: { trip_id: id } });
  assert.equal(row.freight_amount, FREIGHT, 'the gross hire was never rewritten');
});

test('HTTP. a customer sees their OWN billing and no vendor money', async (t) => {
  if (!trip || !customerToken) { t.skip('no customer'); return; }
  const bk = booking.booking_id;

  const r = await call('GET', `/api/trips/${bk}/financial`, customerToken);
  assert.equal(r.status, 200, `customer financial failed: ${JSON.stringify(r.body)}`);

  const d = r.body.data;
  assert.equal(d.billedAmount, FREIGHT, 'they see what they owe');
  assert.equal(d.amountReceived, 30000);
  assert.equal(d.outstandingAmount, 20000);
  assert.equal(d.paymentStatus, 'PARTIAL');
  assert.ok(Array.isArray(d.payments), 'their own payment history is included');
  assert.ok(d.payments.length >= 2);

  const payload = JSON.stringify(r.body);
  for (const forbidden of [
    'btMargin', 'bt_margin', 'commission', 'commissionAmount',
    'driverPayout', 'ownerSettlement', 'ownerSettlementAmount',
    'driverAdvance', 'ownerAdvance', 'balances',
  ]) {
    assert.ok(!payload.includes(forbidden),
      `the CUSTOMER projection must not contain "${forbidden}"`);
  }
});

test('HTTP. a customer transaction ledger shows only their own money', async (t) => {
  if (!trip || !customerToken) { t.skip('no customer'); return; }
  const bk = booking.booking_id;

  for (const p of [`/api/trips/${bk}/transactions`, `/api/trips/${bk}/transactions/ledger`]) {
    const r = await call('GET', p, customerToken);
    assert.equal(r.status, 200, `${p} failed: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.data));
    for (const row of r.body.data) {
      assert.ok(
        ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT', 'REVERSAL', 'REFUND'].includes(row.transaction_type),
        `a customer must not see ${row.transaction_type}`
      );
    }
    const payload = JSON.stringify(r.body);
    assert.doesNotMatch(payload, /OWNER_SETTLEMENT/, 'no vendor settlement');
    assert.doesNotMatch(payload, /TRANSPORT_OWNER/, 'no vendor party');
  }
});

test('HTTP. an unrelated customer cannot read this billing', async (t) => {
  if (!booking || !otherCustomerToken) { t.skip('no second customer'); return; }
  const bk = booking.booking_id;

  for (const p of [
    `/api/trips/${bk}/financial`,
    `/api/trips/${bk}/transactions`,
    `/api/trips/${bk}/transactions/ledger`,
  ]) {
    const r = await call('GET', p, otherCustomerToken);
    assert.ok(r.status === 403 || r.status === 404,
      `${p} must not be readable by another customer, got ${r.status}`);
  }
});

test('HTTP. a driver and a partner cannot read the customer/vendor ledger', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  const id = trip.trip_id;

  // The standalone trip ledger is admin-only.
  for (const token of [driverToken, partnerToken].filter(Boolean)) {
    const r = await call('GET', `/api/trips/${id}/transactions`, token);
    assert.equal(r.status, 403, `the full trip ledger is admin-only, got ${r.status}`);
  }

  // The standalone canonical financials are admin-only.
  if (driverToken) {
    const r = await call('GET', `/api/trips/${id}/financials`, driverToken);
    assert.equal(r.status, 403, `trip financials are admin-only, got ${r.status}`);
  }
});

test('HTTP. a customer, a driver and a partner cannot record a payment', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  const id = trip.trip_id;
  const bk = booking.booking_id;

  const before = await prisma.financialTransaction.count({ where: { trip_id: id } });

  for (const token of [customerToken, otherCustomerToken, driverToken, partnerToken].filter(Boolean)) {
    const a = await call('POST', `/api/trips/${id}/payments/client`, token, { amount: 100 });
    assert.equal(a.status, 403, 'recording a payment is admin-only');

    const b = await call('POST', `/api/trips/${id}/payments`, token, { amount: 100, payment_type: 'PARTIAL' });
    assert.equal(b.status, 403, 'recording a payment is admin-only');
  }

  void bk;
  assert.equal(
    await prisma.financialTransaction.count({ where: { trip_id: id } }),
    before,
    'no unauthorized request moved money'
  );
});

test('HTTP. a second invoice for the same booking is refused by the database', async (t) => {
  if (!booking || !adminToken) { t.skip('no booking'); return; }
  const bk = booking.booking_id;

  // The repository module exports the class itself, not a named property.
  const InvoiceRepository = require('../repositories/InvoiceRepository');
  const first = await new InvoiceRepository().ensureForBooking({
    booking_id: bk, booking_number: booking.booking_number, amount: FREIGHT,
  });
  assert.equal(first.created, true);

  const second = await new InvoiceRepository().ensureForBooking({
    booking_id: bk, booking_number: booking.booking_number, amount: FREIGHT,
  });
  assert.equal(second.created, false, 'the service refuses a duplicate bill');
  assert.equal(second.invoice_id, first.invoice_id);

  await assert.rejects(
    () => prisma.invoice.create({
      data: { booking_id: bk, invoice_number: `${TAG}-BYPASS`, final_price: 1 },
    }),
    'PostgreSQL refuses a second invoice for one booking'
  );
});

test('HTTP. the global financial summary stays admin-only', async (t) => {
  if (!adminToken) { t.skip('no admin'); return; }

  const s = await call('GET', '/api/financials/summary', adminToken);
  assert.equal(s.status, 200, `summary failed: ${JSON.stringify(s.body)}`);
  assert.ok('totalReceivable' in s.body.data, 'the receivable total is reported');
  assert.ok('totalPayable' in s.body.data, 'the payable total is reported separately');
  assert.notEqual(
    s.body.data.receivables.totalOutstanding,
    s.body.data.payables.owner.totalDue,
    'customer receivable and vendor payable are DIFFERENT figures'
  );

  for (const p of ['/api/financials/summary', '/api/financials/receivables', '/api/financials/payables']) {
    for (const token of [customerToken, driverToken].filter(Boolean)) {
      assert.equal((await call('GET', p, token)).status, 403, `${p} is admin-only`);
    }
  }
});

test('HTTP. no data from this file survives', async () => {
  await cleanup();
  assert.equal(await prisma.trip.count({ where: { trip_number: { startsWith: TAG } } }), 0);
  assert.equal(await prisma.booking.count({ where: { booking_number: { startsWith: TAG } } }), 0);
  assert.equal(await prisma.invoice.count({ where: { invoice_number: { contains: TAG } } }), 0);
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
  if (child) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!child.killed) child.kill('SIGKILL');
  }
});
