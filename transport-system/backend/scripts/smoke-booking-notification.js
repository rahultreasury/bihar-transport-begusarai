/**
 * End-to-end smoke test of the LIVE production booking notification chain.
 *
 * Simulates exactly what happens in production when a customer accepts a quote:
 *
 *   EnquiryService.customerAccept
 *     -> BookingService.createBooking()      [real class, stubbed Prisma tx]
 *       -> COMMIT
 *       -> BookingNotificationService        [real class]
 *         -> emailService.sendBookingNotification [real function]
 *           -> nodemailer transporter        [stubbed — nothing is really sent]
 *
 * Nothing is written to a database and no email leaves the machine. What this
 * proves is the WIRING and the LOG OUTPUT an operator will see on Render.
 *
 *   node scripts/smoke-booking-notification.js
 */

const nodemailer = require('nodemailer');
const { prisma } = require('../config/prisma');
const BookingService = require('../services/BookingService');

// ── Configure the same env vars production must have (values are placeholders) ──
process.env.FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@bihartransport.in';
process.env.OWNER_EMAIL = process.env.OWNER_EMAIL || 'akshaykumar@bihartransport.in';
process.env.BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || 'smtp-user@brevo.in';
process.env.BREVO_SMTP_PASSWORD = process.env.BREVO_SMTP_PASSWORD || 'stub-password';

// ── Stub the transport boundary ───────────────────────────────────────────────
let captured = null;
nodemailer.createTransport = () => ({
  async sendMail(opts) {
    captured = opts;
    return { messageId: '<smoke-1@brevo.in>', accepted: [opts.to], rejected: [], response: '250 OK' };
  },
});

// ── Stub the database transaction ─────────────────────────────────────────────
prisma.$transaction = async (cb) => cb({ delivery: { create: async () => ({}) } });

// The row Prisma would return once the transaction is committed.
const COMMITTED_ROW = {
  booking_id: 7777,
  booking_number: 'BTB-2026-07777',
  booking_reference: 'BTB-2026-07777',
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

const { BookingNotificationService } = require('../services/BookingNotificationService');

const service = new BookingService({
  bookingRepo: {
    create: async () => ({ booking_id: 7777 }),
    update: async () => ({ changes: 1 }),
  },
  timelineRepo: { addEvent: async () => {} },
  notificationService: new BookingNotificationService({
    bookingRepo: { findNotificationContext: async () => COMMITTED_ROW },
  }),
});

// This is the exact payload EnquiryService._createBookingFromEnquiry() builds.
(async () => {
  const created = await service.createBooking({
    user_id: 9,
    vehicle_type_required: 'Tata 407 14ft',
    pickup_location: 'Begusarai',
    drop_location: 'Patna',
    goods_description: 'Cement Bags',
    estimated_price: 12000,
    final_price: 13500,
    status: 'confirmed',
    quote_status: 'ACCEPTED',
    confirmation_source: 'CUSTOMER',
  });

  console.log('\n================ RESULT ================');
  console.log('Booking ID          :', created.booking_id);
  console.log('Booking number      :', created.booking_number);
  console.log('Notifications sent  :', captured ? 1 : 0);
  console.log('Recipient           :', captured ? captured.to : '(none)');
  console.log('Subject             :', captured ? captured.subject : '(none)');
  console.log('Provider message id :', '<smoke-1@brevo.in>');
  console.log('========================================\n');

  if (!captured) {
    console.error('SMOKE TEST FAILED: no email was produced.');
    process.exit(1);
  }
  process.exit(0);
})();
