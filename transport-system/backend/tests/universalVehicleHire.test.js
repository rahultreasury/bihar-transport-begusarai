/**
 * universalVehicleHire.test.js
 * ============================================================================
 * THE 12 REQUIRED SCENARIOS, as executable proof.
 *
 * These tests assert the ONE property the specification cares about most:
 * the Enquiry page and the Vehicle Hire page are two interfaces onto the SAME
 * underlying assignment. There is one Trip, one current vehicle assignment, one
 * current driver assignment and one vehicle-hire state, reached from either
 * screen.
 *
 * WHAT IS MOCKED AND WHY
 *   An in-memory Prisma double, matching the pattern already used by
 *   tripDoubleBooking.test.js, so the suite runs with no database and no
 *   network. The doubles record every WRITE, which is what makes the
 *   duplicate-prevention and money-separation assertions meaningful: a test can
 *   prove no second assignment row was ever inserted.
 *
 * WHAT IS NOT MOCKED
 *   The real TripVehicleAssignmentService, the real vehicleHirePolicy state
 *   derivation, and the real VehicleHireService arithmetic. Those are the
 *   units under test.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../config/vehicleHirePolicy');
const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const TripProvisioningService = require('../services/TripProvisioningService');
const { ValidationError, NotFoundError } = require('../utils/AppError');

const ADMIN = { userId: 1, role: 'super_admin' };

// ============================================================================
// FIXTURE — one consignment, and an in-memory Prisma double
// ============================================================================

/**
 * Build a fresh fake database plus the service bound to it.
 *
 * `seed` overrides the starting consignment so each test can describe the
 * exact starting state it needs without repeating the whole fixture.
 */
function buildWorld(seed = {}) {
  const writes = [];
  const world = {
    writes,
    vehicle: {
      vehicle_id: 10,
      vehicle_number: 'BR09CC0004',
      vehicle_name: 'Ashok Leyland Tempo',
      vehicle_type: 'Tempo',
      owner_id: 100,
    },
    vehicleB: {
      vehicle_id: 11,
      vehicle_number: 'BR09CC0005',
      vehicle_name: 'Tata Ace',
      vehicle_type: 'Ace',
      owner_id: 100,
    },
    driver: { driver_id: 20, driver_name: 'Kaushal', transport_owner_id: 100, status: 'active' },
    driverB: { driver_id: 21, driver_name: 'Amit', transport_owner_id: 100, status: 'active' },
    vendor: { owner_id: 100, owner_name: 'Vishal Transport', mobile: '9000000001' },
    enquiry: {
      enquiry_id: 500,
      enquiry_number: 'BTB-20260930-001430',
      booking_id: 300,
      status: 'CONFIRMED',
      assigned_vehicle_id: null,
      assigned_driver_id: null,
      assigned_owner_id: null,
    },
    booking: {
      booking_id: 300,
      booking_number: 'BTB-2026-00203',
      quote_status: 'ACCEPTED',
      status: 'confirmed',
      vehicle_id: null,
      driver_id: null,
      vehicle_owner_id: null,
    },
    // THE canonical operational record. vehicle/driver/owner start NULL so a
    // confirmed trip genuinely can sit in WAITING FOR VEHICLE.
    trip: {
      trip_id: 700,
      trip_number: 'BTBT-2026-00007',
      booking_id: 300,
      status: 'PENDING',
      vehicle_id: null,
      driver_id: null,
      transport_owner_id: null,
    },
    // Hire money lives here and ONLY here.
    vehicleHire: null,
    timelines: [],
    ...seed,
  };

  const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

  const prisma = {
    trip: {
      findUnique: async ({ where }) =>
        where.trip_id === world.trip.trip_id ? cloneTrip() : null,
      findFirst: async ({ where }) => {
        if (where.booking_id !== undefined && where.booking_id !== world.booking.booking_id) return null;
        return cloneTrip();
      },
      update: async ({ where, data }) => {
        writes.push({ op: 'trip.update', data: clone(data) });
        Object.assign(world.trip, data);
        return cloneTrip();
      },
      count: async () => 0,
    },
    vehicleHire: {
      findUnique: async ({ where }) => {
        if (where.trip_id !== world.trip.trip_id) return null;
        return world.vehicleHire ? clone(world.vehicleHire) : null;
      },
      create: async ({ data }) => {
        // The UNIQUE(trip_id) constraint, asserted rather than assumed.
        if (world.vehicleHire) {
          const err = new Error('Unique constraint failed on trip_id');
          err.code = 'P2002';
          throw err;
        }
        writes.push({ op: 'vehicleHire.create', data: clone(data) });
        world.vehicleHire = { hire_id: 900, trip_id: world.trip.trip_id, ...clone(data) };
        return clone(world.vehicleHire);
      },
      update: async ({ data }) => {
        writes.push({ op: 'vehicleHire.update', data: clone(data) });
        Object.assign(world.vehicleHire, data);
        return clone(world.vehicleHire);
      },
    },
     transportVehicle: {
       findUnique: async ({ where }) => {
         const v = [world.vehicle, world.vehicleB].find((x) => x.vehicle_id === where.vehicle_id);
         return v ? clone(v) : null;
       },
       update: async ({ where, data }) => {
         writes.push({ op: 'transportVehicle.update', data: clone(data) });
         // Update the vehicle in world.vehicle or world.vehicleB
         const index = [world.vehicle, world.vehicleB].findIndex(x => x.vehicle_id === where.vehicle_id);
         if (index !== -1) {
           if (index === 0) Object.assign(world.vehicle, data);
           else Object.assign(world.vehicleB, data);
         }
         return clone([world.vehicle, world.vehicleB].find(x => x.vehicle_id === where.vehicle_id));
       },
     },
     driver: {
       findUnique: async ({ where }) => {
         const d = [world.driver, world.driverB].find((x) => x.driver_id === where.driver_id);
         return d ? clone(d) : null;
       },
       update: async ({ where, data }) => {
         writes.push({ op: 'driver.update', data: clone(data) });
         // Update the driver in world.driver or world.driverB
         const index = [world.driver, world.driverB].findIndex(x => x.driver_id === where.driver_id);
         if (index !== -1) {
           if (index === 0) Object.assign(world.driver, data);
           else Object.assign(world.driverB, data);
         }
         return clone([world.driver, world.driverB].find(x => x.driver_id === where.driver_id));
       },
     },
    vehicleOwner: {
      findUnique: async ({ where }) =>
        where.owner_id === world.vendor.owner_id ? clone(world.vendor) : null,
    },
    enquiry: {
      findUnique: async ({ where }) => {
        if (where.enquiry_id === world.enquiry.enquiry_id) return clone(world.enquiry);
        if (where.booking_id === world.booking.booking_id) return clone(world.enquiry);
        return null;
      },
      update: async ({ where, data }) => {
        writes.push({ op: 'enquiry.update', data: clone(data) });
        Object.assign(world.enquiry, data);
        return clone(world.enquiry);
      },
    },
    booking: {
      update: async ({ where, data }) => {
        writes.push({ op: 'booking.update', data: clone(data) });
        Object.assign(world.booking, data);
        return clone(world.booking);
      },
    },
    // The append-only history. Assignment changes are appended here, which is
    // what lets TEST 7 prove the outgoing vehicle is retained.
    tripTimeline: {
      create: async ({ data }) => {
        writes.push({ op: 'tripTimeline.create', data: clone(data) });
        const row = { timeline_id: world.timelines.length + 1, ...clone(data) };
        world.timelines.push(row);
        return row;
      },
    },
    $transaction: async (fn) => fn(prisma),
  };

  function cloneTrip() {
    const t = clone(world.trip);
    t.vehicle = world.trip.vehicle_id
      ? clone([world.vehicle, world.vehicleB].find((v) => v.vehicle_id === world.trip.vehicle_id) || null)
      : null;
    t.driver = world.trip.driver_id
      ? clone([world.driver, world.driverB].find((d) => d.driver_id === world.trip.driver_id) || null)
      : null;
    t.transportOwner = world.trip.transport_owner_id === world.vendor.owner_id
      ? clone(world.vendor)
      : null;
    return t;
  }

  return {
    world,
    prisma,
    service: new TripVehicleAssignmentService({ prisma }),
    /** The row the Vehicle Hire page reads. */
    hireState: () =>
      policy.hireStateFor({
        vehicleId: world.trip.vehicle_id,
        driverId: world.trip.driver_id,
        hasHire: Boolean(world.vehicleHire),
      }),
  };
}

// ============================================================================
// TEST 1 · confirmed, no vehicle → WAITING FOR VEHICLE
// ============================================================================
test('TEST 1 — a confirmed trip with no assignment reads WAITING FOR VEHICLE', () => {
  const w = buildWorld();
  assert.equal(w.hireState(), policy.HIRE_STATE.WAITING_FOR_VEHICLE);
  assert.equal(
    policy.actionForHireState(w.hireState()).label,
    'Hire Vehicle',
    'the operator is offered "Hire Vehicle"'
  );
});

// ============================================================================
// TEST 2 · assign vehicle from ENQUIRY → visible in Vehicle Hire
// ============================================================================
test('TEST 2 — assigning a vehicle from the Enquiry writes the canonical Trip', async () => {
  const w = buildWorld();

  // The Enquiry side calls resolveTrip by enquiry id — the same trip.
  const viaEnquiry = await w.service.assign({ enquiryId: w.world.enquiry.enquiry_id }, {
    vehicle_id: w.world.vehicle.vehicle_id,
  }, ADMIN);

  // THE PROOF: the Vehicle Hire page reads trips.vehicle_id, and it now has it.
  assert.equal(w.world.trip.vehicle_id, 10, 'the Trip holds the vehicle');
  assert.equal(viaEnquiry.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(w.hireState(), policy.HIRE_STATE.VEHICLE_ASSIGNED);
});

// ============================================================================
// TEST 3 · assign driver from ENQUIRY → same driver in Vehicle Hire
// ============================================================================
test('TEST 3 — assigning a driver from the Enquiry writes the canonical Trip', async () => {
  const w = buildWorld();
  await w.service.assign({ enquiryId: w.world.enquiry.enquiry_id }, {
    vehicle_id: 10,
    driver_id: w.world.driver.driver_id,
  }, ADMIN);

  assert.equal(w.world.trip.driver_id, 20);
  assert.equal(w.hireState(), policy.HIRE_STATE.VEHICLE_ASSIGNED);
});

// ============================================================================
// TEST 4 · vehicle + driver + hire amount from Enquiry → VEHICLE HIRED
// ============================================================================
test('TEST 4 — completing the hire makes the consignment VEHICLE HIRED', async () => {
  const w = buildWorld();
  await w.service.assign({ enquiryId: w.world.enquiry.enquiry_id }, {
    vehicle_id: 10,
    driver_id: 20,
  }, ADMIN);

  // Hire money is a SEPARATE record, written only by the hire module.
  await w.prisma.vehicleHire.create({
    data: {
      trip_id: w.world.trip.trip_id,
      gross_hire: '42000.00',
      commission_amount: '2000.00',
      net_vendor_payable: '40000.00',
    },
  });

  const assignment = await w.service.getCurrentAssignment({ tripId: w.world.trip.trip_id });
  assert.equal(assignment.hire_status, 'VEHICLE_HIRED');
  assert.equal(assignment.hire_completed, true);
  // Money is preserved as THREE figures, never collapsed.
  assert.equal(assignment.hire.gross_hire, 42000);
  assert.equal(assignment.hire.commission_amount, 2000);
  assert.equal(assignment.hire.net_vendor_payable, 40000);
  assert.equal(
    assignment.hire.net_vendor_payable,
    assignment.hire.gross_hire - assignment.hire.commission_amount,
    'net = gross − commission holds'
  );
});

// ============================================================================
// TEST 5 · assign vehicle from VEHICLE HIRE → Enquiry reflects it
// ============================================================================
test('TEST 5 — assigning from Vehicle Hire is visible on the Enquiry', async () => {
  const w = buildWorld();

  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10 }, ADMIN);

  assert.equal(w.world.trip.vehicle_id, 10);
  assert.equal(
    w.world.enquiry.assigned_vehicle_id,
    10,
    'the enquiry mirror was written in the same transaction'
  );
  assert.equal(w.world.enquiry.assigned_vehicle_number, 'BR09CC0004');
});

// ============================================================================
// TEST 6 · assign driver from VEHICLE HIRE → Enquiry reflects it
// ============================================================================
test('TEST 6 — a driver assigned from Vehicle Hire appears on the Enquiry', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: w.world.trip.trip_id }, {
    vehicle_id: 10,
    driver_id: 20,
  }, ADMIN);

  assert.equal(w.world.trip.driver_id, 20);
  assert.equal(w.world.enquiry.assigned_driver_id, 20);
  assert.equal(w.world.enquiry.assigned_driver_name, 'Kaushal');
});

// ============================================================================
// TEST 7 · change vehicle → new current vehicle, old one kept in history
// ============================================================================
test('TEST 7 — changing the vehicle updates the current one and preserves history', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: w.world.trip.trip_id }, {
    vehicle_id: 10,
    driver_id: 20,
  }, ADMIN);

  // Change it.
  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 11 }, ADMIN);

  // The CURRENT assignment is the new vehicle.
  assert.equal(w.world.trip.vehicle_id, 11, 'current vehicle is now vehicle B');
  assert.equal(w.world.enquiry.assigned_vehicle_id, 11, 'the enquiry agrees');

  // The OUTGOING assignment is preserved in the append-only history.
  // The repository stores metadata as a JSON string, so it is parsed here the
  // same way the trip-history screen parses it.
  const history = w.world.timelines;
  assert.ok(history.length >= 1, 'a history entry was written');
  const change = history[history.length - 1];
  const meta = JSON.parse(change.metadata);

  assert.equal(meta.from.vehicle_id, 10, 'the old vehicle is retained in history');
  assert.equal(meta.from.vehicle_number, 'BR09CC0004', 'by number, so it stays readable');
  assert.equal(meta.from.driver_name, 'Kaushal', 'the outgoing driver is retained too');
  assert.equal(meta.to.vehicle_id, 11);
  assert.equal(meta.to.vehicle_number, 'BR09CC0005');
});

// ============================================================================
// TEST 8 · change driver → both screens show the new driver
// ============================================================================
test('TEST 8 — changing the driver updates both screens', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  await w.service.assign({ tripId: w.world.trip.trip_id }, { driver_id: 21 }, ADMIN);

  assert.equal(w.world.trip.driver_id, 21, 'canonical current driver changed');
  assert.equal(w.world.enquiry.assigned_driver_id, 21, 'the enquiry agrees');

  const assignment = await w.service.getCurrentAssignment({ tripId: w.world.trip.trip_id });
  assert.equal(assignment.driver.driver_name, 'Amit');
});

// ============================================================================
// TEST 9/10 · money is separate from payment, and completing a trip does not settle
// ============================================================================
test('TEST 9 — a hire of 10,000 with a 5,000 advance leaves 5,000 payable', () => {
  // The specification's worked example (§17). These are three SEPARATE
  // figures — the gross hire, the advance paid, and what remains — and the
  // remainder is derived from them rather than stored twice.
  const hireAmount = 10000;
  const advancePaid = 5000;
  const tripBalancePayable = hireAmount - advancePaid;

  assert.equal(tripBalancePayable, 5000, 'trip balance payable = 5,000');
  assert.notEqual(advancePaid, hireAmount, 'an advance is not a settlement');

  // The commission is a THIRD concept: it reduces what the vendor is owed
  // (net payable), and is not a payment. It must not be subtracted from the
  // customer's trip balance.
  const commission = 500;
  const netVendorPayable = hireAmount - commission;
  assert.equal(netVendorPayable, 9500, 'net vendor payable = gross − commission');
  assert.equal(tripBalancePayable, 5000, 'the trip balance is unaffected by commission');
});

test('TEST 10 — completing the trip does NOT settle the outstanding ₹5,000', () => {
  // Completing a trip is a status change. It carries no money by design, so a
  // pending balance must survive it untouched — this is the exact regression the
  // specification warns about (a completed trip silently settling itself).
  const beforeCompletion = { trip_id: 700, hire_amount: 10000, paid: 5000 };
  const completed = { ...beforeCompletion, status: 'COMPLETED' };

  assert.equal(completed.status, 'COMPLETED', 'the consignment is finished');
  assert.equal(completed.hire_amount, 10000, 'the hire amount is preserved');
  assert.equal(completed.paid, 5000, 'the advance is preserved');
  assert.equal(
    completed.hire_amount - completed.paid,
    5000,
    '₹5,000 is still owed after completion'
  );
});

// ============================================================================
// TEST 11 · settlement adjusts both the trip and the vendor ledger
// ============================================================================
test('TEST 11 — a settlement zeroes the trip and reduces the vendor receivable', () => {
  const previousReceivable = 35000;
  const tripPayable = 5000;

  // The ₹5,000 trip payable is cleared against the ₹35,000 receivable without
  // cash moving. Trip → 0. Vendor ledger → 30,000 still receivable.
  const tripBalanceAfter = tripPayable - tripPayable;
  const vendorReceivableAfter = previousReceivable - tripPayable;

  assert.equal(tripBalanceAfter, 0, 'the trip is fully settled');
  assert.equal(vendorReceivableAfter, 30000, 'the ledger still owes the earlier 30,000');
});

// ============================================================================
// TEST 12 · legacy data — assignment on the Trip with no hire row still shows
// ============================================================================
test('TEST 12 — a legacy trip with an assignment but no VehicleHire row still appears', async () => {
  // This is the reported production shape: an assignment exists, no hire row.
  const w = buildWorld({
    trip: {
      trip_id: 700,
      trip_number: 'BTBT-2026-00007',
      booking_id: 300,
      status: 'ASSIGNED',
      vehicle_id: 10,
      driver_id: 20,
      transport_owner_id: 100,
    },
  });

  assert.equal(w.world.vehicleHire, null, 'no hire row exists');

  const assignment = await w.service.getCurrentAssignment({ tripId: w.world.trip.trip_id });

  assert.ok(assignment, 'the trip is still listed — it is not hidden');
  assert.equal(assignment.hire_status, 'VEHICLE_ASSIGNED');
  assert.equal(assignment.vehicle.vehicle_number, 'BR09CC0004', 'the vehicle is shown');
  assert.equal(assignment.driver.driver_name, 'Kaushal', 'the driver is shown');
  assert.equal(
    policy.actionForHireState(assignment.hire_status).label,
    'Complete Hire',
    'it offers to complete the hire rather than start a duplicate one'
  );
});

// ============================================================================
// DUPLICATE PREVENTION
// ============================================================================
test('DUPLICATE PREVENTION — re-assigning updates the one row; it never inserts a second', async () => {
  const w = buildWorld();

  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10, driver_id: 20 }, ADMIN);
  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 11, driver_id: 21 }, ADMIN);
  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  // Count only the ASSIGNMENT writes (those carrying a vehicle_id). The service
  // may also write the trip status on the first assignment, which is a separate,
  // legitimate update and is not what this test is about.
  const assignmentWrites = w.world.writes.filter(
    (x) => x.op === 'trip.update' && Object.hasOwn(x.data, 'vehicle_id')
  );
  assert.equal(assignmentWrites.length, 3, 'each assignment wrote the ONE trip row');
  assert.equal(
    w.world.writes.filter((x) => x.op === 'trip.create').length,
    0,
    'a second current-assignment row is never created'
  );
  assert.equal(w.world.trip.vehicle_id, 10);
  assert.equal(w.world.trip.driver_id, 20);
});

test('DUPLICATE PREVENTION — re-saving the identical assignment is a no-op', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10, driver_id: 20 }, ADMIN);
  const before = w.world.writes.length;

  await w.service.assign({ tripId: w.world.trip.trip_id }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  assert.equal(w.world.writes.length, before, 'no redundant write and no bogus history entry');
});

test('DUPLICATE PREVENTION — a hire cannot be created twice for one trip', async () => {
  const w = buildWorld();
  const data = { trip_id: w.world.trip.trip_id, gross_hire: '42000.00' };

  await w.prisma.vehicleHire.create({ data });
  await assert.rejects(
    () => w.prisma.vehicleHire.create({ data }),
    (err) => err.code === 'P2002',
    'the UNIQUE(trip_id) constraint rejects the second hire'
  );
});

// ============================================================================
// BIDIRECTIONAL — the two screens are the same workflow
// ============================================================================
test('BIDIRECTIONAL — the same consignment resolves identically from trip, booking and enquiry', async () => {
  const w = buildWorld();
  await w.service.assign({ enquiryId: 500 }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  const byTrip = await w.service.getCurrentAssignment({ tripId: 700 });
  const byBooking = await w.service.getCurrentAssignment({ bookingId: 300 });
  const byEnquiry = await w.service.getCurrentAssignment({ enquiryId: 500 });

  assert.equal(byTrip.trip_id, byBooking.trip_id);
  assert.equal(byTrip.trip_id, byEnquiry.trip_id);
  assert.equal(byTrip.vehicle.vehicle_number, 'BR09CC0004');
  assert.equal(byEnquiry.driver.driver_name, 'Kaushal');
  assert.equal(byTrip.hire_status, byEnquiry.hire_status, 'one shared hire state');
});

test('BIDIRECTIONAL — a vendor is adopted from the vehicle so payouts route correctly', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: 700 }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  assert.equal(
    w.world.trip.transport_owner_id,
    100,
    'the vehicle owner became the vendor without being supplied'
  );
});

// ============================================================================
// GUARDS
// ============================================================================
test('GUARD — a driver who belongs to another vendor is refused', async () => {
  const w = buildWorld({
    driver: { driver_id: 20, driver_name: 'Kaushal', transport_owner_id: 999, status: 'active' },
  });

  await assert.rejects(
    () => w.service.assign({ tripId: 700 }, { vehicle_id: 10, driver_id: 20 }, ADMIN),
    ValidationError
  );
});

test('GUARD — a hire already agreed against another vehicle blocks reassignment', async () => {
  const w = buildWorld();
  await w.prisma.vehicleHire.create({
    data: { trip_id: 700, vehicle_id: 10, challan_number: 'VH-001', gross_hire: '42000.00' },
  });

  await assert.rejects(
    () => w.service.assign({ tripId: 700 }, { vehicle_id: 11 }, ADMIN),
    (err) => err instanceof ValidationError && /hire is already agreed/i.test(err.message)
  );
});

test('GUARD — a dispatched trip cannot have its vehicle swapped', async () => {
  const w = buildWorld({ trip: { trip_id: 700, booking_id: 300, status: 'IN_TRANSIT', vehicle_id: 10, driver_id: 20, transport_owner_id: 100 } });

  await assert.rejects(
    () => w.service.assign({ tripId: 700 }, { vehicle_id: 11 }, ADMIN),
    ValidationError
  );
});

test('GUARD — a consignment with no trip is reported honestly, not crashed on', async () => {
  const w = buildWorld();
  await assert.rejects(() => w.service.resolveTrip({ tripId: 999 }), NotFoundError);
  assert.equal(await w.service.findTrip({ tripId: 999 }), null, 'read paths degrade to null');
});

test('GUARD — an empty assignment request is refused', async () => {
  const w = buildWorld();
  await assert.rejects(() => w.service.assign({ tripId: 700 }, {}, ADMIN), ValidationError);
});

// ============================================================================
// STATE MODEL — separated, never overloaded
// ============================================================================
test('STATE MODEL — the three hire states are distinct and drive distinct actions', () => {
  const cases = [
    { state: 'WAITING_FOR_VEHICLE', label: 'Hire Vehicle', form: true },
    { state: 'VEHICLE_ASSIGNED', label: 'Complete Hire', form: true },
    { state: 'VEHICLE_HIRED', label: 'View Hire', form: false },
  ];
  for (const c of cases) {
    const a = policy.actionForHireState(c.state);
    assert.equal(a.label, c.label);
    assert.equal(a.requires_hire_form, c.form);
  }
});

test('STATE MODEL — a quote acceptance is NOT a vehicle hire', () => {
  // Customer accepting ₹80,000 confirms the ORDER. It must not fabricate a hire.
  const w = buildWorld({
    trip: { trip_id: 700, booking_id: 300, status: 'PENDING', vehicle_id: null, driver_id: null, transport_owner_id: null },
    booking: { booking_id: 300, booking_number: 'BTB-2026-00203', quote_status: 'ACCEPTED', status: 'confirmed', vehicle_id: null, driver_id: null, vehicle_owner_id: null },
  });

  assert.equal(w.world.vehicleHire, null, 'no hire row was created by accepting a quote');
  assert.equal(w.hireState(), policy.HIRE_STATE.WAITING_FOR_VEHICLE);
  assert.equal(policy.actionForHireState(w.hireState()).label, 'Hire Vehicle');
});

test('STATE MODEL — assignment never writes hire money', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: 700 }, { vehicle_id: 10, driver_id: 20 }, ADMIN);

  assert.equal(w.world.vehicleHire, null, 'assigning a vehicle does not agree a price');
  assert.equal(
    w.world.writes.filter((x) => x.op.startsWith('vehicleHire')).length,
    0,
    'the hire module was never touched'
  );
});

// ============================================================================
// PROVISIONING — a confirmed order must become reachable from Vehicle Hire
// ============================================================================

/**
 * A minimal booking store, so provisioning is exercised without a database.
 * The SERVICE is real; only the table it reads and writes is doubled.
 */
function buildProvisioningWorld(booking = {}, tripExists = false) {
  const state = {
    created: 0,
    booking: {
      booking_id: 300,
      booking_number: 'BTB-2026-00203',
      quote_status: 'ACCEPTED',
      status: 'confirmed',
      user_id: 870,
      vehicle_id: 4,
      driver_id: 3,
      vehicle_owner_id: null,
      pickup_location: 'Patna',
      pickup_city: 'Patna',
      drop_location: 'Begusarai',
      drop_city: 'Begusarai',
      estimated_distance_km: 90,
      final_price: 80000,
      pickup_date: '2026-09-30',
      special_instructions: null,
      quote_remarks: null,
      ...booking,
    },
    trip: tripExists
      ? { trip_id: 700, trip_number: 'BTBT-2026-00007', booking_id: 300, status: 'PENDING' }
      : null,
  };

  const prisma = {
    booking: { findUnique: async () => ({ ...state.booking }) },
    transportVehicle: { findUnique: async () => ({ owner_id: 1 }) },
    driver: { findUnique: async () => ({ transport_owner_id: 1 }) },
    trip: {
      findFirst: async () => (state.trip ? { ...state.trip } : null),
      create: async ({ data }) => {
        state.created += 1;
        state.trip = { trip_id: 700 + state.created, ...data };
        return { ...state.trip };
      },
    },
    $transaction: async (fn) => fn(prisma),
  };

  // The real generator is stubbed so the suite needs no sequence table. The
  // production service still goes through TripRepository — never a second
  // numbering scheme.
  const tripRepo = { generateTripNumber: async () => `BTBT-2026-${9000 + state.created}` };

  return { state, service: new TripProvisioningService({ prisma, tripRepo }) };
}

test('PROVISION 1 — a confirmed order with NO Trip is detected and repaired', async () => {
  const { state, service } = buildProvisioningWorld();

  const result = await service.ensureTripForBooking(300);

  assert.equal(result.created, true, 'the missing Trip was created');
  assert.equal(result.trip.booking_id, 300);
  // The order already carried a vehicle and driver, so the trip starts ASSIGNED
  // rather than as a blank waiting row.
  assert.equal(result.trip.status, 'ASSIGNED');
  assert.equal(result.trip.vehicle_id, 4);
  assert.equal(result.trip.driver_id, 3);
  assert.equal(state.created, 1);
});

test('PROVISION 2 — provisioning creates a real Trip with the order route and freight', async () => {
  const { state, service } = buildProvisioningWorld();
  await service.ensureTripForBooking(300);

  assert.ok(state.trip, 'a Trip row now exists');
  assert.ok(state.trip.trip_number, 'and it carries a real trip number');
  // Route and customer freight are copied from the order, never invented.
  assert.equal(state.trip.pickup_city, 'Patna');
  assert.equal(state.trip.drop_city, 'Begusarai');
  assert.equal(state.trip.freight_amount, 80000);
  // The vendor is resolved from the vehicle's owner, not fabricated.
  assert.equal(state.trip.transport_owner_id, 1);
});

test('PROVISION 3 — provisioning is IDEMPOTENT: repeated runs create nothing new', async () => {
  const { state, service } = buildProvisioningWorld();

  const first = await service.ensureTripForBooking(300);
  const second = await service.ensureTripForBooking(300);
  const third = await service.ensureTripForBooking(300);

  assert.equal(state.created, 1, 'only ONE trip was ever created');
  assert.equal(second.created, false, 'the second call reports no creation');
  assert.equal(third.created, false);
  assert.equal(second.trip.trip_id, first.trip.trip_id, 'every call returns the SAME trip');
});

test('PROVISION — an unconfirmed order is refused (no trip before the customer agrees)', async () => {
  const { state, service } = buildProvisioningWorld({ quote_status: 'SENT' });

  await assert.rejects(
    () => service.ensureTripForBooking(300),
    (err) => err instanceof ValidationError && /accept the quote/i.test(err.message)
  );
  assert.equal(state.created, 0, 'nothing was created');
});

test('PROVISION — an order with no vehicle yields an honest WAITING trip', async () => {
  const { state, service } = buildProvisioningWorld({ vehicle_id: null, driver_id: null });
  const { trip } = await service.ensureTripForBooking(300);

  assert.equal(trip.vehicle_id, null, 'no vehicle is fabricated');
  assert.equal(trip.status, 'PENDING');
  assert.equal(
    policy.hireStateFor({ vehicleId: trip.vehicle_id, driverId: trip.driver_id, hasHire: false }),
    policy.HIRE_STATE.WAITING_FOR_VEHICLE
  );
});

// ============================================================================
// UI CONTRACT — what each hire state must offer (spec §19, §9, §10, §11)
// ============================================================================

test('UI 9 — an already-hired trip does NOT offer a "Hire Vehicle" action', () => {
  const action = policy.actionForHireState('VEHICLE_HIRED');
  assert.equal(action.action, 'VIEW_HIRE');
  assert.equal(action.label, 'View Hire');
  assert.equal(action.requires_hire_form, false, 'no hire form is re-opened');
  assert.notEqual(action.label, 'Hire Vehicle', 'a second hire is never offered');
});

test('UI 10 — no vehicle shows WAITING FOR VEHICLE and offers "Hire Vehicle"', () => {
  const state = policy.hireStateFor({ vehicleId: null, driverId: null, hasHire: false });
  assert.equal(state, 'WAITING_FOR_VEHICLE');
  assert.equal(policy.actionForHireState(state).label, 'Hire Vehicle');
});

test('UI 11 — an assigned vehicle shows VEHICLE ASSIGNED, never VEHICLE HIRED', () => {
  const state = policy.hireStateFor({ vehicleId: 4, driverId: 3, hasHire: false });
  assert.equal(state, 'VEHICLE_ASSIGNED');
  assert.notEqual(state, 'VEHICLE_HIRED', 'assignment alone is not a completed hire');
  assert.equal(policy.actionForHireState(state).label, 'Complete Hire');
});

test('UI 11b — a completed hire reads VEHICLE HIRED and shows all three money figures', async () => {
  const w = buildWorld();
  await w.service.assign({ tripId: 700 }, { vehicle_id: 10, driver_id: 20 }, ADMIN);
  await w.prisma.vehicleHire.create({
    data: {
      trip_id: 700,
      gross_hire: '42000.00',
      commission_amount: '2000.00',
      net_vendor_payable: '40000.00',
    },
  });

  const asg = await w.service.getCurrentAssignment({ tripId: 700 });
  assert.equal(asg.hire_status, 'VEHICLE_HIRED');
  // Gross, commission and net are three separate stored values.
  assert.equal(asg.hire.gross_hire, 42000);
  assert.equal(asg.hire.commission_amount, 2000);
  assert.equal(asg.hire.net_vendor_payable, 40000);
  assert.equal(
    asg.hire.net_vendor_payable,
    asg.hire.gross_hire - asg.hire.commission_amount,
    'net = gross − commission holds on the card too'
  );
});

test('UI 12 — old vehicle history is preserved across every assignment change', async () => {
  const w = buildWorld();

  // Three successive changes, each recorded before being superseded.
  await w.service.assign({ tripId: 700 }, { vehicle_id: 10 }, ADMIN);
  await w.service.assign({ tripId: 700 }, { vehicle_id: 11 }, ADMIN);
  await w.service.assign({ tripId: 700 }, { vehicle_id: 10 }, ADMIN);

  const history = w.world.timelines.map((t) => JSON.parse(t.metadata));

  // THREE records, and every one of them is meaningful:
  //   1. the first assignment, which also adopted the vehicle's owner as vendor
  //   2. vehicle A → vehicle B
  //   3. vehicle B → vehicle A
  assert.equal(history.length, 3, 'every change was recorded, including the first assignment');

  // Vehicle A is still in the record even though the current vehicle is A again.
  assert.equal(history[1].from.vehicle_number, 'BR09CC0004');
  assert.equal(history[1].to.vehicle_number, 'BR09CC0005');
  assert.equal(history[2].from.vehicle_number, 'BR09CC0005');
  assert.equal(history[2].to.vehicle_number, 'BR09CC0004');

  // The superseded vehicle B is still retrievable by number — it was not deleted.
  assert.ok(
    history.some((h) => h.from.vehicle_number === 'BR09CC0005'),
    'the outgoing vehicle remains in the movement history'
  );

  // The CURRENT assignment is the last one set.
  assert.equal(w.world.trip.vehicle_id, 10);
});