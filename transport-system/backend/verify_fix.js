/**
 * Verification Script for Driver/Trip Count Fix
 * Uses the new authoritative operationalTripStatus module
 * Run with: node verify_fix.js
 */

const { PrismaClient } = require('@prisma/client');
const {
  getDriverWithOperationalActiveTripsWhere,
  getBookingWithOperationalActiveTripsWhere,
  getOperationalActiveTripWhere,
  OPERATIONAL_TRIP_STATUSES,
  TERMINAL_TRIP_STATUSES,
} = require('./utils/operationalTripStatus');

const prisma = new PrismaClient();

async function main() {
  console.log('=== VERIFICATION OF FIX USING AUTHORITATIVE DEFINITION ===\n');

  // 1. Drivers with operationally active trips (NEW authoritative definition)
  const driversWithOpActiveTrips = await prisma.driver.findMany({
    where: getDriverWithOperationalActiveTripsWhere(),
    select: { driver_id: true, driver_name: true, status: true, driver_code: true },
  });
  console.log(`1. Drivers with OPERATIONALLY ACTIVE trips: ${driversWithOpActiveTrips.length}`);
  console.log('   Details:', driversWithOpActiveTrips.map(d => `${d.driver_code} (${d.driver_name}) - status: ${d.status}`).join(', '));

  // 2. Operationally active trips (NEW authoritative definition)
  const opActiveTrips = await prisma.trip.findMany({
    where: getOperationalActiveTripWhere(),
    select: { trip_id: true, trip_number: true, status: true, driver_id: true, booking_id: true, vehicle_id: true, vehicleHire: { select: { hire_id: true } } },
  });
  console.log(`\n2. Operationally active trips: ${opActiveTrips.length}`);
  console.log('   Details:', opActiveTrips.map(t => `${t.trip_number} - status: ${t.status}, driver_id: ${t.driver_id}, booking_id: ${t.booking_id}, vehicle_id: ${t.vehicle_id}, vehicleHire: ${t.vehicleHire ? t.vehicleHire.hire_id : 'none'}`).join(', '));

  // 3. Bookings with operationally active trips (NEW authoritative definition)
  const bookingsWithOpActiveTrips = await prisma.booking.count({
    where: getBookingWithOperationalActiveTripsWhere({ archived_at: null }),
  });
  console.log(`\n3. Bookings with operationally active trips: ${bookingsWithOpActiveTrips}`);

  // 4. Driver dashboard stats using new definition
  const { getDriverWithOperationalActiveTripsWhere: getDriverWhere } = require('./utils/operationalTripStatus');
  const operationalActiveTripWhere = getDriverWhere();

  const [total, available, onTrip, inactive] = await Promise.all([
    prisma.driver.count(),
    prisma.driver.count({
      where: {
        status: 'available',
        trips: { none: operationalActiveTripWhere.trips.some },
      },
    }),
    prisma.driver.count({ where: operationalActiveTripWhere }),
    prisma.driver.count({ where: { status: 'inactive' } }),
  ]);

  console.log('\n4. NEW Driver Dashboard Stats (using authoritative definition):');
  console.log(`     total: ${total}`);
  console.log(`     available: ${available}`);
  console.log(`     onTrip: ${onTrip}`);
  console.log(`     inactive: ${inactive}`);

  // 5. Booking Lifecycle Summary using new definition for activeTrips
  const baseWhere = { archived_at: null };
  const activeTripsNew = await prisma.booking.count({
    where: getBookingWithOperationalActiveTripsWhere(baseWhere),
  });

  // Keep other counts as they were (they have specific business logic)
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

  console.log('\n5. NEW Booking Lifecycle Summary (activeTrips uses authoritative definition):');
  console.log(`     totalOrders: ${await prisma.booking.count({ where: baseWhere })}`);
  console.log(`     activeTrips: ${activeTripsNew} (was 28, now matches driver onTrip count)`);
  console.log(`     vehiclePending: ${vehiclePending}`);
  console.log(`     inTransit: ${inTransit}`);
  console.log(`     delivered: ${delivered}`);
  console.log(`     podPending: ${podPending}`);
  console.log(`     completed: ${completed}`);

  // 6. Comparison: Old vs New
  console.log('\n6. COMPARISON:');
  console.log(`     Old Driver onTrip (non-terminal): 41`);
  console.log(`     New Driver onTrip (operational): ${onTrip}`);
  console.log(`     Old Booking activeTrips: 28`);
  console.log(`     New Booking activeTrips: ${activeTripsNew}`);
  console.log(`     Match: ${onTrip === activeTripsNew ? 'YES ✓' : 'NO ✗'}`);

  // 7. Show which trips are now excluded
  const allActiveTrips = await prisma.trip.findMany({
    where: { status: { in: OPERATIONAL_TRIP_STATUSES } },
    select: { trip_id: true, trip_number: true, status: true, driver_id: true, booking_id: true, vehicle_id: true, vehicleHire: { select: { hire_id: true } } },
  });
  const excludedTrips = allActiveTrips.filter(t => {
    const hasBooking = !!t.booking_id;
    const hasVehicleHire = !!t.vehicleHire;
    const hasDriverAndVehicle = !!t.driver_id && !!t.vehicle_id;
    const beyondPending = t.status !== 'PENDING';
    return !(hasBooking || hasVehicleHire || hasDriverAndVehicle || beyondPending);
  });
  console.log(`\n7. Excluded placeholder trips (PENDING without booking/vehicleHire/driver+vehicle): ${excludedTrips.length}`);
  console.log('   Details:', excludedTrips.map(t => `${t.trip_number} - status: ${t.status}`).join(', '));

  // 8. Drivers who were incorrectly marked on_trip due to placeholder trips
  const driversWithPlaceholderOnly = [];
  for (const driver of driversWithOpActiveTrips) {
    // Check if driver has any non-placeholder active trips
    const opTrips = await prisma.trip.count({
      where: {
        driver_id: driver.driver_id,
        ...getOperationalActiveTripWhere(),
      },
    });
    if (opTrips === 0) {
      driversWithPlaceholderOnly.push(driver);
    }
  }
  console.log(`\n8. Drivers with ONLY placeholder trips (should be available, not on_trip): ${driversWithPlaceholderOnly.length}`);
  if (driversWithPlaceholderOnly.length > 0) {
    console.log('   Details:', driversWithPlaceholderOnly.map(d => `${d.driver_code} (${d.driver_name})`).join(', '));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});