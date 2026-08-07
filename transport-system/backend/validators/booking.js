/**
 * Express validator chains for booking endpoints.
 *
 * All validation rules are defined here — the single source of truth
 * for input validation. Routes should only reference these validators.
 */

const { body, param, query } = require('express-validator');

const requiredString = (field, label) =>
  body(field)
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage(`${label || field} is required`)
    .isString()
    .withMessage(`${label || field} must be a string`);

const optionalString = (field, label) =>
  body(field)
    .optional()
    .isString()
    .withMessage(`${label || field} must be a string`);

const requiredNumber = (field, label) =>
  body(field)
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage(`${label || field} is required`)
    .isFloat({ min: 0 })
    .withMessage(`${label || field} must be a positive number`);

const optionalNumber = (field, label) =>
  body(field)
    .optional()
    .isFloat()
    .withMessage(`${label || field} must be a number`);

const validateCreateBooking = [
  requiredString('pickup_location', 'Pickup location'),
  requiredString('pickup_city', 'Pickup city'),
  requiredString('drop_location', 'Drop location'),
  requiredString('drop_city', 'Drop city'),
  requiredString('pickup_date', 'Pickup date'),
  requiredString('pickup_time', 'Pickup time'),
  requiredString('goods_description', 'Goods description'),
  requiredString('vehicle_type_required', 'Vehicle type'),
  optionalString('pickup_address', 'Pickup address'),
  optionalString('pickup_state', 'Pickup state'),
  optionalString('pickup_pincode', 'Pickup pincode'),
  optionalString('drop_address', 'Drop address'),
  optionalString('drop_state', 'Drop state'),
  optionalString('drop_pincode', 'Drop pincode'),
  optionalString('goods_type', 'Goods type'),
  optionalNumber('goods_weight_kg', 'Goods weight'),
  optionalNumber('goods_volume', 'Goods volume'),
  optionalNumber('number_of_items', 'Number of items'),
  body('fragile').optional().isBoolean().withMessage('fragile must be a boolean'),
  optionalNumber('estimated_distance_km', 'Estimated distance'),
  optionalNumber('estimated_price', 'Estimated price'),
];

const validateBookingId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid booking id'),
];

const validateSendQuote = [
  ...validateBookingId,
  body('final_price')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('final_price is required')
    .isFloat({ min: 0.01 })
    .withMessage('final_price must be a positive number'),
  body('remarks').optional().isString().withMessage('remarks must be a string'),
  body('driver_id').optional().isInt({ min: 1 }).withMessage('driver_id must be a positive integer'),
  body('vehicle_id').optional().isInt({ min: 1 }).withMessage('vehicle_id must be a positive integer'),
  body('quote_validity_hours').optional().isInt({ min: 1 }).withMessage('quote_validity_hours must be a positive integer'),
];

const validateBulkStatus = [
  body('bookingIds')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('bookingIds is required')
    .isArray({ min: 1 })
    .withMessage('bookingIds must be a non-empty array'),
  body('bookingIds.*').isInt({ min: 1 }).withMessage('Each bookingId must be a positive integer'),
  body('status')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('status is required')
    .isIn(['pending', 'confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'cancelled', 'completed'])
    .withMessage('Invalid status'),
];

const validateAssignDriver = [
  ...validateBookingId,
  body('driver_id')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('driver_id is required')
    .isInt({ min: 1 })
    .withMessage('driver_id must be a positive integer'),
];

const validateAssignVehicle = [
  ...validateBookingId,
  body('vehicle_id')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('vehicle_id is required')
    .isInt({ min: 1 })
    .withMessage('vehicle_id must be a positive integer'),
];

const validateUpdateBooking = [
  ...validateBookingId,
  body('pickup_address').optional().isString(),
  body('drop_address').optional().isString(),
  body('pickup_city').optional().isString(),
  body('drop_city').optional().isString(),
  body('goods_description').optional().isString(),
  body('goods_type').optional().isString(),
  body('goods_weight_kg').optional().isFloat(),
  body('number_of_items').optional().isInt(),
  body('fragile').optional().isBoolean(),
  body('vehicle_type_required').optional().isString(),
  body('estimated_distance_km').optional().isFloat(),
  body('estimated_price').optional().isFloat(),
  body('final_price').optional().isFloat(),
];

const validateStatusUpdate = [
  ...validateBookingId,
  body('status')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('status is required')
    .isIn(['pending', 'confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'cancelled', 'completed'])
    .withMessage('Invalid status'),
];

const validateMvpBooking = [
  requiredString('pickup', 'Pickup location'),
  requiredString('drop', 'Drop location'),
  requiredString('vehicle', 'Vehicle type'),
  body('distance')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('distance is required')
    .matches(/^\d+(\.\d+)?$/)
    .withMessage('distance must be a number'),
  body('price')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('price is required')
    .matches(/^\d+(\.\d+)?$/)
    .withMessage('price must be a number'),
  requiredString('customerName', 'Customer name'),
  body('mobile')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('mobile must be a valid 10-digit Indian number starting with 6, 7, 8, or 9'),
  body('pickupDate').optional().isString(),
  body('pickupTime').optional().isString(),
];

module.exports = {
  validateCreateBooking,
  validateBookingId,
  validateSendQuote,
  validateBulkStatus,
  validateAssignDriver,
  validateAssignVehicle,
  validateUpdateBooking,
  validateStatusUpdate,
  validateMvpBooking,
};
