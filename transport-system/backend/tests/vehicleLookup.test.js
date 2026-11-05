/**
 * Unit tests for the Parse CarInfo vehicle RC lookup.
 *
 * The `UP14ET4166` fixture below is the REAL response captured from a single
 * live CarInfo call (structure verbatim, owner name replaced with a mask
 * placeholder because our service never reads or returns it anyway).
 *
 * NO Parse credits are consumed here: every network path is stubbed.
 *
 * Conventions: node:test + node:assert, matching tests/*.test.js.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const service = require('../services/vehicleLookupService');

/* -------------------------------------------------------------------------- */
/* Real captured CarInfo response (single live call, UP14ET4166)              */
/* -------------------------------------------------------------------------- */

const REAL_RESPONSE = {
  status: 'success',
  data: {
    vehicle_number: 'UP14ET4166',
    owner_name_masked: 'S****Y K***R',
    make_model: 'ONE TATA ACE',
    vehicle_image_url: 'https://d289c58yi26upx.cloudfront.net/March27th2020/Bus.png',
    is_two_wheeler: false,
    rto: {
      code: 'UP-14',
      registered_rto: 'Ghaziabad, Uttar Pradesh - 201002',
      state: 'Uttar Pradesh',
      phone: '+91-575-2703884',
      website: 'http://uptransport.upsdc.gov.in/',
    },
    insurance: {
      expiry_date: '26-Nov-2020',
      expired: true,
      expiring_soon: false,
    },
    pollution_certificate_expired: true,
    notices: [
      { title: 'Insurance Expired!', subtitle: 'Renew instantly', action_types: ['CAR_INSURANCE'] },
      { title: 'View Pending Challans', subtitle: 'Check & pay', action_types: ['CHALLAN_DETAILS'] },
    ],
  },
};

/* Second real capture (single live call): an Eicher Pro. Same 9 fields, same
   generic demo image, but a well-formed "<MANUFACTURER> <model>" designation. */
const JH05_RESPONSE = {
  status: 'success',
  data: {
    vehicle_number: 'JH05DG3670',
    owner_name_masked: '<masked>',
    make_model: 'EICHER PRO 2114XP S L HSD BS6',
    vehicle_image_url: 'https://d289c58yi26upx.cloudfront.net/March27th2020/Bus.png',
    is_two_wheeler: false,
    rto: {
      code: 'JH-05',
      registered_rto: 'Jamshedpur, East Singhbhum, Jharkhand - 831001',
      state: 'Jharkhand',
      phone: '',
      website: 'http://jhtransport.gov.in/',
    },
    insurance: { expiry_date: '28-Sep-2025', expired: true, expiring_soon: false },
    pollution_certificate_expired: true,
    notices: [],
  },
};

const realGet = axios.get;
let stubbed = null;

function stubAxios(impl) {
  stubbed = impl;
  axios.get = impl;
}

beforeEach(() => {
  service.clearCache();
  delete process.env.PARSE_API_KEY;
  process.env.PARSE_API_KEY = 'pk_test_STUBBED_KEY_NEVER_REAL';
  stubAxios(async () => ({ status: 200, data: REAL_RESPONSE }));
});

/* -------------------------------------------------------------------------- */
/* 1-7. Mapping the REAL response                                             */
/* -------------------------------------------------------------------------- */

describe('mapCarInfoPayload — real JH05DG3670 response (Eicher Pro)', () => {
  test('a well-formed make_model populates the identity fields', () => {
    const { data, fieldsFound, vehicleIdentityVerified, warnings } = service.mapCarInfoPayload(JH05_RESPONSE.data, 'JH05DG3670');

    assert.strictEqual(vehicleIdentityVerified, true, 'EICHER leads the string => trusted');
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(data.vehicleName, 'EICHER PRO 2114XP S L HSD BS6');
    assert.strictEqual(data.make, 'EICHER');
    assert.strictEqual(data.model, 'PRO 2114XP S L HSD BS6');
    assert.strictEqual(data.insuranceExpiry, '2025-09-28');
    assert.strictEqual(data.rtoCode, 'JH-05');
    assert.strictEqual(data.rtoState, 'Jharkhand');
    assert.ok(fieldsFound.includes('vehicleName') && fieldsFound.includes('make') && fieldsFound.includes('model'));
  });
});

describe('mapCarInfoPayload — real UP14ET4166 response', () => {
  test('UNVERIFIED make_model is NOT presented as the vehicle identity', () => {
    const { data, vehicleIdentityVerified, warnings } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');

    // "ONE TATA ACE" is wrong: UP14ET4166 is a Tata LPT 14 FT. The payload has
    // no chassis/engine/year/registration date to corroborate it.
    assert.strictEqual(vehicleIdentityVerified, false);
    assert.strictEqual(data.vehicleName, null, 'must not auto-fill a wrong vehicle name');
    assert.strictEqual(data.make, null, 'must not auto-fill a wrong make');
    assert.strictEqual(data.model, null, 'must NOT derive "ONE ACE" from an unverified string');
    assert.strictEqual(data.rcMakeModel, 'ONE TATA ACE', 'raw value kept for audit only');
    assert.ok(warnings.some((w) => w.code === 'VEHICLE_MODEL_UNVERIFIED'));
  });

  test('REGRESSION: our code never generates the wrong identity strings', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    const autoFilled = { vehicleName: data.vehicleName, make: data.make, model: data.model };
    const serialised = JSON.stringify(autoFilled);
    assert.ok(!serialised.includes('TATA'), 'no auto-filled make may contain TATA');
    assert.ok(!serialised.includes('ONE'), 'no auto-filled identity may contain ONE');
    assert.ok(!serialised.includes('ACE'), 'no auto-filled identity may contain ACE');
  });

  test('is_two_wheeler=false maps to a four-wheeler type', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.isTwoWheeler, false);
    assert.strictEqual(data.vehicleType, 'Four Wheeler');
  });

  test('nested insurance.expiry_date is mapped and date-normalised', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.insuranceExpiry, '2020-11-26');
    assert.strictEqual(data.insuranceExpired, true);
    assert.strictEqual(data.insuranceExpiringSoon, false);
  });

  test('nested rto object is mapped (code, registered_rto, state)', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.rto, 'Ghaziabad, Uttar Pradesh - 201002');
    assert.strictEqual(data.rtoCode, 'UP-14');
    assert.strictEqual(data.rtoState, 'Uttar Pradesh');
  });

  test('pollution_certificate_expired is a boolean, never a fake date', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.pollutionCertificateExpired, true);
    assert.strictEqual(data.pollutionExpiry, null, 'CarInfo gives no PUC date — must stay null');
  });

  test('fields CarInfo does not provide are never invented', () => {
    const { data } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.registrationDate, null);
    assert.strictEqual(data.manufacturingYear, null);
  });

  test('owner identity is not exposed to the caller', () => {
    const { data, fieldsFound } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    const serialised = JSON.stringify({ data, fieldsFound });
    assert.ok(!serialised.includes('S****Y K***R'), 'masked RC owner must not be returned');
    assert.ok(!/owner/i.test(serialised), 'no owner field at all');
  });

  test('trustworthy registration-linked data IS still mapped', () => {
    const { data, fieldsFound } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(data.insuranceExpiry, '2020-11-26');
    assert.strictEqual(data.insuranceExpired, true);
    assert.strictEqual(data.pollutionCertificateExpired, true);
    assert.strictEqual(data.rto, 'Ghaziabad, Uttar Pradesh - 201002');
    assert.strictEqual(data.rtoCode, 'UP-14');
    assert.strictEqual(data.rtoState, 'Uttar Pradesh');
    assert.ok(fieldsFound.includes('insuranceExpiry') && fieldsFound.includes('rto'));
  });

  test('the whole real payload yields 10 auto-filled fields + rcMakeModel', () => {
    const { fieldsFound } = service.mapCarInfoPayload(REAL_RESPONSE.data, 'UP14ET4166');
    assert.strictEqual(fieldsFound.length, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Date normalisation                                                         */
/* -------------------------------------------------------------------------- */

describe('toIsoDate — formats CarInfo and Indian RCs actually use', () => {
  const cases = [
    ['2020-05-15', '2020-05-15'],
    ['15/05/2020', '2020-05-15'],
    ['15-05-2020', '2020-05-15'],
    ['30-Apr-2026', '2026-04-30'],
    ['26-Nov-2020', '2020-11-26'],
    ['15 May 2020', '2020-05-15'],
    ['2020-05-15T00:00:00.000Z', '2020-05-15'],
  ];
  for (const [input, expected] of cases) {
    test(`${input} -> ${expected}`, () => {
      assert.strictEqual(service.toIsoDate(input), expected);
    });
  }

  test('unparseable values return null rather than a wrong date', () => {
    assert.strictEqual(service.toIsoDate('N/A'), null);
    assert.strictEqual(service.toIsoDate(''), null);
    assert.strictEqual(service.toIsoDate(undefined), null);
  });
});

/* -------------------------------------------------------------------------- */
/* Registration-number validation                                             */
/* -------------------------------------------------------------------------- */

describe('vehicle number normalisation + validation', () => {
  test('normalises spacing, hyphens and case', () => {
    assert.strictEqual(service.normalizeVehicleNumber('up 14 et 4166'), 'UP14ET4166');
    assert.strictEqual(service.normalizeVehicleNumber('UP-14-ET-4166'), 'UP14ET4166');
  });

  test('accepts real Indian RC formats', () => {
    for (const n of ['UP14ET4166', 'BR09AB1234', 'MH01CL3390', 'BH01AA1234']) {
      assert.strictEqual(service.isValidVehicleNumber(n), true, n);
    }
  });

  test('rejects malformed input with a 400', async () => {
    await assert.rejects(
      () => service.lookupVehicleByRegistration('NOT-A-NUMBER'),
      (e) => e.statusCode === 400,
    );
  });

  test('rejects a missing number with a 400', async () => {
    await assert.rejects(
      () => service.lookupVehicleByRegistration(''),
      (e) => e.statusCode === 400,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Service happy path over the real response                                  */
/* -------------------------------------------------------------------------- */

describe('lookupVehicleByRegistration — happy path (stubbed upstream)', () => {
  test('returns the contract shape and never the raw payload', async () => {
    const result = await service.lookupVehicleByRegistration('up14et4166');
    assert.strictEqual(result.vehicleNumber, 'UP14ET4166');
    assert.strictEqual(result.found ?? true, true);
    assert.strictEqual(result.source, 'parse_carinfo');
    assert.strictEqual(result.data.insuranceExpiry, '2020-11-26');
    assert.strictEqual(result.raw, undefined, 'raw upstream payload must not be forwarded');
  });

  test('sends the documented endpoint, header and query param', async () => {
    let captured = null;
    stubAxios(async (url, config) => {
      captured = { url, config };
      return { status: 200, data: REAL_RESPONSE };
    });

    await service.lookupVehicleByRegistration('UP14ET4166');
    assert.strictEqual(
      captured.url,
      'https://api.parse.bot/scraper/ee7a3855-c293-4068-a7e7-30b2d941aa9d/get_vehicle_details',
    );
    assert.strictEqual(captured.config.params.vehicle_number, 'UP14ET4166');
    assert.strictEqual(captured.config.headers['X-API-Key'], process.env.PARSE_API_KEY);
    assert.ok(captured.config.timeout > 0, 'must set a timeout');
  });

  test('caches within the TTL so repeat lookups cost no credits', async () => {
    let calls = 0;
    stubAxios(async () => { calls += 1; return { status: 200, data: REAL_RESPONSE }; });

    await service.lookupVehicleByRegistration('UP14ET4166');
    const second = await service.lookupVehicleByRegistration('UP14ET4166');
    assert.strictEqual(calls, 1, 'second lookup must be served from cache');
    assert.strictEqual(second.cached, true);
  });

  test('bypassCache forces a fresh upstream call', async () => {
    let calls = 0;
    stubAxios(async () => { calls += 1; return { status: 200, data: REAL_RESPONSE }; });

    await service.lookupVehicleByRegistration('UP14ET4166');
    await service.lookupVehicleByRegistration('UP14ET4166', { bypassCache: true });
    assert.strictEqual(calls, 2);
  });

  test('a FAILED lookup is never cached — a later retry still reaches Parse', async () => {
    let calls = 0;
    // First attempt: upstream has no record.
    stubAxios(async () => { calls += 1; return { status: 404, data: { error: { message: 'not found' } } }; });
    await assert.rejects(() => service.lookupVehicleByRegistration('UP14ET4166'), (e) => e.statusCode === 404);

    // Second attempt: the record is now available. A cached negative would
    // wrongly keep returning 404 without ever calling Parse again.
    stubAxios(async () => { calls += 1; return { status: 200, data: REAL_RESPONSE }; });
    const result = await service.lookupVehicleByRegistration('UP14ET4166');

    assert.strictEqual(calls, 2, 'the retry must actually reach Parse');
    assert.strictEqual(result.cached, false, 'a negative result must never be served from cache');
    assert.strictEqual(result.data.insuranceExpiry, '2020-11-26');
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Missing optional fields                                                */
/* -------------------------------------------------------------------------- */

describe('sparse responses', () => {
  test('a MALFORMED make_model is not trusted (no leading manufacturer)', () => {
    const { data, fieldsFound, vehicleIdentityVerified } = service.mapCarInfoPayload(
      { vehicle_number: 'BR09AB1234', make_model: 'SOME UNKNOWN BODY' },
      'BR09AB1234',
    );
    assert.strictEqual(vehicleIdentityVerified, false);
    assert.strictEqual(data.vehicleName, null);
    assert.strictEqual(data.make, null);
    assert.strictEqual(data.rcMakeModel, 'SOME UNKNOWN BODY');
    assert.deepStrictEqual(fieldsFound, ['rcMakeModel']);
  });

  test('a well-formed "<MANUFACTURER> <model>" make_model IS trusted', () => {
    const { data, vehicleIdentityVerified, warnings } = service.mapCarInfoPayload({
      vehicle_number: 'BR09AB1234',
      make_model: 'Tata LPT 1412',
      rto: { code: 'BR-09', registered_rto: 'Patna', state: 'Bihar' },
      insurance: { expiry_date: '2026-07-01' },
    }, 'BR09AB1234');

    assert.strictEqual(vehicleIdentityVerified, true);
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(data.vehicleName, 'Tata LPT 1412');
    assert.strictEqual(data.make, 'Tata');
    assert.strictEqual(data.model, 'LPT 1412');
    assert.strictEqual(data.insuranceExpiry, '2026-07-01');
  });

  test('a well-formed make_model with a MISMATCHED RTO state is not trusted', () => {
    const { data, vehicleIdentityVerified } = service.mapCarInfoPayload({
      vehicle_number: 'BR09AB1234',
      make_model: 'Tata LPT 1412',
      rto: { code: 'MH-01', registered_rto: 'Mumbai', state: 'Maharashtra' },
    }, 'BR09AB1234');

    assert.strictEqual(vehicleIdentityVerified, false, 'BR registration cannot carry an MH RTO');
    assert.strictEqual(data.vehicleName, null);
  });

  test('a two-wheeler response maps to a two-wheeler type', () => {
    const { data } = service.mapCarInfoPayload({ make_model: 'HONDA ACTIVA', is_two_wheeler: true }, 'DL01AA1111');
    assert.strictEqual(data.vehicleType, 'Two Wheeler');
    assert.strictEqual(data.isTwoWheeler, true);
  });

  test('an empty payload is treated as not found (404)', async () => {
    stubAxios(async () => ({ status: 200, data: { status: 'success', data: {} } }));
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 404,
    );
  });

  test('a 200 that self-reports failure is an upstream error, not a hit', async () => {
    stubAxios(async () => ({ status: 200, data: { status: 'error', message: 'no record' } }));
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 404,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 11-12. API error + timeout                                                 */
/* -------------------------------------------------------------------------- */

describe('upstream failures', () => {
  test('404 maps to a not-found error with a clean message', async () => {
    stubAxios(async () => ({ status: 404, data: { error: { message: 'vehicle not found' } } }));
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 404 && /No vehicle record found/.test(e.message),
    );
  });

  test('401 maps to 503 and never leaks the API key', async () => {
    stubAxios(async () => ({
      status: 401,
      data: { error: { message: `invalid api key ${process.env.PARSE_API_KEY}` } },
    }));
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 503 && !e.message.includes(process.env.PARSE_API_KEY),
    );
  });

  test('a network error is contained (502) and does not crash', async () => {
    stubAxios(async () => {
      const err = new Error('getaddrinfo ENOTFOUND api.parse.bot');
      err.code = 'ENOTFOUND';
      throw err;
    });
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 502,
    );
  });

  test('a timeout maps to 504', async () => {
    stubAxios(async () => {
      const err = new Error('timeout of 10000ms exceeded');
      err.code = 'ECONNABORTED';
      throw err;
    });
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 504,
    );
  });

  test('a missing API key is a 503 that does not crash the server', async () => {
    delete process.env.PARSE_API_KEY;
    assert.strictEqual(service.isVehicleLookupConfigured(), false);
    await assert.rejects(
      () => service.lookupVehicleByRegistration('UP14ET4166'),
      (e) => e.statusCode === 503 && /not configured/.test(e.message),
    );
  });
});

test.after(() => { axios.get = realGet; });
