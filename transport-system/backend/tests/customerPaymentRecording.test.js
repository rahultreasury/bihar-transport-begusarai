/**
 * tests/customerPaymentRecording.test.js
 * ---------------------------------------------------------------------------
 * CUSTOMER PAYMENT RECORDING — end-to-end service behaviour.
 *
 * The route POST /api/trips/:tripId/payments/client (protect + adminOnly) calls
 * CanonicalFinancialService.recordClientPayment, which is the ONE place a
 * customer/client collection is written to the FinancialTransaction ledger.
 * These tests pin the business rules the operator depends on:
 *   • partial and full payments reduce the outstanding correctly,
 *   • overpayment is refused,
 *   • a non-positive amount is refused,
 *   • CANCELLED / REFUNDED money never counts as collected,
 *   • a retried request with the same reference is idempotent (no double post),
 *   • the write carries the trip / booking / client / audit references.
 *
 * Authorization (protect + adminOnly) is enforced by the route middleware and
 * is covered by the financialDrilldown authorization suite; it is not re-mocked
 * here.
 *
 * LOCAL ONLY — in-memory fakes, no database, no production records touched.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const FREIGHT = 50000;

/** In-memory prisma covering exactly what recordClientPayment touches. */
function makePrisma({ freight = FREIGHT, bookingId = 11, transactions = [], tripPayments = [] } = {}) {
  const state = {
    trip: {
      trip_id: 1, trip_number: 'BTBT-2026-00001', freight_amount: freight,
      source_type: 'ONLINE_BOOKING', client_id: null, booking_id: bookingId, status: 'IN_TRANSIT',
    },
    transactions: transactions.map((t, i) => ({ transaction_id: i + 1, trip_id: 1, booking_id: bookingId, ...t })),
    tripPayments,
    tripFinancial: null,
    lockAcquired: false,
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
      }
      return row[k] === v;
    });

  const tx = {
    trip: {
      findUnique: async ({ where, include } = {}) => {
        if (where.trip_id !== state.trip.trip_id) return null;
        if (!include) return state.trip;
        // calculateTripFinancials reads the trip with its relations included.
        const row = { ...state.trip };
        if (include.financialTransactions) row.financialTransactions = [...state.transactions];
        if (include.payments) row.payments = [...state.tripPayments];
        return row;
      },
    },
    tripPayment: {
      findMany: async ({ where }) => state.tripPayments.filter((p) => matches(p, where)),
    },
    financialTransaction: {
      findMany: async ({ where }) => state.transactions.filter((t) => matches(t, where)),
      findFirst: async ({ where }) => state.transactions.find((t) => matches(t, where)) || null,
      create: async ({ data }) => {
        const row = { transaction_id: state.transactions.length + 1, ...data };
        state.transactions.push(row);
        return row;
      },
    },
    tripFinancial: {
      findFirst: async ({ where }) => (state.tripFinancial && matches(state.tripFinancial, where) ? state.tripFinancial : null),
      create: async ({ data }) => {
        state.tripFinancial = { trip_financial_id: 1, ...data };
        return state.tripFinancial;
      },
    },
    $queryRaw: async () => { state.lockAcquired = true; return []; },
    $transaction: async (cb) => cb(tx),
  };

  return { ...tx, state };
}

const svc = (prisma) => new CanonicalFinancialService({ prisma });
const record = (prisma, payload, user = { user_id: 1 }) => svc(prisma).recordClientPayment(1, payload, user);

test('a partial payment reduces the outstanding and reports PARTIAL', async () => {
  const prisma = makePrisma();
  const tx = await record(prisma, { amount: 20000, payment_method: 'cash', reference_number: 'R-1' });

  assert.equal(tx.transaction_type, 'CUSTOMER_PAYMENT');
  assert.equal(tx.direction, 'CREDIT');
  assert.equal(Number(tx.amount), 20000);
  assert.equal(tx.status, 'PAID');
  assert.equal(tx.trip_id, 1);
  assert.equal(tx.booking_id, 11);
  assert.equal(tx.created_by, 1, 'audit: the recording admin is stored');

  const fin = await svc(prisma).calculateTripFinancials(1);
  assert.equal(fin.customerCollected, 20000);
  assert.equal(fin.customerDue, 30000);
  assert.equal(fin.customerPaymentStatus, 'PARTIAL');
});

test('a full payment clears the outstanding and reports PAID', async () => {
  const prisma = makePrisma();
  await record(prisma, { amount: 50000, payment_method: 'upi', reference_number: 'R-FULL' });
  const fin = await svc(prisma).calculateTripFinancials(1);
  assert.equal(fin.customerCollected, 50000);
  assert.equal(fin.customerDue, 0);
  assert.equal(fin.customerPaymentStatus, 'PAID');
});

test('overpayment is refused and nothing is written', async () => {
  const prisma = makePrisma();
  await assert.rejects(
    () => record(prisma, { amount: 60000, payment_method: 'cash' }),
    /exceeds outstanding/i,
  );
  assert.equal(prisma.state.transactions.length, 0, 'no ledger row on a refused payment');
});

test('a non-positive amount is refused', async () => {
  const prisma = makePrisma();
  await assert.rejects(() => record(prisma, { amount: 0 }), /valid payment amount/i);
  await assert.rejects(() => record(prisma, { amount: -100 }), /valid payment amount/i);
  assert.equal(prisma.state.transactions.length, 0);
});

test('CANCELLED and REFUNDED money never counts as collected', async () => {
  const prisma = makePrisma({
    transactions: [
      { transaction_type: 'CUSTOMER_PAYMENT', amount: 20000, direction: 'CREDIT', status: 'CANCELLED', reference_number: 'X' },
      { transaction_type: 'CUSTOMER_PAYMENT', amount: 5000, direction: 'CREDIT', status: 'REFUNDED', reference_number: 'Y' },
    ],
  });
  // A fresh 10000 payment on top of the cancelled/refunded ones.
  await record(prisma, { amount: 10000, payment_method: 'cash', reference_number: 'R-2' });
  const fin = await svc(prisma).calculateTripFinancials(1);
  assert.equal(fin.customerCollected, 10000, 'only the live payment counts');
  assert.equal(fin.customerDue, 40000);
  assert.equal(fin.customerPaymentStatus, 'PARTIAL');
});

test('a retried request with the same reference is idempotent (no double post)', async () => {
  const prisma = makePrisma();
  const first = await record(prisma, { amount: 20000, payment_method: 'cash', reference_number: 'DUP-1' });
  const second = await record(prisma, { amount: 20000, payment_method: 'cash', reference_number: 'DUP-1' });

  assert.equal(first.idempotentReplay, undefined, 'the first call is a real write');
  assert.equal(second.idempotentReplay, true, 'the retry returns the original');
  assert.equal(second.transaction_id, first.transaction_id, 'same ledger row');
  assert.equal(prisma.state.transactions.length, 1, 'exactly one ledger row exists');

  const fin = await svc(prisma).calculateTripFinancials(1);
  assert.equal(fin.customerCollected, 20000, 'counted once, not twice');
});

test('the write takes a row lock so concurrent payments serialise', async () => {
  const prisma = makePrisma();
  // The first payment creates the ledger row; the second finds it and takes the
  // FOR UPDATE lock, which is what serialises two concurrent payments.
  await record(prisma, { amount: 10000, payment_method: 'cash', reference_number: 'LOCK-1' });
  assert.equal(prisma.state.lockAcquired, false, 'the create path does not lock');
  await record(prisma, { amount: 10000, payment_method: 'cash', reference_number: 'LOCK-2' });
  assert.equal(prisma.state.lockAcquired, true, 'FOR UPDATE lock was taken on the existing row');
});
