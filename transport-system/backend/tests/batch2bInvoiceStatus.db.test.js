/**
 * batch2bInvoiceStatus.db.test.js
 * ---------------------------------------------------------------------------
 * BATCH 2B · PHASE 2 — THE INVOICE'S OWN STATE MOVES WITH THE LEDGER
 * ---------------------------------------------------------------------------
 *
 * Verify against a live PostgreSQL database the exact Batch 2B contract:
 *
 *   §1  An invoice is created once; a repeat returns the SAME document.
 *
 *   §2  ₹35,000 of a ₹50,000 invoice ⇒ payment_status AND the InvoiceStatus
 *       enum BOTH read PARTIALLY_PAID, and ₹15,000 stays outstanding on the
 *       trip's canonical financials.
 *
 *   §3  Paying the remaining ₹15,000 ⇒ PAID on both columns + paid_at stamped.
 *
 *   §4  An over-payment never advertises a negative balance: the invoice is
 *       PAID with a ZERO balance (the Phase 7 contract — no cap, the change
 *       is a settlement fact, not a debt).
 *
 *   §5  A reversed receipt (a CANCELLED ledger row) makes the invoice fall
 *       back to PENDING/UNPAID — it stops claiming money that is not there.
 *
 *   §6  Completing the trip NEVER settles the bill: DELIVERED/COMPLETED leave
 *       the outstanding and the invoice's own state exactly as they were.
 *
 *   §7  Vendor money on the trip (advances / owner settlements) never moves
 *       the customer receivable.
 *
 *   §8  The canonical `recordClientPayment` path reconciles the invoice too —
 *       every customer-receipt path shares ONE reconciliation.
 *
 * Nothing is mocked. Every row is created for the test and deleted again in
 * `after()`. If no live PostgreSQL is available the suite reports itself as
 * SKIPPED — it never pretends to have passed.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const TripInvoiceService = require('../services/TripInvoiceService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const TripAdvanceService = require('../services/TripAdvanceService');

const ADMIN = { user_id: null, role: 'admin' };

const created = {
  users: [], drivers: [], vehicleOwners: [], transportVehicles: [], trips: [],
  invoices: [], tripFinancials: [], tripAdvances: [], financialTransactions: [],
};

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

let counter = 0;
function uniq(base) {
  counter += 1;
  return `${base}${process.pid}${counter}${Date.now().toString(36)}`;
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
  await prisma.financialTransaction.deleteMany({ where: { transaction_id: { in: created.financialTransactions } } });
  await prisma.tripAdvance.deleteMany({ where: { advance_id: { in: created.tripAdvances } } });
  await prisma.tripFinancial.deleteMany({ where: { trip_financial_id: { in: created.tripFinancials } } });
  await prisma.invoice.deleteMany({ where: { invoice_id: { in: created.invoices } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.booking.deleteMany({ where: { booking_id: { in: createdBookings } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.transportVehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.vehicleOwners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

/** Booking rows created by the §10 chain (deleted before the trips above). */
const createdBookings = [];

/**
 * One customer → vendor → vehicle → driver → trip chain, with the customer's
 * registered user on the trip so the invoice has a payer.
 */
async function seedTrip({ freight = 50000, status = 'IN_TRANSIT', suffix }) {
  const u = uniq(suffix || 'B2BI');
  const customer = await prisma.user.create({
    data: {
      first_name: 'B2B', last_name: 'Customer',
      email: `b2b.customer.${u}@example.test`,
      phone: `97${u}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(customer.user_id);

  const owner = await prisma.vehicleOwner.create({
    data: { owner_name: `B2B Owner ${u}`, mobile: `999${u}`.slice(0, 10), owner_type: 'TRANSPORT_COMPANY' },
  });
  created.vehicleOwners.push(owner.owner_id);

  const vehicle = await prisma.transportVehicle.create({
    data: { vehicle_number: `P2BI${u}`.slice(0, 20), vehicle_type: 'TRUCK', owner_id: owner.owner_id },
  });
  created.transportVehicles.push(vehicle.vehicle_id);

  const driverUser = await prisma.user.create({
    data: {
      first_name: 'B2B', last_name: 'Driver',
      email: `b2b.driver.${u}@example.test`,
      phone: `88${u}`.slice(0, 10),
      password_hash: 'not-used',
    },
  });
  created.users.push(driverUser.user_id);

  const driver = await prisma.driver.create({
    data: { user_id: driverUser.user_id, driver_name: `B2B Driver ${u}`, mobile: `77${u}`.slice(0, 10), transport_owner_id: owner.owner_id },
  });
  created.drivers.push(driver.driver_id);

  const trip = await prisma.trip.create({
    data: {
      trip_number: `BTBT-B2B-${u}`,
      source_type: 'ONLINE_BOOKING',
      user_id: customer.user_id,
      transport_owner_id: owner.owner_id,
      vehicle_id: vehicle.vehicle_id,
      driver_id: driver.driver_id,
      pickup_location: 'Begusarai',
      pickup_city: 'Begusarai',
      drop_location: 'Patna',
      drop_city: 'Patna',
      freight_amount: freight,
      driver_payment: 0,
      trip_date: new Date('2026-10-04T00:00:00.000Z'),
      status,
    },
  });
  created.trips.push(trip.trip_id);

  return { tripId: trip.trip_id, userId: customer.user_id, freight };
}

async function track(ctx) {
  const [inv, tf, txa] = await Promise.all([
    prisma.invoice.findMany({ where: { trip_id: ctx.tripId }, select: { invoice_id: true } }),
    prisma.tripFinancial.findMany({ where: { trip_id: ctx.tripId }, select: { trip_financial_id: true } }),
    prisma.financialTransaction.findMany({ where: { trip_id: ctx.tripId }, select: { transaction_id: true } }),
  ]);
  created.invoices.push(...inv.map((r) => r.invoice_id));
  created.tripFinancials.push(...tf.map((r) => r.trip_financial_id));
  created.financialTransactions.push(...txa.map((r) => r.transaction_id));
}

const service = () => new TripInvoiceService({ prisma });
const canonical = () => new CanonicalFinancialService({ prisma });

const guard = async (t) => {
  if (!ready) return t.skip(skipReason);
  return null;
};

/* ==========================================================================
   §1 — ONE BILL, AND ONLY ONE
   ========================================================================== */

test('DB · createInvoice raises ₹50,000 exactly once; a repeat returns the same document', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV1' });

  const first = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);
  assert.equal(first.created, true);
  assert.equal(first.invoice.grand_total, 50000);
  assert.equal(first.invoice.status, 'GENERATED');
  assert.equal(first.invoice.payment_status, 'UNPAID');
  assert.equal(first.position.received, 0);
  assert.equal(first.position.balance, 50000);

  // Idempotent: a double-clicked Create never raises a second bill.
  const second = await service().createInvoice(ctx.tripId, ADMIN);
  assert.equal(second.created, false);
  assert.equal(second.invoice.invoice_id, first.invoice.invoice_id);

  const rows = await prisma.invoice.findMany({ where: { trip_id: ctx.tripId } });
  assert.equal(rows.length, 1);
});

/* ==========================================================================
   §2 — ₹35,000 ⇒ PARTIALLY_PAID, ₹15,000 OUTSTANDING — BOTH COLUMNS MOVE
   ========================================================================== */

test('DB · ₹35,000 of ₹50,000 is PARTIALLY_PAID on payment_status AND the enum', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV2' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  const receipt = await service().recordCustomerPayment(ctx.tripId, {
    amount: 35000,
    payment_method: 'BANK',
    reference_number: 'UTR-B2B-INV2-1',
  }, ADMIN);

  assert.equal(receipt.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(receipt.received, 35000);
  assert.equal(receipt.total, 50000);
  assert.equal(receipt.balance, 15000, 'exactly ₹15,000 stays outstanding');

  // The DOCUMENT agrees with the CASH — on BOTH of its own columns.
  let row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.payment_status, 'PARTIALLY_PAID');
  assert.equal(row.status, 'PARTIALLY_PAID', 'the InvoiceStatus enum moved with the cash');
  assert.equal(row.paid_at, null, 'nothing has been fully paid yet');

  // And the trip's canonical financials still demand the ₹15,000.
  const financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 15000);
});

/* ==========================================================================
   §3 — CLEARING THE REST ⇒ PAID + paid_at
   ========================================================================== */

test('DB · the remaining ₹15,000 makes the invoice PAID and stamps paid_at', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV3' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  await service().recordCustomerPayment(ctx.tripId, { amount: 35000, payment_method: 'CASH' }, ADMIN);
  const second = await service().recordCustomerPayment(ctx.tripId, { amount: 15000, payment_method: 'CASH' }, ADMIN);

  assert.equal(second.paymentStatus, 'PAID');
  assert.equal(second.balance, 0);

  const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.payment_status, 'PAID');
  assert.equal(row.status, 'PAID');
  assert.ok(row.paid_at instanceof Date, 'paid_at is stamped the moment the balance clears');

  const financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 0);
  assert.equal(financials.customerCollected, 50000);
});

/* ==========================================================================
   §4 — OVER-PAYMENT: PAID, BALANCE ZERO, NEVER NEGATIVE
   ========================================================================== */

test('DB · an over-payment lands as PAID with a ZERO balance and no negative debt', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV4' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  // Phase 7 contract: receipt paths do not impose an arbitrary cap; the
  // reconciliation must turn the overshoot into a settled document.
  const receipt = await service().recordCustomerPayment(ctx.tripId, { amount: 60000, payment_method: 'CASH' }, ADMIN);

  assert.equal(receipt.paymentStatus, 'PAID');
  assert.equal(receipt.balance, 0, 'the advertised balance is clamped to zero');
  assert.ok(receipt.balance >= 0, 'a balance is never negative');

  const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.payment_status, 'PAID');
  assert.equal(row.status, 'PAID');

  const financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 0, 'nothing is due');
});

/* ==========================================================================
   §5 — A REVERSED RECE stopS THE INVOICE CLAIMING MONEY
   ========================================================================== */

test('DB · cancelling the receipt falls the invoice back to PENDING/UNPAID', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV5' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  const paid = await service().recordCustomerPayment(ctx.tripId, {
    amount: 35000,
    payment_method: 'BANK',
    reference_number: 'UTR-B2B-INV5-1',
  }, ADMIN);
  assert.equal(paid.paymentStatus, 'PARTIALLY_PAID');

  // The reversal: the SAME ledger row is cancelled, never deleted — a money
  // trail that erases itself is no trail.
  await prisma.financialTransaction.update({
    where: { transaction_id: paid.transaction.transaction_id },
    data: { status: 'CANCELLED', updated_at: new Date() },
  });

  // THE ONE RECONCILIATION, run standalone here — receipt paths run it inside
  // their own transaction.
  const recon = await TripInvoiceService.reconcileInvoiceStatus({
    prisma,
    invoiceId: inv.invoice.invoice_id,
  });

  assert.equal(recon.paymentStatus, 'UNPAID');
  assert.equal(recon.status, 'PENDING', 'the enum falls back instead of keeping the claim');
  assert.equal(recon.received, 0, 'cancelled receipts are not money in');
  assert.equal(recon.balance, 50000);

  const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.payment_status, 'UNPAID');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.paid_at, null);
});

/* ==========================================================================
   §6 — COMPLETING THE TRIP NEVER SETTLES THE BILL
   ========================================================================== */

test('DB · DELIVERED and COMPLETED leave the outstanding and the document untouched, unpaid', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV6' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  await service().recordCustomerPayment(ctx.tripId, { amount: 35000, payment_method: 'CASH' }, ADMIN);

  let financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 15000);
  let row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.status, 'PARTIALLY_PAID');

  // DELIVERED: driving the operation forward is NOT a money movement.
  await prisma.trip.update({ where: { trip_id: ctx.tripId }, data: { status: 'DELIVERED' } });
  financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 15000, 'delivery does not change the outstanding');
  row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.status, 'PARTIALLY_PAID', 'and does not settle the document');

  // COMPLETED: not even the final state clears it.
  await prisma.trip.update({ where: { trip_id: ctx.tripId }, data: { status: 'COMPLETED' } });
  financials = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(financials.customerDue, 15000, 'completion does not change the outstanding');
  row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.status, 'PARTIALLY_PAID');
  assert.equal(row.paid_at, null);
});

/* ==========================================================================
   §7 — VENDOR MONEY NEVER MOVES THE CUSTOMER RECEIVABLE
   ========================================================================== */

test('DB · an owner advance changes the vendor side and nothing of the customer receivable', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV7' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  await service().recordCustomerPayment(ctx.tripId, { amount: 35000, payment_method: 'CASH' }, ADMIN);

  const before = await canonical().calculateTripFinancials(ctx.tripId);
  const positionBefore = await (await service()).getPosition(inv.invoice);

  // ₹25,000 advanced to the owner — VENDOR money, on the same trip and the
  // same canonical ledger.
  const advances = new TripAdvanceService({ prisma });
  await advances.createAdvance(null, {
    trip_id: ctx.tripId,
    amount: 25000,
    advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash',
    reference_number: `B2B-INV7-ADV`,
    advance_date: '2026-10-15',
  }, ADMIN);
  await track(ctx);

  const after = await canonical().calculateTripFinancials(ctx.tripId);
  assert.equal(after.customerDue, before.customerDue, 'the customer due does not move');
  assert.equal(after.customerCollected, before.customerCollected, 'collected does not move');

  const positionAfter = await service().getPosition(inv.invoice);
  assert.equal(positionAfter.received, positionBefore.received, 'a vendor advance is not a customer receipt');
  assert.equal(positionAfter.received, 35000);
  assert.equal(positionAfter.balance, 15000);

  const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.status, 'PARTIALLY_PAID');
});

/* ==========================================================================
   §8 — EVERY RECEIPT PATH SHARES THE ONE RECONCILIATION
   ========================================================================== */

describe('DB · every customer-receipt path reconciles the invoice', () => {
  test('the canonical recordClientPayment path moves BOTH invoice columns too', async (t) => {
    if (await guard(t)) return;
    const ctx = await seedTrip({ freight: 50000, suffix: 'INV8' });
    const inv = await service().createInvoice(ctx.tripId, ADMIN);
    await track(ctx);

    await canonical().recordClientPayment(ctx.tripId, {
      amount: 35000,
      payment_method: 'bank_transfer',
      reference_number: `B2B-INV8-R1`,
      notes: 'phase-2 path parity',
    }, ADMIN);
    await track(ctx);

    const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
    assert.equal(row.payment_status, 'PARTIALLY_PAID');
    assert.equal(row.status, 'PARTIALLY_PAID');

    // And the receipt is stamped with the bill it paid.
    const receipt = await prisma.financialTransaction.findFirst({
      where: {
        trip_id: ctx.tripId,
        transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
      },
    });
    assert.ok(receipt, 'the receipt exists in the canonical ledger');
    assert.equal(receipt.invoice_id, inv.invoice.invoice_id, 'the ledger row names the invoice');
  });
});

/* ==========================================================================
   §9 — A REFUNDED RECEIPT IS NOT MONEY IN
   ========================================================================== */

test('DB · a REFUNDED receipt stops being money in — the document falls back with the ledger', async (t) => {
  if (await guard(t)) return;

  const ctx = await seedTrip({ freight: 50000, suffix: 'INV9' });
  const inv = await service().createInvoice(ctx.tripId, ADMIN);
  await track(ctx);

  const paid = await service().recordCustomerPayment(ctx.tripId, {
    amount: 35000,
    payment_method: 'BANK',
    reference_number: 'UTR-B2B-INV9-1',
  }, ADMIN);
  assert.equal(paid.paymentStatus, 'PARTIALLY_PAID');

  // The refund: the SAME ledger row is refunded, never deleted. The canonical
  // due-check never counts CANCELLED or REFUNDED money — the document's own
  // reconciliation must agree with that layer or the two would contradict.
  await prisma.financialTransaction.update({
    where: { transaction_id: paid.transaction.transaction_id },
    data: { status: 'REFUNDED', updated_at: new Date() },
  });

  const recon = await TripInvoiceService.reconcileInvoiceStatus({
    prisma,
    invoiceId: inv.invoice.invoice_id,
  });

  assert.equal(recon.received, 0, 'a refunded receipt is not money in');
  assert.equal(recon.paymentStatus, 'UNPAID');
  assert.equal(recon.balance, 50000);
  assert.equal(recon.status, 'PENDING', 'the enum falls back instead of keeping the claim');

  const row = await prisma.invoice.findUnique({ where: { invoice_id: inv.invoice.invoice_id } });
  assert.equal(row.status, 'PENDING');
  assert.equal(row.paid_at, null);
});

/* ==========================================================================
   §10 — ONE BILL PER CONSIGNMENT, WHICHEVER PATH RAISED IT
   ========================================================================== */

describe('DB · the booking auto-bill and the trip invoice API are one path', () => {
  test('createInvoice returns the Phase 7 auto bill instead of raising a second document', async (t) => {
    if (await guard(t)) return;

    // THE ORDINARY CHAIN: booking confirmed → the Phase 7 auto invoice
    // (booking-linked only; the trip does not exist yet) → a trip later stands
    // up FOR that booking, as provisioning does.
    const ctx = await seedTrip({ freight: 50000, suffix: 'INV10' });
    const u = uniq('AUTO');

    const booking = await prisma.booking.create({
      data: {
        booking_number: `BTBT-AUTO-${u}`,
        user_id: ctx.userId,
        pickup_location: 'Begusarai', pickup_city: 'Begusarai',
        pickup_date: '2026-10-05', pickup_time: '09:00',
        drop_location: 'Patna', drop_city: 'Patna',
        goods_description: 'Audit goods',
        vehicle_type_required: 'Tata 407 14ft',
        final_price: 50000,
        status: 'confirmed', quote_status: 'ACCEPTED',
      },
    });
    createdBookings.push(booking.booking_id);

    const InvoiceRepositoryCtor = require('../repositories/InvoiceRepository');
    const auto = await new InvoiceRepositoryCtor({ prisma }).ensureForBooking({
      booking_id: booking.booking_id,
      booking_number: booking.booking_number,
      amount: 50000,
    });
    assert.equal(auto.created, true, 'the auto bill was created fresh for this booking');

    let autoRow = await prisma.invoice.findUnique({ where: { invoice_id: auto.invoice_id } });
    created.invoices.push(autoRow.invoice_id);
    assert.equal(autoRow.trip_id, null, 'the auto bill predates any trip — trip_id is NULL');
    assert.equal(Number(autoRow.total_amount), 50000);

    // Stand the trip up FOR this booking.
    const trip = await prisma.trip.update({
      where: { trip_id: ctx.tripId },
      data: { booking_id: booking.booking_id },
    });

    // ── THE ONE BILL: creating against the trip returns the booking's bill ──
    const promised = await service().createInvoice(trip.trip_id, ADMIN);
    assert.equal(promised.created, false, 'no second document is raised');
    assert.equal(promised.invoice.invoice_id, auto.invoice_id, 'the SAME bill comes back');
    assert.equal(promised.position.total, 50000, 'its position reads ₹50,000');
    assert.equal(promised.position.balance, 50000);

    // The Phase 7 document's columns are left exactly as written — the trip
    // API returns the bill, it does not rewrite the earlier contract.
    autoRow = await prisma.invoice.findUnique({ where: { invoice_id: auto.invoice_id } });
    assert.equal(autoRow.trip_id, null, 'returned unchanged, not rewritten');
    assert.equal(Number(autoRow.total_amount), 50000);

    // Exactly one invoice for the consignment, on both lookups.
    assert.equal(await prisma.invoice.count({ where: { booking_id: booking.booking_id } }), 1);
    assert.equal(await prisma.invoice.count({ where: { trip_id: trip.trip_id } }), 0);

    // Money flows to it through the trip-scoped receipt API anyway — the
    // booking-authored bill reconciles like any other.
    const receipt = await service().recordCustomerPayment(trip.trip_id, {
      amount: 35000,
      payment_method: 'BANK',
      reference_number: 'UTR-B2B-INV10-1',
    }, ADMIN);
    assert.equal(receipt.invoice.invoice_id, auto.invoice_id, 'the receipt settles the booking bill');
    assert.equal(receipt.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(receipt.balance, 15000);

    const stamped = await prisma.financialTransaction.findFirst({
      where: {
        trip_id: trip.trip_id,
        transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
    });
    assert.equal(stamped.invoice_id, auto.invoice_id, 'the ledger row names the booking-authored bill');

    const afterRow = await prisma.invoice.findUnique({ where: { invoice_id: auto.invoice_id } });
    assert.equal(afterRow.payment_status, 'PARTIALLY_PAID');
    assert.equal(afterRow.status, 'PARTIALLY_PAID');

    // The read side sees it too — no "no invoice" dead end inviting a second.
    const read = await service().getInvoiceForTrip(trip.trip_id);
    assert.equal(read.invoice_id, auto.invoice_id, 'getInvoiceForTrip shows the booking bill');
    assert.equal(read.position.balance, 15000);
  });
});
