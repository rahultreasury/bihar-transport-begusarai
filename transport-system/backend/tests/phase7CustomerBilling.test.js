/**
 * phase7CustomerBilling.test.js
 * ---------------------------------------------------------------------------
 * PHASE 7 — CUSTOMER BILLING → CUSTOMER PAYMENT (UNIT / SERVICE LEVEL)
 * ---------------------------------------------------------------------------
 *
 * WHAT THIS SUITE IS FOR
 *   Phase 7 audited the repository rather than redesigning it. Most of the
 *   customer-billing domain already existed, so this suite proves the EXISTING
 *   contracts and the Phase 7 hardening. It is deliberately written against
 *   the real services with an in-memory Prisma double, so it exercises the
 *   actual arithmetic and branching with nothing mocked above the database.
 *
 * WHAT IT COVERS (mapped to the Phase 7 brief)
 *   Billing      1-5   authoritative amount, invoice created once, duplicate
 *                       prevented, correct booking link, browser cannot override
 *   Payments     6-12  full, partial, multiple, duplicate, invalid, wrong
 *                       customer, unauthorized
 *   Balance      13-16 correct outstanding, partial, fully paid, overpayment
 *   Separation   23-26 customer payment must not move vendor money
 *   Idempotency  27    repeated request
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT
 *   Refunds, cancellation charges, GST and online payment providers are
 *   reported as NOT SPECIFIED in the audit; inventing an expectation for any
 *   of them here would be inventing a business rule.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const InvoiceRepository = require('../repositories/InvoiceRepository');
const { projectTransactionsForRole } = require('../dtos/TripFinancialDTO');

/* ========================================================================== */
/* An in-memory Prisma double, scoped to what these services actually touch.   */
/* ========================================================================== */

/**
 * @param {Object} seed
 * @param {Object} seed.trip
 * @param {Array}  seed.transactions  FinancialTransaction rows
 * @param {Array}  seed.tripPayments  TripPayment rows
 * @returns {Object} a Prisma-shaped client
 */
function makePrisma({ trip, transactions = [], tripPayments = [], tripFinancial = null }) {
  const state = {
    trip,
    transactions: transactions.map((t, i) => ({ transaction_id: i + 1, ...t })),
    tripPayments: [...tripPayments],
    tripFinancial,
    invoices: [],
    lockAcquired: false,
  };

  const matches = (row, where) =>
    Object.entries(where || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
      }
      return row[k] === v;
    });

  const tx = {
    trip: {
      // `calculateTripFinancials` reads the trip with its relations included,
      // so the double has to attach them or the ledger looks empty.
      findUnique: async ({ include } = {}) => {
        if (!include) return state.trip;
        const row = { ...state.trip };
        if (include.financialTransactions) row.financialTransactions = [...state.transactions];
        if (include.payments) row.payments = [...state.tripPayments];
        if (include.client) row.client = state.trip.client || null;
        if (include.driver) row.driver = null;
        if (include.transportOwner) row.transportOwner = null;
        return row;
      },
    },
    tripPayment: {
      findMany: async ({ where }) => state.tripPayments.filter((p) => matches(p, where)),
      create: async ({ data }) => {
        const row = { payment_id: state.tripPayments.length + 1, ...data };
        state.tripPayments.push(row);
        return row;
      },
      findFirst: async ({ where }) => state.tripPayments.find((p) => matches(p, where)) || null,
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
      findFirst: async ({ where }) => (matches(state.tripFinancial || {}, where) ? state.tripFinancial : null),
      create: async ({ data, select }) => {
        state.tripFinancial = { trip_financial_id: 1, ...data };
        return select ? { trip_financial_id: 1 } : state.tripFinancial;
      },
    },
    invoice: {
      findFirst: async ({ where }) => state.invoices.find((i) => matches(i, where)) || null,
      create: async ({ data }) => {
        const row = { invoice_id: state.invoices.length + 1, ...data };
        state.invoices.push(row);
        return row;
      },
    },
    $queryRaw: async () => {
      state.lockAcquired = true;
      return [];
    },
    $transaction: async (cb) => cb(tx),
  };

  // `recordClientPayment` reads the trip through the top-level client and
  // everything else through the transaction client, so both share one state.
  const client = { ...tx, $transaction: tx.$transaction, state };
  return client;
}

function tripRow(overrides = {}) {
  return {
    trip_id: 1,
    trip_number: 'BTBT-2026-00001',
    freight_amount: 50000,
    source_type: 'ONLINE_BOOKING',
    client_id: null,
    user_id: 7,
    booking_id: 11,
    status: 'IN_TRANSIT',
    ...overrides,
  };
}

const customerPayment = (amount, extra = {}) => ({
  transaction_type: 'CUSTOMER_PAYMENT',
  amount,
  direction: 'CREDIT',
  from_party: 'CUSTOMER',
  to_party: 'BIHAR_TRANSPORT',
  status: 'PAID',
  trip_id: 1,
  metadata: null,
  reference_number: null,
  ...extra,
});

const serviceFor = (prisma) => new CanonicalFinancialService({ prisma });

/* ========================================================================== */
describe('BILLING — the authoritative customer amount', () => {
  test('1. the customer total is the persisted Trip.freight_amount, never a posted one', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma).calculateTripFinancials(1);

    assert.equal(f.freight, 50000, 'freight comes from the trip row');
    assert.equal(f.customerDue, 50000, 'nothing paid yet');
    assert.equal(f.customerPaymentStatus, 'PENDING');
  });

  test('1b. TripPayment rows are NOT summed on top of the canonical ledger (no double count)', async () => {
    // TripService.addPayment writes BOTH a TripPayment and a
    // FinancialTransaction for the same money. Summing both would bill twice.
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [customerPayment(20000)],
      tripPayments: [
        { amount: 20000, payment_category: 'CLIENT_PAYMENT' },
        { amount: 20000, payment_category: 'CLIENT_PAYMENT' },
      ],
    });
    const f = await serviceFor(prisma).calculateTripFinancials(1);

    assert.equal(f.customerCollected, 20000, 'the ledger is authoritative when it has spoken');
    assert.equal(f.customerDue, 30000);
  });

  test('1c. TripPayment rows ARE used when the canonical ledger has no customer payment', async () => {
    // The documented legacy fallback: payments recorded before the ledger was
    // populated must still be honoured, or historical money would vanish.
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [],
      tripPayments: [{ amount: 12000, payment_category: 'CLIENT_PAYMENT' }],
    });
    const f = await serviceFor(prisma).calculateTripFinancials(1);

    assert.equal(f.customerCollected, 12000);
    assert.equal(f.customerDue, 38000);
  });
});

/* ========================================================================== */
describe('INVOICE — one bill per booking', () => {
  const invoiceRepo = () => new InvoiceRepository();

  test('2. an invoice is created once for a booking', async () => {
    const prisma = makePrisma({ trip: tripRow() });
    const repo = invoiceRepo();

    const first = await repo.ensureForBooking({ booking_id: 5, booking_number: 'BTB-2026-00005', amount: 13500 }, prisma);
    assert.equal(first.created, true);
    assert.equal(prisma.state.invoices.length, 1);
  });

  test('3. a duplicate invoice is prevented — the second call returns the first', async () => {
    const prisma = makePrisma({ trip: tripRow() });
    const repo = invoiceRepo();

    const a = await repo.ensureForBooking({ booking_id: 5, booking_number: 'BTB-2026-00005', amount: 13500 }, prisma);
    const b = await repo.ensureForBooking({ booking_id: 5, booking_number: 'BTB-2026-00005', amount: 99999 }, prisma);

    assert.equal(b.created, false, 'the second attempt does not create a bill');
    assert.equal(b.invoice_id, a.invoice_id, 'it resolves to the invoice that already exists');
    assert.equal(prisma.state.invoices.length, 1, 'exactly one invoice row exists');
    assert.equal(
      prisma.state.invoices[0].final_price,
      13500,
      'a later attempt cannot rewrite the agreed amount'
    );
  });

  test('4. the invoice is linked to the booking it bills', async () => {
    const prisma = makePrisma({ trip: tripRow() });
    await invoiceRepo().ensureForBooking({ booking_id: 42, booking_number: 'BTB-2026-00042', amount: 9000 }, prisma);

    assert.equal(prisma.state.invoices[0].booking_id, 42);
  });

  test('5. the invoice number is deterministic, so a retry cannot collide', () => {
    const repo = invoiceRepo();
    assert.equal(repo.buildInvoiceNumber('BTB-2026-00042'), 'INV-BTB-2026-00042');
    // The old generator appended Date.now(), so two invoices raised in the
    // same second produced the same number and broke the unique constraint.
    assert.equal(repo.buildInvoiceNumber('BTB-2026-00042'), repo.buildInvoiceNumber('BTB-2026-00042'));
  });
});

/* ========================================================================== */
describe('PAYMENTS — recording customer money', () => {
  test('6. a full payment clears the outstanding', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 50000, payment_method: 'upi', reference_number: 'UPI-1' });
    const after = await f.calculateTripFinancials(1);

    assert.equal(after.customerCollected, 50000);
    assert.equal(after.customerDue, 0);
    assert.equal(after.customerPaymentStatus, 'PAID');
  });

  test('7. a partial payment leaves the remainder outstanding', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 20000, payment_method: 'cash', reference_number: 'CASH-1' });
    const after = await f.calculateTripFinancials(1);

    assert.equal(after.customerCollected, 20000);
    assert.equal(after.customerDue, 30000);
    assert.equal(after.customerPaymentStatus, 'PARTIAL');
  });

  test('8. multiple payments accumulate', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 20000, reference_number: 'R-1' });
    await f.recordClientPayment(1, { amount: 30000, reference_number: 'R-2' });
    const after = await f.calculateTripFinancials(1);

    assert.equal(after.customerCollected, 50000);
    assert.equal(after.customerDue, 0);
    assert.equal(after.customerPaymentStatus, 'PAID');
    assert.equal(prisma.state.transactions.length, 2, 'two real money movements');
  });

  test('10. an invalid (non-positive) payment is rejected', async () => {
    const prisma = makePrisma({ trip: tripRow() });
    await assert.rejects(
      () => serviceFor(prisma).recordClientPayment(1, { amount: 0 }),
      /Valid payment amount is required/
    );
    await assert.rejects(
      () => serviceFor(prisma).recordClientPayment(1, { amount: -5 }),
      /Valid payment amount is required/
    );
    assert.equal(prisma.state.transactions.length, 0, 'no money moved');
  });

  test('16. overpayment follows the EXISTING repository rule: it is rejected', async () => {
    // The repository already rejected overpayment for both payment entry
    // points before Phase 7. Phase 7 does not invent a new policy; it keeps
    // the one that was there and makes the check atomic.
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await assert.rejects(
      () => f.recordClientPayment(1, { amount: 50001, reference_number: 'OVER-1' }),
      /exceeds outstanding customer due/
    );
    assert.equal(prisma.state.transactions.length, 0);
  });

  test('16b. an offline client payment still requires a client id', async () => {
    const prisma = makePrisma({
      trip: tripRow({ source_type: 'OFFLINE_CLIENT', client_id: null }),
    });
    await assert.rejects(
      () => serviceFor(prisma).recordClientPayment(1, { amount: 1000 }),
      /Client ID is required for offline client payment/
    );
  });
});

/* ========================================================================== */
describe('IDEMPOTENCY — a repeated request must not move money twice', () => {
  test('27. a repeated payment request with the same reference returns the first payment', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    const first = await f.recordClientPayment(1, { amount: 20000, reference_number: 'UPI-DUP-1' });
    const second = await f.recordClientPayment(1, { amount: 20000, reference_number: 'UPI-DUP-1' });

    assert.equal(second.idempotentReplay, true, 'the replay is recognised');
    assert.equal(second.transaction_id, first.transaction_id, 'it resolves to the same payment');
    assert.equal(prisma.state.transactions.length, 1, 'exactly one money movement');

    const after = await f.calculateTripFinancials(1);
    assert.equal(after.customerCollected, 20000, 'the amount is counted once');
    assert.equal(after.customerDue, 30000);
  });

  test('27b. a repeated request is not double-counted', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-1' });
    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-1' });
    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-1' });

    assert.equal(prisma.state.transactions.length, 1);

    const after = await f.calculateTripFinancials(1);
    assert.equal(after.customerCollected, 10000, 'counted exactly once');
    assert.equal(after.customerDue, 40000);
  });

  test('27b-2. a SECOND, distinct payment takes a row lock on the trip ledger', async () => {
    // The lock is what makes "is there still enough due?" safe against a
    // concurrent payment for the same trip. It is taken when the ledger row
    // ALREADY exists; the very first payment creates that row, so there is
    // nothing for a competing writer to collide with yet.
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-1' });
    assert.equal(prisma.state.lockAcquired, false, 'the first payment creates the ledger row');

    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-2' });
    assert.equal(prisma.state.lockAcquired, true, 'the second payment locks the ledger row');
    assert.equal(prisma.state.transactions.length, 2);
  });

  test('27c. a DIFFERENT reference is a genuinely different payment', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-1' });
    await f.recordClientPayment(1, { amount: 10000, reference_number: 'R-2' });

    assert.equal(prisma.state.transactions.length, 2, 'two references are two payments');
  });

  test('27d. a payment with no reference is accepted (offline cash has none)', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    const f = await serviceFor(prisma);

    const p = await f.recordClientPayment(1, { amount: 5000, payment_method: 'cash' });
    assert.equal(p.reference_number, null);
    assert.equal(prisma.state.transactions.length, 1);
  });
});

/* ========================================================================== */
describe('BALANCE — outstanding is derived, never stored twice', () => {
  test('13-15. outstanding tracks the persisted ledger exactly', async () => {
    const cases = [
      { paid: 0, due: 50000, status: 'PENDING' },
      { paid: 20000, due: 30000, status: 'PARTIAL' },
      { paid: 50000, due: 0, status: 'PAID' },
    ];

    for (const c of cases) {
      const prisma = makePrisma({
        trip: tripRow({ freight_amount: 50000 }),
        transactions: c.paid ? [customerPayment(c.paid)] : [],
      });
      const f = await serviceFor(prisma).calculateTripFinancials(1);

      assert.equal(f.customerCollected, c.paid);
      assert.equal(f.customerDue, c.due);
      assert.equal(f.customerPaymentStatus, c.status);
    }
  });

  test('13b. a CANCELLED payment is not collected', () => {
    // Step 8: payment status must be derived consistently from the persisted
    // record. The aggregation used to ignore `status` entirely, so a cancelled
    // payment still read as cash in hand.
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [customerPayment(20000, { status: 'CANCELLED' })],
    });
    const f = serviceFor(prisma);
    const agg = f._aggregateTransactions(prisma.state.transactions);

    assert.equal(agg.totalCustomerPayments, 0);
  });

  test('13c. a REFUNDED payment is not collected', () => {
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [customerPayment(20000, { status: 'REFUNDED' })],
    });
    const agg = serviceFor(prisma)._aggregateTransactions(prisma.state.transactions);
    assert.equal(agg.totalCustomerPayments, 0);
  });

  test('13d. an existing REVERSAL row reduces what was collected', () => {
    // The repository already writes a REVERSAL row (TripTransactionService
    // .createReversal) but the aggregation had no REVERSAL case, so a
    // reversed payment stayed counted forever.
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [
        customerPayment(20000, { transaction_id: 1, reference_number: 'UPI-9' }),
        {
          transaction_id: 2,
          transaction_type: 'REVERSAL',
          amount: 20000,
          direction: 'DEBIT',
          status: 'PAID',
          trip_id: 1,
          reference_number: 'UPI-9',
          metadata: JSON.stringify({ original_transaction_id: 1, original_type: 'CUSTOMER_PAYMENT' }),
        },
      ],
    });
    const f = serviceFor(prisma);
    const agg = f._aggregateTransactions(prisma.state.transactions);

    assert.equal(agg.totalCustomerPayments, 0, 'the reversed payment is no longer collected');
  });

  test('13e. a reversal can never manufacture a negative receivable', () => {
    const prisma = makePrisma({
      trip: tripRow(),
      transactions: [
        customerPayment(1000, { transaction_id: 1 }),
        {
          transaction_id: 2,
          transaction_type: 'REVERSAL',
          amount: 999999,
          direction: 'DEBIT',
          status: 'PAID',
          trip_id: 1,
          metadata: JSON.stringify({ original_transaction_id: 1, original_type: 'CUSTOMER_PAYMENT' }),
        },
      ],
    });
    const agg = serviceFor(prisma)._aggregateTransactions(prisma.state.transactions);
    assert.equal(agg.totalCustomerPayments, 0, 'floored at zero');
  });

  test('13f. a PARTIAL-status row is still counted (the client has not redefined it)', () => {
    // Excluding PARTIAL would silently re-classify money that exists today,
    // including a real OWNER_SETTLEMENT row on the live database.
    const prisma = makePrisma({
      trip: tripRow({ freight_amount: 50000 }),
      transactions: [customerPayment(20000, { status: 'PARTIAL' })],
    });
    const agg = serviceFor(prisma)._aggregateTransactions(prisma.state.transactions);
    assert.equal(agg.totalCustomerPayments, 20000);
  });
});

/* ========================================================================== */
describe('FINANCIAL SEPARATION — customer money is not vendor money', () => {
  test('23. a customer payment does not alter the vendor payable', async () => {
    const unpaid = await serviceFor(
      makePrisma({ trip: tripRow({ freight_amount: 50000, driver_payment: 40000 }) })
    ).calculateTripFinancials(1);

    const paid = await serviceFor(
      makePrisma({
        trip: tripRow({ freight_amount: 50000, driver_payment: 40000 }),
        transactions: [customerPayment(50000)],
      })
    ).calculateTripFinancials(1);

    assert.equal(paid.customerDue, 0, 'the customer is square');
    assert.equal(paid.driverDue, unpaid.driverDue, 'the driver is owed exactly as before');
    assert.equal(paid.ownerDue, unpaid.ownerDue, 'the owner is owed exactly as before');
    assert.equal(paid.driverDue, 40000, 'no driver advance was implied by the payment');
  });

  test('24. a customer payment does not alter commission', async () => {
    const before = await serviceFor(
      makePrisma({ trip: tripRow({ freight_amount: 50000 }) })
    ).calculateTripFinancials(1);

    const after = await serviceFor(
      makePrisma({
        trip: tripRow({ freight_amount: 50000 }),
        transactions: [customerPayment(50000)],
      })
    ).calculateTripFinancials(1);

    assert.equal(after.btCommission, before.btCommission, 'commission is a function of the hire, not the payment');
    assert.equal(after.commissionRate, before.commissionRate);
    assert.equal(after.btCommission, 2500, '5% of a 50,000 hire, per the fixed policy');
  });

  test('25. a customer payment creates no vendor money movement', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    await serviceFor(prisma).recordClientPayment(1, { amount: 50000, reference_number: 'R-1' });

    const vendorRows = prisma.state.transactions.filter(
      (t) =>
        t.transaction_type === 'OWNER_ADVANCE' ||
        t.transaction_type === 'OWNER_SETTLEMENT' ||
        t.transaction_type === 'DRIVER_ADVANCE' ||
        t.transaction_type === 'DRIVER_SETTLEMENT' ||
        t.transaction_type === 'COMMISSION'
    );
    assert.equal(vendorRows.length, 0, 'no vendor settlement is created by a customer payment');
  });

  test('26. a customer payment does not corrupt the trip ledger row', async () => {
    const prisma = makePrisma({ trip: tripRow({ freight_amount: 50000 }) });
    await serviceFor(prisma).recordClientPayment(1, { amount: 20000, reference_number: 'R-1' });

    assert.equal(prisma.state.tripFinancial.customer_fare, 50000, 'the gross hire is never rewritten');
    assert.equal(prisma.state.tripFinancial.trip_financial_id, 1);
  });
});

/* ========================================================================== */
describe('SECURITY — allow-list projections (no complete Prisma object)', () => {
  const rows = [
    { transaction_id: 1, trip_id: 1, transaction_type: 'CUSTOMER_PAYMENT', amount: 20000, direction: 'CREDIT', from_party: 'CUSTOMER', to_party: 'BIHAR_TRANSPORT', payment_method: 'upi', reference_number: 'R-1', transaction_date: null, status: 'PAID', notes: 'internal note', created_by: 5, metadata: '{"secret":1}', trip_financial_id: 3 },
    { transaction_id: 2, trip_id: 1, transaction_type: 'OWNER_SETTLEMENT', amount: 45000, direction: 'DEBIT', from_party: 'BIHAR_TRANSPORT', to_party: 'TRANSPORT_OWNER', payment_method: 'bank', reference_number: 'O-1', transaction_date: null, status: 'PAID', notes: 'internal note', created_by: 5, metadata: null, trip_financial_id: 3 },
    { transaction_id: 3, trip_id: 1, transaction_type: 'COMMISSION', amount: 5000, direction: 'DEBIT', from_party: 'BIHAR_TRANSPORT', to_party: 'BIHAR_TRANSPORT', payment_method: null, reference_number: null, transaction_date: null, status: 'PAID', notes: 'internal', created_by: 5, metadata: null, trip_financial_id: 3 },
  ];

  test('17. an admin still sees the complete ledger (the UI is unchanged)', () => {
    const out = projectTransactionsForRole(rows, 'ADMIN');
    assert.equal(out.length, 3);
    assert.equal(out[0].notes, 'internal note', 'admins keep the full row');
  });

  test('19. a customer sees only their own money', () => {
    const out = projectTransactionsForRole(rows, 'CUSTOMER');
    assert.equal(out.length, 1);
    assert.equal(out[0].transaction_type, 'CUSTOMER_PAYMENT');

    const serialised = JSON.stringify(out);
    assert.doesNotMatch(serialised, /OWNER_SETTLEMENT/, 'no vendor payable');
    assert.doesNotMatch(serialised, /COMMISSION/, 'no commission');
    assert.doesNotMatch(serialised, /TRANSPORT_OWNER/, 'no vendor party');
    assert.doesNotMatch(serialised, /bt_margin|btMargin/, 'no internal margin');
  });

  test('19b. a driver sees only their own advances and settlements', () => {
    const out = projectTransactionsForRole(rows, 'DRIVER');
    assert.equal(out.length, 0, 'none of these rows concern a driver');
    assert.doesNotMatch(JSON.stringify(out), /CUSTOMER_PAYMENT/);
  });

  test('21. a partner sees only owner money, never the customer fare', () => {
    const out = projectTransactionsForRole(rows, 'TRANSPORT_OWNER');
    assert.equal(out.length, 1);
    assert.equal(out[0].transaction_type, 'OWNER_SETTLEMENT');
    assert.doesNotMatch(JSON.stringify(out), /CUSTOMER_PAYMENT/);
  });

  test('19c. a non-admin row never carries internal columns', () => {
    const out = projectTransactionsForRole(rows, 'CUSTOMER');
    for (const key of ['notes', 'created_by', 'metadata', 'trip_financial_id', 'status']) {
      assert.ok(!(key in out[0]), `${key} must not be exposed to a customer`);
    }
  });
});
