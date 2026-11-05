/**
 * Quick diagnostic script to reproduce the GET /api/admin/bookings 500 error.
 * Run: node test-bookings-error.js
 */

require('dotenv').config({ path: '.env' });
const { prisma } = require('./config/prisma');
const BookingRepository = require('./repositories/BookingRepository');

async function main() {
  console.log('[TEST] Starting diagnostic...');
  
  // Test DB connection
  try {
    await prisma.$queryRaw`SELECT 1 as connected`;
    console.log('[TEST] DB connection OK');
  } catch (err) {
    console.error('[TEST] DB connection FAILED:', err.message);
    process.exit(1);
  }

  // Test the exact query from BookingRepository.listBookings
  const repo = new BookingRepository();
  try {
    console.log('[TEST] Calling repo.listBookings({ page: 1, limit: 20 })...');
    const result = await repo.listBookings({ page: 1, limit: 20 });
    console.log('[TEST] SUCCESS. Result count:', result.data.length);
    console.log('[TEST] Pagination:', result.pagination);
  } catch (err) {
    console.error('[TEST] ERROR in listBookings:');
    console.error('  Name:', err.name);
    console.error('  Code:', err.code);
    console.error('  Message:', err.message);
    console.error('  Stack:', err.stack);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[TEST] Unhandled error:', err);
  process.exit(1);
});
