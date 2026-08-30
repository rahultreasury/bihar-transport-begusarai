/**
 * Trip Routes
 * RESTful API endpoints for trip management.
 *
 * All routes are protected by authentication middleware.
 * Admin-only routes are protected by adminOnly middleware.
 */

const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const TripService = require('../services/TripService');
const TripTimelineService = require('../services/TripTimelineService');
const TripFinancialCalculationService = require('../services/TripFinancialCalculationService');
const { ValidationError, NotFoundError } = require('../utils/AppError');

const tripService = new TripService();
const timelineService = new TripTimelineService();
const financialService = new TripFinancialCalculationService();

// ============================
// TRIP CRUD
// ============================

/**
 * GET /api/trips
 * Get all trips with pagination, filters, and search.
 * Query params: page, limit, search, status, client_id, driver_id, vehicle_id, owner_id, date_from, date_to, sort_by, sort_order
 */
router.get('/', protect, async (req, res) => {
  try {
    const result = await tripService.getAllTrips(req.query, req.user);
    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/summary
 * Get trip summary statistics.
 */
router.get('/summary', protect, async (req, res) => {
  try {
    const summary = await tripService.getTripSummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get trip summary error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/top-clients
 * Get top clients by trip count and freight.
 */
router.get('/top-clients', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const topClients = await tripService.getTopClients(limit);
    res.json({
      success: true,
      data: topClients,
    });
  } catch (error) {
    console.error('Get top clients error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:id
 * Get trip by ID.
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const trip = await tripService.getTripById(tripId, req.user);
    res.json({
      success: true,
      data: trip,
    });
  } catch (error) {
    console.error('Get trip error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips
 * Create a new trip (Admin only).
 */
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const trip = await tripService.createTrip(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Trip created successfully',
      data: trip,
    });
  } catch (error) {
    console.error('Create trip error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * PUT /api/trips/:id
 * Update a trip (Admin only).
 */
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const trip = await tripService.updateTrip(tripId, req.body, req.user);
    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: trip,
    });
  } catch (error) {
    console.error('Update trip error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * DELETE /api/trips/:id
 * Delete a trip (Admin only).
 */
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const trip = await tripService.deleteTrip(tripId, req.user);
    res.json({
      success: true,
      message: 'Trip deleted successfully',
      data: trip,
    });
  } catch (error) {
    console.error('Delete trip error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * PATCH /api/trips/:id/status
 * Update trip status (Admin only).
 */
router.patch('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const trip = await tripService.updateTripStatus(tripId, status, req.user);
    res.json({
      success: true,
      message: 'Trip status updated successfully',
      data: trip,
    });
  } catch (error) {
    console.error('Update trip status error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIP EXPENSES
// ============================

/**
 * GET /api/trips/:id/expenses
 * Get all expenses for a trip.
 */
router.get('/:id/expenses', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const expenses = await tripService.getTripExpenses(tripId);
    res.json({
      success: true,
      data: expenses,
    });
  } catch (error) {
    console.error('Get trip expenses error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:id/expenses
 * Add expense to a trip (Admin only).
 */
router.post('/:id/expenses', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const expense = await tripService.addExpense(tripId, req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: expense,
    });
  } catch (error) {
    console.error('Add expense error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * PUT /api/trips/:id/expenses/:expenseId
 * Update trip expense (Admin only).
 */
router.put('/:id/expenses/:expenseId', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const expenseId = parseInt(req.params.expenseId);

    if (isNaN(tripId) || isNaN(expenseId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID or expense ID' });
    }

    const expense = await tripService.updateExpense(tripId, expenseId, req.body, req.user);
    res.json({
      success: true,
      message: 'Expense updated successfully',
      data: expense,
    });
  } catch (error) {
    console.error('Update expense error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * DELETE /api/trips/:id/expenses/:expenseId
 * Delete trip expense (Admin only).
 */
router.delete('/:id/expenses/:expenseId', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const expenseId = parseInt(req.params.expenseId);

    if (isNaN(tripId) || isNaN(expenseId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID or expense ID' });
    }

    const expense = await tripService.deleteExpense(tripId, expenseId, req.user);
    res.json({
      success: true,
      message: 'Expense deleted successfully',
      data: expense,
    });
  } catch (error) {
    console.error('Delete expense error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIP PAYMENTS
// ============================

/**
 * GET /api/trips/:id/payments
 * Get all payments for a trip.
 */
router.get('/:id/payments', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const payments = await tripService.getTripPayments(tripId);
    res.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error('Get trip payments error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:id/payments
 * Add payment to a trip (Admin only).
 */
router.post('/:id/payments', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const payment = await tripService.addPayment(tripId, req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Payment added successfully',
      data: payment,
    });
  } catch (error) {
    console.error('Add payment error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIPS BY ENTITY
// ============================

/**
 * GET /api/trips/client/:clientId
 * Get trips by client ID.
 */
router.get('/client/:clientId', protect, async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId);
    if (isNaN(clientId)) {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const result = await tripService.getTripsByClientId(clientId, req.query);
    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get client trips error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/driver/:driverId
 * Get trips by driver ID.
 */
router.get('/driver/:driverId', protect, async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver ID' });
    }

    const result = await tripService.getTripsByDriverId(driverId, req.query);
    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get driver trips error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/vehicle/:vehicleId
 * Get trips by vehicle ID.
 */
router.get('/vehicle/:vehicleId', protect, async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) {
      return res.status(400).json({ success: false, message: 'Invalid vehicle ID' });
    }

    const result = await tripService.getTripsByVehicleId(vehicleId, req.query);
    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get vehicle trips error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/owner/:ownerId
 * Get trips by transport owner ID.
 */
router.get('/owner/:ownerId', protect, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.ownerId);
    if (isNaN(ownerId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID' });
    }

    const result = await tripService.getTripsByOwnerId(ownerId, req.query);
    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get owner trips error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// LOOKUP DATA
// ============================

/**
 * GET /api/trips/lookup/clients
 * Get available clients for dropdown.
 */
router.get('/lookup/clients', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const clients = await tripService.getAvailableClients(search);
    res.json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/lookup/drivers
 * Get available drivers for dropdown.
 */
router.get('/lookup/drivers', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const drivers = await tripService.getAvailableDrivers(search);
    res.json({
      success: true,
      data: drivers,
    });
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/lookup/vehicles
 * Get available vehicles for dropdown.
 */
router.get('/lookup/vehicles', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const vehicles = await tripService.getAvailableVehicles(search);
    res.json({
      success: true,
      data: vehicles,
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/lookup/owners
 * Get available transport owners for dropdown.
 */
router.get('/lookup/owners', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const owners = await tripService.getAvailableOwners(search);
    res.json({
      success: true,
      data: owners,
    });
  } catch (error) {
    console.error('Get owners error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIP TIMELINE
// ============================

/**
 * GET /api/trips/:id/timeline
 * Get unified timeline for a trip.
 */
router.get('/:id/timeline', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const timeline = await timelineService.getTripTimeline(tripId);
    res.json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    console.error('Get trip timeline error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// TRIP FINANCIAL SUMMARY
// ============================

/**
 * GET /api/trips/:id/financial-summary
 * Get complete financial summary for a trip.
 */
router.get('/:id/financial-summary', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const financials = await financialService.calculateTripFinancials(tripId);
    res.json({
      success: true,
      data: financials,
    });
  } catch (error) {
    console.error('Get trip financials error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// LOOKUP - CLIENTS WITH STATS
// ============================

/**
 * GET /api/trips/lookup/clients-with-stats
 * Get clients with outstanding amounts and trip counts.
 */
router.get('/lookup/clients-with-stats', protect, async (req, res) => {
  try {
    const clients = await tripService.getClientsWithStats();
    res.json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error('Get clients with stats error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/lookup/vehicles-by-owner/:ownerId
 * Get vehicles belonging to a specific transport owner.
 */
router.get('/lookup/vehicles-by-owner/:ownerId', protect, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.ownerId);
    if (isNaN(ownerId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID' });
    }

    const vehicles = await tripService.getVehiclesByOwner(ownerId);
    res.json({
      success: true,
      data: vehicles,
    });
  } catch (error) {
    console.error('Get vehicles by owner error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/lookup/drivers-by-owner/:ownerId
 * Get drivers belonging to a specific transport owner.
 * Used for trip creation wizard to ensure owner-vehicle-driver consistency.
 */
router.get('/lookup/drivers-by-owner/:ownerId', protect, async (req, res) => {
  try {
    const ownerId = parseInt(req.params.ownerId);
    if (isNaN(ownerId)) {
      return res.status(400).json({ success: false, message: 'Invalid owner ID' });
    }

    const search = req.query.search || '';
    const drivers = await tripService.getDriversByOwner(ownerId, search);
    res.json({
      success: true,
      data: drivers,
    });
  } catch (error) {
    console.error('Get drivers by owner error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
