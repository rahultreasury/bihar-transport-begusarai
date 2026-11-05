/**
 * Client Routes - Admin
 * CRUD for offline corporate clients.
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const ClientService = require('../services/ClientService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const clientService = new ClientService();
const canonicalFinancialService = new CanonicalFinancialService();

// Admin access middleware
const adminCheck = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'operator') {
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
  console.error('Client route error:', error);
  if (error.code === 'CLIENT_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  if (error.code === 'P2002') {
    return res.status(400).json({ success: false, message: 'A client with this phone or company name already exists' });
  }
  // Handle ValidationError for "Client not found" - return 404
  if (error.name === 'ValidationError' && error.message === 'Client not found') {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }
  res.status(500).json({ success: false, message: error.message || defaultMsg });
};

// ============================
// CLIENT CRUD
// ============================

// List clients with financial summary
router.get('/', protect, adminCheck, async (req, res) => {
  try {
    const result = await clientService.listClients(req.query);

    // Enrich with financial data
    const clientsWithFinancials = await Promise.all(
      result.clients.map(async (client) => {
        try {
          const financials = await canonicalFinancialService.calculateClientFinancials(client.client_id);
          return {
            ...client,
            financials: {
              totalTrips: financials.totalTrips,
              activeTrips: financials.activeTrips,
              totalFreight: financials.totalFreight,
              totalPaid: financials.totalPaid,
              totalOutstanding: financials.totalOutstanding,
              paymentStatus: financials.paymentStatus,
            },
          };
        } catch {
          return {
            ...client,
            financials: {
              totalTrips: 0,
              activeTrips: 0,
              totalFreight: 0,
              totalPaid: 0,
              totalOutstanding: 0,
              paymentStatus: 'PENDING',
            },
          };
        }
      })
    );

    res.json({ success: true, data: clientsWithFinancials, pagination: result.pagination });
  } catch (error) {
    handleError(res, error);
  }
});

// Get client by ID with financial summary
router.get('/:id', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const client = await clientService.getClientProfile(clientId);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Get financial summary
    const financials = await canonicalFinancialService.calculateClientFinancials(clientId);

    res.json({
      success: true,
      data: {
        ...client,
        financials,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Get client statement
router.get('/:id/statement', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const statement = await canonicalFinancialService.getClientStatement(clientId);

    res.json({
      success: true,
      data: statement,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Get client trips with financials
router.get('/:id/trips', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const trips = await canonicalFinancialService.prisma.trip.findMany({
      where: { client_id: clientId },
      include: {
        financialTransactions: true,
        driver: { select: { driver_id: true, driver_name: true } },
        transportOwner: { select: { owner_id: true, owner_name: true } },
        vehicle: { select: { vehicle_id: true, vehicle_number: true } },
      },
      orderBy: { trip_date: 'desc' },
    });

    const tripsWithFinancials = trips.map((trip) => {
      const financials = canonicalFinancialService._computeTripFinancials(trip);
      return {
        tripId: trip.trip_id,
        tripNumber: trip.trip_number,
        status: trip.status,
        tripDate: trip.trip_date,
        route: `${trip.pickup_city} → ${trip.drop_city}`,
        vehicle: trip.vehicle?.vehicle_number || '-',
        driver: trip.driver?.driver_name || '-',
        owner: trip.transportOwner?.owner_name || '-',
        freight: financials.freight,
        paid: financials.customerCollected,
        due: financials.customerDue,
        paymentStatus: financials.customerPaymentStatus,
      };
    });

    res.json({
      success: true,
      data: tripsWithFinancials,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Create client
router.post('/', protect, adminCheck, [
  body('company_name').trim().notEmpty().withMessage('Company name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('contact_person').optional().trim(),
  body('email').optional().trim().isEmail().withMessage('Valid email is required'),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('gst_number').optional().trim(),
  body('pan_number').optional().trim(),
  body('bank_account').optional().trim(),
  body('bank_ifsc').optional().trim(),
  body('bank_name').optional().trim(),
  body('upi_id').optional().trim(),
  body('status').optional().isIn(['active', 'inactive', 'suspended']).withMessage('Valid status is required'),
  body('notes').optional().trim(),
], handleValidation, async (req, res) => {
  try {
    const client = await clientService.createClient(req.body);
    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: client,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Update client
router.put('/:id', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const client = await clientService.updateClient(clientId, req.body);
    res.json({
      success: true,
      message: 'Client updated successfully',
      data: client,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Deactivate client
router.patch('/:id/deactivate', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const client = await clientService.deactivateClient(clientId);
    res.json({
      success: true,
      message: 'Client deactivated successfully',
      data: client,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// Reactivate client
router.patch('/:id/reactivate', protect, adminCheck, async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) return res.status(400).json({ success: false, message: 'Invalid client ID' });

    const client = await clientService.reactivateClient(clientId);
    res.json({
      success: true,
      message: 'Client reactivated successfully',
      data: client,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================
// CLIENT LOOKUP (for trip creation)
// ============================

// Search clients for trip creation
router.get('/lookup/search', protect, async (req, res) => {
  try {
    const search = req.query.search || '';
    const clients = await clientService.searchForLookup(search);
    res.json({ success: true, data: clients });
  } catch (error) {
    console.error('Client lookup error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

module.exports = router;
