const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { prisma } = require('../config/prisma');

const BookingService = require('../services/BookingService');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const BookingAssignmentService = require('../services/BookingAssignmentService');
const { createBookingController } = require('../controllers/bookingController');

const bookingService = new BookingService();
const bookingAssignmentService = new BookingAssignmentService();
const bookingController = createBookingController();

const mapDomainErrorToHttp = (err, res) => {
  if (err?.name === 'ValidationError' || err?.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ success: false, message: err?.message || 'Validation failed' });
  }
  if (err?.name === 'NotFoundError' || err?.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, message: err?.message || 'Not found' });
  }
  return res.status(500).json({ success: false, message: 'Internal server error' });
};

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard stats
// @access  Private (Admin)
router.get('/dashboard', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get total counts
    const totalUsers = await prisma.user.count({
      where: { role: 'customer' }
    });
    const totalDrivers = await prisma.driver.count();
    const totalVehicles = await prisma.transportVehicle.count();
    const totalBookings = await prisma.booking.count();

    // Get booking stats
    const pendingBookings = await prisma.booking.count({
      where: { status: 'pending' }
    });
    const activeDeliveries = await prisma.booking.count({
      where: { status: { in: ['confirmed', 'in_transit', 'pickup_completed'] } }
    });
    const completedDeliveries = await prisma.booking.count({
      where: { status: { in: ['delivered', 'completed'] } }
    });

    // Get revenue stats
    const revenueAgg = await prisma.booking.aggregate({
      where: { status: { in: ['delivered', 'completed'] } },
      _sum: { final_price: true },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayRevenueAgg = await prisma.booking.aggregate({
      where: {
        status: { in: ['delivered', 'completed'] },
        delivered_at: { gte: todayStart, lte: todayEnd },
      },
      _sum: { final_price: true },
    });

    // Get recent bookings with user info
    const recentBookingsRaw = await prisma.booking.findMany({
      take: 10,
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
      },
    });

    const recentBookings = recentBookingsRaw.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      pickup_city: b.pickup_city,
      drop_city: b.drop_city,
      status: b.status,
      final_price: b.final_price,
      created_at: b.created_at,
      first_name: b.user?.first_name ?? null,
      last_name: b.user?.last_name ?? null,
      phone: b.user?.phone ?? null,
    }));

    // Get available drivers with user info
    const availableDriversRaw = await prisma.driver.findMany({
      where: { is_available: true },
      take: 10,
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
      },
    });

    const availableDrivers = availableDriversRaw.map((d) => ({
      driver_id: d.driver_id,
      user_id: d.user_id,
      license_number: d.license_number,
      license_expiry: d.license_expiry,
      profile_image: d.profile_image,
      is_available: d.is_available,
      is_verified: d.is_verified,
      rating: d.rating,
      total_deliveries: d.total_deliveries,
      created_at: d.created_at,
      updated_at: d.updated_at,
      first_name: d.user?.first_name ?? null,
      last_name: d.user?.last_name ?? null,
      phone: d.user?.phone ?? null,
    }));

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalDrivers,
          totalVehicles,
          totalBookings,
          pendingBookings,
          activeDeliveries,
          completedDeliveries,
          totalRevenue: revenueAgg._sum.final_price || 0,
          todayRevenue: todayRevenueAgg._sum.final_price || 0,
        },
        recentBookings,
        availableDrivers,
      },
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all customers
// @access  Private (Admin)
router.get('/users', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    // Build Prisma where clause
    const where = {
      role: 'customer',
    };

    if (search) {
      where.OR = [
        { first_name: { contains: search } },
        { last_name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          is_active: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/drivers
// @desc    Get all drivers.
//          Handled exclusively by driverManagementRoutes (single source of truth)
//          mounted at /api/admin/drivers in server.js. This legacy inline handler
//          was removed to (1) eliminate the duplicate/shadowed route and (2) remove
//          direct Prisma access from the route layer (Route → Service → Repository → Prisma).
// @access  Private (Admin)

// @route   GET /api/admin/vehicles
// @desc    Get all vehicles
// @access  Private (Admin)
router.get('/vehicles', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, type = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build Prisma where clause
    const where = {};
    if (type) {
      where.vehicle_type = type;
    }

    const [vehicles, total] = await Promise.all([
      prisma.transportVehicle.findMany({
        where,
        include: {
          driver: {
            include: {
              user: {
                select: {
                  first_name: true,
                  phone: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.transportVehicle.count({ where }),
    ]);

    // Flatten Prisma result to match original SQL response format
    const flattened = vehicles.map((v) => ({
      vehicle_id: v.vehicle_id,
      driver_id: v.driver_id,
      vehicle_number: v.vehicle_number,
      vehicle_type: v.vehicle_type,
      vehicle_name: v.vehicle_name,
      capacity_kg: v.capacity_kg,
      capacity_volume: v.capacity_volume,
      vehicle_make: v.vehicle_make,
      vehicle_model: v.vehicle_model,
      manufacturing_year: v.manufacturing_year,
      registration_date: v.registration_date,
      insurance_number: v.insurance_number,
      insurance_expiry: v.insurance_expiry,
      permit_number: v.permit_number,
      permit_expiry: v.permit_expiry,
      pollution_certificate: v.pollution_certificate,
      pollution_expiry: v.pollution_expiry,
      is_available: v.is_available,
      is_verified: v.is_verified,
      current_status: v.current_status,
      base_location: v.base_location,
      hourly_rate: v.hourly_rate,
      per_km_rate: v.per_km_rate,
      created_at: v.created_at,
      updated_at: v.updated_at,
      owner_name: v.driver?.user?.first_name ?? null,
      owner_phone: v.driver?.user?.phone ?? null,
    }));

    res.json({
      success: true,
      data: flattened,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/admin/bookings
// @desc    Get all bookings
// @access  Private (Admin)
// NOTE: The route only delegates to the controller. All query validation,
// authorization, and error handling live in the controller (which forwards
// errors to the centralized error handler via next(error)).
router.get('/bookings', protect, bookingController.listBookings);

// @route   POST /api/admin/bookings/:id/send-quote
// @desc    Send a final quote to the customer (Final Transport Charge).
//          Does NOT confirm the booking — waits for customer acceptance.
// @access  Private (Admin)
router.post('/bookings/:id/send-quote', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const { final_price, remarks, driver_id, vehicle_id, quote_validity_hours } = req.body || {};

    // Enterprise workflow: admin reserves a driver + vehicle, sets the Final
    // Transport Charge and a validity window, then sends the quote. The booking
    // is NOT confirmed until the customer accepts.
    const result = await bookingService.sendQuoteWithReservation(bookingId, {
      final_price,
      remarks,
      driver_id,
      vehicle_id,
      quote_validity_hours,
      reserved_by: req.user.user_id,
    });

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
  } catch (err) {
    console.error('Send quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   PUT /api/admin/drivers/:id/verify
// @desc    Verify a driver
// @access  Private (Admin)
router.put('/drivers/:id/verify', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const driverId = parseInt(req.params.id);

    // Verify driver exists before updating
    const existing = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    await prisma.driver.update({
      where: { driver_id: driverId },
      data: { is_verified: true },
    });

    res.json({
      success: true,
      message: 'Driver verified successfully',
    });
  } catch (error) {
    console.error('Verify driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/admin/vehicles/:id/verify
// @desc    Verify a vehicle
// @access  Private (Admin)
router.put('/vehicles/:id/verify', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vehicleId = parseInt(req.params.id);

    // Verify vehicle exists before updating
    const existing = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      select: { vehicle_id: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    await prisma.transportVehicle.update({
      where: { vehicle_id: vehicleId },
      data: { is_verified: true },
    });

    res.json({
      success: true,
      message: 'Vehicle verified successfully',
    });
  } catch (error) {
    console.error('Verify vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/admin/users/:id/status
// @desc    Toggle user status
// @access  Private (Admin)
router.put('/users/:id/status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const userId = parseInt(req.params.id);
    const { is_active } = req.body;

    await prisma.user.update({
      where: { user_id: userId },
      data: { is_active: is_active ? true : false }
    });

    res.json({
      success: true,
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * ===============================
 * Admin Booking Management (Phase 1)
 * ===============================
 */

// @route   POST /api/admin/bookings/bulk-status
// @desc    Bulk update booking status in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds, status } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, status);
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk status error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/bulk-confirm
// @desc    Bulk confirm bookings in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-confirm', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, 'confirmed');
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk confirm error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/bulk-cancel
// @desc    Bulk cancel bookings in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-cancel', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, 'cancelled');
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk cancel error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   GET /api/admin/bookings/:id
// @desc    Get a booking by id
// @access  Private (Admin)
router.get('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);

const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
        driver: {
          select: {
            user_id: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
        delivery: {
          select: {
            current_status: true,
            status_description: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Flatten Prisma result to match original SQL response format
    const flattened = {
      booking_id: booking.booking_id,
      booking_reference: booking.booking_reference,
      booking_number: booking.booking_number,
user_id: booking.user_id,
      driver_id: booking.driver_id,
      pickup_location: booking.pickup_location,
      pickup_address: booking.pickup_address,
      pickup_city: booking.pickup_city,
      pickup_state: booking.pickup_state,
      pickup_pincode: booking.pickup_pincode,
      pickup_date: booking.pickup_date,
      pickup_time: booking.pickup_time,
      drop_location: booking.drop_location,
      drop_address: booking.drop_address,
      drop_city: booking.drop_city,
      drop_state: booking.drop_state,
      drop_pincode: booking.drop_pincode,
      goods_description: booking.goods_description,
      goods_type: booking.goods_type,
      goods_weight_kg: booking.goods_weight_kg,
      goods_volume: booking.goods_volume,
      number_of_items: booking.number_of_items,
      fragile: booking.fragile,
      vehicle_type_required: booking.vehicle_type_required,
      estimated_distance_km: booking.estimated_distance_km,
      estimated_price: booking.estimated_price,
      final_price: booking.final_price,
status: booking.status,
      quote_status: booking.quote_status,
      confirmation_source: booking.confirmation_source ?? null,
      quote_remarks: booking.quote_remarks,
      quote_sent_at: booking.quote_sent_at,
      quote_accepted_at: booking.quote_accepted_at,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      confirmed_at: booking.confirmed_at,
      driver_assigned_at: booking.driver_assigned_at,
      pickup_completed_at: booking.pickup_completed_at,
      delivered_at: booking.delivered_at,
customer_first_name: booking.user?.first_name ?? null,
      customer_last_name: booking.user?.last_name ?? null,
      customer_email: booking.user?.email ?? null,
      customer_phone: booking.user?.phone ?? null,
      vehicle_number: booking.truck_number_snapshot ?? null,
      vehicle_name: null,
      vehicle_type: null,
      driver_user_id: booking.driver?.user_id ?? null,
      driver_first_name: booking.driver?.user?.first_name ?? null,
      driver_last_name: booking.driver?.user?.last_name ?? null,
      driver_phone: booking.driver?.user?.phone ?? null,
      driver_name_snapshot: booking.driver_name_snapshot ?? null,
      truck_number_snapshot: booking.truck_number_snapshot ?? null,
      owner_name_snapshot: booking.partner_name_snapshot ?? null,
      mobile_snapshot: booking.mobile_snapshot ?? null,
      delivery_current_status: booking.delivery?.current_status ?? null,
      delivery_status_description: booking.delivery?.status_description ?? null,
    };

    res.json({
      success: true,
      data: flattened,
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/admin/bookings/:id
// @desc    Edit/update a booking by id
// @access  Private (Admin)
router.put('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);

    const {
      pickup_address,
      drop_address,
      pickup_city,
      drop_city,
      goods_description,
      goods_type,
      goods_weight_kg,
      number_of_items,
      fragile,
      vehicle_type_required,
      estimated_distance_km,
      estimated_price,
      final_price
    } = req.body || {};

    // Build update data, only including provided fields
    const updateData = {};
    if (pickup_address !== undefined) updateData.pickup_address = pickup_address;
    if (drop_address !== undefined) updateData.drop_address = drop_address;
    if (pickup_city !== undefined) updateData.pickup_city = pickup_city;
    if (drop_city !== undefined) updateData.drop_city = drop_city;
    if (goods_description !== undefined) updateData.goods_description = goods_description;
    if (goods_type !== undefined) updateData.goods_type = goods_type;
    if (goods_weight_kg !== undefined) updateData.goods_weight_kg = goods_weight_kg ? parseFloat(goods_weight_kg) : null;
    if (number_of_items !== undefined) updateData.number_of_items = number_of_items ? parseInt(number_of_items) : null;
    if (fragile !== undefined) updateData.fragile = fragile ? true : false;
    if (vehicle_type_required !== undefined) updateData.vehicle_type_required = vehicle_type_required;
    if (estimated_distance_km !== undefined) updateData.estimated_distance_km = estimated_distance_km ? parseFloat(estimated_distance_km) : null;
    if (estimated_price !== undefined) updateData.estimated_price = estimated_price ? parseFloat(estimated_price) : null;
    if (final_price !== undefined) updateData.final_price = final_price ? parseFloat(final_price) : null;

    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: updateData,
    });

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: { booking_id: bookingId },
    });
  } catch (error) {
    console.error('Update booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/admin/bookings/:id
// @desc    Delete booking by id
// @access  Private (Admin)
router.delete('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);

    // Prisma cascading deletes will handle related records
    // (BookingEvent, BookingAssignment, Delivery are set to onDelete: Cascade)
    await prisma.booking.delete({
      where: { booking_id: bookingId },
    });

    res.json({
      success: true,
      message: 'Booking deleted successfully',
      data: { booking_id: bookingId },
    });
  } catch (error) {
    console.error('Delete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PATCH /api/admin/bookings/:id/status
// @desc    Update booking status by id
// @access  Private (Admin)
router.patch('/bookings/:id/status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required'
      });
    }

    // Only allow known states (based on schema)
    const allowed = [
      'pending',
      'confirmed',
      'driver_assigned',
      'pickup_completed',
      'in_transit',
      'delivered',
      'cancelled',
      'completed'
    ];

if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // === Single source of truth ===
    // Confirmation is DRIVEN BY quote_status. When an admin sets status to
    // 'confirmed' (offline/phone/WhatsApp confirmation), we must atomically
    // also set quote_status='ACCEPTED' + confirmation_source='ADMIN' +
    // confirmed_at, and write a BOOKING_CONFIRMED_BY_ADMIN timeline event.
    // This guarantees the DB is NEVER left in an inconsistent state
    // (e.g. status=confirmed + quote_status=SENT/PENDING).
    if (status === 'confirmed') {
      const result = await bookingService.confirmBooking(bookingId);
      return res.json({
        success: true,
        message: 'Booking confirmed successfully',
        data: result,
      });
    }

    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: { status },
    });

    res.json({
      success: true,
      message: 'Booking status updated successfully'
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.name === 'ValidationError' || error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.name === 'NotFoundError' || error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * ===============================
 * Driver Assignment API
 * ===============================
 */

// @route   GET /api/admin/booking-drivers
// @desc    Scalable driver lookup for the Booking Assignment picker (10k+ drivers).
//          Server-side pagination + search + filters + trip stats in ONE call.
//          Each driver carries its assigned vehicle (one-driver-one-vehicle),
//          so the frontend never combines multiple APIs.
// @query   page, limit, search, status, vehicle_type, min_rating
// @access  Private (Admin)
router.get('/booking-drivers', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const adminBookingController = require('../controllers/adminBookingController');
    const ctrl = adminBookingController.createAdminBookingController();
    await ctrl.getAssignableDrivers(req, res);
  } catch (err) {
    console.error('Get assignable drivers error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/bookings/:id/assign-driver
// @desc    Assign an available driver to a booking
// @access  Private (Admin)
router.post('/bookings/:id/assign-driver', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { driver_id } = req.body || {};

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'driver_id is required'
      });
    }

    const parsedDriverId = parseInt(driver_id);

    // Validate booking exists
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        booking_id: true,
        driver_id: true,
        status: true,
        quote_status: true,
      },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Quote workflow gate: a driver may only be assigned AFTER the customer
    // has ACCEPTED the final quote. This replaces the old confirm flow.
    if (booking.quote_status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'Driver can only be assigned after the customer accepts the final quote'
      });
    }

    // Prevent assigning driver to cancelled/completed bookings
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver to a booking with status: ${booking.status}`
      });
    }

    // Prevent reassigning if driver already assigned
    if (booking.driver_id) {
      return res.status(400).json({
        success: false,
        message: 'Driver already assigned to this booking'
      });
    }

// Validate driver exists and is available
    // Brokerage model: each driver maps to exactly one primary registered
    // vehicle (stored on the driver as vehicle_number / vehicle_type). We
    // load those fields so the vehicle can be auto-associated on assignment.
    const driver = await prisma.driver.findUnique({
      where: { driver_id: parsedDriverId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        currentPartner: {
          select: {
            partner_name: true,
          },
        },
      },
    });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    if (!driver.is_available) {
      return res.status(400).json({
        success: false,
        message: 'Driver is not available'
      });
    }

    // Brokerage validation: a driver MUST have a registered vehicle before
    // they can be assigned to a booking. Rejection happens BEFORE any DB
    // write, so the booking is never partially updated.
    if (!driver.vehicle_number) {
      return res.status(400).json({
        success: false,
        message: 'Driver has no registered vehicle. Please assign a vehicle to the driver first.'
      });
    }

    // Check driver is not already assigned to another active booking
    const activeBooking = await prisma.booking.findFirst({
      where: {
        driver_id: parsedDriverId,
        status: { notIn: ['cancelled', 'completed', 'delivered'] },
      },
      select: { booking_id: true },
    });
    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'Driver is already assigned to another active booking'
      });
    }

    // Execute assignment within an atomic Prisma interactive transaction.
    // Assigning the driver auto-associates the driver's registered vehicle
    // (stored as immutable snapshots on the booking) in the SAME transaction.
    // If any step fails, the whole transaction rolls back.
    const assigned = await prisma.$transaction(async (tx) => {
      // 1. Update booking: set driver_id, status, driver_assigned_at, and
      //    auto-assign the driver's registered vehicle as immutable snapshots.
      const updatedBooking = await tx.booking.update({
        where: { booking_id: bookingId },
        data: {
          driver_id: parsedDriverId,
          status: 'driver_assigned',
          driver_assigned_at: new Date(),
          // Auto-assign driver's registered vehicle (brokerage snapshot model)
          driver_name_snapshot: driver.driver_name || `${driver.user.first_name} ${driver.user.last_name}`.trim(),
          mobile_snapshot: driver.mobile || driver.user.phone || null,
truck_number_snapshot: driver.vehicle_number,
          partner_name_snapshot: driver.currentPartner?.partner_name || null,
        },
      });

      // 2. Mark driver as unavailable
      await tx.driver.update({
        where: { driver_id: parsedDriverId },
        data: { is_available: false },
      });

      // 3. Record the driver assignment
      await tx.bookingAssignment.create({
        data: {
          booking_id: bookingId,
          assigned_driver_id: parsedDriverId,
          assigned_by_admin_id: req.user.user_id,
          assignment_status: 'active',
        },
      });

      // 4. Update delivery record if exists
      const delivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
        select: { delivery_id: true },
      });
      if (delivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: parsedDriverId,
            current_status: 'driver_assigned',
            status_description: 'Driver assigned to booking',
          },
        });
      }

      // 5. Timeline events: Driver Assigned → Vehicle Auto Assigned → Booking Ready
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'driver_assigned',
          event_payload: JSON.stringify({
            driver_id: parsedDriverId,
            driver_name: driver.driver_name || `${driver.user.first_name} ${driver.user.last_name}`.trim(),
            driver_phone: driver.mobile || driver.user.phone || null,
          }),
        },
      });
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'vehicle_auto_assigned',
          event_payload: JSON.stringify({
            vehicle_number: driver.vehicle_number,
            vehicle_type: driver.vehicle_type || null,
            source: 'driver_primary_vehicle',
          }),
        },
      });
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'booking_ready',
          event_payload: JSON.stringify({
            status: 'driver_assigned',
            message: 'Driver and vehicle assigned. Booking ready.',
          }),
        },
      });

      return updatedBooking;
    });

    // Fetch the fresh booking to return accurate snapshot data
    const freshBooking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        truck_number_snapshot: true,
        driver_name_snapshot: true,
        mobile_snapshot: true,
        partner_name_snapshot: true,
      },
    });

    res.json({
      success: true,
      message: 'Driver assigned successfully. The driver\'s registered vehicle was auto-assigned.',
      data: {
        booking_id: bookingId,
        driver_id: parsedDriverId,
        driver_name: freshBooking?.driver_name_snapshot || assigned?.driver_name_snapshot || null,
        driver_phone: freshBooking?.mobile_snapshot || driver.mobile || driver.user.phone || null,
        vehicle_number: freshBooking?.truck_number_snapshot || driver.vehicle_number,
        vehicle_type: driver.vehicle_type || null,
        owner_name: freshBooking?.partner_name_snapshot || driver.currentPartner?.partner_name || null,
        status: 'driver_assigned',
      },
    });

  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning driver'
    });
  }
});

// @route   POST /api/admin/bookings/:id/assign-driver-details
// @desc    Manually assign a driver + truck to a booking (brokerage model).
//          The platform does NOT own trucks — the admin captures the driver's
//          own vehicle details and stores them as immutable snapshots.
//          Only allowed after the customer ACCEPTS the final quote.
// @access  Private (Admin)
router.post('/bookings/:id/assign-driver-details', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const {
      driver_name,
      phone,
      vehicle_number,
      vehicle_type,
      owner_name
    } = req.body || {};

    if (!driver_name) {
      return res.status(400).json({ success: false, message: 'driver_name is required' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    if (!vehicle_number) {
      return res.status(400).json({ success: false, message: 'vehicle_number is required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { booking_id: true, status: true, quote_status: true },
    });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.quote_status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'Driver can only be assigned after the customer accepts the final quote',
      });
    }

    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver to a booking with status: ${booking.status}`,
      });
    }

    // Persist driver + truck contact details as immutable snapshots and mark assigned.
    const updated = await prisma.booking.update({
      where: { booking_id: bookingId },
      data: {
        driver_name_snapshot: String(driver_name),
        mobile_snapshot: String(phone),
        truck_number_snapshot: String(vehicle_number),
        partner_name_snapshot: owner_name ? String(owner_name) : null,
        status: 'driver_assigned',
        driver_assigned_at: new Date(),
      },
    });

    await prisma.bookingEvent.create({
      data: {
        booking_id: bookingId,
        event_type: 'driver_assigned',
        event_payload: JSON.stringify({
          driver_name,
          phone,
          vehicle_number,
          vehicle_type: vehicle_type || null,
          owner_name: owner_name || null,
        }),
      },
    });

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        booking_id: bookingId,
        driver_name,
        phone,
        vehicle_number,
        vehicle_type: vehicle_type || null,
        owner_name: owner_name || null,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Assign driver details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning driver',
    });
  }
});

/**
 * ===============================
 * Vehicle Assignment API
 * ===============================
 */

// @route   POST /api/admin/bookings/:id/assign-vehicle
// @desc    Assign a vehicle to a booking. Creates a BookingAssignment record
//          with the assigned vehicle. The Booking model retains `vehicle_id`
//          and `Delivery` retains `vehicle_id` in the current architecture.
// @access  Private (Admin)
router.post('/bookings/:id/assign-vehicle', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { vehicle_id } = req.body;

    if (!bookingId || !vehicle_id) {
      return res.status(400).json({
        success: false,
        message: 'bookingId and vehicle_id are required'
      });
    }

    // Verify booking exists
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { booking_id: true },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Verify vehicle exists
    const vehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: parseInt(vehicle_id) },
      select: { vehicle_id: true, is_available: true },
    });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    const result = await bookingAssignmentService.assignVehicle(bookingId, parseInt(vehicle_id), req.user.user_id);

    res.json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: result,
    });
  } catch (err) {
    console.error('Assign vehicle error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Server error assigning vehicle',
    });
  }
});

module.exports = router;


