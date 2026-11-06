const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('module');

/**
 * ManualOrderService unit tests.
 *
 * Mocks prisma and the timeline/audit repositories via require.cache so no
 * database is touched. Validates orchestration: validation, client
 * resolution/dedup, single transaction, MANUAL source, PENDING trip, canonical
 * numbers, backend financial recalculation.
 */

function seedMock(absFrom, specifier, exports) {
  const req = createRequire(absFrom);
  const resolved = req.resolve(specifier);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function makeTx() {
  const clients = [];
  const bookings = [];
  const trips = [];
  const tripFinancials = [];
  const base = {
    client: {
      findUnique: async ({ where }) => clients.find((c) => c.client_id === where.client_id && !c.deleted_at) || null,
      findFirst: async ({ where }) => {
        if (where.phone) return clients.find((c) => c.phone === where.phone && !c.deleted_at) || null;
        return null;
      },
      create: async ({ data }) => {
        const id = clients.length + 101;
        const c = { client_id: id, client_code: `CLI-${id}`, deleted_at: null, ...data };
        clients.push(c);
        return c;
      },
      update: async ({ where, data }) => {
        const c = clients.find((x) => x.client_id === where.client_id);
        Object.assign(c, data, { updated_at: new Date() });
        return c;
      },
    },
    booking: {
      create: async ({ data }) => {
        const id = bookings.length + 5001;
        const b = { booking_id: id, ...data };
        bookings.push(b);
        return b;
      },
      update: async ({ where, data }) => {
        const b = bookings.find((x) => x.booking_id === where.booking_id);
        Object.assign(b, data);
        return b;
      },
      findUnique: async ({ where }) => {
        if (where.booking_id) return bookings.find((b) => b.booking_id === where.booking_id) || null;
        if (where.idempotency_key) return bookings.find((b) => b.idempotency_key === where.idempotency_key) || null;
        return null;
      },
      findFirst: async ({ where }) => bookings.find((b) => {
        if (where.confirmation_source !== undefined && b.confirmation_source !== where.confirmation_source) return false;
        if (where.user_id !== undefined && b.user_id !== where.user_id) return false;
        if (where.pickup_city !== undefined && b.pickup_city !== where.pickup_city) return false;
        if (where.drop_city !== undefined && b.drop_city !== where.drop_city) return false;
        if (where.goods_description !== undefined && b.goods_description !== where.goods_description) return false;
        if (where.final_price !== undefined && b.final_price !== where.final_price) return false;
        return true;
      }) || null,
    },
    trip: {
      create: async ({ data }) => {
        const id = trips.length + 9001;
        const t = { trip_id: id, ...data };
        trips.push(t);
        return t;
      },
      update: async ({ where, data }) => {
        const t = trips.find((x) => x.trip_id === where.trip_id);
        Object.assign(t, data);
        return t;
      },
      findFirst: async ({ where }) => trips.find((t) => t.booking_id === where.booking_id) || null,
    },
    tripFinancial: { create: async ({ data }) => { tripFinancials.push(data); return data; } },
    delivery: { create: async ({ data }) => data },
    user: { findUnique: async ({ where }) => ({ user_id: where.user_id }) },
    $transaction: async (cb) => cb(base),
  };
  return { tx: base, clients, bookings, trips, tripFinancials };
}

const absService = require.resolve('../services/ManualOrderService.js');

async function loadService(tx, bookings) {
  const prisma = {
    $transaction: async (cb) => cb(tx),
    booking: {
      findUnique: async ({ where }) => {
        if (where.booking_id) return bookings.find((b) => b.booking_id === where.booking_id) || null;
        if (where.idempotency_key) return bookings.find((b) => b.idempotency_key === where.idempotency_key) || null;
        return null;
      },
      findFirst: async () => null,
    },
    trip: { findFirst: async () => null },
  };

  const noopRepo = class {
    addEvent() { return {}; }
    create() { return {}; }
  };

  seedMock(absService, '../config/prisma', { default: prisma, prisma });
  seedMock(absService, '../repositories/BookingTimelineRepository', noopRepo);
  seedMock(absService, '../repositories/TripTimelineRepository', noopRepo);
  seedMock(absService, '../repositories/AuditLogRepository', noopRepo);

  delete require.cache[absService];
  const ManualOrderService = require('../services/ManualOrderService.js');
  return new ManualOrderService();
}

const actor = { adminId: 1, adminName: 'Admin User', ipAddress: '127.0.0.1', userAgent: 'test' };

// Manual orders are owned by a reserved system customer user (never the admin's id).
process.env.MANUAL_ORDER_SYSTEM_USER_ID = '1';

const baseInput = {
  orderInfo: { orderDate: '2026-11-04', branch: 'Begusarai' },
  customer: { clientId: null, newClient: { companyName: 'ABC Industries', contactPerson: 'Ramesh', phone: '9876543210', email: 'r@abc.com', address: 'Main Rd', city: 'Begusarai', state: 'Bihar', gstNumber: 'GST123', panNumber: 'PAN123' } },
  pickup: { location: 'Begusarai Depot', address: 'Near Chowk', city: 'Begusarai', state: 'Bihar', pincode: '851101', contactPerson: 'Ramesh', contactNumber: '9876543210' },
  drop: { location: 'Khagaria Market', address: 'Main Bazar', city: 'Khagaria', state: 'Bihar', pincode: '851204', contactPerson: 'Suresh', contactNumber: '9876543211' },
  distance_km: 45,
  tripType: 'One Way',
  goods: { description: 'Pipes', category: 'Building Material', quantity: '100', quantityUnit: 'Pieces', weight: '7', weightUnit: 'Tons', packageType: 'Bundles', specialInstructions: 'Handle with care', value: '70000' },
  vehicle: { type: 'Truck', size: '22 ft', requiredQuantity: 1, tripDate: '2026-11-05', expectedDeliveryDate: '2026-11-06', specialRequirements: '', remarks: '' },
  commercial: { rateType: 'per_trip', rateAsPer: 'per_trip', rate: '15000', freightAmount: '15000', gstType: 'FORWARD_CHARGE', gstPercentage: '5', gstAmount: '', additionalCharges: [{ name: 'Toll', rate: '500', quantity: '1', total: '' }], additionalChargesTax: '', totalBillingAmount: '', paymentTerms: 'FULL_PAYMENT_IN_ADVANCE', paymentRemarks: 'Advance paid' },
  operational: { podRequired: true, partyInvoiceRequired: 'yes', ewayBillRequired: 'to_be_confirmed', lrGrRequired: 'yes', specialDocuments: '', remarks: '' },
  idempotency_key: 'test-idempotency-key-abcdefghijklmnopqrstuvwxyz',
};

test('createManualOrder creates booking + trip with MANUAL source and PENDING status', async (t) => {
  const { tx, clients, bookings } = makeTx();
  const service = await loadService(tx, bookings);
  const result = await service.createManualOrder(baseInput, actor);

  assert.equal(result.success, true);
  assert.equal(result.data.source_type, 'MANUAL');
  assert.ok(result.data.booking.booking_number.match(/^BTB-\d{4}-\d{5}$/));
  assert.ok(result.data.trip.trip_number.match(/^BTBT-\d{4}-\d{5}$/));
  assert.equal(result.data.trip.status, 'PENDING');
  assert.equal(result.data.trip.vehicle_id, null);
  assert.equal(result.data.trip.driver_id, null);
  assert.equal(result.data.client.company_name, 'ABC Industries');
  assert.equal(clients.length, 1);
});

test('createManualOrder validates missing required fields', async (t) => {
  const { tx, bookings } = makeTx();
  const service = await loadService(tx, bookings);
  let threw = false;
  try {
    await service.createManualOrder({ orderInfo: {} }, actor);
  } catch (err) {
    threw = true;
    assert.equal(err.name, 'ValidationError');
  }
  assert.equal(threw, true, 'expected validation error');
});

test('createManualOrder deduplicates clients by phone', async (t) => {
  const { tx, clients, bookings } = makeTx();
  tx.client.create({ data: { company_name: 'Existing', contact_person: 'Old', phone: '9876543210', status: 'active', is_active: true } });
  const service = await loadService(tx, bookings);
  const input = JSON.parse(JSON.stringify(baseInput));
  const result = await service.createManualOrder(input, actor);
  assert.equal(result.success, true);
  const phones = clients.filter((c) => c.phone === '9876543210');
  assert.equal(phones.length, 1, 'client must not be duplicated by phone');
});

test('existing customer selection links the client', async (t) => {
  const { tx, clients, bookings } = makeTx();
  tx.client.create({ data: { client_id: 77, client_code: 'CLI-77', company_name: 'Existing Corp', contact_person: 'X', phone: '1111111111', status: 'active', is_active: true } });
  const service = await loadService(tx, bookings);
  const input = JSON.parse(JSON.stringify(baseInput));
  input.customer.clientId = 77;
  input.customer.newClient = {};
  const result = await service.createManualOrder(input, actor);
  assert.equal(result.success, true);
  assert.equal(result.data.client.client_id, 77);
});

test('no vehicle is assigned at creation (waiting for vehicle)', async (t) => {
  const { tx, bookings } = makeTx();
  const service = await loadService(tx, bookings);
  const result = await service.createManualOrder(baseInput, actor);
  assert.equal(result.data.trip.vehicle_id, null);
  assert.equal(result.data.trip.driver_id, null);
});

test('backend recalculates GST and ignores frontend-supplied gstAmount', async (t) => {
  const { tx, bookings, trips, tripFinancials } = makeTx();
  const service = await loadService(tx, bookings);
  const input = JSON.parse(JSON.stringify(baseInput));
  // Frontend sends a WRONG gstAmount and totalBillingAmount
  input.commercial.gstAmount = '999999';
  input.commercial.totalBillingAmount = '999999';
  input.commercial.freightAmount = '10000';
  input.commercial.gstPercentage = '10';
  input.commercial.gstType = 'FORWARD_CHARGE';
  input.commercial.additionalCharges = [{ name: 'Toll', rate: '500', quantity: '2', total: '999999' }];
  input.commercial.additionalChargesTax = '0';

  const result = await service.createManualOrder(input, actor);
  assert.equal(result.success, true);

  // Backend must have recomputed: GST = 10000 * 10% = 1000; Toll total = 500 * 2 = 1000
  // total = 10000 + 1000 + 1000 + 0 = 12000
  // Stored in TripFinancial.customer_fare (not booking.final_price which is the frontend value)
  const financial = tripFinancials[tripFinancials.length - 1];
  assert.equal(financial.customer_fare, 12000, 'Total billing must be recomputed by backend');
  assert.notEqual(financial.customer_fare, 999999, 'Must not trust frontend-supplied total');
});

test('backend rejects non-numeric distance/quantity/weight', async (t) => {
  const { tx, bookings } = makeTx();
  const service = await loadService(tx, bookings);
  const input = JSON.parse(JSON.stringify(baseInput));
  input.distance_km = 'not-a-number';
  let threw = false;
  try {
    await service.createManualOrder(input, actor);
  } catch (err) {
    threw = true;
    assert.equal(err.name, 'ValidationError');
  }
  assert.equal(threw, true, 'expected validation error for invalid distance');
});

test('createManualOrder replays the existing order on duplicate submission', async (t) => {
  const { tx, clients, bookings, trips } = makeTx();
  const service = await loadService(tx, bookings);

  // First submission creates the order.
  const first = await service.createManualOrder(baseInput, actor);
  assert.equal(first.success, true);
  assert.equal(first.data.idempotent, false);
  const createdCount = bookings.length;

  // Second submission with the same customer, route, goods and total within the
  // idempotency window must return the existing order, not create a duplicate.
  const second = await service.createManualOrder(baseInput, actor);
  assert.equal(second.success, true);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.booking.booking_id, first.data.booking.booking_id);
  assert.equal(second.data.trip.trip_id, first.data.trip.trip_id);
  assert.equal(bookings.length, createdCount, 'no duplicate booking created');
  assert.equal(clients.length, 1, 'no duplicate client created');
  assert.equal(trips.length, 1, 'no duplicate trip created');
});

test('createManualOrder throws a clear error when MANUAL_ORDER_SYSTEM_USER_ID is unset', async (t) => {
  const { tx } = makeTx();
  const original = process.env.MANUAL_ORDER_SYSTEM_USER_ID;
  delete process.env.MANUAL_ORDER_SYSTEM_USER_ID;
  try {
    delete require.cache[absService];
    const ManualOrderService = require('../services/ManualOrderService.js');
    const service = new ManualOrderService();
    let threw = false;
    try {
      await service.createManualOrder(baseInput, { ...actor, adminId: 1 });
    } catch (err) {
      threw = true;
      assert.equal(err.name, 'ValidationError');
      assert.ok(/MANUAL_ORDER_SYSTEM_USER_ID/.test(err.message), 'message names the missing config');
    }
    assert.equal(threw, true, 'expected configuration error when env var is unset');
  } finally {
    process.env.MANUAL_ORDER_SYSTEM_USER_ID = original;
    delete require.cache[absService];
  }
});
