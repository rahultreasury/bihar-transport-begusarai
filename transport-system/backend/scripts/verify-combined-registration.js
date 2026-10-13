/**
 * Verify the combined transport-resources registration endpoint.
 * Tests independent and combined registration flows against the REAL backend.
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

function genMobile() {
  let tail = '';
  for (let i = 0; i < 9; i++) tail += Math.floor(Math.random() * 10);
  return '9' + tail;
}

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
    console.log('LOGIN FAILED:', JSON.stringify(login.body));
    process.exit(1);
  }
  console.log('LOGIN ok. role=', login.body.data.role);

  const results = [];

  // ─── TEST 1: Owner only ───────────────────────────────────────────
  const ownerMobile = genMobile();
  const ownerRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: { owner_name: 'Combined Test Owner', mobile: ownerMobile, city: 'Begusarai', commission_percentage: 10 },
      driver: null,
      vehicle: null,
    },
  });
  console.log('\n=== TEST 1: OWNER ONLY ===', ownerRes.status, ownerRes.body?.success);
  console.log('  owner_id:', ownerRes.body?.data?.owner_id, 'owner_code:', ownerRes.body?.data?.owner_code);
  results.push({ name: 'Owner only', status: ownerRes.status, success: ownerRes.body?.success, id: ownerRes.body?.data?.owner_id });

  // Verify owner is retrievable
  if (ownerRes.body?.data?.owner_id) {
    const getRes = await request('GET', `/api/admin/vehicle-owners/${ownerRes.body.data.owner_id}`, { token });
    console.log('  GET owner:', getRes.status, getRes.body?.success, 'name:', getRes.body?.data?.owner_name);
    results.push({ name: 'Owner retrieval', status: getRes.status, success: getRes.body?.success });
  }

  // ─── TEST 2: Driver only (self-owner) ─────────────────────────────
  const driverMobile = genMobile();
  const driverRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: null,
      driver: {
        driver_name: 'Combined Test Driver',
        mobile: driverMobile,
        license_number: 'DL/BR/999001/2020',
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_number: genVehicle(),
        is_self_owner: true,
      },
      vehicle: null,
    },
  });
  console.log('\n=== TEST 2: DRIVER ONLY (self-owner) ===', driverRes.status, driverRes.body?.success);
  console.log('  driver_id:', driverRes.body?.data?.driver_id, 'driver_code:', driverRes.body?.data?.driver_code);
  results.push({ name: 'Driver only', status: driverRes.status, success: driverRes.body?.success, id: driverRes.body?.data?.driver_id });

  // Verify driver is retrievable
  if (driverRes.body?.data?.driver_id) {
    const getRes = await request('GET', `/api/admin/drivers/${driverRes.body.data.driver_id}`, { token });
    console.log('  GET driver:', getRes.status, getRes.body?.success, 'name:', getRes.body?.data?.driver_name);
    results.push({ name: 'Driver retrieval', status: getRes.status, success: getRes.body?.success });
  }

  // ─── TEST 3: Vehicle only (standalone) ────────────────────────────
  const vehRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: null,
      driver: null,
      vehicle: {
        vehicle_number: genVehicle(),
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_name: 'Tata Ace',
        current_status: 'available',
      },
    },
  });
  console.log('\n=== TEST 3: VEHICLE ONLY (standalone) ===', vehRes.status, vehRes.body?.success);
  console.log('  vehicle_id:', vehRes.body?.data?.vehicle_id, 'vehicle_number:', vehRes.body?.data?.vehicle_number);
  results.push({ name: 'Vehicle only', status: vehRes.status, success: vehRes.body?.success, id: vehRes.body?.data?.vehicle_id });

  // Verify vehicle is retrievable
  if (vehRes.body?.data?.vehicle_id) {
    const getRes = await request('GET', `/api/admin/vehicles/${vehRes.body.data.vehicle_id}`, { token });
    console.log('  GET vehicle:', getRes.status, getRes.body?.success, 'number:', getRes.body?.data?.vehicle_number);
    results.push({ name: 'Vehicle retrieval', status: getRes.status, success: getRes.body?.success });
  }

  // ─── TEST 4: All three combined ───────────────────────────────────
  const combinedOwnerMobile = genMobile();
  const combinedDriverMobile = genMobile();
  const combinedRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: { owner_name: 'Combined All Owner', mobile: combinedOwnerMobile, city: 'Begusarai', commission_percentage: 12 },
      driver: {
        driver_name: 'Combined All Driver',
        mobile: combinedDriverMobile,
        license_number: 'DL/BR/999002/2020',
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_number: genVehicle(),
      },
      vehicle: {
        vehicle_number: genVehicle(),
        vehicle_type: 'Tata Ace (Chhota Hathi)',
        vehicle_name: 'Tata Ace',
        current_status: 'available',
      },
    },
  });
  console.log('\n=== TEST 4: ALL THREE COMBINED ===', combinedRes.status, combinedRes.body?.success);
  console.log('  owner_id:', combinedRes.body?.data?.owner_id);
  console.log('  driver_id:', combinedRes.body?.data?.driver_id);
  console.log('  vehicle_id:', combinedRes.body?.data?.vehicle_id);
  results.push({ name: 'All three combined', status: combinedRes.status, success: combinedRes.body?.success });

  // Verify relationships
  if (combinedRes.body?.data?.driver_id) {
    const getDriver = await request('GET', `/api/admin/drivers/${combinedRes.body.data.driver_id}`, { token });
    const driverOwnerId = getDriver.body?.data?.transport_owner_id;
    console.log('  Driver transport_owner_id:', driverOwnerId, '(expected:', combinedRes.body?.data?.owner_id, ')');
    results.push({ name: 'Driver→Owner relationship', status: getDriver.status, success: driverOwnerId === combinedRes.body?.data?.owner_id });
  }
  if (combinedRes.body?.data?.vehicle_id) {
    const getVehicle = await request('GET', `/api/admin/vehicles/${combinedRes.body.data.vehicle_id}`, { token });
    const vehicleOwnerId = getVehicle.body?.data?.owner_id;
    const vehicleDriverId = getVehicle.body?.data?.driver_id;
    console.log('  Vehicle owner_id:', vehicleOwnerId, '(expected:', combinedRes.body?.data?.owner_id, ')');
    console.log('  Vehicle driver_id:', vehicleDriverId, '(expected:', combinedRes.body?.data?.driver_id, ')');
    results.push({ name: 'Vehicle→Owner relationship', status: getVehicle.status, success: vehicleOwnerId === combinedRes.body?.data?.owner_id });
    results.push({ name: 'Vehicle→Driver relationship', status: getVehicle.status, success: vehicleDriverId === combinedRes.body?.data?.driver_id });
  }

  // ─── TEST 5: Invalid data (validation errors) ─────────────────────
  const invalidRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: { owner_name: '', mobile: '123', city: '' },
      driver: null,
      vehicle: null,
    },
  });
  console.log('\n=== TEST 5: INVALID OWNER DATA ===', invalidRes.status, invalidRes.body?.success);
  console.log('  message:', invalidRes.body?.message || JSON.stringify(invalidRes.body?.errors));
  results.push({ name: 'Invalid data rejected', status: invalidRes.status, success: invalidRes.body?.success === false });

  // ─── TEST 6: Duplicate mobile (409) ───────────────────────────────
  const dupRes = await request('POST', '/api/admin/transport-resources', {
    token,
    body: {
      owner: { owner_name: 'Duplicate Owner', mobile: ownerMobile, city: 'Begusarai' },
      driver: null,
      vehicle: null,
    },
  });
  console.log('\n=== TEST 6: DUPLICATE OWNER MOBILE ===', dupRes.status, dupRes.body?.success);
  console.log('  message:', dupRes.body?.message);
  results.push({ name: 'Duplicate mobile rejected', status: dupRes.status, success: dupRes.body?.success === false });

  // ─── TEST 7: No auth (401) ────────────────────────────────────────
  const noAuthRes = await request('POST', '/api/admin/transport-resources', {
    body: { owner: { owner_name: 'No Auth', mobile: genMobile(), city: 'Begusarai' } },
  });
  console.log('\n=== TEST 7: NO AUTH ===', noAuthRes.status, noAuthRes.body?.success);
  results.push({ name: 'No auth rejected', status: noAuthRes.status, success: noAuthRes.body?.success === false });

  // ─── TEST 8: Double-click simulation (idempotency) ────────────────
  const doubleMobile = genMobile();
  const doubleBody = {
    owner: { owner_name: 'Double Click Owner', mobile: doubleMobile, city: 'Begusarai' },
    driver: null,
    vehicle: null,
  };
  const [d1, d2] = await Promise.all([
    request('POST', '/api/admin/transport-resources', { token, body: doubleBody }),
    request('POST', '/api/admin/transport-resources', { token, body: doubleBody }),
  ]);
  const successCount = [d1, d2].filter(r => r.body?.success).length;
  console.log('\n=== TEST 8: DOUBLE SUBMIT ===');
  console.log('  Request 1:', d1.status, d1.body?.success);
  console.log('  Request 2:', d2.status, d2.body?.success);
  console.log('  Successful creations:', successCount, '(expected: 1)');
  results.push({ name: 'Double submit no duplicate', status: 200, success: successCount === 1 });

  // ─── SUMMARY ──────────────────────────────────────────────────────
  console.log('\n\n=== FINAL SUMMARY ===');
  let pass = 0, fail = 0;
  for (const r of results) {
    const ok = r.success ? 'PASS' : 'FAIL';
    if (r.success) pass++; else fail++;
    console.log(`  [${ok}] ${r.name} (HTTP ${r.status})`);
  }
  console.log(`\nTotal: ${pass} passed, ${fail} failed out of ${results.length}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
