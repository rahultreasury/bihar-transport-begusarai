/**
 * STEP 10 Verification: Driver Trip Status Workflow
 *
 * Tests:
 * TEST 1: Driver authentication
 * TEST 2: Driver can update own Trip status (valid transition)
 * TEST 3: Driver cannot update another driver's Trip (isolation)
 * TEST 4: Driver cannot update another owner's Trip (isolation)
 * TEST 5: Unauthenticated request rejected
 * TEST 6: Nonexistent Trip rejected
 * TEST 6: Invalid status rejected
 * TEST 7: Invalid transition rejected (COMPLETED when customer due > 0)
 * TEST 8: Admin sees updated status (synchronization)
 * TEST 9: Partner sees updated status (synchronization)
 * TEST 10: Driver sees updated status (synchronization)
 * TEST 11: Legacy Booking status endpoint still works
 * TEST 12: STEP 9 regression
 * TEST 13: Frontend build
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
  console.log('=== STEP 10 Verification: Driver Trip Status Workflow ===\n');

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
  // TEST 1: Driver authentication
  // ============================================================
  console.log('\n=== TEST 1: Driver authentication ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips`, { headers: driverHeaders });
    record('TEST 1: Driver authentication works', res.data.success === true);
  } catch (err) {
    record('TEST 1: Driver authentication works', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 2: Driver can update own Trip status (valid transition)
  // ============================================================
  console.log('\n=== TEST 2: Driver updates own Trip status ===');
  try {
    const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}/status`, { status: 'ASSIGNED' }, { headers: driverHeaders });
    if (res.data.success) {
      record('TEST 2: Valid transition PENDING → ASSIGNED', res.data.data.status === 'ASSIGNED');
      record('TEST 2: Response has correct trip_id', res.data.data.trip_id === testTrip.trip_id);
      record('TEST 2: Response has correct driver_id', res.data.data.driver_id === driverB.driver_id);
    } else {
      record('TEST 2: Valid transition', false, res.data.message);
    }
  } catch (err) {
    record('TEST 2: Valid transition', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 3: Driver cannot update another driver's Trip (same owner)
  // ============================================================
  console.log('\n=== TEST 3: Driver isolation (same owner) ===');
  try {
    const driverATrip = await prisma.trip.findFirst({ where: { driver_id: driverA.driver_id } });
    if (driverATrip) {
      const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${driverATrip.trip_id}/status`, { status: 'ASSIGNED' }, { headers: driverHeaders }).catch(err => err.response);
      record('TEST 3: Driver B cannot update Driver A trip', res.status === 403, `status=${res.status}, message=${res.data?.message}`);
    } else {
      record('TEST 3: Driver A trip exists', false, 'No trip found for Driver A');
    }
  } catch (err) {
    record('TEST 3: Driver isolation (same owner)', false, err.message);
  }

  // ============================================================
  // TEST 4: Driver cannot update another owner's Trip
  // ============================================================
  console.log('\n=== TEST 4: Driver isolation (different owner) ===');
  try {
    const driverCTrip = await prisma.trip.findFirst({ where: { driver_id: driverC.driver_id } });
    if (driverCTrip) {
      const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${driverCTrip.trip_id}/status`, { status: 'ASSIGNED' }, { headers: driverHeaders }).catch(err => err.response);
      record('TEST 4: Driver B cannot update Driver C trip', res.status === 403, `status=${res.status}, message=${res.data?.message}`);
    } else {
      record('TEST 4: Driver C trip exists', false, 'No trip found for Driver C');
    }
  } catch (err) {
    record('TEST 4: Driver isolation (different owner)', false, err.message);
  }

  // ============================================================
  // TEST 5: Unauthenticated request rejected
  // ============================================================
  console.log('\n=== TEST 5: Unauthenticated request ===');
  try {
    const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}/status`, { status: 'ASSIGNED' }).catch(err => err.response);
    record('TEST 5: Unauthenticated rejected', res.status === 401, `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 5: Unauthenticated request', false, err.message);
  }

  // ============================================================
  // TEST 6: Nonexistent Trip rejected
  // ============================================================
  console.log('\n=== TEST 6: Nonexistent Trip ===');
  try {
    const res = await axios.patch(`${BASE_URL}/drivers/me/trips/99999/status`, { status: 'ASSIGNED' }, { headers: driverHeaders }).catch(err => err.response);
    record('TEST 6: Nonexistent Trip returns 404', res.status === 404, `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 6: Nonexistent Trip', false, err.message);
  }

  // ============================================================
  // TEST 7: Invalid status rejected
  // ============================================================
  console.log('\n=== TEST 7: Invalid status ===');
  try {
    const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}/status`, { status: 'INVALID_STATUS' }, { headers: driverHeaders }).catch(err => err.response);
    record('TEST 7: Invalid status rejected', res.status === 400, `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 7: Invalid status', false, err.message);
  }

  // ============================================================
  // TEST 8: Invalid transition rejected (COMPLETED when customer due > 0)
  // ============================================================
  console.log('\n=== TEST 8: Invalid transition (COMPLETED with customer due) ===');
  try {
    const res = await axios.patch(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}/status`, { status: 'COMPLETED' }, { headers: driverHeaders }).catch(err => err.response);
    record('TEST 8: COMPLETED rejected when customer due > 0', res.status === 400 && res.data?.message?.includes('Customer payment pending'),
      `status=${res.status}, message=${res.data?.message}`);
  } catch (err) {
    record('TEST 8: Invalid transition', false, err.message);
  }

  // ============================================================
  // TEST 9: Admin sees updated status (synchronization)
  // ============================================================
  console.log('\n=== TEST 9: Admin synchronization ===');
  try {
    const res = await axios.get(`${BASE_URL}/trips/${testTrip.trip_id}`, { headers: adminHeaders });
    if (res.data.success) {
      const trip = res.data.data;
      record('TEST 9: Admin sees same trip_id', trip.trip_id === testTrip.trip_id);
      record('TEST 9: Admin sees same driver_id', trip.driver_id === driverB.driver_id);
      record('TEST 9: Admin sees updated status', trip.status === 'ASSIGNED');
      record('TEST 9: Admin sees same vehicle_id', trip.vehicle_id === testTrip.vehicle_id);
      record('TEST 9: Admin sees same transport_owner_id', trip.transport_owner_id === testTrip.transport_owner_id);
    } else {
      record('TEST 9: Admin synchronization', false, res.data.message);
    }
  } catch (err) {
    record('TEST 9: Admin synchronization', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 10: Partner sees updated status (synchronization)
  // ============================================================
  console.log('\n=== TEST 10: Partner synchronization ===');
  try {
    const owner = await prisma.vehicleOwner.findUnique({ where: { owner_id: driverB.transport_owner_id } });
    const partner = await prisma.partner.findFirst({ where: { partner_id: owner.partner_link } });
    if (partner) {
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
            record('TEST 10: Partner sees same trip_id', trip.trip_id === testTrip.trip_id);
            record('TEST 10: Partner sees same driver_id', trip.driver_id === driverB.driver_id);
            record('TEST 10: Partner sees updated status', trip.status === 'ASSIGNED');
          } else {
            record('TEST 10: Partner synchronization', false, res.data.message);
          }
        } else {
          record('TEST 10: Partner has user account', false, 'No user account for partner');
        }
      } else {
        record('TEST 10: Partner linked to owner', false, 'No partner linked to owner');
      }
    } else {
      record('TEST 10: Owner exists', false, 'Owner not found');
    }
  } catch (err) {
    record('TEST 10: Partner synchronization', false, err.message);
  }

  // ============================================================
  // TEST 11: Driver sees updated status (synchronization)
  // ============================================================
  console.log('\n=== TEST 11: Driver synchronization ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/me/trips/${testTrip.trip_id}`, { headers: driverHeaders });
    if (res.data.success) {
      const trip = res.data.data;
      record('TEST 11: Driver sees same trip_id', trip.trip_id === testTrip.trip_id);
      record('TEST 11: Driver sees same driver_id', trip.driver_id === driverB.driver_id);
      record('TEST 11: Driver sees updated status', trip.status === 'ASSIGNED');
    } else {
      record('TEST 11: Driver synchronization', false, res.data.message);
    }
  } catch (err) {
    record('TEST 11: Driver synchronization', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 12: Legacy Booking status endpoint still works
  // ============================================================
  console.log('\n=== TEST 12: Legacy Booking status endpoint ===');
  try {
    const res = await axios.get(`${BASE_URL}/drivers/my-jobs`, { headers: driverHeaders });
    record('TEST 12: Legacy Booking endpoint works', res.data.success === true);
  } catch (err) {
    record('TEST 12: Legacy Booking endpoint', false, err.response?.data?.message || err.message);
  }

  // ============================================================
  // TEST 13: STEP 9 regression
  // ============================================================
  console.log('\n=== TEST 13: STEP 9 regression ===');
  try {
    const { execSync } = require('child_process');
    const step9Result = execSync('node scripts/verify-step9.js', { cwd: '/Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/backend', encoding: 'utf8', timeout: 120000 });
    const step9Pass = step9Result.includes('Passed:') && !step9Result.includes('FAIL:');
    record('TEST 13: STEP 9 regression', step9Pass, step9Pass ? 'All passed' : 'Some failed');
  } catch (err) {
    record('TEST 13: STEP 9 regression', false, err.message);
  }

  // ============================================================
  // TEST 14: Frontend build
  // ============================================================
  console.log('\n=== TEST 14: Frontend build ===');
  try {
    const { execSync } = require('child_process');
    execSync('npm run build', { cwd: '/Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/frontend', encoding: 'utf8', timeout: 180000 });
    record('TEST 14: Frontend build', true);
  } catch (err) {
    record('TEST 14: Frontend build', false, err.message);
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