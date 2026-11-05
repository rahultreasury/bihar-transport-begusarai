const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const money = require('../services/finance/money');

describe('money engine', () => {
  test('0.10 + 0.20 is exact', () => {
    assert.equal(money.add(0.1, 0.2), 0.3);
  });
  test('repeated 0.01 addition is exact', () => {
    let total = 0;
    for (let i = 0; i < 100; i++) total = money.add(total, 0.01);
    assert.equal(total, 1);
  });
  test('percentage commission', () => {
    assert.equal(money.percent(42000, 5), 2100);
  });
  test('partial payment subtraction', () => {
    assert.equal(money.sub(11000, 2000), 9000);
  });
  test('fuel adjustment sum', () => {
    assert.equal(money.add(1000, 2000), 3000);
  });
  test('commission net payable', () => {
    assert.equal(money.sub(42000, 2000), 40000);
  });
});

describe('money validation', () => {
  test('valid values convert to paise', () => {
    assert.equal(money.toPaiseStrict(0), 0);
    assert.equal(money.toPaiseStrict(0.01), 1);
    assert.equal(money.toPaiseStrict(0.1), 10);
    assert.equal(money.toPaiseStrict(0.2), 20);
    assert.equal(money.toPaiseStrict(100.5), 10050);
    assert.equal(money.toPaiseStrict(999999.99), 99999999);
  });
  test('rejects invalid inputs', () => {
    assert.throws(() => money.toPaiseStrict(NaN));
    assert.throws(() => money.toPaiseStrict(Infinity));
    assert.throws(() => money.toPaiseStrict('abc'));
    assert.throws(() => money.toPaiseStrict(''));
    assert.throws(() => money.toPaiseStrict('  '));
    assert.throws(() => money.toPaiseStrict(null));
    assert.throws(() => money.toPaiseStrict(undefined));
  });
  test('rejects excessive precision', () => {
    assert.throws(() => money.toPaiseStrict('1.23456'));
  });
  test('negative handling', () => {
    assert.equal(money.toPaiseStrict(-5.25), -525);
    assert.throws(() => money.toPaiseStrict(-5.25, { allowNegative: false }));
  });
});
