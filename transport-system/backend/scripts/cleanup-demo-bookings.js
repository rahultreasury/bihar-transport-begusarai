#!/usr/bin/env node
/**
 * ============================================================
 * Bihar Transport Begusarai — Cleanup Demo Bookings
 * ============================================================
 *
 * Removes ALL demo/test booking records that were created only
 * for testing the Driver Management module.
 *
 * Demo bookings have references matching pattern: BTB-2024-*
 *
 * This script ONLY deletes demo bookings. Genuine bookings
 * created from the website are NOT touched.
 *
 * Usage: node scripts/cleanup-demo-bookings.js
 * ============================================================
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanup() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Bihar Transport — Cleanup Demo Bookings       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    // Find all demo bookings (references starting with BTB-2024-)
    const demoBookings = await prisma.booking.findMany({
      where: {
        booking_reference: {
          startsWith: 'BTB-2024-',
        },
      },
      select: {
        booking_id: true,
        booking_reference: true,
      },
    });

    if (demoBookings.length === 0) {
      console.log('✅ No demo bookings found. Nothing to clean up.\n');
      await prisma.$disconnect();
      return;
    }

    console.log(`🔍 Found ${demoBookings.length} demo booking(s) to remove:\n`);
    demoBookings.forEach(b => console.log(`   • ${b.booking_reference} (ID: ${b.booking_id})`));
    console.log('');

    const demoIds = demoBookings.map(b => b.booking_id);

    // Delete in reverse dependency order within a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Delete booking_assignments linked to demo bookings
      const deletedAssignments = await tx.bookingAssignment.deleteMany({
        where: { booking_id: { in: demoIds } },
      });
      console.log(`   🗑️  Deleted ${deletedAssignments.count} booking assignment(s)`);

      // 2. Delete booking_events linked to demo bookings
      const deletedEvents = await tx.bookingEvent.deleteMany({
        where: { booking_id: { in: demoIds } },
      });
      console.log(`   🗑️  Deleted ${deletedEvents.count} booking event(s)`);

      // 3. Delete deliveries linked to demo bookings
      const deletedDeliveries = await tx.delivery.deleteMany({
        where: { booking_id: { in: demoIds } },
      });
      console.log(`   🗑️  Deleted ${deletedDeliveries.count} delivery record(s)`);

      // 4. Finally delete the demo bookings themselves
      const deletedBookings = await tx.booking.deleteMany({
        where: { booking_id: { in: demoIds } },
      });
      console.log(`   🗑️  Deleted ${deletedBookings.count} booking record(s)`);
    });

    console.log('\n✅ Cleanup complete! Demo bookings removed successfully.\n');
    console.log('📋 Summary:');
    console.log('   ─────────────────────────────────────────────');
    console.log(`   Demo bookings removed:     ${demoBookings.length}`);
    console.log(`   Genuine bookings:          Untouched ✅`);
    console.log(`   Booking Management table:  Clean ✅`);
    console.log('   ─────────────────────────────────────────────\n');

  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message);
    if (error.meta) console.error('Meta:', JSON.stringify(error.meta));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();

