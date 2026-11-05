import React from 'react';
import trustedClients from '../../data/trustedClients';

/**
 * Inline SVG brand logo renderer based on client id.
 * Grayscale by default, reveals brand color on hover via group-hover.
 */
function BrandLogo({ clientId }) {
  const common = 'h-12 w-auto md:h-14 transition-all duration-300 grayscale group-hover:grayscale-0 group-hover:scale-110';

  switch (clientId) {
    case 'pioneer':
      return (
        <svg className={common} viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="8" width="28" height="3" rx="1.5" className="fill-gray-400 group-hover:fill-emerald-600 transition-colors duration-300" />
          <rect x="0" y="16" width="20" height="3" rx="1.5" className="fill-gray-400 group-hover:fill-emerald-600 transition-colors duration-300" />
          <rect x="0" y="24" width="24" height="3" rx="1.5" className="fill-gray-400 group-hover:fill-emerald-600 transition-colors duration-300" />
          <circle cx="90" cy="20" r="9" className="fill-gray-400 group-hover:fill-emerald-500 transition-colors duration-300" />
          <text x="38" y="26" fontSize="14" fontWeight="700" fontFamily="system-ui" className="fill-gray-500 group-hover:fill-gray-800 transition-colors duration-300">PIONEER</text>
        </svg>
      );
    case 'pepsico':
      return (
        <svg className={common} viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="10" width="32" height="20" rx="4" className="fill-gray-400 group-hover:fill-red-500 transition-colors duration-300" />
          <rect x="4" y="14" width="24" height="12" rx="2" className="fill-white" />
          <circle cx="16" cy="20" r="4" className="fill-gray-400 group-hover:fill-blue-600 transition-colors duration-300" />
          <text x="40" y="26" fontSize="13" fontWeight="700" fontFamily="system-ui" className="fill-gray-500 group-hover:fill-gray-800 transition-colors duration-300">PEPSICO</text>
        </svg>
      );
    case 'veedol':
      return (
        <svg className={common} viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 10L16 10L20 20L24 10L32 10L26 30L14 30L8 10Z" className="fill-gray-400 group-hover:fill-orange-500 transition-colors duration-300" />
          <circle cx="20" cy="30" r="3" className="fill-gray-400 group-hover:fill-orange-600 transition-colors duration-300" />
          <text x="40" y="26" fontSize="13" fontWeight="700" fontFamily="system-ui" className="fill-gray-500 group-hover:fill-gray-800 transition-colors duration-300">VEEDOL</text>
        </svg>
      );
    default:
      return (
        <div className="h-12 w-24 bg-gray-200 rounded" />
      );
  }
}

/**
 * TrustedClients — "Trusted by Leading Businesses" section.
 * Replaces the old "Available Vehicles Today" bar on the homepage.
 */
const TrustedClients = React.memo(function TrustedClients() {
  return (
    <section className="py-10 bg-white border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">
            Trusted by Leading Businesses
          </h3>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto">
            Proud logistics partner for leading companies across agriculture, FMCG, industrial and commercial sectors.
          </p>
        </div>

        {/* Desktop: centered row */}
        <div className="hidden md:flex items-center justify-center gap-8 lg:gap-12">
          {trustedClients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
          <MoreCard />
        </div>

        {/* Tablet: wrap */}
        <div className="hidden sm:flex md:hidden flex-wrap items-center justify-center gap-6">
          {trustedClients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
          <MoreCard />
        </div>

        {/* Mobile: horizontal snap scroll */}
        <div className="sm:hidden">
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 -mx-4 px-4 items-center">
            {trustedClients.map((client) => (
              <div key={client.id} className="snap-center shrink-0">
                <ClientCard client={client} />
              </div>
            ))}
            <div className="snap-center shrink-0">
              <MoreCard />
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center mt-3">← Swipe →</p>
        </div>

        <p className="text-xs md:text-sm text-gray-400 text-center mt-8 max-w-3xl mx-auto leading-relaxed">
          Serving businesses across manufacturing, agriculture, FMCG, retail and industrial supply chains throughout India.
        </p>
      </div>
    </section>
  );
});

/**
 * ClientCard — Individual brand logo card.
 */
const ClientCard = React.memo(function ClientCard({ client }) {
  return (
    <div className="group flex items-center justify-center px-6 py-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 cursor-default min-w-[160px]">
      <BrandLogo clientId={client.id} />
    </div>
  );
});

/**
 * MoreCard — "+ Many More" card.
 */
const MoreCard = React.memo(function MoreCard() {
  return (
    <div className="group flex flex-col items-center justify-center px-5 py-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-100 shadow-sm hover:shadow-md hover:scale-105 transition-all duration-300 cursor-default min-w-[120px]">
      <span className="text-2xl font-bold text-amber-500 leading-none group-hover:scale-110 transition-transform">
        +250
      </span>
      <span className="text-xs font-semibold text-amber-600 mt-1 whitespace-nowrap">
        Many More
      </span>
    </div>
  );
});

export default TrustedClients;

