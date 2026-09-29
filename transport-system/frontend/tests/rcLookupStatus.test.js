/**
 * Regression tests for the Vehicle Registration RC-lookup logic.
 *
 * Covers two things that are actively harmful when wrong:
 *   1. The status message told the admin "your existing information was already
 *      filled" even when the form was COMPLETELY EMPTY.
 *   2. The RC Data section must only ever show fields the API actually returned
 *      — never an empty field just because the database has a column for it.
 *
 * No test framework dependency — node:test + node:assert, matching the
 * backend's tests/*.test.js convention. Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  planRcFill,
  buildRcStatusMessage,
  buildRcDisplayRows,
  hasRcDisplayData,
  formatRcDate,
  insuranceStatusFrom,
  pucStatusFrom,
  RC_FIELD_MAP,
} from '../src/components/admin-premium/transport/rcLookupStatus.js';

const VEHICLE_TYPES = [
  'Mahindra Bolero Pickup', 'Tata Ace (Chhota Hathi)', '14 ft Truck', 'Other',
];

/* Real CarInfo `data` block captured for JH05DG3670 (Eicher Pro). */
const JH05_RC = {
  vehicleName: 'EICHER PRO 2114XP S L HSD BS6',
  make: 'EICHER',
  model: 'PRO 2114XP S L HSD BS6',
  vehicleType: 'Four Wheeler',
  isTwoWheeler: false,
  registrationDate: null,
  manufacturingYear: null,
  insuranceExpiry: '2025-09-28',
  insuranceExpired: true,
  insuranceExpiringSoon: false,
  pollutionExpiry: null,
  pollutionCertificateExpired: true,
  rto: 'Jamshedpur, East Singhbhum, Jharkhand - 831001',
  rtoCode: 'JH-05',
  rtoState: 'Jharkhand',
  rcMakeModel: 'EICHER PRO 2114XP S L HSD BS6',
  vehicleIdentityVerified: true,
};

/* Real CarInfo `data` block captured for UP14ET4166 (untrusted identity). */
const UP14_RC = {
  vehicleName: null,
  make: null,
  model: null,
  vehicleType: 'Four Wheeler',
  insuranceExpiry: '2020-11-26',
  insuranceExpired: true,
  pollutionCertificateExpired: true,
  rto: 'Ghaziabad, Uttar Pradesh - 201002',
  rtoCode: 'UP-14',
  rtoState: 'Uttar Pradesh',
  rcMakeModel: 'ONE TATA ACE',
  vehicleIdentityVerified: false,
};

const EMPTY_RC = {
  vehicleName: null, make: null, model: null, vehicleType: null,
  insuranceExpiry: null, insuranceExpired: null, insuranceExpiringSoon: null,
  registrationDate: null, manufacturingYear: null, pollutionExpiry: null,
  pollutionCertificateExpired: null, rto: null, rtoCode: null, rtoState: null,
};

/* -------------------------------------------------------------------------- */
/* planRcFill — form writing                                                  */
/* -------------------------------------------------------------------------- */

describe('planRcFill', () => {
  test('fills every empty field the RC provides', () => {
    const plan = planRcFill({ vehicle_number: 'JH05DG3670' }, JH05_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.deepStrictEqual(
      plan.filled.map((f) => f.field).sort(),
      ['insurance_expiry', 'vehicle_make', 'vehicle_model', 'vehicle_name'],
    );
    assert.deepStrictEqual(plan.skippedAsFilled, []);
  });

  test('never overwrites a value the admin already entered', () => {
    const plan = planRcFill(
      { vehicle_name: 'MY OWN NAME', insurance_expiry: '2030-01-01' },
      JH05_RC,
      { vehicleTypeOptions: VEHICLE_TYPES },
    );
    assert.ok(!plan.filled.some((f) => f.field === 'vehicle_name'));
    assert.ok(!plan.filled.some((f) => f.field === 'insurance_expiry'));
    assert.deepStrictEqual(plan.skippedAsFilled.sort(), ['insurance expiry', 'name']);
  });

  test('skips a <select> value that is not one of the options', () => {
    const plan = planRcFill({}, JH05_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.ok(!plan.filled.some((f) => f.field === 'vehicle_type'), 'must not blank the dropdown');
    assert.ok(plan.notApplicable.includes('type'));
    assert.ok(plan.rcUsable.includes('type'), 'but the RC did supply a value');
  });

  test('treats an empty RC as supplying nothing', () => {
    const plan = planRcFill({}, EMPTY_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.deepStrictEqual(plan.filled, []);
    assert.deepStrictEqual(plan.rcUsable, []);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRcStatusMessage — the four required outcomes                          */
/* -------------------------------------------------------------------------- */

describe('buildRcStatusMessage', () => {
  test('1. found === false -> "No RC record found for this number."', () => {
    assert.strictEqual(buildRcStatusMessage({ found: false }), 'No RC record found for this number.');
  });

  test('2. fields were written -> "N fields auto-filled (...)"', () => {
    const plan = planRcFill({ vehicle_number: 'JH05DG3670' }, JH05_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    const msg = buildRcStatusMessage({ found: true, ...plan });

    assert.strictEqual(
      msg,
      'RC found — 4 fields auto-filled (name, make, model, insurance expiry).',
    );
  });

  test('3. nothing usable at all -> must NOT say "already filled"', () => {
    const plan = planRcFill({}, EMPTY_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    const msg = buildRcStatusMessage({ found: true, ...plan });

    assert.strictEqual(
      msg,
      'RC found — no verifiable vehicle details were available. Please enter the details manually.',
    );
    assert.ok(!/already filled/i.test(msg));
  });

  test('3b. REGRESSION: empty form + untrusted model -> "no verifiable details"', () => {
    const form = { vehicle_number: 'UP14ET4166' };
    const plan = planRcFill(form, { ...EMPTY_RC, rcMakeModel: 'ONE TATA ACE' }, { vehicleTypeOptions: VEHICLE_TYPES });
    const msg = buildRcStatusMessage({ found: true, ...plan });

    assert.ok(!/already filled/i.test(msg), `got "${msg}"`);
    assert.ok(/no verifiable vehicle details were available/.test(msg), msg);
  });

  test('4. RC data was all already present -> "already filled"', () => {
    const form = {
      vehicle_name: 'EICHER PRO 2114XP S L HSD BS6',
      vehicle_make: 'EICHER',
      vehicle_model: 'PRO 2114XP S L HSD BS6',
      insurance_expiry: '2025-09-28',
    };
    const plan = planRcFill(form, JH05_RC, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.ok(/your existing information was already filled/.test(buildRcStatusMessage({ found: true, ...plan })));
  });

  test('BUG FIX: an empty form with usable RC data is NOT "already filled"', () => {
    const rc = {
      ...EMPTY_RC,
      make: 'EICHER', model: 'PRO 2114', insuranceExpiry: '2025-09-28',
      rtoCode: 'JH-05', rtoState: 'Jharkhand',
    };
    const withIdentity = { ...rc, vehicleIdentityVerified: true };
    const plan = planRcFill({ vehicle_number: 'JH05DG3670' }, rc, { vehicleTypeOptions: VEHICLE_TYPES });
    const availableCount = buildRcDisplayRows(withIdentity, { vehicleNumber: 'JH05DG3670' }).length;
    const msg = buildRcStatusMessage({ found: true, ...plan, availableCount });

    assert.ok(!/already filled/i.test(msg), `got "${msg}"`);
    assert.strictEqual(msg, 'RC found — 3 fields auto-filled (make, model, insurance expiry).');
  });

  test('RC data with nothing to auto-fill still reports availability', () => {
    const rc = { ...EMPTY_RC, rtoCode: 'JH-05', rtoState: 'Jharkhand' };
    const plan = planRcFill({}, rc, { vehicleTypeOptions: VEHICLE_TYPES });
    const availableCount = buildRcDisplayRows(rc, { vehicleNumber: 'JH05DG3670' }).length;
    assert.ok(/3 fields available/.test(buildRcStatusMessage({ found: true, ...plan, availableCount })));
  });

  test('backend warnings are appended', () => {
    const plan = planRcFill({}, { ...EMPTY_RC, rcMakeModel: 'ONE TATA ACE' }, { vehicleTypeOptions: VEHICLE_TYPES });
    const msg = buildRcStatusMessage({
      found: true, ...plan,
      warnings: [{ code: 'VEHICLE_MODEL_UNVERIFIED', message: 'Enter the vehicle name, make and model manually.' }],
    });
    assert.ok(msg.endsWith('Enter the vehicle name, make and model manually.'), msg);
  });

  test('singular vs plural on the auto-filled count', () => {
    const one = planRcFill({}, { ...EMPTY_RC, insuranceExpiry: '2025-09-28' }, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.ok(/1 field auto-filled \(insurance expiry\)\./.test(buildRcStatusMessage({ found: true, ...one })));

    const two = planRcFill({}, { ...EMPTY_RC, make: 'EICHER', model: 'PRO 2114' }, { vehicleTypeOptions: VEHICLE_TYPES });
    assert.ok(/2 fields auto-filled \(make, model\)\./.test(buildRcStatusMessage({ found: true, ...two })));
  });
});

/* -------------------------------------------------------------------------- */
/* RC Data section                                                            */
/* -------------------------------------------------------------------------- */

describe('buildRcDisplayRows — only render what the API returned', () => {
  test('JH05DG3670 shows exactly the fields the API supplied', () => {
    const rows = buildRcDisplayRows(JH05_RC, { vehicleNumber: 'JH05DG3670' });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    assert.strictEqual(byKey.vehicleNumber, 'JH05DG3670');
    assert.strictEqual(byKey.vehicleName, 'EICHER PRO 2114XP S L HSD BS6');
    assert.strictEqual(byKey.make, 'EICHER');
    assert.strictEqual(byKey.model, 'PRO 2114XP S L HSD BS6');
    assert.strictEqual(byKey.vehicleType, 'Four Wheeler');
    assert.strictEqual(byKey.isTwoWheeler, 'No');
    assert.strictEqual(byKey.rto, 'Jamshedpur, East Singhbhum, Jharkhand - 831001');
    assert.strictEqual(byKey.rtoCode, 'JH-05');
    assert.strictEqual(byKey.rtoState, 'Jharkhand');
    assert.strictEqual(byKey.insuranceExpiry, '28/09/2025');
    assert.strictEqual(byKey.insuranceStatus, 'Expired');
    assert.strictEqual(byKey.pollutionStatus, 'Expired');
  });

  test('fields the API never returns are NOT rendered', () => {
    const rows = buildRcDisplayRows(JH05_RC, { vehicleNumber: 'JH05DG3670' });
    const labels = rows.map((r) => r.label);

    for (const forbidden of [
      'Registration Date', 'Manufacturing Year', 'Pollution Expiry',
      'Insurance No.', 'Permit No.', 'Permit Expiry',
      'Chassis', 'Engine', 'Capacity', 'Owner',
    ]) {
      assert.ok(!labels.includes(forbidden), `must not render "${forbidden}"`);
    }
  });

  test('registrationDate / manufacturingYear / pollutionExpiry DO render when present', () => {
    const rows = buildRcDisplayRows(
      { ...EMPTY_RC, registrationDate: '2021-07-02', manufacturingYear: 2021, pollutionExpiry: '2027-04-30' },
      { vehicleNumber: 'BR09AB1234' },
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    assert.strictEqual(byKey.registrationDate, '02/07/2021');
    assert.strictEqual(byKey.manufacturingYear, '2021');
    assert.strictEqual(byKey.pollutionExpiry, '30/04/2027');
  });

  test('UP14ET4166 omits the unverified identity but keeps insurance/RTO', () => {
    const rows = buildRcDisplayRows(UP14_RC, { vehicleNumber: 'UP14ET4166' });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    assert.strictEqual(byKey.vehicleName, undefined, 'unverified name must not be shown');
    assert.strictEqual(byKey.make, undefined);
    assert.strictEqual(byKey.model, undefined);
    assert.strictEqual(byKey.insuranceExpiry, '26/11/2020');
    assert.strictEqual(byKey.insuranceStatus, 'Expired');
    assert.strictEqual(byKey.rtoCode, 'UP-14');
  });

  test('the raw audit field rcMakeModel is never rendered', () => {
    const rows = buildRcDisplayRows(UP14_RC, { vehicleNumber: 'UP14ET4166' });
    assert.ok(!rows.some((r) => /one tata ace/i.test(r.value)), 'must not surface the malformed string');
  });

  test('a response with only insurance data renders only insurance rows', () => {
    const rc = { ...EMPTY_RC, insuranceExpiry: '2026-01-31', insuranceExpired: false };
    const rows = buildRcDisplayRows(rc, { vehicleNumber: 'BR09AB1234' });
    assert.deepStrictEqual(rows.map((r) => r.key), ['vehicleNumber', 'insuranceExpiry', 'insuranceStatus']);
  });

  test('a response with only RTO data renders only RTO rows', () => {
    const rc = { ...EMPTY_RC, rtoCode: 'BR-09', rtoState: 'Bihar', rto: 'Patna' };
    const rows = buildRcDisplayRows(rc, { vehicleNumber: 'BR09AB1234' });
    assert.deepStrictEqual(rows.map((r) => r.key), ['vehicleNumber', 'rto', 'rtoCode', 'rtoState']);
  });

  test('a response with no usable data produces no data rows (section hidden)', () => {
    // The vehicle number is the only thing a bare response can contribute.
    assert.deepStrictEqual(
      buildRcDisplayRows(EMPTY_RC, { vehicleNumber: 'BR09AB1234' }).map((r) => r.key),
      ['vehicleNumber'],
    );
    // With nothing at all to show, the section is hidden entirely.
    assert.deepStrictEqual(buildRcDisplayRows(EMPTY_RC, {}), []);
    assert.strictEqual(hasRcDisplayData(EMPTY_RC, {}), false);
    assert.deepStrictEqual(buildRcDisplayRows(null, {}), []);
  });

  test('the RTO row spans the full width', () => {
    const rows = buildRcDisplayRows(JH05_RC, { vehicleNumber: 'JH05DG3670' });
    assert.strictEqual(rows.find((r) => r.key === 'rto').wide, true);
  });
});

describe('status mappers use the backend flags, never recompute', () => {
  test('insurance status from the API booleans', () => {
    assert.strictEqual(insuranceStatusFrom({ insuranceExpired: true }), 'Expired');
    assert.strictEqual(insuranceStatusFrom({ insuranceExpired: false }), 'Active');
    assert.strictEqual(insuranceStatusFrom({ insuranceExpiringSoon: true }), 'Expiring Soon');
    assert.strictEqual(insuranceStatusFrom({}), null);
  });

  test('PUC status from pollutionCertificateExpired', () => {
    assert.strictEqual(pucStatusFrom({ pollutionCertificateExpired: true }), 'Expired');
    assert.strictEqual(pucStatusFrom({ pollutionCertificateExpired: false }), 'Valid');
    assert.strictEqual(pucStatusFrom({}), null);
  });

  test('date formatting is dd/mm/yyyy', () => {
    assert.strictEqual(formatRcDate('2025-09-28'), '28/09/2025');
    assert.strictEqual(formatRcDate('2020-11-26'), '26/11/2020');
    assert.strictEqual(formatRcDate(null), null);
  });
});

describe('RC_FIELD_MAP', () => {
  test('never maps the raw rcMakeModel audit field into the form', () => {
    assert.ok(!RC_FIELD_MAP.some(([, key]) => key === 'rcMakeModel'));
  });
});
