/**
 * phase9DispatchWorkspace.test.js
 * ---------------------------------------------------------------------------
 * PHASE 9 — THE DISPATCH WORKSPACE
 * ---------------------------------------------------------------------------
 *
 * Runs against an in-memory stand-in for Prisma, following the pattern
 * tests/phase4LoadingDispatch.test.js already uses. Nothing here touches the
 * real database, and nothing writes outside the fake client.
 *
 * THE SCENARIOS THE SPECIFICATION NAMES
 *    1.  Cannot dispatch from ASSIGNED
 *    2.  Cannot dispatch from TO_LOADING_POINT
 *    3.  Cannot dispatch from AT_LOADING_POINT when loading is incomplete
 *    4.  Cannot dispatch when the required E-Way Bill is missing
 *    5.  Cannot dispatch when the required LR/GR is missing
 *    6.  Cannot dispatch when another required document is missing
 *    7.  CAN dispatch when every mandatory requirement passes
 *    8.  Dispatch changes the status LOADED → DISPATCHED
 *    9.  Dispatch creates a movement-history entry
 *   10.  Dispatch creates an audit entry
 *   11.  Dispatch data persists after a refresh (a NEW service sees it)
 *   12.  The invoice is linked to the Trip
 *   13.  The E-Way Bill is linked to the Trip
 *   14.  The LR/GR is linked to the Trip
 *   15.  The POD requirement persists
 *   16.  A repeated dispatch does not create a second dispatch record
 *   17.  A failed dispatch writes NOTHING (no partial update)
 *
 * AND THE HONESTY CONTRACTS, which are as important as the happy path
 *   18.  No government e-way bill confirmation is ever written
 *   19.  A vehicle change flags the paper and keeps the previous vehicle
 *   20.  The original vehicle survives every change, permanently
 *   21.  Insurance is a warning when not required, a blocker when required
 *   22.  An expired blocking vehicle document blocks dispatch
 *   23.  Customer payments are partial and never settle themselves
 *   24.  Tracking reports "not connected" rather than inventing a location
 *   25.  The invoice PDF is a REAL PDF, not a placeholder
 *
 * Uses node:test + node:assert (no extra deps).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const TripDispatchService = require('../services/TripDispatchService');
const TripDocumentStorage = require('../services/TripDocumentStorage');
const dispatchPolicy = require('../config/dispatchPolicy');
const documentPolicy = require('../config/tripDocumentPolicy');
const { ValidationError } = require('../utils/AppError');

const ADMIN = { user_id: 1, role: 'admin', name: 'System Administrator' };

// ===========================================================================
// In-memory Prisma stand-in
// ===========================================================================

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return value !== cond.not;
      if ('gte' in cond) return new Date(value) >= new Date(cond.gte);
      if ('lte' in cond) return new Date(value) <= new Date(cond.lte);
      if ('gt' in cond) return new Date(value) > new Date(cond.gt);
      if ('lt' in cond) return new Date(value) < new Date(cond.lt);
    }
    return value === cond;
  });
}

let autoId = 0;

/** A table with the subset of Prisma's API the Phase 9 services actually use. */
function table(rows, { keyField = null, uniqueOn = [] } = {}) {
  return {
    rows,
    async findMany({ where, orderBy, take } = {}) {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy) {
        const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
        out = [...out].sort((a, b) => {
          for (const c of clauses) {
            for (const [k, dir] of Object.entries(c)) {
              if (a[k] === b[k]) continue;
              if (a[k] === null || a[k] === undefined) return 1;
              if (b[k] === null || b[k] === undefined) return -1;
              return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
            }
          }
          return 0;
        });
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => ({ ...r }));
    },
    async findFirst(args = {}) {
      const out = await this.findMany(args);
      return out.length ? out[0] : null;
    },
    async findUnique({ where } = {}) {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    },
    async create({ data }) {
      autoId += 1;
      const row = { ...data };
      if (keyField && row[keyField] === undefined) row[keyField] = autoId;
      // ENFORCE the uniqueness the real schema declares, so idempotency is a
      // database property in this test rather than a hope.
      for (const [i, field] of [keyField, ...uniqueOn].filter(Boolean).entries()) {
        if (row[field] === undefined || row[field] === null) continue;
        const clash = rows.find((r) => r[field] === row[field]);
        if (clash) {
          const err = new Error(`Unique constraint failed on ${field} (key ${i})`);
          err.code = 'P2002';
          throw err;
        }
      }
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    },
    async count({ where } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

/**
 * Resolve the `include` shapes the Phase 9 services ask for.
 *
 * Deliberately narrow: it understands exactly the relations these services read,
 * and returns `null` for anything it does not know rather than pretending. A
 * relation that does not exist is a true "not included", not a silent `{}` —
 * which is exactly how the real Prisma client behaves, and why naming an
 * undefined relation is a hard error rather than a warning.
 */
const INCLUDE_FK = {
  vehicle: ['transportVehicle', 'vehicle_id'],
  driver: ['driver', 'driver_id'],
  transportOwner: ['vehicleOwner', 'owner_id'],
  booking: ['booking', 'booking_id'],
  user: ['user', 'user_id'],
  client: ['client', 'client_id'],
};

function applyInclude(row, include, state) {
  if (!include || !row) return row ? { ...row } : row;
  const out = { ...row };

  for (const [key, spec] of Object.entries(include)) {
    // `documents: { orderBy: ... }` — a LIST relation, keyed on the parent.
    if (key === 'documents') {
      const rows = state.tables.tripDocument.rows
        .filter((r) => r.trip_id === row.trip_id)
        .map((r) => ({ ...r }));
      const clauses = Array.isArray(spec?.orderBy) ? spec.orderBy : [spec?.orderBy].filter(Boolean);
      rows.sort((a, b) => {
        for (const c of clauses) {
          for (const [k, dir] of Object.entries(c)) {
            if (a[k] === b[k]) continue;
            return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
          }
        }
        return 0;
      });
      out.documents = rows;
      continue;
    }

    const mapped = INCLUDE_FK[key];
    if (!mapped) { out[key] = null; continue; }

    const [tableName, pk] = mapped;
    const relRows = state.tables[tableName].rows;
    const match = relRows.find((r) => r[pk] === row[pk]);
    out[key] = match ? applyInclude(match, spec?.include || null, state) : null;
  }

  return out;
}

/**
 * A trip in the requested state with a vehicle, a driver and a booking that
 * carries the PLANNED goods figures.
 */
// Auto-increment ids must start ABOVE every id the fixture seeds by hand,
// otherwise the first generated row collides with a seeded one and the fake
// reports a uniqueness failure that the real database would never produce.
autoId = 1000;

function makeDb({
  status = 'LOADED',
  withVehicle = true,
  withDriver = true,
  freight = 60000,
  valueOfGoods = null,
  loadingCompleted = true,
  vehicleDocs = {},
  insuranceRequired = null,
  podRequired = null,
  documents = ['LR', 'INVOICE', 'E_WAY_BILL'],
} = {}) {
  const state = { tables: {} };

  state.tables.trip = table([{
    trip_id: 1,
    trip_number: 'BTBT-2026-00009',
    booking_id: 900,
    user_id: 700,
    client_id: null,
    pickup_location: 'Kosi Farm Gate',
    pickup_city: 'Begusarai',
    drop_location: 'Mandi Yard',
    drop_city: 'Patna',
    distance_km: 1490,
    expected_delivery_date: new Date('2026-10-06T00:00:00Z'),
    freight_amount: freight,
    driver_payment: null,
    owner_payment: null,
    vehicle_id: withVehicle ? 100 : null,
    driver_id: withDriver ? 200 : null,
    transport_owner_id: 300,
    status,
    documents_required: null,
    sent_to_loading_at: new Date('2026-10-03T02:00:00Z'),
    arrived_at_loading_at: new Date('2026-10-03T04:00:00Z'),
    loading_started_at: new Date('2026-10-03T05:00:00Z'),
    loading_completed_at: loadingCompleted ? new Date('2026-10-03T07:30:00Z') : null,
    loading_remarks: 'Loaded in 4 hours',
    loaded_by: 'Loader Ram',
    dispatched_at: null,
    actual_quantity: loadingCompleted ? 500 : null,
    actual_quantity_unit: loadingCompleted ? 'Bags' : null,
    actual_weight_kg: loadingCompleted ? 25000 : null,
    pod_required: podRequired,
    insurance_required: insuranceRequired,
    value_of_goods: valueOfGoods,
    current_latitude: null,
    current_longitude: null,
    location_updated_at: null,
    location_source: null,
    location_accuracy_m: null,
    estimated_arrival_at: null,
    eta_calculated_at: null,
    distance_remaining_km: null,
    arrived_at_destination_at: null,
    arrival_remarks: null,
    delivered_receiver_name: null,
    delivery_remarks: null,
    delivered_quantity: null,
    delivered_quantity_unit: null,
    delivered_weight_kg: null,
    trip_date: new Date('2026-10-01T00:00:00Z'),
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    completed_at: null,
    cancelled_at: null,
  }], { keyField: 'trip_id' });

  state.tables.transportVehicle = table(withVehicle ? [{
    vehicle_id: 100,
    vehicle_number: 'BR09CC0004',
    vehicle_type: 'TRUCK',
    vehicle_name: 'Tata 407',
    body_type: 'Open Body',
    capacity_kg: 5000,
    owner_id: 300,
    is_available: true,
    current_status: 'available',
    // Every statutory paper valid for two years, unless a test overrides one.
    insurance_number: 'INS-1', insurance_expiry: '2028-01-01',
    permit_number: 'PM-1', permit_expiry: '2028-01-01',
    fitness_number: 'FT-1', fitness_expiry: '2028-01-01',
    pollution_certificate: 'PUCC-1', pollution_expiry: '2028-01-01',
    tax_number: 'TX-1', tax_expiry: '2028-01-01',
    national_permit_number: null, national_permit_expiry: null,
    ...vehicleDocs,
  }] : [], { keyField: 'vehicle_id' });

  state.tables.driver = table(withDriver ? [{
    driver_id: 200,
    driver_name: 'Kaushal',
    mobile: '9876543210',
    is_available: true,
    status: 'available',
  }] : [], { keyField: 'driver_id' });

  state.tables.vehicleOwner = table([{ owner_id: 300, owner_name: 'Patna Carriers' }], { keyField: 'owner_id' });
  state.tables.user = table([{ user_id: 700, first_name: 'Sejal', last_name: 'Customer', phone: '9000000000', email: 'sejal@example.test' }], { keyField: 'user_id' });
  state.tables.client = table([], { keyField: 'client_id' });

  state.tables.booking = table([{
    booking_id: 900,
    booking_number: 'BTB-2026-00009',
    user_id: 700,
    goods_description: 'Wheat',
    number_of_items: 500,
    quantity_unit: 'Bags',
    goods_weight_kg: 25000,
    weight_unit: 'KG',
    drop_address: 'Mandi Yard, Patna',
    final_price: freight,
    quotationSnapshot: null,
  }], { keyField: 'booking_id' });

  state.tables.bookingQuotationSnapshot = table([{
    snapshot_id: 1,
    booking_id: 900,
    quotation_id: 55,
    rate_type: 'FIXED',
    rate: freight,
    freight,
    total_freight: freight,
    gst_type: 'RCM',
    gst_percentage: 5,
    gst_amount: 0,
    total_additional_charges: 3000,
    additional_charges_tax: 0,
    total_billing_amount: freight + 3000,
    validity_days: 15,
    payment_schedule_type: 'FULL_PAYMENT_IN_ADVANCE',
    schedule_total: 0,
    schedule_remaining: 0,
    captured_at: new Date('2026-09-30T00:00:00Z'),
  }], { keyField: 'snapshot_id' });

  state.tables.quotationCharge = table([
    { charge_id: 1, quotation_id: 55, charges_name: 'Detention', rate: 1500, quantity: 2, quantity_unit: 'Days', total: 3000, sort_order: 0 },
    { charge_id: 2, quotation_id: 55, charges_name: 'Loading', rate: 500, quantity: 1, quantity_unit: null, total: 500, sort_order: 1 },
  ], { keyField: 'charge_id' });

  // The mandatory paperwork, as `TripDocumentService` would have written it.
  state.tables.tripDocument = table(
    documents.map((type, i) => ({
      document_id: i + 1,
      trip_id: 1,
      document_type: type,
      document_status: 'PRESENT',
      reference_number: type === 'LR' ? 'LR-2026-00125' : `${type}-REF-1`,
      issued_at: new Date('2026-10-03T07:00:00Z'),
      expires_at: null,
      file_url: `/uploads/1/${type}/scan.pdf`,
      is_uploaded: true,
      is_verified: false,
      verified_by: null,
      verified_at: null,
      remarks: null,
      created_by: 1,
      created_at: new Date('2026-10-03T07:05:00Z'),
      updated_at: new Date('2026-10-03T07:05:00Z'),
    })),
    { keyField: 'document_id' },
  );

  state.tables.tripTimeline = table([], { keyField: 'timeline_id' });
  state.tables.auditLog = table([], { keyField: 'audit_id' });
  // `trip_dispatches.trip_id` is UNIQUE in the real schema: one dispatch act
  // per consignment, enforced by PostgreSQL.
  state.tables.tripDispatch = table([], { keyField: 'dispatch_id', uniqueOn: ['trip_id'] });
  state.tables.ewayBill = table([], { keyField: 'eway_bill_id' });
  state.tables.tripInsurance = table([], { keyField: 'insurance_id' });
  state.tables.tripIncident = table([], { keyField: 'incident_id' });
  state.tables.tripVehicleChange = table([], { keyField: 'change_id' });
  state.tables.invoice = table([], { keyField: 'invoice_id' });
  state.tables.financialTransaction = table([], { keyField: 'transaction_id' });
  state.tables.tripFinancial = table([], { keyField: 'trip_financial_id' });
  state.tables.vehicleHire = table([], { keyField: 'hire_id' });

  // The client surface the services use.
  const client = {};
  for (const [name, t] of Object.entries(state.tables)) {
    client[camel(name)] = {
      findMany: (a) => t.findMany(a),
      findFirst: (a) => t.findFirst(a),
      findUnique: (a) => t.findUnique(a),
      create: (a) => t.create(a),
      update: (a) => t.update(a),
      count: (a) => t.count(a),
    };
  }

  // Trip needs the `include` shape, and an `$transaction` that is real enough
  // for the atomicity test: it snapshots and restores on failure.
  client.trip = {
    findUnique: async ({ where, include }) => {
      const row = state.tables.trip.rows.find((r) => matches(r, where));
      return row ? applyInclude(row, include, state) : null;
    },
    findFirst: async ({ where } = {}) => {
      const row = state.tables.trip.rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    },
    findMany: ({ where, orderBy } = {}) => state.tables.trip.findMany({ where, orderBy }),
    update: ({ where, data }) => state.tables.trip.update({ where, data }),
    create: ({ data }) => state.tables.trip.create({ data }),
  };

  client.auditLog = {
    create: ({ data }) => state.tables.auditLog.create({ data }),
    findMany: ({ where } = {}) => state.tables.auditLog.findMany({ where }),
  };

  // `TripInvoiceService` reads the confirmed commercial snapshot through
  // `booking.findUnique({ include: { quotationSnapshot: true } })`. Without this
  // the include resolves to nothing and every invoice test would silently be
  // asserting the trip-freight fallback instead of the quotation figures.
  client.booking = {
    findUnique: async ({ where, include } = {}) => {
      const row = state.tables.booking.rows.find((r) => matches(r, where));
      if (!row) return null;
      if (!include?.quotationSnapshot) return { ...row };
      const snap = state.tables.bookingQuotationSnapshot.rows.find((s) => s.booking_id === row.booking_id);
      return { ...row, quotationSnapshot: snap ? { ...snap } : null };
    },
    findFirst: ({ where } = {}) => state.tables.booking.findFirst({ where }),
    findMany: ({ where } = {}) => state.tables.booking.findMany({ where }),
  };

  client.$transaction = async (fn) => {
    const snapshot = JSON.stringify(
      Object.fromEntries(Object.entries(state.tables).map(([k, t]) => [k, t.rows])),
    );
    try {
      return await fn(client);
    } catch (err) {
      // Roll back EVERY table — this is what makes scenario 17 provable.
      const restored = JSON.parse(snapshot);
      for (const [k, rows] of Object.entries(restored)) state.tables[k].rows.splice(0, state.tables[k].rows.length, ...rows);
      throw err;
    }
  };

  return { client, state };
}

function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * A trip with everything in place, plus the paperwork captured as a DRAFT
 * dispatch row — exactly the state a truck at the loading gate is really in
 * once an operator has typed in the LR and the consignee.
 *
 * `insuranceRequired: false` is the default on purpose: the fixture declares a
 * goods value of ₹120,000, which under the real policy DOES require transit
 * insurance. Test 21 asserts that rule; leaving it on by default here would make
 * every other test fail for a reason that has nothing to do with what it checks.
 */
function readyDb(overrides = {}) {
  const db = makeDb({ insuranceRequired: false, ...overrides });
  db.state.tables.tripDispatch.rows.push({
    dispatch_id: 1,
    trip_id: 1,
    // A placeholder instant: a DRAFT row has not happened yet, and the real
    // instant is written when the vehicle actually leaves.
    dispatched_at: new Date('2099-01-01T00:00:00Z'),
    dispatch_origin: 'ADMIN',
    lr_gr_number: 'LR-2026-00125',
    lr_gr_document_id: 1,
    lr_gr_remarks: null,
    delivery_number: 'DL-77',
    consignee_name: 'Begum Bazar Rice Mill',
    consignee_contact: '9123456789',
    consignee_address: null,
    value_of_goods: 120000,
    actual_quantity: 500,
    actual_quantity_unit: 'Bags',
    actual_weight_kg: 25000,
    invoice_id: null,
    eway_bill_id: null,
    insurance_id: null,
    pod_required: false,
    status: 'PENDING',
    created_by: 1,
    created_at: new Date('2026-10-03T08:00:00Z'),
    updated_at: new Date('2026-10-03T08:00:00Z'),
  });
  return db;
}

// ===========================================================================
// 1–3 · The status gate
// ===========================================================================

test('1. cannot dispatch from ASSIGNED', async () => {
  const { client } = readyDb({ status: 'ASSIGNED' });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('TRIP_NOT_LOADED'));

  await assert.rejects(
    () => service.dispatch(1, {}, ADMIN),
    (err) => err instanceof ValidationError && /cannot be dispatched|cannot be completed/i.test(err.message),
  );
});

test('2. cannot dispatch from TO_LOADING_POINT', async () => {
  const { client } = readyDb({ status: 'TO_LOADING_POINT' });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('TRIP_NOT_LOADED'));

  // The operator is told WHICH stage it is at, in words they can act on.
  const check = readiness.checks.find((c) => c.key === 'trip_status');
  assert.match(check.message, /on its way to the loading point/i);

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), ValidationError);
});

test('3. cannot dispatch from AT_LOADING_POINT when loading is incomplete', async () => {
  const { client } = readyDb({ status: 'AT_LOADING_POINT', loadingCompleted: false });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('TRIP_NOT_LOADED'));
  assert.ok(readiness.blocker_codes.includes('LOADING_NOT_COMPLETED'));

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), ValidationError);
});

test('3b. LOADED without a recorded loading fact is still blocked', async () => {
  // A trip that reached LOADED through a legacy path without anyone writing
  // down what went on the truck must not be dispatchable.
  const { client } = readyDb({ status: 'LOADED', loadingCompleted: false });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('LOADING_NOT_COMPLETED'));
  await assert.rejects(() => service.dispatch(1, {}, ADMIN), ValidationError);
});

// ===========================================================================
// 4–6 · The paperwork
// ===========================================================================

test('4. cannot dispatch when the required E-Way Bill is missing', async () => {
  const { client } = readyDb({ documents: ['LR', 'INVOICE'], valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('EWAY_BILL_REQUIRED'));

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /E-Way Bill/i);
    return true;
  });
});

test('4b. a small consignment does not need an E-Way Bill', async () => {
  const { client } = readyDb({ documents: ['LR', 'INVOICE'], valueOfGoods: 12000 });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers));

  const check = readiness.checks.find((c) => c.key === 'eway_bill');
  assert.equal(check.blocking, false);
  assert.match(check.message, /not required/i);
});

test('5. cannot dispatch when the required LR/GR is missing', async () => {
  const { client, state } = readyDb();
  // Remove the LR document AND the LR number from the draft dispatch record.
  state.tables.tripDocument.rows.splice(0, state.tables.tripDocument.rows.length);
  state.tables.tripDispatch.rows[0].lr_gr_number = null;
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('LR_GR_REQUIRED'));

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), (err) => {
    assert.match(err.message, /LR\/GR/i);
    return true;
  });
});

test('6. cannot dispatch when another required document is missing', async () => {
  const { client } = readyDb({ documents: ['LR', 'E_WAY_BILL'], valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('DOCUMENT_MISSING'));
  assert.ok(readiness.blockers.some((b) => /Party Invoice/i.test(b.message)));

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), ValidationError);
});

test('6b. a rejected document does not satisfy a requirement', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const invoice = state.tables.tripDocument.rows.find((d) => d.document_type === 'INVOICE');
  invoice.document_status = 'REJECTED';
  const service = new TripDispatchService({ prisma: client });

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blocker_codes.includes('DOCUMENT_MISSING'));
});

// ===========================================================================
// 7–11 · The happy path
// ===========================================================================

test('7. CAN dispatch when every mandatory requirement passes', async () => {
  const { client } = readyDb({ valueOfGoods: 120000 });
  // The E-Way Bill must be RECORDED, not merely required. Seed it the way the
  // operator would.
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, {
    eway_bill_number: '121234567890',
    eway_bill_date: '2026-10-03',
    expiry_at: '2026-10-20',
  }, ADMIN);

  const before = await service.getReadiness(1);
  assert.equal(before.ready, true, JSON.stringify(before.blockers));

  const result = await service.dispatch(1, { pod_required: true }, ADMIN);
  assert.equal(result.idempotent, false);
  assert.equal(result.status, 'DISPATCHED');
});

test('8. dispatch changes the status LOADED → DISPATCHED', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  await service.dispatch(1, {}, ADMIN);

  assert.equal(state.tables.trip.rows[0].status, 'DISPATCHED');
  assert.ok(state.tables.trip.rows[0].dispatched_at, 'dispatched_at is recorded');
});

test('9. dispatch creates a movement-history entry', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  const before = state.tables.tripTimeline.rows.length;
  const result = await service.dispatch(1, {}, ADMIN);
  assert.equal(result.movement_history_recorded, true);

  const events = state.tables.tripTimeline.rows;
  assert.equal(events.length, before + 1);

  const event = events[events.length - 1];
  assert.equal(event.event_type, 'vehicle_dispatched');
  assert.equal(event.description, 'Vehicle dispatched');
  assert.equal(event.created_by, ADMIN.user_id);

  // The metadata carries what an operator needs to read the timeline later.
  const meta = JSON.parse(event.metadata);
  assert.equal(meta.to, 'DISPATCHED');
  assert.equal(meta.from, 'LOADED');
  assert.equal(meta.vehicle_number, 'BR09CC0004');
  assert.equal(meta.driver_name, 'Kaushal');
  assert.equal(meta.lr_gr_number, 'LR-2026-00125');
  assert.equal(meta.eway_bill_number, '121234567890');
});

test('10. dispatch creates an audit entry', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  await service.dispatch(1, {}, ADMIN);

  const audit = state.tables.auditLog.rows.filter((a) => a.action === 'trip_dispatched');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity_type, 'Trip');
  assert.equal(audit[0].entity_id, 1);
  assert.equal(audit[0].user_id, 1);

  // Who / what / old / new — the four things an audit entry has to answer.
  assert.match(JSON.parse(audit[0].previous_value).status, /^LOADED$/);
  assert.match(JSON.parse(audit[0].new_value).status, /^DISPATCHED$/);
});

test('11. dispatch data persists after a refresh', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const first = new TripDispatchService({ prisma: client });
  await first.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);
  await first.dispatch(1, { pod_required: true, consignee_name: 'Mill', consignee_contact: '9123456789' }, ADMIN);

  // A COMPLETELY NEW service instance — the equivalent of reloading the page.
  const second = new TripDispatchService({ prisma: client });
  const ws = await second.getWorkspace(1);

  assert.equal(ws.status, 'DISPATCHED');
  assert.ok(ws.dispatch, 'the dispatch record is still there');
  assert.equal(ws.dispatch.pod_required, true);
  assert.equal(ws.lr_gr.number, 'LR-2026-00125');
  assert.equal(ws.eway_bill.internal.number, '121234567890');
  assert.equal(ws.delivery.consignee_name, 'Mill');
  assert.equal(state.tables.trip.rows[0].pod_required, true, 'POD is on the trip too');
});

test('13. the E-Way Bill is linked to the Trip', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  assert.equal(state.tables.ewayBill.rows.length, 1);
  const bill = state.tables.ewayBill.rows[0];
  assert.equal(bill.trip_id, 1);
  assert.equal(bill.eway_bill_number, '121234567890');
  assert.equal(bill.current_vehicle_number, 'BR09CC0004');

  // A second save UPDATES the same row — one e-way bill per consignment.
  await service.saveEwayBill(1, { eway_bill_number: '121234567891', expiry_at: '2026-10-21' }, ADMIN);
  assert.equal(state.tables.ewayBill.rows.length, 1);
  assert.equal(state.tables.ewayBill.rows[0].eway_bill_number, '121234567891');
});

test('14. the LR/GR is linked to the Trip and to the dispatch record', async () => {
  const { client, state } = readyDb();
  const service = new TripDispatchService({ prisma: client });

  // Replace the seeded LR with a freshly recorded one through the real module.
  state.tables.tripDocument.rows.splice(0, state.tables.tripDocument.rows.length);
  const result = await service.saveLrGr(1, {
    document_type: 'LR',
    reference_number: 'LR-2026-00999',
    issued_at: '2026-10-03',
  }, ADMIN);

  assert.equal(result.document.document_type, 'LR');
  assert.equal(result.document.trip_id, 1);
  assert.equal(state.tables.tripDispatch.rows[0].lr_gr_number, 'LR-2026-00999');
  assert.equal(state.tables.tripDispatch.rows[0].lr_gr_document_id, result.document.document_id);

  // One timeline entry — the operator does not record it by hand.
  const lrEvents = state.tables.tripTimeline.rows.filter((e) => e.event_type === 'lr_gr_recorded');
  assert.equal(lrEvents.length, 1);
});

test('15. the POD requirement persists', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  await service.dispatch(1, { pod_required: true }, ADMIN);
  assert.equal(state.tables.trip.rows[0].pod_required, true);
  assert.equal(state.tables.tripDispatch.rows[0].pod_required, true);

  const ws = await new TripDispatchService({ prisma: client }).getWorkspace(1);
  assert.equal(ws.delivery.pod_required, true);

  // POD NOT required is equally a persisted fact, not an absence.
  const db2 = readyDb({ valueOfGoods: 120000 });
  const s2 = new TripDispatchService({ prisma: db2.client });
  await s2.saveEwayBill(1, { eway_bill_number: '1', expiry_at: '2026-10-20' }, ADMIN);
  await s2.dispatch(1, { pod_required: false }, ADMIN);
  assert.equal(db2.state.tables.trip.rows[0].pod_required, false);
});

// ===========================================================================
// 16–17 · Idempotency and atomicity
// ===========================================================================

test('16. a repeated dispatch does not create a second dispatch record', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  const first = await service.dispatch(1, {}, ADMIN);
  const second = await service.dispatch(1, {}, ADMIN);
  const third = await service.dispatch(1, {}, ADMIN);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(third.idempotent, true);
  assert.equal(second.status, 'DISPATCHED');

  assert.equal(state.tables.tripDispatch.rows.length, 1, 'exactly one dispatch record');
  const dispatchEvents = state.tables.tripTimeline.rows.filter((e) => e.event_type === 'vehicle_dispatched');
  assert.equal(dispatchEvents.length, 1, 'and exactly one movement-history entry');
});

test('16b. the database refuses a second dispatch row for the same trip', async () => {
  const { client, state } = readyDb();
  // Even if the service guard were bypassed, the UNIQUE index holds.
  await assert.rejects(() => state.tables.tripDispatch.create({
    data: { trip_id: 1, dispatched_at: new Date(), pod_required: false },
  }), /Unique constraint/);
});

test('17. a failed dispatch writes NOTHING', async () => {
  const { client, state } = readyDb({ documents: ['LR'], valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });

  const beforeTrip = { ...state.tables.trip.rows[0] };
  const beforeTimeline = state.tables.tripTimeline.rows.length;
  const beforeAudit = state.tables.auditLog.rows.length;
  const beforeDispatch = state.tables.tripDispatch.rows.length;

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), ValidationError);

  assert.deepEqual(state.tables.trip.rows[0], beforeTrip, 'the trip row is untouched');
  assert.equal(state.tables.tripTimeline.rows.length, beforeTimeline, 'no timeline event');
  assert.equal(state.tables.auditLog.rows.length, beforeAudit, 'no audit entry');
  assert.equal(state.tables.tripDispatch.rows.length, beforeDispatch, 'no dispatch record');
});

test('17b. a failure inside the transaction rolls the whole thing back', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });
  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);

  const beforeTrip = { ...state.tables.trip.rows[0] };
  const beforeTimeline = state.tables.tripTimeline.rows.length;
  const beforeAudit = state.tables.auditLog.rows.length;
  const beforeDispatch = state.tables.tripDispatch.rows.length;

  // Make the audit write explode — the LAST thing the transaction does. A
  // partial write would leave a DISPATCHED trip with no audit trail.
  const realAuditCreate = client.auditLog.create;
  client.auditLog.create = async () => { throw new Error('simulated audit failure'); };

  await assert.rejects(() => service.dispatch(1, {}, ADMIN), /simulated audit failure/);

  client.auditLog.create = realAuditCreate;

  assert.equal(state.tables.trip.rows[0].status, beforeTrip.status, 'the status did not move');
  assert.equal(state.tables.trip.rows[0].dispatched_at, beforeTrip.dispatched_at, 'dispatched_at was not written');
  assert.equal(state.tables.tripTimeline.rows.length, beforeTimeline);
  assert.equal(state.tables.auditLog.rows.length, beforeAudit);
  assert.equal(state.tables.tripDispatch.rows.length, beforeDispatch, 'no orphan dispatch row');
});

// ===========================================================================
// 18–22 · Honesty contracts
// ===========================================================================

test('18. no government E-Way Bill confirmation is ever written', async () => {
  const { client, state } = readyDb({ valueOfGoods: 120000 });
  const service = new TripDispatchService({ prisma: client });

  await service.saveEwayBill(1, { eway_bill_number: '121234567890', expiry_at: '2026-10-20' }, ADMIN);
  await service.saveEwayBill(1, { eway_bill_number: '121234567891', expiry_at: '2026-10-21' }, ADMIN);

  const bill = state.tables.ewayBill.rows[0];
  assert.equal(bill.gov_sync_status, 'NOT_CONNECTED');
  assert.equal(bill.gov_eway_bill_number, null);
  assert.equal(bill.gov_synced_at, null);
  assert.equal(bill.gov_response, null);

  const readiness = await service.getReadiness(1);
  assert.equal(readiness.eway_bill_integration,
    'Internal record only — Government E-Way Bill API not connected.');
});

