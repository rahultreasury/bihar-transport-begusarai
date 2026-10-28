/**
 * Data Repair Dry-Run Script for Driver/Trip Count Mismatch
 * Identifies issues and proposes corrections without making changes.
 * Run with: node repair_data_dryrun.js
 * To apply fixes: node repair_data_dryrun.js --apply
 */

const { PrismaClient } = require('@prisma/client');
const {
  getOperationalActiveTripWhere,
  OPERATIONAL_TRIP_STATUSES,
  TERMINAL_TRIP_STATUSES,
  hasOperationalSubstance,
} = require('./utils/operationalTripStatus');

const prisma = new PrismaClient();
const APPLY_FIXES = process.argv.includes('--apply');

async function main() {
  console.log(`=== DATA REPAIR ${APPLY_FIXES ? 'APPLY' : 'DRY-RUN'} ===\n`);

  const report = {
    placeholderTrips: [],
    driversWithMultipleTrips: [],
    tripsWithoutDriver: [],
    driversNeedingStatusSync: [],
    orphanedVehicleHires: [],
  };

  // 1. Identify placeholder PENDING trips (no booking, no vehicleHire, no driver+vehicle)
  console.log('1. PLACEHOLDER PENDING TRIPS (no operational substance):');
  const allPendingTrips = await prisma.trip.findMany({
    where: { status: 'PENDING' },
    select: { trip_id: true, trip_number: true, driver_id: true, booking_id: true, vehicle_id: true, vehicleHire: { select: { hire_id: true } } },
  });

  for (const trip of allPendingTrips) {
    const hasSubstance = hasOperationalSubstance(trip);
    if (!hasSubstance) {
      report.placeholderTrips.push({
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        reason: 'PENDING with no booking_id, no vehicleHire, no driver+vehicle',
        proposedAction: 'CANCEL (set status=CANCELLED, cancelled_at=now)',
      });
      console.log(`   ${trip.trip_number} (trip_id=${trip.trip_id}) - ${report.placeholderTrips[report.placeholderTrips.length-1].reason}`);
    }
  }
  console.log(`   Total: ${report.placeholderTrips.length} placeholder trips\n`);

  // 2. Identify drivers with multiple operationally active trips
  console.log('2. DRIVERS WITH MULTIPLE OPERATIONALLY ACTIVE TRIPS:');
  const opActiveTrips = await prisma.trip.findMany({
    where: getOperationalActiveTripWhere(),
    select: { trip_id: true, trip_number: true, status: true, driver_id: true, booking_id: true },
  });

  const driverTripMap = {};
  for (const trip of opActiveTrips) {
    if (trip.driver_id) {
      if (!driverTripMap[trip.driver_id]) driverTripMap[trip.driver_id] = [];
      driverTripMap[trip.driver_id].push(trip);
    }
  }

  for (const [driverId, trips] of Object.entries(driverTripMap)) {
    if (trips.length > 1) {
      const driver = await prisma.driver.findUnique({ where: { driver_id: parseInt(driverId) }, select: { driver_code: true, driver_name: true } });
      report.driversWithMultipleTrips.push({
        driver_id: parseInt(driverId),
        driver_code: driver?.driver_code,
        driver_name: driver?.driver_name,
        tripCount: trips.length,
        trips: trips.map(t => ({ trip_number: t.trip_number, status: t.status, booking_id: t.booking_id })),
        proposedAction: 'REVIEW - verify if multiple concurrent trips are legitimate',
      });
      console.log(`   ${driver?.driver_code} (${driver?.driver_name}): ${trips.length} active trips`);
      trips.forEach(t => console.log(`     - ${t.trip_number} (${t.status}) booking_id=${t.booking_id}`));
    }
  }
  console.log(`   Total: ${report.driversWithMultipleTrips.length} drivers with multiple trips\n`);

  // 3. Identify operationally active trips without driver
  console.log('3. OPERATIONALLY ACTIVE TRIPS WITHOUT DRIVER:');
  const tripsWithoutDriver = opActiveTrips.filter(t => t.driver_id === null);
  for (const trip of tripsWithoutDriver) {
    report.tripsWithoutDriver.push({
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,
      booking_id: trip.booking_id,
      proposedAction: 'ASSIGN DRIVER or verify if trip should be cancelled',
    });
    console.log(`   ${trip.trip_number} (trip_id=${trip.trip_id}) - status: ${trip.status}, booking_id: ${trip.booking_id}`);
  }
  console.log(`   Total: ${report.tripsWithoutDriver.length} trips without driver\n`);

  // 4. Identify drivers needing status sync (status='on_trip' but no operationally active trips)
  console.log('4. DRIVERS NEEDING STATUS SYNC:');
  const driversOnTrip = await prisma.driver.findMany({
    where: { status: 'on_trip' },
    select: { driver_id: true, driver_name: true, driver_code: true },
  });

  for (const driver of driversOnTrip) {
    const opTripCount = await prisma.trip.count({
      where: { driver_id: driver.driver_id, ...getOperationalActiveTripWhere() },
    });
    if (opTripCount === 0) {
      report.driversNeedingStatusSync.push({
        driver_id: driver.driver_id,
        driver_code: driver.driver_code,
        driver_name: driver.driver_name,
        currentStatus: 'on_trip',
        proposedStatus: 'available',
        proposedAction: 'SYNC status to available (no operationally active trips)',
      });
      console.log(`   ${driver.driver_code} (${driver.driver_name}) - currently on_trip, ${opTripCount} operational trips`);
    }
  }
  console.log(`   Total: ${report.driversNeedingStatusSync.length} drivers need sync\n`);

  // 5. Identify vehicle hires without trip linkage
  console.log('5. VEHICLE HIRES WITHOUT TRIP LINKAGE:');
  const vehicleHires = await prisma.vehicleHire.findMany({
    where: { status: 'ACTIVE' },
    select: { hire_id: true, trip_id: true, booking_id: true, driver_id: true, vehicle_id: true },
  });
  for (const vh of vehicleHires) {
    if (!vh.trip_id) {
      report.orphanedVehicleHires.push({
        hire_id: vh.hire_id,
        booking_id: vh.booking_id,
        driver_id: vh.driver_id,
        vehicle_id: vh.vehicle_id,
        proposedAction: 'LINK TO TRIP or verify if hire should be cancelled',
      });
      console.log(`   hire_id=${vh.hire_id} - no trip_id, booking_id=${vh.booking_id}, driver_id=${vh.driver_id}, vehicle_id=${vh.vehicle_id}`);
    }
  }
  console.log(`   Total: ${report.orphanedVehicleHires.length} orphaned vehicle hires\n`);

  // 6. Summary
  console.log('=== REPAIR SUMMARY ===');
  console.log(`Placeholder trips to cancel: ${report.placeholderTrips.length}`);
  console.log(`Drivers with multiple trips to review: ${report.driversWithMultipleTrips.length}`);
  console.log(`Trips without driver to assign: ${report.tripsWithoutDriver.length}`);
  console.log(`Drivers needing status sync: ${report.driversNeedingStatusSync.length}`);
  console.log(`Orphaned vehicle hires: ${report.orphanedVehicleHires.length}`);

  if (APPLY_FIXES) {
    console.log('\n=== APPLYING FIXES ===\n');

    // Fix 1: Cancel placeholder trips
    if (report.placeholderTrips.length > 0) {
      console.log('Cancelling placeholder trips...');
      for (const item of report.placeholderTrips) {
        await prisma.trip.update({
          where: { trip_id: item.trip_id },
          data: { status: 'CANCELLED', cancelled_at: new Date() },
        });
        console.log(`  Cancelled ${item.trip_number}`);
      }
    }

    // Fix 4: Sync driver statuses
    if (report.driversNeedingStatusSync.length > 0) {
      console.log('\nSyncing driver statuses...');
      for (const item of report.driversNeedingStatusSync) {
        await prisma.driver.update({
          where: { driver_id: item.driver_id },
          data: { status: 'available', is_available: true },
        });
        await prisma.driverTimeline.create({
          data: {
            driver_id: item.driver_id,
            event_type: 'status_changed',
            description: 'Status auto-synced to available (no operationally active trips after cleanup)',
          },
        });
        console.log(`  Synced ${item.driver_code} to available`);
      }
    }

    console.log('\n=== FIXES APPLIED ===');
  } else {
    console.log('\n=== DRY-RUN COMPLETE ===');
    console.log('Run with --apply to execute fixes: node repair_data_dryrun.js --apply');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});