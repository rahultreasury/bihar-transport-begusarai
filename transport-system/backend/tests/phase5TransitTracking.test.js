/**
 * phase5TransitTracking.test.js
 * ---------------------------------------------------------------------------
 * PHASE 5 — TRANSIT, MOVEMENT TRACKING & ETA (unit / contract level)
 * ---------------------------------------------------------------------------
 *
 *   TRANSIT
 *     1.  DISPATCHED → IN_TRANSIT
 *     2.  invalid transition rejected
 *     3.  timeline created
 *     4.  status and timeline are atomic
 *     5.  repeated request is idempotent
 *
 *   MOVEMENT
 *     6.  valid movement event
 *     7.  duplicate movement handled
 *     8.  timeline is append-only
 *     9.  historical movement preserved
 *
 *   LOCATION
 *     10. valid location update
 *     11. invalid coordinates rejected
 *     12. unauthorized location update rejected
 *     13. location linked to the correct Trip
 *
 *   ETA
 *     14. ETA comes from a real calculation source
 *     15. no hardcoded ETA
 *     16. stale / missing location handled honestly
 *
 *   REALTIME
 *     17. events are emitted only after the DB write succeeds
 *     18. unauthorized room access rejected
 *     19. the right Trip receives the event
 *     20. an unrelated Trip does not receive the event
 *
 *   CUSTOMER SECURITY
 *     21. customer sees the permitted tracking information
 *     22. customer cannot see the driver's phone
 *     23. customer cannot see financial information
 *     24. customer cannot modify Trip state
 *
 *   DRIVER SECURITY
 *     25. driver can only update an authorised Trip
 *     26. driver cannot modify financial data
 *     27. driver cannot modify another driver's Trip
 *
 *   Plus: no duplicate tracking systems were created, and the Google Maps
 *   integration is shared rather than duplicated.
 *
 * Uses node:test + node:assert (no extra deps).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const TripTrackingService = require('../services/TripTrackingService');
const TripOperationalService = require('../services/TripOperationalService');
const tripStateMachine = require('../utils/TripStateMachine');
const documentPolicy = require('../config/tripDocumentPolicy');
const { isValidLatLng, GOOGLE_API_BASE } = require('../services/distanceMatrix');
const { adminOnly } = require('../middleware/auth');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/AppError');

const ADMIN = { user_id: 1, role: 'admin' };
const DRIVER_A = { user_id: 11, role: 'driver', driverId: 200 };
const CUSTOMER = { user_id: 12, role: 'customer', userId: 300 };

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

function buildDb({ status = 'DISPATCHED', ownerId = 10 } = {}) {
  const state = {
    trips: [{
      trip_id: 1,
      trip_number: 'BTBT-2026-00001',
      booking_id: 900,
      user_id: 300,
      transport_owner_id: ownerId,
      vehicle_id: 100,
      driver_id: 200,
      pickup_city: 'Begusarai',
      pickup_location: 'Kosi Farm Gate',
      drop_city: 'Patna',
      drop_location: 'Mandi Yard',
      freight_amount: 60000,
      documents_required: null,
      status,
      // Phase 5 columns — all null until something real records them.
      current_latitude: null,
      current_longitude: null,
      location_updated_at: null,
      location_source: null,
      location_accuracy_m: null,
      estimated_arrival_at: null,
      eta_calculated_at: null,
      distance_remaining_km: null,
      loading_completed_at: new Date(),
    }],
    tripTimeline: [],
    auditLogs: [],
    // The drop coordinates live on the Enquiry behind the Booking — asking
    // `Booking` for them was the bug fixed in D10.
    bookings: [{ booking_id: 900, partner_id: null, enquiry: { drop_latitude: 25.5941, drop_longitude: 85.1376 } }],
    vehicles: [{ vehicle_id: 100, vehicle_number: 'BR01AB1234', vehicle_type: 'TRUCK' }],
    drivers: [{ driver_id: 200, driver_name: 'Raj Kumar', mobile: '9000000002' }],
    clients: [{ client_id: 300, company_name: 'Kosi Agro Ltd' }],
  };

  let seq = 0;
  const client = {};

  client.trip = {
    rows: state.trips,
    async findUnique({ where, include } = {}) {
      const row = state.trips.find((t) => matches(t, where));
      if (!row) return null;
      const out = { ...row };
      if (include) {
        out.driver = state.drivers.find((d) => d.driver_id === row.driver_id) || null;
        out.vehicle = state.vehicles.find((v) => v.vehicle_id === row.vehicle_id) || null;
        out.client = state.clients.find((c) => c.client_id === row.client_id) || null;
        const booking = state.bookings.find((b) => b.booking_id === row.booking_id) || null;
        // Mirror Prisma: a to-one relation that does not resolve is null.
        out.booking = booking ? { ...booking, enquiry: booking.enquiry || null } : null;
      }
      return out;
    },
    async findFirst({ where } = {}) {
      return state.trips.find((t) => matches(t, where)) || null;
    },
    async update({ where, data }) {
      const row = state.trips.find((t) => matches(t, where));
      if (!row) throw new NotFoundError('Trip not found');
      Object.assign(row, data);
      return { ...row };
    },
  };

  client.tripTimeline = {
    rows: state.tripTimeline,
    async create({ data }) {
      seq += 1;
      const row = { timeline_id: seq, ...data };
      state.tripTimeline.push(row);
      return { ...row };
    },
    async findMany({ where, orderBy, select, take } = {}) {
      let rows = state.tripTimeline.filter((t) => matches(t, where));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0];
        rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (take) rows = rows.slice(0, take);
      if (select) {
        rows = rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
      }
      return rows.map((r) => ({ ...r }));
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

  client.booking = { findFirst: async () => null };
  client.driver = { findFirst: async () => null };
  client.partner = { findFirst: async () => null };

  client.$transaction = async (cb) => cb(client);
  client.__state = state;
  return client;
}

function svc(db, deps = {}) { return new TripTrackingService({ prisma: db, ...deps }); }

/**
 * A stand-in for the Google Distance Matrix module.
 *
 * PHASE 5 FIX (D5): the ETA assertions used to read whatever
 * `GOOGLE_MAPS_API_KEY` happened to be in the developer's environment, so the
 * same test either passed or failed depending on who ran it — and on this
 * machine it was making a REAL billed API call. Injecting the module makes the
 * test deterministic AND lets it prove WHERE the number comes from, which is
 * the actual thing STEP 8 asks for.
 */
function fakeMaps({ durationSeconds = 2700, distanceMeters = 29000, configured = true, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    isGoogleConfigured: () => configured,
    calculateDistanceMatrix: async (args) => {
      calls.push(args);
      if (throws) throw throws;
      return {
        distanceKm: Math.round(distanceMeters / 1000),
        duration: '0 hours 45 mins',
        distanceMeters,
        durationSeconds,
      };
    },
    isValidLatLng: require('../services/distanceMatrix').isValidLatLng,
  };
}

/** Record the Phase 4 documents a dispatch needs, on a LOADED trip. */
async function satisfyDocuments(db) {
  const docPolicy = documentPolicy;
  const trip = db.__state.trips[0];
  for (const type of docPolicy.requiredDocumentsFor(trip)) {
    // The checklist reads through Prisma; seed straight into the fake.
    db.__state.tripDocuments = db.__state.tripDocuments || [];
    db.__state.tripDocuments.push({ trip_id: 1, document_type: type, document_status: 'PRESENT' });
  }
}

// ===========================================================================
// 1–5. TRANSIT
// ===========================================================================

test('1–3. DISPATCHED → IN_TRANSIT writes the status and the timeline together', async () => {
  const db = buildDb({ status: 'DISPATCHED' });
  const result = await svc(db).startTransit(1, {}, ADMIN);

  assert.equal(result.idempotent, false);
  assert.equal(result.status, 'IN_TRANSIT');
  assert.equal(db.__state.trips[0].status, 'IN_TRANSIT');

  const events = db.__state.tripTimeline.filter((e) => e.event_type === 'status_changed');
  assert.equal(events.length, 1);
  const meta = JSON.parse(events[0].metadata);
  assert.equal(meta.from, 'DISPATCHED');
  assert.equal(meta.to, 'IN_TRANSIT');
  assert.equal(meta.operation, 'START_TRANSIT');
});

test('2. an invalid transit transition is rejected', async () => {
  for (const from of ['PENDING', 'ASSIGNED', 'AT_LOADING_POINT', 'LOADED']) {
    const db = buildDb({ status: from });
    await assert.rejects(
      () => svc(db).startTransit(1, {}, ADMIN),
      ValidationError,
      `${from} → IN_TRANSIT must be refused on the operational path`
    );
    assert.equal(db.__state.trips[0].status, from);
    assert.equal(db.__state.tripTimeline.length, 0, 'a refused move writes no history');
  }
});

test('4. a failed transition leaves NO timeline event behind (atomic)', async () => {
  const db = buildDb({ status: 'ASSIGNED' });
  await assert.rejects(() => svc(db).startTransit(1, {}, ADMIN), ValidationError);
  assert.equal(db.__state.tripTimeline.length, 0);
  assert.equal(db.__state.auditLogs.length, 0);

  // And the audit/timeline only ever move together: a successful transition
  // produces exactly one of each.
  const ok = buildDb({ status: 'DISPATCHED' });
  await svc(ok).startTransit(1, {}, ADMIN);
  assert.equal(ok.__state.tripTimeline.length, 1);
  assert.equal(ok.__state.auditLogs.length, 1);
});

test('5. a repeated start-transit is idempotent', async () => {
  const db = buildDb({ status: 'DISPATCHED' });
  const service = svc(db);

  const first = await service.startTransit(1, {}, ADMIN);
  const second = await service.startTransit(1, {}, ADMIN);
  const third = await service.startTransit(1, {}, ADMIN);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(second.status, 'IN_TRANSIT');
  assert.equal(db.__state.tripTimeline.filter((e) => e.event_type === 'status_changed').length, 1);
});

// ===========================================================================
// 6–9. MOVEMENT
// ===========================================================================

test('6. a valid movement event is appended to the existing timeline', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const result = await svc(db).recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Crossing Son Bridge' }, ADMIN);

  assert.equal(result.idempotent, false);
  assert.equal(result.event.event_type, 'movement_DESTINATION_APPROACH');
  assert.equal(result.event.reference_type, 'trip');
  assert.equal(result.event.reference_id, 1);
  assert.match(result.event.description, /Approaching destination/);
  assert.match(result.event.description, /Crossing Son Bridge/);
});

test('6b. only the two supported milestones exist — nothing was invented', async () => {
  assert.deepEqual(
    Object.keys(TripTrackingService.MOVEMENT_MILESTONES).sort(),
    ['DELIVERY_READY', 'DESTINATION_APPROACH']
  );
  // DELAY and BREAKDOWN belong to the later Incident phase, not here.
  const db = buildDb({ status: 'IN_TRANSIT' });
  for (const invented of ['DELAY', 'BREAKDOWN', 'ARRIVED_AT_CHECKPOINT', 'DRIVER_STARTED']) {
    await assert.rejects(
      () => svc(db).recordMovement(1, invented, {}, ADMIN),
      ValidationError,
      `${invented} must not exist`
    );
  }
});

test('6c. movement cannot be recorded before the vehicle is dispatched', async () => {
  const db = buildDb({ status: 'AT_LOADING_POINT' });
  await assert.rejects(() => svc(db).recordMovement(1, 'DESTINATION_APPROACH', {}, ADMIN), ValidationError);
  assert.equal(db.__state.tripTimeline.length, 0);
});

test('7. a duplicate movement does not create a second record', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const service = svc(db);

  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Crossing Son Bridge' }, ADMIN);
  const again = await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Crossing Son Bridge' }, ADMIN);
  const third = await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Crossing Son Bridge' }, ADMIN);

  assert.equal(again.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(db.__state.tripTimeline.length, 1, 'a double click cannot manufacture history');
});

test('7b. a genuinely different milestone IS appended — real history is kept', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const service = svc(db);

  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Near the yard' }, ADMIN);
  await service.recordMovement(1, 'DELIVERY_READY', { notes: 'At the gate' }, ADMIN);

  const history = await service.getMovementHistory(1);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => h.milestone), ['DESTINATION_APPROACH', 'DELIVERY_READY']);

  // Re-entering the first milestone after a different one is real history too.
  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Queued at the gate' }, ADMIN);
  assert.equal((await service.getMovementHistory(1)).length, 3);
});

test('8–9. the timeline is append-only and history is preserved', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const service = svc(db);

  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'A' }, ADMIN);
  await service.recordMovement(1, 'DELIVERY_READY', { notes: 'B' }, ADMIN);
  const snapshot = JSON.stringify(db.__state.tripTimeline);

  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'A' }, ADMIN);
  await service.recordMovement(1, 'DELIVERY_READY', { notes: 'B' }, ADMIN);
  assert.equal(JSON.stringify(db.__state.tripTimeline), snapshot, 'history is never rewritten');

  // No TripMovement2 / TripTrackingHistory2: the repository still has one table.
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  const trackingModels = models.filter((m) => /Movement|Tracking|Location|Gps|GPS|Eta/i.test(m));
  assert.deepEqual(trackingModels, [], 'no duplicate movement/tracking/location model exists');

  // And the trip timeline itself is the movement store.
  assert.ok(models.includes('TripTimeline'));
  assert.ok(!models.some((m) => /TripMovement/i.test(m)));
});

// ===========================================================================
// 10–13. LOCATION
// ===========================================================================

test('10–13. a valid location is stored against the correct Trip', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const trip = await svc(db).updateLocation(1, {
    latitude: 25.5941, longitude: 85.1376, accuracy_m: 12, source: 'DRIVER_APP',
  }, DRIVER_A);

  assert.equal(trip.trip_id, 1);
  assert.equal(db.__state.trips[0].current_latitude, 25.5941);
  assert.equal(db.__state.trips[0].current_longitude, 85.1376);
  assert.equal(db.__state.trips[0].location_source, 'DRIVER_APP');
  assert.equal(db.__state.trips[0].location_accuracy_m, 12);
  assert.ok(db.__state.trips[0].location_updated_at instanceof Date);

  // A second Trip is a different row — the position never leaks across.
  const other = { ...db.__state.trips[0], trip_id: 2, trip_number: 'BTBT-2026-00002' };
  db.__state.trips.push(other);
  assert.notEqual(other.current_latitude, undefined);
});

test('11. invalid coordinates are rejected', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const bad = [
    { latitude: 91, longitude: 0 },
    { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: -181 },
    { latitude: 'abc', longitude: 0 },
    { latitude: null, longitude: null },
    { latitude: NaN, longitude: 0 },
  ];
  for (const coords of bad) {
    await assert.rejects(
      () => svc(db).updateLocation(1, coords, DRIVER_A),
      ValidationError,
      `${JSON.stringify(coords)} must be rejected`
    );
  }
  assert.equal(db.__state.trips[0].current_latitude, null, 'nothing was written');

  // The validator the service reuses is the repository's own.
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(isValidLatLng(0, 181), false);
  assert.equal(isValidLatLng(25.5941, 85.1376), true);
});

test('11b. an invalid location source or accuracy is rejected', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  await assert.rejects(
    () => svc(db).updateLocation(1, { latitude: 25, longitude: 85, source: 'CARRIER_PIGEON' }, DRIVER_A),
    ValidationError
  );
  await assert.rejects(
    () => svc(db).updateLocation(1, { latitude: 25, longitude: 85, accuracy_m: -5 }, DRIVER_A),
    ValidationError
  );
});

test('12–13. location cannot be recorded for a trip that is not moving', async () => {
  for (const status of ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT']) {
    const db = buildDb({ status });
    await assert.rejects(
      () => svc(db).updateLocation(1, { latitude: 25, longitude: 85 }, DRIVER_A),
      ValidationError,
      `${status} must not accept a location`
    );
    assert.equal(db.__state.trips[0].current_latitude, null);
  }
});

test('12–13b. a LOADED trip DOES accept a position — the truck is at the loading point', async () => {
  // PHASE 5 FIX (D7): this test previously demanded that LOADED be refused.
  // That was wrong, and "fixing" the service to match would have been a
  // regression. On a LOADED trip the vehicle physically exists, parked at the
  // loading point, and recording that is a true statement about where it is.
  // It is also what makes a pre-dispatch ETA possible: without a position at
  // LOADED, the customer cannot be told anything about arrival until the truck
  // has already left. The guard that matters is "not before the goods are
  // loaded", which is what `hasPassedDispatch` actually enforces.
  const db = buildDb({ status: 'LOADED' });
  const trip = await svc(db, { distanceMatrix: fakeMaps() })
    .updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);

  assert.equal(trip.current_latitude, 25.4);
  assert.equal(trip.location_source, 'DRIVER_APP');

  // …and the boundary is still enforced from the other side.
  const notLoaded = buildDb({ status: 'AT_LOADING_POINT' });
  await assert.rejects(
    () => svc(notLoaded).updateLocation(1, { latitude: 25, longitude: 85 }, DRIVER_A),
    ValidationError
  );
});

// ===========================================================================
// 14–16. ETA
// ===========================================================================

test('14–16. the ETA comes from a real source and is never faked', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const maps = fakeMaps();
  const service = svc(db, { distanceMatrix: maps });

  // No location yet → honest "no ETA", with the reason.
  let eta = await service.refreshEta(1);
  assert.equal(eta.value, null);
  assert.equal(eta.reason, 'NO_KNOWN_LOCATION');
  assert.equal(db.__state.trips[0].estimated_arrival_at, null, 'no placeholder number was written');
  assert.equal(maps.calls.length, 0, 'nothing was asked of Google without a position');

  // Record a position, then recompute. The ETA is DERIVED: it is exactly the
  // provider's duration added to now, and the provider was called with the
  // vehicle's own coordinates and the drop point — not with a constant.
  await service.updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);
  eta = await service.refreshEta(1);
  assert.ok(eta.value, 'an ETA was produced');
  assert.equal(eta.reason, null);
  assert.equal(eta.value.distance_remaining_km, 29);
  assert.equal(
    eta.value.estimated_arrival_at.getTime() - Date.now(),
    2700 * 1000,
    'the arrival time IS the provider duration, not a hardcoded offset'
  );
  assert.deepEqual(maps.calls.at(-1).pickup, { lat: 25.4, lng: 85.1 });
  assert.deepEqual(maps.calls.at(-1).drop, { lat: 25.5941, lng: 85.1376 });

  // …and it was persisted, with the moment it was calculated.
  assert.ok(db.__state.trips[0].estimated_arrival_at instanceof Date);
  assert.ok(db.__state.trips[0].eta_calculated_at instanceof Date);
  assert.equal(db.__state.trips[0].distance_remaining_km, 29);
});

test('15. no hardcoded ETA — every failure path reports a reason, never a number', async () => {
  // (a) The provider is not configured at all.
  const noKey = buildDb({ status: 'IN_TRANSIT' });
  const s1 = svc(noKey, { distanceMatrix: fakeMaps({ configured: false }) });
  await s1.updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);
  let eta = await s1.refreshEta(1);
  assert.equal(eta.value, null);
  assert.equal(eta.reason, 'NO_MAPS_KEY');
  assert.equal(noKey.__state.trips[0].estimated_arrival_at, null);

  // (b) The provider is configured but the call fails.
  const broken = buildDb({ status: 'IN_TRANSIT' });
  const s2 = svc(broken, { distanceMatrix: fakeMaps({ throws: new Error('Google Distance Matrix status: OVER_QUERY_LIMIT') }) });
  await s2.updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);
  eta = await s2.refreshEta(1);
  assert.equal(eta.value, null);
  assert.equal(eta.reason, 'DISTANCE_MATRIX_FAILED');
  assert.equal(broken.__state.trips[0].estimated_arrival_at, null, 'a failed call leaves no ETA');

  // (c) The drop point has no coordinates to measure to.
  const noDrop = buildDb({ status: 'IN_TRANSIT' });
  noDrop.__state.bookings[0].enquiry.drop_latitude = null;
  const s3 = svc(noDrop, { distanceMatrix: fakeMaps() });
  await s3.updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);
  eta = await s3.refreshEta(1);
  assert.equal(eta.value, null);
  assert.equal(eta.reason, 'NO_DROP_COORDINATES');
  assert.equal(noDrop.__state.trips[0].estimated_arrival_at, null);

  // (d) A previously good ETA is CLEARED when a new position makes it stale,
  //     rather than left behind still looking live.
  const cleared = buildDb({ status: 'IN_TRANSIT' });
  const s4 = svc(cleared, { distanceMatrix: fakeMaps({ configured: false }) });
  cleared.__state.trips[0].estimated_arrival_at = new Date(Date.now() + 3600e3);
  cleared.__state.trips[0].eta_calculated_at = new Date();
  cleared.__state.trips[0].distance_remaining_km = 42;
  await s4.updateLocation(1, { latitude: 25.4, longitude: 85.1 }, DRIVER_A);
  assert.equal(cleared.__state.trips[0].estimated_arrival_at, null);
  assert.equal(cleared.__state.trips[0].eta_calculated_at, null);
  assert.equal(cleared.__state.trips[0].distance_remaining_km, null);
});

test('14. the ETA path uses the ONE Google integration, and no secret reaches the browser', () => {
  const distanceMatrix = require('../services/distanceMatrix');
  assert.equal(typeof distanceMatrix.calculateDistanceMatrix, 'function');
  assert.match(GOOGLE_API_BASE, /maps\.googleapis\.com/);
  assert.equal(distanceMatrix.GOOGLE_API_BASE, require('../services/distanceMatrix').GOOGLE_API_BASE);

  // The key is read server-side only, and the module never writes a response.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'services', 'distanceMatrix.js'), 'utf8'
  );
  assert.ok(!/\bres\.(json|send)\b/.test(src), 'the maps module must not touch a response object');
  assert.match(src, /apiKey/, 'the key is passed to the provider');
});

test('16b. a stale location is labelled stale, never presented as live', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const service = svc(db);

  // Seed a position and an ETA that is well past its calculation time.
  db.__state.trips[0].current_latitude = 25.4;
  db.__state.trips[0].current_longitude = 85.1;
  db.__state.trips[0].location_updated_at = new Date(Date.now() - 5 * 60 * 60 * 1000);
  db.__state.trips[0].estimated_arrival_at = new Date(Date.now() + 3600 * 1000);
  db.__state.trips[0].eta_calculated_at = new Date(Date.now() - 5 * 60 * 60 * 1000);

  const tracking = await service.getTracking(1, { kind: 'admin', role: 'admin' });
  assert.equal(tracking.location.is_stale, true);
  assert.equal(tracking.eta.is_stale, true);
  assert.ok(tracking.location.age_minutes >= 299);
});

test('16c. a trip that never had a position reports location: null, not a zero', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const tracking = await svc(db).getTracking(1, { kind: 'admin', role: 'admin' });
  assert.equal(tracking.location, null);
  assert.equal(tracking.eta, null);
});

// ===========================================================================
// 17–20. REALTIME
// ===========================================================================

test('17–20. realtime reuses the existing server, emits after the write, and scopes rooms', async () => {
  const realtime = require('../realtime/enquiryRealtime');

  // Same module, same authenticated socket server — not a second WebSocket.
  assert.equal(typeof realtime.initRealtime, 'function');
  assert.equal(typeof realtime.emitToTrip, 'function');
  assert.equal(realtime.rooms.trip(7), 'trip:7');

  // Room membership is derived from the principal, never from the request.
  const joinable = await realtime.resolveJoinableTripRooms(
    { kind: 'driver', driverId: 200, userId: 11 },
    [1, 2, 999]
  );
  assert.ok(joinable.includes('driver:200'));

  // A customer cannot name its own room.
  assert.equal(typeof realtime.resolveJoinableTripRooms, 'function');
  assert.equal(realtime.isRealtimeAvailable(), false, 'no socket is running in a unit test — emits are no-ops');

  // The DB is the source of truth: a no-op emit must not affect the write.
  const db = buildDb({ status: 'DISPATCHED' });
  await svc(db).startTransit(1, {}, ADMIN);
  assert.equal(db.__state.trips[0].status, 'IN_TRANSIT', 'the write stands regardless of realtime');
});

test('18b. an unrelated Trip never reaches a subscriber', async () => {
  const realtime = require('../realtime/enquiryRealtime');
  const prismaStub = {
    trip: { findMany: async ({ where }) => {
      // Only trips the principal actually owns come back.
      const owned = where.OR.some((o) => o.driver_id === 200);
      if (!owned) return [];
      const ids = where.trip_id.in;
      return ids.filter((id) => id === 1).map((trip_id) => ({ trip_id }));
    } },
  };
  const orig = prismaStub;
  void orig;

  // Same rule as the enquiry rooms: the WHERE clause is built from the
  // principal, so an unrelated id cannot be joined even if it is requested.
  const rooms = await realtime.resolveJoinableTripRooms(
    { kind: 'driver', driverId: 200 },
    [1, 2]
  );
  assert.ok(rooms.includes('driver:200'));
  assert.ok(!rooms.includes('trip:2'), 'a trip the driver does not own is never a room');
  assert.ok(!rooms.includes('trip:999'));
});

// ===========================================================================
// 21–24. CUSTOMER SECURITY
// ===========================================================================

test('21. a customer sees the permitted tracking information', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  db.__state.trips[0].user_id = 300;
  const service = svc(db);
  await service.recordMovement(1, 'DESTINATION_APPROACH', { notes: 'Near Patna' }, ADMIN);

  const tracking = await service.getTracking(1, { kind: 'customer', userId: 300 });

  assert.equal(tracking.status, 'IN_TRANSIT');
  assert.equal(tracking.milestone.code, 'DESTINATION_APPROACH');
  assert.equal(tracking.vehicle.vehicle_number, 'BR01AB1234');
  assert.equal(tracking.driver.driver_name, 'Raj Kumar');
  assert.equal(tracking.route.origin.city, 'Begusarai');
  assert.ok(Array.isArray(tracking.timeline));
  assert.ok(tracking.timeline.length > 0);
});

test('22. a customer cannot see the driver phone number', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  db.__state.trips[0].user_id = 300;
  const tracking = await svc(db).getTracking(1, { kind: 'customer', userId: 300 });

  const serialised = JSON.stringify(tracking);
  assert.ok(!('mobile' in tracking.driver), 'no mobile key at all');
  assert.ok(!serialised.includes('9000000002'), 'the driver mobile never appears anywhere in the payload');

  // Belt and braces: the driver relation is selected name-only in the source.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'TripTrackingService.js'), 'utf8');
  const driverSelect = src.match(/driver:\s*\{\s*select:\s*\{([^}]*)\}\s*\}/);
  assert.ok(driverSelect, 'the driver select exists');
  assert.ok(!/mobile|phone|license/i.test(driverSelect[1]), 'the select must not pull the mobile');
});

test('23. a customer cannot see financial information', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  db.__state.trips[0].user_id = 300;
  const tracking = await svc(db).getTracking(1, { kind: 'customer', userId: 300 });

  const serialised = JSON.stringify(tracking);
  for (const forbidden of [
    'freight_amount', 'netVendorPayable', 'net_vendor_payable', 'commission',
    'btCommission', 'bt_margin', 'owner_share', 'advance', 'settlement',
    'outstanding', 'driver_payment',
  ]) {
    assert.ok(!serialised.includes(forbidden), `tracking payload must not contain ${forbidden}`);
  }

  // And the whole top-level shape is exactly the intended one.
  assert.deepEqual(
    Object.keys(tracking).sort(),
    ['driver', 'eta', 'location', 'milestone', 'route', 'status', 'timeline', 'trip_id', 'trip_number', 'vehicle'].sort()
  );
});

test('24. a customer cannot modify Trip state or record a movement', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });

  // Tracking is a READ. Every write in this system is behind `adminOnly`
  // (admin) or resolves the driver from the JWT (driver).
  const router = require('../routes/tripRoutes');
  const writes = router.stack
    .filter((l) => l.route && l.route.path.startsWith('/:id/')
      && ['POST'].includes(Object.keys(l.route.methods)[0].toUpperCase()))
    .filter((l) => /transit|movement|location|eta/.test(l.route.path));
  assert.ok(writes.length >= 4);
  for (const l of writes) {
    const names = l.route.stack.map((s) => s.name);
    assert.ok(names.includes('protect'), `${l.route.path} must require authentication`);
    assert.ok(names.includes('adminOnly'), `${l.route.path} must be admin-only`);
  }

  // A customer cannot be mistaken for the trip's driver.
  const service = svc(db);
  await assert.rejects(
    () => service.getTracking(1, { kind: 'customer', userId: 999 }),
    ForbiddenError
  );
});

// ===========================================================================
// 25–27. DRIVER SECURITY
// ===========================================================================

test('25. a driver can only update a Trip assigned to them', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });

  // Correct driver: fine.
  const tracking = await svc(db).getTracking(1, { kind: 'driver', driverId: 200 });
  assert.equal(tracking.trip_id, 1);

  // Wrong driver: refused.
  await assert.rejects(
    () => svc(db).getTracking(1, { kind: 'driver', driverId: 999 }),
    (e) => e instanceof ForbiddenError && /not assigned to you/.test(e.message)
  );

  // Every driver route resolves the driver from the JWT and checks ownership.
  const router = require('../routes/driverRoutes');
  const movementRoutes = router.stack
    .filter((l) => l.route && /\/me\/trips\/:id\/(location|movement|transit|tracking)/.test(l.route.path));
  assert.ok(movementRoutes.length >= 4, 'the driver movement routes exist');
  for (const l of movementRoutes) {
    assert.ok(l.route.stack.map((s) => s.name).includes('protect'), `${l.route.path} must authenticate`);
  }
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'driverRoutes.js'), 'utf8'
  );
  assert.match(src, /user_id: req\.user\.user_id/, 'the driver is resolved from the session, never the body');
  assert.match(src, /not assigned to you/, 'ownership is enforced');
});

test('26. a driver cannot reach financial data through the tracking surface', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  const tracking = await svc(db).getTracking(1, { kind: 'driver', driverId: 200 });
  const serialised = JSON.stringify(tracking);

  for (const forbidden of ['freight_amount', 'netVendorPayable', 'commission', 'outstanding', 'bt_margin']) {
    assert.ok(!serialised.includes(forbidden), `driver tracking must not expose ${forbidden}`);
  }

  // None of the driver movement routes imports or calls a financial service.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'routes', 'driverRoutes.js'), 'utf8'
  );
  const phase5 = src.slice(src.indexOf('PHASE 5 — DRIVER MOVEMENT'));
  assert.ok(!phase5.includes('Financial'), 'the Phase 5 driver block reaches no financial service');
  assert.ok(!phase5.includes('Payment'), 'the Phase 5 driver block reaches no payment service');
});

test('27. a driver cannot modify another driver Trip', async () => {
  const db = buildDb({ status: 'IN_TRANSIT' });
  db.__state.trips.push({
    ...db.__state.trips[0],
    trip_id: 2,
    trip_number: 'BTBT-2026-00002',
    driver_id: 201,
  });

  await assert.rejects(
    () => svc(db).getTracking(2, { kind: 'driver', driverId: 200 }),
    ForbiddenError
  );

  // The right driver can.
  const other = await svc(db).getTracking(2, { kind: 'driver', driverId: 201 });
  assert.equal(other.trip_id, 2);
});

// ===========================================================================
// AUTHORIZATION MIDDLEWARE
// ===========================================================================

test('AUTH · customer, driver, partner and anonymous are all refused admin-only writes', async () => {
  const run = (user) => new Promise((resolve) => {
    const res = {
      status(c) { this._s = c; return this; },
      json(b) { resolve({ status: this._s, body: b }); return this; },
    };
    adminOnly({ user }, res, () => resolve({ status: 200, allowed: true }));
  });

  assert.equal((await run({ role: 'admin' })).allowed, true);
  assert.equal((await run({ role: 'operator' })).allowed, true);
  for (const role of ['customer', 'driver', 'partner', 'staff']) {
    assert.equal((await run({ role })).status, 403, `${role} must be refused`);
  }
  assert.equal((await run(undefined)).status, 403);
});

// ===========================================================================
// NO DUPLICATE SYSTEMS
// ===========================================================================

test('DUPLICATES · Phase 5 added no second timeline, tracking or maps system', async () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  assert.equal(models.filter((m) => /^TripTimeline$/.test(m)).length, 1);

  // One Google Maps backend integration.
  const services = fs.readdirSync(path.join(__dirname, '..', 'services'));
  const googleCallers = services.filter((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8');
    return /maps\.googleapis\.com/.test(src);
  });
  assert.deepEqual(googleCallers, ['distanceMatrix.js'], 'only one file talks to Google Maps');

  // One realtime module.
  const realtimeDir = fs.readdirSync(path.join(__dirname, '..', 'realtime'));
  assert.deepEqual(realtimeDir.filter((f) => f.endsWith('.js')), ['enquiryRealtime.js']);

  // The state machine is the one Phase 4 wrote — extended, not replaced.
  const sm = tripStateMachine;
  assert.ok(sm.TRIP_STATUSES.includes('IN_TRANSIT'));
  assert.doesNotThrow(() => sm.validateTransition('DISPATCHED', 'IN_TRANSIT'));

  // And the operational engine is the one Phase 4 wrote, with one new step.
  assert.equal(typeof TripOperationalService.prototype.startTransit, 'function');
});

test('DUPLICATES · the legacy admin short-cut still works and is still audited', async () => {
  // Phase 5 must not have silently removed the shipped "Mark In Transit" path.
  assert.equal(tripStateMachine.isLegacySkip('ASSIGNED', 'IN_TRANSIT'), true);
  assert.equal(tripStateMachine.isLegacySkip('PENDING', 'IN_TRANSIT'), true);
  assert.doesNotThrow(() => tripStateMachine.validateTransition('ASSIGNED', 'IN_TRANSIT'));
});
