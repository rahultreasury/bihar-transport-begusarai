/**
 * adminEnquiryController
 * ---------------------------------------------------------------------------
 * HTTP boundary for ADMIN enquiry management.
 *
 * Public surface (all behind `protect` + `adminOnly`):
 *   GET   /api/admin/enquiries              list + search + filters + pagination
 *   GET   /api/admin/enquiries/stats        counts for the filter chips
 *   GET   /api/admin/enquiries/options      assignable vehicles/drivers/partners/owners
 *   GET   /api/admin/enquiries/:id          full workspace payload + audit history
 *   PATCH /api/admin/enquiries/:id          update review state / internal notes
 *   POST  /api/admin/enquiries/:id/assign   assign vehicle + driver + partner + owner
 *   POST  /api/admin/enquiries/:id/quote    save the final quote (draft)
 *   POST  /api/admin/enquiries/:id/send-quote  send it to the customer
 *   POST  /api/admin/enquiries/:id/reassign change resources on a live enquiry
 *   POST  /api/admin/enquiries/:id/cancel   admin cancellation
 *
 * TRUST BOUNDARY
 * The admin identity comes from the verified JWT — never from a posted
 * `admin_id`. Resource ids and prices posted by the browser are re-validated
 * against the database in EnquiryService / EnquiryAssignmentService before
 * anything is written.
 */

const asyncHandler = require('../middleware/asyncHandler');
const enquiryService = require('../services/EnquiryService');
const assignmentService = require('../services/EnquiryAssignmentService');
const eventService = require('../services/EnquiryEventService');
const { toAdminEnquiry, toAdminEnquiryRow } = require('../dtos/EnquiryDTO');
const { logger } = require('../utils/logger');
const { ValidationError } = require('../utils/AppError');

/**
 * Extract the verified admin principal from `req.user` (populated by `protect`).
 * @param {import('express').Request} req
 * @returns {{adminId:number, adminName:string, role:string}}
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
 * canonical enquiry number so an admin can paste either into the workspace URL.
 * @param {string} idOrNumber
 */
async function resolveEnquiry(idOrNumber) {
  const raw = String(idOrNumber || '').trim();
  if (!raw) throw new ValidationError({ message: 'Enquiry id or number is required' });
  if (/^\d+$/.test(raw)) return enquiryService.loadForAdmin(Number(raw));

  const byNumber = await enquiryService.loadByNumber(raw);
  return enquiryService.loadForAdmin(byNumber.enquiry_id);
}

/**
 * GET /api/admin/enquiries
 */
const listEnquiries = asyncHandler(async (req, res) => {
  const result = await enquiryService.listForAdmin({
    search: req.query.search || req.query.q,
    status: req.query.status,
    price_status: req.query.price_status,
    pickup_date_from: req.query.pickup_date_from,
    pickup_date_to: req.query.pickup_date_to,
    page: req.query.page,
    page_size: req.query.page_size || req.query.limit,
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
 * GET /api/admin/enquiries/stats
 * Counts per filter chip, so the admin table can show "New (12)" badges.
 */
const getStats = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/prisma');

  const groupByStatus = await prisma.enquiry.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const counts = groupByStatus.reduce((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  // Mirror the UI filter chips so the frontend does not re-derive the mapping.
  const chips = {
    ALL: Object.values(counts).reduce((a, b) => a + b, 0),
    NEW: (counts.ENQUIRY_SUBMITTED || 0),
    REVIEWING: (counts.ADMIN_REVIEW || 0) + (counts.ASSIGNMENT_PENDING || 0),
    ASSIGNMENT_PENDING:
      (counts.ASSIGNMENT_PENDING || 0) + (counts.VEHICLE_ASSIGNED || 0) + (counts.DRIVER_ASSIGNED || 0),
    QUOTE_PENDING: counts.QUOTE_READY || 0,
    AWAITING_CUSTOMER: counts.AWAITING_CUSTOMER_ACCEPTANCE || 0,
    ACCEPTED: counts.CUSTOMER_ACCEPTED || 0,
    CONFIRMED: (counts.CONFIRMED || 0) + (counts.IN_PROGRESS || 0) + (counts.COMPLETED || 0),
    CANCELLED: (counts.CANCELLED || 0) + (counts.CUSTOMER_REJECTED || 0),
  };

  res.json({ success: true, data: chips });
});

/**
 * GET /api/admin/enquiries/options
 * Assignable resources for the workspace dropdowns.
 */
const getOptions = asyncHandler(async (req, res) => {
  const options = await assignmentService.listAssignableOptions();
  res.json({ success: true, data: options });
});

/**
 * GET /api/admin/enquiries/:id
 * The full admin workspace payload, including the complete audit history.
 */
const getEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);

  // Audit: opening the workspace is a recorded admin action.
  const admin = adminFrom(req);
  await enquiryService.markAdminViewed(enquiry.enquiry_id, admin);

  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    data: toAdminEnquiry(enquiry, events),
  });
});

/**
 * PATCH /api/admin/enquiries/:id
 * Update the review state. Deliberately narrow: a PATCH here can advance the
 * enquiry into review and store an internal note, but it can NEVER set the
 * final price or the status directly — those go through the quote and
 * send-quote endpoints so the audit trail cannot be bypassed.
 */
const patchEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const { status, note } = req.body || {};

  if (!status && !note) {
    throw new ValidationError({ message: 'Provide a status and/or a note to update' });
  }

  if (status) {
    // Delegates to a validated, audited transition. The service rejects any
    // status that is not one of the two review markers, so a caller cannot
    // shortcut the lifecycle to CONFIRMED or set a price from here.
    await enquiryService.adminSetReviewStatus(enquiry.enquiry_id, status, admin, { note });
  } else {
    await eventService.addEvent({
      enquiryId: enquiry.enquiry_id,
      eventType: 'NOTE_ADDED',
      actorType: 'ADMIN',
      actorId: admin.adminId,
      actorName: admin.adminName,
      message: String(note).slice(0, 500),
      customerVisible: false,
    });
  }

  const fresh = await enquiryService.loadForAdmin(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    message: 'Enquiry updated',
    data: toAdminEnquiry(fresh, events),
  });
});

/**
 * POST /api/admin/enquiries/:id/assign
 */
const assign = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const updated = await enquiryService.adminAssign(enquiry.enquiry_id, req.body || {}, admin);

  const fresh = await enquiryService.loadForAdmin(updated.enquiry_id);
  const events = await eventService.listEvents(updated.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    message: 'Assignment saved',
    data: toAdminEnquiry(fresh, events),
  });
});

/**
 * POST /api/admin/enquiries/:id/quote
 * Save the final quote as a draft (customer not notified).
 */
const saveQuote = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  await enquiryService.adminSetQuote(enquiry.enquiry_id, req.body || {}, admin);

  const fresh = await enquiryService.loadForAdmin(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    message: 'Quotation saved. Send it to the customer when you are ready.',
    data: toAdminEnquiry(fresh, events),
  });
});

/**
 * POST /api/admin/enquiries/:id/send-quote
 * Publish the quote to the customer → AWAITING_CUSTOMER_ACCEPTANCE.
 */
const sendQuote = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const { enquiry: updated, alreadySent } = await enquiryService.adminSendQuote(
    enquiry.enquiry_id,
    admin
  );

  const fresh = await enquiryService.loadForAdmin(updated.enquiry_id);
  const events = await eventService.listEvents(updated.enquiry_id, { customerVisibleOnly: false });

  logger.info(
    { enquiryId: updated.enquiry_id, adminId: admin.adminId, price: updated.final_quoted_price },
    alreadySent ? 'enquiry.quote_send_duplicate' : 'enquiry.quote_sent'
  );

  res.json({
    success: true,
    // Idempotent by design: a repeated send is a no-op the operator can see,
    // not a failure they have to dismiss.
    message: alreadySent
      ? 'This quote was already sent to the customer'
      : 'Quote sent to the customer. They have been notified.',
    already_sent: Boolean(alreadySent),
    data: toAdminEnquiry(fresh, events),
  });
});

/**
 * POST /api/admin/enquiries/:id/reassign
 */
const reassign = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const updated = await enquiryService.adminReassign(enquiry.enquiry_id, req.body || {}, admin);

  const fresh = await enquiryService.loadForAdmin(updated.enquiry_id);
  const events = await eventService.listEvents(updated.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    message: 'Resources reassigned',
    data: toAdminEnquiry(fresh, events),
  });
});

/**
 * POST /api/admin/enquiries/:id/cancel
 */
const cancelEnquiry = asyncHandler(async (req, res) => {
  const enquiry = await resolveEnquiry(req.params.id);
  const admin = adminFrom(req);

  const result = await enquiryService.adminCancel(enquiry.enquiry_id, admin, {
    reason: req.body?.reason,
  });

  const fresh = await enquiryService.loadForAdmin(enquiry.enquiry_id);
  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: false });

  res.json({
    success: true,
    message: result.alreadyCancelled ? 'Enquiry was already cancelled' : 'Enquiry cancelled',
    data: toAdminEnquiry(fresh, events),
  });
});

module.exports = {
  listEnquiries,
  getStats,
  getOptions,
  getEnquiry,
  patchEnquiry,
  assign,
  saveQuote,
  sendQuote,
  reassign,
  cancelEnquiry,
  adminFrom,
  resolveEnquiry,
  toAdminEnquiryRow,
};
