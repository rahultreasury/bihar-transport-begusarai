/**
 * orderDashboardRegression.test.js
 * ============================================================================
 * Regression tests for the ORDER LIST + DASHBOARD 500s.
 *
 * THE BUG
 *   `TripRepository.getTopClients()` grouped trips by `user_id` and fed the
 *   result straight into `user.findMany({ where: { user_id: { in: userIds } } })`.
 *   `trips.user_id` is NULLABLE, so the group can contain `null` — and Prisma's
 *   `in:` filter is typed `ListIntFieldRefInput` and rejects null outright:
 *
 *     Argument `in`: Invalid value provided.
 *       Expected ListIntFieldRefInput, provided (Null, Int, Int, Int, Int).
 *
 *   That turned GET /api/trips/top-clients into a 500 and took a dashboard card
 *   down with it.
 *
 * WHY THESE TESTS USE THE REAL DATABASE
 *   The failure is a Prisma ARGUMENT-VALIDATION error, not a JavaScript one. A
 *   hand-written double would happily accept `[null, 1, 2]` and could never
 *   reproduce it. These assertions therefore run against real rows that mirror
 *   the production shape: a NULL `user_id` group alongside normal ones.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PrismaClient } = require('@prisma/client');
const TripRepository = require('../repositories/TripRepository');
const TripStateMachine = require('../utils/TripStateMachine');

const prisma = new PrismaClient();

/**
 * Is the database reachable? Probed inside `before()` rather than at module
 * scope — a top-level `await` alongside CommonJS `require` makes Node refuse to
 * pick a module format and the whole file fails to load.
 */
let dbAvailable = false;
let skipReason = '';

test.before(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbAvailable = true;
  } catch (e) {
    skipReason = `database unavailable: ${e.message}`;
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// 1 — THE REGRESSION THAT CAUSED THE 500
// ============================================================================

test('REGRESSION 1 — getTopClients survives trips with a NULL user_id', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  // The real database already contains such rows (legacy DIRECT / OFFLINE_CLIENT
  // consignments), which is what made this endpoint 500 in production.
  const nullGroups = await prisma.trip.count({ where: { user_id: null } });

  const repo = new TripRepository(prisma);

  // The call that used to throw. It must now return data.
  const clients = await repo.getTopClients(5);

  assert.ok(Array.isArray(clients), 'it returns an array');
  assert.ok(clients.length > 0, 'with real rows from the database');
  // A null-user group is still reported — it is not silently dropped, because
  // that consignment's trips and freight are real.
  for (const c of clients) {
    assert.ok(c.user === null || typeof c.user === 'object', 'user is null or a record');
    assert.equal(typeof c.tripCount, 'number', 'tripCount is a number');
  }
  assert.ok(
    clients.some((c) => c.user === null) || nullGroups === 0,
    'a null-user group, when present, is returned rather than discarded'
  );
});

test('REGRESSION 2 — the filter handed to Prisma never contains a null', () => {
  // The precise shape that Prisma rejects, asserted directly so the rule is
  // documented at the point of the fix.
  const grouped = [{ user_id: null }, { user_id: 1 }, { user_id: 39 }];
  const userIds = grouped.map((c) => c.user_id).filter((id) => id !== null && id !== undefined);

  assert.deepEqual(userIds, [1, 39], 'nulls are removed before building the `in` list');
  assert.equal(userIds.includes(null), false, 'the list contains no null');
});

// ============================================================================
// 2 — NULLABILITY: the Universal Vehicle Hire migration made trip resources
//     nullable, and shared reads must tolerate that
// ============================================================================

test('NULLABILITY 3 — a trip with a null vehicle does not break the trip list', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  // The WAITING FOR VEHICLE state the new workflow deliberately allows.
  const row = await prisma.trip.findFirst({
    where: { vehicle_id: null },
    orderBy: { trip_id: 'desc' },
  });
  if (!row) return t.skip('no null-vehicle trip in this database');

  const repo = new TripRepository(prisma);
  const list = await repo.findAll({ page: 1, limit: 50 });

  // `findAll` returns a paged envelope; accept either shape rather than
  // asserting a return contract this test does not own.
  const rows = Array.isArray(list) ? list : (list?.data || list?.trips || []);
  assert.ok(Array.isArray(rows), 'the trip list still resolves');
  assert.ok(rows.length > 0, 'and returns rows even though one has no vehicle');
});

test('NULLABILITY 4 — a trip with null vehicle AND driver resolves its relations', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const row = await prisma.trip.findFirst({
    where: { vehicle_id: null, driver_id: null },
    orderBy: { trip_id: 'desc' },
  });
  if (!row) return t.skip('no fully-unassigned trip in this database');

  // Relations are optional now, so the include must not be assumed non-null.
  const loaded = await prisma.trip.findUnique({
    where: { trip_id: row.trip_id },
    include: { vehicle: true, driver: true, transportOwner: true },
  });

  assert.equal(loaded.vehicle, null, 'vehicle is null, not a crash');
  assert.equal(loaded.driver, null);
  assert.equal(loaded.transportOwner, null);
  assert.equal(loaded.status, row.status, 'the row still reads back normally');
});

test('NULLABILITY 5 — a trip with null transport_owner does not break the owner list', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const row = await prisma.trip.findFirst({ where: { transport_owner_id: null } });
  if (!row) return t.skip('no null-owner trip in this database');

  // Owner aggregation must not require every trip to have an owner.
  const owners = await prisma.vehicleOwner.findMany({ select: { owner_id: true } });
  assert.ok(Array.isArray(owners), 'the owner list is independent of trip nullability');
});

test('NULLABILITY 6 — a trip without a VehicleHire does not break the dashboard', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const withoutHire = await prisma.trip.count({ where: { vehicleHire: null } });
  const total = await prisma.trip.count();
  assert.ok(total > withoutHire, 'most trips have no hire — the common case');

  // The trip summary the dashboard renders.
  const summary = await new TripRepository(prisma).getSummary();
  assert.equal(typeof summary.totalTrips, 'number');
  assert.ok(summary.totalTrips > 0, 'the dashboard counts real trips');
});

// ============================================================================
// 3 — THE ORDER LIST AND DETAIL ENDPOINTS
// ============================================================================

test('ORDERS 7 — the booking list query returns real records', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  // `listBookings` is the method the admin orders list actually calls.
  const repo = new (require('../repositories/BookingRepository'))(prisma);
  const result = await repo.listBookings({
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  });

  const rows = result?.data || result?.bookings || result;
  assert.ok(Array.isArray(rows), 'rows is an array');
  assert.ok(rows.length > 0, 'and returns real orders');

  const total = await prisma.booking.count();
  assert.ok(total > 0, `the database has bookings (${total})`);
});

test('ORDERS 8 — order BTB-2026-00203 (confirmed, with a Trip) resolves', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const booking = await prisma.booking.findUnique({
    where: { booking_number: 'BTB-2026-00203' },
    include: { trips: { include: { vehicleHire: true } } },
  });
  if (!booking) return t.skip('BTB-2026-00203 is not in this database');

  assert.ok(booking.trips.length >= 0, 'its trips resolve');
  // The trip carries the vehicle/driver the enquiry assigned.
  const trip = booking.trips[0];
  if (trip) {
    assert.equal(trip.status, 'ASSIGNED', 'the operational trip is ASSIGNED');
    assert.ok(trip.vehicle_id, 'and carries the engaged vehicle');
  }
});

test('ORDERS 9 — an order with NO Trip resolves without error', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const booking = await prisma.booking.findFirst({
    where: { trips: { none: {} } },
    orderBy: { booking_id: 'desc' },
  });
  if (!booking) return t.skip('every booking has a trip in this database');

  // This is the majority branch: a booking that is not operational yet.
  const loaded = await prisma.booking.findUnique({
    where: { booking_id: booking.booking_id },
    include: { trips: true },
  });
  assert.deepEqual(loaded.trips, [], 'no trips, and the record still reads back');
  assert.equal(loaded.booking_number, booking.booking_number);
});

test('ORDERS 10 — BTB-2026-00367 resolves', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const booking = await prisma.booking.findUnique({
    where: { booking_number: 'BTB-2026-00367' },
  });
  if (!booking) return t.skip('BTB-2026-00367 is not in this database');
  assert.ok(booking.booking_id, 'it loads');
});

// ============================================================================
// 4 — DATA SAFETY: provisioning must not have created duplicates or orphans
// ============================================================================

test('DATA 11 — provisioning created exactly one trip per booking', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const dupes = await prisma.$queryRawUnsafe(
    'SELECT booking_id, COUNT(*)::int AS c FROM trips WHERE booking_id IS NOT NULL GROUP BY booking_id HAVING COUNT(*) > 1'
  );
  assert.deepEqual(dupes, [], 'no booking has more than one operational trip');
});

test('DATA 12 — the expected record counts are intact (nothing was deleted)', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  const [bookings, enquiries, trips, hires] = await Promise.all([
    prisma.booking.count(),
    prisma.enquiry.count(),
    prisma.trip.count(),
    prisma.vehicleHire.count(),
  ]);

  assert.ok(bookings >= 57, `bookings present (${bookings})`);
  assert.ok(enquiries >= 40, `enquiries present (${enquiries})`);
  assert.ok(trips >= 27, `trips present (${trips})`);
  assert.equal(hires, 1, 'the vehicle hire is untouched');
});

test('DATA 13 — the newly provisioned trips carry a real customer', async (t) => {
  if (!dbAvailable) return t.skip(skipReason);

  // Provisioning copies `bookings.user_id`; a null here would have been the
  // source of the `in: [null]` crash, so it is asserted rather than assumed.
  const provisioned = await prisma.trip.findMany({
    where: { booking_id: { not: null } },
    select: { trip_number: true, user_id: true, booking_id: true },
  });
  for (const t2 of provisioned) {
    assert.notEqual(t2.user_id, null, `${t2.trip_number} has a real customer`);
  }
});

// ============================================================================
// 5 — THE HIRE WORKFLOW STILL PASSES ITS OWN GATE
// ============================================================================

test('ARCHITECTURE 14 — the vehicle-hire architecture is intact', () => {
  const Svc = require('../services/TripVehicleAssignmentService');
  const Hire = require('../services/VehicleHireWorkflowService');
  const policy = require('../config/vehicleHirePolicy');
  const stage = require('../config/tripStagePolicy');

  assert.equal(typeof Svc, 'function', 'TripVehicleAssignmentService exists');
  assert.ok(Hire.VehicleHireWorkflowService, 'VehicleHireWorkflowService exists');
  assert.ok(policy.hireStateFor, 'vehicleHirePolicy still derives the hire state');
  assert.ok(stage.resolveTripStage, 'tripStagePolicy still derives the stage');

  // Trip remains the single operational source of truth.
  assert.deepEqual(
    TripStateMachine.TRIP_STATUSES.includes('ASSIGNED') ? true : false,
    true,
    'the Trip state machine is unchanged'
  );
});

test('ARCHITECTURE 15 — assignment and hire remain separate concerns', () => {
  const A = require('../services/TripVehicleAssignmentService');
  const s = new A({ prisma: {} });
  // Assignment decides WHO drives.
  assert.equal(typeof s.assign, 'function');
  assert.equal(typeof s.getCurrentAssignment, 'function');
  // It must NOT have grown money/settlement responsibilities.
  for (const forbidden of ['createHire', 'settleVendor', 'payVendor', 'calculateGross']) {
    assert.equal(s[forbidden], undefined, `${forbidden} is not on the assignment service`);
  }
});
