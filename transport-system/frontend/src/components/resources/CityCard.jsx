/**
 * CityCard — Reusable card for displaying city information
 */
import { Link } from 'react-router-dom';

export default function CityCard({ city }) {
  return (
    <Link
      to={`/cities/${city.slug}`}
      className="card group hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
      aria-label={`View transport services in ${city.city}, ${city.state}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center text-sky-600 font-bold text-sm">
          {city.city.charAt(0)}
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 group-hover:text-sky-600 transition-colors">
            {city.city}
          </h3>
          <p className="text-gray-400 text-xs">{city.state}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {city.popularIndustries.slice(0, 3).map((ind) => (
          <span key={ind} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {ind}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center text-sky-600 text-sm font-medium">
        <span>Book Transport</span>
        <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

