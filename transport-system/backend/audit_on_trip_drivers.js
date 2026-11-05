/**
 * Audit On Trip Drivers - Find drivers marked On Trip without valid vehicle
 * Run with: node audit_on_trip_drivers.js
 */

const { PrismaClient } = require('@prisma/client');
const { getOperationalActiveTripWhere, getDriverWithOperationalActiveTripsWhere } = require('./utils/operationalTripStatus');

const prisma = new PrismaClient();

async function main() {
  console.log('=== AUDIT: ALL ON TRIP DRIVERS ===\n');

  // 1. Get all drivers with status 'on_trip'
  const onTripDrivers = await prisma.driver.findMany({
    where: { status: 'on_trip' },
    select: {
      driver_id: true,
      driver_name: true,
      driver_code: true,
      status: true,
      current_vehicle_id: true,
      transport_owner_id: true,
      currentVehicle: {
        select: { vehicle_id: true, vehicle_number: true, vehicle_type: true }
      }
    }
  });

  console.log(`Total drivers with status='on_trip': ${onTripDrivers.length}\n`);

  // 2. For each driver, check their operational trips and vehicle assignments
  for (const driver of onTripDrivers) {
    console.log(`\n--- Driver: ${driver.driver_name} (${driver.driver_code || 'no code'}) ID: ${driver.driver_id} ---`);
    console.log(`  DB Status: ${driver.status}`);
    console.log(`  Profile current_vehicle_id: ${driver.current_vehicle_id || 'NULL'}`);
    console.log(`  Profile currentVehicle: ${driver.currentVehicle ? `${driver.currentVehicle.vehicle_number} (${driver.currentVehicle.vehicle_type})` : 'NULL'}`);
    
    // Check transportVehicles via separate query
    const transportVehicles = await prisma.transportVehicle.findMany({
      where: { driver_id: driver.driver_id },
      select: { vehicle_id: true, vehicle_number: true, vehicle_type: true }
    });
    console.log(`  transportVehicles count: ${transportVehicles.length}`);
    transportVehicles.forEach(v => console.log(`    - ${v.vehicle_number} (${v.vehicle_type})`));

    // Get operational trips for this driver
    const opTrips = await prisma.trip.findMany({
      where: {
        driver_id: driver.driver_id,
        ...getOperationalActiveTripWhere()
      },
      select: {
        trip_id: true,
        trip_number: true,
        status: true,
        booking_id: true,
        vehicle_id: true,
        vehicleHire: { select: { hire_id: true } },
        vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } }
      }
    });

    console.log(`  Operational trips: ${opTrips.length}`);
    
    if (opTrips.length === 0) {
      console.log(`  ⚠️  NO OPERATIONAL TRIPS - Driver should NOT be On Trip!`);
    } else {
      for (const trip of opTrips) {
        const hasVehicle = !!trip.vehicle_id || !!trip.vehicleHire;
        const vehicleInfo = trip.vehicle 
          ? `${trip.vehicle.vehicle_number} (${trip.vehicle.vehicle_type})` 
          : (trip.vehicleHire ? `VehicleHire#${trip.vehicleHire.hire_id}` : 'NO VEHICLE');
        
        console.log(`    Trip: ${trip.trip_number} | Status: ${trip.status} | Vehicle: ${vehicleInfo} | Booking: ${trip.booking_id || 'NULL'}`);
        
        if (!hasVehicle && ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(trip.status)) {
          console.log(`      ⚠️  CRITICAL: Trip in ${trip.status} but NO VEHICLE assigned!`);
        }
      }
    }

    // Check if driver has a vehicle through any relationship
    const profileVehicles = await prisma.transportVehicle.findMany({
      where: { driver_id: driver.driver_id },
      select: { vehicle_id: true }
    });
    const hasProfileVehicle = !!driver.current_vehicle_id || profileVehicles.length > 0;
    const hasTripVehicle = opTrips.some(t => !!t.vehicle_id || !!t.vehicleHire);
    
    if (!hasProfileVehicle && !hasTripVehicle) {
      console.log(`  ❌ NO VEHICLE ASSIGNED ANYWHERE - Driver On Trip but no vehicle!`);
    } else if (!hasProfileVehicle && hasTripVehicle) {
      console.log(`  ℹ️  No profile vehicle, but trip has vehicle assignment`);
    }
  }

  // 3. Summary
  console.log('\n=== SUMMARY ===');
  let driversWithNoOpTrips = 0;
  let driversWithNoVehicleAnywhere = 0;
  let driversWithTripButNoVehicle = 0;
  
  for (const driver of onTripDrivers) {
    const opTrips = await prisma.trip.findMany({
      where: { driver_id: driver.driver_id, ...getOperationalActiveTripWhere() },
      select: { trip_id: true, vehicle_id: true, vehicleHire: { select: { hire_id: true } } }
    });
    
    if (opTrips.length === 0) driversWithNoOpTrips++;
    
    const transportVehicles = await prisma.transportVehicle.findMany({
      where: { driver_id: driver.driver_id },
      select: { vehicle_id: true }
    });
    
    const hasProfileVehicle = !!driver.current_vehicle_id || transportVehicles.length > 0;
    const hasTripVehicle = opTrips.some(t => !!t.vehicle_id || !!t.vehicleHire);
    
    if (!hasProfileVehicle && !hasTripVehicle) driversWithNoVehicleAnywhere++;
    if (opTrips.length > 0 && !hasTripVehicle) driversWithTripButNoVehicle++;
  }
  
  console.log(`Drivers with status=on_trip: ${onTripDrivers.length}`);
  console.log(`  - With NO operational trips: ${driversWithNoOpTrips}`);
  console.log(`  - With NO vehicle anywhere (profile + trips): ${driversWithNoVehicleAnywhere}`);
  console.log(`  - With operational trips but NO vehicle on trips: ${driversWithTripButNoVehicle}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});