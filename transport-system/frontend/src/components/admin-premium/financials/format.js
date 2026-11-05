/**
 * format.js — one set of money/date formatters for the Finance module.
 *
 * The browser never creates a financial figure; it only formats one received
 * from the server. Keeping the formatters here guarantees every tab shows the
 * same currency shape.
 */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrPreciseFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const inr = (value) => inrFormatter.format(Number(value) || 0);
export const inrPrecise = (value) => inrPreciseFormatter.format(Number(value) || 0);

export const compactInr = (value) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return inr(n);
};

export const day = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dayShort = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const pct = (value) => {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
};

export const number = (value) => new Intl.NumberFormat('en-IN').format(Number(value) || 0);

export const titleCase = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const methodLabel = (value) => {
  if (!value) return '—';
  const key = String(value).toUpperCase();
  const labels = {
    CASH: 'Cash',
    BANK: 'Bank',
    BANK_TRANSFER: 'Bank Transfer',
    UPI: 'UPI',
    CHEQUE: 'Cheque',
    SETTLEMENT: 'Settlement',
    FUEL_CREDIT: 'Fuel Credit',
    CREDIT: 'Credit',
  };
  return labels[key] || titleCase(value);
};

/** Unwrap the project's `{ success, data }` envelope. */
export const unwrap = (response) => response?.data?.data ?? null;
