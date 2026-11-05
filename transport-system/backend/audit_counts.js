/**
 * Database Audit Script for Driver/Trip Count Mismatch
 * Run with: node audit_counts.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TERMINAL_TRIP_STATUSES = ['COMPLETED', 'CANCELLED'];
const ACTIVE_TRIP_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'TO_LOADING_POINT',
  'AT_LOADING_POINT',
  'LOADED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
];

async function main() {
  console.log('=== DATABASE AUDIT FOR DRIVER/TRIP COUNT MISMATCH ===\n');

  // 1. Total distinct drivers with at least one active trip (Driver Management definition)
  const driversWithActiveTrips = await prisma.driver.findMany({
    where: {
      trips: {
        some: {
          status: { notIn: TERMINAL_TRIP_STATUSES },
        },
      },
    },
    select: { driver_id: true, driver_name: true, status: true, driver_code: true },
  });
  console.log(`1. Drivers with active trips (non-terminal): ${driversWithActiveTrips.length}`);
  console.log('   Details:', driversWithActiveTrips.map(d => `${d.driver_code} (${d.driver_name}) - status: ${d.status}`).join(', '));

  // 2. Total distinct active trips (Order/Trip Master definition)
  const activeTrips = await prisma.trip.findMany({
    where: {
      status: { in: ACTIVE_TRIP_STATUSES },
    },
    select: { trip_id: true, trip_number: true, status: true, driver_id: true, booking_id: true },
  });
  console.log(`\n2. Active trips (ACTIVE_TRIP_STATUSES): ${activeTrips.length}`);
  console.log('   Details:', activeTrips.map(t => `${t.trip_number} - status: ${t.status}, driver_id: ${t.driver_id}, booking_id: ${t.booking_id}`).join(', '));

  // 3. Active trips with assigned driver
  const activeTripsWithDriver = activeTrips.filter(t => t.driver_id !== null);
  console.log(`\n3. Active trips with assigned driver: ${activeTripsWithDriver.length}`);

  // 4. Active trips without driver
  const activeTripsWithoutDriver = activeTrips.filter(t => t.driver_id === null);
  console.log(`\n4. Active trips WITHOUT driver: ${activeTripsWithoutDriver.length}`);
  if (activeTripsWithoutDriver.length > 0) {
    console.log('   Details:', activeTripsWithoutDriver.map(t => `${t.trip_number} - status: ${t.status}`).join(', '));
  }

  // 5. Drivers whose database status is 'on_trip' but who have no active trip
  const driversOnTripStatus = await prisma.driver.findMany({
    where: { status: 'on_trip' },
    select: { driver_id: true, driver_name: true, driver_code: true },
  });
  console.log(`\n5. Drivers with status='on_trip': ${driversOnTripStatus.length}`);
  
  const driversOnTripNoActive = [];
  for (const driver of driversOnTripStatus) {
    const activeTripCount = await prisma.trip.count({
      where: {
        driver_id: driver.driver_id,
        status: { notIn: TERMINAL_TRIP_STATUSES },
      },
    });
    if (activeTripCount === 0) {
      driversOnTripNoActive.push(driver);
    }
  }
  console.log(`   Drivers with status='on_trip' but NO active trips: ${driversOnTripNoActive.length}`);
  if (driversOnTripNoActive.length > 0) {
    console.log('   Details:', driversOnTripNoActive.map(d => `${d.driver_code} (${d.driver_name})`).join(', '));
  }

  // 6. Drivers marked 'available' who have an active trip
  const driversAvailableStatus = await prisma.driver.findMany({
    where: { status: 'available' },
    select: { driver_id: true, driver_name: true, driver_code: true },
  });
  console.log(`\n6. Drivers with status='available': ${driversAvailableStatus.length}`);
  
  const driversAvailableWithActive = [];
  for (const driver of driversAvailableStatus) {
    const activeTripCount = await prisma.trip.count({
      where: {
        driver_id: driver.driver_id,
        status: { notIn: TERMINAL_TRIP_STATUSES },
      },
    });
    if (activeTripCount > 0) {
      driversAvailableWithActive.push({ ...driver, activeTripCount });
    }
  }
  console.log(`   Drivers with status='available' but HAVE active trips: ${driversAvailableWithActive.length}`);
  if (driversAvailableWithActive.length > 0) {
    console.log('   Details:', driversAvailableWithActive.map(d => `${d.driver_code} (${d.driver_name}) - ${d.activeTripCount} active trips`).join(', '));
  }

  // 7. Duplicate or conflicting driver assignments (multiple active trips per driver)
  console.log('\n7. Drivers with multiple active trips:');
  const driverTripCounts = {};
  for (const trip of activeTrips) {
    if (trip.driver_id) {
      driverTripCounts[trip.driver_id] = (driverTripCounts[trip.driver_id] || 0) + 1;
    }
  }
  const multiTripDrivers = Object.entries(driverTripCounts).filter(([_, count]) => count > 1);
  console.log(`   Drivers with >1 active trip: ${multiTripDrivers.length}`);
  for (const [driverId, count] of multiTripDrivers) {
    const driver = await prisma.driver.findUnique({ where: { driver_id: parseInt(driverId) }, select: { driver_code: true, driver_name: true } });
    console.log(`     ${driver.driver_code} (${driver.driver_name}): ${count} active trips`);
  }

  // 8. Active operational trips missing a corresponding Order/Booking relationship
  const activeTripsNoBooking = activeTrips.filter(t => t.booking_id === null);
  console.log(`\n8. Active trips WITHOUT booking_id: ${activeTripsNoBooking.length}`);
  if (activeTripsNoBooking.length > 0) {
    console.log('   Details:', activeTripsNoBooking.map(t => `${t.trip_number} - status: ${t.status}, driver_id: ${t.driver_id}`).join(', '));
  }

  // 9. Orders classified as active without a qualifying operational Trip
  // Check bookings that are in "active" statuses but don't have active trips
  const activeBookingStatuses = ['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit'];
  const bookingsActiveNoTrip = await prisma.booking.findMany({
    where: {
      status: { in: activeBookingStatuses },
      trips: { none: { status: { in: ACTIVE_TRIP_STATUSES } } },
    },
    select: { booking_id: true, booking_number: true, status: true, driver_id: true, vehicle_id: true },
  });
  console.log(`\n9. Bookings with active status but NO active trip: ${bookingsActiveNoTrip.length}`);
  if (bookingsActiveNoTrip.length > 0) {
    console.log('   Details:', bookingsActiveNoTrip.map(b => `${b.booking_number} - status: ${b.status}, driver_id: ${b.driver_id}, vehicle_id: ${b.vehicle_id}`).join(', '));
  }

  // 10. Trip records incorrectly included in multiple status buckets
  // Check for trips that might be counted in multiple lifecycle buckets
  console.log('\n10. Trip status distribution:');
  const tripStatusCounts = await prisma.trip.groupBy({
    by: ['status'],
    _count: { status: true },
  });
  for (const { status, _count } of tripStatusCounts) {
    console.log(`     ${status}: ${_count.status}`);
  }

  // 11. Booking lifecycle summary counts (what the Order/Trip Master shows)
  console.log('\n11. Booking Lifecycle Summary (Order/Trip Master):');
  const baseWhere = { archived_at: null };
  
  const activeTripsBooking = await prisma.booking.count({
    where: {
      ...baseWhere,
      trips: { some: { status: { in: ACTIVE_TRIP_STATUSES } } },
    },
  });
  
  const vehiclePending = await prisma.booking.count({
    where: {
      ...baseWhere,
      OR: [
        { AND: [{ quote_status: 'ACCEPTED' }, { status: { in: ['confirmed', 'driver_assigned'] } }, { OR: [{ vehicle_id: null }, { driver_id: null }] }] },
        { trips: { some: { status: { in: ['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED'] } } } },
      ],
    },
  });
  
  const inTransit = await prisma.booking.count({
    where: {
      ...baseWhere,
      OR: [
        { status: 'in_transit' },
        { delivery: { is: { current_status: { in: ['in_transit', 'out_for_delivery'] } } } },
        { trips: { some: { status: 'IN_TRANSIT' } } },
      ],
    },
  });
  
  const delivered = await prisma.booking.count({
    where: {
      ...baseWhere,
      OR: [
        { delivery: { is: { current_status: 'out_for_delivery' } } },
        { trips: { some: { status: 'DELIVERED' } } },
      ],
    },
  });
  
  const podPending = await prisma.booking.count({
    where: {
      ...baseWhere,
      OR: [{ status: 'delivered' }, { delivery: { is: { current_status: 'delivered' } } }],
      AND: [
        { trips: { none: { status: 'COMPLETED' } } },
        { trips: { some: { documents_required: { array_contains: 'POD' } } } },
      ],
    },
  });
  
  const completed = await prisma.booking.count({
    where: {
      ...baseWhere,
      OR: [{ status: 'completed' }, { trips: { some: { status: 'COMPLETED' } } }],
    },
  });

  console.log(`     totalOrders: ${await prisma.booking.count({ where: baseWhere })}`);
  console.log(`     activeTrips: ${activeTripsBooking}`);
  console.log(`     vehiclePending: ${vehiclePending}`);
  console.log(`     inTransit: ${inTransit}`);
  console.log(`     delivered: ${delivered}`);
  console.log(`     podPending: ${podPending}`);
  console.log(`     completed: ${completed}`);

  // 12. Driver stats (what Driver Management shows)
  console.log('\n12. Driver Dashboard Stats (Driver Management):');
  const totalDrivers = await prisma.driver.count();
  const availableDrivers = await prisma.driver.count({
    where: {
      status: 'available',
      trips: { none: { status: { notIn: TERMINAL_TRIP_STATUSES } } },
    },
  });
  const onTripDrivers = await prisma.driver.count({
    where: {
      trips: { some: { status: { notIn: TERMINAL_TRIP_STATUSES } } },
    },
  });
  const inactiveDrivers = await prisma.driver.count({ where: { status: 'inactive' } });
  
  console.log(`     total: ${totalDrivers}`);
  console.log(`     available: ${availableDrivers}`);
  console.log(`     onTrip: ${onTripDrivers}`);
  console.log(`     inactive: ${inactiveDrivers}`);

  // 13. Check for VehicleHire records that might create trips
  console.log('\n13. VehicleHire records:');
  const vehicleHires = await prisma.vehicleHire.findMany({
    where: { status: 'ACTIVE' },
    select: { hire_id: true, trip_id: true, booking_id: true, driver_id: true, vehicle_id: true, status: true },
  });
  console.log(`     Active VehicleHires: ${vehicleHires.length}`);
  for (const vh of vehicleHires) {
    console.log(`     hire_id: ${vh.hire_id}, trip_id: ${vh.trip_id}, booking_id: ${vh.booking_id}, driver_id: ${vh.driver_id}, vehicle_id: ${vh.vehicle_id}`);
  }

  // 14. Check for trips with status PENDING that might be pre-operational
  const pendingTrips = await prisma.trip.findMany({
    where: { status: 'PENDING' },
    select: { trip_id: true, trip_number: true, driver_id: true, booking_id: true, vehicle_id: true, vehicleHire: { select: { hire_id: true } } },
  });
  console.log(`\n14. PENDING trips: ${pendingTrips.length}`);
  for (const t of pendingTrips) {
    console.log(`     ${t.trip_number} - driver_id: ${t.driver_id}, booking_id: ${t.booking_id}, vehicle_id: ${t.vehicle_id}, vehicleHire: ${t.vehicleHire ? t.vehicleHire.hire_id : 'none'}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});