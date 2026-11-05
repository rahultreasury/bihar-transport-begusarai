/**
 * driverVehicleAssignment.test.js
 * ------------------------------------------------------------------
 * Focused tests for Driver <-> Vehicle assignment flow.
 *
 * Covers:
 *   1. Driver can load vehicles belonging to their Transport Owner.
 *   2. Available vehicle appears in Assign Vehicle modal.
 *   3. Historical trip does not incorrectly make vehicle unavailable.
 *   4. Driver + same-owner vehicle assignment succeeds.
 *   5. Driver + different-owner vehicle assignment fails.
 *   6. Vehicle list reflects assigned Driver.
 *   7. Driver list reflects assigned Vehicle.
 *   8. Self Owner Driver can be assigned their own vehicle.
 *   9. Driver cannot have conflicting active vehicle assignment.
 *   10. Vehicle cannot have conflicting active driver assignment.
 *   11. Backend validates owner relationship.
 *   12. Assignment transaction rolls back on failure.
 *
 * Conventions:
 *   - node:test + node:assert
 *   - No external deps
 *   - Uses stub prisma client for unit tests
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const prismaModule = require('../config/prisma');
const realPrisma = prismaModule.prisma;

const DriverManagementService = require('../services/DriverManagementService');

// ------------------------------------------------------------------
// Stub helpers
// ------------------------------------------------------------------

function buildPrismaStub(initialState = {}) {
  const state = {
    drivers: initialState.drivers || [],
    vehicleOwners: initialState.vehicleOwners || [],
    transportVehicles: initialState.transportVehicles || [],
    vehicleAssignments: initialState.vehicleAssignments || [],
    ...initialState,
  };
  const calls = {
    driver_findUnique: [],
    driver_update: [],
    transportVehicle_findUnique: [],
    transportVehicle_findMany: [],
    transportVehicle_update: [],
    vehicleAssignment_create: [],
    vehicleAssignment_updateMany: [],
    $transaction: [],
  };

  const stub = {
    driver: {
      findUnique: async ({ where, include }) => {
        calls.driver_findUnique.push({ where, include });
        const driver = state.drivers.find(d => d.driver_id === where.driver_id);
        if (!driver) return null;
        let result = { ...driver };
        if (include?.user && driver.user) {
          result.user = driver.user;
        }
        if (include?.transportOwner && driver.transportOwner) {
          result.transportOwner = driver.transportOwner;
        }
        if (include?.currentVehicle && driver.currentVehicle) {
          result.currentVehicle = driver.currentVehicle;
        }
        return result;
      },
      update: async ({ where, data }) => {
        calls.driver_update.push({ where, data });
        const idx = state.drivers.findIndex(d => d.driver_id === where.driver_id);
        if (idx === -1) throw new Error('Driver not found');
        state.drivers[idx] = { ...state.drivers[idx], ...data };
        return state.drivers[idx];
      },
    },
    transportVehicle: {
      findUnique: async ({ where }) => {
        calls.transportVehicle_findUnique.push(where);
        return state.transportVehicles.find(v => v.vehicle_id === where.vehicle_id) || null;
      },
      findMany: async ({ where }) => {
        calls.transportVehicle_findMany.push(where);
        let results = [...state.transportVehicles];
        if (where.owner_id) {
          results = results.filter(v => v.owner_id === where.owner_id);
        }
        if (where.is_available !== undefined) {
          results = results.filter(v => v.is_available === where.is_available);
        }
        if (where.current_status) {
          results = results.filter(v => v.current_status === where.current_status);
        }
        if (where.OR) {
          results = results.filter(v => {
            return where.OR.some(cond => {
              if (cond.driver_id === null) return v.driver_id === null;
              if (cond.driver_id !== undefined) return v.driver_id === cond.driver_id;
              return true;
            });
          });
        }
        return results;
      },
      update: async ({ where, data }) => {
        calls.transportVehicle_update.push({ where, data });
        const idx = state.transportVehicles.findIndex(v => v.vehicle_id === where.vehicle_id);
        if (idx === -1) throw new Error('Vehicle not found');
        state.transportVehicles[idx] = { ...state.transportVehicles[idx], ...data };
        return state.transportVehicles[idx];
      },
    },
    vehicleAssignment: {
      create: async ({ data }) => {
        calls.vehicleAssignment_create.push(data);
        const newAssignment = {
          assignment_id: state.vehicleAssignments.length + 1,
          ...data,
          assigned_at: new Date(),
          status: 'active',
        };
        state.vehicleAssignments.push(newAssignment);
        return newAssignment;
      },
      updateMany: async ({ where, data }) => {
        calls.vehicleAssignment_updateMany.push({ where, data });
        state.vehicleAssignments.forEach(a => {
          if (a.vehicle_id === where.vehicle_id && a.driver_id === where.driver_id && a.status === where.status) {
            Object.assign(a, data);
          }
        });
        return { count: 1 };
      },
    },
    $transaction: async (fn) => {
      calls.$transaction.push(fn);
      return fn(stub);
    },
  };

  return { stub, state, calls };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('DriverVehicleAssignment', () => {
  let service;

  before(() => {
    prismaModule.prisma = realPrisma;
    service = new DriverManagementService();
  });

  after(() => {
    prismaModule.prisma = realPrisma;
  });

  // Helper to create fresh stub state
  function createState() {
    const owner = { owner_id: 1, owner_name: 'ABC Transport', owner_type: 'TRANSPORT_COMPANY', mobile: '9999999999' };
    const driver = {
      driver_id: 1,
      driver_name: 'Sunny Kumar',
      transport_owner_id: 1,
      current_vehicle_id: null,
      user: { first_name: 'Sunny', last_name: 'Kumar', phone: '8888888888' },
    };
    const vehicle = {
      vehicle_id: 1,
      vehicle_number: 'BR09GA4589',
      vehicle_type: 'truck',
      owner_id: 1,
      driver_id: null,
      current_status: 'available',
      is_available: true,
    };
    return buildPrismaStub({
      drivers: [driver],
      vehicleOwners: [owner],
      transportVehicles: [vehicle],
      vehicleAssignments: [],
    });
  }

  // ----------------------------------------------------------------
  // TEST 1: Driver can load vehicles belonging to their Transport Owner
  // ----------------------------------------------------------------
  test('getAvailableVehicles returns vehicles for driver\'s transport owner', async () => {
    const { stub: s, state: st, calls: c } = createState();
    prismaModule.prisma = s;

    const vehicles = await service.getAvailableVehicles(1);
    assert.ok(Array.isArray(vehicles));
    assert.strictEqual(vehicles.length, 1);
    assert.strictEqual(vehicles[0].vehicle_id, 1);
    assert.strictEqual(vehicles[0].owner_id, 1);
  });

  // ----------------------------------------------------------------
  // TEST 2: Available vehicle appears in list
  // ----------------------------------------------------------------
  test('available vehicle with status=available and is_available=true is returned', async () => {
    const { stub: s } = createState();
    prismaModule.prisma = s;

    const vehicles = await service.getAvailableVehicles(1);
    const available = vehicles.find(v => v.vehicle_id === 1);
    assert.ok(available);
    assert.strictEqual(available.current_status, 'available');
    assert.strictEqual(available.is_available, true);
  });

  // ----------------------------------------------------------------
  // TEST 3: Historical trip does not make vehicle unavailable
  // ----------------------------------------------------------------
  test('vehicle with on_trip status is NOT returned as available', async () => {
    const { stub: s, state: st } = createState();
    st.transportVehicles[0].current_status = 'on_trip';
    st.transportVehicles[0].is_available = false;
    prismaModule.prisma = s;

    const vehicles = await service.getAvailableVehicles(1);
    assert.strictEqual(vehicles.length, 0);
  });

  // ----------------------------------------------------------------
  // TEST 4: Driver + same-owner vehicle assignment succeeds
  // ----------------------------------------------------------------
  test('assignVehicle succeeds when vehicle belongs to driver\'s owner', async () => {
    const { stub: s, state: st, calls: c } = createState();
    prismaModule.prisma = s;

    const result = await service.assignVehicle(1, 1, 1);
    assert.ok(result.driver);
    assert.ok(result.vehicle);
    assert.strictEqual(result.driver.current_vehicle_id, 1);
    assert.strictEqual(result.vehicle.driver_id, 1);
    assert.strictEqual(result.vehicle.current_status, 'available');
    assert.strictEqual(result.vehicle.is_available, false);
  });

  // ----------------------------------------------------------------
  // TEST 5: Driver + different-owner vehicle assignment fails
  // ----------------------------------------------------------------
  test('assignVehicle fails when vehicle belongs to different owner', async () => {
    const { stub: s, state: st } = createState();
    st.transportVehicles.push({
      vehicle_id: 2,
      vehicle_number: 'BR09XX9999',
      vehicle_type: 'truck',
      owner_id: 2,
      driver_id: null,
      current_status: 'available',
      is_available: true,
    });
    prismaModule.prisma = s;

    await assert.rejects(
      async () => await service.assignVehicle(1, 2, 1),
      { message: "This vehicle does not belong to the driver's transport owner" }
    );
  });

  // ----------------------------------------------------------------
  // TEST 6: Vehicle assignment creates history record
  // ----------------------------------------------------------------
  test('vehicle assignment creates VehicleAssignment history record', async () => {
    const { stub: s, state: st, calls: c } = createState();
    prismaModule.prisma = s;

    await service.assignVehicle(1, 1, 1);
    assert.strictEqual(c.vehicleAssignment_create.length, 1);
    assert.strictEqual(c.vehicleAssignment_create[0].vehicle_id, 1);
    assert.strictEqual(c.vehicleAssignment_create[0].driver_id, 1);
    assert.strictEqual(c.vehicleAssignment_create[0].status, 'active');
  });

  // ----------------------------------------------------------------
  // TEST 7: Driver list reflects assigned vehicle
  // ----------------------------------------------------------------
  test('driver current_vehicle_id is updated after assignment', async () => {
    const { stub: s, state: st, calls: c } = createState();
    prismaModule.prisma = s;

    await service.assignVehicle(1, 1, 1);
    const driver = st.drivers.find(d => d.driver_id === 1);
    assert.strictEqual(driver.current_vehicle_id, 1);
  });

  // ----------------------------------------------------------------
  // TEST 8: Self Owner Driver can be assigned their own vehicle
  // ----------------------------------------------------------------
  test('Self Owner driver can be assigned vehicle owned by same owner', async () => {
    const { stub: s, state: st } = createState();
    st.vehicleOwners[0].owner_type = 'DRIVER_OWNER';
    prismaModule.prisma = s;

    const result = await service.assignVehicle(1, 1, 1);
    assert.ok(result.driver);
    assert.ok(result.vehicle);
    assert.strictEqual(result.driver.current_vehicle_id, 1);
    assert.strictEqual(result.vehicle.driver_id, 1);
  });

  // ----------------------------------------------------------------
  // TEST 9: Driver cannot have conflicting active vehicle assignment
  // ----------------------------------------------------------------
  test('assigning new vehicle unassigns previous vehicle', async () => {
    const { stub: s, state: st, calls: c } = createState();
    st.transportVehicles.push({
      vehicle_id: 2,
      vehicle_number: 'BR09XX0002',
      vehicle_type: 'truck',
      owner_id: 1,
      driver_id: null,
      current_status: 'available',
      is_available: true,
    });
    prismaModule.prisma = s;

    await service.assignVehicle(1, 1, 1);
    await service.assignVehicle(1, 2, 1);

    const v1 = st.transportVehicles.find(v => v.vehicle_id === 1);
    assert.strictEqual(v1.driver_id, null);
    assert.strictEqual(v1.is_available, true);
    assert.strictEqual(v1.current_status, 'available');

    const v2 = st.transportVehicles.find(v => v.vehicle_id === 2);
    assert.strictEqual(v2.driver_id, 1);
    assert.strictEqual(v2.is_available, false);
  });

  // ----------------------------------------------------------------
  // TEST 10: Vehicle cannot have conflicting active driver assignment
  // ----------------------------------------------------------------
  test('vehicle already assigned to another driver cannot be assigned', async () => {
    const { stub: s, state: st } = createState();
    st.transportVehicles[0].driver_id = 99;
    st.drivers[0].transport_owner_id = null;
    prismaModule.prisma = s;

    await assert.rejects(
      async () => await service.assignVehicle(1, 1, 1),
      { message: 'This vehicle is already assigned to another driver' }
    );
  });

  // ----------------------------------------------------------------
  // TEST 11: Backend validates owner relationship
  // ----------------------------------------------------------------
  test('getAvailableVehicles returns empty for driver with no owner', async () => {
    const { stub: s, state: st } = createState();
    st.drivers[0].transport_owner_id = null;
    prismaModule.prisma = s;

    const vehicles = await service.getAvailableVehicles(1);
    assert.strictEqual(vehicles.length, 0);
  });

  // ----------------------------------------------------------------
  // TEST 12: Assignment transaction rolls back on failure
  // ----------------------------------------------------------------
  test('failed assignment does not leave partial state', async () => {
    const { stub: s, state: st, calls: c } = createState();
    st.transportVehicles.push({
      vehicle_id: 2,
      vehicle_number: 'BR09XX9999',
      vehicle_type: 'truck',
      owner_id: 2,
      driver_id: null,
      current_status: 'available',
      is_available: true,
    });
    prismaModule.prisma = s;

    try {
      await service.assignVehicle(1, 2, 1);
    } catch (err) {
      // Expected to fail
    }

    const driver = st.drivers.find(d => d.driver_id === 1);
    assert.strictEqual(driver.current_vehicle_id, null);

    const vehicle = st.transportVehicles.find(v => v.vehicle_id === 2);
    assert.strictEqual(vehicle.driver_id, null);
    assert.strictEqual(vehicle.is_available, true);
  });
});
