/**
 * placesService.js
 * ---------------------------------------------------------------------------
 * Google Places access for the CUSTOMER booking surfaces.
 *
 * WHY THIS EXISTS
 * ---------------
 * The web frontend calls the Google Maps JavaScript API from the browser, so
 * its Places key is a browser-exposed (restricted) key. A React Native app has
 * no browser and must never ship a Maps key inside the bundle — an app binary
 * is trivially inspectable. So the mobile client reaches the SAME provider
 * through the server, exactly the way `services/distanceMatrix.js` already
 * reaches Google for distances: one key, one place to change it.
 *
 * This is the SAME Google provider and the SAME `GOOGLE_MAPS_API_KEY` the
 * backend already uses. No second geocoding service is introduced.
 *
 * The API key is read from the SERVER environment and is never returned to a
 * client. Nothing in this module writes to a response object.
 */

const axios = require('axios');

const { GOOGLE_API_BASE } = require('./distanceMatrix');

/** Places Autocomplete is a legacy endpoint; it is stable and free of the
 *  per-session billing that the newer (New) Places API needs. The backend
 *  already speaks the legacy Distance Matrix API, so both are consistent. */
const PLACES_AUTOCOMPLETE_URL = `${GOOGLE_API_BASE}/place/autocomplete/json`;
const PLACES_DETAILS_URL = `${GOOGLE_API_BASE}/place/details/json`;

/** Google's own guidance for an autocomplete query. */
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;

/** Upper bound on returned predictions. */
const MAX_RESULTS = 10;

/**
 * Is a server-side Google key configured at all?
 * @returns {boolean}
 */
function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * Normalise a user-entered search term.
 *
 * @param {unknown} value
 * @returns {string|null} the trimmed term, or null when it is unusable
 */
function normalizeQuery(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length < MIN_QUERY_LENGTH) return null;
  return str.slice(0, MAX_QUERY_LENGTH);
}

/**
 * Normalise a region bias (e.g. "in" for India).
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
function normalizeRegion(value) {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim().toLowerCase();
  if (!str) return undefined;
  // Google's `region` filter takes a ccTLD ("in", "uk") or a region code.
  return /^[a-z]{2}$/.test(str) ? str : undefined;
}

/**
 * Is this a usable WGS-84 coordinate pair?
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidLatLng(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * Map one Google prediction onto the small, stable shape the client consumes.
 *
 * @param {object} prediction
 * @returns {{placeId:string,label:string,mainText:string,secondaryText:string}}
 */
function toPrediction(prediction) {
  const structured = prediction.structured_formatting || {};
  const mainText = structured.main_text || prediction.description || '';
  const secondaryText = structured.secondary_text || '';

  return {
    placeId: prediction.place_id || '',
    label: prediction.description || mainText,
    mainText,
    secondaryText,
  };
}

/**
 * Google Places Autocomplete (proxy).
 *
 * Throws on any non-OK status. Callers decide what an unanswerable question
 * means — they must never substitute a made-up place.
 *
 * @param {{input:string, region?:string, apiKey:string}} params
 * @returns {Promise<Array<{placeId:string,label:string,mainText:string,secondaryText:string}>>}
 */
async function autocompletePlaces({ input, region, apiKey }) {
  const response = await axios.get(PLACES_AUTOCOMPLETE_URL, {
    params: {
      input,
      // Bias the results towards the country the customer is actually in.
      components: 'country:IN',
      ...(region ? { region } : {}),
      key: apiKey,
    },
    timeout: 15000,
  });

  const data = response.data;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places status: ${data.status}`);
  }

  const predictions = Array.isArray(data.predictions) ? data.predictions : [];
  return predictions.slice(0, MAX_RESULTS).map(toPrediction);
}

/**
 * Google Place Details (proxy).
 *
 * @param {{placeId:string, apiKey:string}} params
 * @returns {Promise<{placeId:string,name:string,address:string,lat:number,lng:number}>}
 */
async function getPlaceDetails({ placeId, apiKey }) {
  const response = await axios.get(PLACES_DETAILS_URL, {
    params: {
      place_id: placeId,
      fields: 'place_id,name,formatted_address,geometry,address_components',
      key: apiKey,
    },
    timeout: 15000,
  });

  const data = response.data;

  if (data.status !== 'OK') {
    throw new Error(`Google Place Details status: ${data.status}`);
  }

  const result = data.result || {};
  const location = result.geometry?.location;

  if (!isValidLatLng(location?.lat, location?.lng)) {
    throw new Error('Google Place Details returned no usable coordinates');
  }

  return {
    placeId: result.place_id || placeId,
    name: result.name || '',
    address: result.formatted_address || '',
    lat: location.lat,
    lng: location.lng,
  };
}

module.exports = {
  PLACES_AUTOCOMPLETE_URL,
  PLACES_DETAILS_URL,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  isGoogleConfigured,
  normalizeQuery,
  normalizeRegion,
  isValidLatLng,
  toPrediction,
  autocompletePlaces,
  getPlaceDetails,
};
