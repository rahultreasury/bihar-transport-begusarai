/**
 * Driver Management Routes - Admin
 * Complete CRUD + Transactions + Vehicle Assignment + Timeline
 * Designed for market driver model (brokerage - no employee tracking)
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
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
// VEHICLE ASSIGNMENT
// Must be defined BEFORE `/:id` param routes to avoid Express
// matching `vehicles` as a driver ID.
// ============================

// Get available vehicles
router.get('/vehicles/available', protect, adminCheck, async (req, res) => {
  try {
    const vehicles = await driverService.getAvailableVehicles();
    res.json({ success: true, data: vehicles });
  } catch (error) {
    console.error('Get available vehicles error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// DRIVER CRUD
// ============================

// List all drivers
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const result = await driverService.listDrivers(req.query);
    res.json({ success: true, data: result.drivers, pagination: result.pagination });
  } catch (error) {
    console.error('List drivers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get driver profile
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const driver = await driverService.getDriverProfile(driverId);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    res.json({ success: true, data: driver });
  } catch (error) {
    console.error('Get driver error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Register new driver
router.post('/', protect, adminCheck, [
  body('driver_name').trim().notEmpty().withMessage('Driver name is required'),
  body('mobile').trim().notEmpty().withMessage('Mobile number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit mobile number'),
], handleValidation, async (req, res) => {
  try {
    const driver = await driverService.registerDriver(req.body);
    res.status(201).json({
      success: true,
      message: 'Driver registered successfully',
      data: { driver_id: driver.driver_id, driver_code: driver.driver_code, driver_name: driver.driver_name },
    });
  } catch (error) {
    console.error('Register driver error:', error);
    if (error.code === 'DRIVER_ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        message: 'Driver already exists',
        data: error.data,
      });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'A driver with this mobile number already exists' });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// Update driver
router.put('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const driver = await driverService.updateDriver(driverId, req.body);
    res.json({ success: true, message: 'Driver updated successfully', data: driver });
  } catch (error) {
    console.error('Update driver error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// Soft delete driver
router.delete('/:id', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    await driverService.deleteDriver(driverId);
    res.json({ success: true, message: 'Driver marked as inactive' });
  } catch (error) {
    console.error('Delete driver error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Toggle driver status
router.patch('/:id/status', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const { status } = req.body;
    let driver;
    if (status && ['available', 'on_trip', 'inactive'].includes(status)) {
      driver = await driverService.updateDriver(driverId, { status });
    } else {
      driver = await driverService.toggleStatus(driverId);
    }

    res.json({ success: true, message: 'Driver status updated', data: { driver_id: driverId, status: driver.status } });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIPS
// ============================

router.get('/:id/trips', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const result = await driverService.getDriverTrips(driverId, req.query);
    res.json({ success: true, data: result.trips, revenue: result.revenue, totalDistance: result.totalDistance, pagination: result.pagination });
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// TRANSACTIONS / LEDGER
// ============================

// Record a transaction
router.post('/:id/transactions', protect, adminCheck, [
  body('transaction_type').isIn(['advance', 'trip_payment', 'fuel_expense', 'toll_expense', 'recovery', 'other_expense']).withMessage('Valid transaction type required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
], handleValidation, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const transaction = await driverService.recordTransaction(driverId, {
      ...req.body,
      amount: parseFloat(req.body.amount),
      recorded_by: req.user.user_id,
      description: req.body.description || `${req.body.transaction_type.replace(/_/g, ' ')}`,
    });

    res.status(201).json({ success: true, message: 'Transaction recorded successfully', data: transaction });
  } catch (error) {
    console.error('Record transaction error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// Get transaction history
router.get('/:id/transactions', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const result = await driverService.getDriverTransactions(driverId, req.query);
    res.json({ success: true, data: result.transactions, summary: result.summary, pagination: result.pagination });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// VEHICLE ASSIGNMENT
// ============================

// Assign vehicle to driver
router.post('/:id/assign-vehicle', protect, adminCheck, [
  body('vehicle_id').isInt({ min: 1 }).withMessage('Valid vehicle_id is required'),
], handleValidation, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const result = await driverService.assignVehicle(driverId, req.body.vehicle_id);
    res.json({ success: true, message: 'Vehicle assigned successfully', data: result });
  } catch (error) {
    console.error('Assign vehicle error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TIMELINE
// ============================

router.get('/:id/timeline', protect, adminCheck, async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ success: false, message: 'Invalid driver ID' });

    const timeline = await driverService.getDriverTimeline(driverId);
    res.json({ success: true, data: timeline });
  } catch (error) {
    console.error('Get timeline error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
