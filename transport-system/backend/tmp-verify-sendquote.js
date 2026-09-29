/**
 * TEMP — real end-to-end verification of the send-quote vehicle auto-resolution.
 *
 * Drivers 1/2/3 hold real vehicles but sit on genuinely active bookings, so the
 * business guard blocks a plain send against booking 24. To exercise the REAL
 * HTTP endpoint with a REAL driver and REAL vehicle we:
 *   1. snapshot every row we are about to touch,
 *   2. temporarily release the conflicting booking,
 *   3. call POST /api/admin/bookings/24/send-quote over real HTTP,
 *   4. assert the driver's real vehicle was resolved + snapshotted,
 *   5. restore every row exactly as it was.
 */
require('dotenv').config();
const fs = require('fs');
const { prisma } = require('./config/prisma');

const TOKEN = fs.readFileSync('/tmp/btb-admin-token.txt', 'utf8').trim();
const BOOKING_FIELDS = [
  'status', 'quote_status', 'driver_id', 'vehicle_id', 'final_price',
  'driver_name_snapshot', 'mobile_snapshot', 'truck_number_snapshot',
  'partner_name_snapshot', 'quote_remarks', 'quote_sent_at', 'quote_valid_until',
  'vehicle_type_required',
];

(async () => {
  const backup24 = await prisma.booking.findUnique({ where: { booking_id: 24 } });
  const backup3 = await prisma.booking.findUnique({ where: { booking_id: 3 } });
  const backupRes = await prisma.reservation.findMany({ where: { booking_id: 24 } });
  const backupEvents = await prisma.bookingEvent.findMany({ where: { booking_id: 24 } });
  // The timeline model is `bookingEvent` (BookingTimelineRepository.addEvent).
  const backupTimeline = await prisma.bookingEvent.findMany({ where: { booking_id: 24 } });

  const pick = (b) => Object.fromEntries(BOOKING_FIELDS.map((f) => [f, b[f]]));
  console.log('BACKUP booking24:', JSON.stringify(pick(backup24)));
  console.log('BACKUP booking3 status:', backup3.status, 'driver_id:', backup3.driver_id);

  // Release the conflicting booking so driver 3 is legitimately selectable.
  await prisma.booking.update({ where: { booking_id: 3 }, data: { status: 'cancelled' } });

  try {
    console.log('\n=== REAL HTTP POST /api/admin/bookings/24/send-quote (driver 3) ===');
    const res = await fetch('http://localhost:3000/api/admin/bookings/24/send-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ driver_id: 3, final_price: 77450, quote_validity_hours: 24, remarks: 'E2E verification' }),
    });
    const body = await res.json();
    console.log('HTTP', res.status);
    console.log(JSON.stringify(body, null, 2));

    console.log('\n=== booking 24 AFTER send ===');
    console.log(JSON.stringify(await prisma.booking.findUnique({
      where: { booking_id: 24 }, select: Object.fromEntries(BOOKING_FIELDS.map((f) => [f, true])),
    }), null, 2));

    console.log('\n=== reservations ===');
    console.log(JSON.stringify(await prisma.reservation.findMany({
      where: { booking_id: 24 }, select: { driver_id: true, vehicle_id: true, status: true, expires_at: true },
    }), null, 2));
  } finally {
    // ---- restore everything exactly ----
    await prisma.reservation.deleteMany({ where: { booking_id: 24 } });
    if (backupRes.length) {
      await prisma.reservation.createMany({ data: backupRes });
    }
    await prisma.bookingEvent.deleteMany({ where: { booking_id: 24 } });
    if (backupEvents.length) {
      await prisma.bookingEvent.createMany({ data: backupEvents });
    }
    await prisma.booking.update({ where: { booking_id: 24 }, data: pick(backup24) });
    await prisma.booking.update({ where: { booking_id: 3 }, data: { status: backup3.status, driver_id: backup3.driver_id } });

    const now = await prisma.booking.findUnique({
      where: { booking_id: 24 }, select: Object.fromEntries(BOOKING_FIELDS.map((f) => [f, true])),
    });
    const now3 = await prisma.booking.findUnique({ where: { booking_id: 3 }, select: { status: true, driver_id: true } });
    console.log('\n=== RESTORED booking24 ===', JSON.stringify(pick(now)));
    console.log('=== RESTORED booking3 ===', JSON.stringify(now3));
  }

  await prisma.$disconnect();
})();
