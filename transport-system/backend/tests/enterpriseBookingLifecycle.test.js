/**
 * Enterprise Booking Workflow — Full Lifecycle Tests
 *
 * Covers:
 *   1. Customer creates booking → status = PENDING
 *   2. Admin sends final quote (requires driver_id + vehicle_id)
 *   3. Customer rejects → status = REJECTED, reservations released
 *   4. Customer accepts → status = CONFIRMED, driver/vehicle locked,
 *      delivery row created, invoice created, assignment created
 *   5. Tracking page: driver info HIDDEN until quote accepted
 *   6. Driver lifecycle: confirmed → pickup_started → pickup_completed
 *      → in_transit → out_for_delivery → delivered → completed
 *
 * Uses node:test + node:assert (no extra deps). BookingService uses the
 * global prisma singleton from config/prisma, so we patch its methods
 * (findUnique / $transaction) per-test and restore them afterwards.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const BookingService = require('../services/BookingService');
const { prisma } = require('../config/prisma');
const {
  validateTransition,
  isTerminal,
  canSendQuote,
  canReject,
  canAssignDriver,
  canStartPickup,
  toDeliveryStatus,
} = require('../utils/BookingStateMachine');
const { ValidationError, NotFoundError } = require('../utils/AppError');

// --- Fake repositories -----------------------------------------------------

function makeFakeRepos(overrides = {}) {
  const timelineEvents = [];
  const releasedReservations = [];
  const state = {
    booking: overrides.initialBooking || null,
    activeReservation: overrides.activeReservation || null,
driver: overrides.driver || { driver_id: 1, is_available: true, vehicle_number: 'BR09AB1234', vehicle_type: 'pickup' },
    vehicle: overrides.vehicle || { vehicle_id: 1, driver_id: 1, is_available: true },
  };

const bookingRepo = {
    findById: async () => state.booking,
    // Canonical identifier lookup used by getBookingForTracking /
    // getBookingByIdentifier. Mirrors the real repository's
    // findByIdentifier (looks up by canonical booking_number OR legacy
    // booking_reference). Returns the full relation shape the mapper needs.
    findByIdentifier: async (identifier) => {
      if (!identifier) return null;
      const b = state.booking;
      if (!b) return null;
      const matches =
        b.booking_number === identifier ||
        b.booking_reference === identifier;
      if (!matches) return null;
      return {
        ...b,
        vehicle: b.vehicle || null,
        delivery: b.delivery || null,
        driver: b.trackingDriver || null,
        reservations: b.reservations || [],
        bookingEvents: b.bookingEvents || [],
      };
    },
    update: async (id, data) => {
      state.booking = { ...(state.booking || {}), ...data };
      return { changes: 1 };
    },
    create: async (data) => {
      state.booking = { booking_id: 1, ...data };
      return state.booking;
    },
  };

  const timelineRepo = {
    addEvent: async (bookingId, eventType, payload) => {
      timelineEvents.push({ bookingId, eventType, payload: payload ? JSON.parse(payload) : null });
      return { booking_event_id: timelineEvents.length };
    },
  };

  const reservationRepo = {
    getActiveByBooking: async () => state.activeReservation,
    convertAllActive: async () => 0,
    releaseAllActive: async (bookingId) => {
      releasedReservations.push(bookingId);
      state.activeReservation = null;
      return 1;
    },
    create: async (data) => {
      state.activeReservation = { reservation_id: 1, ...data };
      return state.activeReservation;
    },
  };

  const invoiceRepo = {
    create: async () => ({ invoice_id: 1 }),
  };

  return {
    bookingRepo,
    timelineRepo,
    reservationRepo,
    invoiceRepo,
    state,
    timelineEvents,
    releasedReservations,
    getState: () => state.booking,
    getActiveReservation: () => state.activeReservation,
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

/**
 * Patch the global prisma singleton so the service's DB calls resolve to
 * fakes. Returns a restore function.
 */
function patchPrisma(fakes) {
  const original = {
    $transaction: prisma.$transaction,
    driver_findUnique: prisma.driver && prisma.driver.findUnique,
    vehicle_findUnique: prisma.transportVehicle && prisma.transportVehicle.findUnique,
    booking_findUnique: prisma.booking && prisma.booking.findUnique,
    booking_findFirst: prisma.booking && prisma.booking.findFirst,
  };

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
    booking: {
      updateMany: async ({ where, data }) => {
        const b = fakes.state.booking;
        if (!b) return { count: 0 };
        // Simple fake: if where matches, apply data.
        if (where.booking_id && b.booking_id !== where.booking_id) return { count: 0 };
        if (where.quote_status && b.quote_status !== where.quote_status) return { count: 0 };
        fakes.state.booking = { ...b, ...data };
        return { count: 1 };
      },
    },
  };

  prisma.$transaction = async (fn) => fn(tx);
  if (prisma.driver) prisma.driver.findUnique = async () => fakes.state.driver;
  if (prisma.transportVehicle) prisma.transportVehicle.findUnique = async () => fakes.state.vehicle;
  if (prisma.booking) {
    prisma.booking.findUnique = async ({ where }) => {
      const b = fakes.state.booking;
      if (!b) return null;
      // Reconstruct the nested shape the tracking mapper expects.
      return {
        ...b,
        vehicle: b.vehicle || null,
        delivery: b.delivery || null,
        driver: b.trackingDriver || null,
        reservations: b.reservations || [],
        bookingEvents: b.bookingEvents || [],
      };
    };
    prisma.booking.findFirst = async ({ where }) => {
      const b = fakes.state.booking;
      if (!b) return null;
      // Simple fake: return the booking if it matches the where clause.
      if (where.driver_id && b.driver_id !== where.driver_id) return null;
      if (where.status && b.status !== where.status) return null;
      return b;
    };
  }

  return () => {
    prisma.$transaction = original.$transaction;
    if (prisma.driver) prisma.driver.findUnique = original.driver_findUnique;
    if (prisma.transportVehicle) prisma.transportVehicle.findUnique = original.vehicle_findUnique;
    if (prisma.booking) {
      prisma.booking.findUnique = original.booking_findUnique;
      prisma.booking.findFirst = original.booking_findFirst;
    }
  };
}

// --- State machine tests ---------------------------------------------------

describe('BookingStateMachine — enterprise lifecycle', () => {
  test('pending → quote_sent → confirmed → pickup_started → pickup_completed → in_transit → out_for_delivery → delivered → completed', () => {
    const lifecycle = [
      'pending',
      'quote_sent',
      'confirmed',
      'pickup_started',
      'pickup_completed',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'completed',
    ];

    for (let i = 0; i < lifecycle.length - 1; i++) {
      const from = lifecycle[i];
      const to = lifecycle[i + 1];
      assert.doesNotThrow(() => validateTransition(from, to), `Expected valid transition: ${from} → ${to}`);
    }
  });

  test('pending → quote_sent → rejected is terminal', () => {
    validateTransition('pending', 'quote_sent');
    validateTransition('quote_sent', 'rejected');
    assert.strictEqual(isTerminal('rejected'), true);
    assert.strictEqual(canReject('quote_sent'), true);
    assert.strictEqual(canSendQuote('pending'), true);
  });

test('quote_sent → confirmed requires customer ACCEPTED quote', () => {
    // canAssignDriver guards the transition INTO confirmed. A booking can only
    // be confirmed once the quote_status is ACCEPTED.
    assert.strictEqual(canAssignDriver('quote_sent', 'PENDING'), false);
    assert.strictEqual(canAssignDriver('quote_sent', 'SENT'), false);
    assert.strictEqual(canAssignDriver('quote_sent', 'ACCEPTED'), true);
  });

  test('driver cannot start pickup unless booking is confirmed', () => {
    assert.strictEqual(canStartPickup('quote_sent'), false);
    assert.strictEqual(canStartPickup('confirmed'), true);
  });

  test('toDeliveryStatus maps new statuses correctly', () => {
    assert.strictEqual(toDeliveryStatus('confirmed'), 'booking_confirmed');
    assert.strictEqual(toDeliveryStatus('pickup_started'), 'pickup_in_progress');
    assert.strictEqual(toDeliveryStatus('pickup_completed'), 'pickup_completed');
    assert.strictEqual(toDeliveryStatus('in_transit'), 'in_transit');
    assert.strictEqual(toDeliveryStatus('out_for_delivery'), 'out_for_delivery');
    assert.strictEqual(toDeliveryStatus('delivered'), 'delivered');
  });
});

// --- BookingService lifecycle ----------------------------------------------

describe('BookingService — enterprise lifecycle', () => {
test('sendQuoteWithReservation requires driver_id; vehicle is auto-resolved from driver', async () => {
    const makeFakes = (driverOverrides) => makeFakeRepos({
      initialBooking: {
        booking_id: 1,
        booking_reference: 'BTB-1',
        quote_status: 'PENDING',
        status: 'pending',
      },
      driver: driverOverrides,
    });

    // 1. driver_id is REQUIRED — sending without it must be rejected.
    {
      const fakes = makeFakes({ driver_id: 1, is_available: true, vehicle_number: 'BR09AB1234' });
      const service = makeService(fakes);
      const restore = patchPrisma(fakes);
      try {
        await assert.rejects(
          () => service.sendQuoteWithReservation(1, { final_price: 5000, vehicle_id: 1 }),
          (err) => err instanceof ValidationError
        );
      } finally {
        restore();
      }
    }

    // 2. Driver selected but has NO active vehicle (no vehicle_number) → rejected.
    {
      const fakes = makeFakes({ driver_id: 1, is_available: true, vehicle_number: null });
      const service = makeService(fakes);
      const restore = patchPrisma(fakes);
      try {
        await assert.rejects(
          () => service.sendQuoteWithReservation(1, { final_price: 5000, driver_id: 1 }),
          (err) => err instanceof ValidationError
        );
      } finally {
        restore();
      }
    }

    // 3. final_price is REQUIRED → rejected.
    {
      const fakes = makeFakes({ driver_id: 1, is_available: true, vehicle_number: 'BR09AB1234' });
      const service = makeService(fakes);
      const restore = patchPrisma(fakes);
      try {
        await assert.rejects(
          () => service.sendQuoteWithReservation(1, { driver_id: 1 }),
          (err) => err instanceof ValidationError
        );
      } finally {
        restore();
      }
    }

    // 4. driver_id only (no explicit vehicle_id) → SUCCEEDS when the driver has
    //    an active vehicle. The current vehicle is auto-resolved from the driver.
    {
      const fakes = makeFakes({ driver_id: 1, is_available: true, vehicle_number: 'BR09AB1234', vehicle_type: 'pickup' });
      const service = makeService(fakes);
      const restore = patchPrisma(fakes);
      let result;
      try {
        result = await service.sendQuoteWithReservation(1, { final_price: 5000, driver_id: 1 });
      } finally {
        restore();
      }
      assert.strictEqual(result.driver_id, 1);
      assert.strictEqual(result.quote_status, 'SENT');
      assert.strictEqual(result.status, 'quote_sent');
    }
  });

  test('sendQuoteWithReservation sets status=quote_sent, creates reservation, updates timeline', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 2,
        booking_reference: 'BTB-2',
        quote_status: 'PENDING',
        status: 'pending',
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    let result;
    try {
      result = await service.sendQuoteWithReservation(2, {
        final_price: 6500,
        driver_id: 1,
        vehicle_id: 1,
        remarks: 'Final quote for city-to-city move',
        quote_validity_hours: 2,
      });
    } finally {
      restore();
    }

    assert.strictEqual(result.quote_status, 'SENT');
    assert.strictEqual(result.status, 'quote_sent');
    assert.strictEqual(result.driver_id, 1);
    assert.strictEqual(result.vehicle_id, 1);
    assert.strictEqual(result.final_price, 6500);
    assert.ok(result.quote_valid_until);

    const booking = fakes.getState();
    assert.strictEqual(booking.status, 'quote_sent');
    assert.strictEqual(booking.quote_status, 'SENT');
    assert.strictEqual(booking.quote_remarks, 'Final quote for city-to-city move');

    const reservation = fakes.getActiveReservation();
    assert.ok(reservation);
    assert.strictEqual(reservation.driver_id, 1);
    assert.strictEqual(reservation.vehicle_id, 1);
    assert.strictEqual(reservation.status, 'ACTIVE');

    const hasQuoteSent = fakes.timelineEvents.some((e) => e.eventType === 'quote_sent');
    assert.strictEqual(hasQuoteSent, true, 'expected quote_sent timeline event');
  });

  test('Customer REJECTS quote → status=rejected, reservations released, driver/vehicle available again', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 3,
        booking_reference: 'BTB-3',
        quote_status: 'SENT',
        status: 'quote_sent',
        final_price: 6500,
        quote_valid_until: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
      activeReservation: {
        reservation_id: 1,
        booking_id: 3,
        driver_id: 1,
        vehicle_id: 1,
        status: 'ACTIVE',
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    let result;
    try {
      result = await service.respondToQuote(3, 'REJECT');
    } finally {
      restore();
    }

    assert.strictEqual(result.quote_status, 'REJECTED');
    assert.strictEqual(result.status, 'rejected');

    const booking = fakes.getState();
    assert.strictEqual(booking.status, 'rejected');
    assert.strictEqual(booking.quote_status, 'REJECTED');
    assert.ok(booking.quote_rejected_at);

    assert.strictEqual(fakes.releasedReservations.length, 1);
    assert.strictEqual(fakes.releasedReservations[0], 3);
    assert.strictEqual(fakes.getActiveReservation(), null);

    const hasRejected = fakes.timelineEvents.some((e) => e.eventType === 'quote_rejected');
    assert.strictEqual(hasRejected, true, 'expected quote_rejected timeline event');
  });

  test('Customer ACCEPTS quote → status=confirmed, driver locked, delivery+invoice+assignment created', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 4,
        booking_reference: 'BTB-4',
        quote_status: 'SENT',
        status: 'quote_sent',
        final_price: 6500,
        quote_valid_until: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
      activeReservation: {
        reservation_id: 1,
        booking_id: 4,
        driver_id: 1,
        vehicle_id: 1,
        status: 'ACTIVE',
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    let result;
    try {
      result = await service.respondToQuote(4, 'ACCEPT');
    } finally {
      restore();
    }

    assert.strictEqual(result.quote_status, 'ACCEPTED');
    assert.strictEqual(result.status, 'confirmed');
    assert.strictEqual(result.driver_id, 1);
    assert.strictEqual(result.vehicle_id, 1);
    assert.ok(result.invoice_number);

    const booking = fakes.getState();
    assert.strictEqual(booking.status, 'confirmed');
    assert.strictEqual(booking.quote_status, 'ACCEPTED');
    assert.strictEqual(booking.confirmation_source, 'CUSTOMER');
    assert.strictEqual(booking.driver_id, 1);
    assert.strictEqual(booking.vehicle_id, 1);
    assert.ok(booking.confirmed_at);

    const hasConfirmed = fakes.timelineEvents.some((e) => e.eventType === 'booking_confirmed');
    assert.strictEqual(hasConfirmed, true, 'expected booking_confirmed timeline event');
    const hasAccepted = fakes.timelineEvents.some((e) => e.eventType === 'quote_accepted');
    assert.strictEqual(hasAccepted, true, 'expected quote_accepted timeline event');
    const hasCustomerEvent = fakes.timelineEvents.some((e) => e.eventType === 'QUOTE_ACCEPTED_BY_CUSTOMER');
    assert.strictEqual(hasCustomerEvent, true, 'expected QUOTE_ACCEPTED_BY_CUSTOMER timeline event');
  });

  test('Tracking page: driver info HIDDEN until quote accepted (booking status=quote_sent)', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 5,
        booking_reference: 'BTB-5',
        quote_status: 'SENT',
        status: 'quote_sent',
        final_price: 6500,
        quote_remarks: 'Final quote',
        quote_valid_until: new Date(Date.now() + 2 * 60 * 60 * 1000),
        driver_id: 1,
        vehicle_id: 1,
        driver_name_snapshot: null,
        mobile_snapshot: null,
        truck_number_snapshot: null,
        partner_name_snapshot: null,
        trackingDriver: {
          driver_id: 1,
          rating: 4.5,
          total_deliveries: 10,
          user: { first_name: 'Rahul', last_name: 'Kumar', phone: '9876543210' },
        },
        vehicle: { vehicle_id: 1, vehicle_number: 'BR31PA1234', vehicle_name: 'Tata Ace', vehicle_type: 'mini_truck' },
        delivery: { current_status: null, status_description: null },
        reservations: [
          {
            reservation_id: 1,
            booking_id: 5,
            driver_id: 1,
            vehicle_id: 1,
            status: 'ACTIVE',
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
            driver: {
              driver_id: 1,
              driver_name: 'Rahul Kumar',
              mobile: '9876543210',
              rating: 4.5,
              profile_image: null,
            },
            vehicle: {
              vehicle_id: 1,
              vehicle_number: 'BR31PA1234',
              vehicle_name: 'Tata Ace',
              vehicle_type: 'mini_truck',
            },
          },
        ],
        bookingEvents: [],
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    let data;
    try {
      data = await service.getBookingForTracking('BTB-5');
    } finally {
      restore();
    }

    // Driver info must NOT be visible before acceptance
    assert.strictEqual(data.driver, null, 'driver info must be hidden before acceptance');
    assert.strictEqual(data.driver_id, null, 'driver_id must be null before acceptance');
    assert.strictEqual(data.vehicle_id, null, 'vehicle_id must be null before acceptance');
    assert.strictEqual(data.vehicle_number, null, 'vehicle_number must be null before acceptance');
    assert.strictEqual(data.reservation, null, 'reservation must be hidden before acceptance');

    // But driver_quote object IS available for the Accept/Reject UI
    assert.ok(data.driver_quote, 'driver_quote should be present for quote card');
    assert.strictEqual(data.driver_quote.driver_name, 'Rahul Kumar');
    assert.strictEqual(data.driver_quote.driver_phone, '9876543210');
    assert.strictEqual(data.driver_quote.vehicle_number, 'BR31PA1234');
    assert.strictEqual(data.driver_quote.vehicle_type, 'mini_truck');
    assert.strictEqual(data.driver_quote.final_price, 6500);
    assert.strictEqual(data.driver_quote.remarks, 'Final quote');
  });

  test('Tracking page: driver info VISIBLE after quote accepted (status=confirmed)', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 6,
        booking_reference: 'BTB-6',
        quote_status: 'ACCEPTED',
        status: 'confirmed',
        final_price: 6500,
        confirmation_source: 'CUSTOMER',
        driver_id: 1,
        vehicle_id: 1,
        driver_name_snapshot: null,
        mobile_snapshot: null,
        truck_number_snapshot: null,
        partner_name_snapshot: null,
        trackingDriver: {
          driver_id: 1,
          rating: 4.5,
          total_deliveries: 10,
          user: { first_name: 'Rahul', last_name: 'Kumar', phone: '9876543210' },
        },
        vehicle: { vehicle_id: 1, vehicle_number: 'BR31PA1234', vehicle_name: 'Tata Ace', vehicle_type: 'mini_truck' },
        delivery: { current_status: 'booking_confirmed', status_description: 'Booking confirmed' },
        reservations: [],
        bookingEvents: [],
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    let data;
    try {
      data = await service.getBookingForTracking('BTB-6');
    } finally {
      restore();
    }

    assert.ok(data.driver, 'driver info should be visible after acceptance');
    assert.strictEqual(data.driver.first_name, 'Rahul');
    assert.strictEqual(data.driver.phone, '9876543210');
    assert.strictEqual(data.driver_id, 1);
    assert.strictEqual(data.vehicle_id, 1);
    assert.strictEqual(data.vehicle_number, 'BR31PA1234');
    assert.strictEqual(data.vehicle_type, 'mini_truck');
  });

  test('Full lifecycle: pending → quote_sent → confirmed → pickup_started → pickup_completed → in_transit → out_for_delivery → delivered → completed', async () => {
    const fakes = makeFakeRepos({
      initialBooking: {
        booking_id: 7,
        booking_reference: 'BTB-7',
        quote_status: 'PENDING',
        status: 'pending',
      },
    });
    const service = makeService(fakes);
    const restore = patchPrisma(fakes);

    try {
      // 1. Admin sends quote
      await service.sendQuoteWithReservation(7, {
        final_price: 8000,
        driver_id: 1,
        vehicle_id: 1,
      });
      assert.strictEqual(fakes.getState().status, 'quote_sent');
      assert.strictEqual(fakes.getState().quote_status, 'SENT');

      // 2. Customer accepts
      await service.respondToQuote(7, 'ACCEPT');
      assert.strictEqual(fakes.getState().status, 'confirmed');
      assert.strictEqual(fakes.getState().quote_status, 'ACCEPTED');
      assert.strictEqual(fakes.getState().confirmation_source, 'CUSTOMER');

      // 3. Driver updates status through full lifecycle
      const lifecycle = [
        'pickup_started',
        'pickup_completed',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'completed',
      ];

      for (const nextStatus of lifecycle) {
        const current = fakes.getState().status;
        validateTransition(current, nextStatus);
        await service.updateBooking(7, { status: nextStatus });
        assert.strictEqual(fakes.getState().status, nextStatus);
      }

      assert.strictEqual(isTerminal('completed'), true);
} finally {
      restore();
    }
  });
});
