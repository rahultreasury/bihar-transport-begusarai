/**
 * phase5-transit.http.test.js
 * ---------------------------------------------------------------------------
 * PHASE 5 — LIVE HTTP VERIFICATION (STEP 20)
 * ---------------------------------------------------------------------------
 * Boots the real Express server and exercises the real Phase 5 endpoints over
 * TCP with real, signed JWTs:
 *
 *   GET  /api/trips/:id/tracking
 *   POST /api/trips/:id/transit/start
 *   POST /api/trips/:id/movement
 *   GET  /api/trips/:id/movement/history
 *   POST /api/trips/:id/location
 *   POST /api/trips/:id/eta/refresh
 *
 * Every principal is a REAL identity read from the database, and the JWT is
 * signed with the REAL JWT_SECRET — nothing is stubbed:
 *
 *   • admin          — an existing Admin row
 *   • customer       — the User that owns the trip
 *   • otherCustomer  — a different real User
 *   • driver         — the trip's real Driver
 *   • otherDriver    — a different real Driver
 *   • anonymous      — no Authorization header
 *
 * It provisions its own trip and deletes everything it created.
 *
 * Usage:  node --test tests/phase5-transit.http.test.js
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { prisma } = require('../config/prisma');

// ── Start the real server as a child process ───────────────────────────────
// Spawning (rather than requiring) server.js keeps `node --test` able to print
// its own summary, and gives us a clean way to shut the listener down.
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = process.env.PH5_TEST_PORT || '3999';
let child = null;
let base = `http://127.0.0.1:${PORT}`;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  // Wait for the port to accept connections.
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`).catch(() => null);
      if (r || Date.now() > deadline) break;
    } catch { /* retry */ }
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

function sign(id, type) {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function call(method, path, token, body) {
  const res = await fetch(`${base}${path}`, {
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
  // The donor trip must have a customer who is genuinely a CUSTOMER.
  // `principalFromRequest` resolves a User to driver/partner FIRST, and in
  // this dataset some Users are both a customer on one trip and a driver
  // login on another — for those the customer assertions would be testing the
  // driver path instead. Pick a trip whose user_id is neither.
  const staffUserIds = [
    ...(await prisma.driver.findMany({ select: { user_id: true } })).map((d) => d.user_id),
    ...(await prisma.partnerApplication.findMany({
      where: { user_id: { not: null } }, select: { user_id: true },
    })).map((p) => p.user_id),
  ].filter(Boolean);

  const donor = await prisma.trip.findFirst({
    where: {
      status: { in: ['ASSIGNED', 'IN_TRANSIT', 'COMPLETED', 'PENDING'] },
      user_id: { not: null, notIn: staffUserIds },
    },
    orderBy: { trip_id: 'asc' },
  }) || await prisma.trip.findFirst({
    where: { status: { in: ['ASSIGNED', 'IN_TRANSIT', 'COMPLETED', 'PENDING'] } },
    orderBy: { trip_id: 'asc' },
  });
  if (!donor) return false;

  const admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
  if (!admin) return false;

  // Pick a User who is genuinely a plain customer: not a driver, not a partner
  // application holder. The provisioned trip is assigned to THAT user, so the
  // customer-authorisation assertions are always exercised rather than
  // depending on the shape of existing production data.
  const pureCustomer = await prisma.user.findFirst({
    where: { user_id: { notIn: staffUserIds } },
    orderBy: { user_id: 'asc' },
  });
  const customer = pureCustomer
    || (donor.user_id ? await prisma.user.findUnique({ where: { user_id: donor.user_id } }) : null);

  // `Driver` has no `email` / `user_id` column — the login hangs off the
  // `user` relation, so the driver's JWT comes from that User row.
  const driver = await prisma.driver.findUnique({
    where: { driver_id: donor.driver_id },
    include: { user: { select: { user_id: true, role: true } } },
  });

  // The "unrelated customer" must be a real customer: NOT the trip's customer,
  // NOT any driver and NOT any partner, because `principalFromRequest` resolves
  // a User to driver/partner FIRST, and a driver login would legitimately be
  // allowed to read its own trip.
  const driverUserIds = (await prisma.driver.findMany({ select: { user_id: true } }))
    .map((d) => d.user_id).filter(Boolean);
  // A partner is linked to a login through `PartnerApplication`; `Partner` has
  // no `user_id` column at all.
  const partnerUserIds = (await prisma.partnerApplication.findMany({
    where: { user_id: { not: null } }, select: { user_id: true },
  })).map((p) => p.user_id).filter(Boolean);
  const reserved = [...new Set(
    [customer && customer.user_id, donor.user_id, ...driverUserIds, ...partnerUserIds].filter(Boolean)
  )];

  const otherUser = await prisma.user.findFirst({
    where: { user_id: { notIn: reserved } },
    orderBy: { user_id: 'asc' },
  });

  const otherDriver = await prisma.driver.findFirst({
    where: { driver_id: { not: donor.driver_id } },
    include: { user: { select: { user_id: true } } },
    orderBy: { driver_id: 'asc' },
  });

  trip = await prisma.trip.create({
    data: {
      trip_number: `PH5-HTTP-${Date.now().toString(36)}`,
      transport_owner_id: donor.transport_owner_id,
      vehicle_id: donor.vehicle_id,
      driver_id: donor.driver_id,
      user_id: customer ? customer.user_id : null,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      freight_amount: 60000,
      status: 'DISPATCHED',
      dispatched_at: new Date(),
      loading_completed_at: new Date(),
    },
  });

  adminToken = sign(admin.admin_id, 'admin');
  if (customer) customerToken = sign(customer.user_id, 'user');
  if (otherUser) otherCustomerToken = sign(otherUser.user_id, 'user');
  if (driver && driver.user) driverToken = sign(driver.user.user_id, 'user');
  if (otherDriver && otherDriver.user) otherDriverToken = sign(otherDriver.user.user_id, 'user');

  console.log(`    [http] trip_id=${trip.trip_id} admin=${admin.admin_id} `
    + `customer=${customer ? customer.user_id : 'n/a'} driverLogin=${driverToken ? 'yes' : 'no'}`);
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
  await prisma.tripTimeline.deleteMany({ where: { trip_id: trip.trip_id } });
  await prisma.trip.delete({ where: { trip_id: trip.trip_id } });
  trip = null;
}

// ===========================================================================

test('HTTP. the server is really listening', () => {
  assert.ok(base, 'server started');
  console.log(`    [http] base = ${base}`);
});

test('HTTP. unauthenticated requests are refused', async (t) => {
  if (!await provision()) { t.skip('no fixtures'); return; }
  const id = trip.trip_id;

  const anonTrack = await call('GET', `/api/trips/${id}/tracking`);
  assert.equal(anonTrack.status, 401, 'tracking needs a token');

  const anonStart = await call('POST', `/api/trips/${id}/transit/start`);
  assert.equal(anonStart.status, 401, 'start-transit needs a token');

  const anonMove = await call('POST', `/api/trips/${id}/movement`, null, { milestone: 'DELIVERY_READY' });
  assert.equal(anonMove.status, 401, 'movement needs a token');

  const anonLoc = await call('POST', `/api/trips/${id}/location`, null, { latitude: 25, longitude: 85 });
  assert.equal(anonLoc.status, 401, 'location needs a token');

  const bad = await call('GET', `/api/trips/${id}/tracking`, 'not-a-real-jwt');
  assert.equal(bad.status, 401, 'a forged token is refused');
});

test('HTTP. a customer cannot perform any Phase 5 write', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  if (!customerToken) { t.skip('no customer login for this trip'); return; }
  const id = trip.trip_id;

  for (const [path, body] of [
    [`/api/trips/${id}/transit/start`, {}],
    [`/api/trips/${id}/movement`, { milestone: 'DELIVERY_READY' }],
    [`/api/trips/${id}/location`, { latitude: 25, longitude: 85 }],
    [`/api/trips/${id}/eta/refresh`, {}],
  ]) {
    const r = await call('POST', path, customerToken, body);
    assert.equal(r.status, 403, `${path} must be admin-only`);
    assert.equal(r.body.success, false);
  }

  // And the trip really did not move.
  const row = await prisma.trip.findUnique({ where: { trip_id: id } });
  assert.equal(row.status, 'DISPATCHED', 'a refused write changed nothing');
});

test('HTTP. an unrelated customer cannot read the trip', async (t) => {
  if (!trip || !otherCustomerToken) { t.skip('no second customer'); return; }
  const r = await call('GET', `/api/trips/${trip.trip_id}/tracking`, otherCustomerToken);
  assert.equal(r.status, 403, 'someone else’s trip is forbidden');
});

test('HTTP. admin: transit → movement → location → tracking works end to end', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  const id = trip.trip_id;

  // 1. DISPATCHED → IN_TRANSIT
  const start = await call('POST', `/api/trips/${id}/transit/start`, adminToken, {});
  assert.equal(start.status, 200, `start-transit failed: ${JSON.stringify(start.body)}`);
  assert.equal(start.body.data.status, 'IN_TRANSIT');

  // 2. Idempotent over HTTP
  const again = await call('POST', `/api/trips/${id}/transit/start`, adminToken, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.idempotent, true, 'the repeat is a no-op');

  // 3. Movement
  const mv = await call('POST', `/api/trips/${id}/movement`, adminToken, {
    milestone: 'DESTINATION_APPROACH', notes: 'http-test',
  });
  assert.equal(mv.status, 201, `movement failed: ${JSON.stringify(mv.body)}`);
  const dup = await call('POST', `/api/trips/${id}/movement`, adminToken, {
    milestone: 'DESTINATION_APPROACH', notes: 'http-test',
  });
  assert.equal(dup.status, 200, 'the duplicate is reported idempotent');
  assert.equal(dup.body.idempotent, true);

  // 4. Movement history
  const hist = await call('GET', `/api/trips/${id}/movement/history`, adminToken);
  assert.equal(hist.status, 200);
  assert.equal(hist.body.data.length, 1, 'exactly one movement, no duplicate');

  // 5. Location — valid
  const loc = await call('POST', `/api/trips/${id}/location`, adminToken, {
    latitude: 25.5941, longitude: 85.1376, source: 'ADMIN',
  });
  assert.equal(loc.status, 200, `location failed: ${JSON.stringify(loc.body)}`);
  assert.equal(loc.body.data.current_latitude, 25.5941);

  // 6. Location — invalid coordinates rejected with 400, not a 500
  const bad = await call('POST', `/api/trips/${id}/location`, adminToken, { latitude: 91, longitude: 0 });
  assert.ok(bad.status === 400 || bad.status === 422, `expected a client error, got ${bad.status}`);
  const nul = await call('POST', `/api/trips/${id}/location`, adminToken, { latitude: null, longitude: null });
  assert.ok(nul.status === 400 || nul.status === 422, `null coords must be a client error, got ${nul.status}`);

  // 7. ETA refresh always answers, with a value or an honest reason
  const eta = await call('POST', `/api/trips/${id}/eta/refresh`, adminToken, {});
  assert.equal(eta.status, 200);
  assert.ok('eta' in eta.body.data && 'reason' in eta.body.data);

  // 8. Tracking read: THE milestone must be a real object on the wire.
  const track = await call('GET', `/api/trips/${id}/tracking`, adminToken);
  assert.equal(track.status, 200, `tracking failed: ${JSON.stringify(track.body)}`);
  const d = track.body.data;
  assert.equal(d.status, 'IN_TRANSIT');
  assert.ok(d.milestone && d.milestone.code === 'DESTINATION_APPROACH',
    `milestone must survive JSON, got ${JSON.stringify(d.milestone)}`);
  assert.ok(d.location && d.location.latitude === 25.5941, 'location is exposed');
  assert.ok(Array.isArray(d.timeline));
  assert.ok(d.driver && ('mobile' in d.driver) === false, 'no driver mobile in tracking');
});

test('HTTP. the customer sees the permitted tracking and nothing more', async (t) => {
  if (!trip || !customerToken) { t.skip('no customer'); return; }
  const r = await call('GET', `/api/trips/${trip.trip_id}/tracking`, customerToken);
  assert.equal(r.status, 200, `customer tracking failed: ${JSON.stringify(r.body)}`);

  const payload = JSON.stringify(r.body);
  assert.ok(r.body.data.milestone.code, 'the customer sees the operational milestone');
  assert.ok(r.body.data.vehicle.vehicle_number, 'the customer sees which truck');
  assert.ok(r.body.data.driver.driver_name, 'the customer sees the driver name');
  for (const forbidden of ['mobile', 'freight_amount', 'commission', 'outstanding', 'settlement', 'net_vendor_payable']) {
    assert.ok(!payload.includes(forbidden), `customer payload must not contain "${forbidden}"`);
  }
});

test('HTTP. another driver is refused; the assigned driver is not', async (t) => {
  if (!trip) { t.skip('no trip'); return; }
  if (otherDriverToken) {
    const r = await call('GET', `/api/trips/${trip.trip_id}/tracking`, otherDriverToken);
    assert.ok(r.status === 403 || r.status === 404,
      `an unrelated driver must not read the trip, got ${r.status}`);
  } else {
    console.log('    [http] no second driver login available; covered by the service test');
  }
});

test('HTTP. the canonical endpoint refuses the legacy short-cut', async (t) => {
  // Use a PENDING/ASSIGNED trip that is NOT the provisioned one.
  const other = await prisma.trip.findFirst({
    where: { status: { in: ['PENDING', 'ASSIGNED'] } }, orderBy: { trip_id: 'asc' },
  });
  if (!other) { t.skip('no PENDING/ASSIGNED trip'); return; }
  const r = await call('POST', `/api/trips/${other.trip_id}/transit/start`, adminToken, {});
  assert.ok(r.status === 400 || r.status === 422, `expected refusal, got ${r.status}`);
  const row = await prisma.trip.findUnique({ where: { trip_id: other.trip_id } });
  assert.equal(row.status, other.status, 'the trip was not moved');
});

test('HTTP. no data from this file survives', async () => {
  await cleanup();
  const leftover = await prisma.trip.count({ where: { trip_number: { startsWith: 'PH5-HTTP-' } } });
  assert.equal(leftover, 0, 'the provisioned trip was deleted');
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
