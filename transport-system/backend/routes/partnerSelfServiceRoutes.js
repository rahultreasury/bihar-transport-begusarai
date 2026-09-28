/**
 * Partner Self-Service Routes
 * Authenticated Partner endpoints for accessing own data
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');
const { protect } = require('../middleware/auth');
const { attachPartner } = require('../middleware/partnerAuth');
const { NotFoundError, ValidationError } = require('../utils/AppError');
const PartnerService = require('../services/PartnerService');
const BookingRepository = require('../repositories/BookingRepository');
const TripService = require('../services/TripService');
const { flattenBookingForPartner, flattenTripForPartner } = require('../utils/BookingMapper');
const { flattenVehicleForPartner } = require('../utils/VehicleMapper');
const { flattenDriverForPartner } = require('../utils/DriverMapper');

const partnerService = new PartnerService();
const bookingRepository = new BookingRepository();
const tripService = new TripService();

/**
 * GET /api/partner/me
 * Get authenticated Partner's profile
 * Middleware chain: protect → attachPartner
 */
router.get('/me', protect, attachPartner, async (req, res) => {
  try {
    // req.partner is attached by attachPartner middleware
    // It contains safe profile fields (no password, no sensitive financial data)
    const partner = req.partner;

    res.json({
      success: true,
      data: {
        partner_id: partner.partner_id,
        partner_code: partner.partner_code,
        partner_name: partner.partner_name,
        owner_name: partner.owner_name,
        company_name: partner.company_name,
        email: partner.email,
        mobile: partner.mobile,
        alternate_mobile: partner.alternate_mobile,
        city: partner.city,
        state: partner.state,
        gst_number: partner.gst_number,
        pan_number: partner.pan_number,
        address: partner.address,
        status: partner.status,
        is_active: partner.is_active,
        available_capacity: partner.available_capacity,
        network_locations: partner.network_locations,
        commission_percentage: partner.commission_percentage,
        commission_type: partner.commission_type,
        fixed_commission: partner.fixed_commission,
        partner_capability: partner.partner_capability,
        created_at: partner.created_at,
        updated_at: partner.updated_at,
      },
    });
  } catch (error) {
    console.error('Partner me error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching partner profile',
    });
  }
});
 
/**
 * GET /api/partner/me/dashboard
 * Get authenticated Partner's dashboard summary
 * Middleware chain: protect → attachPartner
 * Returns only Partner-scoped data (no admin-only internal financials)
 */
router.get('/me/dashboard', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
  
    // Use existing PartnerService which wraps PartnerRepository.getDashboardSummary
    const dashboard = await partnerService.getPartnerDashboard(partnerId);
  
    if (!dashboard) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found',
      });
    }
  
    // Filter out admin-only internal financial fields
    // These are BT internal metrics that Partners should not see
    const {
      totalCustomerRevenue,
      totalOwnerDriverCost,
      totalCommission,
      totalBtMargin,
      // Also exclude root-level duplicate fields that are now nested
      totalBookings,
      activeBookings,
      completedBookings,
      cancelledBookings,
      totalRevenue,
      commissionEarned,
      outstandingBalance,
      advanceGiven,
      fuelAdvance,
      pendingSettlements,
      totalCredit,
      totalDebit,
      totalTrips,
      completedTrips,
      pendingSettlement,
      totalPaid,
      totalAdvance,
      commission,
      ...safeDashboard
    } = dashboard;
  
    // Add vehicle and driver counts using existing repository methods
    const [vehicles, drivers] = await Promise.all([
      partnerService.repo.getSourcedVehicles(partnerId),
      partnerService.repo.getPartnerDrivers(partnerId),
    ]);

    // Fetch recent trips for this partner using existing service method.
    // Reuses PartnerService.getOwnerBookings which queries BookingRepository
    // with partner_id scoping — no new database query is introduced.
    // Results are mapped with flattenBookingForPartner to exclude
    // customer-only financial fields (final_price).
    let recentTrips = [];
    try {
      const recentResult = await partnerService.getOwnerBookings(partnerId, {
        limit: 5,
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      recentTrips = (recentResult.bookings || []).map(b => ({ ...flattenBookingForPartner(b), record_type: 'booking' }));
    } catch (recentErr) {
      // Log but do not fail the entire dashboard if recent trips cannot be loaded.
      console.error('Partner dashboard recentTrips error:', recentErr);
    }

    // Also fetch recent standalone Trip records (Admin-created trips from
    // STEP 5) scoped to this partner's linked VehicleOwner.
    try {
      const recentTripResult = await tripService.getTripsByPartner(partnerId, {
        limit: 5,
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      const standaloneTrips = (recentTripResult.trips || []).map(t => ({ ...flattenTripForPartner(t), record_type: 'trip' }));
      recentTrips = [...recentTrips, ...standaloneTrips]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 5);
    } catch (recentTripErr) {
      // Log but do not fail the entire dashboard if recent trips cannot be loaded.
      console.error('Partner dashboard recentTrips (trips) error:', recentTripErr);
    }

    res.json({
      success: true,
      data: {
        partner: {
          partner_id: dashboard.partner.partner_id,
          partner_code: dashboard.partner.partner_code,
          partner_name: dashboard.partner.partner_name,
          status: dashboard.partner.status,
        },
        operations: {
          totalTrips: dashboard.totalTrips || dashboard.totalBookings || 0,
          activeTrips: dashboard.activeBookings || 0,
          pendingTrips: (dashboard.totalBookings || 0) - (dashboard.activeBookings || 0) - (dashboard.completedBookings || 0) - (dashboard.cancelledBookings || 0),
          completedTrips: dashboard.completedTrips || dashboard.completedBookings || 0,
        },
        fleet: {
          totalVehicles: vehicles.length,
          totalDrivers: drivers.length,
        },
        financials: {
          totalRevenue: dashboard.totalRevenue || 0,
          commission: dashboard.commissionEarned || dashboard.commission || 0,
          totalAdvance: dashboard.totalAdvance || 0,
          totalPaid: dashboard.totalPaid || 0,
          outstandingBalance: dashboard.outstandingBalance || 0,
          pendingSettlement: dashboard.pendingSettlement || dashboard.pendingSettlements || 0,
        },
        recentTrips,
      },
    });
  } catch (error) {
    console.error('Partner dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching partner dashboard',
    });
  }
});

/**
 * GET /api/partner/me/trips
 * Get authenticated Partner's trips (bookings AND standalone trips) list
 * with pagination and filters.
 *
 * Middleware chain: protect → attachPartner
 * SECURITY: Scopes all queries to req.partner.partner_id.
 *
 * Returns a unified list so the Partner Dashboard / Trips page shows both
 * legacy Booking records (partner_id = this partner) AND first-class Trip
 * records whose transport owner is linked to this partner
 * (Trip.transport_owner_id → VehicleOwner.partner_link → Partner).
 */
router.get('/me/trips', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;

    // Build filters from query params, always scoping to this partner
    const filters = {
      partner_id: partnerId,
      page: req.query.page,
      limit: req.query.limit,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      status: req.query.status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      vehicle_id: req.query.vehicle_id,
      driver_id: req.query.driver_id,
      goods_type: req.query.goods_type,
      pickup_city: req.query.pickup_city,
      drop_city: req.query.drop_city,
      price_min: req.query.price_min,
      price_max: req.query.price_max,
      archived: req.query.archived,
    };

    // 1) Existing BookingRepository.listBookings with partner_id filter
    const bookingResult = await bookingRepository.listBookings(filters);
    const bookings = (bookingResult.data || []).map(flattenBookingForPartner);

    // 2) Standalone Trip records scoped to this partner's linked owner
    const tripFilters = {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      search: req.query.search,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
    };
    let trips = [];
    let tripPagination = { page: 1, limit: filters.limit || 20, total: 0, pages: 0 };
    try {
      const tripResult = await tripService.getTripsByPartner(partnerId, tripFilters);
      trips = (tripResult.trips || []).map(flattenTripForPartner);
      tripPagination = tripResult.pagination;
    } catch (tripErr) {
      // Do not fail the entire list if trip lookup errors — log and continue.
      console.error('Partner trips (standalone) error:', tripErr);
    }

    // Merge: bookings first (legacy), then standalone trips. Each item is
    // tagged with a `record_type` so the frontend can render correctly.
    const data = [
      ...bookings.map(b => ({ ...b, record_type: 'booking' })),
      ...trips.map(t => ({ ...t, record_type: 'trip' })),
    ];

    // Combine pagination: bookings are the primary count; trips are additive.
    const pagination = {
      page: bookingResult.pagination?.page || tripPagination.page || 1,
      limit: bookingResult.pagination?.limit || tripPagination.limit || 20,
      total: (bookingResult.pagination?.total || 0) + (tripPagination.total || 0),
      pages: Math.max(bookingResult.pagination?.pages || 0, tripPagination.pages || 0),
    };

    res.json({
      success: true,
      data,
      pagination,
    });
  } catch (error) {
    console.error('Partner trips list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching trips',
    });
  }
});

/**
 * GET /api/partner/me/trips/:id
 * Get authenticated Partner's single trip detail.
 *
 * Accepts either a Booking ID or a Trip ID. The ID is resolved in order:
 *   1. Booking (booking_id) — legacy records
 *   2. Trip (trip_id) — first-class standalone trip records
 *
 * Middleware chain: protect → attachPartner
 * SECURITY: Verifies the record belongs to this partner before returning.
 */
router.get('/me/trips/:id', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
    const id = Number(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid trip ID',
    });
  }

  // 1) Try as a Booking first (legacy path — unchanged behaviour).
  const booking = await bookingRepository.findByIdWithPartnerRelations(id);
  if (booking) {
    // SECURITY: Verify this booking belongs to the authenticated partner
    if (booking.partner_id === partnerId) {
      const data = flattenBookingForPartner(booking);
      return res.json({ success: true, data: { ...data, record_type: 'booking' } });
    }
    // Booking exists but doesn't belong to this partner — fall through to
    // try as a standalone Trip. Booking IDs and Trip IDs can overlap because
    // they use independent auto-increment sequences, so a Trip may share
    // the same numeric ID as a Booking that belongs to another partner.
  }

  // 2) Try as a standalone Trip. Ownership is enforced by scoping the query
  //    to this partner's linked VehicleOwner — a Trip whose transport owner
  //    is NOT linked to this partner will simply not be found (404), which
  //    is the secure behaviour we want (no cross-partner leakage).
  let trip = null;
  try {
    trip = await tripService.getTripById(id);
  } catch (e) {
    // Trip not found — fall through to 404 below
  }

  if (trip && trip.transport_owner_id) {
    const owner = await tripService.getOwnerByPartnerId(partnerId);
    if (!owner || owner.owner_id !== trip.transport_owner_id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: This trip does not belong to your partner account',
      });
    }
    const data = flattenTripForPartner(trip);
    return res.json({ success: true, data: { ...data, record_type: 'trip' } });
  }

  return res.status(404).json({
    success: false,
    message: 'Trip not found',
  });
  } catch (error) {
    console.error('Partner trip detail error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching trip details',
    });
  }
});
 
/**
 * GET /api/partner/me/vehicles
 * Get authenticated Partner's vehicles (sourced fleet) list with pagination and filters
 * Middleware chain: protect → attachPartner
 * SECURITY: Scopes all queries to req.partner.partner_id
 */
router.get('/me/vehicles', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
    
    // Build options from query params, always scoping to this partner
    const options = {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      vehicle_type: req.query.vehicle_type,
      is_available: req.query.is_available === 'true' ? true : req.query.is_available === 'false' ? false : undefined,
    };
    
    // Use existing PartnerService.getSourcedVehicles with partner_id scoping
    const result = await partnerService.getSourcedVehicles(partnerId, options);
    
    // Map to partner-safe format (excludes hourly_rate, per_km_rate)
    const vehicles = result.data.map(flattenVehicleForPartner);
    
    res.json({
      success: true,
      data: {
        vehicles,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner vehicles list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching vehicles',
    });
  }
});

/**
 * GET /api/partner/me/drivers
 * Get authenticated Partner's drivers list with pagination and filters
 * Middleware chain: protect → attachPartner
 * SECURITY: Scopes all queries to req.partner.partner_id
 */
router.get('/me/drivers', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
    
    // Build filters from query params, always scoping to this partner
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      status: req.query.status,
      search: req.query.search,
      availability: req.query.availability,
    };
    
    // Use PartnerService.getPartnerDriversPaginated with partner_id scoping
    const result = await partnerService.getPartnerDriversPaginated(partnerId, filters);
    
    // Map to partner-safe format (excludes financial fields)
    const drivers = result.drivers.map(flattenDriverForPartner);
    
    res.json({
      success: true,
      data: {
        drivers,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner drivers list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching drivers',
    });
  }
});

/**
 * GET /api/partner/me/bookings
 * Get authenticated Partner's bookings list with pagination and filters
 * Middleware chain: protect → attachPartner
 * SECURITY: Scopes all queries to req.partner.partner_id
 */
router.get('/me/bookings', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
    
    // Build filters from query params, always scoping to this partner
    const filters = {
      partner_id: partnerId,
      page: req.query.page,
      limit: req.query.limit,
      sort_by: req.query.sort_by,
      sort_order: req.query.sort_order,
      status: req.query.status,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      search: req.query.search,
      vehicle_id: req.query.vehicle_id,
      driver_id: req.query.driver_id,
      goods_type: req.query.goods_type,
      pickup_city: req.query.pickup_city,
      drop_city: req.query.drop_city,
      price_min: req.query.price_min,
      price_max: req.query.price_max,
      archived: req.query.archived,
    };
    
    // Use existing BookingRepository.listBookings with partner_id filter
    const result = await bookingRepository.listBookings(filters);
    
    // Map to partner-safe format (excludes final_price, includes commission)
    const bookings = result.data.map(flattenBookingForPartner);
    
    res.json({
      success: true,
      data: {
        bookings,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner bookings list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching bookings',
    });
  }
});

/**
 * GET /api/partner/me/financials
 * Get authenticated Partner's financial summary based on PartnerLedger
 * Middleware chain: protect → attachPartner
 * Returns Partner-scoped financial summary using accounting source of truth
 */
router.get('/me/financials', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;

    // Use new PartnerService method that queries PartnerLedger directly
    const financials = await partnerService.getPartnerFinancialSummary(partnerId);

    res.json({
      success: true,
      data: financials,
    });
  } catch (error) {
    console.error('Partner financials error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching financial summary',
    });
  }
});

/**
 * GET /api/partner/me/ledger
 * Get authenticated Partner's ledger entries with pagination and filters
 * Middleware chain: protect → attachPartner
 * Reuses PartnerService.getLedger with Partner-scoped queries
 */
router.get('/me/ledger', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;

    // Build filters from query params
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      transaction_type: req.query.transaction_type,
    };

    // Use existing PartnerService.getLedger with partner_id scoping
    const result = await partnerService.getLedger(partnerId, filters);

    // Filter out admin-only fields from entries (created_by)
    const safeEntries = result.entries.map(entry => {
      const { created_by, is_reversal, reversal_of, ...safeEntry } = entry;
      return safeEntry;
    });

    res.json({
      success: true,
      data: {
        entries: safeEntries,
        summary: result.summary,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner ledger error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching ledger',
    });
  }
});

/**
 * GET /api/partner/me/payments
 * Get authenticated Partner's payments with pagination
 * Middleware chain: protect → attachPartner
 * Reuses PartnerService.getPayments with Partner-scoped queries
 * Preserves payment status - only status === 'paid' represents actual money received
 */
router.get('/me/payments', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;

    // Build filters from query params
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
    };

    // Use existing PartnerService.getPayments with partner_id scoping
    const result = await partnerService.getPayments(partnerId, filters);

    // Filter out admin-only fields (created_by)
    const safePayments = result.payments.map(payment => {
      const { created_by, ...safePayment } = payment;
      return safePayment;
    });

    res.json({
      success: true,
      data: {
        payments: safePayments,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching payments',
    });
  }
});

/**
 * GET /api/partner/me/settlements
 * Get authenticated Partner's monthly settlements with pagination
 * Middleware chain: protect → attachPartner
 * Reuses PartnerService.getSettlements with Partner-scoped queries
 * Does NOT present stale amount_paid/balance_due as actual figures
 */
router.get('/me/settlements', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;

    // Build filters from query params
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
    };

    // Use existing PartnerService.getSettlements with partner_id scoping
    const result = await partnerService.getSettlements(partnerId, filters);

    // Filter to Partner-safe fields only
    const safeSettlements = result.settlements.map(settlement => {
      const { created_by, ...safeSettlement } = settlement;
      // Note: amount_paid and balance_due are stale/placeholder - not presented as actuals
      return safeSettlement;
    });

    res.json({
      success: true,
      data: {
        settlements: safeSettlements,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error('Partner settlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching settlements',
    });
  }
});

/**
 * PATCH /api/partner/me/trips/:id/driver
 * Assign a driver to a trip (Partner self-service).
 *
 * Middleware chain: protect → attachPartner
 *
 * SECURITY:
 * 1. Trip must exist
 * 2. Trip must belong to the authenticated Partner's linked transport owner
 * 3. Driver must exist and belong to the trip's transport owner
 * 4. Trip must be in an assignable state (PENDING or ASSIGNED)
 *
 * Reuses TripService.updateTrip for the actual update and audit logging.
 */
router.patch('/me/trips/:id/driver', protect, attachPartner, async (req, res) => {
  try {
    const partnerId = req.partner.partner_id;
    const tripId = parseInt(req.params.id, 10);
    const { driver_id } = req.body;

    if (isNaN(tripId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trip ID',
      });
    }

    if (!driver_id || isNaN(parseInt(driver_id, 10))) {
      return res.status(400).json({
        success: false,
        message: 'driver_id is required',
      });
    }

    // 1. Verify trip exists
    const trip = await tripService.getTripById(tripId);

    // 2. Verify trip belongs to this partner's linked transport owner
    const owner = await tripService.getOwnerByPartnerId(partnerId);
    if (!owner || owner.owner_id !== trip.transport_owner_id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: This trip does not belong to your partner account',
      });
    }

    // 3. Verify driver exists and belongs to the trip's transport owner
    const driver = await prisma.driver.findUnique({
      where: { driver_id: parseInt(driver_id, 10) },
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    // Driver must belong to the same transport owner as the trip
    if (driver.transport_owner_id !== trip.transport_owner_id) {
      return res.status(403).json({
        success: false,
        message: 'Driver does not belong to the transport owner of this trip',
      });
    }

    // 4. Validate trip state — driver can only be assigned when trip is PENDING or ASSIGNED
    const assignableStatuses = ['PENDING', 'ASSIGNED'];
    if (!assignableStatuses.includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign driver when trip is in ${trip.status} status. Driver assignment is only allowed when the trip is PENDING or ASSIGNED.`,
      });
    }

    // 5. Update trip driver via TripService (includes audit logging)
    const updatedTrip = await tripService.updateTrip(tripId, { driver_id: parseInt(driver_id, 10) });

    // 6. Re-fetch with relations for the response
    const tripWithRelations = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: {
        vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_name: true, vehicle_type: true } },
        driver: { select: { driver_id: true, driver_name: true, mobile: true, license_number: true } },
        transportOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
      },
    });

    const data = flattenTripForPartner(tripWithRelations);

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: { ...data, record_type: 'trip' },
    });
  } catch (error) {
    console.error('Partner assign driver error:', error);
    if (error instanceof NotFoundError) {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error while assigning driver',
    });
  }
});

module.exports = router;