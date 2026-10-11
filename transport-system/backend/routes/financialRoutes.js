/**
 * Financial Routes
 * Central financial control center for Bihar Transport.
 *
 * All financial values are calculated from FinancialTransaction records
 * using CanonicalFinancialService — the single source of truth.
 *
 * SECURITY: Backend enforces admin-only access for financial data.
 */

const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const canonicalFinancialService = new CanonicalFinancialService();

// ============================================================
// GLOBAL FINANCIAL SUMMARY
// ============================================================

/**
 * GET /api/financials/summary
 * Get global financial summary.
 */
router.get('/summary', protect, adminOnly, async (req, res) => {
  try {
    const summary = await canonicalFinancialService.calculateGlobalFinancials();

    res.json({
      success: true,
      data: {
        // Top cards
        totalReceivable: summary.totalReceivable,
        totalPayable: summary.totalPayable,
        totalReceived: summary.totalReceived,
        totalAdvances: summary.totalAdvances,
        netPosition: summary.netPosition,
        // Details
        receivables: {
          totalFreight: summary.totalFreight,
          totalReceived: summary.totalReceived,
          totalOutstanding: summary.totalReceivable,
        },
        payables: {
          owner: {
            totalShare: summary.totalOwnerShare,
            totalPaid: summary.totalOwnerPaid,
            totalDue: summary.totalOwnerPayable,
          },
          driver: {
            totalAgreedPay: summary.totalDriverAgreedPay,
            totalPaid: summary.totalDriverPaid,
            totalDue: summary.totalDriverPayable,
          },
        },
        commission: {
          total: summary.totalBtCommission,
        },
        trips: {
          total: summary.totalTrips,
        },
      },
    });
  } catch (error) {
    console.error('Get financial summary error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// RECEIVABLES
// ============================================================

/**
 * GET /api/financials/receivables
 * Get receivables grouped by client.
 *
 * QUERY: ?status=ALL|DUE|UNPAID|PARTIALLY_PAID|OVERDUE|DUE_SOON
 *        &search= &sort=OUTSTANDING_DESC|OUTSTANDING_ASC|OLDEST_DUE|NEWEST
 *
 * `status=DUE` is the "Client Due" view — only parties money is actually
 * pending from. The filters run on the SAME per-client balance the summary uses,
 * so whatever this returns still totals to the dashboard figure.
 */
router.get('/receivables', protect, adminOnly, async (req, res) => {
  try {
    const receivables = await canonicalFinancialService.getReceivablesByClient(req.query || {});

    const totalOutstanding = receivables.reduce((sum, r) => sum + r.outstanding, 0);

    res.json({
      success: true,
      data: {
        totalOutstanding,
        count: receivables.length,
        receivables,
      },
    });
  } catch (error) {
    console.error('Get receivables error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// PAYABLES
// ============================================================

/**
 * GET /api/financials/payables
 * Get payables grouped by owner and driver.
 *
 * Each owner row carries `ownerId`, which is what the vendor-ledger drill-down
 * is addressed by.
 */
router.get('/payables', protect, adminOnly, async (req, res) => {
  try {
    const payables = await canonicalFinancialService.getPayables();

    const totalOwnerDue = payables.owners.reduce((sum, o) => sum + o.totalDue, 0);
    const totalDriverDue = payables.drivers.reduce((sum, d) => sum + d.totalDue, 0);

    res.json({
      success: true,
      data: {
        totalPayable: totalOwnerDue + totalDriverDue,
        totalOwnerDue,
        totalDriverDue,
        owners: payables.owners,
        drivers: payables.drivers,
      },
    });
  } catch (error) {
    console.error('Get payables error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// TRANSACTIONS
// ============================================================

/**
 * GET /api/financials/transactions
 * Get all financial transactions with optional filters.
 */
router.get('/transactions', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions(req.query);

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
 * GET /api/financials/transactions/ledger
 * Get complete transaction ledger.
 */
router.get('/transactions/ledger', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions({
      ...req.query,
      orderBy: 'transaction_date',
      orderDirection: 'asc',
    });

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error('Get transaction ledger error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// LEDGER DRILL-DOWNS — the "who exactly" behind a total
// ============================================================

/**
 * GET /api/financials/client-ledger/:clientId
 *
 * ONE customer's complete statement: identity, every trip they were billed for,
 * every payment they actually made, and a running balance.
 *
 * SECURITY: `protect` + `adminOnly`, exactly like every other route in this
 * file. No vendor or customer contact detail is exposed to anyone else.
 */
router.get('/client-ledger/:clientId', protect, adminOnly, async (req, res) => {
  try {
    const ledger = await canonicalFinancialService.getClientLedger(req.params.clientId, req.query || {});
    res.json({ success: true, data: ledger });
  } catch (error) {
    console.error('Get client ledger error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/vendor-ledger/:ownerId
 *
 * ONE vehicle owner's complete statement, with gross hire, commission and net
 * payable preserved as three separate figures and a running balance.
 */
router.get('/vendor-ledger/:ownerId', protect, adminOnly, async (req, res) => {
  try {
    const ledger = await canonicalFinancialService.getVendorLedger(req.params.ownerId, req.query || {});
    res.json({ success: true, data: ledger });
  } catch (error) {
    console.error('Get vendor ledger error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/commission
 * Commission earned, per trip, with gross / commission / net kept distinct.
 */
router.get('/commission', protect, adminOnly, async (req, res) => {
  try {
    const data = await canonicalFinancialService.getCommissionEarned(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('Get commission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// ADVANCES
// ============================================================

/**
 * GET /api/financials/advances
 * Get all advances summary.
 */
router.get('/advances', protect, adminOnly, async (req, res) => {
  try {
    const advances = await canonicalFinancialService.getTransactions({
      transaction_type: { in: ['DRIVER_ADVANCE', 'FUEL_ADVANCE', 'OWNER_ADVANCE'] },
    });

    const summary = {
      totalDriverAdvance: 0,
      totalFuelAdvance: 0,
      totalOwnerAdvance: 0,
      totalAll: 0,
      count: advances.length,
    };

    for (const adv of advances) {
      if (adv.transaction_type === 'DRIVER_ADVANCE') summary.totalDriverAdvance += adv.amount;
      else if (adv.transaction_type === 'FUEL_ADVANCE') summary.totalFuelAdvance += adv.amount;
      else if (adv.transaction_type === 'OWNER_ADVANCE') summary.totalOwnerAdvance += adv.amount;
    }

    summary.totalAll = summary.totalDriverAdvance + summary.totalFuelAdvance + summary.totalOwnerAdvance;

    res.json({
      success: true,
      data: {
        summary,
        advances,
      },
    });
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================================
// SETTLEMENTS
// ============================================================

/**
 * GET /api/financials/settlements
 * Get all settlements summary.
 */
router.get('/settlements', protect, adminOnly, async (req, res) => {
  try {
    const settlements = await canonicalFinancialService.getTransactions({
      transaction_type: { in: ['DRIVER_SETTLEMENT', 'OWNER_SETTLEMENT'] },
    });

    const summary = {
      totalDriverSettlement: 0,
      totalOwnerSettlement: 0,
      totalAll: 0,
      count: settlements.length,
    };

    for (const set of settlements) {
      if (set.transaction_type === 'DRIVER_SETTLEMENT') summary.totalDriverSettlement += set.amount;
      else if (set.transaction_type === 'OWNER_SETTLEMENT') summary.totalOwnerSettlement += set.amount;
    }

    summary.totalAll = summary.totalDriverSettlement + summary.totalOwnerSettlement;

    res.json({
      success: true,
      data: {
        summary,
        settlements,
      },
    });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
