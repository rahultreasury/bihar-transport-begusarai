/**
 * tmp-verify-assignment-sync.js
 * ---------------------------------------------------------------------------
 * End-to-end verification of the BACKEND -> CUSTOMER assignment sync.
 *
 * Runs the exact production flow against the real database:
 *   1. create an enquiry
 *   2. pick a real vehicle + driver (+ owner) from the live tables
 *   3. call the same service the admin "Assign Resources" button calls
 *   4. re-read the raw DB row              (persistence proof)
 *   5. shape the customer DTO              (API contract proof)
 *   6. assert the customer payload is safe (privacy proof)
 *   7. assert the timeline maps correctly  (UI mapping proof)
 *
 * Leaves no rows behind: the enquiry is deleted in `finally`.
 *
 * Run:  node tmp-verify-assignment-sync.js
 */

require('dotenv').config();

const { prisma } = require('./config/prisma');
// Both services export a ready-made singleton (the same instances the
// controllers use), so this exercises the production objects, not a fake.
const enquiryService = require('./services/EnquiryService');
const eventService = require('./services/EnquiryEventService');
const { toCustomerEnquiry } = require('./dtos/EnquiryDTO');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`   PASS  ${label}${detail ? ` -> ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

/** A pickup date the service will accept (tomorrow, UTC midnight). */
function tomorrow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

(async () => {
  let created = null;

  try {
    // ── 1. Create an enquiry ──────────────────────────────────────────────
    console.log('\n[1] Creating an enquiry (customer submits)...');
    const vehicleForLookup = await prisma.transportVehicle.findFirst({
      where: { current_status: { notIn: ['off_road', 'maintenance', 'scrapped'] } },
      select: { vehicle_id: true, vehicle_name: true, vehicle_type: true },
    });

    const { enquiry, accessToken } = await enquiryService.createEnquiry(
      {
        customer_name: 'Sync Verify Customer',
        customer_mobile: '9812345678',
        pickup_location: 'Patna',
        drop_location: 'Mumbai',
        material: 'Cement Bags',
        weight: 8000,
        weight_unit: 'KG',
        pickup_date: tomorrow(),
        pickup_time: '10:00',
        requested_vehicle_name: vehicleForLookup?.vehicle_name || '20ft Container',
        distance_km: 1211,
        pickup_latitude: 25.5941,
        pickup_longitude: 85.1376,
        drop_latitude: 19.076,
        drop_longitude: 72.8777,
      },
      {}
    );
    created = enquiry.enquiry_id;
    console.log(`   Enquiry ${enquiry.enquiry_number} created (id=${enquiry.enquiry_id})`);

    // ── 2. BEFORE assignment: the customer must see no assignment ─────────
    console.log('\n[2] Customer payload BEFORE assignment...');
    let fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);
    let events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });
    let dto = toCustomerEnquiry(fresh, events);
    check('status is ENQUIRY_SUBMITTED', dto.status === 'ENQUIRY_SUBMITTED', dto.status);
    check('assignment is null (nothing assigned yet)', dto.assignment === null);
    check('route/pickup/drop/distance preserved', Boolean(
      dto.route.pickup_location && dto.route.drop_location && dto.route.distance_km
    ), `${dto.route.pickup_location} -> ${dto.route.drop_location} (${dto.route.distance_km} km)`);

    // ── 3. Select real assignable resources ───────────────────────────────
    console.log('\n[3] Selecting a real vehicle + driver + owner from the database...');
    const driver = await prisma.driver.findFirst({
      where: { status: { not: 'inactive' } },
      orderBy: { driver_id: 'asc' },
      select: { driver_id: true, driver_name: true, mobile: true, transport_owner_id: true, partner_id: true, current_vehicle_id: true },
    });
    if (!driver) throw new Error('No active driver in the database to test with');

    // Prefer the driver's own paired vehicle so Rule 5 (coherence) passes.
    const vehicle = driver.current_vehicle_id
      ? await prisma.transportVehicle.findUnique({
          where: { vehicle_id: driver.current_vehicle_id },
          select: { vehicle_id: true, vehicle_number: true, vehicle_name: true, vehicle_type: true, capacity_kg: true, owner_id: true },
        })
      : await prisma.transportVehicle.findFirst({
          where: {
            current_status: { notIn: ['off_road', 'maintenance', 'scrapped'] },
            OR: [{ driver_id: null }, { driver_id: driver.driver_id }],
          },
          orderBy: { vehicle_id: 'asc' },
          select: { vehicle_id: true, vehicle_number: true, vehicle_name: true, vehicle_type: true, capacity_kg: true, owner_id: true },
        });

    if (!vehicle) throw new Error('No assignable vehicle in the database to test with');

    const owner = driver.transport_owner_id
      ? await prisma.vehicleOwner.findUnique({
          where: { owner_id: driver.transport_owner_id },
          select: { owner_id: true, owner_name: true, company_name: true, status: true, is_active: true, deleted_at: true },
        })
      : null;

    console.log(`   Vehicle #${vehicle.vehicle_id} ${vehicle.vehicle_number} (${vehicle.vehicle_name || vehicle.vehicle_type})`);
    console.log(`   Driver  #${driver.driver_id} ${driver.driver_name}`);
    console.log(`   Owner   ${owner ? `#${owner.owner_id} ${owner.company_name || owner.owner_name}` : '(none available)'}`);

    // ── 4. "Assign Resources" — the exact service call the admin button makes
    console.log('\n[4] Calling adminAssign() (what the "Assign Resources" button does)...');
    const admin = { adminId: null, adminName: 'Sync Verify Admin', role: 'admin' };
    const payload = { vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id };
    if (owner) payload.owner_id = owner.owner_id;

    const updated = await enquiryService.adminAssign(enquiry.enquiry_id, payload, admin);
    console.log(`   Assign returned status = ${updated.status}`);

    // ── 5. Re-read the RAW database row (bypasses every service/DTO layer)
    console.log('\n[5] Verifying the RAW database row...');
    const row = await prisma.enquiry.findUnique({
      where: { enquiry_id: enquiry.enquiry_id },
      select: {
        status: true,
        assigned_vehicle_id: true,
        assigned_driver_id: true,
        assigned_owner_id: true,
        assigned_vehicle_number: true,
        assigned_vehicle_type: true,
        assigned_driver_name: true,
        vehicle_assigned_at: true,
        driver_assigned_at: true,
      },
    });

    check('DB status is DRIVER_ASSIGNED', row.status === 'DRIVER_ASSIGNED', row.status);
    check('DB assigned_vehicle_id persisted', row.assigned_vehicle_id === vehicle.vehicle_id, String(row.assigned_vehicle_id));
    check('DB assigned_driver_id persisted', row.assigned_driver_id === driver.driver_id, String(row.assigned_driver_id));
    check('DB assigned_vehicle_number snapshot', row.assigned_vehicle_number === vehicle.vehicle_number, row.assigned_vehicle_number);
    check('DB assigned_vehicle_type snapshot', Boolean(row.assigned_vehicle_type), row.assigned_vehicle_type);
    check('DB assigned_driver_name snapshot', Boolean(row.assigned_driver_name), row.assigned_driver_name);
    check('DB vehicle_assigned_at stamped', Boolean(row.vehicle_assigned_at));
    check('DB driver_assigned_at stamped', Boolean(row.driver_assigned_at));
    if (owner) {
      check('DB assigned_owner_id persisted', row.assigned_owner_id === owner.owner_id, String(row.assigned_owner_id));
    }

    // ── 6. The customer payload (what GET /api/enquiries/:id returns) ──────
    console.log('\n[6] Customer API payload (GET /api/enquiries/:id)...');
    fresh = await enquiryService.loadForCustomer(enquiry.enquiry_id);
    events = await eventService.listEvents(enquiry.enquiry_id, { customerVisibleOnly: true });
    dto = toCustomerEnquiry(fresh, events);

    check('customer status is DRIVER_ASSIGNED', dto.status === 'DRIVER_ASSIGNED', dto.status);
    check('assignment block is present (was null before the fix)', dto.assignment !== null);
    if (dto.assignment) {
      check('vehicle_assigned flag true', dto.assignment.vehicle_assigned === true);
      check('driver_assigned flag true', dto.assignment.driver_assigned === true);
      check('vehicle_number returned', dto.assignment.vehicle_number === vehicle.vehicle_number, dto.assignment.vehicle_number);
      check('vehicle_type returned', Boolean(dto.assignment.vehicle_type), dto.assignment.vehicle_type);
      check('driver_name returned', dto.assignment.driver_name === driver.driver_name, dto.assignment.driver_name);
      check('vehicle_capacity_kg returned', dto.assignment.vehicle_capacity_kg === Number(vehicle.capacity_kg), String(dto.assignment.vehicle_capacity_kg));
    }
    check('route pickup/drop/distance still intact', Boolean(
      dto.route.pickup_location && dto.route.drop_location && dto.route.distance_km
    ), `${dto.route.pickup_location} -> ${dto.route.drop_location} (${dto.route.distance_km} km)`);
    check('map lat/lng still intact', dto.route.pickup_latitude != null && dto.route.drop_longitude != null);
    check('pickup date/time still intact', Boolean(dto.schedule.pickup_date && dto.schedule.pickup_time), `${dto.schedule.pickup_date} ${dto.schedule.pickup_time}`);
    check('progress_stage is 3 (assignment)', dto.progress_stage === 3, String(dto.progress_stage));

    // ── 7. Customer-safe data (STEP 8) ────────────────────────────────────
    console.log('\n[7] Customer-safety checks...');
    const serialised = JSON.stringify(dto);
    check("driver's MOBILE number is NOT in the payload", !serialised.includes(String(driver.mobile)));
    check('no internal notes in events', events.every((e) => e.customer_visible === true));
    check('no admin identity leaked', !serialised.includes('quotedByAdmin') && !serialised.includes('admin_id'));
    check('no internal pricing calc leaked', !serialised.includes('commission') && !serialised.includes('payout'));
    check('no partner internal data leaked', !serialised.includes('partner_code'));
    check('no raw event metadata leaked', !('metadata' in (dto.events[0] || {})));
    console.log(`   (event types visible to customer: ${[...new Set(dto.events.map((e) => e.type))].join(', ')})`);

    // ── 8. The status the frontend maps the timeline from ─────────────────
    // The timeline itself is an ES module and is verified separately in
    // tmp-verify-timeline.js; here we assert the backend value it maps from.
    console.log('\n[8] Status the customer timeline is driven by...');
    console.log(`   frontend buildTimeline("${dto.status}") is exercised in tmp-verify-timeline.js`);
    check('status is exactly DRIVER_ASSIGNED (the timeline key)', dto.status === 'DRIVER_ASSIGNED', dto.status);
    check('progress_stage is 3', dto.progress_stage === 3, String(dto.progress_stage));

    // ── 9. Reassignment path (admin changes resources) ────────────────────
    console.log('\n[9] Reassigning to the same resources is idempotent...');
    const again = await enquiryService.adminAssign(enquiry.enquiry_id, payload, admin);
    check('status stays DRIVER_ASSIGNED', again.status === 'DRIVER_ASSIGNED', again.status);

    // ── 10. Guest access token still works (access control unchanged) ─────
    console.log('\n[10] Access control unchanged...');
    check('guest access token was issued at creation', Boolean(accessToken && accessToken.token));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULT: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));
  } catch (err) {
    failed += 1;
    console.error('\nERROR during verification:', err.message);
    console.error(err.stack);
  } finally {
    if (created) {
      try {
        // EnquiryEvent rows cascade with the enquiry.
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
