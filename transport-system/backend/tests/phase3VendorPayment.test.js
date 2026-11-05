/**
 * phase3VendorPayment.test.js
 * ---------------------------------------------------------------------------
 * PHASE 3 — VENDOR PAYMENT, ADVANCE, SETTLEMENT & LEDGER
 * ---------------------------------------------------------------------------
 *
 *   Phase 2 fixed WHAT THE HIRE IS:
 *          GROSS HIRE − COMMISSION = NET VENDOR PAYABLE
 *
 *   Phase 3 fixes WHAT THE MONEY DOES:
 *          NET VENDOR PAYABLE − ADVANCES − PAYMENTS = OUTSTANDING
 *
 * The two identities must never be mixed. A hire is a calculation; an advance
 * and a payment are cash movements. This suite proves that separation holds.
 *
 *   1.  gross hire
 *   2.  commission
 *   3.  net vendor payable
 *   4.  create advance
 *   5.  advance reduces outstanding
 *   6.  advance does NOT change gross
 *   7.  advance does NOT change commission
 *   8.  advance does NOT change net payable
 *   9.  full payment
 *   10. partial payment
 *   11. multiple partial payments
 *   12. payment reduces outstanding
 *   13. payment cannot exceed the outstanding (existing rule: REJECT)
 *   14. payment creates the correct canonical transaction
 *   15. payment appears in the vendor ledger
 *   16. settlement semantics
 *   17. settlement does not duplicate a payment
 *   18. settlement updates the correct accounting state
 *   19. duplicate request (double click) creates nothing new
 *   20. retry request creates nothing new
 *   21. admin may record vendor money
 *   22. an authorised partner gets only its own scope
 *   23. an unauthorised partner cannot touch another partner's payment
 *   24. a driver cannot record a vendor payment
 *   25. a customer cannot record a vendor payment
 *   26. an unauthenticated caller cannot record a vendor payment
 *   27. ledger entries are chronological
 *   28. ledger balance calculation
 *   29. multiple trips for the same vendor
 *   30. multiple payments for the same trip
 *   +   fuel advance / diesel expense stay distinct from vendor money
 *
 * Uses node:test + node:assert (no extra deps) against an in-memory Prisma
 * stand-in. The live-PostgreSQL suite lives in
 * tests/phase3VendorPayment.db.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const VehicleHireService = require('../services/VehicleHireService');
const VendorLedgerService = require('../services/VendorLedgerService');
const TripAdvanceService = require('../services/TripAdvanceService');
const TripSettlementService = require('../services/TripSettlementService');
const CanonicalFinancialService = require('../services/CanonicalFinancialService');
const { adminOnly } = require('../middleware/auth');
const { ValidationError } = require('../utils/AppError');

// ===========================================================================
// In-memory Prisma stand-in
// ===========================================================================
// Only the methods the Phase 3 services actually call are implemented, and
// each one is a faithful stand-in: the same `where` semantics, the same
// ordering, the same projection. Anything the services do not call is absent on
// purpose, so a test that reaches for it fails loudly instead of silently
// getting a stub.

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return cond.not === null ? value !== null : value !== cond.not;
      if ('gte' in cond) return new Date(value) >= new Date(cond.gte);
      if ('lte' in cond) return new Date(value) <= new Date(cond.lte);
    }
    return value === cond;
  });
}

function project(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const [k, v] of Object.entries(select)) if (v) out[k] = row[k];
  return out;
}

/**
 * Prisma model name -> { rows, pk }. The array names are plural purely so the
 * assertions in this file read naturally; the client surface below is keyed by
 * the real SINGULAR model name exactly as Prisma exposes it.
 */
const MODELS = {
  vehicleOwner: { rows: 'vehicleOwners', pk: 'owner_id' },
  transportVehicle: { rows: 'transportVehicles', pk: 'vehicle_id' },
  driver: { rows: 'drivers', pk: 'driver_id' },
  client: { rows: 'clients', pk: 'client_id' },
  user: { rows: 'users', pk: 'user_id' },
  booking: { rows: 'bookings', pk: 'booking_id' },
  trip: { rows: 'trips', pk: 'trip_id' },
  tripFinancial: { rows: 'tripFinancials', pk: 'trip_financial_id' },
  tripAdvance: { rows: 'tripAdvances', pk: 'advance_id' },
  tripSettlement: { rows: 'tripSettlements', pk: 'settlement_id' },
  tripPayment: { rows: 'tripPayments', pk: 'payment_id' },
  tripExpense: { rows: 'tripExpenses', pk: 'expense_id' },
  financialTransaction: { rows: 'financialTransactions', pk: 'transaction_id' },
  auditLog: { rows: 'auditLogs', pk: 'audit_id' },
};

function buildTable(state, model) {
  const rows = state[MODELS[model].rows];
  const pk = MODELS[model].pk;

  const sorted = (orderBy) => {
    if (!orderBy) return [...rows];
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const c of clauses) {
        for (const [k, dir] of Object.entries(c)) {
          const av = a[k];
          const bv = b[k];
          if (av === bv) continue;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
      }
      return 0;
    });
  };

  // Relation resolvers matching the `include` shapes the services request.
  const rel = {
    transportOwner: (r) => state.vehicleOwners.find((o) => o.owner_id === r.transport_owner_id) || null,
    driver: (r) => state.drivers.find((d) => d.driver_id === r.driver_id) || null,
    vehicle: (r) => state.transportVehicles.find((v) => v.vehicle_id === r.vehicle_id) || null,
    client: (r) => state.clients.find((c) => c.client_id === r.client_id) || null,
    user: (r) => state.users.find((u) => u.user_id === r.user_id) || null,
    financialTransactions: (r) => state.financialTransactions.filter((x) => x.trip_id === r.trip_id),
    payments: (r) => state.tripPayments.filter((x) => x.trip_id === r.trip_id),
    advances: (r) => state.tripAdvances.filter((x) => x.trip_financial_id === r.trip_financial_id),
    settlements: (r) => state.tripSettlements.filter((x) => x.trip_financial_id === r.trip_financial_id),
    transactions: (r) => state.financialTransactions.filter((x) => x.trip_financial_id === r.trip_financial_id),
    trip: (r) => state.trips.find((t) => t.trip_id === r.trip_id) || null,
    booking: (r) => state.bookings.find((b) => b.booking_id === r.booking_id) || null,
  };

  const applyInclude = (row) => {
    const inc = {};
    for (const [key, fn] of Object.entries(rel)) {
      const value = fn(row);
      if (value) inc[key] = value;
    }
    return inc;
  };

  return {
    rows,
    async findMany({ where, orderBy, select, include } = {}) {
      const out = sorted(orderBy).filter((r) => matches(r, where));
      return out.map((r) => ({
        ...project(r, select),
        ...(include ? applyInclude(r) : {}),
      }));
    },
    async findFirst(args = {}) {
      const out = await this.findMany({ ...args, orderBy: args.orderBy });
      return out.length ? out[0] : null;
    },
    async findUnique({ where, select, include } = {}) {
      const found = rows.find((r) => matches(r, where));
      if (!found) return null;
      return { ...project(found, select), ...(include ? applyInclude(found) : {}) };
    },
    async create({ data }) {
      state.__seq[model] = (state.__seq[model] || 0) + 1;
      const row = { ...data };
      if (row[pk] === undefined || row[pk] === null) row[pk] = 100000 + state.__seq[model];
      rows.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`${model} not found`);
      Object.assign(row, data);
      return { ...row };
    },
  };
}

/**
 * Build a fresh fake database containing one owner, one vehicle, one driver,
 * one client and one trip whose gross hire is `gross`.
 *
 * @param {{gross?:number, commissionType?:string, commissionPct?:number}} [opts]
 */
function makeDb(opts = {}) {
  const gross = opts.gross === undefined ? 40000 : opts.gross;

  const state = {
    __seq: {},
    vehicleOwners: [{ owner_id: 10, owner_name: 'Bihar Transport Fleet', owner_type: 'TRANSPORT_COMPANY', mobile: '9000000001', partner_link: 77 }],
    transportVehicles: [{ vehicle_id: 100, vehicle_number: 'BR01AB1234' }],
    drivers: [{ driver_id: 200, driver_name: 'Raj Kumar', transport_owner_id: 10 }],
    clients: [{ client_id: 300, company_name: 'Kosi Agro Ltd' }],
    users: [{ user_id: 301, first_name: 'Ramesh', last_name: 'Kumar' }],
    bookings: [{ booking_id: 900, driver_id: 200, vehicle_owner_id: 10, vehicle_id: 100 }],
    trips: [{
      trip_id: 1,
      trip_number: 'BTBT-2026-00001',
      booking_id: 900,
      source_type: 'OFFLINE_CLIENT',
      user_id: null,
      client_id: 300,
      transport_owner_id: 10,
      vehicle_id: 100,
      driver_id: 200,
      pickup_city: 'Begusarai',
      drop_city: 'Patna',
      status: 'IN_TRANSIT',
      freight_amount: gross,
      driver_payment: 30000,
      commission_type: opts.commissionType || null,
      commission_percentage: opts.commissionPct === undefined ? null : opts.commissionPct,
      trip_date: new Date('2026-10-05T00:00:00.000Z'),
      created_at: new Date('2026-10-01T00:00:00.000Z'),
    }],
    tripFinancials: [],
    tripAdvances: [],
    tripSettlements: [],
    tripPayments: [],
    tripExpenses: [],
    financialTransactions: [],
    auditLogs: [],
  };

  const client = { $transaction: null };
  for (const model of Object.keys(MODELS)) {
    client[model] = buildTable(state, model);
  }
  client.$transaction = async (cb) => cb(client);
  client.__state = state;
  return client;
}

const ADMIN = { user_id: 1, role: 'admin' };

// ===========================================================================
// 1–3. VENDOR PAYABLE — gross, commission, net
// ===========================================================================

test('1–3. gross hire, commission and net vendor payable are server-derived', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const ledger = new VendorLedgerService({ prisma: db });

  const position = await ledger.getOwnerPosition(1);

  assert.equal(position.grossHire, 42000);
  assert.equal(position.commissionAmount, 2100);
  assert.equal(position.netVendorPayable, 39900);
  // The identity itself.
  assert.equal(
    position.grossHire - position.commissionAmount,
    position.netVendorPayable
  );

  // A browser-supplied payable must never win.
  const spoofed = await ledger.getOwnerPosition(1, {
    net_vendor_payable: 999999,
    owner_payable: 999999,
    vendor_payable: 999999,
  });
  assert.equal(spoofed.netVendorPayable, 39900);
  assert.equal(spoofed.outstanding, 39900);

  // Fixed commission uses the same single calculator.
  const fixedDb = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const fixed = await new VendorLedgerService({ prisma: fixedDb }).getOwnerPosition(1);
  assert.equal(fixed.commissionAmount, 2000);
  assert.equal(fixed.netVendorPayable, 40000);
});

// ===========================================================================
// 4–8. ADVANCE
// ===========================================================================

test('4. create advance records an immutable TripAdvance and its canonical transaction', async () => {
  const db = makeDb({ gross: 40000, commissionPct: 5 });
  const svc = new TripAdvanceService({ prisma: db });

  const advance = await svc.createAdvance(null, {
    trip_id: 1,
    amount: 10000,
    advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash',
    reference_number: 'ADV-1',
  }, ADMIN);

  assert.equal(advance.amount, 10000);
  assert.equal(advance.transport_owner_id, 10, 'party comes from the Trip, not the payload');
  assert.equal(db.__state.tripAdvances.length, 1);

  const txs = db.__state.financialTransactions.filter(
    (t) => t.transaction_type === 'OWNER_ADVANCE'
  );
  assert.equal(txs.length, 1, 'advance must always produce a FinancialTransaction');
  assert.equal(txs[0].direction, 'DEBIT');
  assert.equal(txs[0].from_party, 'BIHAR_TRANSPORT');
  assert.equal(txs[0].to_party, 'TRANSPORT_OWNER');
  assert.equal(txs[0].transport_owner_id, 10);
  assert.equal(txs[0].trip_id, 1);
  assert.equal(txs[0].created_by, 1);
});

test('5–8. an advance reduces ONLY the outstanding balance', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const ledger = new VendorLedgerService({ prisma: db });
  const svc = new TripAdvanceService({ prisma: db });

  const before = await ledger.getOwnerPosition(1);
  assert.equal(before.grossHire, 42000);
  assert.equal(before.commissionAmount, 2100);
  assert.equal(before.netVendorPayable, 39900);
  assert.equal(before.outstanding, 39900);

  await svc.createAdvance(null, {
    trip_id: 1,
    amount: 10000,
    advance_type: 'OWNER_ADVANCE',
    payment_method: 'upi',
    reference_number: 'ADV-1',
  }, ADMIN);

  const after = await ledger.getOwnerPosition(1);

  // 6. gross unchanged
  assert.equal(after.grossHire, 42000);
  // 7. commission unchanged
  assert.equal(after.commissionAmount, 2100);
  // 8. net payable NOT reduced — the obligation stands at 39,900
  assert.equal(after.netVendorPayable, 39900);
  // 5. only the outstanding balance moves
  assert.equal(after.advancePaid, 10000);
  assert.equal(after.paidTotal, 10000);
  assert.equal(after.outstanding, 29900);
  assert.equal(after.paymentStatus, 'PARTIAL');

  // And nothing wrote a net figure back onto the Trip row.
  assert.equal(db.__state.trips[0].freight_amount, 42000);
});

test('4b. an advance beyond the outstanding vendor payable is rejected', async () => {
  const db = makeDb({ gross: 10000, commissionPct: 5 });
  const svc = new TripAdvanceService({ prisma: db });

  // net payable = 9,500
  await assert.rejects(
    () => svc.createAdvance(null, {
      trip_id: 1, amount: 9600, advance_type: 'OWNER_ADVANCE',
      payment_method: 'cash',
    }, ADMIN),
    (e) => e instanceof ValidationError && /outstanding vendor payable/.test(e.message)
  );

  // Exactly the outstanding is allowed.
  const ok = await svc.createAdvance(null, {
    trip_id: 1, amount: 9500, advance_type: 'OWNER_ADVANCE', payment_method: 'cash',
  }, ADMIN);
  assert.equal(ok.amount, 9500);
});

test('4c. a fuel advance is vendor-distinct and never touches the vendor balance', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const ledger = new VendorLedgerService({ prisma: db });
  const svc = new TripAdvanceService({ prisma: db });

  const before = await ledger.getOwnerPosition(1);
  await svc.createAdvance(null, {
    trip_id: 1, amount: 5000, advance_type: 'FUEL_ADVANCE', payment_method: 'cash',
  }, ADMIN);
  const after = await ledger.getOwnerPosition(1);

  assert.equal(after.netVendorPayable, before.netVendorPayable);
  assert.equal(after.outstanding, before.outstanding, 'a fuel advance is not a vendor payment');

  const fuelTx = db.__state.financialTransactions.find((t) => t.transaction_type === 'FUEL_ADVANCE');
  assert.ok(fuelTx);
  assert.equal(fuelTx.to_party, 'DRIVER', 'fuel advance goes to the driver, not the vendor');
});

// ===========================================================================
// 9–13. PAYMENTS AND PARTIAL PAYMENTS
// ===========================================================================

/**
 * Payment 1 = 10,000 · Payment 2 = 15,000 · Payment 3 = 15,000 against a
 * 40,000 net payable. The model in STEP 6.
 */
async function threePartialPayments(amounts, netPayable) {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  const seen = [];
  for (const amount of amounts) {
    const before = await ledger.getOwnerPosition(1);
    await settle.recordOwnerSettlementByTripId(1, {
      amount,
      payment_method: 'bank_transfer',
      reference_number: `PAY-${amount}`,
    }, ADMIN);
    const after = await ledger.getOwnerPosition(1);
    seen.push({ before, after });
  }
  return { db, ledger, settle, seen, netPayable };
}

test('9. a full payment settles the vendor exactly', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 }); // net 39,900
  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  const result = await settle.recordOwnerSettlementByTripId(1, {
    amount: 39900, payment_method: 'upi', reference_number: 'FULL-1',
  }, ADMIN);

  assert.equal(result.owner_settlement_amount, 39900);
  assert.equal(result.owner_settlement_status, 'PAID');
  assert.equal(result.owner_settlement_payment_method, 'upi');
  assert.equal(result.owner_settlement_reference, 'FULL-1');

  const after = await ledger.getOwnerPosition(1);
  assert.equal(after.outstanding, 0);
  assert.equal(after.settled, true);
  assert.equal(after.paymentStatus, 'PAID');
});

test('10–12. partial payments walk the outstanding down without clearing it early', async () => {
  // Build a 40,000 net payable trip: gross 42,000 with a fixed 2,000 commission.
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  const start = await ledger.getOwnerPosition(1);
  assert.equal(start.netVendorPayable, 40000);
  assert.equal(start.outstanding, 40000);

  const step = async (amount, ref) => {
    const before = await ledger.getOwnerPosition(1);
    await settle.recordOwnerSettlementByTripId(1, {
      amount, payment_method: 'bank_transfer', reference_number: ref,
    }, ADMIN);
    const after = await ledger.getOwnerPosition(1);
    return { before, after };
  };

  const p1 = await step(10000, 'PAY-1');
  assert.equal(p1.after.outstanding, 30000, '10,000 paid → 30,000 outstanding');
  assert.notEqual(p1.after.paymentStatus, 'PAID', 'the first payment is NOT full settlement');

  const p2 = await step(15000, 'PAY-2');
  assert.equal(p2.after.outstanding, 15000, '15,000 more → 15,000 outstanding');

  const p3 = await step(15000, 'PAY-3');
  assert.equal(p3.after.outstanding, 0);
  assert.equal(p3.after.paymentStatus, 'PAID');

  // The obligation itself never changed.
  assert.equal(p3.after.netVendorPayable, 40000);
  assert.equal(p3.after.grossHire, 42000);
  assert.equal(p3.after.commissionAmount, 2000);

  // 30. Multiple payments for the same trip remain individually visible.
  const settlements = db.__state.financialTransactions.filter(
    (t) => t.transaction_type === 'OWNER_SETTLEMENT'
  );
  assert.equal(settlements.length, 3, 'payment history stays visible');
  assert.deepEqual(settlements.map((s) => s.amount), [10000, 15000, 15000]);
});

test('13. a payment beyond the outstanding is rejected (existing business rule)', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 }); // net 40,000
  const settle = new TripSettlementService({ prisma: db });

  await assert.rejects(
    () => settle.recordOwnerSettlementByTripId(1, {
      amount: 40001, payment_method: 'cash',
    }, ADMIN),
    (e) => e instanceof ValidationError && /outstanding vendor payable/.test(e.message)
  );

  // Rejection must leave no trace at all.
  assert.equal(db.__state.financialTransactions.length, 0);
  assert.equal(db.__state.tripSettlements.length, 0);
});

test('13b. over-payment is rejected even when a client asserts a bigger payable', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 }); // net 40,000
  const settle = new TripSettlementService({ prisma: db });

  await assert.rejects(
    () => settle.recordOwnerSettlementByTripId(1, {
      amount: 60000,
      payment_method: 'cash',
      net_vendor_payable: 90000,
      owner_payable: 90000,
      remaining_owner_settlement: 90000,
    }, ADMIN),
    (e) => e instanceof ValidationError && /outstanding vendor payable/.test(e.message)
  );
});

// ===========================================================================
// 14–15. TRANSACTION + LEDGER INTEGRITY
// ===========================================================================

test('14. every payment produces exactly one correct canonical transaction', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, {
    amount: 5000,
    payment_method: 'cheque',
    reference_number: 'CHQ-9871',
    settlement_date: '2026-10-10',
    notes: 'second cheque',
  }, ADMIN);

  const txs = db.__state.financialTransactions;
  assert.equal(txs.length, 1);

  const tx = txs[0];
  assert.equal(tx.transaction_type, 'OWNER_SETTLEMENT');
  assert.equal(tx.direction, 'DEBIT');
  assert.equal(tx.from_party, 'BIHAR_TRANSPORT');
  assert.equal(tx.to_party, 'TRANSPORT_OWNER');
  assert.equal(tx.amount, 5000);
  assert.equal(tx.payment_method, 'cheque');
  assert.equal(tx.reference_number, 'CHQ-9871');
  assert.equal(tx.transport_owner_id, 10, 'payment belongs to the trip vendor');
  assert.equal(tx.vehicle_id, 100);
  assert.equal(tx.trip_id, 1);
  assert.equal(tx.booking_id, 900);
  assert.equal(tx.created_by, 1);
  assert.equal(tx.status, 'PAID');
  assert.equal(new Date(tx.transaction_date).toISOString().slice(0, 10), '2026-10-10');

  // 17. A settlement is a payment — it must NOT also create a TripPayment row.
  assert.equal(db.__state.tripPayments.length, 0);
});

test('15. payments appear in the vendor ledger', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const ledger = new VendorLedgerService({ prisma: db });
  const advances = new TripAdvanceService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  await advances.createAdvance(null, {
    trip_id: 1, amount: 10000, advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash', reference_number: 'ADV-1',
  }, ADMIN);
  await settle.recordOwnerSettlementByTripId(1, {
    amount: 15000, payment_method: 'upi', reference_number: 'PAY-1',
  }, ADMIN);

  const statement = await ledger.getOwnerLedger(10);
  const kinds = statement.entries.map((e) => e.impact || e.transaction_type);

  assert.ok(kinds.includes('VEHICLE_HIRE_OBLIGATION'));
  assert.ok(kinds.includes('ADVANCE'));
  assert.ok(kinds.includes('PAYMENT'));
  assert.equal(statement.totalObligations, 40000);
  assert.equal(statement.totalAdvances, 10000);
  assert.equal(statement.totalPayments, 15000);
  assert.equal(statement.closingBalance, 15000);
});

// ===========================================================================
// 16–18. SETTLEMENT SEMANTICS
// ===========================================================================

test('16. settlement means an actual payment in this repository, not a reconciliation', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, {
    amount: 40000, payment_method: 'bank_transfer', reference_number: 'TRF-1',
  }, ADMIN);

  // The TripSettlement row records money actually paid.
  const row = db.__state.tripSettlements[0];
  assert.equal(row.owner_settlement_amount, 40000);
  assert.equal(row.owner_settlement_status, 'PAID');
  assert.ok(row.owner_settlement_paid_at, 'paid_at is recorded');
  assert.equal(row.owner_settlement_payment_method, 'bank_transfer');

  // ...and a matching real money movement exists.
  const money = db.__state.financialTransactions.filter(
    (t) => t.transaction_type === 'OWNER_SETTLEMENT'
  );
  assert.equal(money.length, 1);
  assert.equal(money[0].direction, 'DEBIT');
});

test('17. a settlement never duplicates the payment', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, {
    amount: 40000, payment_method: 'bank_transfer',
  }, ADMIN);

  const allMoney = db.__state.financialTransactions;
  assert.equal(allMoney.length, 1, 'exactly one money row for one settlement');
  assert.equal(db.__state.tripPayments.length, 0, 'no parallel TripPayment row');
  assert.equal(db.__state.tripSettlements.length, 1, 'one settlement record, not one per request');
});

test('18. settlement updates the correct accounting state (cumulative, not last)', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 }); // net 40,000
  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, { amount: 10000, payment_method: 'cash' }, ADMIN);
  let row = db.__state.tripSettlements[0];
  assert.equal(row.owner_settlement_amount, 10000);
  assert.equal(row.owner_settlement_status, 'PARTIAL');

  await settle.recordOwnerSettlementByTripId(1, { amount: 15000, payment_method: 'cash' }, ADMIN);
  row = db.__state.tripSettlements[0];
  assert.equal(row.owner_settlement_amount, 25000, 'cumulative, not overwritten by the last payment');
  assert.equal(row.owner_settlement_status, 'PARTIAL');
  assert.equal((await ledger.getOwnerPosition(1)).outstanding, 15000);

  await settle.recordOwnerSettlementByTripId(1, { amount: 15000, payment_method: 'cash' }, ADMIN);
  row = db.__state.tripSettlements[0];
  assert.equal(row.owner_settlement_amount, 40000);
  assert.equal(row.owner_settlement_status, 'PAID', 'status follows the REMAINING balance');
  assert.equal((await ledger.getOwnerPosition(1)).outstanding, 0);
});

// ===========================================================================
// 19–20. IDEMPOTENCY
// ===========================================================================

test('19. a duplicate request (double click) records an advance only once', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const svc = new TripAdvanceService({ prisma: db });
  const ledger = new VendorLedgerService({ prisma: db });

  const payload = {
    trip_id: 1, amount: 10000, advance_type: 'OWNER_ADVANCE',
    payment_method: 'upi', reference_number: 'UPI-DUP-1',
  };

  const first = await svc.createAdvance(null, payload, ADMIN);
  const second = await svc.createAdvance(null, payload, ADMIN);

  assert.equal(first.already_recorded, undefined);
  assert.equal(second.already_recorded, true);
  assert.equal(second.advance_id, first.advance_id, 'the same advance is returned');

  assert.equal(db.__state.tripAdvances.length, 1);
  assert.equal(db.__state.financialTransactions.length, 1, 'no second money movement');
  assert.equal((await ledger.getOwnerPosition(1)).outstanding, 30000, 'charged once');
});

test('20. a retried payment with the same reference records nothing twice', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const settle = new TripSettlementService({ prisma: db });
  const ledger = new VendorLedgerService({ prisma: db });

  const payload = { amount: 15000, payment_method: 'upi', reference_number: 'UPI-DUP-2' };

  const first = await settle.recordOwnerSettlementByTripId(1, payload, ADMIN);
  const second = await settle.recordOwnerSettlementByTripId(1, payload, ADMIN);

  assert.equal(second.already_recorded, true);
  assert.equal(
    db.__state.financialTransactions.filter((t) => t.transaction_type === 'OWNER_SETTLEMENT').length,
    1
  );
  assert.equal(db.__state.tripSettlements[0].owner_settlement_amount, 15000, 'not added twice');
  assert.equal(first.owner_settlement_amount, second.owner_settlement_amount);
  assert.equal((await ledger.getOwnerPosition(1)).outstanding, 25000, 'charged once');
});

test('20b. payments with different references are separate payments', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, { amount: 1000, reference_number: 'R1' }, ADMIN);
  await settle.recordOwnerSettlementByTripId(1, { amount: 1000, reference_number: 'R2' }, ADMIN);

  assert.equal(
    db.__state.financialTransactions.filter((t) => t.transaction_type === 'OWNER_SETTLEMENT').length,
    2,
    'genuinely distinct payments are not collapsed'
  );
  assert.equal(db.__state.tripSettlements[0].owner_settlement_amount, 2000);
});

// ===========================================================================
// 21–26. AUTHORIZATION
// ===========================================================================

function runAdminOnly(user) {
  return new Promise((resolve) => {
    const res = {
      status(c) { this._status = c; return this; },
      json(b) { this._body = b; resolve({ status: this._status, body: this._body }); return this; },
    };
    adminOnly({ user }, res, () => resolve({ status: 200, body: null, allowed: true }));
  });
}

test('21. an admin may record vendor money', async () => {
  for (const role of ['admin', 'super_admin', 'operator']) {
    const r = await runAdminOnly({ role });
    assert.equal(r.allowed, true, `${role} must be allowed`);
  }
});

test('22–25. customer, driver, unauthenticated and partner cannot record vendor money', async () => {
  const denied = [
    ['customer', { user_id: 9, role: 'customer' }],
    ['driver', { user_id: 8, role: 'driver' }],
    ['partner', { user_id: 7, role: 'partner' }],
    ['operator-less admin', { user_id: 6, role: 'staff' }],
  ];
  for (const [label, user] of denied) {
    const r = await runAdminOnly(user);
    assert.equal(r.status, 403, `${label} must be refused`);
    assert.equal(r.allowed, undefined, `${label} must not reach the handler`);
  }

  // Unauthenticated: `protect` rejects before `adminOnly` ever runs, and
  // `adminOnly` cannot pass a request with no user at all.
  const anon = await runAdminOnly(undefined);
  assert.equal(anon.status, 403);
});

test('23b. an unauthorised partner cannot reach another partner payment surface', async () => {
  // partnerSelfServiceRoutes mounts only `/me/*` behind `attachPartner`, which
  // derives the partner from the authenticated session — there is no route that
  // takes a partner id in the URL at all, so a partner cannot address somebody
  // else's ledger, payments or settlements. Assert that from the router's own
  // route table rather than trusting the comment above it.
  const router = require('../routes/partnerSelfServiceRoutes');
  const paths = router.stack
    .filter((l) => l.route)
    .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

  assert.deepEqual(
    paths.filter((p) => /:partnerId/i.test(p)),
    [],
    'no partner route accepts a partner id from the URL'
  );
  assert.deepEqual(
    paths.filter((p) => /\/(payments|ledger|settlements|financials)/.test(p) && /:id/.test(p)),
    [],
    'no partner money route is addressable by id'
  );
  // The id-taking routes that do exist are trip-scoped, and are authorised by
  // `attachPartner` against the session's own partner.
  for (const p of paths.filter((x) => /:id/.test(x))) {
    assert.match(p, /\/me\//, `unexpected partner route ${p}`);
  }
  assert.ok(paths.some((p) => p.endsWith('/me/ledger')));
  assert.ok(paths.some((p) => p.endsWith('/me/payments')));
  assert.ok(paths.some((p) => p.endsWith('/me/settlements')));
});

test('24–26. the write routes are behind protect + adminOnly in the real router', async () => {
  const router = require('../routes/tripFinancialRoutes');
  const guardOf = (predicate) => router.stack
    .filter((l) => l.route && predicate(`${Object.keys(l.route.methods)[0]} ${l.route.path}`))
    .map((l) => l.route.stack.map((s) => s.name));

  const writes = guardOf((d) => d.startsWith('POST'));
  for (const stack of writes) {
    assert.ok(stack.includes('protect'), 'every money route requires authentication');
    assert.ok(
      stack.includes('adminOnly') || stack.includes('adminCheck'),
      'every money route requires an admin role'
    );
  }

  const ownerRoutes = require('../routes/vehicleOwnerRoutes');
  const ledgerStack = ownerRoutes.stack
    .filter((l) => l.route && l.route.path === '/:id/ledger')
    .flatMap((l) => l.route.stack.map((s) => s.name));
  assert.ok(ledgerStack.includes('protect'), 'the vendor ledger requires authentication');
  assert.ok(ledgerStack.includes('adminCheck'), 'the vendor ledger is admin-only');
});

// ===========================================================================
// 27–30. LEDGER
// ===========================================================================

test('27–28. ledger entries are chronological and the running balance is correct', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const ledger = new VendorLedgerService({ prisma: db });
  const advances = new TripAdvanceService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  await advances.createAdvance(null, {
    trip_id: 1, amount: 10000, advance_type: 'OWNER_ADVANCE',
    payment_method: 'cash', reference_number: 'ADV-1', advance_date: '2026-10-06',
  }, ADMIN);
  await settle.recordOwnerSettlementByTripId(1, {
    amount: 15000, payment_method: 'upi', reference_number: 'PAY-1',
    settlement_date: '2026-10-08',
  }, ADMIN);
  await settle.recordOwnerSettlementByTripId(1, {
    amount: 15000, payment_method: 'cheque', reference_number: 'CHQ-1',
    settlement_date: '2026-10-09',
  }, ADMIN);

  const statement = await ledger.getOwnerLedger(10);

  // Chronological.
  const dates = statement.entries.map((e) => new Date(e.date).getTime());
  for (let i = 1; i < dates.length; i += 1) {
    assert.ok(dates[i] >= dates[i - 1], 'entries are in date order');
  }

  // Every line carries the ledger fields the schema already has.
  for (const e of statement.entries) {
    for (const field of ['date', 'trip_number', 'transaction_type', 'direction', 'amount', 'reference', 'balance']) {
      assert.ok(field in e, `entry is missing ${field}`);
    }
  }

  // Opening + obligations − advances/payments = closing.
  assert.equal(statement.openingBalance, 0);
  assert.equal(statement.totalObligations, 40000);
  assert.equal(statement.totalAdvances, 10000);
  assert.equal(statement.totalPayments, 30000);
  assert.equal(statement.closingBalance, 0);
  assert.equal(statement.outstanding, 0);
  assert.equal(statement.settled, true);

  // Running balance on the final line.
  assert.equal(statement.entries[statement.entries.length - 1].balance, 0);

  // Running balance steps: +40,000 → 30,000 → 15,000 → 0
  assert.deepEqual(
    statement.entries.map((e) => e.balance),
    [40000, 30000, 15000, 0]
  );
});

test('29. multiple trips for the same vendor aggregate into one statement', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  // Trip 2 records NO commission terms of its own, so it falls back to the
  // business policy (5%) — the two trips therefore have different commission
  // shapes, which is exactly what the roll-up has to survive.
  db.__state.trips.push({
    ...db.__state.trips[0],
    trip_id: 2,
    trip_number: 'BTBT-2026-00002',
    freight_amount: 21000,
    commission_type: null,
    commission_percentage: null,
    trip_date: new Date('2026-11-02T00:00:00.000Z'),
  });

  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordOwnerSettlementByTripId(1, { amount: 40000, payment_method: 'cash' }, ADMIN);

  const statement = await ledger.getOwnerLedger(10);
  assert.equal(statement.tripCount, 2);
  assert.equal(statement.totalObligations, 40000 + 19950, 'trip 1 fixed 2,000 · trip 2 policy 5%');

  // Balances are per trip: trip 1 settled, trip 2 fully outstanding.
  const perTrip = await ledger.getOwnerTripPositions(10);
  assert.equal(perTrip.length, 2);
  const t1 = perTrip.find((p) => p.trip_id === 1);
  const t2 = perTrip.find((p) => p.trip_id === 2);
  assert.equal(t1.outstanding, 0);
  assert.equal(t1.netVendorPayable, 40000);
  assert.equal(t2.outstanding, 19950);
  assert.equal(t2.netVendorPayable, 19950);
  assert.equal(t2.grossHire, 21000);
  assert.equal(t2.commissionAmount, 1050);

  // The roll-up still equals the sum of the trips.
  const sumOutstanding = perTrip.reduce((s, p) => s + p.outstanding, 0);
  assert.equal(statement.outstanding, sumOutstanding);
  assert.equal(statement.outstanding, 19950);
  assert.equal(statement.totalPayments, 40000);
});

test('30. multiple payments for the same trip all remain in the ledger', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const ledger = new VendorLedgerService({ prisma: db });
  const settle = new TripSettlementService({ prisma: db });

  for (const [i, amount] of [10000, 15000, 15000].entries()) {
    await settle.recordOwnerSettlementByTripId(1, {
      amount, payment_method: 'bank_transfer', reference_number: `PAY-${i + 1}`,
      settlement_date: `2026-10-1${i + 1}`,
    }, ADMIN);
  }

  const statement = await ledger.getOwnerLedger(10);
  const payments = statement.entries.filter((e) => e.impact === 'PAYMENT');

  assert.equal(payments.length, 3, 'every payment is individually visible');
  assert.deepEqual(payments.map((p) => p.amount), [-10000, -15000, -15000]);
  assert.deepEqual(payments.map((p) => p.reference), ['PAY-1', 'PAY-2', 'PAY-3']);
  assert.deepEqual(payments.map((p) => p.balance), [30000, 15000, 0]);
  assert.ok(payments.every((p) => p.trip_number === 'BTBT-2026-00001'));
});

// ===========================================================================
// STEP 13 — FUEL STAYS DISTINCT
// ===========================================================================

test('fuel records never reduce the vendor payable and are never vendor money', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  const ledger = new VendorLedgerService({ prisma: db });
  const before = await ledger.getOwnerPosition(1);

  // A recorded diesel spend is a TripExpense, not a vendor payment.
  db.__state.tripExpenses = [{
    expense_id: 1, trip_id: 1, expense_type: 'DIESEL', amount: 8000,
    paid_by: 'TRANSPORT_OWNER', payment_method: 'cash',
  }];
  // A fuel advance is paid to the driver.
  db.__state.financialTransactions.push({
    transaction_id: 900, trip_id: 1, transport_owner_id: 10,
    transaction_type: 'FUEL_ADVANCE', amount: 5000,
    direction: 'DEBIT', from_party: 'BIHAR_TRANSPORT', to_party: 'DRIVER',
    transaction_date: new Date('2026-10-07'), status: 'PAID',
  });

  const after = await ledger.getOwnerPosition(1);
  assert.equal(after.netVendorPayable, before.netVendorPayable);
  assert.equal(after.outstanding, before.outstanding);
  assert.equal(after.paidTotal, 0);

  const classification = new VendorLedgerService({ prisma: db }).classifyTransaction(
    db.__state.financialTransactions[0]
  );
  assert.equal(classification.counts, false, 'a fuel advance is not vendor money');
});

// ===========================================================================
// HIRE IS NOT PAYMENT
// ===========================================================================

test('building a hire still writes no money of any kind', async () => {
  const db = makeDb({ gross: 42000, commissionPct: 5 });
  const hireService = new VehicleHireService({ prisma: db });

  await hireService.getVehicleHire(1);
  await hireService.getVehicleHire(1);

  assert.equal(db.__state.financialTransactions.length, 0);
  assert.equal(db.__state.tripAdvances.length, 0);
  assert.equal(db.__state.tripSettlements.length, 0);
  assert.equal(db.__state.tripPayments.length, 0);
  assert.equal(db.__state.auditLogs.length, 0);
});

// ===========================================================================
// DRIVER SETTLEMENT (unchanged path — regression guard)
// ===========================================================================

test('driver settlement still uses the existing canonical driver due', async () => {
  const db = makeDb({ gross: 42000, commissionType: 'fixed', commissionPct: 2000 });
  db.__state.trips[0].driver_payment = 30000;
  const settle = new TripSettlementService({ prisma: db });

  await settle.recordDriverSettlementByTripId(1, { amount: 10000, payment_method: 'cash' }, ADMIN);
  await settle.recordDriverSettlementByTripId(1, { amount: 20000, payment_method: 'cash' }, ADMIN);

  const row = db.__state.tripSettlements[0];
  assert.equal(row.driver_settlement_amount, 30000);
  assert.equal(row.driver_settlement_status, 'PAID');

  const canonical = new CanonicalFinancialService({ prisma: db });
  const financials = await canonical.calculateTripFinancials(1);
  assert.equal(financials.driverDue, 0);
  // The vendor position is untouched by driver money.
  const position = await new VendorLedgerService({ prisma: db }).getOwnerPosition(1);
  assert.equal(position.outstanding, 40000);
});

// keep the helper referenced so the suite documents the same flow it tests
void threePartialPayments;
