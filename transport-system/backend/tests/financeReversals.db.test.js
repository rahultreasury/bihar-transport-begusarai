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

async function seedInvoice() {
  const uniqueId = `${process.pid}${Date.now()}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const owner = await prisma.vehicleOwner.create({ data: { owner_name: `REV Owner ${uniqueId}`, mobile: generateMobile(uniqueId), owner_type: 'TRANSPORT_COMPANY' } });
  created.owners.push(owner.owner_id);
  const vehicle = await prisma.transportVehicle.create({ data: { vehicle_number: generateVehicleNumber("REV", uniqueId), vehicle_type: 'TRUCK', owner_id: owner.owner_id } });
  created.vehicles.push(vehicle.vehicle_id);
  const user = await prisma.user.create({ data: { first_name: 'REV', last_name: 'Cust', email: `rev.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '1'), password_hash: 'x' } });
  created.users.push(user.user_id);
  const driverUser = await prisma.user.create({ data: { first_name: 'REV', last_name: 'Drv', email: `revd.${uniqueId}@example.test`, phone: generateMobile(uniqueId + '2'), password_hash: 'x' } });
  created.users.push(driverUser.user_id);
  const driver = await prisma.driver.create({ data: { user_id: driverUser.user_id, driver_name: `REV Drv ${uniqueId}`, mobile: generateMobile(uniqueId + '3'), transport_owner_id: owner.owner_id } });
  created.drivers.push(driver.driver_id);
  const booking = await prisma.booking.create({ data: {
    user_id: user.user_id, booking_number: `REV-BK-${uniqueId}`, booking_reference: `REV-BK-${uniqueId}`,
    driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, vehicle_owner_id: owner.owner_id,
    pickup_location: 'A', drop_location: 'B', pickup_city: 'A', drop_city: 'B',
    pickup_state: 'Bihar', drop_state: 'Bihar', pickup_date: '2026-10-05', pickup_time: '10:00:00',
    goods_description: 'x', vehicle_type_required: 'Tata 407 14ft', final_price: 50000, status: 'confirmed', quote_status: 'ACCEPTED',
  } });
  created.bookings.push(booking.booking_id);
  const trip = await prisma.trip.create({ data: {
    trip_number: `REV-T-${uniqueId}`, source_type: 'ONLINE_BOOKING', booking_id: booking.booking_id, user_id: user.user_id,
    transport_owner_id: owner.owner_id, vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id,
    pickup_location: 'A', pickup_city: 'A', drop_location: 'B', drop_city: 'B',
    freight_amount: 50000, driver_payment: 1000, status: 'IN_TRANSIT',
  } });
  created.trips.push(trip.trip_id);
  const invoice = await prisma.invoice.create({ data: {
    booking_id: booking.booking_id, trip_id: trip.trip_id, invoice_number: `REV-INV-${uniqueId}`,
    final_price: 50000, grand_total: 50000, total_amount: 50000, status: 'GENERATED', payment_status: 'UNPAID',
  } });
  created.invoices.push(invoice.invoice_id);
  return { tripId: trip.trip_id, invoiceId: invoice.invoice_id };
}

describe('REV DB', () => {
  test('reverse transaction and reject duplicate', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });
    const receipt = await posting.recordCustomerReceipt({ amount: 10000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    const rev = await posting.reverseTransaction(receipt.transaction.transaction_id, { reason: 'test reversal reason' }, ADMIN);
    assert.ok(rev.reversal.transaction_id);
    await assert.rejects(
      () => posting.reverseTransaction(receipt.transaction.transaction_id, { reason: 'second reversal reason' }, ADMIN),
      /already been reversed/
    );
  });

  test('reversal of a reversal is rejected', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });
    const receipt = await posting.recordCustomerReceipt({ amount: 10000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    const rev = await posting.reverseTransaction(receipt.transaction.transaction_id, { reason: 'first reversal' }, ADMIN);
    await assert.rejects(
      () => posting.reverseTransaction(rev.reversal.transaction_id, { reason: 'reversal of reversal should fail' }, ADMIN),
      /A reversal transaction cannot be reversed/
    );
  });

  test('invoice paid_at cleared on PAID to PARTIALLY_PAID transition', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });

    // Create partial payment (PARTIALLY_PAID) first
    await posting.recordCustomerReceipt({ amount: 25000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    let invoice = await prisma.invoice.findUnique({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(invoice.payment_status, 'PARTIALLY_PAID');
    assert.equal(invoice.paid_at, null, 'paid_at should be null when PARTIALLY_PAID');

    // Full payment to make it PAID
    await posting.recordCustomerReceipt({ amount: 25000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    invoice = await prisma.invoice.findUnique({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(invoice.payment_status, 'PAID');
    assert.ok(invoice.paid_at, 'paid_at should be set when PAID');

    // Partial reversal to trigger PARTIALLY_PAID
    // We need to create another receipt then reverse it
    const receipt = await posting.recordCustomerReceipt({ amount: 25000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    const rev = await posting.reverseTransaction(receipt.transaction.transaction_id, { reason: 'partial reversal' }, ADMIN);

    invoice = await prisma.invoice.findUnique({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(invoice.payment_status, 'PARTIALLY_PAID');
    assert.equal(invoice.paid_at, null, 'paid_at should be null when PARTIALLY_PAID');
  });

  test('invoice paid_at cleared on PAID to UNPAID transition', async () => {
    if (!ready) return skip();
    const ctx = await seedInvoice();
    const posting = new FinancePostingService({ prisma });

    // Create full payment (PAID)
    await posting.recordCustomerReceipt({ amount: 50000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    let invoice = await prisma.invoice.findUnique({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(invoice.payment_status, 'PAID');
    assert.ok(invoice.paid_at, 'paid_at should be set when PAID');

    // Full reversal to trigger UNPAID
    // We need to create another receipt then reverse it
    const receipt = await posting.recordCustomerReceipt({ amount: 50000, payment_method: 'cash', invoice_id: ctx.invoiceId }, ADMIN);
    await posting.reverseTransaction(receipt.transaction.transaction_id, { reason: 'full reversal' }, ADMIN);

    invoice = await prisma.invoice.findUnique({ where: { invoice_id: ctx.invoiceId } });
    assert.equal(invoice.payment_status, 'UNPAID');
    assert.equal(invoice.paid_at, null, 'paid_at should be null when UNPAID');
  });
});
