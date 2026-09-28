/**
 * enquiryWhatsAppFormatter
 * ---------------------------------------------------------------------------
 * Builds every WhatsApp payload the enquiry flow sends, from live enquiry state.
 *
 * TWO RULES
 *  1. NEVER HARDCODE A VALUE. Route, vehicle, material, weight, dates and fare
 *     are all read off the enquiry row. A field that is genuinely null is simply
 *     omitted from the message — the message can never print "null",
 *     "undefined" or a placeholder dash.
 *
 *  2. NEVER LEAK A DRIVER NUMBER. These messages are addressed TO customer care.
 *     They describe the load and the request; they do not contain (or invite
 *     direct contact with) the assigned driver. The driver relationship stays
 *     inside Bihar Transport.
 *
 * The formatter is pure — it takes a plain object and returns a string. The
 * route handlers own the wa.me URL construction (config/customerCare.js).
 */

const { BRAND_NAME, buildWhatsAppLink } = require('../config/customerCare');
const { toProgressStage } = require('../utils/EnquiryStateMachine');

const RULE = '━━━━━━━━━━━━━━━━━━';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format a date as "26 September 2026" (the format the customer sees everywhere).
 *
 * UTC BY DESIGN: Enquiry.pickup_date is pinned to UTC midnight so the stored
 * value IS the calendar date the customer picked (see parsePickupDate in
 * EnquiryService). Reading the UTC components is what keeps a message saying the
 * same date the customer chose, on any server, in any timezone.
 *
 * @param {Date|string|null} value
 * @returns {string} '' when unparseable
 */
function formatLongDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Format a time as "10:00 AM" from either "HH:mm", "HH:mm:ss" or a Date.
 * @param {string|TimeLike|null} value
 * @returns {string} '' when unparseable
 */
function formatTime12(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      let hour = Number(match[1]);
      const minute = match[2];
      const suffix = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${suffix}`;
    }
    return '';
  }

  if (typeof value === 'object' && typeof value.getHours === 'function') {
    let hour = value.getHours();
    const minute = String(value.getMinutes()).padStart(2, '0');
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${suffix}`;
  }

  return '';
}

/**
 * Format an amount with the Indian rupee sign and thousands separators.
 * @param {number|string|null} value
 * @returns {string} '' when not a finite number
 */
function formatINR(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * Format a distance, e.g. "1,211 km".
 * @param {number|string|null} value
 * @returns {string}
 */
function formatKm(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n).toLocaleString('en-IN');
  return `${rounded} km`;
}

/**
 * Combine a value and its unit, e.g. ("85", "Bundles") -> "85 Bundles".
 * @param {*} value
 * @param {string} [unit]
 * @returns {string} '' when the value is missing
 */
function withUnit(value, unit) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  const base = Number.isFinite(n) ? n.toLocaleString('en-IN') : String(value);
  return unit ? `${base} ${unit}` : base;
}

/**
 * Estimated fare line: "₹54,495 – ₹66,605", or a single value when only one
 * bound is known, or '' when nothing is estimated.
 * @param {number|null} min
 * @param {number|null} max
 * @returns {string}
 */
function formatFareRange(min, max) {
  const hasMin = Number.isFinite(Number(min)) && min !== null && min !== '';
  const hasMax = Number.isFinite(Number(max)) && max !== null && max !== '';

  if (hasMin && hasMax) {
    if (Number(min) === Number(max)) return formatINR(min);
    return `${formatINR(min)} – ${formatINR(max)}`;
  }
  if (hasMin) return `from ${formatINR(min)}`;
  if (hasMax) return `up to ${formatINR(max)}`;
  return '';
}

/**
 * A "label: value" line, or null when the value is empty (so the whole line
 * can be filtered out rather than printing a blank field).
 */
function line(label, value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '' || text === false) return null;
  return `${label} ${text}`;
}

/**
 * The full customer-facing enquiry summary sent to customer care on WhatsApp.
 *
 * @param {object} enquiry - Prisma enquiry row (raw, not a DTO)
 * @returns {string} the plain-text message body
 */
function buildEnquirySummaryMessage(enquiry) {
  if (!enquiry) return '';

  const vehicleName = enquiry.assigned_vehicle_type || enquiry.requested_vehicle_name || null;
  const pickupDate = formatLongDate(enquiry.pickup_date);
  const pickupTime = formatTime12(enquiry.pickup_time);
  const fare = formatFareRange(enquiry.estimated_price_min, enquiry.estimated_price_max);
  const stage = toProgressStage(enquiry.status);

  const sections = [];

  sections.push(
    [
      RULE,
      `🚛 ${BRAND_NAME.toUpperCase()}`,
      'Transport Booking Request',
      RULE,
      '',
      '📋 Enquiry ID:',
      enquiry.enquiry_number,
    ].join('\n')
  );

  // ── Route ──
  const routeLines = [
    line('Pickup:', enquiry.pickup_location),
    line('Drop:', enquiry.drop_location),
    line('Distance:', formatKm(enquiry.distance_km)),
  ].filter(Boolean);
  sections.push([RULE, '📍 ROUTE', RULE, ...routeLines].join('\n'));

  // ── Vehicle ──
  // Falls back to an explicit "as per availability" line rather than printing
  // nothing, because support needs to know whether a preference was expressed.
  const vehicleLines = [line('Vehicle:', vehicleName) || 'Vehicle: As per availability'];
  sections.push([RULE, '🚚 VEHICLE', RULE, ...vehicleLines].join('\n'));

  // ── Shipment ──
  const shipmentLines = [
    line('Material:', enquiry.material),
    line('Quantity:', withUnit(enquiry.quantity, enquiry.quantity_unit)),
    line('Weight:', withUnit(enquiry.weight, enquiry.weight_unit)),
    line('Category:', enquiry.goods_category),
    line('Handling:', enquiry.fragile ? 'Fragile goods' : null),
  ].filter(Boolean);
  sections.push([RULE, '📦 SHIPMENT', RULE, ...shipmentLines].join('\n'));

  // ── Schedule ──
  const scheduleLines = [
    line('Pickup Date:', pickupDate),
    line('Pickup Time:', pickupTime),
  ].filter(Boolean);
  sections.push([RULE, '📅 SCHEDULE', RULE, ...scheduleLines].join('\n'));

  // ── Fare ──
  const fareLines = [line(fare ? 'Estimated Fare:' : '', fare)].filter(Boolean);
  sections.push(
    [
      RULE,
      '💰 ESTIMATED FARE',
      RULE,
      ...fareLines,
      '',
      'ℹ️ Final price will be confirmed by Bihar Transport after vehicle and driver assignment.',
    ].join('\n')
  );

  // ── Progress (helps support triage) ──
  sections.push(
    [
      RULE,
      '📌 CURRENT STATUS',
      RULE,
      `Stage ${stage} of 6`,
      `Status: ${enquiry.status}`,
    ].join('\n')
  );

  const instructions = (enquiry.special_instructions || '').trim();
  if (instructions) {
    sections.push([RULE, '📝 SPECIAL INSTRUCTIONS', RULE, instructions].join('\n'));
  }

  sections.push(
    [
      'Please review and assist with this transport request.',
      '',
      'Thank you,',
      BRAND_NAME,
    ].join('\n')
  );

  return sections.join('\n\n');
}

/**
 * The "help with my enquiry" message — the default body for the customer-care
 * WhatsApp button on the confirmation page.
 *
 * @param {object} enquiry
 * @returns {string}
 */
function buildCustomerCareHelpMessage(enquiry) {
  const number = enquiry?.enquiry_number ? enquiry.enquiry_number : 'my enquiry';

  return [
    `Hello Bihar Transport Customer Care,`,
    '',
    'I need assistance regarding my transport enquiry.',
    '',
    `Enquiry ID: ${number}`,
  ].join('\n');
}

/**
 * The full "help with my enquiry" message with the request context filled in.
 * This is what the enquiry confirmation page sends.
 *
 * @param {object} enquiry
 * @returns {string}
 */
function buildEnquiryHelpMessage(enquiry) {
  if (!enquiry) return buildCustomerCareHelpMessage(null);

  const context = [
    line('Pickup:', enquiry.pickup_location),
    line('Drop:', enquiry.drop_location),
    line('Vehicle:', enquiry.assigned_vehicle_type || enquiry.requested_vehicle_name),
    line('Material:', enquiry.material),
    line('Weight:', withUnit(enquiry.weight, enquiry.weight_unit)),
    line('Pickup Date:', formatLongDate(enquiry.pickup_date)),
    line('Pickup Time:', formatTime12(enquiry.pickup_time)),
  ].filter(Boolean);

  return [
    'Hello Bihar Transport Customer Care,',
    '',
    'I need assistance regarding my transport enquiry.',
    '',
    `Enquiry ID: ${enquiry.enquiry_number}`,
    ...context,
    '',
    'Please assist me with my enquiry.',
    '',
    'Thank you,',
    BRAND_NAME,
  ].join('\n');
}

/**
 * The admin notification message — the one dispatch sends when an admin needs
 * to look at a new enquiry. Kept separate from the customer message so support
 * wording and customer wording can diverge without touching call sites.
 *
 * @param {object} enquiry
 * @returns {string}
 */
function buildAdminAlertMessage(enquiry) {
  if (!enquiry) return '';
  return [
    `🚨 New transport enquiry received`,
    '',
    `Enquiry ID: ${enquiry.enquiry_number}`,
    `Customer: ${enquiry.customer_name} (${enquiry.customer_mobile})`,
    line('Pickup:', enquiry.pickup_location),
    line('Drop:', enquiry.drop_location),
    line('Vehicle requested:', enquiry.requested_vehicle_name),
    line('Material:', enquiry.material),
    line('Weight:', withUnit(enquiry.weight, enquiry.weight_unit)),
    line('Pickup Date:', formatLongDate(enquiry.pickup_date)),
  ].filter((l) => l !== null && l !== undefined).join('\n');
}

/**
 * Build a ready-to-open wa.me URL for an enquiry.
 *
 * @param {object} enquiry
 * @param {'summary'|'help'|'admin'} [variant]
 * @returns {string}
 */
function buildEnquiryWhatsAppUrl(enquiry, variant = 'help') {
  let body;
  if (variant === 'summary') body = buildEnquirySummaryMessage(enquiry);
  else if (variant === 'admin') body = buildAdminAlertMessage(enquiry);
  else body = buildEnquiryHelpMessage(enquiry);

  return buildWhatsAppLink(body);
}

module.exports = {
  RULE,
  formatLongDate,
  formatTime12,
  formatINR,
  formatKm,
  withUnit,
  formatFareRange,
  buildEnquirySummaryMessage,
  buildCustomerCareHelpMessage,
  buildEnquiryHelpMessage,
  buildAdminAlertMessage,
  buildEnquiryWhatsAppUrl,
};
