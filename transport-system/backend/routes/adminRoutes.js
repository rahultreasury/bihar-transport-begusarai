const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { prisma } = require('../config/prisma');

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
// @desc    Get all drivers (legacy — kept for backward compatibility)
//          Note: The new driver management module at /api/admin/drivers (driverManagementRoutes)
//          should be used for full-featured driver listing with search.
// @access  Private (Admin)
router.get('/drivers', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, status = '', search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build Prisma where clause
    const where = {};
    if (status === 'available') {
      where.is_available = true;
    } else if (status === 'busy') {
      where.is_available = false;
    }

    // Support search across driver fields
    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { driver_name: { contains: searchTerm, mode: 'insensitive' } },
        { driver_code: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [drivers, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
              address: true,
              city: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.driver.count({ where }),
    ]);

    // Flatten Prisma result to match original SQL response format
    const flattened = drivers.map((d) => ({
      driver_id: d.driver_id,
      driver_code: d.driver_code,
      driver_name: d.driver_name,
      mobile: d.mobile,
      user_id: d.user_id,
      license_number: d.license_number,
      license_expiry: d.license_expiry,
      profile_image: d.profile_image,
      is_available: d.is_available,
      is_verified: d.is_verified,
      rating: d.rating,
      total_deliveries: d.total_deliveries,
      status: d.status,
      city: d.city,
      state: d.state,
      created_at: d.created_at,
      updated_at: d.updated_at,
      first_name: d.user?.first_name ?? null,
      last_name: d.user?.last_name ?? null,
      email: d.user?.email ?? null,
      phone: d.user?.phone ?? null,
      address: d.user?.address ?? null,
      user_city: d.user?.city ?? null,
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
    console.error('Get drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

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
router.get('/bookings', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, status = '', search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build Prisma where clause
    const where = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { booking_reference: { contains: search, mode: 'insensitive' } },
        { pickup_city: { contains: search, mode: 'insensitive' } },
        { drop_city: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            select: {
              first_name: true,
              last_name: true,
              phone: true,
            },
          },
          vehicle: {
            select: {
              vehicle_number: true,
              vehicle_name: true,
            },
          },
          driver: {
            select: {
              user_id: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.booking.count({ where }),
    ]);

    // Flatten Prisma result to match original SQL response format
    const flattened = bookings.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      booking_number: b.booking_number,
      user_id: b.user_id,
      driver_id: b.driver_id,
      vehicle_id: b.vehicle_id,
      pickup_location: b.pickup_location,
      pickup_address: b.pickup_address,
      pickup_city: b.pickup_city,
      pickup_state: b.pickup_state,
      pickup_pincode: b.pickup_pincode,
      pickup_date: b.pickup_date,
      pickup_time: b.pickup_time,
      drop_location: b.drop_location,
      drop_address: b.drop_address,
      drop_city: b.drop_city,
      drop_state: b.drop_state,
      drop_pincode: b.drop_pincode,
      goods_description: b.goods_description,
      goods_type: b.goods_type,
      goods_weight_kg: b.goods_weight_kg,
      goods_volume: b.goods_volume,
      number_of_items: b.number_of_items,
      fragile: b.fragile,
      vehicle_type_required: b.vehicle_type_required,
      estimated_distance_km: b.estimated_distance_km,
      estimated_price: b.estimated_price,
      final_price: b.final_price,
      status: b.status,
      created_at: b.created_at,
      updated_at: b.updated_at,
      confirmed_at: b.confirmed_at,
      driver_assigned_at: b.driver_assigned_at,
      pickup_completed_at: b.pickup_completed_at,
      delivered_at: b.delivered_at,
      customer_first_name: b.user?.first_name ?? null,
      customer_last_name: b.user?.last_name ?? null,
      customer_phone: b.user?.phone ?? null,
      vehicle_number: b.vehicle?.vehicle_number ?? null,
      vehicle_name: b.vehicle?.vehicle_name ?? null,
      driver_user_id: b.driver?.user_id ?? null,
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
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
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
        vehicle: {
          select: {
            vehicle_number: true,
            vehicle_name: true,
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
      vehicle_id: booking.vehicle_id,
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
      vehicle_number: booking.vehicle?.vehicle_number ?? null,
      vehicle_name: booking.vehicle?.vehicle_name ?? null,
      driver_user_id: booking.driver?.user_id ?? null,
      driver_first_name: booking.driver?.user?.first_name ?? null,
      driver_last_name: booking.driver?.user?.last_name ?? null,
      driver_phone: booking.driver?.user?.phone ?? null,
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
      },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
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

    // Execute assignment within a Prisma interactive transaction
    await prisma.$transaction(async (tx) => {
      // 1. Update booking: set driver_id, status, driver_assigned_at
      await tx.booking.update({
        where: { booking_id: bookingId },
        data: {
          driver_id: parsedDriverId,
          status: 'driver_assigned',
          driver_assigned_at: new Date(),
        },
      });

      // 2. Mark driver as unavailable
      await tx.driver.update({
        where: { driver_id: parsedDriverId },
        data: { is_available: false },
      });

      // 3. Insert booking_assignment record
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
    });

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        booking_id: bookingId,
        driver_id: parsedDriverId,
        driver_name: `${driver.user.first_name} ${driver.user.last_name}`,
        driver_phone: driver.user.phone,
        status: 'driver_assigned'
      }
    });

  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning driver'
    });
  }
});

/**
 * ===============================
 * Vehicle Assignment API
 * ===============================
 */

// @route   POST /api/admin/bookings/:id/assign-vehicle
// @desc    Assign an available vehicle to a booking
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
    const { vehicle_id } = req.body || {};

    if (!vehicle_id) {
      return res.status(400).json({
        success: false,
        message: 'vehicle_id is required'
      });
    }

    const parsedVehicleId = parseInt(vehicle_id);

    // Validate booking exists
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        booking_id: true,
        vehicle_id: true,
        status: true,
      },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Prevent assigning to cancelled/completed bookings
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign vehicle to a booking with status: ${booking.status}`
      });
    }

    // Prevent reassigning if vehicle already assigned
    if (booking.vehicle_id) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle already assigned to this booking'
      });
    }

    // Validate vehicle exists and is available
    const vehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: parsedVehicleId },
      select: {
        vehicle_id: true,
        is_available: true,
        vehicle_name: true,
        vehicle_number: true,
        vehicle_type: true,
      },
    });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }
    if (!vehicle.is_available) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is not available'
      });
    }

    // Check vehicle is not already assigned to another active booking
    const activeBooking = await prisma.booking.findFirst({
      where: {
        vehicle_id: parsedVehicleId,
        status: { notIn: ['cancelled', 'completed', 'delivered'] },
      },
      select: { booking_id: true },
    });
    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is already assigned to another active booking'
      });
    }

    // Execute assignment within a Prisma interactive transaction
    await prisma.$transaction(async (tx) => {
      // 1. Update booking: set vehicle_id
      await tx.booking.update({
        where: { booking_id: bookingId },
        data: { vehicle_id: parsedVehicleId },
      });

      // 2. Mark vehicle as unavailable
      await tx.transportVehicle.update({
        where: { vehicle_id: parsedVehicleId },
        data: { is_available: false, current_status: 'on_trip' },
      });

      // 3. Upsert booking_assignment with vehicle_id
      // Check if a booking_assignment record already exists (e.g., from driver assignment)
      const existingAssignment = await tx.bookingAssignment.findFirst({
        where: { booking_id: bookingId },
        select: { booking_assignment_id: true },
      });
      if (existingAssignment) {
        await tx.bookingAssignment.update({
          where: { booking_assignment_id: existingAssignment.booking_assignment_id },
          data: { assigned_vehicle_id: parsedVehicleId },
        });
      } else {
        await tx.bookingAssignment.create({
          data: {
            booking_id: bookingId,
            assigned_vehicle_id: parsedVehicleId,
            assigned_by_admin_id: req.user.user_id,
            assignment_status: 'active',
          },
        });
      }

      // 4. Update delivery record if exists
      const delivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
        select: { delivery_id: true },
      });
      if (delivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: { vehicle_id: parsedVehicleId },
        });
      }
    });

    res.json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: {
        booking_id: bookingId,
        vehicle_id: parsedVehicleId,
        vehicle_name: vehicle.vehicle_name,
        vehicle_number: vehicle.vehicle_number,
        vehicle_type: vehicle.vehicle_type,
      },
    });

  } catch (error) {
    console.error('Assign vehicle error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning vehicle',
    });
  }
});

module.exports = router;


