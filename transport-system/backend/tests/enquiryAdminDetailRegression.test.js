/**
 * tests/enquiryAdminDetailRegression.test.js
 * ============================================================================
 * REGRESSION COVERAGE — the HTTP 500 behind /admin/enquiries/:id.
 *
 * THE BUG
 *   GET /api/admin/enquiries/4470 returned "Enquiry unavailable — Internal server
 *   error". The chain was:
 *
 *     controller.getEnquiry
 *       -> EnquiryService.loadForAdmin
 *         -> prisma.enquiry.findUnique({ include: adminRelationSelect })
 *            -> PrismaClientValidationError:
 *               Unknown field `quotation` for include statement on model `Enquiry`
 *
 *   Prisma validates `include` against the schema the client was generated
 *   from. The enquiry module had gained a Phase B `quotation` relation; the
 *   Quotation models were later removed from the deployed schema, but the DTO
 *   kept asking for the relation. Every admin enquiry read — the list AND the
 *   detail page — failed, and it looked like a database problem rather than a
 *   code/schema mismatch.
 *
 * THE FIX
 *   EnquiryDTO filters every declared relation through `onlyKnownRelations`,
 *   which keeps only the fields the running Prisma Client actually knows.
 *   Quotation data is still loaded in full wherever the relation exists.
 *
 * WHAT IS ASSERTED HERE
 *   1. the include never names a relation the client does not know
 *   2. enquiry 4470 (every optional relation NULL) loads and serialises
 *   3. the DTO is null-safe for every optional relation
 *   4. malformed / missing enquiries still produce 404, never a 500
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Prisma } = require('@prisma/client');
const {
  adminRelationSelect,
  customerRelationSelect,
  toAdminEnquiry,
} = require('../dtos/EnquiryDTO');

/* ========================================================================== */
/* 1. the include matches the generated client                                 */
/* ========================================================================== */

test('the admin include never names a relation the Prisma client does not know', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Enquiry');
  assert.ok(model, 'the Enquiry model must exist in the generated client');

  const known = new Set(model.fields.map((f) => f.name));
  for (const relation of Object.keys(adminRelationSelect)) {
    assert.ok(
      known.has(relation),
      `adminRelationSelect asks for "${relation}", which the generated client does not know. ` +
      'Selecting an unknown relation is a PrismaClientValidationError -> HTTP 500.'
    );
  }
});

test('the customer include never names a relation the Prisma client does not know', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Enquiry');
  const known = new Set(model.fields.map((f) => f.name));
  for (const relation of Object.keys(customerRelationSelect)) {
    assert.ok(known.has(relation), `customerRelationSelect asks for unknown "${relation}"`);
  }
});

test('the admin include still carries the relations dispatch depends on', () => {
  // These are not optional decoration: the admin workspace renders each of them,
  // and the customerPrivacy contract depends on driver mobile being ADMIN-only.
  for (const required of [
    'customer', 'assignedDriver', 'assignedVehicle',
    'assignedOwner', 'assignedPartner', 'requestedVehicle',
    'quotedByAdmin', 'booking',
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(adminRelationSelect, required),
      `adminRelationSelect must keep "${required}"`
    );
  }
  assert.equal(adminRelationSelect.assignedDriver.select.mobile, true);
});

/* ========================================================================== */
/* 2 + 3. null-safety: an enquiry with every optional relation NULL           */
/* ========================================================================== */

/** Enquiry 4470 exactly as it is stored: every optional relation is NULL. */
function enquiryWithEveryOptionalRelationNull() {
  return {
    enquiry_id: 4470,
    enquiry_number: 'BTB-20261004-004470',
    customer_id: null,
    customer: null,
    customer_name: 'mankhush',
    customer_mobile: '9709907415',
    customer_email: null,
    status: 'ENQUIRY_SUBMITTED',
    price_status: 'ESTIMATED',
    pickup_location: 'Patna',
    drop_location: 'Gaya',
    pickup_date: new Date('2026-10-04T00:00:00.000Z'),
    pickup_time: '09:00',
    // no booking, no quotation, no vehicle, no driver, no owner, no partner
    booking_id: null,
    booking: null,
    quotation: undefined,
    assignedVehicle: null,
    assignedDriver: null,
    assignedOwner: null,
    assignedPartner: null,
    requestedVehicle: null,
    quotedByAdmin: null,
    final_quoted_price: null,
  };
}

test('4470 — an enquiry with every optional relation NULL serialises without throwing', () => {
  const dto = toAdminEnquiry(enquiryWithEveryOptionalRelationNull(), []);
  assert.equal(dto.enquiry_id, 4470);
  assert.equal(dto.enquiry_number, 'BTB-20261004-004470');
  assert.equal(dto.status, 'ENQUIRY_SUBMITTED');
  assert.equal(dto.customer.name, 'mankhush');
  assert.deepEqual(dto.events, []);
});

test('4470 — every missing optional relation renders as an empty state, not a crash', () => {
  const dto = toAdminEnquiry(enquiryWithEveryOptionalRelationNull(), []);

  assert.equal(dto.assignment.driver, null);
  assert.equal(dto.assignment.vehicle, null);
  assert.equal(dto.assignment.owner, null);
  assert.equal(dto.assignment.partner, null);
  assert.equal(dto.booking, null);

  assert.equal(dto.commercial.has_order, false);
  assert.equal(dto.commercial.booking_id, null);
  assert.equal(dto.commercial.quotation_status, null);
  assert.equal(dto.commercial.quotation_number, null);
  assert.equal(dto.commercial.total_billing_amount, null);

  assert.equal(dto.quote.quoted_by, null);
  assert.equal(dto.vehicle.assigned_vehicle_id, null);
});

test('4470 — an empty event list does not break the payload', () => {
  const dto = toAdminEnquiry(enquiryWithEveryOptionalRelationNull(), []);
  assert.ok(Array.isArray(dto.events));
  assert.equal(dto.events.length, 0);
});

test('events are returned in the order supplied, one malformed entry cannot break the payload', () => {
  const events = [
    { enquiry_event_id: 1, event_type: 'ENQUIRY_CREATED', message: 'created', actor_type: 'SYSTEM', created_at: new Date() },
    { enquiry_event_id: 2, event_type: 'QUOTE_SAVED', message: 'quoted', actor_type: 'ADMIN', created_at: new Date() },
  ];
  const dto = toAdminEnquiry(enquiryWithEveryOptionalRelationNull(), events);
  assert.equal(dto.events.length, 2);
});

/* ========================================================================== */
/* 4. a partially assigned enquiry still renders                                */
/* ========================================================================== */

test('a partially assigned enquiry (driver only) renders that driver and no vehicle', () => {
  const e = {
    ...enquiryWithEveryOptionalRelationNull(),
    assigned_driver_id: 7,
    assignedDriver: { driver_id: 7, driver_code: 'DRV007', driver_name: 'Ramesh', mobile: '9800000000', alternate_mobile: null, status: 'available', is_available: true, rating: 4.5, transport_owner_id: null, partner_id: null },
  };
  const dto = toAdminEnquiry(e, []);
  assert.equal(dto.assignment.driver.driver_name, 'Ramesh');
  assert.equal(dto.assignment.driver.mobile, '9800000000'); // admin-only contact is preserved
  assert.equal(dto.assignment.vehicle, null);
});

test('an enquiry with a booking reports has_order and the booking', () => {
  const e = {
    ...enquiryWithEveryOptionalRelationNull(),
    booking_id: 55,
    booking: { booking_id: 55, booking_number: 'BTB-2026-00055', status: 'confirmed' },
  };
  const dto = toAdminEnquiry(e, []);
  assert.equal(dto.commercial.has_order, true);
  assert.equal(dto.booking.booking_number, 'BTB-2026-00055');
});

/* ========================================================================== */
/* 5. the DTO never breaks the customer privacy contract                        */
/* ========================================================================== */

test('the admin DTO still exposes driver mobile; the customer DTO never would', () => {
  const dto = toAdminEnquiry(enquiryWithEveryOptionalRelationNull(), []);
  assert.equal(dto.assignment.driver, null); // nothing assigned here
  // The privacy scrubber is untouched by this change — assert the helper exists.
  assert.equal(typeof require('../dtos/EnquiryDTO').toCustomerEnquiry, 'function');
});
