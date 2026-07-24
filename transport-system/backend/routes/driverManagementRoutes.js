/**
 * Driver Management Routes - Admin
 * Complete CRUD + Finance + Timeline for driver management module.
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const DriverManagementService = require('../services/DriverManagementService');

const driverService = new DriverManagementService();

// Middleware: Check admin access
const adminCheck = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
  }
  next();
};

// Validation error handler
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================
// DASHBOARD STATS
// ============================

// @route   GET /api/admin/drivers/stats
// @desc    Get driver dashboard KPIs
router.get('/stats', protect, adminCheck, async (req, res) => {
  try {
    const stats = await driverService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// DRIVER CRUD
// ============================

// @route   GET /api/admin/drivers
// @desc    List all drivers with search, filter, sort, pagination
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const result = await driverService.listDrivers(req.query);
    res.json({
      success: true,
      data: result.drivers,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('List drivers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/drivers/:id
// @desc    Get driver full profile
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const driver = await driverService.getDriverProfile(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    res.json({ success: true, data: driver });
  } catch (error) {
    console.error('Get driver error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/drivers
// @desc    Register a new driver
router.post('/', protect, adminCheck, [
  body('driver_name').trim().notEmpty().withMessage('Driver name is required'),
  body('mobile').trim().notEmpty().withMessage('Mobile number is required'),
  body('license_number').trim().notEmpty().withMessage('License number is required'),
  body('license_expiry').trim().notEmpty().withMessage('License expiry date is required'),
], handleValidation, async (req, res) => {
  try {
    const driver = await driverService.registerDriver(req.body);
    res.status(201).json({
      success: true,
      message: 'Driver registered successfully',
      data: {
        driver_id: driver.driver_id,
        driver_code: driver.driver_code,
        driver_name: driver.driver_name,
      },
    });
  } catch (error) {
    console.error('Register driver error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'A driver with this license number or mobile already exists',
      });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   PUT /api/admin/drivers/:id
// @desc    Update driver information
router.put('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const driver = await driverService.updateDriver(driverId, req.body);
    res.json({
      success: true,
      message: 'Driver updated successfully',
      data: driver,
    });
  } catch (error) {
    console.error('Update driver error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   DELETE /api/admin/drivers/:id
// @desc    Delete a driver
router.delete('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    await driverService.deleteDriver(driverId);
    res.json({ success: true, message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('Delete driver error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PATCH /api/admin/drivers/:id/status
// @desc    Toggle driver availability status
router.patch('/:id/status', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const { status } = req.body;
    let driver;

    if (status && ['available', 'on_trip', 'inactive'].includes(status)) {
      driver = await driverService.updateDriver(driverId, { status });
    } else {
      driver = await driverService.toggleStatus(driverId);
    }

    res.json({
      success: true,
      message: 'Driver status updated',
      data: { driver_id: driverId, status: driver.status },
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIPS
// ============================

// @route   GET /api/admin/drivers/:id/trips
// @desc    Get driver trip history
router.get('/:id/trips', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const result = await driverService.getDriverTrips(driverId, req.query);
    res.json({
      success: true,
      data: result.trips,
      revenue: result.revenue,
      totalDistance: result.totalDistance,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// FINANCE / LEDGER
// ============================

// @route   GET /api/admin/drivers/:id/finance
// @desc    Get driver financial ledger
router.get('/:id/finance', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const result = await driverService.getDriverFinance(driverId, req.query);
    res.json({
      success: true,
      data: result.transactions,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get finance error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/drivers/:id/advance
// @desc    Record advance payment
router.post('/:id/advance', protect, adminCheck, [
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
], handleValidation, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const transaction = await driverService.recordAdvance(driverId, {
      ...req.body,
      recorded_by: req.user.user_id,
    });

    res.status(201).json({
      success: true,
      message: 'Advance recorded successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Record advance error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   POST /api/admin/drivers/:id/payment
// @desc    Record trip payment
router.post('/:id/payment', protect, adminCheck, [
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
], handleValidation, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const transaction = await driverService.recordPayment(driverId, {
      ...req.body,
      recorded_by: req.user.user_id,
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   POST /api/admin/drivers/:id/expense
// @desc    Record fuel/toll/other expense
router.post('/:id/expense', protect, adminCheck, [
  body('expense_type').isIn(['fuel', 'toll', 'other']).withMessage('Expense type must be fuel, toll, or other'),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
], handleValidation, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const transaction = await driverService.recordExpense(driverId, {
      ...req.body,
      recorded_by: req.user.user_id,
    });

    res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Record expense error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// VEHICLES
// ============================

// @route   GET /api/admin/drivers/:id/vehicles
// @desc    Get driver vehicle assignment history
router.get('/:id/vehicles', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const result = await driverService.getDriverVehicles(driverId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// TIMELINE
// ============================

// @route   GET /api/admin/drivers/:id/timeline
// @desc    Get driver activity timeline
router.get('/:id/timeline', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const timeline = await driverService.getDriverTimeline(driverId);
    res.json({ success: true, data: timeline });
  } catch (error) {
    console.error('Get timeline error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

