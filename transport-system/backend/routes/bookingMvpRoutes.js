const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const { sendBookingNotification } = require('../services/emailService');
const { prisma } = require('../config/prisma');

const router = express.Router();


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
      fields,
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

    const { booking_id, booking_reference } = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          booking_reference: 'TEMP',
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
        },
      });

      const year = new Date().getFullYear();
      const ref = `BTB${year}${String(booking.booking_id).padStart(5, '0')}`;

      await tx.booking.update({
        where: { booking_id: booking.booking_id },
        data: { booking_reference: ref, booking_number: ref },
      });

      await tx.delivery.create({
        data: {
          booking_id: booking.booking_id,
          current_status: 'booking_confirmed',
          status_description: 'Booking confirmed, waiting for driver assignment',
        },
      });

      return { booking_id: booking.booking_id, booking_reference: ref };
    });

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
      bookingReference: booking_reference,
      message: 'Booking submitted successfully.',
    });

  } catch (err) {
    // Do not expose stack traces
    console.error('[booking][error]', err);

    return res.status(500).json({
      success: false,
      message: 'Booking received but WhatsApp delivery failed.',
    });
  }
});

module.exports = router;

