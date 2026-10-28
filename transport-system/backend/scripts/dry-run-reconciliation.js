/**
 * Dry-run reconciliation script for vehicle/driver assignment conflicts.
 * 
 * This script:
 * 1. Reads all current Trips and assignments
 * 2. Computes expected resource availability from authoritative active Trip relationships
 * 3. Identifies master records whose availability flags disagree with the computed state
 * 4. Detects multiple active assignments
 * 5. Produces a reviewable report before any changes are made
 * 
 * DOES NOT WRITE TO THE DATABASE.
 * 
 * Usage: node scripts/dry-run-reconciliation.js [--apply] [--driver-id=N] [--vehicle-id=N]
 *   --apply          Actually apply fixes (requires explicit confirmation)
 *   --driver-id=N    Filter to specific driver
 *   --vehicle-id=N   Filter to specific vehicle
 *   --confirm        Required with --apply to confirm intentional execution
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const tripStateMachine = require('../utils/TripStateMachine');

const prisma = new PrismaClient();
const ACTIVE_TRIP_STATUSES = tripStateMachine.ACTIVE_TRIP_STATUSES;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirm = args.includes('--confirm');
const driverIdFilter = args.find(a => a.startsWith('--driver-id='))?.split('=')[1];
const vehicleIdFilter = args.find(a => a.startsWith('--vehicle-id='))?.split('=')[1];

if (apply && !confirm) {
  console.error('ERROR: --apply requires --confirm flag for safety');
  process.exit(1);
}

async function main() {
  console.log('=== DRY-RUN RECONCILIATION REPORT ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Mode:', apply ? 'APPLY (with confirmation)' : 'DRY-RUN (read-only)');
  console.log('Centralized ACTIVE_TRIP_STATUSES:', ACTIVE_TRIP_STATUSES.join(', '));
  console.log('');

  // Build where clause
  const where = {
    status: { in: ACTIVE_TRIP_STATUSES }
  };
  
  if (driverIdFilter || vehicleIdFilter) {
    where.OR = [];
    if (driverIdFilter) where.OR.push({ driver_id: parseInt(driverIdFilter, 10) });
    if (vehicleIdFilter) where.OR.push({ vehicle_id: parseInt(vehicleIdFilter, 10) });
  }

  // Get all active trips
  const trips = await prisma.trip.findMany({
    where,
    include: {
      booking: { select: { booking_id: true, booking_number: true, status: true, quote_status: true } },
      vehicle: { select: { vehicle_id: true, vehicle_number: true, is_available: true, current_status: true } },
      driver: { select: { driver_id: true, driver_name: true, is_available: true, status: true } },
      transportOwner: { select: { owner_id: true, owner_name: true } }
    },
    orderBy: { created_at: 'asc' }
  });

  console.log(`\nFound ${trips.length} active trips`);

  // Analyze by driver
  const byDriver = {};
  const byVehicle = {};
  
  trips.forEach(t => {
    if (!byDriver[t.driver_id]) byDriver[t.driver_id] = [];
    byDriver[t.driver_id].push(t);
    
    if (!byVehicle[t.vehicle_id]) byVehicle[t.vehicle_id] = [];
    byVehicle[t.vehicle_id].push(t);
  });

  // Report: Confirmed duplicate assignments
  console.log('\n=== 1. CONFIRMED DUPLICATE ASSIGNMENTS ===');
  let duplicateCount = 0;
  
  Object.entries(byDriver).forEach(([driverId, ts]) => {
    if (ts.length > 1) {
      duplicateCount++;
      const driver = ts[0].driver;
      console.log(`\n  DRIVER ${driverId} (${driver?.driver_name}): ${ts.length} active trips`);
      console.log(`    Master: status=${driver?.status}, is_available=${driver?.is_available}`);
      ts.forEach(t => {
        const evidence = [];
        if (t.loading_completed_at) evidence.push('Loading completed');
        if (t.dispatched_at) evidence.push('Dispatched');
        if (t.arrived_at_destination_at) evidence.push('Arrived');
        if (t.actual_quantity) evidence.push('Qty recorded');
        const ops = evidence.length > 0 ? evidence.join(', ') : 'NO operational evidence';
        console.log(`    - ${t.trip_number} [${t.status}] booking=${t.booking?.booking_number || 'none'} created=${t.created_at.toISOString().split('T')[0]} ops=${ops}`);
      });
      console.log(`    → RECOMMENDATION: Review all ${ts.length} bookings. Only ONE should remain active.`);
    }
  });

  Object.entries(byVehicle).forEach(([vehicleId, ts]) => {
    if (ts.length > 1) {
      duplicateCount++;
      const vehicle = ts[0].vehicle;
      console.log(`\n  VEHICLE ${vehicleId} (${vehicle?.vehicle_number}): ${ts.length} active trips`);
      console.log(`    Master: current_status=${vehicle?.current_status}, is_available=${vehicle?.is_available}`);
      ts.forEach(t => {
        const evidence = [];
        if (t.loading_completed_at) evidence.push('Loading completed');
        if (t.dispatched_at) evidence.push('Dispatched');
        if (t.arrived_at_destination_at) evidence.push('Arrived');
        if (t.actual_quantity) evidence.push('Qty recorded');
        const ops = evidence.length > 0 ? evidence.join(', ') : 'NO operational evidence';
        console.log(`    - ${t.trip_number} [${t.status}] driver=${t.driver?.driver_name} booking=${t.booking?.booking_number || 'none'} created=${t.created_at.toISOString().split('T')[0]} ops=${ops}`);
      });
      console.log(`    → RECOMMENDATION: Review all ${ts.length} bookings. Only ONE should remain active.`);
    }
  });

  if (duplicateCount === 0) {
    console.log('  None found.');
  }

  // Report: Stale availability flags
  console.log('\n=== 2. STALE MASTER AVAILABILITY FLAGS ===');
  
  const allDriverIds = new Set(trips.map(t => t.driver_id).filter(Boolean));
  const allVehicleIds = new Set(trips.map(t => t.vehicle_id).filter(Boolean));
  
  // Check drivers
  for (const driverId of allDriverIds) {
    const driver = await prisma.driver.findUnique({ where: { driver_id: parseInt(driverId, 10) } });
    const hasActive = byDriver[driverId]?.length > 0;
    const computedAvailable = !hasActive;
    const masterAvailable = driver?.is_available === true && driver?.status === 'available';
    
    if (computedAvailable !== masterAvailable) {
      console.log(`\n  DRIVER ${driverId} (${driver?.driver_name}): STALE`);
      console.log(`    Master: status=${driver?.status}, is_available=${driver?.is_available}`);
      console.log(`    Computed: has_active_trips=${hasActive}, should_be_available=${computedAvailable}`);
      console.log(`    → RECOMMENDATION: ${computedAvailable ? 'Set available' : 'Set on_trip/unavailable'}`);
    }
  }
  
  // Check vehicles
  for (const vehicleId of allVehicleIds) {
    const vehicle = await prisma.transportVehicle.findUnique({ where: { vehicle_id: parseInt(vehicleId, 10) } });
    const hasActive = byVehicle[vehicleId]?.length > 0;
    const computedAvailable = !hasActive;
    const masterAvailable = vehicle?.is_available === true && vehicle?.current_status === 'available';
    
    if (computedAvailable !== masterAvailable) {
      console.log(`\n  VEHICLE ${vehicleId} (${vehicle?.vehicle_number}): STALE`);
      console.log(`    Master: current_status=${vehicle?.current_status}, is_available=${vehicle?.is_available}`);
      console.log(`    Computed: has_active_trips=${hasActive}, should_be_available=${computedAvailable}`);
      console.log(`    → RECOMMENDATION: ${computedAvailable ? 'Set available' : 'Set on_trip/unavailable'}`);
    }
  }

  // Report: Potential conflicts requiring human review
  console.log('\n=== 3. POTENTIAL CONFLICTS REQUIRING HUMAN REVIEW ===');
  
  // Trips with no operational evidence but IN_TRANSIT
  const suspiciousTrips = trips.filter(t => 
    t.status === 'IN_TRANSIT' && 
    !t.loading_completed_at && 
    !t.dispatched_at && 
    !t.arrived_at_destination_at &&
    !t.actual_quantity
  );
  
  if (suspiciousTrips.length > 0) {
    console.log('\n  Trips in IN_TRANSIT with NO operational evidence (possible legacy shortcuts):');
    suspiciousTrips.forEach(t => {
      console.log(`    - ${t.trip_number} [${t.status}] driver=${t.driver?.driver_name} vehicle=${t.vehicle?.vehicle_number}`);
      console.log(`      Created: ${t.created_at} | No loading/dispatch/arrival timestamps`);
    });
  }

  // Trips with ASSIGNED status but bookings exist
  const assignedTrips = trips.filter(t => t.status === 'ASSIGNED' && t.booking_id);
  if (assignedTrips.length > 0) {
    console.log('\n  Trips in ASSIGNED status with confirmed bookings (may need hire completion):');
    assignedTrips.forEach(t => {
      console.log(`    - ${t.trip_number} booking=${t.booking?.booking_number} driver=${t.driver?.driver_name}`);
    });
  }

  // Enquiry holds that may conflict
  const enquiries = await prisma.enquiry.findMany({
    where: {
      OR: [
        { assigned_driver_id: { in: Array.from(allDriverIds).map(Number) } },
        { assigned_vehicle_id: { in: Array.from(allVehicleIds).map(Number) } }
      ],
      status: { in: ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'QUOTE_READY', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'] }
    }
  });
  
  if (enquiries.length > 0) {
    console.log('\n  Enquiry holds (reservations) on these resources:');
    enquiries.forEach(e => {
      const tripConflict = trips.find(t => 
        (e.assigned_vehicle_id && t.vehicle_id === e.assigned_vehicle_id) ||
        (e.assigned_driver_id && t.driver_id === e.assigned_driver_id)
      );
      console.log(`    - ${e.enquiry_number} [${e.status}] vehicle=${e.assigned_vehicle_id} driver=${e.assigned_driver_id} pickup=${e.pickup_date?.toISOString().split('T')[0]}`);
      if (tripConflict) {
        console.log(`      ⚠️ CONFLICTS with trip ${tripConflict.trip_number} [${tripConflict.status}]`);
      }
    });
  }

  // Report: Legitimate sequential/historical assignments
  console.log('\n=== 4. LEGITIMATE SEQUENTIAL/HISTORICAL ASSIGNMENTS ===');
  console.log('  (Single active trip per resource - no action needed)');
  
  Object.entries(byDriver).forEach(([driverId, ts]) => {
    if (ts.length === 1) {
      const t = ts[0];
      console.log(`  Driver ${driverId} (${t.driver?.driver_name}): ${t.trip_number} [${t.status}] - OK`);
    }
  });
  
  Object.entries(byVehicle).forEach(([vehicleId, ts]) => {
    if (ts.length === 1) {
      const t = ts[0];
      console.log(`  Vehicle ${vehicleId} (${t.vehicle?.vehicle_number}): ${t.trip_number} [${t.status}] - OK`);
    }
  });

  // Report: Missing/contradictory operational evidence
  console.log('\n=== 5. MISSING OR CONTRADICTORY OPERATIONAL EVIDENCE ===');
  
  trips.forEach(t => {
    const issues = [];
    if (t.status === 'IN_TRANSIT' && !t.dispatched_at) issues.push('IN_TRANSIT without dispatch timestamp');
    if (t.status === 'IN_TRANSIT' && !t.loading_completed_at) issues.push('IN_TRANSIT without loading completion');
    if (t.status === 'DELIVERED' && !t.arrived_at_destination_at) issues.push('DELIVERED without arrival timestamp');
    if (t.dispatched_at && !t.loading_completed_at) issues.push('Dispatched before loading completed');
    if (t.arrived_at_destination_at && !t.dispatched_at) issues.push('Arrived before dispatch');
    
    if (issues.length > 0) {
      console.log(`  ${t.trip_number} [${t.status}]: ${issues.join('; ')}`);
    }
  });

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total active trips: ${trips.length}`);
  console.log(`Drivers with duplicates: ${Object.values(byDriver).filter(ts => ts.length > 1).length}`);
  console.log(`Vehicles with duplicates: ${Object.values(byVehicle).filter(ts => ts.length > 1).length}`);
  console.log(`Stale driver flags: ${Array.from(allDriverIds).filter(id => {
    const d = trips.find(t => t.driver_id === parseInt(id, 10))?.driver;
    const hasActive = byDriver[id]?.length > 0;
    return d && ((hasActive && d.is_available) || (!hasActive && !d.is_available));
  }).length}`);
  console.log(`Stale vehicle flags: ${Array.from(allVehicleIds).filter(id => {
    const v = trips.find(t => t.vehicle_id === parseInt(id, 10))?.vehicle;
    const hasActive = byVehicle[id]?.length > 0;
    return v && ((hasActive && v.is_available) || (!hasActive && !v.is_available));
  }).length}`);
  console.log(`Trips with missing evidence: ${suspiciousTrips.length}`);

  // Apply fixes if requested
  if (apply) {
    console.log('\n=== APPLYING FIXES ===');
    console.log('WARNING: This will modify the database!');
    
    // Fix stale driver flags
    for (const driverId of allDriverIds) {
      const driver = await prisma.driver.findUnique({ where: { driver_id: parseInt(driverId, 10) } });
      const hasActive = byDriver[driverId]?.length > 0;
      const shouldBeAvailable = !hasActive;
      
      if (driver.is_available !== shouldBeAvailable || (hasActive && driver.status !== 'on_trip') || (!hasActive && driver.status !== 'available')) {
        const newStatus = hasActive ? 'on_trip' : 'available';
        console.log(`Updating driver ${driverId} (${driver.driver_name}): is_available=${driver.is_available}→${shouldBeAvailable}, status=${driver.status}→${newStatus}`);
        await prisma.driver.update({
          where: { driver_id: parseInt(driverId, 10) },
          data: { is_available: shouldBeAvailable, status: newStatus }
        });
      }
    }
    
    // Fix stale vehicle flags
    for (const vehicleId of allVehicleIds) {
      const vehicle = await prisma.transportVehicle.findUnique({ where: { vehicle_id: parseInt(vehicleId, 10) } });
      const hasActive = byVehicle[vehicleId]?.length > 0;
      const shouldBeAvailable = !hasActive;
      
      if (vehicle.is_available !== shouldBeAvailable || (hasActive && vehicle.current_status !== 'on_trip') || (!hasActive && vehicle.current_status !== 'available')) {
        const newStatus = hasActive ? 'on_trip' : 'available';
        console.log(`Updating vehicle ${vehicleId} (${vehicle.vehicle_number}): is_available=${vehicle.is_available}→${shouldBeAvailable}, current_status=${vehicle.current_status}→${newStatus}`);
        await prisma.transportVehicle.update({
          where: { vehicle_id: parseInt(vehicleId, 10) },
          data: { is_available: shouldBeAvailable, current_status: newStatus }
        });
      }
    }
    
    console.log('Fixes applied.');
  } else {
    console.log('\n=== DRY-RUN COMPLETE ===');
    console.log('No changes made. Run with --apply --confirm to apply fixes.');
  }
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());