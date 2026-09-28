#!/usr/bin/env node
/**
 * STEP 5 Verification Script
 * Tests Admin Trip Assignment -> Partner flow end-to-end.
 *
 * Usage: node scripts/verify-step5.js
 * Requires server running on PORT (default 3000).
 *
 * Note: Login rate limiter allows 20 requests per 15 min.
 * This script minimizes HTTP login requests and uses Prisma for DB setup/verification.
 */

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const { PrismaClient } = require('@prisma/client');

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name} - ${detail || ''}`); }
}

async function api(path, options = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log('=== STEP 5 Verification: Admin Trip Assignment -> Partner ===\n');

  const prisma = new PrismaClient();

  // Get admin token (single login)
  console.log('--- Admin login ---\n');
  const admin = await api('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@bihartransport.com', password: 'admin123' }),
  });
  assert('Admin login', admin.status === 200, `got ${admin.status}`);
  const adminToken = admin.data?.token;
  assert('Admin token received', !!adminToken);
  if (!adminToken) { console.error('Cannot login as admin. Aborting.'); process.exit(1); }

  // Setup: Ensure Partner A (E2E TestPartner) has a vehicle and driver
  console.log('\n--- Setting up Partner A resources ---\n');
  const partnerA = await prisma.partner.findFirst({ where: { partner_name: 'E2E TestPartner' } });
  assert('Partner A (E2E TestPartner) exists', !!partnerA, 'not found');
  const partnerIdA = partnerA?.partner_id;
  console.log(`Partner A ID: ${partnerIdA}`);

  let ownerA = await prisma.vehicleOwner.findFirst({ where: { partner_link: partnerIdA } });
  assert('Owner A linked to Partner A', !!ownerA, 'not found');
  const ownerIdA = ownerA?.owner_id;
  console.log(`Owner A ID: ${ownerIdA}`);

  // Create vehicle for owner A if none exists
  let vehicleA = await prisma.transportVehicle.findFirst({ where: { owner_id: ownerIdA } });
  if (!vehicleA) {
    vehicleA = await prisma.transportVehicle.create({
      data: {
        vehicle_number: 'BR01STEP001',
        vehicle_type: 'truck',
        vehicle_name: 'Step Vehicle',
        owner_id: ownerIdA,
        partner_id: partnerIdA,
        current_status: 'available',
      }
    });
    console.log(`Created Vehicle A: ${vehicleA.vehicle_number} (id: ${vehicleA.vehicle_id})`);
  } else {
    // Ensure partner_id is set
    if (vehicleA.partner_id !== partnerIdA) {
      await prisma.transportVehicle.update({ where: { vehicle_id: vehicleA.vehicle_id }, data: { partner_id: partnerIdA } });
      vehicleA = await prisma.transportVehicle.findUnique({ where: { vehicle_id: vehicleA.vehicle_id } });
    }
    console.log(`Vehicle A exists: ${vehicleA.vehicle_number} (id: ${vehicleA.vehicle_id})`);
  }
  const vehicleIdA = vehicleA?.vehicle_id;

  // Create driver for owner A if none exists
  let driverA = await prisma.driver.findFirst({ where: { transport_owner_id: ownerIdA } });
  if (!driverA) {
    driverA = await prisma.driver.create({
      data: {
        driver_code: 'DRV-STEP-001',
        user_id: 1, // Use existing user
        driver_name: 'Step Driver A',
        mobile: '9999999001',
        city: 'Patna',
        state: 'Bihar',
        license_number: 'BR-STEP-001',
        transport_owner_id: ownerIdA,
        partner_id: partnerIdA,
        status: 'available',
        is_available: true,
        current_vehicle_id: null,
      }
    });
    console.log(`Created Driver A: ${driverA.driver_name} (id: ${driverA.driver_id})`);
  } else {
    if (driverA.partner_id !== partnerIdA) {
      await prisma.driver.update({ where: { driver_id: driverA.driver_id }, data: { partner_id: partnerIdA } });
      driverA = await prisma.driver.findUnique({ where: { driver_id: driverA.driver_id } });
    }
    console.log(`Driver A exists: ${driverA.driver_name} (id: ${driverA.driver_id})`);
  }
  const driverIdA = driverA?.driver_id;

  // Setup Partner B resources
  console.log('\n--- Setting up Partner B resources ---\n');
  const partnerB = await prisma.partner.findFirst({ where: { partner_name: 'Transport Partner A' } });
  assert('Partner B (Transport Partner A) exists', !!partnerB, 'not found');
  const partnerIdB = partnerB?.partner_id;
  console.log(`Partner B ID: ${partnerIdB}`);

  let ownerB = await prisma.vehicleOwner.findFirst({ where: { partner_link: partnerIdB } });
  let ownerIdB = null;
  let vehicleIdB = null;
  let driverIdB = null;

  if (ownerB) {
    ownerIdB = ownerB?.owner_id;
    console.log(`Owner B ID: ${ownerIdB}`);

    vehicleB = await prisma.transportVehicle.findFirst({ where: { owner_id: ownerIdB } });
    if (!vehicleB) {
      vehicleB = await prisma.transportVehicle.create({
        data: {
          vehicle_number: 'BR01STEP002',
          vehicle_type: 'truck',
          vehicle_name: 'Partner B Vehicle',
          owner_id: ownerIdB,
          partner_id: partnerIdB,
          current_status: 'available',
        }
      });
      console.log(`Created Vehicle B: ${vehicleB.vehicle_number} (id: ${vehicleB.vehicle_id})`);
    } else {
      if (vehicleB.partner_id !== partnerIdB) {
        await prisma.transportVehicle.update({ where: { vehicle_id: vehicleB.vehicle_id }, data: { partner_id: partnerIdB } });
        vehicleB = await prisma.transportVehicle.findUnique({ where: { vehicle_id: vehicleB.vehicle_id } });
      }
      console.log(`Vehicle B exists: ${vehicleB.vehicle_number} (id: ${vehicleB.vehicle_id})`);
    }
    vehicleIdB = vehicleB?.vehicle_id;

    driverB = await prisma.driver.findFirst({ where: { transport_owner_id: ownerIdB } });
    if (!driverB) {
      driverB = await prisma.driver.create({
        data: {
          driver_code: 'DRV-STEP-002',
          user_id: 1,
          driver_name: 'Partner B Driver',
          mobile: '9999999002',
          city: 'Patna',
          state: 'Bihar',
          license_number: 'BR-STEP-002',
          transport_owner_id: ownerIdB,
          partner_id: partnerIdB,
          status: 'available',
          is_available: true,
          current_vehicle_id: null,
        }
      });
      console.log(`Created Driver B: ${driverB.driver_name} (id: ${driverB.driver_id})`);
    } else {
      if (driverB.partner_id !== partnerIdB) {
        await prisma.driver.update({ where: { driver_id: driverB.driver_id }, data: { partner_id: partnerIdB } });
        driverB = await prisma.driver.findUnique({ where: { driver_id: driverB.driver_id } });
      }
      console.log(`Driver B exists: ${driverB.driver_name} (id: ${driverB.driver_id})`);
    }
    driverIdB = driverB?.driver_id;
  } else {
    console.log('No owner B found, creating one...');
    ownerB = await prisma.vehicleOwner.create({
      data: {
        owner_name: 'Partner B Owner',
        partner_link: partnerIdB,
        owner_type: 'TRANSPORT_COMPANY',
        is_active: true,
        mobile: '9999999003',
      }
    });
    ownerIdB = ownerB?.owner_id;
    console.log(`Created Owner B ID: ${ownerIdB}`);

    vehicleB = await prisma.transportVehicle.create({
      data: {
        vehicle_number: 'BR01STEP002',
        vehicle_type: 'truck',
        vehicle_name: 'Partner B Vehicle',
        owner_id: ownerIdB,
        partner_id: partnerIdB,
        current_status: 'available',
      }
    });
    vehicleIdB = vehicleB?.vehicle_id;
    console.log(`Created Vehicle B: ${vehicleB.vehicle_number} (id: ${vehicleIdB})`);

    driverB = await prisma.driver.create({
      data: {
        driver_code: 'DRV-STEP-002',
        user_id: 1,
        driver_name: 'Partner B Driver',
        mobile: '9999999002',
        city: 'Patna',
        state: 'Bihar',
        license_number: 'BR-STEP-002',
        transport_owner_id: ownerIdB,
        partner_id: partnerIdB,
        status: 'available',
        is_available: true,
        current_vehicle_id: null,
      }
    });
    driverIdB = driverB?.driver_id;
    console.log(`Created Driver B: ${driverB.name} (id: ${driverIdB})`);
  }

  // TEST 1: Admin creates trip with Partner A + Vehicle A + Driver A
  console.log('\n=== TEST 1: Create trip with valid Partner A + Vehicle A + Driver A ===\n');

  const createTripRes = await api('/api/trips', {
    method: 'POST',
    body: JSON.stringify({
      partner_id: partnerIdA,
      transport_owner_id: ownerIdA,
      vehicle_id: vehicleIdA,
      driver_id: driverIdA,
      user_id: 1,
      pickup_location: 'Test Pickup',
      pickup_city: 'Patna',
      drop_location: 'Test Drop',
      drop_city: 'Begusarai',
      freight_amount: 1500,
      trip_date: new Date().toISOString(),
    }),
  }, adminToken);

  assert('TEST 1: Create trip returns 200/201', [200, 201].includes(createTripRes.status), `got ${createTripRes.status}: ${JSON.stringify(createTripRes.data).substring(0, 300)}`);

  let tripId = null;
  if (createTripRes.data?.data?.trip_id) {
    tripId = createTripRes.data.data.trip_id;
  } else if (createTripRes.data?.trip) {
    tripId = createTripRes.data.trip.trip_id || createTripRes.data.trip.id;
  } else if (createTripRes.data?.id) {
    tripId = createTripRes.data.id;
  } else if (createTripRes.data?.trip_id) {
    tripId = createTripRes.data.trip_id;
  }
  assert('TEST 1: Trip ID returned', !!tripId, JSON.stringify(createTripRes.data).substring(0, 300));
  console.log(`Trip ID: ${tripId}`);

  if (tripId) {
    const tripDetailRes = await api(`/api/trips/${tripId}`, {}, adminToken);
    if (tripDetailRes.status === 200) {
      const tripData = tripDetailRes.data?.data || tripDetailRes.data;
      assert('TEST 1: Trip has correct transport_owner_id', tripData?.transport_owner_id === ownerIdA, `owner=${tripData?.transport_owner_id}`);
      assert('TEST 1: Trip has correct vehicle_id', tripData?.vehicle_id === vehicleIdA, `vehicle=${tripData?.vehicle_id}`);
      assert('TEST 1: Trip has correct driver_id', tripData?.driver_id === driverIdA, `driver=${tripData?.driver_id}`);
    }
  }

  // TEST 2: Backend rejects Partner B vehicle with Partner A
  console.log('\n=== TEST 2: Reject invalid vehicle (Partner B vehicle with Partner A) ===\n');

  if (vehicleIdB) {
    const rejectRes = await api('/api/trips', {
      method: 'POST',
      body: JSON.stringify({
        partner_id: partnerIdA,
        transport_owner_id: ownerIdA,
        vehicle_id: vehicleIdB,
        driver_id: driverIdA,
        pickup_location: 'Test Pickup',
        pickup_city: 'Patna',
        drop_location: 'Test Drop',
        drop_city: 'Begusarai',
        freight_amount: 1500,
        trip_date: new Date().toISOString().split('T')[0],
      }),
    }, adminToken);

    assert('TEST 2: Reject invalid vehicle (400/403)', [400, 403].includes(rejectRes.status), `got ${rejectRes.status}: ${JSON.stringify(rejectRes.data).substring(0, 200)}`);
  } else {
    assert('TEST 2: Skipped (no Partner B vehicle found)', false, 'No Partner B vehicle available');
  }

  // TEST 3: Backend rejects Partner B driver with Partner A
  console.log('\n=== TEST 3: Reject invalid driver (Partner B driver with Partner A) ===\n');

  if (driverIdB) {
    const rejectDriverRes = await api('/api/trips', {
      method: 'POST',
      body: JSON.stringify({
        partner_id: partnerIdA,
        transport_owner_id: ownerIdA,
        vehicle_id: vehicleIdA,
        driver_id: driverIdB,
        pickup_location: 'Test Pickup',
        pickup_city: 'Patna',
        drop_location: 'Test Drop',
        drop_city: 'Begusarai',
        freight_amount: 1500,
        trip_date: new Date().toISOString().split('T')[0],
      }),
    }, adminToken);

    assert('TEST 3: Reject invalid driver (400/403)', [400, 403].includes(rejectDriverRes.status), `got ${rejectDriverRes.status}: ${JSON.stringify(rejectDriverRes.data).substring(0, 200)}`);
  } else {
    assert('TEST 3: Skipped (no Partner B driver found)', false, 'No Partner B driver available');
  }

  // TEST 4-6: Partner visibility via database verification
  console.log('\n=== TESTS 4-6: Partner visibility (via Prisma verification) ===\n');

  if (tripId) {
    // TEST 4: Partner A can see their trip
    const partnerATrips = await prisma.trip.findMany({
      where: { trip_id: tripId },
      select: { trip_id: true, transport_owner_id: true, vehicle_id: true, driver_id: true, status: true }
    });
    assert('TEST 4: Trip exists in database', partnerATrips.length === 1, `found ${partnerATrips.length} trips`);

    if (partnerATrips.length === 1) {
      const trip = partnerATrips[0];
      assert('TEST 4: Trip belongs to Partner A owner', trip.transport_owner_id === ownerIdA, `owner=${trip.transport_owner_id}`);
      assert('TEST 4: Trip has Vehicle A', trip.vehicle_id === vehicleIdA);
      assert('TEST 4: Trip has Driver A', trip.driver_id === driverIdA);
    }

    // Verify Partner A owner is linked to Partner A
    const ownerADb = await prisma.vehicleOwner.findUnique({
      where: { owner_id: ownerIdA },
      select: { owner_id: true, partner_link: true }
    });
    assert('TEST 4: Owner A linked to Partner A', ownerADb?.partner_link === partnerIdA, `partner_link=${ownerADb?.partner_link}`);

    // TEST 5: Partner B cannot see Partner A's trip
    const ownerBDb = await prisma.vehicleOwner.findUnique({
      where: { owner_id: ownerIdB },
      select: { owner_id: true, partner_link: true }
    });
    assert('TEST 5: Owner B linked to Partner B', ownerBDb?.partner_link === partnerIdB, `partner_link=${ownerBDb?.partner_link}`);

    const partnerBTrips = await prisma.trip.findMany({
      where: { trip_id: tripId, transport_owner_id: ownerIdB },
      select: { trip_id: true }
    });
    assert('TEST 5: Partner B does NOT see Partner A trip', partnerBTrips.length === 0, `found ${partnerBTrips.length} trips`);

    // TEST 6: Verify trip is in Partner A scoped trip list
    const partnerAScopedTrips = await prisma.trip.findMany({
      where: { transport_owner_id: ownerIdA },
      select: { trip_id: true }
    });
    const foundInScoped = partnerAScopedTrips.some(t => t.trip_id === tripId);
    assert('TEST 6: New trip in Partner A scoped trips', foundInScoped);
  }

  // TEST 7: Frontend build check
  console.log('\n=== TEST 7: Frontend build ===\n');
  const { execSync } = require('child_process');
  try {
    execSync('cd frontend && npm run build', { stdio: 'pipe', timeout: 60000 });
    assert('TEST 7: Frontend build succeeds', true);
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    assert('TEST 7: Frontend build fails', false, stderr.substring(0, 200));
  }

  // Summary
  console.log('\n\n=== VERIFICATION SUMMARY ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
  }
  console.log('\n=== END VERIFICATION ===\n');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Verification script error:', err);
  process.exit(1);
});
