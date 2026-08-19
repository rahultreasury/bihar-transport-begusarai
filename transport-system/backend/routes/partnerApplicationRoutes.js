/**
 * Partner Application Routes
 * Public application submission + Admin review/approval/rejection
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { protect } = require('../middleware/auth');
const { prisma } = require('../config/prisma');
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
  console.error('Partner application route error:', error);
  if (error.code === 'P2002') {
    return res.status(400).json({ success: false, message: 'A partner with this mobile or email already exists' });
  }
  res.status(500).json({ success: false, message: error.message || defaultMsg });
};

// ============================
// PUBLIC APPLICATION ENDPOINTS
// ============================

// @route   POST /api/partner/apply
// @desc    Submit a new partner application (public)
// @access  Public
router.post('/apply', [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('partnership_type').isIn(['vehicle_owner', 'transport_owner']).withMessage('Valid partnership type is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
], handleValidation, async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      password,
      partnership_type,
      company_name,
      gst_number,
      pan_number,
      city,
      state,
      address,
      vehicle_number,
      vehicle_type,
      number_of_vehicles,
      available_capacity,
      network_locations,
    } = req.body;

    // Check if application already exists
    const existingApp = await prisma.partnerApplication.findFirst({
      where: {
        OR: [
          { email: email },
          { phone: phone },
        ],
        status: { in: ['pending', 'approved'] },
      },
    });

    if (existingApp) {
      return res.status(400).json({
        success: false,
        message: 'An application with this email or phone already exists',
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Generate application code
    const lastApp = await prisma.partnerApplication.findFirst({
      orderBy: { application_code: 'desc' },
      select: { application_code: true },
    });
    let nextNum = 1;
    if (lastApp && lastApp.application_code) {
      const match = lastApp.application_code.match(/PPA-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    const applicationCode = `PPA-${String(nextNum).padStart(6, '0')}`;

    // Create application
    const application = await prisma.partnerApplication.create({
      data: {
        application_code: applicationCode,
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        partnership_type,
        company_name: company_name || null,
        gst_number: gst_number || null,
        pan_number: pan_number || null,
        city,
        state: state || 'Bihar',
        address: address || null,
        vehicle_number: vehicle_number || null,
        vehicle_type: vehicle_type || null,
        number_of_vehicles: number_of_vehicles ? parseInt(number_of_vehicles) : null,
        available_capacity: available_capacity || null,
        network_locations: network_locations || null,
        status: 'pending',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully. Our team will review it shortly.',
      data: {
        application_id: application.application_id,
        application_code: application.application_code,
        status: application.status,
      },
    });
  } catch (error) {
    console.error('Submit partner application error:', error);
    handleError(res, error);
  }
});

// @route   GET /api/partner/apply/:id/status
// @desc    Check application status (public)
// @access  Public
router.get('/apply/:id/status', async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    const application = await prisma.partnerApplication.findUnique({
      where: { application_id: applicationId },
      select: {
        application_id: true,
        application_code: true,
        status: true,
        reviewed_at: true,
        rejection_reason: true,
        partner_id: true,
        user_id: true,
      },
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    res.json({ success: true, data: application });
  } catch (error) {
    console.error('Get application status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================
// ADMIN APPLICATION ENDPOINTS
// ============================

// @route   GET /api/admin/partner-applications
// @desc    List all partner applications (admin)
// @access  Private (Admin)
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const { status, partnership_type, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status && status !== 'all') {
      where.status = status;
    }
    if (partnership_type && partnership_type !== 'all') {
      where.partnership_type = partnership_type;
    }

    const [applications, total] = await Promise.all([
      prisma.partnerApplication.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
        select: {
          application_id: true,
          application_code: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          partnership_type: true,
          company_name: true,
          city: true,
          state: true,
          vehicle_number: true,
          vehicle_type: true,
          number_of_vehicles: true,
          status: true,
          reviewed_by: true,
          reviewed_at: true,
          rejection_reason: true,
          admin_notes: true,
          partner_id: true,
          user_id: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.partnerApplication.count({ where }),
    ]);

    res.json({
      success: true,
      data: applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('List partner applications error:', error);
    handleError(res, error);
  }
});

// @route   GET /api/admin/partner-applications/:id
// @desc    Get single application details (admin)
// @access  Private (Admin)
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    const application = await prisma.partnerApplication.findUnique({
      where: { application_id: applicationId },
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    res.json({ success: true, data: application });
  } catch (error) {
    console.error('Get application details error:', error);
    handleError(res, error);
  }
});

// @route   POST /api/admin/partner-applications/:id/approve
// @desc    Approve a partner application (admin)
// @access  Private (Admin)
router.post('/:id/approve', protect, adminCheck, [
  body('admin_notes').optional().trim(),
], handleValidation, async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    const application = await prisma.partnerApplication.findUnique({
      where: { application_id: applicationId },
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Application is already ${application.status}` });
    }

    const { admin_notes } = req.body;

    // Create User account
    const newUser = await prisma.user.create({
      data: {
        first_name: application.first_name,
        last_name: application.last_name,
        email: application.email,
        phone: application.phone,
        password_hash: application.password_hash,
        address: application.address,
        city: application.city,
        state: application.state || 'Bihar',
        role: 'partner',
        is_active: true,
      },
      select: { user_id: true },
    });

    const user_id = newUser.user_id;

    let partner_id = null;
    let vehicle_owner_id = null;

    if (application.partnership_type === 'vehicle_owner') {
      // Create VehicleOwner record
      const vehicleOwner = await prisma.vehicleOwner.create({
        data: {
          owner_name: `${application.first_name} ${application.last_name}`,
          company_name: application.company_name,
          email: application.email,
          mobile: application.phone,
          city: application.city,
          state: application.state || 'Bihar',
          address: application.address,
          gst_number: application.gst_number,
          pan_number: application.pan_number,
          available_capacity: application.available_capacity,
          network_locations: application.network_locations,
          is_active: true,
        },
        select: { vehicle_owner_id: true },
      });
      vehicle_owner_id = vehicleOwner.vehicle_owner_id;
    } else {
      // Create Partner record (transport_owner or other)
      const partner = await partnerService.registerPartner({
        owner_name: `${application.first_name} ${application.last_name}`,
        partner_name: `${application.first_name} ${application.last_name}`,
        company_name: application.company_name,
        email: application.email,
        mobile: application.phone,
        city: application.city,
        state: application.state || 'Bihar',
        gst_number: application.gst_number,
        pan_number: application.pan_number,
        address: application.address,
        commission_percentage: 10,
        available_capacity: application.available_capacity,
        network_locations: application.network_locations,
      });
      partner_id = partner.partner_id;
    }

    // Update application
    const updatedApplication = await prisma.partnerApplication.update({
      where: { application_id: applicationId },
      data: {
        status: 'approved',
        reviewed_by: req.user.user_id,
        reviewed_at: new Date(),
        admin_notes: admin_notes || null,
        partner_id: partner_id,
        vehicle_owner_id: vehicle_owner_id,
        user_id: user_id,
      },
    });

    // TODO: Send email/SMS notification to applicant with login credentials

    res.json({
      success: true,
      message: application.partnership_type === 'vehicle_owner'
        ? 'Application approved. Vehicle Owner account created.'
        : 'Application approved. Partner account created.',
      data: {
        application_id: updatedApplication.application_id,
        application_code: updatedApplication.application_code,
        status: updatedApplication.status,
        partnership_type: application.partnership_type,
        partner_id: partner_id,
        vehicle_owner_id: vehicle_owner_id,
        user_id: user_id,
      },
    });
  } catch (error) {
    console.error('Approve application error:', error);
    handleError(res, error);
  }
});

// @route   POST /api/admin/partner-applications/:id/reject
// @desc    Reject a partner application (admin)
// @access  Private (Admin)
router.post('/:id/reject', protect, adminCheck, [
  body('rejection_reason').trim().notEmpty().withMessage('Rejection reason is required'),
], handleValidation, async (req, res) => {
  try {
    const applicationId = parseInt(req.params.id);
    if (isNaN(applicationId)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    const application = await prisma.partnerApplication.findUnique({
      where: { application_id: applicationId },
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Application is already ${application.status}` });
    }

    const { rejection_reason, admin_notes } = req.body;

    const updatedApplication = await prisma.partnerApplication.update({
      where: { application_id: applicationId },
      data: {
        status: 'rejected',
        reviewed_by: req.user.user_id,
        reviewed_at: new Date(),
        rejection_reason,
        admin_notes: admin_notes || null,
      },
    });

    // TODO: Send email/SMS notification to applicant about rejection

    res.json({
      success: true,
      message: 'Application rejected.',
      data: {
        application_id: updatedApplication.application_id,
        application_code: updatedApplication.application_code,
        status: updatedApplication.status,
        rejection_reason: updatedApplication.rejection_reason,
      },
    });
  } catch (error) {
    console.error('Reject application error:', error);
    handleError(res, error);
  }
});

module.exports = router;
