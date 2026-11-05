/**
 * driverEnquiryRoutes.js
 * ---------------------------------------------------------------------------
 * Driver-facing enquiry API, mounted at /api/driver/enquiries.
 *
 * There is intentionally NO cancel endpoint and NO price endpoint. A driver
 * cannot end a customer's booking, and cannot see or change the price the
 * customer agreed to. The only lever they have is a reassignment REQUEST,
 * which an admin resolves.
 *
 * Identity comes from the verified JWT on every route.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { protect } = require('../middleware/auth');
const controller = require('../controllers/driverEnquiryController');

const router = express.Router();

const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please contact dispatch if this is urgent.',
  },
});

router.use(protect);

/** GET /api/driver/enquiries — jobs assigned to the authenticated driver. */
router.get('/', readLimiter, controller.listMyEnquiries);

/** GET /api/driver/enquiries/:id — one assigned job. */
router.get('/:id', readLimiter, controller.getMyEnquiry);

/** POST /api/driver/enquiries/:id/report-issue */
router.post('/:id/report-issue', requestLimiter, controller.reportIssue);

/** POST /api/driver/enquiries/:id/request-reassignment */
router.post('/:id/request-reassignment', requestLimiter, controller.requestReassignment);

module.exports = router;
