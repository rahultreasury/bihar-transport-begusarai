/**
 * orderFormat.js — presentation-only helpers for the Order / Trip Master.
 *
 * Every function here is defensive: the backend has a lot of genuinely NULL
 * columns on a Booking (goods_weight_kg, estimated_distance_km, final_price,
 * snapshots…). A blank must render as an em dash, never as "NaN", "undefined"
 * or a misleading zero.
 */

const EM_DASH = '—';

const isBlank = (v) =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));

export const na = (v) => (isBlank(v) ? EM_DASH : v);

/** ₹ amount with Indian digit grouping. Returns an em dash when not a number. */
export function inr(value, { decimals = 0, suffix = '' } = {}) {
  if (isBlank(value)) return EM_DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
}

/** Compact money for KPI tiles: ₹2.45L / ₹1.2Cr. */
export function inrCompact(value) {
  if (isBlank(value)) return EM_DASH;
  const n = Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return inr(n);
}

/** "1,211 km" */
export function distance(km) {
  if (isBlank(km)) return EM_DASH;
  const n = Number(km);
  if (!Number.isFinite(n)) return EM_DASH;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
}

function toDate(value) {
  if (isBlank(value)) return null;
  // Booking.pickup_date is a plain "YYYY-MM-DD" string, not a Date — parsing it
  // with `new Date()` would treat it as UTC midnight and can render as the
  // previous day in IST. Build a local date instead.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "27 Sep 2026" */
export function formatDate(value) {
  const d = toDate(value);
  if (!d) return EM_DASH;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "27 Sep 2026, 2:15 PM" */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return EM_DASH;
  return `${d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

/** "2:15 PM" */
export function formatTime(value) {
  const d = toDate(value);
  if (!d) return EM_DASH;
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Pickup time is stored as a bare "HH:MM:SS" string (Booking.pickup_time), so
 * Date cannot parse it. Format it by hand and keep it locale-stable.
 */
export function formatClock(value) {
  if (isBlank(value)) return EM_DASH;
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  const h = Number(m[1]);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]} ${period}`;
}

/** Join the non-blank parts of an address into one readable line. */
export function place(...parts) {
  const bits = parts.filter((p) => !isBlank(p) && String(p).trim() !== 'null');
  return bits.length ? bits.join(', ') : EM_DASH;
}

/** "Patna → Chandigarh" for list rows. */
export function routeLine(row) {
  if (!row) return EM_DASH;
  const from = na(row.pickup_location ?? row.pickup_city);
  const to = na(row.drop_location ?? row.drop_city);
  return `${from} → ${to}`;
}

/** Full name from the flattened customer columns. */
export function customerName(row) {
  if (!row) return EM_DASH;
  const name = [row.customer_first_name, row.customer_last_name]
    .filter((p) => !isBlank(p) && String(p).trim())
    .join(' ');
  return name || na(row.customer_name);
}

/** "25 Units" / "8,500 KG" / "10 TON" — quantity and weight each on their own. */
export function qtyWithUnit(value, unit) {
  if (isBlank(value)) return EM_DASH;
  const n = Number(value);
  const shown = Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value;
  return isBlank(unit) ? String(shown) : `${shown} ${unit}`;
}

export { EM_DASH };
