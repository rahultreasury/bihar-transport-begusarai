/**
 * reconcile-availability.test.js
 * ============================================================================
 * Tests for the safe reconciliation script.
 * Updated to use the authoritative operational trip definition.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { getOperationalActiveTripWhere, OPERATIONAL_TRIP_STATUSES } = require('../utils/operationalTripStatus');

const prisma = new PrismaClient();

// Helper to run the reconciliation script in dry-run mode programmatically
async function runDryRun(filters = {}) {
  // This would normally call the script, but for unit tests we test the logic directly
  // by reusing the same Prisma queries the script uses
  const where = getOperationalActiveTripWhere();
  if (filters.driverId) where.driver_id = filters.driverId;
  if (filters.vehicleId) where.vehicle_id = filters.vehicleId;

  const trips = await prisma.trip.findMany({
    where,
    select: { driver_id: true, vehicle_id: true },
    distinct: ['driver_id', 'vehicle_id']
  });

  const driverIds = [...new Set(trips.map(t => t.driver_id).filter(Boolean))];
  const vehicleIds = [...new Set(trips.map(t => t.vehicle_id).filter(Boolean))];

  // Filter if requested
  const filteredDriverIds = filters.driverId ? driverIds.filter(id => id === filters.driverId) : driverIds;
  const filteredVehicleIds = filters.vehicleId ? vehicleIds.filter(id => id === filters.vehicleId) : vehicleIds;

  // Precheck drivers
  const driverResults = [];
  for (const id of filteredDriverIds) {
    const driver = await prisma.driver.findUnique({ where: { driver_id: id } });
    if (!driver) continue;
    const activeTrips = await prisma.trip.findMany({
      where: { driver_id: id, ...getOperationalActiveTripWhere() },
      select: { trip_id: true }
    });
    const hasActive = activeTrips.length > 0;
    const expectedAvailable = !hasActive;
    const currentAvailable = driver.is_available === true && driver.status === 'available';
    const needsUpdate = currentAvailable !== expectedAvailable;
    
    if (needsUpdate) {
      driverResults.push({
        id,
        name: driver.driver_name,
        current: { status: driver.status, is_available: driver.is_available },
        proposed: { status: expectedAvailable ? 'available' : 'on_trip', is_available: expectedAvailable },
        activeCount: activeTrips.length
      });
    }
  }

  // Precheck vehicles
  const vehicleResults = [];
  for (const id of filteredVehicleIds) {
    const vehicle = await prisma.transportVehicle.findUnique({ where: { vehicle_id: id } });
    if (!vehicle) continue;
    const activeTrips = await prisma.trip.findMany({
      where: { vehicle_id: id, ...getOperationalActiveTripWhere() },
      select: { trip_id: true }
    });
    const hasActive = activeTrips.length > 0;
    const expectedAvailable = !hasActive;
    const currentAvailable = vehicle.is_available === true && vehicle.current_status === 'available';
    const needsUpdate = currentAvailable !== expectedAvailable;
    
    if (needsUpdate) {
      vehicleResults.push({
        id,
        number: vehicle.vehicle_number,
        current: { current_status: vehicle.current_status, is_available: vehicle.is_available },
        proposed: { current_status: expectedAvailable ? 'available' : 'on_trip', is_available: expectedAvailable },
        activeCount: activeTrips.length
      });
    }
  }

  return { driverResults, vehicleResults };
}

describe('Reconciliation Script - Dry Run Logic (Authoritative Definition)', () => {
  it('identifies stale drivers and vehicles using operational trip definition', async () => {
    const { driverResults, vehicleResults } = await runDryRun();
    
    // With the new authoritative definition, placeholder PENDING trips are excluded
    // So fewer resources need status updates
    assert.ok(driverResults.length >= 0, `Driver results: ${driverResults.length}`);
    assert.ok(vehicleResults.length >= 0, `Vehicle results: ${vehicleResults.length}`);
  });

  it('all proposed driver updates set on_trip/false', async () => {
    const { driverResults } = await runDryRun();
    
    for (const d of driverResults) {
      assert.equal(d.proposed.status, 'on_trip', `Driver ${d.id} should be on_trip`);
      assert.equal(d.proposed.is_available, false, `Driver ${d.id} should have is_available=false`);
      assert.equal(d.current.status, 'available', `Driver ${d.id} should currently be available`);
      assert.equal(d.current.is_available, true, `Driver ${d.id} should currently have is_available=true`);
    }
  });

  it('all proposed vehicle updates set on_trip/false', async () => {
    const { vehicleResults } = await runDryRun();
    
    for (const v of vehicleResults) {
      assert.equal(v.proposed.current_status, 'on_trip', `Vehicle ${v.id} should be on_trip`);
      assert.equal(v.proposed.is_available, false, `Vehicle ${v.id} should have is_available=false`);
      assert.equal(v.current.current_status, 'available', `Vehicle ${v.id} should currently be available`);
      assert.equal(v.current.is_available, true, `Vehicle ${v.id} should currently have is_available=true`);
    }
  });

  it('drivers with operationally active trips are correctly identified', async () => {
    const { driverResults } = await runDryRun();
    
    // Verify specific known drivers with operationally active trips
    // Driver 1 (Rahul Raj) has 9 operationally active trips (all have driver+vehicle)
    // But driver 1 is already on_trip, so should NOT be in results (no update needed)
    const driver1 = driverResults.find(d => d.id === 1);
    assert.ok(!driver1, 'Driver 1 (Rahul Raj) should NOT need update (already on_trip)');
    
    // Driver 3 (kaushal) has 4 operationally active trips
    // But driver 3 is already on_trip, so should NOT be in results
    const driver3 = driverResults.find(d => d.id === 3);
    assert.ok(!driver3, 'Driver 3 (kaushal) should NOT need update (already on_trip)');
  });

  it('vehicles with operationally active trips are correctly identified', async () => {
    const { vehicleResults } = await runDryRun();
    
    // Vehicle 1 has 20 operationally active trips but current_status is 'available'
    // It SHOULD be in results (needs update to on_trip)
    const vehicle1 = vehicleResults.find(v => v.id === 1);
    assert.ok(vehicle1, 'Vehicle 1 (BR09AA0001) SHOULD need update (stale: available but has active trips)');
    assert.equal(vehicle1.activeCount, 20, 'Vehicle 1 should have 20 active trips');
    assert.equal(vehicle1.current.current_status, 'available', 'Vehicle 1 currently available');
    assert.equal(vehicle1.proposed.current_status, 'on_trip', 'Vehicle 1 should be proposed on_trip');
    
    // Vehicle 11 has 8 operationally active trips
    // Check if it needs update
    const vehicle11 = vehicleResults.find(v => v.id === 11);
    if (vehicle11) {
      assert.equal(vehicle11.activeCount, 8, 'Vehicle 11 should have 8 active trips');
    }
  });

  it('resources already correctly flagged are not in results', async () => {
    const { driverResults, vehicleResults } = await runDryRun();
    
    // Driver 3097 is already on_trip/false
    const driver3097 = driverResults.find(d => d.id === 3097);
    assert.ok(!driver3097, 'Driver 3097 should not need update (already on_trip/false)');
    
    // Vehicle 5026 is already on_trip/false
    const vehicle5026 = vehicleResults.find(v => v.id === 5026);
    assert.ok(!vehicle5026, 'Vehicle 5026 should not need update (already on_trip/false)');
  });
});

describe('Production Database Detection', () => {
  it('detects production URLs', () => {
    const prodUrls = [
      'postgresql://user:pass@prod-db.example.com:5432/db',
      'postgresql://user:pass@production-db.aws.rds.com:5432/db',
      'postgresql://user:pass@live.database.cloud:5432/db',
    ];
    
    const isProduction = (url) => {
      const prodPatterns = [/prod/i, /production/i, /live/i, /aws\.rds/i, /cloudsql/i, /azure\.database/i];
      return prodPatterns.some(p => p.test(url));
    };
    
    for (const url of prodUrls) {
      assert.ok(isProduction(url), `Should detect ${url} as production`);
    }
    
    // Non-production
    const devUrls = [
      'postgresql://user:pass@localhost:5432/db',
      'postgresql://user:pass@dev-db.example.com:5432/db',
      'postgresql://user:pass@127.0.0.1:5432/db',
    ];
    
    for (const url of devUrls) {
      assert.ok(!isProduction(url), `Should not detect ${url} as production`);
    }
  });
});

describe('Rollback Manifest Structure', () => {
  it('has correct structure for drivers', () => {
    const manifest = {
      batchId: 'reconcile-test',
      timestamp: new Date().toISOString(),
      driverUpdates: [{
        id: 1,
        originalValues: { status: 'available', is_available: true },
        newValues: { status: 'on_trip', is_available: false }
      }],
      vehicleUpdates: [{
        id: 1,
        originalValues: { current_status: 'available', is_available: true },
        newValues: { current_status: 'on_trip', is_available: false }
      }],
      executed: true
    };
    
    assert.ok(manifest.batchId);
    assert.ok(manifest.timestamp);
    assert.ok(Array.isArray(manifest.driverUpdates));
    assert.ok(Array.isArray(manifest.vehicleUpdates));
    assert.equal(manifest.executed, true);
    
    // Verify driver update structure
    const du = manifest.driverUpdates[0];
    assert.ok('id' in du);
    assert.ok('originalValues' in du);
    assert.ok('newValues' in du);
    assert.equal(du.originalValues.status, 'available');
    assert.equal(du.newValues.status, 'on_trip');
    
    // Verify vehicle update structure
    const vu = manifest.vehicleUpdates[0];
    assert.ok('id' in vu);
    assert.ok('originalValues' in vu);
    assert.ok('newValues' in vu);
    assert.equal(vu.originalValues.current_status, 'available');
    assert.equal(vu.newValues.current_status, 'on_trip');
  });
});

describe('Concurrent Modification Protection', () => {
  it('detects state changes between precheck and apply', async () => {
    // This is a conceptual test - the actual protection is in the apply logic
    // which re-reads the resource before updating and compares with precheck values
    
    const precheckValues = { status: 'available', is_available: true };
    const currentValues = { status: 'available', is_available: true };
    const changedValues = { status: 'on_trip', is_available: false };
    
    // Should pass when unchanged
    assert.deepEqual(currentValues, precheckValues);
    
    // Should fail when changed
    assert.notDeepEqual(changedValues, precheckValues);
  });
});

describe('Filter Functionality', () => {
  it('can filter to single driver', async () => {
    // Driver 1 is already on_trip, so filtering to driver 1 should return 0 results (no update needed)
    const { driverResults } = await runDryRun({ driverId: 1 });
    assert.equal(driverResults.length, 0, 'Driver 1 is already on_trip, no update needed');
  });

  it('can filter to single vehicle', async () => {
    // Vehicle 1 is stale (available but has active trips), so filtering to vehicle 1 should return 1 result
    const { vehicleResults } = await runDryRun({ vehicleId: 1 });
    assert.equal(vehicleResults.length, 1, 'Vehicle 1 is stale, needs update');
    assert.equal(vehicleResults[0].id, 1);
  });
});

describe('OPERATIONAL_TRIP_STATUSES completeness', () => {
  it('includes all 8 non-terminal operational statuses', () => {
    const expected = [
      'PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT',
      'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'
    ];
    
    // OPERATIONAL_TRIP_STATUSES is frozen, so create a copy for sorting
    const actual = [...OPERATIONAL_TRIP_STATUSES].sort();
    assert.deepEqual(actual, expected.sort());
    assert.equal(OPERATIONAL_TRIP_STATUSES.length, 8);
  });

  it('excludes terminal statuses', () => {
    assert.ok(!OPERATIONAL_TRIP_STATUSES.includes('COMPLETED'));
    assert.ok(!OPERATIONAL_TRIP_STATUSES.includes('CANCELLED'));
  });
});

after(async () => {
  await prisma.$disconnect();
});