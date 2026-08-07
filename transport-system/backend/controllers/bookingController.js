/**
 * BookingController
 * HTTP boundary for all booking-related requests.
 *
 * Responsibilities:
 * - Authenticate/authorize (admin role gates).
 * - Validate request params/body.
 * - Delegate to BookingService.
 * - Return structured JSON responses.
 * - Forward every error to the centralized error handler via next(error).
 */

const asyncHandler = require('../middleware/asyncHandler');
const BookingService = require('../services/BookingService');
const BookingAssignmentService = require('../services/BookingAssignmentService');
const { validateRequest } = require('../middleware/validateRequest');
const { logger } = require('../utils/logger');

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Factory that wires services into the controller.
 * @param {Object=} deps
 * @param {BookingService=} deps.bookingService
 * @param {BookingAssignmentService=} deps.assignmentService
 */
function createBookingController(deps = {}) {
  const bookingService = deps.bookingService || new BookingService();
  const assignmentService = deps.assignmentService || new BookingAssignmentService();

  /**
   * POST /api/bookings/create
   * Create a new transport booking.
   */
  const createBooking = asyncHandler(async (req, res, next) => {
    const {
      pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode,
      pickup_date, pickup_time,
      drop_location, drop_address, drop_city, drop_state, drop_pincode,
      goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile,
      vehicle_type_required, estimated_distance_km, estimated_price,
    } = req.body;

    const result = await bookingService.createBooking({
      booking_reference: `BTB-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
      user_id: req.user.user_id,
      pickup_location,
      pickup_address,
      pickup_city,
      pickup_state: pickup_state || 'Bihar',
      pickup_pincode,
      pickup_date,
      pickup_time,
      drop_location,
      drop_address,
      drop_city,
      drop_state: drop_state || 'Bihar',
      drop_pincode,
      goods_description,
      goods_type,
      goods_weight_kg,
      goods_volume,
      number_of_items: number_of_items || 1,
      fragile: fragile || false,
      vehicle_type_required,
      estimated_distance_km,
      estimated_price,
      final_price: estimated_price,
      status: 'pending',
    });

    logger.info({ userId: req.user.user_id, bookingId: result.booking_id }, 'booking.created');

    return res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking_id: result.booking_id,
        status: 'pending',
      },
    });
  });

  /**
   * GET /api/bookings/user/:id
   * Get all bookings for a user.
   */
  const getUserBookings = asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);

    if (req.user.user_id !== userId && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view these bookings' });
    }

    const bookings = await bookingService.searchBookings({ userId });

    return res.json({
      success: true,
      data: bookings,
      count: bookings.length,
    });
  });

  /**
   * GET /api/bookings/my-bookings
   * Get current user's bookings.
   */
  const getMyBookings = asyncHandler(async (req, res) => {
    const bookings = await bookingService.searchBookings({ userId: req.user.user_id });

    return res.json({
      success: true,
      data: bookings,
      count: bookings.length,
    });
  });

  /**
   * GET /api/bookings/:id
   * Get booking details.
   */
  const getBooking = asyncHandler(async (req, res, next) => {
    const bookingId = parseInt(req.params.id, 10);
    const booking = await bookingService.searchBookings({ bookingId });

    if (!booking || booking.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const b = booking[0];

    if (b.user_id !== req.user.user_id && !ADMIN_ROLES.includes(req.user.role) && req.user.role !== 'driver') {
      return res.status(403).json({ success: false, message: 'Not authorized to view this booking' });
    }

    return res.json({
      success: true,
      data: b,
    });
  });

  /**
   * PUT /api/bookings/:id/cancel
   * Cancel a booking.
   */
  const cancelBooking = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const result = await bookingService.cancelBooking(bookingId);

    logger.info({ userId: req.user.user_id, bookingId }, 'booking.cancelled');

    return res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: result,
    });
  });

  /**
   * POST /api/bookings/:id/quote/accept
   * Customer accepts the admin's final quote.
   */
  const acceptQuote = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const result = await bookingService.respondToQuote(bookingId, 'ACCEPT');

    logger.info({ userId: req.user.user_id, bookingId }, 'quote.accepted');

    return res.json({
      success: true,
      message: 'Quote accepted successfully',
      data: result,
    });
  });

  /**
   * POST /api/bookings/:id/quote/reject
   * Customer rejects the admin's final quote.
   */
  const rejectQuote = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const result = await bookingService.respondToQuote(bookingId, 'REJECT');

    logger.info({ userId: req.user.user_id, bookingId }, 'quote.rejected');

    return res.json({
      success: true,
      message: 'Quote rejected',
      data: result,
    });
  });

  /**
   * GET /api/bookings/track/:reference
   * Track booking by reference number.
   */
  const trackBooking = asyncHandler(async (req, res) => {
    const reference = req.params.reference;
    const data = await bookingService.getBookingForTracking(reference);

    return res.json({
      success: true,
      data,
    });
  });

  /**
   * GET /api/admin/bookings
   * Get all bookings (admin only).
   */
  const listBookings = asyncHandler(async (req, res) => {
    const { status, vehicle_type, page = 1, limit = 20 } = req.query;
    const filters = {};

    if (status) filters.status = status;
    if (vehicle_type) filters.vehicleType = vehicle_type;

    const bookings = await bookingService.searchBookings(filters);
    const total = bookings.length;

    return res.json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  });

  return {
    createBooking,
    getUserBookings,
    getMyBookings,
    getBooking,
    cancelBooking,
    acceptQuote,
    rejectQuote,
    trackBooking,
    listBookings,
  };
}

module.exports = { createBookingController };
