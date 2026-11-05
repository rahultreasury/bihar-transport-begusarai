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

/** Public, non-sensitive reads: /my and the published customer-care profile. */
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * THE CUSTOMER-PAGE READ BUDGET — keyed by (IP, enquiry number), not by IP alone.
 *
 * WHY THIS CHANGED
 * ---------------
 * A single shared per-IP bucket of 300 / 5 min was being drained by ONE stale
 * browser tab, and the next customer's page load was rejected with 429 before it
 * ever reached assertCustomerAccess. Measured on the failing machine: four tabs
 * parked on enquiry numbers that no longer exist produced 144 requests in 30
 * seconds, all of them `GET /api/enquiries/:number` and `/quote`, and the whole
 * IP-wide bucket went to 0 within ~85 seconds. Every other customer behind the
 * same address then saw "We couldn't load your request status".
 *
 * A customer's read budget belongs to the PAGE, not to the address. Every read
 * of `/:idOrNumber/*` must already carry either the caller's user JWT or a token
 * scoped to that one enquiry (see EnquiryService.assertCustomerAccess), so a
 * caller who holds a valid token can only ever spend this budget on the ONE
 * enquiry they are entitled to. Keying per enquiry therefore does not weaken the
 * limit against scraping — it removes the cross-customer contamination where one
 * misbehaving page locks out everyone else on the same NAT / office IP.
 *
 * THE NUMBER
 * The confirmation page polls every 12 s and each tick performs two reads (the
 * enquiry and its quote): 10 requests/min = 50 per 5-minute window. 200 leaves
 * 4x headroom for the socket-driven refreshes and a burst of tab restores, and
 * is still a hard stop: a runaway loop is throttled, never served.
 */
const customerReadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${req.ip}|${String(req.params?.idOrNumber || 'unknown').toUpperCase()}`,
  message: {
    success: false,
    message:
      'Too many status checks for this request. Please wait a moment and try again, or call customer care.',
    errorCode: 'RATE_LIMITED',
  },
});

/**
 * An absolute per-IP ceiling for the whole customer read surface, on top of the
 * per-enquiry budget. Defence in depth for a device that opens many enquiries at
 * once; it is deliberately generous so a shared office connection is never the
 * thing that breaks a customer.
 */
const customerReadCeiling = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 900,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      'Too many status checks from this device. Please wait a moment and try again, or call customer care.',
    errorCode: 'RATE_LIMITED',
  },
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

/**
 * Both limiters are hard caps and both stay. The per-enquiry one is what stops
 * one page exhausting a shared address; the per-IP ceiling is the backstop.
 */
const customerReads = [customerReadCeiling, customerReadLimiter, optionalAuth];

router.get('/:idOrNumber', customerReads, controller.getEnquiry);
router.get('/:idOrNumber/status', customerReads, controller.getStatus);
router.get('/:idOrNumber/quote', customerReads, controller.getQuote);

// ── Customer actions (server-authoritative) ───────────────────────────

router.post('/:idOrNumber/accept', actionLimiter, optionalAuth, controller.acceptQuote);
router.post('/:idOrNumber/reject', actionLimiter, optionalAuth, controller.rejectQuote);
router.post('/:idOrNumber/cancel', actionLimiter, optionalAuth, controller.cancelEnquiry);

module.exports = router;
