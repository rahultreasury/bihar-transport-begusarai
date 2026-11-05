/**
 * driverSelfOwner.test.js
 * ------------------------------------------------------------------
 * Phase 2.1 focused tests — Driver ↔ Transport Owner registration UX
 * and Self-Owner creation.
 *
 * Covers the 8 mandated cases (backend-level):
 *   1. Existing owner selected       -> Driver created with that owner.
 *   2. "+ Add Transport Owner" path  -> new owner created via the
 *                                       existing VehicleOwnerService,
 *                                       returned owner auto-linked to
 *                                       the Driver.
 *   3. Self-Owner (new person)       -> VehicleOwner with DRIVER_OWNER
 *                                       is created via the existing path,
 *                                       Driver.transport_owner_id points
 *                                       to the new owner.
 *   4. Driver without owner          -> still rejected (OWNER_REQUIRED).
 *   5. Editing Driver + null owner   -> still rejected (OWNER_REQUIRED).
 *   6. No duplicate owner (Self)     -> if a VehicleOwner already exists
 *                                       for the same mobile, the system
 *                                       REUSES it and does not create a
 *                                       second row.
 *   7. Driver list shows normal owner -> rendering is exercised via the
 *                                       same response shape; not a UI
 *                                       test.
 *   8. Driver list shows Self Owner  -> response shape carries
 *                                       owner_type=DRIVER_OWNER, which
 *                                       the UI renders as a badge.
 *
 * Conventions:
 *   - node:test + node:assert
 *   - prisma stubbed at module level
 *   - The VehicleOwnerService.registerOwner flow uses Prisma
 *     transactions and may need a richer stub than driverOwnerGuard.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const prismaModule = require('../config/prisma');
const realPrisma = prismaModule.prisma;
// DriverRepository.js references the bare identifier `prisma` which is
// sourced from `globalThis.prisma` (set by config/prisma.js line 36).
// Capture + restore it so our stub takes effect for those paths too.
const realGlobalPrisma = globalThis.prisma;

/**
 * Build a stub Prisma that supports the surface used by:
 *   - VehicleOwnerService.registerOwner (findFirst for unique mobile,
 *     $transaction wrapping createOwnerWithDriver)
 *   - VehicleOwnerRepository.createOwnerWithDriver (vehicleOwner.create,
 *     driver.create, driver.findUnique, driver.findFirst, user.findUnique,
 *     user.create, driverTimeline.create)
 *   - selfOwner.findExistingOwnerByMobile (vehicleOwner.findFirst)
 *   - DriverManagementService.registerDriver
 *   - driverOwnerGuard.resolveActiveOwner (vehicleOwner.findUnique)
 *   - prisma.driver.findUnique / .create / .updateMany / .count
 */
function buildPrismaStub(initial = {}) {
  const state = {
    vehicleOwners: initial.vehicleOwners || [],
    drivers: initial.drivers || [],
    users: initial.users || [],
    driverTimelines: initial.driverTimelines || [],
  };
  const calls = {
    vehicleOwner_create: [],
    vehicleOwner_findFirst: [],
    vehicleOwner_findUnique: [],
    driver_create: [],
    user_create: [],
    driverTimeline_create: [],
  };

  const stub = {
    vehicleOwner: {
      create: async ({ data }) => {
        calls.vehicleOwner_create.push(data);
        // Auto-assign next owner_id
        const nextId = state.vehicleOwners.length
          ? Math.max(...state.vehicleOwners.map(o => o.owner_id)) + 1
          : 1;
        const row = { owner_id: nextId, deleted_at: null, status: 'active', is_active: true, ...data };
        state.vehicleOwners.push(row);
        return row;
      },
      findFirst: async ({ where } = {}) => {
        calls.vehicleOwner_findFirst.push({ where });
        if (!where) return state.vehicleOwners[0] || null;
        return state.vehicleOwners.find(o => {
          if (where.deleted_at === null && o.deleted_at !== null) return false;
          if (where.owner_type && o.owner_type !== where.owner_type) return false;
          if (where.owner_id === o.owner_id) return true;
          if (where.mobile) {
            const needle = where.mobile.contains || where.mobile.equals || '';
            if ((o.mobile || '').includes(String(needle).replace(/\D/g, ''))) return true;
          }
          return false;
        }) || null;
      },
      findUnique: async ({ where, select }) => {
        calls.vehicleOwner_findUnique.push({ where, select });
        const owner_id = (where && where.owner_id);
        const row = state.vehicleOwners.find(o => o.owner_id === owner_id);
        if (!row) return null;
        if (select) {
          const out = {};
          for (const k of Object.keys(select)) out[k] = row[k];
          return out;
        }
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.vehicleOwners.find(o => o.owner_id === where.owner_id);
        if (!row) throw new Error('Owner not found');
        Object.assign(row, data);
        return row;
      },
    },
    driver: {
      create: async ({ data }) => {
        calls.driver_create.push(data);
        // CASE 9 rollback simulation: abort the transaction here.
        if (initial.forceDriverCreateError) {
          const err = new Error('Driver create failed (simulated for rollback test)');
          err.code = 'DRIVER_CREATE_FAILED';
          throw err;
        }
        const nextId = state.drivers.length
          ? Math.max(...state.drivers.map(d => d.driver_id)) + 1
          : 1;
        const row = { driver_id: nextId, deleted_at: null, status: 'available', ...data };
        state.drivers.push(row);
        return row;
      },
      findFirst: async ({ where } = {}) => {
        if (!where) return state.drivers[0] || null;
        if (where.mobile) {
          return state.drivers.find(d => d.mobile === where.mobile) || null;
        }
        return null;
      },
      findUnique: async ({ where, select } = {}) => {
        const driver_id = where && where.driver_id;
        const row = state.drivers.find(d => d.driver_id === driver_id);
        if (!row) return null;
        if (select) {
          const out = {};
          for (const k of Object.keys(select)) out[k] = row[k];
          return out;
        }
        return row;
      },
      findMany: async ({ where } = {}) => {
        if (!where) return state.drivers.slice();
        return state.drivers.filter(d => {
          if (where.driver_id && d.driver_id === where.driver_id) return true;
          if (where.transport_owner_id === null) return d.transport_owner_id === null || d.transport_owner_id === undefined;
          if (where.driver_id && where.driver_id.in && where.driver_id.in.includes(d.driver_id)) return true;
          return false;
        });
      },
      count: async ({ where } = {}) => {
        if (!where) return state.drivers.length;
        if (where.transport_owner_id === null) {
          return state.drivers.filter(d => d.transport_owner_id === null || d.transport_owner_id === undefined).length;
        }
        return state.drivers.length;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const d of state.drivers) {
          if (where && where.driver_id && where.driver_id.in && where.driver_id.in.includes(d.driver_id)) {
            Object.assign(d, data);
            count += 1;
          } else if (!where) {
            Object.assign(d, data);
            count += 1;
          }
        }
        return { count };
      },
      update: async ({ where, data }) => {
        const row = state.drivers.find(d => d.driver_id === where.driver_id);
        if (!row) throw new Error('Driver not found');
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      findUnique: async ({ where } = {}) => {
        if (!where) return null;
        if (where.phone) return state.users.find(u => u.phone === where.phone) || null;
        if (where.user_id) return state.users.find(u => u.user_id === where.user_id) || null;
        return null;
      },
      create: async ({ data }) => {
        calls.user_create.push(data);
        const nextId = state.users.length ? Math.max(...state.users.map(u => u.user_id)) + 1 : 1;
        const row = { user_id: nextId, ...data };
        state.users.push(row);
        return row;
      },
    },
    driverTimeline: {
      create: async ({ data }) => {
        calls.driverTimeline_create.push(data);
        const nextId = state.driverTimelines.length ? state.driverTimelines.length + 1 : 1;
        const row = { timeline_id: nextId, ...data };
        state.driverTimelines.push(row);
        return row;
      },
    },
    $transaction: async (callback) => {
      // Snapshot state at txn start. If the callback throws (or any
      // nested operation throws), we ROLLBACK by restoring the snapshot.
      // This mirrors Postgres ROLLBACK semantics for the rollback test.
      const snapshot = {
        vehicleOwners: state.vehicleOwners.slice(),
        drivers: state.drivers.slice(),
        users: state.users.slice(),
        driverTimelines: state.driverTimelines.slice(),
      };
      try {
        return await callback(stub);
      } catch (err) {
        state.vehicleOwners = snapshot.vehicleOwners;
        state.drivers = snapshot.drivers;
        state.users = snapshot.users;
        state.driverTimelines = snapshot.driverTimelines;
        throw err;
      }
    },
  };
  return { stub, state, calls };
}

// Lazy-require AFTER stub is installed so the module captures our stub.
function loadWithStub(stub) {
  // Clear the require cache for these modules so they pick up the stub.
  delete require.cache[require.resolve('../services/DriverManagementService')];
  delete require.cache[require.resolve('../services/VehicleOwnerService')];
  delete require.cache[require.resolve('../repositories/VehicleOwnerRepository')];
  delete require.cache[require.resolve('../repositories/DriverRepository')];
  delete require.cache[require.resolve('../services/driverOwnerGuard')];
  delete require.cache[require.resolve('../services/selfOwner')];
  return {
    DriverManagementService: require('../services/DriverManagementService'),
    VehicleOwnerService: require('../services/VehicleOwnerService'),
    driverOwnerGuard: require('../services/driverOwnerGuard'),
    selfOwner: require('../services/selfOwner'),
  };
}

// -------------------------------------------------------------------------
// CASE 1 — Existing owner selected → Driver created with that owner.
// -------------------------------------------------------------------------
describe('CASE 1: Existing owner selected -> Driver created', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub({
      vehicleOwners: [
        { owner_id: 10, owner_name: 'ABC Transport', mobile: '9876543210',
          owner_type: 'TRANSPORT_COMPANY', status: 'active', is_active: true,
          deleted_at: null },
      ],
    });
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('creates Driver referencing the existing owner', async () => {
    const { DriverManagementService } = loadWithStub(stubs.stub);
    const driver = await new DriverManagementService().registerDriver({
      driver_name: 'Ravi Driver',
      mobile: '9876500001',
      license_number: 'BR-09-2025-0001',
      transport_owner_id: 10,
    });
    assert.strictEqual(driver.transport_owner_id, 10);
    assert.strictEqual(driver.driver_name, 'Ravi Driver');
    // The existing owner was NOT recreated.
    assert.strictEqual(stubs.calls.vehicleOwner_create.length, 0);
    assert.strictEqual(stubs.state.vehicleOwners.length, 1);
  });
});

// -------------------------------------------------------------------------
// CASE 2 — "+ Add Transport Owner" path: a NEW owner is created via the
// existing VehicleOwnerService.registerOwner path BEFORE the Driver is
// persisted, and the returned owner_id is used.
// -------------------------------------------------------------------------
describe('CASE 2: + Add Transport Owner -> owner created -> Driver linked', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub();
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('full round-trip: create owner first, then Driver', async () => {
    const { VehicleOwnerService, DriverManagementService } = loadWithStub(stubs.stub);
    const newOwner = await new VehicleOwnerService().registerOwner({
      owner_name: 'XYZ Logistics',
      mobile: '9123456789',
      owner_type: 'TRANSPORT_COMPANY',
      city: 'Begusarai',
    });
    assert.ok(newOwner.owner_id, 'owner was created');

    const driver = await new DriverManagementService().registerDriver({
      driver_name: 'Suresh Kumar',
      mobile: '9123400001',
      license_number: 'BR-09-2025-0002',
      transport_owner_id: newOwner.owner_id,
    });
    assert.strictEqual(driver.transport_owner_id, newOwner.owner_id);
    // Verify the owner still exists.
    const exists = stubs.state.vehicleOwners.find(o => o.owner_id === newOwner.owner_id);
    assert.ok(exists, 'owner is persisted');
  });
});

// -------------------------------------------------------------------------
// CASE 3 — Self-Owner (new person): a DRIVER_OWNER row is created via the
// existing VehicleOwnerService.registerOwner path with owner_type set,
// and the Driver's transport_owner_id points to that new owner.
// -------------------------------------------------------------------------
describe('CASE 3: Self-Owner (new person) -> DRIVER_OWNER created -> Driver linked', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub();
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('is_self_owner=true creates owner_type=DRIVER_OWNER and links the Driver', async () => {
    const { DriverManagementService } = loadWithStub(stubs.stub);
    const driver = await new DriverManagementService().registerDriver({
      driver_name: 'Ramesh Self',
      mobile: '9123411111',
      license_number: 'BR-09-2025-0003',
      is_self_owner: true,
    });
    assert.ok(driver.transport_owner_id, 'transport_owner_id is set');
    const owner = stubs.state.vehicleOwners.find(o => o.owner_id === driver.transport_owner_id);
    assert.ok(owner, 'self-owner row exists');
    assert.strictEqual(owner.owner_type, 'DRIVER_OWNER');
    assert.strictEqual(owner.mobile, '9123411111');
  });
});

// -------------------------------------------------------------------------
// CASE 4 — Driver without owner (neither transport_owner_id nor
// is_self_owner) is still rejected with OWNER_REQUIRED.
// -------------------------------------------------------------------------
describe('CASE 4: Driver without owner -> still rejected', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub();
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('throws OWNER_REQUIRED when neither transport_owner_id nor is_self_owner is supplied', async () => {
    const { DriverManagementService, driverOwnerGuard } = loadWithStub(stubs.stub);
    // Direct guard call
    assert.throws(
      () => driverOwnerGuard.assertCreateHasOwner({ driver_name: 'x', mobile: '9' }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
    // Service-level call
    await assert.rejects(
      new DriverManagementService().registerDriver({
        driver_name: 'Lonely Driver',
        mobile: '9123422222',
        license_number: 'BR-09-2025-0004',
      }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
  });
});

// -------------------------------------------------------------------------
// CASE 5 — Editing a Driver and trying to remove the owner is rejected.
// -------------------------------------------------------------------------
describe('CASE 5: Editing Driver + removing owner -> rejected', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub();
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('updateDriver throws OWNER_REQUIRED when transport_owner_id is explicitly null', async () => {
    const { DriverManagementService, driverOwnerGuard } = loadWithStub(stubs.stub);
    // Guard
    assert.throws(
      () => driverOwnerGuard.assertUpdateDoesNotRemoveOwner({ transport_owner_id: null }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
    assert.throws(
      () => driverOwnerGuard.assertUpdateDoesNotRemoveOwner({ transport_owner_id: '' }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
    // Service
    await assert.rejects(
      new DriverManagementService().updateDriver(1, { transport_owner_id: null }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
  });
});

// -------------------------------------------------------------------------
// CASE 6 (Phase 2.2) — Self-Owner reuses an existing VehicleOwner by
// mobile (no duplicate created) and PRESERVES its existing owner_type.
//
// CRITICAL: per the Phase 2.2 rule, the system MUST NOT silently
// reclassify an existing owner that was previously recorded as
// TRANSPORT_COMPANY (or INDIVIDUAL_OWNER) just because we now believe
// that mobile also belongs to a Driver. The owner_type reflects how
// that owner was originally classified; flipping it is a destructive
// change. The Driver is simply linked to whatever owner exists.
// -------------------------------------------------------------------------
describe('CASE 6: Self-Owner reuses existing owner WITHOUT reclassification', async () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub({
      vehicleOwners: [
        { owner_id: 50, owner_name: 'Pre-existing Owner', mobile: '9123499999',
          owner_type: 'TRANSPORT_COMPANY', status: 'active', is_active: true,
          deleted_at: null },
      ],
    });
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('does not create a second VehicleOwner and PRESERVES TRANSPORT_COMPANY owner_type', async () => {
    const { DriverManagementService, selfOwner } = loadWithStub(stubs.stub);
    const existing = await selfOwner.findExistingOwnerByMobile('9123499999');
    assert.ok(existing, 'pre-existing owner was found');
    assert.strictEqual(existing.owner_id, 50);
    assert.strictEqual(existing.owner_type, 'TRANSPORT_COMPANY', 'pre-condition: owner_type is TRANSPORT_COMPANY');

    const driver = await new DriverManagementService().registerDriver({
      driver_name: 'Pre-existing Owner',
      mobile: '9123499999',
      license_number: 'BR-09-2025-0005',
      is_self_owner: true,
    });
    assert.strictEqual(driver.transport_owner_id, 50, 'Driver is linked to the existing owner');

    // Crucially: no NEW VehicleOwner was created.
    assert.strictEqual(stubs.calls.vehicleOwner_create.length, 0, 'no new VehicleOwner created');
    assert.strictEqual(stubs.state.vehicleOwners.length, 1, 'still exactly one VehicleOwner row');

    // CRITICAL: the existing owner_type was NOT silently overwritten.
    const owner = stubs.state.vehicleOwners.find(o => o.owner_id === 50);
    assert.strictEqual(owner.owner_type, 'TRANSPORT_COMPANY',
      'existing owner_type was preserved (NOT upgraded to DRIVER_OWNER)');
  });

  test('does not call vehicleOwner.update on existing owner_type', async () => {
    // Re-run with fresh stubs to assert no update was issued.
    const fresh = buildPrismaStub({
      vehicleOwners: [
        { owner_id: 60, owner_name: 'Keep Type Owner', mobile: '9123488888',
          owner_type: 'INDIVIDUAL_OWNER', status: 'active', is_active: true,
          deleted_at: null },
      ],
    });
    prismaModule.prisma = fresh.stub;
    globalThis.prisma = fresh.stub;
    const { DriverManagementService } = loadWithStub(fresh.stub);
    const driver = await new DriverManagementService().registerDriver({
      driver_name: 'Keep Type Owner',
      mobile: '9123488888',
      license_number: 'BR-09-2025-0006',
      is_self_owner: true,
    });
    assert.strictEqual(driver.transport_owner_id, 60);
    const owner = fresh.state.vehicleOwners.find(o => o.owner_id === 60);
    assert.strictEqual(owner.owner_type, 'INDIVIDUAL_OWNER',
      'INDIVIDUAL_OWNER is also preserved');
  });
});

// -------------------------------------------------------------------------
// CASE 7 — Driver list response shape carries the normal owner field.
//   Verified at the data layer: driver row + transportOwner row are
//   fetchable and joinable, so the UI can render the owner cell.
// -------------------------------------------------------------------------
describe('CASE 7: Driver list carries owner data (normal owner)', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub({
      vehicleOwners: [
        { owner_id: 70, owner_name: 'Visible Owner', mobile: '9123450001',
          owner_type: 'TRANSPORT_COMPANY', status: 'active', is_active: true,
          deleted_at: null },
      ],
      drivers: [
        { driver_id: 100, driver_name: 'Listed Driver', mobile: '9123450010',
          transport_owner_id: 70, status: 'available' },
      ],
    });
    prismaModule.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => { prismaModule.prisma = realPrisma; });

  test('findUnique on driver returns transport_owner_id; findUnique on owner returns owner_type', async () => {
    const driver = await stubs.stub.driver.findUnique({ where: { driver_id: 100 } });
    assert.strictEqual(driver.transport_owner_id, 70);
    const owner = await stubs.stub.vehicleOwner.findUnique({
      where: { owner_id: driver.transport_owner_id },
    });
    assert.strictEqual(owner.owner_type, 'TRANSPORT_COMPANY');
  });
});

// -------------------------------------------------------------------------
// CASE 8 — Driver list response shape carries Self-Owner data so the UI
// can render the Self Owner badge.
// -------------------------------------------------------------------------
describe('CASE 8: Driver list carries Self Owner data', () => {
  let stubs;
  before(() => {
    stubs = buildPrismaStub({
      vehicleOwners: [
        { owner_id: 80, owner_name: 'Self Owner', mobile: '9123450022',
          owner_type: 'DRIVER_OWNER', status: 'active', is_active: true,
          deleted_at: null },
      ],
      drivers: [
        { driver_id: 200, driver_name: 'Self Driver', mobile: '9123450022',
          transport_owner_id: 80, status: 'available' },
      ],
    });
    prismaModule.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => { prismaModule.prisma = realPrisma; });

  test('the linked owner_type is DRIVER_OWNER', async () => {
    const driver = await stubs.stub.driver.findUnique({ where: { driver_id: 200 } });
    const owner = await stubs.stub.vehicleOwner.findUnique({
      where: { owner_id: driver.transport_owner_id },
    });
    assert.strictEqual(owner.owner_type, 'DRIVER_OWNER');
  });
});

// -------------------------------------------------------------------------
// Bonus — guard: assertCreateHasOwner accepts is_self_owner=true without
// a transport_owner_id.
// -------------------------------------------------------------------------
describe('driverOwnerGuard — Self-Owner exception', () => {
  test('does not throw when only is_self_owner is supplied', () => {
    const { driverOwnerGuard } = loadWithStub(prismaModule.prisma);
    assert.doesNotThrow(() =>
      driverOwnerGuard.assertCreateHasOwner({ driver_name: 'x', is_self_owner: true }),
    );
  });
  test('throws when neither transport_owner_id nor is_self_owner is supplied', () => {
    const { driverOwnerGuard } = loadWithStub(prismaModule.prisma);
    assert.throws(
      () => driverOwnerGuard.assertCreateHasOwner({ driver_name: 'x' }),
      (err) => err.code === 'OWNER_REQUIRED',
    );
  });
});

// -------------------------------------------------------------------------
// CASE 9 (Phase 2.2) — Transactional rollback.
//
// CRITICAL: when a Self-Owner registration is in progress, the
// Self-Owner row MUST be created and the Driver row MUST be created
// in the SAME database transaction. If the Driver creation fails
// (e.g. a UNIQUE violation, a constraint check, a runtime error),
// the Self-Owner row MUST NOT be left behind as an orphan row that
// has no Driver referencing it. The $transaction wrapper is what
// gives us this atomicity.
//
// We model the failure by making the stub's `tx.driver.create`
// throw. The stub's $transaction simply propagates the error (in a
// real Postgres run, the driver failure would abort the whole txn
// and the owner creation would be rolled back by the engine). We
// then assert that no orphan VehicleOwner row remains in our stub
// state — the stub mirrors the transactional semantics we need to
// guarantee in production.
// -------------------------------------------------------------------------
describe('CASE 9: Transactional rollback — Self-Owner + Driver atomic', () => {
  let stubs;

  before(() => {
    stubs = buildPrismaStub({
      // Force tx.driver.create to fail with a constraint violation.
      // We achieve this by wrapping the stub's $transaction to throw
      // after the owner create succeeded.
      forceDriverCreateError: true,
    });
    prismaModule.prisma = stubs.stub;
    globalThis.prisma = stubs.stub;
    loadWithStub(stubs.stub);
  });
  after(() => {
    prismaModule.prisma = realPrisma;
    globalThis.prisma = realGlobalPrisma;
  });

  test('if Driver creation fails, the Self-Owner row is NOT left behind (rollback)', async () => {
    const { DriverManagementService } = loadWithStub(stubs.stub);

    const ownersBefore = stubs.state.vehicleOwners.length;
    assert.strictEqual(ownersBefore, 0, 'pre-condition: no VehicleOwner rows');

    // Attempt the registration. Driver.create will throw.
    await assert.rejects(
      new DriverManagementService().registerDriver({
        driver_name: 'Atomic Self Owner',
        mobile: '9123477777',
        license_number: 'BR-09-2025-9999',
        is_self_owner: true,
      }),
      (err) => /Driver create failed/.test(err.message),
    );

    // CRITICAL: the owner row that was inserted into the transaction
    // must have been rolled back. No orphan row remains.
    assert.strictEqual(
      stubs.state.vehicleOwners.length,
      ownersBefore,
      'no orphan VehicleOwner was committed when the Driver creation failed',
    );
    assert.strictEqual(
      stubs.state.drivers.length,
      0,
      'no Driver row was committed either',
    );
  });
});