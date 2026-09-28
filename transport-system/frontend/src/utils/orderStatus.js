/**
 * orderStatus.js — THE single place order lifecycle logic lives.
 * ---------------------------------------------------------------------------
 * §21 of the Order / Trip Master spec: "Create a central status-mapping function
 * rather than scattering status logic throughout React components."
 *
 * WHY THIS EXISTS
 *   An "order" in Bihar Transport is not one row. It is a composite of four
 *   existing, already-canonical backend records that each carry part of the
 *   truth:
 *
 *     Enquiry            (enquiries)             the pre-booking request + quote handshake
 *     Booking            (bookings)              THE ORDER MASTER (booking_number)
 *     Delivery           (deliveries)            1:1 with a booking; loading → POD
 *     Trip               (trips)                 optional operational record
 *
 *   Each uses a DIFFERENT status vocabulary:
 *
 *     booking.quote_status : PENDING | PREPARING | DRIVER_RESERVED | VEHICLE_RESERVED
 *                            | QUOTE_SENT | WAITING_CUSTOMER_APPROVAL
 *                            | ACCEPTED | REJECTED | EXPIRED
 *     booking.status       : pending | confirmed | driver_assigned | pickup_completed
 *                            | in_transit | delivered | completed | cancelled
 *     delivery.current_status: booking_confirmed | driver_assigned | pickup_in_progress
 *                            | pickup_completed | in_transit | out_for_delivery | delivered
 *     trip.status          : PENDING | ASSIGNED | IN_TRANSIT | DELIVERED
 *                            | COMPLETED | CANCELLED
 *
 *   React components must not re-derive this. They call `resolveOrder()` and
 *   render whatever it returns. That keeps the lifecycle consistent between the
 *   list, the detail header, the progress rail, the ops cards and the filters.
 *
 * NO backend model, enum or API is duplicated here. This is a pure, read-only
 * projection of state the server already owns.
 */

/** The ten stages shown on the Order / Trip Master lifecycle rail, in order. */
export const ORDER_STAGES = [
  { key: 'ENQUIRY', label: 'Enquiry', short: 'Enquiry' },
  { key: 'QUOTATION', label: 'Quotation Rate', short: 'Quote' },
  { key: 'ORDER_CONFIRMED', label: 'Order Confirmed', short: 'Confirmed' },
  { key: 'VEHICLE_HIRED', label: 'Vehicle Hired', short: 'Vehicle' },
  { key: 'LOADING', label: 'Loading', short: 'Loading' },
  { key: 'DISPATCH', label: 'Dispatch', short: 'Dispatch' },
  { key: 'TRANSIT', label: 'Transit', short: 'Transit' },
  { key: 'DELIVERY', label: 'Delivery', short: 'Delivery' },
  { key: 'POD', label: 'POD', short: 'POD' },
  { key: 'COMPLETED', label: 'Completed', short: 'Done' },
];

const STAGE_INDEX = ORDER_STAGES.reduce((acc, s, i) => ({ ...acc, [s.key]: i }), {});

/** 0-based index of the last stage, used when POD/completion is reached. */
export const LAST_STAGE_INDEX = ORDER_STAGES.length - 1;

const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');

/**
 * Stage reached from the QUOTE side (enquiry → quotation → confirmation).
 * Only ever returns a stage at or before ORDER_CONFIRMED, because nothing
 * operational has happened yet at this point.
 */
function stageFromQuote(quoteStatus) {
  switch (norm(quoteStatus)) {
    case 'REJECTED':
      return { key: 'QUOTATION', blocked: true, reason: 'Quote rejected' };
    case 'EXPIRED':
      return { key: 'QUOTATION', blocked: true, reason: 'Quote expired' };
    case 'ACCEPTED':
      return { key: 'ORDER_CONFIRMED' };
    case 'QUOTE_SENT':
    case 'WAITING_CUSTOMER_APPROVAL':
    case 'DRIVER_RESERVED':
    case 'VEHICLE_RESERVED':
    case 'PREPARING':
    case 'PENDING':
    default:
      return { key: 'QUOTATION' };
  }
}

/** Stage reached from the BOOKING side. */
function stageFromBooking(bookingStatus, hasVehicle, hasDriver) {
  switch (norm(bookingStatus)) {
    case 'CANCELLED':
      return { key: 'ORDER_CONFIRMED', blocked: true, reason: 'Order cancelled' };
    case 'COMPLETED':
      return { key: 'COMPLETED' };
    case 'DELIVERED':
      // Delivered is not "closed" — proof of delivery is still outstanding.
      return { key: 'POD' };
    case 'IN_TRANSIT':
      return { key: 'TRANSIT' };
    case 'PICKUP_COMPLETED':
      return { key: 'TRANSIT' };
    case 'DRIVER_ASSIGNED':
      return { key: hasVehicle ? 'LOADING' : 'VEHICLE_HIRED' };
    case 'CONFIRMED':
      return { key: hasVehicle && hasDriver ? 'VEHICLE_HIRED' : 'VEHICLE_HIRED' };
    case 'PENDING':
    default:
      return { key: 'ORDER_CONFIRMED' };
  }
}

/** Stage reached from the DELIVERY side (1:1 with booking, drives POD). */
function stageFromDelivery(deliveryStatus) {
  switch (norm(deliveryStatus)) {
    case 'DELIVERED':
      return { key: 'POD' };
    case 'OUT_FOR_DELIVERY':
      return { key: 'DELIVERY' };
    case 'IN_TRANSIT':
      return { key: 'TRANSIT' };
    case 'PICKUP_COMPLETED':
      return { key: 'TRANSIT' };
    case 'PICKUP_IN_PROGRESS':
      return { key: 'LOADING' };
    case 'DRIVER_ASSIGNED':
      return { key: 'VEHICLE_HIRED' };
    case 'BOOKING_CONFIRMED':
    default:
      return null; // Adds no information beyond the booking status.
  }
}

/** Stage reached from the TRIP side. */
function stageFromTrip(tripStatus) {
  switch (norm(tripStatus)) {
    case 'COMPLETED':
      return { key: 'COMPLETED' };
    case 'DELIVERED':
      return { key: 'POD' };
    case 'IN_TRANSIT':
      return { key: 'TRANSIT' };
    case 'ASSIGNED':
      return { key: 'VEHICLE_HIRED' };
    case 'CANCELLED':
      return { key: 'TRANSIT', blocked: true, reason: 'Trip cancelled' };
    case 'PENDING':
    default:
      return null;
  }
}

/** The operational action an admin should take next at each stage. */
const NEXT_ACTION = {
  ENQUIRY: 'Review the request and prepare a quotation',
  QUOTATION: 'Send the quotation rate to the customer',
  ORDER_CONFIRMED: 'Assign a vehicle and driver',
  VEHICLE_HIRED: 'Confirm loading schedule',
  LOADING: 'Record loading at the pickup point',
  DISPATCH: 'Mark the vehicle as dispatched',
  TRANSIT: 'Monitor the vehicle in transit',
  DELIVERY: 'Confirm arrival at the drop point',
  POD: 'Collect proof of delivery and close the order',
  COMPLETED: 'Order complete — no action required',
};

/**
 * Resolve an order row (a booking, optionally with its linked trip / delivery)
 * into the single lifecycle view the whole UI shares.
 *
 * Precedence rule: the MOST ADVANCED stage wins, because each backend record
 * reports a different slice and the furthest-along record is the best evidence.
 * A blocked/terminal record short-circuits so a rejected quote or a cancelled
 * trip is never masked by a stale "confirmed" booking row.
 *
 * @param {object} order  Flattened booking row from GET /api/admin/bookings (the
 *                        existing API already returns delivery_* and status
 *                        fields flattened onto the booking).
 * @param {object} [trip] Optional linked Trip row.
 * @returns {{
 *   stageKey: string, stageIndex: number, stageLabel: string,
 *   state: 'done'|'current'|'upcoming'|'blocked',
 *   blockedReason: string|null, nextAction: string,
 *   stages: Array<{key,label,short,state}>
 * }}
 */
export function resolveOrder(order, trip) {
  const o = order || {};
  const quote = stageFromQuote(o.quote_status);
  const hasVehicle = Boolean(o.vehicle_id);
  const hasDriver = Boolean(o.driver_id);
  const booking = stageFromBooking(o.status, hasVehicle, hasDriver);
  const delivery = stageFromDelivery(o.delivery_current_status);
  const tripStage = trip ? stageFromTrip(trip.status) : null;

  // Quote-side failure is terminal for the order until a new quote is issued.
  if (quote.blocked) return finalise(quote.key, true, quote.reason, o);

  // A cancelled booking is terminal for the whole order. Checked here, BEFORE the
  // furthest-stage reduce, so the blocked flag cannot be lost by a healthier
  // record (e.g. a stale delivery row) out-ranking it.
  if (booking.blocked) return finalise(booking.key, true, booking.reason, o);

  // A cancelled trip blocks, but never below what the booking already proves.
  if (tripStage?.blocked && STAGE_INDEX[tripStage.key] >= STAGE_INDEX[booking.key]) {
    return finalise(tripStage.key, true, tripStage.reason, o);
  }

  const candidates = [quote, booking, delivery, tripStage].filter(Boolean);
  let furthest = candidates.reduce((best, c) =>
    STAGE_INDEX[c.key] > STAGE_INDEX[best.key] ? c : best
  );

  // A booking still sitting at `pending` whose quote was never accepted is NOT
  // a confirmed order. Without this, "furthest wins" would let the booking row
  // claim ORDER_CONFIRMED while the quote is still being prepared, and the
  // lifecycle would show a stage the business has not actually reached.
  //
  // Only applied while the booking has made no operational progress: legacy rows
  // that are genuinely in_transit/delivered/completed keep their true stage even
  // when their quote_status is stale.
  // NB: norm() upper-cases, so this must compare against 'PENDING'.
  const madeProgress =
    norm(o.status) !== 'PENDING' || Boolean(delivery) || Boolean(tripStage?.key);
  if (!madeProgress && furthest.key !== 'QUOTATION' && furthest.key !== 'ENQUIRY') {
    furthest = quote;
  }

  return finalise(furthest.key, false, null, o);
}

function finalise(stageKey, blocked, reason, order) {
  const idx = STAGE_INDEX[stageKey] ?? 0;
  const stages = ORDER_STAGES.map((s, i) => ({
    ...s,
    state: blocked
      ? i < idx
        ? 'done'
        : i === idx
          ? 'blocked'
          : 'upcoming'
      : i < idx
        ? 'done'
        : i === idx
          ? 'current'
          : 'upcoming',
  }));

  return {
    stageKey,
    stageIndex: idx,
    stageLabel: ORDER_STAGES[idx].label,
    state: blocked ? 'blocked' : 'current',
    blockedReason: blocked ? reason || 'Order blocked' : null,
    nextAction: blocked ? reason || 'Resolve the blocked order' : NEXT_ACTION[stageKey],
    // Payment state is part of "where is this order", so it travels with it.
    paymentState: resolvePaymentState(order),
    stages,
  };
}

/**
 * Payment lifecycle, derived from the existing financial fields the booking API
 * already returns. Never invents an amount — if the backend has not recorded a
 * payment, this reports PENDING rather than guessing a zero.
 */
export function resolvePaymentState(order) {
  const o = order || {};
  const billing = num(o.final_price ?? o.estimated_price);
  const received = num(o.amount_received ?? o.payment_received);
  const status = norm(o.payment_status);

  if (status === 'PAID' || (billing > 0 && received >= billing)) {
    return { key: 'PAID', label: 'Paid', tone: 'success' };
  }
  if (status === 'PARTIAL' || received > 0) {
    return { key: 'PARTIAL', label: 'Partially Paid', tone: 'warning' };
  }
  if (status === 'REFUNDED') return { key: 'REFUNDED', label: 'Refunded', tone: 'info' };
  return { key: 'PENDING', label: 'Pending', tone: 'neutral' };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Stage filter chips for the Order list (§18). `key` matches a stage key from
 * resolveOrder(); 'ALL' is the catch-all. Filtering happens on the client from
 * the SAME resolved value the table renders, so chips can never disagree with
 * the rows.
 */
export const ORDER_STAGE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'ENQUIRY', label: 'Enquiry' },
  { key: 'QUOTATION', label: 'Quotation' },
  { key: 'ORDER_CONFIRMED', label: 'Confirmed' },
  { key: 'VEHICLE_HIRED', label: 'Vehicle Hired' },
  { key: 'LOADING', label: 'Loading' },
  { key: 'DISPATCH', label: 'Dispatch' },
  { key: 'TRANSIT', label: 'Transit' },
  { key: 'DELIVERY', label: 'Delivered' },
  { key: 'POD', label: 'POD Pending' },
  { key: 'COMPLETED', label: 'Completed' },
];

/**
 * KPI aggregation for the Order list header (§19). Computed from the rows the
 * server actually returned — never from hardcoded figures.
 */
export function summariseOrders(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const acc = {
    total: list.length,
    activeTrips: 0,
    vehiclesHired: 0,
    inTransit: 0,
    delivered: 0,
    podPending: 0,
    completed: 0,
    paymentDue: 0,
  };

  for (const row of list) {
    const r = resolveOrder(row);
    const i = r.stageIndex;

    if (i > STAGE_INDEX.ORDER_CONFIRMED && i < STAGE_INDEX.COMPLETED) acc.activeTrips += 1;
    if (i >= STAGE_INDEX.VEHICLE_HIRED) acc.vehiclesHired += 1;
    if (i === STAGE_INDEX.TRANSIT) acc.inTransit += 1;
    if (i === STAGE_INDEX.DELIVERY || i === STAGE_INDEX.POD) acc.delivered += 1;
    if (i === STAGE_INDEX.POD) acc.podPending += 1;
    if (i === STAGE_INDEX.COMPLETED) acc.completed += 1;

    const billing = num(row?.final_price ?? row?.estimated_price);
    const received = num(row?.amount_received ?? row?.payment_received);
    acc.paymentDue += Math.max(0, billing - received);
  }

  return acc;
}

export { STAGE_INDEX };
