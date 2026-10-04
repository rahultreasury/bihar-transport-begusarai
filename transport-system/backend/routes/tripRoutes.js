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
const { prisma } = require('../config/prisma');
const TripService = require('../services/TripService');
const TripTimelineService = require('../services/TripTimelineService');
const TripFinancialCalculationService = require('../services/TripFinancialCalculationService');
const TripOperationalService = require('../services/TripOperationalService');
const TripDocumentService = require('../services/TripDocumentService');
// Phase 9 — the Dispatch Workspace. `operationalService` is kept for the
// LOADING step (and for Phase 4's direct-service tests, which still call it).
// The dispatch READINESS and the dispatch ACT come from TripDispatchService,
// because the operator's question — "is this vehicle ready to leave, and if
// not exactly what is missing?" — needs checks the operational service has no
// vocabulary for.
const TripDispatchService = require('../services/TripDispatchService');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/AppError');

const tripService = new TripService();
const timelineService = new TripTimelineService();
const financialService = new TripFinancialCalculationService();
const operationalService = new TripOperationalService();
const documentService = new TripDocumentService();
// Phase 9 — dispatch readiness, the dispatch act, and the paperwork around it.
const dispatchWorkspaceService = new TripDispatchService();

/**
 * Shared error shape for the Phase 4 operational + document endpoints, so a
 * blocked transition comes back as a 400/404 with the service's own message
 * instead of a blanket 500.
 *
 * PHASE 6 FIX — `ForbiddenError` is now mapped to 403. It was missing, so every
 * authorisation refusal from a service (a customer reading another customer's
 * trip, a driver reading somebody else's, a partner reading outside their
 * network) fell through to the 500 branch and was reported to the client as a
 * SERVER error. That is wrong twice over: it is a client-visible status bug,
 * and it makes a deliberate access denial look like an outage in the logs.
 */
function sendOperationalError(res, error, logLabel) {
  console.error(logLabel, error);
  if (error instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      message: error.message,
      ...(error.details?.length ? { blockers: error.details } : {}),
    });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || 'Server error' });
}

function readTripId(req, res) {
  const tripId = parseInt(req.params.id);
  if (isNaN(tripId)) {
    res.status(400).json({ success: false, message: 'Invalid trip ID' });
    return null;
  }
  return tripId;
}

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
    if (error instanceof ConflictError) {
      return res.status(409).json({ success: false, message: error.message });
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
 * GET /api/trips/lookup/offline-clients
 * Get offline clients (business accounts) for trip creation.
 * Searchable lookup with trip count and outstanding stats.
 */
router.get('/lookup/offline-clients', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const clients = await tripService.getOfflineClients(search);
    res.json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error('Get offline clients error:', error);
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

/**
 * GET /api/trips/lookup/owner-by-partner/:partnerId
 * Resolve the VehicleOwner linked to a Partner (via VehicleOwner.partner_link).
 * Used by the Admin trip-creation wizard to select a Partner and then load
 * that Partner's linked transport owner, vehicles, and drivers.
 */
router.get('/lookup/owner-by-partner/:partnerId', protect, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.partnerId);
    if (isNaN(partnerId)) {
      return res.status(400).json({ success: false, message: 'Invalid partner ID' });
    }

    const owner = await tripService.getOwnerByPartnerId(partnerId);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'No transport owner is linked to this partner',
      });
    }

    res.json({
      success: true,
      data: owner,
    });
  } catch (error) {
    console.error('Get owner by partner error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ===========================================================================
// PHASE 4 — LOADING → DOCUMENTS → DISPATCH
// ===========================================================================
//
// The operational path between "vehicle hired" and "in transit":
//
//     ASSIGNED ─► TO_LOADING_POINT ─► AT_LOADING_POINT ─► LOADED
//                     ─► DISPATCHED ─► IN TRANSIT
//
// SERVER-AUTHORITATIVE BY DESIGN: none of these endpoints accepts a `status`
// in the body. The caller asks for a NAMED OPERATION and the server decides
// what that means and whether it is currently legal. Sending `{"status":
// "DISPATCHED"}` to any of them is ignored.
//
// Every route is behind the SAME `protect` + `adminOnly` middleware the rest
// of this router already uses — no new permission system, and a customer,
// driver or partner token is refused with 403 exactly as it is everywhere
// else in the trip module.
//
// Writes are idempotent: repeating an operation that has already happened
// returns the current state with `idempotent: true` and writes no second
// timeline event, so a double click, a browser retry or an API retry is safe.

// --- Reading the operational state ---------------------------------------

/**
 * GET /api/trips/:id/workflow
 * Where the trip is, where it may go next, its loading facts, its planned vs
 * actual figures, and its document checklist.
 *
 * `status` and `documents` are returned as SEPARATE things, never merged.
 */
router.get('/:id/workflow', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const state = await operationalService.getOperationalState(tripId);
    res.json({ success: true, data: state });
  } catch (error) {
    sendOperationalError(res, error, 'Get trip workflow error:');
  }
});

// --- Loading ---------------------------------------------------------------

/**
 * POST /api/trips/:id/loading/send
 * VEHICLE HIRED → TO LOADING POINT
 */
router.post('/:id/loading/send', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await operationalService.sendToLoadingPoint(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip is already at or past the loading point' : 'Trip sent to loading point',
      idempotent: result.idempotent,
      data: result.trip,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Send to loading point error:');
  }
});

/**
 * POST /api/trips/:id/loading/arrive
 * TO LOADING POINT → AT LOADING POINT
 */
router.post('/:id/loading/arrive', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await operationalService.arriveAtLoadingPoint(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip has already arrived at the loading point' : 'Trip arrived at loading point',
      idempotent: result.idempotent,
      data: result.trip,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Arrive at loading point error:');
  }
});

/**
 * POST /api/trips/:id/loading/facts
 * Record the ACTUAL loading figures without changing the status, so they can
 * be captured while the vehicle is still being loaded.
 */
router.post('/:id/loading/facts', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const trip = await operationalService.recordLoadingFacts(tripId, req.body, req.user);
    res.json({ success: true, message: 'Loading information recorded', data: trip });
  } catch (error) {
    sendOperationalError(res, error, 'Record loading facts error:');
  }
});

/**
 * POST /api/trips/:id/loading/complete
 * AT LOADING POINT → LOADED. Accepts the actual quantity / weight; the
 * PLANNED figures on the booking are never touched.
 */
router.post('/:id/loading/complete', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await operationalService.completeLoading(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip is already loaded' : 'Trip loaded',
      idempotent: result.idempotent,
      data: result.trip,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Complete loading error:');
  }
});

// --- Dispatch ---------------------------------------------------------------

/**
 * GET /api/trips/:id/dispatch/readiness
 *
 * PHASE 9 UPGRADE. Still answers `{ ready, blockers, checks }` — the shape this
 * endpoint has always had, so nothing that consumes it breaks — but the report
 * is now produced by `TripDispatchService` and is per-check rather than a flat
 * list:
 *
 *   {
 *     "ready": false,
 *     "blocker_codes": ["LOADING_NOT_COMPLETED", "LR_GR_REQUIRED"],
 *     "blockers": [ { "code", "label", "message" }, ... ],
 *     "checks":   [ { "key", "label", "state", "blocking", "message" }, ... ],
 *     "summary":  { "total", "passed", "failed", "warning" }
 *   }
 *
 * `checklist` is still returned so the older client keeps working.
 *
 * THE MESSAGE MATTERS MORE THAN THE BOOLEAN
 *   Every entry carries what is missing AND what to do about it. The old
 *   generic "Required document E_WAY_BILL is not present" and the placeholder
 *   "The server has not cleared this step yet" are both gone: an operator can
 *   now read the reason off the screen and act on it.
 */
router.get('/:id/dispatch/readiness', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const readiness = await dispatchWorkspaceService.getReadiness(tripId);
    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    const checklist = trip ? await documentService.getChecklist(trip) : null;

    res.json({
      success: true,
      data: {
        trip_id: readiness.trip_id,
        trip_number: readiness.trip_number,
        status: readiness.status,
        ready: readiness.ready,
        already_dispatched: readiness.already_dispatched,
        blockers: readiness.blockers,
        blocker_codes: readiness.blocker_codes,
        checks: readiness.checks,
        summary: readiness.summary,
        dispatch: readiness.dispatch,
        eway_bill_integration: readiness.eway_bill_integration,
        // Backwards compatibility with the Phase 4 response shape.
        checklist,
      },
    });
  } catch (error) {
    sendOperationalError(res, error, 'Get dispatch readiness error:');
  }
});

/**
 * POST /api/trips/:id/dispatch
 * LOADED → DISPATCHED.
 *
 * PHASE 9. The server:
 *   1. loads the trip
 *   2. refuses a repeat (idempotent — no second dispatch record)
 *   3. computes readiness and refuses, with the FULL blocker list, if blocked
 *   4. validates every supplied field
 *   5. ONLY THEN opens one transaction that writes the dispatch record, the
 *      status change, `dispatched_at`, the POD decision, the movement-history
 *      event and the audit entry together
 *
 * Steps 1–4 write nothing, so a refused dispatch leaves the database exactly as
 * it was. The body cannot carry a `status`: the browser asks to dispatch, the
 * server decides what that means and whether it is legal now.
 *
 * The body MAY carry the paperwork the operator filled in — `lr_gr_number`,
 * `eway_bill_number`, `pod_required`, `consignee_name`, `consignee_contact`,
 * `delivery_number`, `value_of_goods`, `invoice_id` — so a single Confirm click
 * can both record and dispatch, which is what the confirmation modal promises.
 */
router.post('/:id/dispatch', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await dispatchWorkspaceService.dispatch(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent
        ? result.message || 'Trip is already dispatched'
        : 'Vehicle dispatched',
      idempotent: result.idempotent,
      status: result.status,
      data: result.trip,
      dispatch: result.dispatch,
      movement_history_recorded: result.movement_history_recorded ?? false,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Dispatch trip error:');
  }
});

// --- Documents ---------------------------------------------------------------

/**
 * GET /api/trips/:id/documents
 * Every recorded document plus the full checklist.
 */
router.get('/:id/documents', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const checklist = await documentService.getChecklist(trip);
    res.json({ success: true, data: checklist.items, checklist });
  } catch (error) {
    sendOperationalError(res, error, 'Get trip documents error:');
  }
});

/**
 * POST /api/trips/:id/documents
 * Record one document against this trip. The trip comes from the URL, never
 * from the body, so a document cannot be filed against another trip.
 * Re-posting the same facts is a safe no-op.
 */
router.post('/:id/documents', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const doc = await documentService.recordDocument(tripId, req.body, req.user);
    res.status(doc.already_recorded ? 200 : 201).json({
      success: true,
      message: doc.already_recorded ? 'Document already recorded with these details' : 'Document recorded',
      data: doc,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Record trip document error:');
  }
});

/**
 * POST /api/trips/:id/documents/:documentId/verify
 * Mark a recorded document as verified.
 */
router.post('/:id/documents/:documentId/verify', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const doc = await documentService.verifyDocument(tripId, req.params.documentId, req.user);
    res.json({ success: true, message: 'Document verified', data: doc });
  } catch (error) {
    sendOperationalError(res, error, 'Verify trip document error:');
  }
});

/**
 * DELETE /api/trips/:id/documents/:documentId
 * Remove a document. The append-only timeline entry recording that it existed
 * is deliberately kept.
 */
router.delete('/:id/documents/:documentId', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await documentService.deleteDocument(tripId, req.params.documentId, req.user);
    res.json({ success: true, message: 'Document removed', data: result });
  } catch (error) {
    sendOperationalError(res, error, 'Delete trip document error:');
  }
});

module.exports = router;

