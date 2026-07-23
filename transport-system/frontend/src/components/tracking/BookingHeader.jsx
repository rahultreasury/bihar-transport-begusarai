import React from 'react';

const VEHICLE_ICONS = {
  truck: '🚛',
  mini_truck: '🛻',
  pickup: '🛺',
  tempo: '🚚',
  lorry: '🚛',
};

/**
 * BookingHeader — Displays confirmed booking summary at the top of tracking dashboard.
 * @param {{ booking: Object }} props
 */
const BookingHeader = React.memo(function BookingHeader({ booking }) {
  if (!booking) return null;

  const vehicleIcon = VEHICLE_ICONS[booking.vehicle_type_required] || '🚛';

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

  const paymentStatus = booking.final_price ? 'Paid' : 'Unpaid';

  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-5 md:p-7 text-white shadow-lg">
      {/* Confirmed Badge */}
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
          Booking Confirmed
        </span>
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
          <div className="text-amber-200 text-xs font-medium uppercase tracking-wider">Est. Cost</div>
          <div className="font-semibold mt-1 text-sm md:text-base">
            ₹{Number(booking.estimated_price || 0).toLocaleString('en-IN')}
          </div>
          <div className={`text-xs mt-0.5 ${paymentStatus === 'Paid' ? 'text-green-300' : 'text-amber-200'}`}>
            {paymentStatus}
          </div>
        </div>
      </div>
    </div>
  );
});

export default BookingHeader;

