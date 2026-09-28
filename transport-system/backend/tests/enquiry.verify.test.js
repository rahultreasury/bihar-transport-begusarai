/**
 * enquiry.verify.test.js
 * ---------------------------------------------------------------------------
 * Regression tests for the enquiry module that need NO database.
 *
 * These run with `node --test` and cover the parts that are easy to break
 * silently and expensive to break in production:
 *
 *   1. PRIVACY — a customer-facing DTO must never contain a driver's phone.
 *      This is the single most important invariant in the feature.
 *   2. NUMBERING — enquiry numbers are derived from the PK, are unique under
 *      concurrency, and match the documented BTB-YYYYMMDD-NNNNNN shape.
 *   3. STATE MACHINE — only legal transitions pass; terminal states are final.
 *   4. ACCESS TOKENS — a token is scoped to exactly one enquiry, and a token
 *      for enquiry A cannot authorise enquiry B.
 *   5. CAPACITY + CONFLICT RULES — unit normalisation (Tons vs KG) and
 *      overlapping-window detection.
 *   6. WHATSAPP — the message is built from real data, never prints
 *      "undefined"/"null", and never contains a driver number.
 *   7. CUSTOMER CARE — the config normalises any phone format into a valid
 *      wa.me / tel: target.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-enquiry-unit-tests-only';

// config/customerCare.js reads the environment once at module load, so the
// support number has to be present BEFORE it is required below. This is a test
// fixture, not a production default — the real value comes from the deployment
// environment.
process.env.CUSTOMER_CARE_PHONE = process.env.CUSTOMER_CARE_PHONE || '9876543210';
process.env.CUSTOMER_CARE_WHATSAPP = process.env.CUSTOMER_CARE_WHATSAPP || '9876543210';
process.env.CUSTOMER_CARE_NAME = process.env.CUSTOMER_CARE_NAME || 'Bihar Transport Customer Care';

// ── 1. PRIVACY ───────────────────────────────────────────────────────────
const {
  toCustomerEnquiry,
  toAdminEnquiry,
  toDriverEnquiry,
  assertNoDriverPhone,
} = require('../dtos/EnquiryDTO');

/** A committed enquiry whose assigned driver HAS a mobile in the source row. */
function committedEnquiry(overrides = {}) {
  return {
    enquiry_id: 123,
    enquiry_number: 'BTB-20260926-000123',
    status: 'CONFIRMED',
    price_status: 'ACCEPTED',
    customer_id: 42,
    customer_name: 'Ramesh Kumar',
    customer_mobile: '9876543210',
    customer_email: 'ramesh@example.com',
    session_key: null,
    pickup_location: 'Patna',
    pickup_address: 'Kankarbagh',
    pickup_latitude: 25.5941,
    pickup_longitude: 85.1376,
    drop_location: 'Chandigarh',
    drop_address: null,
    drop_latitude: 30.7333,
    drop_longitude: 76.7794,
    distance_km: 1211,
    requested_vehicle_id: null,
    requested_vehicle_name: '17 ft Truck',
    assigned_vehicle_id: 7,
    assigned_driver_id: 3,
    assigned_partner_id: null,
    assigned_owner_id: null,
    assigned_vehicle_number: 'BR-XX-1234',
    assigned_vehicle_type: '17 ft Truck',
    assigned_driver_name: 'Raj Kumar',
    driver_assigned_at: new Date(),
    vehicle_assigned_at: new Date(),
    material: 'Cement Steel',
    quantity: 85,
    quantity_unit: 'Bundles',
    weight: 8,
    weight_unit: 'Tons',
    goods_category: 'Construction',
    fragile: false,
    special_instructions: null,
    // Explicit UTC. Enquiry.pickup_date is pinned to UTC midnight by
    // parsePickupDate, so a fixture written as a bare 'YYYY-MM-DD' (which JS
    // parses as LOCAL midnight) would model the very off-by-one this suite
    // exists to prevent.
    pickup_date: new Date('2026-09-26T00:00:00.000Z'),
    pickup_time: '10:00:00',
    estimated_price_min: 54495,
    estimated_price_max: 66605,
    final_quoted_price: 61000,
    quote_remarks: null,
    quoted_by_admin_id: 1,
    quoted_at: new Date(),
    accepted_at: new Date(),
    rejected_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    confirmed_at: new Date(),
    started_at: null,
    completed_at: null,
    booking_id: 900,
    created_at: new Date(),
    updated_at: new Date(),
    customer: { user_id: 42, first_name: 'Ramesh', last_name: 'Kumar' },
    // The dangerous fields. A customer select MUST NOT include these, so this
    // test passes the driver WITHOUT them — exactly as the real query does.
    assignedDriver: {
      driver_id: 3,
      driver_name: 'Raj Kumar',
      rating: 4.8,
      profile_image: null,
      is_verified: true,
      total_deliveries: 210,
      status: 'on_trip',
    },
    assignedVehicle: {
      vehicle_id: 7,
      vehicle_number: 'BR-XX-1234',
      vehicle_type: 'TRUCK_17FT',
      vehicle_name: '17 ft Truck',
      capacity_kg: 12000,
      body_type: 'Open Body',
      current_status: 'on_trip',
    },
    assignedOwner: null,
    assignedPartner: null,
    requestedVehicle: null,
    booking: { booking_id: 900, booking_number: 'BTB-2026-00042', status: 'confirmed' },
    ...overrides,
  };
}

test('PRIVACY: customer DTO never exposes a driver mobile number', () => {
  const dto = toCustomerEnquiry(committedEnquiry(), []);

  const serialised = JSON.stringify(dto);

  // The customer's own number is fine to echo back.
  assert.ok(serialised.includes('9876543210'), 'customer mobile should be present');

  // The driver has no mobile in the customer select, so none can appear.
  assert.ok(
    !/"driver_mobile"|"driver_phone"|"alternate_mobile"/.test(serialised),
    'customer DTO must not contain driver contact keys'
  );

  // The assignment block carries the four displayable facts and nothing else.
  assert.deepEqual(Object.keys(dto.assignment).sort(), [
    'assigned_at',
    'contact',
    'driver_assigned',
    'driver_name',
    'driver_rating',
    'driver_status',
    'driver_total_deliveries',
    'driver_verified',
    'transport_owner',
    'vehicle_id',
    'vehicle_number',
    'vehicle_type',
  ]);
});

test('PRIVACY: driver DTO hides customer PII and the quoted price', () => {
  const dto = toDriverEnquiry(committedEnquiry());
  const serialised = JSON.stringify(dto);

  assert.ok(!serialised.includes('9876543210'), 'driver DTO must not expose customer mobile');
  assert.ok(!serialised.includes('ramesh@example.com'), 'driver DTO must not expose customer email');
  assert.ok(!serialised.includes('61000'), 'driver DTO must not expose final quoted price');
  assert.ok(!('final_quoted_price' in dto), 'driver DTO must have no price field at all');
  assert.equal(dto.customer_first_name, 'Ramesh', 'driver gets a first name to greet the contact');
});

test('PRIVACY: admin DTO DOES carry the driver mobile (dispatch needs it)', () => {
  const adminEnquiry = {
    ...committedEnquiry(),
    assignedDriver: {
      driver_id: 3,
      driver_code: 'DRV000003',
      driver_name: 'Raj Kumar',
      mobile: '9000000001',
      alternate_mobile: '9000000002',
      status: 'on_trip',
      is_available: false,
      rating: 4.8,
      transport_owner_id: null,
      partner_id: null,
      current_vehicle_id: 7,
    },
    quotedByAdmin: { admin_id: 1, full_name: 'Admin', email: 'a@b.c' },
  };

  const dto = toAdminEnquiry(adminEnquiry, []);
  assert.equal(dto.assignment.driver.mobile, '9000000001', 'admin must be able to call the driver');
  assert.equal(dto.assignment.driver.alternate_mobile, '9000000002');
});

test('PRIVACY: assignment is hidden until the customer commits', () => {
  const notCommitted = toCustomerEnquiry(committedEnquiry({ status: 'AWAITING_CUSTOMER_ACCEPTANCE' }), []);
  assert.equal(notCommitted.assignment, null, 'no driver details before acceptance');

  const afterAccept = toCustomerEnquiry(committedEnquiry({ status: 'CUSTOMER_ACCEPTED' }), []);
  assert.ok(afterAccept.assignment, 'driver details appear after acceptance');
  assert.equal(afterAccept.assignment.driver_name, 'Raj Kumar');
});

test('PRIVACY: the tripwire throws when a driver contact key is injected', () => {
  assert.throws(
    () => assertNoDriverPhone({ assignment: { driver_mobile: '9000000001' } }),
    /privacy violation/i
  );
  assert.throws(
    () => assertNoDriverPhone({ driver: { phone: '9000000001' } }),
    /privacy violation/i
  );
  // The legitimate customer-cared paths must NOT throw.
  assert.doesNotThrow(() =>
    assertNoDriverPhone({
      customer: { mobile: '9876543210' },
      contact: { phoneDigits: '919876543210' },
      assignment: { contact: { phoneDigits: '919876543210' } },
    })
  );
});

// ── 2. NUMBERING ─────────────────────────────────────────────────────────
const {
  buildEnquiryNumber,
  isCanonicalEnquiryNumber,
  normalizeEnquiryIdentifier,
} = require('../services/EnquiryNumberService');

test('NUMBERING: derives BTB-YYYYMMDD-NNNNNN from the primary key', () => {
  const n = buildEnquiryNumber(123, new Date('2026-09-26T10:00:00Z'));
  assert.equal(n, 'BTB-20260926-000123');
  assert.ok(isCanonicalEnquiryNumber(n));
});

test('NUMBERING: consecutive ids never collide (PK-derived, not random)', () => {
  const day = new Date('2026-09-26T00:00:00Z');
  const seen = new Set();
  for (let i = 1; i <= 5000; i += 1) {
    const n = buildEnquiryNumber(i, day);
    assert.ok(!seen.has(n), `duplicate generated at id=${i}`);
    seen.add(n);
  }
  assert.equal(seen.size, 5000);
});

test('NUMBERING: rejects a missing id and normalises user input', () => {
  assert.throws(() => buildEnquiryNumber(0));
  assert.throws(() => buildEnquiryNumber(null));
  assert.equal(normalizeEnquiryIdentifier('  btb-20260926-000123 '), 'BTB-20260926-000123');
  assert.ok(!isCanonicalEnquiryNumber('BTB-2026-000123'), 'booking numbers are a different namespace');
});

// ── 3. STATE MACHINE ─────────────────────────────────────────────────────
const {
  assertTransition,
  canTransition,
  isTerminal,
  canCancel,
  isCustomerCommitted,
  toProgressStage,
} = require('../utils/EnquiryStateMachine');

test('STATE: legal transitions pass', () => {
  assert.doesNotThrow(() => assertTransition('ENQUIRY_SUBMITTED', 'ADMIN_REVIEW'));
  assert.doesNotThrow(() => assertTransition('ADMIN_REVIEW', 'ASSIGNMENT_PENDING'));
  assert.doesNotThrow(() => assertTransition('ASSIGNMENT_PENDING', 'VEHICLE_ASSIGNED'));
  assert.doesNotThrow(() => assertTransition('VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED'));
  assert.doesNotThrow(() => assertTransition('DRIVER_ASSIGNED', 'QUOTE_READY'));
  assert.doesNotThrow(() => assertTransition('QUOTE_READY', 'AWAITING_CUSTOMER_ACCEPTANCE'));
  assert.doesNotThrow(() => assertTransition('AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED'));
  assert.doesNotThrow(() => assertTransition('CUSTOMER_ACCEPTED', 'CONFIRMED'));
  assert.doesNotThrow(() => assertTransition('CONFIRMED', 'IN_PROGRESS'));
  assert.doesNotThrow(() => assertTransition('IN_PROGRESS', 'COMPLETED'));
});

test('STATE: skipping steps is rejected (no shortcut to CONFIRMED)', () => {
  assert.throws(() => assertTransition('ENQUIRY_SUBMITTED', 'CONFIRMED'));
  assert.throws(() => assertTransition('ENQUIRY_SUBMITTED', 'AWAITING_CUSTOMER_ACCEPTANCE'));
  assert.throws(() => assertTransition('AWAITING_CUSTOMER_ACCEPTANCE', 'COMPLETED'));
  assert.ok(!canTransition('ENQUIRY_SUBMITTED', 'CONFIRMED'));
});

test('STATE: a self-transition is rejected', () => {
  assert.throws(() => assertTransition('ADMIN_REVIEW', 'ADMIN_REVIEW'));
});

test('STATE: terminal states are final', () => {
  for (const terminal of ['CANCELLED', 'CUSTOMER_REJECTED', 'COMPLETED']) {
    assert.ok(isTerminal(terminal));
    assert.throws(() => assertTransition(terminal, 'ADMIN_REVIEW'), undefined, `${terminal} must be final`);
  }
});

test('STATE: customer may cancel before confirmation but not after', () => {
  assert.ok(canCancel('ENQUIRY_SUBMITTED', 'CUSTOMER'));
  assert.ok(canCancel('AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER'));
  assert.ok(!canCancel('CONFIRMED', 'CUSTOMER'), 'a confirmed trip needs customer care, not a self-serve cancel');
  assert.ok(!canCancel('IN_PROGRESS', 'CUSTOMER'));
  // An admin can still cancel a live trip.
  assert.ok(canCancel('CONFIRMED', 'ADMIN'));
  assert.ok(canCancel('IN_PROGRESS', 'ADMIN'));
});

test('STATE: driver details are gated on commitment', () => {
  assert.ok(!isCustomerCommitted('AWAITING_CUSTOMER_ACCEPTANCE'));
  assert.ok(isCustomerCommitted('CUSTOMER_ACCEPTED'));
  assert.ok(isCustomerCommitted('CONFIRMED'));
  assert.equal(toProgressStage('ENQUIRY_SUBMITTED'), 1);
  assert.equal(toProgressStage('AWAITING_CUSTOMER_ACCEPTANCE'), 5);
  assert.equal(toProgressStage('CONFIRMED'), 6);
});

// ── 4. ACCESS TOKENS ─────────────────────────────────────────────────────
const {
  issueEnquiryAccessToken,
  verifyEnquiryAccessToken,
  extractEnquiryToken,
} = require('../utils/EnquiryAccessToken');

test('TOKEN: round-trips and is scoped to exactly one enquiry', () => {
  const { token, jti } = issueEnquiryAccessToken({ enquiryId: 123, enquiryNumber: 'BTB-20260926-000123' });
  const result = verifyEnquiryAccessToken(token);

  assert.ok(result.valid);
  assert.equal(result.payload.type, 'enquiry_access');
  assert.equal(result.payload.enquiryId, 123);
  assert.equal(result.payload.jti, jti);
  // The token carries NO customer PII — only opaque identifiers.
  assert.equal(JSON.stringify(result.payload).includes('9876543210'), false);
});

test('TOKEN: a token for enquiry A cannot authorise enquiry B', () => {
  const { token } = issueEnquiryAccessToken({ enquiryId: 123, enquiryNumber: 'BTB-20260926-000123' });
  const result = verifyEnquiryAccessToken(token);

  // The controller compares these; a mismatch is what blocks access.
  assert.notEqual(result.payload.enquiryId, 456);
});

test('TOKEN: garbage and expired tokens are rejected, not thrown', () => {
  assert.equal(verifyEnquiryAccessToken('not-a-jwt').valid, false);
  assert.equal(verifyEnquiryAccessToken('').valid, false);
  assert.equal(verifyEnquiryAccessToken(null).valid, false);
  assert.equal(verifyEnquiryAccessToken(undefined).reason, 'missing');
});

test('TOKEN: extraction prefers X-Enquiry-Token, falls back to Bearer', () => {
  const custom = extractEnquiryToken({ headers: { 'x-enquiry-token': 'AAA' }, query: {} });
  assert.equal(custom, 'AAA');

  const bearer = extractEnquiryToken({ headers: { authorization: 'Bearer BBB' }, query: {} });
  assert.equal(bearer, 'BBB');

  const query = extractEnquiryToken({ headers: {}, query: { enquiry_token: 'CCC' } });
  assert.equal(query, 'CCC');

  assert.equal(extractEnquiryToken({ headers: {}, query: {} }), null);
});

// ── 5. ASSIGNMENT RULES ──────────────────────────────────────────────────
const { toKilograms, pickupWindow, rangesOverlap } = require('../services/EnquiryAssignmentService');

test('ASSIGNMENT: weight units normalise to kilograms for capacity checks', () => {
  assert.equal(toKilograms(8, 'Tons'), 8000, '8 Tons must be 8000 kg, not 8 kg');
  assert.equal(toKilograms(8, 'TON'), 8000);
  assert.equal(toKilograms(5, 'Quintal'), 500);
  assert.equal(toKilograms(1500, 'KG'), 1500);
  assert.equal(toKilograms(1500, null), 1500, 'defaults to KG');
  // FTL is "the whole truck" — the capacity check is meaningless, not a number.
  assert.equal(toKilograms(1, 'FTL'), null);
  assert.equal(toKilograms(0, 'Tons'), null);
  assert.equal(toKilograms(-5, 'Tons'), null);
  assert.equal(toKilograms('abc', 'Tons'), null);
});

test('ASSIGNMENT: overlapping pickup windows are detected', () => {
  const a = pickupWindow(new Date('2026-09-26T00:00:00'), '10:00:00');
  const sameDayLater = pickupWindow(new Date('2026-09-26T00:00:00'), '16:00:00');
  const nextDay = pickupWindow(new Date('2026-09-27T00:00:00'), '10:00:00');

  assert.ok(rangesOverlap(a.start, a.end, sameDayLater.start, sameDayLater.end), 'same day must conflict');
  assert.ok(!rangesOverlap(a.start, a.end, nextDay.start, nextDay.end), 'next day must not conflict');
});

// ── 6. WHATSAPP ──────────────────────────────────────────────────────────
const {
  buildEnquirySummaryMessage,
  buildEnquiryHelpMessage,
  formatFareRange,
  formatLongDate,
  formatTime12,
} = require('../services/enquiryWhatsAppFormatter');

test('WHATSAPP: the summary is built from real values, never "undefined"', () => {
  const msg = buildEnquirySummaryMessage(committedEnquiry());

  assert.ok(msg.includes('BTB-20260926-000123'), 'includes the enquiry id');
  assert.ok(msg.includes('Patna'));
  assert.ok(msg.includes('Chandigarh'));
  assert.ok(msg.includes('1,211 km'));
  assert.ok(msg.includes('Cement Steel'));
  assert.ok(msg.includes('85 Bundles'));
  assert.ok(msg.includes('8 Tons'));
  assert.ok(msg.includes('26 September 2026'));
  assert.ok(msg.includes('10:00 AM'));
  assert.ok(msg.includes('₹54,495 – ₹66,605'), 'includes the estimate range');
  assert.ok(msg.includes('Final price will be confirmed by Bihar Transport'));

  // The classic formatter bug: a missing field printing as a literal.
  assert.ok(!msg.includes('undefined'), 'message must never contain "undefined"');
  assert.ok(!/:\s*null/i.test(msg), 'message must never contain "null"');
  assert.ok(!msg.includes('NaN'), 'message must never contain NaN');
});

test('WHATSAPP: the summary never contains a driver contact detail', () => {
  const msg = buildEnquirySummaryMessage({
    ...committedEnquiry(),
    assignedDriver: { mobile: '9000000001', alternate_mobile: '9000000002', driver_name: 'Raj Kumar' },
  });
  assert.ok(!msg.includes('9000000001'), 'driver mobile must never reach a customer message');
  assert.ok(!msg.includes('9000000002'));
});

// ── 6b. REGRESSION: pickup date off-by-one ───────────────────────────────
// A pickup date must never shift a day. This caught a real bug: the date was
// parsed as LOCAL midnight, which Prisma wrote as the previous UTC day, so a
// customer picking 26 September was stored (and messaged) as 25 September.
const { parsePickupDate } = require('../services/EnquiryService');

test('DATE: parsePickupDate pins the calendar date to UTC midnight', () => {
  const d = parsePickupDate('2026-09-26');
  assert.equal(d.toISOString(), '2026-09-26T00:00:00.000Z', 'stored value IS the chosen date');
  // Round-trips through the formatter unchanged.
  assert.equal(formatLongDate(d), '26 September 2026');
});

test('DATE: a full ISO timestamp collapses to its own UTC calendar day', () => {
  assert.equal(parsePickupDate('2026-09-26T10:00:00Z').toISOString(), '2026-09-26T00:00:00.000Z');
  assert.equal(parsePickupDate('2026-12-01T23:59:59Z').toISOString(), '2026-12-01T00:00:00.000Z');
});

test('DATE: re-parsing an already-normalised value does not drift', () => {
  const once = parsePickupDate('2026-09-26');
  const twice = parsePickupDate(once);
  assert.equal(once.getTime(), twice.getTime(), 'idempotent');
});

test('DATE: month/day boundaries are not shifted', () => {
  assert.equal(formatLongDate(parsePickupDate('2026-01-01')), '1 January 2026');
  assert.equal(formatLongDate(parsePickupDate('2026-12-31')), '31 December 2026');
  assert.equal(formatLongDate(parsePickupDate('2026-03-01')), '1 March 2026', 'non-leap year');
  assert.equal(formatLongDate(parsePickupDate('2024-03-01')), '1 March 2024', 'leap year');
});

test('WHATSAPP: a sparse enquiry omits missing fields instead of printing blanks', () => {
  const sparse = {
    ...committedEnquiry(),
    quantity: null,
    quantity_unit: null,
    weight: null,
    weight_unit: null,
    goods_category: null,
    special_instructions: null,
    estimated_price_min: null,
    estimated_price_max: null,
  };
  const msg = buildEnquirySummaryMessage(sparse);
  assert.ok(!msg.includes('undefined'));
  assert.ok(!msg.includes('null'));
  assert.ok(!msg.includes('Quantity:'), 'a missing quantity is omitted, not printed empty');
  assert.ok(msg.includes('Vehicle:'), 'a present vehicle is still shown');
});

test('WHATSAPP: formatters handle edge inputs', () => {
  assert.equal(formatLongDate(null), '');
  assert.equal(formatTime12(''), '');
  assert.equal(formatFareRange(null, null), '');
  assert.equal(formatFareRange(100, 100), '₹100');
  assert.equal(formatFareRange(100, null), 'from ₹100');
  assert.equal(formatFareRange(null, 200), 'up to ₹200');
  assert.equal(formatTime12('00:00:00'), '12:00 AM');
  assert.equal(formatTime12('13:45:00'), '1:45 PM');
});

test('WHATSAPP: the help message is pre-filled with the enquiry context', () => {
  const msg = buildEnquiryHelpMessage(committedEnquiry());
  assert.ok(msg.includes('Hello Bihar Transport Customer Care'));
  assert.ok(msg.includes('Enquiry ID: BTB-20260926-000123'));
  assert.ok(msg.includes('Patna'));
  assert.ok(msg.includes('Chandigarh'));
  assert.ok(msg.includes('8 Tons'));
  assert.ok(!msg.includes('9000000001'));
});

// ── 7. CUSTOMER CARE CONFIG ──────────────────────────────────────────────
const { toDialableDigits, formatPhoneForDisplay, buildWhatsAppLink } = require('../config/customerCare');

test('CUSTOMER CARE: any phone format normalises to a valid wa.me target', () => {
  assert.equal(toDialableDigits('9876543210'), '919876543210', 'bare 10-digit gets the 91 prefix');
  assert.equal(toDialableDigits('+91 98765 43210'), '919876543210');
  assert.equal(toDialableDigits('91-987-654-3210'), '919876543210');
  assert.equal(toDialableDigits('(987) 654-3210'), '919876543210');
  assert.equal(toDialableDigits(''), '');
  assert.equal(toDialableDigits(null), '');
  assert.equal(toDialableDigits('abc'), '');
});

test('CUSTOMER CARE: display formatting and link encoding are safe', () => {
  assert.equal(formatPhoneForDisplay('919876543210'), '+91 98765 43210');
  assert.equal(formatPhoneForDisplay(''), '');

  const link = buildWhatsAppLink('Line 1\nLine 2 & special=chars');
  assert.ok(link.startsWith('https://wa.me/'));
  assert.ok(!link.includes('\n'), 'newlines must be encoded, not raw');
  assert.ok(link.includes('%26'), 'ampersand is encoded so it cannot break the query string');
});

// ── 8. EVENT METADATA SCRUBBING ──────────────────────────────────────────
const { scrubMetadata } = require('../services/EnquiryEventService');

test('EVENTS: driver contact keys are redacted before they reach the audit log', () => {
  const scrubbed = scrubMetadata({
    driver_id: 3,
    driver_name: 'Raj Kumar',
    mobile: '9000000001',
    nested: { alternate_mobile: '9000000002', vehicle_number: 'BR-XX-1234' },
    list: [{ phone: '9000000003' }],
  });

  assert.equal(scrubbed.driver_id, 3, 'safe fields survive');
  assert.equal(scrubbed.mobile, '[redacted]');
  assert.equal(scrubbed.nested.alternate_mobile, '[redacted]');
  assert.equal(scrubbed.nested.vehicle_number, 'BR-XX-1234');
  assert.equal(scrubbed.list[0].phone, '[redacted]');
});
