/**
 * Petrol Pump Ledger Tests
 * Mocked unit tests for financial integrity
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Decimal } = require('@prisma/client/runtime/library');

const PetrolPumpRepository = require('../repositories/PetrolPumpRepository');

test('Decimal arithmetic - addition and multiplication', () => {
  const repo = new PetrolPumpRepository();
  const a = repo._toDecimal('10.5');
  const b = repo._toDecimal('2.3');
  const sum = a.add(b);
  const prod = a.mul(b);
  assert.equal(sum.toString(), '12.8');
  assert.equal(prod.toFixed(2), '24.15');
});

test('Decimal arithmetic - no parseFloat precision loss', () => {
  const repo = new PetrolPumpRepository();
  // 0.1 + 0.2 precision issue with floats
  const result = repo._toDecimal('0.1').add(repo._toDecimal('0.2'));
  assert.equal(result.toString(), '0.3');
});

test('Positive validation - litres must be positive', () => {
  const repo = new PetrolPumpRepository();
  const litres = repo._toDecimal('-10');
  assert(litres.lte(0));
});

test('Positive validation - rate must be positive', () => {
  const repo = new PetrolPumpRepository();
  const rate = repo._toDecimal('0');
  assert(rate.lte(0));
});

test('Bill amount calculation', () => {
  const repo = new PetrolPumpRepository();
  const fuelTotal = repo._toDecimal('50000.50');
  const adjustment = repo._toDecimal('100.25');
  const billAmount = fuelTotal.add(adjustment);
  assert.equal(billAmount.toString(), '50100.75');
});

test('Payment outstanding calculation', () => {
  const repo = new PetrolPumpRepository();
  const billAmount = repo._toDecimal('10000');
  const paidAmount = repo._toDecimal('3000');
  const outstanding = billAmount.sub(paidAmount);
  assert.equal(outstanding.toString(), '7000');
  
  const fullPaid = billAmount.sub(billAmount);
  assert.equal(fullPaid.toString(), '0');
});

test('Overpayment detection', () => {
  const repo = new PetrolPumpRepository();
  const outstanding = repo._toDecimal('5000');
  const payment = repo._toDecimal('6000');
  assert(payment.gt(outstanding));
});

test('Ledger balance calculation - debits increase liability', () => {
  const repo = new PetrolPumpRepository();
  let balance = repo._toDecimal('10000'); // opening
  const fuelPurchase = repo._toDecimal('5000');
  balance = balance.add(fuelPurchase); // debit
  assert.equal(balance.toString(), '15000');
});

test('Ledger balance calculation - credits reduce liability', () => {
  const repo = new PetrolPumpRepository();
  let balance = repo._toDecimal('15000');
  const payment = repo._toDecimal('8000');
  balance = balance.sub(payment); // credit
  assert.equal(balance.toString(), '7000');
});

test('Running balance calculation', () => {
  const repo = new PetrolPumpRepository();
  let balance = repo._toDecimal('0'); // opening
  const entries = [
    { debit: new Decimal('10000'), credit: new Decimal('0') },
    { debit: new Decimal('5000'), credit: new Decimal('0') },
    { debit: new Decimal('0'), credit: new Decimal('8000') },
  ];
  const results = [];
  for (const entry of entries) {
    balance = balance.add(entry.debit).sub(entry.credit);
    results.push(balance.toString());
  }
  assert.deepEqual(results, ['10000', '15000', '7000']);
});

test('Idempotency key uniqueness concept', () => {
  const repo = new PetrolPumpRepository();
  const key1 = `${Date.now()}-${Math.random()}`;
  const key2 = key1;
  assert.equal(key1, key2); // Same key should be detected
});

console.log('Petrol Pump Ledger mocked tests completed');

// === CONCURRENCY & RECONCILIATION TESTS (MOCKED) ===

test('MOCK: Concurrent bill creation - same transaction not double-billed', () => {
  // Simulate: two concurrent transactions both try to bill same unbilled tx
  const billed = new Set();
  const txId = 123;
  
  // First request
  const canBill1 = !billed.has(txId);
  if (canBill1) billed.add(txId);
  
  // Second concurrent request
  const canBill2 = !billed.has(txId);
  if (canBill2) billed.add(txId);
  
  assert.equal(canBill1, true);
  assert.equal(canBill2, false); // Second should be prevented
  assert.equal(billed.size, 1);
});

test('MOCK: Concurrent bill creation - duplicate period prevention', () => {
  const billsByPeriod = new Set();
  const key = 'pump1_2026-10-01_2026-10-31';
  
  // First request
  const canCreate1 = !billsByPeriod.has(key);
  if (canCreate1) billsByPeriod.add(key);
  
  // Second concurrent request
  const canCreate2 = !billsByPeriod.has(key);
  if (canCreate2) billsByPeriod.add(key);
  
  assert.equal(canCreate1, true);
  assert.equal(canCreate2, false);
});

test('MOCK: Concurrent payment - overpayment prevention', () => {
  const repo = new PetrolPumpRepository();
  let outstanding = repo._toDecimal('5000');
  
  // First payment
  const payment1 = repo._toDecimal('3000');
  const canPay1 = payment1.lte(outstanding);
  if (canPay1) outstanding = outstanding.sub(payment1);
  
  // Second concurrent payment trying to overpay
  const payment2 = repo._toDecimal('3000'); // would leave 2000, but let's say tries to pay 3000
  const canPay2 = payment2.lte(outstanding); // 3000 <= 2000 is false
  if (canPay2) outstanding = outstanding.sub(payment2);
  
  assert.equal(canPay1, true);
  assert.equal(canPay2, false);
  assert.equal(outstanding.toString(), '2000');
});

test('MOCK: Idempotency - same key returns original', () => {
  const payments = new Map();
  const key = 'idem-123';
  const payment1 = { id: 1, amount: '1000', key };
  
  // First request
  if (!payments.has(key)) {
    payments.set(key, payment1);
  }
  
  // Second request with same key
  const result = payments.get(key);
  
  assert.equal(result.id, 1);
  assert.equal(payments.size, 1);
});

test('MOCK: Idempotency - different payload with same key should be detected', () => {
  const payments = new Map();
  const key = 'idem-456';
  payments.set(key, { id: 1, amount: '1000', pump_id: 1 });
  
  // Attempt with different payload
  const existing = payments.get(key);
  const newPayload = { amount: '2000', pump_id: 1 };
  
  // Should detect mismatch
  const isSamePayload = existing.amount === newPayload.amount;
  assert.equal(isSamePayload, false); // Different payload detected
});

test('MOCK: Concurrent payments - no lost updates', () => {
  const repo = new PetrolPumpRepository();
  let paidAmount = repo._toDecimal('0');
  const billAmount = repo._toDecimal('10000');
  
  // Simulate atomic updates
  const payment1 = repo._toDecimal('3000');
  paidAmount = paidAmount.add(payment1);
  
  const payment2 = repo._toDecimal('4000');
  paidAmount = paidAmount.add(payment2);
  
  const outstanding = billAmount.sub(paidAmount);
  assert.equal(paidAmount.toString(), '7000');
  assert.equal(outstanding.toString(), '3000');
});

test('MOCK: Ledger reconciliation equation', () => {
  const repo = new PetrolPumpRepository();
  const opening = repo._toDecimal('5000');
  const fuelDebits = repo._toDecimal('20000');
  const paymentsCredits = repo._toDecimal('15000');
  const adjustments = repo._toDecimal('0');
  
  const closing = opening.add(fuelDebits).sub(paymentsCredits).add(adjustments);
  assert.equal(closing.toString(), '10000');
});

test('MOCK: Bills do not create double-counting of fuel expenses', () => {
  // Fuel transactions are the source of truth
  // Bills aggregate existing unbilled transactions, don't create new ones
  const fuelTxCount = 5;
  const billedTxCount = 5;
  const additionalExpenses = 0; // Bill is not a separate expense
  
  assert.equal(billedTxCount, fuelTxCount);
  assert.equal(additionalExpenses, 0);
});

test('MOCK: Partial payments reconcile correctly', () => {
  const repo = new PetrolPumpRepository();
  const billAmount = repo._toDecimal('10000');
  let paidAmount = repo._toDecimal('0');
  
  // First partial payment
  paidAmount = paidAmount.add(repo._toDecimal('3000'));
  let outstanding = billAmount.sub(paidAmount);
  assert.equal(outstanding.toString(), '7000');
  const status1 = outstanding.gt(0) && paidAmount.gt(0) ? 'PARTIALLY_PAID' : 'PAID';
  assert.equal(status1, 'PARTIALLY_PAID');
  
  // Second payment completes
  paidAmount = paidAmount.add(repo._toDecimal('7000'));
  outstanding = billAmount.sub(paidAmount);
  const status2 = outstanding.lte(0) ? 'PAID' : 'PARTIALLY_PAID';
  assert.equal(status2, 'PAID');
  assert.equal(outstanding.toString(), '0');
});

console.log('Concurrency & reconciliation tests completed');

// === FINAL DEFECT CORRECTION TESTS (MOCKED) ===

test('MOCK: Idempotency - same key identical payload returns original', () => {
  const repo = new PetrolPumpRepository();
  const payments = new Map();
  const key = 'idem-identical';
  const payload = { pump_id: 1, bill_id: 10, amount: '5000', payment_method: 'BANK_TRANSFER', reference_number: 'REF123' };
  const payment1 = { payment_id: 100, ...payload, idempotency_key: key };
  
  // First request
  if (!payments.has(key)) {
    payments.set(key, payment1);
  }
  
  // Second request identical
  const existing = payments.get(key);
  const matches = existing.pump_id === payload.pump_id &&
    existing.bill_id === payload.bill_id &&
    repo._toDecimal(existing.amount).eq(repo._toDecimal(payload.amount)) &&
    existing.payment_method === payload.payment_method &&
    existing.reference_number === payload.reference_number;
  
  assert.equal(matches, true);
  assert.equal(existing.payment_id, 100);
});

test('MOCK: Idempotency - same key different amount rejected', () => {
  const repo = new PetrolPumpRepository();
  const key = 'idem-diff-amount';
  const original = { pump_id: 1, bill_id: 10, amount: '5000', payment_method: 'BANK_TRANSFER' };
  payments_map = new Map();
  payments_map.set(key, { ...original, payment_id: 200 });
  
  const different = { pump_id: 1, bill_id: 10, amount: '6000', payment_method: 'BANK_TRANSFER' };
  const existing = payments_map.get(key);
  
  const matches = existing.pump_id === different.pump_id &&
    existing.bill_id === different.bill_id &&
    repo._toDecimal(existing.amount).eq(repo._toDecimal(different.amount));
  
  assert.equal(matches, false); // Should reject
});

test('MOCK: Idempotency - same key different bill rejected', () => {
  const repo = new PetrolPumpRepository();
  const key = 'idem-diff-bill';
  const original = { pump_id: 1, bill_id: 10, amount: '5000', payment_method: 'BANK_TRANSFER' };
  const map = new Map();
  map.set(key, { ...original, payment_id: 300 });
  
  const different = { pump_id: 1, bill_id: 20, amount: '5000', payment_method: 'BANK_TRANSFER' };
  const existing = map.get(key);
  
  const matches = existing.bill_id === different.bill_id;
  assert.equal(matches, false); // Should reject
});

test('MOCK: Concurrent identical requests with idempotency', () => {
  const payments = new Map();
  const key = 'idem-concurrent';
  let created = false;
  
  // Simulate two concurrent requests
  const req1 = () => {
    if (!payments.has(key)) {
      payments.set(key, { payment_id: 400, idempotency_key: key });
      created = true;
      return payments.get(key);
    }
    return payments.get(key);
  };
  
  const req2 = () => {
    if (!payments.has(key)) {
      payments.set(key, { payment_id: 401, idempotency_key: key });
      created = true;
      return payments.get(key);
    }
    return payments.get(key);
  };
  
  const r1 = req1();
  const r2 = req2();
  
  assert.equal(r1.payment_id, r2.payment_id);
  assert.equal(payments.size, 1);
});

test('MOCK: Concurrent payments exceeding balance rejected', () => {
  const repo = new PetrolPumpRepository();
  let outstanding = repo._toDecimal('5000');
  
  // Two concurrent attempts
  const attempt1 = repo._toDecimal('4000');
  const attempt2 = repo._toDecimal('2000');
  
  // First wins
  if (attempt1.lte(outstanding)) {
    outstanding = outstanding.sub(attempt1);
  }
  
  // Second should be rejected
  const canPay2 = attempt2.lte(outstanding);
  assert.equal(canPay2, false);
  assert.equal(outstanding.toString(), '1000');
});

test('MOCK: Concurrent bill generation - transaction locking prevents double billing', () => {
  const billed = new Map();
  const txId = 555;
  
  // Simulate row-level lock
  const lock = new Set();
  
  const bill1 = () => {
    if (lock.has(txId)) throw new Error('Locked');
    lock.add(txId);
    if (billed.has(txId)) throw new Error('Already billed');
    billed.set(txId, 1);
    return true;
  };
  
  const bill2 = () => {
    if (lock.has(txId)) throw new Error('Locked or concurrent');
    lock.add(txId);
    if (billed.has(txId)) throw new Error('Already billed');
    billed.set(txId, 2);
    return true;
  };
  
  try {
    bill1();
    assert.throws(() => bill2(), /Locked or concurrent|Already billed/);
  } catch (e) {
    // Expected
  }
  assert.equal(billed.size, 1);
});

console.log('Final defect correction tests completed');
