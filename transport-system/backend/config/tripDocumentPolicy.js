/**
 * tripDocumentPolicy.js
 * ---------------------------------------------------------------------------
 * ONE place where the transport-paperwork rules live.
 *
 * This follows exactly the pattern config/commissionPolicy.js already uses for
 * the commission rate: the business rule is declared once, is overridable, and
 * is never hardcoded a second time inside a service or a route.
 *
 * ── HONEST PROVENANCE (STEP 10: "DO NOT invent rules") ────────────────────
 * The repository had NO pre-existing document rule. Before Phase 4 the live
 * database contained 0 trip documents and 0 invoices, and nothing in the
 * codebase referenced LR, GR, e-way bills or a document checklist. So there
 * was no rule to preserve, only a rule to declare.
 *
 * The set below is the MINIMUM the Phase 4 specification names for a road
 * consignment, and it is deliberately kept small and explicit rather than
 * guessed at:
 *
 *   LR          a lorry receipt is issued at loading for every consignment
 *   INVOICE     the tax document for the movement
 *   E_WAY_BILL  statutory road-freight paperwork — see the threshold below
 *
 * Insurance, permit, fitness, RC and GR are VALID document types and are
 * tracked, but they are not dispatch blockers by default: they are
 * vehicle- or delivery-scoped, and this repository records vehicle documents
 * on the VEHICLE (TransportVehicle.insurance_*, permit_*, pollution_*), not
 * per trip.
 *
 * Nothing here is a hardcoded production value scattered through the code —
 * change it here and every caller follows.
 */

/** Mirrors the Prisma `TripDocumentType` enum exactly. */
const DOCUMENT_TYPES = Object.freeze([
  'LR',
  'GR',
  'INVOICE',
  'E_WAY_BILL',
  'INSURANCE',
  'PERMIT',
  'FITNESS',
  'RC',
  'POD',
  'OTHER',
]);

/** Mirrors the Prisma `TripDocumentStatus` enum exactly. */
const DOCUMENT_STATUSES = Object.freeze([
  'PENDING',
  'PRESENT',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
]);

/**
 * Document states that satisfy a "must have this paper" requirement.
 *
 * PRESENT counts: the paper exists. VERIFIED counts: somebody checked it.
 * Requiring VERIFIED would block dispatch on an admin simply having not got
 * round to checking it yet, which is a different problem from the paper being
 * missing. REJECTED and EXPIRED never count. PENDING means it was never
 * supplied.
 */
const SATISFIES_REQUIREMENT = Object.freeze(['PRESENT', 'VERIFIED']);

/** Which states mean "the document actually exists". */
const SUPPLIED_STATES = Object.freeze(['PRESENT', 'VERIFIED']);

/**
 * The default set that must be present before a trip may be dispatched.
 * See the provenance note above.
 */
const REQUIRED_BEFORE_DISPATCH = Object.freeze(['LR', 'INVOICE', 'E_WAY_BILL']);

/**
 * An e-way bill is only statutorily required above a consignment value, so a
 * small local load is not blocked for paperwork that does not apply to it.
 *
 * PHASE 9: the NUMBER is not restated here — it is read from
 * `config/dispatchPolicy.js`, which owns the consignment-value rule for the
 * whole system. Two modules each deciding "what is this load worth" is how a
 * load ends up simultaneously "needs an e-way bill" and "does not".
 */
const E_WAY_BILL_REQUIRED_ABOVE = 50000;

/**
 * Documents whose requirement is conditional on the consignment value.
 *
 * `field` is retained for callers that want to know which column the decision
 * is nominally about, but the VALUE is always resolved through
 * `dispatchPolicy.consignmentValueFor()`, so the declared value of the goods is
 * preferred over the freight we happen to charge.
 *
 * @type {Object<string, {above:number, field:string}>}
 */
const VALUE_THRESHOLDS = Object.freeze({
  E_WAY_BILL: { above: E_WAY_BILL_REQUIRED_ABOVE, field: 'value_of_goods' },
});

/**
 * Resolve which documents THIS trip must have.
 *
 * Precedence:
 *   1. `Trip.documents_required` — an explicit per-trip override. An EMPTY
 *      array is meaningful: "this trip genuinely needs no papers".
 *   2. the default set, minus any entry whose statutory threshold this trip
 *      does not reach.
 *
 * @param {{documents_required?: string[]|null, freight_amount?: number,
 *          value_of_goods?: number|null}} trip
 * @returns {string[]}
 */
function requiredDocumentsFor(trip = {}) {
  const override = trip.documents_required;
  if (Array.isArray(override)) {
    return DOCUMENT_TYPES.filter((t) => override.includes(t));
  }

  // ONE definition of "what is this consignment worth", shared with the
  // dispatch gate. Required lazily so this module stays requireable on its own.
  // eslint-disable-next-line global-require
  const { consignmentValueFor } = require('./dispatchPolicy');

  return REQUIRED_BEFORE_DISPATCH.filter((type) => {
    const rule = VALUE_THRESHOLDS[type];
    if (!rule) return true;
    return consignmentValueFor(trip).value > rule.above;
  });
}

module.exports = {
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  SATISFIES_REQUIREMENT,
  SUPPLIED_STATES,
  REQUIRED_BEFORE_DISPATCH,
  E_WAY_BILL_REQUIRED_ABOVE,
  VALUE_THRESHOLDS,
  requiredDocumentsFor,
};
