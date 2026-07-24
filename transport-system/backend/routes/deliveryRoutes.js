const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');
const { protect } = require('../middleware/auth');

// @route   POST /api/delivery/update-location
// @desc    Update driver location for live tracking
// @access  Private (Driver)
router.post('/update-location', protect, async (req, res) => {
  try {
    // Get driver details via Prisma
    const driver = await prisma.driver.findFirst({
      where: { user_id: req.user.user_id },
      select: { driver_id: true },
    });
    
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

    const locationData = {
      current_latitude: parseFloat(latitude),
      current_longitude: parseFloat(longitude),
      last_location_update: new Date(),
    };

    // If booking_id provided, update location for specific delivery
    if (booking_id) {
      await prisma.delivery.updateMany({
        where: {
          booking_id: parseInt(booking_id),
          driver_id: driver.driver_id,
        },
        data: locationData,
      });
    }

    // Also update any active delivery for this driver
    await prisma.delivery.updateMany({
      where: {
        driver_id: driver.driver_id,
        current_status: {
          in: ['driver_assigned', 'pickup_in_progress', 'in_transit', 'out_for_delivery'],
        },
      },
      data: locationData,
    });

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
    const bookingId = parseInt(req.params.bookingId);

    const delivery = await prisma.delivery.findUnique({
      where: { booking_id: bookingId },
      select: {
        current_latitude: true,
        current_longitude: true,
        last_location_update: true,
        current_status: true,
        status_description: true,
        booking: {
          select: {
            booking_reference: true,
            pickup_city: true,
            drop_city: true,
          },
        },
      },
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    res.json({
      success: true,
      data: {
        current_latitude: delivery.current_latitude,
        current_longitude: delivery.current_longitude,
        last_location_update: delivery.last_location_update,
        current_status: delivery.current_status,
        status_description: delivery.status_description,
        booking_reference: delivery.booking?.booking_reference,
        pickup_city: delivery.booking?.pickup_city,
        drop_city: delivery.booking?.drop_city,
      },
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

    const delivery = await prisma.delivery.findUnique({
      where: { booking_id: parseInt(booking_id) },
      select: {
        delivery_id: true,
        delivery_otp: true,
        otp_verified: true,
      },
    });

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
    await prisma.delivery.update({
      where: { booking_id: parseInt(booking_id) },
      data: { otp_verified: true },
    });

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

    // Get driver details via Prisma
    const driver = await prisma.driver.findFirst({
      where: { user_id: req.user.user_id },
      select: { driver_id: true },
    });
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Check booking belongs to driver
    const booking = await prisma.booking.findFirst({
      where: {
        booking_id: parseInt(booking_id),
        driver_id: driver.driver_id,
      },
      select: {
        booking_id: true,
        vehicle_id: true,
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not assigned to you'
      });
    }

    // Perform all updates in a transaction
    await prisma.$transaction(async (tx) => {
      // Update delivery
      await tx.delivery.update({
        where: { booking_id: parseInt(booking_id) },
        data: {
          current_status: 'delivered',
          status_description: 'Delivery completed',
          actual_delivery_time: new Date(),
          recipient_name: recipient_name || null,
          delivery_notes: delivery_notes || null,
          delivery_proof_image: delivery_proof_image || null,
        },
      });

      // Update booking status
      await tx.booking.update({
        where: { booking_id: parseInt(booking_id) },
        data: {
          status: 'delivered',
          delivered_at: new Date(),
        },
      });

      // Make driver available again
      await tx.driver.update({
        where: { driver_id: driver.driver_id },
        data: {
          is_available: true,
          total_deliveries: { increment: 1 },
        },
      });

      // Make vehicle available again
      if (booking.vehicle_id) {
        await tx.transportVehicle.update({
          where: { vehicle_id: booking.vehicle_id },
          data: {
            is_available: true,
            current_status: 'available',
          },
        });
      }
    });

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

