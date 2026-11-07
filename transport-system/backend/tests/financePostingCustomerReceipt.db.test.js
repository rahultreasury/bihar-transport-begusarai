const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const FinancePostingService = require('../services/FinancePostingService');
const { ConflictError, ValidationError } = require('../utils/AppError');

const TAG = `FPCR${process.pid}`;
const ADMIN = { user_id: null, role: 'admin' };

const created = { users: [], owners: [], vehicles: [], drivers: [], trips: [], bookings: [], invoices: [], txs: [] };
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
  await prisma.invoice.deleteMany({ where: { invoice_id: { in: created.invoices } } });
  await prisma.trip.deleteMany({ where: { trip_id: { in: created.trips } } });
  await prisma.booking.deleteMany({ where: { booking_id: { in: created.bookings } } });
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

async function seedInvoice(freight = 50000) {
  const uniqueId = `${process.pid}${Date.now()}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const owner = await prisma.vehicleOwner.create({ data: { owner_name: `FPCR Owner ${uniqueId}`, mobile: generateMobile(uniqueId), owner_type: 'TRANSPORT_COMPANY' } });
  created.owners.push(owner.owner_id);
  const vehicle = await prisma.transportVehicle.create({ data: { vehicle_number: generateVehicleNumber("FPCR", uniqueId), vehicle_type: 'TRUCK', owner_id: owner.owner_id } });
  created.vehicles.push(vehicle.vehicle_id);
  const user = await prisma.user.create({ data: { first_name: 'FPCR', last_name: 'Cust', email: `fpcr.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '1'), password_hash: 'x' } });
  created.users.push(user.user_id);
  const driverUser = await prisma.user.create({ data: { first_name: 'FPCR', last_name: 'Drv', email: `fpcrd.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '2'), password_hash: 'x' } });
  created.users.push(driverUser.user_id);
  const driver = await prisma.driver.create({ data: { user_id: driverUser.user_id, driver_name: `FPCR Drv ${uniqueId}`, mobile: generateMobile(uniqueId + '3'), transport_owner_id: owner.owner_id } });
  created.drivers.push(driver.driver_id);
  const booking = await prisma.booking.create({ data: {
    user_id: user.user_id, booking_number: `FPCR-BK-${uniqueId}`, booking_reference: `FPCR-BK-${uniqueId}`,
    driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, vehicle_owner_id: owner.owner_id,
    pickup_location: 'A', drop_location: 'B', pickup_city: 'A', drop_city: 'B',
    pickup_state: 'Bihar', drop_state: 'Bihar', pickup_date: '2026-10-05', pickup_time: '10:00:00',
    goods_description: 'x', vehicle_type_required: 'Tata 407 14ft', final_price: freight, status: 'confirmed', quote_status: 'ACCEPTED',
  } });
  created.bookings.push(booking.booking_id);
  const trip = await prisma.trip.create({ data: {
    trip_number: `FPCR-T-${uniqueId}`, source_type: 'ONLINE_BOOKING', booking_id: booking.booking_id, user_id: user.user_id,
    transport_owner_id: owner.owner_id, vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id,
    pickup_location: 'A', pickup_city: 'A', drop_location: 'B', drop_city: 'B',
    freight_amount: freight, driver_payment: 1000, status: 'IN_TRANSIT',
  } });
  created.trips.push(trip.trip_id);
  const invoice = await prisma.invoice.create({ data: {
    booking_id: booking.booking_id, trip_id: trip.trip_id, invoice_number: `FPCR-INV-${uniqueId}`,
    final_price: freight, grand_total: freight, total_amount: freight, status: 'GENERATED', payment_status: 'UNPAID',
  } });
  created.invoices.push(invoice.invoice_id);
  return { tripId: trip.trip_id, bookingId: booking.booking_id, invoiceId: invoice.invoice_id, freight };
}

describe('FPCR DB', () => {
  test('full then partial idempotency payload conflict', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice(50000);
    const posting = new FinancePostingService({ prisma });
    const r1 = await posting.recordCustomerReceipt({ amount: 20000, payment_method: 'cash', invoice_id: ctx.invoiceId, idempotency_key: `${TAG}-KEY-${ctx.invoiceId}` }, ADMIN);
    assert.equal(r1.already_recorded, undefined);
    const r2 = await posting.recordCustomerReceipt({ amount: 20000, payment_method: 'cash', invoice_id: ctx.invoiceId, idempotency_key: `${TAG}-KEY-${ctx.invoiceId}` }, ADMIN);
    assert.equal(r2.already_recorded, true);
    await assert.rejects(
      () => posting.recordCustomerReceipt({ amount: 30000, payment_method: 'cash', invoice_id: ctx.invoiceId, idempotency_key: `${TAG}-KEY-${ctx.invoiceId}` }, ADMIN),
      (e) => e instanceof ConflictError
    );
  });

  test('over-allocation rejected', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice(50000);
    const posting = new FinancePostingService({ prisma });
    await posting.recordCustomerReceipt({ amount: 40000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    await assert.rejects(
      () => posting.recordCustomerReceipt({ amount: 20000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN),
      (e) => e instanceof ValidationError
    );
  });
});


describe('FPCR DB ROLLBACK/CONCURRENCY', () => {
  test('journal failure rolls back receipt transaction', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice(50000);
    const posting = new FinancePostingService({ prisma });
    const original = posting.journalService.postJournal.bind(posting.journalService);
    posting.journalService.postJournal = async () => { throw new Error('injected journal failure'); };
    await assert.rejects(
      () => posting.recordCustomerReceipt({ amount: 10000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN),
      /injected journal failure/
    );
    posting.journalService.postJournal = original;
    const count = await prisma.financialTransaction.count({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(count, 0, 'no ledger row remains after rollback');
  });

  test('concurrent over-allocation allows only one receipt', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice(50000);
    const posting = new FinancePostingService({ prisma });
    const results = await Promise.allSettled([
      posting.recordCustomerReceipt({ amount: 30000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN),
      posting.recordCustomerReceipt({ amount: 30000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    assert.equal(fulfilled, 1, 'exactly one receipt succeeds');
    assert.equal(rejected, 1, 'the second is rejected');
  });
});
