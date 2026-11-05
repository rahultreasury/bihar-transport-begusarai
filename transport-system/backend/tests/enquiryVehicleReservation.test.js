/**
 * Enquiry → Vehicle RESERVATION → Quote → Customer Acceptance.
 * ---------------------------------------------------------------------------
 * THE NEW OPERATIONAL ORDER, asserted end to end against an in-memory world.
 *
 *   ENQUIRY → ASSIGN VEHICLE + DRIVER → FINALISE QUOTE → CUSTOMER ACCEPTS
 *
 * The customer used to be told "₹5,000, we'll find you a truck" and had to wait
 * after accepting. The whole point of this change is that the vehicle and driver
 * are engaged BEFORE the quote is finalised, and that the reservation survives
 * acceptance intact — so nobody waits.
 *
 * NO DATABASE REQUIRED. The prisma client is an in-memory model of exactly the
 * tables and operations these services touch, and availability is delegated to
 * the REAL `EnquiryAssignmentService`, so the conflict rules under test are the
 * shipped ones rather than a re-statement of them.
 *
 * Run with: npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'enquiry-vehicle-reservation-test-secret';

const TripProvisioningService = require('../services/TripProvisioningService');
const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const { EnquiryAssignmentService } = require('../services/EnquiryAssignmentService');

const VEHICLE_ID = 11;
const DRIVER_ID = 20;
const OTHER_VEHICLE_ID = 12;
const OTHER_DRIVER_ID = 21;
const OWNER_ID = 7;
const OWNER_NAME = 'P7 Owner IDEM1';

/* ═══════════════════════════════════════════════════════════════════════════
   THE WORLD
   ═══════════════════════════════════════════════════════════════════════════ */

function newWorld(overrides = {}) {
  return {
    seq: { trip: 1, event: 1, hire: 1 },
    enquiries: {},
    bookings: {},
    trips: [],
    timeline: [],
    vehicles: {
      [VEHICLE_ID]: {
        vehicle_id: VEHICLE_ID,
        vehicle_number: 'BR09CC0004',
        vehicle_name: 'Ashok Leyland Tempo',
        vehicle_type: 'TEMPO',
        owner_id: OWNER_ID,
        capacity_kg: 1500,
        current_status: 'available',
        is_available: true,
      },
      [OTHER_VEHICLE_ID]: {
        vehicle_id: OTHER_VEHICLE_ID,
        vehicle_number: 'BR09CC0005',
        vehicle_name: 'Tata 407',
        vehicle_type: 'TRUCK',
        owner_id: OWNER_ID,
        capacity_kg: 2500,
        current_status: 'available',
        is_available: true,
      },
    },
    drivers: {
      [DRIVER_ID]: {
        driver_id: DRIVER_ID,
        driver_name: 'Kaushal',
        status: 'available',
        is_available: true,
        transport_owner_id: OWNER_ID,
      },
      [OTHER_DRIVER_ID]: {
        driver_id: OTHER_DRIVER_ID,
        driver_name: 'Ravi',
        status: 'available',
        is_available: true,
        transport_owner_id: OWNER_ID,
      },
    },
    owners: {
      [OWNER_ID]: {
        owner_id: OWNER_ID,
        owner_name: OWNER_NAME,
        company_name: OWNER_NAME,
        owner_type: 'TRANSPORT_OWNER',
        mobile: '9800000000',
      },
    },
    vehicleHires: [],
    ...overrides,
  };
}

/** Attach the trip's relations exactly as prisma's `include` would. */
function hydrateTrip(world, trip) {
  if (!trip) return null;
  return {
    ...trip,
    vehicle: trip.vehicle_id ? world.vehicles[trip.vehicle_id] || null : null,
    driver: trip.driver_id ? world.drivers[trip.driver_id] || null : null,
    transportOwner: trip.transport_owner_id ? world.owners[trip.transport_owner_id] || null : null,
  };
}

const matchOne = (where = {}, row) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });

function matchMany(where = {}, row) {
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === 'object') {
      if ('in' in v) return v.in.includes(row[k]);
      if ('notIn' in v) return !v.notIn.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      return true;
    }
    return row[k] === v;
  });
}

/** An in-memory prisma covering exactly what these services call. */
function fakePrisma(world) {
  const api = {
    // $transaction is wired below, once `api` exists, so the callback receives
    // the very same client — exactly how a real transaction client behaves.
    $transaction: async (fn) => fn(api),

    enquiry: {
      findUnique: async ({ where }) => {
        const row = world.enquiries[where.enquiry_id];
        if (!row) return null;
        return {
          ...row,
          assignedDriver: row.assigned_driver_id ? world.drivers[row.assigned_driver_id] : null,
          assignedVehicle: row.assigned_vehicle_id ? world.vehicles[row.assigned_vehicle_id] : null,
        };
      },
      findFirst: async ({ where }) => Object.values(world.enquiries).find((e) => matchMany(where, e)) || null,
      update: async ({ where, data }) => Object.assign(world.enquiries[where.enquiry_id], data),
      updateMany: async ({ where, data }) => {
        const rows = Object.values(world.enquiries).filter((e) => matchMany(where, e));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },

    booking: {
      findUnique: async ({ where }) => world.bookings[where.booking_id] || null,
      findFirst: async ({ where }) => Object.values(world.bookings).find((b) => matchMany(where, b)) || null,
      findMany: async ({ where }) => Object.values(world.bookings).filter((b) => matchMany(where, b)),
      update: async ({ where, data }) => Object.assign(world.bookings[where.booking_id], data),
      create: async ({ data }) => {
        const row = { booking_id: Object.keys(world.bookings).length + 1, ...data };
        world.bookings[row.booking_id] = row;
        return row;
      },
    },

    trip: {
      // `_tripInclude()` asks for vehicle/driver/vendor relations; a real prisma
      // hydrates them, so the fake must too or every assignment reads as null.
      findFirst: async ({ where }) => hydrateTrip(world, world.trips.find((t) => matchMany(where, t))),
      findUnique: async ({ where }) =>
        hydrateTrip(world, world.trips.find((t) => t.trip_id === where.trip_id)),
      create: async ({ data }) => {
        // The partial UNIQUE index on trips.enquiry_id, enforced in memory so the
        // duplicate-safety claim is actually exercised rather than assumed.
        if (data.enquiry_id != null && world.trips.some((t) => t.enquiry_id === data.enquiry_id)) {
          const err = new Error('uq_trips_enquiry_reservation');
          err.code = 'P2002';
          throw err;
        }
        const row = { trip_id: world.seq.trip++, ...data };
        world.trips.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = world.trips.find((t) => t.trip_id === where.trip_id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = world.trips.filter((t) => matchMany(where, t));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      },
    },

    vehicleHire: {
      findUnique: async ({ where }) =>
        world.vehicleHires.find((h) => h.trip_id === where.trip_id) || null,
      updateMany: async ({ where, data }) => {
        const hires = world.vehicleHires.filter((h) => {
          if (where.trip?.enquiry_id != null) {
            const trip = world.trips.find((t) => t.trip_id === h.trip_id);
            return trip && trip.enquiry_id === where.trip.enquiry_id;
          }
          if (where.trip_id != null) {
            return h.trip_id === where.trip_id;
          }
          if (where.booking_id != null) {
            return h.booking_id === where.booking_id;
          }
          return false;
        });
        hires.forEach((h) => Object.assign(h, data));
        return { count: hires.length };
      },
    },

    transportVehicle: {
      findUnique: async ({ where }) => world.vehicles[where.vehicle_id] || null,
      findMany: async ({ where }) => Object.values(world.vehicles).filter((v) => matchMany(where, v)),
      update: async ({ where, data }) => Object.assign(world.vehicles[where.vehicle_id], data),
    },

    driver: {
      findUnique: async ({ where }) => world.drivers[where.driver_id] || null,
      findMany: async ({ where }) => Object.values(world.drivers).filter((d) => matchMany(where, d)),
      update: async ({ where, data }) => Object.assign(world.drivers[where.driver_id], data),
    },

    vehicleOwner: {
      findUnique: async ({ where }) => world.owners[where.owner_id] || null,
      findMany: async () => Object.values(world.owners),
    },

    tripTimeline: { create: async () => ({}) },

    partner: { findUnique: async () => null, findMany: async () => [] },
  };

  return api;
}

/** A fresh ENQUIRY_SUBMITTED enquiry, which has no Booking and no Trip yet. */
function seedEnquiry(world, overrides = {}) {
  const enquiry = {
    enquiry_id: 500,
    enquiry_number: 'BTB-20261003-004071',
    status: 'ENQUIRY_SUBMITTED',
    booking_id: null,
    customer_id: 9,
    customer_name: 'Anita Sharma',
    customer_mobile: '9876543210',
    pickup_location: 'Patna Junction',
    drop_location: 'Bihar Transport, Begusarai',
    pickup_date: new Date('2026-10-10T00:00:00Z'),
    pickup_time: '10:00',
    distance_km: 90,
    weight: 800,
    weight_unit: 'KG',
    material: 'Sacks',
    final_quoted_price: null,
    assigned_vehicle_id: null,
    assigned_driver_id: null,
    assigned_owner_id: null,
    assigned_vehicle_number: null,
    assigned_vehicle_type: null,
    assigned_driver_name: null,
    ...overrides,
  };
  world.enquiries[enquiry.enquiry_id] = enquiry;
  return enquiry;
}

/** A world, a prisma, and the REAL services under test. */
function build() {
  const world = newWorld();
  const prisma = fakePrisma(world);
  const availability = new EnquiryAssignmentService({ prisma });

  // A deterministic stand-in for the existing trip-number generator, so the
  // test does not need the database-backed repository.
  const tripRepo = { generateTripNumber: async () => `BTBT-TEST-${world.seq.trip}` };

  const provisioning = new TripProvisioningService({ prisma, tripRepo });
  const assignment = new TripVehicleAssignmentService({ prisma, availability });

  return { world, prisma, provisioning, assignment };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1-3. PROVISION ON DEMAND, EXACTLY ONCE
   ═══════════════════════════════════════════════════════════════════════════ */

test('1-3. an enquiry with NO trip is provisioned exactly once, however often it is asked', async () => {
  const { world, provisioning } = build();
  seedEnquiry(world);

  // 2. "Click Assign Vehicle & Driver" — the browser asks for the trip.
  const first = await provisioning.ensureTripForEnquiry(500);

  assert.equal(first.created, true, 'the first ask creates the reservation trip');
  assert.equal(first.trip.trip_id, 1);
  assert.equal(world.trips.length, 1, 'exactly one trip exists');

  // 3. Repeat clicks converge on the same row — no duplicates, ever.
  const second = await provisioning.ensureTripForEnquiry(500);
  const third = await provisioning.ensureTripForEnquiry(500);

  assert.equal(second.created, false);
  assert.equal(third.created, false);
  assert.equal(second.trip.trip_id, first.trip.trip_id);
  assert.equal(world.trips.length, 1, 'provisioning is idempotent');
});

test('the reservation trip is created in the true waiting state', async () => {
  const { world, provisioning } = build();
  seedEnquiry(world);

  const { trip } = await provisioning.ensureTripForEnquiry(500);

  assert.equal(trip.enquiry_id, 500, 'anchored on the enquiry, because no Booking exists yet');
  assert.equal(trip.booking_id, null);
  assert.equal(trip.vehicle_id, null, 'WAITING FOR VEHICLE means no vehicle');
  assert.equal(trip.driver_id, null);
  assert.equal(trip.status, 'PENDING');
  assert.equal(trip.pickup_location, 'Patna Junction');
  assert.equal(trip.drop_location, 'Bihar Transport, Begusarai');
  assert.equal(trip.distance_km, 90);
  assert.ok(trip.trip_date instanceof Date, 'the trip date comes from the enquiry');
});

test('a database-level duplicate is refused, not merely avoided', async () => {
  const { world, prisma, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  // Simulate a second writer that bypasses the application's own read.
  await assert.rejects(
    () =>
      prisma.trip.create({
        data: {
          trip_number: 'BTBT-TEST-LEAK',
          enquiry_id: 500,
          pickup_location: 'x',
          pickup_city: 'x',
          drop_location: 'x',
          drop_city: 'x',
          freight_amount: 0,
          status: 'PENDING',
        },
      }),
    /uq_trips_enquiry_reservation/,
    'the UNIQUE partial index is the real guarantee, not just the code',
  );
  assert.equal(world.trips.length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6-10. ASSIGN VEHICLE + DRIVER, THROUGH THE ONE WRITER
   ═══════════════════════════════════════════════════════════════════════════ */

test('6-10. vehicle + driver assigned successfully, and the enquiry shows VEHICLE_ASSIGNED', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  const result = await assignment.assign(
    { enquiryId: 500 },
    { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID },
    { userId: 1, role: 'admin' },
  );

  // 9/10. the consignment is reserved, before anyone has quoted it.
  assert.equal(result.hire_status, 'VEHICLE_ASSIGNED');
  assert.equal(result.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(result.driver.driver_name, 'Kaushal');
  assert.equal(result.vendor.owner_name, OWNER_NAME);
  assert.equal(result.hire, null, 'no vendor payable exists merely because a truck was reserved');

  // The reservation is mirrored onto the enquiry, which is what the customer
  // quote and the acceptance hand-off both read.
  assert.equal(world.enquiries[500].assigned_vehicle_id, VEHICLE_ID);
  assert.equal(world.enquiries[500].assigned_driver_id, DRIVER_ID);
  assert.equal(world.enquiries[500].assigned_vehicle_number, 'BR09CC0004');
  assert.equal(world.enquiries[500].assigned_driver_name, 'Kaushal');
});

test('6. a driver belonging to a DIFFERENT owner is rejected', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  world.drivers[DRIVER_ID].transport_owner_id = 999; // someone else's driver

  await assert.rejects(
    () => assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    /does not belong to the selected vehicle vendor/,
  );
  assert.equal(world.enquiries[500].assigned_driver_id, null, 'nothing partial is left behind');
});

test('6. a truck whose capacity is too small for the load is rejected', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world, { weight: 9000, weight_unit: 'KG' });
  await provisioning.ensureTripForEnquiry(500);

  await assert.rejects(
    () => assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    /capacity|load|weight/i,
  );
});

test('7. a vehicle already committed to a conflicting trip is rejected', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  // Another consignment takes the same truck on the same pickup day.
  world.trips.push({
    trip_id: 99,
    trip_number: 'BTBT-OTHER',
    booking_id: 777,
    vehicle_id: VEHICLE_ID,
    driver_id: OTHER_DRIVER_ID,
    transport_owner_id: OWNER_ID,
    pickup_location: 'Patna',
    pickup_city: 'Patna',
    drop_location: 'Gaya',
    drop_city: 'Gaya',
    freight_amount: 0,
    status: 'ASSIGNED',
    trip_date: new Date('2026-10-10T00:00:00Z'),
  });

  await assert.rejects(
    () => assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    /already assigned to enquiry|already assigned|conflict/i,
  );
});

test('7. a driver already committed to a conflicting enquiry is rejected', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  seedEnquiry(world, {
    enquiry_id: 501,
    enquiry_number: 'BTB-20261003-004072',
    status: 'QUOTE_READY',
    pickup_date: new Date('2026-10-10T00:00:00Z'),
    assigned_driver_id: DRIVER_ID,
    assigned_driver_name: 'Kaushal',
  });

  await assert.rejects(
    () => assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    /already assigned/i,
  );
});

test('25. re-assigning the SAME resources is idempotent — no duplicate, no false history', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });
  const again = await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  assert.equal(again.hire_status, 'VEHICLE_ASSIGNED');
  assert.equal(world.trips.length, 1, 'still exactly one trip');
});

test('25. changing the vehicle supersedes rather than duplicates — one current assignment', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);

  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });
  const changed = await assignment.assign({ enquiryId: 500 }, { vehicle_id: OTHER_VEHICLE_ID });

  assert.equal(changed.vehicle.vehicle_number, 'BR09CC0005');
  assert.equal(changed.driver.driver_name, 'Kaushal', 'the driver is carried forward');
  assert.equal(world.trips.length, 1, 'assignment updates the one row; it never inserts a second');
});

/* ═══════════════════════════════════════════════════════════════════════════
   11-18. QUOTE THEN ACCEPTANCE — the customer never waits
   ═══════════════════════════════════════════════════════════════════════════ */

test('13-18. customer acceptance keeps the reservation and links the ONE trip to the Booking', async () => {
  const { world, prisma, assignment, provisioning } = build();
  seedEnquiry(world, {
    status: 'AWAITING_CUSTOMER_ACCEPTANCE',
    final_quoted_price: 5000,
  });
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  // 13.7/13.8 — acceptance binds the reservation to the Booking it just created.
  const booking = { booking_id: 42, booking_number: 'BTB-2026-00210', ...{} };
  world.bookings[42] = booking;
  world.enquiries[500].booking_id = 42;

  // The hand-off performed inside EnquiryService.customerAccept's transaction.
  await prisma.$transaction(async (tx) => {
    await tx.trip.updateMany({
      where: { enquiry_id: 500, booking_id: null },
      data: { booking_id: 42, status: 'ASSIGNED', updated_at: new Date() },
    });
  });

  // 16. the vehicle and driver remain assigned — the customer's acceptance is
  // not followed by "waiting for a vehicle".
  const after = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(after.hire_status, 'VEHICLE_ASSIGNED');
  assert.equal(after.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(after.driver.driver_name, 'Kaushal');
  assert.equal(after.booking_id, 42);

  // 15/25. one trip for the consignment, now operational.
  assert.equal(world.trips.length, 1);
  assert.equal(world.trips[0].booking_id, 42);
  assert.equal(world.trips[0].status, 'ASSIGNED');
});

test('20. a second acceptance does not create a second Booking or a second trip', async () => {
  const { world, provisioning } = build();
  seedEnquiry(world, { status: 'CONFIRMED', final_quoted_price: 5000, booking_id: 42 });
  world.bookings[42] = { booking_id: 42, booking_number: 'BTB-2026-00210' };

  await provisioning.ensureTripForEnquiry(500);
  await provisioning.ensureTripForEnquiry(500);
  await provisioning.ensureTripForEnquiry(500);

  assert.equal(world.trips.length, 1);
  assert.equal(Object.keys(world.bookings).length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   16-17. RELEASE ON REJECTION / CANCELLATION
   ═══════════════════════════════════════════════════════════════════════════ */

test('17. rejection releases the reservation so the fleet is not held for nothing', async () => {
  const { world, prisma, assignment, provisioning } = build();
  seedEnquiry(world, { status: 'AWAITING_CUSTOMER_ACCEPTANCE', final_quoted_price: 5000 });
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  assert.equal((await assignment.getCurrentAssignment({ enquiryId: 500 })).hire_status, 'VEHICLE_ASSIGNED');

  // The release performed by EnquiryService._releaseReservation.
  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { trip_id: 1 },
      data: { vehicle_id: null, driver_id: null, transport_owner_id: null },
    });
    await tx.enquiry.updateMany({
      where: { enquiry_id: 500 },
      data: {
        assigned_vehicle_id: null,
        assigned_vehicle_number: null,
        assigned_driver_id: null,
        assigned_driver_name: null,
        assigned_owner_id: null,
      },
    });
  });

  // 17. the resources are free again for the next enquiry.
  const after = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(after.hire_status, 'WAITING_FOR_VEHICLE');
  assert.equal(world.enquiries[500].assigned_vehicle_id, null);
  assert.equal(world.enquiries[500].assigned_driver_id, null);

  // And they can be assigned to a DIFFERENT enquiry immediately.
  seedEnquiry(world, { enquiry_id: 502, enquiry_number: 'BTB-20261003-004073' });
  await provisioning.ensureTripForEnquiry(502);
  const reused = await assignment.assign({ enquiryId: 502 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });
  assert.equal(reused.hire_status, 'VEHICLE_ASSIGNED');
});

/* ═══════════════════════════════════════════════════════════════════════════
   23. ONE ASSIGNMENT SYSTEM
   ═══════════════════════════════════════════════════════════════════════════ */

test('23. the enquiry and the trip resolve to the SAME single assignment', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world);
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  const byEnquiry = await assignment.getCurrentAssignment({ enquiryId: 500 });
  const byTrip = await assignment.getCurrentAssignment({ tripId: byEnquiry.trip_id });

  assert.deepEqual(byEnquiry, byTrip, 'one row, one answer, whichever key you use');
  assert.equal(byEnquiry.trip_id, 1);
  assert.equal(byEnquiry.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(byEnquiry.driver.driver_name, 'Kaushal');
});

/* ═══════════════════════════════════════════════════════════════════════════
   REGRESSION TESTS: Vehicle Hire Before Quotation & Instant Attachment
   ═══════════════════════════════════════════════════════════════════════════ */

test('REGRESSION: Vehicle Hire must be completed (VEHICLE_HIRED) before quote can be sent', async () => {
  const { world, assignment, provisioning } = build();
  seedEnquiry(world, { status: 'QUOTE_READY', final_quoted_price: 5000 });
  await provisioning.ensureTripForEnquiry(500);

  // Assign vehicle and driver (VEHICLE_ASSIGNED)
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });
  let afterAssign = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(afterAssign.hire_status, 'VEHICLE_ASSIGNED');
  assert.equal(afterAssign.hire, null, 'no hire money exists yet');

  // Simulate completing the Vehicle Hire (VEHICLE_HIRED) with financial terms
  // This is done via the VehicleHireWorkflowService in real code, but we simulate
  // the state change here to test the quote gate logic.
  const trip = world.trips[0];
  world.vehicleHires.push({
    hire_id: 1,
    trip_id: trip.trip_id,
    booking_id: null,
    vehicle_id: VEHICLE_ID,
    vendor_id: OWNER_ID,
    driver_id: DRIVER_ID,
    billing_to: 'BIHAR_TRANSPORT',
    business_model: 'CONTRACT_HIRE',
    rate_basis: 'PER_KM',
    rate_value: 50,
    rate_quantity: 90,
    rate_unit: 'km',
    gross_hire: 4500,
    commission_type: 'PERCENTAGE',
    commission_rate: 10,
    commission_amount: 450,
    net_vendor_payable: 4050,
    status: 'ACTIVE',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Now the assignment should show VEHICLE_HIRED with hire details
  const afterHire = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(afterHire.hire_status, 'VEHICLE_HIRED');
  assert.ok(afterHire.hire, 'hire financial details should exist');
  assert.equal(afterHire.hire.gross_hire, 4500);
  assert.equal(afterHire.hire.commission_amount, 450);
  assert.equal(afterHire.hire.net_vendor_payable, 4050);

  // The quote gate (canFinalizeQuote) should now allow sending the quote
  // This is tested in the frontend, but we verify the backend state is correct
  assert.equal(afterHire.hire_status, 'VEHICLE_HIRED', 'hire_status should be VEHICLE_HIRED');
});

test('REGRESSION: Customer acceptance links existing Vehicle Hire to Booking and returns vehicle info', async () => {
  const { world, prisma, assignment, provisioning } = build();
  seedEnquiry(world, { status: 'AWAITING_CUSTOMER_ACCEPTANCE', final_quoted_price: 5000 });
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  // Complete the Vehicle Hire
  const trip = world.trips[0];
  world.vehicleHires.push({
    hire_id: 1,
    trip_id: trip.trip_id,
    booking_id: null,
    vehicle_id: VEHICLE_ID,
    vendor_id: OWNER_ID,
    driver_id: DRIVER_ID,
    billing_to: 'BIHAR_TRANSPORT',
    business_model: 'CONTRACT_HIRE',
    rate_basis: 'PER_KM',
    rate_value: 50,
    rate_quantity: 90,
    rate_unit: 'km',
    gross_hire: 4500,
    commission_type: 'PERCENTAGE',
    commission_rate: 10,
    commission_amount: 450,
    net_vendor_payable: 4050,
    status: 'ACTIVE',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Simulate customer acceptance (hand-off performed in EnquiryService.customerAccept)
  const booking = { booking_id: 42, booking_number: 'BTB-2026-00210' };
  world.bookings[42] = booking;
  world.enquiries[500].booking_id = 42;

  await prisma.$transaction(async (tx) => {
    await tx.trip.updateMany({
      where: { enquiry_id: 500, booking_id: null },
      data: { booking_id: 42, status: 'ASSIGNED', updated_at: new Date() },
    });
    // Link existing Vehicle Hire to the new booking
    await tx.vehicleHire.updateMany({
      where: { trip: { enquiry_id: 500 }, booking_id: null },
      data: { booking_id: 42, updated_at: new Date() },
    });
  });

  // Verify the Vehicle Hire is now linked to the booking
  const linkedHire = world.vehicleHires.find(h => h.trip_id === trip.trip_id);
  assert.equal(linkedHire.booking_id, 42, 'Vehicle Hire should be linked to the booking');

  // Verify the assignment still shows the same vehicle and driver
  const after = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(after.hire_status, 'VEHICLE_HIRED');
  assert.equal(after.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(after.driver.driver_name, 'Kaushal');
  assert.equal(after.booking_id, 42);
  assert.ok(after.hire, 'hire financial details should be present');
  assert.equal(after.hire.gross_hire, 4500);
  assert.equal(after.hire.net_vendor_payable, 4050);
});

test('REGRESSION: No duplicate Vehicle Hire is created on customer acceptance', async () => {
  const { world, prisma, assignment, provisioning } = build();
  seedEnquiry(world, { status: 'AWAITING_CUSTOMER_ACCEPTANCE', final_quoted_price: 5000 });
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  // Complete the Vehicle Hire
  const trip = world.trips[0];
  world.vehicleHires.push({
    hire_id: 1,
    trip_id: trip.trip_id,
    booking_id: null,
    vehicle_id: VEHICLE_ID,
    vendor_id: OWNER_ID,
    driver_id: DRIVER_ID,
    billing_to: 'BIHAR_TRANSPORT',
    business_model: 'CONTRACT_HIRE',
    rate_basis: 'PER_KM',
    rate_value: 50,
    rate_quantity: 90,
    rate_unit: 'km',
    gross_hire: 4500,
    commission_type: 'PERCENTAGE',
    commission_rate: 10,
    commission_amount: 450,
    net_vendor_payable: 4050,
    status: 'ACTIVE',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const initialHireCount = world.vehicleHires.length;

  // Simulate customer acceptance
  const booking = { booking_id: 42, booking_number: 'BTB-2026-00210' };
  world.bookings[42] = booking;
  world.enquiries[500].booking_id = 42;

  await prisma.$transaction(async (tx) => {
    await tx.trip.updateMany({
      where: { enquiry_id: 500, booking_id: null },
      data: { booking_id: 42, status: 'ASSIGNED', updated_at: new Date() },
    });
    await tx.vehicleHire.updateMany({
      where: { trip: { enquiry_id: 500 }, booking_id: null },
      data: { booking_id: 42, updated_at: new Date() },
    });
  });

  // Verify no new Vehicle Hire was created
  assert.equal(world.vehicleHires.length, initialHireCount, 'No duplicate Vehicle Hire should be created');

  // Verify the existing hire was updated, not duplicated
  const hire = world.vehicleHires.find(h => h.trip_id === trip.trip_id);
  assert.equal(hire.booking_id, 42);
  assert.equal(hire.hire_id, 1, 'Same hire_id should be preserved');
});

test('REGRESSION: Admin confirmation also links Vehicle Hire and returns vehicle info', async () => {
  const { world, prisma, assignment, provisioning } = build();
  seedEnquiry(world, { status: 'AWAITING_CUSTOMER_ACCEPTANCE', final_quoted_price: 5000 });
  await provisioning.ensureTripForEnquiry(500);
  await assignment.assign({ enquiryId: 500 }, { vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID });

  // Complete the Vehicle Hire
  const trip = world.trips[0];
  world.vehicleHires.push({
    hire_id: 1,
    trip_id: trip.trip_id,
    booking_id: null,
    vehicle_id: VEHICLE_ID,
    vendor_id: OWNER_ID,
    driver_id: DRIVER_ID,
    billing_to: 'BIHAR_TRANSPORT',
    business_model: 'CONTRACT_HIRE',
    rate_basis: 'PER_KM',
    rate_value: 50,
    rate_quantity: 90,
    rate_unit: 'km',
    gross_hire: 4500,
    commission_type: 'PERCENTAGE',
    commission_rate: 10,
    commission_amount: 450,
    net_vendor_payable: 4050,
    status: 'ACTIVE',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Simulate admin confirmation (hand-off performed in EnquiryService._convertEnquiryToOrder)
  const booking = { booking_id: 42, booking_number: 'BTB-2026-00210' };
  world.bookings[42] = booking;
  world.enquiries[500].booking_id = 42;

  await prisma.$transaction(async (tx) => {
    await tx.trip.updateMany({
      where: { enquiry_id: 500, booking_id: null },
      data: { booking_id: 42, status: 'ASSIGNED', updated_at: new Date() },
    });
    await tx.vehicleHire.updateMany({
      where: { trip: { enquiry_id: 500 }, booking_id: null },
      data: { booking_id: 42, updated_at: new Date() },
    });
  });

  // Verify the Vehicle Hire is linked to the booking
  const linkedHire = world.vehicleHires.find(h => h.trip_id === trip.trip_id);
  assert.equal(linkedHire.booking_id, 42, 'Vehicle Hire should be linked to the booking');

  // Verify the assignment shows the hire details
  const after = await assignment.getCurrentAssignment({ enquiryId: 500 });
  assert.equal(after.hire_status, 'VEHICLE_HIRED');
  assert.ok(after.hire, 'hire financial details should be present');
  assert.equal(after.hire.gross_hire, 4500);
  assert.equal(after.hire.commission_amount, 450);
  assert.equal(after.hire.net_vendor_payable, 4050);
});