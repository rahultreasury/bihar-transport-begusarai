/**
 * config/tripStagePolicy.js
 * ============================================================================
 * THE canonical answer to "where is this consignment, and what happens next?".
 *
 * WHY THIS FILE EXISTS
 *   The Order / Trip Master shows a ten-stage lifecycle and a "Next Action".
 *   Previously that mapping lived only in the browser (`utils/orderStatus.js`),
 *   which meant:
 *     • the React component had to know operational rules, and
 *     • the Trip statuses added by the loading / dispatch / transit phases
 *       (TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED) were NOT in the
 *       browser's table at all, so a trip sitting in LOADED lost its stage
 *       entirely and the rail appeared to fall back to "Vehicle".
 *
 *   This module is the single mapping, derived purely from `Trip.status`, and is
 *   served through the EXISTING `GET /api/trips/:id/workflow`. It adds no new
 *   workflow: every `action` below names an endpoint and a method that already
 *   exists in `routes/tripRoutes.js` or `routes/vehicleHireRoutes.js`.
 *
 * TRIP REMAINS THE ONLY SOURCE (§17)
 *   Nothing here reads Booking.status, Enquiry.status or VehicleHire.status. A
 *   hire is folded in only to distinguish "waiting for a vehicle" from "vehicle
 *   assigned", and even then the decision is anchored on the Trip row.
 *
 * CLICKING A STAGE NEVER CHANGES STATUS
 *   `stage.goto` is a DESTINATION (a route or a workspace), never a mutation.
 *   A status only ever changes through the `action` endpoint, which is guarded by
 *   the existing `TripStateMachine`. That is why a future stage is clickable for
 *   VIEWING requirements while remaining impossible to shortcut into.
 */

'use strict';

/**
 * The ten lifecycle stages the Order / Trip Master rail shows.
 * `goto` is what clicking the node opens. `stageKey` maps to a Trip status.
 */
const STAGES = Object.freeze([
  { key: 'ENQUIRY', label: 'Enquiry', trip_status: null, goto: { kind: 'enquiry' } },
  { key: 'QUOTATION', label: 'Quote', trip_status: null, goto: { kind: 'enquiry', anchor: 'quote' } },
  { key: 'ORDER_CONFIRMED', label: 'Confirmed', trip_status: null, goto: { kind: 'overview' } },
  { key: 'VEHICLE_HIRED', label: 'Vehicle', trip_status: 'ASSIGNED', goto: { kind: 'vehicle_hire' } },
  { key: 'LOADING', label: 'Loading', trip_status: 'AT_LOADING_POINT', goto: { kind: 'trip_tab', tab: 'loading' } },
  { key: 'DISPATCH', label: 'Dispatch', trip_status: 'DISPATCHED', goto: { kind: 'trip_tab', tab: 'dispatch' } },
  { key: 'TRANSIT', label: 'Transit', trip_status: 'IN_TRANSIT', goto: { kind: 'trip_tab', tab: 'tracking' } },
  { key: 'DELIVERY', label: 'Delivery', trip_status: 'DELIVERED', goto: { kind: 'trip_tab', tab: 'delivery' } },
  { key: 'POD', label: 'POD', trip_status: null, goto: { kind: 'trip_tab', tab: 'pod' } },
  { key: 'COMPLETED', label: 'Completed', trip_status: 'COMPLETED', goto: { kind: 'trip_tab', tab: 'summary' } },
]);

/**
 * Trip status → lifecycle stage.
 *
 * The COMPLETE mapping. A trip in `LOADED` is at LOADING; in `DISPATCHED` it is
 * at DISPATCH; in `TO_LOADING_POINT` / `AT_LOADING_POINT` it is still LOADING.
 * Previously these four returned null and the stage was lost.
 */
const STATUS_TO_STAGE = Object.freeze({
  PENDING: 'VEHICLE_HIRED',
  ASSIGNED: 'VEHICLE_HIRED',
  TO_LOADING_POINT: 'LOADING',
  AT_LOADING_POINT: 'LOADING',
  LOADED: 'LOADING',
  DISPATCHED: 'DISPATCH',
  IN_TRANSIT: 'TRANSIT',
  DELIVERED: 'POD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'COMPLETED',
});

/**
 * Trip status → the ONE next operational action.
 *
 * Every `endpoint` named here already exists; nothing new is invented:
 *   loading/send · loading/arrive · loading/facts · loading/complete
 *   dispatch (+ /dispatch/readiness) · transit/start · arrival · delivered
 *   pod · complete
 *
 * `vehicle_hire` actions point at the Universal Vehicle Hire module, so the
 * Order Master and the Vehicle Hire page stay the SAME workflow.
 */
const NEXT_ACTION_BY_STATUS = Object.freeze({
  PENDING: {
    id: 'HIRE_VEHICLE',
    label: 'Hire Vehicle',
    stage: 'VEHICLE_HIRED',
    endpoint: '/api/vehicle-hire/trips/{tripId}',
    method: 'POST',
    requires_hire_form: true,
  },
  ASSIGNED: {
    id: 'SEND_TO_LOADING',
    label: 'Send / Schedule Vehicle for Loading',
    stage: 'LOADING',
    endpoint: '/api/trips/{tripId}/loading/send',
    method: 'POST',
    requires_hire_form: false,
  },
  TO_LOADING_POINT: {
    id: 'ARRIVE_LOADING',
    label: 'Mark Arrived at Loading',
    stage: 'LOADING',
    endpoint: '/api/trips/{tripId}/loading/arrive',
    method: 'POST',
  },
  AT_LOADING_POINT: {
    id: 'MARK_LOADED',
    label: 'Mark as Loaded',
    stage: 'LOADING',
    endpoint: '/api/trips/{tripId}/loading/complete',
    method: 'POST',
  },
  LOADED: {
    id: 'DISPATCH',
    label: 'Dispatch Vehicle',
    stage: 'DISPATCH',
    endpoint: '/api/trips/{tripId}/dispatch',
    method: 'POST',
  },
  DISPATCHED: {
    id: 'START_TRANSIT',
    label: 'Start Transit / View Tracking',
    stage: 'TRANSIT',
    endpoint: '/api/trips/{tripId}/transit/start',
    method: 'POST',
  },
  IN_TRANSIT: {
    id: 'ARRIVE_DELIVERY',
    label: 'Arrived at Delivery',
    stage: 'DELIVERY',
    endpoint: '/api/trips/{tripId}/arrival',
    method: 'POST',
  },
  DELIVERED: {
    id: 'UPLOAD_POD',
    label: 'Upload POD',
    stage: 'POD',
    endpoint: '/api/trips/{tripId}/pod',
    method: 'POST',
  },
  COMPLETED: {
    id: 'VIEW_SUMMARY',
    label: 'View Completion Summary',
    stage: 'COMPLETED',
    endpoint: null,
    method: null,
  },
  CANCELLED: {
    id: 'VIEW_SUMMARY',
    label: 'Order cancelled — no action required',
    stage: 'COMPLETED',
    endpoint: null,
    method: null,
  },
});

/**
 * Why a stage cannot be started yet. Shown on hover over a future stage, so the
 * rail explains itself instead of looking broken.
 */
const STAGE_REQUIREMENT = Object.freeze({
  LOADING: 'The vehicle must be hired and sent to the loading point first',
  DISPATCH: 'Loading must be completed before the vehicle can be dispatched',
  TRANSIT: 'Transit starts after the vehicle is dispatched',
  DELIVERY: 'Delivery opens once the vehicle is in transit',
  POD: 'Proof of delivery opens after the consignment is delivered',
  COMPLETED: 'The trip completes after delivery and, where required, POD',
});

/**
 * Resolve the lifecycle view for a trip.
 *
 * PURE — no database, no I/O — so the API, the page and the tests all get the
 * same answer from the same rule.
 *
 * @param {Object} params
 * @param {string|null} params.tripStatus   `Trip.status`, the operational truth
 * @param {boolean} [params.hasVehicleHire] a `vehicle_hires` row exists
 * @param {boolean} [params.podRequired]    POD is required for this trip
 * @param {boolean} [params.podReceived]    POD has been received
 * @param {Object} [params.trip]            trip row, for ids used in endpoints
 * @returns {Object} the stage view the page renders
 */
function resolveTripStage({
  tripStatus = null,
  hasVehicleHire = false,
  podRequired = true,
  podReceived = false,
  trip = null,
} = {}) {
  // A booking with NO Trip is a real and common state (an order that has not
  // become operational yet). It has no Trip status, so it is reported as null
  // rather than an empty string that looks like a status somebody forgot.
  const raw = String(tripStatus ?? '').trim().toUpperCase();
  const status = raw || null;
  const tripId = trip?.trip_id ?? null;

  // ── NO TRIP: nothing operational to report, and nothing to offer ──────────
  // The rail is still returned so the page renders its full plan, but no node is
  // current and no action is offered — there is no Trip to act on.
  if (status === null) {
    return {
      status: null,
      effective_status: null,
      has_trip: false,
      vehicle_hire_state: null,
      pod_required: false,
      pod_received: false,
      current_stage: null,
      current_stage_label: 'Not operational yet',
      next_action: {
        id: 'NONE',
        label: 'This order has no operational trip yet',
        stage: null,
        endpoint: null,
        method: null,
      },
      stages: STAGES.map((s) => ({
        key: s.key,
        label: s.label,
        trip_status: s.trip_status,
        goto: s.goto,
        // Not 'done', not 'current', not 'available' — simply unreachable.
        state: 'unavailable',
        requirement: 'This order has no operational trip yet',
      })),
    };
  }

  // ── The vehicle-hire stage is the ONE place a hire is consulted ────────────
  // A trip with no vehicle is "waiting", which is a different action from a trip
  // whose truck is assigned but whose money is not yet agreed. Both are derived
  // from the Trip row plus the hire row — never from Booking or Enquiry.
  let vehicleHireState = null;
  if (status === 'PENDING') {
    vehicleHireState = hasVehicleHire ? 'VEHICLE_HIRED' : 'WAITING_FOR_VEHICLE';
  } else if (status === 'ASSIGNED') {
    vehicleHireState = hasVehicleHire ? 'VEHICLE_HIRED' : 'VEHICLE_ASSIGNED';
  }

  // ── POD decides the two final transitions (§10, §12) ───────────────────────
  // POD is a DOCUMENT state, never a trip status, so it is applied here as a
  // next-action refinement rather than by inventing a new TripStatus.
  let effectiveStatus = status;
  if (status === 'DELIVERED') {
    effectiveStatus = podRequired && !podReceived ? 'POD_PENDING' : 'READY_TO_COMPLETE';
  }

  const action = nextActionFor(effectiveStatus, { podRequired, podReceived, tripId });
  const currentStageKey = stageKeyFor(effectiveStatus, status);

  return {
    // The raw operational status is returned untouched — payment, document and
    // POD state stay SEPARATE from it (§15).
    status,
    effective_status: effectiveStatus,
    vehicle_hire_state: vehicleHireState,
    pod_required: Boolean(podRequired),
    pod_received: Boolean(podReceived),

    current_stage: currentStageKey,
    current_stage_label: stageLabel(currentStageKey),
    next_action: action,
    has_trip: true,

    stages: STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      trip_status: s.trip_status,
      goto: s.goto,
      state: stageStateFor(s.key, currentStageKey, action.stage),
      // Every stage is viewable; only the current one and the one the next
      // action belongs to are "actionable". Nothing here can change a status.
      requirement: STAGE_REQUIREMENT[s.key] || null,
    })),
  };
}

/**
 * The one next action, as a descriptor the page turns into a link or a form.
 * @private
 */
function nextActionFor(status, { podRequired, podReceived, tripId }) {
  // POD branches that are decided by the DOCUMENT state, not the trip status.
  if (status === 'POD_PENDING') {
    return {
      id: 'UPLOAD_POD',
      label: 'Upload POD',
      stage: 'POD',
      endpoint: `/api/trips/${tripId}/pod`,
      method: 'POST',
      requires_hire_form: false,
    };
  }
  if (status === 'READY_TO_COMPLETE') {
    return {
      id: 'COMPLETE_TRIP',
      label: 'Complete Trip',
      stage: 'COMPLETED',
      endpoint: `/api/trips/${tripId}/complete`,
      method: 'POST',
    };
  }

  const base = NEXT_ACTION_BY_STATUS[status];
  if (!base) {
    return { id: 'NONE', label: 'No action required', stage: 'COMPLETED', endpoint: null, method: null };
  }

  // A trip that is merely "assigned" may still be waiting for a vehicle if the
  // hire was never completed — the Universal Vehicle Hire form handles both.
  return {
    ...base,
    endpoint: base.endpoint ? base.endpoint.replace('{tripId}', String(tripId ?? '')) : null,
  };
}

/**
 * Lifecycle stage for an effective status.
 * @private
 */
function stageKeyFor(effectiveStatus, rawStatus) {
  if (effectiveStatus === 'POD_PENDING' || effectiveStatus === 'READY_TO_COMPLETE') return 'POD';
  return STATUS_TO_STAGE[rawStatus] || STATUS_TO_STAGE[effectiveStatus] || 'VEHICLE_HIRED';
}

/** Human label for a stage key. @private */
function stageLabel(key) {
  return STAGES.find((s) => s.key === key)?.label || key;
}

/**
 * Visual state of one rail node, derived from its position relative to the
 * current stage. The four states the specification asks for.
 * @private
 */
function stageStateFor(key, currentKey, actionStage = null) {
  const i = STAGES.findIndex((s) => s.key === key);
  const cur = STAGES.findIndex((s) => s.key === currentKey);
  if (i < 0) return 'locked';
  if (i < cur) return 'done';
  if (i === cur) return 'current';
  // 'available' is the stage the NEXT ACTION belongs to — not simply
  // "current + 1". That distinction matters: a trip waiting for a vehicle is
  // current at VEHICLE_HIRED and its next action is still HIRE_VEHICLE, so
  // Loading must NOT be offered as available. It stays locked, with its
  // requirement shown, rather than implying loading could begin now.
  if (actionStage && key === actionStage) return 'available';
  return 'locked';
}

module.exports = {
  STAGES,
  STATUS_TO_STAGE,
  NEXT_ACTION_BY_STATUS,
  STAGE_REQUIREMENT,
  resolveTripStage,
};