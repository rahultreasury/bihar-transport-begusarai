/**
 * Tests for the OWNER notification email sent when a customer submits an
 * enquiry.
 *
 * The critical guarantee: the ONLY recipient is process.env.OWNER_EMAIL.
 * The customer is never emailed — not the enquiry address, not User.email.
 *
 * SMTP is stubbed at the nodemailer boundary, so no real mail is sent.
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const nodemailer = require('nodemailer');
const {
  sendNewInquiryNotificationEmail,
  buildNewInquiryEmail,
  newInquiryRows,
} = require('../services/emailService');

const OWNER = 'owner@bihartransport.in';
const FROM = 'sender@bihartransport.in';
const SMTP_USER = 'smtp-user@brevo.in';
const CUSTOMER_EMAIL = 'customer@gmail.com';

const ENQUIRY = {
  enquiry_id: 7,
  enquiry_number: 'ENQ-2026-00007',
  customer_id: null,
  customer_name: 'Rahul',
  customer_mobile: '98XXXXXXXX',
  customer_email: CUSTOMER_EMAIL, // present but must NEVER be a recipient
  pickup_location: 'Begusarai',
  drop_location: 'Patna',
  requested_vehicle_name: '17 ft Truck',
  material: 'General Goods',
  quantity: 120,
  quantity_unit: 'bags',
  weight: 8500,
  weight_unit: 'kg',
  pickup_date: '2026-10-05T00:00:00.000Z',
  pickup_time: '10:00:00',
  distance_km: 110,
  special_instructions: 'Call before pickup.',
  status: 'NEW',
  created_at: '2026-09-29T04:00:00.000Z',
};

let sent = [];
const realCreateTransport = nodemailer.createTransport;

beforeEach(() => {
  process.env.FROM_EMAIL = FROM;
  process.env.OWNER_EMAIL = OWNER;
  process.env.BREVO_SMTP_USER = SMTP_USER;
  process.env.BREVO_SMTP_PASSWORD = 'stub-password';
  delete process.env.ADMIN_URL;
  sent = [];
  nodemailer.createTransport = () => ({
    async sendMail(opts) {
      sent.push(opts);
      return {
        messageId: '<inquiry-1@brevo.in>',
        accepted: [opts.to],
        rejected: [],
        response: '250 OK',
      };
    },
  });
});

afterEach(() => {
  nodemailer.createTransport = realCreateTransport;
  delete process.env.FROM_EMAIL;
  delete process.env.OWNER_EMAIL;
  delete process.env.BREVO_SMTP_USER;
  delete process.env.BREVO_SMTP_PASSWORD;
});

/* -------------------------------------------------------------------------- */
/* Test 1 — enquiry submitted -> owner notified                               */
/* -------------------------------------------------------------------------- */

describe('Test 1: enquiry submitted notifies the owner', () => {
  test('sendMail is called once, addressed to OWNER_EMAIL', async () => {
    const result = await sendNewInquiryNotificationEmail(ENQUIRY);

    assert.strictEqual(sent.length, 1, 'exactly one email per enquiry');
    assert.strictEqual(sent[0].to, OWNER);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.messageId, '<inquiry-1@brevo.in>');
    assert.deepStrictEqual(result.accepted, [OWNER]);
    assert.deepStrictEqual(result.rejected, []);
  });

  test('subject identifies the enquiry', () => {
    const { subject } = buildNewInquiryEmail({ enquiry: ENQUIRY, enquiryRef: ENQUIRY.enquiry_number });
    assert.match(subject, /New Transport Inquiry/);
    assert.ok(subject.includes(ENQUIRY.enquiry_number), 'subject must carry the enquiry number');
  });

  test('the email carries the real enquiry data, HTML and text', () => {
    const { html, text } = buildNewInquiryEmail({ enquiry: ENQUIRY, enquiryRef: ENQUIRY.enquiry_number });

    for (const fragment of [
      'ENQ-2026-00007', 'Rahul', '98XXXXXXXX', 'Begusarai', 'Patna',
      '17 ft Truck', 'General Goods', '120 bags', '8500 kg', '110 km',
      'Call before pickup.', 'Guest (website)',
    ]) {
      assert.ok(html.includes(fragment), `HTML missing "${fragment}"`);
      assert.ok(text.includes(fragment), `text missing "${fragment}"`);
    }
    assert.ok(html.includes('<html'), 'html body required');
    assert.ok(text.length > 50, 'plain-text fallback required');
  });
});

/* -------------------------------------------------------------------------- */
/* Test 2 — recipient is OWNER_EMAIL, never the customer                      */
/* -------------------------------------------------------------------------- */

describe('Test 2: recipient correctness', () => {
  test('recipient === OWNER_EMAIL even when the enquiry carries a customer email', async () => {
    await sendNewInquiryNotificationEmail(ENQUIRY);
    const { to } = sent[0];

    assert.strictEqual(to, OWNER);
    assert.notStrictEqual(to, CUSTOMER_EMAIL, 'must never go to the customer');
    assert.ok(!to.includes('gmail.com'), 'must never go to a customer domain');
  });

  test('a registered customer with a User.email still goes only to the owner', async () => {
    await sendNewInquiryNotificationEmail({
      ...ENQUIRY,
      customer_id: 42,
      customer_email: 'registered.user@gmail.com',
    });
    assert.strictEqual(sent[0].to, OWNER);
    assert.notStrictEqual(sent[0].to, 'registered.user@gmail.com');
  });

  test('never falls back to the SMTP user or the sender address', async () => {
    await sendNewInquiryNotificationEmail(ENQUIRY);
    assert.ok(!sent[0].to.includes(SMTP_USER));
    assert.ok(!sent[0].to.includes(FROM));
  });
});

/* -------------------------------------------------------------------------- */
/* Test 3 — SMTP failure is contained                                         */
/* -------------------------------------------------------------------------- */

describe('Test 3: SMTP failure', () => {
  test('the error is rethrown so the caller can log it', async () => {
    nodemailer.createTransport = () => ({
      async sendMail() {
        const err = new Error('421 Service not available');
        err.code = 'ECONNECTION';
        err.responseCode = 421;
        err.command = 'MAIL FROM';
        throw err;
      },
    });

    await assert.rejects(
      () => sendNewInquiryNotificationEmail(ENQUIRY),
      (err) => {
        assert.strictEqual(err.responseCode, 421);
        return true;
      },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Test 4 — one enquiry, one email (no duplicates)                            */
/* -------------------------------------------------------------------------- */

describe('Test 4: no duplicate notifications', () => {
  test('sending for two different enquiries produces exactly two emails', async () => {
    await sendNewInquiryNotificationEmail(ENQUIRY);
    await sendNewInquiryNotificationEmail({ ...ENQUIRY, enquiry_id: 8, enquiry_number: 'ENQ-2026-00008' });

    assert.strictEqual(sent.length, 2, 'one email per enquiry, not two for one');
    assert.ok(sent.every((m) => m.to === OWNER));
    assert.ok(sent[0].subject.includes('ENQ-2026-00007'));
    assert.ok(sent[1].subject.includes('ENQ-2026-00008'));
  });
});

/* -------------------------------------------------------------------------- */
/* Test 5 — content only uses fields that exist                                */
/* -------------------------------------------------------------------------- */

describe('Test 5: no invented data', () => {
  test('empty enquiry fields are dropped, not shown as blanks', () => {
    const rows = newInquiryRows({
      enquiry_number: 'ENQ-1',
      customer_name: 'Rahul',
      material: null,
      weight: null,
      quantity: null,
      distance_km: null,
      special_instructions: '',
    });
    const labels = rows.map(([l]) => l);

    assert.ok(labels.includes('Customer Name'));
    assert.ok(!labels.includes('Goods / Material'));
    assert.ok(!labels.includes('Weight'));
    assert.ok(!labels.includes('Quantity'));
    assert.ok(!labels.includes('Distance'));
  });

  test('the dashboard link is omitted when ADMIN_URL is not configured', () => {
    const { html, text } = buildNewInquiryEmail({ enquiry: ENQUIRY, enquiryRef: 'ENQ-1' });
    assert.ok(!html.includes('View Inquiry in Dashboard'), 'no invented URL');
    assert.ok(!text.includes('View Inquiry in Dashboard'));
  });

  test('the dashboard link is included when ADMIN_URL IS configured', () => {
    process.env.ADMIN_URL = 'https://app.bihartransport.in';
    const { html, text } = buildNewInquiryEmail({ enquiry: ENQUIRY, enquiryRef: 'ENQ-1' });
    assert.ok(html.includes('View Inquiry in Dashboard'));
    assert.ok(html.includes('https://app.bihartransport.in/admin/enquiries'));
    assert.ok(text.includes('https://app.bihartransport.in/admin/enquiries'));
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration guards                                                       */
/* -------------------------------------------------------------------------- */

describe('configuration guards', () => {
  test('missing OWNER_EMAIL -> skipped, sendMail NOT called', async () => {
    delete process.env.OWNER_EMAIL;
    const result = await sendNewInquiryNotificationEmail(ENQUIRY);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(result.success, false);
  });

  test('missing FROM_EMAIL -> skipped', async () => {
    delete process.env.FROM_EMAIL;
    const result = await sendNewInquiryNotificationEmail(ENQUIRY);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(result.success, false);
  });
});
