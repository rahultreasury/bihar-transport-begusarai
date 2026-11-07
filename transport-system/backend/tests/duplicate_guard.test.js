/**
 * duplicate_guard.test.js
 * ---------------------------------------------------------------------------
 * Tests for Resource Management Stability - Duplicate Guard feature
 * Verifies that duplicate mobile, licence, and vehicle numbers are rejected
 * at both application and database levels.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const DriverRepository = require('../repositories/DriverRepository');
const VehicleOwnerRepository = require('../repositories/VehicleOwnerRepository');
const DriverManagementService = require('../services/DriverManagementService');
const VehicleOwnerService = require('../services/VehicleOwnerService');

const driverRepo = new DriverRepository();
const vehicleOwnerRepo = new VehicleOwnerRepository();
const driverService = new DriverManagementService();
const vehicleOwnerService = new VehicleOwnerService();

const created = {
  drivers: [], owners: [], vehicles: [], users: []
};

let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

before(async () => {
  if (!process.env.DATABASE_URL) { skipReason = 'DATABASE_URL is not set'; return; }
  try { await prisma.$queryRaw`SELECT 1`; ready = true; skipReason = null; }
  catch (e) { skipReason = `live PostgreSQL unavailable: ${String(e.message).split('\n')[0]}`; }
});

after(async () => {
  if (!ready) return;
  // Cleanup in correct order to avoid FK constraints
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } }).catch(() => {});
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.vehicles } } }).catch(() => {});
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.owners } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } }).catch(() => {});
  await prisma.$disconnect();
});

function skip() { return { skip: skipReason }; }

const VALID_LICENSE_EXPIRY = '2030-12-31';

function uniqueMobile(suffix) {
  const numeric = `${process.pid}${Date.now()}${suffix}`.replace(/\D/g, '');
  const tenDigits = numeric.slice(-10).padStart(10, '0');
  const firstDigit = String(6 + (Number(tenDigits[0]) % 4));
  return firstDigit + tenDigits.slice(1);
}

function uniqueVehicle(suffix) {
  const base = `${process.pid}${Date.now()}${suffix}`.replace(/\D/g, '').slice(-8).padStart(8, '0');
  const rto = String(Number(base.slice(0, 2)) % 99 + 1).padStart(2, '0');
  const seriesNum = Number(base.slice(2, 4)) % 676;
  const series = String.fromCharCode(65 + Math.floor(seriesNum / 26)) + String.fromCharCode(65 + (seriesNum % 26));
  const num = base.slice(4, 8);
  return `BR${rto}${series}${num}`;
}

function uniqueLicense(suffix) {
  const base = `${process.pid}${Date.now()}${suffix}`.replace(/\D/g, '').slice(-12).padStart(12, '0');
  return `BR${base.slice(0, 2)}${base.slice(2, 6)}${base.slice(6, 12)}`;
}

async function createTestOwner(suffix) {
  const owner = await vehicleOwnerService.registerOwner({
    owner_name: `Test Owner ${suffix}`,
    mobile: uniqueMobile(`owner${suffix}`),
    city: 'Patna',
    owner_type: 'TRANSPORT_COMPANY',
  });
  created.owners.push(owner.owner_id);
  return owner;
}

async function createTestDriver(ownerId, suffix) {
  const driver = await driverService.registerDriver({
    driver_name: `Test Driver ${suffix}`,
    mobile: uniqueMobile(`driver${suffix}`),
    license_number: uniqueLicense(`lic${suffix}`),
    license_expiry: VALID_LICENSE_EXPIRY,
    city: 'Patna',
    transport_owner_id: ownerId,
  });
  created.drivers.push(driver.driver_id);
  return driver;
}

describe('Duplicate Guard - Core Functionality', () => {
  test('valid driver registration with unique mobile and license is accepted', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('a1');
    const driver = await createTestDriver(owner.owner_id, 'a1');
    assert.ok(driver.driver_id);
    assert.ok(driver.mobile.match(/^[6-9]\d{9}$/));
  });

  test('duplicate driver mobile is rejected at service level', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('b1');
    const mobile = uniqueMobile('b1');
    await createTestDriver(owner.owner_id, 'b1');
    
    await assert.rejects(
      () => driverService.registerDriver({
        driver_name: 'Duplicate Driver',
        mobile,
        license_number: uniqueLicense('b2'),
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
      { code: 'DRIVER_ALREADY_EXISTS' }
    );
  });

  test('duplicate driver license is rejected at service level', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('c1');
    const license = uniqueLicense('c1');
    await createTestDriver(owner.owner_id, 'c1');
    
    await assert.rejects(
      () => driverService.registerDriver({
        driver_name: 'Duplicate License Driver',
        mobile: uniqueMobile('c2'),
        license_number: license,
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
      { code: 'DRIVER_LICENSE_EXISTS' }
    );
  });

  test('valid vehicle registration with unique number is accepted', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('d1');
    const driver = await createTestDriver(owner.owner_id, 'd1');
    const vehicleNum = uniqueVehicle('d1');
    
    const vehicle = await vehicleOwnerService.createOwnerVehicle(owner.owner_id, {
      vehicle_number: vehicleNum,
      vehicle_type: 'TRUCK',
      vehicle_name: 'Test Truck',
      driver_id: driver.driver_id,
    });
    assert.ok(vehicle.vehicle_id);
    created.vehicles.push(vehicle.vehicle_id);
  });

  test('duplicate vehicle number is rejected at service level', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('e1');
    const driver = await createTestDriver(owner.owner_id, 'e1');
    const vehicleNum = uniqueVehicle('e1');
    
    await vehicleOwnerService.createOwnerVehicle(owner.owner_id, {
      vehicle_number: vehicleNum,
      vehicle_type: 'TRUCK',
      vehicle_name: 'Test Truck One',
      driver_id: driver.driver_id,
    });
    created.vehicles.push(driver.vehicles?.[0]?.vehicle_id);
    
    await assert.rejects(
      () => vehicleOwnerService.createOwnerVehicle(owner.owner_id, {
        vehicle_number: vehicleNum,
        vehicle_type: 'TRUCK',
        vehicle_name: 'Test Truck Two',
        driver_id: driver.driver_id,
      }),
      { code: 'VEHICLE_ALREADY_EXISTS' }
    );
  });

  test('valid vehicle owner registration with unique mobile is accepted', async () => {
    if (!ready) return skip();
    const mobile = uniqueMobile('f1');
    const owner = await vehicleOwnerService.registerOwner({
      owner_name: 'Owner One',
      mobile,
      city: 'Patna',
      owner_type: 'TRANSPORT_COMPANY',
    });
    assert.ok(owner.owner_id);
    created.owners.push(owner.owner_id);
  });

  test('duplicate vehicle owner mobile is rejected', async () => {
    if (!ready) return skip();
    const mobile = uniqueMobile('g1');
    await vehicleOwnerService.registerOwner({
      owner_name: 'Owner Two',
      mobile,
      city: 'Patna',
      owner_type: 'TRANSPORT_COMPANY',
    });
    
    await assert.rejects(
      () => vehicleOwnerService.registerOwner({
        owner_name: 'Owner Three',
        mobile,
        city: 'Patna',
        owner_type: 'TRANSPORT_COMPANY',
      }),
      { code: 'VEHICLE_OWNER_ALREADY_EXISTS' }
    );
  });
});

describe('Concurrent Duplicate Registration Protection', () => {
  test('concurrent driver registration with same mobile - one succeeds, one fails', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('conc1');
    const mobile = uniqueMobile('conc1');
    const license = uniqueLicense('conc1');
    
    const [result1, result2] = await Promise.allSettled([
      driverService.registerDriver({
        driver_name: 'Concurrent One',
        mobile,
        license_number: license,
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
      driverService.registerDriver({
        driver_name: 'Concurrent Two',
        mobile,
        license_number: uniqueLicense('conc2'),
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
    ]);
    
    const successes = [result1, result2].filter(r => r.status === 'fulfilled');
    const failures = [result1, result2].filter(r => r.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    // Can be either service-level error or Prisma P2002
    assert.ok(failures[0].reason.code === 'DRIVER_ALREADY_EXISTS' || failures[0].reason.code === 'P2002');
    
    if (successes[0].status === 'fulfilled') {
      created.drivers.push(successes[0].value.driver_id);
    }
  });
});

describe('Database Trigger Guards', () => {
  test('driver mobile unique trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_driver_mobile_unique'
    `;
    assert.ok(triggers.length > 0, 'Driver mobile unique trigger should exist');
  });

  test('driver license unique trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_driver_license_unique'
    `;
    assert.ok(triggers.length > 0, 'Driver license unique trigger should exist');
  });

  test('vehicle number unique trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_transport_vehicle_number_unique'
    `;
    assert.ok(triggers.length > 0, 'Vehicle number unique trigger should exist');
  });

  test('vehicle owner mobile unique trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_vehicle_owner_mobile_unique'
    `;
    assert.ok(triggers.length > 0, 'Vehicle owner mobile unique trigger should exist');
  });

  test('driver availability guard trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_driver_availability_guard'
    `;
    assert.ok(triggers.length > 0, 'Driver availability guard trigger should exist');
  });

  test('vehicle assignment guard triggers exist', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name IN ('trg_vehicle_driver_assignment_guard', 'trg_driver_vehicle_assignment_guard')
    `;
    assert.equal(triggers.length, 2, 'Both vehicle assignment guard triggers should exist');
  });

  test('owner delete protection trigger exists', async () => {
    if (!ready) return skip();
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE trigger_name = 'trg_vehicle_owner_delete_protect'
    `;
    assert.ok(triggers.length > 0, 'Owner delete protection trigger should exist');
  });
});

describe('Invalid Format Rejection', () => {
  test('invalid mobile format (not 10 digits) is rejected', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('fmt1');
    await assert.rejects(
      () => driverService.registerDriver({
        driver_name: 'Invalid Mobile Driver',
        mobile: '12345',
        license_number: uniqueLicense('fmt1'),
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
      { code: 'VALIDATION_ERROR' }
    );
  });

  test('mobile not starting with 6-9 is rejected', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('fmt2');
    await assert.rejects(
      () => driverService.registerDriver({
        driver_name: 'Invalid Mobile Driver Two',
        mobile: '5123456789',
        license_number: uniqueLicense('fmt2'),
        license_expiry: VALID_LICENSE_EXPIRY,
        city: 'Patna',
        transport_owner_id: owner.owner_id,
      }),
      { code: 'VALIDATION_ERROR' }
    );
  });

  test('invalid vehicle number format is rejected', async () => {
    if (!ready) return skip();
    const owner = await createTestOwner('fmt3');
    const driver = await createTestDriver(owner.owner_id, 'fmt3');
    await assert.rejects(
      () => vehicleOwnerService.createOwnerVehicle(owner.owner_id, {
        vehicle_number: 'INVALID123',
        vehicle_type: 'TRUCK',
        vehicle_name: 'Invalid Truck',
        driver_id: driver.driver_id,
      }),
      { code: 'VALIDATION_ERROR' }
    );
  });
});
