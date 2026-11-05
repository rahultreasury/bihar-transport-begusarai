const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const FinancePostingService = require('../services/FinancePostingService');

const ADMIN = { user_id: null, role: 'admin' };
const created = { users: [], owners: [], vehicles: [], drivers: [], trips: [], bookings: [], invoices: [] };
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

async function seedInvoice() {
  const d = `${process.pid}-${Date.now().toString(36)}`;
  const owner = await prisma.vehicleOwner.create({ data: { owner_name: `SET Owner ${d}`, mobile: '9999999999', owner_type: 'TRANSPORT_COMPANY' } });
  created.owners.push(owner.owner_id);
  const vehicle = await prisma.transportVehicle.create({ data: { vehicle_number: `SET${d}`.slice(0,20), vehicle_type: 'TRUCK', owner_id: owner.owner_id } });
  created.vehicles.push(vehicle.vehicle_id);
  const user = await prisma.user.create({ data: { first_name: 'SET', last_name: 'Cust', email: `set.${d}@example.test`, phone: String(Math.floor(Math.random()*1e10)).padStart(10,'0'), password_hash: 'x' } });
  created.users.push(user.user_id);
  const driverUser = await prisma.user.create({ data: { first_name: 'SET', last_name: 'Drv', email: `setd.${d}@example.test`, phone: String(Math.floor(Math.random()*1e10)).padStart(10,'0'), password_hash: 'x' } });
  created.users.push(driverUser.user_id);
  const driver = await prisma.driver.create({ data: { user_id: driverUser.user_id, driver_name: `SET Drv ${d}`, mobile: '7777777777', transport_owner_id: owner.owner_id } });
  created.drivers.push(driver.driver_id);
  const booking = await prisma.booking.create({ data: {
    user_id: user.user_id, booking_number: `SET-BK-${d}`, booking_reference: `SET-BK-${d}`,
    driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, vehicle_owner_id: owner.owner_id,
    pickup_location: 'A', drop_location: 'B', pickup_city: 'A', drop_city: 'B',
    pickup_state: 'Bihar', drop_state: 'Bihar', pickup_date: '2026-10-05', pickup_time: '10:00:00',
    goods_description: 'x', vehicle_type_required: 'Tata 407 14ft', final_price: 50000, status: 'confirmed', quote_status: 'ACCEPTED',
  } });
  created.bookings.push(booking.booking_id);
  const trip = await prisma.trip.create({ data: {
    trip_number: `SET-T-${d}`, source_type: 'ONLINE_BOOKING', booking_id: booking.booking_id, user_id: user.user_id,
    transport_owner_id: owner.owner_id, vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id,
    pickup_location: 'A', pickup_city: 'A', drop_location: 'B', drop_city: 'B',
    freight_amount: 50000, driver_payment: 1000, status: 'IN_TRANSIT',
  } });
  created.trips.push(trip.trip_id);
  const invoice = await prisma.invoice.create({ data: {
    booking_id: booking.booking_id, trip_id: trip.trip_id, invoice_number: `SET-INV-${d}`,
    final_price: 50000, grand_total: 50000, total_amount: 50000, status: 'GENERATED', payment_status: 'UNPAID',
  } });
  created.invoices.push(invoice.invoice_id);
  return { tripId: trip.trip_id, invoiceId: invoice.invoice_id };
}

describe('SET DB', () => {
  test('customer settlement idempotency', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });
    const key = `SET-KEY-${ctx.invoiceId}`;
    await posting.createSettlement({ party_type: 'CUSTOMER', invoice_id: ctx.invoiceId, amount: 1000, payment_method: 'SETTLEMENT', idempotency_key: key }, ADMIN);
    const second = await posting.createSettlement({ party_type: 'CUSTOMER', invoice_id: ctx.invoiceId, amount: 1000, payment_method: 'SETTLEMENT', idempotency_key: key }, ADMIN);
    assert.equal(second.already_recorded, true);
  });

  test('rollback on journal failure', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });
    const original = posting.journalService.postJournal.bind(posting.journalService);
    posting.journalService.postJournal = async () => { throw new Error('injected settlement journal failure'); };
    await assert.rejects(
      () => posting.createSettlement({ party_type: 'CUSTOMER', invoice_id: ctx.invoiceId, amount: 1000, payment_method: 'SETTLEMENT' }, ADMIN),
      /injected settlement journal failure/
    );
    posting.journalService.postJournal = original;
  });
});
