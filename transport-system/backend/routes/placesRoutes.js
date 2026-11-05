/**
 * placesRoutes.js
 * ---------------------------------------------------------------------------
 * Customer place lookup, mounted at /api/places.
 *
 * A NEW namespace: no existing route is touched, renamed or shadowed, so the
 * web application is unaffected.
 *
 * These are PUBLIC because a customer typing a pickup address is not signed in
 * yet — the same public surface as the pricing estimate, which is also
 * required before authentication.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { autocompleteHandler, placeDetailsHandler } = require('../controllers/placesController');

const router = express.Router();

/**
 * Place suggestions are typed a character at a time, so the budget is per
 * IP but generous enough for a burst of typing. It is still a hard stop.
 */
const placesLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many location searches. Please wait a moment and try again.',
    errorCode: 'RATE_LIMITED',
  },
});

// GET /api/places/autocomplete?q=...&region=in
router.get('/autocomplete', placesLimiter, autocompleteHandler);

// GET /api/places/details?place_id=...
router.get('/details', placesLimiter, placeDetailsHandler);

module.exports = router;
