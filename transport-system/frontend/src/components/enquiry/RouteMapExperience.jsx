/**
 * RouteMapExperience.jsx
 * ---------------------------------------------------------------------------
 * The hero of the enquiry confirmation page: a large, premium Google Map that
 * shows the customer's real route while Bihar Transport looks for a truck.
 *
 * REAL DATA ONLY
 *   • Pickup/drop coordinates come from the enquiry payload the API already
 *     returns (`route.pickup_latitude` / `pickup_longitude`, …). Nothing is
 *     geocoded here — if the backend has coordinates, they are used; if it does
 *     not, the component renders a branded route card instead of inventing a map.
 *   • The road line is a genuine `google.maps.DirectionsService` result, the
 *     same API the booking page already uses. If Directions fails we fall back
 *     to a straight line between the two REAL coordinates — never a fabricated
 *     road network.
 *   • Distance prefers the value the backend calculated for this enquiry and
 *     only falls back to Google's leg distance.
 *
 * NO FAKE GPS
 *   Nothing on this map is presented as a live vehicle position. While the team
 *   is genuinely searching, a radar pulse expands over the PICKUP AREA — the
 *   place a truck would actually be found — and a truck chip pulses on the spot.
 *   As soon as the server reports an assignment, the radar stops and the chip
 *   becomes a confirmed check.
 *
 * PERFORMANCE
 *   Animation is CSS transform/opacity on a handful of DOM nodes placed in a
 *   map overlay pane. The map itself is never re-rendered by the animation, and
 *   the route-draw effect uses one 60ms interval that stops as soon as the draw
 *   completes. `prefers-reduced-motion` collapses all of it to a static state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GoogleMap, MarkerF, PolylineF } from '@react-google-maps/api';
import { useGoogleMapsApi } from '../../services/googleMapsLoader';
import { Check, MapPin, Radio, Route as RouteIcon, Truck, XCircle } from 'lucide-react';
import { formatKm } from '../../utils/enquiryFormat';

/* ── Brand palette ────────────────────────────────────────────────────────
   Single place so the map, the pins and the overlay can never drift apart. */
const NAVY = '#172B4D';
const NAVY_SOFT = 'rgba(23,43,77,0.22)';
const ORANGE = '#F5A623';
const GREEN = '#10B981';

/**
 * A restrained, premium basemap style: Google chrome quieted to near-neutral
 * greys so the navy route and the orange action colour own the composition.
 */
const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#eef1f5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5b6b82' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f6f9' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e3e8ef' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e2e7ee' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6e2ef' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d3dae4' }] },
];

/* ── Markers ─────────────────────────────────────────────────────────────
   Inline SVG pins rather than Google's default teardrop, so the pickup/drop
   pair reads as Bihar Transport branding instead of a stock map pin. */
function pinDataUri({ fill, glyph }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
    <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#0b1b33" flood-opacity="0.35"/>
    </filter>
    <path filter="url(#s)" d="M17 0.6C7.8 0.6 0.6 7.8 0.6 17c0 11.6 14.6 25.7 15.3 26.4a1.7 1.7 0 0 0 2.2 0c.7-.7 15.3-14.8 15.3-26.4C33.4 7.8 26.2 0.6 17 0.6Z" fill="${fill}" stroke="#fff" stroke-width="2.4"/>
    ${glyph}
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const PICKUP_PIN = pinDataUri({
  fill: ORANGE,
  glyph:
    '<circle cx="17" cy="17" r="8" fill="#fff"/>' +
    '<circle cx="17" cy="17" r="3.4" fill="#172B4D"/>',
});

const DROP_PIN = pinDataUri({
  fill: NAVY,
  glyph:
    '<path d="M12.4 12.4h2.1v7.2h4.4v2.1h-6.5z" fill="#fff"/>' +
    '<circle cx="17" cy="17" r="8" fill="none" stroke="#fff" stroke-width="1.6" opacity="0.65"/>',
});

/* ── Path maths (pure, no Google objects required) ─────────────────────── */
const toLiteral = (p) => (p && typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : p);

/** Cumulative approximate distance along a polyline, in degrees-ish units. */
function cumulativeDistances(path) {
  const cum = new Float64Array(path.length);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const dx = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const dy = b.lat - a.lat;
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  return cum;
}

/**
 * Slice a polyline at fraction `t` of its total length, interpolating the cut
 * point. This is what produces the "route draws itself" reveal without asking
 * the Maps API to animate anything.
 */
function slicePath(path, cum, t) {
  if (t >= 1 || path.length < 2) return path;
  const total = cum[cum.length - 1] || 1;
  const target = total * t;
  let i = 1;
  while (i < cum.length && cum[i] < target) i += 1;
  if (i >= cum.length) return path;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg));
  const a = path[i - 1];
  const b = path[i];
  return path.slice(0, i).concat({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
}

/** Midpoint of a polyline by length — used to centre the map. */
function midpointOf(path) {
  if (!path || path.length === 0) return null;
  if (path.length < 3) return { lat: (path[0].lat + path[1].lat) / 2, lng: (path[0].lng + path[1].lng) / 2 };
  const cum = cumulativeDistances(path);
  const target = cum[cum.length - 1] / 2;
  let i = 1;
  while (i < cum.length && cum[i] < target) i += 1;
  return path[i] || path[path.length - 1];
}

/* ── Anchoring DOM to a coordinate ────────────────────────────────────────
   The radar + truck chip are ordinary DOM that must sit exactly on the pickup
   point, and the only projection that is guaranteed to exist is the one handed
   to a `google.maps.OverlayView` (`Map.getProjection()` does not expose the
   canvas projection methods on every renderer). So we mount our own overlay,
   let the Maps API call `draw()` whenever the viewport changes, and move a
   single node with one transform write.

   Cost: no React re-render while panning, no map re-render, one style write per
   frame at most — the animation itself is pure CSS on the node's children. */
function MapAnchor({ map, position, children }) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    if (!map || !position || !window.google?.maps) return undefined;

    const google = window.google;
    const node = document.createElement('div');
    node.style.position = 'absolute';
    node.style.left = '0';
    node.style.top = '0';
    // A 1px anchor box: the children are absolutely positioned from it, and
    // `w-max` on the chip makes it size to its own content regardless.
    node.style.width = '1px';
    node.style.height = '1px';
    node.style.pointerEvents = 'none';
    node.style.willChange = 'transform';
    setContainer(node);

    const Overlay = class extends google.maps.OverlayView {
      onAdd() {
        this.getPanes()?.overlayMouseTarget?.appendChild(node);
      }

      draw() {
        const projection = this.getProjection();
        if (!projection) return;
        const pt = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(position.lat, position.lng)
        );
        node.style.transform = `translate3d(${pt.x}px, ${pt.y}px, 0)`;
      }

      onRemove() {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    };

    const overlay = new Overlay();
    overlay.setMap(map);

    return () => {
      overlay.setMap(null);
      if (node.parentNode) node.parentNode.removeChild(node);
      setContainer(null);
    };
  }, [map, position?.lat, position?.lng]);

  return container ? createPortal(children, container) : null;
}

/* ── Small presentational pieces ────────────────────────────────────────── */

/** The live "we are looking for a truck" pulse, drawn over the pickup area. */
function SearchPulse({ searching, found }) {
  if (searching) {
    return (
      <div className="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          /* Centred with negative margins, NOT a transform: the radar
             animation itself owns the `transform` property, and a
             translate utility here would be overwritten by it. */
          <span
            key={i}
            className="btb-radar-ring absolute left-0 top-0 -m-16 h-32 w-32 rounded-full border-2 border-[#F5A623]"
            style={{ animationDelay: `${i * 0.85}s` }}
          />
        ))}
      </div>
    );
  }

  if (found) {
    return (
      <div className="pointer-events-none absolute left-0 top-0 h-0 w-0" aria-hidden="true">
        <span className="absolute left-0 top-0 -m-8 h-16 w-16 rounded-full bg-emerald-500/15" />
      </div>
    );
  }

  return null;
}

/** The truck chip. Pulsing while searching, a confirmed check once assigned. */
function TruckChip({ searching, found, assignedLabel }) {
  if (found) {
    return (
      <div className="absolute left-0 top-0 w-max -translate-x-1/2 -translate-y-[135%]">
        <div className="btb-rise flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[0_6px_16px_-4px_rgba(16,185,129,0.7)]">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
          {assignedLabel || 'Vehicle assigned'}
        </div>
      </div>
    );
  }

  return (
    // `w-max` is required, not cosmetic: this sits inside a zero-width anchor,
    // and an absolutely positioned child would otherwise shrink-to-fit against
    // a 0px containing block and collapse to nothing.
    <div className="absolute left-0 top-0 w-max -translate-x-1/2 -translate-y-[135%]">
      <div className="btb-truck-hover flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#172B4D] shadow-[0_6px_18px_-6px_rgba(11,27,51,0.45)] ring-1 ring-[#172B4D]/10">
        <span className="relative flex h-4 w-4 items-center justify-center">
          <span className="btb-halo absolute inset-0 rounded-full bg-[#F5A623]/40" />
          <Truck className="relative h-3.5 w-3.5 text-[#F5A623]" aria-hidden="true" />
        </span>
        {searching ? 'Searching available vehicles' : 'Vehicle on the way'}
      </div>
    </div>
  );
}

/**
 * The floating status card that sits over the bottom of the map.
 * Glass + subtle shadow, exactly as a modern ride-hailing app presents it.
 */
function MapStatusCard({ stage, searching, connected, distanceLabel }) {
  const tone =
    stage.tone === 'closed'
      ? { chip: 'bg-red-50 text-red-700', dot: 'bg-red-500', bar: null }
      : stage.tone === 'found' || stage.tone === 'confirmed'
      ? { chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', bar: null }
      : stage.tone === 'quote'
      ? { chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500', bar: null }
      : { chip: 'bg-[#F5A623]/12 text-[#B26A00]', dot: 'bg-[#F5A623]', bar: 'bg-[#F5A623]' };

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-6 z-20 sm:inset-x-5 sm:bottom-7">
      <div className="rounded-2xl border border-white/60 bg-white/95 p-3.5 shadow-[0_18px_40px_-18px_rgba(11,27,51,0.55)] backdrop-blur-md sm:p-4">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              searching ? 'bg-[#F5A623]/15 text-[#B26A00]' : tone.chip
            }`}
          >
            {searching ? (
              <Radio className="btb-accent-pulse h-[18px] w-[18px] rounded-full" aria-hidden="true" />
            ) : stage.tone === 'closed' ? (
              <XCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Check className="h-[18px] w-[18px]" strokeWidth={2.6} aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-bold leading-tight text-[#172B4D]">
                {searching ? 'Finding the right truck for you' : stage.headline}
              </span>
              {connected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{stage.detail}</p>

            {distanceLabel && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#172B4D]/60">
                <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {distanceLabel}
              </p>
            )}
          </div>
        </div>

        {/* Indeterminate "still working" bar. Purely a pulse of reassurance —
            it is not a progress bar and never claims a percentage. */}
        {searching && tone.bar && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#172B4D]/8">
            <div className="btb-sweep relative h-full w-full overflow-hidden rounded-full">
              <div className={`h-full w-1/3 rounded-full ${tone.bar}`} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Branded fallback shown when the Google Maps script is unavailable (no key,
 * blocked by the network, or the enquiry has no coordinates yet).
 * It is deliberately NOT a fake map — it is an honest route summary.
 */
function RouteFallbackCard({ route, distanceLabel }) {
  return (
    <div className="relative flex h-[400px] flex-col justify-between overflow-hidden bg-[#E9EEF4] p-5 sm:h-[500px]">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(23,43,77,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(23,43,77,0.06) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div className="relative flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#172B4D]">
          <Truck className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <span className="text-[13px] font-bold tracking-tight text-[#172B4D]">Bihar Transport</span>
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <div className="flex w-full max-w-xs items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#F5A623] bg-white" />
            <span className="h-full w-0.5 flex-1 border-l-2 border-dashed border-[#172B4D]/25" />
          </div>
          <div className="flex-1 space-y-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#172B4D]/45">Pickup</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#172B4D]/45">Drop</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#172B4D]">
              <MapPin className="h-2.5 w-2.5 text-white" aria-hidden="true" />
            </span>
            <span className="h-full w-0.5 flex-1 border-l-2 border-dashed border-[#172B4D]/25" />
          </div>
        </div>
      </div>

      <div className="relative rounded-2xl border border-white/70 bg-white/90 p-4 shadow-[0_18px_40px_-22px_rgba(11,27,51,0.5)]">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#172B4D]/45">Your route</p>
        <p className="mt-1.5 text-[15px] font-bold leading-snug text-[#172B4D]">
          {route?.pickup_location || 'Pickup'}
          <span className="mx-1.5 text-[#F5A623]">→</span>
          {route?.drop_location || 'Drop'}
        </p>
        {distanceLabel && (
          <p className="mt-1 text-xs text-slate-500">Approx. route distance {distanceLabel}</p>
        )}
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */
export default function RouteMapExperience({
  route,
  stage,
  searching = true,
  connected = false,
  assignedLabel,
  className = '',
}) {
  const { isLoaded, loadError, hasApiKey } = useGoogleMapsApi();

  const [directionsRoute, setDirectionsRoute] = useState(null);
  const [drawProgress, setDrawProgress] = useState(0);
  const [map, setMap] = useState(null);
  const fittedRef = useRef(false);

  /* ── Coordinates, straight from the enquiry payload ── */
  const pickup = useMemo(() => {
    const lat = Number(route?.pickup_latitude);
    const lng = Number(route?.pickup_longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [route?.pickup_latitude, route?.pickup_longitude]);

  const drop = useMemo(() => {
    const lat = Number(route?.drop_latitude);
    const lng = Number(route?.drop_longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [route?.drop_latitude, route?.drop_longitude]);

  const hasCoordinates = Boolean(pickup && drop);
  const pickupKey = pickup ? `${pickup.lat},${pickup.lng}` : '';
  const dropKey = drop ? `${drop.lat},${drop.lng}` : '';

  /* ── The road line: a real DirectionsService result ── */
  useEffect(() => {
    if (!isLoaded || !pickup || !drop) return undefined;

    let cancelled = false;
    setDirectionsRoute(null);

    try {
      const service = new window.google.maps.DirectionsService();
      service
        .route(
          {
            origin: pickup,
            destination: drop,
            travelMode: window.google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: false,
          },
          (result, status) => {
            if (cancelled) return;
            if (status === window.google.maps.DirectionsStatus.OK && result?.routes?.[0]) {
              setDirectionsRoute(result.routes[0]);
            } else {
              // ZERO / NOT_FOUND / OVER_QUERY_LIMIT → straight line between the
              // two real coordinates. Honest, and never blocks the page.
              setDirectionsRoute(null);
            }
          }
        )
        .catch(() => {
          if (!cancelled) setDirectionsRoute(null);
        });
    } catch {
      if (!cancelled) setDirectionsRoute(null);
    }

    return () => {
      cancelled = true;
    };
  }, [isLoaded, pickupKey, dropKey, pickup, drop]);

  /* ── Route draw-in: one short interval, then it stops for good ── */
  const overviewPath = useMemo(() => {
    const raw = directionsRoute?.overview_path;
    if (raw && raw.length > 1) return Array.from(raw, toLiteral);
    // Straight line between the two real coordinates.
    return pickup && drop ? [pickup, drop] : null;
  }, [directionsRoute, pickup, drop]);

  useEffect(() => {
    if (!overviewPath || overviewPath.length < 2) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setDrawProgress(1);
      return undefined;
    }
    setDrawProgress(0);
    const started = Date.now();
    const duration = 1500;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / duration);
      setDrawProgress(t);
      if (t >= 1) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [overviewPath]);

  const cum = useMemo(
    () => (overviewPath ? cumulativeDistances(overviewPath) : null),
    [overviewPath]
  );
  const drawnPath = useMemo(
    () => (overviewPath && cum ? slicePath(overviewPath, cum, drawProgress) : null),
    [overviewPath, cum, drawProgress]
  );

  /* ── Distance: the backend's own figure wins ── */
  const distanceLabel = useMemo(() => {
    if (route?.distance_km != null) return formatKm(route.distance_km);
    const legDistance = directionsRoute?.legs?.[0]?.distance?.value;
    if (typeof legDistance === 'number' && Number.isFinite(legDistance)) {
      return formatKm(legDistance / 1000);
    }
    return '';
  }, [route?.distance_km, directionsRoute]);

  /* ── Fit the viewport to the route exactly once ── */
  const onLoad = useCallback(
    (mapInstance) => {
      setMap(mapInstance);
      const bounds = new window.google.maps.LatLngBounds();
      if (pickup) bounds.extend(pickup);
      if (drop) bounds.extend(drop);
      if (overviewPath && overviewPath.length) {
        overviewPath.forEach((p) => bounds.extend(p));
      }
      // Padding leaves room for the floating status card at the bottom.
      mapInstance.fitBounds(bounds, { top: 70, right: 70, bottom: 190, left: 70 });
    },
    [pickup, drop, overviewPath]
  );

  // Refit when the route arrives a moment after the map (the common case).
  useEffect(() => {
    if (!map || fittedRef.current || !overviewPath || !window.google?.maps) return;
    fittedRef.current = true;
    const bounds = new window.google.maps.LatLngBounds();
    if (pickup) bounds.extend(pickup);
    if (drop) bounds.extend(drop);
    overviewPath.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { top: 70, right: 70, bottom: 190, left: 70 });
  }, [map, overviewPath, pickup, drop]);

  const center = useMemo(() => midpointOf(overviewPath) || pickup || drop, [overviewPath, pickup, drop]);

  const mapReady = hasApiKey && isLoaded && !loadError && hasCoordinates && center;

  /* ── Marker label offset (needs the loaded google namespace) ──
     Labels sit BELOW the pin so the "searching" chip above the pickup marker
     has clear space and the two never collide. */
  const labelOffset = useMemo(() => {
    if (!isLoaded || !window.google?.maps) return undefined;
    return new window.google.maps.LatLng(0, 30);
  }, [isLoaded]);

  const pinAnchor = useMemo(() => {
    if (!isLoaded || !window.google?.maps) return undefined;
    return new window.google.maps.Point(17, 45);
  }, [isLoaded]);

  const showMap = mapReady;

  return (
    <section
      className={`relative overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-30px_rgba(11,27,51,0.45),0_2px_6px_rgba(11,27,51,0.06)] ring-1 ring-[#172B4D]/8 ${className}`}
      aria-label="Live route map"
    >
      <div className="relative h-[400px] w-full sm:h-[460px] lg:h-[520px]">
        {showMap ? (
          <GoogleMap
            mapContainerClassName="h-full w-full"
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={center}
            zoom={6}
            onLoad={onLoad}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              clickableIcons: false,
              streetViewControl: false,
              fullscreenControl: false,
              mapTypeControl: false,
              gestureHandling: 'cooperative',
              backgroundColor: '#E9EEF4',
              styles: MAP_STYLES,
              // Zoom sits mid-right so it never collides with the brand chip
              // (top-left), the route summary (top-right) or the floating
              // status card (bottom).
              ...(window.google?.maps?.ControlPosition
                ? { zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_CENTER } }
                : {}),
            }}
          >
            {/* The planned route: a quiet navy guide line. */}
            {overviewPath && (
              <PolylineF
                path={overviewPath}
                options={{
                  strokeColor: NAVY_SOFT,
                  strokeOpacity: 1,
                  strokeWeight: 5,
                  clickable: false,
                  zIndex: 1,
                }}
              />
            )}

            {/* The drawn portion: brand orange, revealed left → right. */}
            {drawnPath && drawnPath.length > 1 && (
              <PolylineF
                path={drawnPath}
                options={{
                  strokeColor: ORANGE,
                  strokeOpacity: 1,
                  strokeWeight: 5,
                  clickable: false,
                  zIndex: 2,
                }}
              />
            )}

            {pickup && (
              <MarkerF
                position={pickup}
                icon={{ url: PICKUP_PIN, anchor: pinAnchor, scaledSize: { width: 34, height: 46 } }}
                label={
                  labelOffset
                    ? { text: 'Pickup', className: 'btb-map-label', position: labelOffset }
                    : undefined
                }
                zIndex={30}
                title={route?.pickup_location || 'Pickup'}
              />
            )}

            {drop && (
              <MarkerF
                position={drop}
                icon={{ url: DROP_PIN, anchor: pinAnchor, scaledSize: { width: 34, height: 46 } }}
                label={
                  labelOffset
                    ? { text: 'Drop', className: 'btb-map-label btb-map-label--drop', position: labelOffset }
                    : undefined
                }
                zIndex={30}
                title={route?.drop_location || 'Drop'}
              />
            )}

            {/* Radar + truck, anchored to the pickup area — where a vehicle for
                this route would actually be found. Never a GPS position. */}
          </GoogleMap>
        ) : (
          <RouteFallbackCard route={route} distanceLabel={distanceLabel} />
        )}

        {/* The search pulse + truck chip, anchored to the pickup point inside
            the map's own overlay pane. */}
        {showMap && pickup && (searching || stage.tone === 'found') && (
          <MapAnchor map={map} position={pickup}>
            <div className="pointer-events-none absolute left-0 top-0" aria-hidden="true">
              <SearchPulse searching={searching} found={stage.tone === 'found'} />
              <TruckChip
                searching={searching}
                found={stage.tone === 'found'}
                assignedLabel={assignedLabel}
              />
            </div>
          </MapAnchor>
        )}

        {/* Bihar Transport branding on the map itself. */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 sm:left-4 sm:top-4">
          <span className="flex items-center gap-1.5 rounded-full bg-white/92 px-2.5 py-1.5 text-[11px] font-bold tracking-tight text-[#172B4D] shadow-[0_6px_18px_-8px_rgba(11,27,51,0.5)] ring-1 ring-[#172B4D]/5 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-[#F5A623]" />
            Bihar Transport
          </span>
          {hasCoordinates && !showMap && (
            <span className="rounded-full bg-white/92 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-[#172B4D]/5 backdrop-blur">
              Map loading…
            </span>
          )}
        </div>

        {/* Pickup → drop summary strip, top right. */}
        {hasCoordinates && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 hidden max-w-[46%] sm:right-4 sm:top-4 sm:block">
            <div className="rounded-2xl bg-white/92 px-3 py-2 text-right shadow-[0_6px_18px_-8px_rgba(11,27,51,0.5)] ring-1 ring-[#172B4D]/5 backdrop-blur">
              <p className="truncate text-[12px] font-bold text-[#172B4D]">
                {route?.pickup_location || 'Pickup'}
                <span className="mx-1.5 text-[#F5A623]">→</span>
                {route?.drop_location || 'Drop'}
              </p>
              {distanceLabel && (
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{distanceLabel}</p>
              )}
            </div>
          </div>
        )}

        <MapStatusCard
          stage={stage}
          searching={searching}
          connected={connected}
          distanceLabel={distanceLabel}
        />
      </div>
    </section>
  );
}
