import React from 'react';
import QuoteStatusBadge from './QuoteStatusBadge';
import { normalizeQuoteStatus, normalizeStatus, isConfirmedStatus } from '../../utils/bookingUtils';

const VEHICLE_ICONS = {
  truck: '🚛',
  mini_truck: '🛻',
  pickup: '🛺',
  tempo: '🚚',
  lorry: '🚛',
};

/**
 * BookingHeader — Displays booking summary at the top of tracking dashboard.
 * Quote-aware: shows "Booking Received" while awaiting approval, and
 * "Booking Confirmed" only after the quote is accepted.
 *
 * @param {{ booking: Object }} props
 */
const BookingHeader = React.memo(function BookingHeader({ booking }) {
  if (!booking) return null;

const vehicleIcon = VEHICLE_ICONS[booking.vehicle_type_required] || '🚛';
  const quoteStatus = normalizeQuoteStatus(booking.quote_status);
  const normalizedStatus = normalizeStatus(booking.status);
  // SINGLE SOURCE OF TRUTH: a booking is only "confirmed" once the customer has
  // ACCEPTED the final quote. quote_status is authoritative; booking.status is
  // a derived mirror. Any downstream status (driver_assigned, in_transit, etc.)
  // also implies the quote was accepted.
  const isConfirmed =
    quoteStatus === 'ACCEPTED' ||
    isConfirmedStatus(normalizedStatus);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-5 md:p-7 text-white shadow-lg">
      {/* Status badge */}
      <div className="flex items-center gap-2 mb-4">
        {isConfirmed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
            Booking Confirmed
          </span>
        ) : (
          <QuoteStatusBadge quoteStatus={quoteStatus} size="sm" />
        )}
      </div>

      {/* Booking Number & Customer */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">
            {booking.booking_reference || '—'}
          </h2>
          <p className="text-amber-100 text-sm mt-1">
            {booking.customer_first_name
              ? `${booking.customer_first_name} ${booking.customer_last_name || ''}`
              : 'Customer'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-amber-100">Booking Date:</span>
          <span className="font-medium">{formatDate(booking.created_at)}</span>
        </div>
      </div>

      {/* Route, Vehicle, Cost */}
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3">
          <div className="text-amber-200 text-xs font-medium uppercase tracking-wider">Pickup</div>
          <div className="font-semibold mt-1 text-sm md:text-base truncate">
            {booking.pickup_city || '—'}
          </div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3">
          <div className="text-amber-200 text-xs font-medium uppercase tracking-wider">Drop</div>
          <div className="font-semibold mt-1 text-sm md:text-base truncate">
            {booking.drop_city || '—'}
          </div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3">
          <div className="text-amber-200 text-xs font-medium uppercase tracking-wider">Vehicle</div>
          <div className="font-semibold mt-1 text-sm md:text-base">
            {vehicleIcon} {booking.vehicle_type_required?.replace('_', ' ') || '—'}
          </div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm p-3">
          <div className="text-amber-200 text-xs font-medium uppercase tracking-wider">Cost</div>
          {booking.final_price != null ? (
            <div className="font-semibold mt-1 text-sm md:text-base">
              ₹{Number(booking.final_price).toLocaleString('en-IN')}
            </div>
          ) : (
            <div className="font-semibold mt-1 text-sm md:text-base">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-200 animate-pulse" />
                Confirming
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default BookingHeader;
