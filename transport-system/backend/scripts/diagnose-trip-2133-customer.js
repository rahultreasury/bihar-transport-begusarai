/**
 * scripts/diagnose-trip-2133-customer.js
 * ---------------------------------------------------------------------------
 * A STRICTLY READ-ONLY trace of Trip 2133's customer chain.
 *
 * WHY
 *   The Vehicle page reported `Customer: —` for this trip. A missing label must
 *   never be papered over with a hidden field: the question is whether the trip
 *   genuinely has no customer, or whether the name exists somewhere the read
 *   path never looked. This answers that with the trip's REAL relations rather
 *   than an assumption.
 *
 * WHAT IT READS (nothing is written)
 *   trips ──▶ client_id, user_id, booking_id, enquiry_id
 *   clients / users / bookings  (the two real master relations + the order)
 *   enquiries                   (the fallback for an enquiry-raised trip)
 *   vehicle_hires               (whether a hire already exists)
 *   then it calls the REAL `getHireContext` and prints what the hire workspace
 *   would actually show.
 *
 * Run: node scripts/diagnose-trip-2133-customer.js [tripId]
 * LOCAL ONLY. Opens no write transaction.
 */

require('dotenv').config();

const { prisma } = require('../config/prisma');
const { VehicleHireWorkflowService } = require('../services/VehicleHireWorkflowService');

const tripId = Number.parseInt(process.argv[2] || '2133', 10);

function line(label, value) {
  console.log(`  ${String(label).padEnd(26)} ${value === null || value === undefined || value === '' ? '(none)' : value}`);
}

async function main() {
  console.log(`\n═══ TRIP ${tripId} — customer chain (read-only) ═══\n`);

  const trip = await prisma.trip.findUnique({
    where: { trip_id: tripId },
    select: {
      trip_id: true,
      trip_number: true,
      status: true,
      pickup_city: true,
      drop_city: true,
      client_id: true,
      user_id: true,
      booking_id: true,
      enquiry_id: true,
      vehicle_id: true,
      driver_id: true,
      transport_owner_id: true,
    },
  });

  if (!trip) {
    console.log(`  No trip with id ${tripId}.`);
    return;
  }

  console.log('THE TRIP');
  line('trip_id', trip.trip_id);
  line('trip_number', trip.trip_number);
  line('status', trip.status);
  line('route', `${trip.pickup_city} → ${trip.drop_city}`);
  line('client_id', trip.client_id);
  line('user_id', trip.user_id);
  line('booking_id', trip.booking_id);
  line('enquiry_id', trip.enquiry_id);
  line('vehicle_id', trip.vehicle_id);
  line('driver_id', trip.driver_id);
  line('transport_owner_id', trip.transport_owner_id);

  console.log('\nRELATION 1 — clients (trip.client_id)');
  const client = trip.client_id
    ? await prisma.client.findUnique({ where: { client_id: trip.client_id } }).catch(() => null)
    : null;
  line('found', Boolean(client));
  if (client) {
    line('company_name', client.company_name);
    line('client_name', client.client_name);
    line('mobile', client.mobile || client.phone);
  }

  console.log('\nRELATION 2 — users (trip.user_id)');
  const user = trip.user_id
    ? await prisma.user.findUnique({ where: { user_id: trip.user_id } }).catch(() => null)
    : null;
  line('found', Boolean(user));
  if (user) {
    line('full_name', user.full_name);
    line('phone', user.phone);
  }

  console.log('\nRELATION 3 — bookings (trip.booking_id)');
  const booking = trip.booking_id
    ? await prisma.booking.findUnique({
        where: { booking_id: trip.booking_id },
        select: { booking_id: true, booking_number: true, customer_name: true, customer_mobile: true, client_id: true, user_id: true },
      }).catch(() => null)
    : null;
  line('found', Boolean(booking));
  if (booking) {
    line('booking_number', booking.booking_number);
    line('customer_name', booking.customer_name);
    line('customer_mobile', booking.customer_mobile);
    line('booking.client_id', booking.client_id);
    line('booking.user_id', booking.user_id);
  }

  console.log('\nRELATION 4 — enquiries (trip.enquiry_id, the scalar fallback)');
  const enquiry = trip.enquiry_id
    ? await prisma.enquiry.findUnique({
        where: { enquiry_id: trip.enquiry_id },
        select: { enquiry_id: true, enquiry_number: true, customer_name: true, customer_mobile: true, booking_id: true },
      }).catch(() => null)
    : null;
  line('found', Boolean(enquiry));
  if (enquiry) {
    line('enquiry_number', enquiry.enquiry_number);
    line('customer_name', enquiry.customer_name);
    line('customer_mobile', enquiry.customer_mobile);
    line('enquiry.booking_id', enquiry.booking_id);
  }

  console.log('\nEXISTING VEHICLE HIRE');
  const hire = await prisma.vehicleHire.findUnique({
    where: { trip_id: tripId },
    include: {
      vehicle: { select: { vehicle_number: true } },
      vendor: { select: { owner_name: true } },
      driver: { select: { driver_name: true } },
    },
  }).catch(() => null);
  line('vehicle_hire exists', Boolean(hire));
  if (hire) {
    line('challan_number', hire.challan_number);
    line('vehicle', hire.vehicle?.vehicle_number);
    line('vendor', hire.vendor?.owner_name);
    line('driver', hire.driver?.driver_name);
    line('gross_hire', hire.gross_hire);
    line('commission_amount', hire.commission_amount);
    line('net_vendor_payable', hire.net_vendor_payable);
  }

  console.log('\nWHAT THE HIRE WORKSPACE WILL SHOW (real getHireContext)');
  const service = new VehicleHireWorkflowService(prisma);
  try {
    const ctx = await service.getHireContext(tripId);
    line('customer.name', ctx.customer?.name);
    line('customer.source', ctx.customer?.source);
    line('customer.mobile', ctx.customer?.mobile);
    line('enquiry_number', ctx.customer?.enquiry_number);
    line('can_hire', ctx.can_hire);
    line('blocked_reason', ctx.blocked_reason);
    line('existing_hire', Boolean(ctx.existing_hire));
    line('documents known', ctx.documents?.documents?.length);
  } catch (err) {
    console.log(`  getHireContext threw: ${err.message}`);
  }

  console.log('');
}

main()
  .catch((err) => {
    console.error('diagnostic failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
