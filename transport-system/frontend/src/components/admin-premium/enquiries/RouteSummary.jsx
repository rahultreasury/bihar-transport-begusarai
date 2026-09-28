/**
 * RouteSummary.jsx
 * ---------------------------------------------------------------------------
 * Route visualization for the enquiry workspace: PICKUP → DROP.
 *
 * MAP POLICY (no second provider, no broken map)
 *   The admin `bookings` table stores pickup/drop as city + address strings —
 *   it has NO latitude/longitude columns, and the existing Google Maps
 *   experience (components/enquiry/RouteMapExperience.jsx) is driven by the
 *   pre-booking `enquiries` payload's coordinates. So when coordinates are
 *   present they are rendered by the same Google provider; when they are not,
 *   this component shows an honest, professional route summary instead of an
 *   empty or grey map frame.
 */

import React from 'react';
import { MapPin, Navigation, Route as RouteIcon } from 'lucide-react';
import { fmtDistance } from './enquiryStatus';

function Stop({ kind, city, location, address, state, pincode }) {
  const isPickup = kind === 'pickup';
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
            isPickup ? 'bg-amber-500/10 text-amber-600' : 'bg-[#1e3a5f]/10 text-[#1e3a5f]'
          }`}
        >
          {isPickup ? (
            <Navigation className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          )}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          {isPickup ? 'Pickup' : 'Drop'}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[14px] font-bold text-text" title={city || location}>
        {city || location || '—'}
      </p>
      {location && location !== city ? (
        <p className="truncate text-[12px] text-muted" title={location}>
          {location}
        </p>
      ) : null}
      {address ? (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted" title={address}>
          {address}
        </p>
      ) : null}
      {state || pincode ? (
        <p className="mt-0.5 text-[11px] text-slate-400">
          {[state, pincode].filter(Boolean).join(' – ')}
        </p>
      ) : null}
    </div>
  );
}

export default function RouteSummary({ booking, hasCoordinates = false }) {
  const distance = fmtDistance(booking?.estimated_distance_km);

  return (
    <div className="rounded-lg border border-border bg-slate-50/70 p-3.5">
      <div className="flex items-center gap-3">
        <Stop
          kind="pickup"
          city={booking?.pickup_city}
          location={booking?.pickup_location}
          address={booking?.pickup_address}
          state={booking?.pickup_state}
          pincode={booking?.pickup_pincode}
        />

        {/* Connector */}
        <div className="flex w-16 shrink-0 flex-col items-center gap-1 sm:w-24">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Distance</span>
          <div className="flex w-full items-center gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span className="h-px flex-1 bg-gradient-to-r from-amber-400 to-[#1e3a5f]" />
            <RouteIcon className="h-3.5 w-3.5 shrink-0 text-[#1e3a5f]" strokeWidth={2.5} />
            <span className="h-px flex-1 bg-[#1e3a5f]/40" />
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1e3a5f]" />
          </div>
          <span className="whitespace-nowrap text-[12.5px] font-bold text-text">{distance}</span>
        </div>

        <Stop
          kind="drop"
          city={booking?.drop_city}
          location={booking?.drop_location}
          address={booking?.drop_address}
          state={booking?.drop_state}
          pincode={booking?.drop_pincode}
        />
      </div>

      <p className="mt-3 border-t border-border/70 pt-2.5 text-[11px] leading-relaxed text-muted">
        {hasCoordinates
          ? 'Route rendered from the coordinates stored with this request.'
          : 'This request stores pickup and drop as locations (no coordinates on record), so the route is shown as an operational summary rather than a map.'}
      </p>
    </div>
  );
}
