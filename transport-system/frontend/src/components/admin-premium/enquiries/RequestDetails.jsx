/**
 * RequestDetails.jsx
 * ---------------------------------------------------------------------------
 * Left column of the enquiry workspace: who the customer is and exactly what
 * they asked to move. Read-only — every value comes from the booking row
 * returned by GET /api/admin/bookings/by-number/:bookingNumber.
 */

import React from 'react';
import {
  Boxes,
  CalendarClock,
  Clock,
  IdCard,
  Mail,
  Phone,
  Scale,
  Truck,
  UserRound,
} from 'lucide-react';
import { FactGrid, InfoRow, Panel } from './EnquiryUI';
import { customerName, fmtDate, weightLabel } from './enquiryStatus';

export function CustomerPanel({ booking }) {
  return (
    <Panel title="Customer" icon={UserRound}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1e3a5f] text-[13px] font-bold text-white">
          {customerName(booking)
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || '—'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-text">{customerName(booking)}</p>
          <p className="truncate text-[11.5px] text-muted">
            {booking.customer_phone || 'No mobile on record'}
          </p>
        </div>
      </div>

      <div className="space-y-0">
        <InfoRow label="Name" value={customerName(booking)} icon={UserRound} />
        <InfoRow
          label="Mobile"
          value={
            booking.customer_phone ? (
              <a href={`tel:${booking.customer_phone}`} className="text-amber-700 hover:underline">
                {booking.customer_phone}
              </a>
            ) : null
          }
          icon={Phone}
          mono
        />
        <InfoRow
          label="Email"
          value={
            booking.customer_email ? (
              <a href={`mailto:${booking.customer_email}`} className="text-amber-700 hover:underline">
                {booking.customer_email}
              </a>
            ) : null
          }
          icon={Mail}
        />
        <InfoRow
          label="Customer type"
          value={booking.user_id ? 'Registered customer account' : 'Guest enquiry'}
          icon={IdCard}
        />
        {booking.customer_address ? <InfoRow label="Address" value={booking.customer_address} /> : null}
      </div>
    </Panel>
  );
}

export function TransportRequestPanel({ booking }) {
  const items = [
    { label: 'Distance', value: booking.estimated_distance_km ? `${Number(booking.estimated_distance_km).toLocaleString('en-IN')} km` : '—' },
    { label: 'Pickup date', value: fmtDate(booking.pickup_date), icon: CalendarClock },
    { label: 'Pickup time', value: booking.pickup_time || '—', icon: Clock },
    { label: 'Goods type', value: booking.goods_type || booking.goods_description || '—', icon: Boxes },
    { label: 'Weight', value: weightLabel(booking), icon: Scale },
    { label: 'Vehicle requested', value: booking.vehicle_type_required || '—', icon: Truck },
  ];

  return (
    <Panel title="Transport Request" icon={Boxes} subtitle="What the customer asked to move">
      <FactGrid items={items} columns={2} />
      {booking.number_of_items ? (
        <p className="mt-3 text-[12px] text-muted">
          Quantity: <span className="font-semibold text-text">{booking.number_of_items}</span>
          {booking.quantity_unit ? ` ${booking.quantity_unit}` : ''}
          {booking.goods_volume ? ` · Volume ${booking.goods_volume}` : ''}
        </p>
      ) : null}
      {booking.fragile ? (
        <p className="mt-2 inline-flex rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
          Fragile goods — handle with care
        </p>
      ) : null}
      {booking.special_instructions ? (
        <div className="mt-3 rounded-lg border border-border bg-slate-50 px-3 py-2.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Special instructions</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text">{booking.special_instructions}</p>
        </div>
      ) : null}
    </Panel>
  );
}

export default function RequestDetails({ booking }) {
  return (
    <div className="space-y-3">
      <CustomerPanel booking={booking} />
      <TransportRequestPanel booking={booking} />
    </div>
  );
}
