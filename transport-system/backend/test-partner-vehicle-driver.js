/**
 * Test script for Partner-Vehicle-Driver relationships
 * Run with: node test-partner-vehicle-driver.js
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

// Helper to make authenticated requests
async function authRequest(method, path, data = null, token = null) {
  const config = {
    method,
    url: `${API_BASE}${path}`,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (data) {
    config.data = data;
  }
  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`Error ${method} ${path}:`, error.response?.data || error.message);
    throw error;
  }
}

async function runTests() {
  console.log('=== Partner-Vehicle-Driver Relationship Tests ===\n');

  // Step 1: Admin login
  console.log('1. Admin login...');
  const loginData = await authRequest('POST', '/auth/admin-login', {
    email: 'admin@bihartransport.com',
    password: 'admin123',
  });
  const adminToken = loginData.token;
  console.log('   Admin logged in successfully\n');

  // Step 2: Create a partner (Transport Owner)
  console.log('2. Creating Partner A...');
  const partnerData = await authRequest('POST', '/admin/partners', {
    partner_name: 'Transport Partner A',
    owner_name: 'Transport Partner A',
    company_name: 'A Transport Co.',
    mobile: '999999' + (Date.now() % 10000),
    city: 'Patna',
    state: 'Bihar',
    email: 'partnera@test.com',
    commission_percentage: 10,
  }, adminToken);
  const partnerAId = partnerData.data.partner_id;
  console.log(`   Partner A created with ID: ${partnerAId}\n`);

  // Step 3: Create a vehicle owner
  console.log('3. Creating Vehicle Owner A...');
  const ownerData = await authRequest('POST', '/admin/vehicle-owners', {
    owner_name: 'Vehicle Owner A',
    company_name: 'A Vehicles Pvt Ltd',
    mobile: '888888' + String(Date.now() % 10000).padStart(4, '0'),
    city: 'Patna',
    state: 'Bihar',
    email: 'ownera@test.com',
  }, adminToken);
  const ownerAId = ownerData.data.owner_id;
  console.log(`   Vehicle Owner A created with ID: ${ownerAId}\n`);

  // Step 4: Create a driver
  console.log('4. Creating Driver A...');
  const driverData = await authRequest('POST', '/admin/drivers', {
    driver_name: 'Driver A',
    mobile: '7777777' + (Date.now() % 10000),
    city: 'Patna',
    state: 'Bihar',
    license_number: 'DL1234567890',
    transport_owner_id: ownerAId,
    vehicle_type: 'Tata Ace',
    vehicle_number: 'BR09DR1234',
  }, adminToken);
  const driverAId = driverData.data.driver_id;
  console.log(`   Driver A created with ID: ${driverAId}\n`);

  // Step 5: Create another driver for partner consistency test
  console.log('5. Creating Driver B (for Partner B)...');
  const driverBData = await authRequest('POST', '/admin/drivers', {
    driver_name: 'Driver B',
    mobile: '7777777772',
    city: 'Patna',
    state: 'Bihar',
    license_number: 'DL1234567891',
    transport_owner_id: ownerAId,
    vehicle_type: 'Tata 407',
    vehicle_number: 'BR09DR5678',
  }, adminToken);
  const driverBId = driverBData.data.driver_id;
  console.log(`   Driver B created with ID: ${driverBId}\n`);

  // Step 6: Create another partner for consistency test
  console.log('6. Creating Partner B...');
  const partnerBData = await authRequest('POST', '/admin/partners', {
    partner_name: 'Transport Partner B',
    owner_name: 'Transport Partner B',
    company_name: 'B Transport Co.',
    mobile: '9999999992',
    city: 'Patna',
    state: 'Bihar',
    email: 'partnerb@test.com',
    commission_percentage: 10,
  }, adminToken);
  const partnerBId = partnerBData.data.partner_id;
  console.log(`   Partner B created with ID: ${partnerBId}\n`);

  // TEST 1: Create vehicle with Partner A, Owner A, no driver
  console.log('TEST 1: Create vehicle (Partner A, Owner A, no driver)');
  const vehicle1Data = await authRequest('POST', `/admin/vehicle-owners/${ownerAId}/vehicles`, {
    vehicle_number: 'BR09TEST1',
    vehicle_type: 'Tata Ace',
    vehicle_name: 'Test Vehicle 1',
    partner_id: partnerAId,
    owner_id: ownerAId,
    current_status: 'available',
  }, adminToken);
  const vehicle1Id = vehicle1Data.data.vehicle_id;
  console.log(`   Vehicle 1 created with ID: ${vehicle1Id}`);
  console.log(`   partner_id: ${vehicle1Data.data.partner_id} (expected: ${partnerAId})`);
  console.log(`   owner_id: ${vehicle1Data.data.owner_id} (expected: ${ownerAId})`);
  console.log(`   driver_id: ${vehicle1Data.data.driver_id} (expected: null)`);
  console.log(`   PASS: ${vehicle1Data.data.partner_id === partnerAId && vehicle1Data.data.owner_id === ownerAId && vehicle1Data.data.driver_id === null ? 'YES' : 'NO'}\n`);

  // TEST 2: Create vehicle with Partner A, Owner A, Driver A
  console.log('TEST 2: Create vehicle (Partner A, Owner A, Driver A)');
  const vehicle2Data = await authRequest('POST', `/admin/vehicle-owners/${ownerAId}/vehicles`, {
    vehicle_number: 'BR09TEST2',
    vehicle_type: 'Tata 407',
    vehicle_name: 'Test Vehicle 2',
    partner_id: partnerAId,
    owner_id: ownerAId,
    driver_id: driverAId,
    current_status: 'available',
  }, adminToken);
  const vehicle2Id = vehicle2Data.data.vehicle_id;
  console.log(`   Vehicle 2 created with ID: ${vehicle2Id}`);
  console.log(`   partner_id: ${vehicle2Data.data.partner_id} (expected: ${partnerAId})`);
  console.log(`   owner_id: ${vehicle2Data.data.owner_id} (expected: ${ownerAId})`);
  console.log(`   driver_id: ${vehicle2Data.data.driver_id} (expected: ${driverAId})`);

  // Verify driver's current_vehicle_id was updated
  const driverAProfile = await authRequest('GET', `/admin/drivers/${driverAId}`, null, adminToken);
  console.log(`   Driver A current_vehicle_id: ${driverAProfile.data.current_vehicle_id} (expected: ${vehicle2Id})`);
  console.log(`   PASS: ${vehicle2Data.data.partner_id === partnerAId && vehicle2Data.data.owner_id === ownerAId && vehicle2Data.data.driver_id === driverAId && driverAProfile.data.current_vehicle_id === vehicle2Id ? 'YES' : 'NO'}\n`);

  // TEST 3: Move Driver A from Vehicle 2 to Vehicle 1
  console.log('TEST 3: Move Driver A from Vehicle 2 to Vehicle 1');
  const assignResult = await authRequest('POST', `/admin/vehicles/${vehicle1Id}/assign-driver`, {
    driver_id: driverAId,
  }, adminToken);
  console.log(`   Vehicle 1 driver_id: ${assignResult.data.driver_id} (expected: ${driverAId})`);
  console.log(`   Vehicle 2 driver_id should be null`);

  // Verify Vehicle 2 has no driver
  const vehicle2After = await authRequest('GET', `/admin/vehicles/${vehicle2Id}`, null, adminToken);
  console.log(`   Vehicle 2 driver_id: ${vehicle2After.data.driver_id} (expected: null)`);

  // Verify Driver A's current_vehicle_id
  const driverAAfter = await authRequest('GET', `/admin/drivers/${driverAId}`, null, adminToken);
  console.log(`   Driver A current_vehicle_id: ${driverAAfter.data.current_vehicle_id} (expected: ${vehicle1Id})`);
  console.log(`   PASS: ${assignResult.data.driver_id === driverAId && vehicle2After.data.driver_id === null && driverAAfter.data.current_vehicle_id === vehicle1Id ? 'YES' : 'NO'}\n`);

  // TEST 4: Assign Driver B to Vehicle 2 (Driver B was unassigned)
  console.log('TEST 4: Assign Driver B to Vehicle 2');
  const assignBResult = await authRequest('POST', `/admin/vehicles/${vehicle2Id}/assign-driver`, {
    driver_id: driverBId,
  }, adminToken);
  console.log(`   Vehicle 2 driver_id: ${assignBResult.data.driver_id} (expected: ${driverBId})`);

  const driverBAfter = await authRequest('GET', `/admin/drivers/${driverBId}`, null, adminToken);
  console.log(`   Driver B current_vehicle_id: ${driverBAfter.data.current_vehicle_id} (expected: ${vehicle2Id})`);
  console.log(`   PASS: ${assignBResult.data.driver_id === driverBId && driverBAfter.data.current_vehicle_id === vehicle2Id ? 'YES' : 'NO'}\n`);

  // TEST 5: Try assigning Driver B (belongs to Partner A) to a vehicle of Partner B
  console.log('TEST 5: Try assigning Driver B to Partner B vehicle (should fail)');
  
  // First, set Driver B's partner_id to Partner A to simulate a driver belonging to a partner
  await authRequest('PATCH', `/admin/drivers/${driverBId}`, {
    partner_id: partnerAId,
  }, adminToken);
  console.log(`   Driver B partner_id set to ${partnerAId} (Partner A)`);

  const vehicle3Data = await authRequest('POST', `/admin/vehicle-owners/${ownerAId}/vehicles`, {
    vehicle_number: 'BR09TEST3',
    vehicle_type: 'Tata Ace',
    vehicle_name: 'Test Vehicle 3',
    partner_id: partnerBId,
    owner_id: ownerAId,
    current_status: 'available',
  }, adminToken);
  const vehicle3Id = vehicle3Data.data.vehicle_id;
  console.log(`   Vehicle 3 created with partner_id: ${vehicle3Data.data.partner_id} (Partner B)`);

  try {
    await authRequest('POST', `/admin/vehicles/${vehicle3Id}/assign-driver`, {
      driver_id: driverBId,
    }, adminToken);
    console.log('   FAIL: Should have thrown an error');
  } catch (error) {
    console.log(`   PASS: Request rejected with error: ${error.response?.data?.message || error.message}`);
  }
  console.log();

  // TEST 6: Remove driver from vehicle
  console.log('TEST 6: Remove driver from Vehicle 1');
  const removeResult = await authRequest('POST', `/admin/vehicles/${vehicle1Id}/remove-driver`, {}, adminToken);
  console.log(`   Vehicle 1 driver_id: ${removeResult.data.driver_id} (expected: null)`);

  const driverAAfterRemove = await authRequest('GET', `/admin/drivers/${driverAId}`, null, adminToken);
  console.log(`   Driver A current_vehicle_id: ${driverAAfterRemove.data.current_vehicle_id} (expected: null)`);
  console.log(`   PASS: ${removeResult.data.driver_id === null && driverAAfterRemove.data.current_vehicle_id === null ? 'YES' : 'NO'}\n`);

  // TEST 7: GET /api/admin/partners/:id/vehicles
  console.log('TEST 7: Get Partner A vehicles');
  const partnerVehicles = await authRequest('GET', `/admin/partners/${partnerAId}/vehicles`, null, adminToken);
  console.log(`   Partner A has ${partnerVehicles.data?.length || 0} vehicles`);
  console.log(`   PASS: ${(partnerVehicles.data?.length || 0) >= 2 ? 'YES' : 'NO'}\n`);

  // TEST 8: GET /api/admin/vehicles includes partner info
  console.log('TEST 8: GET /api/admin/vehicles includes partner info');
  const allVehicles = await authRequest('GET', '/admin/vehicles', null, adminToken);
  const testVehicle = allVehicles.data.find(v => v.vehicle_id === vehicle1Id);
  console.log(`   Vehicle 1 partner_id: ${testVehicle?.partner_id} (expected: ${partnerAId})`);
  console.log(`   Vehicle 1 partner_name: ${testVehicle?.partner_name} (expected: Transport Partner A)`);
  console.log(`   PASS: ${testVehicle?.partner_id === partnerAId && testVehicle?.partner_name === 'Transport Partner A' ? 'YES' : 'NO'}\n`);

  console.log('=== All tests completed ===');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
