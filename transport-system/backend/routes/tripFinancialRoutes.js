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
 *
 * WHY THIS FILE DISPATCHES ON THE ID (Phase 3)
 * routes/tripRoutes.js and this router are BOTH mounted on /api/trips, so the
 * URL cannot tell a booking id from a trip id: /api/trips/12/advances is
 * genuinely ambiguous. Express also matches the first declared pattern, so the
 * /:bookingId/... handlers used to win every time and the /:tripId/... handlers
 * further down this file were unreachable.
 *
 * That silently broke the trip workspace: every existing UI call passes a TRIP
 * id (adminAPI.getTripAdvancesByTripId, createTripAdvanceByTripId,
 * recordOwnerSettlement), so advances were being read and written against a
 * non-existent BOOKING id instead of the trip.
 *
 * The fix keeps every existing URL and every existing booking call working.
 * resolveTrip() decides which world the id belongs to, a Trip wins when it
 * exists (a Trip may legitimately exist with no Booking), and anything that is
 * not a Trip falls through to the original booking behaviour. No new URL, no UI
 * change, no breaking change.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/prisma');
const { renderPaymentDocument } = require('../services/PaymentDocumentPdf');
const TripFinancialService = require('../services/TripFinancialService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');
const TripTransactionService = require('../services/TripTransactionService');
const CommissionService = require('../services/CommissionService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const VendorLedgerService = require('../services/VendorLedgerService');
const { serializeTripFinancial, projectTransactionsForRole } = require('../dtos/TripFinancialDTO');
const { validateTransition } = require('../utils/BookingStateMachine');

const tripFinancialService = new TripFinancialService();
const tripAdvanceService = new TripAdvanceService();
const tripSettlementService = new TripSettlementService();
const tripTransactionService = new TripTransactionService();
const commissionService = new CommissionService();
const canonicalFinancialService = new CanonicalFinancialService();
const vendorLedgerService = new VendorLedgerService();

/**
 * Resolve an id taken from the URL to a Trip, or null when it is not one.
 *
 * @param {number|string} id
 * @returns {Promise<Object|null>}
 */
async function resolveTrip(id) {
  const tripId = parseInt(id);
  if (Number.isNaN(tripId)) return null;
  return await prisma.trip.findUnique({
    where: { trip_id: tripId },
    select: {
      trip_id: true,
      trip_number: true,
      booking_id: true,
      driver_id: true,
      vehicle_id: true,
      transport_owner_id: true,
    },
  });
}

/**
 * Role mapping already used by this router, factored out so the dispatching
 * handlers below do not each repeat it.
 *
 * PHASE 7 — a `customer` is NO LONGER mapped to ADMIN
 *   Both the helper and the two inline copies in this file used to end with
 *   `return 'ADMIN'` as a catch-all, and one of them said so in a comment:
 *   "Default to admin for customers (they see minimal info)". That granted
 *   every logged-in customer the full ADMIN financial projection, including
 *   btMargin, commission, the driver payout and the owner settlement — the
 *   exact "customer must NOT see vendor payable / commission / internal
 *   margins" rule. Customers now resolve to their own CUSTOMER projection.
 *
 *   An unrecognised role resolves to the LEAST privileged view rather than
 *   the most, so a future role can never be granted admin money by accident.
 *
 * @param {Object} user
 * @returns {'ADMIN'|'TRANSPORT_OWNER'|'DRIVER'|'CUSTOMER'}
 */
function roleFor(user) {
  if (!user) return 'CUSTOMER';
  if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'operator') return 'ADMIN';
  if (user.role === 'partner') return 'TRANSPORT_OWNER';
  if (user.role === 'driver') return 'DRIVER';
  if (user.role === 'customer') return 'CUSTOMER';
  // Least privilege for anything unrecognised.
  return 'CUSTOMER';
}

// ============================
// TRIP FINANCIAL SUMMARY
// ============================

/**
 * GET /api/trips/:tripId/financials
 * Get standalone trip financial summary (canonical calculation).
 * For trips created without a booking.
 *
 * PHASE 7: this used to be `protect` only, and the canonical summary contains
 * btCommission, ownerShare, ownerDue and driverDue — the whole vendor side. It
 * is now admin-only, which matches `/:tripId/vendor-position` and
 * `/api/financials/*` in the same router. A customer asking a trip id for
 * their own money uses `/:bookingId/financial`, which returns the CUSTOMER
 * allow-list projection.
 */
router.get('/:tripId/financials', protect, adminOnly, async (req, res) => {
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

    // PHASE 7: roleFor() instead of the inline mapping, which resolved every
    // non-staff caller — customers included — to ADMIN.
    const user = req.user;
    const role = roleFor(user);

    const summary = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    // PHASE 7: an authorization refusal is a 403, not a 500.
    return respondToFinancialError(res, error, 'Get trip financial');
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

    // PHASE 7: same fix as /financial above — no caller defaults to ADMIN.
    const user = req.user;
    const role = roleFor(user);

    const timeline = await tripFinancialService.getTripFinancialTimeline(bookingId, role, user);

    res.json({
      success: true,
      data: timeline,
    });
  } catch (error) {
    // PHASE 7: an authorization refusal is a 403, not a 500.
    return respondToFinancialError(res, error, 'Get trip financial timeline');
  }
});

// ============================
// ADVANCES (Admin only for creation)
// ============================

/**
 * POST /api/trips/:id/advances
 * Create a new advance (Admin only).
 *
 * `:id` is a TRIP id when a Trip with that id exists (which is what every
 * existing UI call sends), otherwise a BOOKING id. See the header note.
 */
router.post('/:id/advances', protect, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);
    const advance = trip
      ? await tripAdvanceService.createAdvance(null, { ...req.body, trip_id: trip.trip_id }, req.user)
      : await tripAdvanceService.createAdvance(id, req.body, req.user);

    res.status(201).json({
      success: true,
      message: advance.already_recorded
        ? 'Advance already recorded for this reference'
        : 'Advance created successfully',
      data: advance,
    });
  } catch (error) {
    console.error('Create advance error:', error);
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:id/advances
 * Get all advances for a trip (role-based).
 */
router.get('/:id/advances', protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);
    const role = roleFor(req.user);
    const advances = trip
      ? await tripAdvanceService.getAdvances(null, trip.trip_id, role)
      : await tripAdvanceService.getAdvances(id, null, role);

    res.json({
      success: true,
      scope: trip ? 'trip' : 'booking',
      data: advances,
    });
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:id/advances/summary
 * Get advance summary for a trip.
 */
router.get('/:id/advances/summary', protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);
    const summary = trip
      ? await tripAdvanceService.getAdvanceSummary(null, trip.trip_id)
      : await tripAdvanceService.getAdvanceSummary(id);

    res.json({
      success: true,
      scope: trip ? 'trip' : 'booking',
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
 * POST /api/trips/:id/settlements/driver
 * Record driver settlement payment (Admin only).
 */
router.post('/:id/settlements/driver', protect, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);
    const settlement = trip
      ? await tripSettlementService.recordDriverSettlementByTripId(trip.trip_id, req.body, req.user)
      : await tripSettlementService.recordDriverSettlement(id, req.body, req.user);

    res.status(201).json({
      success: true,
      message: settlement.already_recorded
        ? 'Driver settlement already recorded for this reference'
        : 'Driver settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record driver settlement error:', error);
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * POST /api/trips/:id/settlements/owner
 * Record owner settlement payment (Admin only).
 */
router.post('/:id/settlements/owner', protect, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);
    const settlement = trip
      ? await tripSettlementService.recordOwnerSettlementByTripId(trip.trip_id, req.body, req.user)
      : await tripSettlementService.recordOwnerSettlement(id, req.body, req.user);

    res.status(201).json({
      success: true,
      message: settlement.already_recorded
        ? 'Owner settlement already recorded for this reference'
        : 'Owner settlement recorded successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Record owner settlement error:', error);
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:id/settlements
 * Get settlement details for a trip (or the trip linked to a booking).
 */
router.get('/:id/settlements', protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid trip or booking ID' });
    }

    const trip = await resolveTrip(id);

    if (trip) {
      const settlements = await prisma.tripSettlement.findMany({
        where: { trip_id: trip.trip_id },
        orderBy: { settlement_id: 'asc' },
      });
      // The authoritative money position for the trip's vendor, so a caller
      // never has to derive it client-side.
      const position = await vendorLedgerService.getOwnerPosition(trip.trip_id);
      return res.json({
        success: true,
        scope: 'trip',
        trip: { trip_id: trip.trip_id, trip_number: trip.trip_number },
        data: settlements,
        position,
      });
    }

    const settlement = await tripSettlementService.getSettlement(id);

    res.json({
      success: true,
      scope: 'booking',
      data: settlement,
    });
  } catch (error) {
    console.error('Get settlement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/trips/:tripId/vendor-position
 * Authoritative vendor money position for one trip:
 *   gross hire / commission / net vendor payable / advances / payments /
 *   outstanding.
 *
 * The payable is computed on the server from the persisted hire. Any
 * net_vendor_payable / owner_payable / vendor_payable supplied by the caller is
 * ignored — that is the Phase 3 contract for STEP 3.
 */
router.get('/:tripId/vendor-position', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId);
    if (isNaN(tripId)) {
      return res.status(400).json({ success: false, message: 'Invalid trip ID' });
    }

    const position = await vendorLedgerService.getOwnerPosition(tripId, req.body || req.query);

    res.json({ success: true, data: position });
  } catch (error) {
    console.error('Get vendor position error:', error);
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
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
 * Map a service-layer authorization failure to the right HTTP status.
 *
 * PHASE 7: TripFinancialService throws a ValidationError when a caller asks
 * for money that is not theirs ("Access denied. This booking does not belong
 * to you"). Returning 500 for that was wrong and hid a real authorization
 * decision behind a server fault.
 */
function respondToFinancialError(res, error, logLabel) {
  console.error(`${logLabel} error:`, error);
  const message = error?.message || 'Server error';
  if (typeof message === 'string' && message.toLowerCase().includes('access denied')) {
    return res.status(403).json({ success: false, message });
  }
  if (error?.name === 'ValidationError' || error?.statusCode === 400) {
    return res.status(400).json({ success: false, message });
  }
  if (error?.name === 'NotFoundError' || error?.statusCode === 404) {
    return res.status(404).json({ success: false, message });
  }
  return res.status(500).json({ success: false, message });
}

/**
 * GET /api/trips/:bookingId/transactions
 * Get all financial transactions for a trip (role-based).
 *
 * PHASE 7: roleFor() (no ADMIN default) + an explicit allow-list projection.
 * The previous filter was `{ from_party: undefined }` for a DRIVER, i.e. NO
 * filter at all, and 'ADMIN' for a customer.
 */
router.get('/:bookingId/transactions', protect, async (req, res) => {
  try {
    const id = parseInt(req.params.bookingId);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking or trip ID' });
    }

    // PHASE 7 — dispatch on WHAT the id is, exactly as the advances and
    // settlements handlers above already do (see the file header). Both
    // /:bookingId/transactions and /:tripId/transactions are declared in this
    // router and match the same URL, and Express takes the first one — so a
    // TRIP id used to be handed to the booking handler, which then looked up a
    // non-existent booking and 500'd. resolveTrip() makes the id unambiguous;
    // no URL changes and no UI change.
    const asTrip = await resolveTrip(id);
    const asBooking = asTrip ? null : await prisma.booking.findUnique({
      where: { booking_id: id },
      select: { booking_id: true, user_id: true, driver_id: true, vehicle_owner_id: true },
    });

    if (!asTrip && !asBooking) {
      return res.status(404).json({ success: false, message: 'Trip or booking not found' });
    }

    const user = req.user;
    const role = roleFor(user);

    // The role check runs against the OWNING booking either way, so it also
    // enforces "is this booking yours?".
    const owningBookingId = asTrip ? asTrip.booking_id : asBooking.booking_id;
    if (owningBookingId) {
      await tripFinancialService.getTripFinancialSummary(owningBookingId, role, user);
    } else if (role === 'CUSTOMER') {
      // A standalone trip with no booking has no customer owner to authorise
      // against, and the admin-only detail view covers the rest.
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const transactions = await tripTransactionService.getTripTransactions(asTrip ? asTrip.trip_id : id);

    res.json({
      success: true,
      scope: asTrip ? 'trip' : 'booking',
      data: projectTransactionsForRole(transactions, role, user),
    });
  } catch (error) {
    return respondToFinancialError(res, error, 'Get transactions');
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

    // PHASE 7: same trip-or-booking dispatch as /transactions above, because
    // this URL is matched by both handlers and Express takes the first.
    const asTrip = await resolveTrip(bookingId);
    const asBooking = asTrip ? null : await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { booking_id: true },
    });
    if (!asTrip && !asBooking) {
      return res.status(404).json({ success: false, message: 'Trip or booking not found' });
    }

    const user = req.user;
    // PHASE 7: no ADMIN default — see roleFor().
    const role = roleFor(user);

    const owningBookingId = asTrip ? asTrip.booking_id : asBooking.booking_id;
    if (owningBookingId) {
      await tripFinancialService.getTripFinancialSummary(owningBookingId, role, user);
    } else if (role === 'CUSTOMER') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const ledger = await tripTransactionService.getTripLedger(asTrip ? asTrip.trip_id : bookingId);

    res.json({
      success: true,
      scope: asTrip ? 'trip' : 'booking',
      data: projectTransactionsForRole(ledger, role, user),
    });
  } catch (error) {
    return respondToFinancialError(res, error, 'Get transaction ledger');
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
    // PHASE 7: no ADMIN default — see roleFor().
    const role = roleFor(user);

    // Get trip financial — also enforces "is this booking yours?".
    const tripFinancial = await tripFinancialService.getTripFinancialSummary(bookingId, role, user);
    if (!tripFinancial) {
      return res.status(404).json({ success: false, message: 'Trip financial not found' });
    }

    const balances = await tripTransactionService.calculatePartyBalances(tripFinancial.tripId || bookingId);

    // PHASE 7: the party-balance object exposes the OWNER and DRIVER payable
    // alongside the customer, so a non-admin caller gets only their own side.
    const payload = { ...balances };
    if (role !== 'ADMIN') {
      if (role === 'CUSTOMER') {
        delete payload.owner;
        delete payload.driver;
        delete payload.expenses;
      } else if (role === 'DRIVER') {
        delete payload.owner;
        delete payload.client;
        delete payload.expenses;
      } else if (role === 'TRANSPORT_OWNER') {
        delete payload.driver;
        delete payload.client;
        delete payload.expenses;
      }
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    return respondToFinancialError(res, error, 'Get party balances');
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
 * PHASE 3: the /:tripId/advances, /:tripId/settlements/* handlers that used
 * to live here were unreachable — Express matched the identically-shaped
 * /:id/... handlers declared above first, and those now dispatch on whether
 * the id is a Trip or a Booking (see the header note). They have been
 * removed rather than left as dead code so there is only one place to fix.
 */

/**
 * GET /api/trips/:tripId/transactions
 * Get all financial transactions for a trip.
 *
 * PHASE 7: admin-only. This returned the complete money ledger — customer
 * freight, owner advances and settlements, driver payouts, commission — behind
 * `protect` alone, so any logged-in customer, driver or partner could read a
 * trip's entire financial position, including other parties' money. The admin
 * trip UI is the only consumer, and admins are unaffected.
 */
router.get('/:tripId/transactions', protect, adminOnly, async (req, res) => {
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

/**
 * GET /api/trips/:tripId/payments/:transactionId/RECEIPT.pdf
 * GET /api/trips/:tripId/payments/:transactionId/VOUCHER.pdf
 *
 * Render a money receipt (money received, CREDIT) or a payment voucher (money
 * paid out, DEBIT) from the persisted FinancialTransaction row — the SAME ledger
 * the balances are read from. No second source of truth, and a document can
 * never exist for a payment that was not recorded. The renderer refuses the
 * wrong kind (a receipt for an outgoing payment → 400).
 */
router.get('/:tripId/payments/:transactionId/:docType', protect, adminOnly, async (req, res) => {
  try {
    const tripId = parseInt(req.params.tripId, 10);
    const transactionId = parseInt(req.params.transactionId, 10);
    const kind = String(req.params.docType || '').replace(/\.pdf$/i, '').toUpperCase();
    if (isNaN(tripId) || isNaN(transactionId) || (kind !== 'RECEIPT' && kind !== 'VOUCHER')) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const tx = await prisma.financialTransaction.findUnique({ where: { transaction_id: transactionId } });
    if (!tx || tx.trip_id !== tripId) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    const invoice = tx.invoice_id
      ? await prisma.invoice.findUnique({ where: { invoice_id: tx.invoice_id } })
      : null;

    const pdf = await renderPaymentDocument({ transaction: tx, kind, trip, invoice });
    const safeRef = String(tx.reference_number || `TXN-${tx.transaction_id}`).replace(/[^\w.-]+/g, '-');
    const filename = kind === 'RECEIPT' ? `Money-Receipt-${safeRef}.pdf` : `Payment-Voucher-${safeRef}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    return res.send(pdf);
  } catch (error) {
    // assertDocumentType throws a ValidationError for the wrong document kind.
    if (error.message && /money receipt|payment voucher/i.test(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Payment document error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
