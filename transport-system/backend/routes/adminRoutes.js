const express = require('express');
const router = express.Router();
const { query, run, get, transaction } = require('../config/database');
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
    const totalDrivers = await get('SELECT COUNT(*) as count FROM drivers', []);
    const totalVehicles = await get('SELECT COUNT(*) as count FROM transport_vehicles', []);
    const totalBookings = await get('SELECT COUNT(*) as count FROM bookings', []);

    // Get booking stats
    const pendingBookings = await get('SELECT COUNT(*) as count FROM bookings WHERE status = ?', ['pending']);
    const activeDeliveries = await get('SELECT COUNT(*) as count FROM bookings WHERE status IN (?, ?, ?)', ['confirmed', 'in_transit', 'pickup_completed']);
    const completedDeliveries = await get('SELECT COUNT(*) as count FROM bookings WHERE status IN (?, ?)', ['delivered', 'completed']);

    // Get revenue stats
    const totalRevenue = await get('SELECT SUM(final_price) as total FROM bookings WHERE status IN (?, ?)', ['delivered', 'completed']);
    const todayRevenue = await get(
      `SELECT SUM(final_price) as total FROM bookings 
       WHERE status IN (?, ?) AND DATE(delivered_at) = DATE('now')`,
      ['delivered', 'completed']
    );

    // Get recent bookings
    const recentBookings = await query(
      `SELECT b.booking_id, b.booking_reference, b.pickup_city, b.drop_city, b.status, b.final_price, b.created_at,
        u.first_name, u.last_name, u.phone
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       ORDER BY b.created_at DESC
       LIMIT 10`
    );

    // Get available drivers
    const availableDrivers = await query(
      `SELECT d.*, u.first_name, u.last_name, u.phone
       FROM drivers d
       JOIN users u ON d.user_id = u.user_id
       WHERE d.is_available = 1
       LIMIT 10`
    );

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalDrivers: totalDrivers.count,
          totalVehicles: totalVehicles.count,
          totalBookings: totalBookings.count,
          pendingBookings: pendingBookings.count,
          activeDeliveries: activeDeliveries.count,
          completedDeliveries: completedDeliveries.count,
          totalRevenue: totalRevenue.total || 0,
          todayRevenue: todayRevenue.total || 0
        },
        recentBookings,
        availableDrivers
      }
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
// @desc    Get all drivers
// @access  Private (Admin)
router.get('/drivers', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, status = '' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (status === 'available') {
      whereClause = 'WHERE d.is_available = 1';
    } else if (status === 'busy') {
      whereClause = 'WHERE d.is_available = 0';
    }

    const drivers = await query(
      `SELECT d.*, u.first_name, u.last_name, u.email, u.phone, u.address, u.city
       FROM drivers d
       JOIN users u ON d.user_id = u.user_id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const total = await get('SELECT COUNT(*) as count FROM drivers', []);

    res.json({
      success: true,
      data: drivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (type) {
      whereClause = 'WHERE vehicle_type = ?';
      params.push(type);
    }

    const vehicles = await query(
      `SELECT tv.*, u.first_name as owner_name, u.phone as owner_phone
       FROM transport_vehicles tv
       LEFT JOIN drivers d ON tv.driver_id = d.driver_id
       LEFT JOIN users u ON d.user_id = u.user_id
       ${whereClause}
       ORDER BY tv.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const total = await get('SELECT COUNT(*) as count FROM transport_vehicles', []);

    res.json({
      success: true,
      data: vehicles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (status) {
      whereClause = 'WHERE b.status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += whereClause ? ' AND' : 'WHERE';
      whereClause += ' (b.booking_reference LIKE ? OR b.pickup_city LIKE ? OR b.drop_city LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const bookings = await query(
      `SELECT b.*, 
        u.first_name as customer_first_name, u.last_name as customer_last_name, u.phone as customer_phone,
        tv.vehicle_number, tv.vehicle_name,
        d.user_id as driver_user_id
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       LEFT JOIN drivers d ON b.driver_id = d.driver_id
       ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const total = await get('SELECT COUNT(*) as count FROM bookings', []);

    res.json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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

    const driverId = req.params.id;

    await run('UPDATE drivers SET is_verified = 1 WHERE driver_id = ?', [driverId]);

    res.json({
      success: true,
      message: 'Driver verified successfully'
    });
  } catch (error) {
    console.error('Verify driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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

    const vehicleId = req.params.id;

    await run('UPDATE transport_vehicles SET is_verified = 1 WHERE vehicle_id = ?', [vehicleId]);

    res.json({
      success: true,
      message: 'Vehicle verified successfully'
    });
  } catch (error) {
    console.error('Verify vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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

    const bookingId = req.params.id;

    const booking = await get(
      `SELECT b.*, 
         u.first_name as customer_first_name,
         u.last_name as customer_last_name,
         u.email as customer_email,
         u.phone as customer_phone,
         tv.vehicle_number,
         tv.vehicle_name,
         d.user_id as driver_user_id,
         du.first_name as driver_first_name,
         du.last_name as driver_last_name,
         du.phone as driver_phone,
         del.current_status as delivery_current_status,
         del.status_description as delivery_status_description
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       LEFT JOIN drivers d ON b.driver_id = d.driver_id
       LEFT JOIN users du ON d.user_id = du.user_id
       LEFT JOIN deliveries del ON b.booking_id = del.booking_id
       WHERE b.booking_id = ?`,
      [bookingId]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
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

    const bookingId = req.params.id;

    // Only allow editing a limited safe subset.
    // This prevents accidental schema-breaking writes.
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

    const updateSql = `UPDATE bookings SET
      pickup_address = COALESCE(?, pickup_address),
      drop_address = COALESCE(?, drop_address),
      pickup_city = COALESCE(?, pickup_city),
      drop_city = COALESCE(?, drop_city),
      goods_description = COALESCE(?, goods_description),
      goods_type = COALESCE(?, goods_type),
      goods_weight_kg = COALESCE(?, goods_weight_kg),
      number_of_items = COALESCE(?, number_of_items),
      fragile = COALESCE(?, fragile),
      vehicle_type_required = COALESCE(?, vehicle_type_required),
      estimated_distance_km = COALESCE(?, estimated_distance_km),
      estimated_price = COALESCE(?, estimated_price),
      final_price = COALESCE(?, final_price)
    WHERE booking_id = ?`;

    const result = await run(updateSql, [
      pickup_address ?? null,
      drop_address ?? null,
      pickup_city ?? null,
      drop_city ?? null,
      goods_description ?? null,
      goods_type ?? null,
      goods_weight_kg ?? null,
      number_of_items ?? null,
      typeof fragile === 'boolean' ? (fragile ? 1 : 0) : fragile ?? null,
      vehicle_type_required ?? null,
      estimated_distance_km ?? null,
      estimated_price ?? null,
      final_price ?? null,
      bookingId,
    ]);

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: { booking_id: bookingId, changes: result.changes }
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

    const bookingId = req.params.id;

    // Delete delivery record first if exists (to avoid FK issues in some SQLite setups)
    await run('DELETE FROM deliveries WHERE booking_id = ?', [bookingId]);
    const result = await run('DELETE FROM bookings WHERE booking_id = ?', [bookingId]);

    res.json({
      success: true,
      message: 'Booking deleted successfully',
      data: { booking_id: bookingId, changes: result.changes }
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

    const bookingId = req.params.id;
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

    await run('UPDATE bookings SET status = ? WHERE booking_id = ?', [status, bookingId]);

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

    const bookingId = req.params.id;
    const { driver_id } = req.body || {};

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'driver_id is required'
      });
    }

    // Validate booking exists
    const booking = await get('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);
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
    const driver = await get(
      `SELECT d.*, u.first_name, u.last_name, u.phone
       FROM drivers d
       JOIN users u ON d.user_id = u.user_id
       WHERE d.driver_id = ?`,
      [driver_id]
    );
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
    const activeBooking = await get(
      `SELECT booking_id FROM bookings
       WHERE driver_id = ? AND status NOT IN ('cancelled', 'completed', 'delivered')`,
      [driver_id]
    );
    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'Driver is already assigned to another active booking'
      });
    }

    // Execute assignment within a transaction
    await transaction(async (tx) => {
      // 1. Update booking: set driver_id, status, driver_assigned_at
      await tx.run(
        `UPDATE bookings SET
           driver_id = ?,
           status = 'driver_assigned',
           driver_assigned_at = CURRENT_TIMESTAMP
         WHERE booking_id = ?`,
        [driver_id, bookingId]
      );

      // 2. Mark driver as unavailable
      await tx.run(
        'UPDATE drivers SET is_available = 0 WHERE driver_id = ?',
        [driver_id]
      );

      // 3. Insert booking_assignment record
      await tx.run(
        `INSERT INTO booking_assignments
           (booking_id, assigned_driver_id, assigned_by_admin_id, assignment_status)
         VALUES (?, ?, ?, 'active')`,
        [bookingId, driver_id, req.user.user_id]
      );

      // 4. Update delivery record if exists
      const delivery = await tx.get(
        'SELECT delivery_id FROM deliveries WHERE booking_id = ?',
        [bookingId]
      );
      if (delivery) {
        await tx.run(
          `UPDATE deliveries SET
             driver_id = ?,
             current_status = 'driver_assigned',
             status_description = 'Driver assigned to booking'
           WHERE booking_id = ?`,
          [driver_id, bookingId]
        );
      }
    });

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        booking_id: parseInt(bookingId),
        driver_id: parseInt(driver_id),
        driver_name: `${driver.first_name} ${driver.last_name}`,
        driver_phone: driver.phone,
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

    const bookingId = req.params.id;
    const { vehicle_id } = req.body || {};

    if (!vehicle_id) {
      return res.status(400).json({
        success: false,
        message: 'vehicle_id is required'
      });
    }

    // Validate booking exists
    const booking = await get('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);
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
    const vehicle = await get(
      'SELECT * FROM transport_vehicles WHERE vehicle_id = ?',
      [vehicle_id]
    );
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
    const activeBooking = await get(
      `SELECT booking_id FROM bookings
       WHERE vehicle_id = ? AND status NOT IN ('cancelled', 'completed', 'delivered')`,
      [vehicle_id]
    );
    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is already assigned to another active booking'
      });
    }

    // Execute assignment within a transaction
    await transaction(async (tx) => {
      // 1. Update booking: set vehicle_id
      await tx.run(
        `UPDATE bookings SET vehicle_id = ? WHERE booking_id = ?`,
        [vehicle_id, bookingId]
      );

      // 2. Mark vehicle as unavailable
      await tx.run(
        "UPDATE transport_vehicles SET is_available = 0, current_status = 'on_trip' WHERE vehicle_id = ?",
        [vehicle_id]
      );

      // 3. Upsert booking_assignment with vehicle_id
      // Check if a booking_assignment record already exists (e.g., from driver assignment)
      const existingAssignment = await tx.get(
        'SELECT booking_assignment_id FROM booking_assignments WHERE booking_id = ?',
        [bookingId]
      );
      if (existingAssignment) {
        await tx.run(
          'UPDATE booking_assignments SET assigned_vehicle_id = ? WHERE booking_id = ?',
          [vehicle_id, bookingId]
        );
      } else {
        await tx.run(
          `INSERT INTO booking_assignments
             (booking_id, assigned_vehicle_id, assigned_by_admin_id, assignment_status)
           VALUES (?, ?, ?, 'active')`,
          [bookingId, vehicle_id, req.user.user_id]
        );
      }

      // 4. Update delivery record if exists
      const delivery = await tx.get(
        'SELECT delivery_id FROM deliveries WHERE booking_id = ?',
        [bookingId]
      );
      if (delivery) {
        await tx.run(
          'UPDATE deliveries SET vehicle_id = ? WHERE booking_id = ?',
          [vehicle_id, bookingId]
        );
      }
    });

    res.json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: {
        booking_id: parseInt(bookingId),
        vehicle_id: parseInt(vehicle_id),
        vehicle_name: vehicle.vehicle_name,
        vehicle_number: vehicle.vehicle_number,
        vehicle_type: vehicle.vehicle_type
      }
    });

  } catch (error) {
    console.error('Assign vehicle error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning vehicle'
    });
  }
});

module.exports = router;


