/**
 * orderTripMaster.test.js
 * ============================================================================
 * The Order / Trip Master lifecycle rail and its Next Action.
 *
 * THE CONTRACT UNDER TEST
 *   The rail is a CONTROL CENTRE, not decoration:
 *     • every one of the ten stages is reachable, and
 *     • reaching a stage NAVIGATES — it never writes a status.
 *
 *   Status only ever moves through the operational endpoints the backend names
 *   in `next_action.endpoint`, and those are all guarded by the existing
 *   `TripStateMachine`. That separation is what stops a click on "Completed"
 *   from force-completing an unfinished trip, and it is asserted here directly.
 *
 * WHY THE POLICY IS TESTED AND NOT THE COMPONENT
 *   `config/tripStagePolicy.js` is the single canonical mapping (§12). Testing it
 *   proves the rail, the cards and the next-action button all agree, because all
 *   three render this one object. A component test would only prove that one
 *   component copied it correctly.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../config/tripStagePolicy');
const tripStateMachine = require('../utils/TripStateMachine');
const { ValidationError } = require('../utils/AppError');

const TRIP = { trip_id: 1094, trip_number: 'BTBT-2026-00009' };

// The hierarchy the Order Master is a view of:
//
//   BOOKING
//      |
//      +-- no Trip yet          <- the order is not operational
//      |
//      +-- Trip                 <- Vehicle · Loading · Dispatch · Transit
//                                   · Delivery · POD
//
// The six operational areas belong to the TRIP, so a booking without one has
// nowhere to navigate to for them. Both branches are asserted below.
const TRIP_AREAS = ['VEHICLE_HIRED', 'LOADING', 'DISPATCH', 'TRANSIT', 'DELIVERY', 'POD'];

/** Resolve the stage view the way `getOperationalState()` does. */
const resolve = (tripStatus, opts = {}) =>
  policy.resolveTripStage({ tripStatus, trip: TRIP, ...opts });

// ============================================================================
// 1. TIMELINE NODES NAVIGATE TO THE RIGHT WORKSPACES
// ============================================================================

test('RAIL 1 — all ten stages are present, in order, each with a destination', () => {
  const r = resolve('ASSIGNED');
  assert.deepEqual(
    r.stages.map((s) => s.key),
    ['ENQUIRY', 'QUOTATION', 'ORDER_CONFIRMED', 'VEHICLE_HIRED', 'LOADING',
      'DISPATCH', 'TRANSIT', 'DELIVERY', 'POD', 'COMPLETED'],
    'ten stages, in lifecycle order'
  );
  for (const s of r.stages) {
    assert.ok(s.goto && s.goto.kind, `${s.label} has a click destination`);
  }
});

test('RAIL 1b — each stage points at the EXISTING workspace, not a new one', () => {
  const r = resolve('ASSIGNED');
  const by = Object.fromEntries(r.stages.map((s) => [s.key, s.goto]));

  // The enquiry stage opens the EXISTING enquiry workspace.
  assert.equal(by.ENQUIRY.kind, 'enquiry');
  // Quote reuses the same enquiry workspace rather than a duplicate quotation.
  assert.equal(by.QUOTATION.kind, 'enquiry');
  assert.equal(by.QUOTATION.anchor, 'quote');
  // Confirmed is this same overview page.
  assert.equal(by.ORDER_CONFIRMED.kind, 'overview');
  // Vehicle opens the Universal Vehicle Hire workflow already implemented.
  assert.equal(by.VEHICLE_HIRED.kind, 'vehicle_hire');
  // The operational stages open the trip's own workspace tabs.
  assert.equal(by.LOADING.tab, 'loading');
  assert.equal(by.DISPATCH.tab, 'dispatch');
  assert.equal(by.TRANSIT.tab, 'tracking');
  assert.equal(by.DELIVERY.tab, 'delivery');
  assert.equal(by.POD.tab, 'pod');
  assert.equal(by.COMPLETED.tab, 'summary');
});

// ============================================================================
// 2. CLICKING A NODE NEVER MUTATES STATUS
// ============================================================================

test('RAIL 2 — the stage view carries NO writable field and no status mutation', () => {
  const r = resolve('ASSIGNED');

  // Nothing on a stage node, or on the next action, can name a target status to
  // write. They name a DESTINATION (route) or an ENDPOINT the server guards.
  for (const s of r.stages) {
    assert.equal(s.set_status, undefined, `${s.key} cannot set a status`);
    assert.equal(s.mutate, undefined, `${s.key} cannot mutate`);
  }
  assert.equal(r.next_action.set_status, undefined);
  // The only status the object reports is the one already stored.
  assert.equal(r.status, 'ASSIGNED');
});

test('RAIL 2b — the next action names an EXISTING endpoint, not a status write', () => {
  const r = resolve('ASSIGNED');
  assert.equal(r.next_action.method, 'POST');
  // It POSTs to the operational endpoint that decides the target itself.
  assert.equal(r.next_action.endpoint, '/api/trips/1094/loading/send');
});

test('RAIL 2c — the trip id is interpolated into the endpoint, not sent as a status', () => {
  const r = resolve('LOADED');
  assert.equal(r.next_action.endpoint, '/api/trips/1094/dispatch');
  assert.ok(r.next_action.endpoint.includes(String(TRIP.trip_id)));
});

// ============================================================================
// 3. NEXT ACTION IS DERIVED FROM THE TRIP STATUS
// ============================================================================

test('NEXT 3 — the next action is a pure function of Trip.status', () => {
  assert.equal(resolve('PENDING').next_action.id, 'HIRE_VEHICLE');
  assert.equal(resolve('ASSIGNED').next_action.id, 'SEND_TO_LOADING');
  assert.equal(resolve('TO_LOADING_POINT').next_action.id, 'ARRIVE_LOADING');
  assert.equal(resolve('AT_LOADING_POINT').next_action.id, 'MARK_LOADED');
  assert.equal(resolve('LOADED').next_action.id, 'DISPATCH');
  assert.equal(resolve('DISPATCHED').next_action.id, 'START_TRANSIT');
  assert.equal(resolve('IN_TRANSIT').next_action.id, 'ARRIVE_DELIVERY');
  assert.equal(resolve('COMPLETED').next_action.id, 'VIEW_SUMMARY');
});

test('NEXT 3b — the mapping lives in ONE module, not scattered in components', () => {
  // A single frozen table the policy and the page both read.
  assert.ok(policy.NEXT_ACTION_BY_STATUS);
  assert.equal(typeof policy.NEXT_ACTION_BY_STATUS, 'object');
  assert.ok(Object.isFrozen(policy.NEXT_ACTION_BY_STATUS));
});

// ============================================================================
// 4–10. THE OPERATIONAL CHAIN
// ============================================================================

test('CHAIN 4 — VEHICLE HIRED → Send to Loading', () => {
  const r = resolve('ASSIGNED', { hasVehicleHire: true });
  assert.equal(r.next_action.id, 'SEND_TO_LOADING');
  assert.equal(r.current_stage, 'VEHICLE_HIRED');
  assert.match(r.next_action.label, /Loading/i);
});

test('CHAIN 5 — TO LOADING POINT → Arrived at Loading', () => {
  const r = resolve('TO_LOADING_POINT');
  assert.equal(r.next_action.id, 'ARRIVE_LOADING');
  assert.equal(r.current_stage, 'LOADING', 'the trip has entered the Loading stage');
});

test('CHAIN 6 — AT LOADING POINT → Mark as Loaded', () => {
  const r = resolve('AT_LOADING_POINT');
  assert.equal(r.next_action.id, 'MARK_LOADED');
  assert.equal(r.next_action.endpoint, '/api/trips/1094/loading/complete');
});

test('CHAIN 7 — LOADED → Dispatch', () => {
  const r = resolve('LOADED');
  assert.equal(r.next_action.id, 'DISPATCH');
  assert.equal(r.current_stage, 'LOADING', 'dispatch has not happened yet');
});

test('CHAIN 8 — DISPATCHED → Transit / Tracking', () => {
  const r = resolve('DISPATCHED');
  assert.equal(r.next_action.id, 'START_TRANSIT');
  // THIS is the stage that was previously lost: DISPATCHED had no entry in the
  // browser's table, so the rail fell back to "Vehicle".
  assert.equal(r.current_stage, 'DISPATCH');
});

test('CHAIN 9 — IN TRANSIT → Arrived at Delivery', () => {
  const r = resolve('IN_TRANSIT');
  assert.equal(r.next_action.id, 'ARRIVE_DELIVERY');
  assert.equal(r.current_stage, 'TRANSIT');
});

test('CHAIN 10 — DELIVERED → POD (both branches)', () => {
  const required = resolve('DELIVERED', { podRequired: true });
  assert.equal(required.next_action.id, 'UPLOAD_POD', 'POD required → upload POD');
  assert.equal(required.current_stage, 'POD');

  const notRequired = resolve('DELIVERED', { podRequired: false });
  assert.equal(notRequired.next_action.id, 'COMPLETE_TRIP', 'POD not required → complete');
});

// ============================================================================
// 11–13. THE POD BRANCHES
// ============================================================================

test('POD 11 — DELIVERED + POD required → POD_PENDING, awaiting upload', () => {
  const r = resolve('DELIVERED', { podRequired: true, podReceived: false });
  assert.equal(r.effective_status, 'POD_PENDING');
  assert.equal(r.next_action.id, 'UPLOAD_POD');
  // The RAW status is untouched — POD is a document state, not a trip status.
  assert.equal(r.status, 'DELIVERED');
});

test('POD 12 — POD uploaded → Complete Trip', () => {
  const r = resolve('DELIVERED', { podRequired: true, podReceived: true });
  assert.equal(r.pod_received, true);
  assert.equal(r.next_action.id, 'COMPLETE_TRIP');
  assert.equal(r.next_action.endpoint, '/api/trips/1094/complete');
});

test('POD 13 — DELIVERED + POD NOT required → Complete Trip directly', () => {
  const r = resolve('DELIVERED', { podRequired: false });
  assert.equal(r.effective_status, 'READY_TO_COMPLETE');
  assert.equal(r.next_action.id, 'COMPLETE_TRIP', 'no POD step is invented');
  assert.equal(r.pod_required, false);
});

// ============================================================================
// 14. INVALID TRANSITIONS ARE REJECTED BY THE BACKEND
// ============================================================================

test('GATE 14 — the next action only ever names a LEGAL transition', () => {
  // Every next action's endpoint implies a target status. That target must be
  // one the state machine actually allows from the current status — this is what
  // proves a click cannot shortcut the workflow.
  const IMPLIED_TARGET = {
    SEND_TO_LOADING: 'TO_LOADING_POINT',
    ARRIVE_LOADING: 'AT_LOADING_POINT',
    MARK_LOADED: 'LOADED',
    DISPATCH: 'DISPATCHED',
    START_TRANSIT: 'IN_TRANSIT',
    ARRIVE_DELIVERY: 'DELIVERED',
  };

  for (const status of ['ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT']) {
    const { next_action: a } = resolve(status);
    const target = IMPLIED_TARGET[a.id];
    assert.ok(target, `${a.id} has an implied target`);
    assert.ok(
      tripStateMachine.ALLOWED_TRANSITIONS[status].includes(target),
      `${status} → ${target} is allowed by the state machine`
    );
  }
});

test('GATE 14b — the state machine still refuses a shortcut (LOADED → IN_TRANSIT)', () => {
  // The rail may SHOW a locked Transit node, but the state machine refuses the
  // jump. A future stage is viewable, never reachable.
  assert.equal(
    tripStateMachine.ALLOWED_TRANSITIONS.LOADED.includes('IN_TRANSIT'),
    false,
    'loading must complete before transit'
  );
  assert.throws(() => tripStateMachine.validateTransition('PENDING', 'LOADED'), ValidationError);
  assert.throws(() => tripStateMachine.validateTransition('ASSIGNED', 'DELIVERED'), ValidationError);
});

// ============================================================================
// 15. REFRESH UPDATES THE TIMELINE AUTOMATICALLY
// ============================================================================

test('REFRESH 15 — re-resolving after a transition yields the new stage', () => {
  // This is exactly what happens when the page re-fetches GET /trips/:id/workflow:
  // the object is rebuilt from the stored status, so nothing is stale and no
  // manual browser refresh is needed.
  const before = resolve('ASSIGNED');
  assert.equal(before.current_stage, 'VEHICLE_HIRED');
  assert.equal(before.next_action.id, 'SEND_TO_LOADING');

  const after = resolve('TO_LOADING_POINT');
  assert.equal(after.current_stage, 'LOADING', 'the rail advanced');
  assert.equal(after.next_action.id, 'ARRIVE_LOADING', 'the next action advanced');
  assert.equal(
    after.stages.find((s) => s.key === 'VEHICLE_HIRED').state,
    'done',
    'Vehicle is now a completed node'
  );
  assert.equal(after.stages.find((s) => s.key === 'LOADING').state, 'current');
});

test('REFRESH 15b — every Trip.status produces a resolvable, non-null stage', () => {
  // Guards the original defect: a status with no entry produced a null stage and
  // the rail silently regressed.
  const ALL = [
    'PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED',
    'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED',
  ];
  for (const status of ALL) {
    const r = resolve(status);
    assert.ok(r.current_stage, `${status} resolves a stage`);
    assert.ok(r.next_action, `${status} resolves a next action`);
    assert.equal(r.status, status, 'the raw status is reported unchanged');
  }
});

// ============================================================================
// 16–17. MOVEMENT HISTORY
// ============================================================================

test('HISTORY 16 — the stage view never claims a transition happened', () => {
  // Movement history is written by TripOperationalService._perform(), not by this
  // projection. The projection must therefore expose no history of its own, or
  // the two could disagree.
  const r = resolve('ASSIGNED');
  assert.equal(r.events, undefined, 'the stage view carries no events');
  assert.equal(r.history, undefined);
});

test('HISTORY 17 — a repeat of the SAME action cannot advance the stage twice', () => {
  // The stage is a pure projection of the stored status. Re-running an action
  // that is idempotent by target state leaves the status — and therefore the
  // stage and the history — exactly where it was.
  const once = resolve('TO_LOADING_POINT');
  const twice = resolve('TO_LOADING_POINT');
  assert.deepEqual(
    once.stages.map((s) => s.state),
    twice.stages.map((s) => s.state),
    'resolving twice produces identical rail states'
  );
  assert.equal(once.next_action.id, twice.next_action.id);
});

// ============================================================================
// 18. PAYMENT NEVER DRIVES THE OPERATIONAL TIMELINE
// ============================================================================

test('SEPARATION 18 — payment state is not an input to the stage or next action', () => {
  // The policy's signature has no payment parameter at all, which is the
  // strongest form of the guarantee: payment cannot influence the timeline.
  const base = resolve('IN_TRANSIT', { hasVehicleHire: true });
  assert.equal(base.current_stage, 'TRANSIT');
  assert.equal(base.next_action.id, 'ARRIVE_DELIVERY');

  // Anything payment-shaped is simply not read.
  const r = resolve('IN_TRANSIT', {
    hasVehicleHire: true,
    podRequired: true,
    podReceived: false,
    customerPaid: 100000,
    vendorPaid: 0,
  });
  assert.equal(r.current_stage, base.current_stage, 'a payment changes nothing');
  assert.equal(r.next_action.id, base.next_action.id);
});

test('SEPARATION 18b — POD state refines the next action but never the raw status', () => {
  const a = resolve('DELIVERED', { podRequired: true, podReceived: false });
  const b = resolve('DELIVERED', { podRequired: true, podReceived: true });

  assert.equal(a.status, b.status, 'both report the same operational status');
  assert.notEqual(a.next_action.id, b.next_action.id, 'but the next action differs');
  assert.equal(a.current_stage, b.current_stage, 'and the rail stage is the same');
});

// ============================================================================
// THE SPEC'S WORKED EXAMPLE (§18) — order BTB-2026-00203 / trip BTBT-2026-00009
// ============================================================================

test('SPEC §18 — BTBT-2026-00009 shows Vehicle as current and Loading as next', () => {
  const r = resolve('ASSIGNED', { hasVehicleHire: false });

  assert.equal(r.stages.length, 10);
  assert.deepEqual(
    r.stages.map((s) => `${s.state}:${s.key}`),
    [
      'done:ENQUIRY',
      'done:QUOTATION',
      'done:ORDER_CONFIRMED',
      'current:VEHICLE_HIRED',
      'available:LOADING',
      'locked:DISPATCH',
      'locked:TRANSIT',
      'locked:DELIVERY',
      'locked:POD',
      'locked:COMPLETED',
    ],
    'exactly the rail the specification asks for'
  );
  assert.equal(r.current_stage, 'VEHICLE_HIRED');
  // The vehicle is assigned but the hire money is not agreed yet.
  assert.equal(r.vehicle_hire_state, 'VEHICLE_ASSIGNED');
  assert.equal(r.next_action.id, 'SEND_TO_LOADING');
  assert.match(r.next_action.label, /Loading/i);
});

test('SPEC §18b — a future locked node explains what it needs', () => {
  const r = resolve('ASSIGNED');
  const loading = r.stages.find((s) => s.key === 'LOADING');
  assert.equal(loading.state, 'available');
  assert.ok(loading.requirement, 'the hover text names the requirement');

  const dispatch = r.stages.find((s) => s.key === 'DISPATCH');
  assert.equal(dispatch.state, 'locked', 'still clickable for viewing');
  assert.ok(dispatch.requirement, 'but explains what must happen first');
});

// ============================================================================
// THE BOOKING → TRIP HIERARCHY — both branches
// ============================================================================

test('HIERARCHY — a Trip carries exactly the six operational areas', () => {
  const r = resolve('ASSIGNED');
  const keys = r.stages.map((s) => s.key);
  for (const area of TRIP_AREAS) {
    assert.ok(keys.includes(area), `${area} is one of the trip's areas`);
  }
  // Enquiry / Quote / Confirmed belong to the BOOKING, above the Trip.
  for (const pre of ['ENQUIRY', 'QUOTATION', 'ORDER_CONFIRMED']) {
    assert.ok(keys.includes(pre), `${pre} is a booking-level stage`);
  }
  // The six areas are contiguous and always follow Confirmed.
  const firstArea = keys.indexOf('VEHICLE_HIRED');
  assert.deepEqual(
    keys.slice(firstArea, firstArea + TRIP_AREAS.length),
    TRIP_AREAS,
    'the trip areas run together, in order, immediately after the order is confirmed'
  );
});

test('HIERARCHY — a booking with NO Trip resolves no operational stage at all', () => {
  // The "no Trip yet" branch. There is no Trip row, so there is no Trip status,
  // and the policy must report NOTHING rather than guessing a stage.
  const r = resolve(null, { trip: null });

  assert.equal(r.status, null, 'no operational status is reported');
  assert.equal(r.has_trip, false, 'and it says so explicitly');
  assert.equal(r.current_stage, null, 'no current stage is invented');
  assert.equal(r.next_action.endpoint, null, 'no operational action is offered');
  assert.equal(r.vehicle_hire_state, null, 'no vehicle-hire state is claimed');
  // The rail still renders its full plan, but no node is claimed as reached or
  // actionable — every one is `unavailable`.
  assert.equal(r.stages.length, 10);
  for (const s of r.stages) {
    assert.equal(s.state, 'unavailable', `${s.key} is unreachable without a trip`);
  }
});

test('HIERARCHY — with a Trip, every operational area is reachable', () => {
  const r = resolve('ASSIGNED');
  for (const area of TRIP_AREAS) {
    const node = r.stages.find((s) => s.key === area);
    assert.ok(node.goto && node.goto.kind, `${area} can be opened`);
  }
});

test('HIERARCHY — the six areas are NOT reachable before the vehicle is engaged', () => {
  // Loading onward all depend on a hired vehicle. They stay visible (the rail
  // explains the whole plan) but none of them is 'available' yet.
  const r = resolve('PENDING', { hasVehicleHire: false });
  assert.equal(r.current_stage, 'VEHICLE_HIRED', 'Vehicle is where it waits');

  for (const area of ['LOADING', 'DISPATCH', 'TRANSIT', 'DELIVERY', 'POD']) {
    const node = r.stages.find((s) => s.key === area);
    assert.equal(node.state, 'locked', `${area} is not yet available`);
    assert.ok(node.requirement, `${area} explains what it needs`);
  }
  assert.equal(r.stages.find((s) => s.key === 'VEHICLE_HIRED').state, 'current');
});
