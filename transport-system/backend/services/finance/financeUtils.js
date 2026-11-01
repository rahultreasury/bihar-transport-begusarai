const money = require('./money');
/**
 * financeUtils
 * ---------------------------------------------------------------------------
 * Small, dependency-free helpers shared by the Finance reporting and posting
 * services. Keeping them here (rather than in each service) guarantees that a
 * rupee is rounded the same way on the write path and on the read path.
 */

/** Round a money value to paise, absorbing binary float drift. */
function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Coerce a Prisma Decimal / numeric / string to a finite number. */
function num(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a `YYYY-MM-DD` or ISO date into a Date, or null. */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const d = new Date(dayOnly ? `${text}T00:00:00.000Z` : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Parse the JSON `metadata` column of a FinancialTransaction. */
function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** A payment method that moves real cash/bank money. */
const NON_CASH_METHODS = new Set(['SETTLEMENT', 'CREDIT', 'FUEL_CREDIT', 'ADJUSTMENT', 'NONE']);

function isCashMethod(method) {
  if (!method) return true;
  return !NON_CASH_METHODS.has(String(method).toUpperCase());
}

/** Human label for a payment method. */
const METHOD_LABELS = Object.freeze({
  CASH: 'Cash',
  BANK: 'Bank',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  SETTLEMENT: 'Settlement',
  CREDIT: 'Credit',
  FUEL_CREDIT: 'Fuel Credit',
  OTHER: 'Other',
  ONLINE: 'Online',
  RAZORPAY: 'Online',
  STRIPE: 'Online',
});

function methodLabel(method) {
  if (!method) return '—';
  const key = String(method).toUpperCase();
  return METHOD_LABELS[key] || String(method);
}

/** The effective billed value of an invoice, whatever stage wrote it. */
function invoiceTotal(invoice) {
  const totalPaise =
    money.toPaise(invoice.grand_total) ||
    money.toPaise(invoice.total_amount) ||
    money.toPaise(invoice.final_price) ||
    (money.toPaise(invoice.taxable_amount) + money.toPaise(invoice.tax_amount));
  return money.fromPaise(totalPaise);
}

/** The effective customer name for an invoice. */
function invoiceCustomerName(invoice) {
  const client = invoice.trips?.client;
  if (client?.company_name) return client.company_name;
  if (client?.contact_person) return client.contact_person;

  const user = invoice.booking?.user;
  if (user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (name) return name;
  }
  return 'Customer';
}

/** Standard default range: the current calendar month (UTC), matching the
 * stored timestamp convention used across this codebase. */
function defaultRange(now = new Date()) {
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

module.exports = {
  roundMoney,
  num,
  parseDate,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  monthKey,
  monthLabel,
  parseMetadata,
  isCashMethod,
  NON_CASH_METHODS,
  methodLabel,
  invoiceTotal,
  invoiceCustomerName,
  defaultRange,
};
