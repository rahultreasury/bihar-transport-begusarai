/**
 * phase6DeliveryPod.test.js
 * ---------------------------------------------------------------------------
 * PHASE 6 — DELIVERY, POD & COMPLETION (unit / contract level)
 * ---------------------------------------------------------------------------
 *
 *   ARRIVAL       1. IN_TRANSIT → arrival
 *                 2. invalid arrival rejected
 *                 3. arrival timeline recorded
 *                 4. duplicate arrival safe
 *
 *   POD           5. POD upload
 *                 6. POD linked to correct Trip
 *                 7. unauthorized POD upload rejected
 *                 8. POD verification
 *                 9. duplicate verification safe
 *                10. customer POD access per business rules
 *
 *   DELIVERY     11. valid delivery
 *                12. delivery without required POD rejected
 *                13. delivery before arrival rejected
 *                14. delivery from invalid status rejected
 *                15. delivery timeline recorded
 *                16. duplicate delivery safe
 *
 *   COMPLETION   17. valid completion
 *                18. completion from invalid state rejected
 *                19. completion prerequisites enforced
 *                20. duplicate completion safe
 *
 *   SECURITY     21. customer    22. driver    23. partner    24. admin
 *                25. unauthorized user
 *
 *   FINANCIAL    27. delivery does not modify gross hire
 *                28. delivery does not modify commission
 *                29. delivery does not create a duplicate vendor payment
 *                30. completion does not create a fake settlement
 *
 *   INTEGRITY    31. original booking quantity preserved
 *                32. original enquiry information preserved
 *                33. actual delivery values stored separately
 *
 *   DUPLICATES   no POD2 / Delivery2 / TripCompletion2 / DeliveryTimeline2
 *
 * Uses node:test + node:assert. No extra dependencies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TripDeliveryService = require('../services/TripDeliveryService');
const tripStateMachine = require('../utils/TripStateMachine');
const deliveryPolicy = require('../config/tripDeliveryPolicy');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/AppError');

const ADMIN = { user_id: 1, role: 'admin' };
const DRIVER_A = { kind: 'driver', driverId: 200 };
const DRIVER_B = { kind: 'driver', driverId: 999 };
const CUSTOMER = { kind: 'customer', userId: 300 };
const PARTNER = { kind: 'partner', partnerId: 700 };
const STRANGER = { kind: 'customer', userId: 400 };

// ===========================================================================
// In-memory Prisma stand-in
// ===========================================================================

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('gte' in cond) return new Date(value) >= new Date(cond.gte);
      if ('lte' in cond) return new Date(value) <= new Date(cond.lte);
      if ('notIn' in cond) return !cond.notIn.includes(value);
      if ('not' in cond) return value !== cond.not;
    }
    if (cond === null) return value === null;
    return value === cond;
  });
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.status] starting trip status
 */
function buildDb({ status = 'IN_TRANSIT' } = {}) {
  const state = {
    trips: [{
      trip_id: 1,
      trip_number: 'BTBT-2026-00001',
      booking_id: 900,
      user_id: 300,
      transport_owner_id: 10,
      vehicle_id: 100,
      driver_id: 200,
      pickup_city: 'Begusarai',
      pickup_location: 'Kosi Farm Gate',
      drop_city: 'Patna',
      drop_location: 'Mandi Yard',
      // Financial columns — Phase 6 must not touch any of them.
      freight_amount: 60000,
      driver_payment: 45000,
      owner_payment: 50000,
      // Planned quantity lives on the BOOKING, not here.
      actual_quantity: 480,
      actual_quantity_unit: 'bags',
      actual_weight_kg: 4800,
      // Phase 6 columns.
      arrived_at_destination_at: null,
      arrival_remarks: null,
      delivered_receiver_name: null,
      delivery_remarks: null,
      delivered_quantity: null,
      delivered_quantity_unit: null,
      delivered_weight_kg: null,
      trip_delivered_date: null,
      completed_at: null,
      status,
    }],
    drivers: [{
      driver_id: 200,
      driver_name: 'Kaushal',
      mobile: '9876543210',
      is_available: true,
      status: 'available',
      transport_owner_id: 10,
      user_id: 20,
    }],
    vehicles: [{
      vehicle_id: 100,
      vehicle_number: 'BR09CC0004',
      vehicle_type: 'TRUCK',
      vehicle_name: 'Tata 407',
      body_type: 'Open Body',
      capacity_kg: 5000,
      owner_id: 10,
      is_available: true,
      current_status: 'available',
    }],
    tripTimeline: [],
    tripDocuments: [],
    auditLogs: [],
    bookings: [{
      booking_id: 900,
      partner_id: 700,
      // PLANNED values. Must survive the whole flow untouched.
      quantity: 500,
      quantity_unit: 'bags',
      goods_weight_kg: 5000,
    }],
    enquiries: [{ enquiry_id: 5000, material: 'Maize', quantity: 500 }],
    // Financial tables Phase 6 must never write to.
    settlements: [],
    commissionRecords: [],
    financialTransactions: [],
  };

  let seq = 0;
  const client = {};

  client.trip = {
    rows: state.trips,
    async findUnique({ where, include } = {}) {
      const row = state.trips.find((t) => matches(t, where));
      if (!row) return null;
      const out = { ...row };
      if (include && include.booking) {
        out.booking = state.bookings.find((b) => b.booking_id === row.booking_id) || null;
      }
      return out;
    },
    async findFirst({ where } = {}) {
      return state.trips.find((t) => matches(t, where)) || null;
    },
    async update({ where, data }) {
      const row = state.trips.find((t) => matches(t, where));
      if (!row) throw new NotFoundError({ message: 'Trip not found' });
      Object.assign(row, data);
      return { ...row };
    },
  };

  client.tripTimeline = {
    rows: state.tripTimeline,
    async create({ data }) {
      seq += 1;
      const row = { timeline_id: seq, created_at: new Date(), ...data };
      state.tripTimeline.push(row);
      return { ...row };
    },
    async findMany({ where, orderBy, select } = {}) {
      let rows = state.tripTimeline.filter((t) => matches(t, where));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0];
        rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      }
      if (select) rows = rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
      return rows.map((r) => ({ ...r }));
    },
    async findFirst({ where, orderBy } = {}) {
      let rows = state.tripTimeline.filter((t) => matches(t, where));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0];
        rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      }
      return rows[0] ? { ...rows[0] } : null;
    },
  };

  client.tripDocument = {
    rows: state.tripDocuments,
    async findUnique({ where } = {}) {
      // The real schema names the compound unique `uq_trip_documents_trip_type`,
      // so Prisma keys a lookup by that name rather than by two top-level
      // fields. The double understands both forms.
      if (where.uq_trip_documents_trip_type) {
        const row = state.tripDocuments.find((d) => matches(d, where.uq_trip_documents_trip_type));
        return row ? { ...row } : null;
      }
      if (where.trip_id_document_type) {
        const row = state.tripDocuments.find((d) => matches(d, where.trip_id_document_type));
        return row ? { ...row } : null;
      }
      const row = state.tripDocuments.find((d) => matches(d, where));
      return row ? { ...row } : null;
    },
    async findFirst({ where } = {}) {
      const row = state.tripDocuments.find((d) => matches(d, where));
      return row ? { ...row } : null;
    },
    async findMany({ where } = {}) {
      return state.tripDocuments.filter((d) => matches(d, where)).map((d) => ({ ...d }));
    },
    async create({ data }) {
      // Mirror the real TripDocumentService.recordDocument behavior: check for
      // existing document with same (trip_id, document_type) and update instead
      // of throwing. This matches the real service's upsert logic.
      const existing = state.tripDocuments.find(
        (d) => d.trip_id === data.trip_id && d.document_type === data.document_type
      );
      if (existing) {
        // Update existing document (simplified - real service has more logic)
        Object.assign(existing, data, { updated_at: new Date() });
        return { ...existing };
      }
      const row = { document_id: state.tripDocuments.length + 1, ...data, created_at: new Date(), updated_at: new Date() };
      state.tripDocuments.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = state.tripDocuments.find((d) => matches(d, where));
      if (!row) throw new NotFoundError({ message: 'Document not found' });
      Object.assign(row, data, { updated_at: new Date() });
      return { ...row };
    },
    async delete({ where }) {
      const i = state.tripDocuments.findIndex((d) => matches(d, where));
      if (i < 0) throw new NotFoundError({ message: 'Document not found' });
      return state.tripDocuments.splice(i, 1)[0];
    },
  };

  client.auditLog = {
    rows: state.auditLogs,
    async create({ data }) {
      const row = { audit_id: state.auditLogs.length + 1, ...data };
      state.auditLogs.push(row);
      return row;
    },
  };

  client.driver = {
    rows: state.drivers,
    async findUnique({ where } = {}) {
      const row = state.drivers.find((d) => matches(d, where));
      return row ? { ...row } : null;
    },
    async update({ where, data }) {
      const row = state.drivers.find((d) => matches(d, where));
      if (!row) throw new NotFoundError({ message: 'Driver not found' });
      Object.assign(row, data);
      return { ...row };
    },
  };

  client.transportVehicle = {
    rows: state.vehicles,
    async findUnique({ where } = {}) {
      const row = state.vehicles.find((v) => matches(v, where));
      return row ? { ...row } : null;
    },
    async update({ where, data }) {
      const row = state.vehicles.find((v) => matches(v, where));
      if (!row) throw new NotFoundError({ message: 'Vehicle not found' });
      Object.assign(row, data);
      return { ...row };
    },
  };

  // Financial tables are read-only tripwires: if Phase 6 ever writes one of
  // these, the call throws and the test fails loudly.
  const financialTripwire = (name) => new Proxy({}, {
    get: () => async () => { throw new Error(`Phase 6 must not write to ${name}`); },
  });
  client.settlement = financialTripwire('settlements');
  client.commissionRecord = financialTripwire('commissionRecords');
  client.financialTransaction = financialTripwire('financialTransactions');
  client.tripSettlement = financialTripwire('tripSettlements');
  client.tripFinancial = financialTripwire('tripFinancial');
  client.vehicleHire = financialTripwire('vehicleHire');

  client.$transaction = async (cb) => cb(client);
  client.__state = state;
  return client;
}

function svc(db) { return new TripDeliveryService({ prisma: db }); }

const countEvents = (db, type) => db.__state.tripTimeline.filter((e) => e.event_type === type).length;

/** Drive a trip to the point where it is ready to be delivered. */
async function makeDeliverable(db) {
  const s = svc(db);
  await s.arriveAtDestination(1, { remarks: 'At the gate' }, ADMIN);
  const { pod } = await s.submitPod(1, { reference_number: 'POD-1' }, ADMIN);
  await s.verifyPod(1, pod.document_id, ADMIN);
  await s.submitPod(1, { receiver_name: 'Ramesh Yadav' }, ADMIN);
  return s;
}

// ===========================================================================
// 1–4. ARRIVAL
// ===========================================================================

test('1. IN_TRANSIT → arrival records the fact without changing status', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const result = await svc(db).arriveAtDestination(1, { remarks: 'At the Mandi gate' }, ADMIN);

  assert.equal(result.idempotent, false);
  assert.ok(db.__state.trips[0].arrived_at_destination_at instanceof Date);
  assert.equal(db.__state.trips[0].arrival_remarks, 'At the Mandi gate');
  assert.equal(
    db.__state.trips[0].status, 'IN_TRANSIT',
    'arriving is not delivering — the status must not move'
  );
});

test('2. an invalid arrival is rejected', async () => {
  for (const status of ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED']) {
    const db = buildDb({ status });
    await assert.rejects(
      () => svc(db).arriveAtDestination(1, {}, ADMIN),
      ValidationError,
      `${status} must not be able to arrive at destination`
    );
    assert.equal(db.__state.trips[0].arrived_at_destination_at, null);
  }
  // Nor after the goods are already gone.
  for (const status of ['DELIVERED', 'COMPLETED']) {
    const db = buildDb({ status });
    await assert.rejects(() => svc(db).arriveAtDestination(1, {}, ADMIN), ValidationError);
  }
  // A missing trip is a 404-shaped error, not a crash.
  await assert.rejects(() => svc(buildDb()).arriveAtDestination(999, {}, ADMIN), NotFoundError);
});

test('3. arrival is recorded on the append-only timeline with an audit entry', async () => {
  const db = buildDb();
  await svc(db).arriveAtDestination(1, { remarks: 'Reached Son Bridge' }, ADMIN);

  assert.equal(countEvents(db, 'arrived_destination'), 1);
  const [event] = db.__state.tripTimeline;
  assert.equal(event.reference_type, 'trip');
  assert.equal(event.reference_id, 1);
  assert.equal(event.created_by, 1);
  assert.match(event.description, /Reached Son Bridge/);

  const audits = db.__state.auditLogs.filter((a) => a.action === 'trip_arrived_destination');
  assert.equal(audits.length, 1, 'the audit entry committed with the timeline event');
});

test('4. a duplicate arrival is a no-op; a genuinely new arrival is appended', async () => {
  const db = buildDb();
  const s = svc(db);

  const first = await s.arriveAtDestination(1, { remarks: 'At the gate' }, ADMIN);
  const second = await s.arriveAtDestination(1, { remarks: 'At the gate' }, ADMIN);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(countEvents(db, 'arrived_destination'), 1, 'a double click writes no second event');

  // Different remarks is a new fact: appended, never overwriting history.
  await s.arriveAtDestination(1, { remarks: 'Moved to bay 4' }, ADMIN);
  assert.equal(countEvents(db, 'arrived_destination'), 2);
  assert.equal(db.__state.tripTimeline[0].description.includes('At the gate'), true);
});

// ===========================================================================
// 5–10. POD
// ===========================================================================

test('5–6. a POD is the EXISTING trip_documents row, linked to the right Trip', async () => {
  const db = buildDb();
  const result = await svc(db).submitPod(1, {
    reference_number: 'POD-7788',
    file_url: '/uploads/pod/7788.jpg',
    receiver_name: 'Ramesh Yadav',
    delivered_quantity: 478,
    delivered_quantity_unit: 'bags',
    delivered_weight_kg: 4770,
    delivery_remarks: 'Two bags short, consignee informed',
  }, ADMIN);

  // It is a TripDocument, not a new model.
  assert.equal(db.__state.tripDocuments.length, 1);
  const doc = db.__state.tripDocuments[0];
  assert.equal(doc.document_type, 'POD');
  assert.equal(doc.trip_id, 1, 'the POD belongs to THIS trip');
  assert.equal(doc.document_status, 'PRESENT');
  assert.equal(result.pod.document_id, doc.document_id);

  // Arrival is implied by the POD when nobody recorded it separately.
  assert.ok(db.__state.trips[0].arrived_at_destination_at instanceof Date);
  assert.equal(countEvents(db, 'pod_submitted'), 1);

  // A second trip's POD never lands on this one.
  const other = buildDb();
  other.__state.trips.push({ ...other.__state.trips[0], trip_id: 2, trip_number: 'BTBT-2026-00002' });
  await svc(other).submitPod(2, { reference_number: 'POD-OTHER' }, ADMIN);
  assert.equal(other.__state.tripDocuments[0].trip_id, 2);
  assert.equal(other.__state.tripDocuments.length, 1);
});

test('7. an unauthorized POD upload is rejected (the routes are admin-only)', async () => {
  const router = require('../routes/tripRoutes');
  const writes = router.stack
    .filter((l) => l.route && l.route.path.startsWith('/:id/')
      && Object.keys(l.route.methods).some((m) => m.toUpperCase() === 'POST'))
    .filter((l) => /arrival|delivery-attempt|pod|delivered|complete/.test(l.route.path));

  assert.ok(writes.length >= 6, 'the Phase 6 write routes exist');
  for (const l of writes) {
    const names = l.route.stack.map((s) => s.name);
    assert.ok(names.includes('protect'), `${l.route.path} must require authentication`);
    assert.ok(names.includes('adminOnly'), `${l.route.path} must be admin-only`);
  }

  // And the service refuses a trip that does not exist for anyone.
  await assert.rejects(() => svc(buildDb()).submitPod(4242, {}, ADMIN), NotFoundError);
  // A POD cannot be attached before the goods even left.
  await assert.rejects(
    () => svc(buildDb({ status: 'PENDING' })).submitPod(1, {}, ADMIN),
    ValidationError
  );
});

test('8. POD verification reuses the Phase 4 document verification', async () => {
  const db = buildDb();
  const s = svc(db);
  const { pod } = await s.submitPod(1, { reference_number: 'POD-1' }, ADMIN);

  const verified = await s.verifyPod(1, pod.document_id, ADMIN);
  assert.equal(verified.idempotent, false);
  assert.equal(db.__state.tripDocuments[0].document_status, 'VERIFIED');
  assert.equal(db.__state.tripDocuments[0].is_verified, true);
  assert.equal(db.__state.tripDocuments[0].verified_by, 1);

  // Same timeline event the Phase 4 service writes for every other document.
  assert.equal(countEvents(db, 'document_verified'), 1);

  // A document id belonging to another trip cannot be verified here.
  await assert.rejects(() => s.verifyPod(1, 99999, ADMIN), NotFoundError);
});

test('9. duplicate verification is safe — no duplicate timeline events', async () => {
  const db = buildDb();
  const s = svc(db);
  const { pod } = await s.submitPod(1, {}, ADMIN);

  await s.verifyPod(1, pod.document_id, ADMIN);
  const again = await s.verifyPod(1, pod.document_id, ADMIN);
  const third = await s.verifyPod(1, pod.document_id, ADMIN);

  assert.equal(again.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(countEvents(db, 'document_verified'), 1, 'a double click cannot manufacture history');
  assert.equal(db.__state.tripDocuments.length, 1, 'still exactly one POD document');
});

test('10. a customer sees POD PRESENCE and verification, never the file', async () => {
  const db = buildDb();
  const s = svc(db);
  const { pod } = await s.submitPod(1, {
    file_url: '/secret/pod-scan.jpg',
    receiver_name: 'Ramesh Yadav',
    delivered_quantity: 478,
    delivered_weight_kg: 4770,
  }, ADMIN);
  await s.verifyPod(1, pod.document_id, ADMIN);

  const view = await s.getDelivery(1, CUSTOMER);
  assert.equal(view.pod.is_supplied, true);
  assert.equal(view.pod.is_verified, true);
  assert.equal(view.pod.has_file, true, 'the customer is told a file exists');
  assert.equal(view.receiver, 'Ramesh Yadav');
  assert.equal(view.received.quantity, 478);

  // The URL ITSELF is never in the payload — it is served by the separate,
  // admin-gated document endpoint.
  const serialised = JSON.stringify(view);
  assert.ok(!serialised.includes('/secret/pod-scan.jpg'), 'the POD file path never leaks');
  assert.ok(!('file_url' in view.pod), 'no file_url key at all');
  assert.ok(!('verified_by' in view.pod), 'internal staff identifiers stay internal');
});

// ===========================================================================
// 11–16. DELIVERY
// ===========================================================================

test('11. a valid delivery moves IN_TRANSIT → DELIVERED', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);

  const result = await s.markDelivered(1, {}, ADMIN);
  assert.equal(result.status, 'DELIVERED');
  assert.equal(result.idempotent, false);
  assert.equal(db.__state.trips[0].status, 'DELIVERED');
  assert.ok(db.__state.trips[0].trip_delivered_date instanceof Date);
});

test('12. delivery without the required POD is rejected', async () => {
  const db = buildDb();
  const s = svc(db);

  // Nothing at all recorded yet — every blocker reported together.
  await assert.rejects(() => s.markDelivered(1, {}, ADMIN), (e) => {
    assert.ok(e instanceof ValidationError);
    const codes = e.details.map((b) => b.code);
    assert.deepEqual(codes, [
      'ARRIVAL_NOT_RECORDED', 'POD_NOT_SUPPLIED', 'RECEIVER_NOT_RECORDED',
    ], 'all applicable blockers are returned at once');
    return true;
  });
  assert.equal(db.__state.trips[0].status, 'IN_TRANSIT', 'a refused delivery changes nothing');

  // Arrival + receiver, but still no POD.
  await s.arriveAtDestination(1, {}, ADMIN);
  await s.submitPod(1, { receiver_name: 'Ramesh' }, ADMIN);
  // A POD now exists but is only PRESENT, not VERIFIED.
  await assert.rejects(() => s.markDelivered(1, {}, ADMIN), (e) => {
    assert.deepEqual(e.details.map((b) => b.code), ['POD_NOT_VERIFIED']);
    return true;
  });
});

test('13. delivery before arrival is rejected', async () => {
  const db = buildDb();
  const s = svc(db);
  const { pod } = await s.submitPod(1, { receiver_name: 'Ramesh' }, ADMIN);
  await s.verifyPod(1, pod.document_id, ADMIN);

  const readiness = await s.getDeliveryReadiness(1);
  assert.equal(readiness.ready, true, 'POD alone implies arrival');

  // Clear the implied arrival to prove the rule is real.
  db.__state.trips[0].arrived_at_destination_at = null;
  const blocked = await s.getDeliveryReadiness(1);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers.map((b) => b.code), ['ARRIVAL_NOT_RECORDED']);
  await assert.rejects(() => s.markDelivered(1, {}, ADMIN), ValidationError);
});

test('14. delivery from an invalid status is rejected', async () => {
  for (const status of ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'CANCELLED']) {
    const db = buildDb({ status });
    await assert.rejects(
      () => svc(db).markDelivered(1, {}, ADMIN),
      ValidationError,
      `${status} must not be deliverable`
    );
    assert.equal(db.__state.trips[0].status, status);
  }
});

test('15. delivery is recorded on the timeline and audited in one transaction', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);
  await s.markDelivered(1, {}, ADMIN);

  assert.equal(countEvents(db, 'delivered'), 1);
  const [event] = db.__state.tripTimeline.filter((e) => e.event_type === 'delivered');
  const meta = JSON.parse(event.metadata);
  assert.equal(meta.from, 'IN_TRANSIT');
  assert.equal(meta.to, 'DELIVERED');
  assert.equal(meta.operation, 'MARK_DELIVERED');
  assert.equal(meta.receiver, 'Ramesh Yadav');

  const audits = db.__state.auditLogs.filter((a) => a.action === 'trip_operational_transition');
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].new_value).status, 'DELIVERED');
});

test('16. a duplicate delivery is a no-op', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);

  const first = await s.markDelivered(1, {}, ADMIN);
  const second = await s.markDelivered(1, {}, ADMIN);
  const third = await s.markDelivered(1, {}, ADMIN);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(countEvents(db, 'delivered'), 1);
});

test('16b. a failed delivery attempt is recorded without moving the trip', async () => {
  const db = buildDb();
  const s = svc(db);

  const attempt = await s.recordDeliveryAttempt(1, {
    reason: 'CONSIGNEE_UNAVAILABLE', notes: 'Shop was shut',
  }, ADMIN);
  assert.equal(attempt.idempotent, false);
  assert.equal(attempt.event.event_type, 'delivery_attempt');
  assert.equal(db.__state.trips[0].status, 'IN_TRANSIT', 'a failed attempt does not change status');
  assert.equal(countEvents(db, 'delivery_attempt'), 1);

  // Identical retry is a no-op; a different attempt is real history.
  const retry = await s.recordDeliveryAttempt(1, { reason: 'CONSIGNEE_UNAVAILABLE', notes: 'Shop was shut' }, ADMIN);
  assert.equal(retry.idempotent, true);
  await s.recordDeliveryAttempt(1, { reason: 'DESTINATION_CLOSED', notes: 'Mandi closed for the day' }, ADMIN);
  assert.equal(countEvents(db, 'delivery_attempt'), 2);

  // Only the specification's own reasons exist.
  for (const invented of ['WEATHER', 'ROAD_BLOCKED', 'LATE', 'TYPO']) {
    await assert.rejects(
      () => s.recordDeliveryAttempt(1, { reason: invented }, ADMIN),
      ValidationError,
      `${invented} must not be invented`
    );
  }
  // And an attempt only makes sense while the goods are in transit.
  await assert.rejects(
    () => svc(buildDb({ status: 'DELIVERED' })).recordDeliveryAttempt(1, { reason: 'OTHER' }, ADMIN),
    ValidationError
  );
});

// ===========================================================================
// 17–20. COMPLETION
// ===========================================================================

test('17. a valid completion moves DELIVERED → COMPLETED', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);
  await s.markDelivered(1, {}, ADMIN);

  const result = await s.completeTrip(1, {}, ADMIN);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(db.__state.trips[0].status, 'COMPLETED');
  assert.ok(db.__state.trips[0].completed_at instanceof Date);
});

test('18. completion from an invalid state is rejected', async () => {
  for (const status of ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT']) {
    const db = buildDb({ status });
    await assert.rejects(
      () => svc(db).completeTrip(1, {}, ADMIN),
      ValidationError,
      `${status} must not be completable`
    );
    assert.equal(db.__state.trips[0].status, status);
    assert.equal(db.__state.trips[0].completed_at, null);
  }
});

test('19. completion prerequisites are enforced and reported', async () => {
  const db = buildDb();
  const readiness = await svc(db).getCompletionReadiness(1);
  assert.equal(readiness.ready, false);
  // A fresh trip has neither delivery nor verified POD
  assert.deepEqual(readiness.blockers.map((b) => b.code).sort(), ['NOT_DELIVERED', 'POD_NOT_VERIFIED'].sort());
});

test('20. duplicate completion is safe', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);
  await s.markDelivered(1, {}, ADMIN);

  const first = await s.completeTrip(1, {}, ADMIN);
  const second = await s.completeTrip(1, {}, ADMIN);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(countEvents(db, 'trip_completed'), 1);
});

// ===========================================================================
// 21–25. SECURITY
// ===========================================================================

test('21. CUSTOMER — may read their own delivery, not another\'s, and never a write', async () => {
  const db = buildDb();
  await makeDeliverable(db);
  await svc(db).markDelivered(1, {}, ADMIN);

  const mine = await svc(db).getDelivery(1, CUSTOMER);
  assert.equal(mine.status, 'DELIVERED');
  assert.ok(mine.trip_delivered_date !== undefined || mine.delivered_at instanceof Date);
  assert.ok(Array.isArray(mine.timeline));

  // Someone else's trip.
  await assert.rejects(
    () => svc(db).getDelivery(1, STRANGER),
    (e) => e instanceof ForbiddenError && /not yours/.test(e.message)
  );
});

test('22. DRIVER — the assigned driver may read; another driver may not', async () => {
  const db = buildDb();
  const mine = await svc(db).getDelivery(1, DRIVER_A);
  assert.equal(mine.trip_id, 1);
  await assert.rejects(
    () => svc(db).getDelivery(1, DRIVER_B),
    (e) => e instanceof ForbiddenError && /not assigned to you/.test(e.message)
  );
});

test('23. PARTNER — only a linked partner may read', async () => {
  const db = buildDb();
  const linked = await svc(db).getDelivery(1, PARTNER);
  assert.equal(linked.trip_id, 1);

  await assert.rejects(
    () => svc(db).getDelivery(1, { kind: 'partner', partnerId: 12345 }),
    (e) => e instanceof ForbiddenError && /not in your network/.test(e.message)
  );
});

test('24. ADMIN — may read anything', async () => {
  const db = buildDb();
  const view = await svc(db).getDelivery(1, { kind: 'admin', role: 'admin' });
  assert.equal(view.trip_id, 1);
  for (const role of ['super_admin', 'operator']) {
    assert.equal((await svc(db).getDelivery(1, { kind: 'admin', role })).trip_id, 1);
  }
});

test('25. UNAUTHORIZED — anonymous and unknown principals are refused', async () => {
  const db = buildDb();
  await assert.rejects(() => svc(db).getDelivery(1, null), NotFoundError);
  await assert.rejects(() => svc(db).getDelivery(1, { kind: 'guest' }), ForbiddenError);
  await assert.rejects(() => svc(db).getDelivery(9999, CUSTOMER), NotFoundError);
});

test('25b. no delivery or POD payload carries driver or financial data', async () => {
  const db = buildDb();
  await makeDeliverable(db);
  await svc(db).markDelivered(1, {}, ADMIN);

  const payload = JSON.stringify(await svc(db).getDelivery(1, CUSTOMER));
  for (const forbidden of [
    'mobile', 'freight_amount', 'driver_payment', 'owner_payment', 'commission',
    'settlement', 'outstanding', 'net_vendor_payable', 'advance', 'bt_margin',
  ]) {
    assert.ok(!payload.includes(forbidden), `delivery payload must not contain ${forbidden}`);
  }

  // The projection is an allow-list, exactly like the Phase 5 tracking view.
  assert.deepEqual(
    Object.keys(await svc(db).getDelivery(1, CUSTOMER)).sort(),
    ['arrival', 'completed_at', 'delivered_at', 'destination', 'pod', 'receiver',
      'received', 'remarks', 'status', 'timeline', 'trip_id', 'trip_number'].sort()
  );
});

// ===========================================================================
// 27–30. FINANCIAL SEPARATION
// ===========================================================================

test('27–30. delivery and completion move NO money at all', async () => {
  const db = buildDb();
  const before = JSON.parse(JSON.stringify(db.__state.trips[0]));

  const s = await makeDeliverable(db);
  await s.markDelivered(1, {}, ADMIN);
  await s.completeTrip(1, {}, ADMIN);

  const after = db.__state.trips[0];

  // Gross hire and every agreed figure are untouched.
  assert.equal(after.freight_amount, before.freight_amount, 'gross hire unchanged');
  assert.equal(after.driver_payment, before.driver_payment, 'driver payout unchanged');
  assert.equal(after.owner_payment, before.owner_payment, 'owner settlement unchanged');
  assert.equal(after.commission_percentage, before.commission_percentage, 'commission rate unchanged');
  assert.equal(after.commission_type, before.commission_type, 'commission type unchanged');

  // Nothing landed in any financial table. The fake DB raises on a write to
  // settlement / commissionRecord / financialTransaction / tripSettlement /
  // tripFinancial / vehicleHire, so simply completing the trip above is the
  // proof that none of them was touched.
  assert.deepEqual(db.__state.settlements, []);
  assert.deepEqual(db.__state.commissionRecords, []);
  assert.deepEqual(db.__state.financialTransactions, []);

  // Structurally: the service imports no financial module at all.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'TripDeliveryService.js'), 'utf8'
  );
  for (const forbidden of [
    'VehicleHireService', 'CommissionService', 'TripSettlementService',
    'TripFinancialService', 'TripTransactionService', 'VendorLedgerService',
    'TripAdvanceService', 'CanonicalFinancialService',
  ]) {
    assert.ok(!src.includes(forbidden), `TripDeliveryService must not reference ${forbidden}`);
  }

  // And the only fields the completion transition writes are status + timestamp.
  // Bound the slice from `completeTrip` FORWARD, because `markDelivered` (which
  // comes earlier) also mentions getDeliveryReadiness.
  const from = src.indexOf('async completeTrip');
  const completion = src.slice(from, src.indexOf('async getDeliveryReadiness', from));
  const writeLine = completion.split('\n').find((l) => l.includes('data: {') && l.includes('COMPLETED'));
  assert.ok(writeLine, 'the completion transaction writes a status change');
  assert.match(writeLine, /status:\s*'COMPLETED'/);
  assert.match(writeLine, /completed_at:\s*now/);
  // Nothing financial appears anywhere in that block.
  for (const forbidden of ['freight', 'payment', 'settlement', 'commission', 'amount']) {
    assert.ok(
      !new RegExp(forbidden, 'i').test(writeLine),
      `the completion write must not touch ${forbidden}`
    );
  }
});

// ===========================================================================
// 31–33. DATA INTEGRITY
// ===========================================================================

test('31. the PLANNED quantity on the booking is never overwritten', async () => {
  const db = buildDb();
  const plannedBefore = { ...db.__state.bookings[0] };

  const s = await makeDeliverable(db);
  // A SHORT delivery: 478 bags received against 500 planned.
  await s.submitPod(1, { delivered_quantity: 478, delivered_weight_kg: 4770 }, ADMIN);
  await s.markDelivered(1, {}, ADMIN);

  assert.deepEqual(db.__state.bookings[0], plannedBefore, 'the booking is byte-for-byte identical');
  assert.equal(db.__state.bookings[0].quantity, 500, 'the planned figure still says 500');
  assert.equal(db.__state.bookings[0].goods_weight_kg, 5000);

  // The shortfall is recorded, on the trip, in its own columns.
  assert.equal(db.__state.trips[0].delivered_quantity, 478);
  assert.equal(db.__state.trips[0].delivered_weight_kg, 4770);
});

test('32. the original enquiry information is preserved', async () => {
  const db = buildDb();
  const enquiryBefore = { ...db.__state.enquiries[0] };

  const s = await makeDeliverable(db);
  await s.submitPod(1, { delivered_quantity: 478 }, ADMIN);
  await s.markDelivered(1, {}, ADMIN);
  await s.completeTrip(1, {}, ADMIN);

  assert.deepEqual(db.__state.enquiries[0], enquiryBefore);
});

test('33. loaded actuals and received actuals are stored separately', async () => {
  const db = buildDb();
  const s = await makeDeliverable(db);
  await s.submitPod(1, {
    delivered_quantity: 478, delivered_quantity_unit: 'bags', delivered_weight_kg: 4770,
  }, ADMIN);

  const trip = db.__state.trips[0];
  // The LOADED actuals from Phase 4 are untouched…
  assert.equal(trip.actual_quantity, 480);
  assert.equal(trip.actual_weight_kg, 4800);
  // …and the RECEIVED actuals live in their own columns.
  assert.equal(trip.delivered_quantity, 478);
  assert.equal(trip.delivered_weight_kg, 4770);
  assert.equal(trip.delivered_quantity_unit, 'bags');

  // A nonsense received figure is rejected rather than stored.
  await assert.rejects(
    () => s.submitPod(1, { delivered_quantity: -5 }, ADMIN),
    ValidationError
  );
  await assert.rejects(
    () => s.submitPod(1, { delivered_weight_kg: 'heavy' }, ADMIN),
    ValidationError
  );
});

// ===========================================================================
// DUPLICATE SYSTEMS
// ===========================================================================

test('DUPLICATES · Phase 6 created no second delivery, POD, document or timeline system', async () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);

  // No POD2 / Delivery2 / TripCompletion2 / DeliveryTimeline2.
  for (const banned of [/^POD/, /^POD2/, /^Delivery2/, /^TripCompletion/, /Timeline2$/]) {
    const found = models.filter((m) => banned.test(m));
    assert.deepEqual(found, [], `no ${banned} model exists`);
  }

  // The POD is a TripDocument row, and there is exactly one document model for
  // trips (PartnerDocument is partner KYC, a different subject entirely).
  assert.equal(models.filter((m) => m === 'TripDocument').length, 1);
  assert.equal(models.filter((m) => m === 'TripTimeline').length, 1);

  // The state machine is the Phase 4/5 one, extended not replaced: DELIVERED
  // and COMPLETED already existed, and no enum value was renamed.
  assert.ok(tripStateMachine.TRIP_STATUSES.includes('DELIVERED'));
  assert.ok(tripStateMachine.TRIP_STATUSES.includes('COMPLETED'));
  assert.deepEqual(tripStateMachine.OPERATIONAL_SEQUENCE, [
    'PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED',
    'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  ]);
  // The TripStatus enum itself is unchanged in the schema.
  const enumBlock = schema.slice(schema.indexOf('enum TripStatus'));
  for (const value of tripStateMachine.TRIP_STATUSES) {
    assert.ok(enumBlock.includes(value), `${value} still exists in the enum`);
  }

  // One realtime module, reused.
  const realtimeDir = fs.readdirSync(path.join(__dirname, '..', 'realtime'));
  assert.deepEqual(realtimeDir.filter((f) => f.endsWith('.js')), ['enquiryRealtime.js']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'TripDeliveryService.js'), 'utf8');
  assert.match(src, /require\('\.\.\/realtime\/enquiryRealtime'\)/, 'the existing socket server is reused');
});

test('DUPLICATES · the shipped "Mark Delivered / Mark Completed" control still works', async () => {
  // Phase 6 must not silently remove the legacy PATCH /trips/:id/status path.
  // The strict rules live on the NEW endpoints; the shipped control is untouched.
  assert.doesNotThrow(() => tripStateMachine.validateTransition('IN_TRANSIT', 'DELIVERED'));
  assert.doesNotThrow(() => tripStateMachine.validateTransition('DELIVERED', 'COMPLETED'));

  // …and the new endpoints use the STRICT validator.
  assert.throws(
    () => tripStateMachine.validateOperationalTransition('ASSIGNED', 'DELIVERED'),
    /Allowed from|Cannot move/
  );
  assert.doesNotThrow(() => tripStateMachine.validateOperationalTransition('IN_TRANSIT', 'DELIVERED'));
});
