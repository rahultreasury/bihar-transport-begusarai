/**
 * enquiry.flow.e2e.js
 * ---------------------------------------------------------------------------
 * END-TO-END verification of the enquiry lifecycle against a real PostgreSQL
 * database. Run manually against a scratch database — it creates and deletes
 * its own rows and never touches a production database.
 *
 *   DATABASE_URL=postgresql://<user>@localhost:5432/bt_enquiry_migtest \
 *     node tests/enquiry.flow.e2e.js
 *
 * It walks the exact business flow the feature promises:
 *
 *   1. Customer submits an enquiry with NO login        → enquiry + guest token
 *   2. Guest token authorises reading that enquiry      → no driver phone
 *   3. Guest token for enquiry A cannot read enquiry B  → 403
 *   4. Admin assigns a vehicle                          → status advances
 *   5. Admin assigns a driver                           → status advances
 *   6. Admin enters a final quote                       → price_status QUOTED
 *   7. Admin sends the quote                            → AWAITING_CUSTOMER_ACCEPTANCE
 *   8. Customer accepts                                 → Booking row created
 *   9. Driver details now visible, still no phone       → privacy holds
 *  10. Double-accept is idempotent                      → one booking only
 *  11. Driver requests reassignment                    → status unchanged
 *  12. Capacity rule rejects an undersized vehicle     → ValidationError
 *  13. Every step is in the audit trail
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-secret-only';
process.env.CUSTOMER_CARE_PHONE = process.env.CUSTOMER_CARE_PHONE || '9876543210';
process.env.CUSTOMER_CARE_WHATSAPP = process.env.CUSTOMER_CARE_WHATSAPP || '9876543210';

const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const enquiryService = require('../services/EnquiryService');
const eventService = require('../services/EnquiryEventService');
const { toCustomerEnquiry } = require('../dtos/EnquiryDTO');
const { toDriverEnquiry } = require('../dtos/EnquiryDTO');
const { verifyEnquiryAccessToken, issueEnquiryAccessToken } = require('../utils/EnquiryAccessToken');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

const ADMIN = { adminId: 0, adminName: 'E2E Admin' };
let runTag = 0;

async function main() {
  runTag = Date.now().toString().slice(-6);
  // A valid 10-digit Indian mobile: starts 6-9, then 9 more digits.
  const stamp = String(Date.now()).slice(-9);
  const mobile = `9${stamp}`;

  // ── Fixtures ────────────────────────────────────────────────────────────
  section('Seeding fixtures');

  const hash = await bcrypt.hash('e2e-password', 10);
  const customerUser = await prisma.user.create({
    data: {
      first_name: 'E2E',
      last_name: 'Customer',
      email: `e2e_customer_${runTag}@btb.local`,
      phone: mobile,
      password_hash: hash,
      role: 'customer',
    },
  });

  const admin = await prisma.admin.create({
    data: {
      username: `e2e_admin_${runTag}`,
      email: `e2e_admin_${runTag}@btb.local`,
      password_hash: hash,
      full_name: 'E2E Admin',
      role: 'admin',
    },
  });
  ADMIN.adminId = admin.admin_id;

  const owner = await prisma.vehicleOwner.create({
    data: {
      owner_name: `E2E Owner ${runTag}`,
      mobile: '9000000011',
      owner_type: 'TRANSPORT_COMPANY',
      status: 'active',
      is_active: true,
    },
  });

  const bigVehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `BR-E2E-${runTag}-1`,
      vehicle_type: 'TRUCK_17FT',
      vehicle_name: '17 ft Truck',
      capacity_kg: 12000,
      current_status: 'available',
      is_available: true,
      owner_id: owner.owner_id,
    },
  });

  const smallVehicle = await prisma.transportVehicle.create({
    data: {
      vehicle_number: `BR-E2E-${runTag}-2`,
      vehicle_type: 'TATA_ACE',
      vehicle_name: 'Tata Ace',
      capacity_kg: 750, // far too small for an 8-ton load
      current_status: 'available',
      is_available: true,
      owner_id: owner.owner_id,
    },
  });

  const driverUser = await prisma.user.create({
    data: {
      first_name: 'Raj',
      last_name: 'Kumar',
      email: `e2e_driver_${runTag}@btb.local`,
      phone: `97${String(Date.now()).slice(-8)}`,
      password_hash: hash,
      role: 'driver',
    },
  });

  const driver = await prisma.driver.create({
    data: {
      user_id: driverUser.user_id,
      driver_name: 'Raj Kumar',
      mobile: '9000000001',
      alternate_mobile: '9000000002',
      status: 'available',
      is_available: true,
      transport_owner_id: owner.owner_id,
      rating: 4.8,
    },
  });

  check('fixtures created', !!customerUser.user_id && !!admin.admin_id && !!driver.driver_id);

  // ── 1. Guest enquiry creation (NO LOGIN) ────────────────────────────────
  section('1. Customer submits an enquiry with no login');

  const pickup = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  pickup.setHours(0, 0, 0, 0);

  const { enquiry, accessToken } = await enquiryService.createEnquiry(
    {
      customer_name: 'Ramesh Kumar',
      customer_mobile: mobile,
      customer_email: 'ramesh@example.com',
      pickup_location: 'Patna',
      pickup_address: 'Kankarbagh, Patna',
      pickup_latitude: 25.5941,
      pickup_longitude: 85.1376,
      drop_location: 'Chandigarh',
      drop_latitude: 30.7333,
      drop_longitude: 76.7794,
      distance_km: 1211,
      requested_vehicle_name: '17 ft Truck',
      material: 'Cement Steel',
      quantity: 85,
      quantity_unit: 'Bundles',
      weight: 8,
      weight_unit: 'Tons',
      goods_category: 'Construction',
      fragile: false,
      pickup_date: pickup,
      pickup_time: '10:00:00',
      estimated_price_min: 54495,
      estimated_price_max: 66605,
    },
    { user: null, sessionKey: `e2e_${runTag}` }
  );

  check('enquiry created without any login', !!enquiry.enquiry_id);
  check(
    'enquiry number matches BTB-YYYYMMDD-NNNNNN',
    /^BTB-\d{8}-\d{6}$/.test(enquiry.enquiry_number),
    enquiry.enquiry_number
  );
  check('a guest access token was issued', !!accessToken?.token);
  check('customer_id is NULL for a guest', enquiry.customer_id === null);
  check('status starts at ENQUIRY_SUBMITTED', enquiry.status === 'ENQUIRY_SUBMITTED');

  // ── 2. Guest token authorises reading ───────────────────────────────────
  section('2. Guest token authorises reading that enquiry');

  const loaded = await enquiryService.loadForCustomer(enquiry.enquiry_id);
  const access = enquiryService.assertCustomerAccess(loaded, {
    user: null,
    enquiryToken: accessToken.token,
  });
  check('guest token grants access', access.isOwner === true && access.via === 'guest_token');

  const events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });
  check('ENQUIRY_CREATED audit event written', events.some((e) => e.event_type === 'ENQUIRY_CREATED'));
  check('customer timeline shows "Request received"',
    events.some((e) => /request received/i.test(e.message)));

  // ── 3. Cross-enquiry access is denied ───────────────────────────────────
  section('3. A token for enquiry A cannot authorise enquiry B');

  const other = await enquiryService.createEnquiry(
    {
      customer_name: 'Someone Else',
      customer_mobile: `8${String(Date.now()).slice(-9)}`,
      pickup_location: 'Gaya',
      drop_location: 'Kolkata',
      material: 'Rice',
      requested_vehicle_name: '10 ft Truck',
      pickup_date: pickup,
      pickup_time: '09:00:00',
    },
    { user: null }
  );

  let crossBlocked = false;
  try {
    const otherLoaded = await enquiryService.loadForCustomer(other.enquiry.enquiry_id);
    enquiryService.assertCustomerAccess(otherLoaded, {
      user: null,
      enquiryToken: accessToken.token,
    });
  } catch {
    crossBlocked = true;
  }
  check('cross-enquiry access is blocked', crossBlocked);

  let noTokenBlocked = false;
  try {
    enquiryService.assertCustomerAccess(loaded, { user: null, enquiryToken: null });
  } catch {
    noTokenBlocked = true;
  }
  check('no credential is blocked', noTokenBlocked);

  // ── 4-5. Admin assignment ───────────────────────────────────────────────
  section('4-5. Admin reviews, then assigns vehicle and driver');

  // Real admin sequence: open the request → "Start reviewing" → assign.
  const reviewing = await enquiryService.adminSetReviewStatus(
    enquiry.enquiry_id,
    'ADMIN_REVIEW',
    ADMIN
  );
  check('status advanced to ADMIN_REVIEW', reviewing.status === 'ADMIN_REVIEW');

  let rejected;
  try {
    rejected = await enquiryService.adminAssign(
      enquiry.enquiry_id,
      { vehicle_id: smallVehicle.vehicle_id, driver_id: driver.driver_id },
      ADMIN
    );
  } catch (err) {
    check('undersized vehicle is rejected (8 Tons vs 750 kg capacity)',
      /capacity/i.test(err.message), err.message);
  }
  if (rejected) check('undersized vehicle is rejected', false, 'no error thrown');

  const afterVehicle = await enquiryService.adminAssign(
    enquiry.enquiry_id,
    { vehicle_id: bigVehicle.vehicle_id },
    ADMIN
  );
  check('vehicle assignment succeeds', afterVehicle.assigned_vehicle_id === bigVehicle.vehicle_id);
  check('status advanced to VEHICLE_ASSIGNED', afterVehicle.status === 'VEHICLE_ASSIGNED');
  check('vehicle number snapshot stored', afterVehicle.assigned_vehicle_number === bigVehicle.vehicle_number);

  const afterDriver = await enquiryService.adminAssign(
    enquiry.enquiry_id,
    { driver_id: driver.driver_id },
    ADMIN
  );
  check('driver assignment succeeds', afterDriver.assigned_driver_id === driver.driver_id);
  check('status advanced to DRIVER_ASSIGNED', afterDriver.status === 'DRIVER_ASSIGNED');

  // Customer must NOT see the driver before accepting.
  const preAccept = toCustomerEnquiry(
    await enquiryService.loadForCustomer(enquiry.enquiry_id),
    []
  );
  check('driver details hidden before acceptance', preAccept.assignment === null);

  // ── 6-7. Quote then send ───────────────────────────────────────────────
  section('6-7. Admin quotes, then sends to customer');

  const quoted = await enquiryService.adminSetQuote(
    enquiry.enquiry_id,
    { final_price: 61000, remarks: 'Includes loading and unloading' },
    ADMIN
  );
  check('final quote saved', quoted.final_quoted_price === 61000);
  check('price_status is QUOTED', quoted.price_status === 'QUOTED');

  // The draft quote must not be visible to the customer yet.
  const draftEvents = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });
  check('draft quote is NOT on the customer timeline',
    !draftEvents.some((e) => e.event_type === 'QUOTE_CREATED'));

  const sent = await enquiryService.adminSendQuote(enquiry.enquiry_id, ADMIN);
  check('quote sent → AWAITING_CUSTOMER_ACCEPTANCE', sent.status === 'AWAITING_CUSTOMER_ACCEPTANCE');
  check('price_status is SENT', sent.price_status === 'SENT');
  check('quoted_at stamped', !!sent.quoted_at);
  check('quoted_by_admin_id stamped', sent.quoted_by_admin_id === admin.admin_id);

  // ── 8. Customer accepts → Booking created ──────────────────────────────
  section('8. Customer accepts the final quote');

  const acceptResult = await enquiryService.customerAccept(enquiry.enquiry_id, {
    user: null,
    enquiryToken: accessToken.token,
  });

  check('status is CONFIRMED', acceptResult.enquiry.status === 'CONFIRMED');
  check('accepted_at recorded', !!acceptResult.enquiry.accepted_at);
  check('price_status is ACCEPTED', acceptResult.enquiry.price_status === 'ACCEPTED');
  check('a Booking was created', !!acceptResult.booking?.booking_id);
  check('Booking number is canonical BTB-YYYY-NNNNN',
    /^BTB-\d{4}-\d{5}$/.test(acceptResult.booking?.booking_number || ''),
    acceptResult.booking?.booking_number);
  check('enquiry links to the booking', acceptResult.enquiry.booking_id === acceptResult.booking.booking_id);

  const bookingRow = await prisma.booking.findUnique({
    where: { booking_id: acceptResult.booking.booking_id },
  });
  check('Booking carries the final price', bookingRow.final_price === 61000);
  check('Booking quote_status is ACCEPTED', bookingRow.quote_status === 'ACCEPTED');
  check('Booking assigned the driver', bookingRow.driver_id === driver.driver_id);
  check('Booking assigned the vehicle', bookingRow.vehicle_id === bigVehicle.vehicle_id);
  check('Booking confirmation_source is CUSTOMER', bookingRow.confirmation_source === 'CUSTOMER');

  // The guest is now bound to a real account.
  const linked = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
  check('guest enquiry linked to a user account', !!linked.customer_id);

  // ── 9. Driver visible, phone still hidden ───────────────────────────────
  section('9. Driver visible after acceptance — phone still hidden');

  const postAccept = toCustomerEnquiry(
    await enquiryService.loadForCustomer(enquiry.enquiry_id),
    []
  );
  check('driver details now visible', !!postAccept.assignment);
  check('driver NAME visible', postAccept.assignment?.driver_name === 'Raj Kumar');
  check('vehicle NUMBER visible', postAccept.assignment?.vehicle_number === bigVehicle.vehicle_number);

  const customerJson = JSON.stringify(postAccept);
  check('driver mobile NOT in customer payload', !customerJson.includes('9000000001'));
  check('driver alternate_mobile NOT in customer payload', !customerJson.includes('9000000002'));
  check('customer has a contact route', !!postAccept.contact?.whatsappUrl);

  // The DRIVER's own view must not leak the customer or the price.
  const driverView = toDriverEnquiry(
    await prisma.enquiry.findUnique({
      where: { enquiry_id: enquiry.enquiry_id },
      include: { customer: { select: { first_name: true } } },
    })
  );
  const driverJson = JSON.stringify(driverView);
  check('driver payload has no final price', !driverJson.includes('61000'));
  check('driver payload has no customer mobile', !driverJson.includes(mobile));

  // ── 10. Double accept is idempotent ─────────────────────────────────────
  section('10. Double-accept cannot create two bookings');

  // Count BEFORE the second accept. The correct outcome is that the count does
  // not change — a repeat tap must never mint a second Booking.
  const bookingCountBefore = await prisma.booking.count({
    where: { user_id: linked.customer_id },
  });
  const second = await enquiryService.customerAccept(enquiry.enquiry_id, {
    user: null,
    enquiryToken: accessToken.token,
  });
  const bookingCountAfter = await prisma.booking.count({
    where: { user_id: linked.customer_id },
  });
  check('second accept is a no-op', second.alreadyAccepted === true);
  check('exactly one booking exists for this customer', bookingCountBefore === 1,
    `found ${bookingCountBefore}`);
  check('no duplicate booking created', bookingCountAfter === bookingCountBefore,
    `before=${bookingCountBefore} after=${bookingCountAfter}`);

  // ── 11. Driver cannot cancel; can only request reassignment ─────────────
  section('11. Driver requests reassignment (no direct cancel)');

  const beforeStatus = (await prisma.enquiry.findUnique({
    where: { enquiry_id: enquiry.enquiry_id },
  })).status;

  const reqResult = await enquiryService.driverRequestReassignment(
    enquiry.enquiry_id,
    { driverId: driver.driver_id, driverName: 'Raj Kumar' },
    { reason: 'Vehicle breakdown', category: 'VEHICLE' }
  );
  check('reassignment request recorded', !!reqResult.event);

  const afterRequest = await prisma.enquiry.findUnique({
    where: { enquiry_id: enquiry.enquiry_id },
  });
  check('STATUS UNCHANGED after a driver request', afterRequest.status === beforeStatus,
    `${beforeStatus} → ${afterRequest.status}`);
  check('driver is still assigned', afterRequest.assigned_driver_id === driver.driver_id);

  let wrongDriverBlocked = false;
  try {
    await enquiryService.driverRequestReassignment(
      enquiry.enquiry_id,
      { driverId: 999999, driverName: 'Impostor' },
      { reason: 'x' }
    );
  } catch {
    wrongDriverBlocked = true;
  }
  check('a non-assigned driver cannot request changes', wrongDriverBlocked);

  // ── 13. Audit trail completeness ────────────────────────────────────────
  section('13. Audit trail is complete');

  const allEvents = await eventService.listEvents(enquiry.enquiry_id);
  const types = new Set(allEvents.map((e) => e.event_type));
  for (const expected of [
    'ENQUIRY_CREATED',
    'VEHICLE_ASSIGNED',
    'DRIVER_ASSIGNED',
    'QUOTE_SENT',
    'CUSTOMER_ACCEPTED',
    'BOOKING_CREATED',
    'DRIVER_REASSIGNMENT_REQUESTED',
  ]) {
    check(`audit contains ${expected}`, types.has(expected));
  }
  check('audit events are actor-attributed', allEvents.every((e) => !!e.actor_type));

  // Reassignment request must be internal (customer must not see it).
  const customerVisibleTypes = new Set(
    (await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true })).map((e) => e.event_type)
  );
  check('driver request is hidden from the customer',
    !customerVisibleTypes.has('DRIVER_REASSIGNMENT_REQUESTED'));

  // ── 13b. Customer cancel rules ──────────────────────────────────────────
  section('13b. Customer self-cancel is blocked after confirmation');

  let cancelBlocked = false;
  try {
    await enquiryService.customerCancel(
      enquiry.enquiry_id,
      { user: null, enquiryToken: accessToken.token },
      { reason: 'test' }
    );
  } catch {
    cancelBlocked = true;
  }
  check('customer cannot self-cancel a confirmed trip', cancelBlocked);

  // ── 13c. Admin CAN cancel ───────────────────────────────────────────────
  const cancelled = await enquiryService.adminCancel(
    enquiry.enquiry_id,
    ADMIN,
    { reason: 'Vehicle off-road' }
  );
  check('admin CAN cancel a confirmed trip', cancelled.enquiry.status === 'CANCELLED');

  // ── Cleanup ─────────────────────────────────────────────────────────────
  section('Cleanup');
  await prisma.enquiryEvent.deleteMany({ where: { enquiry_id: { in: [enquiry.enquiry_id, other.enquiry.enquiry_id] } } });
  await prisma.enquiry.deleteMany({ where: { enquiry_id: { in: [enquiry.enquiry_id, other.enquiry.enquiry_id] } } });
  await prisma.bookingAssignment.deleteMany({ where: { booking_id: acceptResult.booking.booking_id } });
  await prisma.delivery.deleteMany({ where: { booking_id: acceptResult.booking.booking_id } });
  await prisma.bookingEvent.deleteMany({ where: { booking_id: acceptResult.booking.booking_id } });
  await prisma.booking.deleteMany({ where: { booking_id: acceptResult.booking.booking_id } });
  await prisma.driver.deleteMany({ where: { driver_id: driver.driver_id } });
  await prisma.user.deleteMany({ where: { user_id: { in: [customerUser.user_id, driverUser.user_id] } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: [bigVehicle.vehicle_id, smallVehicle.vehicle_id] } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: owner.owner_id } });
  await prisma.admin.deleteMany({ where: { admin_id: admin.admin_id } });
  check('test rows cleaned up', true);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  E2E RESULT: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(52));
}

main()
  .catch((err) => {
    console.error('\nE2E RUN FAILED:', err);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
