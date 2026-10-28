const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const BookingService = require('../services/BookingService');
const rateLimit = require('express-rate-limit');

const bookingService = new BookingService();

const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/tracking/bookings/:bookingReference
router.get(
  '/bookings/:bookingReference',
  trackingLimiter,
  asyncHandler(async (req, res) => {
    const reference = req.params.bookingReference;
    const data = await bookingService.getBookingForTracking(reference);
    return res.json({
      success: true,
      data,
    });
  })
);

module.exports = router;
