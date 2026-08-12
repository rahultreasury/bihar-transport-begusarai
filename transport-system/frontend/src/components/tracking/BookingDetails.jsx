import React from 'react';
import { normalizeQuoteStatus, normalizeStatus, isConfirmedStatus } from '../../utils/bookingUtils';

const VEHICLE_LABELS = {
  truck: 'Truck',
  mini_truck: 'Mini Truck',
  pickup: 'Pickup',
  tempo: 'Tempo',
  lorry: 'Lorry',
};

/**
 * BookingDetails — Displays all booking details in a structured card.
 * The final price is shown ONLY after the quote is accepted (confirmed).
 * Before acceptance, the price row shows "Finding best market price…".
 *
 * @param {{ booking: Object }} props
 */
const BookingDetails = React.memo(function BookingDetails({ booking }) {
  if (!booking) return null;

  const quoteStatus = normalizeQuoteStatus(booking.quote_status);
  const normalizedStatus = normalizeStatus(booking.status);
  const isConfirmed = quoteStatus === 'ACCEPTED' || isConfirmedStatus(normalizedStatus);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    try {
      const [h, m] = timeStr.split(':');
      const date = new Date();
      date.setHours(parseInt(h, 10), parseInt(m, 10));
      return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return timeStr;
    }
  };

  const details = [
    { label: 'Booking Number', value: booking.booking_reference || '—' },
    { label: 'Pickup Address', value: booking.pickup_address || booking.pickup_location || '—', fullWidth: true },
    { label: 'Drop Address', value: booking.drop_address || booking.drop_location || '—', fullWidth: true },
    { label: 'Pickup City', value: booking.pickup_city || '—' },
    { label: 'Drop City', value: booking.drop_city || '—' },
    { label: 'Pickup Date', value: formatDate(booking.pickup_date) },
    { label: 'Pickup Time', value: formatTime(booking.pickup_time) },
    {
      label: 'Vehicle',
      value: VEHICLE_LABELS[booking.vehicle_type_required] || booking.vehicle_type_required || '—',
    },
    {
      label: 'Distance',
      value: booking.estimated_distance_km
        ? `${Number(booking.estimated_distance_km).toLocaleString('en-IN')} km`
        : '—',
    },
    { label: 'Goods Type', value: booking.goods_type || '—' },
    {
      label: 'Weight',
      value: booking.goods_weight_kg
        ? `${Number(booking.goods_weight_kg).toLocaleString('en-IN')} kg`
        : '—',
    },
    { label: 'Items', value: booking.number_of_items || '—' },
    { label: 'Fragile', value: booking.fragile ? 'Yes' : 'No' },
  ];

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 md:p-6">
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
        Booking Details
      </h3>

      <dl className="divide-y divide-gray-50">
        {details.map((item, idx) => (
          <div
            key={idx}
            className={`py-3 flex ${item.fullWidth ? 'flex-col' : 'flex-col sm:flex-row sm:items-center'} gap-1 sm:gap-4`}
          >
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider shrink-0 w-32">
              {item.label}
            </dt>
            <dd className={`text-sm font-semibold text-gray-900 ${item.fullWidth ? '' : 'sm:ml-0'}`}>
              {item.value}
            </dd>
          </div>
        ))}

        {/* Price row — shows final price only after confirmation */}
        <div className="py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider shrink-0 w-32">
            Price
          </dt>
          <dd className="text-sm font-semibold text-gray-900 sm:ml-0">
            {isConfirmed && booking.final_price != null ? (
              `₹${Number(booking.final_price).toLocaleString('en-IN')}`
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                Finding best market price…
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
});

export default BookingDetails;
