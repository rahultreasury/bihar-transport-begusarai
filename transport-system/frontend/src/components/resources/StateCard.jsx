/**
 * StateCard — Reusable card for displaying state information
 */
import { Link } from 'react-router-dom';

export default function StateCard({ state }) {
  return (
    <Link
      to={`/transport-services/${state.slug}`}
      className="card group hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
      aria-label={`View transport services in ${state.name}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600 font-bold text-sm">
          {state.name.charAt(0)}
        </div>
        <h3 className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">
          {state.name}
        </h3>
      </div>
      <p className="text-gray-500 text-sm mb-2">
        Capital: <span className="text-gray-700">{state.capital}</span>
      </p>
      <p className="text-gray-400 text-xs line-clamp-2">
        {state.majorCities.slice(0, 5).join(', ')}
      </p>
      <div className="mt-3 flex items-center text-amber-600 text-sm font-medium">
        <span>View Services</span>
        <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

