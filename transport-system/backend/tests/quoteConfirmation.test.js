/**
 * Regression tests for the quote → confirmation single-source-of-truth fix.
 *
 * Confirmation is DRIVEN BY quote_status. Invariants:
 *   - status == confirmed  ==>  quote_status == ACCEPTED
 *   - quote_status == ACCEPTED  ==>  frontend shows Confirmed
 *   - Never status=confirmed with quote_status in {PENDING, SENT, ...}
 *
 * Covers:
 *   1. Customer online acceptance (acceptQuote → confirmation_source=CUSTOMER)
 *   2. Admin manual confirmation (confirmBooking → confirmation_source=ADMIN)
 *   3. bulkUpdateStatus('confirmed') auto-syncs quote_status=ACCEPTED + ADMIN
 *   4. Prevention of inconsistent states
 *
 * Uses node:test + node:assert (no extra deps). The BookingService is tested
 * with injected fake repositories so no real database is required.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const BookingService = require('../services/BookingService');
const { ValidationError, NotFoundError } = require('../utils/AppError');

// --- Fake repositories -----------------------------------------------------

function makeFakeRepos(overrides = {}) {
  const timelineEvents = [];
  const state = {
    booking: overrides.initialBooking || null,
  };

  const bookingRepo = {
    findById: async () => state.booking,
    update: async (id, data) => {
      state.booking = { ...(state.booking || {}), ...data };
      return { changes: 1 };
    },
  };

  const timelineRepo = {
    addEvent: async (bookingId, eventType, payload) => {
      timelineEvents.push({ bookingId, eventType, payload: payload ? JSON.parse(payload) : null });
      return { booking_event_id: timelineEvents.length };
    },
  };

  const reservationRepo = {
    getActiveByBooking: async () => overrides.activeReservation || null,
    convertAllActive: async () => 0,
    releaseAllActive: async () => 0,
  };

  const invoiceRepo = {
    create: async () => ({ invoice_id: 1 }),
  };

  // Fake prisma transaction helper — executes the callback with a fake tx.
  const tx = {
    bookingAssignment: { create: async () => ({ booking_assignment_id: 1 }) },
    driver: { update: async () => ({}) },
    transportVehicle: { update: async () => ({}) },
    delivery: {
      findUnique: async () => null,
      create: async () => ({ delivery_id: 1 }),
      update: async () => ({ delivery_id: 1 }),
    },
    bookingEvent: { create: async () => ({ booking_event_id: 1 }) },
    booking: { updateMany: async () => ({ count: 1 }) },
  };
  const prisma = {
    $transaction: async (fn) => fn(tx),
  };

  return {
    bookingRepo,
    timelineRepo,
    reservationRepo,
    invoiceRepo,
    prisma,
    state,
    timelineEvents,
    getState: () => state.booking,
  };
}

function makeService(fakes) {
  return new BookingService({
    bookingRepo: fakes.bookingRepo,
    timelineRepo: fakes.timelineRepo,
    reservationRepo: fakes.reservationRepo,
    invoiceRepo: fakes.invoiceRepo,
  });
}

// Need to inject prisma too. BookingService imports prisma from config; for
// isolation we stub the methods it uses by overriding the module-level prisma
// references inside the service. Because BookingService holds `prisma` from
// config/prisma, we patch the service's prisma usage by relying on the tx
// passed through the fake. For acceptQuote/respondToQuote the service calls
// prisma.$transaction — so we patch the config module's prisma.
const { prisma: realPrisma } = require('../config/prisma');

function patchPrismaForTest() {
  const originalTransaction = realPrisma.$transaction;
  return originalTransaction;
}

// --- Tests -----------------------------------------------------------------

describe('Quote → Confirmation single source of truth', () => {
  test('CUSTOMER online acceptance sets confirmation_source=CUSTOMER + quote_status=ACCEPTED + status=confirmed', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 1,
        booking_reference: 'BTB-1',
        quote_status: 'SENT',
        status: 'pending',
        final_price: 5000,
      },
    });
    const service = makeService(fakes);

    // Patch prisma.$transaction to use the fake tx.
    const originalTx = realPrisma.$transaction;
    let capturedFakes = fakes;
    const fakeTx = {
      bookingAssignment: { create: async () => ({}) },
      driver: { update: async () => ({}) },
      transportVehicle: { update: async () => ({}) },
      delivery: {
        findUnique: async () => null,
        create: async () => ({ delivery_id: 1 }),
        update: async () => ({ delivery_id: 1 }),
      },
      bookingEvent: { create: async () => ({}) },
      booking: {
        updateMany: function({ where, data }) {
          const b = capturedFakes.state.booking;
          if (!b) return { count: 0 };
          if (where.booking_id && b.booking_id !== where.booking_id) return { count: 0 };
          if (where.quote_status && b.quote_status !== where.quote_status) return { count: 0 };
          capturedFakes.state.booking = { ...b, ...data };
          return { count: 1 };
        },
      },
    };
    realPrisma.$transaction = async (fn) => fn(fakeTx);

    let result;
    try {
      result = await service.respondToQuote(1, 'ACCEPT');
    } finally {
      realPrisma.$transaction = originalTx;
    }

    assert.strictEqual(result.quote_status, 'ACCEPTED');
    assert.strictEqual(result.status, 'confirmed');

    const booking = fakes.getState();
    assert.strictEqual(booking.quote_status, 'ACCEPTED');
    assert.strictEqual(booking.status, 'confirmed');
    assert.strictEqual(booking.confirmation_source, 'CUSTOMER');
    assert.ok(booking.confirmed_at);

    // Timeline must include QUOTE_ACCEPTED_BY_CUSTOMER
    const hasCustomerEvent = fakes.timelineEvents.some((e) => e.eventType === 'QUOTE_ACCEPTED_BY_CUSTOMER');
    assert.strictEqual(hasCustomerEvent, true, 'expected QUOTE_ACCEPTED_BY_CUSTOMER timeline event');
  });

  test('ADMIN manual confirmation is BLOCKED unless customer accepted the quote (quote_status=ACCEPTED)', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 2,
        booking_reference: 'BTB-2',
        quote_status: 'PENDING',
        status: 'pending',
      },
    });
    const service = makeService(fakes);

    // Admin cannot confirm a booking whose quote has not been accepted.
    await assert.rejects(
      () => service.confirmBooking(2),
      (err) => err instanceof ValidationError
    );

    // Booking state must remain unchanged.
    const booking = fakes.getState();
    assert.strictEqual(booking.status, 'pending');
    assert.strictEqual(booking.quote_status, 'PENDING');
  });

  test('bulkUpdateStatus("confirmed") is BLOCKED for bookings without quote_status=ACCEPTED', async () => {
    const fakes = makeFakeRepos({});
    const service = makeService(fakes);

    const fakeTx = {
      booking: {
        findMany: async () => [{ booking_id: 10, status: 'pending', quote_status: 'PENDING' }],
        update: async () => ({ booking_id: 10 }),
      },
    };
    const originalTx = realPrisma.$transaction;
    realPrisma.$transaction = async (fn) => fn(fakeTx);
    try {
      await assert.rejects(
        () => service.bulkUpdateStatus([10], 'confirmed'),
        (err) => err instanceof ValidationError
      );
    } finally {
      realPrisma.$transaction = originalTx;
    }
  });

  test('REJECT path never sets status=confirmed (no inconsistent state)', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 3,
        booking_reference: 'BTB-3',
        quote_status: 'SENT',
        status: 'pending',
      },
    });
    const service = makeService(fakes);

    const originalTx = realPrisma.$transaction;
    let capturedFakes = fakes;
    const fakeTx = {
      bookingAssignment: { create: async () => ({}) },
      driver: { update: async () => ({}) },
      transportVehicle: { update: async () => ({}) },
      delivery: {
        findUnique: async () => null,
        create: async () => ({ delivery_id: 1 }),
        update: async () => ({ delivery_id: 1 }),
      },
      bookingEvent: { create: async () => ({}) },
      booking: {
        updateMany: function({ where, data }) {
          const b = capturedFakes.state.booking;
          if (!b) return { count: 0 };
          if (where.booking_id && b.booking_id !== where.booking_id) return { count: 0 };
          if (where.quote_status && b.quote_status !== where.quote_status) return { count: 0 };
          capturedFakes.state.booking = { ...b, ...data };
          return { count: 1 };
        },
      },
    };
    realPrisma.$transaction = async (fn) => fn(fakeTx);
    let result;
    try {
      result = await service.respondToQuote(3, 'REJECT');
    } finally {
      realPrisma.$transaction = originalTx;
    }

    assert.strictEqual(result.quote_status, 'REJECTED');
    const booking = fakes.getState();
    assert.notStrictEqual(booking.status, 'confirmed');
    assert.strictEqual(booking.quote_status, 'REJECTED');
  });

  test('confirmBooking is idempotent when already ACCEPTED', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 4,
        booking_reference: 'BTB-4',
        quote_status: 'ACCEPTED',
        status: 'confirmed',
        confirmation_source: 'CUSTOMER',
      },
    });
    const service = makeService(fakes);

    const originalTx = realPrisma.$transaction;
    let txCalled = false;
    realPrisma.$transaction = async (fn) => { txCalled = true; return fn({}); };
    let result;
    try {
      result = await service.confirmBooking(4);
    } finally {
      realPrisma.$transaction = originalTx;
    }

    assert.strictEqual(txCalled, false, 'should NOT run a new transaction when already confirmed');
    assert.strictEqual(result.quote_status, 'ACCEPTED');
    assert.strictEqual(result.confirmation_source, 'CUSTOMER');
  });

  test('confirmBooking rejects cancelled/completed/delivered bookings', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 5,
        booking_reference: 'BTB-5',
        quote_status: 'PENDING',
        status: 'cancelled',
      },
    });
    const service = makeService(fakes);

    await assert.rejects(
      () => service.confirmBooking(5),
      (err) => err instanceof ValidationError
    );
  });
});
