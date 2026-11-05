/**
 * money — integer-paise money engine.
 *
 * All authoritative arithmetic should go through these helpers instead of
 * raw JavaScript `+`/`-`/`*`/`/` on rupee Numbers. Values are converted to
 * integer paise at the boundary and converted back to rupees only for storage
 * or presentation.
 */

const PAISE_PER_RUPEE = 100;

const MAX_SAFE_PAISE = Number.MAX_SAFE_INTEGER;

function isMoneyString(value) {
  return /^-?\d+(\.\d{1,4})?$/.test(String(value).trim());
}

function parseMoneyInput(value, options = {}) {
  const { allowNegative = true, maxPaise = MAX_SAFE_PAISE } = options;
  if (value === null || value === undefined) {
    throw new Error('Money value is required');
  }
  if (typeof value === 'boolean') {
    throw new Error('Money value must be numeric');
  }
  const text = String(value).trim();
  if (text === '') throw new Error('Money value is required');
  if (!isMoneyString(text)) throw new Error('Invalid money format');
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error('Money value must be finite');
  const paise = Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * PAISE_PER_RUPEE);
  if (!Number.isSafeInteger(paise)) throw new Error('Money value exceeds safe precision');
  if (Math.abs(paise) > maxPaise) throw new Error('Money value exceeds supported limit');
  if (!allowNegative && paise < 0) throw new Error('Negative money values are not allowed');
  return paise;
}

function toPaiseStrict(value, options) {
  return parseMoneyInput(value, options);
}

function toPaise(value) {
  try {
    return parseMoneyInput(value, { allowNegative: true });
  } catch (e) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * PAISE_PER_RUPEE);
  }
}

function fromPaise(paise) {
  if (!Number.isFinite(paise)) return 0;
  return Math.round(paise) / PAISE_PER_RUPEE;
}

function add(...values) {
  return fromPaise(values.reduce((sum, v) => sum + toPaise(v), 0));
}

function sub(a, b) {
  return fromPaise(toPaise(a) - toPaise(b));
}

function mul(a, b) {
  // a is money, b is a dimensionless factor (rate, quantity, ...).
  return fromPaise(Math.round(toPaise(a) * Number(b)));
}

function div(a, b) {
  const divisor = Number(b);
  if (!Number.isFinite(divisor) || divisor === 0) return 0;
  return fromPaise(Math.round(toPaise(a) / divisor));
}

function percent(amount, rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 0;
  return fromPaise(Math.round((toPaise(amount) * r) / 100));
}

function min(a, b) {
  return toPaise(a) <= toPaise(b) ? fromPaise(toPaise(a)) : fromPaise(toPaise(b));
}

function max(a, b) {
  return toPaise(a) >= toPaise(b) ? fromPaise(toPaise(a)) : fromPaise(toPaise(b));
}

function eq(a, b) {
  return toPaise(a) === toPaise(b);
}

function cmp(a, b) {
  const x = toPaise(a);
  const y = toPaise(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

module.exports = {
  PAISE_PER_RUPEE,
  MAX_SAFE_PAISE,
  parseMoneyInput,
  toPaiseStrict,
  toPaise,
  fromPaise,
  add,
  sub,
  mul,
  div,
  percent,
  min,
  max,
  eq,
  cmp,
};
