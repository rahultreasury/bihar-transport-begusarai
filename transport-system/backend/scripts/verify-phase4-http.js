/**
 * scripts/verify-phase4-http.js
 * ---------------------------------------------------------------------------
 * PHASE 4 end-to-end proof over REAL HTTP:
 *
 *     Express  →  Service  →  Prisma  →  PostgreSQL
 *
 * It boots the actual server, mints real JWTs for an admin, a customer and a
 * driver, and drives the operational endpoints over the wire:
 *
 *   GET    /api/trips/:id/workflow
 *   POST   /api/trips/:id/loading/send
 *   POST   /api/trips/:id/loading/arrive
 *   POST   /api/trips/:id/loading/facts
 *   POST   /api/trips/:id/loading/complete
 *   GET    /api/trips/:id/dispatch/readiness
 *   POST   /api/trips/:id/dispatch
 *   GET/POST /api/trips/:id/documents
 *   PATCH-equivalent /api/trips/:id/status   (the pre-existing control)
 *
 * It also proves the Phase 4 endpoints IGNORE a posted status, and that a
 * customer, a driver and an unauthenticated caller are all refused.
 *
 * Everything it creates is deleted again before it exits.
 *
 * Usage:  node scripts/verify-phase4-http.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('dotenv').config();

const PORT = 4601;
const BASE = `http://127.0.0.1:${PORT}`;

const jwt = require('jsonwebtoken');

let prisma;
let adminToken;
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
      fetch(`${BASE}/api/health`)
        .then(() => resolve())
        .catch(() => {
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
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
}

(async () => {
  // server.js starts listening as a side effect of being required.
  process.env.PORT = String(PORT);
  require('../server');
  prisma = require('../config/prisma').prisma;
  await waitForServer();

  const admin = await prisma.admin.findFirst({
    where: { role: { in: ['admin', 'super_admin'] } },
    select: { admin_id: true, role: true },
  });
  if (!admin) throw new Error('no admin row to authenticate as');
  adminToken = jwt.sign({ id: admin.admin_id, type: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const pid = process.pid;
  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `HTTP4 ${pid}`, mobile: `96${pid}0000`.slice(0, 10) },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `HTTP4${pid}`.padEnd(14, 'X'), vehicle_type: 'TRUCK',
      owner_id: owner.owner_id, is_available: true, current_status: 'available',
    },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const driverUser = await prisma.user.create({
    data: {
      first_name: 'HTTP4', last_name: 'Driver',
      email: `http4.driver.${pid}@example.test`,
      phone: `86${pid}0000`.slice(0, 10),
      password_hash: 'not-used', role: 'driver',
    },
  });
  created.users.push(driverUser.user_id);
  driverToken = jwt.sign({ id: driverUser.user_id, type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id, driver_name: `HTTP4 Driver ${pid}`,
      mobile: `85${pid}0000`.slice(0, 10),
      transport_owner_id: owner.owner_id, is_available: true, status: 'available',
    },
  });
  created.drivers.push(driver.driver_id);

  const customerUser = await prisma.user.create({
    data: {
      first_name: 'HTTP4', last_name: 'Customer',
      email: `http4.customer.${pid}@example.test`,
      phone: `84${pid}0000`.slice(0, 10),
      password_hash: 'not-used', role: 'customer',
    },
  });
  created.users.push(customerUser.user_id);
  customerToken = jwt.sign({ id: customerUser.user_id, type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-HTTP4-${pid}`,
      source_type: 'DIRECT',
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      freight_amount: 60000,
      driver_payment: 0,
      status: 'ASSIGNED',
      trip_date: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
  created.trips.push(trip.trip_id);

  const T = `/api/trips/${trip.trip_id}`;

  // --- 1. workflow reads the operational state --------------------------------
  let r = await call('GET', `${T}/workflow`, null, adminToken);
  check('GET workflow returns 200', r.status === 200, `status=${r.status}`);
  check('workflow reports ASSIGNED', r.body?.data?.status === 'ASSIGNED', r.body?.data?.status);
  check('workflow lists the allowed next status', r.body?.data?.allowed_next?.includes('TO_LOADING_POINT'), JSON.stringify(r.body?.data?.allowed_next));
  check('workflow separates status from documents', typeof r.body?.data?.status === 'string' && typeof r.body?.data?.documents === 'object');
  check('workflow reuses pickup_location as the loading point', r.body?.data?.loading?.loading_point === 'Kosi Farm Gate', r.body?.data?.loading?.loading_point);

  // --- 2. a posted status is IGNORED by the operational endpoints ------------
  r = await call('POST', `${T}/loading/send`, { status: 'DISPATCHED' }, adminToken);
  check('POST loading/send ignores a posted status', r.status === 200 && r.body?.data?.status === 'TO_LOADING_POINT', `${r.status} ${r.body?.data?.status}`);

  // --- 3. the chain, in order --------------------------------------------------
  r = await call('POST', `${T}/loading/arrive`, {}, adminToken);
  check('loading/arrive moves to AT_LOADING_POINT', r.body?.data?.status === 'AT_LOADING_POINT', r.body?.data?.status);

  r = await call('POST', `${T}/loading/facts`, {
    actual_quantity: 480, actual_quantity_unit: 'Bags', actual_weight_kg: 24200,
  }, adminToken);
  check('loading/facts records actuals without moving status', r.status === 200 && r.body?.data?.status === 'AT_LOADING_POINT', `${r.status} ${r.body?.data?.status}`);
  check('actual quantity stored', r.body?.data?.actual_quantity === 480, String(r.body?.data?.actual_quantity));

  r = await call('POST', `${T}/loading/complete`, {
    actual_quantity: 480, actual_quantity_unit: 'Bags', actual_weight_kg: 24200, loaded_by: 'Ravi',
  }, adminToken);
  check('loading/complete moves to LOADED', r.body?.data?.status === 'LOADED', r.body?.data?.status);

  // --- 4. backward transition refused over HTTP --------------------------------
  r = await call('POST', `${T}/loading/arrive`, {}, adminToken);
  check('repeat of a passed step is a safe no-op', r.status === 200 && r.body?.idempotent === true, `idempotent=${r.body?.idempotent}`);

  r = await call('PATCH', `${T}/status`, { status: 'AT_LOADING_POINT' }, adminToken);
  check('PATCH status backwards is refused with 400', r.status === 400, `status=${r.status} msg=${r.body?.message}`);

  // --- 5. dispatch blocked by missing documents -------------------------------
  r = await call('GET', `${T}/dispatch/readiness`, null, adminToken);
  check('dispatch readiness returns 200', r.status === 200, `status=${r.status}`);
  check('dispatch is blocked while documents are missing', r.body?.data?.ready === false);
  const missing = (r.body?.data?.blockers || []).filter((b) => b.code === 'MISSING_DOCUMENT');
  check('all three mandatory documents are reported missing', missing.length === 3, JSON.stringify(missing.map((m) => m.document_type)));

  r = await call('POST', `${T}/dispatch`, {}, adminToken);
  check('dispatch is refused with 400 and the reason', r.status === 400 && /cannot be dispatched/.test(r.body?.message || ''), `status=${r.status}`);

  // --- 6. documents ------------------------------------------------------------
  for (const type of ['LR', 'INVOICE', 'E_WAY_BILL']) {
    r = await call('POST', `${T}/documents`, {
      document_type: type, document_status: 'PRESENT', reference_number: `${type}-${pid}`,
    }, adminToken);
    check(`document ${type} recorded`, r.status === 201 || r.status === 200, `status=${r.status}`);
  }
  // A retried post must not create a second row.
  r = await call('POST', `${T}/documents`, {
    document_type: 'LR', document_status: 'PRESENT', reference_number: `LR-${pid}`,
  }, adminToken);
  check('re-posting the same document is a no-op', r.body?.data?.already_recorded === true, String(r.body?.data?.already_recorded));
  check('exactly three documents exist', (await prisma.tripDocument.count({ where: { trip_id: trip.trip_id } })) === 3);

  // A posted trip_id cannot file a document against somebody else's trip.
  r = await call('POST', `${T}/documents`, { trip_id: 999999, document_type: 'POD' }, adminToken);
  check('a posted trip_id is ignored (the URL wins)', r.status === 201, `status=${r.status}`);
  await prisma.tripDocument.deleteMany({ where: { trip_id: trip.trip_id, document_type: 'POD' } });

  // --- 7. dispatch --------------------------------------------------------------
  r = await call('GET', `${T}/dispatch/readiness`, null, adminToken);
  check('dispatch is ready once documents are present', r.body?.data?.ready === true, JSON.stringify(r.body?.data?.blockers));

  r = await call('POST', `${T}/dispatch`, {}, adminToken);
  check('dispatch succeeds', r.status === 200 && r.body?.data?.status === 'DISPATCHED', `status=${r.status} ${r.body?.data?.status}`);

  const again = await call('POST', `${T}/dispatch`, {}, adminToken);
  check('a repeated dispatch is idempotent', again.body?.idempotent === true, String(again.body?.idempotent));

  const dispatchEvents = await prisma.tripTimeline.count({
    where: { trip_id: trip.trip_id, event_type: 'status_changed' },
  });
  check('exactly four movements were recorded despite the retry', dispatchEvents === 4, `count=${dispatchEvents}`);

  // --- 8. the pre-existing status control still works --------------------------
  r = await call('PATCH', `${T}/status`, { status: 'IN_TRANSIT' }, adminToken);
  check('the existing Mark In Transit control still works', r.status === 200 && r.body?.data?.status === 'IN_TRANSIT', `status=${r.status} ${r.body?.data?.status}`);
  check('the response still carries the trip relations the UI expects', Boolean(r.body?.data?.vehicle && r.body?.data?.driver), 'vehicle/driver present');

  // --- 9. timeline recorded everything ----------------------------------------
  const events = await prisma.tripTimeline.findMany({
    where: { trip_id: trip.trip_id, event_type: 'status_changed' },
    orderBy: { timeline_id: 'asc' },
  });
  const tos = events.map((e) => JSON.parse(e.metadata).to);
  check('timeline holds every movement in order', JSON.stringify(tos) === JSON.stringify(['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT']), JSON.stringify(tos));

  // --- 10. security ------------------------------------------------------------
  const denied = [
    ['customer', customerToken],
    ['driver', driverToken],
    ['unauthenticated', undefined],
  ];
  for (const [label, token] of denied) {
    for (const [what, method, path, body] of [
      ['send to loading', 'POST', `${T}/loading/send`, {}],
      ['complete loading', 'POST', `${T}/loading/complete`, {}],
      ['dispatch', 'POST', `${T}/dispatch`, {}],
      ['read documents', 'GET', `${T}/documents`, null],
      ['record a document', 'POST', `${T}/documents`, { document_type: 'LR' }],
    ]) {
      const res = await call(method, path, body, token);
      const expected = label === 'unauthenticated' ? 401 : 403;
      check(`${label} cannot ${what}`, res.status === expected, `status=${res.status}`);
    }
  }

  // --- report ------------------------------------------------------------------
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
  console.error('verify-phase4-http FAILED:', err);
  try { await cleanup(); } catch { /* ignore */ }
  if (prisma) await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
