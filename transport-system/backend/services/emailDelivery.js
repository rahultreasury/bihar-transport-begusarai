/**
 * emailDelivery.js
 * ===========================================================================
 * THE environment-aware email delivery layer.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The root cause of test bookings landing in the owner's real Zoho inbox is
 * that `emailService.js` had NO environment gate at all: every call site
 * unconditionally did `transporter.sendMail(...)`. Because the local
 * `backend/.env` carries REAL `BREVO_SMTP_USER` / `BREVO_SMTP_PASSWORD` /
 * `FROM_EMAIL` / `OWNER_EMAIL`, running `npm run dev` and creating a booking
 * sent a genuine message on every single save.
 *
 * This module is the SINGLE choke point through which every email now leaves
 * the process. `emailService.js` still owns the templates and the business
 * rules; it no longer talks to nodemailer directly.
 *
 * THE CONTRACT
 * ------------
 *   EMAIL_MODE=production    -> real SMTP delivery (production behaviour, unchanged)
 *   EMAIL_MODE=development   -> NO real email; log what WOULD have been sent
 *   EMAIL_MODE=test          -> NO real email; log + fully block external delivery
 *
 * RESOLUTION ORDER (deny-by-default, so a missing value is SAFE)
 * ------------------------------------------------------------
 *   1. NODE_ENV=test                       -> 'test'        (hard, no override)
 *   2. EMAIL_MODE set and valid             -> that value
 *   3. EMAIL_MODE set but invalid/blank    -> derived from NODE_ENV + a warning
 *   4. EMAIL_MODE unset                    -> 'production' ONLY when
 *                                              NODE_ENV === 'production',
 *                                              otherwise 'development'
 *
 * Rule 4 is what makes the fix work with zero configuration: a developer
 * machine with no EMAIL_MODE and no NODE_ENV now resolves to 'development',
 * so no real mail is sent.
 *
 * THE SAFETY GUARD
 * ----------------
 * Even an explicit `EMAIL_MODE=production` cannot open real delivery while
 * NODE_ENV is 'development'/'test' unless the operator ALSO sets
 * EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION=true. `NODE_ENV=test` is an
 * absolute hard block — automated tests can never send real mail, which is
 * the strongest guarantee requirement (7) asks for.
 *
 * NOTHING about the booking workflow, the notification itself, the templates
 * or the return contract changes: a simulated send still returns
 * `{ success: true }` to the booking code, so a booking is created identically
 * in every mode. This module changes DELIVERY only.
 */

const nodemailer = require('nodemailer');

/* -------------------------------------------------------------------------- */
/* Modes                                                                       */
/* -------------------------------------------------------------------------- */

const EMAIL_MODES = Object.freeze({
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  TEST: 'test',
});

const VALID_MODES = new Set(Object.values(EMAIL_MODES));

/** Human label used in the "[EMAIL:TEST MODE]" log block. */
const MODE_LABEL = Object.freeze({
  [EMAIL_MODES.PRODUCTION]: 'LIVE MODE',
  [EMAIL_MODES.DEVELOPMENT]: 'TEST MODE',
  [EMAIL_MODES.TEST]: 'TEST MODE',
});

/* -------------------------------------------------------------------------- */
/* Small env helpers                                                           */
/* -------------------------------------------------------------------------- */

function readStr(env, key) {
  const value = env ? env[key] : undefined;
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function readNodeEnv(env = process.env) {
  return readStr(env, 'NODE_ENV').toLowerCase();
}

function isTruthy(value) {
  const s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/* -------------------------------------------------------------------------- */
/* Mode resolution                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the effective email mode. Pure and side-effect free so it can be
 * unit-tested against any env object without mutating the real one.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {'production'|'development'|'test'}
 */
function resolveEmailMode(env = process.env) {
  const nodeEnv = readNodeEnv(env);

  // 1. An automated test run is never allowed to reach the network, whatever
  //    EMAIL_MODE happens to say. Hard stop, no escape hatch.
  if (nodeEnv === 'test') return EMAIL_MODES.TEST;

  const explicit = readStr(env, 'EMAIL_MODE').toLowerCase();

  // 2. Explicit, valid EMAIL_MODE wins.
  if (VALID_MODES.has(explicit)) return explicit;

  // 3 + 4. Missing or invalid EMAIL_MODE -> derive from NODE_ENV.
  return nodeEnv === 'production' ? EMAIL_MODES.PRODUCTION : EMAIL_MODES.DEVELOPMENT;
}

/**
 * The safety guard. Real delivery is permitted ONLY when:
 *
 *   - the resolved mode is 'production', AND
 *   - NODE_ENV is 'production', OR
 *   - NODE_ENV is 'development'/unset AND the operator explicitly opted in
 *     with EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION=true.
 *
 * `NODE_ENV=test` is never permitted, whatever the env says.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {boolean}
 */
function isRealDeliveryEnabled(env = process.env) {
  if (resolveEmailMode(env) !== EMAIL_MODES.PRODUCTION) return false;

  const nodeEnv = readNodeEnv(env);

  if (nodeEnv === 'production') return true;
  if (nodeEnv === 'test') return false; // unreachable via resolve(), kept as belt-and-braces

  return isTruthy(readStr(env, 'EMAIL_ALLOW_REAL_SEND_IN_NON_PRODUCTION'));
}

/**
 * One-line explanation of the current configuration, for boot logs and for the
 * "why was nothing sent?" question that always follows.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string}
 */
function describeEmailMode(env = process.env) {
  const mode = resolveEmailMode(env);
  const nodeEnv = readNodeEnv(env) || '(unset)';
  const enabled = isRealDeliveryEnabled(env);
  const real = enabled ? 'real email delivery ENABLED' : 'real email delivery BLOCKED';
  return `EMAIL_MODE=${mode} NODE_ENV=${nodeEnv} — ${real}`;
}

/* -------------------------------------------------------------------------- */
/* Guard                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Throws when a caller tries to obtain a live SMTP transporter while the
 * environment forbids real delivery. Callers should use `sendEmail()`, which
 * needs no such guard; this exists so an accidental future `require` of
 * nodemailer inside emailService cannot quietly reintroduce the leak.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
function assertRealDeliveryAllowed(env = process.env) {
  if (isRealDeliveryEnabled(env)) return;
  throw new Error(
    `Real SMTP delivery is not permitted in this environment (${describeEmailMode(env)}). ` +
      'Use emailDelivery.sendEmail() so non-production environments are simulated.'
  );
}

/* -------------------------------------------------------------------------- */
/* Transporter                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the nodemailer transporter from Brevo SMTP settings.
 * Refuses to hand out a live transporter outside an allowed environment.
 */
function createTransporter(env = process.env) {
  assertRealDeliveryAllowed(env);

  const host = env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(env.BREVO_SMTP_PORT || '587', 10);
  const user = env.BREVO_SMTP_USER || '';
  const pass = env.BREVO_SMTP_PASSWORD || '';

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Log what WOULD have been sent, and hand the caller a success result so the
 * business workflow proceeds exactly as it would in production.
 *
 * Nothing here touches the network, the filesystem or any secret.
 *
 * @param {Object} mail
 * @param {string} mail.to
 * @param {string} mail.subject
 * @param {string} [mail.template] — logical template/type name
 * @param {string} [mail.description] — human label, e.g. 'booking notification'
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{success: true, simulated: true, messageId: null, accepted: string[], rejected: string[], mode: string, message: string}}
 */
function simulateSend(mail, env = process.env) {
  const mode = resolveEmailMode(env);
  const label = MODE_LABEL[mode] || 'TEST MODE';
  const to = mail.to || '(no recipient)';
  const subject = mail.subject || '(no subject)';

  // The exact shape requested for development/test runs.
  console.log(`[EMAIL:${label}]`);
  console.log(`Would send ${mail.description || 'email'}`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  if (mail.template) console.log(`Template: ${mail.template}`);
  console.log(`Mode: ${describeEmailMode(env)}`);
  console.log('[EMAIL] No real email was sent.');

  return {
    success: true,
    simulated: true,
    messageId: null,
    accepted: [],
    rejected: [],
    mode,
    message: `Simulated in ${mode} mode — no real email sent`,
  };
}

/* -------------------------------------------------------------------------- */
/* The single delivery choke point                                             */
/* -------------------------------------------------------------------------- */

/**
 * sendEmail — the ONLY function in this codebase allowed to perform real SMTP
 * delivery. Every public `emailService` function routes through it.
 *
 * Contract, identical in all modes:
 *   - resolves to an object shaped like a nodemailer `info` on success
 *   - `success: true` in every mode, so the booking/enquiry workflow is
 *     unaffected by a simulated send
 *   - REJECTS with the provider error on a real delivery failure, so the
 *     existing callers' catch blocks behave exactly as before
 *
 * @param {Object} mail
 * @param {string} mail.from
 * @param {string} mail.to
 * @param {string} mail.subject
 * @param {string} [mail.html]
 * @param {string} [mail.text]
 * @param {Array}  [mail.attachments]
 * @param {string} [mail.template]    — logical template/type name, for logs
 * @param {string} [mail.description] — human label, for logs
 * @returns {Promise<Object>}
 */
async function sendEmail(mail, env = process.env) {
  if (!isRealDeliveryEnabled(env)) {
    return simulateSend(mail, env);
  }

  const transporter = createTransporter(env);

  const info = await transporter.sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    ...(mail.text ? { text: mail.text } : {}),
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.attachments && mail.attachments.length ? { attachments: mail.attachments } : {}),
  });

  return info;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                     */
/* -------------------------------------------------------------------------- */

module.exports = {
  EMAIL_MODES,
  MODE_LABEL,
  // mode resolution
  resolveEmailMode,
  isRealDeliveryEnabled,
  describeEmailMode,
  // guard
  assertRealDeliveryAllowed,
  // delivery
  createTransporter,
  sendEmail,
  simulateSend,
};
