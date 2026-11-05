/**
 * Vehicle RC lookup controller.
 *
 * Exposes the backend-only proxy to the Parse CarInfo API:
 *   GET /api/vehicles/lookup?vehicleNumber=UP14ET4166
 *
 * The Parse API key lives in the backend env (`PARSE_API_KEY`) and is never
 * sent to, or readable by, the browser. Errors are thrown as AppError
 * subclasses and shaped by the shared errorHandler middleware.
 *
 * Response contract:
 *   {
 *     success: true,
 *     found: true,
 *     vehicleNumber: "UP14ET4166",
 *     data: { vehicleName, make, model, vehicleType, isTwoWheeler,
 *             registrationDate, manufacturingYear, insuranceExpiry,
 *             insuranceExpired, insuranceExpiringSoon, pollutionExpiry,
 *             pollutionCertificateExpired, rto, rtoCode, rtoState, rcMakeModel },
 *     fieldsFound: ["vehicleName", "make", ...],
 *     vehicleIdentityVerified: false,
 *     warnings: [{ code, message }]
 *   }
 *
 * `vehicleName` / `make` / `model` are null unless the upstream payload carries
 * corroborating identity evidence, so an unverified `make_model` string is never
 * presented as this vehicle's real identity. See services/vehicleLookupService.js.
 *
 * The raw upstream payload is intentionally NOT forwarded to the client.
 */

const asyncHandler = require('../middleware/asyncHandler');
const {
  lookupVehicleByRegistration,
  isVehicleLookupConfigured,
} = require('../services/vehicleLookupService');

/**
 * @route   GET /api/vehicles/lookup
 * @access  Private (admin)
 * @query   {string}  vehicleNumber  Indian RC number, e.g. BR09AB1234
 * @query   {boolean} refresh        Bypass the short-lived lookup cache
 */
const lookupVehicle = asyncHandler(async (req, res) => {
  // Accept both camelCase (documented) and snake_case (Parse-style) params.
  const requestedNumber = req.query.vehicleNumber ?? req.query.vehicle_number;

  const {
    vehicleNumber, data, fieldsFound, vehicleIdentityVerified, warnings,
  } = await lookupVehicleByRegistration(requestedNumber, {
    bypassCache: req.query.refresh === 'true' || req.query.refresh === '1',
  });

  return res.json({
    success: true,
    found: true,
    vehicleNumber,
    data,
    fieldsFound,
    vehicleIdentityVerified,
    warnings,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /api/vehicles/lookup/status
 * @access  Private (admin)
 *
 * Lets the admin UI hide the RC-lookup affordance when the server has no
 * Parse key configured, instead of letting the user trigger a 503.
 */
const lookupStatus = asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    found: true,
    data: { configured: isVehicleLookupConfigured() },
    timestamp: new Date().toISOString(),
  });
});

module.exports = { lookupVehicle, lookupStatus };
