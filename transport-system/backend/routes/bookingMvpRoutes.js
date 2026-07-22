const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const { query, run, get, transaction } = require('../config/database');
const { sendBookingNotification } = require('../services/emailService');

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

    // Lookup or create guest user
    let user;
    user = await get('SELECT user_id FROM users WHERE phone = ?', [mobile]);
    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(`guest_${mobile}`, salt);
      const result = await run(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['Guest', 'Customer', placeholderEmail, mobile, password_hash, 'customer']
      );
      user = { user_id: result.lastID };
    }

    // Booking reference will be generated after INSERT using the auto-generated booking_id.

    // Insert booking into SQLite
    const estimated_distance_km = Number(req.body.distance);
    const estimated_price = Number(req.body.price);

    const bookingSql = `INSERT INTO bookings (
        booking_reference,
        user_id,
        pickup_location,
        pickup_address,
        pickup_city,
        pickup_state,
        pickup_pincode,
        pickup_date,
        pickup_time,
        drop_location,
        drop_address,
        drop_city,
        drop_state,
        drop_pincode,
        goods_description,
        goods_type,
        goods_weight_kg,
        goods_volume,
        number_of_items,
        fragile,
        vehicle_type_required,
        estimated_distance_km,
        estimated_price,
        final_price,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `;

const bookingValues = [
      'TEMP', // placeholder — will be updated after INSERT with real booking_reference
      user.user_id,
      req.body.pickup,
      null,
      req.body.pickup,
      'Bihar',
      null,
      req.body.pickupDate || null,
      req.body.pickupTime || '00:00:00',
      req.body.drop,
      null,
      req.body.drop,
      'Bihar',
      null,
      req.body.goodsType,
      req.body.goodsType,
      null,
      null,
      1,
      0,
      req.body.vehicle,
      estimated_distance_km,
      estimated_price,
      estimated_price,
      'pending',
    ];

    if (process.env.NODE_ENV === 'development') {
      const columnsList = (bookingSql.match(/INSERT INTO bookings \([\s\S]*?\) VALUES/) || [''])[0];
      const columnsCount = (bookingSql.match(/\n\s*[A-Za-z_][A-Za-z0-9_]*\s*,?/g) || []).length;
      const placeholdersCount = (bookingSql.match(/\?/g) || []).length;
      console.log('[booking][debug]', { columnsCount, placeholdersCount, valuesCount: bookingValues.length });
    }

const { booking_id, booking_reference } = await transaction(async (tx) => {
      const bookingResult = await tx.run(bookingSql, bookingValues);
      const bid = bookingResult.lastID;
      const year = new Date().getFullYear();
      const ref = `BTB${year}${String(bid).padStart(5, '0')}`;
      await tx.run('UPDATE bookings SET booking_reference = ? WHERE booking_id = ?', [ref, bid]);
      await tx.run(
        'INSERT INTO deliveries (booking_id, current_status, status_description) VALUES (?, ?, ?)',
        [bid, 'booking_confirmed', 'Booking confirmed, waiting for driver assignment']
      );
      return { booking_id: bid, booking_reference: ref };
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

