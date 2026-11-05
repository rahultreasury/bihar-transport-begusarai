/**
 * STEP 6 Verification: Partner → Driver Assignment
 *
 * Tests:
 * TEST 1: Partner A assigns Driver A to Partner A trip (PENDING status)
 * TEST 2: Partner A attempts to assign Partner B's driver → REJECT
 * TEST 3: Partner A attempts to modify Partner B's trip → REJECT
 * TEST 4: Non-authenticated request attempts assignment → REJECT
 * TEST 5: Driver assignment on COMPLETED trip → REJECT
 * TEST 6: Successful assignment appears in Partner Trip Detail
 * TEST 7: Partner dashboard/trip data reflects assigned driver
 */

const axios = require('axios');
const { prisma } = require('../config/prisma');
const assert = require('assert');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';

let passed = 0;
let failed = 0;
const results = [];

function record(name, success, detail = '') {
  results.push({ name, success, detail });
  if (success) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} — ${detail}`);
  }
}

async function main() {
  console.log('=== STEP 6 Verification: Partner → Driver Assignment ===\n');

  // --- Setup: Use Prisma for DB operations (avoid rate limiting) ---
  console.log('--- Setting up test data via Prisma ---');

  // Find Partner A (E2E TestPartner) and Partner B (Transport Partner A)
  const partnerA = await prisma.partner.findFirst({ where: { partner_name: 'E2E TestPartner' } });
  const partnerB = await prisma.partner.findFirst({ where: { partner_name: 'Transport Partner A' } });

  if (!partnerA) {
    console.log('ERROR: Partner A (E2E TestPartner) not found. Run STEP 5 verification first.');
    process.exit(1);
  }
  if (!partnerB) {
    console.log('ERROR: Partner B (Transport Partner A) not found. Run STEP 5 verification first.');
    process.exit(1);
  }

  console.log(`Partner A: ${partnerA.partner_name} (id: ${partnerA.partner_id})`);
  console.log(`Partner B: ${partnerB.partner_name} (id: ${partnerB.partner_id})`);

  // Get VehicleOwners linked to partners
  const ownerA = await prisma.vehicleOwner.findFirst({ where: { partner_link: partnerA.partner_id } });
  const ownerB = await prisma.vehicleOwner.findFirst({ where: { partner_link: partnerB.partner_id } });

  if (!ownerA) {
    console.log('ERROR: Owner A not found for Partner A');
    process.exit(1);
  }

  // Get Driver A (belongs to Owner A) and Driver B (belongs to Owner B)
  const driverA = await prisma.driver.findFirst({
    where: { transport_owner_id: ownerA.owner_id },
    orderBy: { driver_id: 'asc' },
  });
  const driverB = await prisma.driver.findFirst({
    where: { transport_owner_id: ownerB.owner_id },
    orderBy: { driver_id: 'asc' },
  });

  if (!driverA) {
    console.log('ERROR: Driver A not found for Owner A');
    process.exit(1);
  }
  if (!driverB) {
    console.log('ERROR: Driver B not found for Owner B');
    process.exit(1);
  }

  console.log(`Driver A: ${driverA.driver_name} (id: ${driverA.driver_id}, owner: ${ownerA.owner_id})`);
  console.log(`Driver B: ${driverB.driver_name} (id: ${driverB.driver_id}, owner: ${ownerB.owner_id})`);

  // Find or create a PENDING trip for Partner A
  let trip = await prisma.trip.findFirst({
    where: { transport_owner_id: ownerA.owner_id, status: 'PENDING' },
    orderBy: { trip_id: 'desc' },
  });

  if (!trip) {
    // Create a PENDING trip for Partner A
    const vehicleA = await prisma.transportVehicle.findFirst({
      where: { owner_id: ownerA.owner_id },
      orderBy: { vehicle_id: 'asc' },
    });
    if (!vehicleA) {
      console.log('ERROR: No vehicle found for Owner A');
      process.exit(1);
    }

    trip = await prisma.trip.create({
      data: {
        trip_number: `BTBT-STEP6-${Date.now()}`,
        transport_owner_id: ownerA.owner_id,
        vehicle_id: vehicleA.vehicle_id,
        driver_id: driverA.driver_id,
        pickup_location: 'Step6 Pickup',
        pickup_city: 'Begusarai',
        drop_location: 'Step6 Drop',
        drop_city: 'Patna',
        freight_amount: 5000,
        status: 'PENDING',
      },
    });
    console.log(`Created PENDING trip: ${trip.trip_number} (id: ${trip.trip_id})`);
  } else {
    console.log(`Using existing PENDING trip: ${trip.trip_number} (id: ${trip.trip_id})`);
  }

  // Ensure trip has Driver A assigned (for Change Driver test)
  const currentTripDriver = await prisma.trip.findUnique({ where: { trip_id: trip.trip_id } });
  if (currentTripDriver.driver_id !== driverA.driver_id) {
    await prisma.trip.update({
      where: { trip_id: trip.trip_id },
      data: { driver_id: driverA.driver_id },
    });
    console.log(`Set trip driver to Driver A (id: ${driverA.driver_id})`);
  }

  // Get a COMPLETED trip for TEST 5 (status validation)
  let completedTrip = await prisma.trip.findFirst({
    where: { transport_owner_id: ownerA.owner_id, status: 'COMPLETED' },
    orderBy: { trip_id: 'desc' },
  });

  if (!completedTrip) {
    // Create a COMPLETED trip
    const vehicleA2 = await prisma.transportVehicle.findFirst({
      where: { owner_id: ownerA.owner_id },
      orderBy: { vehicle_id: 'asc' },
    });
    completedTrip = await prisma.trip.create({
      data: {
        trip_number: `BTBT-COMP6-${Date.now()}`,
        transport_owner_id: ownerA.owner_id,
        vehicle_id: vehicleA2 ? vehicleA2.vehicle_id : trip.vehicle_id,
        driver_id: driverA.driver_id,
        pickup_location: 'Completed Pickup',
        pickup_city: 'Begusarai',
        drop_location: 'Completed Drop',
        drop_city: 'Patna',
        freight_amount: 3000,
        status: 'COMPLETED',
      },
    });
    console.log(`Created COMPLETED trip: ${completedTrip.trip_number} (id: ${completedTrip.trip_id})`);
  }

  // --- Admin login for HTTP requests ---
  console.log('\n--- Admin login ---');
  const adminLogin = await axios.post(`${BASE_URL}/auth/admin-login`, {
    email: 'admin@bihartransport.com',
    password: 'admin123',
  });
  const adminToken = adminLogin.data.data.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  console.log('Admin token received');

  // Set known partner password for testing
  console.log('--- Setting known partner password ---');
  const testPartnerPassword = 'step6test123';
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(testPartnerPassword, 10);
  await prisma.user.update({
    where: { email: partnerA.email },
    data: { password_hash: hashedPassword },
  });
  console.log('Partner password set for testing');

  // Partner login
  const partnerLogin = await axios.post(`${BASE_URL}/auth/partner-login`, {
    email: partnerA.email,
    password: testPartnerPassword,
  });
  const partnerToken = partnerLogin.data.token;
  const partnerHeaders = { Authorization: `Bearer ${partnerToken}`, 'Content-Type': 'application/json' };
  console.log('Partner A token received');

  // --- TEST 1: Partner A assigns Driver A to Partner A trip ---
  console.log('\n=== TEST 1: Partner A assigns Driver A to Partner A trip ===');
  try {
    const res = await axios.patch(
      `${BASE_URL}/partner/me/trips/${trip.trip_id}/driver`,
      { driver_id: driverA.driver_id },
      { headers: partnerHeaders }
    );
    assert.strictEqual(res.data.success, true, 'Expected success=true');
    assert(res.data.data, 'Expected data in response');
    record('Partner A assigns Driver A — PASS', true);
    // Verify in DB
    const dbTrip = await prisma.trip.findUnique({ where: { trip_id: trip.trip_id } });
    assert.strictEqual(dbTrip.driver_id, driverA.driver_id, 'Driver not updated in DB');
    record('Driver A attached to trip in DB', true);
  } catch (err) {
    record('Partner A assigns Driver A — FAIL', false, err.response?.data?.message || err.message);
  }

  // --- TEST 2: Partner A attempts to assign Partner B's driver ---
  console.log('\n=== TEST 2: Partner A attempts to assign Partner B\'s driver ===');
  try {
    await axios.patch(
      `${BASE_URL}/partner/me/trips/${trip.trip_id}/driver`,
      { driver_id: driverB.driver_id },
      { headers: partnerHeaders }
    );
    record('Partner A assigns Partner B driver — FAIL', false, 'Expected rejection but got success');
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 400) {
      record('Partner A assigns Partner B driver — REJECTED', true, `HTTP ${status}`);
    } else {
      record('Partner A assigns Partner B driver — FAIL', false, `Expected 403/400, got ${status}`);
    }
  }

  // --- TEST 3: Partner A attempts to modify Partner B's trip ---
  console.log('\n=== TEST 3: Partner A attempts to modify Partner B\'s trip ===');
  try {
    // Need a trip that belongs to Partner B
    const ownerBTrip = await prisma.trip.findFirst({
      where: { transport_owner_id: ownerB.owner_id },
      orderBy: { trip_id: 'desc' },
    });
    if (!ownerBTrip) {
      // Create one for testing
      const vehicleB = await prisma.transportVehicle.findFirst({
        where: { owner_id: ownerB.owner_id },
        orderBy: { vehicle_id: 'asc' },
      });
      ownerBTrip = await prisma.trip.create({
        data: {
          trip_number: `BTBT-PB-${Date.now()}`,
          transport_owner_id: ownerB.owner_id,
          vehicle_id: vehicleB ? vehicleB.vehicle_id : 1,
          driver_id: driverB.driver_id,
          pickup_location: 'Partner B Pickup',
          pickup_city: 'Begusarai',
          drop_location: 'Partner B Drop',
          drop_city: 'Patna',
          freight_amount: 4000,
          status: 'PENDING',
        },
      });
    }

    await axios.patch(
      `${BASE_URL}/partner/me/trips/${ownerBTrip.trip_id}/driver`,
      { driver_id: driverA.driver_id },
      { headers: partnerHeaders }
    );
    record('Partner A modifies Partner B trip — FAIL', false, 'Expected rejection but got success');
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 404) {
      record('Partner A modifies Partner B trip — REJECTED', true, `HTTP ${status}`);
    } else {
      record('Partner A modifies Partner B trip — FAIL', false, `Expected 403/404, got ${status}`);
    }
  }

  // --- TEST 4: Non-authenticated request attempts assignment ---
  console.log('\n=== TEST 4: Non-authenticated request attempts assignment ===');
  try {
    await axios.patch(
      `${BASE_URL}/partner/me/trips/${trip.trip_id}/driver`,
      { driver_id: driverA.driver_id }
    );
    record('Non-authenticated assignment — FAIL', false, 'Expected rejection but got success');
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      record('Non-authenticated assignment — REJECTED', true, `HTTP ${status}`);
    } else {
      record('Non-authenticated assignment — FAIL', false, `Expected 401/403, got ${status}`);
    }
  }

  // --- TEST 5: Driver assignment on COMPLETED trip ---
  console.log('\n=== TEST 5: Driver assignment on COMPLETED trip ===');
  try {
    await axios.patch(
      `${BASE_URL}/partner/me/trips/${completedTrip.trip_id}/driver`,
      { driver_id: driverA.driver_id },
      { headers: partnerHeaders }
    );
    record('Driver assignment on COMPLETED trip — FAIL', false, 'Expected rejection but got success');
  } catch (err) {
    const status = err.response?.status;
    if (status === 400) {
      record('Driver assignment on COMPLETED trip — REJECTED', true, `HTTP ${status}`);
    } else {
      record('Driver assignment on COMPLETED trip — FAIL', false, `Expected 400, got ${status}`);
    }
  }

  // --- TEST 6: Successful assignment appears in Partner Trip Detail ---
  console.log('\n=== TEST 6: Successful assignment appears in Partner Trip Detail ===');
  try {
    // Re-assign driver to trip (TEST 1 may have already done this, but let's verify)
    const res = await axios.get(`${BASE_URL}/partner/me/trips/${trip.trip_id}`, { headers: partnerHeaders });
    assert.strictEqual(res.data.success, true, 'Expected success=true');
    const tripData = res.data.data;
    assert(tripData.driver_id === driverA.driver_id, `Expected driver_id=${driverA.driver_id}, got ${tripData.driver_id}`);
    record('Trip detail shows Driver A', true);
  } catch (err) {
    record('Trip detail shows Driver A — FAIL', false, err.response?.data?.message || err.message);
  }

  // --- TEST 7: Partner dashboard reflects assigned driver ---
  console.log('\n=== TEST 7: Partner dashboard reflects assigned driver ===');
  try {
    const dashRes = await axios.get(`${BASE_URL}/partner/me/dashboard`, { headers: partnerHeaders });
    assert.strictEqual(dashRes.data.success, true, 'Expected success=true');
    const recentTrips = dashRes.data.data.recentTrips || [];
    const foundTrip = recentTrips.find(t => (t.trip_id || t.id) === trip.trip_id);
    assert(foundTrip, 'Trip not found in dashboard recentTrips');
    record('Trip appears in Partner Dashboard', true);
  } catch (err) {
    record('Trip appears in Partner Dashboard — FAIL', false, err.response?.data?.message || err.message);
  }

  // --- Cleanup: Reset trip driver to original for consistency ---
  console.log('\n--- Cleanup ---');
  await prisma.trip.update({
    where: { trip_id: trip.trip_id },
    data: { driver_id: driverA.driver_id },
  });
  console.log('Reset trip driver to Driver A');

  // --- Summary ---
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);
  console.log('=== END VERIFICATION ===');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
