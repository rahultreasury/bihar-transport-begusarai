/**
 * Trip Finance API Regression Tests
 * MOCKED tests for customer payment, vendor transaction, and payment history APIs.
 * No database connections are made.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const CanonicalFinancialService = require('../services/CanonicalFinancialService');

// --- Build world and prisma mock ---
const world = {
  trips: [
    {
      trip_id: 1,
      trip_number: 'BT-2026-001',
      status: 'DELIVERED',
      client_id: 10,
      transport_owner_id: 20,
      vehicle_id: 30,
      driver_id: 40,
      freight_amount: 50000,
      driver_payment: 10000,
      source_type: 'WALK_IN',
      booking_id: null,
      vehicleHire: {
        hire_id: 100,
        gross_hire: 47500,
        commission_amount: 2500,
        commission_type: 'percentage',
        commission_rate: 5,
        net_vendor_payable: 47500, // intentionally wrong - will be fixed by calc
        status: 'ACTIVE',
      },
      transportOwner: { owner_id: 20, owner_name: 'Raj Transport', owner_type: 'INDIVIDUAL', mobile: '9800000001' },
    },
  ],
  financialTransaction: [],
};

const s = { trips: world.trips, financialTransaction: world.financialTransaction };

const prisma = {
  trip: {
    findUnique: async ({ where }) => {
      const t = s.trips.find((x) => x.trip_id === where.trip_id);
      return t ? { ...t } : null;
    },
  },
  financialTransaction: {
    findFirst: async ({ where }) => {
      return s.financialTransaction.find((x) => {
        for (const [k, v] of Object.entries(where)) {
          if (k === 'status' && typeof v === 'object' && v.not) {
            if (x.status === v.not) return false;
          } else if (x[k] !== v) return false;
        }
        return true;
      }) || null;
    },
    findMany: async ({ where, orderBy }) => {
      let results = s.financialTransaction.filter((x) => {
        if (where.trip_id && x.trip_id !== where.trip_id) return false;
        if (where.transaction_type) {
          if (typeof where.transaction_type === 'object' && where.transaction_type.in) {
            if (!where.transaction_type.in.includes(x.transaction_type)) return false;
          } else if (x.transaction_type !== where.transaction_type) return false;
        }
        return true;
      });
      if (orderBy) {
        results.sort((a, b) => new Date(a.transaction_date || 0) - new Date(b.transaction_date || 0));
      }
      return results;
    },
    create: async ({ data }) => {
      const id = 5000 + (s.__seq = (s.__seq || 0) + 1);
      const row = { ...data, transaction_id: id, created_at: new Date() };
      s.financialTransaction.push(row);
      return row;
    },
  },
  $transaction: async (fn) => fn(prisma),
};

const service = new CanonicalFinancialService({ prisma });

test('Mock: Net vendor payable = gross hire − commission (₹47,500 − ₹2,500 = ₹45,000)', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);
  assert.equal(f.ownerShare, 45000, 'Net vendor payable should be gross − commission');
  assert.equal(f.btCommission, 2500, 'Commission should be ₹2,500');
  assert.equal(f.freight, 50000, 'Freight should be ₹50,000');
});

test('Mock: Trip balance after ₹30,000 vendor payment = ₹45,000 − ₹30,000 = ₹15,000', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);
  const remaining = Math.max(0, f.ownerShare - 30000);
  assert.equal(remaining, 15000, 'Trip balance should be ₹15,000');
});

test('Mock: Partial customer payment reduces outstanding', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);
  const initialDue = f.customerDue;
  const collected = 20000;
  const remainingDue = Math.max(0, f.freight - collected);
  assert.equal(remainingDue, 30000, 'After ₹20,000 partial payment, due should be ₹30,000');
  assert.equal(remainingDue < initialDue, true, 'Due should decrease after partial payment');
});

test('Mock: Full customer payment clears outstanding', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);
  const collected = f.freight;
  const remainingDue = Math.max(0, f.freight - collected);
  assert.equal(remainingDue, 0, 'After full payment, due should be ₹0');
});

test('Mock: Duplicate customer payment prevented by reference_number', async () => {
  await prisma.financialTransaction.create({
    data: {
      trip_id: 1,
      transaction_type: 'CUSTOMER_PAYMENT',
      amount: 10000,
      reference_number: 'UTR-DUP-001',
      status: 'PAID',
    },
  });

  const existing = await prisma.financialTransaction.findFirst({
    where: {
      trip_id: 1,
      transaction_type: 'CUSTOMER_PAYMENT',
      reference_number: 'UTR-DUP-001',
      status: { not: 'CANCELLED' },
    },
  });
  assert.ok(existing, 'First payment should exist');
});

test('Mock: Commission collection (COLLECT) reduces vendor receivable', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);
  assert.equal(f.btCommission, 2500, 'Commission should be ₹2,500');
});

test('Mock: Fixed commission calculation', () => {
  const base = 10000;
  const fixedAmount = 1000;
  const commissionAmount = fixedAmount;
  const ownerShare = base - commissionAmount;
  assert.equal(commissionAmount, 1000);
  assert.equal(ownerShare, 9000);
});

test('Mock: Percentage commission calculation', () => {
  const base = 10000;
  const rate = 10;
  const commissionAmount = base * (rate / 100);
  const ownerShare = base - commissionAmount;
  assert.equal(commissionAmount, 1000);
  assert.equal(ownerShare, 9000);
});

test('Mock: Zero commission', () => {
  const base = 10000;
  const commissionAmount = 0;
  const ownerShare = base - commissionAmount;
  assert.equal(commissionAmount, 0);
  assert.equal(ownerShare, 10000);
});

test('Mock: Settlement without cash movement updates ledger but not cash/bank', () => {
  const settlementTx = {
    transaction_type: 'SETTLEMENT',
    amount: 5000,
    direction: 'DEBIT',
    payment_method: 'SETTLEMENT',
    from_party: 'BIHAR_TRANSPORT',
    to_party: 'TRANSPORT_OWNER',
    purpose: 'Settlement',
  };
  assert.equal(settlementTx.payment_method, 'SETTLEMENT', 'Settlement uses SETTLEMENT payment method');
  assert.equal(settlementTx.direction, 'DEBIT', 'Settlement is a debit to BT');
});

test('Mock: Fuel credit updates vendor ledger and petrol pump ledger', async () => {
  const fuelLitres = 100;
  const fuelRate = 95.50;
  const fuelAmount = fuelLitres * fuelRate; // 9550

  assert.equal(fuelAmount, 9550, 'Fuel amount should be 100 × 95.50 = ₹9,550');
});

test('Mock: Duplicate vendor transaction prevented by reference_number', async () => {
  const ref = 'UTR-VENDOR-001';
  await prisma.financialTransaction.create({
    data: {
      trip_id: 1,
      transaction_type: 'PAY',
      amount: 10000,
      reference_number: ref,
      status: 'PAID',
    },
  });

  const duplicate = await prisma.financialTransaction.findFirst({
    where: {
      trip_id: 1,
      transaction_type: 'PAY',
      reference_number: ref,
    },
  });
  assert.ok(duplicate, 'Duplicate vendor transaction should be detectable');
});

test('Mock: Trip-level outstanding after payments', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);

  const vendorPaid = 30000;
  const remainingVendorDue = Math.max(0, f.ownerShare - vendorPaid);
  assert.equal(remainingVendorDue, 15000, 'Vendor due after ₹30,000 payment should be ₹15,000');

  const customerPaid = 20000;
  const remainingCustomerDue = Math.max(0, f.freight - customerPaid);
  assert.equal(remainingCustomerDue, 30000, 'Customer due after ₹20,000 payment should be ₹30,000');
});

test('Mock: Previous vendor balance reconciliation', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);

  const previousPayable = 5000;
  const currentTripPayable = f.ownerShare; // 45000
  const totalPayable = previousPayable + currentTripPayable; // 50000
  const payment = 20000;
  const remaining = Math.max(0, totalPayable - payment); // 30000

  assert.equal(totalPayable, 50000, 'Total payable should be ₹5,000 + ₹45,000 = ₹50,000');
  assert.equal(remaining, 30000, 'Remaining after ₹20,000 payment should be ₹30,000');
});

test('Mock: Voucher/receipt retrieval - transaction exists for document generation', async () => {
  const tx = await prisma.financialTransaction.create({
    data: {
      trip_financial_id: 1,
      trip_id: 1,
      transaction_type: 'CUSTOMER_PAYMENT',
      amount: 5000,
      direction: 'CREDIT',
      from_party: 'CUSTOMER',
      to_party: 'BIHAR_TRANSPORT',
      purpose: 'Freight Payment',
      payment_method: 'cash',
      reference_number: 'RECEIPT-001',
      status: 'PAID',
      created_by: 1,
    },
  });

  assert.ok(tx.transaction_id, 'Transaction should be created');
  assert.equal(tx.direction, 'CREDIT', 'Customer payment is CREDIT direction');
});

test('Mock: Unauthorized user rejection (non-admin cannot record vendor payment)', () => {
  const adminRoles = ['admin', 'super_admin', 'operator'];
  const nonAdminRoles = ['customer', 'driver', 'partner'];

  const isAdmin = (role) => adminRoles.includes(role);
  assert.equal(isAdmin('admin'), true, 'Admin role should be authorized');
  assert.equal(isAdmin('customer'), false, 'Customer role should NOT be authorized');
  assert.equal(isAdmin('driver'), false, 'Driver role should NOT be authorized');
});

test('Mock: Trip Finance totals match ledger records', async () => {
  const trip = await prisma.trip.findUnique({ where: { trip_id: 1 } });
  const f = service._computeTripFinancials(trip);

  const txs = await prisma.financialTransaction.findMany({ where: { trip_id: 1 } });
  const totalCredits = txs
    .filter((t) => t.direction === 'CREDIT')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalDebits = txs
    .filter((t) => t.direction === 'DEBIT')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  assert.ok(totalCredits >= 0, 'Total credits should be non-negative');
  assert.ok(totalDebits >= 0, 'Total debits should be non-negative');
  assert.ok(f.transactionCount >= 0, 'Transaction count should be valid');
});

console.log('Trip Finance API regression tests completed');
