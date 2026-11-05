/**
 * config/dispatchPolicy.js
 * ============================================================================
 * THE canonical answer to "may this vehicle leave the loading point, and what
 * is still missing?".
 *
 * WHY A SEPARATE FILE (and not a constant inside TripDispatchService)
 *   This repository already uses exactly this pattern for the commission rate
 *   (config/commissionPolicy.js) and for the mandatory paper set
 *   (config/tripDocumentPolicy.js). A dispatch rule declared in a service is a
 *   rule that will be declared a second, differently, six months later. So it
 *   is declared ONCE here and every caller — the readiness endpoint, the
 *   dispatch endpoint, the tests and the page's explanation text — reads the
 *   same value from the same place.
 *
 * EVERY RULE IS OVERRIDABLE PER TRIP, AND "UNSET" IS A REAL ANSWER
 *   Each rule below has a repository DEFAULT and a per-trip override. A trip
 *   column that is NULL means "nobody has decided", which is different from
 *   both TRUE and FALSE, and the resolver reports that honestly rather than
 *   guessing. This is what lets POD stay OPTIONAL and insurance stay
 *   CONDITIONAL instead of being hard-wired on for every consignment.
 *
 * THE STATUS GATE IS NOT HERE
 *   Which statuses may follow which is `utils/TripStateMachine.js`, and it was
 *   already correct. This file only answers "what paperwork and what equipment
 *   must be in place", never "what is the next status".
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// 1. OPERATIONAL STATUS GATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The ONE status a trip must be in for a dispatch to be legal.
 *
 * This is the rule the specification names explicitly:
 *     TO_LOADING_POINT → DISPATCHED     FORBIDDEN
 *     AT_LOADING_POINT → DISPATCHED     FORBIDDEN
 *     ASSIGNED          → DISPATCHED    FORBIDDEN
 *     LOADED            → DISPATCHED    ALLOWED
 *
 * `TripOperationalService.dispatch()` additionally refuses anything that has
 * not been through the loading chain, and `utils/TripStateMachine` refuses the
 * illegal edges, so this constant exists for the READINESS REPORT rather than
 * as a second gate: it is what lets the page say "loading has not been
 * completed" in the operator's own words instead of "the server has not
 * cleared this step yet".
 */
const DISPATCHABLE_STATUS = 'LOADED';

/**
 * Human wording for each status that is NOT dispatchable. Used only to build
 * a message the operator can act on — never to decide anything.
 */
const STATUS_BLOCKER_MESSAGE = Object.freeze({
  PENDING: 'No vehicle has been hired for this consignment yet.',
  ASSIGNED: 'The vehicle has not been sent to the loading point yet.',
  TO_LOADING_POINT: 'Loading has not been completed — the vehicle is still on its way to the loading point.',
  AT_LOADING_POINT: 'Loading has not been completed — the vehicle is at the loading point but is not loaded.',
  LOADED: null,
  DISPATCHED: null,
  IN_TRANSIT: null,
  DELIVERED: null,
  COMPLETED: null,
  CANCELLED: 'This consignment has been cancelled.',
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. BLOCKER CODES
// ═══════════════════════════════════════════════════════════════════════════
//
// A STABLE, MACHINE-READABLE VOCABULARY. The UI colours a row and prints its
// `message`; an API client can branch on `code`. Adding a code here is a
// compatible change; changing an existing one is not.

const BLOCKER = Object.freeze({
  TRIP_CANCELLED: 'TRIP_CANCELLED',
  TRIP_NOT_LOADED: 'TRIP_NOT_LOADED',
  LOADING_NOT_COMPLETED: 'LOADING_NOT_COMPLETED',
  NO_VEHICLE: 'NO_VEHICLE',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
  VEHICLE_DOCUMENT_EXPIRED: 'VEHICLE_DOCUMENT_EXPIRED',
  NO_DRIVER: 'NO_DRIVER',
  DRIVER_UNAVAILABLE: 'DRIVER_UNAVAILABLE',
  DOCUMENT_MISSING: 'DOCUMENT_MISSING',
  EWAY_BILL_REQUIRED: 'EWAY_BILL_REQUIRED',
  EWAY_BILL_EXPIRED: 'EWAY_BILL_EXPIRED',
  LR_GR_REQUIRED: 'LR_GR_REQUIRED',
  INSURANCE_REQUIRED: 'INSURANCE_REQUIRED',
  INSURANCE_EXPIRED: 'INSURANCE_EXPIRED',
  DELIVERY_INFORMATION_INCOMPLETE: 'DELIVERY_INFORMATION_INCOMPLETE',
});

/** Presentation metadata for a blocker code — the UI reads this, not a switch. */
const BLOCKER_META = Object.freeze({
  [BLOCKER.TRIP_CANCELLED]: { label: 'Consignment cancelled', severity: 'blocked' },
  [BLOCKER.TRIP_NOT_LOADED]: { label: 'Loading not completed', severity: 'blocked' },
  [BLOCKER.LOADING_NOT_COMPLETED]: { label: 'Loading not completed', severity: 'blocked' },
  [BLOCKER.NO_VEHICLE]: { label: 'Vehicle not assigned', severity: 'blocked' },
  [BLOCKER.VEHICLE_UNAVAILABLE]: { label: 'Vehicle not available', severity: 'blocked' },
  [BLOCKER.VEHICLE_DOCUMENT_EXPIRED]: { label: 'Vehicle document expired', severity: 'blocked' },
  [BLOCKER.NO_DRIVER]: { label: 'Driver not assigned', severity: 'blocked' },
  [BLOCKER.DRIVER_UNAVAILABLE]: { label: 'Driver not available', severity: 'blocked' },
  [BLOCKER.DOCUMENT_MISSING]: { label: 'Required document missing', severity: 'blocked' },
  [BLOCKER.EWAY_BILL_REQUIRED]: { label: 'E-Way Bill required', severity: 'blocked' },
  [BLOCKER.EWAY_BILL_EXPIRED]: { label: 'E-Way Bill expired', severity: 'blocked' },
  [BLOCKER.LR_GR_REQUIRED]: { label: 'LR/GR required', severity: 'blocked' },
  [BLOCKER.INSURANCE_REQUIRED]: { label: 'Transit insurance required', severity: 'blocked' },
  [BLOCKER.INSURANCE_EXPIRED]: { label: 'Transit insurance expired', severity: 'blocked' },
  [BLOCKER.DELIVERY_INFORMATION_INCOMPLETE]: { label: 'Delivery information incomplete', severity: 'blocked' },
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. E-WAY BILL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An e-way bill is statutorily required above a consignment value, so a small
 * local load is not held for paperwork that does not apply to it.
 *
 * The value used is `trips.value_of_goods` when the operator has declared it
 * (that is the number the law cares about), falling back to the freight we
 * charge only when the declared value was never captured — an honest fallback
 * rather than an invented one.
 */
const E_WAY_BILL_REQUIRED_ABOVE = 50000;

/** An e-way bill inside this many days of its expiry is reported as expiring. */
const E_WAY_BILL_EXPIRING_WITHIN_DAYS = 3;

// ═══════════════════════════════════════════════════════════════════════════
// 4. LR / GR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A lorry receipt is issued at loading for every road consignment, so the
 * repository default is that LR is mandatory before dispatch.
 *
 * `config/tripDocumentPolicy.js` ALSO lists LR in its required set. That is not
 * duplication: the document policy answers "which `trip_documents` rows must
 * exist", this answers "does the dispatch gate additionally insist on an LR/GR
 * NUMBER being written down". They are read together, and a trip that
 * overrides `documents_required` to an empty array is still refused here
 * unless it also overrides this rule — which is the point of making the rule
 * explicit.
 */
const LR_GR_REQUIRED_DEFAULT = true;

// ═══════════════════════════════════════════════════════════════════════════
// 5. TRANSIT INSURANCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Insurance is NOT required for every consignment. The default is therefore
 * "only when the declared value of the goods reaches the threshold", which is
 * the normal commercial rule for a road carrier, and a trip may override it in
 * either direction with `trips.insurance_required`.
 *
 * §15 is explicit: "Do not hard-code the requirement globally." Nothing in this
 * codebase does — a trip with `insured = false` and a low consignment value
 * dispatches normally and simply shows a soft warning.
 */
const INSURANCE_REQUIRED_ABOVE = 100000;

/** Inside this many days of expiry the policy is reported as EXPIRING. */
const INSURANCE_EXPIRING_WITHIN_DAYS = 7;

// ═══════════════════════════════════════════════════════════════════════════
// 6. VEHICLE DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The vehicle's own statutory papers, and how to read them.
 *
 * `TransportVehicle` stores these as TEXT (that is the pre-existing
 * representation and Phase 8 did not change it), in a mixture of formats, so
 * parsing is tolerant on purpose: an unparseable date is reported as UNKNOWN,
 * which renders as a warning, never as an invented expiry.
 *
 * `blocking` answers a BUSINESS question, not a legal one: "if this document
 * is already expired, may we still send the truck out?" Today only insurance,
 * permit and fitness block, because those three are what a stopped vehicle is
 * actually checked for. Tax, PUCC and the national permit report their state
 * without blocking, which is an explicit, reviewable decision recorded here
 * rather than left implicit.
 */
const VEHICLE_DOCUMENTS = Object.freeze([
  { key: 'INSURANCE', label: 'Insurance', number_field: 'insurance_number', expiry_field: 'insurance_expiry', blocking: true },
  { key: 'PERMIT', label: 'Permit', number_field: 'permit_number', expiry_field: 'permit_expiry', blocking: true },
  { key: 'FITNESS', label: 'Fitness', number_field: 'fitness_number', expiry_field: 'fitness_expiry', blocking: true },
  { key: 'PUCC', label: 'PUCC', number_field: 'pollution_certificate', expiry_field: 'pollution_expiry', blocking: false },
  { key: 'NATIONAL_PERMIT', label: 'National Permit', number_field: 'national_permit_number', expiry_field: 'national_permit_expiry', blocking: false },
  { key: 'TAX', label: 'Tax', number_field: 'tax_number', expiry_field: 'tax_expiry', blocking: false },
]);

/** Inside this many days of expiry a vehicle document is "EXPIRING_SOON". */
const VEHICLE_DOCUMENT_EXPIRING_WITHIN_DAYS = 30;

// ═══════════════════════════════════════════════════════════════════════════
// 7. DELIVERY INFORMATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The minimum that must be known BEFORE the vehicle leaves, because it cannot
 * be recovered from a truck that has already gone.
 *
 * `delivery_number` is NOT in this list: a delivery docket is frequently
 * assigned by the consignee at the moment of unloading, and demanding it at
 * dispatch would block loads that are otherwise perfectly legal. POD REQUIRED
 * IS required — because it is the operator stating, before departure, whether
 * proof of delivery will be collected, and that decision governs the whole
 * downstream workflow.
 */
const DELIVERY_INFO_REQUIRED = Object.freeze(['consignee_name', 'consignee_contact', 'pod_required_decided']);

// ═══════════════════════════════════════════════════════════════════════════
// 8. POD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * When neither the trip nor the operator has decided, POD is treated as NOT
 * required. §14 is explicit: "Do not make POD a permanent mandatory step for
 * trips where it is not required." Defaulting the other way would silently add
 * a step to every delivery.
 */
const POD_REQUIRED_DEFAULT = false;

// ═══════════════════════════════════════════════════════════════════════════
// 9. RESOLVERS (pure)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the POD requirement for a trip.
 *
 * Precedence: the operator's explicit decision at dispatch, then the trip
 * column if an earlier step set it, then the repository default.
 *
 * @param {{pod_required?: boolean|null}} trip
 * @returns {{required: boolean, source: 'DISPATCH_DECISION'|'TRIP'|'DEFAULT'}}
 */
function resolvePodRequirement(trip = {}) {
  const raw = trip.pod_required;
  if (raw === true || raw === false) {
    return { required: raw, source: raw === true ? 'DISPATCH_DECISION' : 'TRIP' };
  }
  return { required: POD_REQUIRED_DEFAULT, source: 'DEFAULT' };
}

/**
 * Resolve the transit-insurance requirement for a trip.
 *
 * @param {{insurance_required?: boolean|null, value_of_goods?: number|null,
 *          freight_amount?: number|null}} trip
 * @returns {{required: boolean, source: 'TRIP'|'GOODS_VALUE'|'DEFAULT'}}
 */
function resolveInsuranceRequirement(trip = {}) {
  const raw = trip.insurance_required;
  if (raw === true || raw === false) return { required: raw, source: 'TRIP' };

  const declared = trip.value_of_goods;
  const basis = Number.isFinite(Number(declared)) && declared !== null
    ? Number(declared)
    : Number(trip.freight_amount || 0);
  return { required: basis > INSURANCE_REQUIRED_ABOVE, source: 'GOODS_VALUE' };
}

/**
 * The consignment value that threshold decisions use.
 *
 * The DECLARED value of the goods is what the law and the insurer care about.
 * The freight we charge is only a fallback for a trip where nobody ever
 * captured a declaration — it is clearly labelled as such so no screen can
 * quietly present a freight figure as "value of goods".
 *
 * @param {Object} trip
 * @returns {{value: number, source: 'DECLARED'|'FREIGHT_FALLBACK'|'NONE'}}
 */
function consignmentValueFor(trip = {}) {
  const declared = Number(trip.value_of_goods);
  if (Number.isFinite(declared) && trip.value_of_goods !== null && trip.value_of_goods !== undefined) {
    return { value: declared, source: 'DECLARED' };
  }
  const freight = Number(trip.freight_amount);
  if (Number.isFinite(freight)) return { value: freight, source: 'FREIGHT_FALLBACK' };
  return { value: 0, source: 'NONE' };
}

/**
 * Is an e-way bill required for this consignment?
 *
 * @param {Object} trip
 * @returns {boolean}
 */
function isEwayBillRequired(trip = {}) {
  const { value } = consignmentValueFor(trip);
  return value > E_WAY_BILL_REQUIRED_ABOVE;
}

/**
 * Classify a date against today.
 *
 * @param {Date|string|null} value
 * @param {number} warningDays
 * @param {Date} [now]
 * @returns {'EXPIRED'|'EXPIRING_SOON'|'VALID'|'NOT_RECORDED'|'UNKNOWN'}
 */
function classifyExpiry(value, warningDays, now = new Date()) {
  if (value === null || value === undefined || value === '') return 'NOT_RECORDED';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'UNKNOWN';

  const days = (d.getTime() - now.getTime()) / 86400000;
  if (days < 0) return 'EXPIRED';
  if (days <= warningDays) return 'EXPIRING_SOON';
  return 'VALID';
}

module.exports = {
  DISPATCHABLE_STATUS,
  STATUS_BLOCKER_MESSAGE,
  BLOCKER,
  BLOCKER_META,
  E_WAY_BILL_REQUIRED_ABOVE,
  E_WAY_BILL_EXPIRING_WITHIN_DAYS,
  LR_GR_REQUIRED_DEFAULT,
  INSURANCE_REQUIRED_ABOVE,
  INSURANCE_EXPIRING_WITHIN_DAYS,
  VEHICLE_DOCUMENTS,
  VEHICLE_DOCUMENT_EXPIRING_WITHIN_DAYS,
  DELIVERY_INFO_REQUIRED,
  POD_REQUIRED_DEFAULT,
  resolvePodRequirement,
  resolveInsuranceRequirement,
  consignmentValueFor,
  isEwayBillRequired,
  classifyExpiry,
};
