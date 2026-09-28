/**
 * CustomerQuotePreview.jsx
 * ---------------------------------------------------------------------------
 * "CUSTOMER VIEW" — what the customer will see once the quote is published.
 *
 * PREVIEW ONLY
 *   The Accept / Reject buttons are non-interactive visual affordances. The
 *   real customer decisions happen on the customer's own tracking page
 *   (POST /api/bookings/track/:reference/quote/accept | /reject) through the
 *   existing backend flow. No duplicate customer API is introduced here.
 *
 * Every value shown comes from the live booking row, so the preview can never
 * promise the customer something the backend has not stored.
 */

import React from 'react';
import { BadgeIndianRupee, CalendarClock, MapPin, Package, Truck } from 'lucide-react';
import { EmptyBlock } from './EnquiryUI';
import { assignedVehicleNumber, customerName, fmtDateTime, goodsLabel, inr } from './enquiryStatus';

export default function CustomerQuotePreview({ booking }) {
  if (!booking) return null;

  const finalPrice = Number(booking.final_price) > 0 ? inr(booking.final_price) : null;
  const route = `${booking.pickup_city || booking.pickup_location || '—'} → ${
    booking.drop_city || booking.drop_location || '—'
  }`;
  const vehicle = assignedVehicleNumber(booking) || booking.vehicle_type_required || 'To be confirmed';

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Branded header */}
      <div className="flex items-center justify-between gap-3 bg-[#1e3a5f] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-[11px] font-black text-white">
            BT
          </span>
          <span className="text-[13px] font-bold text-white">Bihar Transport</span>
        </div>
        <span className="font-mono text-[11px] text-white/60">
          {booking.booking_number || booking.booking_reference}
        </span>
      </div>

      <div className="bg-white p-4">
        <p className="text-[13.5px] font-semibold text-text">
          {finalPrice
            ? 'Your transport quote is ready.'
            : 'Your transport request is under review.'}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">Hello {customerName(booking)},</p>

        <dl className="mt-3 space-y-2.5">
          <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <MapPin className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Route
            </dt>
            <dd className="text-right text-[12.5px] font-semibold text-text">{route}</dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <Truck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Vehicle
            </dt>
            <dd className="text-right text-[12.5px] font-semibold text-text">{vehicle}</dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <Package className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Goods
            </dt>
            <dd className="text-right text-[12.5px] text-text">{goodsLabel(booking)}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <BadgeIndianRupee className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Final quote
            </dt>
            <dd className="text-right text-[15px] font-bold text-amber-600">{finalPrice || 'Awaiting quote'}</dd>
          </div>
        </dl>

        {booking.quote_valid_until ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] font-medium text-amber-800">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            Valid until {fmtDateTime(booking.quote_valid_until)}
          </p>
        ) : null}

        {booking.quote_remarks ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-slate-600">
            {booking.quote_remarks}
          </p>
        ) : null}

        {/* Visual affordance only — the real actions live on the customer page. */}
        <div className="mt-3.5 flex gap-2" aria-hidden="true">
          <span className="flex-1 rounded-lg bg-[#1e3a5f] px-3 py-2 text-center text-[12.5px] font-bold text-white">
            Accept Quote
          </span>
          <span className="flex-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-center text-[12.5px] font-bold text-rose-700">
            Reject Quote
          </span>
        </div>

        {!finalPrice ? (
          <div className="mt-3">
            <EmptyBlock
              title="No quote published yet"
              subtitle="The Accept / Reject options appear here once a final quote is sent."
            />
          </div>
        ) : null}

        <p className="mt-3 text-[10.5px] leading-relaxed text-muted">
          Preview only. The customer accepts or rejects on their own tracking page — that is where the
          existing backend updates the real status.
        </p>
      </div>
    </div>
  );
}
