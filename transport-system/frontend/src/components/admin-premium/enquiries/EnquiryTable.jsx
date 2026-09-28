/**
 * EnquiryTable.jsx
 * ---------------------------------------------------------------------------
 * The operational enquiry table for /admin/enquiries.
 *
 * COLUMN PRIORITY (what an operator scans first)
 *   Request → Route → Vehicle → Goods → Distance → Quote → Driver → Status → Action
 *
 * RESPONSIVE STRATEGY
 *   ≥ lg  : dense enterprise table (scrolls inside its own container only)
 *   < lg  : stacked record cards — the page never forces horizontal scrolling
 *
 * Every cell is read from the real booking row returned by
 * GET /api/admin/bookings. No cell is invented or hardcoded.
 */

import React from 'react';
import { ArrowRight, Route as RouteIcon, Truck } from 'lucide-react';
import EnquiryStatusBadge from './EnquiryStatusBadge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './EnquiryUI';
import {
  assignedDriverName,
  assignedVehicleNumber,
  bookingRef,
  customerName,
  fmtDate,
  fmtDateShort,
  goodsLabel,
  inr,
  weightLabel,
} from './enquiryStatus';

/* ── cell fragments ─────────────────────────────────────────────────────── */

function RouteCell({ booking }) {
  const from = booking.pickup_city || booking.pickup_location || '—';
  const to = booking.drop_city || booking.drop_location || '—';
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium text-text" title={from}>
        {from}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
      <span className="truncate font-medium text-text" title={to}>
        {to}
      </span>
    </div>
  );
}

function VehicleCell({ booking }) {
  const assigned = assignedVehicleNumber(booking);
  return (
    <div className="min-w-0">
      <div className="truncate text-[12.5px] font-medium text-text" title={booking.vehicle_type_required}>
        {booking.vehicle_type_required || '—'}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
        <Truck className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {assigned ? <span className="truncate">{assigned}</span> : <span>Not assigned</span>}
      </div>
    </div>
  );
}

function QuoteCell({ booking }) {
  const estimated = inr(booking.estimated_price);
  const final = Number(booking.final_price) > 0 ? inr(booking.final_price) : null;
  return (
    <div className="whitespace-nowrap">
      <div className="text-[12.5px] font-semibold text-text">{estimated}</div>
      {final ? (
        <div className="mt-0.5 text-[11px] font-semibold text-emerald-600">Final {final}</div>
      ) : (
        <div className="mt-0.5 text-[11px] text-muted">No final quote</div>
      )}
    </div>
  );
}

function DriverCell({ booking }) {
  const name = assignedDriverName(booking);
  return name ? (
    <div className="min-w-0">
      <div className="truncate text-[12.5px] font-medium text-text" title={name}>
        {name}
      </div>
      {booking.mobile_snapshot ? (
        <div className="truncate text-[11px] text-muted">{booking.mobile_snapshot}</div>
      ) : null}
    </div>
  ) : (
    <span className="text-[12.5px] text-muted">Not assigned</span>
  );
}

/* ── table ──────────────────────────────────────────────────────────────── */

function DesktopTable({ rows, onOpen }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border bg-slate-50/80">
              {['Request', 'Route', 'Vehicle', 'Goods', 'Distance', 'Quote', 'Driver', 'Status', ''].map((h) => (
                <th
                  key={h || 'action'}
                  scope="col"
                  className="px-3 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-muted"
                >
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.booking_id}
                className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-amber-50/30"
              >
                <td className="px-3 py-2.5 align-top">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    className="block max-w-[13rem] truncate text-left font-mono text-[12px] font-bold text-[#1e3a5f] hover:text-amber-600 hover:underline"
                    title={bookingRef(b)}
                  >
                    {bookingRef(b)}
                  </button>
                  <div className="mt-0.5 max-w-[13rem] truncate text-[12.5px] font-medium text-text">
                    {customerName(b)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {b.customer_phone || '—'} · {fmtDate(b.created_at)}
                  </div>
                </td>

                <td className="max-w-[12rem] px-3 py-2.5 align-top">
                  <RouteCell booking={b} />
                </td>

                <td className="max-w-[9rem] px-3 py-2.5 align-top">
                  <VehicleCell booking={b} />
                </td>

                <td className="max-w-[10rem] px-3 py-2.5 align-top">
                  <div className="truncate text-[12.5px] text-text" title={goodsLabel(b)}>
                    {goodsLabel(b)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">{weightLabel(b)}</div>
                </td>

                <td className="whitespace-nowrap px-3 py-2.5 align-top text-[12.5px] text-text">
                  {Number(b.estimated_distance_km) > 0
                    ? `${Number(b.estimated_distance_km).toLocaleString('en-IN')} km`
                    : '—'}
                </td>

                <td className="px-3 py-2.5 align-top">
                  <QuoteCell booking={b} />
                </td>

                <td className="max-w-[9rem] px-3 py-2.5 align-top">
                  <DriverCell booking={b} />
                </td>

                <td className="px-3 py-2.5 align-top">
                  <EnquiryStatusBadge booking={b} />
                </td>

                <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-amber-600"
                  >
                    Open Enquiry
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCard({ booking, onOpen }) {
  return (
    <article className="rounded-xl border border-border bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] font-bold text-amber-600">{bookingRef(booking)}</p>
          <p className="mt-0.5 truncate text-[13.5px] font-semibold text-text">{customerName(booking)}</p>
          <p className="text-[11px] text-muted">
            {booking.customer_phone || '—'} · {fmtDate(booking.created_at)}
          </p>
        </div>
        <EnquiryStatusBadge booking={booking} />
      </div>

      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
        <RouteIcon className="h-3.5 w-3.5 shrink-0 text-[#1e3a5f]" strokeWidth={2} aria-hidden="true" />
        <span className="truncate text-[12.5px] font-medium text-text">
          {booking.pickup_city || booking.pickup_location || '—'}
        </span>
        <ArrowRight className="h-3 w-3 shrink-0 text-amber-500" strokeWidth={2.5} aria-hidden="true" />
        <span className="truncate text-[12.5px] font-medium text-text">
          {booking.drop_city || booking.drop_location || '—'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Vehicle</dt>
          <dd className="truncate text-text">{booking.vehicle_type_required || '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Goods</dt>
          <dd className="truncate text-text">{goodsLabel(booking)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Distance</dt>
          <dd className="text-text">
            {Number(booking.estimated_distance_km) > 0
              ? `${Number(booking.estimated_distance_km).toLocaleString('en-IN')} km`
              : '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Quote</dt>
          <dd className="truncate font-semibold text-text">{inr(booking.estimated_price)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Driver</dt>
          <dd className="truncate text-text">{assignedDriverName(booking) || 'Not assigned'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Pickup</dt>
          <dd className="text-text">{fmtDateShort(booking.pickup_date)}</dd>
        </div>
      </dl>

      {Number(booking.final_price) > 0 ? (
        <p className="mt-3 text-[12px] font-semibold text-emerald-600">
          Final quote {inr(booking.final_price)}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => onOpen(booking)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-600"
      >
        Open Enquiry
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </article>
  );
}

export default function EnquiryTable({ rows, loading, error, onOpen, onRetry, emptyTitle, emptySubtitle }) {
  if (error) return <ErrorBlock message={error} onRetry={onRetry} />;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-white p-4">
        <LoadingBlock label="Loading enquiries" rows={6} />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return <EmptyBlock title={emptyTitle} subtitle={emptySubtitle} />;
  }

  return (
    <>
      <div className="hidden lg:block">
        <DesktopTable rows={rows} onOpen={onOpen} />
      </div>
      <div className="space-y-2.5 lg:hidden">
        {rows.map((b) => (
          <MobileCard key={b.booking_id} booking={b} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}
