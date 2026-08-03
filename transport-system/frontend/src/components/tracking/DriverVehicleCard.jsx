import React from 'react';

/**
 * DriverVehicleCard — Displays the confirmed driver + vehicle details
 * along with ETA and current status. Replaces the QuoteCard after acceptance.
 *
 * @param {{ booking: Object }} props
 */
const DriverVehicleCard = React.memo(function DriverVehicleCard({ booking }) {
if (!booking) return null;

  // Normalize driver/vehicle from either nested reservation or top-level fields.
  const reservation = booking.reservation || null;
  const driver = booking.driver || reservation?.driver || null;
  const vehicle = booking.vehicle || reservation?.vehicle || null;

  const driverName =
    driver?.driver_name ||
    `${driver?.first_name || ''} ${driver?.last_name || ''}`.trim() ||
    booking.snapshot_driver?.driver_name ||
    null;
  const driverPhone =
    driver?.mobile || driver?.phone || booking.snapshot_driver?.phone || null;
  const driverRating = driver?.rating ?? null;
  const driverInitial = driverName ? driverName.charAt(0).toUpperCase() : 'D';

  const vehicleNumber =
    booking.vehicle_number || vehicle?.vehicle_number || booking.snapshot_driver?.vehicle_number || '—';
  const vehicleType =
    booking.vehicle_type || vehicle?.vehicle_type || booking.snapshot_driver?.vehicle_type || booking.vehicle_type_required || '—';
  const vehicleName = booking.vehicle_name || vehicle?.vehicle_name || null;

  const eta = booking.estimated_delivery_time || booking.estimated_pickup_time || null;

  const formatEta = (ts) => {
    if (!ts) return 'Calculating…';
    try {
      return new Date(ts).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Calculating…';
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-sm font-bold uppercase tracking-wider">Booking Confirmed</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          {String(booking.status || 'confirmed').replace(/_/g, ' ')}
        </span>
      </div>

      <div className="p-5 md:p-6 space-y-5">
        {/* Driver */}
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
            {driverInitial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-gray-900 truncate">{driverName || 'Driver assigned'}</h4>
              {driverRating != null && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <svg className="h-3 w-3 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                  {driverRating}
                </span>
              )}
            </div>
            {driverPhone && (
              <div className="flex items-center gap-1.5 text-sm text-gray-600 mt-1">
                <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {driverPhone}
              </div>
            )}
          </div>
        </div>

        {/* Vehicle */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider">Vehicle</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-400">Vehicle Number</div>
              <div className="text-sm font-bold text-gray-900 font-mono">{vehicleNumber}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Vehicle Type</div>
              <div className="text-sm font-bold text-gray-900 capitalize">{vehicleType.replace(/_/g, ' ')}</div>
            </div>
            {vehicleName && (
              <div className="col-span-2">
                <div className="text-xs text-gray-400">Vehicle Name</div>
                <div className="text-sm font-semibold text-gray-900">{vehicleName}</div>
              </div>
            )}
          </div>
        </div>

        {/* ETA */}
        <div className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
          <span className="text-sm font-semibold text-amber-800">Estimated Delivery</span>
          <span className="text-sm font-bold text-amber-900">{formatEta(eta)}</span>
        </div>
      </div>
    </div>
  );
});

export default DriverVehicleCard;
