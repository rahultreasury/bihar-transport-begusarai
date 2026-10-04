/**
 * tripProcessModel.js
 * ---------------------------------------------------------------------------
 * ONE TRIP, MANY OPERATIONAL WORKSPACES — the pure model behind it.
 *
 * THE PROBLEM THIS ENCODES
 *   The Trip is the master record, but "where is this consignment now?" and
 *   "what can I do about loading right now?" are different questions. Rendering
 *   one page for both is what made every step in the process stepper look like it
 *   did nothing.
 *
 *   So: the Trip is addressed by ONE id, and the PROCESS is addressed by a second
 *   segment. `/admin/trips/1094/loading` and `/admin/trips/1094/pod` are the same
 *   trip, seen through different work.
 *
 * WHAT IS DECIDED HERE, AND WHERE IT COMES FROM
 *   Stage ORDER and reachability are read from the server's own lifecycle
 *   projection (`tripStagePolicy` via `GET /trips/:id/workflow`) — never
 *   re-derived here. A Trip status already decides which stage is current and
 *   which is next; this module only labels and arranges what the server said.
 *
 *   A STAGE IS ALWAYS REACHABLE. Clicking a future stage opens THAT stage and
 *   says "not started", with its prerequisites listed. It is never redirected
 *   back to the current stage, because silently showing the Loading page when
 *   the operator asked for Delivery is the exact confusion being removed.
 *
 *   ACTIONS ARE NOT. A control is enabled only when the server's own readiness
 *   check allows it. This module never invents permission.
 *
 * PURE. No React, no fetch — so the rules are unit tested directly.
 */

/** The processes, in operational order. The URL segment IS the key. */
export const TRIP_PROCESSES = Object.freeze([
  { key: 'vehicle', label: 'Vehicle', short: 'Vehicle', title: 'Vehicle Hiring' },
  { key: 'loading', label: 'Loading', short: 'Loading', title: 'Loading Workspace' },
  { key: 'dispatch', label: 'Dispatch', short: 'Dispatch', title: 'Dispatch Workspace' },
  { key: 'transit', label: 'Transit', short: 'Transit', title: 'Transit & Tracking' },
  { key: 'delivery', label: 'Delivery', short: 'Delivery', title: 'Delivery Workspace' },
  { key: 'pod', label: 'POD', short: 'POD', title: 'Proof of Delivery' },
  { key: 'completed', label: 'Completed', short: 'Completed', title: 'Trip Completion Summary' },
]);

/** How a stage relates to the trip RIGHT NOW. */
export const STAGE_STATE = Object.freeze({
  DONE: 'done',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
});

const ORDER = TRIP_PROCESSES.map((p) => p.key);

/** Is this a process we recognise? An unknown segment must not render a page. */
export function isKnownProcess(key) {
  return ORDER.includes(String(key || '').toLowerCase());
}

/**
 * The processes the Loading → Dispatch deployment actually serves.
 *
 * The full lifecycle model above still knows every process, because the stage
 * rail, `normalizeProcess` and the order/trip-master screens all describe the
 * whole journey. But the trip process PAGE in this deployment renders Loading
 * and Dispatch only — the Transit, Delivery, POD and Completion workspaces ship
 * with their own phases, and the Vehicle Hire workspace ships with the hire
 * module.
 *
 * A request for one of those still gets a real answer rather than a blank
 * screen: `AdminTripProcess` treats the key as unknown and says so, rather than
 * silently falling through to the Trip Overview.
 */
export const LOADING_AND_DISPATCH_ONLY = Object.freeze(new Set(['loading', 'dispatch']));

/**
 * Normalise the URL segment.
 * The stepper historically used `tracking` and `summary`; both are the same
 * processes, so they resolve rather than 404. Everything else is taken as-is.
 */
export function normalizeProcess(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'tracking') return 'transit';
  if (k === 'summary' || k === 'complete') return 'completed';
  if (k === 'vehicle_hire' || k === 'vehicle-hire') return 'vehicle';
  return k;
}

/** The full process record for a segment. */
export function processMeta(key) {
  const k = normalizeProcess(key);
  return TRIP_PROCESSES.find((p) => p.key === k) || null;
}

/**
 * The stage KEY the server rail uses for a process.
 * `VEHICLE_HIRED` is the rail key for the vehicle stage.
 */
const SERVER_STAGE_FOR_PROCESS = Object.freeze({
  vehicle: 'VEHICLE_HIRED',
  loading: 'LOADING',
  dispatch: 'DISPATCH',
  transit: 'TRANSIT',
  delivery: 'DELIVERY',
  pod: 'POD',
  completed: 'COMPLETED',
});

/**
 * Locate a process within the server's stage rail.
 *
 * @param {{key:string}[]} stages  the rail nodes from `workflow.stages`
 * @param {string} processKey
 * @returns {{index:number, total:number, state:string}|null}
 */
export function locateStage(stages = [], processKey) {
  const key = normalizeProcess(processKey);
  const serverKey = SERVER_STAGE_FOR_PROCESS[key];
  if (!serverKey || !Array.isArray(stages) || stages.length === 0) return null;

  const index = stages.findIndex((s) => s.key === serverKey);
  if (index === -1) return null;

  // The SERVER says which stages are behind us. This module never re-decides
  // that from the trip status — it only reports what it was told.
  const node = stages[index];
  const state = node.state === 'done' || node.state === 'completed'
    ? STAGE_STATE.DONE
    : node.state === 'current' || node.state === 'available'
      ? STAGE_STATE.CURRENT
      : STAGE_STATE.UPCOMING;

  return { index, total: stages.length, state, requirement: node.requirement || null };
}

/**
 * The full stepper rail for a process page: every process, with its state.
 *
 * @param {object[]} stages  the rail nodes from `workflow.stages`
 * @param {string} selected  the process being viewed
 */
export function buildRail(stages = [], selected) {
  const sel = normalizeProcess(selected);
  const current = locateStage(stages, sel);

  return TRIP_PROCESSES.map((p) => {
    const at = locateStage(stages, p.key);
    const state = at?.state || STAGE_STATE.UPCOMING;
    return {
      key: p.key,
      label: p.label,
      short: p.short,
      title: p.title,
      state,
      isSelected: p.key === sel,
      // The stage BEHIND the current one is the one you would do next; that is
      // exactly what the server calls "available".
      isCurrent: current?.state === STAGE_STATE.CURRENT && p.key === sel,
      requirement: at?.requirement || null,
    };
  });
}

/**
 * HAS THIS PROCESS HAPPENED?
 *
 * Used to decide between "show the completed record" and "show NOT STARTED with
 * prerequisites". Derived from the server rail plus the trip status, and it is
 * deliberately conservative: anything it cannot prove as done is shown as not
 * started rather than assumed complete.
 */
export function isProcessComplete(tripStatus, stages, processKey) {
  const at = locateStage(stages, processKey);
  if (at?.state === STAGE_STATE.DONE) return true;

  // POD is special: the server rail has no trip_status of its own, so fall back
  // to the trip being COMPLETED, which cannot happen without the POD resolved.
  if (normalizeProcess(processKey) === 'pod') return String(tripStatus || '').toUpperCase() === 'COMPLETED';
  return false;
}

/**
 * WHY AN ACTION CANNOT RUN YET.
 *
 * @param {{ready:boolean, blockers?:Array<{code:string,message:string}>}} readiness
 *   the server's own readiness answer (dispatch/readiness, delivery/readiness)
 * @returns {string|null} a message to show, or null when it is allowed
 */
export function blockedReason(readiness) {
  if (!readiness) return null;
  if (readiness.ready === true) return null;
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  if (blockers.length === 0) return 'The server has not cleared this step yet.';
  return blockers
    .map((b) => b?.message || b?.code)
    .filter(Boolean)
    .join(' · ');
}

/**
 * The human sentence for a future stage, so clicking one is never a dead end.
 *
 * @param {object} args
 * @param {string} args.processKey
 * @param {string} args.tripStatus
 * @param {object[]} args.stages
 * @returns {{started:boolean, headline:string, waitingFor:string|null}}
 */
export function describeProcessState({ processKey, tripStatus, stages = [] }) {
  const key = normalizeProcess(processKey);
  const meta = processMeta(key);
  const label = meta?.label || 'This step';
  const complete = isProcessComplete(tripStatus, stages, key);

  if (complete) {
    return { started: true, headline: `${label.toUpperCase()} COMPLETED`, waitingFor: null };
  }

  // What is the trip actually doing right now? That is what this stage waits on.
  const current = TRIP_PROCESSES.find((p) => locateStage(stages, p.key)?.state === STAGE_STATE.CURRENT);
  const waitingFor = current && current.key !== key ? current.label : null;

  return {
    started: false,
    headline: `${label.toUpperCase()} NOT STARTED`,
    waitingFor,
  };
}

/** THE URL for a process — the single place a process link is ever built. */
export function processPath(tripId, processKey) {
  const key = normalizeProcess(processKey);
  return `/admin/trips/${tripId}/${key}`;
}