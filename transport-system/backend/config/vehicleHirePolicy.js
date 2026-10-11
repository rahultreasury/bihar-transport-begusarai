/**
 * config/vehicleHirePolicy.js
 * ---------------------------------------------------------------------------
 * Single source of truth for the VEHICLE HIRE business rules.
 *
 * This mirrors the pattern the repository already uses for
 * config/commissionPolicy.js and config/tripDocumentPolicy.js: the rules live
 * in `config/`, the services read them, and no page or route ever restates one.
 *
 * WHAT LIVES HERE
 *   1. Who a hire can be billed to, and the business model each one implies.
 *   2. The rate bases ("Rate As Per") and what each one needs to compute gross.
 *   3. The commission types an operator may pick.
 *   4. Which vehicle documents are tracked, which of them are CRITICAL, and how
 *      far ahead of expiry a document starts showing "Expiring Soon".
 *   5. Which trip status means "waiting for a vehicle", which one the hire moves
 *      it to, and what the next operational step is afterwards.
 *
 * THE FINANCIAL SAFETY RULES, STATED ONCE
 *   - A hire establishes an OBLIGATION. It never records a payment.
 *   - `gross_hire` and `net_vendor_payable` are two separate stored columns and
 *     the net is never written over the gross.
 *   - Nothing here touches Customer Freight. Those are different concepts
 *     (customer_fare on TripFinancial / booking totals) and are deliberately not
 *     an input to any figure on this page.
 */

'use strict';

const commissionPolicy = require('./commissionPolicy');

/* ══════════════════════════════════════════════════════════════════════════
   BILLING PARTY → BUSINESS MODEL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * "Billing To" → "Business Model".
 *
 * The model is DERIVED from the billing party, never chosen freely, because the
 * two are the same decision spoken two ways:
 *   • Billed to the vehicle vendor  → we are BROKERING for a commission.
 *   • Billed to anyone else         → the hire is a CONTRACT arrangement and
 *                                      Bihar Transport's margin is contractual.
 *
 * An authorised override is possible (see BUSINESS_MODEL_OVERRIDE_ROLES) but it
 * is recorded explicitly rather than being a second free-floating choice, so the
 * hire always says which rule produced its model.
 */
const BILLING_TO_BUSINESS_MODEL = Object.freeze({
  CONSIGNOR: 'CONTRACT',
  CONSIGNEE: 'CONTRACT',
  THIRD_PARTY: 'CONTRACT',
  VEHICLE_VENDOR: 'COMMISSION',
});

/** Ordered list of billing parties, in the order the page shows them. */
const BILLING_TO_OPTIONS = Object.freeze([
  { value: 'CONSIGNOR', label: 'Consignor', hint: 'The party shipping the goods (our customer)' },
  { value: 'CONSIGNEE', label: 'Consignee', hint: 'The party receiving the goods' },
  { value: 'THIRD_PARTY', label: 'Third Party', hint: 'Some other named party' },
  { value: 'VEHICLE_VENDOR', label: 'Vehicle Vendor', hint: 'Billed to the vehicle owner / vendor' },
]);

/**
 * Roles permitted to override the derived business model.
 *
 * The existing permission vocabulary (middleware/auth.js → adminOnly) is
 * admin / super_admin / operator. Only `super_admin` may override, because the
 * override changes how revenue is reported for the trip. An operator sees the
 * field, always, but it is locked.
 */
const BUSINESS_MODEL_OVERRIDE_ROLES = Object.freeze(['super_admin']);

/* ══════════════════════════════════════════════════════════════════════════
   RATE AS PER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Each rate basis, and the arithmetic that turns the operator's inputs into the
 * GROSS vehicle hire.
 *
 *   mode 'RATE'            → gross = rate                       (Per Trip,
 *                                                            Transport Commission)
 *   mode 'RATE × QUANTITY' → gross = rate × quantity            (Per Ton, Per Kg,
 *                                                            Per Day, Monthly)
 *   mode 'NET'             → the operator enters the NET payable and the gross is
 *                            solved so that gross − commission = net exactly
 *                            (Net Freight)
 *
 * `unit` is what the quantity is counted in; the page renders it as the suffix
 * of the quantity field so the operator never has to guess.
 */
const RATE_BASIS_OPTIONS = Object.freeze([
  {
    value: 'FIXED',
    label: 'Per Trip',
    shortLabel: 'Per Trip',
    mode: 'RATE',
    quantityLabel: null,
    unit: null,
    rateLabel: 'Vehicle Hire Rate',
    hint: 'One agreed amount for the whole trip.',
  },
  {
    value: 'PER_TON',
    label: 'Per Ton',
    shortLabel: 'Per Ton',
    mode: 'RATE_QUANTITY',
    quantityLabel: 'Quantity',
    unit: 'Ton',
    rateLabel: 'Rate Per Ton',
    hint: 'Gross Vehicle Hire = Rate Per Ton × Quantity (Ton).',
  },
  {
    value: 'PER_KG',
    label: 'Per Kg',
    shortLabel: 'Per Kg',
    mode: 'RATE_QUANTITY',
    quantityLabel: 'Quantity',
    unit: 'Kg',
    rateLabel: 'Rate Per Kg',
    hint: 'Gross Vehicle Hire = Rate Per Kg × Quantity (Kg).',
  },
  {
    value: 'PER_DAY',
    label: 'Per Day',
    shortLabel: 'Per Day',
    mode: 'RATE_QUANTITY',
    quantityLabel: 'Number of Days',
    unit: 'Day',
    rateLabel: 'Rate Per Day',
    hint: 'Gross Vehicle Hire = Rate Per Day × Number of Days.',
  },
  {
    value: 'MONTHLY',
    label: 'Monthly',
    shortLabel: 'Monthly',
    mode: 'RATE_QUANTITY',
    quantityLabel: 'Number of Months',
    unit: 'Month',
    rateLabel: 'Rate Per Month',
    hint: 'Gross Vehicle Hire = Rate Per Month × Number of Months.',
  },
  {
    value: 'TRANSPORT_COMMISSION',
    label: 'Transport Commission',
    shortLabel: 'Transport Commission',
    mode: 'RATE',
    quantityLabel: null,
    unit: null,
    rateLabel: 'Transport Commission',
    hint: 'The transport charge agreed for this trip. Gross Vehicle Hire = the amount entered.',
  },
  {
    value: 'NET_FREIGHT',
    label: 'Net Freight',
    shortLabel: 'Net Freight',
    mode: 'NET',
    quantityLabel: null,
    unit: null,
    rateLabel: 'Net Freight (Vendor Payable)',
    hint: 'Enter the amount payable to the vendor. The gross and the commission are solved so that Gross − Commission = Net exactly.',
  },
]);

const RATE_BASIS = Object.freeze(RATE_BASIS_OPTIONS.map((o) => o.value));

/** The basis the page opens on. FIXED is the per-trip hire — the common case. */
const DEFAULT_RATE_BASIS = 'FIXED';

/* ══════════════════════════════════════════════════════════════════════════
   COMMISSION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `no_commission` is modelled as a real, selectable type rather than as
 * "percentage with a rate of 0", because the two mean different things to an
 * auditor: one is a deal with no commission, the other is a 0% commission
 * deal. Both produce ₹0; only the first is honest about which it was.
 *
 * The value the database stores in `commission_type` is 'percentage' for the
 * zero case, matching the existing 'percentage' | 'fixed' vocabulary already
 * used by CommissionRecord and CommissionCalculator.
 */
const COMMISSION_TYPE_OPTIONS = Object.freeze([
  { value: 'PERCENTAGE', label: 'Percentage', stored: 'percentage', hint: 'A percentage of the gross vehicle hire.' },
  { value: 'FIXED', label: 'Fixed Amount', stored: 'fixed', hint: 'A fixed rupee amount for this hire.' },
  { value: 'NO_COMMISSION', label: 'No Commission', stored: 'percentage', zero: true, hint: 'No commission on this hire. Both figures are ₹0.' },
]);

const COMMISSION_TYPES = Object.freeze(COMMISSION_TYPE_OPTIONS.map((o) => o.value));

/** The commission the page opens on: 5% percentage, per config/commissionPolicy. */
const DEFAULT_COMMISSION_TYPE = 'PERCENTAGE';

/** Mirrors commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE so the two can never drift. */
const DEFAULT_COMMISSION_PERCENTAGE = commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE;

/* ══════════════════════════════════════════════════════════════════════════
   VEHICLE DOCUMENT EXPIRY
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The documents the Vehicle Hire page reports on, read from the EXISTING
 * `transport_vehicles` row. There is no second copy of this data: the page only
 * ever displays what the vehicle master already stores, and this module never
 * writes to it.
 *
 * `critical` marks a document whose expiry BLOCKS a hire. Insurance, fitness and
 * permit are the three a truck cannot legally move without; tax and PUCC are
 * reported and warned about but are administratively renewable on the road, so
 * blocking a dispatch on them would be a rule this business never agreed to.
 * `nationalPermit` is critical only when the vehicle actually holds one — a
 * vehicle inside its own state permit does not need a national permit, and an
 * absent one must not read as an expired one.
 */
const VEHICLE_DOCUMENTS = Object.freeze([
  {
    key: 'TAX',
    label: 'Tax Expiry',
    numberField: 'tax_number',
    expiryField: 'tax_expiry',
    critical: false,
  },
  {
    key: 'INSURANCE',
    label: 'Insurance Expiry',
    numberField: 'insurance_number',
    expiryField: 'insurance_expiry',
    critical: true,
  },
  {
    key: 'PUCC',
    label: 'PUCC Expiry',
    numberField: 'pollution_certificate',
    expiryField: 'pollution_expiry',
    critical: false,
  },
  {
    key: 'FITNESS',
    label: 'Fitness Expiry',
    numberField: 'fitness_number',
    expiryField: 'fitness_expiry',
    critical: true,
  },
  {
    key: 'PERMIT',
    label: 'Permit Expiry',
    numberField: 'permit_number',
    expiryField: 'permit_expiry',
    critical: true,
  },
  {
    key: 'NATIONAL_PERMIT',
    label: 'National Permit Expiry',
    numberField: 'national_permit_number',
    expiryField: 'national_permit_expiry',
    critical: 'conditional',
  },
]);

/**
 * How many days before an expiry a document starts reading "Expiring Soon".
 * This is the CONFIGURED WARNING PERIOD the spec asks for — changing it here
 * changes the page, the API and the hire gate at once.
 */
const DOCUMENT_WARNING_DAYS = Number(
  process.env.VEHICLE_HIRE_DOC_WARNING_DAYS || 30
);

/**
 * Roles allowed to hire a vehicle whose CRITICAL document has already expired.
 * An acknowledgement is required either way; only these roles can give it.
 * This is the "authorised user must consciously resolve it" rule — there is no
 * silent path.
 */
const EXPIRED_DOCUMENT_OVERRIDE_ROLES = Object.freeze(['super_admin']);

/* ══════════════════════════════════════════════════════════════════════════
   TRIP STATUS TRANSITION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The hire reuses the EXISTING TripStatus vocabulary in
 * utils/TripStateMachine.js. No new status is introduced, so nothing about the
 * existing Enquiry → Quotation → Order → Trip → Loading → Delivery workflow
 * changes.
 *
 * ── WHY TRIP STATUS IS NOT THE HIRE STATUS ──────────────────────────────────
 * A trip status answers "where is this consignment in the movement pipeline".
 * It cannot also answer "has the hire money been agreed". Overloading one field
 * with both is exactly how the two screens drifted apart, so they are kept
 * SEPARATE and the hire state is derived from real stored data:
 *
 *      trips.vehicle_id IS NULL                       → WAITING FOR VEHICLE
 *      trips.vehicle_id SET, no `vehicle_hires` row   → VEHICLE ASSIGNED
 *      a `vehicle_hires` row exists                   → VEHICLE HIRED
 *
 * `vehicle_hires.trip_id` is UNIQUE, so the third state has exactly one record
 * per consignment and "hired" can never be true twice.
 *
 * A trip status still has to be *eligible* for hiring. `PENDING` is the natural
 * waiting state, but a consignment whose truck was assigned from the Enquiry
 * page already sits in `ASSIGNED`, and that consignment must still be able to
 * complete its hire — so both are hire-ready, along with the early movement
 * statuses before loading physically begins. Once a consignment is AT_LOADING
 * POINT or beyond, hiring is a dispatch correction rather than a hiring action
 * and is refused.
 *
 *   NEXT                is `TO_LOADING_POINT`, the existing "Send to Loading
 *                        Point" operational step. The page states it; it never
 *                        performs it. A hired vehicle is NOT loaded and NOT
 *                        dispatched automatically.
 */
const HIRE_READY_TRIP_STATUSES = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
]);

/**
 * Every trip status the Vehicle Hire page lists.
 *
 * The page is an operational queue, not an archive: a consignment that has been
 * dispatched is no longer a hiring decision. Cancelled and completed trips are
 * excluded so the queue only ever contains work that can still be actioned.
 */
const HIRE_LIST_TRIP_STATUSES = Object.freeze([
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
]);

// ── The three vehicle-hire states, derived from stored data ─────────────────
// These are NOT trip statuses. They describe vehicle-hiring specifically and are
// never written to `trips.status`.
const HIRE_STATE = Object.freeze({
  WAITING_FOR_VEHICLE: 'WAITING_FOR_VEHICLE',
  VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED',
  VEHICLE_HIRED: 'VEHICLE_HIRED',
});

/**
 * Derive the vehicle-hire state of a consignment from what is actually stored.
 *
 * PURE — no database access — so the list query, the hire gate and the tests
 * all answer identically from the same rule instead of three lookalike copies.
 *
 * @param {{vehicleId:*, driverId:*, hasHire:*}} state
 * @returns {string} one of HIRE_STATE
 */
function hireStateFor({ vehicleId, driverId, hasHire }) {
  if (hasHire) return HIRE_STATE.VEHICLE_HIRED;
  if (vehicleId) return HIRE_STATE.VEHICLE_ASSIGNED;
  return HIRE_STATE.WAITING_FOR_VEHICLE;
}

/**
 * What the operator may do next, given the derived state.
 *
 * The action is a function of stored state, not of which screen the operator is
 * on — which is what stops "Hire Vehicle" being offered twice for a vehicle that
 * is already hired (spec §19).
 *
 * @param {string} hireState - one of HIRE_STATE
 * @returns {{action:string,label:string,requires_hire_form:boolean}}
 */
function actionForHireState(hireState) {
  switch (hireState) {
    case HIRE_STATE.WAITING_FOR_VEHICLE:
      return { action: 'HIRE_VEHICLE', label: 'Hire Vehicle', requires_hire_form: true };
    case HIRE_STATE.VEHICLE_ASSIGNED:
      return { action: 'COMPLETE_HIRE', label: 'Complete Hire', requires_hire_form: true };
    case HIRE_STATE.VEHICLE_HIRED:
      return { action: 'VIEW_HIRE', label: 'View Hire', requires_hire_form: false };
    default:
      return { action: 'VIEW_TRIP', label: 'View Trip', requires_hire_form: false };
  }
}

/** The status a trip moves to when a hire is saved. */
const HIRED_TRIP_STATUS = 'ASSIGNED';

/** The next operational state after VEHICLE HIRED, for display only. */
const NEXT_OPERATIONAL_TRIP_STATUS = 'TO_LOADING_POINT';

/** Human label for the next step, so the UI copy lives here too. */
const NEXT_OPERATIONAL_LABEL = 'Waiting for loading · Send to loading point';

/* ══════════════════════════════════════════════════════════════════════════
   LOOKUPS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {string} basis
 * @returns {Object|null} the rate-basis descriptor
 */
function getRateBasis(basis) {
  const key = String(basis || '').toUpperCase();
  return RATE_BASIS_OPTIONS.find((o) => o.value === key) || null;
}

/**
 * @param {string} basis
 * @returns {boolean} true when the basis needs a quantity to compute gross
 */
function rateBasisNeedsQuantity(basis) {
  const descriptor = getRateBasis(basis);
  return Boolean(descriptor && descriptor.mode === 'RATE_QUANTITY');
}

/**
 * @param {string} type
 * @returns {Object|null} the commission-type descriptor
 */
function getCommissionType(type) {
  const key = String(type || '').toUpperCase();
  return COMMISSION_TYPE_OPTIONS.find((o) => o.value === key) || null;
}

/**
 * The business model a billing party implies.
 * @param {string} billingTo
 * @returns {string|null} 'CONTRACT' | 'COMMISSION' | null for an unknown party
 */
function businessModelForBillingTo(billingTo) {
  const key = String(billingTo || '').toUpperCase();
  return BILLING_TO_BUSINESS_MODEL[key] || null;
}

module.exports = {
  BILLING_TO_BUSINESS_MODEL,
  BILLING_TO_OPTIONS,
  BUSINESS_MODEL_OVERRIDE_ROLES,
  HIRE_STATE,
  HIRE_LIST_TRIP_STATUSES,
  hireStateFor,
  actionForHireState,
  RATE_BASIS_OPTIONS,
  RATE_BASIS,
  DEFAULT_RATE_BASIS,
  COMMISSION_TYPE_OPTIONS,
  COMMISSION_TYPES,
  DEFAULT_COMMISSION_TYPE,
  DEFAULT_COMMISSION_PERCENTAGE,
  VEHICLE_DOCUMENTS,
  DOCUMENT_WARNING_DAYS,
  EXPIRED_DOCUMENT_OVERRIDE_ROLES,
  HIRE_READY_TRIP_STATUSES,
  HIRED_TRIP_STATUS,
  NEXT_OPERATIONAL_TRIP_STATUS,
  NEXT_OPERATIONAL_LABEL,
  getRateBasis,
  rateBasisNeedsQuantity,
  getCommissionType,
  businessModelForBillingTo,
};
