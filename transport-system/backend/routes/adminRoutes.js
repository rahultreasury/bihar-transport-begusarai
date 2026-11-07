const express = require('express');
const router = express.Router();
const { protect, adminOnly, isDatabaseConnectionError } = require('../middleware/auth');
const { prisma } = require('../config/prisma');

const BookingService = require('../services/BookingService');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const BookingAssignmentService = require('../services/BookingAssignmentService');
const { createBookingController } = require('../controllers/bookingController');
const { BookingDeletionService } = require('../services/BookingDeletionService');
const VehicleOwnerService = require('../services/VehicleOwnerService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const TripProvisioningService = require('../services/TripProvisioningService');

const bookingService = new BookingService();
const bookingAssignmentService = new BookingAssignmentService();
const bookingController = createBookingController();
const vehicleOwnerService = new VehicleOwnerService();

const ACTIVE_TRIP_STATUSES = ['PENDING', 'ASSIGNED', 'WAITING_FOR_VEHICLE', 'VEHICLE_HIRED', 'WAITING_FOR_LOADING', 'LOADING', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERED', 'POD_SUBMITTED', 'POD_VERIFIED'];

const VEHICLE_STATUS_FILTERS = {
  available: {
    OR: [
      { current_status: 'available' },
      { current_status: null, is_available: true },
      { current_status: '', is_available: true },
    ],
    AND: [
      {
        trips: {
          none: {
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        },
      },
    ],
  },
  on_trip: {
    trips: {
      some: {
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    },
  },
  assigned: { current_status: 'assigned' },
  maintenance: { current_status: 'maintenance' },
  inactive: {
    OR: [
      { current_status: 'inactive' },
      { current_status: null, is_available: false },
      { current_status: '', is_available: false },
    ],
  },
};

const getVehicleStatusWhere = (status) => {
  if (status === 'on_trip') {
    return {
      trips: {
        some: {
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      },
    };
  }
  return VEHICLE_STATUS_FILTERS[status] || null;
};

const getDocumentStatusWhere = (documentStatus) => {
  const today = new Date();
  const expiringAt = new Date(today);
  expiringAt.setDate(today.getDate() + 30);
  // Expiry fields are stored as strings in TransportVehicle. Compare on the
  // date part only so both "YYYY-MM-DD" and full ISO timestamps behave the
  // same way.
  const todayValue = today.toISOString().slice(0, 10);
  const expiringAtValue = expiringAt.toISOString().slice(0, 10);

  // These are the documents the hire gate treats as critical. National
  // permit is conditional: it only counts when the vehicle actually holds
  // one (an intra-state truck is not required to have it).
  const CRITICAL_EXPIRY_FIELDS = ['insurance_expiry', 'fitness_expiry', 'permit_expiry'];

  const after = (field, value) => ({
    AND: [
      { [field]: { not: null } },
      { [field]: { not: '' } },
      { [field]: { gt: value } },
    ],
  });
  const onOrBefore = (field, value) => ({
    AND: [
      { [field]: { not: null } },
      { [field]: { not: '' } },
      { [field]: { lte: value } },
    ],
  });
  const between = (field, from, to) => ({
    AND: [
      { [field]: { not: null } },
      { [field]: { not: '' } },
      { [field]: { gt: from } },
      { [field]: { lte: to } },
    ],
  });
  const isMissing = (field) => ({
    OR: [{ [field]: null }, { [field]: '' }],
  });
  const nationalPermitHeld = {
    AND: [
      { national_permit_number: { not: null } },
      { national_permit_number: { not: '' } },
    ],
  };

  if (documentStatus === 'valid') {
    return {
      AND: [
        ...CRITICAL_EXPIRY_FIELDS.map((field) => after(field, expiringAtValue)),
        {
          OR: [
            { national_permit_number: null },
            { national_permit_number: '' },
            {
              AND: [
                { national_permit_expiry: { not: null } },
                { national_permit_expiry: { not: '' } },
                { national_permit_expiry: { gt: expiringAtValue } },
              ],
            },
          ],
        },
      ],
    };
  }

  if (documentStatus === 'expiring') {
    return {
      AND: [
        // Every critical document must currently be valid (not expired and
        // not missing) for the vehicle to be classified as "expiring".
        ...CRITICAL_EXPIRY_FIELDS.map((field) => after(field, todayValue)),
        {
          OR: [
            ...CRITICAL_EXPIRY_FIELDS.map((field) => between(field, todayValue, expiringAtValue)),
            {
              AND: [
                nationalPermitHeld,
                { national_permit_expiry: { gt: todayValue } },
                { national_permit_expiry: { lte: expiringAtValue } },
              ],
            },
          ],
        },
      ],
    };
  }

  if (documentStatus === 'expired') {
    return {
      OR: [
        ...CRITICAL_EXPIRY_FIELDS.map((field) => onOrBefore(field, todayValue)),
        {
          AND: [
            nationalPermitHeld,
            { national_permit_expiry: { not: null } },
            { national_permit_expiry: { not: '' } },
            { national_permit_expiry: { lte: todayValue } },
          ],
        },
      ],
    };
  }

  if (documentStatus === 'missing') {
    return {
      OR: [
        ...CRITICAL_EXPIRY_FIELDS.map((field) => isMissing(field)),
        {
          AND: [
            nationalPermitHeld,
            { OR: [{ national_permit_expiry: null }, { national_permit_expiry: '' }] },
          ],
        },
      ],
    };
  }

  return null;
};

const CRITICAL_DOCUMENTS = [
  { key: 'insurance', numberField: 'insurance_number', expiryField: 'insurance_expiry', label: 'Insurance' },
  { key: 'fitness', numberField: 'fitness_number', expiryField: 'fitness_expiry', label: 'Fitness' },
  { key: 'permit', numberField: 'permit_number', expiryField: 'permit_expiry', label: 'Permit' },
];

/**
 * Compute the per-document state and the aggregate status for one vehicle.
 * Returns: valid | expiring | expired | missing.
 * National permit is conditional on the vehicle holding one.
 */
const computeDocumentStatus = (vehicle, now = new Date()) => {
  if (!vehicle) return { status: 'missing', documents: [] };

  const todayValue = now.toISOString().slice(0, 10);
  const expiringAt = new Date(now);
  expiringAt.setDate(now.getDate() + 30);
  const expiringAtValue = expiringAt.toISOString().slice(0, 10);

  const documents = CRITICAL_DOCUMENTS.map((doc) => {
    const expiry = vehicle[doc.expiryField] ? String(vehicle[doc.expiryField]).slice(0, 10) : null;
    let status = 'missing';
    if (expiry) {
      if (expiry <= todayValue) status = 'expired';
      else if (expiry <= expiringAtValue) status = 'expiring';
      else status = 'valid';
    }
    return {
      key: doc.key,
      label: doc.label,
      document_number: vehicle[doc.numberField] || null,
      expiry_date: expiry,
      status,
    };
  });

  // Conditional national permit: only evaluated when a number or expiry exists.
  if (vehicle.national_permit_number || vehicle.national_permit_expiry) {
    const expiry = vehicle.national_permit_expiry
      ? String(vehicle.national_permit_expiry).slice(0, 10)
      : null;
    let status = 'missing';
    if (expiry) {
      if (expiry <= todayValue) status = 'expired';
      else if (expiry <= expiringAtValue) status = 'expiring';
      else status = 'valid';
    }
    documents.push({
      key: 'national_permit',
      label: 'National Permit',
      document_number: vehicle.national_permit_number || null,
      expiry_date: expiry,
      status,
    });
  }

  const rank = { missing: 4, expired: 3, expiring: 2, valid: 1 };
  const worst = documents.reduce(
    (acc, doc) => (rank[doc.status] > rank[acc] ? doc.status : acc),
    'valid'
  );

  return { status: worst, documents };
};

const parsePositiveInt = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const mapDomainErrorToHttp = (err, res) => {
  if (err?.name === 'ValidationError' || err?.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ success: false, message: err?.message || 'Validation failed', errorCode: err?.code });
  }
  if (err?.name === 'NotFoundError' || err?.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, message: err?.message || 'Not found', errorCode: err?.code });
  }
  if (['DRIVER_NOT_FOUND', 'VEHICLE_NOT_FOUND', 'VEHICLE_OWNER_NOT_FOUND'].includes(err?.code)) {
    return res.status(404).json({ success: false, message: err?.message || 'Not found', errorCode: err?.code });
  }
  if ([
    'VEHICLE_ALREADY_EXISTS',
    'DRIVER_ALREADY_EXISTS',
    'DRIVER_LICENSE_EXISTS',
    'DRIVER_OWNER_MISMATCH',
    'DRIVER_PARTNER_MISMATCH',
    'DRIVER_HAS_ACTIVE_TRIP',
    'DRIVER_INACTIVE',
    'VEHICLE_ALREADY_ASSIGNED',
    'VEHICLE_NOT_ASSIGNABLE',
    'VEHICLE_OWNER_MISMATCH',
    'VEHICLE_DRIVER_CONFLICT',
  ].includes(err?.code)) {
    return res.status(409).json({
      success: false,
      message: err?.message || 'Conflict',
      errorCode: err?.code,
      ...(err?.data ? { data: err.data } : {}),
    });
  }
  if (err?.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target : [];
    if (target.includes('vehicle_number')) {
      return res.status(409).json({
        success: false,
        message: 'A vehicle with this number already exists',
        errorCode: 'VEHICLE_ALREADY_EXISTS',
      });
    }
    return res.status(409).json({
      success: false,
      message: 'Could not complete the operation due to a conflicting unique value.',
    });
  }
  return res.status(500).json({ success: false, message: 'Internal server error' });
};

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard stats
// @access  Private (Admin)
router.get('/dashboard', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get total counts
    const totalUsers = await prisma.user.count({
      where: { role: 'customer' }
    });
    const totalDrivers = await prisma.driver.count();
    const totalVehicles = await prisma.transportVehicle.count();
    const totalBookings = await prisma.booking.count();

    const activeBookingsWhere = { archived_at: null };

    const pendingBookings = await prisma.booking.count({
      where: { ...activeBookingsWhere, status: 'pending' }
    });
    const activeDeliveries = await prisma.booking.count({
      where: { ...activeBookingsWhere, status: { in: ['confirmed', 'in_transit', 'pickup_completed'] } }
    });
    const completedDeliveries = await prisma.booking.count({
      where: { ...activeBookingsWhere, status: { in: ['delivered', 'completed'] } }
    });

    // Get canonical financial metrics from the single source of truth
    const canonicalFinancials = await new CanonicalFinancialService({ prisma }).calculateGlobalFinancials();

    // Get recent bookings with user info
    const recentBookingsRaw = await prisma.booking.findMany({
      take: 10,
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
      },
    });

    const recentBookings = recentBookingsRaw.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      pickup_city: b.pickup_city,
      drop_city: b.drop_city,
      status: b.status,
      final_price: b.final_price,
      created_at: b.created_at,
      first_name: b.user?.first_name ?? null,
      last_name: b.user?.last_name ?? null,
      phone: b.user?.phone ?? null,
    }));

    // Get available drivers with user info
    const availableDriversRaw = await prisma.driver.findMany({
      where: { is_available: true },
      take: 10,
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
      },
    });

    const availableDrivers = availableDriversRaw.map((d) => ({
      driver_id: d.driver_id,
      user_id: d.user_id,
      license_number: d.license_number,
      license_expiry: d.license_expiry,
      profile_image: d.profile_image,
      is_available: d.is_available,
      is_verified: d.is_verified,
      rating: d.rating,
      total_deliveries: d.total_deliveries,
      created_at: d.created_at,
      updated_at: d.updated_at,
      first_name: d.user?.first_name ?? null,
      last_name: d.user?.last_name ?? null,
      phone: d.user?.phone ?? null,
    }));

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalDrivers,
          totalVehicles,
          totalBookings,
          pendingBookings,
          activeDeliveries,
          completedDeliveries,
          // Canonical financial metrics (single source of truth)
          totalFreight: canonicalFinancials.totalFreight || 0,
          totalRevenue: canonicalFinancials.totalReceived || 0,
          todayRevenue: canonicalFinancials.todayCollections || 0,
          totalCommission: canonicalFinancials.totalBtCommission || 0,
          totalBtNetProfit: canonicalFinancials.netPosition || 0,
          outstandingPayments: canonicalFinancials.totalReceivable || 0,
          customerDue: canonicalFinancials.totalReceivable || 0,
          ownerOutstanding: canonicalFinancials.totalOwnerPayable || 0,
          totalAdvances: canonicalFinancials.totalAdvances || 0,
          totalSettlements: canonicalFinancials.totalSettlements || 0,
        },
        recentBookings,
        availableDrivers,
      },
    });
  } catch (error) {
    console.error('Get dashboard error:', error.code || error.name, error.message);
    if (isDatabaseConnectionError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable. Please try again shortly.',
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all customers
// @access  Private (Admin)
router.get('/users', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    // Build Prisma where clause
    const where = {
      role: 'customer',
    };

    if (search) {
      where.OR = [
        { first_name: { contains: search } },
        { last_name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          is_active: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/drivers
// @desc    Get all drivers.
//          Handled exclusively by driverManagementRoutes (single source of truth)
//          mounted at /api/admin/drivers in server.js. This legacy inline handler
//          was removed to (1) eliminate the duplicate/shadowed route and (2) remove
//          direct Prisma access from the route layer (Route → Service → Repository → Prisma).
// @access  Private (Admin)

// @route   GET /api/admin/vehicles/stats
// @desc    Get vehicle statistics (source of truth from DB)
// @access  Private (Admin)
router.get('/vehicles/stats', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Count by the canonical vehicle status. Backward-compat: legacy
    // "assigned" is treated as "on_trip", and nullable legacy rows are
    // classified using is_available when current_status is absent.
    const [total, available, onTrip, maintenance, inactive] = await Promise.all([
      prisma.transportVehicle.count(),
      prisma.transportVehicle.count({ where: getVehicleStatusWhere('available') }),
      prisma.transportVehicle.count({ where: getVehicleStatusWhere('on_trip') }),
      prisma.transportVehicle.count({ where: getVehicleStatusWhere('maintenance') }),
      prisma.transportVehicle.count({ where: getVehicleStatusWhere('inactive') }),
    ]);

    res.json({
      success: true,
      data: { total, available, onTrip, maintenance, inactive },
    });
  } catch (error) {
    console.error('Get vehicle stats error:', error.code || error.name, error.message);
    if (isDatabaseConnectionError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable. Please try again shortly.',
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/vehicles/:id
// @desc    Get vehicle details with owner, driver, and assignment history
// @access  Private (Admin)
router.get('/vehicles/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({ success: false, message: 'Invalid vehicle id' });
    }

    const vehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      include: {
        owner: {
          select: {
            owner_id: true,
            owner_code: true,
            owner_name: true,
            company_name: true,
            mobile: true,
            email: true,
            city: true,
            state: true,
            gst_number: true,
            pan_number: true,
            address: true,
            status: true,
          },
        },
        driver: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        vehicleAssignments: {
          include: {
            driver: {
              include: {
                user: {
                  select: {
                    first_name: true,
                    last_name: true,
                  },
                },
              },
            },
          },
          orderBy: { assigned_at: 'desc' },
          take: 20,
        },
        bookings: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
            driver: {
              include: {
                user: {
                  select: {
                    first_name: true,
                    last_name: true,
                  },
                },
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
    });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    // Flatten the response
    const documentState = computeDocumentStatus(vehicle);
    const response = {
      ...vehicle,
      document_status: documentState.status,
      documents: documentState.documents,
      owner_name: vehicle.owner?.owner_name ?? null,
      owner_phone: vehicle.owner?.mobile ?? null,
      driver_name: vehicle.driver ? `${vehicle.driver.user.first_name} ${vehicle.driver.user.last_name}` : null,
      driver_phone: vehicle.driver?.user?.phone ?? null,
      driver_code: vehicle.driver?.driver_code ?? null,
      assignment_history: vehicle.vehicleAssignments.map(a => ({
        assignment_id: a.assignment_id,
        driver_id: a.driver_id,
        driver_name: a.driver ? `${a.driver.user.first_name} ${a.driver.user.last_name}` : null,
        assigned_by: a.assigned_by,
        assigned_at: a.assigned_at,
        unassigned_at: a.unassigned_at,
        status: a.status,
        notes: a.notes,
      })),
      booking_history: vehicle.bookings.map(b => ({
        booking_id: b.booking_id,
        booking_number: b.booking_number,
        pickup_location: b.pickup_location,
        drop_location: b.drop_location,
        pickup_date: b.pickup_date,
        status: b.status,
        created_at: b.created_at,
        customer: b.user ? `${b.user.first_name} ${b.user.last_name}` : null,
        driver: b.driver ? `${b.driver.user.first_name} ${b.driver.user.last_name}` : null,
      })),
    };

    // Remove the raw Prisma relations from the response
    delete response.owner;
    delete response.driver;
    delete response.vehicleAssignments;
    delete response.bookings;

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Get vehicle detail error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/vehicles
// @desc    Get all vehicles
// @access  Private (Admin)
router.get('/vehicles', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20) || 20, 100);
    const skip = (page - 1) * limit;
    const take = limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const type = String(req.query.type || '').trim();
    const ownerId = parsePositiveInt(req.query.owner_id);
    const driverId = parsePositiveInt(req.query.driver_id);
    const documentStatus = String(req.query.document_status || req.query.doc_status || '').trim().toLowerCase();

    const allowedStatuses = ['available', 'on_trip', 'assigned', 'maintenance', 'inactive'];
    const allowedDocumentStatuses = ['valid', 'expiring', 'expired', 'missing'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid vehicle status: ${status}` });
    }
    if (documentStatus && !allowedDocumentStatuses.includes(documentStatus)) {
      return res.status(400).json({ success: false, message: `Invalid document status: ${documentStatus}` });
    }
    if (req.query.owner_id && !ownerId) {
      return res.status(400).json({ success: false, message: 'Invalid owner id' });
    }
    if (req.query.driver_id && !driverId) {
      return res.status(400).json({ success: false, message: 'Invalid driver id' });
    }

    // Build the Prisma where clause so pagination and totals reflect the
    // exact filters shown in the admin vehicle table.
    const where = {};
    const whereConditions = [];
    if (type) {
      whereConditions.push({ vehicle_type: type });
    }
    const statusWhere = status ? getVehicleStatusWhere(status) : null;
    if (statusWhere) {
      whereConditions.push(statusWhere);
    }
    if (ownerId) {
      whereConditions.push({ owner_id: ownerId });
    }
    if (driverId) {
      whereConditions.push({ driver_id: driverId });
    }
    if (search) {
      whereConditions.push({
        OR: [
          { vehicle_number: { contains: search, mode: 'insensitive' } },
          { vehicle_code: { contains: search, mode: 'insensitive' } },
          { vehicle_name: { contains: search, mode: 'insensitive' } },
          { vehicle_type: { contains: search, mode: 'insensitive' } },
          { base_location: { contains: search, mode: 'insensitive' } },
          { owner: { owner_name: { contains: search, mode: 'insensitive' } } },
          { driver: { driver_name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    const documentWhere = documentStatus ? getDocumentStatusWhere(documentStatus) : null;
    if (documentWhere) {
      whereConditions.push(documentWhere);
    }
    if (whereConditions.length > 0) {
      where.AND = whereConditions;
    }

    const [vehicles, total] = await Promise.all([
      prisma.transportVehicle.findMany({
        where,
        include: {
          owner: {
            select: {
              owner_id: true,
              owner_name: true,
              company_name: true,
              mobile: true,
            },
          },
          driver: {
            include: {
              user: {
                select: {
                  first_name: true,
                  last_name: true,
                  phone: true,
                },
              },
            },
          },
          sourcePartner: {
            select: {
              partner_id: true,
              partner_code: true,
              partner_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.transportVehicle.count({ where }),
    ]);

    // Flatten Prisma result to match the existing admin API response.
    const flattened = vehicles.map((v) => {
      const driver = v.driver;
      const documentState = computeDocumentStatus(v);
      return {
        vehicle_id: v.vehicle_id,
        driver_id: v.driver_id,
        owner_id: v.owner_id,
        partner_id: v.partner_id,
        vehicle_number: v.vehicle_number,
        vehicle_type: v.vehicle_type,
        vehicle_name: v.vehicle_name,
        capacity_kg: v.capacity_kg,
        capacity_volume: v.capacity_volume,
        vehicle_make: v.vehicle_make,
        vehicle_model: v.vehicle_model,
        manufacturing_year: v.manufacturing_year,
        registration_date: v.registration_date,
        insurance_number: v.insurance_number,
        insurance_expiry: v.insurance_expiry,
        permit_number: v.permit_number,
        permit_expiry: v.permit_expiry,
        pollution_certificate: v.pollution_certificate,
        pollution_expiry: v.pollution_expiry,
        tax_number: v.tax_number,
        tax_expiry: v.tax_expiry,
        fitness_number: v.fitness_number,
        fitness_expiry: v.fitness_expiry,
        national_permit_number: v.national_permit_number,
        national_permit_expiry: v.national_permit_expiry,
        document_status: documentState.status,
        documents: documentState.documents,
        is_available: v.is_available,
        is_verified: v.is_verified,
        current_status: v.current_status,
        base_location: v.base_location,
        hourly_rate: v.hourly_rate,
        per_km_rate: v.per_km_rate,
        created_at: v.created_at,
        updated_at: v.updated_at,
        owner_name: v.owner?.owner_name ?? null,
        owner_phone: v.owner?.mobile ?? null,
        partner_name: v.sourcePartner?.partner_name ?? null,
        partner_code: v.sourcePartner?.partner_code ?? null,
        driver_name: driver ? `${driver.user?.first_name || ''} ${driver.user?.last_name || ''}`.trim() : null,
        driver_phone: driver?.user?.phone ?? null,
      };
    });

    res.json({
      success: true,
      data: flattened,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/admin/bookings
// @desc    Get all bookings
// @access  Private (Admin)
// NOTE: The route only delegates to the controller. All query validation,
// authorization, and error handling live in the controller (which forwards
// errors to the centralized error handler via next(error)).
router.get('/bookings', protect, bookingController.listBookings);
router.get('/bookings/lifecycle-counts', protect, bookingController.getLifecycleCounts);
router.get('/bookings/lifecycle-summary', protect, bookingController.getLifecycleSummary);

// @route   POST /api/admin/bookings/:id/send-quote
// @desc    Send a final quote to the customer (Final Transport Charge).
//          Does NOT confirm the booking — waits for customer acceptance.
// @access  Private (Admin)
router.post('/bookings/:id/send-quote', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const { final_price, remarks, driver_id, vehicle_id, quote_validity_hours } = req.body || {};

    // Enterprise workflow: admin reserves a driver + vehicle, sets the Final
    // Transport Charge and a validity window, then sends the quote. The booking
    // is NOT confirmed until the customer accepts.
    const result = await bookingService.sendQuoteWithReservation(bookingId, {
      final_price,
      remarks,
      driver_id,
      vehicle_id,
      quote_validity_hours,
      reserved_by: req.user.user_id,
    });

    return res.json({
      success: true,
      message: 'Quote sent to customer',
      data: {
        booking_id: bookingId,
        final_price: Number(final_price),
        quote_status: 'SENT',
        quote_sent_at: result?.quote_sent_at || new Date(),
        quote_valid_until: result?.quote_valid_until || null,
        quote_remarks: remarks || null,
        driver_id: result?.driver_id || null,
        vehicle_id: result?.vehicle_id || null,
      },
    });
  } catch (err) {
    console.error('Send quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/:id/quote
// @desc    Send a final quote to the customer (only after driver assignment).
//          Uses the already-assigned driver on the booking.
// @access  Private (Admin)
router.post('/bookings/:id/quote', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const { final_price, note } = req.body || {};

    // Validate booking exists and driver is already assigned
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        booking_id: true,
        driver_id: true,
        status: true,
        quote_status: true,
      },
    });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!booking.driver_id) {
      return res.status(400).json({
        success: false,
        message: 'Assign a driver before sending the quote.',
      });
    }

    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot send quote for a booking with status: ${booking.status}`,
      });
    }

    if (booking.quote_status === 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'Quote already accepted for this booking',
      });
    }

    if (booking.quote_status === 'SENT') {
      return res.status(400).json({
        success: false,
        message: 'A quote is already sent and awaiting customer approval.',
      });
    }

    const result = await bookingService.sendQuoteWithReservation(bookingId, {
      final_price,
      remarks: note,
      driver_id: booking.driver_id,
      quote_validity_hours: 24,
      reserved_by: req.user.user_id,
    });

    return res.json({
      success: true,
      message: 'Quote sent to customer',
      data: {
        booking_id: bookingId,
        final_price: Number(final_price),
        quote_status: 'SENT',
        quote_sent_at: result?.quote_sent_at || new Date(),
        quote_valid_until: result?.quote_valid_until || null,
        quote_remarks: note || null,
        driver_id: result?.driver_id || booking.driver_id,
        vehicle_id: result?.vehicle_id || null,
      },
    });
  } catch (err) {
    console.error('Send quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

/**
 * ===============================
 * Enquiry Workflow (6-stage rail)
 * ===============================
 *
 * The admin ENQUIRY workspace is driven by the six stages
 *   Request Received → Under Review → Quote Prepared → Quote Sent
 *   → Customer Accepted → Confirmed
 *
 * Those stages are a PROJECTION of the columns the booking module already
 * owns (bookings.quote_status / bookings.status /
 * bookings.confirmation_source) — there is no second status system. Only the
 * two operations the existing surface genuinely lacked are added here:
 *
 *   POST /bookings/:id/start-review     PENDING → PREPARING
 *   POST /bookings/:id/prepare-quote    → DRIVER_RESERVED (draft, not sent)
 *
 * plus two read helpers the workspace needs. Everything else — send quote,
 * customer accept/reject, confirmation — is called on the endpoints that
 * already existed and was not duplicated.
 */

/** Shared admin gate for the workflow endpoints. */
function requireBookingAdmin(req, res) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
    res.status(403).json({ success: false, message: 'Access denied' });
    return false;
  }
  return true;
}

// @route   POST /api/admin/bookings/:id/start-review
// @desc    STAGE 1 → 2. Move a received enquiry into review.
// @access  Private (Admin)
router.post('/bookings/:id/start-review', protect, async (req, res) => {
  try {
    if (!requireBookingAdmin(req, res)) return;

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const result = await bookingService.startReview(bookingId, { adminId: req.user.user_id });

    return res.json({
      success: true,
      message: result.alreadyInReview
        ? 'This enquiry is already in review.'
        : 'Enquiry moved to Under Review.',
      data: result,
    });
  } catch (err) {
    console.error('Start review error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/:id/prepare-quote
// @desc    STAGE 2 → 3. Persist the driver, resolved vehicle, final price,
//          remarks and validity WITHOUT notifying the customer.
// @access  Private (Admin)
router.post('/bookings/:id/prepare-quote', protect, async (req, res) => {
  try {
    if (!requireBookingAdmin(req, res)) return;

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const { driver_id, vehicle_id, final_price, remarks, quote_validity_hours } = req.body || {};

    const result = await bookingService.prepareQuote(
      bookingId,
      { driver_id, vehicle_id, final_price, remarks, quote_validity_hours },
      { adminId: req.user.user_id }
    );

    return res.json({
      success: true,
      message: 'Quote prepared. Review it, then send it to the customer.',
      data: result,
    });
  } catch (err) {
    console.error('Prepare quote error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   GET /api/admin/bookings/:id/workflow-timeline
// @desc    The real booking_events audit trail, newest first.
// @access  Private (Admin)
router.get('/bookings/:id/workflow-timeline', protect, async (req, res) => {
  try {
    if (!requireBookingAdmin(req, res)) return;

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const events = await bookingService.getWorkflowTimeline(bookingId, {
      limit: req.query.limit,
    });

    return res.json({ success: true, data: events });
  } catch (err) {
    console.error('Workflow timeline error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   GET /api/admin/bookings/:id/trip-draft
// @desc    Resolve a confirmed booking into a ready payload for the EXISTING
//          POST /api/trips. Read-only — it does not create a trip.
// @access  Private (Admin)
router.get('/bookings/:id/trip-draft', protect, async (req, res) => {
  try {
    if (!requireBookingAdmin(req, res)) return;

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const draft = await bookingService.getTripDraft(bookingId);
    return res.json({ success: true, data: draft });
  } catch (err) {
    console.error('Trip draft error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   PUT /api/admin/drivers/:id/verify
// @desc    Verify a driver
// @access  Private (Admin)
router.put('/drivers/:id/verify', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const driverId = parseInt(req.params.id);

    // Verify driver exists before updating
    const existing = await prisma.driver.findUnique({
      where: { driver_id: driverId },
      select: { driver_id: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    await prisma.driver.update({
      where: { driver_id: driverId },
      data: { is_verified: true },
    });

    res.json({
      success: true,
      message: 'Driver verified successfully',
    });
  } catch (error) {
    console.error('Verify driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/admin/vehicles/:id/verify
// @desc    Verify a vehicle
// @access  Private (Admin)
router.put('/vehicles/:id/verify', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vehicleId = parseInt(req.params.id);

    // Verify vehicle exists before updating
    const existing = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: vehicleId },
      select: { vehicle_id: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    await prisma.transportVehicle.update({
      where: { vehicle_id: vehicleId },
      data: { is_verified: true },
    });

    res.json({
      success: true,
      message: 'Vehicle verified successfully',
    });
  } catch (error) {
    console.error('Verify vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/admin/vehicles/:id
// @desc    Get a single vehicle by ID
// @access  Private (Admin)
router.get('/vehicles/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle id'
      });
    }

    const vehicle = await vehicleOwnerService.getVehicleById(vehicleId);

    res.json({
      success: true,
      data: vehicle,
    });
  } catch (error) {
    console.error('Get vehicle error:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: error.message || 'Vehicle not found',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   POST /api/admin/vehicles
// @desc    Create a standalone vehicle (without owner)
// @access  Private (Admin)
router.post('/vehicles', protect, async (req, res) => {
try {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  const vehicle = await vehicleOwnerService.createStandaloneVehicle(req.body);

  res.status(201).json({
    success: true,
    message: 'Vehicle created successfully',
    data: vehicle,
  });
} catch (error) {
  console.error('Create standalone vehicle error:', error);
  if (error.code === 'VEHICLE_ALREADY_EXISTS') {
    return res.status(409).json({ success: false, message: error.message, data: error.data });
  }
  return mapDomainErrorToHttp(error, res);
}
});

// @route   PUT /api/admin/vehicles/:id
// @desc    Update a vehicle
// @access  Private (Admin)
router.put('/vehicles/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle id'
      });
    }

    const updated = await vehicleOwnerService.updateVehicle(vehicleId, req.body);

    res.json({
      success: true,
      message: 'Vehicle updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update vehicle error:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: error.message || 'Vehicle not found',
      });
    }
    if (error.code === 'VEHICLE_ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        message: error.message || 'Vehicle number already exists',
        errorCode: error.code,
        ...(error.data ? { data: error.data } : {}),
      });
    }
    return mapDomainErrorToHttp(error, res);
  }
});

// @route   POST /api/admin/vehicles/:id/assign-driver
// @desc    Assign a driver to a vehicle
// @access  Private (Admin)
router.post('/vehicles/:id/assign-driver', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({ success: false, message: 'Invalid vehicle id' });
    }

    const { driver_id } = req.body;
    if (!driver_id || isNaN(parseInt(driver_id))) {
      return res.status(400).json({ success: false, message: 'Valid driver_id is required' });
    }

    const driverId = parseInt(driver_id);
    const updatedVehicle = await vehicleOwnerService.assignDriverToVehicle(vehicleId, driverId);

    res.json({
      success: true,
      message: 'Driver assigned to vehicle successfully',
      data: updatedVehicle,
    });
  } catch (error) {
    console.error('Assign driver to vehicle error:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message || 'Vehicle not found' });
    }
    return mapDomainErrorToHttp(error, res);
  }
});

// @route   POST /api/admin/vehicles/:id/remove-driver
// @desc    Remove driver from a vehicle
// @access  Private (Admin)
router.post('/vehicles/:id/remove-driver', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({ success: false, message: 'Invalid vehicle id' });
    }

    const updatedVehicle = await vehicleOwnerService.removeDriverFromVehicle(vehicleId);

    res.json({
      success: true,
      message: 'Driver removed from vehicle successfully',
      data: updatedVehicle,
    });
  } catch (error) {
    console.error('Remove driver from vehicle error:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message || 'Vehicle not found' });
    }
    return mapDomainErrorToHttp(error, res);
  }
});

// @route   POST /api/admin/drivers/:id/assign-vehicle
// @desc    Assign a vehicle to a driver
// @access  Private (Admin)
router.post('/drivers/:id/assign-vehicle', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const driverId = parseInt(req.params.id);
    if (!Number.isFinite(driverId)) {
      return res.status(400).json({ success: false, message: 'Invalid driver id' });
    }

    const { vehicle_id } = req.body;
    if (!vehicle_id || isNaN(parseInt(vehicle_id))) {
      return res.status(400).json({ success: false, message: 'Valid vehicle_id is required' });
    }

    const vehicleId = parseInt(vehicle_id);
    const updatedVehicle = await vehicleOwnerService.assignDriverToVehicle(vehicleId, driverId);

    res.json({
      success: true,
      message: 'Vehicle assigned to driver successfully',
      data: updatedVehicle,
    });
  } catch (error) {
    console.error('Assign vehicle to driver error:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message || 'Vehicle not found' });
    }
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   GET /api/admin/partners/:id/vehicles
// @desc    Get all vehicles for a specific partner
// @access  Private (Admin)
router.get('/partners/:id/vehicles', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const partnerId = parseInt(req.params.id);
    if (!Number.isFinite(partnerId)) {
      return res.status(400).json({ success: false, message: 'Invalid partner id' });
    }

    const result = await vehicleOwnerService.getPartnerVehicles(partnerId, req.query);

    res.json({
      success: true,
      data: result.vehicles,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Get partner vehicles error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   GET /api/admin/vehicles/:id/trips
// @desc    Get trip history for a vehicle with financial summary
// @access  Private (Admin)
router.get('/vehicles/:id/trips', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const vehicleId = parseInt(req.params.id);
    if (!Number.isFinite(vehicleId)) {
      return res.status(400).json({ success: false, message: 'Invalid vehicle id' });
    }

    const { limit = 50, offset = 0 } = req.query;

    // Get bookings for this vehicle with related data
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: { vehicle_id: vehicleId },
        include: {
          customer: {
            include: { user: { select: { first_name: true, last_name: true, phone: true, email: true } } }
          },
          driver: {
            include: { user: { select: { first_name: true, last_name: true } } }
          },
          transportOwner: {
            include: { user: { select: { first_name: true, last_name: true } } }
          },
          tripFinancial: true,
          commissionRecord: true,
          _count: { select: { advances: true, settlements: true } }
        },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.booking.count({ where: { vehicle_id: vehicleId } }),
    ]);

    // Flatten and enrich with financial data
    const trips = bookings.map(b => {
      const financial = b.tripFinancial;
      const commission = b.commissionRecord;
      const totalAdvances = b.advances?.reduce((sum, a) => sum + Number(a.amount), 0) || 0;
      const totalSettlements = b.settlements?.reduce((sum, s) => sum + Number(s.amount), 0) || 0;

      return {
        booking_id: b.booking_id,
        booking_number: b.booking_number,
        pickup_location: b.pickup_location || b.pickup_city,
        drop_location: b.drop_location || b.drop_city,
        pickup_date: b.pickup_date,
        status: b.status,
        quote_status: b.quote_status,
        created_at: b.created_at,
        customer: b.customer ? {
          name: `${b.customer.user.first_name} ${b.customer.user.last_name}`,
          phone: b.customer.user.phone,
          email: b.customer.user.email,
        } : null,
        driver: b.driver ? {
          name: `${b.driver.user.first_name} ${b.driver.user.last_name}`,
          driver_id: b.driver.driver_id,
        } : null,
        transportOwner: b.transportOwner ? {
          name: `${b.transportOwner.user.first_name} ${b.transportOwner.user.last_name}`,
          owner_id: b.transportOwner.owner_id,
        } : null,
        // Financial summary (ADMIN view - full data)
        financial: financial ? {
          customer_fare: financial.customer_fare,
          driver_payout: financial.driver_payout,
          owner_settlement_amount: financial.owner_settlement_amount,
          bt_margin: financial.bt_margin,
          commission_rate: commission?.commission_rate || null,
          commission_amount: commission?.commission_amount || null,
          total_advances: totalAdvances,
          total_settlements: totalSettlements,
          remaining_driver_settlement: Number(financial.driver_payout) - totalAdvances - totalSettlements,
          remaining_owner_settlement: Number(financial.owner_settlement_amount) - totalSettlements,
          financial_status: financial.financial_status,
        } : null,
        advance_count: b._count.advances,
        settlement_count: b._count.settlements,
      };
    });

    res.json({
      success: true,
      data: trips,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
    });
  } catch (error) {
    console.error('Get vehicle trips error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/audit-logs
// @desc    Get audit logs with optional filters
// @access  Private (Admin)
router.get('/audit-logs', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { entity_type, entity_id, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (entity_id) where.entity_id = parseInt(entity_id);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { first_name: true, last_name: true, email: true, role: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.auditLog.count({ where }),
    ]);

    const formatted = logs.map(log => ({
      audit_id: log.audit_id,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      previous_value: log.previous_value,
      new_value: log.new_value,
      reason: log.reason,
      ip_address: log.ip_address,
      created_at: log.created_at,
      user: log.user ? {
        name: `${log.user.first_name} ${log.user.last_name}`,
        email: log.user.email,
        role: log.user.role,
      } : null,
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/audit-logs/entity/:entity_type/:entity_id
// @desc    Get audit logs for a specific entity
// @access  Private (Admin)
router.get('/audit-logs/entity/:entity_type/:entity_id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { entity_type, entity_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entity_type, entity_id: parseInt(entity_id) },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.auditLog.count({ where: { entity_type, entity_id: parseInt(entity_id) } }),
    ]);

    const formatted = logs.map(log => ({
      audit_id: log.audit_id,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      previous_value: log.previous_value,
      new_value: log.new_value,
      reason: log.reason,
      ip_address: log.ip_address,
      created_at: log.created_at,
      user: log.user ? {
        name: `${log.user.first_name} ${log.user.last_name}`,
        email: log.user.email,
        role: log.user.role,
      } : null,
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) },
    });
  } catch (error) {
    console.error('Get entity audit logs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/users/:id/status
// @desc    Toggle user status
// @access  Private (Admin)
router.put('/users/:id/status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const userId = parseInt(req.params.id);
    const { is_active } = req.body;

    await prisma.user.update({
      where: { user_id: userId },
      data: { is_active: is_active ? true : false }
    });

    res.json({
      success: true,
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * ===============================
 * Admin Booking Management (Phase 1)
 * ===============================
 */

// @route   POST /api/admin/bookings/bulk-status
// @desc    Bulk update booking status in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds, status } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, status);
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk status error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/bulk-confirm
// @desc    Bulk confirm bookings in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-confirm', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, 'confirmed');
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk confirm error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   POST /api/admin/bookings/bulk-cancel
// @desc    Bulk cancel bookings in a single transaction
// @access  Private (Admin)
router.post('/bookings/bulk-cancel', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { bookingIds } = req.body || {};
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'bookingIds must be a non-empty array' });
    }

    const result = await bookingService.bulkUpdateStatus(bookingIds, 'cancelled');
    return res.json({ success: true, updated: result.updated });
  } catch (err) {
    console.error('Bulk cancel error:', err);
    return mapDomainErrorToHttp(err, res);
  }
});

// @route   GET /api/admin/bookings/:id
// @desc    Get a booking by id
// @access  Private (Admin)
router.get('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);

const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
        driver: {
          select: {
            user_id: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
        delivery: {
          select: {
            current_status: true,
            status_description: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Flatten Prisma result to match original SQL response format
const flattened = {
      booking_id: booking.booking_id,
      booking_reference: booking.booking_reference,
      booking_number: booking.booking_number,
      user_id: booking.user_id,
      driver_id: booking.driver_id,
      vehicle_id: booking.vehicle_id,
      vehicle_owner_id: booking.vehicle_owner_id,
      pickup_location: booking.pickup_location,
      pickup_address: booking.pickup_address,
      pickup_city: booking.pickup_city,
      pickup_state: booking.pickup_state,
      pickup_pincode: booking.pickup_pincode,
      pickup_date: booking.pickup_date,
      pickup_time: booking.pickup_time,
      drop_location: booking.drop_location,
      drop_address: booking.drop_address,
      drop_city: booking.drop_city,
      drop_state: booking.drop_state,
      drop_pincode: booking.drop_pincode,
      goods_description: booking.goods_description,
      goods_type: booking.goods_type,
      goods_weight_kg: booking.goods_weight_kg,
      goods_volume: booking.goods_volume,
      number_of_items: booking.number_of_items,
      fragile: booking.fragile,
      special_instructions: booking.special_instructions,
      vehicle_type_required: booking.vehicle_type_required,
      estimated_distance_km: booking.estimated_distance_km,
      estimated_price: booking.estimated_price,
      final_price: booking.final_price,
status: booking.status,
      quote_status: booking.quote_status,
      confirmation_source: booking.confirmation_source ?? null,
      quote_remarks: booking.quote_remarks,
      quote_sent_at: booking.quote_sent_at,
      quote_accepted_at: booking.quote_accepted_at,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      confirmed_at: booking.confirmed_at,
      driver_assigned_at: booking.driver_assigned_at,
      pickup_completed_at: booking.pickup_completed_at,
      delivered_at: booking.delivered_at,
customer_first_name: booking.user?.first_name ?? null,
      customer_last_name: booking.user?.last_name ?? null,
      customer_email: booking.user?.email ?? null,
      customer_phone: booking.user?.phone ?? null,
      vehicle_number: booking.truck_number_snapshot ?? null,
      vehicle_name: null,
      vehicle_type: null,
      driver_user_id: booking.driver?.user_id ?? null,
      driver_first_name: booking.driver?.user?.first_name ?? null,
      driver_last_name: booking.driver?.user?.last_name ?? null,
      driver_phone: booking.driver?.user?.phone ?? null,
      driver_name_snapshot: booking.driver_name_snapshot ?? null,
      truck_number_snapshot: booking.truck_number_snapshot ?? null,
      owner_name_snapshot: booking.partner_name_snapshot ?? null,
      mobile_snapshot: booking.mobile_snapshot ?? null,
      delivery_current_status: booking.delivery?.current_status ?? null,
      delivery_status_description: booking.delivery?.status_description ?? null,
    };

    res.json({
      success: true,
      data: flattened,
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/admin/bookings/by-number/:bookingNumber
// @desc    Get a booking by its CANONICAL booking_number (BTB-YYYY-NNNNN)
//          or legacy booking_reference alias. Used by the read-only booking
//          detail page, the dedicated Assign Driver page, and the dedicated
//          Assign Vehicle page — all navigated by booking number.
// @access  Private (Admin)
router.get('/bookings/by-number/:bookingNumber', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const identifier = String(req.params.bookingNumber || '').trim();
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Booking number is required' });
    }
    const data = await bookingService.getBookingByIdentifier(identifier);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Get booking by number error:', err);
    if (err?.name === 'NotFoundError' || err?.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/bookings/:id
// @desc    Edit/update a booking by id
// @access  Private (Admin)
router.put('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);

    const {
      pickup_address,
      drop_address,
      pickup_city,
      drop_city,
      goods_description,
      goods_type,
      goods_weight_kg,
      number_of_items,
      fragile,
      vehicle_type_required,
      estimated_distance_km,
      estimated_price,
      final_price,
      vehicle_id,
      driver_id,
      vehicle_owner_id
    } = req.body || {};

    console.log('DEBUG: req.body =', JSON.stringify(req.body));
    console.log('DEBUG: extracted vehicle_id =', vehicle_id);
    console.log('DEBUG: extracted vehicle_owner_id =', vehicle_owner_id);

    // Build update data, only including provided fields
    const updateData = {};
    if (pickup_address !== undefined) updateData.pickup_address = pickup_address;
    if (drop_address !== undefined) updateData.drop_address = drop_address;
    if (pickup_city !== undefined) updateData.pickup_city = pickup_city;
    if (drop_city !== undefined) updateData.drop_city = drop_city;
    if (goods_description !== undefined) updateData.goods_description = goods_description;
    if (goods_type !== undefined) updateData.goods_type = goods_type;
    if (goods_weight_kg !== undefined) updateData.goods_weight_kg = goods_weight_kg ? parseFloat(goods_weight_kg) : null;
    if (number_of_items !== undefined) updateData.number_of_items = number_of_items ? parseInt(number_of_items) : null;
    if (fragile !== undefined) updateData.fragile = fragile ? true : false;
    if (vehicle_type_required !== undefined) updateData.vehicle_type_required = vehicle_type_required;
    if (estimated_distance_km !== undefined) updateData.estimated_distance_km = estimated_distance_km ? parseFloat(estimated_distance_km) : null;
    if (estimated_price !== undefined) updateData.estimated_price = estimated_price ? parseFloat(estimated_price) : null;
    if (final_price !== undefined) updateData.final_price = final_price ? parseFloat(final_price) : null;
    if (vehicle_id !== undefined) updateData.vehicle_id = vehicle_id ? parseInt(vehicle_id) : null;
    if (driver_id !== undefined) updateData.driver_id = driver_id ? parseInt(driver_id) : null;
    if (vehicle_owner_id !== undefined) updateData.vehicle_owner_id = vehicle_owner_id ? parseInt(vehicle_owner_id) : null;

    console.log('DEBUG: updateData =', JSON.stringify(updateData));

    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: updateData,
    }).then(result => {
      console.log('DEBUG: Prisma update result =', JSON.stringify(result));
    }).catch(err => {
      console.error('DEBUG: Prisma update error =', err);
    });

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: { booking_id: bookingId },
    });
  } catch (error) {
    console.error('Update booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/admin/bookings/:id
// @desc    Delete booking by id (STATE-AWARE + dependency-aware).
//          Booking numbers are derived from the DB autoincrement PK
//          (booking_id), so deleting a booking NEVER reuses its number —
//          the sequence always moves forward. Verified from the canonical
//          booking_number migration.
// @access  Private (Admin)
router.delete('/bookings/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid booking id' } });
    }

    // Fetch the booking with the info needed for the state/dependency check.
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        delivery: { select: { delivery_id: true, current_status: true } },
        reservations: { select: { reservation_id: true, status: true } },
        bookingAssignments: { select: { booking_assignment_id: true, assignment_status: true } },
        invoices: { select: { invoice_id: true, status: true } },
        ledgerEntries: { select: { ledger_id: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' } });
    }

    const status = (booking.status || '').toLowerCase();

    // === State-aware deletion rules ===
    // Protected statuses — never allow deletion of active/operational bookings.
    const PROTECTED_STATUSES = ['confirmed', 'driver_assigned', 'pickup_completed', 'pickup_started', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];
    if (PROTECTED_STATUSES.includes(status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_DELETABLE',
          message: `A booking with status "${booking.status}" cannot be deleted. Only pending, quote_sent, rejected, expired or cancelled bookings without active dependencies can be deleted.`,
          data: { status: booking.status },
        },
      });
    }

    // Allowed cleanup states: pending, quote_sent, rejected, cancelled, expired.
    const ALLOWED_CLEANUP_STATUSES = ['pending', 'quote_sent', 'rejected', 'cancelled', 'expired'];
    if (!ALLOWED_CLEANUP_STATUSES.includes(status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_DELETABLE',
          message: `Booking status "${booking.status}" is not eligible for deletion.`,
          data: { status: booking.status },
        },
      });
    }

    // quote_sent / pending bookings must not have active reservations/assignments/deliveries.
    // For cancelled/rejected bookings, an active delivery is stale and will be
    // safely cleaned up during deletion.
    const hasActiveReservation = booking.reservations?.some((r) => r.status === 'ACTIVE');
    const hasActiveAssignment = booking.bookingAssignments?.some((a) => a.assignment_status === 'active');
    const hasActiveDelivery = booking.delivery && !['delivered', 'cancelled'].includes((booking.delivery.current_status || '').toLowerCase());
    const hasProtectedPayment = booking.invoices?.some((i) => ['GENERATED', 'PAID'].includes(i.status));
    const hasLedgerLink = (booking.ledgerEntries?.length || 0) > 0;

    const isCleanupEligible = ['cancelled', 'rejected'].includes(status);

    if (hasActiveReservation) {
      return res.status(409).json({
        success: false,
        error: { code: 'BOOKING_HAS_ACTIVE_RESERVATION', message: 'This booking has an active driver/vehicle reservation and cannot be deleted.' },
      });
    }
    if (hasActiveAssignment) {
      return res.status(409).json({
        success: false,
        error: { code: 'BOOKING_HAS_ACTIVE_ASSIGNMENT', message: 'This booking has an active assignment and cannot be deleted.' },
      });
    }
    if (hasActiveDelivery && !isCleanupEligible) {
      return res.status(409).json({
        success: false,
        error: { code: 'BOOKING_HAS_ACTIVE_DELIVERY', message: 'This booking has an active delivery and cannot be deleted.' },
      });
    }
    if (hasProtectedPayment) {
      return res.status(409).json({
        success: false,
        error: { code: 'BOOKING_HAS_PROTECTED_PAYMENT', message: 'This booking has protected payment/financial records and cannot be deleted.' },
      });
    }
    if (hasLedgerLink) {
      return res.status(409).json({
        success: false,
        error: { code: 'BOOKING_HAS_LEDGER_RECORDS', message: 'This booking is linked to financial ledger records and cannot be deleted.' },
      });
    }

    // Safe to delete. Use a transaction so the delete + verification are atomic.
    // booking_events, booking_assignments, deliveries, invoices, reservations
    // CASCADE on booking delete (verified from schema). partner_ledger.booking_id
    // is SET NULL by the DB, so no ledger history is destroyed.
    const result = await prisma.$transaction(async (tx) => {
      // For cancelled/rejected bookings with a stale active delivery, safely
      // mark it as cancelled and remove it before deleting the booking.
      if (hasActiveDelivery && booking.delivery) {
        await tx.delivery.update({
          where: { delivery_id: booking.delivery.delivery_id },
          data: {
            current_status: 'cancelled',
            status_description: 'Booking cancelled — delivery removed by admin',
            updated_at: new Date(),
          },
        });
        await tx.delivery.delete({
          where: { delivery_id: booking.delivery.delivery_id },
        });
      }

      await tx.booking.delete({ where: { booking_id: bookingId } });
      const stillThere = await tx.booking.findUnique({
        where: { booking_id: bookingId },
        select: { booking_id: true },
      });
      if (stillThere) {
        const err = new Error('Booking could not be fully removed from the database.');
        err.code = 'BOOKING_DELETE_FAILED';
        throw err;
      }
      return { booking_id: bookingId };
    });

    res.json({
      success: true,
      message: 'Booking deleted successfully.',
      data: { booking_id: bookingId, booking_number: booking.booking_number },
    });
  } catch (error) {
    console.error('Delete booking error:', error);
    if (error.code === 'BOOKING_DELETE_FAILED') {
      return res.status(500).json({ success: false, error: { code: error.code, message: error.message } });
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// @route   GET /api/admin/bookings/:id/deletion-summary
// @desc    Get available actions and warnings for a booking's deletion workflow.
// @access  Private (Admin)
router.get('/bookings/:id/deletion-summary', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid booking id' } });
    }

    const deletionService = new BookingDeletionService();
    const summary = await deletionService.getDeletionSummary(bookingId);

    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Deletion summary error:', error);
    if (error.code === 'NOT_FOUND' || error.name === 'NotFoundError') {
      return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: error.message } });
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// @route   POST /api/admin/bookings/:id/deletion-action
// @desc    Perform a deletion action (keep, archive, or permanent delete) on a booking.
// @body    { action: 'keep' | 'archive' | 'delete' }
// @access  Private (Admin)
router.post('/bookings/:id/deletion-action', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid booking id' } });
    }

    const { action } = req.body || {};
    if (!action || !['keep', 'archive', 'delete'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ACTION', message: 'Action must be one of: keep, archive, delete' },
      });
    }

    // For permanent delete, require strong confirmation from the client.
    if (action === 'delete' && req.body.confirmation_code !== 'DELETE') {
      return res.status(400).json({
        success: false,
        error: { code: 'CONFIRMATION_REQUIRED', message: 'Type DELETE to confirm permanent deletion.' },
      });
    }

    const deletionService = new BookingDeletionService();
    const result = await deletionService.performAction(bookingId, action, req.user.user_id);

    const actionLabels = { keep: 'kept', archive: 'archived', delete: 'permanently deleted' };
    return res.json({
      success: true,
      message: `Booking ${actionLabels[action]} successfully.`,
      data: result,
    });
  } catch (error) {
    console.error('Deletion action error:', error);
    const code = error.code || 'INTERNAL_ERROR';
    const statusMap = {
      BOOKING_NOT_FOUND: 404,
      BOOKING_NOT_ARCHIVABLE: 409,
      BOOKING_NOT_DELETABLE: 409,
      BOOKING_HAS_ACTIVE_DELIVERY: 409,
      BOOKING_HAS_PROTECTED_INVOICE: 409,
      BOOKING_HAS_LEDGER_RECORDS: 409,
      BOOKING_ARCHIVE_FAILED: 500,
      BOOKING_DELETE_FAILED: 500,
      CONFIRMATION_REQUIRED: 400,
      INVALID_ACTION: 400,
    };
    const status = statusMap[code] || 500;
    return res.status(status).json({ success: false, error: { code, message: error.message } });
  }
});

// @route   PATCH /api/admin/bookings/:id/status
// @desc    Update booking status by id
// @access  Private (Admin)
router.patch('/bookings/:id/status', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required'
      });
    }

    // Only allow known states (based on schema)
    const allowed = [
      'pending',
      'confirmed',
      'driver_assigned',
      'pickup_completed',
      'in_transit',
      'delivered',
      'cancelled',
      'completed'
    ];

if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // === Single source of truth ===
    // Confirmation is DRIVEN BY quote_status. When an admin sets status to
    // 'confirmed' (offline/phone/WhatsApp confirmation), we must atomically
    // also set quote_status='ACCEPTED' + confirmation_source='ADMIN' +
    // confirmed_at, and write a BOOKING_CONFIRMED_BY_ADMIN timeline event.
    // This guarantees the DB is NEVER left in an inconsistent state
    // (e.g. status=confirmed + quote_status=SENT/PENDING).
    if (status === 'confirmed') {
      const result = await bookingService.confirmBooking(bookingId);
      return res.json({
        success: true,
        message: 'Booking confirmed successfully',
        data: result,
      });
    }

    await prisma.booking.update({
      where: { booking_id: bookingId },
      data: { status },
    });

    res.json({
      success: true,
      message: 'Booking status updated successfully'
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.name === 'ValidationError' || error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error.name === 'NotFoundError' || error.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * ===============================
 * Driver Assignment API
 * ===============================
 */

// @route   GET /api/admin/booking-drivers
// @desc    Scalable driver lookup for the Booking Assignment picker (10k+ drivers).
//          Server-side pagination + search + filters + trip stats in ONE call.
//          Each driver carries its assigned vehicle (one-driver-one-vehicle),
//          so the frontend never combines multiple APIs.
// @query   page, limit, search, status, vehicle_type, min_rating
// @access  Private (Admin)
router.get('/booking-drivers', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const adminBookingController = require('../controllers/adminBookingController');
    const ctrl = adminBookingController.createAdminBookingController();
    await ctrl.getAssignableDrivers(req, res);
  } catch (err) {
    console.error('Get assignable drivers error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/bookings/:id/assign-driver
// @desc    Assign an available driver to a booking
// @access  Private (Admin)
router.post('/bookings/:id/assign-driver', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { driver_id } = req.body || {};

    // ── Explicit CLEAR is checked FIRST ────────────────────────────────
    // `clear: true` (or an explicit `driver_id: null`) is the ONLY normal way
    // to remove an assignment. It is handled before the `driver_id is
    // required` guard below, otherwise a clear request — which carries no
    // driver by definition — would be rejected as malformed.
    const wantsClear = req.body?.clear === true || req.body?.driver_id === null;
    if (wantsClear) {
      const current = await prisma.booking.findUnique({
        where: { booking_id: bookingId },
        select: { driver_id: true },
      });
      if (!current) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: null,
            vehicle_id: null,
            driver_name_snapshot: null,
            mobile_snapshot: null,
            truck_number_snapshot: null,
            partner_name_snapshot: null,
            driver_assigned_at: null,
            // A booking with no driver must not stay parked in
            // `driver_assigned` with nothing assigned.
            status: 'pending',
          },
        });
        await tx.bookingAssignment.updateMany({
          where: { booking_id: bookingId, assignment_status: 'active' },
          data: { assignment_status: 'released' },
        });
        await tx.bookingEvent.create({
          data: {
            booking_id: bookingId,
            event_type: 'driver_unassigned',
            event_payload: JSON.stringify({
              previous_driver_id: current.driver_id ?? null,
              cleared_by_admin: req.user.user_id,
            }),
          },
        });
      });

      return res.json({
        success: true,
        message: 'Driver and vehicle assignment cleared.',
        data: { booking_id: bookingId, driver_id: null, vehicle_id: null, status: 'pending' },
      });
    }

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'driver_id is required'
      });
    }

    const parsedDriverId = parseInt(driver_id);

// Validate booking exists
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: {
        booking_id: true,
        driver_id: true,
        status: true,
        quote_status: true,
      },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // NOTE: This endpoint is an EXCEPTIONAL operational path for manually
    // assigning a driver. The NORMAL quote workflow selects the driver WITH
    // the final quote (sendQuoteWithReservation) and reserves them; customer
    // acceptance then auto-confirms driver + vehicle. We therefore do NOT
    // require quote_status === 'ACCEPTED' here — that old gate is removed.

    // Prevent assigning driver to cancelled/completed bookings
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver to a booking with status: ${booking.status}`
      });
    }

    // Re-assignment (the "Change" button) IS supported. A booking may swap the
    // driver at any point before it is closed; the previous driver is simply
    // replaced, and the double-booking guard below still applies.
    const previousDriverId = booking.driver_id ?? null;

// Validate driver exists and is available
    // Brokerage model: each driver maps to exactly one primary registered
    // vehicle (stored on the driver as vehicle_number / vehicle_type). We
    // load those fields so the vehicle can be auto-associated on assignment.
const driver = await prisma.driver.findUnique({
      where: { driver_id: parsedDriverId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        currentPartner: {
          select: {
            partner_id: true,
            partner_name: true,
          },
        },
        // The transport owner the driver belongs to. This is the OWNER half of
        // the assignment the admin page has to display — without it a driver who
        // is self-owned (or owned by a VehicleOwner rather than a Partner)
        // showed "Owner / Partner: —" after the booking was re-read.
        transportOwner: {
          select: {
            owner_id: true,
            owner_name: true,
            company_name: true,
            mobile: true,
          },
        },
        // The driver's registered vehicle (one-driver-one-vehicle). This is the
        // REAL relation: Driver.current_vehicle_id -> TransportVehicle. The
        // Driver table has no denormalized vehicle_number/vehicle_type columns,
        // and there is no `transportVehicles` list relation — including one made
        // every assignment 500 with "Unknown field `transportVehicles`".
        currentVehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_type: true,
            vehicle_name: true,
            capacity_kg: true,
            // The vehicle's owner — the authoritative owner/partner for the
            // vehicle actually being assigned.
            owner: {
              select: {
                owner_id: true,
                owner_name: true,
                company_name: true,
                mobile: true,
              },
            },
          },
        },
      },
    });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    if (!driver.is_available) {
      return res.status(400).json({
        success: false,
        message: 'Driver is not available'
      });
    }

    // Brokerage validation: a driver MUST have a registered vehicle before
    // they can be assigned to a booking. A driver has a valid vehicle when the
    // real `currentVehicle` relationship resolves one. This keeps the
    // assignment contract consistent with the driver picker (findAssignable),
    // which surfaces the same relationship.
    // Rejection happens BEFORE any DB write, so the booking is never
    // partially updated.
    const linkedVehicle = driver.currentVehicle || null;
    if (!linkedVehicle || !linkedVehicle.vehicle_number) {
      return res.status(400).json({
        success: false,
        message: 'Driver has no registered vehicle. Please assign a vehicle to the driver first.'
      });
    }

    // Resolve the authoritative vehicle for this assignment from the real
    // driver -> vehicle relationship.
    const assignedVehicleId = linkedVehicle.vehicle_id;
    const assignedVehicleNumber = linkedVehicle.vehicle_number;
    const assignedVehicleType = linkedVehicle.vehicle_type || null;
    const assignedVehicleCapacity = linkedVehicle.capacity_kg ?? null;

    // The owner/partner shown on the booking. A driver can be linked to a
    // network Partner OR to a Transport Owner (VehicleOwner) OR to neither.
    // The vehicle's own owner wins, then the driver's partner, then the
    // driver's transport owner — previously ONLY the partner was read, which
    // is why self-owned drivers displayed "Owner / Partner: —".
    const resolvedOwner = {
      name:
        linkedVehicle.owner?.company_name ||
        linkedVehicle.owner?.owner_name ||
        driver.currentPartner?.partner_name ||
        driver.transportOwner?.company_name ||
        driver.transportOwner?.owner_name ||
        null,
      owner_id: linkedVehicle.owner?.owner_id ?? driver.transportOwner?.owner_id ?? null,
      partner_id: driver.currentPartner?.partner_id ?? null,
      mobile: linkedVehicle.owner?.mobile ?? driver.transportOwner?.mobile ?? null,
    };

    // Check driver is not already assigned to another active booking.
    // Exclude the current booking so reassigning the same driver is allowed.
    const activeBooking = await prisma.booking.findFirst({
      where: {
        driver_id: parsedDriverId,
        booking_id: { not: bookingId },
        status: { notIn: ['cancelled', 'completed', 'delivered'] },
      },
      select: { booking_id: true },
    });
    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'Driver is already assigned to another active booking'
      });
    }

    // Execute assignment within an atomic Prisma interactive transaction.
    // Assigning the driver auto-associates the driver's registered vehicle
    // (stored as immutable snapshots on the booking) in the SAME transaction.
    // If any step fails, the whole transaction rolls back.
    const assigned = await prisma.$transaction(async (tx) => {
      // 1. Persist the assignment ON THE BOOKING ROW.
      //
      //    `vehicle_id` is written (not just the snapshot) so that the Booking
      //    → TransportVehicle relation resolves on EVERY later read. Without
      //    it, GET /bookings/by-number/:number returned no vehicle at all after
      //    a refresh, because the mapper reads `booking.vehicle.vehicle_number`
      //    and that relation was null.
      const updatedBooking = await tx.booking.update({
        where: { booking_id: bookingId },
        data: {
          driver_id: parsedDriverId,
          vehicle_id: assignedVehicleId,
          status: 'driver_assigned',
          driver_assigned_at: new Date(),
          // Snapshots of the driver's registered vehicle, resolved from the
          // real `currentVehicle` relationship.
          driver_name_snapshot: driver.driver_name || `${driver.user.first_name} ${driver.user.last_name}`.trim(),
          mobile_snapshot: driver.mobile || driver.user.phone || null,
          truck_number_snapshot: assignedVehicleNumber,
          partner_name_snapshot: resolvedOwner.name,
        },
      });

      // 2. Close out any PREVIOUS active assignment so the history stays
      //    truthful when the admin changes the driver.
      await tx.bookingAssignment.updateMany({
        where: { booking_id: bookingId, assignment_status: 'active' },
        data: { assignment_status: 'replaced' },
      });

      // 3. Record the driver assignment. `assigned_vehicle_id` is written too so
      //    the assignment history is self-contained.
      await tx.bookingAssignment.create({
        data: {
          booking_id: bookingId,
          assigned_driver_id: parsedDriverId,
          assigned_vehicle_id: assignedVehicleId,
          assigned_by_admin_id: req.user.user_id,
          assignment_status: 'active',
        },
      });

      // 4. Update delivery record if exists
      const delivery = await tx.delivery.findUnique({
        where: { booking_id: bookingId },
        select: { delivery_id: true },
      });
      if (delivery) {
        await tx.delivery.update({
          where: { booking_id: bookingId },
          data: {
            driver_id: parsedDriverId,
            current_status: 'driver_assigned',
            status_description: 'Driver assigned to booking',
          },
        });
      }

      // 5. Timeline events: Driver Assigned → Vehicle Auto Assigned → Booking Ready
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'driver_assigned',
          event_payload: JSON.stringify({
            previous_driver_id: previousDriverId,
            driver_id: parsedDriverId,
            driver_name: driver.driver_name || `${driver.user.first_name} ${driver.user.last_name}`.trim(),
            driver_phone: driver.mobile || driver.user.phone || null,
            vehicle_id: assignedVehicleId,
            vehicle_number: assignedVehicleNumber,
            vehicle_type: assignedVehicleType,
            owner_name: resolvedOwner.name,
          }),
        },
      });
      await tx.bookingEvent.create({
data: {
          booking_id: bookingId,
          event_type: 'vehicle_auto_assigned',
          event_payload: JSON.stringify({
            vehicle_number: assignedVehicleNumber,
            vehicle_type: assignedVehicleType || null,
            vehicle_capacity_kg: assignedVehicleCapacity ?? null,
            source: 'driver_primary_vehicle_or_transport_vehicle',
          }),
        },
      });
      await tx.bookingEvent.create({
        data: {
          booking_id: bookingId,
          event_type: 'booking_ready',
          event_payload: JSON.stringify({
            status: 'driver_assigned',
            message: 'Driver and vehicle assigned. Booking ready.',
          }),
        },
      });

      return updatedBooking;
    });

    // Sync assignment to Trip so Vehicle Hire page stays in sync
    try {
      const tripAssignmentService = new TripVehicleAssignmentService();
      await tripAssignmentService.assign(
        { bookingId },
        { vehicle_id: assignedVehicleId, driver_id: parsedDriverId },
        { userId: req.user.user_id, role: req.user.role }
      );
    } catch (syncError) {
      console.error('Trip assignment sync failed:', syncError);
      // Don't fail the request - the booking assignment succeeded
    }

    // ── The COMPLETE persisted assignment ────────────────────────────────
    // Re-read from the database rather than echoing the request, so the
    // response can only ever describe what was actually committed.
    const persisted = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        driver: { select: { driver_id: true, driver_name: true, mobile: true } },
        vehicle: {
          select: { vehicle_id: true, vehicle_number: true, vehicle_type: true, vehicle_name: true },
        },
        vehicleOwner: { select: { owner_id: true, owner_name: true, company_name: true, mobile: true } },
        partner: { select: { partner_id: true, partner_name: true } },
      },
    });

    res.json({
      success: true,
      message: "Driver assigned successfully. The driver's registered vehicle was auto-assigned.",
      data: {
        booking_id: bookingId,
        driver_id: persisted?.driver_id ?? null,
        driver_name: persisted?.driver_name_snapshot || persisted?.driver?.driver_name || null,
        driver_phone: persisted?.mobile_snapshot || persisted?.driver?.mobile || null,
        vehicle_id: persisted?.vehicle_id ?? null,
        vehicle_number: persisted?.vehicle?.vehicle_number || persisted?.truck_number_snapshot || null,
        vehicle_type: persisted?.vehicle?.vehicle_type || assignedVehicleType || null,
        vehicle_name: persisted?.vehicle?.vehicle_name || null,
        vehicle_capacity_kg: assignedVehicleCapacity ?? null,
        owner_id: persisted?.vehicleOwner?.owner_id ?? resolvedOwner.owner_id ?? null,
        owner_name: persisted?.partner_name_snapshot || persisted?.vehicleOwner?.company_name || persisted?.vehicleOwner?.owner_name || null,
        partner_id: persisted?.partner?.partner_id ?? null,
        partner_name: persisted?.partner?.partner_name ?? null,
        status: persisted?.status || 'driver_assigned',
        assigned_at: persisted?.driver_assigned_at || null,
      },
    });

  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning driver'
    });
  }
});

// @route   POST /api/admin/bookings/:id/assign-driver-details
// @desc    Manually assign a driver + truck to a booking (brokerage model).
//          The platform does NOT own trucks — the admin captures the driver's
//          own vehicle details and stores them as immutable snapshots.
//          Only allowed after the customer ACCEPTS the final quote.
// @access  Private (Admin)
router.post('/bookings/:id/assign-driver-details', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const bookingId = parseInt(req.params.id);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking id' });
    }

    const {
      driver_name,
      phone,
      vehicle_number,
      vehicle_type,
      owner_name
    } = req.body || {};

    if (!driver_name) {
      return res.status(400).json({ success: false, message: 'driver_name is required' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    if (!vehicle_number) {
      return res.status(400).json({ success: false, message: 'vehicle_number is required' });
    }

const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { booking_id: true, status: true, quote_status: true },
    });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Exceptional operational path — the acceptance gate is intentionally
    // removed. The normal quote workflow reserves the driver WITH the quote;
    // acceptance auto-confirms. This endpoint is for manual/snapshot capture.

    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver to a booking with status: ${booking.status}`,
      });
    }

    // Persist driver + truck contact details as immutable snapshots and mark assigned.
    const updated = await prisma.booking.update({
      where: { booking_id: bookingId },
      data: {
        driver_name_snapshot: String(driver_name),
        mobile_snapshot: String(phone),
        truck_number_snapshot: String(vehicle_number),
        partner_name_snapshot: owner_name ? String(owner_name) : null,
        status: 'driver_assigned',
        driver_assigned_at: new Date(),
      },
    });

    await prisma.bookingEvent.create({
      data: {
        booking_id: bookingId,
        event_type: 'driver_assigned',
        event_payload: JSON.stringify({
          driver_name,
          phone,
          vehicle_number,
          vehicle_type: vehicle_type || null,
          owner_name: owner_name || null,
        }),
      },
    });

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        booking_id: bookingId,
        driver_name,
        phone,
        vehicle_number,
        vehicle_type: vehicle_type || null,
        owner_name: owner_name || null,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Assign driver details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error assigning driver',
    });
  }
});

/**
 * ===============================
 * Vehicle Assignment API
 * ===============================
 */

// @route   POST /api/admin/bookings/:id/assign-vehicle
// @desc    Assign a vehicle to a booking. Creates a BookingAssignment record
//          with the assigned vehicle. The Booking model retains `vehicle_id`
//          and `Delivery` retains `vehicle_id` in the current architecture.
// @access  Private (Admin)
router.post('/bookings/:id/assign-vehicle', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const bookingId = parseInt(req.params.id);
    const { vehicle_id } = req.body;

    if (!bookingId || !vehicle_id) {
      return res.status(400).json({
        success: false,
        message: 'bookingId and vehicle_id are required'
      });
    }

    // Verify booking exists
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      select: { booking_id: true },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Verify vehicle exists
    const vehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: parseInt(vehicle_id) },
      select: { vehicle_id: true, is_available: true },
    });
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    const result = await bookingAssignmentService.assignVehicle(bookingId, parseInt(vehicle_id), req.user.user_id);

    // Sync assignment to Trip so Vehicle Hire page stays in sync
    try {
      const tripAssignmentService = new TripVehicleAssignmentService();
      await tripAssignmentService.assign(
        { bookingId },
        { vehicle_id: parseInt(vehicle_id) },
        { userId: req.user.user_id, role: req.user.role }
      );
    } catch (syncError) {
      console.error('Trip assignment sync failed:', syncError);
      // Don't fail the request - the booking assignment succeeded
    }

    res.json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: result,
    });
  } catch (err) {
    console.error('Assign vehicle error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Server error assigning vehicle',
    });
  }
});


// @route   GET /api/admin/global-search
// @desc    Centralized global search across admin modules
// @access  Private (Admin)
router.get('/global-search', protect, adminOnly, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ success: false, message: 'Search query is required' });
    }
    if (q.length > 100) {
      return res.status(400).json({ success: false, message: 'Search query is too long' });
    }

    const page = parsePositiveInt(req.query.page, 1) || 1;
    const limit = Math.min(parsePositiveInt(req.query.limit, 10) || 10, 25);
    const skip = (page - 1) * limit;
    const term = q;
    const numeric = /^\d+(\.\d+)?$/.test(term) ? Number(term) : null;
    const ci = (value) => ({ contains: value, mode: 'insensitive' });

    const driverWhere = {
      OR: [
        { driver_name: ci(term) },
        { mobile: ci(term) },
        { alternate_mobile: ci(term) },
        { driver_code: ci(term) },
        { city: ci(term) },
        { license_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ driver_id: numeric }] : []),
      ],
    };

    const vehicleOwnerWhere = {
      OR: [
        { owner_name: ci(term) },
        { company_name: ci(term) },
        { mobile: ci(term) },
        { alternate_mobile: ci(term) },
        { owner_code: ci(term) },
        { city: ci(term) },
        { email: ci(term) },
        { gst_number: ci(term) },
        { pan_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ owner_id: numeric }] : []),
      ],
    };

    const vehicleWhere = {
      OR: [
        { vehicle_number: ci(term) },
        { vehicle_type: ci(term) },
        { vehicle_name: ci(term) },
        { vehicle_make: ci(term) },
        { vehicle_model: ci(term) },
        { vehicle_code: ci(term) },
        { base_location: ci(term) },
        { driver: { driver_name: ci(term) } },
        { owner: { owner_name: ci(term) } },
        ...(numeric !== null && numeric <= 2147483647 ? [{ vehicle_id: numeric }] : []),
      ],
    };

    const clientWhere = {
      OR: [
        { company_name: ci(term) },
        { contact_person: ci(term) },
        { phone: ci(term) },
        { email: ci(term) },
        { city: ci(term) },
        { client_code: ci(term) },
        { gst_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ client_id: numeric }] : []),
      ],
    };

    const userWhere = {
      role: 'customer',
      OR: [
        { first_name: ci(term) },
        { last_name: ci(term) },
        { email: ci(term) },
        { phone: ci(term) },
        { city: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ user_id: numeric }] : []),
      ],
    };

    const bookingWhere = {
      OR: [
        { booking_number: ci(term) },
        { booking_reference: ci(term) },
        { pickup_city: ci(term) },
        { drop_city: ci(term) },
        { pickup_location: ci(term) },
        { drop_location: ci(term) },
        { goods_description: ci(term) },
        { status: ci(term) },
        { mobile_snapshot: ci(term) },
        { driver_name_snapshot: ci(term) },
        { truck_number_snapshot: ci(term) },
        { partner_name_snapshot: ci(term) },
        { user: { OR: [{ first_name: ci(term) }, { last_name: ci(term) }, { phone: ci(term) }] } },
        { vehicle: { vehicle_number: ci(term) } },
        ...(numeric !== null && numeric <= 2147483647 ? [{ booking_id: numeric }] : []),
      ],
    };

    const enquiryWhere = {
      OR: [
        { enquiry_number: ci(term) },
        { customer_name: ci(term) },
        { customer_mobile: ci(term) },
        { customer_email: ci(term) },
        { pickup_location: ci(term) },
        { drop_location: ci(term) },
        { assigned_driver_name: ci(term) },
        { assigned_vehicle_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ enquiry_id: numeric }] : []),
      ],
    };

    const partnerWhere = {
      OR: [
        { partner_name: ci(term) },
        { owner_name: ci(term) },
        { company_name: ci(term) },
        { mobile: ci(term) },
        { alternate_mobile: ci(term) },
        { partner_code: ci(term) },
        { city: ci(term) },
        { email: ci(term) },
        { gst_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ partner_id: numeric }] : []),
      ],
    };

    const tripWhere = {
      OR: [
        { trip_number: ci(term) },
        { pickup_city: ci(term) },
        { drop_city: ci(term) },
        { pickup_location: ci(term) },
        { drop_location: ci(term) },
        { driver: { driver_name: ci(term) } },
        { vehicle: { vehicle_number: ci(term) } },
        ...(numeric !== null && numeric <= 2147483647 ? [{ trip_id: numeric }] : []),
      ],
    };

    const financialWhere = {
      OR: [
        { reference_number: ci(term) },
        { notes: ci(term) },
        { purpose: ci(term) },
        { payment_method: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ transaction_id: numeric }] : []),
        ...(numeric !== null ? [{ amount: numeric }] : []),
      ],
    };

    const invoiceWhere = {
      OR: [
        { invoice_number: ci(term) },
        { billing_to: ci(term) },
        { gst_number: ci(term) },
        { payment_status: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ invoice_id: numeric }] : []),
        ...(numeric !== null ? [{ grand_total: numeric }, { total_amount: numeric }] : []),
      ],
    };

    const settlementWhere = {
      OR: [
        { settlement_number: ci(term) },
        { notes: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ settlement_id: numeric }] : []),
        ...(numeric !== null ? [{ net_payable: numeric }] : []),
      ],
    };

    const expenseWhere = {
      OR: [
        { description: ci(term) },
        { reference_number: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ expense_id: numeric }] : []),
        ...(numeric !== null ? [{ amount: numeric }] : []),
      ],
    };

    const adminWhere = {
      OR: [
        { username: ci(term) },
        { full_name: ci(term) },
        { email: ci(term) },
        { phone: ci(term) },
        { role: ci(term) },
        ...(numeric !== null && numeric <= 2147483647 ? [{ admin_id: numeric }] : []),
      ],
    };

    const run = async (model, where, orderBy, select, include) => {
      const [count, rows] = await Promise.all([
        prisma[model].count({ where }),
        prisma[model].findMany({
          where,
          orderBy,
          skip,
          take: limit,
          ...(include ? { include } : (select ? { select } : {})),
        }),
      ]);
      return { count, rows };
    };

    const [
      drivers, vehicleOwners, vehicles, clients, customers, bookings, enquiries, partners, trips,
      financials, invoices, settlements, expenses, admins,
    ] = await Promise.all([
      run('driver', driverWhere, { driver_id: 'desc' }, {
        driver_id: true, driver_name: true, mobile: true, driver_code: true, city: true, status: true, is_available: true,
      }, null),
      run('vehicleOwner', vehicleOwnerWhere, { owner_id: 'desc' }, {
        owner_id: true, owner_name: true, company_name: true, mobile: true, owner_code: true, city: true, status: true, owner_type: true,
      }, null),
      run('transportVehicle', vehicleWhere, { vehicle_id: 'desc' }, {
        vehicle_id: true, vehicle_number: true, vehicle_type: true, vehicle_name: true, current_status: true, is_available: true, owner_id: true,
      }, { driver: { select: { driver_name: true, mobile: true } }, owner: { select: { owner_name: true } } }),
      run('client', clientWhere, { client_id: 'desc' }, {
        client_id: true, company_name: true, contact_person: true, phone: true, email: true, city: true, client_code: true, status: true,
      }, null),
      run('user', userWhere, { user_id: 'desc' }, {
        user_id: true, first_name: true, last_name: true, phone: true, email: true, city: true,
      }, null),
      run('booking', bookingWhere, { booking_id: 'desc' }, {
        booking_id: true, booking_number: true, booking_reference: true, pickup_city: true, drop_city: true, status: true, final_price: true, created_at: true,
      }, { user: { select: { first_name: true, last_name: true, phone: true } }, vehicle: { select: { vehicle_number: true } }, driver: { select: { driver_name: true } } }),
      run('enquiry', enquiryWhere, { enquiry_id: 'desc' }, {
        enquiry_id: true, enquiry_number: true, customer_name: true, customer_mobile: true, pickup_location: true, drop_location: true, status: true, price_status: true, final_quoted_price: true,
      }, null),
      run('partner', partnerWhere, { partner_id: 'desc' }, {
        partner_id: true, partner_name: true, owner_name: true, mobile: true, partner_code: true, city: true, status: true, company_name: true,
      }, null),
      run('trip', tripWhere, { trip_id: 'desc' }, {
        trip_id: true, trip_number: true, pickup_city: true, drop_city: true, status: true, freight_amount: true, trip_date: true, booking_id: true,
      }, { driver: { select: { driver_name: true } }, vehicle: { select: { vehicle_number: true } } }),
      run('financialTransaction', financialWhere, { transaction_id: 'desc' }, {
        transaction_id: true, amount: true, status: true, payment_method: true, reference_number: true, purpose: true, booking_id: true, trip_id: true, invoice_id: true, created_at: true,
      }, { booking: { select: { booking_number: true } }, invoices: { select: { invoice_number: true } }, trip: { select: { trip_number: true } } }),
      run('invoice', invoiceWhere, { invoice_id: 'desc' }, {
        invoice_id: true, invoice_number: true, status: true, payment_status: true, grand_total: true, total_amount: true, booking_id: true, trip_id: true,
      }, { booking: { select: { booking_number: true } }, trips: { select: { trip_number: true, trip_id: true } } }),
      run('settlement', settlementWhere, { settlement_id: 'desc' }, {
        settlement_id: true, settlement_number: true, status: true, net_payable: true, partner_id: true, created_at: true,
      }, null),
      run('tripExpense', expenseWhere, { expense_id: 'desc' }, {
        expense_id: true, expense_type: true, amount: true, description: true, trip_id: true, created_at: true,
      }, { trip: { select: { trip_number: true, trip_id: true } } }),
      run('admin', adminWhere, { admin_id: 'desc' }, {
        admin_id: true, full_name: true, username: true, email: true, role: true,
      }, null),
    ]);

    const categories = [];

    const pushCategory = (module, group, label, count, rows, mapFn) => {
      if (!count) return;
      categories.push({
        module,
        group,
        label,
        count,
        results: rows.map(mapFn),
      });
    };

    pushCategory('drivers', 'People', 'Drivers', drivers.count, drivers.rows, (r) => ({
      id: r.driver_id,
      type: 'driver',
      title: r.driver_name,
      subtitle: [r.mobile, r.city].filter(Boolean).join(' · '),
      badge: r.status || (r.is_available ? 'available' : 'unavailable'),
      meta: r.driver_code ? `ID: ${r.driver_code}` : `ID: ${r.driver_id}`,
      route: `/admin/drivers/${r.driver_id}`,
    }));

    pushCategory('vehicle_owners', 'People', 'Vehicle Owners', vehicleOwners.count, vehicleOwners.rows, (r) => ({
      id: r.owner_id,
      type: 'vehicle_owner',
      title: r.owner_name,
      subtitle: [r.mobile, r.city, r.company_name].filter(Boolean).join(' · '),
      badge: r.status || 'active',
      meta: r.owner_code ? `ID: ${r.owner_code}` : `ID: ${r.owner_id}`,
      route: `/admin/vehicle-owners/${r.owner_id}`,
    }));

    pushCategory('vehicles', 'Fleet', 'Vehicles', vehicles.count, vehicles.rows, (r) => ({
      id: r.vehicle_id,
      type: 'vehicle',
      title: r.vehicle_number,
      subtitle: [r.vehicle_type, r.owner?.owner_name, r.driver?.driver_name].filter(Boolean).join(' · '),
      badge: r.current_status || (r.is_available ? 'available' : 'unavailable'),
      meta: r.vehicle_name || `ID: ${r.vehicle_id}`,
      route: `/admin/vehicles/${r.vehicle_id}`,
    }));

    pushCategory('clients', 'People', 'Clients', clients.count, clients.rows, (r) => ({
      id: r.client_id,
      type: 'client',
      title: r.company_name,
      subtitle: [r.contact_person, r.phone, r.city].filter(Boolean).join(' · '),
      badge: r.status || 'active',
      meta: r.client_code ? `ID: ${r.client_code}` : `ID: ${r.client_id}`,
      route: `/admin/clients/${r.client_id}`,
    }));

    pushCategory('customers', 'People', 'Customers', customers.count, customers.rows, (r) => ({
      id: r.user_id,
      type: 'customer',
      title: `${r.first_name} ${r.last_name}`.trim(),
      subtitle: [r.phone, r.email, r.city].filter(Boolean).join(' · '),
      badge: 'customer',
      meta: `ID: ${r.user_id}`,
      route: `/admin/bookings?search=${encodeURIComponent(r.phone || r.first_name || '')}`,
    }));

    pushCategory('bookings', 'Operations', 'Bookings', bookings.count, bookings.rows, (r) => ({
      id: r.booking_id,
      type: 'booking',
      title: r.booking_number || r.booking_reference || `Booking #${r.booking_id}`,
      subtitle: [r.user ? `${r.user.first_name || ''} ${r.user.last_name || ''}`.trim() : null, `${r.pickup_city} → ${r.drop_city}`, r.vehicle?.vehicle_number].filter(Boolean).join(' · '),
      badge: r.status || 'pending',
      meta: r.booking_reference ? `Ref: ${r.booking_reference}` : `ID: ${r.booking_id}`,
      route: `/admin/bookings/${encodeURIComponent(r.booking_number || r.booking_reference || r.booking_id)}`,
    }));

    pushCategory('enquiries', 'Operations', 'Enquiries', enquiries.count, enquiries.rows, (r) => ({
      id: r.enquiry_id,
      type: 'enquiry',
      title: r.enquiry_number || `Enquiry #${r.enquiry_id}`,
      subtitle: [r.customer_name, r.customer_mobile, `${r.pickup_location} → ${r.drop_location}`].filter(Boolean).join(' · '),
      badge: r.status || 'pending',
      meta: r.price_status ? `Price: ${r.price_status}` : `ID: ${r.enquiry_id}`,
      route: `/admin/enquiries/${r.enquiry_id}`,
    }));

    pushCategory('partners', 'People', 'Transport Owners / Partners', partners.count, partners.rows, (r) => ({
      id: r.partner_id,
      type: 'partner',
      title: r.partner_name || r.owner_name || r.company_name,
      subtitle: [r.mobile, r.city, r.company_name].filter(Boolean).join(' · '),
      badge: r.status || 'active',
      meta: r.partner_code ? `ID: ${r.partner_code}` : `ID: ${r.partner_id}`,
      route: `/admin/owners/${r.partner_id}`,
    }));

    pushCategory('trips', 'Operations', 'Trips', trips.count, trips.rows, (r) => ({
      id: r.trip_id,
      type: 'trip',
      title: r.trip_number || `Trip #${r.trip_id}`,
      subtitle: [r.driver?.driver_name, r.vehicle?.vehicle_number, `${r.pickup_city} → ${r.drop_city}`].filter(Boolean).join(' · '),
      badge: r.status || 'pending',
      meta: r.freight_amount != null ? `Freight: ${r.freight_amount}` : `ID: ${r.trip_id}`,
      route: `/admin/trips/${r.trip_id}`,
    }));

    pushCategory('financial_transactions', 'Financials', 'Financial Transactions', financials.count, financials.rows, (r) => ({
      id: r.transaction_id,
      type: 'financial_transaction',
      title: `Transaction #${r.transaction_id}`,
      subtitle: [r.booking?.booking_number, r.invoices?.invoice_number, r.trip?.trip_number].filter(Boolean).join(' · '),
      badge: r.status || 'paid',
      meta: r.amount != null ? `Amount: ${r.amount}` : `ID: ${r.transaction_id}`,
      route: r.trip_id ? `/admin/trips/${r.trip_id}/finance` : '/admin/financials/payments',
    }));

    pushCategory('invoices', 'Financials', 'Invoices', invoices.count, invoices.rows, (r) => ({
      id: r.invoice_id,
      type: 'invoice',
      title: r.invoice_number || `Invoice #${r.invoice_id}`,
      subtitle: [r.booking?.booking_number, r.trips?.trip_number].filter(Boolean).join(' · '),
      badge: r.payment_status || r.status || 'unpaid',
      meta: r.grand_total != null ? `Amount: ${r.grand_total}` : `ID: ${r.invoice_id}`,
      route: (r.trips?.trip_id || r.trip_id) ? `/admin/trips/${r.trips?.trip_id || r.trip_id}/finance` : '/admin/financials/payments',
    }));

    pushCategory('settlements', 'Financials', 'Settlements', settlements.count, settlements.rows, (r) => ({
      id: r.settlement_id,
      type: 'settlement',
      title: r.settlement_number || `Settlement #${r.settlement_id}`,
      subtitle: r.net_payable != null ? `Net payable: ${r.net_payable}` : '',
      badge: r.status || 'pending',
      meta: `ID: ${r.settlement_id}`,
      route: '/admin/settlements',
    }));

    pushCategory('expenses', 'Financials', 'Expenses', expenses.count, expenses.rows, (r) => ({
      id: r.expense_id,
      type: 'expense',
      title: r.description || r.expense_type || `Expense #${r.expense_id}`,
      subtitle: [r.trip?.trip_number, r.amount != null ? `Amount: ${r.amount}` : null].filter(Boolean).join(' · '),
      badge: 'expense',
      meta: `ID: ${r.expense_id}`,
      route: r.trip?.trip_id ? `/admin/trips/${r.trip.trip_id}` : '/admin/financials/advances',
    }));

    pushCategory('admins', 'Other', 'Admin Users', admins.count, admins.rows, (r) => ({
      id: r.admin_id,
      type: 'admin',
      title: r.full_name || r.username,
      subtitle: [r.email, r.role].filter(Boolean).join(' · '),
      badge: r.role || 'admin',
      meta: `ID: ${r.admin_id}`,
      route: '/admin',
    }));

    const totalResults = categories.reduce((sum, c) => sum + (c.count || 0), 0);

    return res.json({
      success: true,
      query: term,
      page,
      limit,
      totalResults,
      categories,
    });
  } catch (err) {
    console.error('Global search error:', err);
    return res.status(500).json({ success: false, message: 'Global search failed' });
  }
});

/**
 * ===============================
 * Manual Order Creation API
 * ===============================
 *
 * POST /api/admin/orders/manual
 *   Create a manual order (phone/offline booking) directly.
 *   This is the primary entry point for the "Create Order" button in
 *   the Admin Order / Trip Master.
 *
 * GET /api/admin/orders/manual/lookups
 *   Get lookup data for the manual order form (clients, vehicles, etc.)
 */

// @route   POST /api/admin/orders/manual
// @desc    Create a manual order from admin phone/offline booking
// @access  Private (Admin)
router.post('/orders/manual', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const ManualOrderService = require('../services/ManualOrderService');
    const service = new ManualOrderService();

    const result = await service.createManualOrder(req.body || {}, {
      adminId: req.user.user_id,
      adminName: req.user.full_name || req.user.username || 'Administrator',
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    const statusCode = result.data && result.data.idempotent ? 200 : 201;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('Create manual order error:', err);
    if (err?.name === 'ValidationError' || err?.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err?.name === 'NotFoundError' || err?.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, message: err.message });
    }
    // Prisma unique violation on any unique constraint (e.g. concurrent duplicate)
    if (err?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A duplicate order was detected. Please refresh and check the order list.',
      });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/orders/manual/lookups
// @desc    Get lookup data for manual order form (clients, vehicles, drivers, owners)
// @access  Private (Admin)
router.get('/orders/manual/lookups', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { search = '', limit = 50 } = req.query;

    const [clients, vehicles, drivers, owners] = await Promise.all([
      // Clients (offline corporate clients)
      prisma.client.findMany({
        where: {
          deleted_at: null,
          is_active: true,
          ...(search ? {
            OR: [
              { company_name: { contains: search, mode: 'insensitive' } },
              { client_code: { contains: search, mode: 'insensitive' } },
              { contact_person: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ]
          } : {})
        },
        select: {
          client_id: true,
          client_code: true,
          company_name: true,
          contact_person: true,
          phone: true,
          email: true,
          city: true,
          state: true,
          gst_number: true,
        },
        orderBy: { company_name: 'asc' },
        take: parseInt(limit),
      }),

      // Available vehicles
      prisma.transportVehicle.findMany({
        where: {
          current_status: { notIn: ['maintenance', 'off_road'] },
          is_available: true,
          ...(search ? {
            OR: [
              { vehicle_number: { contains: search, mode: 'insensitive' } },
              { vehicle_name: { contains: search, mode: 'insensitive' } },
              { vehicle_type: { contains: search, mode: 'insensitive' } },
            ]
          } : {})
        },
        select: {
          vehicle_id: true,
          vehicle_number: true,
          vehicle_name: true,
          vehicle_type: true,
          capacity_kg: true,
          current_status: true,
          owner_id: true,
        },
        orderBy: { vehicle_type: 'asc' },
        take: parseInt(limit),
      }),

      // Available drivers with their vehicles
      prisma.driver.findMany({
        where: {
          is_available: true,
          status: { not: 'inactive' },
          current_vehicle_id: { not: null }, // Only drivers with registered vehicles
          ...(search ? {
            OR: [
              { driver_name: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search, mode: 'insensitive' } },
              { driver_code: { contains: search, mode: 'insensitive' } },
            ]
          } : {})
        },
        select: {
          driver_id: true,
          driver_code: true,
          driver_name: true,
          mobile: true,
          vehicle_type: true,
          vehicle_number: true,
          currentVehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_type: true,
              vehicle_name: true,
              capacity_kg: true,
            }
          },
          transportOwner: {
            select: {
              owner_id: true,
              owner_name: true,
              company_name: true,
            }
          },
        },
        orderBy: { driver_name: 'asc' },
        take: parseInt(limit),
      }),

      // Transport owners
      prisma.vehicleOwner.findMany({
        where: {
          status: 'active',
          deleted_at: null,
          ...(search ? {
            OR: [
              { owner_name: { contains: search, mode: 'insensitive' } },
              { company_name: { contains: search, mode: 'insensitive' } },
              { owner_code: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ]
          } : {})
        },
        select: {
          owner_id: true,
          owner_code: true,
          owner_name: true,
          company_name: true,
          mobile: true,
          city: true,
        },
        orderBy: { owner_name: 'asc' },
        take: parseInt(limit),
      }),
    ]);

    // Vehicle types for dropdown
    const vehicleTypes = [
      'Truck', 'Tata Ace', 'Tempo', 'Pickup', 'Container',
      'Trailer', 'Mini Truck', 'LCV', 'HCV', 'Multi-Axle'
    ];

    // Goods categories for dropdown
    const goodsCategories = [
      'General Cargo', 'Industrial Goods', 'Construction Material',
      'Agricultural Products', 'Automobile Parts', 'Chemicals',
      'Electronics', 'Furniture', 'Machinery', 'Pipes & Fittings',
      'Steel & Metal', 'Textiles', 'Food Products', 'Pharmaceuticals',
      'Other'
    ];

    // Rate types for dropdown
    const rateTypes = [
      { value: 'per_trip', label: 'Per Trip' },
      { value: 'per_ton', label: 'Per Ton' },
      { value: 'per_km', label: 'Per KM' },
      { value: 'fixed', label: 'Fixed Freight' },
    ];

    // GST types
    const gstTypes = [
      { value: 'FORWARD_CHARGE', label: 'Forward Charge' },
      { value: 'RCM', label: 'Reverse Charge (RCM)' },
      { value: 'EXEMPT', label: 'Exempt' },
    ];

    // Payment terms
    const paymentTerms = [
      { value: 'full_advance', label: 'Full Payment in Advance' },
      { value: 'booking_advance_balance', label: 'Booking Amount + Advance After Loading + Balance at Unloading' },
      { value: 'custom', label: 'Custom Schedule' },
    ];

    return res.json({
      success: true,
      data: {
        clients,
        vehicles,
        drivers,
        owners,
        vehicleTypes,
        goodsCategories,
        rateTypes,
        gstTypes,
        paymentTerms,
      }
    });
  } catch (err) {
    console.error('Manual order lookups error:', err.code || err.name, err.message);
    if (isDatabaseConnectionError(err)) {
      return res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable. Please try again shortly.',
        errorCode: 'SERVICE_UNAVAILABLE',
      });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;


