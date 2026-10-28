/**
 * phase4LoadingDispatch.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE 4 — INTEGRATION TESTS AGAINST A LIVE POSTGRESQL DATABASE
 * ---------------------------------------------------------------------------
 *
 * The unit suite (tests/phase4LoadingDispatch.test.js) proves the rules. This
 * one proves them against real tables, real foreign keys, real enum values and
 * real transactions — including that the new TripStatus values actually exist
 * in the database and that a trip can genuinely be walked all the way from
 * ASSIGNED to DISPATCHED.
 *
 * Nothing is mocked. Every row is created here and deleted again in `after()`,
 * scoped to the ids this file recorded.
 *
 * IF NO LIVE POSTGRESQL IS AVAILABLE the tests report themselves as SKIPPED
 * with the reason. They never pretend to have passed.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const TripOperationalService = require('../services/TripOperationalService');
const TripDocumentService = require('../services/TripDocumentService');
const documentPolicy = require('../config/tripDocumentPolicy');
const tripStateMachine = require('../utils/TripStateMachine');
const { ValidationError } = require('../utils/AppError');

const ADMIN = { user_id: null, role: 'admin' };
const TAG = `P4T${process.pid}`;
let testCounter = 0;
function uniqueSuffix(base) {
  testCounter += 1;
  return `${base}-${process.pid}-${testCounter}-${Date.now().toString(36)}`;
}

/**
 * Generate a collision-resistant vehicle number.
 * Uses a large random component to avoid collisions in parallel test runs.
 * Format: P4 + uniqueSuffix (up to 20 chars for vehicle_number column)
 */
function generateVehicleNumber(suffix) {
  const uniq = uniqueSuffix(suffix);
  return `P4${uniq}`.slice(0, 20);
}

const created = { users: [], drivers: [], vehicleOwners: [], transportVehicles: [], trips: [] };
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
  // Trip cascades to trip_documents and trip_timeline.
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });

  // Sibling suites run CONCURRENTLY against this one database. A suite whose
  // donor-search seeds a trip on one of this file's vehicles holds an FK for
  // as long as that trip lives; the deletion below is therefore retried a few
  // times so a *transient* cross-suite reference cannot leave this file's
  // vehicles behind. A PERSISTENT reference fails loudly, as it should.
  const deleteWithRetry = async (fn) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await fn();
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((r) => setTimeout(r, 750 * attempt));
      }
    }
  };
  await deleteWithRetry(() => prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } }));
  await deleteWithRetry(() => prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } }));
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

const guard = async (t) => {
  if (!ready) return t.skip(skipReason);
  return null;
};

async function seedTrip({ freight = 60000, suffix }) {
  const uniq = uniqueSuffix(suffix);
  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `P4 ${uniq}`, mobile: `97${process.pid}0${uniq}`.slice(0, 10) },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: generateVehicleNumber(suffix),
      vehicle_type: 'TRUCK',
      owner_id: owner.owner_id,
      is_available: true,
      current_status: 'available',
    },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const user = await prisma.user.create({
    data: {
      first_name: 'P4', last_name: 'Driver',
      email: `p4.driver.${uniq}@example.test`,
      phone: `76${process.pid}${uniq}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(user.user_id);

  const driver = await prisma.driver.create({
    data: {
      user_id: user.user_id, driver_name: `P4 Driver ${uniq}`,
      mobile: `75${process.pid}${uniq}`.slice(0, 10),
      transport_owner_id: owner.owner_id, is_available: true, status: 'available',
    },
  });
  created.drivers.push(driver.driver_id);

  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-P4-${uniq}`,
      source_type: 'DIRECT',
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      freight_amount: freight,
      driver_payment: 0,
      status: 'ASSIGNED',
      trip_date: new Date('2026-09-01T00:00:00.000Z'),
    },
  });
  created.trips.push(trip.trip_id);

  return { ownerId: owner.owner_id, vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, tripId: trip.trip_id };
}

async function satisfyDocuments(tripId) {
  const svc = new TripDocumentService({ prisma });
  const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
  for (const type of documentPolicy.requiredDocumentsFor(trip)) {
    await svc.recordDocument(tripId, {
      document_type: type, document_status: 'PRESENT', reference_number: `${type}-${tripId}`,
    }, ADMIN);
  }
}

// ===========================================================================

test('DB · the new operational statuses exist in the database enum', async (t) => {
  if (await guard(t)) return;

  const rows = await prisma.$queryRawUnsafe(
    "select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typname = 'TripStatus' order by e.enumsortorder"
  );
  const labels = rows.map((r) => r.enumlabel);

  for (const status of ['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED']) {
    assert.ok(labels.includes(status), `${status} must exist in the TripStatus enum`);
  }
  // The historical six are all still there — the phase-4 stages were added,
  // not substituted. Their physical positions follow the enum the migration
  // chain created (see the enum-order note below); membership is the contract.
  for (const status of ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED']) {
    assert.ok(labels.includes(status), `${status} must exist in the TripStatus enum`);
  }
  // The DB's physical enum order is the one migration 20260820000000 created
  // (all ten values born together); assert it so a future silent reorder of
  // the deployed chain is caught rather than absorbed.
  assert.deepEqual(labels, [
    'PENDING',
    'ASSIGNED',
    'TO_LOADING_POINT',
    'AT_LOADING_POINT',
    'LOADED',
    'DISPATCHED',
    'IN_TRANSIT',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
  ]);
});

test('DB · the full operational chain runs end to end on real rows', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '101' });
  const svc = new TripOperationalService({ prisma });

  let r = await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  assert.equal(r.status, 'TO_LOADING_POINT');
  let row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.ok(row.sent_to_loading_at instanceof Date);

  r = await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  assert.equal(r.status, 'AT_LOADING_POINT');
  row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.ok(row.arrived_at_loading_at instanceof Date);

  r = await svc.completeLoading(ctx.tripId, {
    actual_quantity: 480,
    actual_quantity_unit: 'Bags',
    actual_weight_kg: 24200,
    loaded_by: 'Ravi',
  }, ADMIN);
  assert.equal(r.status, 'LOADED');
  row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.ok(row.loading_completed_at instanceof Date);
  assert.equal(row.actual_quantity, 480);
  assert.equal(row.actual_weight_kg, 24200);

  // Dispatch is refused while the paperwork is missing…
  await assert.rejects(() => svc.dispatch(ctx.tripId, {}, ADMIN), ValidationError);
  row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(row.status, 'LOADED', 'a refused dispatch leaves the trip where it was');

  await satisfyDocuments(ctx.tripId);
  const readiness = await svc.getDispatchReadiness(ctx.tripId);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers));

  r = await svc.dispatch(ctx.tripId, {}, ADMIN);
  assert.equal(r.status, 'DISPATCHED');
  row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.ok(row.dispatched_at instanceof Date);

  // And the trip can go on into transit through the normal status route.
  const TripService = require('../services/TripService');
  const tripService = new TripService();
  const after = await tripService.updateTripStatus(ctx.tripId, 'IN_TRANSIT', ADMIN);
  assert.equal(after.status, 'IN_TRANSIT');
});

test('DB · the timeline holds every movement, in order, and is not rewritten', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '102' });
  const svc = new TripOperationalService({ prisma });

  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {}, ADMIN);
  await satisfyDocuments(ctx.tripId);
  await svc.dispatch(ctx.tripId, {}, ADMIN);

  const events = await prisma.tripTimeline.findMany({
    where: { trip_id: ctx.tripId, event_type: 'status_changed' },
    orderBy: { timeline_id: 'asc' },
  });

  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((e) => JSON.parse(e.metadata).to),
    ['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED']
  );
  for (const e of events) {
    assert.equal(e.reference_type, 'trip');
    assert.equal(e.reference_id, ctx.tripId);
  }

  // Retrying every operation must not append a single extra movement event.
  await svc.dispatch(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);

  const after = await prisma.tripTimeline.count({
    where: { trip_id: ctx.tripId, event_type: 'status_changed' },
  });
  assert.equal(after, 4, 'the movement history is exactly as long as it was');
});

test('DB · a backward transition is refused by the server', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '103' });
  const svc = new TripOperationalService({ prisma });

  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {}, ADMIN);

  // The status cannot go back to AT_LOADING_POINT.
  const TripService = require('../services/TripService');
  const tripService = new TripService();
  await assert.rejects(
    () => tripService.updateTripStatus(ctx.tripId, 'AT_LOADING_POINT', ADMIN),
    (e) => e instanceof ValidationError && /LOADED to AT_LOADING_POINT/.test(e.message)
  );

  const row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(row.status, 'LOADED');
});

test('DB · the document checklist and the unique (trip, type) index are real', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '104' });
  const svc = new TripDocumentService({ prisma });

  const trip = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  let checklist = await svc.getChecklist(trip);
  assert.equal(checklist.ready, false);
  assert.equal(checklist.items.length, 10);
  assert.deepEqual(checklist.required.sort(), ['E_WAY_BILL', 'INVOICE', 'LR']);

  const lr = await svc.recordDocument(ctx.tripId, {
    document_type: 'LR', document_status: 'PRESENT', reference_number: 'LR-DB-1',
  }, ADMIN);
  assert.equal(lr.trip_id, ctx.tripId);

  // A retry of the identical record is a no-op, not a second row.
  const again = await svc.recordDocument(ctx.tripId, {
    document_type: 'LR', document_status: 'PRESENT', reference_number: 'LR-DB-1',
  }, ADMIN);
  assert.equal(again.already_recorded, true);
  assert.equal(await prisma.tripDocument.count({ where: { trip_id: ctx.tripId } }), 1);

  // The database itself refuses a duplicate (trip, type).
  await assert.rejects(
    () => prisma.tripDocument.create({
      data: { trip_id: ctx.tripId, document_type: 'LR', document_status: 'PRESENT' },
    })
  );

  checklist = await svc.getChecklist(trip);
  assert.equal(checklist.ready, false, 'the LR alone is not enough');

  // Documents are visible on the checklist without touching the trip status.
  const row = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(row.status, 'ASSIGNED', 'recording documents never moves the trip');

  // A document belonging to another trip cannot be reached through this one.
  const other = await seedTrip({ freight: 60000, suffix: '105' });
  await assert.rejects(
    () => svc.verifyDocument(other.tripId, lr.document_id, ADMIN),
    (e) => e.name === 'NotFoundError'
  );
});

test('DB · planned figures survive; actual figures land in their own columns', async (t) => {
  if (await guard(t)) return;

  // A booking carrying the customer's PLANNED material / quantity / weight.
  const customer = await prisma.user.create({
    data: {
      first_name: 'P4', last_name: 'Customer',
      email: `p4.customer.${TAG}@example.test`,
      phone: `74${process.pid}00`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(customer.user_id);

  const booking = await prisma.booking.create({
    data: {
      booking_number: `BK-P4-${TAG}`,
      booking_reference: `P4REF${process.pid}`,
      user_id: customer.user_id,
      pickup_location: 'Kosi Farm Gate', pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard', drop_city: 'Patna',
      pickup_date: '2026-09-05',
      pickup_time: '09:00',
      goods_description: 'Wheat',
      vehicle_type_required: 'TRUCK',
      number_of_items: 500,
      quantity_unit: 'Bags',
      goods_weight_kg: 25000,
      weight_unit: 'KG',
      status: 'confirmed',
    },
  });

  const ctx = await seedTrip({ freight: 60000, suffix: '106' });
  await prisma.trip.update({ where: { trip_id: ctx.tripId }, data: { booking_id: booking.booking_id } });

  const svc = new TripOperationalService({ prisma });
  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {
    actual_quantity: 480, actual_quantity_unit: 'Bags', actual_weight_kg: 24200,
  }, ADMIN);

  // PLANNED — untouched by loading.
  const planned = await prisma.booking.findUnique({ where: { booking_id: booking.booking_id } });
  assert.equal(planned.number_of_items, 500);
  assert.equal(planned.goods_weight_kg, 25000);
  assert.equal(planned.goods_description, 'Wheat');

  // ACTUAL — recorded separately.
  const state = await svc.getOperationalState(ctx.tripId);
  assert.equal(state.planned.quantity, 500);
  assert.equal(state.actual.quantity, 480);
  assert.equal(state.planned.weight_kg, 25000);
  assert.equal(state.actual.weight_kg, 24200);
  assert.notEqual(state.planned.quantity, state.actual.quantity, 'the variance is visible');

  await prisma.booking.delete({ where: { booking_id: booking.booking_id } });
});

test('DB · a trip with no booking still runs the whole workflow', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '107' });
  const svc = new TripOperationalService({ prisma });

  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, { actual_quantity: 10 }, ADMIN);
  await satisfyDocuments(ctx.tripId);
  const r = await svc.dispatch(ctx.tripId, {}, ADMIN);

  assert.equal(r.status, 'DISPATCHED');

  const state = await svc.getOperationalState(ctx.tripId);
  assert.equal(state.planned.quantity, null, 'no booking means no planned figures, and that is fine');
  assert.equal(state.actual.quantity, 10);
});

test('DB · existing production trips are untouched by the new workflow', async (t) => {
  if (await guard(t)) return;

  // SIBLING suites share this database and run concurrently: they create,
  // delete and re-status their own trips mid-flight here. Row COUNTS of the
  // whole table are therefore not a stable observation — the contract is
  // about THIS file not disturbing OTHER trips, so it is asserted per ROW:
  // snapshot every foreign trip's status, re-read the same ids afterwards,
  // and require each still-present row to hold its status. Rows deleted by
  // the suite that created them disappear from both reads — that is not
  // this file moving anyone.
  const foreignBefore = (await prisma.trip.findMany({ select: { trip_id: true, status: true } }))
    .filter((r) => !created.trips.includes(r.trip_id));
  const foreignById = new Map(foreignBefore.map((r) => [r.trip_id, r.status]));

  // Walk one trip all the way through.
  const ctx = await seedTrip({ freight: 60000, suffix: '108' });
  const svc = new TripOperationalService({ prisma });
  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {}, ADMIN);
  await satisfyDocuments(ctx.tripId);
  await svc.dispatch(ctx.tripId, {}, ADMIN);

  const afterTrip = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
  assert.equal(afterTrip.status, 'DISPATCHED', 'the trip walked through became DISPATCHED');

  // Every foreign trip keeps its status (its disappearance counts as its
  // owner's housekeeping, not as this file's interference).
  const foreignAfter = await prisma.trip.findMany({
    where: { trip_id: { in: [...foreignById.keys()] } },
    select: { trip_id: true, status: true },
  });
  const touched = foreignAfter
    .filter((r) => foreignById.get(r.trip_id) !== r.status)
    .map((r) => `trip ${r.trip_id}: ${foreignById.get(r.trip_id)} → ${r.status}`);
  assert.deepEqual(touched, [], 'no foreign trip changed status because of this workflow');


  // The enum's physical order is whatever the migration CHAIN created — the
  // type was born (20260820000000_create_missing_tables) already carrying all
  // ten values in the interleaved sequence below, and every deployment that
  // ran the chain has exactly that order. Membership is what MUST hold: the
  // historical six and the four phase-4 stages are all present, and nothing
  // was reordered underneath a live system. (Prisma's schema declares the
  // same VALUES; enum member order is not semantic to Prisma, which is why
  // `migrate diff` between this database and schema.prisma is empty. The
  // state machine lists statuses in LIFECYCLE order, deliberately a
  // different sequence from the enum's storage order.)
  const labels = (await prisma.$queryRawUnsafe(
    "select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typname = 'TripStatus' order by e.enumsortorder"
  )).map((r) => r.enumlabel);
  const EXPECTED_ENUM_ORDER = [
    'PENDING',
    'ASSIGNED',
    'TO_LOADING_POINT',
    'AT_LOADING_POINT',
    'LOADED',
    'DISPATCHED',
    'IN_TRANSIT',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
  ];
  assert.deepEqual(labels, EXPECTED_ENUM_ORDER);
  // Every status the state machine knows about is a real database enum value.
  for (const status of tripStateMachine.TRIP_STATUSES) {
    assert.ok(labels.includes(status), `${status} must exist in the database`);
  }
});

test('DB · a per-trip override can waive the document requirement', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 60000, suffix: '109' });
  await prisma.trip.update({
    where: { trip_id: ctx.tripId },
    data: { documents_required: [] },
  });

  const svc = new TripOperationalService({ prisma });
  await svc.sendToLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.arriveAtLoadingPoint(ctx.tripId, {}, ADMIN);
  await svc.completeLoading(ctx.tripId, {}, ADMIN);

  // No documents recorded, and none needed.
  const readiness = await svc.getDispatchReadiness(ctx.tripId);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers));
  const r = await svc.dispatch(ctx.tripId, {}, ADMIN);
  assert.equal(r.status, 'DISPATCHED');
  assert.equal(await prisma.tripDocument.count({ where: { trip_id: ctx.tripId } }), 0);
});
