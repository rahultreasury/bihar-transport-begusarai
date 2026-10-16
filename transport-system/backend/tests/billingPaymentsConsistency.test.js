/**
 * tests/billingPaymentsConsistency.test.js
 * ---------------------------------------------------------------------------
 * BILLING AND PAYMENTS MUST AGREE FOR THE SAME CONSIGNMENT.
 *
 * THE TWO READ PATHS (verified against the live API during the audit):
 *   • Billing  — GET /api/trips/:bookingId/financial
 *                → TripFinancialService.getTripFinancialSummary(bookingId, role)
 *                → reads the legacy TripFinancial row (billed = booking.final_price)
 *   • Payments — GET /api/trips/:tripId/financials
 *                → CanonicalFinancialService.calculateTripFinancials(tripId)
 *                → reads the Trip (freight = trip.freight_amount)
 *
 * They resolve by DIFFERENT identifiers (bookingId vs tripId) and read the SAME
 * FinancialTransaction ledger through different relations (trip_financial_id vs
 * trip_id). The audit confirmed the applicable customer figures are IDENTICAL
 * for a live consignment, so the endpoint/ID difference is NOT a defect.
 *
 * THE ONE REAL DIFFERENCE — NOW FIXED
 *   The canonical Payments path excludes CANCELLED and REFUNDED money
 *   (CanonicalFinancialService._isLiveMoney); the legacy Billing path used to
 *   count it, so a cancelled/refunded customer payment still read as collected.
 *   TripFinancialService._calculateFromTransactions now applies the SAME rule.
 *   These tests pin that both paths agree for PAID, PARTIAL, CANCELLED and
 *   REFUNDED, and that the outstanding balance and payment status are correct.
 *
 * LOCAL ONLY — in-memory fakes, no database, no production records touched.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const TripFinancialService = require('../services/TripFinancialService');

/* ── One shared consignment, linked the way the real schema links it ─────────
   A FinancialTransaction carries BOTH trip_id and trip_financial_id, so the
   Billing relation (trip_financial_id) and the Payments relation (trip_id)
   project the SAME rows. */
const TRIP_ID = 1;
const BOOKING_ID = 100;
const FREIGHT = 50000;

const customerPayment = (id, amount, status = 'PAID') => ({
  transaction_id: id,
  trip_id: TRIP_ID,
  trip_financial_id: 1,
  booking_id: BOOKING_ID,
  transaction_type: 'CUSTOMER_PAYMENT',
  direction: 'CREDIT',
  amount,
  status,
  reference_number: `R-${id}`,
  metadata: null,
});

/** In-memory prisma for CanonicalFinancialService.calculateTripFinancials. */
function canonicalPrisma(transactions) {
  const trip = {
    trip_id: TRIP_ID,
    trip_number: 'BTBT-2026-00001',
    booking_id: BOOKING_ID,
    status: 'DELIVERED',
    source_type: 'ONLINE_BOOKING',
    freight_amount: FREIGHT,
    driver_payment: 0,
    client_id: null,
    transport_owner_id: null,
    driver_id: null,
    financialTransactions: transactions,
    payments: [],
    client: null,
    driver: null,
    transportOwner: null,
  };
  return {
    trip: {
      findUnique: async ({ where }) => (where.trip_id === TRIP_ID ? trip : null),
    },
  };
}

/** TripFinancialService with the legacy TripFinancial row stubbed. */
function billingService(transactions) {
  const svc = new TripFinancialService();
  svc.tripFinancialRepo = {
    findByBookingId: async (id) => (id === BOOKING_ID ? {
      trip_financial_id: 1,
      status: 'CALCULATED',
      customer_fare: 0,
      driver_payout: 0,
      owner_settlement_amount: 0,
      commission_rate: 0,
      commission_amount: 0,
      bt_margin: 0,
      trip: { trip_id: TRIP_ID },
      booking: {
        booking_id: BOOKING_ID,
        booking_number: 'BTB-2026-00100',
        final_price: FREIGHT,
        status: 'confirmed',
        commission_percentage: null,
        commission_type: null,
        owner_settlement_amount: null,
        driver_payout: null,
      },
      transactions,
      settlements: [],
      commissions: [],
    } : null),
    update: async (id, data) => ({ trip_financial_id: id, ...data }),
  };
  // Unused by getTripFinancialSummary, stubbed so nothing touches the real DB.
  svc.tripAdvanceRepo = { findByBookingId: async () => [] };
  svc.tripSettlementRepo = { findOrCreateByBookingId: async () => ({}) };
  svc.commissionRepo = { findLatestByBookingId: async () => null, create: async () => ({}) };
  svc.financialTxRepo = { create: async () => ({}) };
  svc.auditRepo = { create: async () => ({}) };
  return svc;
}

const paymentsOf = (transactions) =>
  new CanonicalFinancialService({ prisma: canonicalPrisma(transactions) }).calculateTripFinancials(TRIP_ID);
const billingOf = (transactions) =>
  billingService(transactions).getTripFinancialSummary(BOOKING_ID, 'ADMIN');

test('Billing (by bookingId) and Payments (by tripId) report identical customer figures', async () => {
  const transactions = [customerPayment(1, 20000)];
  const payments = await paymentsOf(transactions);
  const billing = await billingOf(transactions);

  assert.equal(billing.customerFare, payments.freight, 'billed amount must match freight');
  assert.equal(billing.customerFare, FREIGHT);
  assert.equal(billing.amountReceived, payments.customerCollected, 'received must match collected');
  assert.equal(billing.amountReceived, 20000);
  assert.equal(billing.outstandingAmount, payments.customerDue, 'outstanding must match due');
  assert.equal(billing.outstandingAmount, 30000);
  assert.equal(billing.paymentStatus, payments.customerPaymentStatus, 'status must match');
});

test('a single payment is counted once — no double counting across the two relations', async () => {
  const transactions = [customerPayment(1, 20000), customerPayment(2, 10000)];
  const payments = await paymentsOf(transactions);
  const billing = await billingOf(transactions);

  assert.equal(payments.customerCollected, 30000, 'two payments summed once each');
  assert.equal(billing.amountReceived, 30000);
  assert.equal(payments.customerDue, 20000);
  assert.equal(billing.outstandingAmount, 20000);
});

test('Payments resolves by internal trip_id; a missing trip is a clean not-found', async () => {
  const svc = new CanonicalFinancialService({ prisma: canonicalPrisma([]) });
  await assert.rejects(() => svc.calculateTripFinancials(99999), /not found/i);
});

test('Billing resolves by bookingId; a missing TripFinancial is initialized, not crashed', async () => {
  const svc = billingService([]);
  svc.initializeTripFinancial = async () => {};
  svc.tripFinancialRepo.findByBookingId = async (id) => (id === 200 ? {
    trip_financial_id: 2, status: 'CALCULATED', customer_fare: 0, driver_payout: 0,
    owner_settlement_amount: 0, commission_rate: 0, commission_amount: 0, bt_margin: 0,
    trip: null,
    booking: { booking_id: 200, booking_number: 'BTB-2026-00200', final_price: 10000, status: 'confirmed',
      commission_percentage: null, commission_type: null, owner_settlement_amount: null, driver_payout: null },
    transactions: [], settlements: [], commissions: [],
  } : null);
  const summary = await svc.getTripFinancialSummary(200, 'ADMIN');
  assert.equal(summary.customerFare, 10000);
  assert.equal(summary.outstandingAmount, 10000);
});

/* ── THE FIX: CANCELLED / REFUNDED must not count as valid payments ─────────── */

test('CANCELLED and REFUNDED are excluded in BOTH Billing and Payments', async () => {
  for (const status of ['CANCELLED', 'REFUNDED']) {
    const transactions = [customerPayment(1, 20000, status)];
    const payments = await paymentsOf(transactions);
    const billing = await billingOf(transactions);

    // Canonical path (unchanged) drops the money.
    assert.equal(payments.customerCollected, 0, `canonical drops ${status}`);
    // Legacy Billing path now applies the SAME rule (the fix).
    assert.equal(billing.amountReceived, 0, `Billing must also drop ${status}`);
    assert.equal(billing.outstandingAmount, FREIGHT, `full amount outstanding after ${status}`);
    assert.equal(billing.paymentStatus, 'PENDING', `status is PENDING after ${status}`);
    // And the two paths agree.
    assert.equal(billing.amountReceived, payments.customerCollected);
    assert.equal(billing.outstandingAmount, payments.customerDue);
    assert.equal(billing.paymentStatus, payments.customerPaymentStatus);
  }
});

test('PAID / PARTIAL / CANCELLED / REFUNDED drive the correct outstanding and status', async () => {
  const cases = [
    { status: 'PAID', amount: 50000, received: 50000, outstanding: 0, paymentStatus: 'PAID' },
    { status: 'PARTIAL', amount: 20000, received: 20000, outstanding: 30000, paymentStatus: 'PARTIAL' },
    { status: 'CANCELLED', amount: 20000, received: 0, outstanding: 50000, paymentStatus: 'PENDING' },
    { status: 'REFUNDED', amount: 20000, received: 0, outstanding: 50000, paymentStatus: 'PENDING' },
  ];
  for (const c of cases) {
    const billing = await billingOf([customerPayment(1, c.amount, c.status)]);
    assert.equal(billing.amountReceived, c.received, `${c.status}: received`);
    assert.equal(billing.outstandingAmount, c.outstanding, `${c.status}: outstanding`);
    assert.equal(billing.paymentStatus, c.paymentStatus, `${c.status}: payment status`);
  }
});

test('a live payment beside a cancelled one counts only the live amount', async () => {
  const transactions = [customerPayment(1, 20000, 'PAID'), customerPayment(2, 15000, 'CANCELLED')];
  const payments = await paymentsOf(transactions);
  const billing = await billingOf(transactions);
  assert.equal(billing.amountReceived, 20000, 'only the live payment counts');
  assert.equal(billing.outstandingAmount, 30000);
  assert.equal(billing.paymentStatus, 'PARTIAL');
  assert.equal(billing.amountReceived, payments.customerCollected, 'Billing matches Payments');
});
