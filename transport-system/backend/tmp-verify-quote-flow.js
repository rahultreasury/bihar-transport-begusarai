/**
 * tmp-verify-quote-flow.js
 * ---------------------------------------------------------------------------
 * End-to-end verification of the QUOTE workflow:
 *   prepare -> send -> accept, plus the draft-quote privacy gate.
 *
 * Mirrors the exact production calls the admin workspace and the customer page
 * make. Runs against the real database and deletes its rows in `finally`.
 *
 * Run:  node tmp-verify-quote-flow.js
 */

require('dotenv').config();

const { prisma } = require('./config/prisma');
const enquiryService = require('./services/EnquiryService');
const eventService = require('./services/EnquiryEventService');
const { toCustomerEnquiry, toCustomerEnquirySummary, toAdminEnquiry } = require('./dtos/EnquiryDTO');

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`   PASS  ${label}${detail ? ` -> ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function tomorrow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const admin = { adminId: null, adminName: 'Quote Verify Admin', role: 'admin' };

(async () => {
  let created = null;
  let bookingId = null;

  try {
    // ── Setup: an enquiry with vehicle + driver assigned ───────────────────
    console.log('\n[1] Create enquiry, assign vehicle + driver');
    const driver = await prisma.driver.findFirst({
      where: { status: { not: 'inactive' } },
      orderBy: { driver_id: 'asc' },
    });
    if (!driver) throw new Error('No active driver available to test with');

    const vehicle = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: driver.current_vehicle_id },
    });
    if (!vehicle) throw new Error('Driver has no paired vehicle to test with');

    const { enquiry, accessToken } = await enquiryService.createEnquiry(
      {
        customer_name: 'Quote Verify Customer',
        customer_mobile: '9876500022',
        pickup_location: 'Patna',
        drop_location: 'Mumbai',
        material: 'Cement Bags',
        weight: 8000,
        weight_unit: 'KG',
        pickup_date: tomorrow(),
        pickup_time: '10:00',
        requested_vehicle_name: vehicle.vehicle_name || vehicle.vehicle_type,
        distance_km: 1211,
        pickup_latitude: 25.5941,
        pickup_longitude: 85.1376,
        drop_latitude: 19.076,
        drop_longitude: 72.8777,
      },
      {}
    );
    created = enquiry.enquiry_id;
    // The customer is a guest: every customer-scoped call is authorised by the
    // scoped access token minted at creation, exactly as the browser does.
    const ctx = { enquiryToken: accessToken.token };
    console.log(`   Enquiry ${enquiry.enquiry_number} (id ${created})`);

    await enquiryService.adminAssign(
      created,
      { vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id },
      admin
    );
    let row = await prisma.enquiry.findUnique({ where: { enquiry_id: created }, select: { status: true } });
    check('assignment moved status to DRIVER_ASSIGNED', row.status === 'DRIVER_ASSIGNED', row.status);

    // ── STEP 2: saving ₹60,000 marks the quote PREPARED ───────────────────
    console.log('\n[2] Admin enters Rs 60,000 and saves (Prepare Quote)');
    await enquiryService.adminSetQuote(created, { final_price: 60000, remarks: 'Internal rate note' }, admin);

    row = await prisma.enquiry.findUnique({
      where: { enquiry_id: created },
      select: { status: true, price_status: true, final_quoted_price: true },
    });
    check('DB status is now QUOTE_READY (quote prepared)', row.status === 'QUOTE_READY', row.status);
    check('DB price_status is QUOTED', row.price_status === 'QUOTED', row.price_status);
    check('DB final_quoted_price is 60000', Number(row.final_quoted_price) === 60000, String(row.final_quoted_price));

    // ── STEP 8: customer must NOT see the price yet ───────────────────────
    console.log('\n[3] Customer API BEFORE sending (draft must stay hidden)');
    let fresh = await enquiryService.loadForCustomer(created);
    let events = await eventService.listEvents(created, { customerVisibleOnly: true });
    let customerDto = toCustomerEnquiry(fresh, events);
    let summary = toCustomerEnquirySummary(fresh);

    check('customer status is QUOTE_READY', customerDto.status === 'QUOTE_READY', customerDto.status);
    check('customer CANNOT see final_quoted_price', customerDto.pricing.final_quoted_price === null, String(customerDto.pricing.final_quoted_price));
    check('customer CANNOT see internal quote_remarks', customerDto.pricing.quote_remarks === null, String(customerDto.pricing.quote_remarks));
    check('summary DTO also hides the price', summary.final_quoted_price === null, String(summary.final_quoted_price));
    // Raw event rows carry `event_type`; the customer DTO renames it to `type`.
    check('no draft quote event is customer-visible', !events.some((e) => e.event_type === 'QUOTE_CREATED'), events.map((e) => e.event_type).join(','));
    check('admin CAN still see the draft price', toAdminEnquiry(await enquiryService.loadForAdmin(created), []).quote.final_quoted_price === 60000);

    // Guard: sending without assignment must be refused
    console.log('\n[4] Guard: cannot send a quote with no assignment');
    const noAssign = await prisma.enquiry.create({
      data: {
        enquiry_number: `BTB-TEST-GUARD-${Date.now()}`,
        customer_name: 'Guard Test',
        customer_mobile: '9876500033',
        pickup_location: 'A', drop_location: 'B', material: 'X',
        pickup_date: new Date(), pickup_time: '10:00',
        final_quoted_price: 1000, price_status: 'QUOTED',
      },
    });
    try {
      await enquiryService.adminSendQuote(noAssign.enquiry_id, admin);
      check('send without assignment is refused', false, 'it succeeded!');
    } catch (err) {
      check('send without assignment is refused', /Assign/.test(err.message), err.message);
    }
    await prisma.enquiry.delete({ where: { enquiry_id: noAssign.enquiry_id } });

    // ── STEP 9/10: send the quote ──────────────────────────────────────────
    console.log('\n[5] Admin clicks "Send Quote to Customer"');
    const sent = await enquiryService.adminSendQuote(created, admin);
    check('service reports alreadySent=false on first send', sent.alreadySent === false);

    row = await prisma.enquiry.findUnique({
      where: { enquiry_id: created },
      select: { status: true, price_status: true, quoted_at: true, final_quoted_price: true },
    });
    check('DB status is AWAITING_CUSTOMER_ACCEPTANCE (quote sent)', row.status === 'AWAITING_CUSTOMER_ACCEPTANCE', row.status);
    check('DB price_status is SENT', row.price_status === 'SENT', row.price_status);
    check('DB quoted_at stamped', Boolean(row.quoted_at));
    check('final quote preserved through send', Number(row.final_quoted_price) === 60000);

    // ── Duplicate-send safety ──────────────────────────────────────────────
    console.log('\n[6] Duplicate send is safe (idempotent)');
    const again = await enquiryService.adminSendQuote(created, admin);
    check('second send returns alreadySent=true (no error)', again.alreadySent === true);
    const sendEvents = await eventService.listEvents(created, { customerVisibleOnly: true });
    const sentEvents = sendEvents.filter((e) => e.event_type === 'QUOTE_SENT');
    check('exactly ONE QUOTE_SENT event exists', sentEvents.length === 1, String(sentEvents.length));
    check('QUOTE_SENT message names the amount', /60,000/.test(sentEvents[0]?.message || ''), sentEvents[0]?.message);

    // ── STEP 11/12: customer now sees ₹60,000 ──────────────────────────────
    console.log('\n[7] Customer API AFTER sending');
    fresh = await enquiryService.loadForCustomer(created);
    events = await eventService.listEvents(created, { customerVisibleOnly: true });
    customerDto = toCustomerEnquiry(fresh, events);
    check('customer status is AWAITING_CUSTOMER_ACCEPTANCE', customerDto.status === 'AWAITING_CUSTOMER_ACCEPTANCE', customerDto.status);
    check('customer NOW sees final_quoted_price 60000', Number(customerDto.pricing.final_quoted_price) === 60000, String(customerDto.pricing.final_quoted_price));
    check('customer sees the QUOTE_SENT activity', events.some((e) => e.event_type === 'QUOTE_SENT'));
    check('customer DTO exposes the "sent to customer" message', customerDto.events.some((e) => e.type === 'QUOTE_SENT' && /60,000/.test(e.message)));

    // ── STEP 13: customer accepts ──────────────────────────────────────────
    console.log('\n[8] Customer clicks "Accept Quote"');
    const accepted = await enquiryService.customerAccept(created, ctx);
    check('accept returns a booking', Boolean(accepted.booking), accepted.booking?.booking_number);
    bookingId = accepted.booking?.booking_id;

    row = await prisma.enquiry.findUnique({
      where: { enquiry_id: created },
      select: { status: true, price_status: true, accepted_at: true, confirmed_at: true, booking_id: true },
    });
    check('DB status is CONFIRMED (accepted + confirmed)', row.status === 'CONFIRMED', row.status);
    check('DB price_status is ACCEPTED', row.price_status === 'ACCEPTED', row.price_status);
    check('DB accepted_at stamped', Boolean(row.accepted_at));
    check('DB booking linked', Boolean(row.booking_id), String(row.booking_id));

    const acceptEvents = await eventService.listEvents(created, { customerVisibleOnly: true });
    check('CUSTOMER_ACCEPTED activity recorded', acceptEvents.some((e) => e.event_type === 'CUSTOMER_ACCEPTED'));
    check('accept message names the amount', acceptEvents.some((e) => /60,000/.test(e.message)));

    // ── Accept is idempotent (double-click) ────────────────────────────────
    const acceptAgain = await enquiryService.customerAccept(created, ctx);
    check('repeat accept is idempotent (no 2nd booking)', acceptAgain.alreadyAccepted === true);
    const bookingCount = await prisma.booking.count({ where: { booking_id: bookingId } });
    check('still exactly one booking', bookingCount === 1, String(bookingCount));

    // ── Customer still sees the price after accepting ──────────────────────
    fresh = await enquiryService.loadForCustomer(created);
    customerDto = toCustomerEnquiry(fresh, []);
    check('customer still sees the accepted price', Number(customerDto.pricing.final_quoted_price) === 60000);

    // ── Cancel/reject guard: cannot reject after accepting ─────────────────
    console.log('\n[9] Guards after acceptance');
    try {
      await enquiryService.customerReject(created, ctx, { reason: 'too late' });
      check('reject after accept is refused', false, 'it succeeded!');
    } catch (err) {
      check('reject after accept is refused', true, err.message.slice(0, 60));
    }

    console.log(`\n${'='.repeat(62)}`);
    console.log(`RESULT: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(62));
  } catch (err) {
    failed += 1;
    console.error('\nERROR:', err.message);
    console.error(err.stack);
  } finally {
    if (created) {
      try {
        await prisma.enquiry.delete({ where: { enquiry_id: created } });
        console.log(`\nCleanup: deleted test enquiry #${created}`);
      } catch (e) {
        console.log(`\nCleanup failed for #${created}: ${e.message}`);
      }
    }
    await prisma.$disconnect();
  }

  process.exit(failed > 0 ? 1 : 0);
})();
