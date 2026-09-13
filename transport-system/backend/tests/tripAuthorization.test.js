// STEP 2C — Authorization tests for the mutating trip routes.
//
// We test the authorization helpers directly (canMutateTrip,
// canCreateTripForPayload, canAccessTrip) using the same in-memory Prisma
// mock pattern that the tripDoubleBooking.test.js file uses. This keeps the
// tests fast and free of any live-DB requirement.

const test = require('node:test');
const assert = require('node:assert/strict');

// -----------------------------------------------------------------
// In-memory Prisma mock
// -----------------------------------------------------------------
const memory = {
  drivers: [], // { driver_id, user_id, transport_owner_id }
  vehicles: [], // { vehicle_id, owner_id }
  owners: [], // { owner_id, owner_name }
  users: [], // { user_id, role, ... }
};

function seed() {
  memory.drivers.length = 0;
  memory.vehicles.length = 0;
  memory.owners.length = 0;
  memory.users.length = 0;

  // Two distinct transport-owner "organizations".
  memory.owners.push(
    { owner_id: 10, owner_name: 'Owner A', owner_type: 'TRANSPORT_COMPANY' },
    { owner_id: 20, owner_name: 'Owner B', owner_type: 'TRANSPORT_COMPANY' }
  );

  // Two drivers — one belongs to each owner. The driver also stores user_id
  // so the canAccessTrip "driver" branch resolves the actor.
  memory.drivers.push(
    { driver_id: 100, user_id: 1001, transport_owner_id: 10 }, // Owner A
    { driver_id: 200, user_id: 2001, transport_owner_id: 20 }, // Owner B
    // A driver NOT linked to any owner (helper resolveTransportOwnerId should
    // NOT treat this as an owner actor).
    { driver_id: 300, user_id: 3001, transport_owner_id: null }
  );

  // Two vehicles — one belongs to each owner.
  memory.vehicles.push(
    { vehicle_id: 1000, owner_id: 10, vehicle_number: 'VH-1000' },
    { vehicle_id: 2000, owner_id: 20, vehicle_number: 'VH-2000' }
  );

  // Users we will pass as actors.
  memory.users.push(
    { user_id: 1, role: 'admin' },
    { user_id: 2, role: 'super_admin' },
    { user_id: 3, role: 'operator' },
    { user_id: 4, role: 'customer' }, // Pure customer.
    // Owner A's login user — resolves to owner_id 10 via driver 100.
    { user_id: 1001, role: 'partner' },
    // Owner B's login user — resolves to owner_id 20 via driver 200.
    { user_id: 2001, role: 'partner' },
    // A driver with no transport_owner_id — should NOT be able to mutate
    // anything via the owner-actor branch.
    { user_id: 3001, role: 'driver' }
  );
}

function makePrismaMock() {
  return {
    driver: {
      findFirst: async ({ where }) => {
        return (
          memory.drivers.find((d) => {
            if (where.user_id !== undefined && d.user_id !== where.user_id) return false;
            if (
              where.transport_owner_id &&
              typeof where.transport_owner_id === 'object' &&
              where.transport_owner_id.not === null &&
              d.transport_owner_id === null
            ) {
              return false;
            }
            return true;
          }) || null
        );
      },
      findUnique: async ({ where }) => {
        return memory.drivers.find((d) => d.driver_id === where.driver_id) || null;
      },
    },
    transportVehicle: {
      findUnique: async ({ where }) => {
        return memory.vehicles.find((v) => v.vehicle_id === where.vehicle_id) || null;
      },
    },
    vehicleOwner: {
      findUnique: async ({ where }) => {
        return memory.owners.find((o) => o.owner_id === where.owner_id) || null;
      },
    },
    user: {
      findUnique: async ({ where }) => {
        return memory.users.find((u) => u.user_id === where.user_id) || null;
      },
    },
    trip: {
      // Stub — used only in the route integration test that may run later.
      findUnique: async () => null,
      findFirst: async () => null,
    },
    $transaction: async (fn) => {
      // The authorization helpers don't open transactions, but we still
      // need to define this to satisfy TripService internals when called.
      return typeof fn === 'function' ? fn(makePrismaMock()) : null;
    },
    $executeRaw: async () => undefined,
    $queryRaw: async () => [],
  };
}

// Inject the mock.
const prismaPath = require.resolve('../config/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma: makePrismaMock() },
};

const TripService = require('../services/TripService');

// -----------------------------------------------------------------
// Trip fixtures
// -----------------------------------------------------------------
function tripOwnedBy(ownerId, id = 1) {
  return {
    trip_id: id,
    transport_owner_id: ownerId,
    user_id: 9999, // some customer
    driver_id: 100,
    vehicle_id: 1000,
    status: 'PENDING',
  };
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------
const adminUser = { user_id: 1, role: 'admin' };
const superAdminUser = { user_id: 2, role: 'super_admin' };
const operatorUser = { user_id: 3, role: 'operator' };
const customerUser = { user_id: 4, role: 'customer' };
const ownerAUser = { user_id: 1001, role: 'partner' }; // → owner_id 10
const ownerBUser = { user_id: 2001, role: 'partner' }; // → owner_id 20
const orphanDriverUser = { user_id: 3001, role: 'driver' };

// -----------------------------------------------------------------
// canMutateTrip
// -----------------------------------------------------------------
test('STEP 2C — canMutateTrip: admin always allowed', async () => {
  seed();
  const svc = new TripService();
  for (const u of [adminUser, superAdminUser, operatorUser]) {
    const r = await svc.canMutateTrip(tripOwnedBy(10), u);
    assert.equal(r.allowed, true, `role ${u.role} should be allowed`);
  }
});

test('STEP 2C — canMutateTrip: customer denied', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(tripOwnedBy(10), customerUser);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Customers or drivers cannot modify trips/);
});

test('STEP 2C — canMutateTrip: driver (orphan) denied', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(tripOwnedBy(10), orphanDriverUser);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Customers or drivers cannot modify trips/);
});

test('STEP 2C — canMutateTrip: null trip denied for non-admin', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(null, ownerAUser);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Trip not found');
});

test('STEP 2C — canMutateTrip: owner A can mutate own trip', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(tripOwnedBy(10), ownerAUser);
  assert.equal(r.allowed, true);
});

test('STEP 2C — canMutateTrip: owner A cannot mutate owner B trip', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(tripOwnedBy(20), ownerAUser);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /do not have permission/);
});

test('STEP 2C — canMutateTrip: unauthenticated denied', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canMutateTrip(tripOwnedBy(10), null);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Not authenticated');
});

// -----------------------------------------------------------------
// canCreateTripForPayload
// -----------------------------------------------------------------
test('STEP 2C — canCreateTripForPayload: admin always allowed', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    { transport_owner_id: 99, driver_id: 99, vehicle_id: 99 }, // even nonsense IDs
    adminUser
  );
  assert.equal(r.allowed, true);
});

test('STEP 2C — canCreateTripForPayload: customer denied', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload({}, customerUser);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /cannot create trips/);
});

test('STEP 2C — canCreateTripForPayload: owner A creating for own org + own driver/vehicle allowed', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    {
      transport_owner_id: 10, // matches ownerAUser
      driver_id: 100, // belongs to owner 10
      vehicle_id: 1000, // belongs to owner 10
    },
    ownerAUser
  );
  assert.equal(r.allowed, true);
});

test('STEP 2C — canCreateTripForPayload: owner A cannot create trip for owner B', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    { transport_owner_id: 20 }, // owner B
    ownerAUser
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /your own transport organization/);
});

test('STEP 2C — canCreateTripForPayload: owner A cannot use owner B driver', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    {
      transport_owner_id: 10, // owner A's org
      driver_id: 200, // belongs to owner B
    },
    ownerAUser
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Driver does not belong to your transport organization/);
});

test('STEP 2C — canCreateTripForPayload: owner A cannot use owner B vehicle', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    {
      transport_owner_id: 10,
      driver_id: 100,
      vehicle_id: 2000, // belongs to owner B
    },
    ownerAUser
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Vehicle does not belong to your transport organization/);
});

test('STEP 2C — canCreateTripForPayload: orphan driver denied at owner-branch', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canCreateTripForPayload(
    { transport_owner_id: 10 },
    orphanDriverUser
  );
  assert.equal(r.allowed, false);
  // Either "cannot create trips" (driver role) or "no transport owner profile
  // linked" — both are correct denials.
  assert.ok(
    /cannot create trips|No transport owner profile is linked/.test(r.reason),
    `unexpected reason: ${r.reason}`
  );
});

// -----------------------------------------------------------------
// canAccessTrip — read endpoint authorization
// -----------------------------------------------------------------
test('STEP 2C — canAccessTrip: admin always allowed', async () => {
  seed();
  const svc = new TripService();
  for (const u of [adminUser, superAdminUser, operatorUser]) {
    const r = await svc.canAccessTrip(tripOwnedBy(10), u);
    assert.equal(r.allowed, true);
  }
});

test('STEP 2C — canAccessTrip: owner A can read own trip, not owner B', async () => {
  seed();
  const svc = new TripService();
  const own = await svc.canAccessTrip(tripOwnedBy(10), ownerAUser);
  assert.equal(own.allowed, true);

  const other = await svc.canAccessTrip(tripOwnedBy(20), ownerAUser);
  assert.equal(other.allowed, false);
});

test('STEP 2C — canAccessTrip: null trip denied for non-admin with "Trip not found"', async () => {
  seed();
  const svc = new TripService();
  const r = await svc.canAccessTrip(null, ownerAUser);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Trip not found');
});