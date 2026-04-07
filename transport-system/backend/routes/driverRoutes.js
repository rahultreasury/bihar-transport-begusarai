const express = require('express');
const router = express.Router();
const { query, run, get } = require('../config/database');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// @route   GET /api/drivers/available-jobs
// @desc    Get available transport jobs
// @access  Private (Driver)
router.get('/available-jobs', protect, async (req, res) => {
  try {
    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Get available bookings that need a driver
    // Filter by driver's available vehicle types
    const vehicles = await query(
      'SELECT * FROM transport_vehicles WHERE driver_id = ? AND is_available = 1',
      [driver.driver_id]
    );

    const vehicleTypes = vehicles.map(v => v.vehicle_type);

    if (vehicleTypes.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No vehicles registered or available'
      });
    }

    const placeholders = vehicleTypes.map(() => '?').join(',');

    const jobs = await query(
      `SELECT b.*, 
        u.first_name as customer_first_name, u.last_name as customer_last_name, u.phone as customer_phone,
        tv.vehicle_id, tv.vehicle_number, tv.vehicle_name, tv.vehicle_type, tv.capacity_kg, tv.per_km_rate
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       WHERE b.status = 'pending' 
       AND b.vehicle_type_required IN (${placeholders})
       ORDER BY b.pickup_date ASC, b.pickup_time ASC`,
      vehicleTypes
    );

    res.json({
      success: true,
      data: jobs,
      count: jobs.length
    });
  } catch (error) {
    console.error('Get available jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/drivers/accept-job/:bookingId
// @desc    Accept a transport job
// @access  Private (Driver)
router.post('/accept-job/:bookingId', protect, async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const { vehicle_id } = req.body;

    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Check if vehicle belongs to driver
    const vehicle = await get(
      'SELECT * FROM transport_vehicles WHERE vehicle_id = ? AND driver_id = ?',
      [vehicle_id, driver.driver_id]
    );

    if (!vehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle not found or does not belong to you'
      });
    }

    // Check booking exists and is pending
    const booking = await get('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This booking is no longer available'
      });
    }

    // Update booking status
    await run(
      `UPDATE bookings SET 
        driver_id = ?, 
        vehicle_id = ?, 
        status = 'confirmed',
        driver_assigned_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP 
       WHERE booking_id = ?`,
      [driver.driver_id, vehicle_id, bookingId]
    );

    // Update delivery status
    await run(
      `UPDATE deliveries SET 
        driver_id = ?, 
        vehicle_id = ?,
        current_status = 'driver_assigned',
        status_description = 'Driver assigned to pickup',
        estimated_pickup_time = ?,
        estimated_delivery_time = datetime(?, '+' || ? || ' hours'),
        delivery_otp = ?,
        updated_at = CURRENT_TIMESTAMP 
       WHERE booking_id = ?`,
      [
        driver.driver_id, vehicle_id,
        booking.pickup_date || CURRENT_TIMESTAMP,
        booking.pickup_date || CURRENT_TIMESTAMP,
        ROUND(booking.estimated_distance_km / 40), // Estimate 40km/hour
        Math.floor(100000 + Math.random() * 900000).toString(),
        bookingId
      ]
    );

    // Make driver and vehicle unavailable
    await run('UPDATE drivers SET is_available = 0 WHERE driver_id = ?', [driver.driver_id]);
    await run('UPDATE transport_vehicles SET is_available = 0, current_status = ? WHERE vehicle_id = ?', ['on_trip', vehicle_id]);

    res.json({
      success: true,
      message: 'Job accepted successfully',
      data: {
        booking_id: bookingId,
        driver_id: driver.driver_id,
        vehicle_id: vehicle_id,
        status: 'confirmed'
      }
    });
  } catch (error) {
    console.error('Accept job error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error accepting job'
    });
  }
});

// @route   GET-jobs
// @desc    Get /api/drivers/my driver's current jobs
// @access  Private (Driver)
router.get('/my-jobs', protect, async (req, res) => {
  try {
    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    const jobs = await query(
      `SELECT b.*, 
        u.first_name as customer_first_name, u.last_name as customer_last_name, u.phone as customer_phone, u.address as customer_address,
        tv.vehicle_number, tv.vehicle_name, tv.vehicle_type, tv.vehicle_make, tv.vehicle_model,
        del.current_status, del.status_description, del.estimated_pickup_time, del.estimated_delivery_time,
        del.actual_pickup_time, del.actual_delivery_time, del.delivery_otp
       FROM bookings b
       JOIN users u ON b.user_id = u.user_id
       JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       JOIN deliveries del ON b.booking_id = del.booking_id
       WHERE b.driver_id = ?
       ORDER BY 
         CASE b.status 
           WHEN 'confirmed' THEN 1 
           WHEN 'pickup_completed' THEN 2 
           WHEN 'in_transit' THEN 3 
           ELSE 4 
         END`,
      [driver.driver_id]
    );

    res.json({
      success: true,
      data: jobs,
      count: jobs.length
    });
  } catch (error) {
    console.error('Get my jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/drivers/update-status/:bookingId
// @desc    Update delivery status
// @access  Private (Driver)
router.put('/update-status/:bookingId', protect, [
  body('status').isIn(['pickup_completed', 'in_transit', 'delivered']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const bookingId = req.params.bookingId;
    const { status, notes } = req.body;

    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Check booking belongs to driver
    const booking = await get(
      'SELECT * FROM bookings WHERE booking_id = ? AND driver_id = ?',
      [bookingId, driver.driver_id]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not assigned to you'
      });
    }

    let bookingStatus = '';
    let deliveryStatus = '';
    let statusDescription = '';
    let timestamp = 'CURRENT_TIMESTAMP';

    switch (status) {
      case 'pickup_completed':
        bookingStatus = 'pickup_completed';
        deliveryStatus = 'pickup_completed';
        statusDescription = 'Pickup completed, goods loaded';
        break;
      case 'in_transit':
        bookingStatus = 'in_transit';
        deliveryStatus = 'in_transit';
        statusDescription = 'Vehicle in transit to destination';
        break;
      case 'delivered':
        bookingStatus = 'delivered';
        deliveryStatus = 'delivered';
        statusDescription = 'Delivery completed successfully';
        break;
    }

    // Update booking
    if (status === 'delivered') {
      await run(
        `UPDATE bookings SET status = ?, delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?`,
        [bookingStatus, bookingId]
      );
    } else {
      await run(
        `UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?`,
        [bookingStatus, bookingId]
      );
    }

    // Update delivery
    await run(
      `UPDATE deliveries SET 
        current_status = ?, 
        status_description = ?,
        ${status === 'pickup_completed' ? 'actual_pickup_time = CURRENT_TIMESTAMP,' : ''}
        ${status === 'delivered' ? 'actual_delivery_time = CURRENT_TIMESTAMP,' : ''}
        delivery_notes = COALESCE(?, delivery_notes),
        updated_at = CURRENT_TIMESTAMP 
       WHERE booking_id = ?`,
      [deliveryStatus, statusDescription, notes || null, bookingId]
    );

    // If delivered, make driver and vehicle available again
    if (status === 'delivered') {
      await run('UPDATE drivers SET is_available = 1, total_deliveries = total_deliveries + 1 WHERE driver_id = ?', [driver.driver_id]);
      await run('UPDATE transport_vehicles SET is_available = 1, current_status = ? WHERE vehicle_id = ?', ['available', booking.vehicle_id]);
    }

    res.json({
      success: true,
      message: `Status updated to ${status}`,
      data: {
        booking_id: bookingId,
        status: bookingStatus,
        delivery_status: deliveryStatus
      }
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating status'
    });
  }
});

// @route   GET /api/drivers/my-vehicles
// @desc    Get driver's vehicles
// @access  Private (Driver)
router.get('/my-vehicles', protect, async (req, res) => {
  try {
    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    const vehicles = await query(
      'SELECT * FROM transport_vehicles WHERE driver_id = ? ORDER BY vehicle_id DESC',
      [driver.driver_id]
    );

    res.json({
      success: true,
      data: vehicles,
      count: vehicles.length
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/drivers/register-vehicle
// @desc    Register a new vehicle
// @access  Private (Driver)
router.post('/register-vehicle', protect, [
  body('vehicle_number').notEmpty().withMessage('Vehicle number is required'),
  body('vehicle_type').isIn(['truck', 'mini_truck', 'pickup', 'tempo', 'lorry']).withMessage('Valid vehicle type required'),
  body('vehicle_name').notEmpty().withMessage('Vehicle name is required'),
  body('capacity_kg').isFloat({ min: 1 }).withMessage('Valid capacity required'),
  body('vehicle_make').notEmpty().withMessage('Vehicle make required'),
  body('vehicle_model').notEmpty().withMessage('Vehicle model required'),
  body('manufacturing_year').isInt({ min: 2000, max: new Date().getFullYear() }).withMessage('Valid manufacturing year required'),
  body('registration_date').notEmpty().withMessage('Registration date required'),
  body('insurance_number').notEmpty().withMessage('Insurance number required'),
  body('insurance_expiry').notEmpty().withMessage('Insurance expiry date required'),
  body('permit_number').notEmpty().withMessage('Permit number required'),
  body('permit_expiry').notEmpty().withMessage('Permit expiry date required'),
  body('base_location').notEmpty().withMessage('Base location required'),
  body('per_km_rate').isFloat({ min: 1 }).withMessage('Rate per km required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    const { 
      vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume,
      vehicle_make, vehicle_model, manufacturing_year, registration_date,
      insurance_number, insurance_expiry, permit_number, permit_expiry,
      pollution_certificate, pollution_expiry, base_location, hourly_rate, per_km_rate
    } = req.body;

    // Check if vehicle number already exists
    const existingVehicle = await get(
      'SELECT vehicle_id FROM transport_vehicles WHERE vehicle_number = ?',
      [vehicle_number]
    );

    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle with this number already registered'
      });
    }

    // Insert vehicle
    const result = await run(
      `INSERT INTO transport_vehicles (
        driver_id, vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume,
        vehicle_make, vehicle_model, manufacturing_year, registration_date,
        insurance_number, insurance_expiry, permit_number, permit_expiry,
        pollution_certificate, pollution_expiry, base_location, hourly_rate, per_km_rate,
        is_available, current_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        driver.driver_id, vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume || null,
        vehicle_make, vehicle_model, manufacturing_year, registration_date,
        insurance_number, insurance_expiry, permit_number, permit_expiry,
        pollution_certificate || null, pollution_expiry || null, base_location, hourly_rate || null, per_km_rate,
        1, 'available'
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully',
      data: {
        vehicle_id: result.lastID,
        vehicle_number,
        vehicle_type
      }
    });
  } catch (error) {
    console.error('Register vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error registering vehicle'
    });
  }
});

// @route   GET /api/drivers/stats
// @desc    Get driver statistics
// @access  Private (Driver)
router.get('/stats', protect, async (req, res) => {
  try {
    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Get stats
    const totalJobs = await get(
      'SELECT COUNT(*) as count FROM bookings WHERE driver_id = ?',
      [driver.driver_id]
    );

    const completedJobs = await get(
      'SELECT COUNT(*) as count FROM bookings WHERE driver_id = ? AND status IN (?, ?, ?)',
      [driver.driver_id, 'delivered', 'completed']
    );

    const earnings = await get(
      'SELECT SUM(final_price) as total FROM bookings WHERE driver_id = ? AND status IN (?, ?)',
      [driver.driver_id, 'delivered', 'completed']
    );

    const activeJobs = await get(
      'SELECT COUNT(*) as count FROM bookings WHERE driver_id = ? AND status IN (?, ?, ?)',
      [driver.driver_id, 'confirmed', 'pickup_completed', 'in_transit']
    );

    res.json({
      success: true,
      data: {
        total_deliveries: driver.total_deliveries,
        rating: driver.rating,
        completed_jobs: completedJobs.count,
        total_earnings: earnings.total || 0,
        active_jobs: activeJobs.count,
        is_available: driver.is_available
      }
    });
  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

