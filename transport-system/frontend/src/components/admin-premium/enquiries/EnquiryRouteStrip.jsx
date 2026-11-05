/**
 * EnquiryRouteStrip.jsx
 * ---------------------------------------------------------------------------
 * The route / shipment visual for the enquiry workspace: PICKUP → DROP, with
 * the distance given real visual weight because it is the number an operator
 * actually plans capacity and freight around.
 *
 * EVERY VALUE COMES FROM `enquiry.route` / `enquiry.schedule` in the existing
 * admin DTO. Optional fields (addresses, coordinates, distance) are omitted
 * when the backend has not computed them — the card degrades instead of
 * showing a placeholder dash that reads like real data.
 */

import React from 'react';
import { MapPin, Navigation, Route as RouteIcon, CalendarClock } from 'lucide-react';
import { formatKm, formatLongDate, formatTime12 } from '../../../utils/enquiryFormat';

/** One end of the route. */
function Stop({ tone, label, place, address }) {
  const isPickup = tone === 'pickup';
  return (
    <div className="flex gap-3">
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border ${
            isPickup
              ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
              : 'border-amber-200 bg-amber-50 text-amber-600'
          }`}
        >
          {isPickup ? (
            <Navigation className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</p>
        <p className="mt-0.5 truncate text-[15px] font-bold leading-tight text-text">
          {place || '—'}
        </p>
        {address ? (
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{address}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {{route: object, schedule: object}} props
 */
export default function EnquiryRouteStrip({ route = {}, schedule = {} }) {
  const distance = formatKm(route.distance_km);
  const pickupDate = formatLongDate(schedule.pickup_date);
  const pickupTime = formatTime12(schedule.pickup_time);

  return (
    <section className="rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <RouteIcon className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" />
        <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.08em] text-text">
          Route
        </h2>
      </header>

      <div className="p-4">
        <div className="relative">
          {/* The connector between the two stops. */}
          <span
            className="absolute left-[13px] top-9 h-[calc(100%-3.5rem)] w-px bg-slate-200"
            aria-hidden="true"
          />
          <Stop
            tone="pickup"
            label="Pickup"
            place={route.pickup_location}
            address={route.pickup_address}
          />
          <Stop tone="drop" label="Drop" place={route.drop_location} address={route.drop_address} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {distance ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-2.5 py-1 text-[12.5px] font-bold text-white">
              <RouteIcon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              {distance}
            </span>
          ) : null}

          {pickupDate ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
              {pickupDate}
              {pickupTime ? ` · ${pickupTime}` : ''}
            </span>
          ) : null}

          {!distance && !pickupDate ? (
            <p className="text-[12px] text-muted">
              Distance and schedule are not on file for this enquiry yet.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
