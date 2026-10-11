/**
 * Regression tests: creating a Booking sends NO email.
 * ---------------------------------------------------------------------------
 * THE "🚚 New Booking Received - BTB-…" OWNER EMAIL HAS BEEN REMOVED.
 *
 * The booking email was deleted outright at the owner's explicit request. These
 * tests pin the new, permanent contract:
 *
 *   1. a booking is still created normally (row, invoice, timeline event)
 *   2. booking creation does NOT dispatch any notification
 *   3. BookingNotificationService.notifyOwnerOfNewBooking() is a hard no-op
 *   4. emailService.sendBookingNotification() never reaches SMTP — not even
 *      with EMAIL_MODE=production and live-looking credentials
 *   5. N bookings produce ZERO emails, in ANY environment
 *
 * NOT AFFECTED (deliberately still active, and asserted as such):
 *   - the pre-booking ENQUIRY email   (EnquiryService)
 *   - password-reset emails
 *   - WhatsApp / SMS
 *   - the booking creation logic, the database, and every UI flow
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
const emailService = require('../services/emailService');
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

/**
 * Build a BookingService whose DB collaborators are fakes.
 *
 * `notificationService` is injected ONLY so the test can prove it is NEVER
 * called. `calls` records any invocation.
 */
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

/**
 * A fake Prisma transaction client.
 *
 * `BookingService.createBooking()` runs, inside the same transaction:
 *   - re-reads the PERSISTED booking row (`tx.booking.findUnique`) so the
 *     invoice amount can never come from the request body, and
 *   - raises the invoice through the real `InvoiceRepository`.
 */
function makeFakeTx(calls) {
  return {
    delivery: { create: async () => ({}) },
    booking: {
      findUnique: async () => ({ final_price: COMMITTED_BOOKING.final_price }),
    },
    invoice: {
      findFirst: async () => null,
      create: async ({ data }) => {
        if (calls) calls.push({ invoice: data });
        return { invoice_id: 1, invoice_number: data.invoice_number };
      },
    },
  };
}

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
  prisma.$transaction = async (cb) => cb(makeFakeTx(null));
});

afterEach(() => {
  prisma.$transaction = realTransaction;
  nodemailer.createTransport = realCreateTransport;
  delete process.env.FROM_EMAIL;
  delete process.env.OWNER_EMAIL;
  delete process.env.BREVO_SMTP_USER;
  delete process.env.BREVO_SMTP_PASSWORD;
  // Restore the run-wide test default from tests/helpers/emailTestEnv.js, so
  // no test can leave real delivery switched on for the next one.
  delete process.env.EMAIL_MODE;
  delete process.env.EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION;
  process.env.NODE_ENV = 'test';
});

/* -------------------------------------------------------------------------- */
/* Test 1 — the booking is still created normally                             */
/* -------------------------------------------------------------------------- */

describe('Test 1: booking creation still works, unchanged', () => {
  test('a direct booking is created and returned', async () => {
    const { service } = makeBookingService();
    const created = await service.createBooking(VALID_INPUT);

    assert.strictEqual(created.booking_id, 4242);
    assert.strictEqual(created.booking_number, 'BTB-2026-04242');
    assert.strictEqual(created.booking_reference, 'BTB-2026-04242');
  });

  test('the enquiry → quote → accept path still creates the booking', async () => {
    const raised = [];
    prisma.$transaction = async (cb) => cb(makeFakeTx(raised));

    const { service } = makeBookingService();
    const created = await service.createBooking(ENQUIRY_ACCEPT_INPUT);

    assert.strictEqual(created.booking_id, 4242);
    assert.strictEqual(raised.length, 1, 'one invoice per accepted booking');
    assert.strictEqual(
      raised[0].invoice.final_price,
      COMMITTED_BOOKING.final_price,
      'the amount is the persisted Booking.final_price, never the request body'
    );
    assert.ok(created.invoice_number, 'the booking reports its invoice number');
  });

  test('a booking that is NOT yet accepted is not billed', async () => {
    const raised = [];
    prisma.$transaction = async (cb) => cb(makeFakeTx(raised));

    const { service } = makeBookingService();
    await service.createBooking(VALID_INPUT);

    assert.strictEqual(raised.length, 0, 'no agreed price yet means no invoice');
  });

  test('many bookings in a row all succeed', async () => {
    const { service } = makeBookingService();
    for (let i = 0; i < 10; i += 1) {
      const created = await service.createBooking(VALID_INPUT);
      assert.strictEqual(created.booking_id, 4242);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Test 2 — booking creation dispatches NO notification at all                 */
/* -------------------------------------------------------------------------- */

describe('Test 2: creating a booking sends NO email', () => {
  test('the notification service is never invoked', async () => {
    const { service, calls } = makeBookingService();

    await service.createBooking(VALID_INPUT);

    assert.strictEqual(
      calls.length,
      0,
      'BookingService must not call the notification service any more'
    );
  });

  test('the enquiry → quote → accept path is also silent', async () => {
    const { service, calls } = makeBookingService();

    await service.createBooking(ENQUIRY_ACCEPT_INPUT);

    assert.strictEqual(calls.length, 0, 'the live production path sends nothing');
  });

  test('TEN bookings produce ZERO emails at the SMTP boundary', async () => {
    const { service } = makeBookingService();

    for (let i = 0; i < 10; i += 1) {
      await service.createBooking({
        ...VALID_INPUT,
        vehicle_type_required: `Truck ${i}`,
      });
    }

    assert.strictEqual(
      sent.length,
      0,
      'no transporter.sendMail() may be invoked for any booking'
    );
  });

  test('even with production email mode enabled, nothing is sent', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';
    process.env.EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION = 'true';

    const { service, calls } = makeBookingService();
    await service.createBooking(VALID_INPUT);

    assert.strictEqual(calls.length, 0);
    assert.strictEqual(sent.length, 0, 'the removal is unconditional');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 3 — BookingNotificationService is a hard no-op                         */
/* -------------------------------------------------------------------------- */

describe('Test 3: BookingNotificationService never sends', () => {
  function makeService(emailStub) {
    return new BookingNotificationService({
      bookingRepo: { findNotificationContext: async () => COMMITTED_BOOKING },
      emailService: emailStub,
    });
  }

  test('notifyOwnerOfNewBooking does not call the email sender', async () => {
    let called = 0;
    const service = makeService({
      sendBookingNotification: async () => {
        called += 1;
        return { success: true };
      },
    });

    const result = await service.notifyOwnerOfNewBooking(4242, {
      source: 'enquiry_quote_accepted',
    });

    assert.strictEqual(called, 0, 'the email sender must never be reached');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'booking_email_removed');
  });

  test('it does not even read the booking from the database', async () => {
    let queries = 0;
    const service = new BookingNotificationService({
      bookingRepo: {
        findNotificationContext: async () => {
          queries += 1;
          return COMMITTED_BOOKING;
        },
      },
      emailService: { sendBookingNotification: async () => ({ success: true }) },
    });

    await service.notifyOwnerOfNewBooking(4242, { source: 'direct_booking' });

    assert.strictEqual(queries, 0, 'no read-back is needed when nothing is sent');
  });

  test('the REAL emailService + BookingNotificationService chain sends nothing', async () => {
    // Deliberately opens the delivery layer all the way — the strongest form of
    // the guarantee. Safe ONLY because `nodemailer.createTransport` is stubbed in
    // beforeEach, so no socket is ever opened.
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';
    process.env.EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION = 'true';

    const service = new BookingNotificationService({
      bookingRepo: { findNotificationContext: async () => COMMITTED_BOOKING },
    });

    const result = await service.notifyOwnerOfNewBooking(4242, {
      source: 'enquiry_quote_accepted',
    });

    assert.strictEqual(result.disabled, true);
    assert.strictEqual(sent.length, 0, 'not one message left the process');
  });

  test('100 notification attempts produce ZERO emails', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';

    const service = makeService({
      sendBookingNotification: async () => ({ success: true }),
    });

    for (let i = 0; i < 100; i += 1) {
      await service.notifyOwnerOfNewBooking(1000 + i, { source: 'direct_booking' });
    }

    assert.strictEqual(sent.length, 0);
  });
});

/* -------------------------------------------------------------------------- */
/* Test 4 — the emailService sender is a hard no-op                            */
/* -------------------------------------------------------------------------- */

describe('Test 4: emailService.sendBookingNotification never sends', () => {
  const booking = {
    booking_reference: 'BTB-2026-04242',
    customerName: 'Rahul Raj',
    mobile: '9876543210',
    pickup: 'Begusarai',
    drop: 'Patna',
    vehicle: 'Tata 407 14ft',
    goodsType: 'Cement Bags',
    price: '13500',
  };

  test('in the test environment nothing is sent', async () => {
    const result = await emailService.sendBookingNotification(booking);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(sent.length, 0);
  });

  test('in PRODUCTION nothing is sent either', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';
    process.env.EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION = 'true';

    const result = await emailService.sendBookingNotification(booking);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(
      sent.length,
      0,
      'the booking email is permanently removed, not merely environment-gated'
    );
  });

  test('it renders no subject and no template', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'emailService.js'),
      'utf8'
    );
    // Strip comments: prose that NAMES the removed email is documentation, not
    // a send path. Only executable code is asserted on.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !code.includes('New Booking Received'),
      'the booking subject line must not exist in executable code'
    );
    assert.ok(
      !/template:\s*['"]booking_notification['"]/.test(code),
      'no booking_notification template may be routed to the delivery layer'
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Test 5 — the OTHER emails are untouched                                     */
/* -------------------------------------------------------------------------- */

describe('Test 5: unrelated emails are NOT affected', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_MODE = 'development';
  });

  test('the enquiry notification email still exists and still works', async () => {
    assert.strictEqual(typeof emailService.sendNewInquiryNotificationEmail, 'function');
    const result = await emailService.sendNewInquiryNotificationEmail({
      enquiry_number: 'ENQ-2026-0001',
      customer_name: 'Test Customer',
    });
    assert.strictEqual(result.success, true, 'the enquiry flow is unaffected');
    assert.strictEqual(sent.length, 0, 'still gated by the environment layer');
  });

  test('the password reset email still exists and still works', async () => {
    assert.strictEqual(typeof emailService.sendPasswordResetEmail, 'function');
    const result = await emailService.sendPasswordResetEmail({
      email: 'someone@not-a-real-domain.test',
      resetUrl: 'https://example.invalid/reset/abc',
      userName: 'Test Customer',
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(sent.length, 0);
  });

  test('the SMTP test-email + connection verification still exist', async () => {
    assert.strictEqual(typeof emailService.sendTestEmail, 'function');
    assert.strictEqual(typeof emailService.verifyConnection, 'function');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 6 — retained pure helpers (kept intact, still null-safe)              */
/* -------------------------------------------------------------------------- */

describe('Test 6: null-safe payload helpers retained', () => {
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
/* Test 7 — no other route or module can dispatch the booking email           */
/* -------------------------------------------------------------------------- */

describe('Test 7: no route or module can send the booking email', () => {
  test('the legacy MVP route does not send its own booking notification', () => {
    const mvpSource = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'bookingMvpRoutes.js'),
      'utf8'
    );
    assert.ok(!mvpSource.includes('sendBookingNotification'));
    assert.ok(!mvpSource.includes('notifyOwnerOfNewBooking'));
    assert.ok(mvpSource.includes('bookingService.createBooking'), 'it still creates bookings');
  });

  /** Strip JS comments so assertions target executable code, not prose. */
  function code(file) {
    return fs
      .readFileSync(path.join(__dirname, '..', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  test('BookingService no longer calls the notification service', () => {
    assert.ok(
      !/notifyOwnerOfNewBooking\s*\(/.test(code('services/BookingService.js')),
      'the booking workflow must not dispatch the owner email'
    );
  });

  test('BookingNotificationService no longer calls the email sender', () => {
    assert.ok(
      !/this\.emailService\s*\.\s*sendBookingNotification\s*\(/.test(
        code('services/BookingNotificationService.js')
      ),
      'the dispatch point must not reach the sender'
    );
  });

  test('no controller, route or realtime module sends a booking email', () => {
    const dirs = ['controllers', 'routes', 'repositories', 'realtime', 'utils'];
    for (const dir of dirs) {
      const full = path.join(__dirname, '..', dir);
      for (const file of fs.readdirSync(full)) {
        if (!file.endsWith('.js')) continue;
        const text = fs
          .readFileSync(path.join(full, file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        assert.ok(
          !text.includes('sendBookingNotification'),
          `${dir}/${file} must not send a booking email`
        );
      }
    }
  });
});
