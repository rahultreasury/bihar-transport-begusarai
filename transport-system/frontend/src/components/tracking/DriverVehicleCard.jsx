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

        {/* Driver contact actions — Call & WhatsApp */}
        {driverPhone && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={`tel:${String(driverPhone).replace(/[^0-9+]/g, '')}`}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call Driver
            </a>
            <a
              href={`https://wa.me/${String(driverPhone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                `Hello, I am a customer for booking ${booking.booking_reference || ''}.`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500 text-white font-semibold text-sm hover:bg-green-600 transition shadow-lg shadow-green-500/20 cursor-pointer"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp Driver
            </a>
          </div>
        )}

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
