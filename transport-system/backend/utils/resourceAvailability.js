/**
 * resourceAvailability.js
 * ---------------------------------------------------------------------------
 * "Which vehicles and drivers are actually free for THIS consignment?"
 *
 * WHY A SEPARATE, PURE MODULE
 *   The Vehicle Hire screen has to show an operator what is genuinely usable for
 *   the pickup it is booking — vacant things first, and a clear reason for
 *   everything else. Deciding that is data, not UI, and it must be testable
 *   without a database. So the classification and the ordering live here, in
 *   one pure function, and the service supplies the commitments it classifies
 *   against.
 *
 * FOUR STATES, AND THEY MEAN DIFFERENT THINGS
 *
 *   AVAILABLE    free for this consignment — assignable now
 *   BUSY         committed to another consignment that OVERLAPS this pickup
 *                (same calendar day, per the existing pickup-window rule)
 *   CONFLICT     this consignment ALREADY holds the resource — i.e. it is the
 *                one currently assigned, so re-picking it is a no-op rather
 *                than a conflict
 *   UNAVAILABLE  not on the road at all (off-road, maintenance, scrapped,
 *                deactivated, or flagged not-available in the master record)
 *
 * ORDERING
 *   Vacant first. Within a band, the vehicle's own number and the driver's own
 *   name decide, so the list is stable and predictable between renders rather
 *   than reshuffling arbitrarily.
 *
 * NO NEW BUSINESS RULES
 *   The overlap maths is `rangesOverlap` over the existing `pickupWindow` /
 *   `tripWindow` helpers from EnquiryAssignmentService — the same functions that
 *   decide whether an assignment is allowed at all. What is displayed and what
 *   is permitted therefore cannot disagree.
 */

/** The four states the Vehicle Hire selectors render. */
export const RESOURCE_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** Sort rank — lower sorts first. This is what puts vacant resources on top. */
const RANK = {
  [RESOURCE_AVAILABILITY.AVAILABLE]: 0,
  [RESOURCE_AVAILABILITY.BUSY]: 1,
  [RESOURCE_AVAILABILITY.CONFLICT]: 2,
  [RESOURCE_AVAILABILITY.UNAVAILABLE]: 3,
};

/** Vehicle master states that mean "not on the road". */
const VEHICLE_OFF_ROAD = ['off_road', 'maintenance', 'scrapped', 'sold'];

/** Driver master states that mean "not working". */
const DRIVER_OFF_ROAD = ['inactive', 'suspended', 'off_duty'];

/**
 * Is this resource held by another consignment that overlaps `window`?
 *
 * @param {{vehicleIds?:number[], driverIds?:number[], tripId?:number|null}[]} commitments
 *   One entry per competing consignment that is still live.
 * @param {'vehicle'|'driver'} kind
 * @param {number} id
 * @param {{start:Date,end:Date}} window  the pickup window of THIS consignment
 * @param {Date|null} [ownTripId]  this consignment's own trip, so it is never
 *   reported as its own conflict.
 * @param {(a:Date,b:Date)=>boolean} overlaps  the shared range test
 * @returns {boolean}
 */
export function isHeldByOthers(commitments, kind, id, window, ownTripId, overlaps) {
  const key = kind === 'vehicle' ? 'vehicleIds' : 'driverIds';
  return commitments.some((c) => {
    if (!c) return false;
    if (ownTripId != null && c.tripId === ownTripId) return false;
    const ids = c[key];
    if (!Array.isArray(ids) || !ids.map(Number).includes(Number(id))) return false;
    if (!c.window) return true; // committed, but with no date to compare
    return overlaps(window.start, window.end, c.window.start, c.window.end);
  });
}

/**
 * Classify ONE vehicle for one consignment.
 *
 * @param {object} vehicle  a TransportVehicle row
 * @param {object} ctx
 * @returns {{availability:string, reason:string|null}}
 */
export function classifyVehicle(vehicle, { commitments = [], window, ownTripId = null, overlaps }) {
  if (!vehicle) {
    return { availability: RESOURCE_AVAILABILITY.UNAVAILABLE, reason: 'Not found' };
  }
  if (VEHICLE_OFF_ROAD.includes(String(vehicle.current_status || '').toLowerCase())) {
    return {
      availability: RESOURCE_AVAILABILITY.UNAVAILABLE,
      reason: `Vehicle is ${String(vehicle.current_status).replace(/_/g, ' ')}`,
    };
  }
  if (vehicle.is_available === false) {
    return { availability: RESOURCE_AVAILABILITY.UNAVAILABLE, reason: 'Marked not available' };
  }

  const currentlyHeld = Number.isInteger(Number(ownTripId))
    && commitments.some((c) => c.tripId === ownTripId && (c.vehicleIds || []).map(Number).includes(Number(vehicle.vehicle_id)));

  if (isHeldByOthers(commitments, 'vehicle', vehicle.vehicle_id, window, ownTripId, overlaps)) {
    return {
      availability: RESOURCE_AVAILABILITY.BUSY,
      reason: 'Already committed to another consignment on this date',
    };
  }
  if (currentlyHeld) {
    return {
      availability: RESOURCE_AVAILABILITY.CONFLICT,
      reason: 'Already assigned to this consignment',
    };
  }
  return { availability: RESOURCE_AVAILABILITY.AVAILABLE, reason: null };
}

/**
 * Classify ONE driver for one consignment.
 *
 * @param {object} driver  a Driver row
 * @param {object} ctx
 * @returns {{availability:string, reason:string|null}}
 */
export function classifyDriver(driver, { commitments = [], window, ownTripId = null, overlaps }) {
  if (!driver) {
    return { availability: RESOURCE_AVAILABILITY.UNAVAILABLE, reason: 'Not found' };
  }
  if (DRIVER_OFF_ROAD.includes(String(driver.status || '').toLowerCase())) {
    return {
      availability: RESOURCE_AVAILABILITY.UNAVAILABLE,
      reason: `Driver is ${String(driver.status).replace(/_/g, ' ')}`,
    };
  }
  if (driver.is_available === false) {
    return { availability: RESOURCE_AVAILABILITY.UNAVAILABLE, reason: 'Marked not available' };
  }

  const currentlyHeld = Number.isInteger(Number(ownTripId))
    && commitments.some((c) => c.tripId === ownTripId && (c.driverIds || []).map(Number).includes(Number(driver.driver_id)));

  if (isHeldByOthers(commitments, 'driver', driver.driver_id, window, ownTripId, overlaps)) {
    return {
      availability: RESOURCE_AVAILABILITY.BUSY,
      reason: 'Already committed to another consignment on this date',
    };
  }
  if (currentlyHeld) {
    return {
      availability: RESOURCE_AVAILABILITY.CONFLICT,
      reason: 'Already assigned to this consignment',
    };
  }
  return { availability: RESOURCE_AVAILABILITY.AVAILABLE, reason: null };
}

/**
 * Annotate and order a whole selector list, vacant first.
 *
 * @param {object[]} rows
 * @param {'vehicle'|'driver'} kind
 * @param {object} ctx  — commitments / window / ownTripId / overlaps
 * @param {string} labelKey  the field used as the stable tie-breaker
 * @returns {object[]} the SAME rows, each with `availability` + `availability_reason`,
 *   ordered vacant-first. Input order is preserved within a band, so nothing the
 *   caller already sorted is disturbed.
 */
export function rankResources(rows, kind, ctx, labelKey) {
  const classify = kind === 'vehicle' ? classifyVehicle : classifyDriver;
  return rows
    .map((row, index) => {
      const { availability, reason } = classify(row, ctx);
      return { ...row, availability, availability_reason: reason, _index: index };
    })
    .sort((a, b) => {
      const byRank = RANK[a.availability] - RANK[b.availability];
      if (byRank !== 0) return byRank;
      const byLabel = String(a[labelKey] || '').localeCompare(String(b[labelKey] || ''), 'en', {
        numeric: true,
      });
      if (byLabel !== 0) return byLabel;
      return a._index - b._index;
    })
    .map(({ _index, ...rest }) => rest);
}

/** Can this resource be assigned right now? */
export function isSelectable(row) {
  return (
    row?.availability === RESOURCE_AVAILABILITY.AVAILABLE ||
    row?.availability === RESOURCE_AVAILABILITY.CONFLICT
  );
}