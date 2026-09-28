/**
 * enquiryRoutes.js
 * ---------------------------------------------------------------------------
 * Customer-facing enquiry API, mounted at /api/enquiries.
 *
 * ROUTE ORDER MATTERS
 *   /my and /config/customer-care are declared BEFORE /:idOrNumber so the
 *   literal segments are not swallowed by the parameterised route.
 *
 * AUTHORISATION MODEL
 *   • POST /                    public — this is the endpoint that removed the
 *                                login wall. optionalAuth attaches a customer_id
 *                                when one is available and is a no-op otherwise.
 *   • GET /:idOrNumber/*        requires proof of ownership: either the caller's
 *                                own user JWT or a scoped enquiry-access token.
 *                                Enforced by EnquiryService.assertCustomerAccess.
 *   • POST /:idOrNumber/accept  same ownership proof, and the transition itself
 *                                is re-validated server-side.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { optionalAuth } = require('../middleware/optionalAuth');
const controller = require('../controllers/enquiryController');

const router = express.Router();

/**
 * Creating an enquiry is the highest-value abuse target (spam, fake bookings),
 * so it gets a much tighter budget than the read endpoints.
 */
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many enquiries submitted from this device. Please try again in a few minutes or call customer care.',
  },
});

/** Accept/reject/cancel are state-changing and must not be hammered. */
const actionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again shortly.',
  },
});

/** Read endpoints — a light limit to blunt scraping without hurting polling. */
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Literal routes FIRST (must precede /:idOrNumber) ───────────────────

/**
 * GET /api/enquiries/my
 * The caller's own enquiries (logged-in user, or guest session key).
 */
router.get('/my', readLimiter, optionalAuth, controller.listMyEnquiries);

/**
 * GET /api/enquiries/config/customer-care
 * Public support profile + a pre-filled WhatsApp deep link.
 */
router.get('/config/customer-care', readLimiter, controller.getCustomerCareConfig);

// ── Create ─────────────────────────────────────────────────────────────

/**
 * POST /api/enquiries
 * Create a transport enquiry. No login required.
 */
router.post('/', createLimiter, optionalAuth, controller.createEnquiry);

// ── Read one ───────────────────────────────────────────────────────────

router.get('/:idOrNumber', readLimiter, optionalAuth, controller.getEnquiry);
router.get('/:idOrNumber/status', readLimiter, optionalAuth, controller.getStatus);
router.get('/:idOrNumber/quote', readLimiter, optionalAuth, controller.getQuote);

// ── Customer actions (server-authoritative) ───────────────────────────

router.post('/:idOrNumber/accept', actionLimiter, optionalAuth, controller.acceptQuote);
router.post('/:idOrNumber/reject', actionLimiter, optionalAuth, controller.rejectQuote);
router.post('/:idOrNumber/cancel', actionLimiter, optionalAuth, controller.cancelEnquiry);

module.exports = router;
