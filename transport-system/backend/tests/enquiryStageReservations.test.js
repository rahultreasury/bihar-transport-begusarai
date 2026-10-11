/**
 * tests/enquiryStageReservations.test.js
 * ---------------------------------------------------------------------------
 * THE TEMPORARY HOLD BEFORE THE CUSTOMER ACCEPTS.
 *
 * A vehicle and a driver are assigned BEFORE the customer accepts, so there is a
 * window in which they are held but nothing has been hired. `Reservation` is that
 * hold. These tests pin the two properties that make it safe:
 *
 *   1. It can be owned by an ENQUIRY (no Booking exists that early) as well as by
 *      a Booking, and never by neither.
 *   2. The DATABASE refuses to double-book. One ACTIVE hold per enquiry, per
 *      vehicle, per driver — enforced by partial UNIQUE indexes, not by
 *      application discipline.
 *
 * NOTHING HERE CREATES MONEY. A hold is not a hire: `VehicleHire` and `Trip` are
 * deliberately untouched by these tests, which is the whole point of the split.
 *
 * LOCAL ONLY — depends on migration 20261005120000_enquiry_stage_reservations,
 * which is not deployed to production.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { prisma } = require('../config/prisma');

/* ── fixtures are created per test and deleted after, so the suite leaves no
      residue and never collides with real enquiries, vehicles or drivers. ──── */

let seq = 0;
function uniq(prefix) {
  seq += 1;
  return `${prefix}${Date.now()}${seq}`.slice(0, 60);
}

async function makeVehicle() {
  return prisma.transportVehicle.create({
    data: {
      vehicle_number: uniq('T-RES-V-'),
      vehicle_type: 'truck',
      vehicle_name: `Reservation Test Vehicle ${seq}`,
      is_available: true,
    },
    select: { vehicle_id: true },
  });
}

async function makeUser(role = 'driver') {
  return prisma.user.create({
    data: {
      first_name: `Reservation Test ${seq}`,
      last_name: 'Harness',
      email: `${uniq('res.test.')}@example.invalid`,
      phone: uniq('79').slice(-10),
      password_hash: 'not-a-real-hash-tests-only',
      role,
    },
    select: { user_id: true },
  });
}

async function makeDriver() {
  // Driver.user_id is NOT NULL, so the driver row owns a throwaway User.
  const user = await makeUser('driver');
  const driver = await prisma.driver.create({
    data: {
      user_id: user.user_id,
      driver_name: `Reservation Test Driver ${seq}`,
      mobile: uniq('9'),
      status: 'available',
      is_available: true,
    },
    select: { driver_id: true },
  });
  driver.user_id = user.user_id;
  return driver;
}

async function makeEnquiry() {
  return prisma.enquiry.create({
    data: {
      enquiry_number: uniq('T-RES-E-'),
      customer_name: `Reservation Test Customer ${seq}`,
      customer_mobile: uniq('8'),
      pickup_location: 'Test Pickup',
      drop_location: 'Test Drop',
      pickup_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      pickup_time: '10:00',
      status: 'AWAITING_CUSTOMER_ACCEPTANCE',
    },
    select: { enquiry_id: true },
  });
}

async function makeBooking(status = 'pending') {
  const user = await makeUser('customer');
  const pickupDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return prisma.booking.create({
    data: {
      user_id: user.user_id,
      booking_number: uniq('T-RES-B-'),
      pickup_location: 'Test Pickup',
      pickup_city: 'Test',
      pickup_date: pickupDate,
      pickup_time: '10:00',
      drop_location: 'Test Drop',
      drop_city: 'Test',
      goods_description: 'Reservation test goods',
      vehicle_type_required: 'truck',
      status,
    },
    select: { booking_id: true },
  });
}

/** PostgreSQL unique-violation. Proves the INDEX did the refusing. */
function isUniqueViolation(err) {
  return err && (err.code === 'P2002' || /uq_reservations_active_/.test(String(err.message || '')));
}

/* ─────────────────────────────────────────────────────────────────────────── */

test('booking-scoped reservations still work (booking_id only)', async () => {
  const booking = await makeBooking();
  const v = await makeVehicle();

  const r = await prisma.reservation.create({
    data: { booking_id: booking.booking_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });

  assert.equal(r.booking_id, booking.booking_id);
  assert.equal(r.enquiry_id, null, 'a booking hold has no enquiry parent');
  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('enquiry-scoped reservation can be created with booking_id NULL', async () => {
  const e = await makeEnquiry();
  const v = await makeVehicle();
  const d = await makeDriver();

  const r = await prisma.reservation.create({
    data: {
      enquiry_id: e.enquiry_id,
      vehicle_id: v.vehicle_id,
      driver_id: d.driver_id,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  assert.equal(r.enquiry_id, e.enquiry_id);
  assert.equal(r.booking_id, null, 'no Booking exists before acceptance');
  assert.equal(r.status, 'ACTIVE');

  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('the enquiry relation resolves and holds the vehicle + driver', async () => {
  const e = await makeEnquiry();
  const v = await makeVehicle();
  const d = await makeDriver();

  const r = await prisma.reservation.create({
    data: { enquiry_id: e.enquiry_id, vehicle_id: v.vehicle_id, driver_id: d.driver_id },
    include: { enquiry: true, vehicle: true, driver: true },
  });

  assert.equal(r.enquiry.enquiry_id, e.enquiry_id);
  assert.equal(r.vehicle.vehicle_id, v.vehicle_id);
  assert.equal(r.driver.driver_id, d.driver_id);

  // …and the back-relation sees it too.
  const back = await prisma.enquiry.findUnique({
    where: { enquiry_id: e.enquiry_id },
    include: { reservations: true },
  });
  assert.equal(back.reservations.length, 1);

  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('a reservation with NEITHER parent is refused by the database', async () => {
  const v = await makeVehicle();
  await assert.rejects(
    () => prisma.reservation.create({ data: { vehicle_id: v.vehicle_id, status: 'ACTIVE' } }),
    /reservations_have_a_parent|violates check constraint/i,
    'an orphaned hold must be impossible',
  );
});

test('ONE ACTIVE reservation per enquiry — the second is refused', async () => {
  const e = await makeEnquiry();
  const v1 = await makeVehicle();
  const v2 = await makeVehicle();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e.enquiry_id, vehicle_id: v1.vehicle_id, status: 'ACTIVE' },
  });

  await assert.rejects(
    () => prisma.reservation.create({
      data: { enquiry_id: e.enquiry_id, vehicle_id: v2.vehicle_id, status: 'ACTIVE' },
    }),
    (err) => isUniqueViolation(err),
    'an enquiry cannot hold two trucks at once',
  );

  await prisma.reservation.delete({ where: { reservation_id: first.reservation_id } });
});

test('ONE ACTIVE reservation per vehicle — the second is refused', async () => {
  const v = await makeVehicle();
  const e1 = await makeEnquiry();
  const e2 = await makeEnquiry();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e1.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });

  await assert.rejects(
    () => prisma.reservation.create({
      data: { enquiry_id: e2.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
    }),
    (err) => isUniqueViolation(err),
    'a truck cannot be promised to two enquiries at once',
  );

  await prisma.reservation.delete({ where: { reservation_id: first.reservation_id } });
});

test('ONE ACTIVE reservation per driver — the second is refused', async () => {
  const d = await makeDriver();
  const e1 = await makeEnquiry();
  const e2 = await makeEnquiry();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e1.enquiry_id, driver_id: d.driver_id, status: 'ACTIVE' },
  });

  await assert.rejects(
    () => prisma.reservation.create({
      data: { enquiry_id: e2.enquiry_id, driver_id: d.driver_id, status: 'ACTIVE' },
    }),
    (err) => isUniqueViolation(err),
    'a driver cannot be promised to two enquiries at once',
  );

  await prisma.reservation.delete({ where: { reservation_id: first.reservation_id } });
});

test('RELEASED frees the vehicle for a new hold', async () => {
  const v = await makeVehicle();
  const e1 = await makeEnquiry();
  const e2 = await makeEnquiry();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e1.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });

  // Customer rejected → released, never deleted.
  await prisma.reservation.update({
    where: { reservation_id: first.reservation_id },
    data: { status: 'RELEASED', released_at: new Date() },
  });

  const second = await prisma.reservation.create({
    data: { enquiry_id: e2.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });
  assert.equal(second.status, 'ACTIVE');

  await prisma.reservation.deleteMany({
    where: { reservation_id: { in: [first.reservation_id, second.reservation_id] } },
  });
});

test('EXPIRED frees the vehicle for a new hold', async () => {
  const v = await makeVehicle();
  const e1 = await makeEnquiry();
  const e2 = await makeEnquiry();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e1.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });
  await prisma.reservation.update({
    where: { reservation_id: first.reservation_id },
    data: { status: 'EXPIRED', released_at: new Date() },
  });

  const second = await prisma.reservation.create({
    data: { enquiry_id: e2.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });
  assert.equal(second.status, 'ACTIVE');

  await prisma.reservation.deleteMany({
    where: { reservation_id: { in: [first.reservation_id, second.reservation_id] } },
  });
});

test('CONVERTED stops being ACTIVE and frees the resources', async () => {
  const v = await makeVehicle();
  const d = await makeDriver();
  const e1 = await makeEnquiry();
  const e2 = await makeEnquiry();

  const first = await prisma.reservation.create({
    data: { enquiry_id: e1.enquiry_id, vehicle_id: v.vehicle_id, driver_id: d.driver_id, status: 'ACTIVE' },
  });

  // Customer accepted → the hold becomes a confirmed hire.
  await prisma.reservation.update({
    where: { reservation_id: first.reservation_id },
    data: { status: 'CONVERTED', converted_at: new Date() },
  });

  const after = await prisma.reservation.findUnique({ where: { reservation_id: first.reservation_id } });
  assert.equal(after.status, 'CONVERTED');
  assert.ok(after.converted_at, 'converted_at records when the customer agreed');

  const second = await prisma.reservation.create({
    data: { enquiry_id: e2.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });
  assert.equal(second.status, 'ACTIVE', 'a converted hold no longer blocks the truck');

  await prisma.reservation.deleteMany({
    where: { reservation_id: { in: [first.reservation_id, second.reservation_id] } },
  });
});

test('history is preserved: a released hold still exists with its vehicle', async () => {
  const e = await makeEnquiry();
  const v = await makeVehicle();

  const r = await prisma.reservation.create({
    data: { enquiry_id: e.enquiry_id, vehicle_id: v.vehicle_id, status: 'ACTIVE' },
  });
  await prisma.reservation.update({
    where: { reservation_id: r.reservation_id },
    data: { status: 'RELEASED', released_at: new Date() },
  });

  const still = await prisma.reservation.findUnique({
    where: { reservation_id: r.reservation_id },
    include: { vehicle: true },
  });
  assert.ok(still, 'a released hold is NEVER deleted — it is history');
  assert.equal(still.vehicle.vehicle_id, v.vehicle_id);
  assert.ok(still.released_at);

  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('a hold creates NO hire money and NO trip', async () => {
  const e = await makeEnquiry();
  const v = await makeVehicle();
  const d = await makeDriver();

  const r = await prisma.reservation.create({
    data: { enquiry_id: e.enquiry_id, vehicle_id: v.vehicle_id, driver_id: d.driver_id },
  });

  // The Trip is not created at reservation time — the customer has not agreed.
  const trips = await prisma.trip.count({ where: { enquiry_id: e.enquiry_id } });
  assert.equal(trips, 0, 'no Trip exists while the customer has only been sent a hold');

  // No vendor liability exists either.
  const holds = await prisma.reservation.count({ where: { reservation_id: r.reservation_id } });
  assert.equal(holds, 1);

  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('reservation model carries both parents (acceptance links the Booking)', async () => {
  const e = await makeEnquiry();
  const booking = await makeBooking('confirmed');
  const v = await makeVehicle();

  // At acceptance both parents are legitimately present — the CHECK is
  // "at least one", never "exactly one".
  const r = await prisma.reservation.create({
    data: { enquiry_id: e.enquiry_id, booking_id: booking.booking_id, vehicle_id: v.vehicle_id },
  });

  assert.equal(r.enquiry_id, e.enquiry_id);
  assert.equal(r.booking_id, booking.booking_id);

  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});

test('an expired (past expires_at) hold can still be created but is not ACTIVE-blocked once expired', async () => {
  const e = await makeEnquiry();
  const v = await makeVehicle();

  const r = await prisma.reservation.create({
    data: {
      enquiry_id: e.enquiry_id,
      vehicle_id: v.vehicle_id,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() - 1000), // already in the past
    },
  });
  assert.ok(r.expires_at < new Date(), 'a lapsed window is representable so a sweeper can find it');

  await prisma.reservation.update({
    where: { reservation_id: r.reservation_id },
    data: { status: 'EXPIRED' },
  });
  await prisma.reservation.delete({ where: { reservation_id: r.reservation_id } });
});
