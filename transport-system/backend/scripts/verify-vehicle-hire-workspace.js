/**
 * scripts/verify-vehicle-hire-workspace.js
 * ---------------------------------------------------------------------------
 * END-TO-END VERIFICATION OF THE VEHICLE HIRE WORKSPACE, against the REAL local
 * database and the REAL service — the same `VehicleHireWorkflowService` the
 * /api/vehicle-hire routes call.
 *
 * WHAT IT PROVES
 *   1. Trip 2133 opens a complete hire context: real vehicle/document data, the
 *      customer resolved from its enquiry, and `can_hire`.
 *   2. The lookups return REAL vacant vehicles and drivers from the masters.
 *   3. `previewHire` writes nothing and returns gross / commission / net that
 *      satisfy gross − commission = net.
 *   4. `hireVehicle` on a THROWAWAY trip creates the hire, links vehicle + driver
 *      + vendor, moves the trip status, and writes a movement-history event.
 *   5. Re-opening the context returns the existing hire, and a second hire is
 *      refused — a duplicate `vehicle_hires` row is impossible.
 *   6. Editing goes through `updateVehicleHire` and still leaves exactly ONE row.
 *
 * WHY A THROWAWAY TRIP
 *   The hire flow WRITES. Trip 2133 is real data the operator is working on, so
 *   the mutating half of the test runs on a trip this script creates and then
 *   deletes. Trip 2133 itself is only ever READ here (context, lookups, preview),
 *   which is exactly what the page does before an operator presses HIRE VEHICLE.
 *   Nothing outside this script's own rows is modified, and the rows it creates
 *   are removed in `finally`.
 *
 * Run: node scripts/verify-vehicle-hire-workspace.js [tripId]
 * LOCAL ONLY.
 */

require('dotenv').config();

const { prisma } = require('../config/prisma');
const { VehicleHireWorkflowService } = require('../services/VehicleHireWorkflowService');

const REAL_TRIP_ID = Number.parseInt(process.argv[2] || '2133', 10);
const service = new VehicleHireWorkflowService(prisma);

let pass = 0;
let fail = 0;
let tempTripId = null;

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✔ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function head(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

async function run() {
  /* ══ 1. TRIP 2133 OPENS A COMPLETE HIRE CONTEXT ═════════════════════════ */
  head('1. Trip context (read-only)');

  const ctx = await service.getHireContext(REAL_TRIP_ID);
  check('trip found', Boolean(ctx?.trip), ctx?.trip?.trip_number);
  check('customer is resolved', Boolean(ctx?.customer?.name), `${ctx?.customer?.name} (via ${ctx?.customer?.source})`);
  check('hire is allowed', ctx?.can_hire === true, ctx?.blocked_reason || 'no blocker');
  check('no hire exists yet', !ctx?.existing_hire);
  check('document statuses are real', (ctx?.documents?.documents?.length || 0) > 0,
    `${ctx?.documents?.documents?.length} documents`);
  check('assignment starts empty', !ctx?.assignment?.vehicle_id && !ctx?.assignment?.driver_id);

  const cat = service.getCatalogue();
  check('catalogue offers billing parties', (cat.billing_to || []).length > 0,
    (cat.billing_to || []).map((o) => o.value).join(' / '));
  check('catalogue offers rate bases', (cat.rate_basis || []).length > 0,
    (cat.rate_basis || []).map((o) => `${o.value}:${o.mode}`).join(' / '));
  check('commission is CONTRACT for CONSIGNOR',
    cat.business_model_by_billing_to?.CONSIGNOR === 'CONTRACT');
  check('commission is COMMISSION for VEHICLE_VENDOR',
    cat.business_model_by_billing_to?.VEHICLE_VENDOR === 'COMMISSION');

  /* ══ 2. REAL VEHICLE + DRIVER LOOKUPS ══════════════════════════════════ */
  head('2. Vehicle / vendor / driver lookups (read-only)');

  const lookups = await service.getLookups({ search: '', limit: 25, tripId: REAL_TRIP_ID });
  const vehicles = lookups.vehicles || [];
  const drivers = lookups.drivers || [];
  check('vehicles returned from the master', vehicles.length > 0, `${vehicles.length} vehicles`);
  check('drivers returned from the master', drivers.length > 0, `${drivers.length} drivers`);
  check('vehicles carry availability labels',
    vehicles.some((v) => v.availability),
    [...new Set(vehicles.map((v) => v.availability).filter(Boolean))].join(','));

  // A vehicle is only hireable when it has an OWNER, because the vendor block and
  // the vendor money are read from that owner record. Several master rows are
  // owner-less test vehicles, so the selector walks the ranked list until it
  // finds a complete one — exactly the constraint the real form enforces.
  //
  // The walk also records the FIRST vehicle whose critical documents have
  // expired. That vehicle is kept aside to prove the document guard below, so
  // the rule is demonstrated rather than assumed.
  let vehicle = null;
  let detail = null;
  let expiredVehicle = null;
  let expiredDetail = null;

  for (const candidate of vehicles) {
    const d = await service.getVehicleDetail(candidate.vehicle_id);
    if (!d?.vendor?.owner_id || d.availability === 'UNAVAILABLE') continue;
    const expired = (d?.documents?.expired_critical || []).filter(Boolean);
    if (!expiredVehicle && expired.length) {
      expiredVehicle = candidate;
      expiredDetail = d;
    }
    if (!vehicle && !expired.length) {
      vehicle = candidate;
      detail = d;
    }
    if (vehicle && expiredVehicle) break;
  }

  check('an owner-linked vehicle with valid documents exists', Boolean(vehicle),
    vehicle ? `${vehicle.vehicle_number} (${vehicle.availability})` : 'none in the first 25');

  check('selected vehicle has real documents',
    (detail?.documents?.documents?.length || 0) > 0,
    `${detail?.documents?.documents?.length} docs, vendor ${detail?.vendor?.owner_name || '—'}`);
  check('vehicle is auto-populated from the master',
    Boolean(detail?.vehicle?.vehicle_number && detail?.vehicle?.vehicle_type),
    `${detail?.vehicle?.vehicle_number} · ${detail?.vehicle?.vehicle_type} · ${detail?.vehicle?.capacity_kg ? `${detail.vehicle.capacity_kg} kg` : detail?.vehicle?.body_type || ''}`);
  check('vendor + mobile come from the owner record',
    Boolean(detail?.vendor?.owner_name && detail?.vendor?.mobile),
    `${detail?.vendor?.owner_name} / ${detail?.vendor?.mobile}`);

  /* ══ 2b. THE EXPIRED-DOCUMENT GUARD ════════════════════════════════════ */
  head('2b. An expired critical document blocks the hire');

  if (expiredVehicle) {
    const expiredLabels = (expiredDetail.documents.expired_critical || [])
      .map((d) => d.label).join(', ');
    check('expired vehicle is reported as expired', Boolean(expiredLabels), expiredVehicle.vehicle_number);

    let blocked = false;
    let blockedMessage = '';
    try {
      await service.previewHire(REAL_TRIP_ID, {
        vehicle_id: expiredVehicle.vehicle_id,
        vendor_id: expiredDetail.vendor.owner_id,
        driver_id: drivers[0].driver_id,
        billing_to: 'VEHICLE_VENDOR',
        rate_basis: 'FIXED',
        rate_value: 42000,
        commission_type: 'PERCENTAGE',
        commission_rate: 5,
      });
    } catch (err) {
      blocked = true;
      blockedMessage = err.message;
    }
    check('the server REFUSES an expired vehicle', blocked, blockedMessage.slice(0, 100));

    // With the authorised acknowledgement it is allowed through — the operator
    // takes responsibility, and the acknowledgement is recorded on the hire.
    let acknowledged = null;
    try {
      acknowledged = await service.previewHire(REAL_TRIP_ID, {
        vehicle_id: expiredVehicle.vehicle_id,
        vendor_id: expiredDetail.vendor.owner_id,
        driver_id: drivers[0].driver_id,
        billing_to: 'VEHICLE_VENDOR',
        rate_basis: 'FIXED',
        rate_value: 42000,
        commission_type: 'PERCENTAGE',
        commission_rate: 5,
        documents_expired_ack: true,
      });
    } catch (err) {
      acknowledged = { error: err.message };
    }
    check('an authorised override can proceed', Boolean(acknowledged && acknowledged.gross_hire !== undefined),
      acknowledged?.error ? acknowledged.error.slice(0, 80) : `gross ₹${acknowledged.gross_hire}`);
  } else {
    console.log('  – no expired-document vehicle in the master; guard not exercised here');
  }

  const driver = drivers.find((d) => d.availability === 'AVAILABLE') || drivers[0];
  const driverDetail = await service.getDriverDetail(driver.driver_id);
  check('driver detail resolves mobile + vendor',
    Boolean(driverDetail?.driver?.driver_name),
    `${driverDetail?.driver?.driver_name} / ${driverDetail?.driver?.mobile}`);

  /* ══ 3. PREVIEW — THE ARITHMETIC, WRITING NOTHING ═══════════════════════ */
  head('3. Preview (Per Trip, 5% commission) — writes nothing');

  const hiresBefore = await prisma.vehicleHire.count();

  const preview = await service.previewHire(REAL_TRIP_ID, {
    vehicle_id: vehicle.vehicle_id,
    vendor_id: detail.vendor.owner_id,
    driver_id: driver.driver_id,
    billing_to: 'VEHICLE_VENDOR',
    rate_basis: cat.default_rate_basis || 'FIXED',
    rate_value: 42000,
    rate_quantity: null,
    commission_type: 'PERCENTAGE',
    commission_rate: 5,
  });
  check('gross hire', Number(preview.gross_hire) === 42000, `₹${preview.gross_hire}`);
  check('commission = 5% of gross', Number(preview.commission_amount) === 2100, `₹${preview.commission_amount}`);
  check('net = gross − commission',
    Number(preview.net_vendor_payable) === Number(preview.gross_hire) - Number(preview.commission_amount),
    `₹${preview.net_vendor_payable}`);
  check('business model derived from billing_to', preview.business_model === 'COMMISSION', preview.business_model);

  const perTon = await service.previewHire(REAL_TRIP_ID, {
    vehicle_id: vehicle.vehicle_id,
    vendor_id: detail.vendor.owner_id,
    driver_id: driver.driver_id,
    billing_to: 'VEHICLE_VENDOR',
    rate_basis: 'PER_TON',
    rate_value: 5000,
    rate_quantity: 8,
    commission_type: 'PERCENTAGE',
    commission_rate: 5,
  });
  check('per-ton gross = rate × quantity', Number(perTon.gross_hire) === 40000, `₹${perTon.gross_hire}`);
  check('per-ton net = gross − commission',
    Number(perTon.net_vendor_payable) === Number(perTon.gross_hire) - Number(perTon.commission_amount),
    `₹${perTon.net_vendor_payable}`);

  const noComm = await service.previewHire(REAL_TRIP_ID, {
    vehicle_id: vehicle.vehicle_id,
    vendor_id: detail.vendor.owner_id,
    driver_id: driver.driver_id,
    billing_to: 'VEHICLE_VENDOR',
    rate_basis: cat.default_rate_basis || 'FIXED',
    rate_value: 42000,
    commission_type: 'NO_COMMISSION',
    commission_rate: 0,
  });
  check('no commission ⇒ net equals gross',
    Number(noComm.commission_amount) === 0 && Number(noComm.net_vendor_payable) === Number(noComm.gross_hire),
    `gross ₹${noComm.gross_hire}, commission ₹${noComm.commission_amount}, net ₹${noComm.net_vendor_payable}`);

  const hiresAfterPreview = await prisma.vehicleHire.count();
  check('preview wrote nothing', hiresBefore === hiresAfterPreview, `${hiresBefore} → ${hiresAfterPreview}`);

  /* ══ 4. HIRE, ON A THROWAWAY TRIP ══════════════════════════════════════ */
  head('4. HIRE VEHICLE (throwaway trip — real writes, then removed)');

  tempTripId = await createThrowawayTrip();

  const hired = await service.hireVehicle(tempTripId, {
    vehicle_id: vehicle.vehicle_id,
    vendor_id: detail.vendor.owner_id,
    driver_id: driver.driver_id,
    billing_to: 'VEHICLE_VENDOR',
    rate_basis: 'FIXED',
    rate_value: 42000,
    commission_type: 'PERCENTAGE',
    commission_rate: 5,
    remarks: 'verification — removed afterwards',
  });

  const after = await prisma.trip.findUnique({
    where: { trip_id: tempTripId },
    select: { status: true, vehicle_id: true, driver_id: true, transport_owner_id: true },
  });
  check('VehicleHire created', Boolean(hired?.hire?.hire_id), hired?.hire?.challan_number);
  check('vehicle linked to trip', after.vehicle_id === vehicle.vehicle_id);
  check('driver linked to trip', after.driver_id === driver.driver_id);
  check('vendor linked to trip', after.transport_owner_id === detail.vendor.owner_id);
  check('trip status advanced', ['ASSIGNED', 'VEHICLE_HIRED'].includes(after.status), after.status);

  const h = hired.hire;
  check('gross hire stored', Number(h.gross_hire) === 42000, `₹${h.gross_hire}`);
  check('commission stored separately', Number(h.commission_amount) === 2100, `₹${h.commission_amount}`);
  check('net vendor payable stored', Number(h.net_vendor_payable) === 39900, `₹${h.net_vendor_payable}`);
  check('the three values stayed separate',
    Number(h.gross_hire) !== Number(h.net_vendor_payable)
    && Number(h.net_vendor_payable) === Number(h.gross_hire) - Number(h.commission_amount));

  const events = await prisma.tripTimeline.count({ where: { trip_id: tempTripId } });
  check('movement-history event written', events > 0, `${events} timeline entries`);

  /* ══ 5. REFRESH — THE HIRE REMAINS, AND CANNOT BE DUPLICATED ═══════════ */
  head('5. Refresh — existing hire loads, a second hire is refused');

  const reopened = await service.getHireContext(tempTripId);
  check('context returns the existing hire', Boolean(reopened?.existing_hire), reopened?.existing_hire?.challan_number);
  check('the trip is no longer hire-ready', reopened?.can_hire === false, reopened?.blocked_reason);

  let duplicateRefused = false;
  let duplicateMessage = '';
  try {
    await service.hireVehicle(tempTripId, {
      vehicle_id: vehicle.vehicle_id,
      vendor_id: detail.vendor.owner_id,
      driver_id: driver.driver_id,
      billing_to: 'VEHICLE_VENDOR',
      rate_basis: 'FIXED',
      rate_value: 42000,
      commission_type: 'PERCENTAGE',
      commission_rate: 5,
    });
  } catch (err) {
    duplicateRefused = true;
    duplicateMessage = err.message;
  }
  const countAfterDuplicate = await prisma.vehicleHire.count({ where: { trip_id: tempTripId } });
  check('a second hire is refused', duplicateRefused, duplicateMessage.slice(0, 90));
  check('still exactly ONE vehicle_hires row', countAfterDuplicate === 1, `${countAfterDuplicate} row(s)`);

  /* ══ 6. EDIT — UPDATES, NEVER ADDS ═════════════════════════════════════ */
  head('6. Edit the existing hire (change vehicle)');

  let otherVehicle = null;
  let otherDetail = null;
  for (const candidate of vehicles) {
    if (candidate.vehicle_id === vehicle.vehicle_id) continue;
    const d = await service.getVehicleDetail(candidate.vehicle_id);
    if (d?.vendor?.owner_id) {
      otherVehicle = candidate;
      otherDetail = d;
      break;
    }
  }
  if (otherVehicle) {
    const updated = await service.updateVehicleHire(tempTripId, {
      vehicle_id: otherVehicle.vehicle_id,
      vendor_id: otherDetail.vendor.owner_id,
      driver_id: driver.driver_id,
      billing_to: 'VEHICLE_VENDOR',
      rate_basis: 'FIXED',
      rate_value: 42000,
      commission_type: 'FIXED',
      commission_rate: 2000,
      change_reason: 'verification — breakdown',
    });
    const u = updated?.hire || updated;
    check('edit updated the same hire', Boolean(u?.hire_id) && u.challan_number === h.challan_number,
      `challan preserved: ${u?.challan_number}`);
    check('commission recalculated to the fixed amount', Number(u.commission_amount) === 2000, `₹${u.commission_amount}`);
    check('net = gross − fixed commission', Number(u.net_vendor_payable) === 40000, `₹${u.net_vendor_payable}`);

    const rowsAfterEdit = await prisma.vehicleHire.count({ where: { trip_id: tempTripId } });
    check('edit created no second row', rowsAfterEdit === 1, `${rowsAfterEdit} row(s)`);

    const history = await prisma.vehicleHireHistory.count({ where: { hire_id: h.hire_id } }).catch(() => 0);
    check('superseded vehicle kept in history', history > 0, `${history} history entr(y/ies)`);
  } else {
    console.log('  – only one vehicle in the master; edit-with-vehicle-change skipped');
  }

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`);
}

/** A trip of our own, so the mutating half of the test touches nothing real. */
async function createThrowawayTrip() {
  const trip = await prisma.trip.create({
    data: {
      trip_number: `VERIFY-VH-${Date.now()}`,
      status: 'PENDING',
      pickup_location: 'Patna',
      pickup_city: 'Patna',
      drop_location: 'Begusarai',
      drop_city: 'Begusarai',
      trip_date: new Date(),
      enquiry_id: 18,
      created_by: 'verify-vehicle-hire-workspace',
    },
  });
  return trip.trip_id;
}

async function cleanup() {
  if (!tempTripId) return;
  try {
    await prisma.vehicleHireHistory.deleteMany({ where: { hire: { trip_id: tempTripId } } });
    await prisma.vehicleHire.deleteMany({ where: { trip_id: tempTripId } });
    await prisma.tripTimeline.deleteMany({ where: { trip_id: tempTripId } });
    await prisma.trip.delete({ where: { trip_id: tempTripId } });
    console.log(`(throwaway trip ${tempTripId} and its hire removed)`);
  } catch (err) {
    console.log(`!! cleanup of trip ${tempTripId} failed: ${err.message}`);
  }
}

run()
  .catch((err) => {
    console.error('\nverification aborted:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
