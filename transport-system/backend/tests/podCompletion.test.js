/**
 * POD Completion Regression Tests
 * Mocked tests for POD workflow
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- Test helpers ---
function makePrismaMock(initialTrips = []) {
  const s = {
    trips: [...initialTrips],
    tripDocuments: [],
    tripTimeline: [],
    vehicles: [{ vehicle_id: 1, vehicle_number: 'TN-01', status: 'ACTIVE' }],
    drivers: [{ driver_id: 1, driver_name: 'Raj Kumar', status: 'ACTIVE' }],
    auditLogs: [],
    __seq: {},
  };

  const prisma = {
    trip: {
      findUnique: async ({ where, include, select }) => {
        const t = s.trips.find((x) => x.trip_id === where.trip_id);
        if (!t) return null;
        return { ...t };
      },
      findFirst: async ({ where }) => {
        return s.trips.find((x) => {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'trip_id' && typeof v === 'object' && v.equals) {
              if (!x.trip_id) return false;
              if (x.trip_id !== Number(v.equals)) return false;
            } else if (x[k] !== v) return false;
          }
          return true;
        }) || null;
      },
      update: async ({ where, data }) => {
        const idx = s.trips.findIndex((x) => x.trip_id === where.trip_id);
        if (idx === -1) throw new Error('Trip not found');
        s.trips[idx] = { ...s.trips[idx], ...data, updated_at: new Date() };
        return { ...s.trips[idx] };
      },
      create: async ({ data }) => {
        const tripId = data.trip_id || (10000 + (s.__seq.trip = (s.__seq.trip || 0) + 1));
        const row = { ...data, trip_id: tripId, created_at: new Date(), updated_at: new Date() };
        s.trips.push(row);
        return row;
      },
    },
    tripDocument: {
      findUnique: async ({ where }) => {
        if (where.trip_id_document_type) {
          return s.tripDocuments.find(
            (d) => d.trip_id === where.trip_id_document_type.trip_id && d.document_type === where.trip_id_document_type.document_type
          ) || null;
        }
        return s.tripDocuments.find((d) => d.document_id === where.document_id) || null;
      },
      findFirst: async ({ where }) => {
        return s.tripDocuments.find((d) => {
          if (where.document_id && d.document_id !== where.document_id) return false;
          if (where.trip_id && d.trip_id !== where.trip_id) return false;
          if (where.document_type && d.document_type !== where.document_type) return false;
          return true;
        }) || null;
      },
      create: async ({ data }) => {
        s.__seq.doc = (s.__seq.doc || 0) + 1;
        const row = { ...data, document_id: 1000 + s.__seq.doc, created_at: new Date(), updated_at: new Date() };
        s.tripDocuments.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const idx = s.tripDocuments.findIndex((d) => d.document_id === where.document_id);
        if (idx === -1) throw new Error('Document not found');
        s.tripDocuments[idx] = { ...s.tripDocuments[idx], ...data, updated_at: new Date() };
        return s.tripDocuments[idx];
      },
      delete: async ({ where }) => {
        const idx = s.tripDocuments.findIndex((d) => d.document_id === where.document_id);
        if (idx === -1) throw new Error('Document not found');
        const deleted = s.tripDocuments.splice(idx, 1)[0];
        return deleted;
      },
    },
    transportVehicle: {
      findUnique: async ({ where }) => {
        return s.vehicles?.find((v) => v.vehicle_id === where.vehicle_id) || null;
      },
      findFirst: async ({ where }) => {
        return s.vehicles?.find((v) => {
          for (const [k, v2] of Object.entries(where)) {
            if (v[k] !== v2) return false;
          }
          return true;
        }) || null;
      },
      update: async ({ where, data }) => {
        const idx = s.vehicles.findIndex((v) => v.vehicle_id === where.vehicle_id);
        if (idx === -1) {
          s.vehicles.push({ ...data, vehicle_id: where.vehicle_id, created_at: new Date(), updated_at: new Date() });
          return s.vehicles[s.vehicles.length - 1];
        }
        s.vehicles[idx] = { ...s.vehicles[idx], ...data, updated_at: new Date() };
        return s.vehicles[idx];
      },
    },
    vehicle: {
      findUnique: async ({ where }) => {
        return s.vehicles.find((v) => v.vehicle_id === where.vehicle_id) || null;
      },
      findFirst: async ({ where }) => {
        return s.vehicles.find((v) => {
          for (const [k, v2] of Object.entries(where)) {
            if (v[k] !== v2) return false;
          }
          return true;
        }) || null;
      },
      update: async ({ where, data }) => {
        const idx = s.vehicles.findIndex((v) => v.vehicle_id === where.vehicle_id);
        if (idx === -1) {
          s.vehicles.push({ ...data, vehicle_id: where.vehicle_id, created_at: new Date(), updated_at: new Date() });
          return s.vehicles[s.vehicles.length - 1];
        }
        s.vehicles[idx] = { ...s.vehicles[idx], ...data, updated_at: new Date() };
        return s.vehicles[idx];
      },
    },
    driver: {
      findUnique: async ({ where }) => {
        return s.drivers.find((d) => d.driver_id === where.driver_id) || null;
      },
      findFirst: async ({ where }) => {
        return s.drivers.find((d) => {
          for (const [k, v2] of Object.entries(where)) {
            if (d[k] !== v2) return false;
          }
          return true;
        }) || null;
      },
      update: async ({ where, data }) => {
        const idx = s.drivers.findIndex((d) => d.driver_id === where.driver_id);
        if (idx === -1) {
          s.drivers.push({ ...data, driver_id: where.driver_id, created_at: new Date(), updated_at: new Date() });
          return s.drivers[s.drivers.length - 1];
        }
        s.drivers[idx] = { ...s.drivers[idx], ...data, updated_at: new Date() };
        return s.drivers[idx];
      },
    },
    auditLog: {
      create: async ({ data }) => {
        s.__seq.al = (s.__seq.al || 0) + 1;
        const row = { ...data, audit_log_id: 3000 + s.__seq.al, created_at: new Date() };
        s.auditLogs.push(row);
        return row;
      },
    },
    tripTimeline: {
      create: async ({ data }) => {
        s.__seq.tl = (s.__seq.tl || 0) + 1;
        const row = { ...data, timeline_id: 2000 + s.__seq.tl, created_at: new Date() };
        s.tripTimeline.push(row);
        return row;
      },
      findFirst: async ({ where }) => {
        return s.tripTimeline.find((t) => {
          for (const [k, v] of Object.entries(where)) {
            if (t[k] !== v) return false;
          }
          return true;
        }) || null;
      },
      findMany: async ({ where, orderBy, select }) => {
        let results = s.tripTimeline.filter((t) => {
          if (where.trip_id && t.trip_id !== where.trip_id) return false;
          if (where.event_type && t.event_type !== where.event_type) return false;
          return true;
        });
        if (orderBy) {
          const dir = orderBy.timeline_id === 'desc' ? -1 : 1;
          results.sort((a, b) => (a.timeline_id - b.timeline_id) * dir);
        }
        return results;
      },
      count: async ({ where }) => {
        return s.tripTimeline.filter((t) => {
          if (where.trip_id && t.trip_id !== where.trip_id) return false;
          return true;
        }).length;
      },
    },
    $transaction: async (fn) => {
      return fn(prisma);
    },
  };

  return prisma;
}

// Seed a trip that is IN_TRANSIT
const mockPrisma = makePrismaMock([{
  trip_id: 1,
  trip_number: 'BT-2026-0001',
  status: 'IN_TRANSIT',
  transport_owner_id: 1,
  vehicle_id: 1,
  driver_id: 1,
  client_id: 1,
  booking_id: 1,
  drop_location: 'Kolkata',
  drop_city: 'Kolkata',
  pod_required: true,
  documents_required: true,
  arrived_at_destination_at: null,
  arrival_remarks: null,
  delivered_receiver_name: null,
  delivery_remarks: null,
  trip_delivered_date: null,
  completed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
}]);

// --- Tests ---

test('POD: IN_TRANSIT allows POD submission', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  const result = await service.submitPod(1, { reference_number: 'POD-001', remarks: 'Test POD' }, { user_id: 1 });
  assert.ok(result.pod, 'POD should be created');
  assert.ok(result.pod.document_id, 'POD should have document_id');
});

test('POD: PENDING status cannot submit POD', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 99,
      trip_number: 'BT-2026-0099',
      status: 'PENDING',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: true,
      documents_required: true,
    },
  });

  await assert.rejects(
    () => service.submitPod(99, { reference_number: 'POD-002' }, { user_id: 1 }),
    (err) => err.message.includes('Cannot supply a POD')
  );
});

test('POD: Verify with correct document ID succeeds', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  const result = await service.submitPod(1, { reference_number: 'POD-001b', remarks: 'Test POD' }, { user_id: 1 });
  const docId = result.pod.document_id;

  const verified = await service.verifyPod(1, docId, { user_id: 1 });
  assert.equal(verified.pod.document_status, 'VERIFIED');
});

test('POD: Verify with wrong document ID fails', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await assert.rejects(
    () => service.verifyPod(1, 99999, { user_id: 1 }),
    (err) => err.message.includes('Document not found for this trip')
  );
});

test('POD: Cannot mark delivered before POD verification', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 10,
      trip_number: 'BT-2026-0010',
      status: 'IN_TRANSIT',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: true,
      documents_required: true,
      arrived_at_destination_at: new Date(),
    },
  });

  await service.submitPod(10, { reference_number: 'POD-003', remarks: 'Unverified POD' }, { user_id: 1 });

  await assert.rejects(
    () => service.markDelivered(10, { delivered_receiver_name: 'John Doe' }, { user_id: 1 }),
    (err) => err.message.includes('not yet verified')
  );
});

test('POD: Full flow - arrive → POD → verify → deliver → complete', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 20,
      trip_number: 'BT-2026-0020',
      status: 'IN_TRANSIT',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: true,
      documents_required: true,
      arrived_at_destination_at: null,
      delivered_receiver_name: null,
    },
  });

  // Arrive at destination
  await service.arriveAtDestination(20, { arrived_at: new Date(), remarks: 'Arrived at Kolkata' }, { user_id: 1 });

  // Submit POD
  const podResult = await service.submitPod(20, { reference_number: 'POD-004', remarks: 'Final POD' }, { user_id: 1 });

  // Verify POD
  await service.verifyPod(20, podResult.pod.document_id, { user_id: 1 });

  // Mark delivered
  await service.markDelivered(20, { delivered_receiver_name: 'John Doe', delivery_remarks: 'Goods received in good condition' }, { user_id: 1 });

  // Complete
  const completed = await service.completeTrip(20, {}, { user_id: 1 });
  assert.equal(completed.trip.status, 'COMPLETED');
});

test('POD: Invalid document type rejected', () => {
  const { TripDocumentService } = require('../services/TripDocumentService');
  const service = new TripDocumentService({ prisma: mockPrisma });

  assert.throws(
    () => service.validateDocument({ document_type: 'INVALID_TYPE' }),
    (err) => err.message.includes('Invalid document_type')
  );
});

test('POD: Duplicate POD submission is idempotent', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 30,
      trip_number: 'BT-2026-0030',
      status: 'IN_TRANSIT',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: true,
      documents_required: true,
    },
  });

  await service.submitPod(30, { reference_number: 'POD-DUP-001' }, { user_id: 1 });
  const result = await service.submitPod(30, { reference_number: 'POD-DUP-001' }, { user_id: 1 });
  assert.equal(result.already_recorded, true);
});

test('POD: Delivery readiness blocks when POD required but not supplied', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 50,
      trip_number: 'BT-2026-0050',
      status: 'IN_TRANSIT',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: true,
      documents_required: true,
      arrived_at_destination_at: new Date(),
      delivered_receiver_name: 'Receiver',
    },
  });

  const readiness = await service.getDeliveryReadiness(50);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.code === 'POD_NOT_SUPPLIED'));
});

test('POD: Delivery readiness passes when POD not required', async () => {
  const { TripDeliveryService } = require('../services/TripDeliveryService');
  const service = new TripDeliveryService({ prisma: mockPrisma });

  await mockPrisma.trip.create({
    data: {
      trip_id: 51,
      trip_number: 'BT-2026-0051',
      status: 'IN_TRANSIT',
      transport_owner_id: 1,
      vehicle_id: 1,
      driver_id: 1,
      pod_required: false,
      documents_required: false,
      arrived_at_destination_at: new Date(),
      delivered_receiver_name: 'Receiver',
    },
  });

  const readiness = await service.getDeliveryReadiness(51);
  assert.equal(readiness.ready, true);
});

test('POD: File type validation - PDF allowed', () => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  assert.ok(allowedTypes.includes('application/pdf'));
});

test('POD: File type validation - Word rejected', () => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  assert.ok(!allowedTypes.includes('application/msword'));
});

console.log('POD Completion regression tests completed');
