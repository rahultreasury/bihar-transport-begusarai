/**
 * vehicleHireRoutes.js
 * ---------------------------------------------------------------------------
 * THE UNIVERSAL VEHICLE HIRE API — one module, mounted once.
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *
 * There is deliberately no `/contract-hire` and no `/commission-hire`. Both are
 * the same screen and the same record; "Billing To" decides which one a hire is,
 * and the business model is derived from it server-side.
 *
 * EVERY ROUTE IS BEHIND THE EXISTING AUTH MIDDLEWARE
 *   `protect` + `adminOnly` — the exact pair the rest of the trip module uses.
 *   No new permission system, no new role vocabulary. A customer, driver or
 *   partner token is refused with 403 here exactly as it is everywhere else.
 *
 * THE CLIENT NEVER SENDS MONEY
 *   No endpoint accepts `gross_hire`, `commission_amount` or
 *   `net_vendor_payable`. The browser sends rate INPUTS; the service computes
 *   all three figures and stores them. `POST /preview` runs the SAME code path
 *   as `POST /` with nothing written, so the summary card the operator verifies
 *   before saving is produced by the identical calculation.
 *
 * SHARING
 *   The challan is served as a PDF and the same bytes can be handed to the Web
 *   Share API or WhatsApp by the browser. Sharing is a client concern — the
 *   server exposes one stable, re-downloadable document, not a second
 *   "shared copy".
 */

const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const VehicleHireWorkflowService = require('../services/VehicleHireWorkflowService');
const TripVehicleAssignmentService = require('../services/TripVehicleAssignmentService');
const TripProvisioningService = require('../services/TripProvisioningService');
const { renderVehicleHireChallanPdf } = require('../services/VehicleHireChallanPdf');
const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../utils/AppError');

const service = new VehicleHireWorkflowService();

// THE ONE assignment writer. The Enquiry controller constructs its own instance
// of this same class and calls the same `assign()` — there is deliberately no
// second implementation of assignment logic behind either screen.
const assignmentService = new TripVehicleAssignmentService();
const provisioningService = new TripProvisioningService();

/**
 * Shared error shape, matching tripRoutes' `sendOperationalError`, so a blocked
 * hire comes back as a 400/403/404 with the service's own message instead of a
 * blanket 500. A deliberate refusal must never look like an outage.
 */
function sendHireError(res, error, logLabel) {
  console.error(logLabel, error);
  if (error instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      message: error.message,
      ...(error.details?.length ? { blockers: error.details } : {}),
    });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  if (error instanceof ConflictError) {
    return res.status(409).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || 'Server error' });
}

/** Parse and validate a numeric path parameter. */
function readId(req, res) {
  const id = Number.parseInt(req.params.tripId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Invalid trip id' });
    return null;
  }
  return id;
}

// ===========================================================================
// CATALOGUE — what the page is allowed to offer
// ===========================================================================
/**
 * GET /api/vehicle-hire/catalogue
 *
 * Billing parties, rate bases, commission types, the document list and the
 * warning window, all read from config/vehicleHirePolicy.js. The page renders
 * its options from here, so it can never offer a choice the backend would
 * reject.
 */
router.get('/catalogue', protect, adminOnly, (req, res) => {
  res.json({
    success: true,
    data: service.getCatalogue({
      // Whether THIS operator may override the derived business model / hire a
      // vehicle with an expired critical document.
      can_override_business_model: service
        .getCatalogue().business_model_override_roles.includes(req.user?.role),
      can_override_expired_documents: service
        .getCatalogue().expired_document_override_roles.includes(req.user?.role),
      viewer_role: req.user?.role || null,
    }),
  });
});

// ===========================================================================
// THE OPERATIONAL LIST
// ===========================================================================
/**
 * GET /api/vehicle-hire/trips
 *
 * The Vehicle Hire page's data source: real trips joined to real `vehicle_hires`
 * rows, with hire eligibility and the three money figures read from their own
 * stored columns.
 *
 * Filters: view (waiting|hired|all), search, trip_date, vehicle_type,
 * business_model, page, limit.
 */
router.get('/trips', protect, adminOnly, async (req, res) => {
  try {
    const view = String(req.query.view || 'waiting').toLowerCase();
    if (!['waiting', 'hired', 'all'].includes(view)) {
      return res.status(400).json({ success: false, message: `Invalid view: ${view}` });
    }

    const result = await service.listTrips({ ...req.query, view });
    res.json({
      success: true,
      data: result.rows,
      counts: result.counts,
      pagination: result.pagination,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire list error:');
  }
});

// ===========================================================================
// LOOKUPS — the searchable selectors, from the EXISTING masters
// ===========================================================================
/**
 * GET /api/vehicle-hire/lookups?search=&owner_id=
 *
 * Real database rows only. No hardcoded vehicles, vendors or drivers anywhere
 * in this module.
 */
router.get('/lookups', protect, adminOnly, async (req, res) => {
  // `trip_id` is optional. When the page knows which consignment it is booking,
  // passing it makes the selectors return resources already annotated with
  // AVAILABLE / BUSY / CONFLICT / UNAVAILABLE for THAT pickup, ordered vacant
  // first — so the operator sees what they can actually use at the top.
  try {
    const data = await service.getLookups({
      search: req.query.search || '',
      ownerId: req.query.owner_id ? Number.parseInt(req.query.owner_id, 10) : null,
      limit: req.query.limit,
      tripId: req.query.trip_id || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire lookups error:');
  }
});

/**
 * GET /api/vehicle-hire/vehicles/:id
 *
 * One vehicle with its REAL document expiries and its owner's details, so
 * selecting a vehicle auto-populates the vendor block and refreshes the
 * document panel in a single call.
 */
router.get('/vehicles/:id', protect, adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid vehicle id' });
  }
  try {
    res.json({ success: true, data: await service.getVehicleDetail(id) });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire vehicle detail error:');
  }
});

/** GET /api/vehicle-hire/vendors/:id — one vendor with their vehicles + drivers. */
router.get('/vendors/:id', protect, adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid vendor id' });
  }
  try {
    res.json({ success: true, data: await service.getVendorDetail(id) });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire vendor detail error:');
  }
});

/** GET /api/vehicle-hire/drivers/:id — one driver with their vendor. */
router.get('/drivers/:id', protect, adminOnly, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid driver id' });
  }
  try {
    res.json({ success: true, data: await service.getDriverDetail(id) });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire driver detail error:');
  }
});

// ===========================================================================
// THE PAGE CONTEXT
// ===========================================================================
// ===========================================================================
// PROVISIONING — make a confirmed order reachable from Vehicle Hire
// ===========================================================================
/**
 * POST /api/vehicle-hire/provision
 *
 * Returns the ONE operational Trip for a consignment, creating it if it does not
 * have one yet. Two callers, one behaviour:
 *
 *   • ENQUIRY THAT IS NOT YET ACCEPTED — the reservation path. The Booking does
 *     not exist at that point, so the trip is anchored on `trips.enquiry_id`
 *     (migration 20261003120000). This is what makes it possible to assign a
 *     vehicle and a driver BEFORE finalising the quote, so the customer receives
 *     the price and the truck together instead of being told to wait afterwards.
 *     It is linked to the Booking at acceptance, so a consignment still has
 *     exactly ONE operational trip across its whole life.
 *   • CONFIRMED ORDER WITH NO TRIP — the historical compatibility path. Orders
 *     confirmed before trips were provisioned are brought into the Vehicle Hire
 *     workflow rather than being hidden from it.
 *
 * IDEMPOTENT, in the database as well as in the application. A partial UNIQUE
 * index on `trips.enquiry_id` and the existing "one trip per booking" rule make a
 * duplicate trip impossible to commit, so a retried request converges on one row
 * rather than racing two. It never modifies an existing assignment, never
 * overwrites a trip, and never touches hire money or any financial row.
 *
 * Body: { booking_id } or { enquiry_id } (or neither, to sweep all confirmed
 * orders that are missing a trip).
 */
router.post('/provision', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = Number.parseInt(req.body?.booking_id, 10);
    const enquiryId = Number.parseInt(req.body?.enquiry_id, 10);

    // ── Targeted: one specific consignment ────────────────────────────────
    if (Number.isInteger(bookingId) && bookingId > 0) {
      const { trip, created } = await provisioningService.ensureTripForBooking(bookingId);
      // Carry the order's existing vehicle/driver onto the new trip so an
      // already-assigned consignment shows as VEHICLE ASSIGNED, not blank.
      const assignment = await assignmentService.assign(
        { tripId: trip.trip_id },
        { vehicle_id: trip.vehicle_id ?? undefined, driver_id: trip.driver_id ?? undefined },
        req.user
      );
      return res.json({ success: true, data: { trip, created, assignment } });
    }

    if (Number.isInteger(enquiryId) && enquiryId > 0) {
      // THE PRE-ACCEPTANCE RESERVATION PATH.
      //
      // A vehicle and driver are now assigned BEFORE the customer accepts, so
      // this must work for an enquiry that has no order yet. `ensureTripForEnquiry`
      // creates (or returns) the ONE reservation trip anchored on trips.enquiry_id
      // and links it to the Booking the moment acceptance creates one.
      //
      // It is idempotent in the DATABASE, not merely in the application: the
      // partial UNIQUE index on trips.enquiry_id makes a second reservation trip
      // for the same enquiry impossible, so a double-click cannot produce two.
      const result = await provisioningService.ensureTripForEnquiry(enquiryId);
      const assignment = result?.trip?.trip_id
        ? await assignmentService.getCurrentAssignment({ tripId: result.trip.trip_id })
        : null;
      return res.json({ success: true, data: { ...result, assignment } });
    }

    // ── Sweep: every confirmed order that is missing its trip ─────────────
    const confirmed = await provisioningService.prisma.booking.findMany({
      where: { quote_status: 'ACCEPTED', trips: { none: {} } },
      select: { booking_id: true },
    });

    const provisioned = [];
    const skipped = [];
    for (const b of confirmed) {
      try {
        const { trip, created } = await provisioningService.ensureTripForBooking(b.booking_id);
        provisioned.push({ booking_id: b.booking_id, trip_id: trip.trip_id, trip_number: trip.trip_number, created });
      } catch (err) {
        skipped.push({ booking_id: b.booking_id, reason: err.message });
      }
    }

    return res.json({
      success: true,
      data: {
        scanned: confirmed.length,
        provisioned_count: provisioned.length,
        skipped_count: skipped.length,
        provisioned,
        skipped,
      },
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire provisioning error:');
  }
});

/**
 * GET /api/vehicle-hire/assignment?booking_id= | ?enquiry_id=
 *
 * The SAME canonical assignment read, addressed by order or enquiry instead of
 * by trip.
 *
 * WHY IT EXISTS
 *   The Enquiry page knows its booking and enquiry ids, not the trip id. Without
 *   this endpoint it would have to guess the trip or re-implement the resolution
 *   rules — and re-implementing them is exactly how the two screens drifted
 *   apart in the first place. It calls the identical
 *   `TripVehicleAssignmentService` with a different key, so the enquiry card
 *   and the Vehicle Hire page cannot disagree.
 *
 *   Returns `{ data: null }` with HTTP 200 when the consignment has no
 *   operational trip yet, so the enquiry page can render an honest "not
 *   provisioned" state instead of treating it as an error.
 */
router.get('/assignment', protect, adminOnly, async (req, res) => {
  try {
    const bookingId = Number.parseInt(req.query.booking_id, 10);
    const enquiryId = Number.parseInt(req.query.enquiry_id, 10);

    if (!Number.isInteger(bookingId) && !Number.isInteger(enquiryId)) {
      return res.status(400).json({
        success: false,
        message: 'Provide booking_id or enquiry_id',
      });
    }

    const assignment = await assignmentService.getCurrentAssignment({
      bookingId: Number.isInteger(bookingId) ? bookingId : undefined,
      enquiryId: Number.isInteger(enquiryId) ? enquiryId : undefined,
    });

    res.json({ success: true, data: assignment });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.json({ success: true, data: null });
    }
    sendHireError(res, error, 'Vehicle hire assignment lookup error:');
  }
});

/**
 * GET /api/vehicle-hire/trips/:tripId/context
 *
 * Everything the Vehicle Hire page needs to open in one round trip: the trip,
 * the customer, the route, the current status, the vehicle/vendor/driver the
 * trip already carries, that vehicle's real document expiries, the policy
 * catalogue and whether a hire already exists.
 */
router.get('/trips/:tripId/context', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const context = await service.getHireContext(tripId);
    const catalogue = service.getCatalogue();
    res.json({
      success: true,
      data: {
        ...context,
        catalogue: {
          ...catalogue,
          can_override_business_model: catalogue.business_model_override_roles.includes(req.user?.role),
          can_override_expired_documents: catalogue.expired_document_override_roles.includes(req.user?.role),
          viewer_role: req.user?.role || null,
        },
      },
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire context error:');
  }
});

/**
 * GET /api/vehicle-hire/trips/:tripId
 * The existing hire for this trip, or null.
 */
router.get('/trips/:tripId', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    res.json({ success: true, data: await service.getHire(tripId) });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire read error:');
  }
});

// ===========================================================================
// PREVIEW — the server-side calculator behind the summary card
// ===========================================================================
/**
 * POST /api/vehicle-hire/trips/:tripId/preview
 *
 * Computes the whole hire — gross, commission, net — and writes NOTHING. It is
 * the same `_resolveTerms` path the save uses, so what the operator verifies on
 * the page is what gets stored.
 */
router.post('/trips/:tripId/preview', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const summary = await service.previewHire(tripId, req.body || {}, req.user);
    res.json({ success: true, data: summary });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire preview error:');
  }
});

// ===========================================================================
// ASSIGN — the same operation the Enquiry page performs
// ===========================================================================
/**
 * GET /api/vehicle-hire/trips/:tripId/assignment
 *
 * The CURRENT assignment for a consignment, in the exact shape the Enquiry page
 * renders: vehicle, driver, vendor and the derived vehicle-hire status. Reading
 * it here and reading it from the enquiry are guaranteed to agree because both
 * read the same Trip row.
 */
router.get('/trips/:tripId/assignment', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const assignment = await assignmentService.getCurrentAssignment({ tripId });
    res.json({ success: true, data: assignment });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire assignment read error:');
  }
});

/**
 * POST /api/vehicle-hire/trips/:tripId/assign
 *
 * "Assign Vehicle" / "Assign Driver" / "Select Vendor" from the Vehicle Hire
 * page. This is the SAME service call the Enquiry page makes, so an assignment
 * made here is visible on the enquiry immediately and vice versa.
 *
 * It UPDATES the one current assignment on the Trip. It never inserts a second
 * one, and it never touches hire money — completing the hire is the separate
 * POST /trips/:tripId below.
 */
router.post('/trips/:tripId/assign', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const assignment = await assignmentService.assign(
      { tripId },
      req.body || {},
      req.user
    );
    res.json({
      success: true,
      message: 'Assignment updated',
      data: assignment,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire assignment error:');
  }
});

/**
 * PUT /api/vehicle-hire/trips/:tripId/assign
 *
 * The same operation, for clients that prefer PUT for an idempotent update of
 * the current assignment. Identical behaviour by design — one implementation.
 */
router.put('/trips/:tripId/assign', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const assignment = await assignmentService.assign(
      { tripId },
      req.body || {},
      req.user
    );
    res.json({
      success: true,
      message: 'Assignment updated',
      data: assignment,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire assignment error:');
  }
});

// ===========================================================================
// SAVE — completing the hire (the money)
// ===========================================================================
/**
 * POST /api/vehicle-hire/trips/:tripId
 *
 * "Hire Vehicle" / "Complete Hire". Validates, calculates, saves the hire, links
 * it to the existing Trip, moves the trip to VEHICLE HIRED and records the event
 * on the EXISTING trip timeline and audit log — all in one transaction.
 *
 * NOTE the division of labour: `/assign` decides WHO drives; this decides WHAT
 * IS OWED. They are separate because the specification keeps them separate —
 * a customer accepting a quote never implies a vehicle has been hired.
 */
router.post('/trips/:tripId', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const result = await service.hireVehicle(tripId, req.body || {}, req.user);
    res.json({
      success: true,
      message: 'Vehicle hired successfully',
      data: result,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire save error:');
  }
});

/**
 * PUT /api/vehicle-hire/trips/:tripId
 *
 * "Edit Vehicle Hire". UPDATES the one existing hire — it can never create a
 * second. Gross, commission and net are recalculated by the SAME
 * `VehicleHireWorkflowService` calculation the create path uses, and the client
 * still sends only rate inputs, so a tampered request cannot post a net figure.
 *
 * The challan number is deliberately preserved: a challan already handed to a
 * driver must keep identifying the same hire.
 */
router.put('/trips/:tripId', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const result = await service.updateVehicleHire(tripId, req.body || {}, req.user);
    res.json({
      success: true,
      message: 'Vehicle hire updated successfully',
      data: result,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire update error:');
  }
});

// ===========================================================================
// CONFIRM / CANCEL
// ===========================================================================
/**
 * POST /api/vehicle-hire/trips/:tripId/confirm
 *
 * "Confirm Hire". Marks the hire as CONFIRMED and moves the trip to
 * VEHICLE_HIRED status, making it operationally ready for loading.
 * Creates a timeline event and audit log entry.
 */
router.post('/trips/:tripId/confirm', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const result = await service.confirmHire(tripId, req.user);
    res.json({
      success: true,
      message: 'Vehicle hire confirmed successfully',
      data: result,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire confirm error:');
  }
});

/**
 * POST /api/vehicle-hire/trips/:tripId/cancel
 *
 * "Cancel Hire". Marks the hire as CANCELLED and reverts the trip to
 * ASSIGNED status (waiting for vehicle). Creates a timeline event and
 * audit log entry with cancellation reason.
 * Body: { reason }
 */
router.post('/trips/:tripId/cancel', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const result = await service.cancelHire(tripId, req.body || {}, req.user);
    res.json({
      success: true,
      message: 'Vehicle hire cancelled successfully',
      data: result,
    });
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire cancel error:');
  }
});

// ===========================================================================
// CHALLAN
// ===========================================================================
/**
 * GET /api/vehicle-hire/trips/:tripId/challan.pdf
 *
 * "[ Download Challan ]". Rendered with the same pdfkit infrastructure the
 * quotation PDF uses, from the PERSISTED hire row only.
 */
router.get('/trips/:tripId/challan.pdf', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const hire = await service.getHireWithTrip(tripId);
    const pdf = await renderVehicleHireChallanPdf({ hire });

    const safeNumber = String(hire.challan_number || `hire-${hire.hire_id}`).replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeNumber}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) {
    sendHireError(res, error, 'Vehicle hire challan error:');
  }
});

module.exports = router;