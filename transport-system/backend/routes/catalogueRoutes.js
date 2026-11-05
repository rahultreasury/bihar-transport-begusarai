/**
 * catalogueRoutes.js
 * ---------------------------------------------------------------------------
 * Public CUSTOMER catalogue, mounted at /api/catalogue.
 *
 * WHY THIS EXISTS
 * ---------------
 * The per-kilometre vehicle pricing already had exactly one source of truth:
 * `services/vehiclePricing.js` (the file `controllers/mapsController.js` uses
 * to price a quote). It simply had no HTTP surface, so every client that
 * wanted to show the fleet had to copy the numbers — which is precisely how
 * the web app ended up with a second, hand-maintained catalogue in
 * `frontend/src/data/vehicleCatalogue.js`.
 *
 * This route publishes that ONE source of truth so a client can render the
 * fleet, submit the canonical vehicle id, and let the SERVER do the pricing.
 * A NEW namespace: no existing route is touched, renamed or shadowed.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  VEHICLE_PRICING,
  LEGACY_TYPE_FALLBACK,
  getValidVehicleIds,
} = require('../services/vehiclePricing');

const router = express.Router();

/** The catalogue is static and tiny, but it is still a public endpoint. */
const catalogueLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/catalogue/vehicles
 *
 * Returns every vehicle the booking form may offer, with the canonical id the
 * server prices against.
 */
router.get('/vehicles', catalogueLimiter, (req, res) => {
  const vehicles = Object.values(VEHICLE_PRICING).map((vehicle) => ({
    id: vehicle.id,
    name: vehicle.name,
    type: vehicle.type,
    rate: vehicle.rate,
    rate_min: vehicle.min,
    rate_max: vehicle.max,
  }));

  res.json({
    success: true,
    data: {
      vehicles,
      // The legacy generic types the old booking form still sends. They are
      // accepted by `getVehiclePricing()`, so a client may keep sending them.
      legacy_types: Object.keys(LEGACY_TYPE_FALLBACK),
      valid_vehicle_ids: getValidVehicleIds(),
    },
  });
});

module.exports = router;
