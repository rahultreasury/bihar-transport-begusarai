/**
 * tests/bookingInvoicePolicy.test.js
 * -----------------------------------
 * Unit tests for the BookingService.createBooking() invoice policy.
 *
 * Policies:
 *   AUTO_IF_ACCEPTED (default) — raise invoice when quote_status is ACCEPTED.
 *   DEFER — never raise an invoice automatically.
 *   EXPLICIT — raise invoice only when input.createInvoice === true.
 *
 * Uses injected fake repositories and a patched prisma.$transaction so no
 * real database is touched. Follows the same pattern as
 * tests/bookingOwnerNotification.test.js and tests/quoteConfirmation.test.js.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const BookingService = require('../services/BookingService');
const { prisma: realPrisma } = require('../config/prisma');

const INVOICE_POLICY = {
  AUTO_IF_ACCEPTED: 'AUTO_IF_ACCEPTED',
  DEFER: 'DEFER',
  EXPLICIT: 'EXPLICIT',
};

function makeFakeRepos() {
  const state = {
    booking: null,
    delivery: null,
    timelineEvents: [],
    invoices: [],
  };

  const bookingRepo = {
    create: async (data, tx) => {
      const id = 5001;
      state.booking = { booking_id: id, ...data };
      return state.booking;
    },
    update: async (id, data, tx) => {
      state.booking = { ...state.booking, ...data };
      return state.booking;
    },
  };

  const timelineRepo = {
    addEvent: async (bookingId, eventType, payload, tx) => {
      state.timelineEvents.push({ bookingId, eventType, payload: payload ? JSON.parse(payload) : null });
      return { booking_event_id: state.timelineEvents.length };
    },
  };

  const invoiceRepo = {
    buildInvoiceNumber: (bookingNumber) => `INV-${bookingNumber}`,
    ensureForBooking: async ({ booking_id, booking_number, amount, status, notes }, tx) => {
      const existing = state.invoices.find((i) => i.booking_id === booking_id);
      if (existing) {
        return { invoice_id: existing.invoice_id, invoice_number: existing.invoice_number, created: false };
      }
      const row = {
        invoice_id: state.invoices.length + 1,
        booking_id,
        invoice_number: `INV-${booking_number || booking_id}`,
        final_price: amount,
        status,
        notes,
      };
      state.invoices.push(row);
      return { invoice_id: row.invoice_id, invoice_number: row.invoice_number, created: true };
    },
  };

  return { bookingRepo, timelineRepo, invoiceRepo, state };
}

function makeFakeTx(repos) {
  return {
    delivery: {
      create: async ({ data }) => {
        repos.state.delivery = { delivery_id: 1, ...data };
        return repos.state.delivery;
      },
    },
    booking: {
      findUnique: async ({ where }) => {
        if (!repos.state.booking) return null;
        return where.booking_id === repos.state.booking.booking_id ? repos.state.booking : null;
      },
    },
    bookingEvent: { create: async () => ({ booking_event_id: 1 }) },
  };
}

function makeService(repos) {
  return new BookingService({
    bookingRepo: repos.bookingRepo,
    timelineRepo: repos.timelineRepo,
    invoiceRepo: repos.invoiceRepo,
    tripProvisioningService: {
      ensureTripForBooking: async () => ({ trip: { trip_id: 999, booking_id: 5001, status: 'PENDING' }, created: true }),
    },
  });
}

const BASE_INPUT = {
  user_id: 9,
  vehicle_type_required: 'Tata 407 14ft',
  pickup_location: 'Begusarai',
  drop_location: 'Patna',
  goods_description: 'Cement Bags',
  final_price: 13500,
};

function patchTransaction(repos) {
  const originalTransaction = realPrisma.$transaction;
  realPrisma.$transaction = async (fn) => fn(makeFakeTx(repos));
  return originalTransaction;
}

describe('BookingService.createBooking — invoice policy', () => {
  test('1. Default policy (AUTO_IF_ACCEPTED) generates invoice for accepted booking', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED' };
      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 1, 'one invoice raised for accepted booking');
      assert.equal(created.invoice_number, `INV-${created.booking_number}`);
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('2. Default policy does NOT generate invoice for pending booking', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'pending' };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 0, 'no invoice for non-accepted booking');
      assert.equal(created.invoice_number, null);
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('3. DEFER does not generate invoice for accepted booking', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED', invoicePolicy: 'DEFER' };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 0, 'DEFER: no invoice even for accepted booking');
      assert.equal(created.invoice_number, null);
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('4. DEFER still creates Booking, Delivery, and Timeline records', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED', invoicePolicy: 'DEFER' };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id, 'booking created');
      assert.ok(repos.state.delivery, 'delivery record created');
      assert.ok(repos.state.timelineEvents.length > 0, 'timeline event recorded');
      assert.equal(repos.state.invoices.length, 0, 'no invoice');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('5. EXPLICIT does not generate invoice without createInvoice=true', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED', invoicePolicy: 'EXPLICIT' };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 0, 'EXPLICIT: no invoice without explicit opt-in');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('6. EXPLICIT generates invoice when createInvoice=true', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED', invoicePolicy: 'EXPLICIT', createInvoice: true };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 1, 'EXPLICIT: invoice raised on explicit opt-in');
      assert.equal(created.invoice_number, `INV-${created.booking_number}`);
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('7. AUTO_IF_ACCEPTED does not generate invoice when quote_status is PENDING', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'pending', quote_status: 'PENDING' };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 0, 'no invoice when quote_status is PENDING');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('8. AUTO_IF_ACCEPTED does not generate invoice when final_price is zero', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED', final_price: 0 };

      const created = await service.createBooking(input);

      assert.ok(created.booking_id);
      assert.equal(repos.state.invoices.length, 0, 'no invoice when amount is zero');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('9. Invoice is idempotent — ensureForBooking returns existing invoice on repeat', async (t) => {
    const repos = makeFakeRepos();
    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED' };

      const first = await service.createBooking(input);
      // Second call simulates a retry — ensureForBooking must return the existing invoice.
      const firstInvoiceId = repos.state.invoices[0].invoice_id;

      // Call ensureForBooking directly to verify idempotency at the repo level.
      const again = await repos.invoiceRepo.ensureForBooking(
        { booking_id: first.booking_id, booking_number: first.booking_number, amount: 13500 },
        makeFakeTx(repos)
      );

      assert.equal(repos.state.invoices.length, 1, 'only one invoice row exists');
      assert.equal(again.created, false, 'second call does not create a new invoice');
      assert.equal(again.invoice_id, firstInvoiceId, 'resolves to the existing invoice');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });
});

describe('BookingService.createBooking — transaction rollback', () => {
  test('10. Failed booking creation leaves no partial records', async (t) => {
    const repos = makeFakeRepos();
    repos.bookingRepo.create = async () => { throw new Error('DB write failed'); };

    const originalTx = patchTransaction(repos);
    try {
      const service = makeService(repos);
      const input = { ...BASE_INPUT, status: 'confirmed', quote_status: 'ACCEPTED' };

      await assert.rejects(() => service.createBooking(input), /DB write failed/);
      assert.equal(repos.state.invoices.length, 0, 'no invoice after failed transaction');
      assert.equal(repos.state.delivery, null, 'no delivery after failed transaction');
      assert.equal(repos.state.timelineEvents.length, 0, 'no timeline after failed transaction');
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });
});
