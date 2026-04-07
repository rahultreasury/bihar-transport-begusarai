const express = require('express');
const router = express.Router();
const { query, run, get } = require('../config/database');
const { protect } = require('../middleware/auth');

// @route   POST /api/delivery/update-location
// @desc    Update driver location for live tracking
// @access  Private (Driver)
router.post('/update-location', protect, async (req, res) => {
  try {
    // Get driver details
    const driver = await get('SELECT * FROM drivers WHERE user_id = ?', [req.user.user_id]);
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    const { latitude, longitude, booking_id } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // If booking_id provided, update location for specific delivery
    if (booking_id) {
      await run(
        `UPDATE deliveries SET 
          current_latitude = ?,
          current_longitude = ?,
          last_location_update = CURRENT_TIMESTAMP
         WHERE booking_id = ? AND driver_id = ?`,
        [latitude, longitude, booking_id, driver.driver_id]
      );
    }

    // Also update any active delivery for this driver
    await run(
      `UPDATE deliveries SET 
        current_latitude = ?,
        current_longitude = ?,
        last_location_update = CURRENT_TIMESTAMP
       WHERE driver_id = ? AND current_status IN ('driver_assigned', 'pickup_in_progress', 'in_transit', 'out_for_delivery')`,
      [latitude, longitude, driver.driver_id]
    );

    res.json({
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating location'
    });
  }
});

// @route   GET /api/delivery/location/:bookingId
// @desc    Get current location of driver for a delivery
// @access  Public (with booking reference)
router.get('/location/:bookingId', async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    const delivery = await get(
      `SELECT d.current_latitude, d.current_longitude, d.last_location_update,
        d.current_status, d.status_description,
        b.booking_reference, b.pickup_city, b.drop_city
       FROM deliveries d
       JOIN bookings b ON d.booking_id = b.booking_id
       WHERE d.booking_id = ?`,
      [bookingId]
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    res.json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/delivery/verify-otp
// @desc    Verify delivery OTP
// @access  Private
router.post('/verify-otp', protect, async (req, res) => {
  try {
    const { booking_id, otp } = req.body;

    if (!booking_id || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and OTP are required'
      });
    }

    const delivery = await get(
      'SELECT * FROM deliveries WHERE booking_id = ?',
      [booking_id]
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (delivery.delivery_otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (delivery.otp_verified) {
      return res.status(400).json({
        success: false,
        message: 'OTP already verified'
      });
    }

    // Mark OTP as verified
    await run(
      'UPDATE deliveries SET otp_verified = 1 WHERE booking_id = ?',
      [booking_id]
    );

    res.json({
      success: true,
      message: 'OTP verified successfully'
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/delivery/complete
// @desc    Complete delivery with recipient details
// @access  Private (Driver)
router.post('/complete', protect, async (req, res) => {
  try {
    const { booking_id, recipient_name, delivery_notes, delivery_proof_image } = req.body;

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
      [booking_id, driver.driver_id]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not assigned to you'
      });
    }

    // Update delivery
    await run(
      `UPDATE deliveries SET 
        current_status = 'delivered',
        status_description = 'Delivery completed',
        actual_delivery_time = CURRENT_TIMESTAMP,
        recipient_name = ?,
        delivery_notes = ?,
        delivery_proof_image = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
      [recipient_name || null, delivery_notes || null, delivery_proof_image || null, booking_id]
    );

    // Update booking status
    await run(
      `UPDATE bookings SET 
        status = 'delivered',
        delivered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE booking_id = ?`,
      [booking_id]
    );

    // Make driver and vehicle available again
    await run('UPDATE drivers SET is_available = 1, total_deliveries = total_deliveries + 1 WHERE driver_id = ?', [driver.driver_id]);
    await run('UPDATE transport_vehicles SET is_available = 1, current_status = ? WHERE vehicle_id = ?', ['available', booking.vehicle_id]);

    res.json({
      success: true,
      message: 'Delivery completed successfully'
    });
  } catch (error) {
    console.error('Complete delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

