const express = require('express');
const router = express.Router();
const { query, run, get } = require('../config/database');
const { protect } = require('../middleware/auth');

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
    const totalUsers = await get('SELECT COUNT(*) as count FROM users WHERE role = ?', ['customer']);
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
          totalUsers: totalUsers.count,
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
    const offset = (page - 1) * limit;

    let whereClause = "WHERE role = 'customer'";
    let params = [];

    if (search) {
      whereClause += " AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const users = await query(
      `SELECT user_id, first_name, last_name, email, phone, address, city, state, is_active, created_at 
       FROM users ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const total = await get(
      `SELECT COUNT(*) as count FROM users WHERE role = 'customer'`,
      []
    );

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
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

    const userId = req.params.id;
    const { is_active } = req.body;

    await run('UPDATE users SET is_active = ? WHERE user_id = ?', [is_active ? 1 : 0, userId]);

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
         d.user_id as driver_user_id
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       LEFT JOIN drivers d ON b.driver_id = d.driver_id
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

module.exports = router;


