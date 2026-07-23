/**
 * RouteCard — Displays a transport route with pricing estimate
 */
import { Link } from 'react-router-dom';

export default function RouteCard({ route }) {
  const estimatedCost = (route.distanceKm * 14).toLocaleString(); // avg ₹14/km
  const slug = `${route.from.toLowerCase()}-to-${route.to.toLowerCase()}`.replace(/\s+/g, '-');
  const fromSlug = route.from.toLowerCase().replace(/\s+/g, '-');
  const toSlug = route.to.toLowerCase().replace(/\s+/g, '-');

  return (
    <Link
      to={`/routes/${fromSlug}-to-${toSlug}`}
      className="card group hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
      aria-label={`Transport from ${route.from} to ${route.to}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900">{route.from}</span>
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="font-semibold text-gray-900">{route.to}</span>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {route.fromState} → {route.toState}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500">
          <span className="font-medium text-gray-700">{route.distanceKm} km</span>
          <span className="mx-1">·</span>
          <span>~{route.estimatedHours} hrs</span>
        </div>
        <div className="text-amber-600 font-semibold">
          ₹{estimatedCost}+
        </div>
      </div>
      <div className="mt-2 flex items-center text-amber-600 text-xs font-medium">
        <span>Get Quote</span>
        <svg className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

export function generateRouteSlug(route) {
  return `${route.from.toLowerCase().replace(/\s+/g, '-')}-to-${route.to.toLowerCase().replace(/\s+/g, '-')}`;
}

