/**
 * Financial drill-down — aggregation, reconciliation and authorisation.
 * ---------------------------------------------------------------------------
 * §20 IS THE TEST THAT MATTERS MOST HERE:
 *
 *   "If the dashboard says Provider Payable = ₹11,73,675, then the Provider
 *    Payables detail page must total exactly ₹11,73,675."
 *
 * A drill-down that cannot add up to the card it was opened from is worse than
 * a static number: it looks like an answer and is not one. So these tests assert
 * DASHBOARD TOTAL === DETAIL TOTAL, not merely that both endpoints return 200.
 *
 * Two REAL reconciliation defects were found and fixed while writing these, and
 * both are locked down here so they cannot come back:
 *
 *   1. Trips with no `client_id` (enquiries, guests) were invisible to the
 *      receivables list, so ₹5,28,000 of an ₹8,88,000 receivable had no row.
 *   2. An INACTIVE client was filtered out entirely, hiding ₹45,000 that was
 *      still owed. Deactivating a customer must never erase money they owe.
 *
 * Run with: npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'financial-drilldown-test-secret';

const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const financialRoutes = require('../routes/financialRoutes');
const { protect, adminOnly } = require('../middleware/auth');

/* ═══════════════════════════════════════════════════════════════════════════
   A SMALL IN-MEMORY LEDGER
   ═══════════════════════════════════════════════════════════════════════════ */

function makeWorld() {
  return {
    clients: {
      1: {
        client_id: 1, company_name: 'ABC Industries', contact_person: 'Asha',
        phone: '9800000001', billing_address: 'Patna',
        city: 'Patna', state: 'Bihar', gst_number: null, is_active: true, client_code: 'ABC',
      },
      // An INACTIVE client that still owes money — the §20 defect, preserved.
      2: {
        client_id: 2, company_name: 'Dormant Traders', contact_person: 'Raj',
        phone: '9800000002', billing_address: 'Gaya',
        city: 'Gaya', state: 'Bihar', gst_number: null, is_active: false, client_code: 'DOR',
      },
    },
    users: {
      10: { user_id: 10, first_name: 'Guest', last_name: 'Buyer', email: 'g@x.com', phone: '9800000010' },
    },
    owners: {
      5: { owner_id: 5, owner_name: 'Rakesh Kumar', company_name: 'Rakesh Transport', owner_type: 'TRANSPORT_COMPANY', mobile: '9800000005', city: 'Patna' },
      6: { owner_id: 6, owner_name: 'P7 Transport', company_name: 'P7 Transport', owner_type: 'TRANSPORT_COMPANY', mobile: '9800000006', city: 'Begusarai' },
    },
    vehicles: {
      100: { vehicle_id: 100, vehicle_number: 'BR09CC0004', vehicle_name: 'Ashok Leyland Tempo', owner_id: 5, capacity_kg: 1500 },
      101: { vehicle_id: 101, vehicle_number: 'BR09CC0005', vehicle_name: 'Tata 407', owner_id: 6, capacity_kg: 2500 },
    },
    drivers: {
      200: { driver_id: 200, driver_name: 'Kaushal', status: 'available', transport_owner_id: 5 },
    },
    bookings: {
      900: { booking_id: 900, booking_number: 'BT-2026-00125' },
    },
    trips: [],
    transactions: [],
  };
}

const TX = (n, o) => ({ transaction_id: n, ...o });

function seed(world) {
  // Trip 1 — a registered client, part-paid (partial payments are first class).
  world.trips.push({
    trip_id: 1, trip_number: 'BTBT-00125', trip_date: '2026-09-22', status: 'DELIVERED',
    client_id: 1, user_id: null, booking_id: 900,
    vehicle_id: 100, driver_id: 200, transport_owner_id: 5,
    freight_amount: 50000, driver_payment: 0, owner_payment: 0,
    financialTransactions: [
      TX(1, { trip_id: 1, client_id: 1, direction: 'CREDIT', transaction_type: 'CUSTOMER_PAYMENT', amount: 20000, from_party: 'ABC Industries', to_party: 'Bihar Transport', status: 'PAID', transaction_date: '2026-09-23', reference_number: 'MR-2026-001', payment_method: 'BANK' }),
      TX(2, { trip_id: 1, client_id: 1, direction: 'CREDIT', transaction_type: 'CUSTOMER_PAYMENT', amount: 15000, from_party: 'ABC Industries', to_party: 'Bihar Transport', status: 'PAID', transaction_date: '2026-09-25', reference_number: 'MR-2026-002', payment_method: 'CASH' }),
      TX(3, { trip_id: 1, transport_owner_id: 5, direction: 'DEBIT', transaction_type: 'OWNER_ADVANCE', amount: 10000, from_party: 'Bihar Transport', to_party: 'Rakesh Kumar', status: 'PAID', transaction_date: '2026-09-26', reference_number: 'OP-2026-001', payment_method: 'BANK' }),
    ],
  });

  // Trip 2 — an INACTIVE client, entirely unpaid.
  world.trips.push({
    trip_id: 2, trip_number: 'BTBT-00126', trip_date: '2026-09-10', status: 'DELIVERED',
    client_id: 2, user_id: null, booking_id: null,
    vehicle_id: 101, driver_id: null, transport_owner_id: 6,
    freight_amount: 25000, driver_payment: 0, owner_payment: 0,
    financialTransactions: [],
  });

  // Trip 3 — a GUEST customer (no client_id at all). The §20 defect, preserved.
  world.trips.push({
    trip_id: 3, trip_number: 'BTBT-00127', trip_date: '2026-10-01', status: 'DELIVERED',
    client_id: null, user_id: 10, booking_id: null,
    vehicle_id: 101, driver_id: null, transport_owner_id: 6,
    freight_amount: 30000, driver_payment: 0, owner_payment: 0,
    financialTransactions: [],
  });

  return world;
}

/** Apply the query filters the service builds onto the fixture's transactions. */
function filterTransactions(world, where = {}) {
  let rows = world.trips.flatMap((t) => t.financialTransactions);
  const tripIdsForOwner = (ownerId) => new Set(
    world.trips.filter((t) => t.transport_owner_id === ownerId).map((t) => t.trip_id),
  );

  if (where.trip_id) rows = rows.filter((r) => r.trip_id === where.trip_id);
  if (where.client_id) rows = rows.filter((r) => r.client_id === where.client_id);
  if (where.transport_owner_id) {
    const ids = tripIdsForOwner(where.transport_owner_id);
    rows = rows.filter((r) => ids.has(r.trip_id));
  }
  if (where.from_party) rows = rows.filter((r) => r.from_party === where.from_party);
  if (where.to_party) rows = rows.filter((r) => r.to_party === where.to_party);
  if (where.status) rows = rows.filter((r) => r.status === where.status);
  if (where.payment_method) rows = rows.filter((r) => r.payment_method === where.payment_method);

  if (where.transaction_type) {
    const t = where.transaction_type;
    if (t && t.in) rows = rows.filter((r) => t.in.includes(r.transaction_type));
    else rows = rows.filter((r) => r.transaction_type === t);
  }

  // The service searches across party, reference and type with one OR clause.
  if (where.OR) {
    const clause = where.OR[0] || {};
    const needle = clause.reference_number?.contains
      || clause.from_party?.contains
      || clause.transaction_type?.contains;
    if (needle) {
      const n = String(needle).toLowerCase();
      rows = rows.filter((r) => [r.reference_number, r.from_party, r.transaction_type, r.remarks]
        .some((v) => String(v || '').toLowerCase().includes(n)));
    }
  }

  return rows.map((r) => ({
    ...r,
    trip: world.trips.find((t) => t.trip_id === r.trip_id) || null,
    booking: world.bookings[r.booking_id] || null,
  }));
}

/**
 * An in-memory prisma covering exactly what CanonicalFinancialService calls.
 * Transactions live on the trips and the transaction table projects them, so a
 * test can never "disagree with itself".
 */
function fakePrisma(world) {
  const tripsWithRelations = () => world.trips.map((t) => ({
    ...t,
    // prisma's `include: { financialTransactions: true }`
    financialTransactions: t.financialTransactions,
    vehicle: world.vehicles[t.vehicle_id] || null,
    driver: world.drivers[t.driver_id] || null,
    transportOwner: world.owners[t.transport_owner_id] || null,
    user: world.users[t.user_id] || null,
    booking: world.bookings[t.booking_id] || null,
    vehicleHire: null,
    tripSettlements: [],
    tripAdvances: [],
  }));

  const withTrips = (c) => (c ? {
    ...c,
    trips: world.trips
      .filter((t) => t.client_id === c.client_id)
      .map((t) => ({ ...t, financialTransactions: t.financialTransactions })),
  } : null);

  return {
    client: {
      findMany: async () => Object.values(world.clients).map(withTrips),
      findUnique: async ({ where }) => withTrips(world.clients[where.client_id]),
    },
    user: { findUnique: async ({ where }) => world.users[where.user_id] || null },
    vehicleOwner: { findUnique: async ({ where }) => world.owners[where.owner_id] || null },

    trip: {
      findMany: async (args = {}) => {
        const { where = {}, skip, take } = args || {};
        let rows = tripsWithRelations();
        if (where.client_id === null) rows = rows.filter((t) => t.client_id === null);
        else if (where.client_id !== undefined) {
          rows = rows.filter((t) => t.client_id === where.client_id);
        }
        if (where.transport_owner_id !== undefined) {
          rows = rows.filter((t) => t.transport_owner_id === where.transport_owner_id);
        }
        // Honour pagination, so the test can prove the page size is enforced.
        const start = skip || 0;
        return take ? rows.slice(start, start + take) : rows.slice(start);
      },
      findUnique: async ({ where }) =>
        tripsWithRelations().find((t) => t.trip_id === where.trip_id) || null,
    },

    financialTransaction: {
      findMany: async (args = {}) => {
        const rows = filterTransactions(world, (args && args.where) || {});
        const skip = (args && args.skip) || 0;
        const take = args && args.take;
        return take ? rows.slice(skip, skip + take) : rows.slice(skip);
      },
      // Totals are counted by the DATABASE, not by slicing a page in JS.
      count: async ({ where } = {}) => filterTransactions(world, where).length,
    },
  };
}

/** Trip 1's owner share is derived from freight; ownerDue = share − paid. */
function build() {
  const world = seed(makeWorld());
  const prisma = fakePrisma(world);
  const service = new CanonicalFinancialService({ prisma });
  return { world, prisma, service };
}

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

/* ═══════════════════════════════════════════════════════════════════════════
   §20 — RECONCILIATION. THE DASHBOARD AND ITS DETAIL MUST AGREE.
   ═══════════════════════════════════════════════════════════════════════════ */

test('§20 the receivables detail totals EXACTLY the dashboard receivable', async () => {
  const { service } = build();
  const summary = await service.calculateGlobalFinancials();
  const rows = await service.getReceivablesByClient();
  assert.equal(sum(rows, 'outstanding'), summary.totalReceivable);
});

test('§20 §DEFECT-1 a guest customer with no client record still appears', async () => {
  const { service } = build();
  const rows = await service.getReceivablesByClient();
  const guest = rows.find((r) => r.unlinked);
  assert.ok(guest, 'a trip with no client_id must still produce a receivable row');
  assert.equal(guest.companyName, 'Guest Buyer');
  assert.equal(guest.outstanding, 30000);
});

test('§20 §DEFECT-2 an INACTIVE client that owes money is still listed', async () => {
  const { service } = build();
  const rows = await service.getReceivablesByClient();
  const dormant = rows.find((r) => r.clientId === 2);
  assert.ok(dormant, 'deactivating a customer must not erase the debt');
  assert.equal(dormant.outstanding, 25000);
  assert.equal(dormant.is_active, false, 'the flag travels with the row instead of hiding it');
});

test('§20 the payables detail totals EXACTLY the dashboard payable', async () => {
  const { service } = build();
  const summary = await service.calculateGlobalFinancials();
  const pay = await service.getPayables();
  const detail = sum(pay.owners, 'totalDue') + sum(pay.drivers, 'totalDue');
  assert.equal(detail, summary.totalPayable);
});

test('§20 net position = receivable − payable, computed not hardcoded', async () => {
  const { service } = build();
  const summary = await service.calculateGlobalFinancials();
  assert.equal(summary.netPosition, summary.totalReceivable - summary.totalPayable);
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 / §18 — PARTIAL CUSTOMER PAYMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

test('§18 two partial payments leave the real remaining balance, not PAID', async () => {
  const { service } = build();
  const abc = (await service.getReceivablesByClient()).find((r) => r.clientId === 1);
  // 50,000 billed, 20,000 + 15,000 received = 35,000 received, 15,000 still due.
  assert.equal(abc.totalFreight, 50000);
  assert.equal(abc.totalPaid, 35000);
  assert.equal(abc.outstanding, 15000);
  assert.notEqual(abc.paymentStatus, 'PAID', 'a part payment is not a paid invoice');
});

test('§1 the customer ledger agrees with the receivables row for that customer', async () => {
  const { service } = build();
  const rows = await service.getReceivablesByClient();
  const abc = rows.find((r) => r.clientId === 1);
  const ledger = await service.getClientLedger(1);

  assert.equal(ledger.totals.currentReceivable, abc.outstanding);
  assert.equal(ledger.totals.billed, abc.totalFreight);
  assert.equal(ledger.totals.received, abc.totalPaid);
  assert.equal(ledger.party.name, 'ABC Industries');
  assert.equal(ledger.trips.length, 1);
  assert.equal(ledger.payments.length, 2, 'both partial payments are listed');
});

test('§11 the ledger separates billed, received and remaining', async () => {
  const { service } = build();
  const ledger = await service.getClientLedger(1);
  const row = ledger.trips[0];
  assert.equal(row.billed, 50000);
  assert.equal(row.received, 35000);
  assert.equal(row.due, 15000);
  assert.equal(ledger.ledger[0].balance, 15000, 'the running balance equals the remaining amount');
});

/* ═══════════════════════════════════════════════════════════════════════════
   §4 / §17 / §19 — THE VENDOR LEDGER
   ═══════════════════════════════════════════════════════════════════════════ */

test('§9 gross, commission and net are three separate figures and net = gross − commission', async () => {
  const { service } = build();
  const comm = await service.getCommissionEarned();
  for (const row of comm.commission) {
    assert.equal(row.net_vendor_payable, row.gross_vehicle_hire - row.commission);
  }
  assert.equal(comm.totals.total_commission, comm.commission.reduce((a, r) => a + r.commission, 0));
});

test('§9 the commission total matches the dashboard commission', async () => {
  const { service } = build();
  const summary = await service.calculateGlobalFinancials();
  const comm = await service.getCommissionEarned();
  assert.equal(comm.totals.total_commission, summary.totalBtCommission);
});

test('§4 the vendor ledger keeps gross, commission, net and payments apart', async () => {
  const { service } = build();
  const ledger = await service.getVendorLedger(5);

  assert.equal(ledger.party.name, 'Rakesh Transport');
  assert.equal(ledger.totals.gross_hire, ledger.totals.net_vendor_payable + ledger.totals.commission);
  assert.equal(ledger.trips[0].net_payable, ledger.trips[0].gross_hire - ledger.trips[0].commission);

  // The hire is a CREDIT (we now owe more); the payment is a DEBIT (we owe less).
  const hire = ledger.ledger.find((l) => l.particulars.startsWith('Vehicle hire'));
  assert.ok(hire && hire.credit > 0 && hire.debit === null, 'a hire increases what we owe');
});

test('§4 the vendor ledger outstanding matches the payables row for that owner', async () => {
  const { service } = build();
  const pay = await service.getPayables();
  const owner = pay.owners.find((o) => o.ownerId === 5);
  const ledger = await service.getVendorLedger(5);
  assert.equal(ledger.totals.outstanding, owner.totalDue);
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — THE "CLIENT DUE" FILTERS
   ═══════════════════════════════════════════════════════════════════════════ */

test('§2 status=DUE returns only parties with money pending', async () => {
  const { service } = build();
  const all = await service.getReceivablesByClient({ status: 'ALL' });
  const due = await service.getReceivablesByClient({ status: 'DUE' });
  assert.ok(due.length > 0);
  assert.ok(due.every((r) => r.outstanding > 0), 'a settled party is not "due"');
  assert.ok(due.length <= all.length);
});

test('§2 status=PARTIALLY_PAID separates a part payer from an untouched debtor', async () => {
  const { service } = build();
  const partial = await service.getReceivablesByClient({ status: 'PARTIALLY_PAID' });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].clientId, 1);

  const unpaid = await service.getReceivablesByClient({ status: 'UNPAID' });
  assert.equal(unpaid.length, 2, 'the dormant client and the guest have paid nothing');
});

test('§15 sort orders by outstanding in both directions', async () => {
  const { service } = build();
  const desc = await service.getReceivablesByClient({ sort: 'OUTSTANDING_DESC' });
  const asc = await service.getReceivablesByClient({ sort: 'OUTSTANDING_ASC' });
  assert.ok(desc[0].outstanding >= desc[desc.length - 1].outstanding);
  assert.ok(asc[0].outstanding <= asc[asc.length - 1].outstanding);
});

test('§15 search narrows the list by party name', async () => {
  const { service } = build();
  const rows = await service.getReceivablesByClient({ search: 'ABC' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, 'ABC Industries');
});

/* ═══════════════════════════════════════════════════════════════════════════
   §21 — PAGINATION. NEVER LOAD EVERY TRANSACTION TO TOTAL IT.
   ═══════════════════════════════════════════════════════════════════════════ */

test('§21 pagination returns an envelope and the total comes from the database', async () => {
  const { service } = build();
  const page = await service.getTransactions({ page: 1, limit: 2 });
  assert.ok(Array.isArray(page.rows));
  assert.equal(page.rows.length, 2);
  assert.equal(page.pagination.total, 3, 'counted by the database, not by the page');
  assert.equal(page.pagination.totalPages, 2);
});

test('§21 pagination is backwards compatible — no page means the original array', async () => {
  const { service } = build();
  const rows = await service.getTransactions({});
  assert.ok(Array.isArray(rows), 'existing callers still receive an array');
  assert.equal(rows.length, 3);
});

test('§15 search on transactions matches party, reference and type', async () => {
  const { service } = build();
  const byRef = await service.getTransactions({ search: 'MR-2026-001' });
  assert.equal(byRef.length, 1);
  const byType = await service.getTransactions({ search: 'OWNER_ADVANCE' });
  assert.equal(byType.length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   §22 — EVERY FINANCIAL ENDPOINT IS ADMIN-ONLY
   ═══════════════════════════════════════════════════════════════════════════ */

test('§22 every financial route is behind protect + adminOnly', () => {
  let endpoints = 0;
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        endpoints += 1;
        const names = (layer.route.stack || [])
          .map((h) => h.name || '')
          .filter(Boolean);
        assert.ok(
          names.includes('protect'),
          `${layer.route.path} is missing authentication`,
        );
        assert.ok(
          names.includes('adminOnly'),
          `${layer.route.path} is missing the admin-only guard`,
        );
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(financialRoutes.stack);
  assert.ok(endpoints >= 7, `expected the financial endpoints to be registered, found ${endpoints}`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   §12 — SETTLEMENTS ARE NOT CASH PAYMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

test('§12 a settlement is its own transaction type, never a bank payment', async () => {
  const { service, world } = build();
  world.trips[0].financialTransactions.push(
    TX(4, { trip_id: 1, direction: 'DEBIT', transaction_type: 'OWNER_SETTLEMENT', amount: 5000, from_party: 'Bihar Transport', to_party: 'Rakesh Kumar', status: 'PAID', transaction_date: '2026-09-27', reference_number: 'ST-2026-001', payment_method: 'SETTLEMENT' }),
  );
  const settlements = await service.getTransactions({ transaction_type: { in: ['OWNER_SETTLEMENT'] } });
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].transaction_type, 'OWNER_SETTLEMENT');
  assert.equal(settlements[0].payment_method, 'SETTLEMENT');
});