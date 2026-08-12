const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');
const { getVehiclePricing, getValidVehicleIds, LEGACY_TYPE_FALLBACK } = require('../services/vehiclePricing');

// Every vehicle uses its own per-km rate (from the shared pricing catalogue).
// Legacy generic types (truck/mini_truck/pickup/tempo/lorry) are resolved to a
// representative vehicle for backward compatibility.
const calculatePrice = (distance, vehicleType) => {
  const pricing = getVehiclePricing(vehicleType);
  if (!pricing) return null;
  return Math.round(distance * pricing.rate);
};

// Accept both the 18 catalogue vehicle ids and the legacy generic type names
// (truck/mini_truck/pickup/tempo/lorry) that BookTransport still submits.
const VALID_VEHICLE_TYPES = [...getValidVehicleIds(), ...Object.keys(LEGACY_TYPE_FALLBACK)];

const estimateDistance = (fromCity, toCity) => {
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
    'Darbhanga-Muzaffarpur': 45,
  };

  const key = `${fromCity}-${toCity}`;
  return cityDistances[key] || 100;
};

const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const BookingService = require('../services/BookingService');
const BookingRepository = require('../repositories/BookingRepository');
const { normalizeBookingIdentifier } = require('../services/BookingNumberService');
const { ValidationError, NotFoundError } = require('../utils/AppError');

const bookingService = new BookingService();
const bookingRepo = new BookingRepository();

const mapDomainErrorToHttp = (err, res, fallback = {}) => {
  const name = err?.name;
  const code = err?.code;

  if (name === 'ValidationError' || code === 'VALIDATION_ERROR') {
    return res.status(400).json({
      success: false,
      message: err?.message || 'Validation failed',
      ...fallback,
    });
  }

  if (name === 'NotFoundError' || code === 'NOT_FOUND') {
    return res.status(404).json({
      success: false,
      message: err?.message || 'Not found',
      ...fallback,
    });
  }

  // No other domain exception types exist in BookingService today.
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...fallback,
  });
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
  body('vehicle_type_required').isIn(VALID_VEHICLE_TYPES).withMessage('Valid vehicle type required')
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

    // Delegate to the single canonical creation service. BookingService
    // derives the booking_number (BTB-YYYY-NNNNN) from the DB primary key,
    // persists it atomically, and creates the delivery record + timeline
    // event. No inline Prisma transaction / random identifier here.
    const result = await bookingService.createBooking({
      user_id: req.user.user_id,
      pickup_location,
      pickup_address: pickup_address || null,
      pickup_city,
      pickup_state: pickup_state || 'Bihar',
      pickup_pincode: pickup_pincode || null,
      pickup_date,
      pickup_time,
      drop_location,
      drop_address: drop_address || null,
      drop_city,
      drop_state: drop_state || 'Bihar',
      drop_pincode: drop_pincode || null,
      goods_description,
      goods_type: goods_type || null,
      goods_weight_kg: goods_weight_kg ? Number(goods_weight_kg) : null,
      goods_volume: goods_volume ? Number(goods_volume) : null,
      number_of_items: number_of_items || 1,
      fragile: fragile ? true : false,
      vehicle_type_required,
      estimated_distance_km,
      estimated_price,
      final_price: estimated_price,
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking_id: result.booking_id,
        booking_number: result.booking_number,
        booking_reference: result.booking_reference || result.booking_number,
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
    const userId = parseInt(req.params.id);

    // Verify user can view these bookings
    if (req.user.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these bookings'
      });
    }

const bookings = await prisma.booking.findMany({
      where: { user_id: userId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        driver: {
          select: {
            license_number: true,
            rating: true,
            total_deliveries: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const flattened = bookings.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      booking_number: b.booking_number,
      user_id: b.user_id,
      driver_id: b.driver_id,
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
      driver_first_name: b.driver?.user?.first_name ?? null,
      driver_last_name: b.driver?.user?.last_name ?? null,
      driver_phone: b.driver?.user?.phone ?? null,
      vehicle_number: b.truck_number_snapshot ?? null,
      vehicle_type: null,
      vehicle_name: null,
    }));

    res.json({
      success: true,
      data: flattened,
      count: flattened.length,
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
const bookings = await prisma.booking.findMany({
      where: { user_id: req.user.user_id },
      include: {
        delivery: {
          select: {
            current_status: true,
            status_description: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const flattened = bookings.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      booking_number: b.booking_number,
      user_id: b.user_id,
      driver_id: b.driver_id,
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
      vehicle_number: b.truck_number_snapshot ?? null,
      vehicle_type: null,
      vehicle_name: null,
      current_status: b.delivery?.current_status ?? null,
      status_description: b.delivery?.status_description ?? null,
    }));

    res.json({
      success: true,
      data: flattened,
      count: flattened.length,
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
    const bookingId = parseInt(req.params.id, 10);

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            address: true,
          },
        },
        driver: {
          select: {
            driver_id: true,
            license_number: true,
            rating: true,
            total_deliveries: true,
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
            estimated_pickup_time: true,
            estimated_delivery_time: true,
            actual_pickup_time: true,
            actual_delivery_time: true,
            delivery_otp: true,
            otp_verified: true,
            recipient_name: true,
            delivery_notes: true,
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

    // Check authorization
    if (booking.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking',
      });
    }

    // Flatten the nested relations into the same shape as the original SQL query
    const flatBooking = {
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
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      confirmed_at: booking.confirmed_at,
      driver_assigned_at: booking.driver_assigned_at,
      pickup_completed_at: booking.pickup_completed_at,
      delivered_at: booking.delivered_at,
      customer_first_name: booking.user?.first_name || null,
      customer_last_name: booking.user?.last_name || null,
      customer_phone: booking.user?.phone || null,
      customer_address: booking.user?.address || null,
      driver_id: booking.driver?.driver_id || null,
      license_number: booking.driver?.license_number || null,
      rating: booking.driver?.rating || null,
      total_deliveries: booking.driver?.total_deliveries || null,
      driver_first_name: booking.driver?.user?.first_name || null,
driver_last_name: booking.driver?.user?.last_name || null,
      driver_phone: booking.driver?.user?.phone || null,
      vehicle_number: booking.truck_number_snapshot || null,
      vehicle_type: null,
      vehicle_name: null,
      vehicle_make: null,
      vehicle_model: null,
      capacity_kg: null,
      per_km_rate: null,
      current_status: booking.delivery?.current_status || null,
      status_description: booking.delivery?.status_description || null,
      estimated_pickup_time: booking.delivery?.estimated_pickup_time || null,
      estimated_delivery_time: booking.delivery?.estimated_delivery_time || null,
      actual_pickup_time: booking.delivery?.actual_pickup_time || null,
      actual_delivery_time: booking.delivery?.actual_delivery_time || null,
      delivery_otp: booking.delivery?.delivery_otp || null,
      otp_verified: booking.delivery?.otp_verified || null,
      recipient_name: booking.delivery?.recipient_name || null,
      delivery_notes: booking.delivery?.delivery_notes || null,
    };

    res.json({
      success: true,
      data: flatBooking,
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/bookings/:id/cancel
// @desc    Cancel a booking
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
    });

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

    // Perform cancellation in a transaction
    await prisma.$transaction(async (tx) => {
      // Update booking status
      await tx.booking.update({
        where: { booking_id: bookingId },
        data: { status: 'cancelled' },
      });

      // Update delivery status
      const existingDelivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
      });
      if (existingDelivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            current_status: 'booking_confirmed',
            status_description: 'Booking cancelled by customer',
          },
        });
      }

// If driver was assigned, make driver available again.
      if (booking.driver_id) {
        await tx.driver.update({
          where: { driver_id: booking.driver_id },
          data: { is_available: true },
        });
      }

      // If vehicle was assigned, make vehicle available again.
      if (booking.vehicle_id) {
        await tx.transportVehicle.update({
          where: { vehicle_id: booking.vehicle_id },
          data: { is_available: true, current_status: 'available' },
        });
      }
    });

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

// @route   POST /api/bookings/:id/quote/accept
// @desc    Customer accepts the admin's final quote.
//          Moves quote_status SENT → ACCEPTED and status → confirmed.
// @access  Private (Booking owner / admin)
router.post('/:id/quote/accept', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { user_id: true, quote_status: true },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    if (booking.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const result = await bookingService.respondToQuote(bookingId, 'ACCEPT');
    return res.json({ success: true, message: 'Quote accepted successfully', data: result });
  } catch (err) {
    console.error('Accept quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/bookings/:id/quote/reject
// @desc    Customer rejects the admin's final quote.
//          Moves quote_status SENT → REJECTED (booking stays pending).
// @access  Private (Booking owner / admin)
router.post('/:id/quote/reject', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { user_id: true, quote_status: true },
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    if (booking.user_id !== req.user.user_id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const result = await bookingService.respondToQuote(bookingId, 'REJECT');
    return res.json({ success: true, message: 'Quote rejected', data: result });
  } catch (err) {
    console.error('Reject quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   GET /api/bookings/track/:reference
// @desc    Track booking by reference number (full quote workflow context)
// @access  Public
router.get('/track/:reference', async (req, res) => {
  try {
    const reference = req.params.reference;

    // Use the service which enriches the response with:
    //   - active reservation (driver + vehicle held for approval)
    //   - quote lifecycle fields (sent_at, valid_until, accepted/rejected)
    //   - auto-expiry handling
    const data = await bookingService.getBookingForTracking(reference);

    res.json({
      success: true,
      message: 'Booking retrieved successfully',
      data,
      errors: null,
    });
  } catch (err) {
    console.error('Track booking error:', err);
    return mapDomainErrorToHttp(err, res, { message: 'Server error tracking booking' });
  }
});

// @route   POST /api/bookings/track/:reference/quote/accept
// @desc    Public quote acceptance by booking reference (guest customers).
//          No authentication required — the booking_reference is the secret.
//          The existing protected numeric-id endpoint remains for logged-in users.
// @access  Public
router.post('/track/:reference/quote/accept', async (req, res) => {
  try {
    const reference = req.params.reference;
    if (!reference || typeof reference !== 'string' || reference.trim() === '') {
      return res.status(400).json({ success: false, message: 'booking identifier is required', data: null, errors: null });
    }

    const identifier = normalizeBookingIdentifier(reference);
    const found = await bookingRepo.findByIdentifier(identifier);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Booking not found', data: null, errors: null });
    }

    const result = await bookingService.respondToQuote(found.booking_id, 'ACCEPT');
    return res.json({ success: true, message: 'Quote accepted successfully', data: result, errors: null });
  } catch (err) {
    console.error('Public accept quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/bookings/track/:reference/quote/reject
// @desc    Public quote rejection by booking reference (guest customers).
//          No authentication required — the booking_reference is the secret.
//          The existing protected numeric-id endpoint remains for logged-in users.
// @access  Public
router.post('/track/:reference/quote/reject', async (req, res) => {
  try {
    const reference = req.params.reference;
    if (!reference || typeof reference !== 'string' || reference.trim() === '') {
      return res.status(400).json({ success: false, message: 'booking identifier is required', data: null, errors: null });
    }

    const identifier = normalizeBookingIdentifier(reference);
    const found = await bookingRepo.findByIdentifier(identifier);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Booking not found', data: null, errors: null });
    }

    const result = await bookingService.respondToQuote(found.booking_id, 'REJECT');
    return res.json({ success: true, message: 'Quote rejected', data: result, errors: null });
  } catch (err) {
    console.error('Public reject quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

module.exports = router;

