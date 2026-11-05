/**
 * driverEnquiryController
 * ---------------------------------------------------------------------------
 * DRIVER-facing enquiry endpoints.
 *
 * WHAT A DRIVER MAY DO WITH AN ENQUIRY
 *   • see the job assigned to them (route, load, schedule, their own vehicle)
 *   • report an issue
 *   • request to be replaced
 *
 * WHAT A DRIVER MAY NEVER DO
 *   • cancel or unassign themselves from a customer booking
 *   • read or change final_quoted_price (the customer-facing contract)
 *   • read the customer's mobile, email or address
 *   • change the admin's assignment
 *
 * There is deliberately no `cancel` or `update-price` route here. A driver who
 * needs out raises a request and an admin decides — see
 * EnquiryService.driverRequestReassignment. Absence of the endpoint IS the
 * enforcement; the service methods it calls are request-only by construction.
 *
 * Identity is always derived from the authenticated JWT (req.user.user_id →
 * Driver.user_id), never from a posted or queried driver id.
 */

const asyncHandler = require('../middleware/asyncHandler');
const { prisma } = require('../config/prisma');
const enquiryService = require('../services/EnquiryService');
const { toDriverEnquiry } = require('../dtos/EnquiryDTO');
const { ForbiddenError, NotFoundError, ValidationError } = require('../utils/AppError');
const { logger } = require('../utils/logger');

/**
 * Resolve the authenticated driver from the JWT.
 * @param {import('express').Request} req
 * @returns {Promise<{driverId:number, driverName:string}>}
 */
async function driverFrom(req) {
  if (!req.user || !req.user.user_id) {
    throw new ForbiddenError({ message: 'Driver authentication required' });
  }

  const driver = await prisma.driver.findFirst({
    where: { user_id: req.user.user_id },
    select: { driver_id: true, driver_name: true, status: true },
  });

  if (!driver) {
    throw new ForbiddenError({ message: 'Driver profile not found for this account' });
  }
  if (String(driver.status || '').toLowerCase() === 'inactive') {
    throw new ForbiddenError({ message: 'This driver account is inactive' });
  }

  return { driverId: driver.driver_id, driverName: driver.driver_name };
}

/**
 * GET /api/driver/me/enquiries
 * The enquiries assigned to the authenticated driver.
 */
const listMyEnquiries = asyncHandler(async (req, res) => {
  const driver = await driverFrom(req);

  const where = { assigned_driver_id: driver.driverId };
  if (req.query.status) where.status = req.query.status;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.page_size) || 20));

  const [rows, total] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      include: {
        customer: { select: { first_name: true } },
        assignedVehicle: {
          select: { vehicle_id: true, vehicle_number: true, vehicle_type: true },
        },
      },
      orderBy: [{ pickup_date: 'asc' }, { enquiry_id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.enquiry.count({ where }),
  ]);

  res.json({
    success: true,
    data: rows.map(toDriverEnquiry),
    pagination: {
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

/**
 * GET /api/driver/me/enquiries/:id
 * One assigned job.
 */
const getMyEnquiry = asyncHandler(async (req, res) => {
  const driver = await driverFrom(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError({ message: 'Invalid enquiry id' });
  }

  const enquiry = await prisma.enquiry.findUnique({
    where: { enquiry_id: id },
    include: {
      customer: { select: { first_name: true } },
      assignedVehicle: {
        select: { vehicle_id: true, vehicle_number: true, vehicle_type: true },
      },
    },
  });

  if (!enquiry) throw new NotFoundError({ message: 'Enquiry not found' });

  // SECURITY: a driver may only read an enquiry assigned to them.
  if (enquiry.assigned_driver_id !== driver.driverId) {
    throw new ForbiddenError({ message: 'This enquiry is not assigned to you' });
  }

  res.json({ success: true, data: toDriverEnquiry(enquiry) });
});

/**
 * POST /api/driver/me/enquiries/:id/report-issue
 */
const reportIssue = asyncHandler(async (req, res) => {
  const driver = await driverFrom(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError({ message: 'Invalid enquiry id' });
  }

  const result = await enquiryService.driverReportIssue(id, driver, {
    description: req.body?.description,
    category: req.body?.category,
    severity: req.body?.severity,
  });

  logger.info(
    { enquiryId: id, driverId: driver.driverId, category: req.body?.category },
    'enquiry.driver_issue_reported'
  );

  res.status(201).json({
    success: true,
    message: 'Issue reported. Bihar Transport dispatch has been notified.',
    data: { enquiry_id: id, event_id: result.event?.enquiry_event_id || null },
  });
});

/**
 * POST /api/driver/me/enquiries/:id/request-reassignment
 *
 * The ONLY way a driver can step away from a customer booking. This creates a
 * request for an admin; it does not change the assignment or the status.
 */
const requestReassignment = asyncHandler(async (req, res) => {
  const driver = await driverFrom(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError({ message: 'Invalid enquiry id' });
  }

  const result = await enquiryService.driverRequestReassignment(id, driver, {
    reason: req.body?.reason,
    category: req.body?.category,
  });

  logger.info(
    { enquiryId: id, driverId: driver.driverId, category: req.body?.category },
    'enquiry.driver_reassignment_requested'
  );

  res.status(201).json({
    success: true,
    message:
      'Reassignment requested. An administrator will review it — your booking stays active until then.',
    data: { enquiry_id: id, event_id: result.event?.enquiry_event_id || null },
  });
});

module.exports = {
  driverFrom,
  listMyEnquiries,
  getMyEnquiry,
  reportIssue,
  requestReassignment,
};
