/**
 * TEMP DIAGNOSTIC — reproduce GET /api/admin/booking-drivers failure.
 * 1. Run the EXACT findAssignable Prisma query to capture the real exception.
 * 2. Verify real driver/vehicle/owner data exists in PostgreSQL.
 * 3. Report actual drivers table columns.
 */
require('dotenv').config();
const { prisma } = require('./config/prisma');
const DriverRepository = require('./repositories/DriverRepository');

(async () => {
  console.log('=== [1] REAL DB DATA ===');
  try {
    const [driverCount, vehicleCount, ownerCount, partnerCount] = await Promise.all([
      prisma.driver.count(),
      prisma.transportVehicle.count(),
      prisma.vehicleOwner.count(),
      prisma.partner.count(),
    ]);
    console.log({ driverCount, vehicleCount, ownerCount, partnerCount });

    const cols = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name='drivers' ORDER BY ordinal_position`
    );
    console.log('drivers columns:', cols.map((c) => c.column_name).join(', '));
    console.log('HAS vehicle_number col?', cols.some((c) => c.column_name === 'vehicle_number'));
    console.log('HAS vehicle_type col?  ', cols.some((c) => c.column_name === 'vehicle_type'));

    const sample = await prisma.driver.findMany({
      take: 5,
      orderBy: { driver_id: 'asc' },
      select: {
        driver_id: true, driver_code: true, driver_name: true, mobile: true,
        status: true, is_available: true, current_vehicle_id: true, transport_owner_id: true,
      },
    });
    console.log('sample drivers:', JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error('DB DATA ERROR:', e.constructor.name, e.message.split('\n').slice(0, 4).join(' | '));
  }

  console.log('\n=== [2] REPRODUCE findAssignable (current code) ===');
  const repo = new DriverRepository();
  try {
    const r = await repo.findAssignable({ page: 1, limit: 20, search: '', status: '', vehicle_type: '' });
    console.log('OK total=', r.pagination.total, 'rows=', r.drivers.length);
  } catch (e) {
    console.error('FAILED:', e.constructor.name);
    console.error('CODE:', e.code);
    console.error('MESSAGE:', String(e.message).split('\n').slice(0, 6).join('\n'));
  }

  console.log('\n=== [3] REPRODUCE with search filter ===');
  try {
    const r = await repo.findAssignable({ page: 1, limit: 20, search: 'a', status: '', vehicle_type: '' });
    console.log('OK total=', r.pagination.total);
  } catch (e) {
    console.error('FAILED:', e.constructor.name, '|', String(e.message).split('\n')[0]);
  }

  console.log('\n=== [4] REPRODUCE with vehicle_type filter ===');
  try {
    const r = await repo.findAssignable({ page: 1, limit: 20, search: '', status: '', vehicle_type: 'truck' });
    console.log('OK total=', r.pagination.total);
  } catch (e) {
    console.error('FAILED:', e.constructor.name, '|', String(e.message).split('\n')[0]);
  }

  await prisma.$disconnect();
})();
