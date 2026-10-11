/**
 * scripts/verify-phase3-http.js
 * ---------------------------------------------------------------------------
 * PHASE 3 end-to-end proof over REAL HTTP:
 *
 *     Express  →  Service  →  Prisma  →  PostgreSQL
 *
 * It boots the actual server on a free port, mints a real admin JWT, creates a
 * disposable trip, and drives the exact URLs the existing UI calls:
 *
 *   GET  /api/trips/:tripId/advances
 *   POST /api/trips/:tripId/advances
 *   POST /api/trips/:tripId/settlements/owner
 *   GET  /api/trips/:tripId/settlements
 *   GET  /api/trips/:tripId/vendor-position
 *   GET  /api/admin/vehicle-owners/:ownerId/ledger
 *
 * Then it checks the security rules with real tokens: no token, a customer
 * token and a driver token must all be refused.
 *
 * Everything it creates is deleted again before it exits.
 *
 * Usage:  node scripts/verify-phase3-http.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('dotenv').config();

const http = require('http');
const jwt = require('jsonwebtoken');

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;

let prisma;
let token;
let customerToken;
let driverToken;

const created = { users: [], drivers: [], vehicleOwners: [], transportVehicles: [], trips: [] };

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function call(method, path, body, bearer) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      http.get(`${BASE}/api/health`, () => resolve()).on('error', () => {
        tries += 1;
        if (tries > 60) reject(new Error('server did not start'));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function cleanup() {
  if (!prisma) return;
  await prisma.financialTransaction.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.tripSettlement.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.tripAdvance.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.tripFinancial.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
}

(async () => {
  // server.js starts listening as a side effect of being required, and it does
  // not export the http server handle. Pin PORT first, then boot it for real —
  // this is the actual application, not a test harness.
  process.env.PORT = String(PORT);
  require('../server');
  prisma = require('../config/prisma').prisma;

  await waitForServer();

  // ── real tokens for the real roles ────────────────────────────────────────
  const admin = await prisma.admin.findFirst({
    where: { role: { in: ['admin', 'super_admin'] } },
    select: { admin_id: true, role: true },
  });
  if (!admin) throw new Error('no admin row to authenticate as');
  token = jwt.sign({ id: admin.admin_id, type: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // ── disposable fixture: vendor → vehicle → driver → trip ─────────────────
  const suffix = `H${process.pid}`;
  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `HTTP ${suffix}`, mobile: `98${process.pid}0000`.slice(0, 10), owner_type: 'TRANSPORT_COMPANY' },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: { vehicle_number: `HTTPP${process.pid}`.padEnd(14, 'X'), vehicle_type: 'TRUCK', owner_id: owner.owner_id },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const driverUser = await prisma.user.create({
    data: {
      first_name: 'HTTP', last_name: 'Driver',
      email: `http.driver.${suffix}@example.test`,
      phone: `86${process.pid}0000`.slice(0, 10),
      password_hash: 'not-used', role: 'driver',
    },
  });
  created.users.push(driverUser.user_id);
  driverToken = jwt.sign({ id: driverUser.user_id, type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const driver = await prisma.driver.create({
    data: { user_id: driverUser.user_id, driver_name: `HTTP Driver ${suffix}`, mobile: `85${process.pid}0000`.slice(0, 10), transport_owner_id: owner.owner_id },
  });
  created.drivers.push(driver.driver_id);

  const customerUser = await prisma.user.create({
    data: {
      first_name: 'HTTP', last_name: 'Customer',
      email: `http.customer.${suffix}@example.test`,
      phone: `84${process.pid}0000`.slice(0, 10),
      password_hash: 'not-used', role: 'customer',
    },
  });
  created.users.push(customerUser.user_id);
  customerToken = jwt.sign({ id: customerUser.user_id, type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // 42,000 gross with a FIXED 2,000 commission ⇒ 40,000 net vendor payable.
  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-HTTP-${suffix}`,
      source_type: 'DIRECT',
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      user_id: customerUser.user_id,
      pickup_location: 'Begusarai', pickup_city: 'Begusarai',
      drop_location: 'Patna', drop_city: 'Patna',
      freight_amount: 42000,
      driver_payment: 0,
      commission_type: 'fixed', commission_percentage: 2000,
      trip_date: new Date('2026-09-01T00:00:00.000Z'),
      status: 'IN_TRANSIT',
    },
  });
  created.trips.push(trip.trip_id);

  const T = `/api/trips/${trip.trip_id}`;

  // ── 1. the server-side payable ────────────────────────────────────────────
  let r = await call('GET', `${T}/vendor-position`, null, token);
  check('GET vendor-position returns 200', r.status === 200, `status=${r.status}`);
  check('gross hire is 42,000', r.body?.data?.grossHire === 42000, String(r.body?.data?.grossHire));
  check('commission is 2,000', r.body?.data?.commissionAmount === 2000, String(r.body?.data?.commissionAmount));
  check('net vendor payable is 40,000', r.body?.data?.netVendorPayable === 40000, String(r.body?.data?.netVendorPayable));
  check('outstanding starts at 40,000', r.body?.data?.outstanding === 40000, String(r.body?.data?.outstanding));

  // ── 2. the advance URL the existing UI actually calls ─────────────────────
  r = await call('GET', `${T}/advances`, null, token);
  check('GET advances returns 200 (trip-scoped, not 500)', r.status === 200, `status=${r.status} scope=${r.body?.scope}`);
  check('GET advances reports trip scope', r.body?.scope === 'trip', String(r.body?.scope));

  r = await call('POST', `${T}/advances`, {
    amount: 10000, advance_type: 'OWNER_ADVANCE', payment_method: 'cash',
    reference_number: `HTTP-ADV-${suffix}`, advance_date: '2026-09-05',
  }, token);
  check('POST advance returns 201', r.status === 201, `status=${r.status} msg=${r.body?.message}`);

  r = await call('GET', `${T}/advances`, null, token);
  check('advance is visible on the trip', Array.isArray(r.body?.data) && r.body.data.length === 1, `count=${r.body?.data?.length}`);

  r = await call('GET', `${T}/vendor-position`, null, token);
  check('outstanding fell to 30,000 after the advance', r.body?.data?.outstanding === 30000, String(r.body?.data?.outstanding));
  check('net vendor payable is still 40,000', r.body?.data?.netVendorPayable === 40000, String(r.body?.data?.netVendorPayable));

  // ── 3. idempotency over real HTTP (double click) ──────────────────────────
  const dup = { amount: 10000, advance_type: 'OWNER_ADVANCE', payment_method: 'cash', reference_number: `HTTP-ADV-${suffix}` };
  await call('POST', `${T}/advances`, dup, token);
  r = await call('POST', `${T}/advances`, dup, token);
  check('a repeated advance is reported as already recorded', r.body?.data?.already_recorded === true, JSON.stringify(r.body?.data?.already_recorded));
  const advCount = await prisma.tripAdvance.count({ where: { trip_id: trip.trip_id } });
  check('only ONE advance row exists after the double click', advCount === 1, `count=${advCount}`);

  // ── 4. the settlement URL the existing UI actually calls ───────────────────
  r = await call('POST', `${T}/settlements/owner`, {
    amount: 10000, payment_method: 'bank_transfer', reference_number: `HTTP-P1-${suffix}`, settlement_date: '2026-09-10',
  }, token);
  check('POST owner settlement returns 201', r.status === 201, `status=${r.status} msg=${r.body?.message}`);

  r = await call('POST', `${T}/settlements/owner`, {
    amount: 15000, payment_method: 'bank_transfer', reference_number: `HTTP-P2-${suffix}`, settlement_date: '2026-09-12',
  }, token);
  check('second partial settlement returns 201', r.status === 201, `status=${r.status}`);

  r = await call('GET', `${T}/settlements`, null, token);
  check('GET settlements returns trip scope', r.body?.scope === 'trip', String(r.body?.scope));
  check('settlement amount is cumulative (25,000)', r.body?.data?.[0]?.owner_settlement_amount === 25000, String(r.body?.data?.[0]?.owner_settlement_amount));
  check('settlement is still PARTIAL', r.body?.data?.[0]?.owner_settlement_status === 'PARTIAL', String(r.body?.data?.[0]?.owner_settlement_status));

  r = await call('GET', `${T}/vendor-position`, null, token);
  check('outstanding fell to 5,000', r.body?.data?.outstanding === 5000, String(r.body?.data?.outstanding));

  r = await call('POST', `${T}/settlements/owner`, {
    amount: 5000, payment_method: 'bank_transfer', reference_number: `HTTP-P3-${suffix}`, settlement_date: '2026-09-15',
  }, token);
  r = await call('GET', `${T}/vendor-position`, null, token);
  check('final payment settles the vendor', r.body?.data?.outstanding === 0 && r.body?.data?.settled === true, JSON.stringify({ o: r.body?.data?.outstanding, s: r.body?.data?.settled }));

  // ── 5. over-payment is refused with 400 ───────────────────────────────────
  r = await call('POST', `${T}/settlements/owner`, { amount: 5000, payment_method: 'cash' }, token);
  check('over-payment is refused with 400', r.status === 400, `status=${r.status} msg=${r.body?.message}`);

  // ── 6. the vendor ledger ──────────────────────────────────────────────────
  r = await call('GET', `/api/admin/vehicle-owners/${owner.owner_id}/ledger`, null, token);
  check('GET vendor ledger returns 200', r.status === 200, `status=${r.status}`);
  check('ledger obligations total 40,000', r.body?.data?.totalObligations === 40000, String(r.body?.data?.totalObligations));
  check('ledger advances total 10,000', r.body?.data?.totalAdvances === 10000, String(r.body?.data?.totalAdvances));
  check('ledger payments total 30,000', r.body?.data?.totalPayments === 30000, String(r.body?.data?.totalPayments));
  check('ledger closing balance is 0', r.body?.data?.closingBalance === 0, String(r.body?.data?.closingBalance));
  check('ledger is chronological', (() => {
    const e = r.body?.data?.entries || [];
    const d = e.map((x) => new Date(x.date).getTime());
    return d.every((v, i) => i === 0 || v >= d[i - 1]);
  })(), `${r.body?.data?.entries?.length} entries`);

  // ── 7. security, over real HTTP ───────────────────────────────────────────
  r = await call('GET', `${T}/advances`, null, undefined);
  check('unauthenticated GET advances is 401', r.status === 401, `status=${r.status}`);

  r = await call('POST', `${T}/advances`, { amount: 1, advance_type: 'OWNER_ADVANCE', payment_method: 'cash' }, undefined);
  check('unauthenticated POST advance is 401', r.status === 401, `status=${r.status}`);

  r = await call('POST', `${T}/settlements/owner`, { amount: 1, payment_method: 'cash' }, customerToken);
  check('customer cannot record a vendor payment (403)', r.status === 403, `status=${r.status}`);

  r = await call('POST', `${T}/settlements/owner`, { amount: 1, payment_method: 'cash' }, driverToken);
  check('driver cannot record a vendor payment (403)', r.status === 403, `status=${r.status}`);

  r = await call('POST', `${T}/advances`, { amount: 1, advance_type: 'OWNER_ADVANCE', payment_method: 'cash' }, customerToken);
  check('customer cannot record a vendor advance (403)', r.status === 403, `status=${r.status}`);

  r = await call('GET', `/api/admin/vehicle-owners/${owner.owner_id}/ledger`, null, customerToken);
  check('customer cannot read the vendor ledger (403)', r.status === 403, `status=${r.status}`);

  r = await call('GET', `/api/admin/vehicle-owners/${owner.owner_id}/ledger`, null, undefined);
  check('unauthenticated cannot read the vendor ledger (401)', r.status === 401, `status=${r.status}`);

  // ── 8. the hire itself changed nothing ────────────────────────────────────
  const tripRow = await prisma.trip.findUnique({ where: { trip_id: trip.trip_id } });
  check('Trip.freight_amount is still 42,000', tripRow.freight_amount === 42000, String(tripRow.freight_amount));

  // ── report ────────────────────────────────────────────────────────────────
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(`  - ${f.label} ${f.detail}`));
  }

  await cleanup();
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('verify-phase3-http FAILED:', err);
  try { await cleanup(); } catch { /* ignore */ }
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
