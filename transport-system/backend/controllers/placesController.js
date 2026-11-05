/**
 * placesController.js
 * ---------------------------------------------------------------------------
 * Customer-facing place lookup, proxied to Google server-side.
 *
 * The mobile app cannot embed a Maps key, so it asks the backend for place
 * suggestions exactly the way it already asks the backend for a distance
 * (`POST /api/calculate-price`). The provider, the key and the error
 * discipline all come from `services/placesService.js`.
 *
 * The endpoints are PUBLIC on purpose: a customer typing a pickup address is
 * not authenticated yet, and this is the same public surface as the pricing
 * estimate. They are rate limited by the router.
 */

const {
  isGoogleConfigured,
  normalizeQuery,
  normalizeRegion,
  autocompletePlaces,
  getPlaceDetails,
  MIN_QUERY_LENGTH,
} = require('../services/placesService');

/**
 * GET /api/places/autocomplete?q=...&region=in
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const autocompleteHandler = async (req, res) => {
  try {
    const input = normalizeQuery(req.query.q ?? req.query.input);

    if (!input) {
      return res.status(400).json({
        success: false,
        message: `q must be at least ${MIN_QUERY_LENGTH} characters`,
      });
    }

    if (!isGoogleConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Place search is temporarily unavailable. Please type your location.',
      });
    }

    const region = normalizeRegion(req.query.region);
    const predictions = await autocompletePlaces({
      input,
      region,
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
    });

    return res.json({ success: true, data: { predictions } });
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: 'Could not load location suggestions. Please try again.',
    });
  }
};

/**
 * GET /api/places/details?place_id=...
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const placeDetailsHandler = async (req, res) => {
  try {
    const placeId = String(req.query.place_id ?? '').trim();

    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: 'place_id is required',
      });
    }

    if (!isGoogleConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Place lookup is temporarily unavailable. Please type your location.',
      });
    }

    const place = await getPlaceDetails({
      placeId,
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
    });

    return res.json({ success: true, data: place });
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: 'Could not load that location. Please try again.',
    });
  }
};

module.exports = {
  autocompleteHandler,
  placeDetailsHandler,
};
