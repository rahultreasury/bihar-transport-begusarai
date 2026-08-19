const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { validateTransition } = require('../utils/BookingStateMachine');
const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');
const TripFinancialService = require('../services/TripFinancialService');

const timelineRepo = new BookingTimelineRepository();
const tripFinancialService = new TripFinancialService();

// @route   GET /api/drivers/available-jobs
// @desc    Get available transport jobs
// @access  Private (Driver)
router.get('/available-jobs', protect, async (req, res) => {
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

    // Get available vehicles that belong to driver
    const vehicles = await prisma.transportVehicle.findMany({
      where: {
        driver_id: driver.driver_id,
        is_available: true,
      },
      select: { vehicle_type: true },
    });

    const vehicleTypes = vehicles.map(v => v.vehicle_type);

    if (vehicleTypes.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No vehicles registered or available'
      });
    }

    // Get available bookings matching driver's vehicle types.
    // Enterprise rule: only bookings that have NOT entered the quote workflow
    // (quote_status === 'PENDING') are shown as available jobs. Once an admin
    // has sent a quote (quote_status = SENT), the driver/vehicle are reserved
    // and the job is no longer available for self-acceptance.
    const jobs = await prisma.booking.findMany({
      where: {
        status: 'pending',
        quote_status: 'PENDING',
        vehicle_type_required: { in: vehicleTypes },
      },
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
            vehicle_id: true,
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            capacity_kg: true,
            per_km_rate: true,
          },
        },
      },
      orderBy: [
        { pickup_date: 'asc' },
        { pickup_time: 'asc' },
      ],
    });

    // Flatten to match original SQL response format
    const flattened = jobs.map((b) => ({
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
      vehicle_id: b.vehicle?.vehicle_id ?? null,
      vehicle_number: b.vehicle?.vehicle_number ?? null,
      vehicle_name: b.vehicle?.vehicle_name ?? null,
      vehicle_type: b.vehicle?.vehicle_type ?? null,
      capacity_kg: b.vehicle?.capacity_kg ?? null,
      per_km_rate: b.vehicle?.per_km_rate ?? null,
    }));

    res.json({
      success: true,
      data: flattened,
      count: flattened.length,
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
    const bookingId = parseInt(req.params.bookingId);
    const { vehicle_id } = req.body;

    // Get driver details via Prisma
    const driver = await prisma.driver.findFirst({
      where: { user_id: req.user.user_id },
    });
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Check if vehicle belongs to driver
    const vehicle = await prisma.transportVehicle.findFirst({
      where: {
        vehicle_id: parseInt(vehicle_id),
        driver_id: driver.driver_id,
      },
    });

    if (!vehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle not found or does not belong to you'
      });
    }

    // Check booking exists and is pending
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Enterprise rule: a driver may ONLY accept a booking AFTER the customer
    // has accepted the final quote (quote_status === 'ACCEPTED'). This prevents
    // a driver from starting a trip before the customer has confirmed.
    if (booking.quote_status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'This booking cannot be accepted yet. Customer must accept the final quote first.'
      });
    }

if (booking.status !== 'pending' && booking.status !== 'quote_sent') {
      return res.status(400).json({
        success: false,
        message: 'This booking is no longer available'
      });
    }

    // Enforce the canonical state machine. Reaching the driver-assigned and
    // then confirmed state must go through a valid transition. A driver
    // accepting a job moves the booking from pending/quote_sent to
    // 'driver_assigned' (the canonical state), then immediately to
    // 'confirmed' (the booked state) once the driver + vehicle are set.
    try {
      validateTransition(booking.status, 'driver_assigned');
      validateTransition('driver_assigned', 'confirmed');
    } catch (err) {
      return res.status(409).json({
        success: false,
        message: err.message,
      });
    }

    // Estimate delivery hours based on distance
    const estimatedHours = Math.round((booking.estimated_distance_km || 0) / 40);

    // Perform all updates in a transaction
    await prisma.$transaction(async (tx) => {
      // Update booking to confirmed (driver accepted + assigned the job).
      await tx.booking.update({
        where: { booking_id: bookingId },
        data: {
          driver_id: driver.driver_id,
          vehicle_id: parseInt(vehicle_id),
          status: 'confirmed',
          driver_assigned_at: new Date(),
        },
      });

      // Record the transition in the booking timeline.
      await timelineRepo.addEvent(
        bookingId,
        'booking_status_changed',
        JSON.stringify({ from: booking.status, to: 'confirmed', actor: 'driver', actorId: driver.driver_id, vehicle_id: parseInt(vehicle_id) }),
        tx
      );

      // Update or create delivery record
      const existingDelivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
      });

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      if (existingDelivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: driver.driver_id,
            vehicle_id: parseInt(vehicle_id),
            current_status: 'driver_assigned',
            status_description: 'Driver assigned to pickup',
            estimated_pickup_time: booking.pickup_date ? new Date(booking.pickup_date) : new Date(),
            estimated_delivery_time: booking.pickup_date
              ? new Date(new Date(booking.pickup_date).getTime() + estimatedHours * 60 * 60 * 1000)
              : new Date(Date.now() + estimatedHours * 60 * 60 * 1000),
            delivery_otp: otp,
          },
        });
      } else {
        await tx.delivery.create({
          data: {
            booking_id: bookingId,
            driver_id: driver.driver_id,
            vehicle_id: parseInt(vehicle_id),
            current_status: 'driver_assigned',
            status_description: 'Driver assigned to pickup',
            estimated_pickup_time: booking.pickup_date ? new Date(booking.pickup_date) : new Date(),
            estimated_delivery_time: booking.pickup_date
              ? new Date(new Date(booking.pickup_date).getTime() + estimatedHours * 60 * 60 * 1000)
              : new Date(Date.now() + estimatedHours * 60 * 60 * 1000),
            delivery_otp: otp,
          },
        });
      }

      // Make driver unavailable
      await tx.driver.update({
        where: { driver_id: driver.driver_id },
        data: { is_available: false },
      });

      // Make vehicle unavailable
      await tx.transportVehicle.update({
        where: { vehicle_id: parseInt(vehicle_id) },
        data: { is_available: false, current_status: 'on_trip' },
      });

      // Initialize trip financial record
      await tripFinancialService.initializeTripFinancial(bookingId, {
        user_id: driver.driver_id,
        role: 'driver',
      });
    });

    res.json({
      success: true,
      message: 'Job accepted successfully',
      data: {
        booking_id: bookingId,
        driver_id: driver.driver_id,
        vehicle_id: parseInt(vehicle_id),
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

    const jobs = await prisma.booking.findMany({
      where: { driver_id: driver.driver_id },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            address: true,
          },
        },
        vehicle: {
          select: {
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            vehicle_make: true,
            vehicle_model: true,
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
          },
        },
        tripFinancial: true,
      },
    });

    // Sort: confirmed → pickup_started → pickup_completed → in_transit → out_for_delivery → delivered → completed → others
    const statusOrder = {
      'confirmed': 1,
      'pickup_started': 2,
      'pickup_completed': 3,
      'in_transit': 4,
      'out_for_delivery': 5,
      'delivered': 6,
      'completed': 7,
    };
    const sorted = [...jobs].sort((a, b) => {
      const aOrder = statusOrder[a.status] || 8;
      const bOrder = statusOrder[b.status] || 8;
      return aOrder - bOrder;
    });

    // Flatten to match original SQL response format with role-based financial data
    const flattened = sorted.map((b) => {
      // Get driver-specific financial summary (NO customer fare, NO BT margin)
      const financial = b.tripFinancial ? {
        tripAmount: b.tripFinancial.driver_payout,
        advanceReceived: b.tripFinancial.total_advance,
        fuelAdvance: b.tripFinancial.total_fuel_advance,
        remainingAmount: b.tripFinancial.remaining_driver_settlement,
        paymentStatus: b.tripFinancial.status,
      } : null;

      return {
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
        customer_address: b.user?.address ?? null,
        vehicle_number: b.vehicle?.vehicle_number ?? null,
        vehicle_name: b.vehicle?.vehicle_name ?? null,
        vehicle_type: b.vehicle?.vehicle_type ?? null,
        vehicle_make: b.vehicle?.vehicle_make ?? null,
        vehicle_model: b.vehicle?.vehicle_model ?? null,
        current_status: b.delivery?.current_status ?? null,
        status_description: b.delivery?.status_description ?? null,
        estimated_pickup_time: b.delivery?.estimated_pickup_time ?? null,
        estimated_delivery_time: b.delivery?.estimated_delivery_time ?? null,
        actual_pickup_time: b.delivery?.actual_pickup_time ?? null,
        actual_delivery_time: b.delivery?.actual_delivery_time ?? null,
        delivery_otp: b.delivery?.delivery_otp ?? null,
        // Driver-specific financial data (NO customer fare, NO BT margin)
        financial,
      };
    });

    res.json({
      success: true,
      data: flattened,
      count: flattened.length,
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
// @desc    Update delivery status (validated through BookingStateMachine)
// @access  Private (Driver)
router.put('/update-status/:bookingId', protect, [
  body('status').isIn(['pickup_started', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const bookingId = parseInt(req.params.bookingId);
    const { status, notes } = req.body;

    // Get driver details via Prisma
    const driver = await prisma.driver.findFirst({
      where: { user_id: req.user.user_id },
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
        booking_id: bookingId,
        driver_id: driver.driver_id,
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not assigned to you'
      });
    }

    // Enterprise rule: validate every status transition through the state machine.
    // A driver cannot skip stages (e.g. jump to delivered from confirmed) and
    // cannot start a trip before the customer has accepted the quote.
    try {
      validateTransition(booking.status, status);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    let bookingStatus = '';
    let deliveryStatus = '';
    let statusDescription = '';

    switch (status) {
      case 'pickup_started':
        bookingStatus = 'pickup_started';
        deliveryStatus = 'pickup_in_progress';
        statusDescription = 'Driver started pickup';
        break;
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
      case 'out_for_delivery':
        bookingStatus = 'out_for_delivery';
        deliveryStatus = 'out_for_delivery';
        statusDescription = 'Out for delivery to destination';
        break;
      case 'delivered':
        bookingStatus = 'delivered';
        deliveryStatus = 'delivered';
        statusDescription = 'Delivery completed successfully';
        break;
    }

    // Perform updates in a transaction
    await prisma.$transaction(async (tx) => {
      // Update booking
      const bookingUpdateData = {
        status: bookingStatus,
      };
      if (status === 'delivered') {
        bookingUpdateData.delivered_at = new Date();
      }
await tx.booking.update({
        where: { booking_id: bookingId },
        data: bookingUpdateData,
      });

      // Record the transition in the booking timeline.
      await timelineRepo.addEvent(
        bookingId,
        'booking_status_changed',
        JSON.stringify({ from: booking.status, to: status, actor: 'driver', actorId: driver.driver_id, notes: notes || null }),
        tx
      );

      // Update delivery
      const deliveryUpdateData = {
        current_status: deliveryStatus,
        status_description: statusDescription,
        delivery_notes: notes || undefined,
      };
      if (status === 'pickup_completed') {
        deliveryUpdateData.actual_pickup_time = new Date();
      }
      if (status === 'delivered') {
        deliveryUpdateData.actual_delivery_time = new Date();
      }
      await tx.delivery.update({
        where: { booking_id: bookingId },
        data: deliveryUpdateData,
      });

      // If delivered, make driver and vehicle available again
      if (status === 'delivered') {
        await tx.driver.update({
          where: { driver_id: driver.driver_id },
          data: {
            is_available: true,
            total_deliveries: { increment: 1 },
          },
        });

        if (booking.vehicle_id) {
          await tx.transportVehicle.update({
            where: { vehicle_id: booking.vehicle_id },
            data: {
              is_available: true,
              current_status: 'available',
            },
          });
        }
      }
    });

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

    const vehicles = await prisma.transportVehicle.findMany({
      where: { driver_id: driver.driver_id },
      orderBy: { vehicle_id: 'desc' },
    });

    res.json({
      success: true,
      data: vehicles,
      count: vehicles.length,
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

    const { 
      vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume,
      vehicle_make, vehicle_model, manufacturing_year, registration_date,
      insurance_number, insurance_expiry, permit_number, permit_expiry,
      pollution_certificate, pollution_expiry, base_location, hourly_rate, per_km_rate
    } = req.body;

    // Check if vehicle number already exists
    const existingVehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_number: vehicle_number },
      select: { vehicle_id: true },
    });

    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle with this number already registered'
      });
    }

    // Create vehicle via Prisma
    const newVehicle = await prisma.transportVehicle.create({
      data: {
        driver_id: driver.driver_id,
        vehicle_number,
        vehicle_type,
        vehicle_name,
        capacity_kg: parseFloat(capacity_kg),
        capacity_volume: capacity_volume ? parseFloat(capacity_volume) : null,
        vehicle_make,
        vehicle_model,
        manufacturing_year: parseInt(manufacturing_year),
        registration_date,
        insurance_number,
        insurance_expiry,
        permit_number,
        permit_expiry,
        pollution_certificate: pollution_certificate || null,
        pollution_expiry: pollution_expiry || null,
        base_location,
        hourly_rate: hourly_rate ? parseFloat(hourly_rate) : null,
        per_km_rate: parseFloat(per_km_rate),
        is_available: true,
        current_status: 'available',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully',
      data: {
        vehicle_id: newVehicle.vehicle_id,
        vehicle_number,
        vehicle_type,
      },
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
    // Get driver details via Prisma
    const driver = await prisma.driver.findFirst({
      where: { user_id: req.user.user_id },
    });
    
    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Get stats using Prisma aggregations
    const totalJobs = await prisma.booking.count({
      where: { driver_id: driver.driver_id },
    });

    const completedJobs = await prisma.booking.count({
      where: {
        driver_id: driver.driver_id,
        status: { in: ['delivered', 'completed'] },
      },
    });

    const earningsAgg = await prisma.booking.aggregate({
      where: {
        driver_id: driver.driver_id,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { final_price: true },
    });

    const activeJobs = await prisma.booking.count({
      where: {
        driver_id: driver.driver_id,
        status: { in: ['confirmed', 'pickup_completed', 'in_transit'] },
      },
    });

    res.json({
      success: true,
      data: {
        total_deliveries: driver.total_deliveries,
        rating: driver.rating,
        completed_jobs: completedJobs,
        total_earnings: earningsAgg._sum.final_price || 0,
        active_jobs: activeJobs,
        is_available: driver.is_available,
      },
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

