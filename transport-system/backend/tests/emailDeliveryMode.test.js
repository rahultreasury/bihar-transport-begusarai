/**
 * Tests for the environment-aware EMAIL DELIVERY LAYER
 * (services/emailDelivery.js) and its wiring in services/emailService.js.
 *
 * THE BUG THIS PINS SHUT
 * ----------------------
 * `emailService.sendBookingNotification()` had no environment gate: it always
 * called `transporter.sendMail()`. Because backend/.env carries real Brevo
 * credentials, every locally created test booking sent a genuine
 * "🚚 New Booking Received - BTB-..." message to the owner's real Zoho inbox.
 *
 * THE CONTRACT PINNED HERE
 * ------------------------
 *   DEVELOPMENT -> no real email, logs what it would have sent, still succeeds
 *   TEST        -> no real email, hard blocked
 *   PRODUCTION  -> real email, unchanged
 *   NODE_ENV=development/test cannot send unless EXPLICITLY opted in
 *   NODE_ENV=test can never send, whatever the variables say
 *
 * No booking/quotation/enquiry/customer logic and no UI is touched here — the
 * subject under test is DELIVERY SAFETY only.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 *
 * NOTE: this suite runs with tests/helpers/emailTestEnv.js preloaded, which has
 * already replaced nodemailer.createTransport with a non-networking stub. Each
 * test re-stubs it with a COUNTING stub, so even if the mode resolution were
 * ever broken, these tests could not open a socket.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const nodemailer = require('nodemailer');

const emailDelivery = require('../services/emailDelivery');
const emailService = require('../services/emailService');

const {
  EMAIL_MODES,
  resolveEmailMode,
  isRealDeliveryEnabled,
  describeEmailMode,
  assertRealDeliveryAllowed,
  createTransporter,
  sendEmail,
} = emailDelivery;

/* RFC 2606 reserved TLD — guaranteed non-deliverable, never a real inbox. */
const OWNER = 'owner@not-a-real-domain.test';
const FROM = 'no-reply@not-a-real-domain.test';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const REAL_ENV = {
  BREVO_SMTP_HOST: 'smtp-relay.brevo.com',
  BREVO_SMTP_PORT: '587',
  BREVO_SMTP_USER: 'smtp-user@brevo.in',
  BREVO_SMTP_PASSWORD: 'not-a-real-password',
};

let savedEnv;
let transportCalls;
let realCreateTransport;
let logLines;

/** Replace console.log so the "[EMAIL:TEST MODE]" block can be asserted. */
function captureLogs() {
  logLines = [];
  return function fakeLog(...args) {
    logLines.push(args.join(' '));
  };
}

beforeEach(() => {
  savedEnv = { ...process.env };

  // Counting stub: any attempt to build a real transporter is recorded.
  transportCalls = [];
  realCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => {
    transportCalls.push('createTransport');
    return {
      async sendMail(options) {
        transportCalls.push({ sendMail: options });
        return { messageId: '<prod@brevo.in>', accepted: [options.to], rejected: [] };
      },
      async verify() {
        return true;
      },
    };
  };

  // Enough configuration for emailService's own pre-flight checks to pass.
  process.env.FROM_EMAIL = FROM;
  process.env.OWNER_EMAIL = OWNER;
  process.env.BREVO_SMTP_USER = REAL_ENV.BREVO_SMTP_USER;
  process.env.BREVO_SMTP_PASSWORD = REAL_ENV.BREVO_SMTP_PASSWORD;

  logLines = [];
});

afterEach(() => {
  nodemailer.createTransport = realCreateTransport;
  process.env = savedEnv;
});

/* ========================================================================== */
/* 1. Mode resolution — pure, no globals mutated                             */
/* ========================================================================== */

describe('1. resolveEmailMode()', () => {
  test('an unconfigured developer machine resolves to development', () => {
    // This is the exact situation that flooded the Zoho inbox:
    // real Brevo credentials, but no EMAIL_MODE and no NODE_ENV.
    assert.strictEqual(resolveEmailMode({ ...REAL_ENV }), EMAIL_MODES.DEVELOPMENT);
  });

  test('EMAIL_MODE=development is honoured', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: 'development' }),
      EMAIL_MODES.DEVELOPMENT
    );
  });

  test('EMAIL_MODE=test is honoured', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: 'test' }),
      EMAIL_MODES.TEST
    );
  });

  test('EMAIL_MODE=production with NODE_ENV=production resolves to production', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: 'production', NODE_ENV: 'production' }),
      EMAIL_MODES.PRODUCTION
    );
  });

  test('NODE_ENV=production alone is enough for production', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, NODE_ENV: 'production' }),
      EMAIL_MODES.PRODUCTION
    );
  });

  test('an INVALID EMAIL_MODE falls back to development, never to production', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: 'live', NODE_ENV: 'development' }),
      EMAIL_MODES.DEVELOPMENT
    );
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: '   ' }),
      EMAIL_MODES.DEVELOPMENT
    );
  });

  test('NODE_ENV=test is a HARD block that no EMAIL_MODE can override', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, NODE_ENV: 'test', EMAIL_MODE: 'production' }),
      EMAIL_MODES.TEST
    );
    // ...even with the escape hatch set.
    assert.strictEqual(
      resolveEmailMode({
        ...REAL_ENV,
        NODE_ENV: 'test',
        EMAIL_MODE: 'production',
        EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION: 'true',
      }),
      EMAIL_MODES.TEST
    );
  });

  test('mode value casing/whitespace is tolerated', () => {
    assert.strictEqual(
      resolveEmailMode({ ...REAL_ENV, EMAIL_MODE: '  PRODUCTION ', NODE_ENV: 'production' }),
      EMAIL_MODES.PRODUCTION
    );
  });
});

/* ========================================================================== */
/* 2. The safety guard                                                        */
/* ========================================================================== */

describe('2. the safety guard', () => {
  test('real delivery is BLOCKED in development and test', () => {
    assert.strictEqual(
      isRealDeliveryEnabled({ ...REAL_ENV, EMAIL_MODE: 'development' }),
      false
    );
    assert.strictEqual(isRealDeliveryEnabled({ ...REAL_ENV, EMAIL_MODE: 'test' }), false);
    assert.strictEqual(isRealDeliveryEnabled({ ...REAL_ENV }), false);
  });

  test('real delivery is ENABLED only in production', () => {
    assert.strictEqual(
      isRealDeliveryEnabled({ ...REAL_ENV, EMAIL_MODE: 'production', NODE_ENV: 'production' }),
      true
    );
  });

  test('EMAIL_MODE=production under NODE_ENV=development is STILL blocked', () => {
    // The accidental-leak case: a stale EMAIL_MODE must not be enough.
    assert.strictEqual(
      isRealDeliveryEnabled({ ...REAL_ENV, EMAIL_MODE: 'production', NODE_ENV: 'development' }),
      false
    );
  });

  test('the explicit opt-in unlocks it, and only for development', () => {
    assert.strictEqual(
      isRealDeliveryEnabled({
        ...REAL_ENV,
        EMAIL_MODE: 'production',
        NODE_ENV: 'development',
        EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION: 'true',
      }),
      true
    );
  });

  test('assertRealDeliveryAllowed() throws outside an allowed environment', () => {
    assert.throws(
      () => assertRealDeliveryAllowed({ ...REAL_ENV, EMAIL_MODE: 'development' }),
      /not permitted/i
    );
  });

  test('assertRealDeliveryAllowed() passes in production', () => {
    assert.doesNotThrow(() =>
      assertRealDeliveryAllowed({ ...REAL_ENV, EMAIL_MODE: 'production', NODE_ENV: 'production' })
    );
  });

  test('createTransporter() REFUSES to hand out a live transporter when blocked', () => {
    assert.throws(
      () => createTransporter({ ...REAL_ENV, EMAIL_MODE: 'development' }),
      /not permitted/i,
      'a stray direct use of createTransporter must not be able to send'
    );
  });

  test('describeEmailMode() explains the current state', () => {
    const described = describeEmailMode({ ...REAL_ENV, EMAIL_MODE: 'development' });
    assert.match(described, /EMAIL_MODE=development/);
    assert.match(described, /BLOCKED/);
  });
});

/* ========================================================================== */
/* 3. sendEmail() — the single delivery choke point                          */
/* ========================================================================== */

describe('3. sendEmail()', () => {
  const mail = {
    from: `"Bihar Transport" <${FROM}>`,
    to: OWNER,
    subject: '🚚 New Booking Received - BTB-2026-00252',
    html: '<p>hello</p>',
  };

  test('DEVELOPMENT: no transporter, success returned, would-be-send logged', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_MODE = 'development';
    const realLog = console.log;
    console.log = captureLogs();

    let result;
    try {
      result = await sendEmail({ ...mail, template: 'booking_notification', description: 'booking notification' });
    } finally {
      console.log = realLog;
    }

    assert.strictEqual(result.success, true, 'the workflow must still see success');
    assert.strictEqual(result.simulated, true);
    assert.strictEqual(transportCalls.length, 0, 'NO transporter may be created in development');

    const output = logLines.join('\n');
    assert.match(output, /\[EMAIL:TEST MODE\]/);
    assert.match(output, /Would send booking notification/);
    assert.ok(output.includes(OWNER), 'the recipient must be logged');
    assert.ok(output.includes('🚚 New Booking Received - BTB-2026-00252'), 'subject must be logged');
    assert.match(output, /Template: booking_notification/);
  });

  test('TEST: no transporter, success returned', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_MODE = 'test';
    const result = await sendEmail(mail);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.strictEqual(transportCalls.length, 0);
  });

  test('PRODUCTION: a real transporter is used', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';

    const result = await sendEmail(mail);

    // sendEmail() resolves to a nodemailer `info`-shaped object; the `success`
    // flag is added by the emailService wrappers that own the return contract.
    assert.notStrictEqual(result.simulated, true, 'this was NOT a simulation');
    assert.strictEqual(result.messageId, '<prod@brevo.in>');
    assert.strictEqual(transportCalls.length, 2, 'createTransport + sendMail');
    assert.strictEqual(transportCalls[1].sendMail.to, OWNER);
    assert.ok(transportCalls[1].sendMail.subject.includes('BTB-2026-00252'));
  });
});

/* ========================================================================== */
/* 4. The booking notification has been REMOVED entirely                       */
/* ========================================================================== */

describe('4. sendBookingNotification() is a hard no-op', () => {
  const booking = {
    booking_reference: 'BTB-2026-00252',
    customerName: 'Test Customer',
    mobile: '9876543210',
    pickup: 'Begusarai',
    drop: 'Patna',
    vehicle: 'Tata 407 14ft',
    goodsType: 'Cement Bags',
    price: '13500',
  };

  test('DEVELOPMENT: nothing is sent, simulated, or logged', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_MODE = 'development';
    const realLog = console.log;
    console.log = captureLogs();

    let result;
    try {
      result = await emailService.sendBookingNotification(booking);
    } finally {
      console.log = realLog;
    }

    assert.strictEqual(result.success, false, 'nothing was sent, so nothing succeeded');
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(transportCalls.length, 0, 'NO real email may leave the process');
    assert.strictEqual(
      logLines.length,
      0,
      'the booking email must not even be rendered/logged for later delivery'
    );
  });

  test('PRODUCTION: still nothing is sent — the removal is unconditional', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';

    const result = await emailService.sendBookingNotification(booking);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.disabled, true);
    assert.strictEqual(
      transportCalls.length,
      0,
      'the booking email is gone even with EMAIL_MODE=production and live credentials'
    );
  });

  test('TEN test bookings in PRODUCTION produce ZERO emails', async () => {
    // The headline guarantee: creating 10 bookings cannot send 10 emails to the
    // owner's real inbox, in ANY environment.
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_MODE = 'production';
    const realLog = console.log;
    console.log = captureLogs();

    try {
      for (let i = 0; i < 10; i += 1) {
        await emailService.sendBookingNotification({
          ...booking,
          booking_reference: `BTB-2026-00${250 + i}`,
        });
      }
    } finally {
      console.log = realLog;
    }

    assert.strictEqual(transportCalls.length, 0, 'NOT ONE email was transmitted');
    assert.strictEqual(logLines.length, 0, 'and none was queued, logged or retried');
  });
});

/* ========================================================================== */
/* 5. Every other sender is gated too                                         */
/* ========================================================================== */

describe('5. the other email senders are gated as well', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_MODE = 'development';
  });

  test('sendNewInquiryNotificationEmail does not send in development', async () => {
    const result = await emailService.sendNewInquiryNotificationEmail({
      enquiry_number: 'ENQ-2026-0001',
      customer_name: 'Test Customer',
    });
    assert.strictEqual(result.success, true, 'the enquiry flow is unaffected');
    assert.strictEqual(transportCalls.length, 0);
  });

  test('sendPasswordResetEmail does not send in development', async () => {
    const result = await emailService.sendPasswordResetEmail({
      email: 'someone@not-a-real-domain.test',
      resetUrl: 'https://example.invalid/reset/abc',
      userName: 'Test Customer',
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(transportCalls.length, 0);
  });

  test('sendTestEmail does not send in development', async () => {
    const result = await emailService.sendTestEmail();
    assert.strictEqual(result.success, true);
    assert.strictEqual(transportCalls.length, 0);
  });

  test('verifyConnection does not open a socket in development', async () => {
    const result = await emailService.verifyConnection();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.strictEqual(transportCalls.length, 0, 'no SMTP verify, no socket');
  });
});

/* ========================================================================== */
/* 6. Source-level guarantee: no bypass left behind                          */
/* ========================================================================== */

describe('6. there is no bypass around the delivery layer', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'emailService.js'),
    'utf8'
  );

  test('emailService never calls transporter.sendMail() directly', () => {
    assert.ok(
      !/transporter\s*\.\s*sendMail\s*\(/.test(source),
      'all sends must go through emailDelivery.sendEmail()'
    );
  });

  test('emailService no longer requires nodemailer itself', () => {
    assert.ok(
      !/require\(['"]nodemailer['"]\)/.test(source),
      'nodemailer is owned exclusively by the delivery layer'
    );
  });

  /**
   * Strip JS comments so a source-level assertion can distinguish a real code
   * path from a documentation line that merely NAMES the removed email.
   * Prose in a comment is documentation, never a send path.
   */
  function executableCode(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  test('the booking notification template has been deleted, not just gated', () => {
    const { sendBookingNotification } = emailService;
    // The symbol survives so historical callers resolve instead of crashing,
    // but no executable booking-email code may remain.
    assert.strictEqual(typeof sendBookingNotification, 'function');

    const code = executableCode(source);
    assert.ok(
      !code.includes('New Booking Received'),
      'the booking email subject/template must be gone from executable code'
    );
    assert.ok(
      !/template:\s*['"]booking_notification['"]/.test(code),
      'no code may route a booking_notification template to the delivery layer'
    );
  });

  test('no production module calls the booking email sender', () => {
    const modules = ['BookingService', 'BookingNotificationService', 'emailService'];
    for (const name of modules) {
      const text = fs.readFileSync(
        path.join(__dirname, '..', 'services', `${name}.js`),
        'utf8'
      );
      const code = executableCode(text);
      // `emailService.js` DEFINES and exports the symbol; it must not CALL it.
      if (name === 'emailService') {
        assert.ok(
          !/await\s+sendBookingNotification\s*\(/.test(code),
          'emailService must not call its own booking sender'
        );
        continue;
      }
      assert.ok(
        !/sendBookingNotification\s*\(/.test(code),
        `${name}.js must not invoke sendBookingNotification()`
      );
      assert.ok(
        !/notifyOwnerOfNewBooking\s*\(/.test(code) || name === 'BookingNotificationService',
        `${name}.js must not dispatch the booking notification`
      );
    }
  });
});
