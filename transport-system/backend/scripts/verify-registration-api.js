/**
 * API verification script for transport resource registration.
 * Tests the REAL backend endpoints with a real admin JWT.
 * Creates test records with unique identifiers (timestamp + random).
 */
const http = require('http');

const BASE = 'http://localhost:3000';
const ADMIN_EMAIL = 'admin@bihartransport.com';
const ADMIN_PASSWORD = 'admin123';

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 10-digit Indian mobile starting with 9 — fully random to avoid collisions
// with previously created test data.
function genMobile() {
  let tail = '';
  for (let i = 0; i < 9; i++) tail += Math.floor(Math.random() * 10);
  return '9' + tail;
}

// 10-char vehicle number BR09AB1234 — fully random
function genVehicle() {
  let tail = '';
  for (let i = 0; i < 4; i++) tail += Math.floor(Math.random() * 10);
  return 'BR09AB' + tail;
}

async function main() {
  const login = await request('POST', '/api/auth/admin-login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = login.body?.token || login.body?.data?.token;
  if (!token) {
    console.log('Login failed:', JSON.stringify(login.body));
    process.exit(1);
  }
  console.log('LOGIN ok. role=', login.body.data.role);

  const seed = Date.now();
  const R = {};

  // 1. Create Owner
  const ownerRes = await request('POST', '/api/admin/vehicle-owners', {
    token,
    body: { owner_name: 'API Test Owner', mobile: genMobile(), city: 'Begusarai', commission_percentage: 10 },
  });
  console.log('\n=== CREATE OWNER ===', ownerRes.status, ownerRes.body?.success);
  console.log(JSON.stringify(ownerRes.body).slice(0, 300));
  R.owner = ownerRes;

  // 2. Create Driver (with transport_owner_id)
  if (ownerRes.body?.data?.owner_id) {
    const driverRes = await request('POST', '/api/admin/drivers', {
      token,
      body: {
        driver_name: 'API Test Driver',
        mobile: genMobile(),
        license_number: 'DL/BR/000001/2020',
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_number: genVehicle(),
        transport_owner_id: ownerRes.body.data.owner_id,
      },
    });
    console.log('\n=== CREATE DRIVER (with owner) ===', driverRes.status, driverRes.body?.success);
    console.log(JSON.stringify(driverRes.body).slice(0, 300));
    R.driver = driverRes;
  }

  // 3. Create Standalone Vehicle (no owner)
  const vehRes = await request('POST', '/api/admin/vehicles', {
    token,
    body: {
      vehicle_number: genVehicle(),
      vehicle_type: 'Tata Ace (Chhota Hathi)',
      vehicle_name: 'Tata Ace',
      current_status: 'available',
    },
  });
  console.log('\n=== CREATE STANDALONE VEHICLE (no owner) ===', vehRes.status, vehRes.body?.success);
  console.log(JSON.stringify(vehRes.body).slice(0, 300));
  R.vehicle = vehRes;

  // 4. Create Vehicle under owner WITH driver
  if (ownerRes.body?.data?.owner_id && R.driver?.body?.data?.driver_id) {
    const vehOwnerRes = await request('POST', `/api/admin/vehicle-owners/${ownerRes.body.data.owner_id}/vehicles`, {
      token,
      body: {
        vehicle_number: genVehicle(),
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_name: 'Tata Ace',
        driver_id: R.driver.body.data.driver_id,
        current_status: 'available',
      },
    });
    console.log('\n=== CREATE VEHICLE UNDER OWNER (with driver) ===', vehOwnerRes.status, vehOwnerRes.body?.success);
    console.log(JSON.stringify(vehOwnerRes.body).slice(0, 300));
    R.vehicleUnderOwner = vehOwnerRes;
  }

  // 5. Create Vehicle under owner WITHOUT driver (business rule check)
  if (ownerRes.body?.data?.owner_id) {
    const vehNoDriverRes = await request('POST', `/api/admin/vehicle-owners/${ownerRes.body.data.owner_id}/vehicles`, {
      token,
      body: {
        vehicle_number: genVehicle(),
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_name: 'Tata Ace',
        current_status: 'available',
      },
    });
    console.log('\n=== CREATE VEHICLE UNDER OWNER (NO driver) ===', vehNoDriverRes.status, vehNoDriverRes.body?.success);
    console.log(JSON.stringify(vehNoDriverRes.body).slice(0, 300));
    R.vehicleUnderOwnerNoDriver = vehNoDriverRes;
  }

  // 6. Create Driver WITHOUT owner (expected 400)
  const driverNoOwnerRes = await request('POST', '/api/admin/drivers', {
    token,
    body: {
      driver_name: 'No Owner Driver',
      mobile: genMobile(),
      license_number: 'DL/BR/000002/2020',
      vehicle_type: 'Tata Ace (Chhota Hathi)',
      vehicle_number: genVehicle(),
    },
  });
  console.log('\n=== CREATE DRIVER (NO owner, NO self_owner) ===', driverNoOwnerRes.status, driverNoOwnerRes.body?.success);
  console.log(JSON.stringify(driverNoOwnerRes.body).slice(0, 300));
  R.driverNoOwner = driverNoOwnerRes;

  // 7. Create Driver with is_self_owner=true
  const selfDriverRes = await request('POST', '/api/admin/drivers', {
    token,
    body: {
      driver_name: 'Self Owner Driver',
      mobile: genMobile(),
      license_number: 'DL/BR/000003/2020',
      vehicle_type: 'Tata Ace (Chhota Hathi)',
      vehicle_number: genVehicle(),
      is_self_owner: true,
    },
  });
  console.log('\n=== CREATE DRIVER (is_self_owner=true) ===', selfDriverRes.status, selfDriverRes.body?.success);
  console.log(JSON.stringify(selfDriverRes.body).slice(0, 300));
  R.selfDriver = selfDriverRes;

  console.log('\n=== SUMMARY ===');
  console.log('Owner:', R.owner?.status, R.owner?.body?.success);
  console.log('Driver (with owner):', R.driver?.status, R.driver?.body?.success);
  console.log('Standalone Vehicle:', R.vehicle?.status, R.vehicle?.body?.success);
  console.log('Vehicle under owner (with driver):', R.vehicleUnderOwner?.status, R.vehicleUnderOwner?.body?.success);
  console.log('Vehicle under owner (no driver):', R.vehicleUnderOwnerNoDriver?.status, R.vehicleUnderOwnerNoDriver?.body?.success);
  console.log('Driver no owner:', R.driverNoOwner?.status, R.driverNoOwner?.body?.success);
  console.log('Self-owner driver:', R.selfDriver?.status, R.selfDriver?.body?.success);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
