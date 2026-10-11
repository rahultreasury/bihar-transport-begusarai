/**
 * BookingNotificationService
 * ---------------------------------------------------------------------------
 * THE single dispatch point for the "a Booking was created" notification.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `emailService.sendBookingNotification()` has always existed, but it used to be
 * wired into exactly ONE route — the legacy `POST /api/booking` MVP endpoint
 * (routes/bookingMvpRoutes.js). The live production booking flow does not use
 * that route:
 *
 *   Customer → BookTransport page → POST /api/enquiries → EnquiryService
 *           → admin quote → customer accepts → EnquiryService.customerAccept
 *           → BookingService.createBooking()   ← NO notification was ever here
 *
 * So on production the booking was committed and NOTHING was sent. The only
 * email that arrived was the *enquiry* email (EnquiryService → sendNewInquiry
 * NotificationEmail), which is a different event and a different moment.
 *
 * Every booking entry point in the system funnels through the ONE canonical
 * `BookingService.createBooking()`:
 *
 *   1. POST /api/booking            routes/bookingMvpRoutes.js   (legacy MVP)
 *   2. POST /api/bookings/create    routes/bookingRoutes.js      (authenticated)
 *   3. POST /api/bookings/create    controllers/bookingController.js
 *   4. enquiry → quote → accept     services/EnquiryService.js  (THE LIVE PATH)
 *
 * Dispatching from inside `createBooking()` therefore guarantees exactly one
 * notification per booking, on every path, with no duplication and no
 * development-only dead end.
 *
 * CONTRACT (do not weaken)
 * ------------------------
 *   - Called ONLY after the booking transaction has COMMITTED.
 *   - The booking is NEVER rolled back because this failed. This method never
 *     throws; it reports the outcome in its return value and logs it.
 *   - It is AWAITED by the caller rather than fire-and-forget. A fire-and-forget
 *     send is lost whenever the host drains the request (Render free tier sleeps
 *     and swaps instances), which is precisely the "local works / production
 *     silent" failure this service exists to remove.
 *   - Recipient is ALWAYS `process.env.OWNER_EMAIL`. The customer is never
 *     emailed and no driver/partner phone number ever leaves the system here.
 *   - No secret (token, password, SMTP key, JWT) is ever logged.
 */

const BookingRepository = require('../repositories/BookingRepository');
const { logger } = require('../utils/logger');

// emailService is required lazily to keep this module free of side effects at
// import time and to stay safe if a caller requires BookingService early.
function loadEmailService() {
  // eslint-disable-next-line global-require
  return require('./emailService');
}

const PLACEHOLDER = '—';

/**
 * Normalise any value to a printable string, never `undefined`.
 * A missing field must degrade to a dash — it must never make a whole booking
 * notification fail, and it must never print the string "null"/"undefined".
 *
 * @param {*} value
 * @param {string=} fallback
 * @returns {string}
 */
function printable(value, fallback = PLACEHOLDER) {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s === '' ? fallback : s;
}

/**
 * Mask a mobile number for logs: keep the first 2 and last 2 digits only.
 * `9876543210` → `98******10`. Never used for the email body itself.
 * @param {*} value
 * @returns {string}
 */
function maskMobile(value) {
  const s = printable(value, '');
  if (!s) return PLACEHOLDER;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return `${'*'.repeat(Math.max(digits.length, 1))}`;
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}

/**
 * Mask an email for logs: keep first 2 chars of the local part and the TLD.
 * `owner@bihartransport.in` → `ow***@bihartransport.in`.
 * @param {*} value
 * @returns {string}
 */
function maskEmail(value) {
  const s = printable(value, '');
  if (!s) return PLACEHOLDER;
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/**
 * Build the customer-facing name for the notification.
 * Falls back to the mobile so an owner looking at a "Guest Customer" row still
 * has something to call.
 */
function buildCustomerName(booking) {
  const user = booking?.user || {};
  const first = printable(user.first_name, '');
  const last = printable(user.last_name, '');
  const combined = `${first} ${last}`.trim();
  if (combined && combined.toLowerCase() !== 'guest customer') return combined;
  return printable(user.first_name, PLACEHOLDER);
}

/**
 * Map a persisted Booking row (+ its customer relation) onto the exact shape
 * `emailService.sendBookingNotification()` renders.
 *
 * Every field is null-safe on purpose: production booking rows legitimately
 * have null goods_type / quantity / weight / mobile_snapshot, and one missing
 * field must not cost the owner the whole notification.
 *
 * @param {Object} booking
 * @returns {Object}
 */
function buildBookingEmailPayload(booking) {
  const row = booking || {};
  const price =
    row.final_price !== null && row.final_price !== undefined
      ? row.final_price
      : row.estimated_price;

  const goods = printable(row.goods_description, '');

  return {
    booking_reference: printable(
      row.booking_number || row.booking_reference,
      `#${row.booking_id ?? ''}`.trim() || PLACEHOLDER
    ),
    customerName: buildCustomerName(row),
    mobile: printable(row.mobile_snapshot || row.user?.phone, PLACEHOLDER),
    pickup: printable(row.pickup_location),
    drop: printable(row.drop_location),
    vehicle: printable(row.vehicle_type_required),
    goodsType: goods || printable(row.goods_type, PLACEHOLDER),
    price: printable(price, PLACEHOLDER),
    pickupDate: printable(row.pickup_date, PLACEHOLDER),
    pickupTime: printable(row.pickup_time, PLACEHOLDER),
  };
}

class BookingNotificationService {
  /**
   * @param {Object=} deps
   * @param {BookingRepository=} deps.bookingRepo
   * @param {{sendBookingNotification:Function}=} deps.emailService
   */
  constructor(deps = {}) {
    this.bookingRepo = deps.bookingRepo || new BookingRepository();
    this._emailService = deps.emailService || null;
  }

  /** Lazily resolved so tests can inject a fake without touching module state. */
  get emailService() {
    if (!this._emailService) this._emailService = loadEmailService();
    return this._emailService;
  }

  /**
   * Read back the committed booking together with the minimum customer data the
   * notification needs. Runs on the main Prisma client (NOT the transaction
   * client) so it can only ever see a COMMITTED row.
   *
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async loadForNotification(bookingId) {
    if (this.bookingRepo.findNotificationContext) {
      return this.bookingRepo.findNotificationContext(bookingId);
    }
    return null;
  }

  /**
   * Notify the transport OWNER that a booking was created — PERMANENTLY DISABLED.
   *
   * The "🚚 New Booking Received - BTB-…" owner email has been removed at the
   * owner's explicit request. This method is intentionally kept as a callable
   * symbol so historical callers keep resolving, but it is a HARD NO-OP:
   *
   *   - it does NOT load the committed booking from the database
   *   - it does NOT build an email payload
   *   - it does NOT call `emailService.sendBookingNotification()`
   *   - it does NOT open an SMTP connection, nor log, queue or retry anything
   *
   * There is no "simulated" mode and no environment variable that re-enables
   * it — not `EMAIL_MODE=production`, not `NODE_ENV`, not a live Brevo
   * credential. The booking email is gone in every environment.
   *
   * NOT AFFECTED — these are separate events and remain fully active:
   *   - the pre-booking ENQUIRY email (EnquiryService → sendNewInquiryNotificationEmail)
   *   - password-reset emails
   *   - WhatsApp / SMS notifications
   *
   * @param {number} _bookingId — ignored entirely.
   * @param {Object} [_context]  — ignored entirely.
   * @returns {Promise<{success:false, skipped:true, disabled:true, reason:string}>}
   */
  async notifyOwnerOfNewBooking(_bookingId, _context = {}) {
    return {
      success: false,
      skipped: true,
      disabled: true,
      reason: 'booking_email_removed',
    };
  }
}

module.exports = BookingNotificationService;
module.exports.BookingNotificationService = BookingNotificationService;
module.exports.buildBookingEmailPayload = buildBookingEmailPayload;
module.exports.maskMobile = maskMobile;
module.exports.maskEmail = maskEmail;
module.exports.printable = printable;
