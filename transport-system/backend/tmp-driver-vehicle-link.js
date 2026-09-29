/**
 * TEMP DIAGNOSTIC 2 — how are drivers actually linked to vehicles in the DB?
 * Driver.current_vehicle_id  vs  TransportVehicle.driver_id
 */
require('dotenv').config();
const { prisma } = require('./config/prisma');

(async () => {
  console.log('=== [A] transport_vehicles raw rows ===');
  const raw = await prisma.$queryRawUnsafe(
    `SELECT vehicle_id, vehicle_number, vehicle_type, driver_id AS tv_driver_id, owner_id, current_status
     FROM transport_vehicles ORDER BY vehicle_id LIMIT 15`
  );
  console.table(raw);

  console.log('=== [B] vehicles whose driver_id column is set ===');
  const linkedByColumn = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM transport_vehicles WHERE driver_id IS NOT NULL`
  );
  console.log(linkedByColumn);

  console.log('=== [C] drivers current_vehicle_id ===');
  const drv = await prisma.$queryRawUnsafe(
    `SELECT driver_id, driver_name, current_vehicle_id, transport_owner_id, status FROM drivers ORDER BY driver_id`
  );
  console.table(drv);

  console.log('=== [D] Prisma relation Driver.currentVehicle ===');
  const rel = await prisma.driver.findMany({
    select: {
      driver_id: true,
      driver_name: true,
      current_vehicle_id: true,
      currentVehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
    },
    orderBy: { driver_id: 'asc' },
  });
  console.log(JSON.stringify(rel, null, 2));

  console.log('=== [E] admin vehicles endpoint filter (TransportVehicle.driver_id column) ===');
  const byCol = await prisma.transportVehicle.findMany({ where: { driver_id: 1 }, select: { vehicle_id: true, vehicle_number: true, driver_id: true } });
  console.log('driver_id=1 ->', JSON.stringify(byCol));

  await prisma.$disconnect();
})();
