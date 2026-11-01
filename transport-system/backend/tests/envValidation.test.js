/**
 * Environment Validation Tests
 * Tests for secure env validation
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isWeakSecret, generateSecureSecret } = require('../utils/env');

test('isWeakSecret - rejects short secrets', () => {
  assert.equal(isWeakSecret('short'), true);
  assert.equal(isWeakSecret('1234567890123456789012345678901'), true); // 31 chars
});

test('isWeakSecret - rejects known default secrets', () => {
  assert.equal(isWeakSecret('btb_secret_key_2024_change_in_production'), true);
  assert.equal(isWeakSecret('secret'), true);
  assert.equal(isWeakSecret('change_me'), true);
});

test('isWeakSecret - rejects weak patterns', () => {
  assert.equal(isWeakSecret('alllowercaseonly'), true);
  assert.equal(isWeakSecret('12345678901234567890123456789012'), true);
});

test('isWeakSecret - accepts strong secrets', () => {
  const strong = generateSecureSecret(32);
  assert.equal(isWeakSecret(strong), false);
  assert.equal(isWeakSecret('MyStr0ng!R@nd0m#S3cr3t*K3y$2024LongEnough'), false);
});

test('generateSecureSecret - generates secure random secrets', () => {
  const secret1 = generateSecureSecret(32);
  const secret2 = generateSecureSecret(32);
  assert.equal(secret1.length, 64); // hex is 2x bytes
  assert.notEqual(secret1, secret2);
  assert.equal(isWeakSecret(secret1), false);
});
