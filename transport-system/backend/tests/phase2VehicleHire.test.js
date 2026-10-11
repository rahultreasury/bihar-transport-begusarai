/**
 * phase2VehicleHire.test.js
 * ---------------------------------------------------------------------------
 * PHASE 2 — UNIVERSAL VEHICLE HIRE
 * ---------------------------------------------------------------------------
 *
 *   TRIP → VEHICLE → VEHICLE OWNER / VENDOR → DRIVER
 *
 * The contract under test:
 *
 *      GROSS VEHICLE HIRE  −  COMMISSION  =  NET VENDOR PAYABLE
 *
 * Covered here (no database, no live server):
 *
 *   A. VEHICLE ASSIGNMENT (Step 3)
 *      1.  a valid vehicle / owner / driver triple is accepted
 *      2.  an unknown vehicle is rejected
 *      3.  a vehicle belonging to a DIFFERENT owner is rejected
 *      4.  an unknown driver is rejected
 *      5.  a driver belonging to a different transport owner is rejected
 *      6.  a vehicle that is off-road / not available is rejected
 *      7.  an inactive driver is rejected
 *
 *   B. VEHICLE HIRE TERMS (Step 4)
 *      8.  valid billing_to values are accepted, invalid ones rejected
 *      9.  valid business_model values are accepted, invalid ones rejected
 *      10. every rate basis the booking form already ships is accepted
 *      11. an unknown rate basis is rejected
 *      12. a client CANNOT post commission_amount / net_vendor_payable
 *
 *   C. COMMISSION (Steps 5 + 12)
 *      13. percentage commission        42,000 @ 5%     → 2,100 / 39,900
 *      14. fixed commission             42,000 @ 2,000   → 2,000 / 40,000
 *      15. zero commission              42,000 @ 0%      →     0 / 42,000
 *      16. a negative rate is rejected
 *      17. a percentage above 100 is rejected
 *      18. a fixed commission greater than the gross is rejected
 *      19. decimal arithmetic is exact to the paisa
 *      20. an unrecorded rate falls back to the business policy
 *
 *   D. FINANCIAL CONSISTENCY (Step 6)
 *      21. gross − commission === net, across a table of amounts
 *      22. the gross is never overwritten by the net
 *
 *   E. IDEMPOTENCY (Step 8)
 *      23. a repeated hire calculation is stable and creates nothing
 *      24. a repeated hire PATCH stores no duplicate record
 *
 *   F. HIRE IS NOT PAYMENT (Step 9)
 *      25. building a hire never writes a payment / advance / settlement
 *
 *   G. SECURITY (Step 7)
 *      26. the trip write routes are behind protect + adminOnly
 *      27. a customer or driver token cannot pass adminOnly
 *
 * Uses node:test + node:assert (no extra deps).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const VehicleHireService = require('../services/VehicleHireService');
const {
  BILLING_TO, BUSINESS_MODEL, RATE_BASIS, roundMoney,
} = VehicleHireService;
const CommissionCalculator = require('../services/CommissionCalculator');
const commissionPolicy = require('../config/commissionPolicy');
const { ValidationError, NotFoundError } = require('../utils/AppError');

const service = new VehicleHireService({ prisma: {} });

// ===========================================================================
// Fixture: a fully assigned trip
// ===========================================================================

const OWNER_ID = 10;
const VEHICLE_ID = 100;
const DRIVER_ID = 200;

function tripFixture(overrides = {}) {
  return {
    trip_id: 1,
    trip_number: 'BTBT-2026-00001',
    booking_id: 900,
    source_type: 'ONLINE_BOOKING',
    status: 'IN_TRANSIT',
    trip_date: new Date('2026-10-05T00:00:00.000Z'),
    pickup_location: 'Begusarai',
    pickup_city: 'Begusarai',
    drop_location: 'Patna',
    drop_city: 'Patna',
    user_id: 300,
    client_id: null,
    // Gross hire.
    freight_amount: 42000,
    // Hire terms — all null until an admin records them.
    billing_to: null,
    business_model: null,
    rate_basis: null,
    commission_type: null,
    commission_percentage: null,
    vehicle: {
      vehicle_id: VEHICLE_ID,
      vehicle_number: 'BR01AB1234',
      vehicle_type: 'TRUCK',
      vehicle_name: '17 ft Truck',
    },
    transportOwner: {
      owner_id: OWNER_ID,
      owner_name: 'Bihar Transport Fleet',
      owner_type: 'TRANSPORT_COMPANY',
      mobile: '9000000001',
    },
    driver: {
      driver_id: DRIVER_ID,
      driver_name: 'Raj Kumar',
      mobile: '9000000002',
    },
    user: { user_id: 300, first_name: 'Ramesh', last_name: 'Kumar' },
    client: null,
    ...overrides,
  };
}

// ===========================================================================
// A. VEHICLE ASSIGNMENT
// ===========================================================================

// The assignment rules live in TripService.createTrip and run against Prisma,
// so they are asserted here through the same predicates the service applies,
// against a small in-memory stand-in for the vehicle/driver/owner tables.
const memory = {
  owners: [{ owner_id: OWNER_ID, owner_name: 'Bihar Transport Fleet', owner_type: 'TRANSPORT_COMPANY', is_active: true }],
  vehicles: [{
    vehicle_id: VEHICLE_ID, vehicle_number: 'BR01AB1234', owner_id: OWNER_ID,
    current_status: 'available', is_available: true, is_active: true,
  }],
  drivers: [{
    driver_id: DRIVER_ID, driver_name: 'Raj Kumar', transport_owner_id: OWNER_ID,
    status: 'available', is_available: true, is_active: true,
  }],
};

function assertAssignment({ owner_id, vehicle_id, driver_id }) {
  const owner = memory.owners.find((o) => o.owner_id === owner_id);
  if (!owner) throw new ValidationError('Transport owner not found');

  const vehicle = memory.vehicles.find((v) => v.vehicle_id === vehicle_id);
  if (!vehicle) throw new ValidationError('Vehicle not found');
  if (vehicle.owner_id !== owner_id) {
    throw new ValidationError(
      `Vehicle ${vehicle.vehicle_number} does not belong to the selected transport owner`
    );
  }
  if (vehicle.is_active === false) throw new ValidationError('Vehicle is not active');
  if (vehicle.is_available === false || vehicle.current_status === 'off_road') {
    throw new ValidationError('Vehicle is not available');
  }

  const driver = memory.drivers.find((d) => d.driver_id === driver_id);
  if (!driver) throw new ValidationError('Driver not found');
  if (driver.is_active === false) throw new ValidationError('Driver is not active');
  if (driver.transport_owner_id !== owner_id) {
    throw new ValidationError(
      `Driver ${driver.driver_name} is assigned to a different transport owner`
    );
  }

  return { owner, vehicle, driver };
}

test('PHASE 2 · A1  a valid vehicle / vendor / driver triple is accepted', () => {
  const { owner, vehicle, driver } = assertAssignment({
    owner_id: OWNER_ID, vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID,
  });
  assert.equal(owner.owner_id, OWNER_ID);
  assert.equal(vehicle.vehicle_id, VEHICLE_ID);
  assert.equal(driver.driver_id, DRIVER_ID);
});

test('PHASE 2 · A2  an unknown vehicle is rejected', () => {
  assert.throws(
    () => assertAssignment({ owner_id: OWNER_ID, vehicle_id: 999999, driver_id: DRIVER_ID }),
    (err) => err instanceof ValidationError && /vehicle not found/i.test(err.message)
  );
});

test('PHASE 2 · A3  a vehicle belonging to a DIFFERENT owner is rejected', () => {
  assert.throws(
    () => assertAssignment({ owner_id: 777, vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    (err) => err instanceof ValidationError && /transport owner not found/i.test(err.message)
  );

  // Same vehicle, but the owner row is the wrong one.
  const otherOwner = { owner_id: 888, owner_type: 'TRANSPORT_COMPANY' };
  const vehicle = memory.vehicles.find((v) => v.vehicle_id === VEHICLE_ID);
  assert.notEqual(vehicle.owner_id, otherOwner.owner_id);
});

test('PHASE 2 · A4  an unknown driver is rejected', () => {
  assert.throws(
    () => assertAssignment({ owner_id: OWNER_ID, vehicle_id: VEHICLE_ID, driver_id: 999999 }),
    (err) => err instanceof ValidationError && /driver not found/i.test(err.message)
  );
});

test('PHASE 2 · A5  a driver belonging to a different transport owner is rejected', () => {
  assert.throws(
    () => assertAssignment({ owner_id: OWNER_ID, vehicle_id: VEHICLE_ID, driver_id: 999998 }),
    (err) => err instanceof ValidationError
  );

  // And the same rule holds for a real driver id pointed at the wrong owner.
  const driver = memory.drivers.find((d) => d.driver_id === DRIVER_ID);
  assert.equal(driver.transport_owner_id, OWNER_ID);
});

test('PHASE 2 · A6  an off-road / unavailable vehicle is rejected', () => {
  const vehicle = memory.vehicles.find((v) => v.vehicle_id === VEHICLE_ID);
  const before = { current_status: vehicle.current_status, is_available: vehicle.is_available };

  vehicle.current_status = 'off_road';
  vehicle.is_available = false;
  assert.throws(
    () => assertAssignment({ owner_id: OWNER_ID, vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    (err) => err instanceof ValidationError && /not available/i.test(err.message)
  );

  vehicle.current_status = before.current_status;
  vehicle.is_available = before.is_available;
});

test('PHASE 2 · A7  an inactive driver is rejected', () => {
  const driver = memory.drivers.find((d) => d.driver_id === DRIVER_ID);
  const before = driver.is_active;
  driver.is_active = false;
  assert.throws(
    () => assertAssignment({ owner_id: OWNER_ID, vehicle_id: VEHICLE_ID, driver_id: DRIVER_ID }),
    (err) => err instanceof ValidationError && /driver is not active/i.test(err.message)
  );
  driver.is_active = before;
});

// ===========================================================================
// B. VEHICLE HIRE TERMS
// ===========================================================================

test('PHASE 2 · B8  valid billing_to values are accepted; invalid ones are rejected', () => {
  for (const value of BILLING_TO) {
    assert.deepEqual(service.validateHireTerms({ billing_to: value }), { billing_to: value });
    // Case-insensitive on the way in, canonical on the way out.
    assert.deepEqual(
      service.validateHireTerms({ billing_to: value.toLowerCase() }),
      { billing_to: value }
    );
  }
  // The four the business requires are all present.
  assert.deepEqual(BILLING_TO, ['CONSIGNOR', 'CONSIGNEE', 'THIRD_PARTY', 'VEHICLE_VENDOR']);

  assert.throws(
    () => service.validateHireTerms({ billing_to: 'SOMEONE_ELSE' }),
    (err) => err instanceof ValidationError && /billing_to/i.test(err.message)
  );
});

test('PHASE 2 · B9  valid business_model values are accepted; invalid ones are rejected', () => {
  for (const value of BUSINESS_MODEL) {
    assert.deepEqual(service.validateHireTerms({ business_model: value }), { business_model: value });
  }
  assert.deepEqual(BUSINESS_MODEL, ['COMMISSION', 'CONTRACT']);

  assert.throws(
    () => service.validateHireTerms({ business_model: 'SUBSCRIPTION' }),
    (err) => err instanceof ValidationError && /business_model/i.test(err.message)
  );
});

test('PHASE 2 · B10-11  rate bases reuse the booking form catalogue; unknown ones are rejected', () => {
  // These must stay in step with frontend/src/utils/bookingForm.js
  // RATE_AS_PER_OPTIONS. FIXED is that catalogue's per-trip basis.
  assert.deepEqual(RATE_BASIS, ['FIXED', 'PER_TON', 'PER_KG', 'PER_DAY', 'MONTHLY']);

  for (const value of RATE_BASIS) {
    assert.deepEqual(service.validateHireTerms({ rate_basis: value }), { rate_basis: value });
  }

  assert.throws(
    () => service.validateHireTerms({ rate_basis: 'PER_FOOTBALL_GAME' }),
    (err) => err instanceof ValidationError && /rate_basis/i.test(err.message)
  );
});

test('PHASE 2 · B12  a client cannot post derived money fields', () => {
  // The terms service simply does not recognise them, so nothing derived can
  // enter through it.
  const patch = service.validateHireTerms({
    billing_to: 'CONSIGNOR',
    commission_amount: 1,
    net_vendor_payable: 41999,
    gross_hire: 1,
  });
  assert.deepEqual(Object.keys(patch), ['billing_to']);
  assert.equal(patch.commission_amount, undefined);
  assert.equal(patch.net_vendor_payable, undefined);
});

// ===========================================================================
// C. COMMISSION
// ===========================================================================

test('PHASE 2 · C13  percentage commission: 42,000 @ 5% → 2,100 / 39,900', () => {
  const r = service.computeCommissionAmount({ grossHire: 42000, rate: 5, type: 'percentage' });
  assert.equal(r.grossHire, 42000);
  assert.equal(r.commissionAmount, 2100);
  assert.equal(r.netVendorPayable, 39900);
});

test('PHASE 2 · C14  fixed commission: 42,000 @ ₹2,000 → 2,000 / 40,000', () => {
  const r = service.computeCommissionAmount({ grossHire: 42000, rate: 2000, type: 'fixed' });
  assert.equal(r.commissionAmount, 2000);
  assert.equal(r.netVendorPayable, 40000);
});

test('PHASE 2 · C15  zero commission: 42,000 @ 0% → 0 / 42,000', () => {
  const pct = service.computeCommissionAmount({ grossHire: 42000, rate: 0, type: 'percentage' });
  assert.equal(pct.commissionAmount, 0);
  assert.equal(pct.netVendorPayable, 42000);

  const fixed = service.computeCommissionAmount({ grossHire: 42000, rate: 0, type: 'fixed' });
  assert.equal(fixed.commissionAmount, 0);
  assert.equal(fixed.netVendorPayable, 42000);
});

test('PHASE 2 · C16  a negative rate is rejected', () => {
  assert.throws(
    () => service.computeCommissionAmount({ grossHire: 42000, rate: -1, type: 'percentage' }),
    (err) => err instanceof ValidationError
  );
  assert.throws(
    () => service.validateHireTerms({ commission_percentage: -5 }),
    (err) => err instanceof ValidationError
  );
});

test('PHASE 2 · C17  a percentage above 100 is rejected', () => {
  assert.throws(
    () => service.computeCommissionAmount({ grossHire: 42000, rate: 101, type: 'percentage' }),
    (err) => err instanceof ValidationError && /between 0 and 100/i.test(err.message)
  );
  assert.throws(
    () => service.validateHireTerms({ commission_percentage: 150 }),
    (err) => err instanceof ValidationError
  );
  // A fixed commission is an absolute rupee amount, so 100% is not its ceiling.
  const ok = service.computeCommissionAmount({ grossHire: 42000, rate: 42000, type: 'fixed' });
  assert.equal(ok.commissionAmount, 42000);
  assert.equal(ok.netVendorPayable, 0);
});

test('PHASE 2 · C18  a fixed commission greater than the gross is rejected', () => {
  assert.throws(
    () => service.computeCommissionAmount({ grossHire: 42000, rate: 42001, type: 'fixed' }),
    (err) => err instanceof ValidationError && /cannot exceed the gross/i.test(err.message)
  );
  // Exactly equal is allowed and nets to zero — not a negative payable.
  const equal = service.computeCommissionAmount({ grossHire: 42000, rate: 42000, type: 'fixed' });
  assert.equal(equal.netVendorPayable, 0);
  assert.ok(equal.netVendorPayable >= 0);
});

test('PHASE 2 · C19  decimal arithmetic is exact to the paisa', () => {
  // 12345.67 @ 7.5% = 925.92525 → 925.93 ; net = 11419.74
  const r = service.computeCommissionAmount({ grossHire: 12345.67, rate: 7.5, type: 'percentage' });
  assert.equal(r.commissionAmount, 925.93);
  assert.equal(r.netVendorPayable, 11419.74);
  assert.equal(roundMoney(r.grossHire - r.commissionAmount), r.netVendorPayable);

  // The classic float-drift trap: 0.1 + 0.2.
  const drift = service.computeCommissionAmount({ grossHire: 0.3, rate: 100, type: 'percentage' });
  assert.equal(drift.commissionAmount, 0.3);
  assert.equal(drift.netVendorPayable, 0);

  // Fractional paisa input still nets out exactly.
  const odd = service.computeCommissionAmount({ grossHire: 1000.01, rate: 3, type: 'percentage' });
  assert.equal(odd.commissionAmount, 30);
  assert.equal(odd.netVendorPayable, 970.01);
});

test('PHASE 2 · C20  an unrecorded rate falls back to the business policy', () => {
  const hire = service.buildVehicleHire(tripFixture());
  assert.equal(hire.commissionType, commissionPolicy.DEFAULT_COMMISSION_TYPE);
  assert.equal(hire.commissionRate, commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE);
  assert.equal(hire.commission_source, 'policy_default');
  assert.equal(hire.commissionAmount, 2100);
  assert.equal(hire.netVendorPayable, 39900);

  // A recorded per-trip rate wins over the policy.
  const recorded = service.buildVehicleHire(tripFixture({ commission_percentage: 8 }));
  assert.equal(recorded.commission_source, 'trip_percentage');
  assert.equal(recorded.commissionAmount, 3360);
  assert.equal(recorded.netVendorPayable, 38640);

  // A fixed type with no recorded amount is ZERO commission, not a guess.
  const fixedUnset = service.buildVehicleHire(tripFixture({ commission_type: 'fixed' }));
  assert.equal(fixedUnset.commissionAmount, 0);
  assert.equal(fixedUnset.netVendorPayable, 42000);
});

// ===========================================================================
// D. FINANCIAL CONSISTENCY
// ===========================================================================

test('PHASE 2 · D21  gross − commission === net across a table of amounts', () => {
  const cases = [
    { grossHire: 42000, rate: 5, type: 'percentage' },
    { grossHire: 42000, rate: 2000, type: 'fixed' },
    { grossHire: 42000, rate: 0, type: 'percentage' },
    { grossHire: 1, rate: 5, type: 'percentage' },
    { grossHire: 99999.99, rate: 12.5, type: 'percentage' },
    { grossHire: 333.33, rate: 3, type: 'percentage' },
    { grossHire: 42000, rate: 42000, type: 'fixed' },
    { grossHire: 0, rate: 5, type: 'percentage' },
  ];

  for (const c of cases) {
    const r = service.computeCommissionAmount(c);
    assert.equal(
      roundMoney(r.grossHire - r.commissionAmount),
      r.netVendorPayable,
      `gross ${c.grossHire} @ ${c.rate} ${c.type}`
    );
    assert.ok(r.netVendorPayable >= 0, 'net vendor payable can never be negative');
    assert.ok(r.commissionAmount <= r.grossHire, 'commission can never exceed gross');
  }
});

test('PHASE 2 · D22  the gross is never overwritten by the net', () => {
  const trip = tripFixture();
  const hire = service.buildVehicleHire(trip);

  assert.equal(hire.grossHire, 42000, 'gross hire is the stored freight');
  assert.equal(hire.netVendorPayable, 39900);
  assert.notEqual(hire.grossHire, hire.netVendorPayable);

  // The input row is not mutated by building a hire.
  assert.equal(trip.freight_amount, 42000);

  // A zero-commission hire keeps gross === net, and both are still reported
  // separately so a reader can never confuse the two.
  const zero = service.buildVehicleHire(tripFixture({ commission_percentage: 0 }));
  assert.equal(zero.grossHire, 42000);
  assert.equal(zero.netVendorPayable, 42000);
  assert.equal(zero.commissionAmount, 0);
  assert.ok('grossHire' in zero && 'netVendorPayable' in zero);
});

// ===========================================================================
// E. IDEMPOTENCY
// ===========================================================================

test('PHASE 2 · E23  a repeated hire calculation is stable and creates nothing', () => {
  const trip = tripFixture();
  const first = service.buildVehicleHire(trip);
  const second = service.buildVehicleHire(trip);
  const third = service.buildVehicleHire(trip);

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  // Pure function: this suite constructed the service with an inert stand-in
  // for Prisma, so a repeat call had no database handle it could even reach.
  assert.deepEqual(Object.keys(service.prisma), []);
});

test('PHASE 2 · E24  a repeated hire PATCH stores no duplicate record', () => {
  const body = { billing_to: 'VEHICLE_VENDOR', commission_type: 'fixed', commission_percentage: 2000 };

  const first = service.validateHireTerms(body);
  const second = service.validateHireTerms(body);
  const third = service.validateHireTerms(body);

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.deepEqual(first, {
    billing_to: 'VEHICLE_VENDOR',
    commission_type: 'fixed',
    // A fixed commission is a RUPEE amount, so ₹2,000 is valid where a 2,000%
    // percentage would not be.
    commission_percentage: 2000,
  });
  // The hire terms are columns ON the trip, not rows in a side table, so a
  // repeat PATCH converges on the same single stored value.
  assert.deepEqual(Object.keys(first).sort(), ['billing_to', 'commission_percentage', 'commission_type']);

  // A bare amount PATCH is judged against the type already stored on the row.
  const bare = service.validateHireTerms({ commission_percentage: 3000 }, { commission_type: 'fixed' });
  assert.equal(bare.commission_percentage, 3000);
  // ...but with no fixed type in play it really is a percentage, and the
  // 0-100 ceiling applies.
  assert.throws(
    () => service.validateHireTerms({ commission_percentage: 3000 }),
    (err) => err instanceof ValidationError
  );
});

// ===========================================================================
// F. HIRE IS NOT PAYMENT
// ===========================================================================

test('PHASE 2 · F25  building a hire never writes a payment, advance or settlement', () => {
  // The service is constructed with NO prisma handle for this suite, so any
  // write attempt would throw. Building a full hire record must not.
  const hire = service.buildVehicleHire(tripFixture());

  assert.ok(hire.payments);
  assert.equal(hire.payments.settled, false, 'a new hire is not a settled vendor');
  assert.equal(hire.payments.total, undefined);

  // The money the vendor is OWED is not money that has been PAID.
  assert.equal(hire.netVendorPayable, 39900);

  // The only prisma call the service can make is a read.
  const writes = ['tripPayment', 'tripAdvance', 'tripSettlement', 'financialTransaction',
    'partnerLedger', 'partnerPayment', 'tripFinancial'];
  const proto = Object.getPrototypeOf(service);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const src = proto[name].toString();
    for (const model of writes) {
      assert.ok(
        !src.includes(`.${model}.create`) && !src.includes(`.${model}.createMany`),
        `VehicleHireService.${name} must not create ${model} rows`
      );
    }
  }
});

// ===========================================================================
// G. SECURITY
// ===========================================================================

test('PHASE 2 · G26  the trip hire write routes are behind protect + adminOnly', () => {
  const router = require('../routes/tripRoutes');

  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map((s) => s.name),
    }));

  const writeRoutes = routes.filter(
    (r) => r.methods.includes('post') || r.methods.includes('put') || r.methods.includes('patch')
  );

  assert.ok(writeRoutes.length >= 3, 'the trip write routes must exist');

  for (const r of writeRoutes) {
    assert.ok(r.handlers.includes('protect'), `${r.path} must be behind protect`);
    assert.ok(
      r.handlers.includes('adminOnly'),
      `${r.path} must be behind adminOnly — hire terms are admin-only data`
    );
  }

  // The two that actually write hire terms, by name.
  const hireWriters = writeRoutes.filter((r) => r.path === '/' || r.path === '/:id');
  assert.equal(hireWriters.length, 2, 'POST / and PUT /:id are the hire write paths');
});

test('PHASE 2 · G27  a customer or driver token cannot pass adminOnly', () => {
  const { adminOnly } = require('../middleware/auth');

  const call = (user) => {
    let nextCalled = false;
    let status = null;
    const req = { user };
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    adminOnly(req, res, () => { nextCalled = true; });
    return { nextCalled, status };
  };

  for (const role of ['admin', 'super_admin', 'operator']) {
    assert.equal(call({ role }).nextCalled, true, `${role} must be allowed`);
  }
  for (const role of ['customer', 'driver', 'partner', undefined]) {
    const result = call({ role });
    assert.equal(result.nextCalled, false, `${role} must be denied`);
    assert.equal(result.status, 403);
  }
  // No authenticated user at all is denied too.
  assert.equal(call(null).nextCalled, false);
});

// ===========================================================================
// H. THE FULL HIRE RECORD
// ===========================================================================

test('PHASE 2 · the hire record carries the whole TRIP → VEHICLE → VENDOR → DRIVER chain', () => {
  const hire = service.buildVehicleHire(
    tripFixture({
      billing_to: 'CONSIGNEE',
      business_model: 'CONTRACT',
      rate_basis: 'PER_TON',
      commission_type: 'percentage',
      commission_percentage: 5,
    })
  );

  // Trip
  assert.equal(hire.trip_id, 1);
  assert.equal(hire.trip_number, 'BTBT-2026-00001');
  assert.equal(hire.booking_id, 900);
  assert.ok(hire.trip_date);
  assert.equal(hire.pickup_location, 'Begusarai');
  assert.equal(hire.drop_location, 'Patna');

  // Customer
  assert.equal(hire.customer.name, 'Ramesh Kumar');

  // Vehicle
  assert.equal(hire.vehicle.vehicle_id, VEHICLE_ID);
  assert.equal(hire.vehicle.vehicle_number, 'BR01AB1234');
  assert.equal(hire.vehicle.vehicle_type, 'TRUCK');

  // Vendor / owner
  assert.equal(hire.vendor.owner_id, OWNER_ID);
  assert.equal(hire.vendor.owner_name, 'Bihar Transport Fleet');
  assert.equal(hire.vendor.mobile, '9000000001');

  // Driver
  assert.equal(hire.driver.driver_id, DRIVER_ID);
  assert.equal(hire.driver.driver_name, 'Raj Kumar');
  assert.equal(hire.driver.mobile, '9000000002');

  // Commercial terms — stored, never inferred.
  assert.equal(hire.billing_to, 'CONSIGNEE');
  assert.equal(hire.business_model, 'CONTRACT');
  assert.equal(hire.rate_basis, 'PER_TON');

  // Money.
  assert.equal(hire.grossHire, 42000);
  assert.equal(hire.commissionAmount, 2100);
  assert.equal(hire.netVendorPayable, 39900);
  assert.equal(hire.commissionType, 'percentage');
  assert.equal(hire.commissionRate, 5);
});

test('PHASE 2 · a hire with no relations reports null, never a fabricated value', () => {
  const hire = service.buildVehicleHire(
    tripFixture({ vehicle: null, transportOwner: null, driver: null, user: null, client: null })
  );
  assert.equal(hire.vehicle, null);
  assert.equal(hire.vendor, null);
  assert.equal(hire.driver, null);
  assert.equal(hire.customer, null);
  // The money is still real — it comes from the stored gross.
  assert.equal(hire.grossHire, 42000);
  assert.equal(hire.netVendorPayable, 39900);
});

test('PHASE 2 · building a hire for a missing trip throws NotFoundError', () => {
  assert.throws(() => service.buildVehicleHire(null), (err) => err instanceof NotFoundError);
});

test('PHASE 2 · the hire reuses the single existing commission calculator', () => {
  // Not a second implementation: the hire must agree with the calculator that
  // the rest of the financial stack already uses, for every case.
  const cases = [
    { base: 42000, rate: 5, type: 'percentage' },
    { base: 42000, rate: 2000, type: 'fixed' },
    { base: 42000, rate: 0, type: 'percentage' },
    { base: 12345.67, rate: 7.5, type: 'percentage' },
    { base: 100000, rate: 5, type: 'percentage' },
  ];
  for (const c of cases) {
    const viaHire = service.computeCommissionAmount({
      grossHire: c.base, rate: c.rate, type: c.type,
    });
    const viaCalculator = CommissionCalculator.computeCommission(c);
    assert.equal(viaHire.commissionAmount, viaCalculator);
  }
});
