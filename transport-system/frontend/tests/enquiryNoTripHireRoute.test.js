/**
 * tests/enquiryNoTripHireRoute.test.js
 * ---------------------------------------------------------------------------
 * BEFORE THE CUSTOMER ACCEPTS THERE IS NO TRIP — SO THERE MUST BE NO TRIP URL.
 *
 * THE BUG THIS PINS
 *   `describeHireAssignment` builds its navigation target with
 *   `hireRouteFor(assignment.trip_id)`. An enquiry that has only been sent a
 *   quote has `trip_id === null`, so `hireRouteFor` produced
 *   `/admin/trips//vehicle`. React Router collapses the empty segment and reads
 *   `tripId = "vehicle"`, so the workspace asked `GET /api/trips/vehicle` and the
 *   API answered HTTP 400 "Invalid trip ID".
 *
 *   Two rules follow, and both are asserted here against the REAL module the
 *   browser runs:
 *     1. `hireRouteFor` returns null for anything that is not a real trip id.
 *     2. `handoffStage` never reports a post-reservation stage while nothing is
 *        reserved — `AWAITING_CUSTOMER_ACCEPTANCE` alone must not imply the
 *        vehicle and driver are held.
 *
 * LOCAL ONLY.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HIRE_STATE,
  HANDOFF_STAGE,
  canFinalizeQuote,
  describeHireAssignment,
  handoffStage,
  hireRouteFor,
} from '../src/components/admin-premium/enquiries/hireHandoff.js';

test('hireRouteFor returns null when there is no trip id', () => {
  assert.equal(hireRouteFor(null), null);
  assert.equal(hireRouteFor(undefined), null);
  assert.equal(hireRouteFor(''), null);
});

test('hireRouteFor refuses a non-numeric trip id instead of building a dead URL', () => {
  // "vehicle" is exactly what React Router extracted from `/admin/trips//vehicle`.
  assert.equal(hireRouteFor('vehicle'), null);
  assert.equal(hireRouteFor('abc'), null);
  assert.equal(hireRouteFor('1638abc'), null);
});

test('hireRouteFor still builds the Trip workspace for a real trip', () => {
  assert.equal(hireRouteFor(1638), '/admin/trips/1638/vehicle-hire');
  assert.equal(hireRouteFor('1638'), '/admin/trips/1638/vehicle-hire');
  assert.equal(hireRouteFor(1638, { edit: true }), '/admin/trips/1638/vehicle-hire?edit=1');
});

test('describeHireAssignment yields NO route when the assignment has no trip', () => {
  const view = describeHireAssignment(null);
  assert.equal(view.tripId, null);
  assert.equal(view.route, null, 'no trip means no trip URL — never /admin/trips//vehicle');

  const waiting = describeHireAssignment({ hire_status: 'WAITING_FOR_VEHICLE' });
  assert.equal(waiting.route, null);
});

test('a quote that was sent does NOT imply the resources are held', () => {
  // EXACTLY enquiry 5549: quote sent, nothing reserved, no trip.
  const stage = handoffStage({
    assignment: null,
    enquiryStatus: 'AWAITING_CUSTOMER_ACCEPTANCE',
  });
  assert.equal(
    stage,
    HANDOFF_STAGE.NEED_RESOURCES,
    'with nothing reserved the operator must still be offered the reservation action',
  );
});

test('a reservation that IS held does advance to QUOTE_SENT', () => {
  const stage = handoffStage({
    assignment: { hire_status: HIRE_STATE.VEHICLE_ASSIGNED },
    enquiryStatus: 'AWAITING_CUSTOMER_ACCEPTANCE',
  });
  assert.equal(stage, HANDOFF_STAGE.QUOTE_SENT);
});

test('customer commitment still wins regardless of assignment', () => {
  const stage = handoffStage({
    assignment: { hire_status: HIRE_STATE.VEHICLE_HIRED },
    enquiryStatus: 'CUSTOMER_ACCEPTED',
  });
  assert.equal(stage, HANDOFF_STAGE.CONFIRMED);
});

test('canFinalizeQuote refuses a quote with no vehicle or driver', () => {
  const none = canFinalizeQuote({ assignment: null, finalPrice: 6000 });
  assert.equal(none.allowed, false, 'a price alone must not be sendable without resources');

  const noDriver = canFinalizeQuote({
    assignment: { vehicle: { vehicle_number: 'BR04EF9012' } },
    finalPrice: 6000,
  });
  assert.equal(noDriver.allowed, false);

  const both = canFinalizeQuote({
    assignment: {
      vehicle: { vehicle_number: 'BR04EF9012' },
      driver: { driver_name: 'Raj Kumar' },
    },
    finalPrice: 6000,
  });
  assert.equal(both.allowed, true);
});
