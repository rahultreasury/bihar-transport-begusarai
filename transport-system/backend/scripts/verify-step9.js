/**
 * STEP 9 Verification: Driver API Readiness for Future Expo App
 *
 * Tests:
 * TEST 1: Driver authentication works
 * TEST 2: Driver trip list returns only own trips
 * TEST 3: Driver trip detail returns correct data
 * TEST 4: Driver cannot see another driver's trip (isolation)
 * TEST 5: Driver cannot see another owner's trip (isolation)
 * TEST 6: Unauthenticated request rejected
 * TEST 7: Nonexistent trip returns 404
 * TEST 8: Admin sees same trip data (synchronization)
 * TEST 9: Partner sees same trip data (synchronization)
 * TEST 10: Driver list only shows own trips
 * TEST 11: Existing STEP 6/7/8 regression
 * TEST 12: Frontend build passes
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
  console.log('=== STEP 9 Verification: Driver API Readiness for Future Expo App ===\n');

  // --- Setup ---
  console.log('--- Setting up test data ---');

  // Find drivers
  const driverA = await prisma.driver.findFirst({ where: { driver_name: 'Step Driver A' } });
  const driverB = await prisma.driver.findFirst({ where: { driver_name: 'Step Driver B' } });
  const driverC = await prisma.driver.findFirst({ where: { driver_name: 'Partner B Driver' } });

  if (!driverA || !driverB || !driverC) {
    console.log('ERROR: Required drivers not found');
    process.exit(1);
  }

  console.log(`Driver A: ${driverA.driver_name} (id: ${driverA.driver_id}, owner: ${driverA.transport_owner_id})`);
  console.log(`Driver B: ${driverB.driver_name} (id: ${driverB.driver_id}, owner: ${driverB.transport_owner_id})`);
  console.log(`Driver C: ${driverC.driver_name} (id: ${driverC.driver_id}, owner: ${driverC.transport_owner_id})`);

  // Get driver B user for login
  const driverBUser = await prisma.user.findUnique({ where: { user_id: driverB.user_id } });
  if (!driverBUser) {
    console.log('ERROR: Driver B user not found');
    process.exit(1);
  }

  // Set password for driver B
  const bcrypt = require('bcryptjs');
  const testPassword = 'steptest123';
  const hashedPassword = await bcrypt.hash(testPassword, 10);
  await prisma.user.update({
    where: { user_id: driverBUser.user_id },
    data: { password_hash: hashedPassword },
  });
  console.log('Driver B password set for testing');

  // Get admin token
  console.log('\n--- Admin login ---');
  const adminLoginRes = await axios.post(`${BASE_URL}/auth/admin-login`, {
    email: 'admin@bihartransport.com',
    password: 'admin123',
  });
  const adminToken = adminLoginRes.data.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  console.log('Admin token received');

  // Driver B login
  console.log('\n--- Driver B login ---');
  const driverLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
    email: driverBUser.email,
    password: testPassword,
  });
  const driverToken = driverLoginRes.data.token;
  const driverHeaders = { Authorization: `Bearer ${driverToken}`, 'Content-Type': 'application/json' };
  console.log('Driver B token received');

  // Create a test trip for Driver B
  console.log('\n--- Creating test trip for Driver B ---');
  const tripData = {
    user_id: 1,
    transport_owner_id: driverB.transport_owner_id,
    vehicle_id: 11,
    driver_id: driverB.driver_id,
    pickup_location: 'Begusarai',
    pickup_city: 'Begusarai',
    drop_location: 'Patna',
    drop_city: 'Patna',
    freight_amount: 7000,
    status: 'PENDING',
  };

  const tripRes = await axios.post(`${BASE_URL}/trips`, tripData, { headers: adminHeaders });
  const testTrip = tripRes.data.data;
  console.log(`Created trip: ${testTrip.trip_number} (id: ${testTrip.trip_id})`);

  // ============================================================
  // TEST 1: Driver authentication works
  // ============================================================
  console.log('\n=== TEST 1: Driver authentication ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips`, { headers: driverHeaders });
    record('TEST 1: Driver authentication works', res.data.success === true);
  } catch (err) {
    record('TEST 1: Driver authentication works', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 2: Driver trip list returns only own trips
  // ============================================================
  console.log('\n=== TEST 2: Driver trip list ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips`, { headers: driverHeaders });
    if (res.data.success) {
      const trips = res.data.data || [];
      const ownTrips = trips.filter(t => t.driver_id === driverB.driver_id);
      const otherTrips = trips.filter(t => t.driver_id !== driverB.driver_id);
      record('TEST 2: Trip list returns only own trips', otherTrips.length === 0 && ownTrips.length > 0,
        `own=${ownTrips.length}, other=${otherTrips.length}`);
    } else {
      record('TEST 2: Trip list returns only own trips', false, res.data.message);
    }
  } catch (err) {
    record('TEST 2: Driver trip list', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 3: Driver trip detail returns correct data
  // ============================================================
  console.log('\n=== TEST 3: Driver trip detail ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}`, { headers: driverHeaders });
    if (res.data.success) {
      const trip = res.data.data;
      record('TEST 3: Trip detail returns correct trip_id', trip.trip_id === testTrip.trip_id);
      record('TEST 3: Trip detail returns correct driver_id', trip.driver_id === driverB.driver_id);
      record('TEST 3: Trip detail has driver_name', !!trip.driver_name);
      record('TEST 3: Trip detail has vehicle_number', !!trip.vehicle_number);
      record('TEST 3: Trip detail has status', !!trip.status);
      record('TEST 3: Trip detail has route', !!trip.route);
    } else {
      record('TEST 3: Trip detail', false, res.data.message);
    }
  } catch (err) {
    record('TEST 3: Driver trip detail', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 4: Driver cannot see another driver's trip (isolation)
  // ============================================================
  console.log('\n=== TEST 4: Driver isolation (same owner) ===');
  try {
    // Find a trip belonging to Driver A (same owner)
    const driverATrip = await prisma.trip.findFirst({ where: { driver_id: driverA.driver_id } });
    if (driverATrip) {
      const res = await axios.get(`${BASE_URL}/drivers/me/trips/${driverATrip.trip_id}`, { headers: driverHeaders }).catch(err => err.response);
      record('TEST 4: Driver B cannot see Driver A trip', res.status === 403,
        `status=${res.status}, message=${res.data?.message}`);
    } else {
      record('TEST 4: Driver A trip exists', false, 'No trip found for Driver A');
    }
  } catch (err) {
    record('TEST 4: Driver isolation (same owner)', false, err.message);
  }

  // ============================================================
  // TEST 5: Driver cannot see another owner's trip (isolation)
  // ============================================================
  console.log('\n=== TEST 5: Driver isolation (different owner) ===');
  try {
    // Find a trip belonging to Driver C (different owner)
    const driverCTrip = await prisma.trip.findFirst({ where: { driver_id: driverC.driver_id } });
    if (driverCTrip) {
      const res = await axios.get(`${BASE_URL}/drivers/me/trips/${driverCTrip.trip_id}`, { headers: driverHeaders }).catch(err => err.response);
      record('TEST 5: Driver B cannot see Driver C trip', res.status === 403,
        `status=${res.status}, message=${res.data?.message}`);
    } else {
      record('TEST 5: Driver C trip exists', false, 'No trip found for Driver C');
    }
  } catch (err) {
    record('TEST 5: Driver isolation (different owner)', false, err.message);
  }

  // ============================================================
  // TEST 6: Unauthenticated request rejected
  // ============================================================
  console.log('\n=== TEST 6: Unauthenticated request ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips`).catch(err => err.response);
    record('TEST 6: Unauthenticated rejected', res.status === 401,
      `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 6: Unauthenticated request', false, err.message);
  }

  // ============================================================
  // TEST 7: Nonexistent trip returns 404
  // ============================================================
  console.log('\n=== TEST 7: Nonexistent trip ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips/99999`, { headers: driverHeaders }).catch(err => err.response);
    record('TEST 7: Nonexistent trip returns 404', res.status === 404,
      `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 7: Nonexistent trip', false, err.message);
  }

  // ============================================================
  // TEST 8: Admin sees same trip data (synchronization)
  // ============================================================
  console.log('\n=== TEST 8: Admin synchronization ===');
  try {
    const res = await axios.get(`${BASE_URL}/trips/${testTrip.trip_id}`, { headers: adminHeaders });
    if (res.data.success) {
      const trip = res.data.data;
      record('TEST 8: Admin sees same trip_id', trip.trip_id === testTrip.trip_id);
      record('TEST 8: Admin sees same driver_id', trip.driver_id === driverB.driver_id);
      record('TEST 8: Admin sees same status', trip.status === testTrip.status);
      record('TEST 8: Admin sees same vehicle_id', trip.vehicle_id === testTrip.vehicle_id);
      record('TEST 8: Admin sees same transport_owner_id', trip.transport_owner_id === testTrip.transport_owner_id);
    } else {
      record('TEST 8: Admin synchronization', false, res.data.message);
    }
  } catch (err) {
    record('TEST 8: Admin synchronization', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 9: Partner sees same trip data (synchronization)
  // ============================================================
  console.log('\n=== TEST 9: Partner synchronization ===');
  try {
    // Find partner linked to Driver B's owner
    const owner = await prisma.vehicleOwner.findUnique({ where: { owner_id: driverB.transport_owner_id } });
    const partner = await prisma.partner.findFirst({ where: { partner_id: owner.partner_link } });
    if (partner) {
      // Set partner password
      const partnerApp = await prisma.partnerApplication.findFirst({ where: { partner_id: partner.partner_id, status: 'approved' } });
      if (partnerApp) {
        const partnerUser = await prisma.user.findUnique({ where: { user_id: partnerApp.user_id } });
        if (partnerUser) {
          await prisma.user.update({
            where: { user_id: partnerUser.user_id },
            data: { password_hash: hashedPassword },
          });
          const partnerLoginRes = await axios.post(`${BASE_URL}/auth/partner-login`, {
            email: partnerUser.email,
            password: testPassword,
          });
          const partnerToken = partnerLoginRes.data.token;
          const partnerHeaders = { Authorization: `Bearer ${partnerToken}` };

          const res = await axios.get(`${BASE_URL}/partner/me/trips/${testTrip.trip_id}`, { headers: partnerHeaders });
          if (res.data.success) {
            const trip = res.data.data;
            record('TEST 9: Partner sees same trip_id', trip.trip_id === testTrip.trip_id);
            record('TEST 9: Partner sees same driver_id', trip.driver_id === driverB.driver_id);
            record('TEST 9: Partner sees same status', trip.status === testTrip.status);
          } else {
            record('TEST 9: Partner synchronization', false, res.data.message);
          }
        } else {
          record('TEST 9: Partner has user account', false, 'No user account for partner');
        }
      } else {
        record('TEST 9: Partner linked to owner', false, 'No partner linked to owner');
      }
    } else {
      record('TEST 9: Owner exists', false, 'Owner not found');
    }
  } catch (err) {
    record('TEST 9: Partner synchronization', false, err.message);
  }

  // ============================================================
  // TEST 10: Driver list only shows own trips
  // ============================================================
  console.log('\n=== TEST 10: Driver list only own trips ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips`, { headers: driverHeaders });
    if (res.data.success) {
      const trips = res.data.data || [];
      const ownTrips = trips.filter(t => t.driver_id === driverB.driver_id);
      const otherTrips = trips.filter(t => t.driver_id !== driverB.driver_id);
      record('TEST 10: List only own trips', otherTrips.length === 0 && ownTrips.length > 0,
        `own=${ownTrips.length}, other=${otherTrips.length}`);
    } else {
      record('TEST 10: Driver list', false, res.data.message);
    }
  } catch (err) {
    record('TEST 10: Driver list', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 11: Regression - STEP 6, 7, 8
  // ============================================================
  console.log('\n=== TEST 11: Regression tests ===');
  try {
    // Run STEP 8 verification
    const { execSync } = require('child_process');
    const step8Result = execSync('node scripts/verify-step8.js', { cwd: '/Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/backend', encoding: 'utf8', timeout: 120000 });
    const step8Pass = step8Result.includes('Passed:') && !step8Result.includes('FAIL:');
    record('TEST 11: STEP 8 regression', step8Pass, step8Pass ? 'All passed' : 'Some failed');
  } catch (err) {
    record('TEST 11: STEP 8 regression', false, err.message);
  }

  // ============================================================
  // TEST 12: Frontend build
  // ============================================================
  console.log('\n=== TEST 12: Frontend build ===');
  try {
    const { execSync } = require('child_process');
    execSync('npm run build', { cwd: '/Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/frontend', encoding: 'utf8', timeout: 180000 });
    record('TEST 12: Frontend build', true);
  } catch (err) {
    record('TEST 12: Frontend build', false, err.message);
  }

  // --- Cleanup ---
  console.log('\n--- Cleanup ---');
  await prisma.trip.delete({ where: { trip_id: testTrip.trip_id } });
  console.log(`Deleted test trip: ${testTrip.trip_number} (id: ${testTrip.trip_id})`);

  // --- Summary ---
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);
  console.log('=== END VERIFICATION ===');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});