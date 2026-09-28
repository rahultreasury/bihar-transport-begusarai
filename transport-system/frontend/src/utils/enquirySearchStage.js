/**
 * enquirySearchStage.js
 * ---------------------------------------------------------------------------
 * The presentation state behind the "Finding your truck" experience.
 *
 * THE ONE RULE OF THIS FILE
 * Nothing here invents backend state. Every headline and every "searching" flag
 * is DERIVED from the enquiry's real `status` field, exactly as the server
 * reported it through GET /api/enquiries/:id or a Socket.IO push. There is no
 * second state machine, no client-side status field, and nothing that can claim
 * a vehicle was assigned when the server did not say so.
 *
 * WHY A NARRATIVE EXISTS AT ALL
 * While an enquiry is genuinely pending, the customer is looking at a page that
 * cannot change by itself. Rotating through the three honest descriptions of the
 * work in progress ("checking availability" → "matching partners" → "confirming
 * vehicle and driver") is presentation, not a status claim: every one of those
 * things is actually happening concurrently on the server. The narrative is
 * strictly monotonic (it never goes backwards) and it is hard-capped by the real
 * status — and the instant the server reports an assignment, searching stops.
 *
 * See utils/enquiryFormat.js for the status constants this mirrors, and
 * backend/utils/EnquiryStateMachine.js for the authoritative server version.
 */

import { ENQUIRY_STATUS } from './enquiryFormat';

/** Statuses in which the team genuinely has not committed a vehicle yet. */
export const SEARCHING_STATUSES = [
  ENQUIRY_STATUS.ENQUIRY_SUBMITTED,
  ENQUIRY_STATUS.ADMIN_REVIEW,
  ENQUIRY_STATUS.ASSIGNMENT_PENDING,
];

/** Which narrative beat each real status corresponds to. */
const STATUS_BEAT = {
  [ENQUIRY_STATUS.ENQUIRY_SUBMITTED]: 0,
  [ENQUIRY_STATUS.ADMIN_REVIEW]: 1,
  [ENQUIRY_STATUS.ASSIGNMENT_PENDING]: 2,
};

/** The three beats of the search narrative, in order. */
export const SEARCH_STAGES = [
  {
    key: 'finding',
    headline: 'Finding your truck',
    detail: 'Checking available vehicles near your route…',
  },
  {
    key: 'availability',
    headline: 'Checking vehicle availability',
    detail: 'We are matching your shipment with suitable transport partners.',
  },
  {
    key: 'arranging',
    headline: 'Arranging your transport',
    detail: 'Our team is confirming the right vehicle and driver for you.',
  },
];

/** Everything that is NOT "still searching", keyed by the real status. */
const SETTLED_STAGES = {
  [ENQUIRY_STATUS.VEHICLE_ASSIGNED]: {
    key: 'vehicle-assigned',
    tone: 'found',
    headline: 'Vehicle found',
    detail: 'Your transport team has assigned a suitable vehicle for your route.',
  },
  [ENQUIRY_STATUS.DRIVER_ASSIGNED]: {
    key: 'driver-assigned',
    tone: 'found',
    headline: 'Vehicle & driver assigned',
    detail: 'Your vehicle and driver are confirmed for this shipment.',
  },
  // QUOTE_READY = the admin has entered a price but NOT sent it. The number is
  // deliberately withheld from the customer at this stage, so the copy must not
  // invite them to review or approve a price they cannot see yet.
  [ENQUIRY_STATUS.QUOTE_READY]: {
    key: 'quote-ready',
    tone: 'quote',
    headline: 'Quote being prepared',
    detail: 'Your confirmed transport price is being prepared.',
  },
  // AWAITING_CUSTOMER_ACCEPTANCE = the send action happened; the price is now
  // published and the decision belongs to the customer.
  [ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE]: {
    key: 'awaiting-acceptance',
    tone: 'quote',
    headline: 'Final quote ready',
    detail: 'Review the confirmed price below and approve it to lock your transport.',
  },
  [ENQUIRY_STATUS.CUSTOMER_ACCEPTED]: {
    key: 'accepted',
    tone: 'confirmed',
    headline: 'Trip confirmed',
    detail: 'Your booking is confirmed and scheduled for pickup.',
  },
  [ENQUIRY_STATUS.CONFIRMED]: {
    key: 'confirmed',
    tone: 'confirmed',
    headline: 'Trip confirmed',
    detail: 'Your booking is confirmed and scheduled for pickup.',
  },
  [ENQUIRY_STATUS.IN_PROGRESS]: {
    key: 'in-progress',
    tone: 'confirmed',
    headline: 'Shipment in transit',
    detail: 'Your shipment is on the move to the destination.',
  },
  [ENQUIRY_STATUS.COMPLETED]: {
    key: 'completed',
    tone: 'confirmed',
    headline: 'Shipment delivered',
    detail: 'This transport request is complete. Thank you for choosing Bihar Transport.',
  },
  [ENQUIRY_STATUS.CANCELLED]: {
    key: 'cancelled',
    tone: 'closed',
    headline: 'Request cancelled',
    detail: 'This request is now closed. Contact customer care to place a new one.',
  },
  [ENQUIRY_STATUS.CUSTOMER_REJECTED]: {
    key: 'declined',
    tone: 'closed',
    headline: 'Quote declined',
    detail: 'This request is now closed. Our team will get in touch to understand your needs.',
  },
};

/** Is the team still looking for a vehicle? Drives the whole search animation. */
export function isSearching(status) {
  return SEARCHING_STATUSES.includes(status);
}

/** The narrative beat the server's status has already reached. */
export function statusBeat(status) {
  const beat = STATUS_BEAT[status];
  return typeof beat === 'number' ? beat : 0;
}

/**
 * Resolve the presentation stage for a given backend status.
 *
 * @param {string} status  the real `enquiry.status` from the API
 * @param {number} [narrativeBeat=0]  how far the local narrative has advanced
 * @returns {{key:string, tone:string, headline:string, detail:string, searching:boolean, beat:number}}
 */
export function resolveSearchStage(status, narrativeBeat = 0) {
  if (isSearching(status)) {
    // Never let the narrative fall behind what the server already knows.
    const beat = Math.max(statusBeat(status), Math.min(narrativeBeat, SEARCH_STAGES.length - 1));
    return { ...SEARCH_STAGES[beat], tone: 'searching', searching: true, beat };
  }

  const settled = SETTLED_STAGES[status];
  if (settled) return { ...settled, searching: false, beat: -1 };

  // Unknown / not-yet-loaded status: show the first honest beat rather than
  // guessing, and keep the search animation running until the server says stop.
  return { ...SEARCH_STAGES[0], tone: 'searching', searching: true, beat: 0 };
}

export default resolveSearchStage;
