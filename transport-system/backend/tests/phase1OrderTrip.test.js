/**
 * phase1OrderTrip.test.js
 * ---------------------------------------------------------------------------
 * PHASE 1 — ENQUIRY → QUOTATION → CUSTOMER ACCEPTANCE → ORDER / TRIP
 * ---------------------------------------------------------------------------
 *
 * Source of truth for this workflow:
 *
 *   ENQUIRY
 *     → GIVE RATE
 *       → ORDER CONFIRMED
 *         → OPERATIONAL TRIP
 *
 * These tests lock the invariants that make that chain true ON THE SERVER, with
 * no database (an in-memory Prisma mock, the same technique already used by
 * tests/tripDoubleBooking.test.js):
 *
 *   A. ENQUIRY INTAKE
 *      1.  An enquiry is created and starts at ENQUIRY_SUBMITTED.
 *      2.  The canonical enquiry number is server-derived, never client-supplied.
 *
 *   B. QUOTATION
 *      3.  A quote is saved as a DRAFT — the customer cannot see it yet.
 *      4.  A quote cannot be sent to the customer without vehicle + driver.
 *      5.  Sending the quote moves the enquiry to AWAITING_CUSTOMER_ACCEPTANCE.
 *
 *   C. CUSTOMER ACCEPTANCE
 *      6.  Acceptance without a final quote is rejected.
 *      7.  Acceptance before the quote was sent is rejected.
 *      8.  Acceptance creates the canonical Booking EXACTLY ONCE.
 *      9.  A duplicate acceptance is an idempotent no-op (never a 2nd booking).
 *      10.  The agreed price comes from the DATABASE, never from the request body.
 *      11.  The enquiry survives acceptance and stays linked to the Booking.
 *      12.  Acceptance writes its timeline/audit events.
 *      13.  A guest accepts through the scoped enquiry token; a token minted for
 *          a DIFFERENT enquiry is refused; no credential at all is refused.
 *      14.  A failed booking creation releases the claim so the customer can retry.
 *
 *   D. REJECTION
 *      15.  A rejected quote never produces a Booking and never confirms an order.
 *
 *   E. ORDER → TRIP (the operational record)
 *      16.  A trip cannot be created for an order whose quote was not accepted.
 *      17.  A trip cannot be created for an unknown order.
 *      18.  A trip is created EXACTLY ONCE per order; a repeat returns the same trip.
 *      19.  The draft preserves the required operational fields from the real row.
 *      20.  The draft carries the enquiry linkage, and the trip body carries only
 *          real `Trip` columns (a stray key would make Prisma reject the request).
 *      21.  A standalone (non-booking) trip is unaffected by the order guards.
 *
 * Uses node:test + node:assert (no extra deps, no live database).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase1-order-trip-test-secret';
process.env.CUSTOMER_CARE_PHONE = process.env.CUSTOMER_CARE_PHONE || '9876543210';
process.env.CUSTOMER_CARE_WHATSAPP = process.env.CUSTOMER_CARE_WHATSAPP || '9876543210';
process.env.CUSTOMER_CARE_NAME = process.env.CUSTOMER_CARE_NAME || 'Bihar Transport Customer Care';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AppError, ValidationError, NotFoundError, ConflictError,
} = require('../utils/AppError');

// ===========================================================================
// In-memory Prisma mock
// ===========================================================================

function makeDb() {
  return {
    enquiries: [],
    events: [],
    bookings: [],
    trips: [],
    users: [],
    seq: { enquiry: 1, event: 1, booking: 1, trip: 1, user: 1 },
  };
}

let db = makeDb();

const OWNER_ID = 10;
const VEHICLE_ID = 100;
const DRIVER_ID = 200;
const CUSTOMER_PHONE = '9876500011';

function reset() {
  db = makeDb();
}

function matches(where, row) {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND' || key === 'OR') return true;
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      // Prisma operator form, e.g. { in: [...] } / { startsWith: '…' }
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('startsWith' in cond) return String(row[key] || '').startsWith(cond.startsWith);
      if ('gte' in cond) return new Date(row[key]) >= new Date(cond.gte);
      return row[key] === cond;
    }
    return row[key] === cond;
  });
}

function findById(rows, where, key) {
  const value = where[key];
  return rows.find((r) => String(r[key]) === String(value)) || null;
}

function makePrisma() {
  const tx = {
    enquiry: {
      create: async ({ data }) => {
        const row = {
          enquiry_id: db.seq.enquiry++,
          enquiry_number: null,
          status: 'ENQUIRY_SUBMITTED',
          price_status: 'NOT_QUOTED',
          accepted_at: null,
          rejected_at: null,
          confirmed_at: null,
          cancelled_at: null,
          final_quoted_price: null,
          quoted_at: null,
          quoted_by_admin_id: null,
          quote_remarks: null,
          booking_id: null,
          assigned_vehicle_id: null,
          assigned_driver_id: null,
          assigned_partner_id: null,
          assigned_owner_id: null,
          assigned_vehicle_number: null,
          assigned_vehicle_type: null,
          assigned_driver_name: null,
          created_at: new Date(),
          ...data,
        };
        db.enquiries.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = findById(db.enquiries, where, 'enquiry_id');
        if (!row) throw new NotFoundError({ message: 'Enquiry not found' });
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const rows = db.enquiries.filter((r) => matches(where, r));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      findUnique: async ({ where }) => {
        const row = where.enquiry_id !== undefined
          ? findById(db.enquiries, where, 'enquiry_id')
          : db.enquiries.find((r) => r.enquiry_number === where.enquiry_number) || null;
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }) => {
        const row = db.enquiries.find((r) => matches(where, r));
        return row ? { ...row } : null;
      },
    },

    enquiryEvent: {
      create: async ({ data }) => {
        const row = { enquiry_event_id: db.seq.event++, customer_visible: true, created_at: new Date(), ...data };
        db.events.push(row);
        return row;
      },
      findMany: async ({ where } = {}) => {
        const rows = where ? db.events.filter((e) => matches(where, e)) : db.events;
        return rows.slice().sort((a, b) => b.enquiry_event_id - a.enquiry_event_id);
      },
    },

    user: {
      findUnique: async ({ where }) => {
        let row = null;
        if (where.user_id !== undefined) row = db.users.find((u) => u.user_id === where.user_id) || null;
        else if (where.phone !== undefined) row = db.users.find((u) => u.phone === where.phone) || null;
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { user_id: db.seq.user++, role: 'customer', is_active: true, ...data };
        db.users.push(row);
        return { ...row };
      },
    },

    booking: {
      findUnique: async ({ where }) => {
        const row = findById(db.bookings, where, 'booking_id');
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { booking_id: db.seq.booking++, ...data };
        db.bookings.push(row);
        return { ...row };
      },
    },

    trip: {
      findFirst: async ({ where }) => {
        const row = db.trips.find((t) => matches(where, t));
        if (!row) return null;
        return { ...row };
      },
      findUnique: async ({ where }) => {
        const row = findById(db.trips, where, 'trip_id');
        return row ? { ...row } : null;
      },
      create: async ({ data }) => {
        const row = { trip_id: db.seq.trip++, ...data };
        db.trips.push(row);
        return { ...row };
      },
      // Customer acceptance binds a pre-acceptance RESERVATION trip to the
      // Booking it has just created, so the consignment has exactly one
      // operational trip for the rest of its life (see
      // EnquiryService.customerAccept).
      update: async ({ where, data }) => {
        const row = findById(db.trips, where, 'trip_id');
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const rows = db.trips.filter((t) => matches(where, t));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      },
    },

    driver: {
      findUnique: async ({ where }) => ({
        driver_id: where.driver_id,
        driver_name: 'Raj Kumar',
        transport_owner_id: OWNER_ID,
      }),
    },

    transportVehicle: {
      findUnique: async ({ where }) => {
        const row = {
          vehicle_id: where.vehicle_id,
          vehicle_name: '17 ft Truck',
          vehicle_type: 'TRUCK',
          vehicle_number: 'BR01AB1234',
          owner_id: OWNER_ID,
        };
        return where.vehicle_id === VEHICLE_ID ? row : null;
      },
    },

    vehicleOwner: {
      findUnique: async ({ where }) => (where.owner_id === OWNER_ID
        ? { owner_id: OWNER_ID, owner_name: 'Bihar Transport', owner_type: 'TRANSPORT_COMPANY' }
        : null),
    },

    client: { findUnique: async () => null },
    auditLog: { create: async () => ({ audit_id: 1 }) },

    $transaction: async (fnOrArray) => {
      if (typeof fnOrArray === 'function') return fnOrArray(tx);
      return Promise.all(fnOrArray);
    },
    $executeRaw: async () => undefined,
    $queryRaw: async () => [],
  };

  return tx;
}

// The single mock instance every layer shares. `reset()` swaps the DATA, not the
// client, so a service that captured this object at module load keeps working.
const prisma = makePrisma();

// Inject the mock BEFORE any service module is required, because TripService,
// BookingService and EnquiryService all capture `prisma` at module load.
const prismaPath = require.resolve('../config/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma },
};

const { EnquiryService } = require('../services/EnquiryService');
const BookingService = require('../services/BookingService');
const TripService = require('../services/TripService');
const { issueEnquiryAccessToken } = require('../utils/EnquiryAccessToken');
const EnquiryStateMachine = require('../utils/EnquiryStateMachine');

// ===========================================================================
// Service doubles
// ===========================================================================

/** A silent realtime double — Phase 1 asserts DB state, never socket pushes. */
const silentRealtime = {
  emitEnquiryToAdmins() {},
  emitToEnquiry: async () => {},
  emitToDriver() {},
  emitToPartner() {},
};

/** Records every addEvent call, honouring the transaction handle it is given. */
function makeEventsSpy() {
  return {
    calls: [],
    async addEvent(params, tx) {
      this.calls.push({ ...params, hadTx: Boolean(tx) });
      const client = tx || prisma;
      return client.enquiryEvent.create({ data: { ...params, enquiry_id: params.enquiryId } });
    },
    async listEvents() { return []; },
  };
}

/**
 * A BookingService double that behaves like the real one for the parts Phase 1
 * asserts on: it creates exactly one row per call and echoes the SERVER price.
 * `failNext` simulates a transient booking failure so the claim-release path
 * can be exercised.
 */
function makeBookingServiceSpy() {
  const spy = {
    created: [],
    failNext: false,
    async createBooking(input) {
      if (spy.failNext) throw new Error('simulated booking failure');
      const row = {
        booking_id: db.seq.booking++,
        booking_number: `BTB-2026-${String(db.bookings.length + 1).padStart(5, '0')}`,
        final_price: input.final_price,
        quote_status: input.quote_status,
        status: input.status,
        confirmation_source: input.confirmation_source,
        ...input,
      };
      db.bookings.push(row);
      spy.created.push(row);
      return { booking_id: row.booking_id, booking_number: row.booking_number };
    },
  };
  return spy;
}

function makeEnquiryService(overrides = {}) {
  return new EnquiryService({
    prisma,
    bookingService: overrides.bookingService || makeBookingServiceSpy(),
    events: overrides.events || makeEventsSpy(),
    realtime: silentRealtime,
  });
}

const ADMIN = { adminId: 1, adminName: 'Ops Admin' };

// ===========================================================================
// Fixtures / helpers
// ===========================================================================

/** A future pickup date, so createEnquiry's "no past dates" rule is satisfied. */
function futureDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function enquiryPayload(overrides = {}) {
  return {
    customer_name: 'Ramesh Kumar',
    customer_mobile: CUSTOMER_PHONE,
    pickup_location: 'Begusarai',
    drop_location: 'Patna',
    pickup_date: futureDate().toISOString().slice(0, 10),
    pickup_time: '10:00',
    requested_vehicle_name: '17 ft Truck',
    material: 'Cement',
    quantity: 40,
    weight: 8,
    weight_unit: 'Tons',
    ...overrides,
  };
}

/** Seeds an enquiry row directly, bypassing intake, for the later-stage tests. */
function seedEnquiry(overrides = {}) {
  const row = {
    enquiry_id: db.seq.enquiry++,
    enquiry_number: `BTB-20260929-${String(db.seq.enquiry).padStart(6, '0')}`,
    customer_id: null,
    customer_name: 'Ramesh Kumar',
    customer_mobile: CUSTOMER_PHONE,
    customer_email: null,
    session_key: null,
    pickup_location: 'Begusarai',
    pickup_address: null,
    drop_location: 'Patna',
    drop_address: null,
    distance_km: 120,
    requested_vehicle_id: null,
    requested_vehicle_name: '17 ft Truck',
    assigned_vehicle_id: VEHICLE_ID,
    assigned_driver_id: DRIVER_ID,
    assigned_partner_id: null,
    assigned_owner_id: OWNER_ID,
    assigned_vehicle_number: 'BR01AB1234',
    assigned_vehicle_type: '17 ft Truck',
    assigned_driver_name: 'Raj Kumar',
    material: 'Cement',
    quantity: 40,
    quantity_unit: 'Bags',
    weight: 8,
    weight_unit: 'Tons',
    goods_category: 'Construction',
    fragile: false,
    special_instructions: 'Call before unloading',
    pickup_date: new Date('2026-10-05T00:00:00.000Z'),
    pickup_time: '10:00:00',
    estimated_price_min: 9000,
    estimated_price_max: 11000,
    final_quoted_price: null,
    price_status: 'NOT_QUOTED',
    quote_remarks: null,
    quoted_by_admin_id: null,
    quoted_at: null,
    status: 'ENQUIRY_SUBMITTED',
    accepted_at: null,
    rejected_at: null,
    cancelled_at: null,
    confirmed_at: null,
    booking_id: null,
    created_at: new Date(),
    ...overrides,
  };
  db.enquiries.push(row);
  return row;
}

/** Puts an enquiry in the only state from which a customer may accept. */
function seedAwaitingAcceptance(overrides = {}) {
  return seedEnquiry({
    status: 'AWAITING_CUSTOMER_ACCEPTANCE',
    price_status: 'SENT',
    final_quoted_price: 10000,
    quoted_at: new Date(),
    quoted_by_admin_id: ADMIN.adminId,
    ...overrides,
  });
}

function guestCtx(enquiryId) {
  return { enquiryToken: issueEnquiryAccessToken({ enquiryId, enquiryNumber: 'TEST' }).token };
}

const tripPayload = (overrides = {}) => ({
  user_id: 300,
  source_type: 'ONLINE_BOOKING',
  transport_owner_id: OWNER_ID,
  vehicle_id: VEHICLE_ID,
  driver_id: DRIVER_ID,
  pickup_location: 'Begusarai',
  pickup_city: 'Begusarai',
  drop_location: 'Patna',
  drop_city: 'Patna',
  freight_amount: 10000,
  ...overrides,
});

/** The online customer who owns the order. ONLINE_BOOKING trips require it. */
function seedCustomer(overrides = {}) {
  const row = {
    user_id: 300,
    first_name: 'Ramesh',
    last_name: 'Kumar',
    phone: CUSTOMER_PHONE,
    email: 'ramesh@example.com',
    role: 'customer',
    is_active: true,
    ...overrides,
  };
  if (!db.users.some((u) => u.user_id === row.user_id)) db.users.push(row);
  return row;
}

/** An order row that represents an accepted, confirmed booking. */
function seedAcceptedBooking(overrides = {}) {
  seedCustomer();
  const row = {
    booking_id: db.seq.booking++,
    booking_number: 'BTB-2026-00001',
    booking_reference: 'BTB-2026-00001',
    user_id: 300,
    driver_id: DRIVER_ID,
    vehicle_id: VEHICLE_ID,
    vehicle_owner_id: OWNER_ID,
    partner_id: null,
    pickup_location: 'Begusarai',
    pickup_city: 'Begusarai',
    drop_location: 'Patna',
    drop_city: 'Patna',
    pickup_date: '2026-10-05',
    estimated_distance_km: 120,
    final_price: 10000,
    status: 'confirmed',
    quote_status: 'ACCEPTED',
    confirmation_source: 'CUSTOMER',
    special_instructions: 'Call before unloading',
    quote_remarks: null,
    ...overrides,
  };
  db.bookings.push(row);
  return row;
}

// ===========================================================================
// A. ENQUIRY INTAKE
// ===========================================================================

test('PHASE 1 · 1-2  create enquiry: persisted, canonical number, ENQUIRY_SUBMITTED', async () => {
  reset();
  const events = makeEventsSpy();
  const service = makeEnquiryService({ events });

  const { enquiry } = await service.createEnquiry(enquiryPayload(), {});

  assert.equal(enquiry.status, 'ENQUIRY_SUBMITTED');
  assert.match(enquiry.enquiry_number, /^BTB-\d{8}-\d{6}$/);
  assert.equal(enquiry.price_status, 'NOT_QUOTED');
  assert.equal(enquiry.final_quoted_price, null);
  assert.equal(db.enquiries.length, 1);
  assert.ok(
    events.calls.some((c) => c.eventType === 'ENQUIRY_CREATED'),
    'an ENQUIRY_CREATED audit event must be written inside the creating transaction'
  );
  assert.ok(
    events.calls.find((c) => c.eventType === 'ENQUIRY_CREATED').hadTx,
    'the ENQUIRY_CREATED event must be written in the same transaction as the row'
  );
});

test('PHASE 1 · create enquiry rejects an incomplete request', async () => {
  reset();
  const service = makeEnquiryService();
  await assert.rejects(
    () => service.createEnquiry({ customer_name: 'X' }, {}),
    (err) => err instanceof ValidationError
  );
  assert.equal(db.enquiries.length, 0);
});

// ===========================================================================
// B. QUOTATION
// ===========================================================================

test('PHASE 1 · 3  a saved quote is a DRAFT the customer cannot see yet', async () => {
  reset();
  const events = makeEventsSpy();
  const service = makeEnquiryService({ events });
  const enquiry = seedEnquiry({ status: 'DRIVER_ASSIGNED' });

  const quoted = await service.adminSetQuote(enquiry.enquiry_id, { final_price: 10000 }, ADMIN);

  assert.equal(quoted.final_quoted_price, 10000);
  assert.equal(quoted.price_status, 'QUOTED');
  assert.equal(quoted.quoted_at, null, 'quoted_at is stamped when the quote is SENT, not typed');
  assert.equal(
    EnquiryStateMachine.isQuoteVisibleToCustomer(quoted.status),
    false,
    'a draft quote must not be customer-visible'
  );
  const draftEvent = events.calls.find((c) => c.eventType === 'QUOTE_CREATED');
  assert.equal(draftEvent.customerVisible, false, 'the draft event stays off the customer timeline');
});

test('PHASE 1 · 4  a quote cannot be sent without vehicle AND driver', async () => {
  reset();
  const service = makeEnquiryService();
  const enquiry = seedEnquiry({ status: 'QUOTE_READY', final_quoted_price: 10000, assigned_driver_id: null });

  await assert.rejects(
    () => service.adminSendQuote(enquiry.enquiry_id, ADMIN),
    (err) => err instanceof ValidationError && /driver/i.test(err.message)
  );
  assert.equal(
    db.enquiries.find((e) => e.enquiry_id === enquiry.enquiry_id).status,
    'QUOTE_READY',
    'a refused send must not move the enquiry'
  );
});

test('PHASE 1 · 5  sending the quote moves the enquiry to AWAITING_CUSTOMER_ACCEPTANCE', async () => {
  reset();
  const events = makeEventsSpy();
  const service = makeEnquiryService({ events });
  const enquiry = seedEnquiry({ status: 'QUOTE_READY', final_quoted_price: 10000, price_status: 'QUOTED' });

  const sent = await service.adminSendQuote(enquiry.enquiry_id, ADMIN);

  assert.equal(sent.enquiry.status, 'AWAITING_CUSTOMER_ACCEPTANCE');
  assert.equal(sent.enquiry.price_status, 'SENT');
  assert.ok(sent.enquiry.quoted_at);
  assert.equal(sent.alreadySent, false);
  assert.ok(events.calls.some((c) => c.eventType === 'QUOTE_SENT'));

  // Idempotent: a double-clicked Send never republishes.
  const again = await service.adminSendQuote(enquiry.enquiry_id, ADMIN);
  assert.equal(again.alreadySent, true);
});

// ===========================================================================
// C. CUSTOMER ACCEPTANCE
// ===========================================================================

test('PHASE 1 · 6  acceptance without a final quote is rejected', async () => {
  reset();
  const bookingService = makeBookingServiceSpy();
  const service = makeEnquiryService({ bookingService });
  const enquiry = seedAwaitingAcceptance({ final_quoted_price: null });

  await assert.rejects(
    () => service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id)),
    (err) => err instanceof ConflictError
  );
  assert.equal(bookingService.created.length, 0, 'no booking may be created without a quote');
  assert.equal(db.bookings.length, 0);
});

test('PHASE 1 · 7  acceptance before the quote was sent is rejected', async () => {
  reset();
  const bookingService = makeBookingServiceSpy();
  const service = makeEnquiryService({ bookingService });
  const enquiry = seedEnquiry({ status: 'QUOTE_READY', final_quoted_price: 10000, price_status: 'QUOTED' });

  await assert.rejects(
    () => service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id)),
    (err) => err instanceof ConflictError && /not awaiting/i.test(err.message)
  );
  assert.equal(bookingService.created.length, 0);
});

test('PHASE 1 · 8,10,11,12  acceptance creates exactly one Booking from the DATABASE price', async () => {
  reset();
  const events = makeEventsSpy();
  const bookingService = makeBookingServiceSpy();
  const service = makeEnquiryService({ bookingService, events });
  const enquiry = seedAwaitingAcceptance({ final_quoted_price: 12345 });

  // A malicious client posting its own price must not be able to change anything.
  const result = await service.customerAccept(enquiry.enquiry_id, {
    ...guestCtx(enquiry.enquiry_id),
    final_price: 1,
    price: 1,
  });

  // 8 — exactly one booking
  assert.equal(bookingService.created.length, 1);
  assert.equal(db.bookings.length, 1);

  // 10 — server-authoritative price
  assert.equal(bookingService.created[0].final_price, 12345);
  assert.equal(bookingService.created[0].quote_status, 'ACCEPTED');
  assert.equal(bookingService.created[0].status, 'confirmed');
  assert.equal(bookingService.created[0].confirmation_source, 'CUSTOMER');

  // 11 — enquiry survives and stays linked
  const row = db.enquiries.find((e) => e.enquiry_id === enquiry.enquiry_id);
  assert.ok(row, 'the enquiry row must still exist');
  assert.equal(row.status, 'CONFIRMED');
  assert.equal(row.booking_id, result.booking.booking_id);
  assert.ok(row.accepted_at);
  assert.equal(row.price_status, 'ACCEPTED');

  // 12 — audit trail
  const types = events.calls.map((c) => c.eventType);
  assert.ok(types.includes('CUSTOMER_ACCEPTED'));
  assert.ok(types.includes('BOOKING_CREATED'));
  assert.ok(types.includes('STATUS_CHANGED'));
  // The customer can see the acceptance, but never a driver contact detail.
  const acceptedEvent = events.calls.find((c) => c.eventType === 'CUSTOMER_ACCEPTED');
  assert.equal(acceptedEvent.actorType, 'CUSTOMER');
  assert.equal(JSON.stringify(acceptedEvent.metadata).includes(CUSTOMER_PHONE), false);
});

test('PHASE 1 · 9  duplicate acceptance is an idempotent no-op — never a 2nd booking', async () => {
  reset();
  const bookingService = makeBookingServiceSpy();
  const service = makeEnquiryService({ bookingService });
  const enquiry = seedAwaitingAcceptance();
  const ctx = guestCtx(enquiry.enquiry_id);

  const first = await service.customerAccept(enquiry.enquiry_id, ctx);
  const second = await service.customerAccept(enquiry.enquiry_id, ctx);

  assert.equal(first.alreadyAccepted, undefined);
  assert.equal(second.alreadyAccepted, true);
  assert.equal(bookingService.created.length, 1, 'exactly one booking may ever exist');
  assert.equal(db.bookings.length, 1);
  assert.equal(second.booking.booking_id, first.booking.booking_id);
});

test('PHASE 1 · 13  guest acceptance requires the token scoped to THIS enquiry', async () => {
  reset();
  const service = makeEnquiryService();
  const enquiry = seedAwaitingAcceptance();

  // A token minted for a different enquiry must not authorise this one.
  const foreignToken = issueEnquiryAccessToken({ enquiryId: enquiry.enquiry_id + 999, enquiryNumber: 'OTHER' });
  await assert.rejects(
    () => service.customerAccept(enquiry.enquiry_id, { enquiryToken: foreignToken.token }),
    (err) => err instanceof AppError && [401, 403].includes(err.statusCode)
  );

  // No credential at all is refused.
  await assert.rejects(
    () => service.customerAccept(enquiry.enquiry_id, {}),
    (err) => err instanceof AppError && err.statusCode === 401
  );

  // The guest's own token works.
  const result = await service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id));
  assert.ok(result.booking.booking_id);
});

test('PHASE 1 · 14  a failed booking creation releases the claim so the customer can retry', async () => {
  reset();
  const bookingService = makeBookingServiceSpy();
  bookingService.failNext = true;
  const service = makeEnquiryService({ bookingService });
  const enquiry = seedAwaitingAcceptance();

  await assert.rejects(() => service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id)));

  const row = db.enquiries.find((e) => e.enquiry_id === enquiry.enquiry_id);
  assert.equal(row.status, 'AWAITING_CUSTOMER_ACCEPTANCE', 'the claim must be released');
  assert.equal(row.accepted_at, null);
  assert.equal(row.booking_id, null);

  // The retry succeeds — the customer is never stranded by a transient failure.
  bookingService.failNext = false;
  const retried = await service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id));
  assert.ok(retried.booking.booking_id);
  assert.equal(db.bookings.length, 1);
});

// ===========================================================================
// D. REJECTION
// ===========================================================================

test('PHASE 1 · 15  rejecting a quote never creates a booking or confirms an order', async () => {
  reset();
  const bookingService = makeBookingServiceSpy();
  const events = makeEventsSpy();
  const service = makeEnquiryService({ bookingService, events });
  const enquiry = seedAwaitingAcceptance();

  const rejected = await service.customerReject(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id), {
    reason: 'Too expensive',
  });

  assert.equal(rejected.enquiry.status, 'CUSTOMER_REJECTED');
  assert.equal(rejected.enquiry.price_status, 'REJECTED');
  assert.equal(rejected.enquiry.booking_id, null);
  assert.equal(db.bookings.length, 0);
  assert.ok(events.calls.some((c) => c.eventType === 'CUSTOMER_REJECTED'));

  // A rejected enquiry is terminal — it can never be accepted afterwards.
  await assert.rejects(
    () => service.customerAccept(enquiry.enquiry_id, guestCtx(enquiry.enquiry_id)),
    (err) => err instanceof ConflictError
  );
  assert.equal(db.bookings.length, 0);
});

// ===========================================================================
// E. ORDER → TRIP (the operational record)
// ===========================================================================

test('PHASE 1 · 16  a trip cannot be created before the customer accepted the quote', async () => {
  reset();
  const svc = new TripService();
  const booking = seedAcceptedBooking({ quote_status: 'PENDING' });

  await assert.rejects(
    () => svc.createTrip(tripPayload({ booking_id: booking.booking_id })),
    (err) => err instanceof ValidationError && /accept the quote/i.test(err.message)
  );
  assert.equal(db.trips.length, 0, 'no operational trip may exist before acceptance');

  // A SENT (published, unanswered) quote is equally not a commitment.
  booking.quote_status = 'SENT';
  await assert.rejects(
    () => svc.createTrip(tripPayload({ booking_id: booking.booking_id })),
    (err) => err instanceof ValidationError
  );
  assert.equal(db.trips.length, 0);
});

test('PHASE 1 · 17  a trip cannot be created for an unknown order', async () => {
  reset();
  seedCustomer();
  const svc = new TripService();

  await assert.rejects(
    () => svc.createTrip(tripPayload({ booking_id: 999999 })),
    (err) => err instanceof ValidationError && /booking not found/i.test(err.message)
  );
  assert.equal(db.trips.length, 0);
});

test('PHASE 1 · 18  a trip is created EXACTLY ONCE per order; a repeat returns the same trip', async () => {
  reset();
  const svc = new TripService();
  const booking = seedAcceptedBooking();
  const enquiry = seedEnquiry({ status: 'CONFIRMED', booking_id: booking.booking_id, final_quoted_price: 10000, price_status: 'ACCEPTED' });

  const first = await svc.createTrip(tripPayload({ booking_id: booking.booking_id }), ADMIN);
  assert.ok(first.trip_id);
  assert.equal(first.alreadyExisted, undefined);
  assert.equal(db.trips.length, 1);

  // A double-clicked "Create trip" must not fork the load's financials.
  const second = await svc.createTrip(tripPayload({ booking_id: booking.booking_id }), ADMIN);
  assert.equal(second.trip_id, first.trip_id, 'the same operational trip is returned');
  assert.equal(second.alreadyExisted, true);
  assert.equal(db.trips.length, 1, 'exactly one trip may exist for one order');

  // 20 — the chain is provable: Enquiry → Booking → Trip.
  assert.equal(first.booking_id, booking.booking_id);
  const linkedEnquiry = db.enquiries.find((e) => e.enquiry_id === enquiry.enquiry_id);
  assert.equal(linkedEnquiry.booking_id, first.booking_id);
});

test('PHASE 1 · 19  the trip draft is BLOCKED until the quote is accepted', async () => {
  reset();
  const booking = seedAcceptedBooking({ quote_status: 'SENT' });
  const bookingService = new BookingService({ bookingRepo: { findById: async () => booking } });

  const draft = await bookingService.getTripDraft(booking.booking_id);

  assert.equal(draft.ready, false);
  assert.equal(draft.trip, null);
  assert.ok(draft.blockers.some((b) => /accept the quote/i.test(b)));
});

test('PHASE 1 · 20  the trip draft preserves the operational fields and the enquiry linkage', async () => {
  reset();
  const booking = seedAcceptedBooking();
  const enquiry = seedEnquiry({
    status: 'CONFIRMED',
    price_status: 'ACCEPTED',
    final_quoted_price: 10000,
    booking_id: booking.booking_id,
  });
  const bookingService = new BookingService({ bookingRepo: { findById: async () => booking } });

  const draft = await bookingService.getTripDraft(booking.booking_id);

  assert.equal(draft.ready, true);
  assert.deepEqual(draft.blockers, []);

  // Enquiry linkage is read back, not re-derived.
  assert.equal(draft.enquiry.enquiry_id, enquiry.enquiry_id);
  assert.equal(draft.enquiry.enquiry_number, enquiry.enquiry_number);
  assert.equal(draft.enquiry.status, 'CONFIRMED');

  const t = draft.trip;
  assert.equal(t.booking_id, booking.booking_id);      // order linkage
  assert.equal(t.user_id, booking.user_id);            // customer
  assert.equal(t.pickup_location, 'Begusarai');
  assert.equal(t.pickup_city, 'Begusarai');
  assert.equal(t.drop_location, 'Patna');
  assert.equal(t.drop_city, 'Patna');
  assert.equal(t.distance_km, 120);
  assert.equal(t.driver_id, DRIVER_ID);                // driver information
  assert.equal(t.vehicle_id, VEHICLE_ID);              // vehicle information
  assert.equal(t.transport_owner_id, OWNER_ID);        // resolved from the vehicle
  assert.equal(t.source_type, 'ONLINE_BOOKING');
  assert.equal(t.freight_amount, 10000);               // the agreed freight
  assert.equal(t.notes, 'Call before unloading');
  assert.ok(t.trip_date, 'trip_date is derived from the booking pickup date');
  // Nothing is invented for a field the system does not hold.
  assert.equal(t.expected_delivery_date, null);

  // `trip` is posted verbatim to POST /api/trips, so it must contain ONLY real
  // Trip columns. The enquiry metadata deliberately lives on the envelope.
  const tripColumn = {
    trip_id: 1, trip_number: 1, source_type: 1, booking_id: 1, user_id: 1, client_id: 1,
    transport_owner_id: 1, vehicle_id: 1, driver_id: 1, pickup_location: 1, pickup_city: 1,
    drop_location: 1, drop_city: 1, distance_km: 1, expected_delivery_date: 1,
    trip_delivered_date: 1, freight_amount: 1, driver_payment: 1, owner_payment: 1,
    notes: 1, status: 1, trip_date: 1, created_at: 1, updated_at: 1, completed_at: 1,
    cancelled_at: 1,
  };
  for (const key of Object.keys(t)) {
    assert.ok(key in tripColumn, `getTripDraft.trip must only contain real Trip columns — found "${key}"`);
  }

  // And the draft the admin posts is accepted by the real create path.
  const svc = new TripService();
  const created = await svc.createTrip(t, ADMIN);
  assert.ok(created.trip_id);
  assert.equal(created.booking_id, booking.booking_id);
  assert.equal(created.freight_amount, 10000);
});

test('PHASE 1 · 21  a standalone (non-booking) trip is unaffected by the order guards', async () => {
  reset();
  seedCustomer();
  const svc = new TripService();

  // An online trip raised directly by an admin (no enquiry, no order behind it)
  // has no quote to accept, so the order guards must not apply to it.
  const trip = await svc.createTrip(tripPayload(), ADMIN);
  assert.ok(trip.trip_id);
  assert.equal(trip.booking_id, undefined);
  assert.equal(db.trips.length, 1);
});

// ===========================================================================
// F. STATE MACHINE
// ===========================================================================

test('PHASE 1 · an order can never be confirmed without passing through acceptance', () => {
  const sm = EnquiryStateMachine;

  // Nothing may jump straight to CONFIRMED.
  for (const from of ['ENQUIRY_SUBMITTED', 'ADMIN_REVIEW', 'ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY']) {
    assert.equal(sm.canTransition(from, 'CONFIRMED'), false, `${from} must not reach CONFIRMED directly`);
    assert.equal(sm.canTransition(from, 'CUSTOMER_ACCEPTED'), false, `${from} must not reach CUSTOMER_ACCEPTED directly`);
  }

  // The legal path is: quote ready → awaiting acceptance → accepted → confirmed.
  assert.equal(sm.canTransition('QUOTE_READY', 'AWAITING_CUSTOMER_ACCEPTANCE'), true);
  assert.equal(sm.canTransition('AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED'), true);
  assert.equal(sm.canTransition('CUSTOMER_ACCEPTED', 'CONFIRMED'), true);
  assert.deepEqual(
    sm.shortestPath('QUOTE_READY', 'CONFIRMED'),
    ['AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED', 'CONFIRMED'],
    'every path to CONFIRMED must traverse customer acceptance'
  );

  // Terminal states are final.
  for (const terminal of sm.TERMINAL_STATUSES) {
    assert.equal(sm.canTransition(terminal, 'CONFIRMED'), false);
    assert.equal(sm.isTerminal(terminal), true);
  }

  // Once committed the price is locked.
  assert.equal(sm.canTransition('CONFIRMED', 'QUOTE_READY'), false);
  assert.equal(sm.canTransition('CONFIRMED', 'AWAITING_CUSTOMER_ACCEPTANCE'), false);
});
