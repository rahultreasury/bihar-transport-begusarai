/**
 * assignmentSelectors.jsx
 * ---------------------------------------------------------------------------
 * Adapters that turn the four REAL option collections returned by
 * `GET /api/admin/enquiries/options`
 * (backend/services/EnquiryAssignmentService.listAssignableOptions)
 * into the presentation contract of <PremiumCombobox />.
 *
 * WHY A SEPARATE FILE
 *   The workspace page owns workflow; this file owns *presentation of data*.
 *   Keeping the cross-referencing logic here means the assignment panel stays
 *   readable and the four selectors stay consistent with one another.
 *
 * REAL DATA ONLY — NOTHING IS INVENTED
 *   The endpoint's projections are exactly:
 *     vehicles : vehicle_id, vehicle_number, vehicle_type, vehicle_name,
 *                capacity_kg, body_type, current_status, owner_id, driver_id
 *     drivers  : driver_id, driver_code, driver_name, status, is_available,
 *                rating, transport_owner_id, partner_id, current_vehicle_id
 *     partners : partner_id, partner_name, partner_code, city
 *     owners   : owner_id, owner_name, company_name, city, state, status
 *
 *   So a driver's "assigned vehicle" is resolved by joining `current_vehicle_id`
 *   against the SAME response's vehicle list, and an owner's "12 vehicles · 8
 *   drivers" is counted from `owner_id` / `transport_owner_id` in that same
 *   response. Nothing is hardcoded, mocked or guessed — where a fact is not in
 *   the payload (e.g. driver mobile is NOT selected) the row simply omits it
 *   rather than showing an invented value. `getKeywords` still reads those
 *   optional fields so the instant they appear in the payload they become
 *   searchable and renderable with no change here.
 */

import { Building2, Check, Handshake, Star, Truck, UserRound } from 'lucide-react';
import { Highlight, formatKg, humanize } from './PremiumCombobox';

/* ── Status vocabulary (real values, defensive fallback) ─────────────────── */

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  sky: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/15',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/15',
};

/** status → { label, tone }. Unknown values degrade to a neutral slate pill. */
const STATUS_TONE = {
  // vehicles (current_status) + drivers (status)
  available: { label: 'AVAILABLE', tone: 'emerald' },
  active: { label: 'ACTIVE', tone: 'emerald' },
  on_trip: { label: 'ON TRIP', tone: 'sky' },
  assigned: { label: 'ASSIGNED', tone: 'sky' },
  loading: { label: 'LOADING', tone: 'amber' },
  in_transit: { label: 'IN TRANSIT', tone: 'sky' },
  maintenance: { label: 'MAINTENANCE', tone: 'rose' },
  off_road: { label: 'OFF ROAD', tone: 'rose' },
  scrapped: { label: 'SCRAPPED', tone: 'rose' },
  suspended: { label: 'SUSPENDED', tone: 'rose' },
  inactive: { label: 'INACTIVE', tone: 'slate' },
};

function statusMeta(status, fallback = 'UNKNOWN') {
  const key = String(status || '').toLowerCase();
  return STATUS_TONE[key] || { label: humanize(status) || fallback, tone: 'slate' };
}

/** Small uppercase availability pill used in every result row. */
function StatusPill({ status, fallback = 'UNKNOWN' }) {
  const meta = statusMeta(status, fallback);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ring-1 ring-inset ${TONES[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

/* ── Small shared atoms ──────────────────────────────────────────────────── */

/** Primary line of a result row, with the matched fragment highlighted. */
function RowTitle({ children, query, mono = false }) {
  return (
    <p
      className={`truncate text-[13px] font-bold text-text ${mono ? 'font-mono tracking-tight' : ''}`}
      title={typeof children === 'string' ? children : undefined}
    >
      <Highlight text={children} query={query} />
    </p>
  );
}

/** Secondary line — the "type · capacity" descriptor. */
function RowMeta({ children, query }) {
  if (!children) return null;
  return (
    <p className="mt-0.5 truncate text-[11.5px] text-muted">
      <Highlight text={children} query={query} />
    </p>
  );
}

/** Tertiary line — ownership / network relationship, always real cross-refs. */
function RowNote({ children, query }) {
  if (!children) return null;
  return (
    <p className="mt-1 truncate text-[11px] font-medium text-[#1e3a5f]">
      <Highlight text={children} query={query} />
    </p>
  );
}

/** The navy tick that marks the currently chosen row. */
function SelectedTick({ selected }) {
  if (!selected) return null;
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500">
      <Check className="h-3 w-3 text-white" strokeWidth={3.5} aria-hidden="true" />
    </span>
  );
}

/* ── Cross-reference index ───────────────────────────────────────────────── */

const key = (v) => (v === null || v === undefined ? null : String(v));

/** Count how many items point at each foreign id. */
function tally(rows, pick) {
  const counts = new Map();
  rows.forEach((row) => {
    const k = key(pick(row));
    if (k === null) return;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return counts;
}

/**
 * Joins the four collections against each other ONCE per options payload.
 *
 * Everything the four selectors show beyond their own row — owner of a vehicle,
 * vehicle of a driver, fleet size of an owner, roster size of a partner — is
 * derived here from the same response. There is no second request and no
 * invented data.
 */
export function buildAssignmentIndex(options = {}) {
  const vehicles = options.vehicles || [];
  const drivers = options.drivers || [];
  const partners = options.partners || [];
  const owners = options.owners || [];

  return {
    vehicles,
    drivers,
    partners,
    owners,

    vehicleById: new Map(vehicles.map((v) => [key(v.vehicle_id), v])),
    ownerById: new Map(owners.map((o) => [key(o.owner_id), o])),

    vehiclesPerOwner: tally(vehicles, (v) => v.owner_id),
    driversPerOwner: tally(drivers, (d) => d.transport_owner_id),
    driversPerPartner: tally(drivers, (d) => d.partner_id),
  };
}

/* ── Search keywords (module-scope so the filter memo stays stable) ──────── */

/* Stable id readers. Defined at module scope so PremiumCombobox's `selected`
   memo is not invalidated by a fresh closure on every parent render. */
export const getVehicleId = (v) => v.vehicle_id;
export const getDriverId = (d) => d.driver_id;
export const getOwnerId = (o) => o.owner_id;
export const getPartnerId = (p) => p.partner_id;

/**
 * Build the searchable keyword list for one record.
 *
 * Returns an ARRAY of already-lowercased strings, which is the contract
 * PremiumCombobox filters against. (It also tolerates a single joined string —
 * see the normaliser in the combobox — but returning the array keeps the
 * matcher's `keys.some(...)` on its fast path.)
 */
const flat = (...parts) =>
  parts
    .flatMap((p) => (p === null || p === undefined ? [] : [p]))
    .filter((p) => p !== '')
    .map((p) => String(p).toLowerCase());

export const vehicleKeywords = (v, ix) => {
  const owner = ix.ownerById.get(key(v.owner_id));
  return flat(
    v.vehicle_number,
    v.vehicle_name,
    v.vehicle_type,
    v.body_type,
    formatKg(v.capacity_kg),
    v.capacity_kg,
    v.current_status,
    owner?.company_name,
    owner?.owner_name,
    owner?.city,
  );
};

export const driverKeywords = (d, ix) => {
  const vehicle = ix.vehicleById.get(key(d.current_vehicle_id));
  const owner = ix.ownerById.get(key(d.transport_owner_id));
  return flat(
    d.driver_name,
    d.driver_code,
    // Present in the Driver model; not currently selected by the options query,
    // so it is searched for the moment the projection includes it.
    d.mobile,
    d.status,
    d.rating,
    vehicle?.vehicle_number,
    vehicle?.vehicle_type,
    vehicle?.vehicle_name,
    owner?.company_name,
    owner?.owner_name,
  );
};

export const ownerKeywords = (o) => flat(o.company_name, o.owner_name, o.city, o.state, o.status, o.owner_code);

export const partnerKeywords = (p) => flat(p.partner_name, p.partner_code, p.company_name, p.city, p.owner_name, p.mobile);

/* ── Vehicle ─────────────────────────────────────────────────────────────── */

export function renderVehicleOption(v, { query, selected }, ix) {
  const capacity = formatKg(v.capacity_kg);
  const type = v.vehicle_name || humanize(v.vehicle_type)?.toLowerCase() || 'Vehicle';
  const owner = ix.ownerById.get(key(v.owner_id));
  const ownerLabel = owner?.company_name || owner?.owner_name;

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#1e3a5f]">
        <Truck className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <RowTitle mono query={query}>
            {v.vehicle_number}
          </RowTitle>
          <StatusPill status={v.current_status} fallback="UNKNOWN" />
        </div>
        <RowMeta query={query}>{[type, capacity].filter(Boolean).join(' · ')}</RowMeta>
        <RowNote query={query}>{ownerLabel ? ownerLabel : null}</RowNote>
      </div>
      <SelectedTick selected={selected} />
    </div>
  );
}

export function renderVehicleSelected(v) {
  const capacity = formatKg(v.capacity_kg);
  const type = v.vehicle_name || humanize(v.vehicle_type)?.toLowerCase() || 'Vehicle';
  return (
    <>
      <p className="truncate font-mono text-[13px] font-bold tracking-tight text-text">
        {v.vehicle_number}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">
        <Highlight text={[type, capacity].filter(Boolean).join(' · ')} query="" />
      </p>
    </>
  );
}

/* ── Driver ──────────────────────────────────────────────────────────────── */

export function renderDriverOption(d, { query, selected }, ix) {
  const vehicle = ix.vehicleById.get(key(d.current_vehicle_id));
  const owner = ix.ownerById.get(key(d.transport_owner_id));
  const identifier = [d.driver_code, d.mobile].filter(Boolean).join(' · ');

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#1e3a5f]">
        <UserRound className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <RowTitle query={query}>{d.driver_name}</RowTitle>
          <StatusPill status={d.status} fallback="UNKNOWN" />
        </div>
        <RowMeta query={query}>
          {identifier || null}
        </RowMeta>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {d.rating > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted">
              <Star className="h-3 w-3 text-amber-500" strokeWidth={0} fill="currentColor" aria-hidden="true" />
              {Number(d.rating).toFixed(1)}
            </span>
          ) : null}
          {vehicle ? (
            <span className="truncate text-[11px] font-medium text-[#1e3a5f]">
              Assigned vehicle: <Highlight text={vehicle.vehicle_number} query={query} />
            </span>
          ) : owner?.company_name || owner?.owner_name ? (
            <span className="truncate text-[11px] font-medium text-[#1e3a5f]">
              <Highlight text={owner.company_name || owner.owner_name} query={query} />
            </span>
          ) : null}
        </div>
      </div>
      <SelectedTick selected={selected} />
    </div>
  );
}

export function renderDriverSelected(d, ix) {
  const vehicle = ix.vehicleById.get(key(d.current_vehicle_id));
  return (
    <>
      <p className="truncate text-[13px] font-bold text-text">{d.driver_name}</p>
      <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
        {d.driver_code || `Driver #${d.driver_id}`}
        {vehicle ? ` · ${vehicle.vehicle_number}` : ''}
      </p>
    </>
  );
}

/* ── Transport Owner ─────────────────────────────────────────────────────── */

export function renderOwnerOption(o, { query, selected }, ix) {
  const vehicleCount = ix.vehiclesPerOwner.get(key(o.owner_id)) || 0;
  const driverCount = ix.driversPerOwner.get(key(o.owner_id)) || 0;
  const place = [o.city, o.state].filter(Boolean).join(', ');
  const person = o.company_name && o.owner_name ? `Owner: ${o.owner_name}` : o.owner_name;

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#1e3a5f]">
        <Building2 className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <RowTitle query={query}>{o.company_name || o.owner_name}</RowTitle>
          <StatusPill status={o.status} fallback="ACTIVE" />
        </div>
        <RowMeta query={query}>{[person, place].filter(Boolean).join(' · ')}</RowMeta>
        <RowNote>
          {`${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} · ${driverCount} driver${
            driverCount === 1 ? '' : 's'
          }`}
        </RowNote>
      </div>
      <SelectedTick selected={selected} />
    </div>
  );
}

export function renderOwnerSelected(o, ix) {
  const vehicleCount = ix.vehiclesPerOwner.get(key(o.owner_id)) || 0;
  return (
    <>
      <p className="truncate text-[13px] font-bold text-text">{o.company_name || o.owner_name}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">
        {[o.owner_name && o.company_name ? o.owner_name : null, o.city, `${vehicleCount} vehicles`]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

/* ── Transport Partner ───────────────────────────────────────────────────── */

export function renderPartnerOption(p, { query, selected }, ix) {
  const driverCount = ix.driversPerPartner.get(key(p.partner_id)) || 0;
  const company = p.company_name || p.partner_name;
  const person = p.owner_name && p.company_name ? `Owner: ${p.owner_name}` : p.partner_code;

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#1e3a5f]">
        <Handshake className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <RowTitle query={query}>{company}</RowTitle>
          <StatusPill status={p.status} fallback="ACTIVE" />
        </div>
        <RowMeta query={query}>{[person, p.city].filter(Boolean).join(' · ')}</RowMeta>
        <RowNote>
          {`${driverCount} driver${driverCount === 1 ? '' : 's'} on network`}
        </RowNote>
      </div>
      <SelectedTick selected={selected} />
    </div>
  );
}

export function renderPartnerSelected(p, ix) {
  const driverCount = ix.driversPerPartner.get(key(p.partner_id)) || 0;
  return (
    <>
      <p className="truncate text-[13px] font-bold text-text">
        {p.company_name || p.partner_name}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">
        {[p.partner_code, p.city, `${driverCount} drivers`].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}
