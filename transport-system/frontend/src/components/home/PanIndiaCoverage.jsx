import React from 'react';
import serviceCities from '../../data/serviceCities';

/**
 * PanIndiaCoverage — Minimal city cards section matching the original design.
 *
 * Replaces old "We Serve Across Bihar" with "We Deliver Across India"
 * using 5 pan-India cities while keeping the exact same card style.
 */
const PanIndiaCoverage = React.memo(function PanIndiaCoverage() {
  return (
    <section className="py-16 md:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
            We Deliver Across India
          </h2>
          <p className="text-gray-600">
            Reliable transport services connecting businesses across India through our growing logistics network.
          </p>
        </div>

        {/* Desktop / Tablet grid */}
        <div className="hidden sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {serviceCities.map((city) => (
            <CityCard key={city.id} city={city} />
          ))}
        </div>

        {/* Mobile horizontal snap scroll */}
        <div className="sm:hidden">
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 -mx-4 px-4">
            {serviceCities.map((city) => (
              <div key={city.id} className="snap-center shrink-0 w-[45vw] max-w-[180px]">
                <CityCard key={city.id} city={city} />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center mt-3 sm:hidden">
            ← Swipe to explore →
          </p>
        </div>
      </div>
    </section>
  );
});

/**
 * CityCard — Individual city card (identical to old design pattern).
 */
const CityCard = React.memo(function CityCard({ city }) {
  return (
    <div
      className="card text-center hover:border-amber-500 border-2 border-transparent transition-all cursor-default"
      style={{ borderRadius: '12px' }}
    >
      <div className="text-3xl mb-2">{city.icon}</div>
      <h3 className="font-semibold text-gray-900">{city.name}</h3>
      <p className="text-xs text-gray-500 mt-0.5">{city.state}</p>
      <div className="flex items-center justify-center gap-1.5 mt-2">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs text-green-600 font-medium">Transport Available</span>
      </div>
    </div>
  );
});

export default PanIndiaCoverage;

