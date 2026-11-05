/**
 * tripDeliveryPolicy.js
 * ---------------------------------------------------------------------------
 * ONE place where the DELIVERY rules live.
 *
 * This follows exactly the pattern config/tripDocumentPolicy.js already uses:
 * the business rule is declared once, is overridable, and is never hardcoded a
 * second time inside a service or a route.
 *
 * ── HONEST PROVENANCE (STEP 9/10: "DO NOT invent requirements") ────────────
 * The repository ALREADY had:
 *
 *   • `TripStatus.DELIVERED` and `TripStatus.COMPLETED`
 *   • the edges IN_TRANSIT → DELIVERED and DELIVERED → COMPLETED in
 *     utils/TripStateMachine.js
 *   • `TripDocumentType.POD` with a PRESENT → VERIFIED lifecycle, and a
 *     `@@unique([trip_id, document_type])` constraint
 *   • `Trip.trip_delivered_date` and `Trip.completed_at`
 *
 * So there is no new status to invent and no new document to invent. What did
 * not exist was a rule about WHAT must be true before a trip may be declared
 * delivered — `TripService.updateTripStatus` would happily move a trip from
 * DELIVERED to COMPLETED with no POD at all.
 *
 * The rules below are the minimum the Phase 6 specification names, and each
 * one is justified by an explicit line of that specification:
 *
 *   ARRIVAL_RECORDED   STEP 4  "Arrival must be server-authoritative"
 *   POD_SUPPLIED       STEP 6  "POD should be associated with the correct Trip"
 *   POD_VERIFIED       STEP 8  "If current business rules require verified
 *                              POD, enforce it server-side"
 *   RECEIVER_RECORDED  STEP 7  "receiver name" — a POD with nobody named is
 *                              not evidence of a handover
 *
 * Nothing financial appears here. See STEP 18: delivery must not pay a vendor,
 * create a settlement or touch commission, and that is enforced by the service
 * simply not calling any financial code.
 */

/**
 * Why a delivery could not be completed on this attempt.
 *
 * STEP 5: this is a MINIMAL record, not the Incident module. A failed attempt
 * is appended to the existing `trip_timeline` and nothing else — no table, no
 * status change, no incident workflow. The trip simply stays IN_TRANSIT.
 *
 * The codes are the ones the specification itself lists; `OTHER` exists so an
 * operator is never blocked from recording a real reason.
 */
const DELIVERY_ATTEMPT_REASONS = Object.freeze({
  CONSIGNEE_UNAVAILABLE: 'CONSIGNEE_UNAVAILABLE',
  DESTINATION_CLOSED: 'DESTINATION_CLOSED',
  INCORRECT_ADDRESS: 'INCORRECT_ADDRESS',
  DAMAGED_GOODS: 'DAMAGED_GOODS',
  REFUSED_DELIVERY: 'REFUSED_DELIVERY',
  OTHER: 'OTHER',
});

/** Human labels for the timeline description. */
const DELIVERY_ATTEMPT_LABELS = Object.freeze({
  CONSIGNEE_UNAVAILABLE: 'Consignee unavailable',
  DESTINATION_CLOSED: 'Destination closed',
  INCORRECT_ADDRESS: 'Incorrect address',
  DAMAGED_GOODS: 'Damaged goods',
  REFUSED_DELIVERY: 'Delivery refused',
  OTHER: 'Other',
});

/**
 * The checks that must pass before a trip may become DELIVERED.
 *
 * Ordered as they are reported, so the operator sees the earliest problem
 * first. `POD_VERIFIED` is listed after `POD_SUPPLIED` on purpose: a missing
 * POD and an unverified POD are different problems with different fixes.
 */
const DELIVERY_REQUIREMENTS = Object.freeze([
  Object.freeze({
    code: 'ARRIVAL_NOT_RECORDED',
    message: 'Arrival at the destination has not been recorded for this trip.',
  }),
  Object.freeze({
    code: 'POD_NOT_SUPPLIED',
    message: 'No proof of delivery (POD) has been supplied for this trip.',
  }),
  Object.freeze({
    code: 'POD_NOT_VERIFIED',
    message: 'The proof of delivery has been supplied but not yet verified.',
  }),
  Object.freeze({
    code: 'RECEIVER_NOT_RECORDED',
    message: 'The name of the person who received the goods has not been recorded.',
  }),
]);

/**
 * The checks that must pass before a trip may become COMPLETED.
 *
 * STEP 10: "Audit what COMPLETED currently means. Do not assume."
 *
 * In this repository COMPLETED means OPERATIONALLY CLOSED — the goods were
 * delivered and the paperwork was accepted. It does NOT mean the money moved:
 * `TripService.updateTripStatus` has always set only `completed_at` for it, and
 * the financial modules from Phases 2–3 (VehicleHire / Commission / Vendor
 * settlement) are driven by their own explicit actions. Requiring a settlement
 * here would be inventing a rule, and would break every existing DELIVERED trip
 * the day this shipped.
 *
 * So COMPLETED requires the trip to be DELIVERED, and nothing financial.
 */
const COMPLETION_REQUIREMENTS = Object.freeze([
  Object.freeze({
    code: 'NOT_DELIVERED',
    message: 'A trip can only be completed once it has been delivered.',
  }),
]);

/**
 * Does a supplied POD satisfy the "verified before delivery" rule?
 *
 * STEP 8: reuse the Phase 4 document verification architecture rather than
 * inventing a second one. `VERIFIED` is the only state that counts here,
 * because POD_VERIFIED is a distinct requirement from POD_SUPPLIED — an
 * operator who has supplied the paper but nobody has checked it yet has not
 * finished the delivery.
 *
 * @param {string} documentStatus - a TripDocumentStatus value, or null
 * @returns {boolean}
 */
function isPodVerified(documentStatus) {
  return documentStatus === 'VERIFIED';
}

/**
 * Was a POD supplied at all (PRESENT or VERIFIED)?
 * Mirrors `TripDocumentService.evaluateDocument`, kept here so the rule is
 * readable in one place.
 *
 * @param {string} documentStatus
 * @returns {boolean}
 */
function isPodSupplied(documentStatus) {
  return documentStatus === 'PRESENT' || documentStatus === 'VERIFIED';
}

module.exports = {
  DELIVERY_ATTEMPT_REASONS,
  DELIVERY_ATTEMPT_LABELS,
  DELIVERY_REQUIREMENTS,
  COMPLETION_REQUIREMENTS,
  isPodVerified,
  isPodSupplied,
};
