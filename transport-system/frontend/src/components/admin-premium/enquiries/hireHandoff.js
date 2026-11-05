/**
 * hireHandoff.js
 * ---------------------------------------------------------------------------
 * THE ENQUIRY → VEHICLE HIRE HANDOFF, AS PURE DATA.
 *
 * WHY A SEPARATE MODULE
 *   The Enquiry page must NOT hire vehicles. After a customer accepts the final
 *   quote the enquiry is CONFIRMED and the consignment is handed to the ONE
 *   Universal Vehicle Hire workspace. This module owns that handoff and nothing
 *   else: which of the three server states applies, what it is called, what the
 *   single navigation action should say, and where that action goes.
 *
 *   It is deliberately free of React and of any network call so it can be unit
 *   tested directly (see tests/enquiryVehicleHireBoundary.test.js) and so the
 *   card that renders it cannot accidentally grow logic.
 *
 * THE SERVER IS THE ONLY SOURCE OF TRUTH
 *   `describeHireAssignment()` renders `assignment.hire_status` exactly as the
 *   backend sent it. It never derives "hired" from the customer's acceptance of
 *   a quote, never computes gross hire / commission / net vendor payable, and
 *   never infers a vehicle that the server did not return. The three states are
 *   kept deliberately distinct:
 *
 *     WAITING_FOR_VEHICLE  no vehicle engaged yet
 *     VEHICLE_ASSIGNED     vehicle engaged, hire money NOT yet agreed
 *     VEHICLE_HIRED        a `vehicle_hires` row exists (gross/commission/net)
 *
 *   "Assigned" is never presented as "Hired", and a customer accepting a quote
 *   never produces a HIRED state — a quote is a different stage, and the backend
 *   enforces the difference.
 *
 * ONE WORKFLOW, ONE ROUTE
 *   Every state resolves to the SAME Universal Vehicle Hire screen. There is no
 *   second hire form anywhere in the application.
 */

/** The server's canonical vehicle-hire states (`policy.HIRE_STATE`). */
export const HIRE_STATE = {
  WAITING_FOR_VEHICLE: 'WAITING_FOR_VEHICLE',
  VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED',
  VEHICLE_HIRED: 'VEHICLE_HIRED',
};

/**
 * THE OPERATIONAL HANDOFF STAGE — the four states an operator actually acts on.
 *
 * The three server `hire_status` values (below) describe the RESOURCE state.
 * These four describe the WORKFLOW state, which additionally knows whether the
 * quote has been sent and whether the customer has accepted. Both are needed:
 * a consignment whose vehicle is assigned but whose quote is still being
 * written is in a different place from one whose quote is already with the
 * customer, and the operator's next action is different in each.
 *
 *   NEED_RESOURCES   nothing engaged yet            → assign vehicle + driver
 *   RESOURCES_READY  vehicle + driver reserved      → finalise the quote
 *   QUOTE_SENT       quote delivered WITH the truck → wait for the customer
 *   CONFIRMED        customer accepted              → send to loading
 *
 * Derived from server state only. Nothing here infers a vehicle from a price or
 * an acceptance from a status the backend did not report.
 */
export const HANDOFF_STAGE = Object.freeze({
  NEED_RESOURCES: 'NEED_RESOURCES',
  RESOURCES_READY: 'RESOURCES_READY',
  QUOTE_SENT: 'QUOTE_SENT',
  CONFIRMED: 'CONFIRMED',
});

/** Enquiry statuses in which the customer has committed. */
const CUSTOMER_COMMITTED = ['CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

/**
 * Which handoff stage a consignment is in.
 *
 * @param {{assignment?:object|null, enquiryStatus?:string|null}} input
 * @returns {string} one of HANDOFF_STAGE
 */
export function handoffStage({ assignment, enquiryStatus } = {}) {
  const status = String(enquiryStatus || '').toUpperCase();

  // The customer already agreed. The resources were reserved BEFORE the quote,
  // so there is nothing left to wait for — the next step is loading.
  if (CUSTOMER_COMMITTED.includes(status)) return HANDOFF_STAGE.CONFIRMED;

  const hireStatus = assignment?.hire_status;
  const resourcesHeld =
    hireStatus === HIRE_STATE.VEHICLE_ASSIGNED || hireStatus === HIRE_STATE.VEHICLE_HIRED;

  // THE QUOTE BEING SENT IS NOT PROOF THE RESOURCES ARE HELD.
  //
  // `AWAITING_CUSTOMER_ACCEPTANCE` only says the customer has the quote. An
  // enquiry can reach that status with NOTHING reserved — and then the card
  // claimed "Ready for Customer" and offered a Trip workspace, which does not
  // exist, producing `/admin/trips//vehicle` → `/admin/trips/vehicle` → HTTP
  // 400 "Invalid trip ID". So the stage is decided by what is actually held,
  // and the status alone only ever PROMOTES a stage, never invents one.
  if (!resourcesHeld) return HANDOFF_STAGE.NEED_RESOURCES;

  // Resources ARE engaged (or the hire is agreed) and the quote is with the
  // customer, carrying the vehicle and driver with it.
  if (status === 'AWAITING_CUSTOMER_ACCEPTANCE') return HANDOFF_STAGE.QUOTE_SENT;

  return HANDOFF_STAGE.RESOURCES_READY;
}

/**
 * MAY THE FINAL QUOTE BE SENT YET?
 *
 * The whole point of the new workflow: a customer must never receive a price and
 * then be told to wait while a vehicle is found. So the quote is only publishable
 * once a price exists AND both resources are reserved — the quote and the truck
 * travel to the customer as one package.
 *
 * This is a UX GATE only. It never bypasses a server rule; it stops the operator
 * being offered a button the workflow says cannot be used yet.
 *
 * @param {{assignment?:object|null, finalPrice?:number|string|null}} input
 * @returns {{allowed:boolean, reason:string|null}}
 */
export function canFinalizeQuote({ assignment, finalPrice } = {}) {
  const price = Number(finalPrice);
  if (!finalPrice || !Number.isFinite(price) || price <= 0) {
    return { allowed: false, reason: 'Enter the final quote amount first.' };
  }
  if (!assignment?.vehicle) {
    return { allowed: false, reason: 'Assign a vehicle before sending the quote to the customer.' };
  }
  if (!assignment?.driver) {
    return { allowed: false, reason: 'Assign a driver before sending the quote to the customer.' };
  }
  return { allowed: true, reason: null };
}

/**
 * Presentation per canonical resource state.
 *
 * The KEYS are the server's state values. If the backend ever adds a state this
 * table simply has no entry and the card falls back to the raw value plus the
 * generic "Open Vehicle Hire" action, rather than guessing a meaning for it.
 */
export const HIRE_STATE_VIEW = {
  [HIRE_STATE.WAITING_FOR_VEHICLE]: {
    label: 'Waiting for Vehicle',
    // The consignment is confirmed but no truck is engaged. Staff assign one
    // from the Vehicle Hire screen.
    action: 'Hire Vehicle',
    tone: 'waiting',
  },
  [HIRE_STATE.VEHICLE_ASSIGNED]: {
    label: 'Vehicle Assigned',
    // A truck and driver are engaged but the hire money is not agreed yet.
    // "Complete" is accurate; calling this "Hired" would be a lie.
    action: 'Complete Vehicle Hire',
    tone: 'assigned',
  },
  [HIRE_STATE.VEHICLE_HIRED]: {
    label: 'Vehicle Hired',
    // Already agreed — offer to view or edit, never to hire again.
    action: 'View Vehicle Hire',
    tone: 'hired',
  },
};

/** Used when the server reports a state this build does not know about. */
export const UNKNOWN_HIRE_STATE_VIEW = {
  label: null, // render the raw server value instead
  action: 'Open Vehicle Hire',
  tone: 'unknown',
};

/**
 * The one and only Universal Vehicle Hire route.
 *
 * The canonical route is `/vehicle-hire` (registered in App.jsx). The legacy
 * `/vehicle` route is kept as a Trip process stage and redirects to the
 * canonical route for backward compatibility with existing bookmarks.
 */
export const HIRE_ROUTE_PATTERN = '/admin/trips/:tripId/vehicle-hire';

/**
 * The Universal Vehicle Hire URL for a consignment.
 *
 * @param {number|string|null|undefined} tripId
 * @param {{edit?:boolean}} [options]
 * @returns {string} `/admin/trips/<tripId>/vehicle-hire` (optionally `?edit=1`)
 */
export function hireRouteFor(tripId, options = {}) {
  const id = tripId === null || tripId === undefined ? '' : String(tripId).trim();
  // NO TRIP, NO TRIP URL. Before the customer accepts there is no Trip at all,
  // and `/admin/trips//vehicle-hire` collapses to `/admin/trips/vehicle-hire`,
  // which React Router reads as tripId="vehicle-hire" and the API rejects with 400.
  // Returning null makes the caller render the enquiry-stage reservation action
  // instead of navigating somewhere that cannot exist.
  if (!/^\d+$/.test(id)) return null;
  return `/admin/trips/${id}/vehicle-hire${options.edit ? '?edit=1' : ''}`;
}

/** True when the server says a hire record exists for this consignment. */
export function isHireCompleted(assignment) {
  return assignment?.hire_status === HIRE_STATE.VEHICLE_HIRED;
}

/** "BR09CC0004 · Ashok Leyland Tempo" — or a plain "Not assigned". */
export function vehicleLabel(assignment) {
  const vehicle = assignment?.vehicle || null;
  const number = vehicle?.vehicle_number || null;
  if (!number) return 'Not assigned';
  const name = vehicle?.vehicle_name || vehicle?.vehicle_type || null;
  return name ? `${number} · ${name}` : String(number);
}

/** The driver's name, or a plain "Not assigned". */
export function driverLabel(assignment) {
  return assignment?.driver?.driver_name || 'Not assigned';
}

/**
 * THE OWNER, shown honestly.
 *
 * Three genuinely different situations, kept apart on purpose:
 *
 *   • no vendor at all            → "Not assigned"
 *   • a PLACEHOLDER vendor row    → "Owner not recorded"
 *   • a real business             → its name
 *
 * The middle case is the one that used to read "Orphan Driver Owner" on screen.
 * That row is real (vehicles point at it, and payouts route on its id), but it
 * is not a business — printing its name tells the operator nothing and hides the
 * paperwork somebody still has to complete. The backend marks it with
 * `vendor.placeholder`, and the id is never rewritten here: swapping in a
 * different owner would send one company's money to another.
 */
export function vendorLabel(assignment) {
  const vendor = assignment?.vendor || null;
  if (!vendor) return 'Not assigned';
  if (vendor.placeholder) return 'Owner not recorded';
  return vendor.display_name || vendor.owner_name || 'Not assigned';
}

/** True when the vendor is a placeholder row awaiting real owner paperwork. */
export function isOwnerUnrecorded(assignment) {
  return Boolean(assignment?.vendor?.placeholder);
}

/**
 * Everything the handoff card renders, derived ONLY from one server payload.
 *
 * @param {object|null} assignment - the body of
 *        `GET /api/vehicle-hire/assignment?enquiry_id=|booking_id=`
 * @returns {{
 *   state: string|null, stateLabel: string, action: string, tone: string,
 *   tripId: number|string|null, tripNumber: string|null,
 *   vehicle: string, driver: string, vendor: string, tripStatus: string,
 *   hire: object|null, isHired: boolean, route: string
 * }}
 */
export function describeHireAssignment(assignment) {
  const state = assignment?.hire_status || null;
  const view = (state && HIRE_STATE_VIEW[state]) || UNKNOWN_HIRE_STATE_VIEW;
  const tripId = assignment?.trip_id ?? null;

  return {
    state,
    stateLabel: view.label || String(state || 'Unknown'),
    action: view.action,
    tone: view.tone,
    tripId,
    tripNumber: assignment?.trip_number || null,
    vehicle: vehicleLabel(assignment),
    driver: driverLabel(assignment),
    vendor: vendorLabel(assignment),
    tripStatus: String(assignment?.trip_status || '').replace(/_/g, ' '),
    // Shown verbatim when it exists. The ENQUIRY page never recomputes hire
    // money — these three figures are calculated by the Vehicle Hire workflow
    // and read back from it.
    hire: assignment?.hire || null,
    isHired: isHireCompleted(assignment),
    route: hireRouteFor(tripId),
  };
}