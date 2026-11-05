/**
 * diagnose-booking-notification.js
 * ---------------------------------------------------------------------------
 * Reports whether the booking-notification email can be delivered on THIS
 * machine, WITHOUT EVER PRINTING A SECRET.
 *
 * For every variable the code actually reads it prints:
 *   SET / MISSING, the length, and (for non-secrets) the value.
 * Passwords, tokens and API keys are reported only as a length so a value can
 * never leak into a screenshot, a CI log, or a bug report.
 *
 * Usage (locally):
 *   node scripts/diagnose-booking-notification.js
 *
 * Usage (on Render, via the shell):
 *   node scripts/diagnose-booking-notification.js
 *
 * With --verify it also performs a real transporter.verify() (an SMTP handshake,
 * no mail is sent) to prove the credentials authenticate.
 *
 * With --test it sends ONE real booking-shaped email to OWNER_EMAIL.
 * Never use --test against a customer's address: the recipient is always the
 * owner, by design.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { verifyConnection, sendBookingNotification } = require('../services/emailService');

const G = '\x1b[32m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const D = '\x1b[90m';
const X = '\x1b[0m';

/**
 * Only these variables exist in the codebase. Nothing here is invented — each
 * name below is a literal `process.env.X` read somewhere in backend code.
 *
 * secret: true  -> never print the value, only whether it is set and how long
 * masked: true  -> print a masked form (emails / phone numbers)
 */
const CHECKS = [
  { name: 'BREVO_SMTP_HOST', usedBy: 'services/emailService.js (default smtp-relay.brevo.com)' },
  { name: 'BREVO_SMTP_PORT', usedBy: 'services/emailService.js (default 587)' },
  { name: 'BREVO_SMTP_USER', usedBy: 'services/emailService.js createTransporter()', secret: true },
  { name: 'BREVO_SMTP_PASSWORD', usedBy: 'services/emailService.js createTransporter()', secret: true },
  { name: 'FROM_EMAIL', usedBy: 'services/emailService.js (the "from" address)', masked: true },
  { name: 'OWNER_EMAIL', usedBy: 'services/emailService.js — the ONLY booking recipient', masked: true },
  { name: 'ADMIN_URL', usedBy: 'services/emailService.js (admin link in the booking email)' },
  {
    name: 'WHATSAPP_ACCESS_TOKEN',
    usedBy: 'server.js startup warning only — NO WhatsApp sender is wired up',
    secret: true,
  },
  {
    name: 'WHATSAPP_PHONE_NUMBER_ID',
    usedBy: 'server.js startup warning only — NO WhatsApp sender is wired up',
  },
  {
    name: 'WHATSAPP_BUSINESS_NUMBER',
    usedBy: 'server.js startup warning only — NO WhatsApp sender is wired up',
  },
];

function maskEmail(v) {
  const at = v.indexOf('@');
  if (at <= 0) return '***';
  return `${v.slice(0, 2)}${'*'.repeat(Math.max(at - 2, 1))}@${v.slice(at + 1)}`;
}

function report() {
  console.log(`\n${D}── Booking notification environment ─────────────────────────────${X}`);
  for (const c of CHECKS) {
    const v = process.env[c.name];
    if (!v) {
      console.log(`${R} MISSING ${X} ${c.name.padEnd(24)} ${D}${c.usedBy}${X}`);
      continue;
    }
    const shown = c.secret ? `<set, ${v.length} chars, value hidden>` : c.masked ? maskEmail(v) : v;
    console.log(`${G} SET     ${X} ${c.name.padEnd(24)} ${shown}`);
    if (c.usedBy) console.log(`${D}         ${' '.repeat(24)} ${c.usedBy}${X}`);
  }
  console.log(`${D}──────────────────────────────────────────────────────────────${X}`);

  const required = ['BREVO_SMTP_USER', 'BREVO_SMTP_PASSWORD', 'FROM_EMAIL', 'OWNER_EMAIL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(
      `\n${R}RESULT: CANNOT SEND.${X} Missing on this host: ${missing.join(', ')}`
    );
    console.log(`${D}A booking would still be saved — the notification is skipped and logged.${X}`);
    return false;
  }
  console.log(`\n${G}RESULT: configuration complete — a booking notification can be sent.${X}`);
  return true;
}

(async () => {
  const configured = report();

  if (!configured) process.exit(1);

  if (process.argv.includes('--verify')) {
    console.log(`\n${D}Verifying SMTP connection (no mail is sent)…${X}`);
    const r = await verifyConnection();
    console.log(r.success ? `${G} SMTP verify OK ${X}` : `${R} SMTP verify FAILED: ${r.message} ${X}`);
    if (!r.success) process.exit(1);
  }

  if (process.argv.includes('--test')) {
    console.log(`\n${Y}Sending ONE real test booking notification to the owner…${X}`);
    const r = await sendBookingNotification({
      booking_reference: 'BTB-DIAGNOSTIC',
      customerName: 'Diagnostic run',
      mobile: '0000000000',
      pickup: 'Begusarai',
      drop: 'Patna',
      vehicle: 'Diagnostic',
      goodsType: 'Diagnostic',
      price: '0',
      pickupDate: '—',
      pickupTime: '—',
    });
    console.log(
      r.success
        ? `${G} Sent. messageId=${r.messageId || 'n/a'} ${X}`
        : `${R} FAILED: ${r.message} ${X}`
    );
    if (!r.success) process.exit(1);
  }

  process.exit(0);
})();
