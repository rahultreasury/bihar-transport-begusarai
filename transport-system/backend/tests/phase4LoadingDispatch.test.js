/**
 * phase4LoadingDispatch.test.js
 * ---------------------------------------------------------------------------
 * PHASE 4 — LOADING → DOCUMENTS → DISPATCH (unit / contract level)
 * ---------------------------------------------------------------------------
 *
 * Runs against an in-memory stand-in for Prisma. The live-PostgreSQL suite is
 * tests/phase4LoadingDispatch.db.test.js.
 *
 *   LOADING
 *     1.  Vehicle hired → To Loading Point
 *     2.  To Loading Point → At Loading Point
 *     3.  At Loading Point → Loaded
 *     4.  Invalid backward transition rejected
 *     5.  Unauthorized loading transition rejected
 *     6.  Duplicate loading request is safe
 *
 *   DOCUMENTS
 *     7.  Required document detection
 *     8.  Missing document blocks dispatch
 *     9.  Present document allows dispatch
 *     10. Document belongs to the correct Trip
 *     11. Unauthorized document access rejected
 *     12. Document status remains separate from Trip status
 *
 *   DISPATCH
 *     13. Valid dispatch
 *     14. Dispatch without vehicle rejected
 *     15. Dispatch without driver rejected
 *     16. Dispatch before loading rejected
 *     17. Dispatch with missing mandatory document rejected
 *     18. Duplicate dispatch safe
 *     19. Dispatch records a timeline event
 *     20. Dispatch records an audit entry
 *
 *   DATA INTEGRITY
 *     21. Planned quantity preserved
 *     22. Actual quantity stored separately
 *     23. Planned weight preserved
 *     24. Actual weight stored separately
 *     25. Existing Trip data remains intact
 *
 *   STATE MACHINE
 *     every legal edge, every illegal edge, terminal states, legacy skip.
 *
 * Uses node:test + node:assert (no extra deps).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const tripStateMachine = require('../utils/TripStateMachine');
const documentPolicy = require('../config/tripDocumentPolicy');
const TripOperationalService = require('../services/TripOperationalService');
const TripDocumentService = require('../services/TripDocumentService');
const { adminOnly } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../utils/AppError');

const ADMIN = { user_id: 1, role: 'admin' };

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
    }
    return value === cond;
  });
}

function table(rows) {
  let seq = 0;
  return {
    rows,
    async findMany({ where, orderBy } = {}) {
      const out = rows.filter((r) => matches(r, where));
      if (!orderBy) return out.map((r) => ({ ...r }));
      const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
      return [...out].sort((a, b) => {
        for (const c of clauses) {
          for (const [k, dir] of Object.entries(c)) {
            if (a[k] === b[k]) continue;
            if (a[k] === null || a[k] === undefined) return 1;
            if (b[k] === null || b[k] === undefined) return -1;
            return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
          }
        }
        return 0;
      }).map((r) => ({ ...r }));
    },
    async findFirst({ where, orderBy } = {}) {
      const out = await this.findMany({ where, orderBy });
      return out.length ? out[0] : null;
    },
    async findUnique({ where } = {}) {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    },
    async create({ data }) {
      seq += 1;
      const row = { [data.trip_id !== undefined ? '_seq' : '_seq']: seq, ...data };
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    },
    async delete({ where }) {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error('not found');
      const [row] = rows.splice(idx, 1);
      return row;
    },
  };
}

/**
 * A trip in the requested state with a vehicle, a driver and a booking that
 * carries the PLANNED goods figures.
 */
function makeDb({ status = 'ASSIGNED', withVehicle = true, withDriver = true, freight = 60000 } = {}) {
  const state = {
    trips: [{
      trip_id: 1,
      trip_number: 'BTBT-2026-00001',
      booking_id: 900,
      pickup_location: 'Kosi Farm Gate',
      pickup_city: 'Begusarai',
      drop_location: 'Mandi Yard',
      drop_city: 'Patna',
      freight_amount: freight,
      documents_required: null,
      vehicle_id: withVehicle ? 100 : null,
      driver_id: withDriver ? 200 : null,
      status,
      sent_to_loading_at: null,
      arrived_at_loading_at: null,
      loading_started_at: null,
      loading_completed_at: null,
      loading_remarks: null,
      loaded_by: null,
      dispatched_at: null,
      actual_quantity: null,
      actual_quantity_unit: null,
      actual_weight_kg: null,
      created_at: new Date('2026-09-01T00:00:00.000Z'),
    }],
    tripDocuments: [],
    tripTimeline: [],
    auditLogs: [],
    bookings: [{
      booking_id: 900,
      goods_description: 'Wheat',
      number_of_items: 500,
      quantity_unit: 'Bags',
      goods_weight_kg: 25000,
      weight_unit: 'KG',
    }],
    vehicles: withVehicle ? [{ vehicle_id: 100, vehicle_number: 'BR01AB1234', is_available: true, current_status: 'available' }] : [],
    drivers: withDriver ? [{ driver_id: 200, driver_name: 'Raj Kumar', is_available: true, status: 'available' }] : [],
  };

  const client = {};
  const tripTable = table(state.trips);
  const docTable = table(state.tripDocuments);

  // Assign ids the way the real tables do, so unique-index behaviour is real.
  docTable.create = async ({ data }) => {
    const existing = state.tripDocuments.find(
      (d) => d.trip_id === data.trip_id && d.document_type === data.document_type
    );
    if (existing) {
      const err = new Error('Unique constraint failed on the fields: (`trip_id`,`document_type`)');
      err.code = 'P2002';
      throw err;
    }
    const row = { document_id: state.tripDocuments.length + 1, ...data };
    state.tripDocuments.push(row);
    return { ...row };
  };
  docTable.findUnique = async ({ where }) => {
    const compound = where.trip_id_document_type || where.uq_trip_documents_trip_type;
    if (compound) {
      const f = state.tripDocuments.find(
        (d) => d.trip_id === compound.trip_id && d.document_type === compound.document_type
      );
      return f ? { ...f } : null;
    }
    const f = state.tripDocuments.find((d) => matches(d, where));
    return f ? { ...f } : null;
  };
  docTable.findFirst = async (args) => {
    const out = await docTable.findMany(args);
    return out.length ? out[0] : null;
  };
  docTable.update = async ({ where, data }) => {
    const f = state.tripDocuments.find((d) => matches(d, where));
    if (!f) throw new Error('not found');
    Object.assign(f, data);
    return { ...f };
  };
  docTable.delete = async ({ where }) => {
    const idx = state.tripDocuments.findIndex((d) => matches(d, where));
    if (idx < 0) throw new Error('not found');
    return state.tripDocuments.splice(idx, 1)[0];
  };

  client.trip = {
    rows: state.trips,
    findUnique: async ({ where, include }) => {
      const found = state.trips.find((t) => matches(t, where));
      if (!found) return null;
      const row = { ...found };
      if (include?.vehicle) row.vehicle = state.vehicles.find((v) => v.vehicle_id === found.vehicle_id) || null;
      if (include?.driver) row.driver = state.drivers.find((d) => d.driver_id === found.driver_id) || null;
      if (include?.booking) row.booking = state.bookings.find((b) => b.booking_id === found.booking_id) || null;
      return row;
    },
    findFirst: async ({ where }) => {
      const f = state.trips.find((t) => matches(t, where));
      return f ? { ...f } : null;
    },
    findMany: async ({ where } = {}) => state.trips.filter((t) => matches(t, where)).map((t) => ({ ...t })),
    update: async ({ where, data }) => {
      const f = state.trips.find((t) => matches(t, where));
      if (!f) throw new Error('not found');
      Object.assign(f, data);
      return { ...f };
    },
  };
  client.tripDocument = docTable;
  client.tripTimeline = {
    rows: state.tripTimeline,
    create: async ({ data }) => {
      const row = { timeline_id: state.tripTimeline.length + 1, ...data };
      state.tripTimeline.push(row);
      return row;
    },
  };
  client.auditLog = {
    rows: state.auditLogs,
    create: async ({ data }) => {
      const row = { audit_id: state.auditLogs.length + 1, ...data };
      state.auditLogs.push(row);
      return row;
    },
  };
  client.$transaction = async (cb) => cb(client);
  client.__state = state;
  return client;
}

function ops(db) { return new TripOperationalService({ prisma: db }); }
function docs(db) { return new TripDocumentService({ prisma: db }); }

/** Record the three default-required documents as PRESENT. */
async function satisfyDocuments(db) {
  for (const type of documentPolicy.requiredDocumentsFor(db.__state.trips[0])) {
    await docs(db).recordDocument(1, { document_type: type, document_status: 'PRESENT', reference_number: `${type}-1` }, ADMIN);
  }
}

/** Walk a trip to LOADED with its documents in place. */
async function driveToLoaded(db) {
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, { actual_quantity: 480, actual_weight_kg: 24200 }, ADMIN);
  return svc;
}

// ===========================================================================
// STATE MACHINE
// ===========================================================================

test('SM · the operational chain is legal and every backwards move is refused', () => {
  const chain = [
    ['PENDING', 'ASSIGNED'],
    ['ASSIGNED', 'TO_LOADING_POINT'],
    ['TO_LOADING_POINT', 'AT_LOADING_POINT'],
    ['AT_LOADING_POINT', 'LOADED'],
    ['LOADED', 'DISPATCHED'],
    ['DISPATCHED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'DELIVERED'],
    ['DELIVERED', 'COMPLETED'],
  ];
  for (const [from, to] of chain) {
    assert.doesNotThrow(() => tripStateMachine.validateTransition(from, to), `${from} → ${to}`);
  }

  const forbidden = [
    ['ASSIGNED', 'AT_LOADING_POINT'],   // skipping a loading step
    ['ASSIGNED', 'LOADED'],             // skipping loading entirely
    ['ASSIGNED', 'DISPATCHED'],         // skipping straight to dispatch
    ['LOADED', 'AT_LOADING_POINT'],     // the reversal STEP 5 calls out
    ['LOADED', 'TO_LOADING_POINT'],
    ['DISPATCHED', 'LOADED'],
    ['IN_TRANSIT', 'LOADED'],
    ['COMPLETED', 'IN_TRANSIT'],        // terminal
    ['CANCELLED', 'PENDING'],           // terminal
    ['LOADED', 'DELIVERED'],
  ];
  for (const [from, to] of forbidden) {
    assert.throws(
      () => tripStateMachine.validateTransition(from, to),
      ValidationError,
      `${from} → ${to} must be refused`
    );
  }
});

test('SM · terminal states accept nothing, and cancellation is always available', () => {
  assert.equal(tripStateMachine.isTerminal('COMPLETED'), true);
  assert.equal(tripStateMachine.isTerminal('CANCELLED'), true);
  assert.equal(tripStateMachine.isTerminal('LOADED'), false);
  for (const status of tripStateMachine.TRIP_STATUSES) {
    if (tripStateMachine.isTerminal(status)) continue;
    assert.ok(
      tripStateMachine.allowedNext(status).includes('CANCELLED'),
      `${status} must be cancellable`
    );
  }
});

test('SM · the legacy admin short-cut is explicit, identified, and not on the strict path', () => {
  // The shipped "Mark In Transit" button must keep working.
  assert.doesNotThrow(() => tripStateMachine.validateTransition('ASSIGNED', 'IN_TRANSIT'));
  assert.equal(tripStateMachine.isLegacySkip('ASSIGNED', 'IN_TRANSIT'), true);

  // …but it must be recognisable as a short-cut rather than the normal path.
  assert.equal(tripStateMachine.isLegacySkip('ASSIGNED', 'TO_LOADING_POINT'), false);
  assert.equal(tripStateMachine.isLegacySkip('DISPATCHED', 'IN_TRANSIT'), false);

  // The operational service reaches IN_TRANSIT only through DISPATCHED.
  // (Phase 5 added START_TRANSIT for exactly that step; it is legal from
  // DISPATCHED and from nowhere else — see the next assertions.)
  assert.equal(TripOperationalService.OPERATION_TARGET.DISPATCH, 'DISPATCHED');
  assert.equal(TripOperationalService.OPERATION_TARGET.START_TRANSIT, 'IN_TRANSIT');
  assert.ok(Object.values(TripOperationalService.OPERATION_TARGET).includes('IN_TRANSIT'));

  // No operational operation can skip DISPATCHED on the way to IN_TRANSIT:
  // those two edges exist only as the documented legacy admin short-cut.
  assert.doesNotThrow(() => tripStateMachine.validateTransition('DISPATCHED', 'IN_TRANSIT'));
  assert.equal(tripStateMachine.isLegacySkip('ASSIGNED', 'IN_TRANSIT'), true);
  assert.equal(tripStateMachine.isLegacySkip('PENDING', 'IN_TRANSIT'), true);
  assert.equal(tripStateMachine.isLegacySkip('DISPATCHED', 'IN_TRANSIT'), false);
});

test('SM · an unknown status is rejected rather than silently stored', () => {
  assert.throws(() => tripStateMachine.validateTransition('ASSIGNED', 'LOADED_WITH_LR'), ValidationError);
  assert.throws(() => tripStateMachine.validateTransition('ASSIGNED', 'BANANA'), ValidationError);
  assert.throws(() => tripStateMachine.validateTransition('BANANA', 'ASSIGNED'), ValidationError);
});

// ===========================================================================
// 1–3. LOADING TRANSITIONS
// ===========================================================================

test('1. Vehicle hired → To Loading Point', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  const result = await ops(db).sendToLoadingPoint(1, {}, ADMIN);

  assert.equal(result.idempotent, false);
  assert.equal(result.status, 'TO_LOADING_POINT');
  assert.equal(db.__state.trips[0].status, 'TO_LOADING_POINT');
  assert.ok(db.__state.trips[0].sent_to_loading_at instanceof Date);
});

test('2. To Loading Point → At Loading Point', async () => {
  const db = makeDb({ status: 'TO_LOADING_POINT' });
  const result = await ops(db).arriveAtLoadingPoint(1, {}, ADMIN);

  assert.equal(result.status, 'AT_LOADING_POINT');
  assert.ok(db.__state.trips[0].arrived_at_loading_at instanceof Date);
});

test('3. At Loading Point → Loaded, with the actual figures recorded', async () => {
  const db = makeDb({ status: 'AT_LOADING_POINT' });
  const result = await ops(db).completeLoading(1, {
    actual_quantity: 480,
    actual_quantity_unit: 'Bags',
    actual_weight_kg: 24200,
    loaded_by: 'Ravi (loader)',
    loading_remarks: '12 bags short on re-weigh',
  }, ADMIN);

  assert.equal(result.status, 'LOADED');
  const trip = db.__state.trips[0];
  assert.equal(trip.actual_quantity, 480);
  assert.equal(trip.actual_weight_kg, 24200);
  assert.equal(trip.loaded_by, 'Ravi (loader)');
  assert.ok(trip.loading_completed_at instanceof Date);
});

test('4. an invalid backward transition is rejected', async () => {
  // The state machine is where a backwards move is actually refused.
  assert.throws(
    () => tripStateMachine.validateTransition('LOADED', 'AT_LOADING_POINT'),
    ValidationError
  );

  // Through the service the same request is a safe no-op, because the trip has
  // already passed that point — it is NOT moving backwards, so it must not be
  // treated as an error, but it must also not change anything.
  const db = makeDb({ status: 'LOADED' });
  const result = await ops(db).arriveAtLoadingPoint(1, {}, ADMIN);
  assert.equal(result.idempotent, true);
  assert.equal(result.status, 'LOADED');
  assert.equal(db.__state.trips[0].status, 'LOADED');

  // A genuinely illegal move through a service is refused outright. A
  // cancelled trip is terminal and is in none of the "already past this" lists,
  // so the state machine is what stops it.
  const dead = makeDb({ status: 'CANCELLED' });
  await assert.rejects(
    () => ops(dead).sendToLoadingPoint(1, {}, ADMIN),
    (e) => e instanceof ValidationError && /terminal state/.test(e.message)
  );
  await assert.rejects(
    () => ops(dead).dispatch(1, {}, ADMIN),
    ValidationError
  );
  assert.equal(dead.__state.trips[0].status, 'CANCELLED');
});

test('4b. a forward skip is rejected — loading cannot be jumped over', async () => {
  const db = makeDb({ status: 'ASSIGNED' });

  await assert.rejects(
    () => ops(db).completeLoading(1, {}, ADMIN),
    (e) => e instanceof ValidationError && /ASSIGNED to LOADED/.test(e.message)
  );
  await assert.rejects(
    () => ops(db).dispatch(1, {}, ADMIN),
    (e) => e instanceof ValidationError
  );
  assert.equal(db.__state.trips[0].status, 'ASSIGNED');
});

test('5. an unauthorized loading transition is rejected', async () => {
  const run = (user) => new Promise((resolve) => {
    const res = {
      status(c) { this._s = c; return this; },
      json(b) { resolve({ status: this._s, body: b }); return this; },
    };
    adminOnly({ user }, res, () => resolve({ status: 200, allowed: true }));
  });

  assert.equal((await run({ role: 'admin' })).allowed, true);
  for (const role of ['customer', 'driver', 'partner', 'staff']) {
    const r = await run({ role });
    assert.equal(r.status, 403, `${role} must not load`);
    assert.equal(r.allowed, undefined);
  }
  assert.equal((await run(undefined)).status, 403, 'unauthenticated must not load');

  // And the real router puts every Phase 4 write behind protect + adminOnly.
  const router = require('../routes/tripRoutes');
  const writes = router.stack
    .filter((l) => l.route && l.route.path.startsWith('/:id/')
      // Express stores route methods lowercased.
      && ['POST', 'DELETE'].includes(Object.keys(l.route.methods)[0].toUpperCase()))
    .filter((l) => /loading|dispatch|documents/.test(l.route.path));
  assert.ok(writes.length >= 6, `the Phase 4 write routes exist (found ${writes.length})`);
  for (const l of writes) {
    const names = l.route.stack.map((s) => s.name);
    assert.ok(names.includes('protect'), `${l.route.path} must require authentication`);
    assert.ok(names.includes('adminOnly'), `${l.route.path} must be admin-only`);
  }
});

// ===========================================================================
// 6. IDEMPOTENCY
// ===========================================================================

test('6. a duplicate loading request is safe and writes no second event', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  const svc = ops(db);

  const first = await svc.sendToLoadingPoint(1, {}, ADMIN);
  const second = await svc.sendToLoadingPoint(1, {}, ADMIN);
  const third = await svc.sendToLoadingPoint(1, {}, ADMIN); // a third try

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(second.status, 'TO_LOADING_POINT');

  assert.equal(
    db.__state.tripTimeline.filter((e) => e.event_type === 'status_changed').length,
    1,
    'exactly one timeline event, however many times it is retried'
  );

  // A retry does not move the recorded timestamp either.
  const stamp = db.__state.trips[0].sent_to_loading_at;
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  assert.equal(db.__state.trips[0].sent_to_loading_at, stamp);
});

test('6b. a loading step already passed is idempotent from further along', async () => {
  const db = makeDb({ status: 'AT_LOADING_POINT' });
  const svc = ops(db);

  // "Sent to loading point" already happened; asking again is a no-op.
  const r = await svc.sendToLoadingPoint(1, {}, ADMIN);
  assert.equal(r.idempotent, true);
  assert.equal(r.status, 'AT_LOADING_POINT');
});

// ===========================================================================
// 7–9. DOCUMENT DETECTION AND DISPATCH GATING
// ===========================================================================

test('7. required document detection follows the one policy module', async () => {
  // 60,000 consignment → above the e-way-bill threshold → all three.
  assert.deepEqual(
    documentPolicy.requiredDocumentsFor({ freight_amount: 60000, documents_required: null }),
    ['LR', 'INVOICE', 'E_WAY_BILL']
  );
  // 10,000 consignment → below the threshold → no e-way bill needed.
  assert.deepEqual(
    documentPolicy.requiredDocumentsFor({ freight_amount: 10000, documents_required: null }),
    ['LR', 'INVOICE']
  );
  // An explicit per-trip override wins, including "none".
  assert.deepEqual(documentPolicy.requiredDocumentsFor({ documents_required: [] }), []);
  assert.deepEqual(documentPolicy.requiredDocumentsFor({ documents_required: ['LR'] }), ['LR']);

  const db = makeDb({ status: 'ASSIGNED' });
  await satisfyDocuments(db);
  const checklist = await docs(db).getChecklist(db.__state.trips[0]);
  assert.equal(checklist.ready, true);
  assert.deepEqual(checklist.required, ['LR', 'INVOICE', 'E_WAY_BILL']);
  assert.equal(checklist.items.length, documentPolicy.DOCUMENT_TYPES.length, 'every type is listed');
});

test('8. a missing document blocks dispatch', async () => {
  const db = makeDb({ status: 'LOADED', freight: 10000 }); // LR + INVOICE required
  await ops(db).completeLoading(1, {}, ADMIN);

  // Nothing recorded yet.
  let readiness = await ops(db).getDispatchReadiness(1);
  assert.equal(readiness.ready, false);
  const codes = readiness.blockers.map((b) => b.code);
  assert.ok(codes.includes('MISSING_DOCUMENT'));
  assert.equal(readiness.blockers.filter((b) => b.code === 'MISSING_DOCUMENT').length, 2);

  await assert.rejects(
    () => ops(db).dispatch(1, {}, ADMIN),
    (e) => e instanceof ValidationError && /cannot be dispatched/.test(e.message)
  );
  assert.equal(db.__state.trips[0].status, 'LOADED', 'a refused dispatch changes nothing');

  // One of the two is still not enough.
  await docs(db).recordDocument(1, { document_type: 'LR', document_status: 'PRESENT' }, ADMIN);
  await assert.rejects(() => ops(db).dispatch(1, {}, ADMIN), ValidationError);

  // A REJECTED document does not count as present.
  await docs(db).recordDocument(1, { document_type: 'INVOICE', document_status: 'REJECTED' }, ADMIN);
  readiness = await ops(db).getDispatchReadiness(1);
  assert.equal(readiness.ready, false, 'a rejected document is not a supplied document');
});

test('9. a present document allows dispatch', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, { actual_quantity: 500, actual_weight_kg: 25000 }, ADMIN);
  await satisfyDocuments(db);

  const readiness = await svc.getDispatchReadiness(1);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers));

  const result = await svc.dispatch(1, {}, ADMIN);
  assert.equal(result.status, 'DISPATCHED');
  assert.ok(db.__state.trips[0].dispatched_at instanceof Date);
});

// ===========================================================================
// 10–11. DOCUMENT OWNERSHIP AND ACCESS
// ===========================================================================

test('10. a document belongs to the trip it was filed against', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  await docs(db).recordDocument(1, { document_type: 'LR', document_status: 'PRESENT', reference_number: 'LR-A' }, ADMIN);

  const all = await docs(db).getTripDocuments(1);
  assert.equal(all.length, 1);
  assert.equal(all[0].trip_id, 1);
  assert.equal(all[0].document_type, 'LR');

  // A document id from another trip cannot be reached through this trip.
  await assert.rejects(
    () => docs(db).verifyDocument(1, 9999, ADMIN),
    NotFoundError
  );
});

test('11. unauthorized document access is rejected', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  await docs(db).recordDocument(1, { document_type: 'LR', document_status: 'PRESENT' }, ADMIN);

  // The service itself never takes a caller identity for reading: access is
  // the route's job, and the route is admin-gated.
  const router = require('../routes/tripRoutes');
  for (const path of ['/:id/documents', '/:id/workflow', '/:id/dispatch/readiness']) {
    const layer = router.stack.find((l) => l.route && l.route.path === path);
    assert.ok(layer, `${path} exists`);
    const names = layer.route.stack.map((s) => s.name);
    assert.ok(names.includes('protect'), `${path} must require authentication`);
  }

  const write = router.stack.find((l) => l.route && l.route.path === '/:id/documents');
  assert.ok(write.route.stack.map((s) => s.name).includes('adminOnly'));

  // An invalid document type never reaches the database.
  await assert.rejects(
    () => docs(db).recordDocument(1, { document_type: 'DRIVING_LICENCE_OF_OWNER' }, ADMIN),
    ValidationError
  );
  assert.equal(db.__state.tripDocuments.length, 1);
});

// ===========================================================================
// 12. DOCUMENT STATUS vs TRIP STATUS
// ===========================================================================

test('12. document status is separate from trip operational status', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = ops(db);

  // Documents can be complete BEFORE the truck is loaded.
  await satisfyDocuments(db);
  assert.equal(db.__state.trips[0].status, 'ASSIGNED');
  let checklist = await docs(db).getChecklist(db.__state.trips[0]);
  assert.equal(checklist.ready, true);

  // …and the trip can be LOADED with no documents at all.
  const bare = makeDb({ status: 'AT_LOADING_POINT', freight: 60000 });
  await ops(bare).completeLoading(1, {}, ADMIN);
  checklist = await docs(bare).getChecklist(bare.__state.trips[0]);
  assert.equal(bare.__state.trips[0].status, 'LOADED');
  assert.equal(checklist.ready, false);

  // There is no combined status anywhere.
  for (const status of tripStateMachine.TRIP_STATUSES) {
    assert.doesNotMatch(status, /WITH|LR|INVOICE|E_WAY/, `no ${status} status may exist`);
  }

  const state = await svc.getOperationalState(1);
  assert.ok('status' in state);
  assert.ok('documents' in state);
  assert.notEqual(state.documents, state.status);
});

// ===========================================================================
// 13–20. DISPATCH
// ===========================================================================

test('13. a valid dispatch succeeds and moves the trip on', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, {}, ADMIN);
  await satisfyDocuments(db);

  const result = await svc.dispatch(1, {}, ADMIN);
  assert.equal(result.status, 'DISPATCHED');
  assert.equal(result.idempotent, false);
  assert.ok(result.trip.dispatched_at);
});

test('14. dispatch without a vehicle is rejected', async () => {
  const db = makeDb({ status: 'ASSIGNED', withVehicle: false, freight: 60000 });
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, {}, ADMIN);
  await satisfyDocuments(db);

  const readiness = await svc.getDispatchReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.code === 'NO_VEHICLE'));
  await assert.rejects(() => svc.dispatch(1, {}, ADMIN), ValidationError);
  assert.equal(db.__state.trips[0].status, 'LOADED');
});

test('15. dispatch without a driver is rejected', async () => {
  const db = makeDb({ status: 'ASSIGNED', withDriver: false, freight: 60000 });
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, {}, ADMIN);
  await satisfyDocuments(db);

  const readiness = await svc.getDispatchReadiness(1);
  assert.ok(readiness.blockers.some((b) => b.code === 'NO_DRIVER'));
  await assert.rejects(() => svc.dispatch(1, {}, ADMIN), ValidationError);
});

test('15b. an inactive vehicle or driver blocks dispatch', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = ops(db);
  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, {}, ADMIN);
  await satisfyDocuments(db);

  db.__state.vehicles[0].current_status = 'off_road';
  db.__state.drivers[0].status = 'inactive';

  const readiness = await svc.getDispatchReadiness(1);
  const codes = readiness.blockers.map((b) => b.code);
  assert.ok(codes.includes('VEHICLE_INACTIVE'));
  assert.ok(codes.includes('DRIVER_INACTIVE'));
});

test('16. dispatch before loading is rejected', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = ops(db);
  await satisfyDocuments(db);

  const readiness = await svc.getDispatchReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.code === 'NOT_LOADED'));
  await assert.rejects(() => svc.dispatch(1, {}, ADMIN), ValidationError);
  assert.equal(db.__state.trips[0].status, 'ASSIGNED');
});

test('16b. dispatch without a recorded loading completion is rejected', async () => {
  // A trip that reached LOADED without the loading fact recorded must not be
  // dispatchable — the status alone is not proof the goods are on board.
  const db = makeDb({ status: 'LOADED', freight: 60000 });
  await satisfyDocuments(db);

  const readiness = await ops(db).getDispatchReadiness(1);
  assert.ok(readiness.blockers.some((b) => b.code === 'LOADING_NOT_RECORDED'));
  await assert.rejects(() => ops(db).dispatch(1, {}, ADMIN), ValidationError);
});

test('17. dispatch with a missing mandatory document is rejected', async () => {
  const db = makeDb({ status: 'LOADED', freight: 60000 });
  await ops(db).completeLoading(1, {}, ADMIN);
  // only the LR recorded — invoice and e-way bill still missing
  await docs(db).recordDocument(1, { document_type: 'LR', document_status: 'PRESENT' }, ADMIN);

  const readiness = await ops(db).getDispatchReadiness(1);
  const missing = readiness.blockers.filter((b) => b.code === 'MISSING_DOCUMENT');
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.map((m) => m.document_type).sort(), ['E_WAY_BILL', 'INVOICE']);

  await assert.rejects(() => ops(db).dispatch(1, {}, ADMIN), ValidationError);
});

test('18. a duplicate dispatch is safe', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = await driveToLoaded(db);
  await satisfyDocuments(db);

  const first = await svc.dispatch(1, {}, ADMIN);
  const second = await svc.dispatch(1, {}, ADMIN);
  const third = await svc.dispatch(1, {}, ADMIN);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(second.status, 'DISPATCHED');

  const dispatchEvents = db.__state.tripTimeline.filter(
    (e) => e.event_type === 'status_changed'
      && e.metadata
      // TripTimeline.metadata is a TEXT column holding a JSON string.
      && JSON.parse(e.metadata).operation === 'DISPATCH'
  );
  assert.equal(dispatchEvents.length, 1, 'a retried dispatch never duplicates the movement');

  const stamp = db.__state.trips[0].dispatched_at;
  await svc.dispatch(1, {}, ADMIN);
  assert.equal(db.__state.trips[0].dispatched_at, stamp, 'the dispatch time is not moved');
});

test('19. dispatch records a timeline event on the existing append-only timeline', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = await driveToLoaded(db);
  await satisfyDocuments(db);
  await svc.dispatch(1, {}, ADMIN);

  const events = db.__state.tripTimeline.filter((e) => e.event_type === 'status_changed');
  assert.deepEqual(
    events.map((e) => JSON.parse(e.metadata).to),
    ['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED'],
    'every operational movement is recorded, in order'
  );
  assert.deepEqual(
    events.map((e) => JSON.parse(e.metadata).from),
    ['ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED']
  );

  const dispatchEvent = events[events.length - 1];
  assert.equal(dispatchEvent.reference_type, 'trip');
  assert.equal(dispatchEvent.reference_id, 1);
  assert.equal(dispatchEvent.created_by, 1);
  assert.match(dispatchEvent.description, /Dispatched/);
});

test('19b. the timeline is append-only — history is never rewritten', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = await driveToLoaded(db);
  await satisfyDocuments(db);
  await svc.dispatch(1, {}, ADMIN);

  const snapshot = JSON.stringify(db.__state.tripTimeline);
  // Retry everything.
  await svc.dispatch(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, {}, ADMIN);
  assert.equal(JSON.stringify(db.__state.tripTimeline), snapshot, 'no event changed or vanished');

  // The repository exposes no update/delete for an event.
  const repo = require('../repositories/TripTimelineRepository');
  assert.equal(typeof repo.prototype.update, 'undefined');
  assert.equal(typeof repo.prototype.delete, 'undefined');
});

test('20. dispatch records an audit entry', async () => {
  const db = makeDb({ status: 'ASSIGNED', freight: 60000 });
  const svc = await driveToLoaded(db);
  await satisfyDocuments(db);
  await svc.dispatch(1, {}, ADMIN);

  const audit = db.__state.auditLogs.filter((a) => a.action === 'trip_operational_transition');
  assert.equal(audit.length, 4, 'send, arrive, load and dispatch are each audited');

  const dispatchAudit = audit[audit.length - 1];
  assert.equal(dispatchAudit.entity_type, 'Trip');
  assert.equal(dispatchAudit.entity_id, 1);
  assert.equal(dispatchAudit.user_id, 1);
  assert.equal(dispatchAudit.user_role, 'admin');
  assert.equal(JSON.parse(dispatchAudit.new_value).status, 'DISPATCHED');
  assert.equal(JSON.parse(dispatchAudit.previous_value).status, 'LOADED');
});

// ===========================================================================
// 21–25. DATA INTEGRITY
// ===========================================================================

test('21–24. planned figures are preserved and actual figures stored separately', async () => {
  const db = makeDb({ status: 'AT_LOADING_POINT' });
  await ops(db).completeLoading(1, {
    actual_quantity: 480,
    actual_quantity_unit: 'Bags',
    actual_weight_kg: 24200,
  }, ADMIN);

  const trip = db.__state.trips[0];
  // PLANNED — untouched, still the customer's original declaration.
  const booking = db.__state.bookings[0];
  assert.equal(booking.number_of_items, 500);
  assert.equal(booking.quantity_unit, 'Bags');
  assert.equal(booking.goods_weight_kg, 25000);
  assert.equal(booking.goods_description, 'Wheat');

  // ACTUAL — recorded alongside, so the variance is visible.
  assert.equal(trip.actual_quantity, 480);
  assert.equal(trip.actual_quantity_unit, 'Bags');
  assert.equal(trip.actual_weight_kg, 24200);

  // Reported as two distinct blocks, never merged.
  const state = await ops(db).getOperationalState(1);
  assert.equal(state.planned.quantity, 500);
  assert.equal(state.actual.quantity, 480);
  assert.equal(state.planned.weight_kg, 25000);
  assert.equal(state.actual.weight_kg, 24200);
});

test('24b. invalid actual figures are rejected, not silently stored', async () => {
  const db = makeDb({ status: 'AT_LOADING_POINT' });
  for (const bad of [{ actual_quantity: -5 }, { actual_weight_kg: -1 }, { actual_quantity: 'heavy' }]) {
    await assert.rejects(() => ops(db).completeLoading(1, bad, ADMIN), ValidationError);
  }
  assert.equal(db.__state.trips[0].status, 'AT_LOADING_POINT');
  assert.equal(db.__state.trips[0].actual_quantity, null);
});

test('25. existing trip data remains intact through the whole workflow', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  const before = { ...db.__state.trips[0] };
  const svc = ops(db);

  await svc.sendToLoadingPoint(1, {}, ADMIN);
  await svc.arriveAtLoadingPoint(1, {}, ADMIN);
  await svc.completeLoading(1, { actual_quantity: 480, actual_weight_kg: 24200 }, ADMIN);
  await satisfyDocuments(db);
  await svc.dispatch(1, {}, ADMIN);

  const after = db.__state.trips[0];
  for (const field of ['trip_id', 'trip_number', 'booking_id', 'freight_amount',
    'pickup_location', 'pickup_city', 'drop_location', 'drop_city',
    'vehicle_id', 'driver_id', 'created_at']) {
    assert.deepEqual(after[field], before[field], `${field} must not change`);
  }
});

test('25b. a trip with no booking still loads — nothing assumes a booking', async () => {
  const db = makeDb({ status: 'AT_LOADING_POINT' });
  db.__state.trips[0].booking_id = null;
  await ops(db).completeLoading(1, { actual_quantity: 10 }, ADMIN);
  assert.equal(db.__state.trips[0].status, 'LOADED');

  const state = await ops(db).getOperationalState(1);
  assert.deepEqual(state.planned, {
    material: null, quantity: null, quantity_unit: null, weight_kg: null, weight_unit: null,
  });
});

// ===========================================================================
// DOCUMENT IDEMPOTENCY
// ===========================================================================

test('DOC · re-posting the same document is a safe no-op', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  const svc = docs(db);

  const first = await svc.recordDocument(1, {
    document_type: 'LR', document_status: 'PRESENT', reference_number: 'LR-77',
  }, ADMIN);
  const second = await svc.recordDocument(1, {
    document_type: 'LR', document_status: 'PRESENT', reference_number: 'LR-77',
  }, ADMIN);

  assert.equal(second.already_recorded, true);
  assert.equal(second.document_id, first.document_id);
  assert.equal(db.__state.tripDocuments.length, 1, 'one document per type per trip');

  // A genuine CHANGE is applied, and is recorded as an update.
  const changed = await svc.recordDocument(1, {
    document_type: 'LR', document_status: 'VERIFIED', reference_number: 'LR-77',
  }, ADMIN);
  assert.equal(changed.document_status, 'VERIFIED');
  assert.equal(changed.is_verified, true);
  assert.equal(db.__state.tripDocuments.length, 1);

  const events = db.__state.tripTimeline.map((e) => e.event_type);
  assert.deepEqual(events, ['document_recorded', 'document_updated']);
});

test('DOC · deleting a document keeps its history', async () => {
  const db = makeDb({ status: 'ASSIGNED' });
  const svc = docs(db);
  const doc = await svc.recordDocument(1, { document_type: 'LR', document_status: 'PRESENT' }, ADMIN);
  await svc.deleteDocument(1, doc.document_id, ADMIN);

  assert.equal(db.__state.tripDocuments.length, 0);
  const events = db.__state.tripTimeline.map((e) => e.event_type);
  assert.deepEqual(events, ['document_recorded', 'document_removed']);
});
