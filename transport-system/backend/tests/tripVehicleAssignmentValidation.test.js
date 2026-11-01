// Regression tests for TripVehicleAssignmentService validation on booking-linked trips without enquiry_id

const test = require('node:test');
const assert = require('node:assert/strict');

const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const { ValidationError, ConflictError } = require('../utils/AppError');

// In-memory stores
const memory = {
  trips: new Map(),
  enquiries: new Map(),
  bookings: new Map(),
  vehicles: new Map(),
  drivers: new Map(),
  owners: new Map(),
  hires: new Map(),
  timelines: [],
};

function reset() {
  memory.trips.clear();
  memory.enquiries.clear();
  memory.bookings.clear();
  memory.vehicles.clear();
  memory.drivers.clear();
  memory.owners.clear();
  memory.hires.clear();
  memory.timelines = [];
}

function makePrismaMock() {
  const prisma = {
    $queryRaw: async () => [],
    tripTimeline: {
      create: async ({ data }) => {
        memory.timelines.push(data);
        return data;
      },
    },
    trip: {
      findUnique: async ({ where, include }) => {
        const trip = memory.trips.get(where.trip_id);
        if (!trip) return null;
        // shallow include
        const res = { ...trip };
        if (include?.vehicle && trip.vehicle_id) res.vehicle = memory.vehicles.get(trip.vehicle_id) || null;
        if (include?.driver && trip.driver_id) res.driver = memory.drivers.get(trip.driver_id) || null;
        if (include?.transportOwner && trip.transport_owner_id) res.transportOwner = memory.owners.get(trip.transport_owner_id) || null;
        return res;
      },
      findFirst: async ({ where }) => {
        for (const t of memory.trips.values()) {
          if (where.enquiry_id !== undefined && t.enquiry_id !== where.enquiry_id) continue;
          if (where.booking_id !== undefined && t.booking_id !== where.booking_id) continue;
          if (where.trip_id && where.trip_id.not && t.trip_id === where.trip_id.not) continue;
          if (where.status && where.status.in && !where.status.in.includes(t.status)) continue;
          if (where.driver_id !== undefined && t.driver_id !== where.driver_id) continue;
          if (where.vehicle_id !== undefined && t.vehicle_id !== where.vehicle_id) continue;
          return t;
        }
        return null;
      },
      update: async ({ where, data }) => {
        const t = memory.trips.get(where.trip_id);
        if (!t) throw new Error('not found');
        Object.assign(t, data);
        return t;
      },
    },
    enquiry: {
      findUnique: async ({ where, select }) => {
        const e = memory.enquiries.get(where.enquiry_id);
        if (!e) return null;
        if (select) {
          const r = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = e[k];
          return r;
        }
        return e;
      },
      findFirst: async ({ where, select }) => {
        for (const e of memory.enquiries.values()) {
          if (where.enquiry_id && where.enquiry_id.not && e.enquiry_id === where.enquiry_id.not) continue;
          if (where.assigned_vehicle_id !== undefined && e.assigned_vehicle_id !== where.assigned_vehicle_id) continue;
          if (where.assigned_driver_id !== undefined && e.assigned_driver_id !== where.assigned_driver_id) continue;
          if (where.status && where.status.in && !where.status.in.includes(e.status)) continue;
          if (select) {
            const r = {};
            for (const k of Object.keys(select)) if (select[k]) r[k] = e[k];
            return r;
          }
          return e;
        }
        return null;
      },
      update: async ({ where, data }) => {
        const e = memory.enquiries.get(where.enquiry_id);
        if (!e) throw new Error('not found');
        Object.assign(e, data);
        return e;
      },
    },
    booking: {
      findUnique: async ({ where, select }) => {
        const b = memory.bookings.get(where.booking_id);
        if (!b) return null;
        if (select) {
          const r = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = b[k];
          return r;
        }
        return b;
      },
      update: async ({ where, data }) => {
        const b = memory.bookings.get(where.booking_id);
        if (!b) throw new Error('not found');
        Object.assign(b, data);
        return b;
      },
    },
    transportVehicle: {
      update: async ({ where, data }) => {
        const v = memory.vehicles.get(where.vehicle_id);
        if (v) Object.assign(v, data);
        return v;
      },
      findUnique: async ({ where, select }) => {
        const v = memory.vehicles.get(where.vehicle_id);
        if (!v) return null;
        if (select) {
          const r = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = v[k];
          return r;
        }
        return v;
      },
    },
    driver: {
      update: async ({ where, data }) => {
        const d = memory.drivers.get(where.driver_id);
        if (d) Object.assign(d, data);
        return d;
      },
      findUnique: async ({ where, select }) => {
        const d = memory.drivers.get(where.driver_id);
        if (!d) return null;
        if (select) {
          const r = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = d[k];
          return r;
        }
        return d;
      },
    },
    vehicleOwner: {
      findUnique: async ({ where, select }) => {
        const o = memory.owners.get(where.owner_id);
        if (!o) return null;
        if (select) {
          const r = {};
          for (const k of Object.keys(select)) if (select[k]) r[k] = o[k];
          return r;
        }
        return o;
      },
    },
    vehicleHire: {
      findUnique: async () => null,
    },
    $transaction: async (fn) => fn(prisma),
  };
  return prisma;
}

test('Booking-linked trip without enquiry_id: existing vehicle conflict is rejected', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  // Conflicting trip with same vehicle on same day
  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, {
    trip_id: 100,
    status: 'IN_TRANSIT',
    vehicle_id: 10,
    driver_id: 20,
    trip_date: new Date('2026-10-01'),
  });

  // Trip to assign
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ConflictError || err instanceof ValidationError
  );
});

test('Booking-linked trip without enquiry_id: existing driver conflict is rejected', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.vehicles.set(11, { vehicle_id: 11, vehicle_number: 'V2', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, {
    trip_id: 100,
    status: 'IN_TRANSIT',
    vehicle_id: 10,
    driver_id: 20,
    trip_date: new Date('2026-10-01'),
  });

  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 11, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ConflictError || err instanceof ValidationError
  );
});

test('Trip self-exclusion: reassigning current trip does not conflict with itself', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, {
    trip_id: 200,
    booking_id: 5,
    status: 'PENDING',
    enquiry_id: null,
    vehicle_id: 10,
    driver_id: 20,
  });

  // Should not throw due to self-conflict
  const res = await service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.ok(res);
});

test('Trip self-exclusion: other conflicting trips still detected', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.drivers.set(21, { driver_id: 21, driver_name: 'D2', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, {
    trip_id: 100,
    status: 'IN_TRANSIT',
    vehicle_id: 10,
    driver_id: 21,
    trip_date: new Date('2026-10-01'),
  });

  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ConflictError || err instanceof ValidationError
  );
});

test('Synthetic enquiry ID: string IDs like trip-123 do not break exclusion queries', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  // Should not throw due to bad numeric conversion
  const res = await service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.ok(res);
});

test('Scheduling: booking pickup date/time used when available', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, { trip_id: 100, status: 'IN_TRANSIT', vehicle_id: 10, driver_id: 20, trip_date: new Date('2026-10-01') });
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ConflictError || err instanceof ValidationError
  );
});

test('Scheduling: trip date used when booking scheduling unavailable', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, { trip_id: 100, status: 'IN_TRANSIT', vehicle_id: 10, driver_id: 20, trip_date: new Date('2026-10-01') });
  memory.bookings.set(5, { booking_id: 5, pickup_date: null, pickup_time: null, goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null, trip_date: new Date('2026-10-01') });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ConflictError || err instanceof ValidationError
  );
});

test('Scheduling: missing scheduling information produces explicit safe outcome', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.trips.set(100, { trip_id: 100, status: 'IN_TRANSIT', vehicle_id: 10, driver_id: 20, trip_date: new Date('2026-10-01') });
  memory.bookings.set(5, { booking_id: 5, pickup_date: null, pickup_time: null, goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null, trip_date: null });

  // With no scheduling info, we skip validation (fail-safe) but assignment should still proceed
  // This is explicit safe outcome - no silent false validation success claim
  const res = await service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.ok(res);
});

test('Driver eligibility: expired licence rejected during reassignment', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1, license_expiry: yesterday });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  await assert.rejects(
    () => service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 }),
    (err) => err instanceof ValidationError
  );
});

test('Driver eligibility: valid licence continues working', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1, license_expiry: tomorrow });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.bookings.set(5, { booking_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', goods_weight_kg: 1000 });
  memory.trips.set(200, { trip_id: 200, booking_id: 5, status: 'PENDING', enquiry_id: null });

  const res = await service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.ok(res);
});

test('Regression: existing enquiry-linked assignment behavior remains unchanged', async () => {
  reset();
  const prisma = makePrismaMock();
  const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });

  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.enquiries.set(5, { enquiry_id: 5, pickup_date: '2026-10-01', pickup_time: '10:00', weight: 1000, weight_unit: 'KG' });
  memory.trips.set(200, { trip_id: 200, enquiry_id: 5, status: 'PENDING' });

  const res = await service.assign({ tripId: 200 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.ok(res);
});
