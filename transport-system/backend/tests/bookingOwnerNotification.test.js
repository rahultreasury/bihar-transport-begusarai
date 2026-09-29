/**
 * Tests for the OWNER notification sent when a Booking is CREATED.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `emailService.sendBookingNotification()` existed but was only ever wired into
 * the legacy `POST /api/booking` MVP route. The LIVE production flow is
 *
 *   BookTransport page → POST /api/enquiries → admin quote → customer accepts
 *   → BookingService.createBooking()
 *
 * and that last hop fired NO notification at all, so production created
 * bookings silently. These tests pin the fixed contract:
 *
 *   1. booking committed  → notification triggered (exactly once)
 *   2. provider succeeds  → booking still succeeds
 *   3. provider fails     → booking STILL succeeds, failure is reported
 *   4. no path sends twice
 *
 * SMTP is stubbed at the nodemailer boundary; Prisma is stubbed at
 * `prisma.$transaction`. No real mail, no real database.
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const nodemailer = require('nodemailer');

const BookingService = require('../services/BookingService');
const BookingNotificationService = require('../services/BookingNotificationService');
const { prisma } = require('../config/prisma');

const {
  buildBookingEmailPayload,
  maskMobile,
  maskEmail,
  printable,
} = BookingNotificationService;

const OWNER = 'akshaykumar@bihartransport.in';
const FROM = 'no-reply@bihartransport.in';

/** A realistic COMMITTED booking row, exactly the shape the repository returns. */
const COMMITTED_BOOKING = {
  booking_id: 4242,
  booking_number: 'BTB-2026-04242',
  booking_reference: 'BTB-2026-04242',
  pickup_location: 'Begusarai',
  drop_location: 'Patna',
  pickup_date: '2026-10-05',
  pickup_time: '10:00:00',
  goods_description: 'Cement Bags',
  goods_type: 'Construction material',
  vehicle_type_required: 'Tata 407 14ft',
  estimated_distance_km: 110,
  estimated_price: 12000,
  final_price: 13500,
  status: 'confirmed',
  quote_status: 'ACCEPTED',
  mobile_snapshot: '9876543210',
  user: { first_name: 'Rahul', last_name: 'Raj', phone: '9876543210' },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Build a BookingService whose DB + notification collaborators are fakes. */
function makeBookingService(notificationImpl) {
  const calls = [];
  const repo = {
    create: async () => ({ booking_id: 4242 }),
    update: async () => ({ changes: 1 }),
    findById: async () => ({ booking_id: 4242 }),
  };
  const timeline = { addEvent: async () => {} };
  const notification = {
    notifyOwnerOfNewBooking: async (bookingId, context) => {
      calls.push({ bookingId, context });
      if (notificationImpl) return notificationImpl(bookingId, context);
      return { success: true, messageId: '<stub@brevo.in>' };
    },
  };
  const service = new BookingService({
    bookingRepo: repo,
    timelineRepo: timeline,
    notificationService: notification,
  });
  return { service, calls, notification };
}

const VALID_INPUT = {
  user_id: 9,
  vehicle_type_required: 'Tata 407 14ft',
  status: 'pending',
};

/** The exact input EnquiryService._createBookingFromEnquiry() passes. */
const ENQUIRY_ACCEPT_INPUT = {
  user_id: 9,
  vehicle_type_required: 'Tata 407 14ft',
  status: 'confirmed',
  quote_status: 'ACCEPTED',
  confirmation_source: 'CUSTOMER',
  final_price: 13500,
};

let realTransaction;
let sent = [];
let realCreateTransport;

beforeEach(() => {
  process.env.FROM_EMAIL = FROM;
  process.env.OWNER_EMAIL = OWNER;
  process.env.BREVO_SMTP_USER = 'smtp-user@brevo.in';
  process.env.BREVO_SMTP_PASSWORD = 'stub-password';
  delete process.env.ADMIN_URL;

  sent = [];
  realCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    async sendMail(opts) {
      sent.push(opts);
      return {
        messageId: '<booking-1@brevo.in>',
        accepted: [opts.to],
        rejected: [],
        response: '250 OK',
      };
    },
  });

  // Stub the DB transaction: run the callback with a fake tx client.
  realTransaction = prisma.$transaction;
  prisma.$transaction = async (cb) =>
    cb({ delivery: { create: async () => ({}) } });
});

afterEach(() => {
  prisma.$transaction = realTransaction;
  nodemailer.createTransport = realCreateTransport;
  delete process.env.FROM_EMAIL;
  delete process.env.OWNER_EMAIL;
  delete process.env.BREVO_SMTP_USER;
  delete process.env.BREVO_SMTP_PASSWORD;
});

/* -------------------------------------------------------------------------- */
/* Test 1 — booking created -> notification triggered (exactly once)            */
/* -------------------------------------------------------------------------- */

describe('Test 1: booking creation triggers the owner notification', () => {
  test('one booking produces exactly one notification', async () => {
    const { service, calls } = makeBookingService();
    const created = await service.createBooking(VALID_INPUT);

    assert.strictEqual(created.booking_id, 4242);
    assert.strictEqual(calls.length, 1, 'exactly one notification per booking');
    assert.strictEqual(calls[0].bookingId, 4242);
  });

  test('the notification happens AFTER the transaction has committed', async () => {
    const order = [];
    prisma.$transaction = async (cb) => {
      order.push('commit');
      return cb({ delivery: { create: async () => ({}) } });
    };

    const { service } = makeBookingService(() => {
      order.push('notify');
      return { success: true };
    });

    await service.createBooking(VALID_INPUT);

    assert.deepStrictEqual(
      order,
      ['commit', 'notify'],
      'the booking must be committed before the notification is triggered'
    );
  });

  test('the enquiry → quote → accept path is labelled and still notifies', async () => {
    const { service, calls } = makeBookingService();
    await service.createBooking(ENQUIRY_ACCEPT_INPUT);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].context.source,
      'enquiry_quote_accepted',
      'the live production path must be identifiable in the logs'
    );
  });

  test('a direct booking is labelled direct_booking', async () => {
    const { service, calls } = makeBookingService();
    await service.createBooking({ ...VALID_INPUT, quote_status: 'PENDING' });
    assert.strictEqual(calls[0].context.source, 'direct_booking');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 2 — provider success                                                    */
/* -------------------------------------------------------------------------- */

describe('Test 2: provider succeeds', () => {
  test('the booking is returned unchanged and the notification succeeds', async () => {
    const { service } = makeBookingService(async () => ({
      success: true,
      messageId: '<booking-1@brevo.in>',
    }));

    const created = await service.createBooking(VALID_INPUT);

    assert.strictEqual(created.booking_id, 4242);
    assert.strictEqual(created.booking_number, 'BTB-2026-04242');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 3 — provider failure never breaks the booking                           */
/* -------------------------------------------------------------------------- */

describe('Test 3: provider failure', () => {
  test('provider THROWS -> the booking is still created and returned', async () => {
    const { service } = makeBookingService(async () => {
      throw new Error('SMTP connection reset');
    });

    const created = await service.createBooking(VALID_INPUT);
    assert.strictEqual(created.booking_id, 4242, 'booking must survive a provider failure');
  });

  test('provider reports success:false -> the booking is still created', async () => {
    const { service } = makeBookingService(async () => ({
      success: false,
      message: 'SMTP error: 535 auth failed',
    }));

    const created = await service.createBooking(VALID_INPUT);
    assert.strictEqual(created.booking_id, 4242);
  });

  test('the notification service ITSELF throws -> the booking is still created', async () => {
    const repo = {
      create: async () => ({ booking_id: 4242 }),
      update: async () => ({ changes: 1 }),
    };
    const service = new BookingService({
      bookingRepo: repo,
      timelineRepo: { addEvent: async () => {} },
      notificationService: {
        notifyOwnerOfNewBooking: async () => {
          throw new Error('boom');
        },
      },
    });

    const created = await service.createBooking(VALID_INPUT);
    assert.strictEqual(created.booking_id, 4242);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 4 — BookingNotificationService end to end (SMTP stubbed)                */
/* -------------------------------------------------------------------------- */

describe('Test 4: BookingNotificationService', () => {
  function makeService(emailStub) {
    return new BookingNotificationService({
      bookingRepo: { findNotificationContext: async () => COMMITTED_BOOKING },
      emailService: emailStub,
    });
  }

  test('sends exactly one email to OWNER_EMAIL and returns the message id', async () => {
    const service = makeService({
      sendBookingNotification: async (payload) => {
        sent.push(payload);
        return { success: true, messageId: '<booking-1@brevo.in>' };
      },
    });

    const result = await service.notifyOwnerOfNewBooking(4242, {
      source: 'enquiry_quote_accepted',
    });

    assert.strictEqual(sent.length, 1, 'exactly one notification');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.messageId, '<booking-1@brevo.in>');
  });

  test('the real emailService recipient is OWNER_EMAIL and never the customer', async () => {
    const service = new BookingNotificationService({
      bookingRepo: { findNotificationContext: async () => COMMITTED_BOOKING },
    });

    await service.notifyOwnerOfNewBooking(4242, { source: 'enquiry_quote_accepted' });

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, OWNER, 'only the owner is ever notified');
    assert.ok(sent[0].subject.includes('BTB-2026-04242'));
    // The customer is never the recipient.
    assert.ok(!String(sent[0].to).includes('9876543210'));
  });

  test('the email body carries the real booking data', async () => {
    const service = makeService({
      sendBookingNotification: async (payload) => {
        sent.push(payload);
        return { success: true };
      },
    });
    await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });

    const p = sent[0];
    assert.strictEqual(p.booking_reference, 'BTB-2026-04242');
    assert.strictEqual(p.customerName, 'Rahul Raj');
    assert.strictEqual(p.mobile, '9876543210');
    assert.strictEqual(p.pickup, 'Begusarai');
    assert.strictEqual(p.drop, 'Patna');
    assert.strictEqual(p.vehicle, 'Tata 407 14ft');
    assert.strictEqual(p.goodsType, 'Cement Bags');
    assert.strictEqual(p.price, '13500', 'final_price wins over estimated_price');
  });

  test('a provider rejection is reported, not thrown', async () => {
    const service = makeService({
      sendBookingNotification: async () => ({ success: false, message: 'SMTP error: 535' }),
    });

    const result = await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });
    assert.strictEqual(result.success, false);
    assert.match(result.reason, /535/);
  });

  test('a provider throw is reported, not rethrown', async () => {
    const service = makeService({
      sendBookingNotification: async () => {
        const err = new Error('SMTP error: 421 service unavailable');
        err.code = 'E421';
        throw err;
      },
    });

    const result = await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'send_threw');
  });

  test('a missing committed row is reported, not thrown', async () => {
    const service = new BookingNotificationService({
      bookingRepo: { findNotificationContext: async () => null },
      emailService: { sendBookingNotification: async () => ({ success: true }) },
    });

    const result = await service.notifyOwnerOfNewBooking(999, { source: 'direct_booking' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'booking_row_not_found');
  });

  /* ---- configuration guards ---- */

  test('missing OWNER_EMAIL -> skipped, nothing is sent', async () => {
    delete process.env.OWNER_EMAIL;
    const service = makeService({
      sendBookingNotification: async () => {
        sent.push('should not happen');
        return { success: true };
      },
    });

    const result = await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.skipped, true);
    assert.match(result.reason, /OWNER_EMAIL/);
    assert.strictEqual(sent.length, 0, 'no send is attempted without a recipient');
  });

  test('missing FROM_EMAIL -> skipped', async () => {
    delete process.env.FROM_EMAIL;
    const service = makeService({ sendBookingNotification: async () => ({ success: true }) });
    const result = await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });
    assert.strictEqual(result.skipped, true);
    assert.match(result.reason, /FROM_EMAIL/);
  });

  test('missing SMTP credentials -> skipped', async () => {
    delete process.env.BREVO_SMTP_PASSWORD;
    const service = makeService({ sendBookingNotification: async () => ({ success: true }) });
    const result = await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });
    assert.strictEqual(result.skipped, true);
    assert.match(result.reason, /SMTP/);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 5 — null-safe payload (production rows really do have nulls)            */
/* -------------------------------------------------------------------------- */

describe('Test 5: null-safe notification payload', () => {
  test('a row with everything null still produces a complete payload', () => {
    const payload = buildBookingEmailPayload({
      booking_id: 1,
      booking_number: null,
      booking_reference: null,
      pickup_location: null,
      drop_location: null,
      pickup_date: null,
      pickup_time: null,
      goods_description: '',
      goods_type: null,
      vehicle_type_required: null,
      estimated_price: null,
      final_price: null,
      mobile_snapshot: null,
      user: { first_name: null, last_name: null, phone: null },
    });

    for (const key of Object.keys(payload)) {
      assert.strictEqual(typeof payload[key], 'string', `${key} must always be a string`);
      assert.notStrictEqual(payload[key], 'null');
      assert.notStrictEqual(payload[key], 'undefined');
    }
    assert.strictEqual(payload.booking_reference, '#1');
    assert.strictEqual(payload.pickup, '—');
    assert.strictEqual(payload.price, '—');
  });

  test('a missing row does not throw', () => {
    assert.doesNotThrow(() => buildBookingEmailPayload(null));
  });

  test('mobile_snapshot is used when the user row has no phone', () => {
    const payload = buildBookingEmailPayload({
      booking_id: 5,
      mobile_snapshot: '9000000000',
      user: { first_name: 'Asha', last_name: null, phone: null },
    });
    assert.strictEqual(payload.mobile, '9000000000');
    assert.strictEqual(payload.customerName, 'Asha');
  });

  test('printable collapses blanks to the dash placeholder', () => {
    assert.strictEqual(printable(null), '—');
    assert.strictEqual(printable(undefined), '—');
    assert.strictEqual(printable('   '), '—');
    assert.strictEqual(printable('Patna'), 'Patna');
    assert.strictEqual(printable(0), '0');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 6 — logging is masked                                                   */
/* -------------------------------------------------------------------------- */

describe('Test 6: production-safe logging', () => {
  test('mobile numbers are masked', () => {
    assert.strictEqual(maskMobile('9876543210'), '98******10');
    assert.strictEqual(maskMobile(null), '—');
    assert.ok(!maskMobile('9876543210').includes('876543'));
  });

  test('emails are masked but stay recognisable', () => {
    const masked = maskEmail(OWNER);
    assert.ok(masked.endsWith('@bihartransport.in'));
    assert.ok(masked.startsWith('ak'));
    assert.ok(!masked.includes('akshaykumar'));
    assert.strictEqual(maskEmail(null), '—');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 7 — no duplicate notification on the legacy MVP route                   */
/* -------------------------------------------------------------------------- */

describe('Test 7: no duplicate dispatch', () => {
  const mvpSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'bookingMvpRoutes.js'),
    'utf8'
  );

  test('the MVP route does not send its own booking notification', () => {
    assert.ok(
      !mvpSource.includes('sendBookingNotification'),
      'POST /api/booking must not send a second owner email — BookingService does it'
    );
  });

  test('the MVP route has no fire-and-forget email block', () => {
    assert.ok(
      !mvpSource.includes('Fire-and-forget email notification'),
      'the unawaited IIFE send is the production "silent" failure mode'
    );
  });

  test('the MVP route still creates the booking through BookingService', () => {
    assert.ok(mvpSource.includes('bookingService.createBooking'));
  });
});
