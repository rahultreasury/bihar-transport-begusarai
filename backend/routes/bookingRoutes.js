const express = require('express');
const router = express.Router();
const { query, run, get } = require('../config/database');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// Generate booking reference
const generateBookingRef = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `BTB-${timestamp.slice(-4)}${random}`;
};

// Calculate estimated price based on distance and vehicle type
const calculatePrice = (distance, vehicleType) => {
  const rates = {
    'truck': { base: 500, perKm: 25 },
    'mini_truck': { base: 300, perKm: 18 },
    'pickup': { base: 250, perKm: 15 },
    'tempo': { base: 400, perKm: 20 },
    'lorry': { base: 700, perKm: 30 }
  };
  
  const rate = rates[vehicleType] || rates['pickup'];
  return rate.base + (distance * rate.perKm);
};

// Estimate distance (in a real app, use a mapping API)
const estimateDistance = (fromCity, toCity) => {
  // Simple distance estimation - in production, use Google Maps API
  const cityDistances = {
    'Begusarai-Patna': 180,
    'Patna-Begusarai': 180,
    'Begusarai-Muzaffarpur': 90,
    'Muzaffarpur-Begusarai': 90,
    'Patna-Muzaffarpur': 80,
    'Muzaffarpur-Patna': 80,
    'Begusarai-Gaya': 140,
    'Gaya-Begusarai': 140,
    'Patna-Gaya': 110,
    'Gaya-Patna': 110,
    'Muzaffarpur-Darbhanga': 45,
    'Darbhanga-Muzaffarpur': 45
  };
  
  const key = `${fromCity}-${toCity}`;
  return cityDistances[key] || 100; // Default 100km if unknown
};

// @route   POST /api/bookings/create
// @desc    Create a new transport booking
// @access  Private (Customer)
router.post('/create', protect, [
  body('pickup_location').notEmpty().withMessage('Pickup location is required'),
  body('pickup_city').notEmpty().withMessage('Pickup city is required'),
  body('drop_location').notEmpty().withMessage('Drop location is required'),
  body('drop_city').notEmpty().withMessage('Drop city is required'),
  body('pickup_date').notEmpty().withMessage('Pickup date is required'),
  body('pickup_time').notEmpty().withMessage('Pickup time is required'),
  body('goods_description').notEmpty().withMessage('Goods description is required'),
  body('vehicle_type_required').isIn(['truck', 'mini_truck', 'pickup', 'tempo', 'lorry']).withMessage('Valid vehicle type required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { 
      pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode,
      pickup_date, pickup_time,
      drop_location, drop_address, drop_city, drop_state, drop_pincode,
      goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile,
      vehicle_type_required
    } = req.body;

    // Estimate distance and price
    const estimated_distance_km = estimateDistance(pickup_city, drop_city);
    const estimated_price = calculatePrice(estimated_distance_km, vehicle_type_required);

    // Generate booking reference
    const booking_reference = generateBookingRef();

    // Insert booking
    const result = await run(
      `INSERT INTO bookings (
        booking_reference, user_id, pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode,
        pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state, drop_pincode,
        goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile,
        vehicle_type_required, estimated_distance_km, estimated_price, final_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        booking_reference, req.user.user_id, pickup_location, pickup_address, pickup_city, pickup_state || 'Bihar', pickup_pincode,
        pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state || 'Bihar', drop_pincode,
        goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items || 1, fragile ? 1 : 0,
        vehicle_type_required, estimated_distance_km, estimated_price, estimated_price, 'pending'
      ]
    );

    // Create delivery record
    await run(
      'INSERT INTO deliveries (booking_id, current_status, status_description) VALUES (?, ?, ?)',
      [result.lastID, 'booking_confirmed', 'Booking confirmed, waiting for driver assignment']
    );

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking_id: result.lastID,
        booking_reference,
        estimated_distance_km,
        estimated_price,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating booking'
    });
  }
});

// @route   GET /api/bookings/user/:id
// @desc    Get all bookings for a user
// @access  Private
router.get('/user/:id', protect, async (req, res) => {
  try {
    const userId = req.params.id;

    // Verify user can view these bookings
    if (req.user.user_id !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these bookings'
      });
    }

    const bookings = await query(
      `SELECT b.*, 
        u.first_name as customer_first_name, u.last_name as customer_last_name, u.phone as customer_phone,
        d.first_name as driver_first_name, d.last_name as driver_last_name, d.phone as driver_phone,
        tv.vehicle_number, tv.vehicle_type, tv.vehicle_name
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.user_id
       LEFT JOIN drivers dr ON b.driver_id = dr.driver_id
       LEFT JOIN users d ON dr.user_id = d.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: bookings,
      count: bookings.length
    });
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/bookings/my-bookings
// @desc    Get current user's bookings
// @access  Private
router.get('/my-bookings', protect, async (req, res) => {
  try {
    const bookings = await query(
      `SELECT b.*, 
        tv.vehicle_number, tv.vehicle_type, tv.vehicle_name,
        d.current_status, d.status_description
       FROM bookings b
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       LEFT JOIN deliveries d ON b.booking_id = d.booking_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      data: bookings,
      count: bookings.length
    });
  } catch (error) {
    console.error('Get my bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/bookings/:id
// @desc    Get booking details
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const bookingId = req.params.id;

    const booking = await get(
      `SELECT b.*, 
        u.first_name as customer_first_name, u.last_name as customer_last_name, u.phone as customer_phone, u.address as customer_address,
        dr.driver_id, dr.license_number, dr.rating, dr.total_deliveries,
        d.first_name as driver_first_name, d.last_name as driver_last_name, d.phone as driver_phone,
        tv.vehicle_number, tv.vehicle_type, tv.vehicle_name, tv.vehicle_make, tv.vehicle_model,
        tv.capacity_kg, tv.per_km_rate,
        del.current_status, del.status_description, del.estimated_pickup_time, del.estimated_delivery_time,
        del.actual_pickup_time, del.actual_delivery_time, del.delivery_otp, del.otp_verified,
        del.recipient_name, del.delivery_notes
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.user_id
       LEFT JOIN drivers dr ON b.driver_id = dr.driver_id
       LEFT JOIN users d ON dr.user_id = d.user_id
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
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

    // Check authorization
    if (booking.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
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

// @route   PUT /api/bookings/:id/cancel
// @desc    Cancel a booking
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const bookingId = req.params.id;

    const booking = await get('SELECT * FROM bookings WHERE booking_id = ?', [bookingId]);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    if (booking.user_id !== req.user.user_id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (['in_transit', 'delivered', 'completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'This booking cannot be cancelled'
      });
    }

    // Update booking status
    await run(
      'UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
      ['cancelled', bookingId]
    );

    // Update delivery status
    await run(
      'UPDATE deliveries SET current_status = ?, status_description = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
      ['booking_confirmed', 'Booking cancelled by customer', bookingId]
    );

    // If driver was assigned, make driver available again
    if (booking.driver_id) {
      await run(
        'UPDATE drivers SET is_available = 1 WHERE driver_id = ?',
        [booking.driver_id]
      );
      
      await run(
        'UPDATE transport_vehicles SET is_available = 1, current_status = ? WHERE vehicle_id = ?',
        ['available', booking.vehicle_id]
      );
    }

    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error cancelling booking'
    });
  }
});

// @route   GET /api/bookings/track/:reference
// @desc    Track booking by reference number
// @access  Public
router.get('/track/:reference', async (req, res) => {
  try {
    const reference = req.params.reference;

    const booking = await get(
      `SELECT b.booking_id, b.booking_reference, b.pickup_location, b.pickup_city, b.drop_location, b.drop_city,
        b.goods_description, b.status, b.estimated_price, b.pickup_date, b.pickup_time,
        b.driver_id, b.vehicle_id,
        tv.vehicle_number, tv.vehicle_name, tv.vehicle_type,
        del.current_status, del.status_description, del.estimated_pickup_time, del.estimated_delivery_time,
        dr.user_id
       FROM bookings b
       LEFT JOIN transport_vehicles tv ON b.vehicle_id = tv.vehicle_id
       LEFT JOIN deliveries del ON b.booking_id = del.booking_id
       LEFT JOIN drivers dr ON b.driver_id = dr.driver_id
       WHERE b.booking_reference = ?`,
      [reference]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Get driver info if assigned
    let driverInfo = null;
    if (booking.driver_id) {
      const driver = await get(
        `SELECT d.driver_id, d.rating, d.total_deliveries, u.first_name, u.last_name         FROM drivers d, u.phone

         JOIN users u ON d.user_id = u.user_id
         WHERE d.driver_id = ?`,
        [booking.driver_id]
      );
      driverInfo = driver;
    }

    res.json({
      success: true,
      data: {
        ...booking,
        driver: driverInfo
      }
    });
  } catch (error) {
    console.error('Track booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error tracking booking'
    });
  }
});

module.exports = router;

