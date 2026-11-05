/**
 * adminEnquiryRoutes.js
 * ---------------------------------------------------------------------------
 * Admin enquiry management, mounted at /api/admin/enquiries.
 *
 * Every route is behind `protect` (JWT verification) AND `adminOnly` (role
 * check), matching the existing admin surface. The mount point in server.js is
 * registered BEFORE /api/admin so this module is the single source of truth for
 * GET /api/admin/enquiries and is never shadowed by adminRoutes.
 *
 * STATIC ROUTES BEFORE PARAM ROUTES
 *   /stats and /options are declared before /:id, otherwise "stats" would be
 *   matched as an enquiry id.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { protect, adminOnly } = require('../middleware/auth');
const controller = require('../controllers/adminEnquiryController');
const quotationController = require('../controllers/quotationController');

const router = express.Router();

/**
 * Write endpoints (assign / quote / cancel) get a tighter budget than reads:
 * they are the operations that change a customer's contract.
 */
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth gate applied to the whole router.
router.use(protect, adminOnly);

// ── Static routes FIRST ────────────────────────────────────────────────

/** GET /api/admin/enquiries/stats — counts for the filter chips. */
router.get('/stats', readLimiter, controller.getStats);

/** GET /api/admin/enquiries/options — assignable vehicles/drivers/partners/owners. */
router.get('/options', readLimiter, controller.getOptions);

/** GET /api/admin/enquiries — list + search + filter + paginate. */
router.get('/', readLimiter, controller.listEnquiries);

// ── Single enquiry ─────────────────────────────────────────────────────

/** GET /api/admin/enquiries/:id — full workspace payload + audit history. */
router.get('/:id', readLimiter, controller.getEnquiry);

/** PATCH /api/admin/enquiries/:id — review state / internal note. */
router.patch('/:id', writeLimiter, controller.patchEnquiry);

/** POST /api/admin/enquiries/:id/assign — vehicle + driver + partner + owner. */
router.post('/:id/assign', writeLimiter, controller.assign);

/** POST /api/admin/enquiries/:id/quote — save the final quote (draft). */
router.post('/:id/quote', writeLimiter, controller.saveQuote);

/** POST /api/admin/enquiries/:id/send-quote — publish to the customer. */
router.post('/:id/send-quote', writeLimiter, controller.sendQuote);

/** POST /api/admin/enquiries/:id/reassign — change resources on a live enquiry. */
router.post('/:id/reassign', writeLimiter, controller.reassign);

/** POST /api/admin/enquiries/:id/cancel — admin cancellation. */
router.post('/:id/cancel', writeLimiter, controller.cancelEnquiry);

// ─────────────────────────────────────────────────────────────────────────
// PHASE B — THE REAL QUOTATION / RATE MODULE (client document §2, §3)
//
// The ENQUIRY is the canonical quotation source:
//     ENQUIRY → GIVE RATE → RATE QUOTED → CONFIRM ORDER → ORDER CONFIRMED
//
// These endpoints replace the Booking-based quote path in the quotation
// workflow. They sit behind the SAME protect + adminOnly gate and the SAME
// writeLimiter as every other enquiry mutation — no new trust boundary is
// introduced. The legacy /quote and /send-quote endpoints above are left
// untouched so existing flows keep working during the transition.
// ─────────────────────────────────────────────────────────────────────────

/** GET /:id/quotation — the persisted quotation (or null). */
router.get('/:id/quotation', readLimiter, quotationController.getQuotation);

/** POST /:id/quotation — "[Save Quotation]": saves the rate. */
router.post('/:id/quotation', writeLimiter, quotationController.saveQuotation);

/** POST /:id/quotation/send — "[Send Quotation]": publishes it, enquiry stays OPEN. */
router.post('/:id/quotation/send', writeLimiter, quotationController.sendQuotation);

/** GET /:id/quotation/download — "[Download Quotation]": real PDF from the DB. */
router.get('/:id/quotation/download', readLimiter, quotationController.downloadQuotation);

/** POST /:id/quotation/confirm-order — "[Confirm Order]": converts to ONE order. */
router.post('/:id/quotation/confirm-order', writeLimiter, quotationController.confirmOrder);

module.exports = router;
