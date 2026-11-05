/**
 * Financial Overview Regression Tests
 * MOCKED tests using in-memory fixtures. No database connections.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const CanonicalFinancialService = require('../services/CanonicalFinancialService');

const prisma = {
  trip: {
    findMany: async () => [
      { trip_id: 1, trip_number: 'BT-001', status: 'DELIVERED', client_id: 1,
        freight_amount: 50000, driver_payment: 0, financialTransactions: [], invoices: [] },
      { trip_id: 2, trip_number: 'BT-002', status: 'DELIVERED', client_id: 1,
        freight_amount: 40000, driver_payment: 0, financialTransactions: [],
        invoices: [{ invoice_id: 1, invoice_number: 'INV-001', final_price: 45000,
          status: 'GENERATED', payment_status: 'PARTIALLY_PAID', trip_id: 2 }] },
      { trip_id: 3, trip_number: 'BT-003', status: 'COMPLETED', client_id: 1,
        freight_amount: 30000, driver_payment: 0, financialTransactions: [],
        invoices: [{ invoice_id: 2, invoice_number: 'INV-002', final_price: 30000,
          status: 'PAID', payment_status: 'PAID', trip_id: 3 }] },
    ],
    findUnique: async ({ where }) => {
      const all = await prisma.trip.findMany();
      return all.find((t) => t.trip_id === where.trip_id) || null;
    },
  },
  $transaction: async (fn) => fn(prisma),
};

const service = new CanonicalFinancialService({ prisma });

test('Regression: Dashboard shows billed/unbilled breakdown', async () => {
  const summary = await service.calculateGlobalFinancials();
  assert.equal(summary.totalFreight, 120000);
  assert.equal(summary.totalBilledAmount, 75000); // 45000 + 30000
  assert.equal(summary.totalUnbilledFreight, 50000); // Trip A only
});

test('Regression: Unbilled trip shows unbilled freight = freight amount', () => {
  const tripA = { trip_id: 1, trip_number: 'BT-001', status: 'DELIVERED',
    client_id: 1, freight_amount: 50000, driver_payment: 0,
    financialTransactions: [], invoices: [] };
  const fA = service._computeTripFinancials(tripA);
  assert.equal(fA.freight, 50000);
  assert.equal(fA.billedAmount, 0);
  assert.equal(fA.unbilledFreight, 50000);
  assert.equal(fA.invoiceStatus, null);
});

test('Regression: Invoiced trip shows billed amount from invoice', () => {
  const tripB = { trip_id: 2, trip_number: 'BT-002', status: 'DELIVERED',
    client_id: 1, freight_amount: 40000, driver_payment: 0,
    financialTransactions: [],
    invoices: [{ invoice_id: 1, invoice_number: 'INV-001', final_price: 45000,
      status: 'GENERATED', payment_status: 'PARTIALLY_PAID', trip_id: 2 }] };
  const fB = service._computeTripFinancials(tripB);
  assert.equal(fB.freight, 40000);
  assert.equal(fB.billedAmount, 45000);
  assert.equal(fB.unbilledFreight, 0); // 40000 - 45000 < 0 → 0
  assert.equal(fB.invoiceStatus, 'PARTIALLY_PAID');
  assert.equal(fB.invoiceNumber, 'INV-001');
});

test('Regression: Cancelled invoice excluded from billing', () => {
  const tripA = { trip_id: 1, trip_number: 'BT-001', status: 'DELIVERED',
    client_id: 1, freight_amount: 50000, driver_payment: 0,
    financialTransactions: [],
    invoices: [{ invoice_id: 99, invoice_number: 'INV-CANCELLED', final_price: 99999,
      status: 'CANCELLED', payment_status: 'CANCELLED', trip_id: 1 }] };
  const fA = service._computeTripFinancials(tripA);
  assert.equal(fA.billedAmount, 0); // Cancelled invoice excluded
  assert.equal(fA.unbilledFreight, 50000);
});

test('Regression: Multiple trips aggregate correctly', async () => {
  const summary = await service.calculateGlobalFinancials();
  assert.equal(summary.totalTrips, 3);
  assert.equal(summary.totalFreight, 120000);
  assert.equal(summary.totalBilledAmount, 75000);
  assert.equal(summary.totalUnbilledFreight, 50000);
});

console.log('Financial overview regression tests completed');
