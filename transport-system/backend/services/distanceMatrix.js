/**
 * distanceMatrix.js
 * ---------------------------------------------------------------------------
 * The repository's SINGLE Google Maps backend integration.
 *
 * It used to live inline inside controllers/mapsController.js. Phase 5 needs
 * the same thing for two purposes — trip pricing and trip ETA — and the
 * specification forbids a second provider. So the existing implementation was
 * MOVED here, unchanged, and mapsController now imports it. One key, one HTTP
 * client, one error shape, one place to change.
 *
 * The API key is read from the SERVER environment and is never returned to a
 * browser. Nothing in this module writes to a response object.
 */

const axios = require('axios');

const GOOGLE_API_BASE = 'https://maps.googleapis.com/maps/api';

/**
 * Human-readable duration, e.g. "2 hours 15 mins".
 * @param {number} durationSeconds
 * @returns {string}
 */
function formatDuration(durationSeconds) {
  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hours ${minutes} mins`;
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
    typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
  );
}

/**
 * Google Distance Matrix lookup.
 *
 * Throws on any non-OK status. Callers decide what an unanswerable question
 * means — they must never substitute a made-up number.
 *
 * @param {{pickup:{lat:number,lng:number}, drop:{lat:number,lng:number}, apiKey:string}} params
 * @returns {Promise<{distanceKm:number, duration:string, distanceMeters:number, durationSeconds:number}>}
 */
async function calculateDistanceMatrix({ pickup, drop, apiKey }) {
  const url = `${GOOGLE_API_BASE}/distancematrix/json`;

  const response = await axios.get(url, {
    params: {
      origins: `${pickup.lat},${pickup.lng}`,
      destinations: `${drop.lat},${drop.lng}`,
      mode: 'driving',
      units: 'metric',
      key: apiKey,
    },
    timeout: 15000,
  });

  const data = response.data;

  if (data.status !== 'OK') {
    throw new Error(`Google Distance Matrix status: ${data.status}`);
  }

  const element = data.rows?.[0]?.elements?.[0];
  const elementStatus = element?.status;

  if (elementStatus !== 'OK') {
    throw new Error(`Google Distance Matrix element status: ${elementStatus}`);
  }

  const distanceMeters = element.distance.value;
  const durationSeconds = element.duration.value;

  const distanceKm = Math.round(distanceMeters / 1000);
  const duration = formatDuration(durationSeconds);

  return { distanceKm, duration, distanceMeters, durationSeconds };
}

/**
 * Is a server-side Google key configured at all?
 * @returns {boolean}
 */
function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

module.exports = {
  GOOGLE_API_BASE,
  formatDuration,
  isValidLatLng,
  calculateDistanceMatrix,
  isGoogleConfigured,
};
