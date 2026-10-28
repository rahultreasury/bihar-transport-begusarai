/**
 * reconcile-availability.js
 * ============================================================================
 * SAFE RECONCILIATION OF DRIVER/VEHICLE AVAILABILITY FLAGS
 *
 * This script corrects stale `is_available` and `status`/`current_status` fields
 * on Driver and TransportVehicle master records to match the authoritative
 * active Trip relationships.
 *
 * SAFETY FEATURES:
 * - Dry-run by default (no writes)
 * - Requires --apply --confirm for actual changes
 * - Production database detection and refusal
 * - All updates in a single database transaction
 * - Precheck verification before any writes
 * - Audit trail via existing AuditLog model
 * - Structured rollback manifest
 * - Concurrent modification protection (conditional updates)
 * - Only updates availability flags; NEVER touches Trips, bookings, enquiries,
 *   VehicleHire, or financial records.
 *
 * USAGE:
 *   node scripts/reconcile-availability.js                    # dry-run
 *   node scripts/reconcile-availability.js --apply --confirm  # apply changes
 *   node scripts/reconcile-availability.js --driver-id=1      # filter to one driver
 *   node scripts/reconcile-availability.js --vehicle-id=1     # filter to one vehicle
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const tripStateMachine = require('../utils/TripStateMachine');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient();
const ACTIVE_TRIP_STATUSES = tripStateMachine.ACTIVE_TRIP_STATUSES;
const RECONCILIATION_BATCH_ID = `reconcile-${Date.now()}`;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirm = args.includes('--confirm');
const dryRun = !apply;
const driverIdFilter = args.find(a => a.startsWith('--driver-id='))?.split('=')[1];
const vehicleIdFilter = args.find(a => a.startsWith('--vehicle-id='))?.split('=')[1];

if (apply && !confirm) {
  console.error('ERROR: --apply requires --confirm flag for safety');
  process.exit(1);
}

if (apply && !dryRun) {
  console.log('=== SAFE RECONCILIATION — APPLY MODE ===');
} else {
  console.log('=== SAFE RECONCILIATION — DRY RUN ===');
}
console.log('Batch ID:', RECONCILIATION_BATCH_ID);
console.log('Timestamp:', new Date().toISOString());
console.log('Database:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown');
console.log('Mode:', dryRun ? 'DRY-RUN (read-only)' : 'APPLY (will write)');
console.log('');

// --- PRODUCTION DATABASE DETECTION ---
function isProductionDatabase() {
  const dbUrl = process.env.DATABASE_URL || '';
  // Common production indicators
  const prodPatterns = [
    /prod/i,
    /production/i,
    /live/i,
    /aws\.rds/i,
    /cloudsql/i,
    /azure\.database/i,
  ];
  return prodPatterns.some(p => p.test(dbUrl));
}

if (apply && isProductionDatabase()) {
  console.error('FATAL: Refusing to run --apply against a production database!');
  console.error('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || 'not set');
  process.exit(1);
}

// --- HELPER: Get active trips for a resource ---
async function getActiveTripsForDriver(driverId) {
  return prisma.trip.findMany({
    where: { driver_id: driverId, status: { in: ACTIVE_TRIP_STATUSES } },
    select: { trip_id: true, trip_number: true, status: true, booking_id: true, created_at: true },
    orderBy: { created_at: 'asc' }
  });
}

async function getActiveTripsForVehicle(vehicleId) {
  return prisma.trip.findMany({
    where: { vehicle_id: vehicleId, status: { in: ACTIVE_TRIP_STATUSES } },
    select: { trip_id: true, trip_number: true, status: true, booking_id: true, driver_id: true, created_at: true },
    orderBy: { created_at: 'asc' }
  });
}

async function getEnquiryHoldsForDriver(driverId) {
  return prisma.enquiry.findMany({
    where: {
      assigned_driver_id: driverId,
      status: { in: ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'] }
    },
    select: { enquiry_id: true, enquiry_number: true, status: true, assigned_vehicle_id: true, pickup_date: true, booking_id: true }
  });
}

async function getEnquiryHoldsForVehicle(vehicleId) {
  return prisma.enquiry.findMany({
    where: {
      assigned_vehicle_id: vehicleId,
      status: { in: ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'] }
    },
    select: { enquiry_id: true, enquiry_number: true, status: true, assigned_driver_id: true, pickup_date: true, booking_id: true }
  });
}

// --- PRECHECK: Verify current state matches expectations ---
async function precheckDrivers(driverIds) {
  console.log('\n--- PRECHECK: DRIVERS ---');
  const results = [];
  for (const id of driverIds) {
    const driver = await prisma.driver.findUnique({ where: { driver_id: id } });
    if (!driver) {
      console.log(`  Driver ${id}: NOT FOUND — SKIP`);
      continue;
    }
    const trips = await getActiveTripsForDriver(id);
    const hasActive = trips.length > 0;
    const expectedAvailable = !hasActive;
    const currentAvailable = driver.is_available === true && driver.status === 'available';
    const needsUpdate = currentAvailable !== expectedAvailable;
    
    const holds = await getEnquiryHoldsForDriver(id);
    const conflictingHolds = holds.filter(h => {
      const tripConflict = trips.find(t => 
        (h.assigned_vehicle_id && t.vehicle_id === h.assigned_vehicle_id) ||
        (h.assigned_driver_id && t.driver_id === h.assigned_driver_id)
      );
      return !!tripConflict;
    });
    
    results.push({
      id,
      name: driver.driver_name,
      currentStatus: driver.status,
      currentAvailable: driver.is_available,
      activeTrips: trips.map(t => ({ id: t.trip_id, number: t.trip_number, status: t.status })),
      hasActiveTrips: hasActive,
      expectedAvailable,
      needsUpdate,
      conflictingHolds: conflictingHolds.map(h => h.enquiry_number),
      currentValues: { status: driver.status, is_available: driver.is_available },
      proposedValues: { status: expectedAvailable ? 'available' : 'on_trip', is_available: expectedAvailable }
    });
    
    console.log(`  Driver ${id} (${driver.driver_name}): status=${driver.status}, is_available=${driver.is_available}, activeTrips=${trips.length}, expectedAvailable=${expectedAvailable}, needsUpdate=${needsUpdate}, conflictingHolds=${conflictingHolds.length}`);
  }
  return results;
}

async function precheckVehicles(vehicleIds) {
  console.log('\n--- PRECHECK: VEHICLES ---');
  const results = [];
  for (const id of vehicleIds) {
    const vehicle = await prisma.transportVehicle.findUnique({ where: { vehicle_id: id } });
    if (!vehicle) {
      console.log(`  Vehicle ${id}: NOT FOUND — SKIP`);
      continue;
    }
    const trips = await getActiveTripsForVehicle(id);
    const hasActive = trips.length > 0;
    const expectedAvailable = !hasActive;
    const currentAvailable = vehicle.is_available === true && vehicle.current_status === 'available';
    const needsUpdate = currentAvailable !== expectedAvailable;
    
    const holds = await getEnquiryHoldsForVehicle(id);
    const conflictingHolds = holds.filter(h => {
      const tripConflict = trips.find(t => 
        (h.assigned_vehicle_id && t.vehicle_id === h.assigned_vehicle_id) ||
        (h.assigned_driver_id && t.driver_id === h.assigned_driver_id)
      );
      return !!tripConflict;
    });
    
    // Check for duplicate assignments
    const driverCounts = {};
    trips.forEach(t => { if (t.driver_id) driverCounts[t.driver_id] = (driverCounts[t.driver_id] || 0) + 1; });
    const duplicateDrivers = Object.entries(driverCounts).filter(([_, c]) => c > 1).map(([d]) => d);
    
    results.push({
      id,
      number: vehicle.vehicle_number,
      currentStatus: vehicle.current_status,
      currentAvailable: vehicle.is_available,
      activeTrips: trips.map(t => ({ id: t.trip_id, number: t.trip_number, status: t.status, driverId: t.driver_id })),
      hasActiveTrips: hasActive,
      expectedAvailable,
      needsUpdate,
      conflictingHolds: conflictingHolds.map(h => h.enquiry_number),
      duplicateDriverAssignments: duplicateDrivers,
      currentValues: { current_status: vehicle.current_status, is_available: vehicle.is_available },
      proposedValues: { current_status: expectedAvailable ? 'available' : 'on_trip', is_available: expectedAvailable }
    });
    
    console.log(`  Vehicle ${id} (${vehicle.vehicle_number}): current_status=${vehicle.current_status}, is_available=${vehicle.is_available}, activeTrips=${trips.length}, expectedAvailable=${expectedAvailable}, needsUpdate=${needsUpdate}, conflictingHolds=${conflictingHolds.length}, duplicateDrivers=${duplicateDrivers.length}`);
  }
  return results;
}

// --- MAIN RECONCILIATION ---
async function reconcile() {
  // Build filter
  const where = { status: { in: ACTIVE_TRIP_STATUSES } };
  if (driverIdFilter) where.driver_id = parseInt(driverIdFilter, 10);
  if (vehicleIdFilter) where.vehicle_id = parseInt(vehicleIdFilter, 10);

  // Get all active trips to determine affected resources
  const trips = await prisma.trip.findMany({
    where,
    select: { driver_id: true, vehicle_id: true },
    distinct: ['driver_id', 'vehicle_id']
  });

  const driverIds = [...new Set(trips.map(t => t.driver_id).filter(Boolean))];
  const vehicleIds = [...new Set(trips.map(t => t.vehicle_id).filter(Boolean))];

  // Apply filters
  const filteredDriverIds = driverIdFilter ? driverIds.filter(id => id === parseInt(driverIdFilter, 10)) : driverIds;
  const filteredVehicleIds = vehicleIdFilter ? vehicleIds.filter(id => id === parseInt(vehicleIdFilter, 10)) : vehicleIds;

  console.log(`Affected drivers: ${filteredDriverIds.length}`);
  console.log(`Affected vehicles: ${filteredVehicleIds.length}`);

  // PRECHECK
  const driverPrecheck = await precheckDrivers(filteredDriverIds);
  const vehiclePrecheck = await precheckVehicles(filteredVehicleIds);

  const driversNeedingUpdate = driverPrecheck.filter(d => d.needsUpdate);
  const vehiclesNeedingUpdate = vehiclePrecheck.filter(v => v.needsUpdate);

  // Flag resources with unresolved conflicts
  const driversWithConflicts = driverPrecheck.filter(d => d.activeTrips.length > 1 || d.conflictingHolds.length > 0);
  const vehiclesWithConflicts = vehiclePrecheck.filter(v => v.activeTrips.length > 1 || v.conflictingHolds.length > 0 || v.duplicateDriverAssignments.length > 0);

  console.log('\n=== SUMMARY ===');
  console.log(`Drivers needing flag update: ${driversNeedingUpdate.length}`);
  console.log(`Vehicles needing flag update: ${vehiclesNeedingUpdate.length}`);
  console.log(`Drivers with unresolved conflicts (duplicates/holds): ${driversWithConflicts.length}`);
  console.log(`Vehicles with unresolved conflicts (duplicates/holds): ${vehiclesWithConflicts.length}`);

  if (driversWithConflicts.length > 0) {
    console.log('\n--- DRIVERS WITH UNRESOLVED CONFLICTS ---');
    driversWithConflicts.forEach(d => {
      console.log(`  Driver ${d.id} (${d.name}): ${d.activeTrips.length} active trips, ${d.conflictingHolds.length} conflicting holds`);
      d.activeTrips.forEach(t => console.log(`    - ${t.number} [${t.status}]`));
    });
  }

  if (vehiclesWithConflicts.length > 0) {
    console.log('\n--- VEHICLES WITH UNRESOLVED CONFLICTS ---');
    vehiclesWithConflicts.forEach(v => {
      console.log(`  Vehicle ${v.id} (${v.number}): ${v.activeTrips.length} active trips, ${v.conflictingHolds.length} conflicting holds, ${v.duplicateDriverAssignments.length} duplicate drivers`);
      v.activeTrips.forEach(t => console.log(`    - ${t.number} [${t.status}] driver=${t.driverId}`));
    });
  }

  // DRY RUN MODE
  if (dryRun) {
    console.log('\n=== DRY RUN COMPLETE ===');
    console.log('No changes made. Run with --apply --confirm to apply changes.');
    console.log('Changes that WOULD be made:');
    driversNeedingUpdate.forEach(d => console.log(`  Driver ${d.id}: ${d.currentValues.status}/${d.currentValues.is_available} -> ${d.proposedValues.status}/${d.proposedValues.is_available}`));
    vehiclesNeedingUpdate.forEach(v => console.log(`  Vehicle ${v.id}: ${v.currentValues.current_status}/${v.currentValues.is_available} -> ${v.proposedValues.current_status}/${v.proposedValues.is_available}`));
    return { driverPrecheck, vehiclePrecheck, driversNeedingUpdate, vehiclesNeedingUpdate };
  }

  // APPLY MODE
  console.log('\n=== APPLYING CHANGES ===');
  console.log('Starting transaction...');

  const rollbackManifest = {
    batchId: RECONCILIATION_BATCH_ID,
    timestamp: new Date().toISOString(),
    driverUpdates: [],
    vehicleUpdates: [],
    executed: false
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Update drivers
      for (const d of driversNeedingUpdate) {
        // Verify current state hasn't changed (conditional update)
        const current = await tx.driver.findUnique({ where: { driver_id: d.id } });
        if (!current) throw new Error(`Driver ${d.id} not found during apply`);
        if (current.status !== d.currentValues.status || current.is_available !== d.currentValues.is_available) {
          throw new Error(`Driver ${d.id} state changed since precheck! Expected status=${d.currentValues.status}, is_available=${d.currentValues.is_available}. Got status=${current.status}, is_available=${current.is_available}. Aborting.`);
        }

        const updated = await tx.driver.update({
          where: { driver_id: d.id },
          data: { status: d.proposedValues.status, is_available: d.proposedValues.is_available }
        });

        rollbackManifest.driverUpdates.push({
          id: d.id,
          originalValues: d.currentValues,
          newValues: { status: updated.status, is_available: updated.is_available }
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            user_id: 1, // system user
            user_role: 'system',
            action: 'availability_reconciliation',
            entity_type: 'Driver',
            entity_id: d.id,
            previous_value: JSON.stringify(d.currentValues),
            new_value: JSON.stringify({ status: updated.status, is_available: updated.is_available }),
            reason: `Availability reconciliation batch ${RECONCILIATION_BATCH_ID}: corrected stale flag based on active Trip relationships`
          }
        });

        console.log(`  Updated Driver ${d.id} (${d.name}): ${d.currentValues.status}/${d.currentValues.is_available} -> ${updated.status}/${updated.is_available}`);
      }

      // Update vehicles
      for (const v of vehiclesNeedingUpdate) {
        const current = await tx.transportVehicle.findUnique({ where: { vehicle_id: v.id } });
        if (!current) throw new Error(`Vehicle ${v.id} not found during apply`);
        if (current.current_status !== v.currentValues.current_status || current.is_available !== v.currentValues.is_available) {
          throw new Error(`Vehicle ${v.id} state changed since precheck! Expected current_status=${v.currentValues.current_status}, is_available=${v.currentValues.is_available}. Got current_status=${current.current_status}, is_available=${current.is_available}. Aborting.`);
        }

        const updated = await tx.transportVehicle.update({
          where: { vehicle_id: v.id },
          data: { current_status: v.proposedValues.current_status, is_available: v.proposedValues.is_available }
        });

        rollbackManifest.vehicleUpdates.push({
          id: v.id,
          originalValues: v.currentValues,
          newValues: { current_status: updated.current_status, is_available: updated.is_available }
        });

        await tx.auditLog.create({
          data: {
            user_id: 1,
            user_role: 'system',
            action: 'availability_reconciliation',
            entity_type: 'TransportVehicle',
            entity_id: v.id,
            previous_value: JSON.stringify(v.currentValues),
            new_value: JSON.stringify({ current_status: updated.current_status, is_available: updated.is_available }),
            reason: `Availability reconciliation batch ${RECONCILIATION_BATCH_ID}: corrected stale flag based on active Trip relationships`
          }
        });

        console.log(`  Updated Vehicle ${v.id} (${v.number}): ${v.currentValues.current_status}/${v.currentValues.is_available} -> ${updated.current_status}/${updated.is_available}`);
      }

      rollbackManifest.executed = true;
    });

    // Write rollback manifest
    const fs = require('fs');
    const manifestPath = `./rollback-manifest-${RECONCILIATION_BATCH_ID}.json`;
    fs.writeFileSync(manifestPath, JSON.stringify(rollbackManifest, null, 2));
    console.log(`\nRollback manifest written to: ${manifestPath}`);

    console.log('\n=== APPLY COMPLETE ===');
    console.log(`Drivers updated: ${driversNeedingUpdate.length}`);
    console.log(`Vehicles updated: ${vehiclesNeedingUpdate.length}`);
    console.log(`Rollback manifest: ${manifestPath}`);

    return { driverPrecheck, vehiclePrecheck, driversNeedingUpdate, vehiclesNeedingUpdate, rollbackManifest };

  } catch (error) {
    console.error('\n=== APPLY FAILED ===');
    console.error('Error:', error.message);
    console.error('Transaction rolled back automatically.');
    throw error;
  }
}

reconcile()
  .catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());