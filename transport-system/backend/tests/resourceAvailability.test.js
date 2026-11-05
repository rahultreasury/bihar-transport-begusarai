// Test the ResourceAvailabilityService centralized availability logic.
// Uses an in-memory mock of the Prisma client so it runs without a real DB.

const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory state
const memory = {
  drivers: new Map(),
  vehicles: new Map(),
  trips: [],
  nextDriverId: 1,
  nextVehicleId: 1,
  nextTripId: 1,
};

function createDriver(overrides = {}) {
  const id = memory.nextDriverId++;
  const driver = {
    driver_id: id,
    driver_name: overrides.driver_name || `Driver ${id}`,
    status: overrides.status || 'available',
    is_available: overrides.is_available !== false,
    ...overrides,
  };
  memory.drivers.set(id, driver);
  return driver;
}

function createVehicle(overrides = {}) {
  const id = memory.nextVehicleId++;
  const vehicle = {
    vehicle_id: id,
    vehicle_number: overrides.vehicle_number || `VEH${id}`,
    current_status: overrides.current_status || 'available',
    is_available: overrides.is_available !== false,
    ...overrides,
  };
  memory.vehicles.set(id, vehicle);
  return vehicle;
}

function createTrip(overrides = {}) {
  const id = memory.nextTripId++;
  const trip = {
    trip_id: id,
    trip_number: `BTBT-${id}`,
    status: overrides.status || 'PENDING',
    driver_id: overrides.driver_id,
    vehicle_id: overrides.vehicle_id,
    ...overrides,
  };
  memory.trips.push(trip);
  return trip;
}

function makePrismaMock() {
  return {
    driver: {
      update: async ({ where, data }) => {
        const driver = memory.drivers.get(where.driver_id);
        if (!driver) throw new Error('Driver not found');
        Object.assign(driver, data);
        return driver;
      },
      findFirst: async ({ where }) => {
        return memory.trips.find((t) => {
          if (where.driver_id !== undefined && t.driver_id !== where.driver_id) return false;
          if (where.status && where.status.in && !where.status.in.includes(t.status)) return false;
          if (where.NOT && where.NOT.trip_id && t.trip_id === where.NOT.trip_id) return false;
          return true;
        }) || null;
      },
    },
    transportVehicle: {
      update: async ({ where, data }) => {
        const vehicle = memory.vehicles.get(where.vehicle_id);
        if (!vehicle) throw new Error('Vehicle not found');
        Object.assign(vehicle, data);
        return vehicle;
      },
      findFirst: async ({ where }) => {
        return memory.trips.find((t) => {
          if (where.vehicle_id !== undefined && t.vehicle_id !== where.vehicle_id) return false;
          if (where.status && where.status.in && !where.status.in.includes(t.status)) return false;
          if (where.NOT && where.NOT.trip_id && t.trip_id === where.NOT.trip_id) return false;
          return true;
        }) || null;
      },
    },
    trip: {
      findFirst: async ({ where }) => {
        return memory.trips.find((t) => {
          if (where.driver_id !== undefined && t.driver_id !== where.driver_id) return false;
          if (where.vehicle_id !== undefined && t.vehicle_id !== where.vehicle_id) return false;
          if (where.booking_id !== undefined && t.booking_id !== where.booking_id) return false;
          if (where.status && where.status.in && !where.status.in.includes(t.status)) return false;
          if (where.NOT && where.NOT.trip_id && t.trip_id === where.NOT.trip_id) return false;
          return true;
        }) || null;
      },
      update: async ({ where, data }) => {
        const trip = memory.trips.find((t) => t.trip_id === where.trip_id);
        if (!trip) throw new Error('Trip not found');
        Object.assign(trip, data);
        return trip;
      },
    },
  };
}

// Set up mock BEFORE requiring the service
const { prisma } = require('../config/prisma');
const mockPrisma = makePrismaMock();
prisma.prisma = mockPrisma;

const ResourceAvailabilityService = require('../services/ResourceAvailabilityService');
const service = new ResourceAvailabilityService({ prisma: mockPrisma });

// Helper to reset state between tests
function reset() {
  memory.drivers.clear();
  memory.vehicles.clear();
  memory.trips = [];
  memory.nextDriverId = 1;
  memory.nextVehicleId = 1;
  memory.nextTripId = 1;
}

// ============================================================
// TESTS
// ============================================================

test('markDriverBusy sets status=on_trip and is_available=false', async () => {
  reset();
  const driver = createDriver({ status: 'available', is_available: true });
  await service.markDriverBusy(driver.driver_id);
  assert.equal(driver.status, 'on_trip');
  assert.equal(driver.is_available, false);
});

test('markVehicleBusy sets current_status=on_trip and is_available=false', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'available', is_available: true });
  await service.markVehicleBusy(vehicle.vehicle_id);
  assert.equal(vehicle.current_status, 'on_trip');
  assert.equal(vehicle.is_available, false);
});

test('markDriverAvailable sets status=available and is_available=true', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  await service.markDriverAvailable(driver.driver_id);
  assert.equal(driver.status, 'available');
  assert.equal(driver.is_available, true);
});

test('markVehicleAvailable sets current_status=available and is_available=true', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  await service.markVehicleAvailable(vehicle.vehicle_id);
  assert.equal(vehicle.current_status, 'available');
  assert.equal(vehicle.is_available, true);
});

test('releaseDriverIfNoActiveTrip releases when no active trip exists', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const released = await service.releaseDriverIfNoActiveTrip(driver.driver_id, null);
  assert.equal(released, true);
  assert.equal(driver.status, 'available');
  assert.equal(driver.is_available, true);
});

test('releaseVehicleIfNoActiveTrip releases when no active trip exists', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const released = await service.releaseVehicleIfNoActiveTrip(vehicle.vehicle_id, null);
  assert.equal(released, true);
  assert.equal(vehicle.current_status, 'available');
  assert.equal(vehicle.is_available, true);
});

test('releaseDriverIfNoActiveTrip does NOT release when another active trip exists', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  createTrip({ driver_id: driver.driver_id, status: 'IN_TRANSIT' });
  const released = await service.releaseDriverIfNoActiveTrip(driver.driver_id, null);
  assert.equal(released, false);
  assert.equal(driver.status, 'on_trip');
  assert.equal(driver.is_available, false);
});

test('releaseVehicleIfNoActiveTrip does NOT release when another active trip exists', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  createTrip({ vehicle_id: vehicle.vehicle_id, status: 'IN_TRANSIT' });
  const released = await service.releaseVehicleIfNoActiveTrip(vehicle.vehicle_id, null);
  assert.equal(released, false);
  assert.equal(vehicle.current_status, 'on_trip');
  assert.equal(vehicle.is_available, false);
});

test('releaseDriverIfNoActiveTrip excludes the specified trip from the check', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const trip = createTrip({ driver_id: driver.driver_id, status: 'IN_TRANSIT' });
  // Exclude the only active trip — driver should be released
  const released = await service.releaseDriverIfNoActiveTrip(driver.driver_id, trip.trip_id);
  assert.equal(released, true);
  assert.equal(driver.status, 'available');
  assert.equal(driver.is_available, true);
});

test('releaseVehicleIfNoActiveTrip excludes the specified trip from the check', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const trip = createTrip({ vehicle_id: vehicle.vehicle_id, status: 'IN_TRANSIT' });
  const released = await service.releaseVehicleIfNoActiveTrip(vehicle.vehicle_id, trip.trip_id);
  assert.equal(released, true);
  assert.equal(vehicle.current_status, 'available');
  assert.equal(vehicle.is_available, true);
});

test('releaseResourcesIfNoActiveTrip releases both when no other active trips', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const result = await service.releaseResourcesIfNoActiveTrip(driver.driver_id, vehicle.vehicle_id, null);
  assert.equal(result.driverReleased, true);
  assert.equal(result.vehicleReleased, true);
  assert.equal(driver.status, 'available');
  assert.equal(vehicle.current_status, 'available');
});

test('releaseResourcesIfNoActiveTrip keeps both busy when other active trips exist', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  createTrip({ driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: 'IN_TRANSIT' });
  const result = await service.releaseResourcesIfNoActiveTrip(driver.driver_id, vehicle.vehicle_id, null);
  assert.equal(result.driverReleased, false);
  assert.equal(result.vehicleReleased, false);
  assert.equal(driver.status, 'on_trip');
  assert.equal(vehicle.current_status, 'on_trip');
});

test('completing a trip releases resources only when no other active trip exists', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const trip = createTrip({ driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: 'IN_TRANSIT' });

  // Complete the trip — should release because it's the only active trip
  await service.releaseResourcesIfNoActiveTrip(driver.driver_id, vehicle.vehicle_id, trip.trip_id);
  assert.equal(driver.status, 'available');
  assert.equal(vehicle.current_status, 'available');
});

test('cancelling a trip releases resources only when no other active trip exists', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const trip = createTrip({ driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: 'ASSIGNED' });

  await service.releaseResourcesIfNoActiveTrip(driver.driver_id, vehicle.vehicle_id, trip.trip_id);
  assert.equal(driver.status, 'available');
  assert.equal(vehicle.current_status, 'available');
});

test('completing one trip does NOT release driver with another active trip', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  const tripA = createTrip({ driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: 'IN_TRANSIT' });
  const tripB = createTrip({ driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: 'ASSIGNED' });

  // Complete tripA — tripB is still active, so resources should NOT be released
  await service.releaseResourcesIfNoActiveTrip(driver.driver_id, vehicle.vehicle_id, tripA.trip_id);
  assert.equal(driver.status, 'on_trip');
  assert.equal(vehicle.current_status, 'on_trip');
});

test('busy transitions update paired fields atomically (driver)', async () => {
  reset();
  const driver = createDriver({ status: 'available', is_available: true });
  await service.markDriverBusy(driver.driver_id);
  assert.equal(driver.status, 'on_trip');
  assert.equal(driver.is_available, false);
});

test('busy transitions update paired fields atomically (vehicle)', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'available', is_available: true });
  await service.markVehicleBusy(vehicle.vehicle_id);
  assert.equal(vehicle.current_status, 'on_trip');
  assert.equal(vehicle.is_available, false);
});

test('available transitions update paired fields atomically (driver)', async () => {
  reset();
  const driver = createDriver({ status: 'on_trip', is_available: false });
  await service.markDriverAvailable(driver.driver_id);
  assert.equal(driver.status, 'available');
  assert.equal(driver.is_available, true);
});

test('available transitions update paired fields atomically (vehicle)', async () => {
  reset();
  const vehicle = createVehicle({ current_status: 'on_trip', is_available: false });
  await service.markVehicleAvailable(vehicle.vehicle_id);
  assert.equal(vehicle.current_status, 'available');
  assert.equal(vehicle.is_available, true);
});
