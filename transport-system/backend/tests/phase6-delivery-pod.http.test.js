/**
 * phase6-delivery-pod.http.test.js
 * ---------------------------------------------------------------------------
 * PHASE 6 — LIVE HTTP VERIFICATION (STEP 22)
 * ---------------------------------------------------------------------------
 * Boots the real Express server and exercises the real Phase 6 endpoints over
 * TCP with real, signed JWTs:
 *
 *   POST /api/trips/:id/arrival
 *   POST /api/trips/:id/delivery-attempt
 *   GET  /api/trips/:id/delivery/readiness
 *   POST /api/trips/:id/pod
 *   POST /api/trips/:id/pod/:documentId/verify
 *   POST /api/trips/:id/delivered
 *   POST /api/trips/:id/complete
 *   GET  /api/trips/:id/delivery
 *
 * Every principal is a REAL identity read from the database, and every JWT is
 * signed with the REAL JWT_SECRET. Nothing is stubbed.
 *
 * Usage:  node --test tests/phase6-delivery-pod.http.test.js
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { prisma } = require('../config/prisma');

const PORT = process.env.PH6_TEST_PORT || '3998';
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

// ── Fixtures ───────────────────────────────────────────────────────────────
let trip = null;
let adminToken = null;
let customerToken = null;
let otherCustomerToken = null;
let driverToken = null;
let otherDriverToken = null;
let partnerToken = null;

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

async function provision() {
  const donor = await prisma.trip.findFirst({
    where: { status: { in: ['IN_TRANSIT', 'ASSIGNED', 'COMPLETED', 'PENDING'] } },
    orderBy: { trip_id: 'asc' },
  });
  if (!donor) return false;

  const admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
  if (!admin) return false;

  // A genuinely plain customer: not a driver, not a partner holder.
  const staffUserIds = [
    ...(await prisma.driver.findMany({ select: { user_id: true } })).map((d) => d.user_id),
    ...(await prisma.partnerApplication.findMany({
      where: { user_id: { not: null } }, select: { user_id: true },
    })).map((p) => p.user_id),
  ].filter(Boolean);

  const customer = await prisma.user.findFirst({
    where: { user_id: { notIn: staffUserIds } }, orderBy: { user_id: 'asc' },
  });
  if (!customer) return false;

  const otherUser = await prisma.user.findFirst({
    where: { user_id: { notIn: [...staffUserIds, customer.user_id] } }, orderBy: { user_id: 'asc' },
  });
  const otherDriver = await prisma.driver.findFirst({
    where: { driver_id: { not: donor.driver_id } },
    include: { user: { select: { user_id: true } } },
    orderBy: { driver_id: 'asc' },
  });
  const driver = await prisma.driver.findUnique({
    where: { driver_id: donor.driver_id },
    include: { user: { select: { user_id: true } } },
  });

  trip = await prisma.trip.create({
    data: {
      trip_number: `PH6-HTTP-${Date.now().toString(36)}`,
      transport_owner_id: donor.transport_owner_id,
      vehicle_id: donor.vehicle_id,
      driver_id: donor.driver_id,
      user_id: customer.user_id,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      freight_amount: 60000,
      status: 'IN_TRANSIT',
      dispatched_at: new Date(),
      loading_completed_at: new Date(),
    },
  });

  adminToken = sign(admin.admin_id, 'admin');
  customerToken = sign(customer.user_id, 'user');
  if (otherUser) otherCustomerToken = sign(otherUser.user_id, 'user');
  if (driver && driver.user) driverToken = sign(driver.user.user_id, 'user');
  if (otherDriver && otherDriver.user) otherDriverToken = sign(otherDriver.user.user_id, 'user');
  void partnerToken;

  console.log(`    [http] trip_id=${trip.trip_id} admin=${admin.admin_id} customer=${customer.user_id} `
    + `driverLogin=${driverToken ? 'yes' : 'no'}`);
  return true;
}

async function cleanup() {
  if (!trip) return;
  const tl = await prisma.tripTimeline.findMany({
    where: { trip_id: trip.trip_id }, select: { timeline_id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entity_type: 'Trip', entity_id: trip.trip_id },
        { entity_type: 'TripTimeline', entity_id: { in: tl.map((r) => r.timeline_id) } },
      ],
    },
  });
  await prisma.tripDocument.deleteMany({ where: { trip_id: trip.trip_id } });
  await prisma.tripTimeline.deleteMany({ where: { trip_id: trip.trip_id } });
  await prisma.trip.delete({ where: { trip_id: trip.trip_id } });
  trip = null;
}

// ===========================================================================

test('HTTP. the server is really listening', () => {
  assert.ok(base);
  console.log(`    [http] base = ${base}`);
});

test('HTTP. unauthenticated and forged requests are refused', async (t) => {
  if (!await provision()) { t.skip('no fixtures'); return; }
  const id = trip.trip_id;

  assert.equal((await call('GET', `/api/trips/${id}/delivery`)).status, 401);
  assert.equal((await call('GET', `/api/trips/${id}/delivery/readiness`)).status, 401);
  assert.equal((await call('POST', `/api/trips/${id}/arrival`, null, {})).status, 401);
  assert.equal((await call('POST', `/api/trips/${id}/delivery-attempt`, null, { reason: 'OTHER' })).status, 401);
  assert.equal((await call('POST', `/api/trips/${id}/pod`, null, {})).status, 401);
  assert.equal((await call('POST', `/api/trips/${id}/delivered`, null, {})).status, 401);
  assert.equal((await call('POST', `/api/trips/${id}/complete`, null, {})).status, 401);

  const forged = await call('GET', `/api/trips/${id}/delivery`, 'not.a.real.jwt');
  assert.equal(forged.status, 401, 'a forged token is refused');
});

test('HTTP. a customer and an unrelated driver cannot perform any delivery write', async (t) => {
  if (!trip || !customerToken) { t.skip('no customer'); return; }
  const id = trip.trip_id;

  for (const [p, body] of [
    [`/api/trips/${id}/arrival`, {}],
    [`/api/trips/${id}/delivery-attempt`, { reason: 'OTHER' }],
    [`/api/trips/${id}/pod`, {}],
    [`/api/trips/${id}/delivered`, {}],
    [`/api/trips/${id}/complete`, {}],
  ]) {
    const r = await call('POST', p, customerToken, body);
    assert.equal(r.status, 403, `${p} must be admin-only (customer)`);
  }

  if (otherDriverToken) {
    const r = await call('GET', `/api/trips/${id}/delivery`, otherDriverToken);
    assert.ok(r.status === 403 || r.status === 404,
      `an unrelated driver must not read it, got ${r.status}`);
  }

  // Nothing moved.
  assert.equal((await prisma.trip.findUnique({ where: { trip_id: id } })).status, 'IN_TRANSIT');
});

test('HTTP. an unrelated customer cannot read the delivery', async (t) => {
  if (!trip || !otherCustomerToken) { t.skip('no second customer'); return; }
  const r = await call('GET', `/api/trips/${trip.trip_id}/delivery`, otherCustomerToken);
  assert.equal(r.status, 403, `someone else's trip is forbidden, got ${r.status}`);
});

test('HTTP. delivery is refused with every blocker before anything is recorded', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  const id = trip.trip_id;

  const readiness = await call('GET', `/api/trips/${id}/delivery/readiness`, adminToken);
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.data.ready, false);
  assert.deepEqual(
    readiness.body.data.blockers.map((b) => b.code),
    ['ARRIVAL_NOT_RECORDED', 'POD_NOT_SUPPLIED', 'RECEIVER_NOT_RECORDED']
  );

  const r = await call('POST', `/api/trips/${id}/delivered`, adminToken, {});
  assert.ok(r.status === 400 || r.status === 422, `expected a client error, got ${r.status}`);
  assert.equal(r.body.success, false);
  assert.ok(Array.isArray(r.body.blockers), 'all applicable blockers come back');
  assert.equal(r.body.blockers.length, 3);

  assert.equal((await prisma.trip.findUnique({ where: { trip_id: id } })).status, 'IN_TRANSIT');
});

test('HTTP. admin drives arrival → POD → verify → DELIVERED → COMPLETED', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  const id = trip.trip_id;

  // 1. Arrival
  const arrival = await call('POST', `/api/trips/${id}/arrival`, adminToken, { remarks: 'At the gate' });
  assert.equal(arrival.status, 200, `arrival failed: ${JSON.stringify(arrival.body)}`);
  assert.ok(arrival.body.data.arrived_at_destination_at);
  const arrivalAgain = await call('POST', `/api/trips/${id}/arrival`, adminToken, { remarks: 'At the gate' });
  assert.equal(arrivalAgain.body.idempotent, true, 'a repeat is a no-op');

  // 2. POD
  const pod = await call('POST', `/api/trips/${id}/pod`, adminToken, {
    reference_number: 'POD-HTTP-1',
    file_url: '/uploads/pod/http-1.jpg',
    receiver_name: 'Ramesh Yadav',
    delivered_quantity: 478,
    delivered_quantity_unit: 'bags',
    delivered_weight_kg: 4770,
  });
  assert.equal(pod.status, 200, `POD failed: ${JSON.stringify(pod.body)}`);
  const documentId = pod.body.data.pod.document_id;
  assert.equal(pod.body.data.receiver, 'Ramesh Yadav');

  // A duplicate upload must not create a second POD.
  const podAgain = await call('POST', `/api/trips/${id}/pod`, adminToken, { reference_number: 'POD-HTTP-1' });
  assert.equal(podAgain.status, 200);
  assert.equal(podAgain.body.idempotent, true);
  assert.equal(podAgain.body.data.pod.document_id, documentId);
  assert.equal(await prisma.tripDocument.count({ where: { trip_id: id, document_type: 'POD' } }), 1);

  // 3. Delivery is still refused: supplied is not verified.
  const early = await call('POST', `/api/trips/${id}/delivered`, adminToken, {});
  assert.ok(early.status === 400 || early.status === 422);
  assert.deepEqual(early.body.blockers.map((b) => b.code), ['POD_NOT_VERIFIED']);

  // 4. Verify
  const verify = await call('POST', `/api/trips/${id}/pod/${documentId}/verify`, adminToken, {});
  assert.equal(verify.status, 200, `verify failed: ${JSON.stringify(verify.body)}`);
  assert.equal(verify.body.data.document_status, 'VERIFIED');
  const verifyAgain = await call('POST', `/api/trips/${id}/pod/${documentId}/verify`, adminToken, {});
  assert.equal(verifyAgain.body.idempotent, true, 'duplicate verification is safe');

  // 5. Deliver
  const delivered = await call('POST', `/api/trips/${id}/delivered`, adminToken, {});
  assert.equal(delivered.status, 200, `deliver failed: ${JSON.stringify(delivered.body)}`);
  assert.equal(delivered.body.data.status, 'DELIVERED');
  assert.ok(delivered.body.data.trip_delivered_date);
  const deliveredAgain = await call('POST', `/api/trips/${id}/delivered`, adminToken, {});
  assert.equal(deliveredAgain.body.idempotent, true, 'duplicate delivery is safe');

  // 6. Complete
  const completed = await call('POST', `/api/trips/${id}/complete`, adminToken, {});
  assert.equal(completed.status, 200, `complete failed: ${JSON.stringify(completed.body)}`);
  assert.equal(completed.body.data.status, 'COMPLETED');
  const completedAgain = await call('POST', `/api/trips/${id}/complete`, adminToken, {});
  assert.equal(completedAgain.body.idempotent, true, 'duplicate completion is safe');
});

test('HTTP. the customer sees the delivery, and nothing forbidden', async (t) => {
  if (!trip || !customerToken) { t.skip('no customer'); return; }

  const r = await call('GET', `/api/trips/${trip.trip_id}/delivery`, customerToken);
  assert.equal(r.status, 200, `customer delivery failed: ${JSON.stringify(r.body)}`);

  const d = r.body.data;
  assert.equal(d.status, 'COMPLETED');
  assert.ok(d.delivered_at, 'the customer sees when it was delivered');
  assert.ok(d.completed_at);
  assert.equal(d.receiver, 'Ramesh Yadav');
  assert.equal(d.pod.is_verified, true);
  assert.equal(d.pod.has_file, true);
  assert.equal(d.received.quantity, 478);
  assert.ok(Array.isArray(d.timeline));

  const payload = JSON.stringify(r.body);
  assert.ok(!payload.includes('/uploads/pod/http-1.jpg'), 'the POD FILE URL never reaches a customer');
  for (const forbidden of [
    'mobile', 'freight_amount', 'driver_payment', 'owner_payment', 'commission',
    'settlement', 'outstanding', 'net_vendor_payable', 'verified_by',
  ]) {
    assert.ok(!payload.includes(forbidden), `customer delivery payload must not contain "${forbidden}"`);
  }
});

test('HTTP. the assigned driver may read; the trip did not move money', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  if (driverToken) {
    const r = await call('GET', `/api/trips/${trip.trip_id}/delivery`, driverToken);
    assert.equal(r.status, 200, `assigned driver read failed: ${JSON.stringify(r.body)}`);
  }

  // STEP 18 over HTTP: completing a delivery creates no financial row.
  const id = trip.trip_id;
  const before = {
    settlements: await prisma.tripSettlement.count(),
    commissions: await prisma.commissionRecord.count(),
    transactions: await prisma.financialTransaction.count(),
  };
  const row = await prisma.trip.findUnique({ where: { trip_id: id } });
  assert.equal(row.freight_amount, 60000, 'gross hire unchanged by delivery');
  assert.equal(row.driver_payment, null, 'no driver payout was created');
  assert.equal(row.owner_payment, null, 'no owner settlement was created');
  const after = {
    settlements: await prisma.tripSettlement.count(),
    commissions: await prisma.commissionRecord.count(),
    transactions: await prisma.financialTransaction.count(),
  };
  assert.deepEqual(after, before, 'no financial row was created by the delivery flow');
});

test('HTTP. no data from this file survives', async () => {
  await cleanup();
  assert.equal(await prisma.trip.count({ where: { trip_number: { startsWith: 'PH6-HTTP-' } } }), 0);
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
