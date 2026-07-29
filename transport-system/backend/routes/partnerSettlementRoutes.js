/**
 * Settlement Routes - Admin
 * Generate & manage monthly settlements for transport partners
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const PartnerService = require('../services/PartnerService');

const partnerService = new PartnerService();

const adminCheck = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
  }
  next();
};

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================
// GENERATE MONTHLY SETTLEMENT
// ============================

router.post('/generate', protect, adminCheck, [
  body('partner_id').isInt({ min: 1 }).withMessage('Valid partner_id required'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Valid month (1-12) required'),
  body('year').isInt({ min: 2020, max: 2100 }).withMessage('Valid year required'),
], handleValidation, async (req, res) => {
  try {
    const { partner_id, month, year } = req.body;
    const settlement = await partnerService.generateSettlement(partner_id, month, year);
    res.status(201).json({
      success: true,
      message: 'Settlement generated successfully',
      data: settlement,
    });
  } catch (error) {
    console.error('Generate settlement error:', error);
    if (error.message?.includes('already exists')) {
      return res.status(409).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// GET ALL SETTLEMENTS (with filters)
// ============================

router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const { prisma } = require('../config/prisma');
    const { page = 1, limit = 20, partner_id, status, month, year } = req.query;

    const where = {};
    if (partner_id) where.partner_id = parseInt(partner_id);
    if (status) where.status = status;
    if (month) where.month = parseInt(month);
    if (year) where.year = parseInt(year);

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [settlements, total] = await Promise.all([
      prisma.settlement.findMany({
        where,
        include: {
          partner: {
            select: {
              partner_id: true,
              partner_code: true,
              partner_name: true,
              mobile: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.settlement.count({ where }),
    ]);

    res.json({
      success: true,
      data: settlements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('List settlements error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// GET SETTLEMENT DETAILS
// ============================

router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const { prisma } = require('../config/prisma');
    const settlementId = parseInt(req.params.id);
    if (isNaN(settlementId)) return res.status(400).json({ success: false, message: 'Invalid settlement ID' });

    const settlement = await prisma.settlement.findUnique({
      where: { settlement_id: settlementId },
      include: {
        partner: {
          select: {
            partner_id: true,
            partner_code: true,
            partner_name: true,
            owner_name: true,
            mobile: true,
            upi_id: true,
            bank_account: true,
            bank_ifsc: true,
            bank_name: true,
            address: true,
          },
        },
        bookings: {
          select: {
            booking_id: true,
            booking_reference: true,
            pickup_city: true,
            drop_city: true,
            final_price: true,
            commission_amount: true,
            status: true,
            delivered_at: true,
          },
        },
      },
    });

    if (!settlement) return res.status(404).json({ success: false, message: 'Settlement not found' });

    res.json({ success: true, data: settlement });
  } catch (error) {
    console.error('Get settlement error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// UPDATE SETTLEMENT STATUS
// ============================

router.patch('/:id/status', protect, adminCheck, [
  body('status').isIn(['pending', 'paid', 'partially_paid', 'cancelled', 'locked']).withMessage('Valid status required'),
], handleValidation, async (req, res) => {
  try {
    const settlementId = parseInt(req.params.id);
    if (isNaN(settlementId)) return res.status(400).json({ success: false, message: 'Invalid settlement ID' });

    const settlement = await partnerService.updateSettlementStatus(settlementId, req.body.status);
    res.json({ success: true, message: 'Settlement status updated', data: settlement });
  } catch (error) {
    console.error('Update settlement status error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================
// LOCK SETTLEMENT
// ============================

router.post('/:id/lock', protect, adminCheck, async (req, res) => {
  try {
    const settlementId = parseInt(req.params.id);
    if (isNaN(settlementId)) return res.status(400).json({ success: false, message: 'Invalid settlement ID' });

    const settlement = await partnerService.updateSettlementStatus(settlementId, 'locked');
    res.json({ success: true, message: 'Settlement locked. Financial records are now frozen.', data: settlement });
  } catch (error) {
    console.error('Lock settlement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
