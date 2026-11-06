/**
 * tests/tripNumbering.test.js
 * ----------------------------
 * Unit tests for canonical trip number generation via TripNumberService.
 *
 * Covers:
 *   1. Correct canonical number generation (BTBT-YYYY-NNNNN).
 *   2. Correct year handling (from trip created_at).
 *   3. Multiple sequential Trip creations.
 *   4. Concurrent Trip creations (no duplicate numbers).
 *   5. Existing Trip reuse (provisioning returns existing trip).
 *   6. Failed Trip creation rollback (no partial records).
 *   7. No committed temporary identifiers (temp UUID never visible).
 *   8. Existing Trip numbers remain unchanged.
 *
 * Uses mocked repositories and a patched prisma.$transaction so no real
 * database is touched. Concurrency is simulated with interleaved async calls.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { prisma: realPrisma } = require('../config/prisma');
const TripNumberService = require('../services/TripNumberService');

/** Build a mock Prisma transaction client with trip + related models. */
function makeTx(overrides = {}) {
  const state = {
    trips: {},
    ...overrides.state,
  };

  let seq = 0;

  const tripModel = {
    create: async ({ data }) => {
      if (overrides.tripCreate) return overrides.tripCreate(data);
      // Simulate DB unique constraint on booking_id (one trip per booking)
      const existing = Object.values(state.trips).find((r) => r.booking_id === data.booking_id);
      if (existing) {
        throw new Error(`Unique constraint violation on booking_id: ${data.booking_id}`);
      }
      seq += 1;
      const id = seq;
      const created_at = data.created_at || new Date();
      const row = {
        trip_id: id,
        trip_number: data.trip_number,
        ...data,
        created_at,
      };
      state.trips[id] = row;
      return row;
    },
    update: async ({ where, data }) => {
      const row = state.trips[where.trip_id];
      if (!row) throw new Error(`Trip ${where.trip_id} not found`);
      state.trips[where.trip_id] = { ...row, ...data };
      return state.trips[where.trip_id];
    },
    findFirst: async ({ where }) => {
      const rows = Object.values(state.trips);
      if (where.booking_id) {
        return rows.find((r) => r.booking_id === where.booking_id) || null;
      }
      if (where.enquiry_id) {
        return rows.find((r) => r.enquiry_id === where.enquiry_id) || null;
      }
      return null;
    },
  };

  const tx = {
    $executeRaw: async () => 1,
    trip: tripModel,
    transportVehicle: {
      findUnique: async ({ where }) => ({
        vehicle_id: where.vehicle_id,
        owner_id: 7,
        vehicle_number: 'TN-01',
      }),
    },
    driver: {
      findUnique: async ({ where }) => ({
        driver_id: where.driver_id,
        transport_owner_id: 7,
        driver_name: 'Test Driver',
      }),
    },
    bookingEvent: { create: async () => ({ booking_event_id: 1 }) },
    $transaction: async (cb) => cb(tx),
  };
  tx.state = state;
  return { tx, state };
}

/** Build a full mock Prisma client for TripProvisioningService pre-transaction queries. */
function makeMockPrisma(tx) {
  return {
    trip: tx.trip,
    transportVehicle: {
      findUnique: async ({ where }) => ({
        vehicle_id: where.vehicle_id,
        owner_id: 7,
        vehicle_number: 'TN-01',
      }),
    },
    driver: {
      findUnique: async ({ where }) => ({
        driver_id: where.driver_id,
        transport_owner_id: 7,
        driver_name: 'Test Driver',
      }),
    },
    user: {
      findUnique: async () => ({ user_id: 5, role: 'customer' }),
    },
    booking: {
      findUnique: async () => ({
        booking_id: 100,
        quote_status: 'ACCEPTED',
        status: 'confirmed',
        user_id: 5,
      }),
    },
    enquiry: {
      findUnique: async ({ where }) => ({
        enquiry_id: where.enquiry_id,
        booking_id: null,
        pickup_location: 'Begusarai',
        drop_location: 'Patna',
        distance_km: 180,
        final_quoted_price: 9000,
        pickup_date: '2026-11-05',
        special_instructions: null,
      }),
    },
    $executeRaw: async () => 1,
    $transaction: async (cb) => cb(tx),
  };
}

/** Build a full mock Prisma client for TripService pre-transaction queries. */
function makeMockTripServicePrisma(tx) {
  return {
    trip: tx.trip,
    user: {
      findUnique: async () => ({ user_id: 5, role: 'customer' }),
    },
    driver: {
      findUnique: async () => ({ driver_id: 1, transport_owner_id: 7, driver_name: 'Test Driver' }),
    },
    booking: {
      findUnique: async ({ where }) => ({
        booking_id: where.booking_id,
        quote_status: 'ACCEPTED',
        status: 'confirmed',
        user_id: 5,
        vehicle_id: null,
        driver_id: null,
        vehicle_owner_id: null,
        pickup_location: 'Begusarai',
        drop_location: 'Patna',
        estimated_distance_km: 180,
        final_price: 9000,
        pickup_date: '2026-11-05',
        special_instructions: null,
        quote_remarks: null,
      }),
    },
    vehicleOwner: {
      findUnique: async () => ({ owner_id: 7, owner_type: 'TRANSPORT_COMPANY' }),
    },
    transportVehicle: {
      findUnique: async () => ({ vehicle_id: 1, owner_id: 7, vehicle_number: 'TN-01' }),
    },
    $executeRaw: async () => 1,
    $transaction: async (cb) => cb(tx),
  };
}

function makeFakeBooking(overrides = {}) {
  return {
    booking_id: 100,
    quote_status: 'ACCEPTED',
    status: 'confirmed',
    user_id: 5,
    vehicle_id: null,
    driver_id: null,
    vehicle_owner_id: null,
    pickup_location: 'Begusarai',
    drop_location: 'Patna',
    estimated_distance_km: 180,
    final_price: 9000,
    pickup_date: '2026-11-05',
    special_instructions: null,
    quote_remarks: null,
    ...overrides,
  };
}

function makeFakeEnquiry(overrides = {}) {
  return {
    enquiry_id: 200,
    booking_id: null,
    pickup_location: 'Begusarai',
    drop_location: 'Patna',
    distance_km: 180,
    final_quoted_price: 9000,
    pickup_date: '2026-11-05',
    special_instructions: null,
    ...overrides,
  };
}

describe('TripNumberService.buildTripNumber', () => {
  test('1. Generates canonical BTBT-YYYY-NNNNN format', () => {
    const number = TripNumberService.buildTripNumber(42, new Date('2026-03-15'));
    assert.match(number, /^BTBT-2026-00042$/);
  });

  test('2. Pads trip ID to 5 digits', () => {
    assert.equal(TripNumberService.buildTripNumber(7, new Date('2026-01-01')), 'BTBT-2026-00007');
    assert.equal(TripNumberService.buildTripNumber(99999, new Date('2026-01-01')), 'BTBT-2026-99999');
    assert.equal(TripNumberService.buildTripNumber(100000, new Date('2026-01-01')), 'BTBT-2026-100000');
  });

  test('3. Uses year from created_at when provided', () => {
    assert.equal(TripNumberService.buildTripNumber(1, new Date('2025-12-31')), 'BTBT-2025-00001');
    assert.equal(TripNumberService.buildTripNumber(1, new Date('2027-01-01')), 'BTBT-2027-00001');
  });

  test('4. Throws for invalid tripId', () => {
    assert.throws(() => TripNumberService.buildTripNumber(0, new Date()), /tripId is required/);
    assert.throws(() => TripNumberService.buildTripNumber(-1, new Date()), /tripId is required/);
    assert.throws(() => TripNumberService.buildTripNumber(null, new Date()), /tripId is required/);
    assert.throws(() => TripNumberService.buildTripNumber(undefined, new Date()), /tripId is required/);
  });
});

describe('TripRepository.createTripWithCanonicalNumber', () => {
  test('5. Creates trip with canonical number derived from PK', async (t) => {
    const { tx, state } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const trip = await repo.createTripWithCanonicalNumber({
      booking_id: 100,
      source_type: 'ONLINE_BOOKING',
      status: 'PENDING',
    });

    assert.equal(trip.trip_id, 1);
    assert.match(trip.trip_number, /^BTBT-2026-00001$/);
    assert.equal(state.trips[1].trip_number, trip.trip_number);
    assert.ok(!trip.trip_number.startsWith('TEMP-'));
  });

  test('6. Temporary UUID is never committed as final number', async (t) => {
    const { tx, state } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const trip = await repo.createTripWithCanonicalNumber({
      booking_id: 100,
      status: 'PENDING',
    });

    assert.ok(!trip.trip_number.startsWith('TEMP-'));
    assert.ok(!state.trips[1].trip_number.startsWith('TEMP-'));
  });

  test('7. Multiple sequential trips get sequential numbers', async (t) => {
    const { tx, state } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const t1 = await repo.createTripWithCanonicalNumber({ booking_id: 100, status: 'PENDING' });
    const t2 = await repo.createTripWithCanonicalNumber({ booking_id: 101, status: 'PENDING' });
    const t3 = await repo.createTripWithCanonicalNumber({ booking_id: 102, status: 'PENDING' });

    assert.equal(t1.trip_number, 'BTBT-2026-00001');
    assert.equal(t2.trip_number, 'BTBT-2026-00002');
    assert.equal(t3.trip_number, 'BTBT-2026-00003');
    assert.equal(Object.keys(state.trips).length, 3);
  });

  test('8. Uses custom created_at year for number', async (t) => {
    const { tx, state } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const trip = await repo.createTripWithCanonicalNumber({
      booking_id: 100,
      status: 'PENDING',
      created_at: new Date('2025-06-15'),
    });

    assert.equal(trip.trip_number, 'BTBT-2025-00001');
  });

  test('9. Failed creation rollback leaves no partial records', async (t) => {
    const { tx, state } = makeTx({
      state: { trips: {} },
      tripCreate: async () => { throw new Error('DB write failed'); },
    });
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    await assert.rejects(
      () => repo.createTripWithCanonicalNumber({ booking_id: 100, status: 'PENDING' }),
      /DB write failed/
    );
    assert.equal(Object.keys(state.trips).length, 0, 'no trip row after failed creation');
  });
});

describe('TripProvisioningService canonical numbering', () => {
  test('10. ensureTripForBooking creates trip with canonical number', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });
    const booking = makeFakeBooking();

    const result = await provisioning.ensureTripForBooking(100, booking, null, null, null);

    assert.ok(result.trip.trip_id);
    assert.match(result.trip.trip_number, /^BTBT-2026-\d{5}$/);
    assert.ok(!result.trip.trip_number.startsWith('TEMP-'));
    assert.equal(result.trip.booking_id, 100);
    assert.equal(result.trip.source_type, 'ONLINE_BOOKING');
  });

  test('11. ensureTripForBooking reuses existing trip (idempotent)', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });
    const booking = makeFakeBooking();

    const first = await provisioning.ensureTripForBooking(100, booking, null, null, null);
    const second = await provisioning.ensureTripForBooking(100, booking, null, null, null);

    assert.equal(first.trip.trip_id, second.trip.trip_id, 'same trip returned');
    assert.equal(Object.keys(tx.state.trips).length, 1, 'only one trip row created');
  });

  test('12. ensureTripForEnquiry creates trip with canonical number', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });
    const enquiry = makeFakeEnquiry();

    const result = await provisioning.ensureTripForEnquiry(200, enquiry);

    assert.ok(result.trip.trip_id);
    assert.match(result.trip.trip_number, /^BTBT-2026-\d{5}$/);
    assert.equal(result.trip.enquiry_id, 200);
  });

  test('13. Concurrent booking provisioning does not create duplicate trips', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });
    const booking = makeFakeBooking();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => provisioning.ensureTripForBooking(100, booking, null, null, null))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.trip);
    assert.ok(successful.length >= 1, 'at least one concurrent call succeeds');
    const tripIds = successful.map((r) => r.trip_id);
    const uniqueIds = new Set(tripIds);
    assert.equal(uniqueIds.size, 1, 'all successful calls return the same trip');
    assert.equal(Object.keys(tx.state.trips).length, 1, 'only one trip row exists');
  });

  test('14. Concurrent enquiry provisioning does not create duplicate trips', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });
    const enquiry = makeFakeEnquiry();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => provisioning.ensureTripForEnquiry(200, enquiry))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.trip);
    assert.ok(successful.length >= 1, 'at least one concurrent call succeeds');
    const tripIds = successful.map((r) => r.trip_id);
    const uniqueIds = new Set(tripIds);
    assert.equal(uniqueIds.size, 1, 'all successful calls return the same trip');
    assert.equal(Object.keys(tx.state.trips).length, 1, 'only one trip row exists');
  });

  test('15. Concurrent trips for different bookings get unique canonical numbers', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockPrisma(tx);
    delete require.cache[require.resolve('../services/TripProvisioningService')];
    const TripProvisioningService = require('../services/TripProvisioningService');
    const provisioning = new TripProvisioningService({ prisma: mockPrisma });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        provisioning.ensureTripForBooking(100 + i, makeFakeBooking({ booking_id: 100 + i }), null, null, null)
      )
    );

    const numbers = results.map((r) => r.trip.trip_number);
    const uniqueNumbers = new Set(numbers);
    assert.equal(uniqueNumbers.size, 10, 'all 10 concurrent trips have unique numbers');
    assert.equal(Object.keys(tx.state.trips).length, 10, 'all 10 trip rows exist');

    for (const num of numbers) {
      assert.match(num, /^BTBT-2026-\d{5}$/);
    }
  });
});

describe('TripService.createTrip canonical numbering', () => {
  test('16. createTrip creates trip with canonical number', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockTripServicePrisma(tx);

    // Patch the module-level prisma that TripService imports
    const keys = Object.keys(mockPrisma);
    for (const key of keys) {
      realPrisma[key] = mockPrisma[key];
    }

    delete require.cache[require.resolve('../services/TripService')];
    const TripService = require('../services/TripService');
    const tripService = new TripService();

    try {
      const result = await tripService.createTrip({
        source_type: 'ONLINE_BOOKING',
        booking_id: 100,
        user_id: 5,
        vehicle_id: 1,
        driver_id: 1,
        transport_owner_id: 7,
        pickup_location: 'Begusarai',
        pickup_city: 'Begusarai',
        drop_location: 'Patna',
        drop_city: 'Patna',
        distance_km: 180,
        trip_date: new Date('2026-11-05'),
        freight_amount: 9000,
        status: 'PENDING',
      });

      assert.ok(result.trip_id);
      assert.match(result.trip_number, /^BTBT-2026-\d{5}$/);
      assert.ok(!result.trip_number.startsWith('TEMP-'));
    } finally {
      // Restore original prisma properties
      for (const key of Object.keys(mockPrisma)) {
        delete realPrisma[key];
      }
    }
  });

  test('17. createTrip does not accept trip_number from caller', async (t) => {
    const { tx } = makeTx();
    const mockPrisma = makeMockTripServicePrisma(tx);

    const keys = Object.keys(mockPrisma);
    for (const key of keys) {
      realPrisma[key] = mockPrisma[key];
    }

    delete require.cache[require.resolve('../services/TripService')];
    const TripService = require('../services/TripService');
    const tripService = new TripService();

    try {
      const result = await tripService.createTrip({
        source_type: 'ONLINE_BOOKING',
        booking_id: 100,
        user_id: 5,
        trip_number: 'BTBT-FAKE-99999',
        vehicle_id: 1,
        driver_id: 1,
        transport_owner_id: 7,
        pickup_location: 'Begusarai',
        pickup_city: 'Begusarai',
        drop_location: 'Patna',
        drop_city: 'Patna',
        distance_km: 180,
        trip_date: new Date('2026-11-05'),
        freight_amount: 9000,
        status: 'PENDING',
      });

      assert.notEqual(result.trip_number, 'BTBT-FAKE-99999');
      assert.match(result.trip_number, /^BTBT-2026-\d{5}$/);
    } finally {
      for (const key of Object.keys(mockPrisma)) {
        delete realPrisma[key];
      }
    }
  });

  test('18. Existing trip numbers remain unchanged (no renumbering)', async (t) => {
    const { tx, state } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const trip = await repo.createTripWithCanonicalNumber({
      booking_id: 100,
      status: 'PENDING',
    });

    const updated = await repo.update(trip.trip_id, { status: 'ASSIGNED' });

    assert.equal(updated.trip_number, trip.trip_number, 'trip_number preserved on update');
    assert.equal(updated.status, 'ASSIGNED');
  });
});

describe('Concurrency safety under load', () => {
  test('19. 50 concurrent trips get 50 unique canonical numbers', async (t) => {
    const { tx } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        repo.createTripWithCanonicalNumber({ booking_id: 1000 + i, status: 'PENDING' })
      )
    );

    const numbers = results.map((r) => r.trip_number);
    const uniqueNumbers = new Set(numbers);
    assert.equal(uniqueNumbers.size, 50, 'all 50 concurrent trips have unique numbers');
    assert.equal(Object.keys(tx.state.trips).length, 50);

    const sorted = [...numbers].sort();
    for (let i = 0; i < sorted.length; i++) {
      assert.equal(sorted[i], `BTBT-2026-${String(i + 1).padStart(5, '0')}`);
    }
  });

  test('20. No TEMP- prefix leaks into any committed trip number', async (t) => {
    const { tx } = makeTx();
    const TripRepository = require('../repositories/TripRepository');
    const repo = new TripRepository(tx);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        repo.createTripWithCanonicalNumber({ booking_id: 2000 + i, status: 'PENDING' })
      )
    );

    for (const r of results) {
      assert.ok(!r.trip_number.startsWith('TEMP-'), `trip ${r.trip_id} has temp prefix`);
      assert.match(r.trip_number, /^BTBT-\d{4}-\d{5}$/);
    }
  });
});
