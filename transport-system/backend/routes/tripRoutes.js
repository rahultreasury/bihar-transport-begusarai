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
const TripDeliveryService = require('../services/TripDeliveryService');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/AppError');

const tripService = new TripService();
const timelineService = new TripTimelineService();
const financialService = new TripFinancialCalculationService();
const operationalService = new TripOperationalService();
const documentService = new TripDocumentService();
// Phase 9 — dispatch readiness, the dispatch act, and the paperwork around it.
const dispatchWorkspaceService = new TripDispatchService();
// Phase 6 — delivery, POD, and completion.
const deliveryService = new TripDeliveryService();

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
 * POST /api/trips/:id/cancel
 * Cancel a trip. Terminal. The reason is preserved in the
 * append-only timeline event metadata — the audit trail for WHY.
 */
router.post('/:id/cancel', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await operationalService.cancelTrip(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip is already cancelled' : 'Trip cancelled',
      idempotent: result.idempotent,
      data: result.trip,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Cancel trip error:');
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

/**
 * POST /api/trips/:id/arrival
 * Record arrival at the destination (IN_TRANSIT → AT_DELIVERY_POINT).
 * Records the arrival timestamp and optional remarks.
 * Idempotent for identical arrival time + remarks.
 */
router.post('/:id/arrival', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await deliveryService.arriveAtDestination(tripId, req.body || {}, req.user);
    res.json({
      success: true,
      message: result.idempotent
        ? result.message || 'Arrival at destination already recorded'
        : 'Arrival at destination recorded',
      idempotent: result.idempotent,
      data: result.trip,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Record arrival at destination error:');
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

// ===========================================================================
// POD (Proof of Delivery)
// ===========================================================================

/**
 * POST /api/trips/:id/pod
 * Supply the proof of delivery document.
 */
router.post('/:id/pod', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await deliveryService.submitPod(tripId, req.body, req.user);
    res.status(result.already_recorded ? 200 : 201).json({
      success: true,
      message: result.already_recorded ? 'POD already recorded with these details' : 'Proof of delivery supplied',
      data: result,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Submit POD error:');
  }
});

/**
 * POST /api/trips/:id/pod/:documentId/verify
 * Verify the supplied POD document.
 */
router.post('/:id/pod/:documentId/verify', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const documentId = parseInt(req.params.documentId, 10);
    if (Number.isNaN(documentId) || documentId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }
    const result = await deliveryService.verifyPod(tripId, documentId, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'POD already verified' : 'Proof of delivery verified',
      data: result,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Verify POD error:');
  }
});

/**
 * POST /api/trips/:id/delivered
 * Mark the trip as delivered.
 */
router.post('/:id/delivered', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await deliveryService.markDelivered(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip already delivered' : 'Trip marked as delivered',
      data: result,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Mark delivered error:');
  }
});

/**
 * POST /api/trips/:id/complete
 * Complete the trip (operational closure).
 */
router.post('/:id/complete', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const result = await deliveryService.completeTrip(tripId, req.body, req.user);
    res.json({
      success: true,
      message: result.idempotent ? 'Trip already completed' : 'Trip completed',
      data: result,
    });
  } catch (error) {
    sendOperationalError(res, error, 'Complete trip error:');
  }
});

/**
 * GET /api/trips/:id/delivery/readiness
 * Check if the trip is ready for delivery.
 */
router.get('/:id/delivery/readiness', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const readiness = await deliveryService.getDeliveryReadiness(tripId);
    res.json({ success: true, data: readiness });
  } catch (error) {
    sendOperationalError(res, error, 'Get delivery readiness error:');
  }
});

/**
 * GET /api/trips/:id/completion/readiness
 * Check if the trip is ready for completion.
 */
router.get('/:id/completion/readiness', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const readiness = await deliveryService.getCompletionReadiness(tripId);
    res.json({ success: true, data: readiness });
  } catch (error) {
    sendOperationalError(res, error, 'Get completion readiness error:');
  }
});

/**
 * GET /api/trips/:id/delivery
 * Get delivery details including POD status.
 */
router.get('/:id/delivery', protect, adminOnly, async (req, res) => {
  const tripId = readTripId(req, res);
  if (tripId === null) return;
  try {
    const delivery = await deliveryService.getDelivery(tripId, req.user);
    res.json({ success: true, data: delivery });
  } catch (error) {
    sendOperationalError(res, error, 'Get delivery error:');
  }
});

module.exports = router;

