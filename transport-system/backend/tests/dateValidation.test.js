const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDateSafe } = require('../services/EnquiryAssignmentService');

test('parseDateSafe rejects impossible dates', () => {
  assert.equal(parseDateSafe('2026-02-31'), null);
  assert.equal(parseDateSafe('2026-13-01'), null);
  assert.equal(parseDateSafe('31-04-2026'), null);
  assert.equal(parseDateSafe('30-02-2026'), null);
});

test('parseDateSafe accepts valid dates', () => {
  assert.ok(parseDateSafe('2026-02-28'));
  assert.ok(parseDateSafe('2024-02-29')); // leap year
  assert.equal(parseDateSafe('2023-02-29'), null); // invalid leap year
  assert.ok(parseDateSafe('31-12-2026'));
  assert.ok(parseDateSafe('01-01-2026'));
});

test('parseDateSafe handles edge cases', () => {
  assert.equal(parseDateSafe(null), null);
  assert.equal(parseDateSafe(''), null);
  assert.equal(parseDateSafe('invalid'), null);
});
