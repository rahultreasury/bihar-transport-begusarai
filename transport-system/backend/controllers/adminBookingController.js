/**
 * AdminBookingController
 * HTTP boundary for admin booking management endpoints.
 *
 * Responsibilities:
 * - Authenticate/authorize (admin role gates).
 * - Validate request params/body.
 * - Delegate to BookingService / BookingAssignmentService.
 * - Return structured JSON responses.
 * - Forward errors to centralized error handler.
 */

const asyncHandler = require('../middleware/asyncHandler');
const BookingService = require('../services/BookingService');
const BookingAssignmentService = require('../services/BookingAssignmentService');
const DriverManagementService = require('../services/DriverManagementService');
const TripFinancialService = require('../services/TripFinancialService');
const { validateRequest } = require('../middleware/validateRequest');
const { logger } = require('../utils/logger');

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Factory that wires services into the controller.
 * @param {Object=} deps
 * @param {BookingService=} deps.bookingService
 * @param {BookingAssignmentService=} deps.assignmentService
 */
function createAdminBookingController(deps = {}) {
  const bookingService = deps.bookingService || new BookingService();
  const assignmentService = deps.assignmentService || new BookingAssignmentService();
  const driverService = deps.driverService || new DriverManagementService();
  const tripFinancialService = deps.tripFinancialService || new TripFinancialService();

  /**
   * GET /api/admin/booking-drivers
   * Scalable driver lookup for the Booking Assignment picker (10,000+ drivers).
   * Server-side pagination + search + filters + trip stats in ONE call.
   * Each driver carries its assigned vehicle (one-driver-one-vehicle), so the
   * frontend never combines multiple APIs.
   *
   * @query page, limit, search, status, vehicle_type, min_rating
   */
  const getAssignableDrivers = asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      vehicle_type = '',
      min_rating = 0,
    } = req.query;

    const result = await driverService.listAssignableDrivers({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      status,
      vehicle_type,
      min_rating,
    });

    return res.json({
      success: true,
      data: result.drivers,
      pagination: result.pagination,
    });
  });

  /**
   * POST /api/admin/bookings/:id/send-quote
   * Send a final quote to the customer.
   */
  const sendQuote = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const { final_price, remarks, driver_id, vehicle_id, quote_validity_hours } = req.body || {};

    const result = await bookingService.sendQuoteWithReservation(bookingId, {
      final_price,
      remarks,
      driver_id,
      vehicle_id,
      quote_validity_hours,
      reserved_by: req.user.user_id,
    });

    logger.info({ adminId: req.user.user_id, bookingId }, 'admin.quote_sent');

    return res.json({
      success: true,
      message: 'Quote sent to customer',
      data: {
        booking_id: bookingId,
        final_price: Number(final_price),
        quote_status: 'SENT',
        quote_sent_at: result?.quote_sent_at || new Date(),
        quote_valid_until: result?.quote_valid_until || null,
        quote_remarks: remarks || null,
        driver_id: result?.driver_id || null,
        vehicle_id: result?.vehicle_id || null,
      },
    });
  });

  /**
   * POST /api/admin/bookings/bulk-status
   * Bulk update booking status.
   */
  const bulkStatus = asyncHandler(async (req, res) => {
    const { bookingIds, status } = req.body || {};
    const result = await bookingService.bulkUpdateStatus(bookingIds, status);

    logger.info({ adminId: req.user.user_id, status, count: result.updated }, 'admin.bulk_status');

    return res.json({ success: true, updated: result.updated });
  });

  /**
   * POST /api/admin/bookings/bulk-confirm
   * Bulk confirm bookings.
   */
  const bulkConfirm = asyncHandler(async (req, res) => {
    const { bookingIds } = req.body || {};
    const result = await bookingService.bulkUpdateStatus(bookingIds, 'confirmed');

    logger.info({ adminId: req.user.user_id, count: result.updated }, 'admin.bulk_confirm');

    return res.json({ success: true, updated: result.updated });
  });

  /**
   * POST /api/admin/bookings/bulk-cancel
   * Bulk cancel bookings.
   */
  const bulkCancel = asyncHandler(async (req, res) => {
    const { bookingIds } = req.body || {};
    const result = await bookingService.bulkUpdateStatus(bookingIds, 'cancelled');

    logger.info({ adminId: req.user.user_id, count: result.updated }, 'admin.bulk_cancel');

    return res.json({ success: true, updated: result.updated });
  });

  /**
   * GET /api/admin/bookings/:id
   * Get a booking by id.
   */
  const getBooking = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const booking = await bookingService.searchBookings({ bookingId });

    if (!booking || booking.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const bookingData = booking[0];

    // Include trip financial data for admin
    try {
      const financialSummary = await tripFinancialService.getTripFinancialSummary(bookingId, 'ADMIN', req.user);
      bookingData.financial = financialSummary;
    } catch (err) {
      // Financial data may not exist yet for new bookings
      bookingData.financial = null;
    }

    return res.json({
      success: true,
      data: bookingData,
    });
  });

  /**
   * PUT /api/admin/bookings/:id
   * Edit/update a booking.
   */
  const updateBooking = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const updateData = req.body || {};

    const result = await bookingService.updateBooking(bookingId, updateData);

    logger.info({ adminId: req.user.user_id, bookingId }, 'admin.booking_updated');

    return res.json({
      success: true,
      message: 'Booking updated successfully',
      data: { booking_id: bookingId },
    });
  });

  /**
   * DELETE /api/admin/bookings/:id
   * Delete booking.
   */
  const deleteBooking = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    // Note: delete should be in the service layer, but for now we keep it here
    // as it's a simple operation. In a full refactor, this would move to BookingService.
    const { prisma } = require('../config/prisma');
    await prisma.booking.delete({
      where: { booking_id: bookingId },
    });

    logger.info({ adminId: req.user.user_id, bookingId }, 'admin.booking_deleted');

    return res.json({
      success: true,
      message: 'Booking deleted successfully',
      data: { booking_id: bookingId },
    });
  });

  /**
   * PATCH /api/admin/bookings/:id/status
   * Update booking status.
   */
  const updateStatus = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const { status } = req.body || {};

    if (status === 'confirmed') {
      const result = await bookingService.confirmBooking(bookingId);
      return res.json({
        success: true,
        message: 'Booking confirmed successfully',
        data: result,
      });
    }

    const result = await bookingService.updateBooking(bookingId, { status });

    logger.info({ adminId: req.user.user_id, bookingId, status }, 'admin.status_updated');

    return res.json({
      success: true,
      message: 'Booking status updated successfully',
      data: result,
    });
  });

  /**
   * POST /api/admin/bookings/:id/assign-driver
   * Assign an available driver to a booking.
   */
  const assignDriver = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const { driver_id } = req.body || {};

    const result = await bookingService.assignDriver(bookingId, driver_id, req.user.user_id);

    logger.info({ adminId: req.user.user_id, bookingId, driverId: driver_id }, 'admin.driver_assigned');

    return res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: result,
    });
  });

  /**
   * POST /api/admin/bookings/:id/assign-driver-details
   * Manually assign driver + truck details.
   */
  const assignDriverDetails = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const { driver_name, phone, vehicle_number, vehicle_type, owner_name } = req.body || {};

    const result = await bookingService.assignDriverDetails(bookingId, {
      driver_name,
      phone,
      vehicle_number,
      vehicle_type,
      owner_name,
    });

    logger.info({ adminId: req.user.user_id, bookingId }, 'admin.driver_details_assigned');

    return res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        booking_id: bookingId,
        driver_name,
        phone,
        vehicle_number,
        vehicle_type: vehicle_type || null,
        owner_name: owner_name || null,
        status: result.status,
      },
    });
  });

  /**
   * POST /api/admin/bookings/:id/assign-vehicle
   * Assign a vehicle to a booking.
   */
  const assignVehicle = asyncHandler(async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    const { vehicle_id } = req.body;

    const result = await assignmentService.assignVehicle(bookingId, vehicle_id, req.user.user_id);

    logger.info({ adminId: req.user.user_id, bookingId, vehicleId: vehicle_id }, 'admin.vehicle_assigned');

    return res.json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: result,
    });
  });

return {
    getAssignableDrivers,
    sendQuote,
    bulkStatus,
    bulkConfirm,
    bulkCancel,
    getBooking,
    updateBooking,
    deleteBooking,
    updateStatus,
    assignDriver,
    assignDriverDetails,
    assignVehicle,
  };
}

module.exports = { createAdminBookingController };
