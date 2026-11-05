/**
 * tests/helpers/emailTestEnv.js
 * ===========================================================================
 * Test-only preload. Loaded with `node --require` by `npm test` so it runs
 * BEFORE any application module.
 *
 * It does two things:
 *
 *   1. FORCES the test environment into a no-send configuration
 *      (NODE_ENV=test, EMAIL_MODE=test). dotenv does not overwrite variables
 *      that are already set, so a developer `backend/.env` containing
 *      `EMAIL_MODE=development` — or real Brevo credentials — cannot weaken
 *      this. `services/emailDelivery.js` treats NODE_ENV=test as a hard block
 *      that no variable can override.
 *
 *   2. REPLACES `nodemailer.createTransport` with a recording stub, so even a
 *      bug in the mode resolution can never open an SMTP socket from a test
 *      run. The stub records instead of sending; `__deliveries` is the record.
 *
 * This file changes DELIVERY SAFETY for tests only. It touches no booking,
 * quotation, enquiry or customer logic, and no UI.
 */

/* ---- 1. Force the no-send configuration ---------------------------------- */

process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'test';

// Explicitly neutralise the non-production escape hatch, so an inherited value
// from the developer's shell can never re-enable real delivery in a test run.
delete process.env.EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION;

/* ---- 2. Hard block at the nodemailer boundary ---------------------------- */

const nodemailer = require('nodemailer');

/** Every message handed to the stubbed transporter, oldest first. */
const __deliveries = [];

/** Clear the recorded deliveries. Call between tests. */
function __reset() {
  __deliveries.length = 0;
}

nodemailer.createTransport = function createTransportStub() {
  return {
    async sendMail(options) {
      __deliveries.push(options);
      return {
        messageId: `<test-blocked@localhost>`,
        accepted: [options && options.to].filter(Boolean),
        rejected: [],
        response: '250 TEST MODE — not actually sent',
      };
    },
    async verify() {
      return true;
    },
  };
};

// Exposed for assertions via `require('../helpers/emailTestEnv')`.
module.exports = { __deliveries, __reset };
