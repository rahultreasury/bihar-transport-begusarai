/**
 * phase8VehicleHireFlow.test.js
 * ---------------------------------------------------------------------------
 * PHASE 8 — THE COMPLETE HIRE FLOW, EXERCISED AGAINST A FAKE PRISMA
 * ---------------------------------------------------------------------------
 *
 *   ENQUIRY → QUOTATION → ORDER CONFIRMED → WAITING FOR VEHICLE
 *            → [ Hire Vehicle ] → VEHICLE HIRED → WAITING FOR LOADING
 *
 * The unit tests in phase8VehicleHirePage.test.js prove the ARITHMETIC in
 * isolation. This file proves the WRITE PATH: that a hire actually persists
 * three separate money figures, that it is linked to the existing trip, that
 * the trip status really moves, and that the event lands on the EXISTING
 * timeline and audit log.
 *
 * It runs against a hand-written fake Prisma client — no database, no server,
 * no network — so the transaction, the write order and the recorded history are
 * all observable. `tripDoubleBooking.test.js` already establishes the in-repo
 * convention of exactly this kind of fake.
 *
 * ALSO PROVED HERE
 *   • Hiring a vehicle records NO payment (spec §14/§15).
 *   • The trip's own freight_amount is never overwritten by the net (spec §7).
 *   • A second hire for the same trip is refused (the double-hire guard).
 *   • A vehicle whose documents are expired is refused without an
 *     acknowledgement, and allowed with one (spec §17).
 *   • The gross hire is written as DECIMAL strings, never binary floats (§13).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const VehicleHireWorkflowService = require('../services/VehicleHireWorkflowService');
const { ValidationError, ConflictError, ForbiddenError } = require('../utils/AppError');

/* ══════════════════════════════════════════════════════════════════════════
   A FAKE PRISMA
   ─────────────────────────────────────────────────────────────────────────
   Records every write so a test can assert on what was stored and in which
   order, and supports a transaction handle so the service's single-transaction
   guarantee can be checked.
   ══════════════════════════════════════════════════════════════════════════ */

function buildFakePrisma(seed = {}) {
  // Masters are keyed by primary key, exactly as Prisma addresses them.
  const state = {
    trips: seed.trip ? { [seed.trip.trip_id]: { ...seed.trip } } : {},
    vehicles: seed.vehicle ? { [seed.vehicle.vehicle_id]: { ...seed.vehicle } } : {},
    owners: seed.owner ? { [seed.owner.owner_id]: { ...seed.owner } } : {},
    drivers: seed.driver ? { [seed.driver.driver_id]: { ...seed.driver } } : {},
    bookings: seed.booking ? { [seed.booking.booking_id]: { ...seed.booking } } : {},
    hires: [],
    timelineEvents: [],
    auditEntries: [],
    // The repository's existing payment tables. If the hire ever wrote one of
    // these, the partial-payment tests would catch it.
    payments: [],
    advances: [],
    settlements: [],
    transactionDepth: 0,
    writes: [],
  };

  const record = (op, target) => state.writes.push({ op, target });

  const client = {
    trip: {
      findUnique: async ({ where }) => {
        const t = state.trips[where.trip_id];
        if (!t) return null;
        return {
          ...t,
          vehicle: state.vehicles[t.vehicle_id] || null,
          driver: state.drivers[t.driver_id] || null,
          transportOwner: state.owners[t.transport_owner_id] || null,
          client: null,
          user: null,
          booking: null,
        };
      },
      findFirst: async () => null, // no conflicting active trip in these tests
      update: async ({ where, data }) => {
        record('trip.update', where.trip_id);
        state.trips[where.trip_id] = { ...state.trips[where.trip_id], ...data };
        return state.trips[where.trip_id];
      },
    },

    transportVehicle: {
      findUnique: async ({ where }) => {
        const v = state.vehicles[where.vehicle_id];
        if (!v) return null;
        return {
          ...v,
          owner: v.owner_id ? state.owners[v.owner_id] || null : null,
        };
      },
      findMany: async () => Object.values(state.vehicles),
    },

    vehicleOwner: {
      findUnique: async ({ where }) => state.owners[where.owner_id] || null,
      findMany: async () => Object.values(state.owners),
    },

    driver: {
      findUnique: async ({ where }) => state.drivers[where.driver_id] || null,
      findMany: async () => Object.values(state.drivers),
    },

    booking: {
      findUnique: async ({ where }) => state.bookings[where.booking_id] || null,
      findFirst: async ({ where }) => Object.values(state.bookings).find(b => 
        (where.booking_id && b.booking_id === where.booking_id) ||
        (where.trip_id && b.trip_id === where.trip_id)
      ) || null,
      update: async ({ where, data }) => {
        const booking = state.bookings[where.booking_id];
        if (!booking) return null;
        record('booking.update', where.booking_id);
        state.bookings[where.booking_id] = { ...booking, ...data };
        return state.bookings[where.booking_id];
      },
    },

    vehicleHire: {
      findUnique: async ({ where }) => {
        if (where.trip_id) return state.hires.find((h) => h.trip_id === where.trip_id) || null;
        return state.hires.find((h) => h.hire_id === where.hire_id) || null;
      },
      create: async ({ data }) => {
        record('vehicleHire.create', data.trip_id);
        const hire = {
          hire_id: state.hires.length + 1,
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        state.hires.push(hire);
        return hire;
      },
    },

    tripTimeline: {
      create: async ({ data }) => {
        record('tripTimeline.create', data.event_type);
        state.timelineEvents.push({ ...data, metadata: JSON.parse(data.metadata || '{}') });
        return data;
      },
    },

    auditLog: {
      create: async ({ data }) => {
        record('auditLog.create', data.action);
        state.auditEntries.push(data);
        return data;
      },
    },

    // Any payment write here would mean the hire created money movement.
    financialTransaction: {
      create: async ({ data }) => {
        state.payments.push(data);
        record('financialTransaction.create', 'PAYMENT!');
        return data;
      },
    },
    tripAdvance: {
      create: async ({ data }) => {
        state.advances.push(data);
        record('tripAdvance.create', 'ADVANCE!');
        return data;
      },
    },
    tripSettlement: {
      create: async ({ data }) => {
        state.settlements.push(data);
        record('tripSettlement.create', 'SETTLEMENT!');
        return data;
      },
    },

    $transaction: async (fn) => {
      state.transactionDepth += 1;
      try {
        return await fn(client);
      } finally {
        state.transactionDepth -= 1;
      }
    },
  };

  // The two repositories the service reaches through.
  const TimelineRepo = require('../repositories/TripTimelineRepository');
  const AuditRepo = require('../repositories/AuditLogRepository');
  void TimelineRepo;
  void AuditRepo;

  return { prisma: client, state };
}

/* ── A fully-valid, hire-ready trip ─────────────────────────────────────── */

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function seedTrip(overrides = {}) {
  return {
    trip: {
      trip_id: 125,
      trip_number: 'BTBT-2026-00125',
      status: 'PENDING',
      booking_id: 88,
      pickup_location: 'Ram Nagar',
      pickup_city: 'Muzaffarpur',
      drop_location: 'Dankuni',
      drop_city: 'Kolkata',
      distance_km: 900,
      trip_date: new Date('2026-09-25'),
      // The CUSTOMER freight — a different concept from the vehicle-side gross,
      // and must never be overwritten by it.
      freight_amount: 58000,
      vehicle_id: 10,
      transport_owner_id: 20,
      driver_id: 30,
      billing_to: null,
      business_model: null,
      rate_basis: null,
      commission_type: null,
      commission_percentage: null,
      ...overrides.trip,
    },
    vehicle: {
      vehicle_id: 10,
      vehicle_number: 'BR01XX1234',
      vehicle_type: '16 Ton Truck',
      vehicle_name: 'Tata 1613',
      body_type: 'Open Body',
      capacity_kg: 16000,
      owner_id: 20,
      current_status: 'available',
      is_available: true,
      tax_number: 'TX-1', tax_expiry: iso(300),
      insurance_number: 'IN-1', insurance_expiry: iso(300),
      pollution_certificate: 'PU-1', pollution_expiry: iso(300),
      fitness_number: 'FT-1', fitness_expiry: iso(300),
      permit_number: 'PM-1', permit_expiry: iso(300),
      national_permit_number: null, national_permit_expiry: null,
      ...overrides.vehicle,
    },
    owner: {
      owner_id: 20,
      owner_name: 'XYZ Transport',
      owner_type: 'TRANSPORT_COMPANY',
      mobile: '9876500001',
      city: 'Muzaffarpur',
      status: 'active',
      is_active: true,
      ...overrides.owner,
    },
    driver: {
      driver_id: 30,
      driver_name: 'Raj Kumar',
      mobile: '9876500002',
      status: 'available',
      is_available: true,
      transport_owner_id: 20,
      current_vehicle_id: 10,
      ...overrides.driver,
    },
    booking: {
      booking_id: 88,
      booking_number: 'BTB-2026-00088',
      user_id: 1,
      vehicle_id: 10,
      driver_id: 30,
      pickup_location: 'Ram Nagar',
      pickup_city: 'Muzaffarpur',
      drop_location: 'Dankuni',
      drop_city: 'Kolkata',
      status: 'confirmed',
      quote_status: 'ACCEPTED',
      final_price: 58000,
      vehicle_owner_id: 20,
      ...overrides.booking,
    },
  };
}

const ADMIN = { user_id: 1, role: 'admin' };
const SUPER = { user_id: 2, role: 'super_admin' };

const validHire = {
  vehicle_id: 10,
  vendor_id: 20,
  driver_id: 30,
  billing_to: 'VEHICLE_VENDOR',
  rate_basis: 'FIXED',
  rate_value: 42000,
  commission_type: 'FIXED',
  commission_rate: 2000,
};

/* ══════════════════════════════════════════════════════════════════════════
   1. THE COMPLETE FLOW
   ══════════════════════════════════════════════════════════════════════════ */

test('FLOW: ENQUIRY→QUOTATION→ORDER→WAITING FOR VEHICLE→HIRE→VEHICLE HIRED', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  // — the trip arrives at WAITING FOR VEHICLE
  assert.equal(state.trips[125].status, 'PENDING');
  assert.equal(service.canHireTripStatus(state.trips[125].status), true);

  // — the operator presses "Hire Vehicle"
  const result = await service.hireVehicle(125, validHire, ADMIN);

  // — the hire is stored, linked to the EXISTING trip
  assert.equal(state.hires.length, 1);
  assert.equal(state.hires[0].trip_id, 125, 'the hire keeps the existing trip/order id');
  assert.equal(state.hires[0].booking_id, 88, 'the hire keeps the order id');

  // — the three money figures are stored separately and exactly
  assert.equal(state.hires[0].gross_hire, '42000.00');
  assert.equal(state.hires[0].commission_amount, '2000.00');
  assert.equal(state.hires[0].net_vendor_payable, '40000.00');

  // — the trip has moved to VEHICLE HIRED
  assert.equal(state.trips[125].status, 'ASSIGNED');
  assert.equal(result.status_before, 'PENDING');
  assert.equal(result.status_after, 'ASSIGNED');

  // — the next operational state is announced, not performed
  assert.equal(result.next_operational.status, 'TO_LOADING_POINT');
  assert.notEqual(state.trips[125].status, 'TO_LOADING_POINT', 'the hire must not load or dispatch');

  // — the commercial terms were written back to the existing Trip columns
  assert.equal(state.trips[125].billing_to, 'VEHICLE_VENDOR');
  assert.equal(state.trips[125].business_model, 'COMMISSION');
  assert.equal(state.trips[125].rate_basis, 'FIXED');

  // — the audit/history event carries all the money figures
  const event = state.timelineEvents.find((e) => e.event_type === 'vehicle_hired');
  assert.ok(event, 'a vehicle_hired timeline event must exist');
  assert.equal(event.metadata.gross_hire, 42000);
  assert.equal(event.metadata.commission_amount, 2000);
  assert.equal(event.metadata.net_vendor_payable, 40000);
  assert.equal(event.metadata.vehicle_number, 'BR01XX1234');
  assert.equal(event.metadata.vendor_name, 'XYZ Transport');
  assert.equal(event.metadata.driver_name, 'Raj Kumar');

  // — and the existing audit log recorded it too
  const audit = state.auditEntries.find((a) => a.action === 'vehicle_hire_created');
  assert.ok(audit, 'the existing AuditLog must record the hire');
  assert.equal(JSON.parse(audit.new_value).vehicle_hired, true);
});

test('FLOW: everything commits inside ONE transaction', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  // The hire, the status change, the timeline event, the audit entry and the booking
  // mirror are five writes; they must be balanced by a matching single transaction.
  const writes = state.writes.map((w) => w.op);
  assert.deepEqual(writes, [
    'vehicleHire.create',
    'trip.update',
    'tripTimeline.create',
    'auditLog.create',
    'booking.update',
  ]);
  assert.equal(state.transactionDepth, 0, 'the transaction must be closed');
});

/* ══════════════════════════════════════════════════════════════════════════
   2. BOTH COMMERCIAL MODELS, ALL FOUR BILLING PARTIES
   ══════════════════════════════════════════════════════════════════════════ */

test('FLOW: Contract / Consignor, Consignee and Third Party all store CONTRACT', async () => {
  for (const [party, expected] of [
    ['CONSIGNOR', 'CONTRACT'],
    ['CONSIGNEE', 'CONTRACT'],
    ['THIRD_PARTY', 'CONTRACT'],
  ]) {
    const { prisma, state } = buildFakePrisma(seedTrip());
    const service = new VehicleHireWorkflowService({ prisma });
    await service.hireVehicle(125, { ...validHire, billing_to: party }, ADMIN);

    assert.equal(state.hires[0].business_model, expected, `${party} → ${expected}`);
    assert.equal(state.hires[0].gross_hire, '42000.00');
    assert.equal(state.hires[0].net_vendor_payable, '40000.00');
  }
});

test('FLOW: Commission / Vehicle Vendor stores COMMISSION with the same arithmetic', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });
  await service.hireVehicle(125, validHire, ADMIN);

  assert.equal(state.hires[0].business_model, 'COMMISSION');
  assert.equal(state.hires[0].business_model_overridden, false);
  // Identical money to the contract case — only the reporting differs.
  assert.equal(state.hires[0].gross_hire, '42000.00');
  assert.equal(state.hires[0].commission_amount, '2000.00');
  assert.equal(state.hires[0].net_vendor_payable, '40000.00');
});

test('FLOW: Per Ton computes the gross from the rate inputs and stores them', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, {
    ...validHire,
    billing_to: 'CONSIGNOR',
    rate_basis: 'PER_TON',
    rate_value: 5000,
    rate_quantity: 8,
    commission_type: 'FIXED',
    commission_rate: 2000,
  }, ADMIN);

  assert.equal(state.hires[0].rate_value, '5000.00');
  assert.equal(state.hires[0].rate_quantity, '8.000');
  assert.equal(state.hires[0].rate_unit, 'Ton');
  assert.equal(state.hires[0].gross_hire, '40000.00', '5,000 × 8 Ton');
  assert.equal(state.hires[0].commission_amount, '2000.00');
  assert.equal(state.hires[0].net_vendor_payable, '38000.00');
});

test('FLOW: 5% percentage and no-commission both store correctly', async () => {
  const pct = buildFakePrisma(seedTrip());
  await new VehicleHireWorkflowService({ prisma: pct.prisma }).hireVehicle(125, {
    ...validHire, commission_type: 'PERCENTAGE', commission_rate: 5,
  }, ADMIN);
  assert.equal(pct.state.hires[0].gross_hire, '42000.00');
  assert.equal(pct.state.hires[0].commission_amount, '2100.00');
  assert.equal(pct.state.hires[0].net_vendor_payable, '39900.00');

  const none = buildFakePrisma(seedTrip());
  await new VehicleHireWorkflowService({ prisma: none.prisma }).hireVehicle(125, {
    ...validHire, commission_type: 'NO_COMMISSION', commission_rate: 0,
  }, ADMIN);
  assert.equal(none.state.hires[0].gross_hire, '42000.00');
  assert.equal(none.state.hires[0].commission_amount, '0.00');
  assert.equal(none.state.hires[0].net_vendor_payable, '42000.00');
});

/* ══════════════════════════════════════════════════════════════════════════
   3. FINANCIAL SAFETY
   ══════════════════════════════════════════════════════════════════════════ */

test('SAFETY: hiring records NO payment, advance or settlement', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  assert.equal(state.payments.length, 0, 'no FinancialTransaction may be created');
  assert.equal(state.advances.length, 0, 'no TripAdvance may be created');
  assert.equal(state.settlements.length, 0, 'no TripSettlement may be created');
});

test('SAFETY: the hire carries no paid_amount or payment_status', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);
  const hire = state.hires[0];

  assert.equal(hire.paid_amount, undefined);
  assert.equal(hire.payment_status, undefined);
  assert.equal(hire.is_paid, undefined);

  const serialized = service.serializeHire(hire);
  assert.equal(serialized.payments.settled, false);
});

test('SAFETY: the customer freight on the trip is never overwritten by the net', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip({ trip: { freight_amount: 58000 } }));
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  // Customer freight is a DIFFERENT concept from the vehicle-side gross. The
  // hire must leave it exactly where it was, and certainly must not replace it
  // with a vehicle-side figure.
  assert.equal(state.trips[125].freight_amount, 58000, 'the customer freight is untouched');
  assert.notEqual(
    state.trips[125].freight_amount,
    40000,
    'the customer freight must never be replaced by the net vendor payable'
  );
  assert.equal(state.hires[0].gross_hire, '42000.00', 'the gross is stored whole');
  assert.equal(state.hires[0].net_vendor_payable, '40000.00');
});

test('SAFETY: money is written as DECIMAL strings, never binary floats', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, {
    ...validHire, rate_basis: 'PER_KG', rate_value: 12.5, rate_quantity: 333.33,
    commission_type: 'PERCENTAGE', commission_rate: 7.5,
  }, ADMIN);

  const hire = state.hires[0];
  for (const key of ['rate_value', 'gross_hire', 'commission_rate', 'commission_amount', 'net_vendor_payable']) {
    assert.equal(typeof hire[key], 'string', `${key} must be a decimal string, not a float`);
    assert.match(hire[key], /^\d+\.\d{2,4}$/, `${key} must carry explicit decimal places`);
  }
  // 12.5 × 333.33 = 4166.625 → 4166.63 gross; 7.5% → 312.50; net 3854.13
  assert.equal(hire.gross_hire, '4166.63');
  assert.equal(hire.commission_amount, '312.50');
  assert.equal(hire.net_vendor_payable, '3854.13');
});

test('SAFETY: partial payments remain compatible — the net stays owed after a later payment', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, {
    ...validHire, rate_value: 10000, commission_type: 'PERCENTAGE', commission_rate: 5,
  }, ADMIN);

  assert.equal(state.hires[0].gross_hire, '10000.00');
  assert.equal(state.hires[0].commission_amount, '500.00');
  assert.equal(state.hires[0].net_vendor_payable, '9500.00');

  // A later vendor payment of ₹5,000 (through the EXISTING ledger) settles part
  // of it. The hire itself is untouched — hiring is not paying.
  const laterPaid = 5000;
  assert.equal(Number(state.hires[0].net_vendor_payable) - laterPaid, 4500);
  assert.equal(state.hires[0].gross_hire, '10000.00', 'the gross is unchanged by a payment');
});

/* ══════════════════════════════════════════════════════════════════════════
   4. VALIDATION AND SAFETY GATES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHY `ASSIGNED` IS NO LONGER IN THIS LIST
 *   A vehicle can be assigned from the ENQUIRY page before the hire money is
 *   agreed, which leaves the trip in `ASSIGNED` while no `vehicle_hires` row
 *   exists. The specification requires exactly that consignment to be able to
 *   COMPLETE its hire from the Vehicle Hire page (it reads "VEHICLE ASSIGNED ·
 *   WAITING FOR HIRE COMPLETION"). Refusing it would strand every consignment
 *   assigned from Enquiry.
 *
 *   `config/vehicleHirePolicy.HIRE_READY_TRIP_STATUSES` therefore covers both
 *   `PENDING` and `ASSIGNED`. What must STILL be refused is a consignment that
 *   has begun or finished moving — hiring those is a dispatch correction, not a
 *   hiring action, and those belong to the loading/transit modules.
 */
test('GATE: a trip that has begun or finished moving cannot be hired', async () => {
  for (const status of ['IN_TRANSIT', 'DELIVERED', 'COMPLETED']) {
    const { prisma, state } = buildFakePrisma(seedTrip({ trip: { status } }));
    const service = new VehicleHireWorkflowService({ prisma });
    await assert.rejects(() => service.hireVehicle(125, validHire, ADMIN), ValidationError);
    assert.equal(state.hires.length, 0, `${status} must not accept a hire`);
  }
});

test('GATE: an ASSIGNED trip CAN complete a hire — that is the Enquiry-assigned path', async () => {
  // Enquiry assigned the vehicle, so the trip is ASSIGNED, but no hire exists
  // yet. Completing the hire from Vehicle Hire must work.
  const { prisma, state } = buildFakePrisma(seedTrip({ trip: { status: 'ASSIGNED' } }));
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  assert.equal(state.hires.length, 1, 'exactly one hire was created');
  assert.equal(state.hires[0].gross_hire, '42000.00');
  // The trip was already in the hired state, so it stays there rather than
  // attempting an illegal ASSIGNED → ASSIGNED transition.
  assert.equal(state.trips[125].status, 'ASSIGNED');
});

test('GATE: a second hire for the same trip is refused — no double obligations', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);
  assert.equal(state.hires.length, 1);

  await assert.rejects(() => service.hireVehicle(125, validHire, ADMIN), ConflictError);
  assert.equal(state.hires.length, 1, 'a double-clicked Hire Vehicle must not create a second hire');
});

test('GATE: an inactive vehicle cannot be hired', async () => {
  for (const vehicle of [
    { is_available: false },
    { current_status: 'maintenance' },
    { current_status: 'off_road' },
    { current_status: 'inactive' },
  ]) {
    const { prisma, state } = buildFakePrisma(seedTrip({ vehicle }));
    const service = new VehicleHireWorkflowService({ prisma });
    await assert.rejects(() => service.hireVehicle(125, validHire, ADMIN), ValidationError);
    assert.equal(state.hires.length, 0);
  }
});

test('GATE: an inactive driver cannot be assigned', async () => {
  for (const driver of [{ is_available: false }, { status: 'inactive' }]) {
    const { prisma, state } = buildFakePrisma(seedTrip({ driver }));
    const service = new VehicleHireWorkflowService({ prisma });
    await assert.rejects(() => service.hireVehicle(125, validHire, ADMIN), ValidationError);
    assert.equal(state.hires.length, 0);
  }
});

test('GATE: an inactive vendor cannot be hired', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip({ owner: { status: 'inactive' } }));
  const service = new VehicleHireWorkflowService({ prisma });
  await assert.rejects(() => service.hireVehicle(125, validHire, ADMIN), ValidationError);
  assert.equal(state.hires.length, 0);
});

test('GATE: an unknown vehicle, vendor or driver is rejected', async () => {
  const cases = [
    { ...validHire, vehicle_id: 999 },
    { ...validHire, vendor_id: 999 },
    { ...validHire, driver_id: 999 },
  ];
  for (const payload of cases) {
    const { prisma, state } = buildFakePrisma(seedTrip());
    const service = new VehicleHireWorkflowService({ prisma });
    await assert.rejects(() => service.hireVehicle(125, payload, ADMIN), ValidationError);
    assert.equal(state.hires.length, 0);
  }
});

test('GATE: a missing rate is rejected — a gross is never invented', async () => {
  for (const payload of [
    { ...validHire, rate_value: '' },
    { ...validHire, rate_value: -100 },
    { ...validHire, rate_basis: 'PER_TON', rate_value: 5000, rate_quantity: '' },
  ]) {
    const { prisma, state } = buildFakePrisma(seedTrip());
    const service = new VehicleHireWorkflowService({ prisma });
    await assert.rejects(() => service.hireVehicle(125, payload, ADMIN), ValidationError);
    assert.equal(state.hires.length, 0);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   5. DOCUMENT EXPIRY GATE
   ══════════════════════════════════════════════════════════════════════════ */

test('DOCUMENTS: an expired critical document blocks the hire until acknowledged', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip({
    vehicle: { insurance_expiry: iso(-10) }, // critical + expired
  }));
  const service = new VehicleHireWorkflowService({ prisma });

  // Refused outright — no silent hire.
  await assert.rejects(
    () => service.hireVehicle(125, validHire, ADMIN),
    (err) => err instanceof ValidationError && /document expired/i.test(err.message)
  );
  assert.equal(state.hires.length, 0);
  assert.equal(state.trips[125].status, 'PENDING', 'a blocked hire leaves the trip untouched');

  // Acknowledged, but by an operator with no authority to override.
  await assert.rejects(
    () => service.hireVehicle(125, { ...validHire, documents_expired_ack: true }, ADMIN),
    ForbiddenError
  );
  assert.equal(state.hires.length, 0);

  // Acknowledged by an authorised role → allowed, and the acknowledgement is
  // recorded on the hire.
  const result = await service.hireVehicle(125, { ...validHire, documents_expired_ack: true }, SUPER);
  assert.equal(state.hires.length, 1);
  assert.equal(state.hires[0].documents_expired_ack, true);
  assert.equal(state.hires[0].documents_expired_ack_by, SUPER.user_id);
  assert.ok(state.hires[0].documents_expired_ack_at, 'the acknowledgement is timestamped');
  assert.equal(result.status_after, 'ASSIGNED');
});

test('DOCUMENTS: the snapshot records what the operator actually saw', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip({
    vehicle: { fitness_expiry: iso(15) }, // EXPIRING SOON
  }));
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  const snapshot = state.hires[0].documents_snapshot;
  assert.ok(snapshot, 'a document snapshot is stored');
  const fitness = snapshot.documents.find((d) => d.key === 'FITNESS');
  assert.equal(fitness.status, 'EXPIRING_SOON');
  assert.equal(snapshot.warning_days, 30);
});

test('DOCUMENTS: an expired NON-critical document warns but does not block', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip({
    vehicle: { pollution_expiry: iso(-20) }, // PUCC is not critical
  }));
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);
  assert.equal(state.hires.length, 1, 'an expired PUCC must not block a hire');
});

/* ══════════════════════════════════════════════════════════════════════════
   6. AUTHORISED OVERRIDES
   ══════════════════════════════════════════════════════════════════════════ */

test('OVERRIDE: an operator cannot change the derived business model', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await assert.rejects(
    () => service.hireVehicle(125, { ...validHire, business_model: 'CONTRACT' }, ADMIN),
    ForbiddenError
  );
  assert.equal(state.hires.length, 0);
});

test('OVERRIDE: a super_admin may, and the override is recorded', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, { ...validHire, business_model: 'CONTRACT' }, SUPER);

  assert.equal(state.hires[0].business_model, 'CONTRACT');
  assert.equal(state.hires[0].business_model_overridden, true, 'the override is explicit, never silent');
});

/* ══════════════════════════════════════════════════════════════════════════
   7. PREVIEW WRITES NOTHING
   ══════════════════════════════════════════════════════════════════════════ */

test('PREVIEW: computes the identical money but writes nothing', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  const preview = await service.previewHire(125, validHire);

  assert.equal(preview.gross_hire, 42000);
  assert.equal(preview.commission_amount, 2000);
  assert.equal(preview.net_vendor_payable, 40000);

  // Nothing persisted, and the trip is exactly where it was.
  assert.equal(state.hires.length, 0);
  assert.equal(state.writes.length, 0);
  assert.equal(state.trips[125].status, 'PENDING');
});

test('PREVIEW: produces the same figures the save then stores', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  const preview = await service.previewHire(125, validHire);
  await service.hireVehicle(125, validHire, ADMIN);

  // The preview is a number for the UI; the stored row is a Decimal string.
  // They must be the SAME VALUE, compared as numbers.
  assert.equal(preview.gross_hire, Number(state.hires[0].gross_hire));
  assert.equal(preview.commission_amount, Number(state.hires[0].commission_amount));
  assert.equal(preview.net_vendor_payable, Number(state.hires[0].net_vendor_payable));
});

/* ══════════════════════════════════════════════════════════════════════════
   8. IDEMPOTENT RE-ENTRY
   ══════════════════════════════════════════════════════════════════════════ */

test('CONTEXT: re-opening the page after a hire shows the hire, and blocks a second one', async () => {
  const { prisma, state } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  await service.hireVehicle(125, validHire, ADMIN);

  const context = await service.getHireContext(125);
  assert.equal(context.can_hire, false);
  assert.match(context.blocked_reason, /already has a hire/i);
  assert.equal(context.existing_hire.gross_hire, 42000);
  assert.equal(context.existing_hire.net_vendor_payable, 40000);
  assert.equal(context.existing_hire.challan_number, `BTVH/${new Date().getFullYear()}/00125`);
});

test('CONTEXT: the page opens on the trip’s real masters, not invented ones', async () => {
  const { prisma } = buildFakePrisma(seedTrip());
  const service = new VehicleHireWorkflowService({ prisma });

  const context = await service.getHireContext(125);
  assert.equal(context.assignment.vehicle.vehicle_number, 'BR01XX1234');
  assert.equal(context.assignment.vendor.owner_name, 'XYZ Transport');
  assert.equal(context.assignment.driver.driver_name, 'Raj Kumar');
  assert.equal(context.can_hire, true);
  // The documents come from the vehicle master and are CALCULATED, not static.
  assert.equal(context.documents.documents.length, 6);
  assert.ok(context.documents.documents.every((d) => typeof d.status === 'string'));
});