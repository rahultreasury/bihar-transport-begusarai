/**
 * Transport Resource Registration Routes
 * POST /api/admin/transport-resources — combined owner/driver/vehicle registration
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect, adminOnly } = require('../middleware/auth');
const TransportResourceService = require('../services/TransportResourceService');

const router = express.Router();
const transportResourceService = new TransportResourceService();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

const handleError = (res, error, defaultMsg = 'Server error') => {
  console.error('Transport resource registration error:', error);
  if (error.code === 'VEHICLE_OWNER_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'DRIVER_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'VEHICLE_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'OWNER_REQUIRED' ||
      error.code === 'OWNER_INVALID'  ||
      error.code === 'OWNER_NOT_FOUND' ||
      error.code === 'OWNER_INACTIVE') {
    return res.status(400).json({ success: false, message: error.message, errorCode: error.code });
  }
  if (error.code === 'NO_RESOURCES' || error.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
    if (target.includes('mobile')) {
      return res.status(409).json({ success: false, message: 'A record with this mobile number already exists' });
    }
    return res.status(500).json({ success: false, message: 'Could not complete registration due to a conflicting unique value. Please try again.' });
  }
  res.status(500).json({ success: false, message: error.message || defaultMsg });
};

/**
 * POST /api/admin/transport-resources
 * Combined registration of Transport Owner, Driver, and Vehicle in a single transaction.
 * Body:
 * {
 *   owner: { owner_name, mobile, city, owner_type?, ... } | null,
 *   driver: { driver_name, mobile, license_number, vehicle_type, vehicle_number, transport_owner_id?, is_self_owner?, ... } | null,
 *   vehicle: { vehicle_number, vehicle_type, vehicle_name, owner_id?, driver_id?, assign_owner_driver?, ... } | null,
 *   owner_context_id: number | null,
 *   driver_context_id: number | null
 * }
 */
router.post(
  '/',
  protect,
  adminOnly,
  [
    body('owner').optional({ nullable: true }).isObject().withMessage('owner must be an object'),
    body('owner.owner_name').optional().trim().notEmpty().withMessage('Owner name is required'),
    body('owner.mobile').optional().matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
    body('owner.city').optional().trim().notEmpty().withMessage('City is required'),
    body('owner.owner_type').optional().isIn(['TRANSPORT_COMPANY', 'INDIVIDUAL_OWNER', 'DRIVER_OWNER']).withMessage('Invalid owner type'),
    body('driver').optional({ nullable: true }).isObject().withMessage('driver must be an object'),
    body('driver.driver_name').optional().trim().notEmpty().withMessage('Driver name is required'),
    body('driver.mobile').optional().matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
    body('driver.license_number').optional().trim().notEmpty().withMessage('License number is required'),
    body('driver.vehicle_type').optional().trim().notEmpty().withMessage('Vehicle type is required'),
    body('driver.vehicle_number').optional().matches(/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/i).withMessage('Enter a valid vehicle number (e.g. BR09AB1234)'),
    body('driver.transport_owner_id').optional().isInt({ min: 1 }).withMessage('Transport Owner ID must be a positive integer'),
    body('driver.is_self_owner').optional().isBoolean().withMessage('is_self_owner must be a boolean'),
    body('vehicle').optional({ nullable: true }).isObject().withMessage('vehicle must be an object'),
    body('vehicle.vehicle_number').optional().matches(/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/i).withMessage('Enter a valid vehicle number (e.g. BR09AB1234)'),
    body('vehicle.vehicle_type').optional().trim().notEmpty().withMessage('Vehicle type is required'),
    body('vehicle.vehicle_name').optional().trim().notEmpty().withMessage('Vehicle name is required'),
    body('vehicle.owner_id').optional().isInt({ min: 1 }).withMessage('Owner ID must be a positive integer'),
    body('vehicle.driver_id').optional().isInt({ min: 1 }).withMessage('Driver ID must be a positive integer'),
    body('vehicle.assign_owner_driver').optional().isBoolean().withMessage('assign_owner_driver must be a boolean'),
    body('owner_context_id').optional().isInt({ min: 1 }).withMessage('Owner context ID must be a positive integer'),
    body('driver_context_id').optional().isInt({ min: 1 }).withMessage('Driver context ID must be a positive integer'),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const result = await transportResourceService.registerResources(req.body);
      res.status(201).json({
        success: true,
        message: 'Transport resources registered successfully',
        data: result,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

module.exports = router;
