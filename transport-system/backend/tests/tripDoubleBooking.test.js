// Test the STEP 2B double-booking guard in TripService.
// Uses an in-memory mock of the Prisma client so it runs without a real DB.

const test = require('node:test');
const assert = require('node:assert/strict');

// Build a minimal in-memory mock of the bits TripService touches.
// TripService imports a few repositories; we satisfy them with stub instances
// because this test is scoped to assertTripResourcesAvailable + createTrip +
// updateTrip resource-conflict detection only.
const memory = {
  trips: [],
  auditLogs: [],
  nextTripId: 1,
  nextTripNumber: 1,
  // STEP 2B.1: track advisory-lock acquisitions.
  advisoryLocks: [],
};

function makePrismaMock() {
  const tripState = memory.trips;

  return {
    trip: {
      create: async ({ data }) => {
        const trip = {
          trip_id: memory.nextTripId++,
          trip_number: `BTBT-${memory.nextTripNumber++}`,
          status: data.status || 'PENDING',
          driver_id: data.driver_id,
          vehicle_id: data.vehicle_id,
          transport_owner_id: data.transport_owner_id,
          user_id: data.user_id,
          ...data,
        };
        tripState.push(trip);
        return trip;
      },
      findFirst: async ({ where }) => {
        // Used by assertTripResourcesAvailable for conflict checks.
        return (
          tripState.find((t) => {
            if (where.NOT && where.NOT.trip_id && t.trip_id === where.NOT.trip_id) {
              return false;
            }
            if (where.status && where.status.in && !where.status.in.includes(t.status)) {
              return false;
            }
            if (where.driver_id !== undefined && t.driver_id !== where.driver_id) {
              return false;
            }
            if (where.vehicle_id !== undefined && t.vehicle_id !== where.vehicle_id) {
              return false;
            }
            return true;
          }) || null
        );
      },
      findUnique: async ({ where }) => {
        // TripRepository calls include TripInclude; mock ignores the include shape
        // because tests don't depend on the nested relations.
        return tripState.find((t) => t.trip_id === where.trip_id) || null;
      },
      update: async ({ where, data }) => {
        const idx = tripState.findIndex((t) => t.trip_id === where.trip_id);
        if (idx === -1) throw new Error('Trip not found');
        tripState[idx] = { ...tripState[idx], ...data };
        return tripState[idx];
      },
      count: async () => tripState.length,
      aggregate: async () => ({ _sum: { amount: 0 } }),
      groupBy: async () => [],
    },
    tripExpense: { aggregate: async () => ({ _sum: { amount: 0 } }), findMany: async () => [] },
    tripPayment: { aggregate: async () => ({ _sum: { amount: 0 } }), findMany: async () => [] },
    driver: {
      findUnique: async ({ where }) => ({
        driver_id: where.driver_id,
        driver_name: `Driver ${where.driver_id}`,
        transport_owner_id: baseOwnerId,
      }),
      findFirst: async () => null,
      update: async ({ where, data }) => {
        const driver = memory.drivers?.get?.(where.driver_id);
        if (driver) Object.assign(driver, data);
        return { driver_id: where.driver_id, ...data };
      },
    },
    transportVehicle: {
      findUnique: async ({ where }) => ({
        vehicle_id: where.vehicle_id,
        vehicle_number: `VH ${where.vehicle_id}`,
        owner_id: baseOwnerId,
      }),
      update: async ({ where, data }) => {
        const vehicle = memory.vehicles?.get?.(where.vehicle_id);
        if (vehicle) Object.assign(vehicle, data);
        return { vehicle_id: where.vehicle_id, ...data };
      },
    },
    vehicleOwner: {
      findUnique: async ({ where }) => ({
        owner_id: where.owner_id,
        owner_name: `Owner ${where.owner_id}`,
        owner_type: 'TRANSPORT_COMPANY',
      }),
    },
    user: {
      findUnique: async ({ where }) => ({
        user_id: where.user_id,
        first_name: `User ${where.user_id}`,
      }),
    },
    booking: { findUnique: async () => null },
    auditLog: { create: async ({ data }) => memory.auditLogs.push(data) },
    $transaction: async (fnOrArr) => {
      // Interactive transaction — execute the callback with a tx wrapper.
      if (typeof fnOrArr === 'function') {
        return fnOrArr(makePrismaMock());
      }
      // Array form
      return Promise.all(fnOrArr);
    },
    // STEP 2B.1: $executeRaw is used by the advisory-lock helper.
    // In the mock we no-op (tests run in a single process, no real DB),
    // but we record the lock keys so tests can assert the right keys
    // were acquired.
    $executeRaw: async (strings, ...values) => {
      const tag = strings.join('|');
      if (tag.includes('pg_advisory_xact_lock')) {
        // Prisma tagged-template raw call: extract the two int4 params.
        const [ns, id] = values;
        memory.advisoryLocks.push({ ns, id });
      }
      return undefined;
    },
    $queryRaw: async () => [],
  };
}

// Inject the mock by overriding require cache for config/prisma.
const prismaPath = require.resolve('../config/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma: makePrismaMock() },
};

const TripService = require('../services/TripService');

function reset() {
  memory.trips.length = 0;
  memory.auditLogs.length = 0;
  memory.advisoryLocks.length = 0;
  memory.nextTripId = 1;
  memory.nextTripNumber = 1;
}

const baseOwnerId = 10;
const baseVehicleId = 100;
const baseDriverId = 200;
const baseUserId = 300;

const validPayload = () => ({
  user_id: baseUserId,
  transport_owner_id: baseOwnerId,
  vehicle_id: baseVehicleId,
  driver_id: baseDriverId,
  pickup_location: 'A',
  pickup_city: 'Begusarai',
  drop_location: 'B',
  drop_city: 'Patna',
  freight_amount: 1000,
});

test('STEP 2B — fresh trip creation succeeds with no conflicts', async () => {
  reset();
  const svc = new TripService();
  const trip = await svc.createTrip(validPayload());
  assert.ok(trip.trip_id);
  assert.equal(trip.status, 'PENDING');
});

test('STEP 2B — creating a 2nd active trip with the same driver fails', async () => {
  reset();
  const svc = new TripService();

  // First trip — succeeds.
  await svc.createTrip(validPayload());

  // Second trip — same driver, different vehicle (to isolate the driver conflict).
  await assert.rejects(
    svc.createTrip({
      ...validPayload(),
      vehicle_id: baseVehicleId + 1,
    }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.code, 'DRIVER_UNAVAILABLE');
      assert.equal(err.conflict.driverBusy, true);
      assert.equal(err.conflict.vehicleBusy, false);
      assert.match(err.message, /Driver is already assigned/);
      return true;
    }
  );
});

test('STEP 2B — creating a 2nd active trip with the same vehicle fails', async () => {
  reset();
  const svc = new TripService();

  await svc.createTrip(validPayload());

  await assert.rejects(
    svc.createTrip({
      ...validPayload(),
      driver_id: baseDriverId + 1,
    }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.code, 'VEHICLE_UNAVAILABLE');
      assert.equal(err.conflict.driverBusy, false);
      assert.equal(err.conflict.vehicleBusy, true);
      return true;
    }
  );
});

test('STEP 2B — creating a 2nd trip with both driver and vehicle busy reports BOTH', async () => {
  reset();
  const svc = new TripService();

  await svc.createTrip(validPayload());

  await assert.rejects(
    svc.createTrip({ ...validPayload() }),
    (err) => {
      assert.equal(err.code, 'DRIVER_AND_VEHICLE_UNAVAILABLE');
      assert.equal(err.conflict.driverBusy, true);
      assert.equal(err.conflict.vehicleBusy, true);
      return true;
    }
  );
});

test('STEP 2B — reassigning a trip to a busy driver fails', async () => {
  reset();
  const svc = new TripService();

  // Trip A — driver A, vehicle A.
  const tripA = await svc.createTrip(validPayload());
  // Trip B — different driver, different vehicle.
  const tripB = await svc.createTrip({
    ...validPayload(),
    driver_id: baseDriverId + 1,
    vehicle_id: baseVehicleId + 1,
  });

  // Now try to reassign Trip B's driver to driver A (who is on Trip A).
  await assert.rejects(
    svc.updateTrip(tripB.trip_id, { driver_id: baseDriverId }),
    (err) => {
      assert.equal(err.code, 'DRIVER_UNAVAILABLE');
      return true;
    }
  );

  // Trip B should be unchanged.
  const stillB = await svc.tripRepo.findById(tripB.trip_id);
  assert.equal(stillB.driver_id, baseDriverId + 1);
  assert.equal(tripA.trip_id, memory.trips[0].trip_id);
});

test('STEP 2B — reassigning a trip to a busy vehicle fails', async () => {
  reset();
  const svc = new TripService();

  const tripA = await svc.createTrip(validPayload());
  const tripB = await svc.createTrip({
    ...validPayload(),
    driver_id: baseDriverId + 1,
    vehicle_id: baseVehicleId + 1,
  });

  await assert.rejects(
    svc.updateTrip(tripB.trip_id, { vehicle_id: baseVehicleId }),
    (err) => {
      assert.equal(err.code, 'VEHICLE_UNAVAILABLE');
      return true;
    }
  );
});

test('STEP 2B — driver/vehicle become available again after trip is CANCELLED', async () => {
  reset();
  const svc = new TripService();

  const tripA = await svc.createTrip(validPayload());

  // Move Trip A to a terminal status (CANCELLED).
  await svc.updateTripStatus(tripA.trip_id, 'CANCELLED', { role: 'admin' });

  // Now a 2nd trip with the same driver/vehicle should succeed.
  const tripB = await svc.createTrip({
    ...validPayload(),
    user_id: baseUserId + 1,
  });
  assert.ok(tripB.trip_id);
});

test('STEP 2B — driver/vehicle become available again after trip is COMPLETED', async () => {
  reset();
  const svc = new TripService();

  const tripA = await svc.createTrip(validPayload());
  await svc.updateTripStatus(tripA.trip_id, 'COMPLETED', { role: 'admin' });

  const tripB = await svc.createTrip({
    ...validPayload(),
    user_id: baseUserId + 1,
  });
  assert.ok(tripB.trip_id);
});

test('STEP 2B — driver on a non-active (CANCELLED) trip does not block a new active trip', async () => {
  reset();
  const svc = new TripService();

  const tripA = await svc.createTrip(validPayload());
  await svc.updateTripStatus(tripA.trip_id, 'CANCELLED', { role: 'admin' });

  // Now try a new trip with the same driver — should succeed.
  const tripB = await svc.createTrip({
    ...validPayload(),
    user_id: baseUserId + 1,
  });
  assert.notEqual(tripA.trip_id, tripB.trip_id);
});

test('STEP 2B — updating a trip without changing driver/vehicle skips the check', async () => {
  reset();
  const svc = new TripService();

  const trip = await svc.createTrip(validPayload());
  // No driver/vehicle change — should pass.
  const updated = await svc.updateTrip(trip.trip_id, { notes: 'updated' });
  assert.equal(updated.notes, 'updated');
});

test('STEP 2B — updating trip to same driver/vehicle is NOT a conflict (no false positive)', async () => {
  reset();
  const svc = new TripService();

  const trip = await svc.createTrip(validPayload());

  // Setting the same driver_id should not throw.
  const updated = await svc.updateTrip(trip.trip_id, {
    driver_id: baseDriverId,
    vehicle_id: baseVehicleId,
    notes: 'noop change',
  });
  assert.equal(updated.notes, 'noop change');
});

// =============================================================================
// STEP 2B.1 — Concurrency-safety tests
// =============================================================================
//
// These tests verify the advisory-lock acquisition path. They do NOT exercise
// real Postgres lock semantics — that requires a live database and is out of
// scope for the current in-memory mock. What they DO verify:
//   1. pg_advisory_xact_lock is invoked with a stable, deterministic key.
//   2. Two createTrip calls acquire the SAME key for the same driver/vehicle.
//   3. Different drivers/vehicles acquire DIFFERENT keys (no unnecessary blocking).
//   4. Lock acquisition order is deterministic (sorted) to prevent deadlocks.
//   5. updateTrip self-exclusion still works under the locked path.

test('STEP 2B.1 — createTrip acquires driver + vehicle advisory locks', async () => {
  reset();
  const svc = new TripService();
  await svc.createTrip(validPayload());

  assert.equal(memory.advisoryLocks.length, 2, 'should acquire one lock per resource');
  // Driver namespace first because its ns value < vehicle ns (sorted).
  const nsValues = memory.advisoryLocks.map((l) => l.ns);
  assert.deepEqual(nsValues, nsValues.slice().sort((a, b) => a - b));
});

test('STEP 2B.1 — lock keys are deterministic for the same resource', async () => {
  reset();
  const svc = new TripService();

  // Run two creates with the same driver/vehicle (the second one will conflict
  // — that's fine, we only care about the lock keys).
  await svc.createTrip(validPayload());
  const firstLocks = [...memory.advisoryLocks];

  await assert.rejects(svc.createTrip({ ...validPayload(), user_id: baseUserId + 1 }));
  const secondLocks = memory.advisoryLocks.slice(firstLocks.length);

  assert.equal(firstLocks.length, 2);
  assert.equal(secondLocks.length, 2);
  // Same ns + id pairs.
  assert.deepEqual(firstLocks, secondLocks);
});

test('STEP 2B.1 — different drivers produce different lock keys', async () => {
  reset();
  const svc = new TripService();
  // First create with driver A + vehicle A.
  await svc.createTrip(validPayload());
  const driverKeyA = memory.advisoryLocks.find((l) => l.ns === 0x54524456);
  assert.ok(driverKeyA);

  // Second create with a DIFFERENT driver/vehicle pair — no conflict expected.
  // We just need to confirm the advisory key for the new driver is distinct.
  memory.advisoryLocks.length = 0;
  await svc.createTrip({
    ...validPayload(),
    driver_id: baseDriverId + 999,
    vehicle_id: baseVehicleId + 999,
  });
  const driverKeyB = memory.advisoryLocks.find((l) => l.ns === 0x54524456);
  assert.ok(driverKeyB);
  assert.notEqual(driverKeyA.id, driverKeyB.id, 'different driver ids must map to different keys');
});

test('STEP 2B.1 — updateTrip acquires only the locks for the changing resource', async () => {
  reset();
  const svc = new TripService();
  const trip = await svc.createTrip(validPayload());

  // Clear lock records so we can isolate the updateTrip acquisition.
  const baseCount = memory.advisoryLocks.length;
  memory.advisoryLocks.length = 0;

  // Update only the driver.
  await svc.updateTrip(trip.trip_id, { driver_id: baseDriverId + 50 });

  // Should have acquired ONLY the driver lock (vehicle unchanged → no need).
  // 2 keys acquired during createTrip were already cleared; this asserts the
  // update only touched the driver namespace.
  assert.equal(memory.advisoryLocks.length, 1);
  assert.equal(memory.advisoryLocks[0].ns, 0x54524456);
});

test('STEP 2B.1 — updateTrip acquires BOTH locks when both resources change', async () => {
  reset();
  const svc = new TripService();
  const trip = await svc.createTrip(validPayload());
  memory.advisoryLocks.length = 0;

  await svc.updateTrip(trip.trip_id, {
    driver_id: baseDriverId + 60,
    vehicle_id: baseVehicleId + 60,
  });

  assert.equal(memory.advisoryLocks.length, 2);
});

test('STEP 2B.1 — updateTrip without resource changes acquires NO advisory locks', async () => {
  reset();
  const svc = new TripService();
  const trip = await svc.createTrip(validPayload());
  memory.advisoryLocks.length = 0;

  await svc.updateTrip(trip.trip_id, { notes: 'just a note' });

  // The no-resource-change path bypasses the guard entirely.
  assert.equal(memory.advisoryLocks.length, 0);
});

test('STEP 2B.1 — concurrent simulation: locks would serialize same-key transactions', async () => {
  // LIMITATION DISCLOSURE: this is an in-memory mock, so we cannot reproduce
  // real Postgres advisory-lock blocking. JavaScript is single-threaded, so
  // two `createTrip` calls launched via `Promise.allSettled` interleave at
  // `await` points, but cannot race the way two separate Postgres connections
  // can. What we verify here is that BOTH calls attempt to acquire the SAME
  // lock keys, which is the precondition a real Postgres instance needs in
  // order to serialize the two transactions.
  //
  // End-to-end race-condition coverage requires a live Postgres test
  // container (out of scope for this in-memory test harness).
  reset();
  const svc = new TripService();

  const call1 = svc.createTrip(validPayload());
  const call2 = svc.createTrip({ ...validPayload(), user_id: baseUserId + 1 });

  await Promise.allSettled([call1, call2]);

  // Both calls should have attempted to acquire the SAME pair of keys.
  const driverKeys = memory.advisoryLocks.filter((l) => l.ns === 0x54524456);
  const vehicleKeys = memory.advisoryLocks.filter((l) => l.ns === 0x54525656);
  assert.equal(driverKeys.length, 2, 'both calls should try to lock the driver');
  assert.equal(vehicleKeys.length, 2, 'both calls should try to lock the vehicle');
  assert.deepEqual(driverKeys[0], driverKeys[1], 'driver lock keys must match');
  assert.deepEqual(vehicleKeys[0], vehicleKeys[1], 'vehicle lock keys must match');
});