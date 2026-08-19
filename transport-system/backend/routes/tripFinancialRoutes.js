/**
 * Trip Financial Routes
 * Role-based financial data access for trips.
 *
 * SECURITY: Backend enforces role-based visibility.
 * - ADMIN: Full financial visibility including BT Margin
 * - TRANSPORT_OWNER: Owner-specific financials only
 * - DRIVER: Driver-specific financials only
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/auth');
const TripFinancialService = require('../services/TripFinancialService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');
const CommissionService = require('../services/CommissionService');
const { serializeTripFinancial } = require('../dtos/TripFinancialDTO');
const { validateTransition } = require('../utils/BookingStateMachine');

const tripFinancialService = new TripFinancialService();
const tripAdvanceService = new TripAdvanceService();
const tripSettlementService = new TripSettlementService();
const commissionService = new CommissionService();

// ============================
// TRIP FINANCIAL SUMMARY
// ============================

/**
 * GET /api/trips/:bookingId/financial
 * Get trip financial summary (role-based).
 */
router.get('/:bookingId/financial', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';

    if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'operator') {
      role = 'ADMIN';
    } else if (user.role === 'partner') {
      // Partner = transport owner
      role = 'TRANSPORT_OWNER';
    } else if (user.role === 'driver') {
      role = 'DRIVER';
    } else {
      role = 'ADMIN'; // Default to admin for customers (they see minimal info)
    }

    const summary = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get trip financial error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/financial/timeline
 * Get trip financial timeline (role-based).
 */
router.get('/:bookingId/financial/timeline', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';

    if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'operator') {
      role = 'ADMIN';
    } else if (user.role === 'partner') {
      role = 'TRANSPORT_OWNER';
    } else if (user.role === 'driver') {
      role = 'DRIVER';
    }

    const timeline = await tripFinancialService.getTripFinancialTimeline(bookingId, role, user);

    res.json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    console.error('Get trip financial timeline error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// ADVANCES (Admin only for creation)
// ============================

/**
 * POST /api/trips/:bookingId/advances
 * Create a new advance (Admin only).
 */
router.post('/:bookingId/advances', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const advance = await tripAdvanceService.createAdvance(bookingId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Advance created successfully',
      data: advance,
    });
  } catch (error) {
    console.error('Create advance error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/advances
 * Get all advances for a trip (role-based).
 */
router.get('/:bookingId/advances', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';
    if (user.role === 'partner') role = 'TRANSPORT_OWNER';
    else if (user.role === 'driver') role = 'DRIVER';

    const advances = await tripAdvanceService.getAdvances(bookingId, role, user);

    res.json({
      success: true,
      data: advances,
    });
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/advances/summary
 * Get advance summary for a trip.
 */
router.get('/:bookingId/advances/summary', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const summary = await tripAdvanceService.getAdvanceSummary(bookingId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get advance summary error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// SETTLEMENTS (Admin only for recording)
// ============================

/**
 * POST /api/trips/:bookingId/settlements/driver
 * Record driver settlement payment (Admin only).
 */
router.post('/:bookingId/settlements/driver', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const settlement = await tripSettlementService.recordDriverSettlement(bookingId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Driver settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record driver settlement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:bookingId/settlements/owner
 * Record owner settlement payment (Admin only).
 */
router.post('/:bookingId/settlements/owner', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const settlement = await tripSettlementService.recordOwnerSettlement(bookingId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Owner settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record owner settlement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/settlements
 * Get settlement details for a trip.
 */
router.get('/:bookingId/settlements', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const settlement = await tripSettlementService.getSettlement(bookingId);

    res.json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    console.error('Get settlement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// COMMISSION (Admin only)
// ============================

/**
 * POST /api/trips/:bookingId/commission
 * Apply commission to a trip (Admin only).
 */
router.post('/:bookingId/commission', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const commission = await commissionService.applyCommission(bookingId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Commission applied successfully',
      data: commission,
    });
  } catch (error) {
    console.error('Apply commission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/commission
 * Get commission details for a trip.
 */
router.get('/:bookingId/commission', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const commission = await commissionService.getCommission(bookingId);

    res.json({
      success: true,
      data: commission,
    });
  } catch (error) {
    console.error('Get commission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// CALCULATE (Admin only)
// ============================

/**
 * POST /api/trips/:bookingId/financial/calculate
 * Recalculate trip financial summary (Admin only).
 */
router.post('/:bookingId/financial/calculate', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const result = await tripFinancialService.calculateTripFinancial(bookingId, {
      admin_id: req.user.user_id,
      notes: req.body.notes || null,
    });

    res.json({
      success: true,
      message: 'Trip financial recalculated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Calculate trip financial error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
