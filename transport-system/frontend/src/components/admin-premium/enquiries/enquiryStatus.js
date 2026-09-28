/**
 * enquiryStatus.js
 * ---------------------------------------------------------------------------
 * Presentation helpers for the admin ENQUIRY workspace.
 *
 * SINGLE SOURCE OF TRUTH
 *   Every label, badge tone, journey step and grouping below is derived from the
 *   REAL backend `bookings.quote_status` / `bookings.status` values returned by
 *   GET /api/admin/bookings and GET /api/admin/bookings/by-number/:number.
 *   Nothing here invents state — it only names and colours what the server
 *   already persisted.
 *
 * The quote_status values are the ones the backend itself persists
 * (backend/repositories/BookingRepository.js → QUOTE_STATUS_VALUES).
 */

/** Filter chips → the `quote_status` value the existing list API filters on. */
export const STATUS_FILTERS = [
  { key: 'ALL', label: 'All', apiValue: null, group: 'all' },
  { key: 'NEW', label: 'New', apiValue: 'PENDING', group: 'new' },
  { key: 'ACTIONABLE', label: 'Awaiting Quote', apiValue: 'ACTIONABLE', group: 'awaiting' },
  {
    key: 'SENT_GROUP',
    label: 'Quote Sent',
    apiValue: 'SENT,QUOTE_SENT,WAITING_CUSTOMER_APPROVAL',
    group: 'sent',
  },
  { key: 'ACCEPTED', label: 'Accepted', apiValue: 'ACCEPTED', group: 'accepted' },
  { key: 'REJECTED', label: 'Rejected', apiValue: 'REJECTED', group: 'rejected' },
  { key: 'EXPIRED', label: 'Expired', apiValue: 'EXPIRED', group: 'expired' },
];

/**
 * Compact KPI strip. Each entry is a REAL database count: the workspace calls
 * the existing list endpoint once per key with `limit=1` and reads
 * `pagination.total`, so a number on screen can only ever be a real row count.
 */
export const KPI_DEFS = [
  { key: 'NEW', label: 'New', hint: 'New requests requiring attention', apiValue: 'PENDING', tone: 'amber' },
  { key: 'ACTIONABLE', label: 'Awaiting Quote', hint: 'Requests waiting for pricing', apiValue: 'ACTIONABLE', tone: 'orange' },
  { key: 'SENT_GROUP', label: 'Quote Sent', hint: 'Quotes currently with customers', apiValue: 'SENT,QUOTE_SENT,WAITING_CUSTOMER_APPROVAL', tone: 'sky' },
  { key: 'ACCEPTED', label: 'Accepted', hint: 'Customer accepted quotation', apiValue: 'ACCEPTED', tone: 'emerald' },
  { key: 'REJECTED', label: 'Rejected', hint: 'Customer rejected quotation', apiValue: 'REJECTED', tone: 'rose' },
  { key: 'ALL', label: 'Total', hint: 'Total enquiries', apiValue: null, tone: 'navy' },
];

const STATUS_META = {
  PENDING: { label: 'Pending', chip: 'Pending', tone: 'amber', bar: 'bg-amber-500' },
  PREPARING: { label: 'Under Review', chip: 'Under Review', tone: 'amber', bar: 'bg-amber-500' },
  DRIVER_RESERVED: { label: 'Quote Prepared', chip: 'Quote Prepared', tone: 'violet', bar: 'bg-violet-500' },
  VEHICLE_RESERVED: { label: 'Quote Prepared', chip: 'Quote Prepared', tone: 'violet', bar: 'bg-violet-500' },
  SENT: { label: 'Quote Sent', chip: 'Quote Sent', tone: 'sky', bar: 'bg-sky-500' },
  QUOTE_SENT: { label: 'Quote Sent', chip: 'Quote Sent', tone: 'sky', bar: 'bg-sky-500' },
  WAITING_CUSTOMER_APPROVAL: { label: 'Quote Sent', chip: 'Quote Sent', tone: 'sky', bar: 'bg-sky-500' },
  ACCEPTED: { label: 'Accepted', chip: 'Accepted', tone: 'emerald', bar: 'bg-emerald-500' },
  REJECTED: { label: 'Rejected', chip: 'Rejected', tone: 'rose', bar: 'bg-rose-500' },
  EXPIRED: { label: 'Expired', chip: 'Expired', tone: 'slate', bar: 'bg-slate-400' },
};

const FALLBACK_META = { label: 'Pending', chip: 'Pending', tone: 'amber', bar: 'bg-amber-500' };

export function normaliseQuoteStatus(booking) {
  const raw = String(booking?.quote_status || 'PENDING').toUpperCase();
  return raw;
}

/**
 * A SENT quote whose validity window has elapsed is shown as EXPIRED. The
 * expiry itself is persisted by the backend (quote_valid_until) — this only
 * reflects it.
 */
export function isQuoteExpired(booking) {
  const status = normaliseQuoteStatus(booking);
  if (status === 'EXPIRED') return true;
  if (status !== 'SENT' && status !== 'QUOTE_SENT' && status !== 'WAITING_CUSTOMER_APPROVAL') return false;
  const until = booking?.quote_valid_until;
  if (!until) return false;
  const ts = new Date(until).getTime();
  return Number.isFinite(ts) && ts < Date.now();
}

export function getStatusMeta(booking) {
  if (isQuoteExpired(booking)) return STATUS_META.EXPIRED;
  return STATUS_META[normaliseQuoteStatus(booking)] || FALLBACK_META;
}

/** The customer journey — a fixed 6-step rail driven by real backend state. */
export const JOURNEY_STEPS = [
  { key: 'received', label: 'Request Received' },
  { key: 'review', label: 'Under Review' },
  { key: 'prepared', label: 'Quote Prepared' },
  { key: 'sent', label: 'Quote Sent' },
  { key: 'accepted', label: 'Customer Accepted' },
  { key: 'confirmed', label: 'Confirmed' },
];

/**
 * Index of the furthest real step reached. Derived only from persisted fields:
 * quote_status, status, quote_accepted_at, confirmed_at.
 */
export function getJourneyIndex(booking) {
  if (!booking) return 0;
  const status = normaliseQuoteStatus(booking);

  if (booking.confirmed_at || String(booking.status || '').toLowerCase() === 'confirmed') return 5;
  if (status === 'ACCEPTED' || booking.quote_accepted_at) return 4;
  if (status === 'REJECTED' || booking.quote_rejected_at) return 3;
  if (isQuoteExpired(booking)) return 3;
  if (status === 'SENT' || status === 'QUOTE_SENT' || status === 'WAITING_CUSTOMER_APPROVAL' || booking.quote_sent_at) return 3;
  if (status === 'DRIVER_RESERVED' || status === 'VEHICLE_RESERVED' || status === 'PREPARING') return 2;
  if (status === 'PENDING') return 1;
  return 0;
}

/** A quote is still editable only while it has not reached the customer. */
export function isQuoteOpen(booking) {
  if (!booking) return false;
  const status = normaliseQuoteStatus(booking);
  if (status === 'ACCEPTED' || status === 'REJECTED' || status === 'EXPIRED') return false;
  if (isQuoteExpired(booking)) return false;
  if (status === 'SENT' || status === 'QUOTE_SENT' || status === 'WAITING_CUSTOMER_APPROVAL') return false;
  return !['cancelled', 'completed', 'delivered'].includes(String(booking.status || '').toLowerCase());
}

/* ── formatters ─────────────────────────────────────────────────────────── */

export function inr(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—';
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDistance(km) {
  const n = Number(km);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-IN')} km` : '—';
}

export function customerName(booking) {
  return (
    `${booking?.customer_first_name || ''} ${booking?.customer_last_name || ''}`.trim() ||
    booking?.customer_name ||
    '—'
  );
}

export function weightLabel(booking) {
  const w = Number(booking?.goods_weight_kg);
  if (!Number.isFinite(w) || w <= 0) return '—';
  return `${w.toLocaleString('en-IN')} ${booking?.weight_unit || 'kg'}`;
}

export function goodsLabel(booking) {
  return booking?.goods_type || booking?.goods_description || '—';
}

export function routeLabel(booking) {
  const from = booking?.pickup_city || booking?.pickup_location || '—';
  const to = booking?.drop_city || booking?.drop_location || '—';
  return `${from} → ${to}`;
}

export function bookingRef(booking) {
  return booking?.booking_number || booking?.booking_reference || `BTB-${booking?.booking_id ?? '—'}`;
}

export function assignedDriverName(booking) {
  if (!booking) return null;
  return (
    booking.driver_name_snapshot ||
    `${booking.driver_first_name || ''} ${booking.driver_last_name || ''}`.trim() ||
    null
  );
}

export function assignedVehicleNumber(booking) {
  if (!booking) return null;
  return booking.vehicle_number || booking.truck_number_snapshot || null;
}

// Backend catch-all strings that carry no diagnostic value. Surfacing them
// ("Server error") is worse than showing the caller's fallback, so we treat
// them as "no message" and let the caller supply a useful one.
const GENERIC_SERVER_MESSAGES = new Set([
  'server error',
  'internal server error',
  'internalservererror',
  'something went wrong',
  'an error occurred',
  'error',
]);

function usableServerMessage(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (GENERIC_SERVER_MESSAGES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Turn an axios failure into a message an admin can act on.
 *
 * Ordering matters: an authentication / authorization failure is described in
 * its own terms instead of being flattened into a generic server error, and a
 * generic backend string is discarded in favour of the caller's fallback.
 */
export function apiErrorMessage(err, fallback) {
  const status = err?.response?.status;
  const serverMessage = usableServerMessage(err?.response?.data?.message);

  if (serverMessage) return serverMessage;

  if (status === 401) {
    return 'Your session has expired. Please sign in again to load drivers.';
  }
  if (status === 403) {
    return 'You do not have permission to view the driver list.';
  }
  if (status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (err?._isNetworkError) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  if (err?._isTimeout) {
    return 'The server took too long to respond. Please try again.';
  }

  return usableServerMessage(err?.message) || fallback;
}
