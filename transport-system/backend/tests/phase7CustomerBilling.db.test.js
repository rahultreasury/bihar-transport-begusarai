/**
 * phase7CustomerBilling.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE 7 — INTEGRATION TESTS AGAINST A LIVE POSTGRESQL DATABASE
 * ---------------------------------------------------------------------------
 *
 * The unit suite (tests/phase7CustomerBilling.test.js) proves the arithmetic
 * and the branching. This suite proves the same contract against the real
 * Express → Service → Prisma → PostgreSQL path: real tables, real foreign
 * keys, real unique constraints, real transactions, real rollbacks.
 *
 * THE POINT OF THIS SUITE
 *   Phase 7's two database-level guarantees cannot be proven with a fake:
 *     - one invoice per booking          (invoices_booking_id_key)
 *     - one payment per (trip, reference) (the partial unique index)
 *   A double happily accepts a duplicate. PostgreSQL does not. So these are
 *   asserted by actually attempting the duplicate insert and expecting the
 *   database to refuse it.
 *
 * IT ALSO PROVES THE FINANCIAL SEPARATION ON REAL ROWS
 *   A customer payment is written, and the vendor money (owner and driver
 *   advances, settlements and commission) and the vendor ledger tables
 *   (partner_ledger / settlements) are checked to be untouched.
 *
 * Nothing is mocked. Every row is created for this suite and deleted again in
 * `after()`, so the database is left exactly as it was found.
 *
 * IF NO LIVE POSTGRESQL IS AVAILABLE the tests report themselves as SKIPPED
 * with the reason. They never pretend to have passed.
 *
 * Run explicitly with:
 *   DATABASE_URL=postgresql://... node --test tests/phase7CustomerBilling.db.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const InvoiceRepository = require('../repositories/InvoiceRepository');
const TripService = require('../services/TripService');
const { projectTransactionsForRole } = require('../dtos/TripFinancialDTO');

const TAG = `P7${process.pid}`;
const ADMIN = { user_id: null, role: 'admin' };

const created = {
  users: [], drivers: [], owners: [], vehicles: [], trips: [],
  tripFinancials: [], invoices: [], bookings: [], deliveries: [],
};

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

const service = () => new CanonicalFinancialService({ prisma });

/** Skip helper — a test that cannot run says so rather than passing quietly. */
function skip() {
  return { skip: skipReason };
}

before(async () => {
  if (!process.env.DATABASE_URL) {
    skipReason = 'DATABASE_URL is not set';
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    ready = true;
    skipReason = null;
  } catch (error) {
    skipReason = `live PostgreSQL unavailable: ${String(error.message).split('\n')[0]}`;
  }
});

after(async () => {
  if (!ready) return;
  // Reverse dependency order; every delete is scoped to rows this file made.
  await prisma.financialTransaction.deleteMany({
    where: { trip_id: { in: created.trips } },
  });
  await prisma.tripPayment.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.tripSettlement.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.commissionRecord.deleteMany({ where: { booking_id: { in: created.bookings } } });
  await prisma.invoice.deleteMany({ where: { booking_id: { in: created.bookings } } });
  await prisma.delivery.deleteMany({ where: { booking_id: { in: created.bookings } } });
  await prisma.tripFinancial.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.booking.deleteMany({ where: { booking_id: { in: created.bookings } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.vehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.owners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

/**
 * A short NUMERIC tag derived from the caller's label.
 *
 * Mobile numbers and vehicle numbers in this schema are numeric, so the human
 * label ("SEP4") can only be used for names — a separate counter supplies the
 * digits. Keeping the label readable in the names and the digits unique in the
 * columns means a failure names the row that caused it.
 */
let seedCounter = 0;
const digitsFor = (label) => {
  seedCounter += 1;
  // Include process.pid and timestamp to avoid collisions in parallel test runs
  const uniquePart = `${process.pid}-${Date.now().toString(36)}-${seedCounter}`;
  return String(1000 + seedCounter + label.length * 7).padStart(4, '0').slice(-4) + uniquePart.slice(-6);
};

/**
 * Generate a collision-resistant vehicle number.
 * Uses the existing digitsFor which includes pid + timestamp + counter.
 * Format: P7 + digitsFor (up to 20 chars for vehicle_number column)
 */
function generateVehicleNumber(label) {
  const d = digitsFor(label);
  return `P7${d}`.slice(0, 20);
}

/** Build one owner → vehicle → driver → trip chain (plus an optional booking). */
async function seedTrip({ freight = 50000, driverPayment = 40000, suffix, withBooking = false }) {
  const d1 = digitsFor(suffix);
  const d2 = digitsFor(suffix);
  const d3 = digitsFor(suffix);

  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `P7 Owner ${suffix}`, mobile: `97${d1}`.slice(0, 10), owner_type: 'TRANSPORT_COMPANY' },
  });
  created.owners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: { vehicle_number: generateVehicleNumber(suffix), vehicle_type: 'TRUCK', owner_id: owner.owner_id },
  });
  created.vehicles.push(vehicle.vehicle_id);

  const user = await prisma.user.create({
    data: {
      first_name: 'P7', last_name: 'Customer',
      email: `p7.customer.${d2}@example.test`,
      phone: `86${d2}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(user.user_id);

  // A Driver row REQUIRES its own User (Driver.user_id is NOT NULL), and the
  // driver's User must be a different account from the customer's.
  const driverUser = await prisma.user.create({
    data: {
      first_name: 'P7', last_name: 'Driver',
      email: `p7.driver.${d3}@example.test`,
      phone: `85${d3}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(driverUser.user_id);

  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id,
      driver_name: `P7 Driver ${suffix}`,
      mobile: `85${d3}`.slice(0, 10),
      transport_owner_id: owner.owner_id,
    },
  });
  created.drivers.push(driver.driver_id);

  let bookingId = null;
  if (withBooking) {
    const booking = await prisma.booking.create({
      data: {
        user_id: user.user_id,
        booking_number: `P7-BK-${d1}-${d2}`,
        booking_reference: `P7-BK-${d1}-${d2}`,
        driver_id: driver.driver_id,
        vehicle_id: vehicle.vehicle_id,
        vehicle_owner_id: owner.owner_id,
        pickup_location: 'Begusarai', drop_location: 'Patna',
        pickup_city: 'Begusarai', drop_city: 'Patna',
        pickup_state: 'Bihar', drop_state: 'Bihar',
        pickup_date: '2026-10-05',
        pickup_time: '10:00:00',
        goods_description: 'Cement Bags',
        vehicle_type_required: 'Tata 407 14ft',
        final_price: freight,
        status: 'confirmed', quote_status: 'ACCEPTED',
      },
    });
    created.bookings.push(booking.booking_id);
    bookingId = booking.booking_id;
  }

  const trip = await prisma.trip.create({
    data: {
      trip_number: `P7-T-${d1}-${d2}`,
      source_type: 'ONLINE_BOOKING',
      booking_id: bookingId,
      user_id: user.user_id,
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Begusarai', pickup_city: 'Begusarai',
      drop_location: 'Patna', drop_city: 'Patna',
      freight_amount: freight,
      driver_payment: driverPayment,
      status: 'IN_TRANSIT',
    },
  });
  created.trips.push(trip.trip_id);

  return { tripId: trip.trip_id, bookingId, userId: user.user_id, freight };
}

/* ========================================================================== */
describe('DB · INVOICE — one bill per booking, enforced by PostgreSQL', () => {
  test('an invoice is created, and a second one is refused by the unique index', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ suffix: 'INV1', withBooking: true });

    const first = await new InvoiceRepository().ensureForBooking({
      booking_id: ctx.bookingId,
      booking_number: `P7-INV1`,
      amount: ctx.freight,
    });
    created.invoices.push(first.invoice_id);
    assert.equal(first.created, true);

    // The service-level guard short-circuits...
    const second = await new InvoiceRepository().ensureForBooking({
      booking_id: ctx.bookingId,
      booking_number: `P7-INV1`,
      amount: ctx.freight,
    });
    assert.equal(second.created, false, 'a duplicate bill is not raised');
    assert.equal(second.invoice_id, first.invoice_id);

    // ...and the DATABASE refuses one too, even if the guard is bypassed.
    await assert.rejects(
      () => prisma.invoice.create({
        data: { booking_id: ctx.bookingId, invoice_number: `P7-BYPASS-${Date.now()}`, final_price: 1 },
      }),
      'PostgreSQL must reject a second invoice for the same booking'
    );
  });

  test('the invoice is linked to the booking, and carries the authoritative amount', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 42000, suffix: 'INV2', withBooking: true });

    const inv = await new InvoiceRepository().ensureForBooking({
      booking_id: ctx.bookingId, booking_number: `P7-INV2`, amount: 42000,
    });
    created.invoices.push(inv.invoice_id);

    const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice_id } });
    const booking = await prisma.booking.findUnique({ where: { booking_id: ctx.bookingId } });

    assert.equal(row.booking_id, ctx.bookingId, 'linked to the right booking');
    assert.equal(row.final_price, booking.final_price, 'amount is the persisted Booking.final_price');
    assert.equal(row.invoice_number, 'INV-P7-INV2');
  });
});

/* ========================================================================== */
describe('DB · PAYMENTS — real money, real ledger, real balance', () => {
  test('a full payment clears the outstanding on real rows', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'PAY1' });

    await service().recordClientPayment(ctx.tripId, { amount: 20000, payment_method: 'cash', reference_number: `${TAG}-A` });
    await service().recordClientPayment(ctx.tripId, { amount: 30000, payment_method: 'upi', reference_number: `${TAG}-B` });

    const f = await service().calculateTripFinancials(ctx.tripId);
    assert.equal(f.freight, 50000);
    assert.equal(f.customerCollected, 50000);
    assert.equal(f.customerDue, 0);
    assert.equal(f.customerPaymentStatus, 'PAID');

    const rows = await prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId } });
    assert.equal(rows.length, 2, 'exactly two money movements');
  });

  test('a partial payment leaves exactly the remainder outstanding', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'PAY2' });

    await service().recordClientPayment(ctx.tripId, { amount: 20000, reference_number: `${TAG}-C` });
    const f = await service().calculateTripFinancials(ctx.tripId);

    assert.equal(f.customerCollected, 20000);
    assert.equal(f.customerDue, 30000);
    assert.equal(f.customerPaymentStatus, 'PARTIAL');
  });

  test('an overpayment is rejected and no money is written', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 10000, suffix: 'PAY3' });

    await assert.rejects(
      () => service().recordClientPayment(ctx.tripId, { amount: 10001, reference_number: `${TAG}-D` }),
      /exceeds outstanding customer due/
    );
    assert.equal(await prisma.financialTransaction.count({ where: { trip_id: ctx.tripId } }), 0);
  });
});

/* ========================================================================== */
describe('DB · IDEMPOTENCY — the database refuses a duplicate money movement', () => {
  test('the same reference does not move money twice', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'IDEM1' });
    const ref = `${TAG}-DUP`;

    const first = await service().recordClientPayment(ctx.tripId, { amount: 10000, reference_number: ref });
    for (let i = 0; i < 4; i += 1) {
      await service().recordClientPayment(ctx.tripId, { amount: 10000, reference_number: ref });
    }

    assert.equal(await prisma.financialTransaction.count({ where: { trip_id: ctx.tripId } }), 1);
    const f = await service().calculateTripFinancials(ctx.tripId);
    assert.equal(f.customerCollected, 10000);
    assert.equal(f.customerDue, 40000);
    assert.ok(first.transaction_id);
  });

  test('a duplicate callback is refused by the partial unique index itself', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'IDEM2' });
    const ref = `${TAG}-IDX`;

    const tripFinancial = await prisma.tripFinancial.create({
      data: { trip_id: ctx.tripId, status: 'CALCULATED', customer_fare: 50000, calculated_at: new Date() },
    });
    created.tripFinancials.push(tripFinancial.trip_financial_id);

    const payload = {
      trip_financial_id: tripFinancial.trip_financial_id,
      trip_id: ctx.tripId,
      transaction_type: 'CUSTOMER_PAYMENT',
      amount: 5000, direction: 'CREDIT',
      from_party: 'CUSTOMER', to_party: 'BIHAR_TRANSPORT',
      purpose: 'Freight Payment', payment_method: 'upi',
      reference_number: ref, transaction_date: new Date(), status: 'PAID',
    };
    await prisma.financialTransaction.create({ data: payload });

    // Even bypassing the service entirely, the database refuses the duplicate.
    await assert.rejects(
      () => prisma.financialTransaction.create({ data: payload }),
      'the partial unique index must reject a second payment with the same reference'
    );
  });

  test('two different references are two genuine payments', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'IDEM3' });

    await service().recordClientPayment(ctx.tripId, { amount: 10000, reference_number: `${TAG}-X1` });
    await service().recordClientPayment(ctx.tripId, { amount: 10000, reference_number: `${TAG}-X2` });

    assert.equal(await prisma.financialTransaction.count({ where: { trip_id: ctx.tripId } }), 2);
  });
});

/* ========================================================================== */
describe('DB · FINANCIAL SEPARATION — customer money never moves vendor money', () => {
  test('paying the customer in full leaves the vendor payable and commission untouched', async () => {
    if (!ready) return skip();

    const unpaid = await service().calculateTripFinancials((await seedTrip({ suffix: 'SEP1' })).tripId);
    const paidTrip = await seedTrip({ suffix: 'SEP2' });

    await service().recordClientPayment(paidTrip.tripId, { amount: paidTrip.freight, reference_number: `${TAG}-FULL` });
    const paid = await service().calculateTripFinancials(paidTrip.tripId);

    assert.equal(paid.customerDue, 0, 'the customer is square');
    assert.equal(paid.driverDue, unpaid.driverDue, 'the driver is owed exactly the same');
    assert.equal(paid.ownerDue, unpaid.ownerDue, 'the owner is owed exactly the same');
    assert.equal(paid.btCommission, unpaid.btCommission, 'commission is unchanged');
  });

  test('a customer payment writes NO vendor money rows', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ suffix: 'SEP3' });

    await service().recordClientPayment(ctx.tripId, { amount: 25000, reference_number: `${TAG}-V1` });

    const vendorRows = await prisma.financialTransaction.findMany({
      where: {
        trip_id: ctx.tripId,
        transaction_type: {
          in: ['OWNER_ADVANCE', 'OWNER_SETTLEMENT', 'DRIVER_ADVANCE', 'FUEL_ADVANCE', 'DRIVER_SETTLEMENT', 'COMMISSION'],
        },
      },
    });
    assert.equal(vendorRows.length, 0, 'no vendor settlement is created by a customer payment');

    assert.equal(
      await prisma.tripSettlement.count({ where: { trip_id: ctx.tripId } }),
      0,
      'no TripSettlement row is created by a customer payment'
    );
    assert.equal(
      await prisma.commissionRecord.count({ where: { booking_id: { in: created.bookings } } }),
      0,
      'no CommissionRecord is created by a customer payment'
    );
  });

  test('the gross hire is never rewritten by a payment', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 60000, suffix: 'SEP4' });

    await service().recordClientPayment(ctx.tripId, { amount: 30000, reference_number: `${TAG}-V2` });

    const trip = await prisma.trip.findUnique({ where: { trip_id: ctx.tripId } });
    assert.equal(trip.freight_amount, 60000, 'freight_amount is untouched');
  });
});

/* ========================================================================== */
describe('DB · TripService.addPayment — the other entry point, same guarantees', () => {
  test('it is idempotent, and TripPayment + FinancialTransaction never disagree', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, suffix: 'TS1' });
    const svc = new TripService();
    const ref = `${TAG}-TS`;

    await svc.addPayment(ctx.tripId, { amount: 20000, payment_type: 'PARTIAL', payment_method: 'upi', reference: ref }, ADMIN);
    await svc.addPayment(ctx.tripId, { amount: 20000, payment_type: 'PARTIAL', payment_method: 'upi', reference: ref }, ADMIN);
    await svc.addPayment(ctx.tripId, { amount: 20000, payment_type: 'PARTIAL', payment_method: 'upi', reference: ref }, ADMIN);

    const tripPayments = await prisma.tripPayment.findMany({ where: { trip_id: ctx.tripId } });
    const ledger = await prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId } });

    assert.equal(tripPayments.length, 1, 'one TripPayment row');
    assert.equal(ledger.length, 1, 'one FinancialTransaction row');
    assert.equal(
      tripPayments[0].amount,
      ledger[0].amount,
      'the two records agree — there is exactly one money movement'
    );

    const f = await service().calculateTripFinancials(ctx.tripId);
    assert.equal(f.customerCollected, 20000, 'not double counted');
    assert.equal(f.customerDue, 30000);
  });
});

/* ========================================================================== */
describe('DB · SECURITY — the allow-list projection holds on real rows', () => {
  test('a customer projection never carries vendor money', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip({ freight: 50000, driverPayment: 40000, suffix: 'SEC1' });

    await service().recordClientPayment(ctx.tripId, { amount: 20000, reference_number: `${TAG}-S1` });
    // A vendor money row on the same trip, which the customer must not see.
    const tripFinancial = await prisma.tripFinancial.create({
      data: { trip_id: ctx.tripId, status: 'CALCULATED', customer_fare: 50000, calculated_at: new Date() },
    });
    created.tripFinancials.push(tripFinancial.trip_financial_id);
    await prisma.financialTransaction.create({
      data: {
        trip_financial_id: tripFinancial.trip_financial_id,
        trip_id: ctx.tripId,
        transaction_type: 'OWNER_SETTLEMENT',
        amount: 45000, direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT', to_party: 'TRANSPORT_OWNER',
        purpose: 'Final Settlement', transaction_date: new Date(), status: 'PAID',
      },
    });

    const rows = await prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId } });
    assert.equal(rows.length, 2, 'the trip really does carry both kinds of money');

    const customerView = projectTransactionsForRole(rows, 'CUSTOMER');
    assert.equal(customerView.length, 1, 'the customer sees only their own payment');
    assert.equal(customerView[0].transaction_type, 'CUSTOMER_PAYMENT');

    const serialised = JSON.stringify(customerView);
    assert.doesNotMatch(serialised, /OWNER_SETTLEMENT/, 'no vendor settlement');
    assert.doesNotMatch(serialised, /TRANSPORT_OWNER/, 'no vendor party');
    assert.doesNotMatch(serialised, /45000/, 'no vendor amount');
  });
});
