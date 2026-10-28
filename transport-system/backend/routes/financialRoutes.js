const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const canonicalFinancialService = new CanonicalFinancialService();

/**
 * GET /api/admin/financials/summary
 * Global financial summary - alias for overview
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
 * GET /api/admin/financials/overview
 * Global financial overview dashboard
 */
router.get('/overview', protect, adminOnly, async (req, res) => {
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
    console.error('Get financial overview error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/financials/client-receivables
 * Client receivables with filters
 */
router.get('/client-receivables', protect, adminOnly, async (req, res) => {
  try {
    const receivables = await canonicalFinancialService.getReceivablesByClient(req.query || {});
    res.json({ success: true, receivables });
  } catch (error) {
    console.error('Get client receivables error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/financials/client-due
 * Client due - clients with outstanding balances (defaults to DUE status)
 */
router.get('/client-due', protect, adminOnly, async (req, res) => {
  try {
    // Client Due page should only show parties with outstanding balances
    // even when "All" is selected - that's what "Due" means
    const query = { ...req.query, status: req.query.status || 'DUE' };
    // Force outstanding > 0 for client-due page regardless of status filter
    query.requireOutstanding = true;
    const receivables = await canonicalFinancialService.getReceivablesByClient(query);
    res.json({ success: true, receivables });
  } catch (error) {
    console.error('Get client due error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/financials/provider-payables
 * Provider payables (owners and drivers)
 */
router.get('/provider-payables', protect, adminOnly, async (req, res) => {
  try {
    const payables = await canonicalFinancialService.getPayables();
    res.json({ success: true, data: payables });
  } catch (error) {
    console.error('Get provider payables error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/financials/payments-received
 * Customer payments actually received
 */
router.get('/payments-received', protect, adminOnly, async (req, res) => {
  try {
    const transactions = await canonicalFinancialService.getTransactions({
      ...req.query,
      transaction_type: {
        in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT']
      }
    });
    
    const rows = Array.isArray(transactions) ? transactions : (transactions.rows || []);
    const totalReceived = rows.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    
    res.json({ 
      success: true, 
      data: { 
        payments: rows, 
        totalReceived,
        pagination: transactions.pagination 
      } 
    });
  } catch (error) {
    console.error('Get payments received error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
});

/**
 * GET /api/admin/financials/advances
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
 * GET /api/admin/financials/settlements
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
 * GET /api/admin/financials/commission-earned
 * Commission earned
 */
router.get('/commission-earned', protect, adminOnly, async (req, res) => {
  try {
    const commission = await canonicalFinancialService.getCommissionEarned(req.query || {});
    res.json({ success: true, data: commission });
  } catch (error) {
    console.error('Get commission earned error:', error);
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
