const test = require('node:test');
const assert = require('node:assert/strict');

const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');
const TripProvisioningService = require('../services/TripProvisioningService');
const VehicleHireWorkflowService = require('../services/VehicleHireWorkflowService');

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

function reset() { for (const k of Object.keys(memory)) memory[k] = k === 'timelines' ? [] : new Map(); }

function makePrismaMock() {
  const prisma = {
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(prisma),
    enquiry: {
      findUnique: async ({ where }) => where.enquiry_id ? memory.enquiries.get(where.enquiry_id) || null : null,
      findFirst: async () => null,
      findMany: async ({ where = {} } = {}) => Array.from(memory.enquiries.values()).filter((e) => {
        if (where.assigned_vehicle_id !== undefined && e.assigned_vehicle_id !== where.assigned_vehicle_id) return false;
        if (where.assigned_driver_id !== undefined && e.assigned_driver_id !== where.assigned_driver_id) return false;
        if (where.status && where.status.in && !where.status.in.includes(e.status)) return false;
        if (where.enquiry_id && where.enquiry_id.not && e.enquiry_id === where.enquiry_id.not) return false;
        return true;
      }),
      update: async ({ where, data }) => { const e = memory.enquiries.get(where.enquiry_id); if (e) Object.assign(e, data); return e; },
    },
    trip: {
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
      findUnique: async ({ where, include }) => {
        const t = memory.trips.get(where.trip_id);
        if (!t) return null;
        const res = { ...t };
        if (include?.vehicle && t.vehicle_id) res.vehicle = memory.vehicles.get(t.vehicle_id);
        if (include?.driver && t.driver_id) res.driver = memory.drivers.get(t.driver_id);
        if (include?.transportOwner && t.transport_owner_id) res.transportOwner = memory.owners.get(t.transport_owner_id);
        return res;
      },
      create: async ({ data }) => { const id = memory.trips.size + 1; const t = { trip_id: id, ...data }; memory.trips.set(id, t); return t; },
      update: async ({ where, data }) => { const t = memory.trips.get(where.trip_id); if (t) Object.assign(t, data); return t; },
      findMany: async ({ where = {} } = {}) => {
        const res = [];
        for (const t of memory.trips.values()) {
          if (where.vehicle_id !== undefined && t.vehicle_id !== where.vehicle_id) continue;
          if (where.driver_id !== undefined && t.driver_id !== where.driver_id) continue;
          if (where.trip_id && where.trip_id.not && t.trip_id === where.trip_id.not) continue;
          if (where.status && where.status.in && !where.status.in.includes(t.status)) continue;
          res.push({ ...t });
        }
        return res;
      },
      count: async () => memory.trips.size,
    },
    booking: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], update: async () => null },
    transportVehicle: {
      update: async ({ where, data }) => { const v = memory.vehicles.get(where.vehicle_id); if (v) Object.assign(v, data); return v; },
      findUnique: async ({ where }) => memory.vehicles.get(where.vehicle_id) || null,
      findMany: async () => Array.from(memory.vehicles.values()),
    },
    driver: {
      update: async ({ where, data }) => { const d = memory.drivers.get(where.driver_id); if (d) Object.assign(d, data); return d; },
      findUnique: async ({ where }) => memory.drivers.get(where.driver_id) || null,
      findMany: async () => Array.from(memory.drivers.values()),
    },
    vehicleOwner: { findUnique: async ({ where }) => memory.owners.get(where.owner_id) || null, findMany: async () => Array.from(memory.owners.values()) },
    vehicleHire: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [] },
    tripTimeline: { create: async ({ data }) => { memory.timelines.push(data); return data; } },
  };
  return prisma;
}

test('Quote-only: trip provisioned for enquiry appears in hire', async () => {
  reset();
  const prisma = makePrismaMock();
  memory.enquiries.set(1, { enquiry_id: 1, enquiry_number: 'ENQ-1', status: 'ENQUIRY_SUBMITTED', pickup_location: 'P', drop_location: 'D', pickup_date: '2026-10-01' });
  const provisioning = new TripProvisioningService({ prisma });
  const hire = new VehicleHireWorkflowService({ prisma });
  const res = await provisioning.ensureTripForEnquiry(1);
  assert.ok(res.trip);
  assert.equal(res.trip.vehicle_id, null);
});

test('Assignment from Vehicle Hire style updates trip', async () => {
  reset();
  const prisma = makePrismaMock();
  memory.vehicles.set(10, { vehicle_id: 10, vehicle_number: 'V1', owner_id: 1, capacity_kg: 10000, current_status: 'available' });
  memory.drivers.set(20, { driver_id: 20, driver_name: 'D1', status: 'available', transport_owner_id: 1 });
  memory.owners.set(1, { owner_id: 1, owner_name: 'O1' });
  memory.enquiries.set(1, { enquiry_id: 1, pickup_date: '2026-10-01', pickup_time: '10:00', weight: 1000, weight_unit: 'KG' });
  memory.trips.set(5, { trip_id: 5, enquiry_id: 1, status: 'PENDING', trip_date: new Date('2026-10-01') });
  
  const availability = new EnquiryAssignmentService({ prisma });
  const service = new TripVehicleAssignmentService({ prisma, availability });
  const res = await service.assign({ tripId: 5 }, { vehicle_id: 10, driver_id: 20 }, { userId: 1 });
  assert.equal(res.vehicle?.vehicle_id, 10);
  assert.ok(memory.timelines.length > 0);
});
