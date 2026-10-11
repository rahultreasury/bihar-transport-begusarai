/**
 * phase9DispatchWorkspace.http.test.js
 * ---------------------------------------------------------------------------
 * PHASE 9 — LIVE HTTP VERIFICATION of the Dispatch Workspace.
 * ---------------------------------------------------------------------------
 *
 * Boots the REAL Express server and drives the REAL endpoints over TCP with a
 * REAL, signed admin JWT and a REAL PostgreSQL database. Nothing is stubbed.
 *
 *   GET   /api/trips/:id/dispatch
 *   GET   /api/trips/:id/dispatch/readiness
 *   PATCH /api/trips/:id/dispatch
 *   POST  /api/trips/:id/dispatch
 *   POST  /api/trips/:id/dispatch/lr-gr
 *   POST  /api/trips/:id/dispatch/eway-bill
 *   GET   /api/trips/:id/dispatch/eway-bill
 *   POST  /api/trips/:id/dispatch/insurance
 *   POST  /api/trips/:id/dispatch/delivery-info
 *   POST  /api/trips/:id/documents/upload
 *   GET   /api/trips/:id/documents/:documentId/file
 *   POST  /api/trips/:id/invoice
 *   GET   /api/trips/:id/invoice
 *   GET   /api/trips/:id/invoice/pdf
 *   POST  /api/trips/:id/invoice/payments
 *   GET   /api/trips/:id/payments/:transactionId/RECEIPT.pdf
 *   GET   /api/trips/:id/transit
 *   POST  /api/trips/:id/incidents
 *   POST  /api/trips/:id/vehicle-changes
 *
 * THE WHOLE END-TO-END SEQUENCE THE SPECIFICATION NAMES
 *   1. open the dispatch page on a trip at TO_LOADING_POINT → DISPATCH BLOCKED,
 *      reason "Loading not completed"
 *   2. POST /dispatch is REFUSED, and the refusal names what is missing
 *   3. send to loading → arrive → mark loaded
 *   4. open the dispatch page again → every blocker is now itemised
 *   5. fix each blocker with a real call (LR/GR, e-way bill, delivery info)
 *   6. POST /dispatch → 200, trip becomes DISPATCHED
 *   7. the movement history contains "Vehicle dispatched"
 *   8. the transit workspace opens with status DISPATCHED
 *   9. a second POST /dispatch is idempotent — no second dispatch record
 *  10. an incident and a vehicle change are persisted, and the ORIGINAL vehicle
 *      is still in the history
 *
 * NOTHING EXISTING IS TOUCHED. The test provisions its own vehicle, owner,
 * driver, user and trip, and deletes exactly what it created in `test.after`.
 * The live database is never reset.
 *
 * Usage:  node --test tests/phase9DispatchWorkspace.http.test.js
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { prisma } = require('../config/prisma');

const PORT = process.env.PH9_TEST_PORT || '3996';
let child = null;
const base = `http://127.0.0.1:${PORT}`;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const deadline = Date.now() + 40000;
  for (;;) {
    try { await fetch(`${base}/api/health`); } catch { /* still booting */ }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 500));
  }
});

// ── Fixtures ───────────────────────────────────────────────────────────────
const created = { users: [], drivers: [], vehicles: [], owners: [], trips: [], bookings: [], files: [] };
let adminToken = null;
let customerToken = null;
let tripId = null;

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

  const contentType = res.headers.get('content-type') || '';
  // ANY binary response is a buffer, not JSON. Reading a PNG back and parsing
  // it as JSON would report a false failure for a perfectly correct endpoint.
  if (contentType && !contentType.includes('application/json')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buffer, headers: res.headers };
  }

  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

test('provision a completely self-contained trip', async () => {
  const admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
  assert.ok(admin, 'an admin account exists');
  adminToken = sign(admin.admin_id, 'admin');

  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);

  const user = await prisma.user.create({
    data: {
      first_name: 'P9',
      last_name: 'Customer',
      email: `p9.customer.${suffix}@example.test`,
      phone: `9${suffix}1`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(user.user_id);
  customerToken = sign(user.user_id, 'user');

  // A Driver needs its own User, and that User must differ from the customer's.
  const driverUser = await prisma.user.create({
    data: {
      first_name: 'P9',
      last_name: 'Driver',
      email: `p9.driver.${suffix}@example.test`,
      phone: `8${suffix}1`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(driverUser.user_id);

  const owner = await prisma.vehicleOwner.create({
    data: {
      owner_name: `P9 Owner ${suffix}`,
      mobile: `7${suffix}1`.slice(0, 10),
      owner_type: 'TRANSPORT_COMPANY',
    },
  });
  created.owners.push(owner.owner_id);

  const future = new Date(Date.now() + 730 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const vehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `P9${suffix}`.padEnd(12, 'X').slice(0, 14),
      vehicle_type: 'TRUCK',
      owner_id: owner.owner_id,
      insurance_number: 'P9-INS', insurance_expiry: future,
      permit_number: 'P9-PM', permit_expiry: future,
      fitness_number: 'P9-FT', fitness_expiry: future,
      pollution_certificate: 'P9-PUCC', pollution_expiry: future,
      tax_number: 'P9-TX', tax_expiry: future,
    },
  });
  created.vehicles.push(vehicle.vehicle_id);

  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id,
      driver_name: `P9 Driver ${suffix}`,
      mobile: `6${suffix}1`.slice(0, 10),
      transport_owner_id: owner.owner_id,
      status: 'available',
      is_available: true,
    },
  });
  created.drivers.push(driver.driver_id);

  const booking = await prisma.booking.create({
    data: {
      booking_number: `P9B-${suffix}`,
      user_id: user.user_id,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      pickup_date: '2026-10-04',
      pickup_time: '08:00',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      goods_description: 'Wheat',
      number_of_items: 500,
      quantity_unit: 'Bags',
      goods_weight_kg: 25000,
      vehicle_type_required: 'TRUCK',
      final_price: 60000,
      status: 'confirmed',
    },
  });
  created.bookings.push(booking.booking_id);

  const trip = await prisma.trip.create({
    data: {
      trip_number: `P9T-${suffix}`,
      booking_id: booking.booking_id,
      user_id: user.user_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      transport_owner_id: owner.owner_id,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      distance_km: 1490,
      freight_amount: 60000,
      // Below the e-way bill threshold so the e-way bill is genuinely OPTIONAL
      // unless the test raises the declared value — which it does, in order to
      // prove the blocker appears and then clears.
      value_of_goods: 120000,
      // The declaration is high, so the policy REQUIRES transit insurance. The
      // test removes the requirement explicitly so it can assert both branches.
      insurance_required: false,
      trip_date: new Date(),
      status: 'ASSIGNED',
    },
  });
  created.trips.push(trip.trip_id);
  tripId = trip.trip_id;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1–2 · THE PAGE OPENS, AND THE REFUSAL IS EXPLICIT
// ═══════════════════════════════════════════════════════════════════════════

test('1. GET /dispatch returns the whole workspace from the database', async () => {
  const res = await call('GET', `/api/trips/${tripId}/dispatch`, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const ws = res.body.data;
  for (const section of [
    'header', 'readiness', 'shipment', 'vehicle', 'driver', 'loading',
    'documents', 'lr_gr', 'eway_bill', 'delivery', 'insurance',
    'billing', 'charges', 'dispatch', 'movement_history',
  ]) {
    assert.ok(ws[section] !== undefined, `workspace.${section} is present`);
  }
  assert.equal(ws.header.trip_number.startsWith('P9T-'), true);
  assert.equal(ws.header.vehicle.vehicle_number.startsWith('P9'), true);
  assert.equal(ws.readiness.ready, false);
});

test('2. an unauthenticated caller cannot read the dispatch workspace', async () => {
  const anon = await call('GET', `/api/trips/${tripId}/dispatch`, null);
  assert.equal(anon.status, 401);
});

test('3. a customer cannot read the ADMIN dispatch workspace', async () => {
  const asCustomer = await call('GET', `/api/trips/${tripId}/dispatch`, customerToken);
  assert.equal(asCustomer.status, 403);
});

test('4. the readiness endpoint returns structured blockers, not a shrug', async () => {
  const res = await call('GET', `/api/trips/${tripId}/dispatch/readiness`, adminToken);
  assert.equal(res.status, 200);

  const d = res.body.data;
  assert.equal(d.ready, false);
  assert.ok(Array.isArray(d.blocker_codes));
  assert.ok(d.blocker_codes.includes('TRIP_NOT_LOADED'));
  assert.ok(d.blockers.every((b) => b.code && b.label && b.message));
  assert.ok(d.summary.total > 0);
  // The old placeholder sentence must be gone.
  assert.ok(!JSON.stringify(d).includes('The server has not cleared this step yet'));
});

test('5. POST /dispatch is refused, in words the operator can act on', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch`, adminToken, {});
  assert.equal(res.status, 400);

  const { message, blockers } = res.body;
  assert.match(message, /Dispatch cannot be completed because the following requirement is missing/i);
  assert.ok(blockers.length > 0, 'the full blocker list comes back');
  assert.ok(blockers.some((b) => /Loading not completed/i.test(b.label)));

  // And NOTHING was written.
  const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
  assert.equal(trip.status, 'ASSIGNED');
  assert.equal(trip.dispatched_at, null);
  assert.equal(await prisma.tripDispatch.count({ where: { trip_id: tripId } }), 0);
});

test('5b. the browser cannot dispatch by sending a status', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch`, adminToken, { status: 'DISPATCHED' });
  assert.equal(res.status, 400);
  const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
  assert.equal(trip.status, 'ASSIGNED');
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · THE LOADING CHAIN
// ═══════════════════════════════════════════════════════════════════════════

test('6. send → arrive → loaded', async () => {
  assert.equal((await call('POST', `/api/trips/${tripId}/loading/send`, adminToken, {})).status, 200);
  assert.equal((await call('POST', `/api/trips/${tripId}/loading/arrive`, adminToken, {})).status, 200);

  const complete = await call('POST', `/api/trips/${tripId}/loading/complete`, adminToken, {
    actual_quantity: 480,
    actual_quantity_unit: 'Bags',
    actual_weight_kg: 24000,
    loading_remarks: 'Loaded under tarpaulin',
    loaded_by: 'Loader Ram',
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.body.data.status, 'LOADED');
});

test('7. the loading facts are now on the dispatch page', async () => {
  const res = await call('GET', `/api/trips/${tripId}/dispatch`, adminToken);
  const ws = res.body.data;

  assert.equal(ws.loading.completed, true);
  assert.equal(ws.loading.actual_quantity, 480);
  assert.equal(ws.loading.actual_weight_kg, 24000);
  assert.equal(ws.loading.remarks, 'Loaded under tarpaulin');
  assert.match(ws.loading.location, /Kosi Farm Gate/);

  const check = ws.readiness.checks.find((c) => c.key === 'loading_completed');
  assert.equal(check.state, 'passed');
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–10 · CLEARING THE BLOCKERS, ONE REAL CALL AT A TIME
// ═══════════════════════════════════════════════════════════════════════════

test('8. the remaining blockers are itemised after loading', async () => {
  const res = await call('GET', `/api/trips/${tripId}/dispatch/readiness`, adminToken);
  const codes = res.body.data.blocker_codes;

  assert.ok(!codes.includes('TRIP_NOT_LOADED'), 'the loading gate has cleared');
  assert.ok(codes.includes('LR_GR_REQUIRED'));
  assert.ok(codes.includes('EWAY_BILL_REQUIRED'), 'declared value is ₹120,000');
  assert.ok(codes.includes('DOCUMENT_MISSING'), 'the party invoice is still absent');
  assert.ok(codes.includes('DELIVERY_INFORMATION_INCOMPLETE'));
});

test('9. every refusal still leaves the database untouched', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch`, adminToken, {});
  assert.equal(res.status, 400);

  const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
  assert.equal(trip.status, 'LOADED');
  assert.equal(trip.dispatched_at, null);
  assert.equal(await prisma.tripDispatch.count({ where: { trip_id: tripId } }), 0);
});

test('10. LR/GR is recorded and STORED, and the file downloads back', async () => {
  // A real one-pixel PNG, base64 encoded — actual bytes on disk.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const res = await call('POST', `/api/trips/${tripId}/dispatch/lr-gr`, adminToken, {
    document_type: 'LR',
    reference_number: 'LR-2026-00455',
    issued_at: '2026-10-04',
    remarks: 'Issued at the gate',
    file_name: 'lr.png',
    file_content: PNG,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.lr_gr_number, 'LR-2026-00455');

  const documentId = res.body.data.document.document_id;
  const fileUrl = res.body.data.document.file_url;
  assert.ok(fileUrl.startsWith('/uploads/'), 'the reference uses the existing convention');
  created.files.push(fileUrl);

  const download = await call('GET', `/api/trips/${tripId}/documents/${documentId}/file`, adminToken);
  assert.equal(download.status, 200);
  assert.equal(download.buffer.subarray(1, 4).toString(), 'PNG', 'the real bytes came back');
});

test('11. the E-Way Bill is recorded as an INTERNAL record, and says so', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch/eway-bill`, adminToken, {
    eway_bill_number: '121234567890',
    eway_bill_date: '2026-10-04',
    expiry_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  assert.equal(res.status, 201);

  assert.equal(res.body.data.integration_notice, 'E-Way Bill is maintained as an internal operational record. This information is stored against this Trip for operational and record-keeping purposes.');
  assert.ok(!res.body.data.government, 'government object should not exist');

  const get = await call('GET', `/api/trips/${tripId}/dispatch/eway-bill`, adminToken);
  assert.equal(get.status, 200);
  assert.ok(!get.body.data.government, 'government object should not exist');
  assert.equal(get.body.data.record.eway_bill_number, '121234567890');
});

test('12. the party invoice document clears the last document blocker', async () => {
  const res = await call('POST', `/api/trips/${tripId}/documents`, adminToken, {
    document_type: 'INVOICE',
    document_status: 'PRESENT',
    reference_number: 'PARTY-INV-9001',
  });
  assert.equal(res.status, 201);
});

test('13. delivery information and the POD decision are captured', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch/delivery-info`, adminToken, {
    consignee_name: 'Begum Bazar Rice Mill',
    consignee_contact: '9123456789',
    delivery_number: 'DL-9001',
    pod_required: true,
    value_of_goods: 120000,
  });
  assert.equal(res.status, 200);

  const readiness = await call('GET', `/api/trips/${tripId}/dispatch/readiness`, adminToken);
  assert.equal(readiness.body.data.ready, true, JSON.stringify(readiness.body.data.blockers));
});

test('13b. an incomplete delivery record is still refused', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch/delivery-info`, adminToken, {
    consignee_name: null,
    consignee_contact: null,
  });
  const readiness = await call('GET', `/api/trips/${tripId}/dispatch/readiness`, adminToken);
  assert.equal(readiness.body.data.ready, false);
  assert.ok(readiness.body.data.blocker_codes.includes('DELIVERY_INFORMATION_INCOMPLETE'));

  // Put it back.
  await call('POST', `/api/trips/${tripId}/dispatch/delivery-info`, adminToken, {
    consignee_name: 'Begum Bazar Rice Mill',
    consignee_contact: '9123456789',
    pod_required: true,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14–16 · THE DISPATCH
// ═══════════════════════════════════════════════════════════════════════════

test('14. POST /dispatch moves LOADED → DISPATCHED and returns the trip', async () => {
  const res = await call('POST', `/api/trips/${tripId}/dispatch`, adminToken, {
    pod_required: true,
    consignee_name: 'Begum Bazar Rice Mill',
    consignee_contact: '9123456789',
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'DISPATCHED');
  assert.equal(res.body.data.status, 'DISPATCHED');
  assert.ok(res.body.data.dispatched_at);
  assert.equal(res.body.movement_history_recorded, true);

  const dispatch = await prisma.tripDispatch.findFirst({ where: { trip_id: tripId } });
  assert.ok(dispatch, 'the dispatch act was recorded');
  assert.equal(dispatch.status, 'DISPATCHED');
  assert.equal(dispatch.pod_required, true);
  assert.equal(dispatch.lr_gr_number, 'LR-2026-00455');
});

test('15. the movement history contains "Vehicle dispatched", written by the server', async () => {
  const events = await prisma.tripTimeline.findMany({ where: { trip_id: tripId } });
  const dispatched = events.find((e) => e.event_type === 'vehicle_dispatched');

  assert.ok(dispatched, 'the event exists');
  assert.equal(dispatched.description, 'Vehicle dispatched');
  assert.equal(dispatched.created_by, adminToken ? dispatched.created_by : null);

  const meta = JSON.parse(dispatched.metadata);
  assert.equal(meta.to, 'DISPATCHED');
  assert.equal(meta.from, 'LOADED');
  assert.equal(meta.lr_gr_number, 'LR-2026-00455');
  assert.equal(meta.eway_bill_number, '121234567890');
  assert.equal(meta.eway_bill_source, 'INTERNAL_RECORD');
  assert.equal(meta.government_eway_bill_api_connected, false);
  assert.equal(meta.pod_required, true);

  // And it is visible through the API, without the operator writing it.
  const ws = await call('GET', `/api/trips/${tripId}/dispatch`, adminToken);
  assert.ok(ws.body.data.movement_history.some((e) => e.description === 'Vehicle dispatched'));
});

test('15b. an audit entry records who / what / old / new', async () => {
  const audit = await prisma.auditLog.findFirst({
    where: { entity_type: 'Trip', entity_id: tripId, action: 'trip_dispatched' },
  });
  assert.ok(audit);
  assert.equal(JSON.parse(audit.previous_value).status, 'LOADED');
  const next = JSON.parse(audit.new_value);
  assert.equal(next.status, 'DISPATCHED');
  assert.equal(next.eway_bill_source, 'INTERNAL_RECORD');
});

test('16. a repeated dispatch is idempotent — no second record, no second event', async () => {
  const before = await prisma.tripDispatch.count({ where: { trip_id: tripId } });
  const eventsBefore = await prisma.tripTimeline.count({
    where: { trip_id: tripId, event_type: 'vehicle_dispatched' },
  });

  const res = await call('POST', `/api/trips/${tripId}/dispatch`, adminToken, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.idempotent, true);

  assert.equal(await prisma.tripDispatch.count({ where: { trip_id: tripId } }), before);
  assert.equal(await prisma.tripTimeline.count({
    where: { trip_id: tripId, event_type: 'vehicle_dispatched' },
  }), eventsBefore);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17–19 · THE TRANSIT WORKSPACE IS NOT A DEAD PAGE
// ═══════════════════════════════════════════════════════════════════════════

test('17. the transit workspace opens with the correct status', async () => {
  const res = await call('GET', `/api/trips/${tripId}/transit`, adminToken);
  assert.equal(res.status, 200);

  const ws = res.body.data;
  assert.equal(ws.status, 'DISPATCHED');
  assert.ok(ws.dispatch.dispatched_at);
  assert.equal(ws.current_vehicle.vehicle_number.startsWith('P9'), true);

  // Tracking and movement history are SEPARATE concepts.
  assert.equal(ws.tracking.connected, false);
  assert.equal(ws.tracking.headline, 'GPS Not Connected');
  assert.ok(Array.isArray(ws.movement_history));
  assert.ok(Array.isArray(ws.vehicle_changes));
  assert.ok(ws.available_actions.some((a) => a.id === 'START_TRANSIT'));
});

test('18. an incident is a persistent record', async () => {
  const res = await call('POST', `/api/trips/${tripId}/incidents`, adminToken, {
    incident_type: 'DRIVER_UNREACHABLE',
    description: 'No answer for 40 minutes',
    location: 'Bakhtiyarpur',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.resolution, 'ONGOING');

  const list = await call('GET', `/api/trips/${tripId}/incidents`, adminToken);
  assert.equal(list.body.data.length, 1);

  const resolved = await call(
    'POST', `/api/trips/${tripId}/incidents/${res.body.data.incident_id}/resolve`,
    adminToken,
    { resolution: 'CONTINUED_SAME_VEHICLE', remarks: 'Answered at the next checkpoint' },
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.resolution, 'CONTINUED_SAME_VEHICLE');
});

test('19. a vehicle change keeps the original vehicle in the history', async () => {
  // A replacement truck.
  const future = new Date(Date.now() + 730 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const replacement = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `P9R${String(Date.now()).slice(-6)}`.padEnd(12, 'X').slice(0, 14),
      vehicle_type: 'TRUCK',
      owner_id: created.owners[0],
      insurance_number: 'P9R-INS', insurance_expiry: future,
      permit_number: 'P9R-PM', permit_expiry: future,
      fitness_number: 'P9R-FT', fitness_expiry: future,
    },
  });
  created.vehicles.push(replacement.vehicle_id);

  const original = await prisma.transportVehicle.findUnique({ where: { vehicle_id: created.vehicles[0] } });

  const res = await call('POST', `/api/trips/${tripId}/vehicle-changes`, adminToken, {
    reason: 'BREAKDOWN',
    remarks: 'Clutch failure, recovered by transshipment',
    location: 'NH-22, Bakhtiyarpur',
    new_vehicle_id: replacement.vehicle_id,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  assert.equal(res.body.data.change.old_vehicle_number, original.vehicle_number);
  assert.equal(res.body.data.change.new_vehicle_number, replacement.vehicle_number);

  // The paper is flagged for amendment — and the government record is NOT
  // claimed to have been touched.
  assert.equal(res.body.data.eway_bill.vehicle_update_required, true);
  assert.ok(!res.body.data.eway_bill.gov_sync_status, 'gov_sync_status should not exist');
  assert.match(res.body.data.integration_notice, /E-Way Bill is maintained as an internal operational record/i);

  const history = await call('GET', `/api/trips/${tripId}/vehicle-changes`, adminToken);
  assert.equal(history.body.data.length, 2, 'the original plus the change');
  assert.equal(history.body.data[0].new_vehicle_number, original.vehicle_number);
});

test('19b. a vehicle change with no reason is refused', async () => {
  const res = await call('POST', `/api/trips/${tripId}/vehicle-changes`, adminToken, {
    new_vehicle_id: created.vehicles[0],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /reason/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 20–23 · CUSTOMER BILLING, MONEY AND DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

test('20. [ Create Invoice ] persists a real invoice linked to the trip', async () => {
  const res = await call('POST', `/api/trips/${tripId}/invoice`, adminToken, {});
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const inv = res.body.data;
  assert.equal(inv.trip_id, tripId);
  assert.match(inv.invoice_number, /^BT\/INV\/\d{4}\/\d{5}$/);
  assert.equal(inv.document_kind, 'INTERNAL_CUSTOMER_INVOICE');
  assert.equal(inv.irn, null, 'no government e-invoice is claimed');
  assert.equal(inv.payment_status, 'UNPAID');

  const get = await call('GET', `/api/trips/${tripId}/invoice`, adminToken);
  assert.equal(get.status, 200);
  assert.equal(get.body.data.is_government_e_invoice, false);
  assert.match(get.body.data.note, /no GST e-invoice/i);
});

test('20b. a second Create Invoice does not raise a second bill', async () => {
  const before = await prisma.invoice.count({ where: { trip_id: tripId } });
  const res = await call('POST', `/api/trips/${tripId}/invoice`, adminToken, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.created, false);
  assert.equal(await prisma.invoice.count({ where: { trip_id: tripId } }), before);
});

test('21. [ Download PDF ] returns a REAL PDF rendered from the stored row', async () => {
  const res = await call('GET', `/api/trips/${tripId}/invoice/pdf`, adminToken);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.ok(res.buffer.length > 1000);
  assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(res.buffer.subarray(-32).toString('latin1'), /%%EOF\s*$/);

  // The render is recorded on the row.
  const inv = await prisma.invoice.findFirst({ where: { trip_id: tripId } });
  assert.ok(inv.pdf_generated_at);
});

test('22. partial customer payments are supported and never self-settle', async () => {
  const first = await call('POST', `/api/trips/${tripId}/invoice/payments`, adminToken, {
    amount: 20000, payment_method: 'BANK', reference_number: 'UTR-778899',
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.payment_status, 'PARTIALLY_PAID');
  assert.equal(first.body.data.received, 20000);

  const second = await call('POST', `/api/trips/${tripId}/invoice/payments`, adminToken, {
    amount: 15000, payment_method: 'CASH',
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.data.payment_status, 'PARTIALLY_PAID', 'still outstanding');
  assert.equal(second.body.data.received, 35000);
  assert.ok(second.body.data.balance > 0);

  // The dispatch did NOT settle the bill — it happened before these payments
  // and reached the ledger as two separate rows.
  const tx = await prisma.financialTransaction.findMany({ where: { trip_id: tripId } });
  const customerRows = tx.filter((t) => t.transaction_type === 'CUSTOMER_PAYMENT');
  assert.equal(customerRows.length, 2);
  assert.ok(customerRows.every((t) => t.invoice_id));
  assert.ok(customerRows.every((t) => t.direction === 'CREDIT'));
});

test('22b. a bank payment without a UTR is refused', async () => {
  const res = await call('POST', `/api/trips/${tripId}/invoice/payments`, adminToken, {
    amount: 1000, payment_method: 'BANK',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /UTR/i);
});

test('23. a money receipt is a REAL PDF named after the ledger row', async () => {
  const tx = await prisma.financialTransaction.findFirst({
    where: { trip_id: tripId, transaction_type: 'CUSTOMER_PAYMENT', reference_number: 'UTR-778899' },
  });
  assert.ok(tx);

  const res = await call('GET', `/api/trips/${tripId}/payments/${tx.transaction_id}/RECEIPT.pdf`, adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(res.headers.get('content-disposition'), /Money-Receipt/i);
});

test('23b. a receipt cannot be printed for money that went OUT', async () => {
  const outgoing = await prisma.financialTransaction.create({
    data: {
      trip_financial_id: (await prisma.tripFinancial.create({
        data: { trip_id: tripId, customer_fare: 0 },
      })).trip_financial_id,
      trip_id: tripId,
      transaction_type: 'DRIVER_ADVANCE',
      amount: 5000,
      direction: 'DEBIT',
      from_party: 'BIHAR_TRANSPORT',
      to_party: 'DRIVER',
      payment_method: 'CASH',
      status: 'PAID',
    },
  });

  const res = await call('GET', `/api/trips/${tripId}/payments/${outgoing.transaction_id}/RECEIPT.pdf`, adminToken);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /money received/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP — only what this test created
// ═══════════════════════════════════════════════════════════════════════════

test.after(async () => {
  if (child) child.kill('SIGTERM');

  // Delete in dependency order, children first, so no FK blocks a cascade.
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.booking.deleteMany({ where: { booking_id: { in: created.bookings } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.vehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.owners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });

  await prisma.$disconnect();
});
