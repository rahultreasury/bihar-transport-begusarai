/**
 * Partner Routes - Admin
 * Complete CRUD + Dashboard + Trucks + Documents + Driver Assignment
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const PartnerService = require('../services/PartnerService');

const partnerService = new PartnerService();

// Admin access middleware
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

const handleError = (res, error, defaultMsg = 'Server error') => {
  console.error('Partner route error:', error);
  if (error.code === 'PARTNER_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'P2002') {
    return res.status(400).json({ success: false, message: 'A partner with this mobile already exists' });
  }
  res.status(500).json({ success: false, message: error.message || defaultMsg });
};

// ============================
// STATS (Dashboard)
// ============================

router.get('/stats', protect, adminCheck, async (req, res) => {
  try {
    const enh = req.query.enhanced === 'true';
    const stats = enh ? await partnerService.getOwnerStats() : await partnerService.getPartnerStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// PARTNER CRUD
// ============================

// List partners
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const result = await partnerService.listPartners(req.query);
    res.json({ success: true, data: result.partners, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

// Get partner profile
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const partner = await partnerService.getPartnerProfile(partnerId);
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

    res.json({ success: true, data: partner });
  } catch (error) {
    handleError(res, error);
  }
});

// Create partner
router.post('/', protect, adminCheck, [
  body('owner_name').trim().notEmpty().withMessage('Please enter the owner\'s name.'),
  body('mobile').trim().notEmpty().withMessage('Phone number is required.')
    .matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number.'),
  body('city').trim().notEmpty().withMessage('City is required.'),
  body('commission_percentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Commission must be between 0 and 100%.'),
  body('partner_capability').optional().isIn(['PARTNER_ONLY', 'TRANSPORT_OPERATOR', 'BOTH']).withMessage('Invalid partner capability.'),
], handleValidation, async (req, res, next) => {
  try {
    console.log('[ROUTE] POST /admin/partners - ENTERED');
    console.log('[ROUTE] Request body keys:', Object.keys(req.body));
    console.log('[ROUTE] owner_name:', req.body.owner_name, 'mobile:', req.body.mobile);

    const partner = await partnerService.registerPartner(req.body);

    console.log('[ROUTE] registerPartner returned. partner_id:', partner?.partner_id);
    console.log('[ROUTE] Sending 201 response');
    return res.status(201).json({
      success: true,
      message: 'Transport Owner registered successfully.',
      data: {
        partner_id: partner.partner_id,
        partner_code: partner.partner_code,
        partner_name: partner.partner_name,
        partner_capability: partner.partner_capability,
        linked_vehicle_owner_id: partner.linked_vehicle_owner_id || null,
      },
    });
  } catch (error) {
    console.error('[ROUTE] Create partner error:', error.message, 'code:', error.code);
    if (error.code === 'PARTNER_ALREADY_EXISTS') {
      return res.status(409).json({ success: false, message: 'This phone number is already registered with another owner.', data: error.data });
    }
    if (error.code === 'MISSING_OWNER_NAME') {
      return res.status(400).json({ success: false, message: 'Please enter the owner\'s name.' });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'This phone number is already registered.' });
    }
    if (error.code === 'INVALID_COMMISSION') {
      return res.status(400).json({ success: false, message: 'Commission must be between 0 and 100%.' });
    }
    if (error.code === 'INVALID_PARTNER_CAPABILITY') {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.log('[ROUTE] Sending 500 error response');
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update partner
router.put('/:id', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const partner = await partnerService.updatePartner(partnerId, req.body);
    res.json({ success: true, message: 'Partner updated successfully', data: partner });
  } catch (error) {
    handleError(res, error);
  }
});

// Permanently delete transport owner (dependency-aware). Only returns success
// AFTER the database confirms the row is gone. Rejects with a structured error
// when the owner has protected financial/historical or operational records.
router.delete('/:id', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.permanentlyDeletePartner(partnerId, req.user?.user_id || null);
    res.json({ success: true, message: 'Transport owner deleted successfully.', data: { partner_id: partnerId } });
  } catch (error) {
    console.error('Delete partner error:', error);
    if (error.code === 'OWNER_NOT_FOUND') {
      return res.status(404).json({ success: false, error: { code: error.code, message: error.message } });
    }
    if (error.code === 'OWNER_HAS_DEPENDENCIES') {
      return res.status(409).json({
        success: false,
        error: { code: error.code, message: error.message, data: error.data || null },
      });
    }
    if (error.code === 'OWNER_DELETE_FAILED') {
      return res.status(500).json({ success: false, error: { code: error.code, message: error.message } });
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// Update partner status
router.patch('/:id/status', protect, adminCheck, [
  body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Valid status required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const partner = await partnerService.toggleStatus(partnerId, req.body.status);
    res.json({ success: true, message: 'Partner status updated', data: { partner_id: partnerId, status: partner.status } });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// DASHBOARD
// ============================

router.get('/:id/dashboard', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const dashboard = await partnerService.getPartnerDashboard(partnerId);
    if (!dashboard) return res.status(404).json({ success: false, message: 'Partner not found' });

    res.json({ success: true, data: dashboard });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// SOURCED VEHICLES
// ============================

router.get('/:id/sourced-vehicles', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const vehicles = await partnerService.getSourcedVehicles(partnerId);
    res.json({ success: true, data: vehicles });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/sourced-vehicles', protect, adminCheck, [
  body('vehicle_number').notEmpty().withMessage('Vehicle number is required'),
  body('vehicle_type').notEmpty().withMessage('Vehicle type is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const vehicle = await partnerService.addSourcedVehicle(partnerId, req.body);
    res.status(201).json({ success: true, message: 'Vehicle added successfully', data: vehicle });
  } catch (error) {
    handleError(res, error);
  }
});

router.put('/sourced-vehicles/:vehicleId', protect, adminCheck, async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ success: false, message: 'Invalid vehicle ID' });

    const vehicle = await partnerService.updateSourcedVehicle(vehicleId, req.body);
    res.json({ success: true, message: 'Vehicle updated successfully', data: vehicle });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/sourced-vehicles/:vehicleId', protect, adminCheck, async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ success: false, message: 'Invalid vehicle ID' });

    await partnerService.removeSourcedVehicle(vehicleId);
    res.json({ success: true, message: 'Vehicle removed from partner' });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// LEDGER
// ============================

router.get('/:id/ledger', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.getLedger(partnerId, req.query);
    res.json({ success: true, data: result.entries, summary: result.summary, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/ledger', protect, adminCheck, [
  body('transaction_type').isIn([
    'booking_income', 'commission', 'fuel_advance', 'driver_advance',
    'toll', 'repair', 'penalty', 'bonus', 'cash', 'online_transfer', 'other_expense',
  ]).withMessage('Valid transaction type required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('type').isIn(['debit', 'credit']).withMessage('Type must be debit or credit'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const entry = await partnerService.recordTransaction(partnerId, {
      ...req.body,
      amount: parseFloat(req.body.amount),
      created_by: req.user.user_id,
    });

    res.status(201).json({ success: true, message: 'Transaction recorded successfully', data: entry });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/ledger/reversal', protect, adminCheck, [
  body('original_transaction_id').notEmpty().withMessage('Original transaction ID is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const entry = await partnerService.recordReversal(partnerId, req.body.original_transaction_id, {
      remarks: req.body.remarks,
      created_by: req.user.user_id,
    });

    res.status(201).json({ success: true, message: 'Reversal recorded successfully', data: entry });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// PAYMENTS
// ============================

router.get('/:id/payments', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.getPayments(partnerId, req.query);
    res.json({ success: true, data: result.payments, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/payments', protect, adminCheck, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('payment_method').isIn(['cash', 'bank_transfer', 'upi', 'cheque']).withMessage('Valid payment method required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const payment = await partnerService.recordPayment(partnerId, {
      ...req.body,
      amount: parseFloat(req.body.amount),
      created_by: req.user.user_id,
    });

    res.status(201).json({ success: true, message: 'Payment recorded successfully', data: payment });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// SETTLEMENTS
// ============================

router.get('/:id/settlements', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.getSettlements(partnerId, req.query);
    res.json({ success: true, data: result.settlements, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// DOCUMENTS
// ============================

router.get('/:id/documents', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const documents = await partnerService.getDocuments(partnerId);
    res.json({ success: true, data: documents });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/documents', protect, adminCheck, [
  body('document_type').isIn(['gst', 'pan', 'aadhaar', 'rc', 'insurance', 'bank_details', 'other']).withMessage('Valid document type required'),
  body('document_name').notEmpty().withMessage('Document name is required'),
  body('file_url').notEmpty().withMessage('File URL is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const doc = await partnerService.uploadDocument(partnerId, {
      ...req.body,
      uploaded_by: req.user.user_id,
    });

    res.status(201).json({ success: true, message: 'Document uploaded successfully', data: doc });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/:id/documents/:docId', protect, adminCheck, async (req, res) => {
  try {
    const docId = parseInt(req.params.docId);
    if (isNaN(docId)) return res.status(400).json({ success: false, message: 'Invalid document ID' });

    await partnerService.deleteDocument(docId);
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// DRIVER ASSIGNMENT
// ============================

router.get('/:id/drivers', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const drivers = await partnerService.getPartnerDrivers(partnerId);
    res.json({ success: true, data: drivers });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/assign-driver', protect, adminCheck, [
  body('driver_id').isInt({ min: 1 }).withMessage('Valid driver_id is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.assignDriverToPartner(parseInt(req.body.driver_id), partnerId, req.user.user_id);
    res.json({ success: true, message: 'Driver assigned to partner successfully', data: result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/unassign-driver', protect, adminCheck, [
  body('driver_id').isInt({ min: 1 }).withMessage('Valid driver_id is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    await partnerService.unassignDriverFromPartner(parseInt(req.body.driver_id), partnerId);
    res.json({ success: true, message: 'Driver unassigned from partner' });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// OWNER MODULE ENHANCEMENTS
// ============================

// Get today's assigned trips
router.get('/today-trips', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = req.query.partner_id ? parseInt(req.query.partner_id) : null;
    const count = await partnerService.getTodayAssignedTrips(partnerId);
    res.json({ success: true, data: { todayAssignedTrips: count } });
  } catch (error) {
    handleError(res, error);
  }
});

// Get owner bookings (with status filter)
router.get('/:id/bookings', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const result = await partnerService.getOwnerBookings(partnerId, req.query);
    res.json({ success: true, data: result.bookings, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

// Get commission summary
router.get('/:id/commission', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) return res.status(400).json({ success: false, message: 'Invalid partner ID' });

    const summary = await partnerService.getCommissionSummary(partnerId);
    if (!summary) return res.status(404).json({ success: false, message: 'Partner not found' });

    res.json({ success: true, data: summary });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// VEHICLE OWNER LINKING
// ============================

// Link an existing VehicleOwner to this Partner
router.post('/:id/link-vehicle-owner', protect, adminCheck, [
  body('vehicle_owner_id').isInt({ min: 1 }).withMessage('Valid vehicle_owner_id is required'),
], handleValidation, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    const vehicleOwnerId = parseInt(req.body.vehicle_owner_id);
    if (isNaN(partnerId) || isNaN(vehicleOwnerId)) {
      return res.status(400).json({ success: false, message: 'Invalid partner ID or vehicle owner ID' });
    }

    const result = await partnerService.linkVehicleOwnerToPartner(partnerId, vehicleOwnerId);
    res.json({ success: true, message: 'Vehicle Owner linked to Partner successfully', data: result });
  } catch (error) {
    handleError(res, error);
  }
});

// Create a VehicleOwner from an existing Partner
router.post('/:id/create-vehicle-owner', protect, adminCheck, async (req, res) => {
  try {
    const partnerId = parseInt(req.params.id);
    if (isNaN(partnerId)) {
      return res.status(400).json({ success: false, message: 'Invalid partner ID' });
    }

    const result = await partnerService.createVehicleOwnerFromPartner(partnerId);
    res.status(201).json({ success: true, message: 'Vehicle Owner created from Partner successfully', data: result });
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
