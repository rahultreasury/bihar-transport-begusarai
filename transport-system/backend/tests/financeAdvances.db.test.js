const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const FinancePostingService = require('../services/FinancePostingService');
const { ConflictError } = require('../utils/AppError');

const ADMIN = { user_id: null, role: 'admin' };
const created = { users: [], owners: [], vehicles: [], drivers: [], trips: [], invoices: [] };
let ready = false;
let skipReason = 'live PostgreSQL not probed yet';

before(async () => {
  if (!process.env.DATABASE_URL) { skipReason = 'DATABASE_URL is not set'; return; }
  try { await prisma.$queryRaw`SELECT 1`; ready = true; skipReason = null; }
  catch (e) { skipReason = `live PostgreSQL unavailable: ${String(e.message).split('\n')[0]}`; }
});

after(async () => {
  if (!ready) return;
  await prisma.financialTransaction.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.transportVehicle.deleteMany({ where: { vehicle_id: { in: created.vehicles } } });
  await prisma.driver.deleteMany({ where: { driver_id: { in: created.drivers } } });
  await prisma.vehicleOwner.deleteMany({ where: { owner_id: { in: created.owners } } });
  await prisma.user.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.$disconnect();
});

function skip() { return { skip: skipReason }; }


/**
 * Generate a valid Indian vehicle registration number.
 * Format: BR + 2-digit RTO (01-99) + 1-2 letters (A-Z) + 4 digits
 * e.g., BR01AB1234, BR09A1234, BR12CD5678
 */
function generateVehicleNumber(prefix, uniqueId) {
  const numeric = String(uniqueId).replace(/\D/g, '').slice(-8).padStart(8, '0');
  const rto = String(Number(numeric.slice(0, 2)) % 99 + 1).padStart(2, '0');
  const seriesNum = Number(numeric.slice(2, 4)) % 676;
  const series = String.fromCharCode(65 + Math.floor(seriesNum / 26)) + String.fromCharCode(65 + (seriesNum % 26));
  const num = numeric.slice(4, 8);
  return `BR${rto}${series}${num}`;
}

/**
 * Generate a unique valid mobile number (10 digits, starting with 6-9).
 */
function generateMobile(uniqueId) {
  const numeric = String(uniqueId).replace(/\D/g, '');
  // Need 10 digits total: first digit 6-9 + 9 more digits
  // Take last 10 digits, if fewer pad with zeros
  const tenDigits = numeric.slice(-10).padStart(10, '0');
  const firstDigit = String(6 + (Number(tenDigits[0]) % 4)); // 6,7,8,9
  return firstDigit + tenDigits.slice(1);
}

async function seedTrip() {
  const uniqueId = `${process.pid}${Date.now()}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const owner = await prisma.vehicleOwner.create({ data: { owner_name: `ADV Owner ${uniqueId}`, mobile: generateMobile(uniqueId), owner_type: 'TRANSPORT_COMPANY' } });
  created.owners.push(owner.owner_id);
  const vehicle = await prisma.transportVehicle.create({ data: { vehicle_number: generateVehicleNumber("ADV", uniqueId), vehicle_type: 'TRUCK', owner_id: owner.owner_id } });
  created.vehicles.push(vehicle.vehicle_id);
  const user = await prisma.user.create({ data: { first_name: 'ADV', last_name: 'Cust', email: `adv.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '1'), password_hash: 'x' } });
  created.users.push(user.user_id);
  const driverUser = await prisma.user.create({ data: { first_name: 'ADV', last_name: 'Drv', email: `advd.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '2'), password_hash: 'x' } });
  created.users.push(driverUser.user_id);
  const driver = await prisma.driver.create({ data: { user_id: driverUser.user_id, driver_name: `ADV Drv ${uniqueId}`, mobile: generateMobile(uniqueId + '3'), transport_owner_id: owner.owner_id } });
  created.drivers.push(driver.driver_id);
  const trip = await prisma.trip.create({ data: {
    trip_number: `ADV-T-${uniqueId}`, source_type: 'ONLINE_BOOKING', user_id: user.user_id,
    transport_owner_id: owner.owner_id, vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id,
    pickup_location: 'A', pickup_city: 'A', drop_location: 'B', drop_city: 'B',
    freight_amount: 50000, driver_payment: 1000, status: 'IN_TRANSIT',
  } });
  created.trips.push(trip.trip_id);
  return { tripId: trip.trip_id };
}

describe('ADV DB', () => {
  test('customer advance idempotency', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip();
    const posting = new FinancePostingService({ prisma });
    const key = `ADV-KEY-${ctx.tripId}`;
    await posting.createAdvance({ trip_id: ctx.tripId, amount: 1000, payment_method: 'cash', party_type: 'CUSTOMER', idempotency_key: key }, ADMIN);
    const second = await posting.createAdvance({ trip_id: ctx.tripId, amount: 1000, payment_method: 'cash', party_type: 'CUSTOMER', idempotency_key: key }, ADMIN);
    assert.equal(second.already_recorded, true);
  });

  test('rollback on journal failure', async () => {
    if (!ready) return skip();
    const ctx = await seedTrip();
    const posting = new FinancePostingService({ prisma });
    const original = posting.journalService.postJournal.bind(posting.journalService);
    posting.journalService.postJournal = async () => { throw new Error('injected advance journal failure'); };
    await assert.rejects(
      () => posting.createAdvance({ trip_id: ctx.tripId, amount: 1000, payment_method: 'cash', party_type: 'CUSTOMER' }, ADMIN),
      /injected advance journal failure/
    );
    posting.journalService.postJournal = original;
  });
});
