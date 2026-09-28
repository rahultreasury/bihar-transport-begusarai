/**
 * Vehicle Owner Routes - Admin
 * Complete CRUD for vehicle owners
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const VehicleOwnerService = require('../services/VehicleOwnerService');
const PartnerService = require('../services/PartnerService');
const ConnectionService = require('../services/ConnectionService');

const vehicleOwnerService = new VehicleOwnerService();
const partnerService = new PartnerService();
const connectionService = new ConnectionService();

// Admin access middleware
const adminCheck = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
  }
  next();
};

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

const handleError = (res, error, defaultMsg = 'Server error') => {
  console.error('Vehicle owner route error:', error);
  if (error.code === 'VEHICLE_OWNER_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'P2002') {
    return res.status(400).json({ success: false, message: 'A vehicle owner with this mobile already exists' });
  }
  res.status(500).json({ success: false, message: error.message || defaultMsg });
};

// ============================
// STATS (Dashboard)
// ============================

router.get('/stats', protect, adminCheck, async (req, res) => {
  try {
    const stats = await vehicleOwnerService.getOwnerStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// VEHICLE OWNER CRUD
// ============================

// List vehicle owners
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const result = await vehicleOwnerService.listOwners(req.query);
    res.json({ success: true, data: result.owners, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

// Get vehicle owner profile
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const owner = await vehicleOwnerService.getOwnerProfile(ownerId);
    if (!owner) return res.status(404).json({ success: false, message: 'Vehicle owner not found' });

    res.json({ success: true, data: owner });
  } catch (error) {
    handleError(res, error);
  }
});

// Create vehicle owner
router.post('/', protect, adminCheck, [
  body('owner_name').trim().notEmpty().withMessage('Please enter the owner\'s name.'),
  body('mobile').trim().notEmpty().withMessage('Phone number is required.')
    .matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number.'),
  body('city').trim().notEmpty().withMessage('City is required.'),
  body('owner_type').optional().isIn(['TRANSPORT_COMPANY', 'INDIVIDUAL_OWNER', 'DRIVER_OWNER']).withMessage('Valid owner type is required'),
  body('driver_id').optional().isInt({ min: 1 }).withMessage('Valid driver ID is required'),
  body('driver_name').optional().trim().notEmpty().withMessage('Driver name is required'),
  body('license_number').optional().trim().notEmpty().withMessage('Driving licence number is required'),
], handleValidation, async (req, res) => {
  try {
    const owner = await vehicleOwnerService.registerOwner(req.body);
    res.status(201).json({
      success: true,
      message: 'Vehicle owner registered successfully',
      data: owner,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Update vehicle owner
router.put('/:id', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const owner = await vehicleOwnerService.updateOwner(ownerId, req.body);
    res.json({
      success: true,
      message: 'Vehicle owner updated successfully',
      data: owner,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Delete vehicle owner
router.delete('/:id', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    await vehicleOwnerService.deleteOwner(ownerId);
    res.json({
      success: true,
      message: 'Vehicle owner deleted successfully',
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Toggle vehicle owner status
router.patch('/:id/status', protect, adminCheck, [
  body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Valid status required'),
], handleValidation, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const owner = await vehicleOwnerService.toggleStatus(ownerId, req.body.status);
    res.json({
      success: true,
      message: 'Vehicle owner status updated',
      data: owner,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Get vehicle owner bookings
router.get('/:id/bookings', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const result = await vehicleOwnerService.getOwnerBookings(ownerId, req.query);
    res.json({
      success: true,
      data: result.bookings,
      pagination: result.pagination,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Get drivers belonging to a vehicle owner (transport owner)
router.get('/:id/drivers', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const result = await vehicleOwnerService.getOwnerDrivers(ownerId, req.query);
    res.json({
      success: true,
      data: result.drivers,
      pagination: result.pagination,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Get vehicles belonging to a vehicle owner (transport owner)
router.get('/:id/vehicles', protect, adminCheck, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const result = await vehicleOwnerService.getOwnerVehicles(ownerId, req.query);
    res.json({
      success: true,
      data: result.vehicles,
      pagination: result.pagination,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Create a new vehicle for a vehicle owner (transport owner)
router.post('/:id/vehicles', protect, adminCheck, [
  body('vehicle_number').trim().notEmpty().withMessage('Vehicle number is required'),
  body('vehicle_type').trim().notEmpty().withMessage('Vehicle type is required'),
  body('vehicle_name').trim().notEmpty().withMessage('Vehicle name is required'),
  body('partner_id').optional().isInt({ min: 1 }).withMessage('Valid partner_id is required when provided'),
  body('owner_id').optional().isInt({ min: 1 }).withMessage('Valid owner_id is required when provided'),
  body('driver_id').optional().isInt({ min: 1 }).withMessage('Valid driver_id is required when provided'),
  body('assign_owner_driver').optional().isBoolean().withMessage('assign_owner_driver must be a boolean'),
], handleValidation, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.id);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const vehicle = await vehicleOwnerService.createOwnerVehicle(ownerId, req.body);
    res.status(201).json({
      success: true,
      message: 'Vehicle added successfully',
      data: vehicle,
    });
  } catch (error) {
    if (error.code === 'VEHICLE_ALREADY_EXISTS') {
      return res.status(409).json({ success: false, message: error.message, data: error.data });
    }
    handleError(res, error);
  }
});

// ============================
// PARTNER LINKING
// ============================

// Link an existing VehicleOwner to an existing Partner.
// Lets an admin-created Transport Owner (VehicleOwner) be connected to a
// Partner so the two systems share the same identity.
router.post('/:ownerId/link-partner', protect, adminCheck, [
  body('partner_id').isInt({ min: 1 }).withMessage('Valid partner_id is required'),
], handleValidation, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.ownerId, 10);
    if (isNaN(ownerId)) return res.status(400).json({ success: false, message: 'Invalid vehicle owner ID' });

    const partnerId = parseInt(req.body.partner_id, 10);
    const result = await partnerService.linkAdminVehicleOwnerToPartner(partnerId, ownerId);

    // Return the updated VehicleOwner including the linked Partner.
    const owner = await vehicleOwnerService.getOwnerProfile(ownerId);
    res.json({
      success: true,
      message: result.already_linked
        ? 'VehicleOwner was already linked to this Partner'
        : 'VehicleOwner linked to Partner successfully',
      data: {
        link: result,
        vehicleOwner: owner,
      },
    });
  } catch (error) {
    if (error.code === 'VEHICLE_OWNER_ALREADY_LINKED') {
      return res.status(409).json({ success: false, message: error.message, data: error.data });
    }
    if (error.code === 'PARTNER_NOT_FOUND' || error.code === 'VEHICLE_OWNER_NOT_FOUND' || error.code === 'PARTNER_INACTIVE') {
      return res.status(404).json({ success: false, message: error.message });
    }
    handleError(res, error);
  }
});

// ============================
// CONNECTION WORKFLOW (Orphan Records)
// ============================

// Get connection statistics
router.get('/connections/stats', protect, adminCheck, async (req, res) => {
  try {
    const stats = await connectionService.getConnectionStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    handleError(res, error);
  }
});

// Get orphan vehicles (without owner or driver)
router.get('/connections/orphan-vehicles', protect, adminCheck, async (req, res) => {
  try {
    const vehicles = await connectionService.getOrphanVehicles();
    res.json({ success: true, data: vehicles });
  } catch (error) {
    handleError(res, error);
  }
});

// Get orphan drivers (without owner)
router.get('/connections/orphan-drivers', protect, adminCheck, async (req, res) => {
  try {
    const drivers = await connectionService.getOrphanDrivers();
    res.json({ success: true, data: drivers });
  } catch (error) {
    handleError(res, error);
  }
});

// Get orphan owners (without vehicles or drivers)
router.get('/connections/orphan-owners', protect, adminCheck, async (req, res) => {
  try {
    const owners = await connectionService.getOrphanOwners();
    res.json({ success: true, data: owners });
  } catch (error) {
    handleError(res, error);
  }
});

// Connect a vehicle to owner and driver
router.post('/connections/connect-vehicle', protect, adminCheck, [
  body('vehicle_id').isInt({ min: 1 }).withMessage('Valid vehicle ID is required'),
  body('owner_id').isInt({ min: 1 }).withMessage('Valid owner ID is required'),
  body('driver_id').isInt({ min: 1 }).withMessage('Valid driver ID is required'),
], handleValidation, async (req, res) => {
  try {
    const { vehicle_id, owner_id, driver_id } = req.body;
    const vehicle = await connectionService.connectVehicle(vehicle_id, owner_id, driver_id);
    res.json({
      success: true,
      message: 'Vehicle connected successfully',
      data: vehicle,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Connect a driver to an owner
router.post('/connections/connect-driver', protect, adminCheck, [
  body('driver_id').isInt({ min: 1 }).withMessage('Valid driver ID is required'),
  body('owner_id').isInt({ min: 1 }).withMessage('Valid owner ID is required'),
  body('is_driver_owner').optional().isBoolean().withMessage('is_driver_owner must be a boolean'),
], handleValidation, async (req, res) => {
  try {
    const { driver_id, owner_id, is_driver_owner } = req.body;
    const driver = await connectionService.connectDriver(driver_id, owner_id, is_driver_owner);
    res.json({
      success: true,
      message: 'Driver connected successfully',
      data: driver,
    });
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
