/**
 * enquiryController
 * ---------------------------------------------------------------------------
 * HTTP boundary for CUSTOMER-facing enquiry endpoints.
 *
 * Public surface:
 *   POST   /api/enquiries                     create (guest or logged in)
 *   GET    /api/enquiries/:idOrNumber         full detail (ownership checked)
 *   GET    /api/enquiries/:idOrNumber/status  compact status (polling)
 *   GET    /api/enquiries/:idOrNumber/quote   quote card
 *   POST   /api/enquiries/:idOrNumber/accept  accept the final quote
 *   POST   /api/enquiries/:idOrNumber/reject  decline the final quote
 *   POST   /api/enquiries/:idOrNumber/cancel  cancel the request
 *   GET    /api/enquiries/my                  the caller's own enquiries
 *   GET    /api/enquiries/config/customer-care  published support profile
 *
 * NOTHING here is a client-side decision. `accept` in particular is a
 * server-authoritative state transition performed by EnquiryService inside a
 * transaction; the button in the UI is only an affordance.
 *
 * Every response that carries enquiry data passes through EnquiryDTO, so no
 * driver phone number can reach a customer from this controller.
 */

const asyncHandler = require('../middleware/asyncHandler');
const enquiryService = require('../services/EnquiryService');
const eventService = require('../services/EnquiryEventService');
const { toCustomerEnquiry, toCustomerEnquirySummary } = require('../dtos/EnquiryDTO');
const { getCustomerCare } = require('../config/customerCare');
const { buildEnquiryWhatsAppUrl } = require('../services/enquiryWhatsAppFormatter');
const { isCanonicalEnquiryNumber } = require('../services/EnquiryNumberService');
const { NotFoundError, ValidationError } = require('../utils/AppError');
const { isQuoteVisibleToCustomer } = require('../utils/EnquiryStateMachine');

/**
 * Resolve "the enquiry" from a route param that may be either the numeric id
 * or the canonical enquiry number (the confirmation page is addressed by number).
 *
 * @param {string} idOrNumber
 * @returns {Promise<object>}
 */
async function resolveEnquiry(idOrNumber) {
  const raw = String(idOrNumber || '').trim();
  if (!raw) throw new ValidationError({ message: 'Enquiry id or number is required' });

  if (isCanonicalEnquiryNumber(raw)) {
    return enquiryService.loadByNumber(raw);
  }
  if (/^\d+$/.test(raw)) {
    return enquiryService.loadForCustomer(Number(raw));
  }
  // A non-numeric, non-canonical value is either a legacy reference or junk.
  return enquiryService.loadByNumber(raw);
}

/**
 * Build the access context the service expects from an Express request.
 * @param {import('express').Request} req
 */
function buildCtx(req) {
  return {
    user: req.user || null,
    enquiryToken: req.enquiryToken || null,
    sessionKey: req.headers['x-session-key'] || null,
  };
}

/**
 * POST /api/enquiries
 * Create a transport enquiry. Works for guests — no login required.
 *
 * RESPONSE CONTRACT (do not narrow this)
 * ---------------------------------------
 * Everything the NEXT page needs is returned here, so the frontend can navigate
 * immediately and render the enquiry without a second round trip:
 *
 *   {
 *     success: true,
 *     data: {
 *       enquiryId:   "<db primary key>",     numeric id, backend-generated
 *       enquiry_id:  "<same value>",         alias, for callers used to the DTO key
 *       enquiryNumber: "BTB-YYYYMMDD-NNNNNN", canonical number used in the URL
 *       bookingId:   null | "<id>",           set only once a Booking row exists
 *       booking_id:  null | "<same value>",   alias
 *       enquiry:     { ...customer DTO... },  the COMPLETE renderable enquiry
 *       enquiry_token, token_expires_at, redirect_to
 *     }
 *   }
 *
 * SYNCHRONISATION GUARANTEE
 * EnquiryService.createEnquiry writes the enquiry row, the canonical number and
 * the ENQUIRY_CREATED audit event inside ONE `prisma.$transaction`, and awaits
 * every write. The `loadForCustomer` + `listEvents` reads below happen AFTER that
 * transaction has committed, so a client that navigates on this response can
 * never observe a partially-created enquiry.
 */
const createEnquiry = asyncHandler(async (req, res) => {
  const { enquiry, accessToken } = await enquiryService.createEnquiry(req.body || {}, buildCtx(req));

  // Read AFTER the creating transaction has committed (see the note above).
  // Return the freshly-shaped customer DTO so the confirmation page can render
  // immediately without a second round trip.
  const fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });

  const enquiryNumber = enquiry.enquiry_number;
  // Pre-booking: no Booking row exists until the customer accepts a quote, so
  // this is null today. Returned explicitly so the contract does not change when
  // a booking starts being created inline.
  const bookingId = enquiry.booking_id != null ? enquiry.booking_id : null;

  res.status(201).json({
    success: true,
    message: 'Your transport request has been received',
    data: {
      // ── Identifiers, straight from the database ──────────────────────────
      enquiryId: enquiry.enquiry_id,
      enquiry_id: enquiry.enquiry_id,
      enquiryNumber,
      enquiry_number: enquiryNumber,
      bookingId,
      booking_id: bookingId,
      // ── The complete, renderable enquiry ────────────────────────────────
      enquiry: toCustomerEnquiry(fresh, events),
      // A guest receives a scoped token so they can return to this enquiry
      // without creating an account. A logged-in customer gets `null` and uses
      // their normal session instead.
      enquiry_token: accessToken ? accessToken.token : null,
      token_expires_at: accessToken ? accessToken.expiresAt : null,
      // Where the frontend should send the customer.
      redirect_to: `/booking/enquiry/${enquiryNumber}`,
    },
  });
});

/**
 * GET /api/enquiries/:idOrNumber
 * Full customer-facing detail, including the live status timeline.
 */
const getEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  enquiryService.assertCustomerAccess(enquiry, buildCtx(req));

  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });

  res.json({
    success: true,
    data: toCustomerEnquiry(enquiry, events),
  });
});

/**
 * GET /api/enquiries/:idOrNumber/status
 * Compact status payload — the polling fallback for the live page.
 */
const getStatus = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  enquiryService.assertCustomerAccess(enquiry, buildCtx(req));

  const status = await enquiryService.getStatus(enquiry.enquiry_id);
  res.json({ success: true, data: status });
});

/**
 * GET /api/enquiries/:idOrNumber/quote
 * The quote card: estimate, final quote, and whether a decision is pending.
 *
 * DRAFT-QUOTE GATE: a price an admin has typed but not yet sent is internal.
 * Until the status reaches AWAITING_CUSTOMER_ACCEPTANCE this endpoint reports
 * `final_quoted_price: null`, so a draft can never be read out of this endpoint
 * even if the client asks directly.
 */
const getQuote = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  enquiryService.assertCustomerAccess(enquiry, buildCtx(req));

  const awaitsDecision = enquiry.status === 'AWAITING_CUSTOMER_ACCEPTANCE';
  const quotePublished = isQuoteVisibleToCustomer(enquiry.status);

  res.json({
    success: true,
    data: {
      enquiry_id: enquiry.enquiry_id,
      enquiry_number: enquiry.enquiry_number,
      price_status: enquiry.price_status,
      estimated_price_min: enquiry.estimated_price_min,
      estimated_price_max: enquiry.estimated_price_max,
      final_quoted_price: quotePublished ? enquiry.final_quoted_price : null,
      quote_remarks: quotePublished ? enquiry.quote_remarks || null : null,
      quoted_at: enquiry.quoted_at || null,
      // Tells the UI which buttons to render, but the server re-validates the
      // status on accept/reject — this is a hint, never an authorisation.
      action_required: awaitsDecision,
      accepted_at: enquiry.accepted_at || null,
      rejected_at: enquiry.rejected_at || null,
      contact: getCustomerCare(),
    },
  });
});

/**
 * POST /api/enquiries/:idOrNumber/accept
 * Customer accepts the final quote → a canonical Booking is created.
 */
const acceptQuote = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  const result = await enquiryService.customerAccept(enquiry.enquiry_id, buildCtx(req));

  const fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });

  res.json({
    success: true,
    message: result.alreadyAccepted
      ? 'This quote was already accepted'
      : 'Quote accepted. Your trip is confirmed.',
    data: {
      enquiry: toCustomerEnquiry(fresh, events),
      booking: result.booking
        ? {
            booking_id: result.booking.booking_id,
            booking_number: result.booking.booking_number,
            status: result.booking.status,
          }
        : null,
    },
  });
});

/**
 * POST /api/enquiries/:idOrNumber/reject
 * Customer declines the final quote.
 */
const rejectQuote = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  const result = await enquiryService.customerReject(
    enquiry.enquiry_id,
    buildCtx(req),
    { reason: req.body?.reason }
  );

  const fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });

  res.json({
    success: true,
    message: 'We have recorded your decision. Our team will get in touch.',
    data: {
      enquiry: toCustomerEnquiry(fresh, events),
      already_rejected: Boolean(result.alreadyRejected),
    },
  });
});

/**
 * POST /api/enquiries/:idOrNumber/cancel
 * Customer cancels the request (pre-confirmation only).
 */
const cancelEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.idOrNumber);
  const result = await enquiryService.customerCancel(
    enquiry.enquiry_id,
    buildCtx(req),
    { reason: req.body?.reason }
  );

  const fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);

  res.json({
    success: true,
    message: 'Your request has been cancelled.',
    data: {
      enquiry: toCustomerEnquirySummary(fresh),
      already_cancelled: Boolean(result.alreadyCancelled),
    },
  });
});

/**
 * GET /api/enquiries/my
 * The caller's own enquiries. Requires a logged-in user OR a guest session key.
 */
const listMyEnquiries = asyncHandler(async (req, res) => {
  const sessionKey = req.headers['x-session-key'] || req.query.session_key;

  if (!req.user && !sessionKey) {
    throw new NotFoundError({
      message: 'Sign in or provide a session key to list your enquiries',
    });
  }

  const result = await enquiryService.listForCustomer({
    userId: req.user?.user_id,
    sessionKey: typeof sessionKey === 'string' ? sessionKey : null,
    page: req.query.page,
    pageSize: req.query.page_size,
  });

  res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: result.total,
      page: result.page,
      page_size: result.pageSize,
      total_pages: result.totalPages,
    },
  });
});

/**
 * GET /api/enquiries/config/customer-care
 * The published support profile + a ready-to-open WhatsApp link for an enquiry.
 *
 * Public by design: the customer needs this on the confirmation page before
 * any authentication. It contains only company-controlled contact details.
 */
const getCustomerCareConfig = asyncHandler(async (req, res) => {
  const care = getCustomerCare();
  const enquiryNumber = typeof req.query.enquiry_number === 'string' ? req.query.enquiry_number : null;

  let whatsappUrl = care.whatsappUrl;
  if (enquiryNumber) {
    // Build the message from the LIVE enquiry, never from client-supplied text.
    try {
      const enquiry = await enquiryService.loadByNumber(enquiryNumber);
      whatsappUrl = buildEnquiryWhatsAppUrl(enquiry, 'help');
    } catch {
      // Unknown number → fall back to the generic help message rather than
      // failing the whole request.
      whatsappUrl = buildEnquiryWhatsAppUrl({ enquiry_number: enquiryNumber }, 'help');
    }
  }

  res.json({
    success: true,
    data: { ...care, whatsappUrl },
  });
});

module.exports = {
  createEnquiry,
  getEnquiry,
  getStatus,
  getQuote,
  acceptQuote,
  rejectQuote,
  cancelEnquiry,
  listMyEnquiries,
  getCustomerCareConfig,
  resolveEnquiry,
  buildCtx,
};
