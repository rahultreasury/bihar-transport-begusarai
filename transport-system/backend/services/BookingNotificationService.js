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
   * Notify the transport OWNER that a booking was created.
   *
   * MUST be called after the booking transaction has committed. Never throws.
   *
   * @param {number} bookingId
   * @param {{source?: string}=} context — which entry point created the booking
   * @returns {Promise<{success:boolean, skipped?:boolean, reason?:string, messageId?:string}>}
   */
  async notifyOwnerOfNewBooking(bookingId, context = {}) {
    const source = context.source || 'unknown';
    const log = { bookingId, source };

    // ── Configuration guard ───────────────────────────────────────────────
    // A missing recipient must be loud and explicit: silently returning here is
    // exactly how a production deployment can go weeks without notifications.
    if (!process.env.OWNER_EMAIL) {
      logger.error(
        { ...log, missingEnv: 'OWNER_EMAIL' },
        '[booking] Notification SKIPPED — OWNER_EMAIL is not configured'
      );
      return { success: false, skipped: true, reason: 'OWNER_EMAIL not configured' };
    }
    if (!process.env.FROM_EMAIL) {
      logger.error(
        { ...log, missingEnv: 'FROM_EMAIL' },
        '[booking] Notification SKIPPED — FROM_EMAIL is not configured'
      );
      return { success: false, skipped: true, reason: 'FROM_EMAIL not configured' };
    }
    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASSWORD) {
      logger.error(
        { ...log, missingEnv: 'BREVO_SMTP_USER/BREVO_SMTP_PASSWORD' },
        '[booking] Notification SKIPPED — Brevo SMTP credentials are not configured'
      );
      return { success: false, skipped: true, reason: 'SMTP not configured' };
    }

    // ── Load the committed row ─────────────────────────────────────────────
    let booking;
    try {
      booking = await this.loadForNotification(bookingId);
    } catch (err) {
      logger.error(
        { ...log, error: err?.message },
        '[booking] Notification FAILED — could not load the committed booking'
      );
      return { success: false, reason: 'notification_context_load_failed' };
    }

    if (!booking) {
      logger.error(
        log,
        '[booking] Notification FAILED — committed booking row was not found'
      );
      return { success: false, reason: 'booking_row_not_found' };
    }

    const payload = buildBookingEmailPayload(booking);
    const bookingNumber = payload.booking_reference;

    logger.info(
      { ...log, bookingNumber, status: booking.status, quoteStatus: booking.quote_status },
      '[booking] Booking created successfully'
    );
    logger.info(
      { ...log, bookingNumber },
      '[booking] Notification triggered'
    );
    logger.info(
      { ...log, bookingNumber, notificationType: 'email' },
      '[booking] Notification type: EMAIL (owner)'
    );
    logger.info(
      { ...log, bookingNumber, recipient: maskEmail(process.env.OWNER_EMAIL) },
      '[booking] Recipient: owner (OWNER_EMAIL, masked)'
    );
    logger.info(
      {
        ...log,
        bookingNumber,
        customer: payload.customerName,
        mobile: maskMobile(payload.mobile),
        pickup: payload.pickup,
        drop: payload.drop,
        vehicle: payload.vehicle,
      },
      '[booking] Sending...'
    );

    // ── Send ──────────────────────────────────────────────────────────────
    try {
      const result = await this.emailService.sendBookingNotification(payload);

      if (result && result.success) {
        logger.info(
          { ...log, bookingNumber, messageId: result.messageId || null },
          '[booking] Provider accepted message'
        );
        logger.info(
          { ...log, bookingNumber, messageId: result.messageId || null },
          '[booking] Message ID logged'
        );
        return { success: true, messageId: result.messageId || null };
      }

      logger.error(
        { ...log, bookingNumber, reason: result?.message || 'unknown' },
        '[booking] Notification FAILED — provider reported a non-success result'
      );
      return { success: false, reason: result?.message || 'send_failed' };
    } catch (err) {
      // Provider threw (SMTP rejected the socket, DNS failure, auth error…).
      // Log the SAFE, actionable fields only — never a token or password.
      logger.error(
        {
          ...log,
          bookingNumber,
          errorCode: err?.code || null,
          errorMessage: err?.message || null,
          responseCode: err?.responseCode || null,
          command: err?.command || null,
        },
        '[booking] Notification FAILED'
      );
      return { success: false, reason: 'send_threw' };
    }
  }
}

module.exports = BookingNotificationService;
module.exports.BookingNotificationService = BookingNotificationService;
module.exports.buildBookingEmailPayload = buildBookingEmailPayload;
module.exports.maskMobile = maskMobile;
module.exports.maskEmail = maskEmail;
module.exports.printable = printable;
