/**
 * Focused unit tests for the shared commission calculator.
 *
 * Phase 1A scope: only the math is tested. No default-rate selection,
 * no DB, no booking / trip creation, no UI / dashboard / settlement
 * logic is exercised here.
 *
 * Conventions:
 *   - node:test + node:assert (matches the rest of the project's
 *     tests in tests/*.test.js).
 *   - No external deps.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { computeCommission, SUPPORTED_TYPES } = require('../services/CommissionCalculator');

describe('CommissionCalculator.computeCommission — percentage', () => {
  test('CASE 1: base=5000, rate=5%  =>  250', () => {
    const result = computeCommission({ base: 5000, rate: 5, type: 'percentage' });
    assert.strictEqual(result, 250);
  });

  test('CASE 2: base=10000, rate=10%  =>  1000', () => {
    const result = computeCommission({ base: 10000, rate: 10, type: 'percentage' });
    assert.strictEqual(result, 1000);
  });

  test('CASE 3: base=5000, rate=0%  =>  0', () => {
    const result = computeCommission({ base: 5000, rate: 0, type: 'percentage' });
    assert.strictEqual(result, 0);
  });

  test('default type is percentage when omitted', () => {
    const result = computeCommission({ base: 2000, rate: 10 });
    assert.strictEqual(result, 200);
  });

  test('rounds to 2 decimal places', () => {
    // 1234.56 * 7.5 / 100 = 92.592 -> 92.59
    const result = computeCommission({ base: 1234.56, rate: 7.5, type: 'percentage' });
    assert.strictEqual(result, 92.59);
  });

  test('non-integer rate is accepted', () => {
    // 10000 * 2.5 / 100 = 250
    const result = computeCommission({ base: 10000, rate: 2.5, type: 'percentage' });
    assert.strictEqual(result, 250);
  });

  test('zero base is allowed (returns 0)', () => {
    const result = computeCommission({ base: 0, rate: 5, type: 'percentage' });
    assert.strictEqual(result, 0);
  });
});

describe('CommissionCalculator.computeCommission — fixed', () => {
  test('CASE 4: fixed commission of 250  =>  250 (base ignored)', () => {
    const result = computeCommission({ base: 99999, rate: 250, type: 'fixed' });
    assert.strictEqual(result, 250);
  });

  test('fixed commission with zero base is allowed', () => {
    const result = computeCommission({ base: 0, rate: 100, type: 'fixed' });
    assert.strictEqual(result, 100);
  });
});

describe('CommissionCalculator.computeCommission — input validation', () => {
  test('CASE 5a: negative base throws INVALID_BASE', () => {
    assert.throws(
      () => computeCommission({ base: -100, rate: 5, type: 'percentage' }),
      (err) => err.code === 'INVALID_BASE'
    );
  });

  test('CASE 5b: non-numeric base throws INVALID_BASE', () => {
    assert.throws(
      () => computeCommission({ base: 'abc', rate: 5, type: 'percentage' }),
      (err) => err.code === 'INVALID_BASE'
    );
  });

  test('CASE 5c: missing base throws INVALID_BASE', () => {
    assert.throws(
      () => computeCommission({ rate: 5, type: 'percentage' }),
      (err) => err.code === 'INVALID_BASE'
    );
  });

  test('negative rate throws INVALID_RATE', () => {
    assert.throws(
      () => computeCommission({ base: 1000, rate: -5, type: 'percentage' }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('non-numeric rate throws INVALID_RATE', () => {
    assert.throws(
      () => computeCommission({ base: 1000, rate: 'high', type: 'percentage' }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('missing rate throws INVALID_RATE', () => {
    assert.throws(
      () => computeCommission({ base: 1000, type: 'percentage' }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('percentage rate > 100 throws INVALID_RATE', () => {
    assert.throws(
      () => computeCommission({ base: 1000, rate: 150, type: 'percentage' }),
      (err) => err.code === 'INVALID_RATE'
    );
  });

  test('fixed rate > 100 is allowed (no upper bound for fixed)', () => {
    const result = computeCommission({ base: 1000, rate: 500, type: 'fixed' });
    assert.strictEqual(result, 500);
  });

  test('unsupported type throws INVALID_TYPE', () => {
    assert.throws(
      () => computeCommission({ base: 1000, rate: 5, type: 'royalty' }),
      (err) => err.code === 'INVALID_TYPE'
    );
  });
});

describe('CommissionCalculator exports', () => {
  test('SUPPORTED_TYPES contains percentage and fixed', () => {
    assert.ok(Array.isArray(SUPPORTED_TYPES));
    assert.ok(SUPPORTED_TYPES.includes('percentage'));
    assert.ok(SUPPORTED_TYPES.includes('fixed'));
  });
});