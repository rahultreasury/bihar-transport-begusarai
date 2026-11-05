/**
 * Vacant-first resource ranking, and the availability race at acceptance.
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS PROTECTS
 *
 *   1. §2 — the Vehicle Hire selectors must show what the operator can ACTUALLY
 *      use for this consignment's pickup, first, labelled AVAILABLE / BUSY /
 *      CONFLICT / UNAVAILABLE. A busy truck must never look assignable, and a
 *      free one must never be buried at the bottom of the list.
 *
 *   2. §8 — the reservation race. A vehicle can be reserved at 3:00 and the
 *      customer can accept at 3:30. If something took the truck in between, the
 *      acceptance must FAIL LOUDLY inside its transaction rather than confirm an
 *      order nobody can actually run. The customer must never receive a
 *      confirmation that cannot be honoured.
 *
 * `utils/resourceAvailability.js` is pure, so the classification and the ordering
 * are tested directly — no database, and no chance of the test asserting against
 * a re-implementation of the rules.
 *
 * Run with: npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RESOURCE_AVAILABILITY,
  classifyVehicle,
  classifyDriver,
  rankResources,
  isSelectable,
} = require('../utils/resourceAvailability');
const { rangesOverlap, tripWindow } = require('../services/EnquiryAssignmentService');

const overlaps = rangesOverlap;

/** The pickup window these tests all compete for: 10 Oct 2026. */
const DAY = new Date('2026-10-10T00:00:00Z');
const WINDOW = tripWindow(DAY);
const otherDay = (iso) => tripWindow(new Date(iso));

const vehicle = (over = {}) => ({
  vehicle_id: 1,
  vehicle_number: 'BR09CC0001',
  vehicle_name: 'Ashok Leyland Tempo',
  owner_id: 7,
  current_status: 'available',
  is_available: true,
  ...over,
});

const driver = (over = {}) => ({
  driver_id: 1,
  driver_name: 'Kaushal',
  transport_owner_id: 7,
  status: 'available',
  is_available: true,
  ...over,
});

const ctx = (over = {}) => ({ commitments: [], window: WINDOW, ownTripId: null, overlaps, ...over });

/* ═══════════════════════════════════════════════════════════════════════════
   4-5. VACANT VEHICLE / DRIVER PRIORITY
   ═══════════════════════════════════════════════════════════════════════════ */

test('4-5. available vehicles are ranked ahead of busy and unavailable ones', () => {
  const rows = [
    vehicle({ vehicle_id: 1, vehicle_number: 'AAA-0001' }),
    vehicle({ vehicle_id: 2, vehicle_number: 'BBB-0002', current_status: 'maintenance' }),
    vehicle({ vehicle_id: 3, vehicle_number: 'CCC-0003' }),
    vehicle({ vehicle_id: 4, vehicle_number: 'DDD-0004', is_available: false }),
  ];

  const ranked = rankResources(rows, 'vehicle', ctx({ ownTripId: 100 }), 'vehicle_number');

  assert.equal(ranked[0].availability, RESOURCE_AVAILABILITY.AVAILABLE);
  assert.equal(ranked[1].availability, RESOURCE_AVAILABILITY.AVAILABLE);
  // Everything that cannot be used is below everything that can.
  assert.ok(
    ranked.slice(2).every((r) => r.availability !== RESOURCE_AVAILABILITY.AVAILABLE),
    'no unavailable resource outranks an available one',
  );
});

test('5. available drivers are ranked ahead of busy and unavailable ones', () => {
  const rows = [
    driver({ driver_id: 1, driver_name: 'Zoya Busy' }),
    driver({ driver_id: 2, driver_name: 'Aarti' }),
    driver({ driver_id: 3, driver_name: 'Inactive Driver', status: 'inactive' }),
  ];

  // Driver 1 is committed to another consignment on the SAME pickup day, so it
  // is BUSY — and, crucially, must not sort above the two that are usable.
  const ranked = rankResources(
    rows,
    'driver',
    ctx({
      ownTripId: 100,
      commitments: [
        { tripId: 200, window: WINDOW, vehicleIds: [], driverIds: [1] },
      ],
    }),
    'driver_name',
  );

  assert.equal(ranked[0].driver_name, 'Aarti', 'the vacant driver is first');
  assert.equal(ranked[0].availability, RESOURCE_AVAILABILITY.AVAILABLE);
  assert.equal(ranked[1].driver_name, 'Zoya Busy');
  assert.equal(ranked[1].availability, RESOURCE_AVAILABILITY.BUSY);
  assert.equal(ranked[2].availability, RESOURCE_AVAILABILITY.UNAVAILABLE);
});

test('5. a vehicle committed to an overlapping trip is BUSY, with a reason', () => {
  const v = vehicle();
  const result = classifyVehicle(
    v,
    ctx({
      ownTripId: 100,
      commitments: [{ tripId: 200, window: WINDOW, vehicleIds: [v.vehicle_id], driverIds: [] }],
    }),
  );

  assert.equal(result.availability, RESOURCE_AVAILABILITY.BUSY);
  assert.match(result.reason, /another consignment/i);
  assert.equal(isSelectable({ availability: result.availability }), false);
});

test('5. the SAME truck on an adjacent day is available — back-to-back is legal', () => {
  const v = vehicle();
  const result = classifyVehicle(
    v,
    ctx({
      ownTripId: 100,
      commitments: [
        { tripId: 200, window: otherDay('2026-10-09T00:00:00Z'), vehicleIds: [v.vehicle_id], driverIds: [] },
      ],
    }),
  );

  assert.equal(result.availability, RESOURCE_AVAILABILITY.AVAILABLE);
});

test('7. a driver committed to an overlapping consignment is BUSY', () => {
  const d = driver();
  const result = classifyDriver(
    d,
    ctx({
      ownTripId: 100,
      commitments: [{ tripId: null, window: WINDOW, vehicleIds: [], driverIds: [d.driver_id] }],
    }),
  );

  assert.equal(result.availability, RESOURCE_AVAILABILITY.BUSY);
});

test('6. a RESERVATION on another enquiry blocks the resource too', () => {
  // A pre-acceptance reservation holds the driver just as firmly as a live trip —
  // this is what stops two enquiries reserving the same person.
  const d = driver();
  const result = classifyDriver(
    d,
    ctx({
      ownTripId: 100,
      commitments: [
        { tripId: null, enquiryId: 501, window: WINDOW, vehicleIds: [], driverIds: [d.driver_id] },
      ],
    }),
  );

  assert.equal(result.availability, RESOURCE_AVAILABILITY.BUSY);
});

test('the resource THIS consignment already holds is CONFLICT, not BUSY', () => {
  // "Already assigned to this consignment" is a different statement from
  // "someone else has it", and the operator must be able to tell them apart.
  const d = driver();
  const result = classifyDriver(
    d,
    ctx({
      ownTripId: 100,
      commitments: [{ tripId: 100, window: WINDOW, vehicleIds: [], driverIds: [d.driver_id] }],
    }),
  );

  assert.equal(result.availability, RESOURCE_AVAILABILITY.CONFLICT);
  assert.match(result.reason, /this consignment/i);
  // Re-picking the resource already held is a no-op, not a failure.
  assert.equal(isSelectable({ availability: result.availability }), true);
});

test('an off-road vehicle is UNAVAILABLE even on a free date', () => {
  for (const status of ['off_road', 'maintenance', 'scrapped']) {
    const result = classifyVehicle(vehicle({ current_status: status }), ctx());
    assert.equal(result.availability, RESOURCE_AVAILABILITY.UNAVAILABLE, status);
  }
});

test('a deactivated master is UNAVAILABLE', () => {
  assert.equal(
    classifyVehicle(vehicle({ is_available: false }), ctx()).availability,
    RESOURCE_AVAILABILITY.UNAVAILABLE,
  );
  assert.equal(
    classifyDriver(driver({ is_available: false }), ctx()).availability,
    RESOURCE_AVAILABILITY.UNAVAILABLE,
  );
  assert.equal(
    classifyDriver(driver({ status: 'suspended' }), ctx()).availability,
    RESOURCE_AVAILABILITY.UNAVAILABLE,
  );
});

test('ranking is stable and does not mutate the caller rows', () => {
  const rows = [
    vehicle({ vehicle_id: 2, vehicle_number: 'ZZZ' }),
    vehicle({ vehicle_id: 1, vehicle_number: 'AAA' }),
  ];
  const snapshot = JSON.stringify(rows);

  const first = rankResources(rows, 'vehicle', ctx(), 'vehicle_number');
  const second = rankResources(rows, 'vehicle', ctx(), 'vehicle_number');

  assert.deepEqual(
    first.map((r) => r.vehicle_number),
    second.map((r) => r.vehicle_number),
    'the same input always yields the same order',
  );
  assert.equal(JSON.stringify(rows), snapshot, 'input rows are not mutated');
  assert.ok(!('_index' in first[0]), 'no internal bookkeeping leaks into the response');
});

/* ═══════════════════════════════════════════════════════════════════════════
   §8 — THE RACE AT ACCEPTANCE
   ═══════════════════════════════════════════════════════════════════════════ */

test('§8 — the race is decidable: still free → available, taken → BUSY', () => {
  const v = vehicle();

  // 3:00pm — reserved, nothing competing. Available.
  const before = classifyVehicle(
    v,
    ctx({ ownTripId: 100, commitments: [] }),
  );
  assert.equal(before.availability, RESOURCE_AVAILABILITY.AVAILABLE);

  // 3:30pm — another booking took it in between. The same check now says BUSY,
  // which is what makes an acceptance refuse rather than confirm.
  const after = classifyVehicle(
    v,
    ctx({
      ownTripId: 100,
      commitments: [{ tripId: 300, window: WINDOW, vehicleIds: [v.vehicle_id], driverIds: [] }],
    }),
  );
  assert.equal(after.availability, RESOURCE_AVAILABILITY.BUSY);
  assert.equal(isSelectable({ availability: after.availability }), false);
});

test('§8 — the driver half of the race is decidable too', () => {
  const d = driver();

  const after = classifyDriver(
    d,
    ctx({
      ownTripId: 100,
      commitments: [{ tripId: 300, window: WINDOW, vehicleIds: [], driverIds: [d.driver_id] }],
    }),
  );
  assert.equal(after.availability, RESOURCE_AVAILABILITY.BUSY);
});

/* ═══════════════════════════════════════════════════════════════════════════
   NO DUPLICATED RULES
   ═══════════════════════════════════════════════════════════════════════════ */

test('the ranking reuses the shipped overlap maths, not a private copy', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'utils', 'resourceAvailability.js'),
    'utf8',
  );
  // It receives `overlaps` and must never roll its own date comparison.
  assert.match(src, /overlaps\(/);
  assert.doesNotMatch(src, /new Date\(.*trip_date|getTime\(\)/, 'no private date maths here');
});