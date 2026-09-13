/**
 * Trip Financial Routes
 * Role-based financial data access for trips.
 *
 * SECURITY: Backend enforces role-based visibility.
 * - ADMIN: Full financial visibility including BT Margin
 * - TRANSPORT_OWNER: Owner-specific financials only
 * - DRIVER: Driver-specific financials only
 *
 * PHASE 3 REDESIGN: Transaction ledger is the single source of truth.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/prisma');
const TripFinancialService = require('../services/TripFinancialService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');
const TripTransactionService = require('../services/TripTransactionService');
const CommissionService = require('../services/CommissionService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const { serializeTripFinancial } = require('../dtos/TripFinancialDTO');
const { validateTransition } = require('../utils/BookingStateMachine');

const tripFinancialService = new TripFinancialService();
const tripAdvanceService = new TripAdvanceService();
const tripSettlementService = new TripSettlementService();
const tripTransactionService = new TripTransactionService();
const commissionService = new CommissionService();
const canonicalFinancialService = new CanonicalFinancialService();

// ============================
// TRIP FINANCIAL SUMMARY
// ============================

/**
 * GET /api/trips/:tripId/financials
 * Get standalone trip financial summary (canonical calculation).
 * For trips created without a booking.
 */
router.get('/:tripId/financials', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const financials = await canonicalFinancialService.calculateTripFinancials(tripId);

    res.json({
      success: true,
      data: financials,
    });
  } catch (error) {
    console.error('Get standalone trip financials error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

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

// ============================
// TRANSACTION LEDGER (Admin only for creation)
// ============================

/**
 * GET /api/trips/:bookingId/transactions
 * Get all financial transactions for a trip (role-based).
 */
router.get('/:bookingId/transactions', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';
    if (user.role === 'partner') role = 'TRANSPORT_OWNER';
    else if (user.role === 'driver') role = 'DRIVER';

    // Get trip financial
    const tripFinancial = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);
    if (!tripFinancial) {
      return res.status(404).json({ success: false, message: 'Trip financial not found' });
    }

    // Get all transactions for this booking
    const transactions = await tripTransactionService.getTripTransactions(
      tripFinancial.tripId || bookingId,
      role === 'ADMIN' ? {} : { from_party: role === 'TRANSPORT_OWNER' ? 'BIHAR_TRANSPORT' : undefined }
    );

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/transactions/ledger
 * Get complete transaction ledger for a trip.
 */
router.get('/:bookingId/transactions/ledger', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';
    if (user.role === 'partner') role = 'TRANSPORT_OWNER';
    else if (user.role === 'driver') role = 'DRIVER';

    // Get trip financial
    const tripFinancial = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);
    if (!tripFinancial) {
      return res.status(404).json({ success: false, message: 'Trip financial not found' });
    }

    // Get ledger
    const ledger = await tripTransactionService.getTripLedger(tripFinancial.tripId || bookingId);

    res.json({
      success: true,
      data: ledger,
    });
  } catch (error) {
    console.error('Get transaction ledger error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:bookingId/transactions/balances
 * Get party balances from transaction ledger.
 */
router.get('/:bookingId/transactions/balances', protect, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const user = req.user;
    let role = 'ADMIN';
    if (user.role === 'partner') role = 'TRANSPORT_OWNER';
    else if (user.role === 'driver') role = 'DRIVER';

    // Get trip financial
    const tripFinancial = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);
    if (!tripFinancial) {
      return res.status(404).json({ success: false, message: 'Trip financial not found' });
    }

    // Get balances
    const balances = await tripTransactionService.calculatePartyBalances(tripFinancial.tripId || bookingId);

    res.json({
      success: true,
      data: balances,
    });
  } catch (error) {
    console.error('Get party balances error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:bookingId/transactions
 * Create a new financial transaction (Admin only).
 * This is the universal transaction creation endpoint.
 */
router.post('/:bookingId/transactions', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const { transaction_type, amount, direction, from_party, to_party, purpose, payment_method, reference_number, transaction_date, notes, metadata } = req.body;

    if (!transaction_type || !amount || !direction || !from_party || !to_party || !purpose) {
      return res.status(400).json({ success: false, message: 'Missing required transaction fields' });
    }

    // Get trip financial
    const tripFinancial = await tripFinancialService.getTripFinancialSummary(bookingId, 'ADMIN', req.user);
    if (!tripFinancial) {
      return res.status(404).json({ success: false, message: 'Trip financial not found' });
    }

    // Create transaction
    const transaction = await tripTransactionService.createTransaction(
      {
        trip_financial_id: tripFinancial.tripFinancialId,
        booking_id: bookingId,
        trip_id: tripFinancial.tripId,
        transaction_type,
        amount,
        direction,
        from_party,
        to_party,
        purpose,
        payment_method,
        reference_number,
        transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
        notes,
        created_by: req.user.user_id,
        metadata,
      },
      req.user
    );

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:bookingId/transactions/:transactionId/reverse
 * Reverse a transaction (Admin only).
 */
router.post('/:bookingId/transactions/:transactionId/reverse', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const transactionId = parseInt(req.params.transactionId);

    if (isNaN(bookingId) || isNaN(transactionId)) {
      return res.status(400).json({ success: false, message: 'Invalid IDs' });
    }

    const { notes } = req.body;

    // Create reversal
    const reversal = await tripTransactionService.createReversal(
      {
        original_transaction_id: transactionId,
        notes: notes || 'Transaction reversal',
        created_by: req.user.user_id,
      },
      req.user
    );

    res.status(201).json({
      success: true,
      message: 'Transaction reversed successfully',
      data: reversal,
    });
  } catch (error) {
    console.error('Reverse transaction error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// TRIP-ID BASED ROUTES (standalone trips / offline clients)
// ============================================================

/**
 * POST /api/trips/:tripId/payments/client
 * Record a client/customer payment for a trip.
 * Creates a CLIENT_PAYMENT or CUSTOMER_PAYMENT FinancialTransaction.
 */
router.post('/:tripId/payments/client', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const { amount, payment_method, reference_number, notes, transaction_date, client_id, source_type } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    const transaction = await canonicalFinancialService.recordClientPayment(tripId, {
      amount,
      payment_method,
      reference_number,
      notes,
      transaction_date,
      client_id,
      source_type,
    }, req.user);

    res.status(201).json({
      success: true,
      message: 'Client payment recorded successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Record client payment error:', error);
    if (error.message && error.message.includes('exceeds outstanding')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:tripId/advances
 * Get all advances for a trip.
 */
router.get('/:tripId/advances', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const advances = await prisma.tripAdvance.findMany({
      where: { trip_id: tripId },
      orderBy: { given_at: 'desc' },
    });

    res.json({ success: true, data: advances });
  } catch (error) {
    console.error('Get trip advances error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:tripId/advances
 * Create an advance for a trip (by trip_id).
 */
router.post('/:tripId/advances', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const advance = await tripAdvanceService.createAdvance(null, { ...req.body, trip_id: tripId }, req.user);

    res.status(201).json({
      success: true,
      message: 'Advance created successfully',
      data: advance,
    });
  } catch (error) {
    console.error('Create trip advance error:', error);
    if (error.message && error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:tripId/settlements
 * Get all settlements for a trip.
 */
router.get('/:tripId/settlements', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const settlements = await prisma.tripSettlement.findMany({
      where: { trip_id: tripId },
      orderBy: { created_at: 'desc' },
    });

    res.json({ success: true, data: settlements });
  } catch (error) {
    console.error('Get trip settlements error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:tripId/settlements/driver
 * Record a driver settlement for a trip.
 */
router.post('/:tripId/settlements/driver', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const settlement = await tripSettlementService.recordDriverSettlementByTripId(tripId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Driver settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record driver settlement error:', error);
    if (error.message && error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:tripId/settlements/owner
 * Record an owner settlement for a trip.
 */
router.post('/:tripId/settlements/owner', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const settlement = await tripSettlementService.recordOwnerSettlementByTripId(tripId, req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Owner settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record owner settlement error:', error);
    if (error.message && error.message.includes('exceeds')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:tripId/transactions
 * Get all financial transactions for a trip.
 */
router.get('/:tripId/transactions', protect, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const transactions = await canonicalFinancialService.getTransactions({ trip_id: tripId });

    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Get trip transactions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
