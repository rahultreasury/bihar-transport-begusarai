const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const { sendBookingNotification } = require('../services/emailService');
const { prisma } = require('../config/prisma');
const BookingService = require('../services/BookingService');

const router = express.Router();

// Canonical booking-creation path. Booking numbers (BTB-YYYY-NNNNN) are
// generated ONCE by BookingService.createBooking → BookingNumberService, which
// derives the number from the DB primary key. All booking-creation endpoints
// share this single service so no two parts of the system can produce
// different identifiers.
const bookingService = new BookingService();


const requiredString = (fieldLabel) =>
  body(fieldLabel)
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage(`${fieldLabel} is required`);

const validateMvpBooking = [
  requiredString('pickup'),
  requiredString('drop'),
  requiredString('vehicle'),
  requiredString('distance'),
  requiredString('price'),
  requiredString('customerName'),
  requiredString('mobile'),
  requiredString('goodsType'),

  body('distance')
    .matches(/^\d+(\.\d+)?$/)
    .withMessage('distance must be a number'),
  body('price')
    .matches(/^\d+(\.\d+)?$/)
    .withMessage('price must be a number'),

// Spec: 10-digit Indian mobile number starting with 6, 7, 8, or 9
  body('mobile')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('mobile must be a valid 10-digit Indian number starting with 6, 7, 8, or 9'),

  // Optional fields - accept strings if present
  body('pickupDate').optional().isString(),
  body('pickupTime').optional().isString(),
];

/**
 * POST /api/booking
 * MVP booking submission endpoint (no DB writes).
 */
router.post('/booking', validateMvpBooking, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fields = errors.array().map((e) => ({ field: e.param, message: e.msg }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      data: null,
      errors: fields,
    });
  }

  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[booking][incoming]', {
        pickup: req.body.pickup,
        drop: req.body.drop,
        vehicle: req.body.vehicle,
        distance: req.body.distance,
        price: req.body.price,
        customerName: req.body.customerName,
        mobile: req.body.mobile,
        goodsType: req.body.goodsType,
        pickupDate: req.body.pickupDate,
        pickupTime: req.body.pickupTime,
      });
    }


    const mobile = req.body.mobile;
    const placeholderEmail = `guest_${mobile}@btb.local`;

    // Lookup or create guest user (Prisma/PostgreSQL)
    let user;
    user = await prisma.user.findFirst({
      where: { phone: mobile },
      select: { user_id: true }
    });
    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(`guest_${mobile}`, salt);
      const newUser = await prisma.user.create({
        data: {
          first_name: 'Guest',
          last_name: 'Customer',
          email: placeholderEmail,
          phone: mobile,
          password_hash,
          role: 'customer',
          is_active: true,
        },
        select: { user_id: true }
      });
      user = { user_id: newUser.user_id };
    }

const estimated_distance_km = Number(req.body.distance);
    const estimated_price = Number(req.body.price);

    // Delegate to the single canonical creation service. BookingService
    // derives the booking_number (BTB-YYYY-NNNNN) from the DB primary key,
    // persists it atomically, and creates the delivery record + timeline
    // event. No UUID / Math.random() / inline Prisma transaction here.
    const created = await bookingService.createBooking({
      user_id: user.user_id,
      pickup_location: req.body.pickup,
      pickup_address: null,
      pickup_city: req.body.pickup,
      pickup_state: 'Bihar',
      pickup_pincode: null,
      pickup_date: req.body.pickupDate || null,
      pickup_time: req.body.pickupTime || '00:00:00',
      drop_location: req.body.drop,
      drop_address: null,
      drop_city: req.body.drop,
      drop_state: 'Bihar',
      drop_pincode: null,
      goods_description: req.body.goodsType,
      goods_type: req.body.goodsType,
      goods_weight_kg: null,
      goods_volume: null,
      number_of_items: 1,
      fragile: false,
      vehicle_type_required: req.body.vehicle,
      estimated_distance_km,
      estimated_price,
      final_price: estimated_price,
      status: 'pending',
      // Explicit quote lifecycle start so the tracking UI is consistent
      // (Pending → Sent → Accepted/Rejected) even for guest bookings.
      quote_status: 'PENDING',
    });

    const booking_id = created.booking_id;
    const booking_reference = created.booking_reference || created.booking_number;

    console.log('Booking saved with id:', booking_id);

    const bookingPayload = {
      ...req.body,
      booking_reference,
      booking_id,
    };

// Fire-and-forget email notification — never blocks the booking response.
    (async () => {
      try {
        const result = await sendBookingNotification(bookingPayload);
        if (result.success) {
          console.log('[booking][email] sent');
        } else {
          console.warn('[booking][email]', result.message);
        }
      } catch (err) {
        console.error('[booking][email]', err);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Booking submitted successfully.',
      data: {
        booking_id,
        booking_reference,
        status: 'pending',
        quote_status: 'PENDING',
      },
      errors: null,
    });

  } catch (err) {
    // Log the real cause server-side; never expose stack traces to clients.
    console.error('[booking][error]', {
      message: err?.message,
      stack: err?.stack,
      code: err?.code,
      name: err?.name,
    });

    // Distinguish database / validation failures from an unreliable WhatsApp
    // delivery. A booking that failed to save MUST NOT claim success.
    const isDuplicate =
      err?.code === 'P2002' || // Prisma unique constraint
      /duplicate/i.test(err?.message || '');

    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        message: 'A booking with this reference already exists. Please try again.',
        data: null,
        errors: [{ field: 'booking_reference', message: 'Duplicate booking reference' }],
      });
    }

    return res.status(500).json({
      success: false,
      message: 'We could not save your booking. Please try again.',
      data: null,
      errors: null,
    });
  }
});

module.exports = router;

