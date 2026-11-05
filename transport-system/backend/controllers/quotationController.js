/**
 * quotationController.js
 * ---------------------------------------------------------------------------
 * PHASE B — HTTP boundary for the REAL Quotation / Rate module.
 * Client document §2 "QUOTATION / RATE", §3 "PARTY CONFIRMS".
 *
 * Public surface (all behind `protect` + `adminOnly`, same as the rest of the
 * admin enquiry surface):
 *   GET  /api/admin/enquiries/:id/quotation           read the persisted quote
 *   POST /api/admin/enquiries/:id/quotation           Save Quotation
 *   POST /api/admin/enquiries/:id/quotation/send      Send Quotation
 *   GET  /api/admin/enquiries/:id/quotation/download  Download Quotation (PDF)
 *   POST /api/admin/enquiries/:id/quotation/confirm-order  Confirm Order
 *
 * TRUST BOUNDARY — UNCHANGED FROM THE REST OF THE ADMIN SURFACE
 *   • The admin identity comes from the verified JWT, never from a posted
 *     admin_id.
 *   • NO money is trusted from the request body. Every total posted is
 *     recomputed in QuotationService and the server value overwrites it. The
 *     controller never adds, adjusts or "fixes" a figure itself.
 *   • Download renders ONLY the persisted row. Send carries no money at all.
 *   • Confirm Order reads the persisted quotation and delegates to the existing,
 *     already-secured EnquiryService.customerAccept() path.
 */

const asyncHandler = require('../middleware/asyncHandler');
// The existing shared EnquiryService singleton — the SAME instance the rest of
// the admin surface uses. Reused (not re-constructed) so Confirm Order reaches
// the canonical customerAccept() with all of its existing guards intact.
const enquiryService = require('../services/EnquiryService');
const QuotationService = require('../services/QuotationService');
const { renderQuotationPdf } = require('../services/QuotationPdf');
const { logger } = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../utils/AppError');

// ONE service instance for the whole process. It is constructed with the
// EXISTING EnquiryService singleton so Confirm Order reuses the canonical,
// idempotent acceptance path rather than building a second order-creation
// mechanism.
const quotationService = new QuotationService({ enquiryService });

/**
 * Extract the verified admin principal from `req.user` (populated by `protect`).
 * Mirrors adminEnquiryController.adminFrom so both surfaces behave identically.
 */
function adminFrom(req) {
  if (!req.user) {
    throw new ValidationError({ message: 'Admin identity missing from token' });
  }
  return {
    adminId: req.user.user_id,
    adminName: req.user.first_name || 'Bihar Transport Admin',
    role: req.user.role,
  };
}

/**
 * Resolve a route param to an enquiry row. Accepts the numeric id or the
 * canonical enquiry number, exactly like the rest of the admin surface.
 */
async function resolveEnquiry(idOrNumber) {
  const raw = String(idOrNumber || '').trim();
  if (!raw) throw new ValidationError({ message: 'Enquiry id or number is required' });
  if (/^\d+$/.test(raw)) return enquiryService.loadForAdmin(Number(raw));
  const byNumber = await enquiryService.loadByNumber(raw);
  return enquiryService.loadForAdmin(byNumber.enquiry_id);
}

/**
 * Public projection of a persisted quotation for the admin UI.
 * Mirrors the persisted values exactly — the UI renders what the server stored.
 */
function present(quotation) {
  if (!quotation) return null;
  return {
    quotation_id: quotation.quotation_id,
    quotation_number: quotation.quotation_number,
    enquiry_id: quotation.enquiry_id,
    status: quotation.status,
    rate_type: quotation.rate_type,
    rate: quotation.rate,
    freight: quotation.freight,
    total_freight: quotation.total_freight,
    gst_type: quotation.gst_type,
    gst_percentage: quotation.gst_percentage,
    gst_amount: quotation.gst_amount,
    total_additional_charges: quotation.total_additional_charges,
    additional_charges_tax: quotation.additional_charges_tax,
    total_billing_amount: quotation.total_billing_amount,
    validity_days: quotation.validity_days,
    valid_until: quotation.valid_until,
    payment_schedule_type: quotation.payment_schedule_type,
    payment_schedule_label: QuotationService.SCHEDULE_LABELS[quotation.payment_schedule_type] || null,
    booking_amount: quotation.booking_amount,
    advance_after_loading_percentage: quotation.advance_after_loading_percentage,
    schedule_total: quotation.schedule_total,
    schedule_remaining: quotation.schedule_remaining,
    remarks: quotation.remarks,
    additional_charges: quotation.quotation_charges || [],
    milestones: quotation.quotation_milestones || [],
    quoted_at: quotation.quoted_at,
    sent_at: quotation.sent_at,
    confirmed_at: quotation.confirmed_at,
    created_at: quotation.created_at,
    updated_at: quotation.updated_at,
  };
}

/**
 * GET /api/admin/enquiries/:id/quotation
 * The persisted quotation, or `{ quotation: null }` when never quoted.
 */
const getQuotation = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const quotation = await quotationService.getQuotation(enquiry.enquiry_id);

  res.json({
    success: true,
    data: {
      enquiry_id: enquiry.enquiry_id,
      enquiry_number: enquiry.enquiry_number,
      // Lets the UI enable/disable each of the four client buttons truthfully.
      enquiry_status: enquiry.status,
      has_order: Boolean(enquiry.booking_id),
      quotation: present(quotation),
    },
  });
});

/**
 * POST /api/admin/enquiries/:id/quotation   — "[Save Quotation]"
 * Client document §2: "Save Quotation — saves the rate."
 */
const saveQuotation = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const quotation = await quotationService.saveQuotation(enquiry.enquiry_id, req.body || {}, admin);

  res.json({
    success: true,
    message: 'Quotation saved.',
    // Every figure below is the server-computed one, not an echo of the request.
    data: present(quotation),
  });
});

/**
 * POST /api/admin/enquiries/:id/quotation/send   — "[Send Quotation]"
 * Client document §2: "If the customer wants time, use Send Quotation and leave
 * the enquiry open." → this endpoint NEVER creates an order.
 */
const sendQuotation = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const { quotation, alreadySent } = await quotationService.sendQuotation(enquiry.enquiry_id, admin);

  const fresh = await resolveEnquiry(enquiry.enquiry_id);

  res.json({
    success: true,
    message: alreadySent
      ? 'Quotation was already sent to the customer.'
      : 'Quotation sent to the customer. The enquiry remains open.',
    data: {
      quotation: present(quotation),
      already_sent: alreadySent,
      enquiry_status: fresh.status,
      // Explicit so the client can never infer that a sent quote is an order.
      order_created: Boolean(fresh.booking_id),
    },
  });
});

/**
 * GET /api/admin/enquiries/:id/quotation/download   — "[Download Quotation]"
 * A REAL PDF built from the persisted row. Admin-only.
 */
const downloadQuotation = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const quotation = await quotationService.getQuotation(enquiry.enquiry_id);

  if (!quotation) {
    throw new NotFoundError({ message: 'Save the quotation before downloading it.' });
  }

  const pdf = await renderQuotationPdf({ quotation, enquiry });

  // Filename is derived from the persisted quotation number — never user input.
  const filename = `${quotation.quotation_number}.pdf`;

  logger.info(
    { enquiryId: enquiry.enquiry_id, quotationId: quotation.quotation_id, bytes: pdf.length },
    'quotation.downloaded',
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

/**
 * POST /api/admin/enquiries/:id/quotation/confirm-order   — "[Confirm Order]"
 * Client document §3 "PARTY CONFIRMS".
 *
 * The customer may be confirming on the phone, so the operator performs this
 * from the quotation screen. It is the SAME conversion the customer performs
 * from their own page: EnquiryService.customerAccept() does the work, keeps its
 * atomic claim, its unique-booking guarantee and its claim-release-on-failure
 * behaviour. Retrying never creates a second order.
 */
const confirmOrder = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const result = await quotationService.confirmOrder(enquiry.enquiry_id, { admin });

  res.json({
    success: true,
    message: result.alreadyConfirmed
      ? 'This enquiry was already converted into an order.'
      : 'Order confirmed. The enquiry has been converted.',
    data: {
      quotation: present(result.quotation),
      order: result.booking
        ? {
            booking_id: result.booking.booking_id,
            booking_number: result.booking.booking_number,
            status: result.booking.status,
          }
        : null,
      already_confirmed: result.alreadyConfirmed,
      enquiry_id: enquiry.enquiry_id,
      enquiry_number: enquiry.enquiry_number,
    },
  });
});

module.exports = {
  getQuotation,
  saveQuotation,
  sendQuotation,
  downloadQuotation,
  confirmOrder,
  // exported for tests / wiring
  quotationService,
  present,
};
