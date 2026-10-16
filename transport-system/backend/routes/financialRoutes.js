const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const canonicalFinancialService = new CanonicalFinancialService();

/**
 * GET /api/financials/summary
 * Global financial summary
 */
router.get('/summary', protect, adminOnly, async (req, res) => {
  try {
    const summary = await canonicalFinancialService.calculateGlobalFinancials();
    const transformed = {
      ...summary,
      receivables: {
        totalFreight: summary.totalFreight,
        totalReceived: summary.totalReceived,
        totalOutstanding: summary.totalReceivable
      },
      payables: {
        owner: {
          totalShare: summary.totalOwnerShare,
          totalPaid: summary.totalOwnerPaid,
          totalDue: summary.totalOwnerPayable
        },
        driver: {
          totalAgreedPay: summary.totalDriverAgreedPay,
          totalPaid: summary.totalDriverPaid,
          totalDue: summary.totalDriverPayable
        }
      },
      commission: {
        total: summary.totalBtCommission
      }
    };
    res.json({ success: true, data: transformed });
  } catch (error) {
    console.error('Get financial summary error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/receivables
 * Client receivables
 */
router.get('/receivables', protect, adminOnly, async (req, res) => {
  try {
    const receivables = await canonicalFinancialService.getReceivablesByClient(req.query || {});
    res.json({ success: true, receivables });
  } catch (error) {
    console.error('Get receivables error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/payables
 * Provider payables
 */
router.get('/payables', protect, adminOnly, async (req, res) => {
  try {
    const payables = await canonicalFinancialService.getPayables();
    res.json({ success: true, data: payables });
  } catch (error) {
    console.error('Get payables error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/transactions
 * Financial transactions
 */
router.get('/transactions', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions(req.query || {});
    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/transactions/ledger
 * Financial ledger
 */
router.get('/transactions/ledger', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions(req.query || {});
    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Get ledger error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/advances
 * Advances
 */
router.get('/advances', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions({
      ...req.query,
      transaction_type: {
        in: ['DRIVER_ADVANCE', 'OWNER_ADVANCE', 'FUEL_ADVANCE']
      }
    });
    
    const rows = Array.isArray(transactions) ? transactions : (transactions.rows || []);
    
    // Calculate summary
    const summary = {
      totalDriverAdvance: 0,
      totalFuelAdvance: 0,
      totalOwnerAdvance: 0,
      totalAll: 0
    };
    
    rows.forEach(tx => {
      const amount = Number(tx.amount) || 0;
      summary.totalAll += amount;
      if (tx.transaction_type === 'DRIVER_ADVANCE') {
        summary.totalDriverAdvance += amount;
      } else if (tx.transaction_type === 'FUEL_ADVANCE') {
        summary.totalFuelAdvance += amount;
      } else if (tx.transaction_type === 'OWNER_ADVANCE') {
        summary.totalOwnerAdvance += amount;
      }
    });
    
    res.json({ success: true, data: { advances: rows, summary, pagination: transactions.pagination } });
  } catch (error) {
    console.error('Get advances error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/settlements
 * Settlements
 */
router.get('/settlements', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions({
      ...req.query,
      transaction_type: {
        in: ['DRIVER_SETTLEMENT', 'OWNER_SETTLEMENT']
      }
    });
    
    const rows = Array.isArray(transactions) ? transactions : (transactions.rows || []);
    
    // Calculate summary
    const summary = {
      totalDriverSettlement: 0,
      totalOwnerSettlement: 0,
      totalAll: 0
    };
    
    rows.forEach(tx => {
      const amount = Number(tx.amount) || 0;
      summary.totalAll += amount;
      if (tx.transaction_type === 'DRIVER_SETTLEMENT') {
        summary.totalDriverSettlement += amount;
      } else if (tx.transaction_type === 'OWNER_SETTLEMENT') {
        summary.totalOwnerSettlement += amount;
      }
    });
    
    res.json({ success: true, data: { settlements: rows, summary, pagination: transactions.pagination } });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/commission
 * Commission earned
 */
router.get('/commission', protect, adminOnly, async (req, res) => {
  try {
    const commission = await canonicalFinancialService.getCommissionEarned(req.query || {});
    res.json({ success: true, data: commission });
  } catch (error) {
    console.error('Get commission error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/financials/client-ledger/:clientId
 * Client ledger
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
 * Vendor ledger
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
 * GET /api/financials/driver-ledger/:driverId
 * Driver ledger
 */
router.get('/driver-ledger/:driverId', protect, adminOnly, async (req, res) => {
  try {
    if (typeof canonicalFinancialService.getDriverLedger === 'function') {
      const ledger = await canonicalFinancialService.getDriverLedger(req.params.driverId, req.query || {});
      return res.json({ success: true, data: ledger });
    }
    return res.json({
      success: true,
      data: {
        party: { party_type: 'DRIVER', driver_id: parseInt(req.params.driverId) },
        totals: { totalAgreedPay: 0, totalPaid: 0, outstanding: 0 },
        transactions: [],
        payments: []
      }
    });
  } catch (error) {
    console.error('Get driver ledger error:', error);
    res.json({
      success: true,
      data: {
        party: { party_type: 'DRIVER', driver_id: parseInt(req.params.driverId) },
        totals: { totalAgreedPay: 0, totalPaid: 0, outstanding: 0 },
        transactions: [],
        payments: []
      }
    });
  }
});

module.exports = router;
