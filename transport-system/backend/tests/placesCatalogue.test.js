/**
 * Unit tests for the customer catalogue and place-lookup endpoints added for
 * the mobile booking screen.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 *
 * NO Google credits are consumed here: every network path is stubbed. The
 * catalogue route is pure data — it is asserted against the SAME
 * `services/vehiclePricing.js` the server prices with, so the two can never
 * drift.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const placesService = require('../services/placesService');
const placesController = require('../controllers/placesController');
const catalogueRouter = require('../routes/catalogueRoutes');
const {
  VEHICLE_PRICING,
  LEGACY_TYPE_FALLBACK,
  getVehiclePricing,
} = require('../services/vehiclePricing');

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal Express-like response double. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

/** Pull the single GET handler off a router stack. */
function handlerFor(router, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path);
  assert.ok(layer, `route ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/* -------------------------------------------------------------------------- */
/* placesService — pure helpers                                               */
/* -------------------------------------------------------------------------- */

describe('placesService helpers', () => {
  test('normalizeQuery rejects a term that is too short or empty', () => {
    assert.equal(placesService.normalizeQuery(''), null);
    assert.equal(placesService.normalizeQuery('   '), null);
    assert.equal(placesService.normalizeQuery('P'), null);
    assert.equal(placesService.normalizeQuery(null), null);
    assert.equal(placesService.normalizeQuery(undefined), null);
  });

  test('normalizeQuery trims and caps the term', () => {
    assert.equal(placesService.normalizeQuery('  Patna  '), 'Patna');
    const long = 'a'.repeat(500);
    assert.equal(placesService.normalizeQuery(long).length, placesService.MAX_QUERY_LENGTH);
  });

  test('normalizeRegion only accepts a ccTLD style code', () => {
    assert.equal(placesService.normalizeRegion('IN'), 'in');
    assert.equal(placesService.normalizeRegion(' in '), 'in');
    assert.equal(placesService.normalizeRegion('india'), undefined);
    assert.equal(placesService.normalizeRegion(''), undefined);
    assert.equal(placesService.normalizeRegion(null), undefined);
  });

  test('isValidLatLng rejects impossible coordinates', () => {
    assert.equal(placesService.isValidLatLng(25.5941, 85.1376), true);
    assert.equal(placesService.isValidLatLng(91, 85), false);
    assert.equal(placesService.isValidLatLng(25, 181), false);
    assert.equal(placesService.isValidLatLng('25', 85), false);
    assert.equal(placesService.isValidLatLng(null, null), false);
  });

  test('toPrediction maps a Google prediction onto the client shape', () => {
    const mapped = placesService.toPrediction({
      place_id: 'ChIJ123',
      description: 'Patna Junction, Patna, Bihar, India',
      structured_formatting: { main_text: 'Patna Junction', secondary_text: 'Patna, Bihar, India' },
    });

    assert.equal(mapped.placeId, 'ChIJ123');
    assert.equal(mapped.label, 'Patna Junction, Patna, Bihar, India');
    assert.equal(mapped.mainText, 'Patna Junction');
    assert.equal(mapped.secondaryText, 'Patna, Bihar, India');
  });
});

/* -------------------------------------------------------------------------- */
/* placesService — network calls (stubbed)                                    */
/* -------------------------------------------------------------------------- */

describe('placesService google calls', () => {
  const originalGet = axios.get;

  afterEach(() => {
    axios.get = originalGet;
  });

  test('autocompletePlaces sends the server key and returns mapped predictions', async () => {
    let called = null;
    axios.get = async (url, config) => {
      called = { url, config };
      return {
        data: {
          status: 'OK',
          predictions: [
            {
              place_id: 'ChIJ1',
              description: 'Patna, Bihar, India',
              structured_formatting: { main_text: 'Patna', secondary_text: 'Bihar, India' },
            },
          ],
        },
      };
    };

    const predictions = await placesService.autocompletePlaces({
      input: 'Patna',
      region: 'in',
      apiKey: 'server-key',
    });

    assert.ok(called.url.includes('/place/autocomplete/json'));
    assert.equal(called.config.params.key, 'server-key');
    assert.equal(called.config.params.input, 'Patna');
    assert.equal(called.config.params.components, 'country:IN');
    assert.equal(called.config.params.region, 'in');
    assert.equal(predictions.length, 1);
    assert.equal(predictions[0].placeId, 'ChIJ1');
  });

  test('autocompletePlaces treats ZERO_RESULTS as an empty list, not an error', async () => {
    axios.get = async () => ({ data: { status: 'ZERO_RESULTS', predictions: [] } });

    const predictions = await placesService.autocompletePlaces({
      input: 'zzzzzzzz',
      apiKey: 'server-key',
    });

    assert.deepEqual(predictions, []);
  });

  test('autocompletePlaces throws on a non-OK Google status', async () => {
    axios.get = async () => ({ data: { status: 'REQUEST_DENIED' } });

    await assert.rejects(
      () => placesService.autocompletePlaces({ input: 'Patna', apiKey: 'server-key' }),
      /Google Places status: REQUEST_DENIED/
    );
  });

  test('getPlaceDetails returns the coordinates the booking form needs', async () => {
    let called = null;
    axios.get = async (url, config) => {
      called = { url, config };
      return {
        data: {
          status: 'OK',
          result: {
            place_id: 'ChIJ1',
            name: 'Patna Junction',
            formatted_address: 'Patna Junction, Patna, Bihar',
            geometry: { location: { lat: 25.5941, lng: 85.1376 } },
          },
        },
      };
    };

    const place = await placesService.getPlaceDetails({ placeId: 'ChIJ1', apiKey: 'server-key' });

    assert.ok(called.url.includes('/place/details/json'));
    assert.equal(called.config.params.key, 'server-key');
    assert.equal(place.placeId, 'ChIJ1');
    assert.equal(place.name, 'Patna Junction');
    assert.equal(place.lat, 25.5941);
    assert.equal(place.lng, 85.1376);
  });

  test('getPlaceDetails throws when Google returns no usable coordinates', async () => {
    axios.get = async () => ({
      data: { status: 'OK', result: { place_id: 'ChIJ1', geometry: { location: {} } } },
    });

    await assert.rejects(
      () => placesService.getPlaceDetails({ placeId: 'ChIJ1', apiKey: 'server-key' }),
      /no usable coordinates/
    );
  });
});

/* -------------------------------------------------------------------------- */
/* placesController — request validation                                      */
/* -------------------------------------------------------------------------- */

describe('placesController validation', () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'server-key';
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  test('autocomplete rejects a query that is too short', async () => {
    const res = makeRes();
    await placesController.autocompleteHandler({ query: { q: 'P' } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /at least 2 characters/);
  });

  test('autocomplete rejects a missing query', async () => {
    const res = makeRes();
    await placesController.autocompleteHandler({ query: {} }, res);

    assert.equal(res.statusCode, 400);
  });

  test('place details rejects a missing place_id', async () => {
    const res = makeRes();
    await placesController.placeDetailsHandler({ query: {} }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /place_id is required/);
  });

  test('autocomplete reports a clear message when no Maps key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const res = makeRes();
    await placesController.autocompleteHandler({ query: { q: 'Patna' } }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /temporarily unavailable/);
  });
});

/* -------------------------------------------------------------------------- */
/* catalogue route — the server's own pricing source of truth                  */
/* -------------------------------------------------------------------------- */

describe('GET /api/catalogue/vehicles', () => {
  test('publishes exactly the vehicles the server prices with', async () => {
    const handler = handlerFor(catalogueRouter, '/vehicles');
    const res = makeRes();

    await handler({ query: {} }, res);

    assert.equal(res.statusCode, null); // no explicit status → 200
    assert.equal(res.body.success, true);

    const { vehicles, legacy_types: legacyTypes, valid_vehicle_ids: validIds } = res.body.data;

    assert.equal(vehicles.length, Object.keys(VEHICLE_PRICING).length);
    assert.equal(validIds.length, Object.keys(VEHICLE_PRICING).length);
    assert.deepEqual(legacyTypes, Object.keys(LEGACY_TYPE_FALLBACK));

    for (const vehicle of vehicles) {
      const source = VEHICLE_PRICING[vehicle.id];
      assert.ok(source, `${vehicle.id} must exist in services/vehiclePricing.js`);
      assert.equal(vehicle.name, source.name);
      assert.equal(vehicle.type, source.type);
      assert.equal(vehicle.rate, source.rate);
      assert.equal(vehicle.rate_min, source.min);
      assert.equal(vehicle.rate_max, source.max);
    }
  });

  test('every published vehicle id is accepted by the pricing resolver', () => {
    const handler = handlerFor(catalogueRouter, '/vehicles');
    const res = makeRes();

    handler({ query: {} }, res);

    for (const vehicle of res.body.data.vehicles) {
      const pricing = getVehiclePricing(vehicle.id);
      assert.ok(pricing, `${vehicle.id} must resolve a price`);
      assert.equal(pricing.rate, vehicle.rate);
    }
  });
});
