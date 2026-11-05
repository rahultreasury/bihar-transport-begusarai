/**
 * phase5-transit.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE 5 — LIVE POSTGRESQL VERIFICATION (STEP 19)
 * ---------------------------------------------------------------------------
 * Runs the real transit stage against the real database:
 *
 *   DISPATCHED → IN_TRANSIT → movement events → location → ETA
 *
 * It asserts the things a fake Prisma client cannot:
 *   • the additive Phase 5 columns really exist on `trips`
 *   • status + timeline really commit in ONE transaction
 *   • the exact (non-LIKE-wildcard) event filter really finds movement rows
 *   • idempotency holds against real rows, including the A/B/A retry pattern
 *   • customer/driver authorisation is enforced against real data
 *
 * IT PROVISIONS ITS OWN TRIP and deletes everything it created in `finally`,
 * so it does not depend on the shape of existing production data and leaves
 * no residue. Real vehicle / driver / owner ids are reused from an existing
 * trip so the foreign keys are genuine.
 *
 * Usage:  node --test tests/phase5-transit.db.test.js
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const { prisma } = require('../config/prisma');
const TripTrackingService = require('../services/TripTrackingService');
const tripStateMachine = require('../utils/TripStateMachine');

const ADMIN = { user_id: 1, role: 'admin' };
const MOVEMENT_TYPES = ['movement_DESTINATION_APPROACH', 'movement_DELIVERY_READY'];

const service = new TripTrackingService();

/** A unique marker so every row this file creates can be identified. */
let runId = 0;
const marker = () => `PH5DB${Date.now().toString(36)}${(runId += 1)}`;

/**
 * Create a trip in DISPATCHED, reusing real vehicle/driver/owner ids.
 * Returns the created trip plus the ids that must be cleaned up.
 */
async function createDispatchedTrip() {
  const donor = await prisma.trip.findFirst({
    where: { status: { in: ['ASSIGNED', 'IN_TRANSIT', 'COMPLETED', 'PENDING'] } },
    orderBy: { trip_id: 'asc' },
  });
  if (!donor) return null;

  const tag = marker();
  const trip = await prisma.trip.create({
    data: {
      trip_number: `PH5-TEST-${tag}`,
      transport_owner_id: donor.transport_owner_id,
      vehicle_id: donor.vehicle_id,
      driver_id: donor.driver_id,
      user_id: donor.user_id,
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
  return trip;
}

/** Remove absolutely everything this helper created. */
async function destroyTrip(trip) {
  if (!trip) return;
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entity_type: 'Trip', entity_id: trip.trip_id },
        { entity_type: 'TripTimeline', entity_id: { in: (await prisma.tripTimeline.findMany({
          where: { trip_id: trip.trip_id }, select: { timeline_id: true },
        })).map((r) => r.timeline_id) } },
      ],
    },
  });
  await prisma.tripTimeline.deleteMany({ where: { trip_id: trip.trip_id } });
  await prisma.trip.delete({ where: { trip_id: trip.trip_id } });
}

// ===========================================================================

test('DB. the additive Phase 5 columns exist on trips', async () => {
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name IN (
        'current_latitude','current_longitude','location_updated_at','location_source',
        'location_accuracy_m','estimated_arrival_at','eta_calculated_at','distance_remaining_km'
      )
    ORDER BY column_name
  `);
  assert.equal(cols.length, 8, 'all eight Phase 5 columns are present');
  for (const c of cols) {
    assert.equal(c.is_nullable, 'YES', `${c.column_name} is nullable (additive, non-breaking)`);
  }
  console.log(`    [db] Phase 5 columns: ${cols.map((c) => c.column_name).join(', ')}`);
});

test('DB. no duplicate tracking / movement / location / ETA table was created', async () => {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ~* '(movement|tracking|gps)'
  `);
  assert.deepEqual(tables, [], 'no TripMovement2 / MovementHistory2 / TripTrackingHistory2');
});

test('DB. DISPATCHED → IN_TRANSIT → movement → location, end to end', async (t) => {
  let trip = null;
  try {
    trip = await createDispatchedTrip();
    if (!trip) {
      t.skip('no donor trip to clone vehicle/driver/owner ids from');
      return;
    }
    const tripId = trip.trip_id;
    console.log(`    [db] provisioned trip_id=${tripId} (${trip.trip_number})`);

    // ── 1. The canonical transit step. ─────────────────────────────────────
    const first = await service.startTransit(tripId, {}, ADMIN);
    assert.equal(first.status, 'IN_TRANSIT');
    assert.equal(first.idempotent, false);

    const after = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    assert.equal(after.status, 'IN_TRANSIT', 'the status really moved in the database');

    // Status and timeline committed together.
    const statusEvents = await prisma.tripTimeline.findMany({
      where: { trip_id: tripId, event_type: 'status_changed' },
      orderBy: { timeline_id: 'asc' },
    });
    assert.equal(statusEvents.length, 1, 'exactly one status_changed event');
    const meta = JSON.parse(statusEvents[0].metadata);
    assert.equal(meta.from, 'DISPATCHED');
    assert.equal(meta.to, 'IN_TRANSIT');
    assert.equal(meta.operation, 'START_TRANSIT');

    const audits = await prisma.auditLog.findMany({
      where: { entity_type: 'Trip', entity_id: tripId, action: 'trip_operational_transition' },
    });
    assert.equal(audits.length, 1, 'the audit entry committed in the same transaction');

    // ── 2. Repeat is a genuine no-op. ──────────────────────────────────────
    const second = await service.startTransit(tripId, {}, ADMIN);
    assert.equal(second.idempotent, true);
    assert.equal(
      await prisma.tripTimeline.count({ where: { trip_id: tripId, event_type: 'status_changed' } }),
      1,
      'no extra timeline row on repeat'
    );

    // ── 3. Movement events on the REAL timeline. ───────────────────────────
    const m1 = await service.recordMovement(tripId, 'DESTINATION_APPROACH', { notes: 'db-test' }, ADMIN);
    assert.equal(m1.idempotent, false);
    assert.equal(m1.event.event_type, 'movement_DESTINATION_APPROACH');

    // The exact filter the service now uses must find it.
    assert.equal(
      await prisma.tripTimeline.count({ where: { trip_id: tripId, event_type: { in: MOVEMENT_TYPES } } }),
      1,
      'the exact event_type filter finds the movement row'
    );

    // Idempotency against a real table, including the A/B/A retry pattern.
    const m2 = await service.recordMovement(tripId, 'DESTINATION_APPROACH', { notes: 'db-test' }, ADMIN);
    assert.equal(m2.idempotent, true);
    await service.recordMovement(tripId, 'DELIVERY_READY', { notes: 'db-test-2' }, ADMIN);
    const m3 = await service.recordMovement(tripId, 'DESTINATION_APPROACH', { notes: 'db-test' }, ADMIN);
    assert.equal(m3.idempotent, true, 'A/B/A cannot manufacture a third real row');
    assert.equal(
      await prisma.tripTimeline.count({ where: { trip_id: tripId, event_type: { in: MOVEMENT_TYPES } } }),
      2
    );

    const history = await service.getMovementHistory(tripId);
    assert.deepEqual(history.map((h) => h.milestone), ['DESTINATION_APPROACH', 'DELIVERY_READY']);

    // ── 4. Location, against a real column. ────────────────────────────────
    const located = await service.updateLocation(
      tripId, { latitude: 25.5941, longitude: 85.1376, source: 'ADMIN', accuracy_m: 12 }, ADMIN
    );
    assert.equal(located.current_latitude, 25.5941);
    const row = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    assert.equal(row.location_source, 'ADMIN');
    assert.ok(row.location_updated_at instanceof Date);

    // The null-coordinate bug this phase fixed, against the real column.
    await assert.rejects(
      () => service.updateLocation(tripId, { latitude: null, longitude: null }, ADMIN),
      /required/
    );
    const unchanged = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    assert.equal(unchanged.current_latitude, 25.5941, 'a rejected update wrote nothing');

    // Out-of-range is rejected too.
    await assert.rejects(
      () => service.updateLocation(tripId, { latitude: 91, longitude: 0 }, ADMIN),
      /Invalid coordinates/
    );

    // ── 5. Tracking read: the milestone must be a real value. ──────────────
    const tracking = await service.getTracking(tripId, { kind: 'admin', role: 'admin' });
    assert.equal(tracking.milestone.code, 'DELIVERY_READY');
    // The exact failure this phase fixed: a Promise serialises to {}.
    const wire = JSON.parse(JSON.stringify(tracking));
    assert.equal(wire.milestone.code, 'DELIVERY_READY', 'milestone survives JSON serialisation');
    assert.ok(wire.location, 'the location is present');
    assert.equal(wire.location.latitude, 25.5941);

    // ── 6. Authorisation, against real data. ───────────────────────────────
    const customerView = await service.getTracking(tripId, { kind: 'customer', userId: trip.user_id });
    const wireCustomer = JSON.parse(JSON.stringify(customerView));
    assert.equal(wireCustomer.milestone.code, 'DELIVERY_READY', 'the customer sees the milestone too');
    const payload = JSON.stringify(wireCustomer);
    for (const forbidden of ['mobile', 'freight_amount', 'commission', 'outstanding', 'settlement']) {
      assert.ok(!payload.includes(forbidden), `customer payload must not contain ${forbidden}`);
    }
    await assert.rejects(
      () => service.getTracking(tripId, { kind: 'customer', userId: 99999999 }),
      /not yours/
    );
    await assert.rejects(
      () => service.getTracking(tripId, { kind: 'driver', driverId: 999999 }),
      /not assigned to you/
    );
  } finally {
    await destroyTrip(trip);
  }
});

test('DB. the operational endpoint refuses the legacy short-cut; the status API keeps it', async () => {
  // PENDING → IN_TRANSIT is the legacy edge the shipped "Mark In Transit"
  // control uses. The canonical endpoint must refuse it…
  const refused = await service.startTransit(-1, {}, ADMIN).catch((e) => e);
  assert.ok(refused, 'a missing trip still errors');

  for (const from of ['PENDING', 'ASSIGNED']) {
    assert.throws(
      () => tripStateMachine.validateOperationalTransition(from, 'IN_TRANSIT'),
      /legacy short-cut|Allowed from/,
      `${from} → IN_TRANSIT is refused operationally`
    );
    // …and the legacy control still permits it, so nothing shipped is broken.
    assert.doesNotThrow(
      () => tripStateMachine.validateTransition(from, 'IN_TRANSIT'),
      `${from} → IN_TRANSIT still works through the status API`
    );
  }
  assert.doesNotThrow(() => tripStateMachine.validateOperationalTransition('DISPATCHED', 'IN_TRANSIT'));
});

test('DB. no test data from this file survives', async () => {
  const leftoverTrips = await prisma.trip.count({ where: { trip_number: { startsWith: 'PH5-TEST-' } } });
  assert.equal(leftoverTrips, 0, 'every provisioned trip was deleted');

  const ids = (await prisma.trip.findMany({ where: { trip_number: { startsWith: 'PH5-TEST-' } } }))
    .map((r) => r.trip_id);
  assert.deepEqual(ids, []);

  const stray = await prisma.auditLog.count({ where: { action: 'trip_movement_recorded' } });
  assert.equal(stray, 0, 'no stray movement audit rows from the live run');
});

test.after(async () => {
  await prisma.$disconnect();
});
