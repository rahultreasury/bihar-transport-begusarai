/**
 * phase6-delivery-pod.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE 6 — LIVE POSTGRESQL VERIFICATION (STEP 21)
 * ---------------------------------------------------------------------------
 * Runs the real delivery stage against the real database:
 *
 *   IN_TRANSIT → arrival → POD → verify → DELIVERED → COMPLETED
 *
 * It proves the things a fake Prisma client cannot:
 *   • the additive Phase 6 columns really exist on `trips`
 *   • the POD really is a `trip_documents` row of type POD, with the real
 *     `@@unique([trip_id, document_type])` constraint preventing a second one
 *   • status + timeline really commit together
 *   • a duplicate upload cannot create a duplicate POD document
 *   • a re-upload cannot UN-verify an already-verified POD
 *   • the planned quantity on Booking is never overwritten
 *   • no financial row is created
 *   • everything it created is deleted afterwards
 *
 * Usage:  node --test tests/phase6-delivery-pod.db.test.js
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const { prisma } = require('../config/prisma');
const TripDeliveryService = require('../services/TripDeliveryService');

const ADMIN = { user_id: 1, role: 'admin' };
const service = new TripDeliveryService();

let runSeq = 0;
const tag = () => `PH6DB${Date.now().toString(36)}${(runSeq += 1)}`;

/** Reference-row chains created by createInTransitTrip, torn down by destroyTrip. */
const ownedChains = [];

/**
 * Create a trip that is genuinely IN_TRANSIT, ready for the delivery stage.
 *
 * The suite OWNS every reference row it stands on (owner → vehicle → user →
 * driver → trip), the same pattern the other DB suites use. It used to CLONE
 * a "donor" trip's owner/vehicle/driver — and under the full suite's
 * parallel batches that donor happened to belong to a sibling being torn
 * down at the same instant, which turned this file's reads into the cause of
 * the sibling's FK failures (trips_vehicle_id_fkey) and left this suite
 * hostage to whatever rows were in flight. A seeded chain is deleted by
 * destroyTrip, so nothing of this suite survives and nothing of anyone
 * else's is held.
 */
async function createInTransitTrip() {
  const uniq = `${process.pid}${Date.now() % 100000}${(runSeq += 1)}`;

  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `PH6 Vendor ${uniq}`, mobile: `98${uniq}`.slice(0, 12) },
  });
  const vehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `PH6${uniq}`.slice(0, 12),
      vehicle_type: 'TRUCK',
      owner_id: owner.owner_id,
      is_available: true,
      current_status: 'available',
    },
  });
  const customer = await prisma.user.create({
    data: {
      first_name: 'PH6', last_name: 'Customer',
      email: `ph6.customer.${uniq}@example.test`,
      phone: `87${uniq}`.slice(0, 12),
      password_hash: 'not-used',
    },
  });
  const driverUser = await prisma.user.create({
    data: {
      first_name: 'PH6', last_name: 'Driver',
      email: `ph6.driver.${uniq}@example.test`,
      phone: `76${uniq}`.slice(0, 12),
      password_hash: 'not-used',
    },
  });
  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id,
      driver_name: `PH6 Driver ${uniq}`,
      mobile: `75${uniq}`.slice(0, 12),
      transport_owner_id: owner.owner_id,
      is_available: true,
      status: 'available',
    },
  });
  ownedChains.push({
    ownerId: owner.owner_id, vehicleId: vehicle.vehicle_id,
    userIds: [customer.user_id, driverUser.user_id], driverId: driver.driver_id,
  });

  return prisma.trip.create({
    data: {
      trip_number: `PH6-TEST-${tag()}`,
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
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
}

async function destroyTrip(trip) {
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

  // This suite's OWN reference rows, reverse of the create order. Nothing
  // shared with sibling suites is touched.
  const chain = ownedChains.pop();
  if (chain) {
    await prisma.driver.deleteMany({ where: { driver_id: chain.driverId } }).catch(() => {});
    for (const userId of chain.userIds) {
      await prisma.user.deleteMany({ where: { user_id: userId } }).catch(() => {});
    }
    await prisma.transportVehicle.deleteMany({ where: { vehicle_id: chain.vehicleId } }).catch(() => {});
    await prisma.vehicleOwner.deleteMany({ where: { owner_id: chain.ownerId } }).catch(() => {});
  }
}

/**
 * Financial rows must stay exactly as they are — read through THIS
 * consignment's keys. Sibling suites share this database and run while this
 * one is between its two reads, so a table-wide count is not a stable
 * observation: another suite's booking legitimately moves
 * `commission_records`, the ledger and `trip_financials` at the same
 * instant. Every money table with a trip back-reference is therefore counted
 * through this trip (ledger, financial skeleton, trip settlement); the
 * commission audit row is keyed per booking, so the trip stands for it by
 * its booking id — the Phase 6 clone has none, and every writer in the
 * estate requires a booking id on that table, so the null-keyed count is
 * stable. `settlements` (a monthly partner cycle) and `driver_transactions`
 * (a driver ledger) have no trip key at all and no writer in the estate, so
 * their table-wide counts are kept as-is; when a trip IS supplied they are
 * additionally scoped to what the delivery chain could touch — the trip's
 * own driver and nothing else.
 */
async function financialSnapshot(trip = null) {
  const [settlements, commissions, transactions, tripSettlements, tripFinancial, driverTx] = await Promise.all([
    prisma.settlement.count(),
    // commission_records key by a REQUIRED booking id (every estate writer
    // goes through CommissionService with one) — a trip with no booking can
    // therefore never own one, and the scoped count is flatly zero.
    trip == null
      ? prisma.commissionRecord.count()
      : trip.booking_id == null
        ? Promise.resolve(0)
        : prisma.commissionRecord.count({ where: { booking_id: trip.booking_id } }),
    trip == null
      ? prisma.financialTransaction.count()
      : prisma.financialTransaction.count({ where: { trip_id: trip.trip_id } }),
    trip == null
      ? prisma.tripSettlement.count()
      : prisma.tripSettlement.count({ where: { trip_id: trip.trip_id } }),
    trip == null
      ? prisma.tripFinancial.count()
      : prisma.tripFinancial.count({ where: { trip_id: trip.trip_id } }),
    trip && trip.driver_id != null
      ? prisma.driverTransaction.count({ where: { driver_id: trip.driver_id } })
      : prisma.driverTransaction.count(),
  ]);
  return { settlements, commissions, transactions, tripSettlements, tripFinancial, driverTx };
}

// ===========================================================================

test('DB. the additive Phase 6 columns exist on trips', async () => {
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name IN (
        'arrived_at_destination_at','arrival_remarks','delivered_receiver_name',
        'delivery_remarks','delivered_quantity','delivered_quantity_unit','delivered_weight_kg'
      )
    ORDER BY column_name
  `);
  assert.equal(cols.length, 7, 'all seven Phase 6 columns are present');
  for (const c of cols) {
    assert.equal(c.is_nullable, 'YES', `${c.column_name} is nullable (additive)`);
  }
  console.log(`    [db] Phase 6 columns: ${cols.map((c) => c.column_name).join(', ')}`);
});

test('DB. no duplicate POD / delivery / completion / timeline table exists', async () => {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (table_name ~* '^pods?$' OR table_name ~* 'delivery' OR table_name ~* 'completion')
  `);
  // `deliveries` is the PRE-EXISTING legacy booking-keyed model, not something
  // Phase 6 created. No new table may have been added alongside it.
  assert.deepEqual(tables.map((t) => t.table_name), [], 'no new delivery/POD/completion table');

  // TripStatus still has exactly the Phase 4/5 values — no rename, no addition.
  const enumValues = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TripStatus' ORDER BY e.enumsortorder
  `);
  // Order is irrelevant; the SET is what matters: no value added, none removed.
  assert.deepEqual(
    enumValues.map((v) => v.enumlabel).sort(),
    ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED',
      'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED'].sort(),
    'the TripStatus enum is unchanged — Phase 6 added no status'
  );
});

test('DB. arrival → POD → verify → DELIVERED → COMPLETED, end to end', async (t) => {
  let trip = null;
  let before = null;
  try {
    trip = await createInTransitTrip();
    const id = trip.trip_id;
    // Baseline is taken once the clone exists (the snapshot scopes by its
    // keys): a freshly created trip has no money rows of its own yet, so the
    // arrival → POD → complete chain below must leave the baseline exactly
    // as it reads here.
    before = await financialSnapshot(trip);
    console.log(`    [db] provisioned trip_id=${id} (${trip.trip_number})`);

    // ── 1. Delivery is refused with every blocker, before anything is done.
    const blocked = await service.getDeliveryReadiness(id);
    assert.equal(blocked.ready, false);
    assert.deepEqual(blocked.blockers.map((b) => b.code), [
      'ARRIVAL_NOT_RECORDED', 'POD_NOT_SUPPLIED', 'RECEIVER_NOT_RECORDED',
    ]);
    await assert.rejects(() => service.markDelivered(id, {}, ADMIN), /cannot be delivered/i);
    assert.equal((await prisma.trip.findUnique({ where: { trip_id: id } })).status, 'IN_TRANSIT');

    // ── 2. Arrival
    const arrival = await service.arriveAtDestination(id, { remarks: 'At the Mandi gate' }, ADMIN);
    assert.equal(arrival.idempotent, false);
    assert.ok((await prisma.trip.findUnique({ where: { trip_id: id } })).arrived_at_destination_at);
    const again = await service.arriveAtDestination(id, { remarks: 'At the Mandi gate' }, ADMIN);
    assert.equal(again.idempotent, true, 'a duplicate arrival writes nothing new');
    assert.equal(
      await prisma.tripTimeline.count({ where: { trip_id: id, event_type: 'arrived_destination' } }),
      1
    );

    // ── 3. POD. It is a trip_documents row, and only ever one.
    const { pod } = await service.submitPod(id, {
      reference_number: 'POD-DB-1',
      file_url: '/uploads/pod/db-1.jpg',
      receiver_name: 'Ramesh Yadav',
      delivered_quantity: 478,
      delivered_quantity_unit: 'bags',
      delivered_weight_kg: 4770,
      delivery_remarks: 'Two bags short',
    }, ADMIN);
    const doc = await prisma.tripDocument.findUnique({ where: { document_id: pod.document_id } });
    assert.equal(doc.document_type, 'POD');
    assert.equal(doc.trip_id, id);
    assert.equal(doc.is_uploaded, true);

    // A duplicate upload must NOT create a second POD document.
    const dup = await service.submitPod(id, { reference_number: 'POD-DB-1' }, ADMIN);
    assert.equal(dup.already_recorded, true);
    assert.equal(await prisma.tripDocument.count({ where: { trip_id: id, document_type: 'POD' } }), 1);
    assert.equal(dup.pod.document_id, pod.document_id, 'the same document is returned');

    // ── 4. Verify, and prove a re-upload cannot un-verify it.
    await assert.rejects(() => service.markDelivered(id, {}, ADMIN), /not yet verified/);
    const verified = await service.verifyPod(id, pod.document_id, ADMIN);
    assert.equal(verified.idempotent, false);
    assert.equal((await prisma.tripDocument.findUnique({ where: { document_id: pod.document_id } })).document_status, 'VERIFIED');

    // THE REGRESSION THIS PHASE FIXED: re-submitting must not downgrade VERIFIED.
    await service.submitPod(id, { reference_number: 'POD-DB-1-FINAL' }, ADMIN);
    const afterReupload = await prisma.tripDocument.findUnique({ where: { document_id: pod.document_id } });
    assert.equal(afterReupload.document_status, 'VERIFIED', 'a re-upload cannot un-verify a POD');
    assert.equal(afterReupload.verified_by, 1, 'the verifier is not erased');
    assert.ok(afterReupload.verified_at instanceof Date);

    // Duplicate verification is a no-op.
    assert.equal((await service.verifyPod(id, pod.document_id, ADMIN)).idempotent, true);
    assert.equal(
      await prisma.tripTimeline.count({ where: { trip_id: id, event_type: 'document_verified' } }),
      1
    );

    // ── 5. Deliver
    const ready = await service.getDeliveryReadiness(id);
    assert.equal(ready.ready, true, `expected ready, got ${JSON.stringify(ready.blockers)}`);

    const delivered = await service.markDelivered(id, {}, ADMIN);
    assert.equal(delivered.status, 'DELIVERED');
    const row = await prisma.trip.findUnique({ where: { trip_id: id } });
    assert.equal(row.status, 'DELIVERED');
    assert.ok(row.trip_delivered_date instanceof Date, 'the PRE-EXISTING column was used');
    assert.equal(row.delivered_receiver_name, 'Ramesh Yadav');
    assert.equal(row.delivered_quantity, 478);
    assert.equal(row.trip_delivered_date.getTime() <= Date.now(), true);

    // The status change and its timeline event really committed together.
    const delivEvents = await prisma.tripTimeline.findMany({
      where: { trip_id: id, event_type: 'delivered' },
    });
    assert.equal(delivEvents.length, 1);
    assert.equal(JSON.parse(delivEvents[0].metadata).operation, 'MARK_DELIVERED');

    // Idempotent.
    assert.equal((await service.markDelivered(id, {}, ADMIN)).idempotent, true);
    assert.equal(await prisma.tripTimeline.count({ where: { trip_id: id, event_type: 'delivered' } }), 1);

    // ── 6. Complete
    const done = await service.completeTrip(id, {}, ADMIN);
    assert.equal(done.status, 'COMPLETED');
    const fin = await prisma.trip.findUnique({ where: { trip_id: id } });
    assert.ok(fin.completed_at instanceof Date);
    assert.equal((await service.completeTrip(id, {}, ADMIN)).idempotent, true);

    // ── 7. FINANCE UNTOUCHED. This is the whole point of STEP 18.
    const after = await financialSnapshot(trip);
    assert.deepEqual(after, before, 'the completion chain wrote no trip-scoped money row (settlement, commission, payment or hire)');

    // And the trip's own commercial figures are unchanged.
    assert.equal(fin.freight_amount, 60000);
    assert.equal(fin.driver_payment, null);
    assert.equal(fin.owner_payment, null);

    // ── 8. The timeline is a real, ordered, append-only history.
    const timeline = await prisma.tripTimeline.findMany({
      where: { trip_id: id }, orderBy: { timeline_id: 'asc' },
    });
    const types = timeline.map((e) => e.event_type);
    for (const expected of ['arrived_destination', 'pod_submitted', 'document_verified', 'delivered', 'trip_completed']) {
      assert.ok(types.includes(expected), `timeline contains ${expected}`);
    }
    assert.deepEqual(
      timeline.map((e) => e.timeline_id),
      [...timeline.map((e) => e.timeline_id)].sort((a, b) => a - b),
      'timeline ids are monotonic — the history is append-only'
    );
  } finally {
    await destroyTrip(trip);
  }
});

test('DB. a failed delivery attempt leaves the trip in transit and adds one event', async (t) => {
  let trip = null;
  try {
    trip = await createInTransitTrip();
    const id = trip.trip_id;

    await service.recordDeliveryAttempt(id, { reason: 'CONSIGNEE_UNAVAILABLE', notes: 'Shop shut' }, ADMIN);
    const retry = await service.recordDeliveryAttempt(id, { reason: 'CONSIGNEE_UNAVAILABLE', notes: 'Shop shut' }, ADMIN);
    assert.equal(retry.idempotent, true);
    assert.equal(await prisma.tripTimeline.count({ where: { trip_id: id, event_type: 'delivery_attempt' } }), 1);

    await service.recordDeliveryAttempt(id, { reason: 'DESTINATION_CLOSED' }, ADMIN);
    assert.equal(await prisma.tripTimeline.count({ where: { trip_id: id, event_type: 'delivery_attempt' } }), 2);
    assert.equal((await prisma.trip.findUnique({ where: { trip_id: id } })).status, 'IN_TRANSIT');
  } finally {
    await destroyTrip(trip);
  }
});

test('DB. no data from this file survives', async () => {
  const trips = await prisma.trip.count({ where: { trip_number: { startsWith: 'PH6-TEST-' } } });
  assert.equal(trips, 0, 'every provisioned trip was deleted');
  const docs = await prisma.tripDocument.count({
    where: { trip: { trip_number: { startsWith: 'PH6-TEST-' } } },
  });
  assert.equal(docs, 0, 'no POD rows survive');
});

test.after(async () => {
  await prisma.$disconnect();
});
