/**
 * CityPage — Individual city transport services page
 * SEO-optimized for /cities/:citySlug
 */
import { useParams, Link } from 'react-router-dom';
import cities from '../../data/resources/cities';
import routes from '../../data/resources/routes';
import states from '../../data/resources/states';
import SEOHead from '../../components/seo/SEOHead';
import RouteCard from '../../components/resources/RouteCard';

export default function CityPage() {
  const { citySlug } = useParams();
  
  const city = cities.find((c) => c.slug === citySlug);
  const cityRoutes = routes.filter(
    (r) => r.from.toLowerCase() === city?.city.toLowerCase() || r.to.toLowerCase() === city?.city.toLowerCase()
  );
  const nearbyCityData = city?.nearbyCities
    ?.map((name) => cities.find((c) => c.city === name))
    .filter(Boolean) || [];

  if (!city) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">City Not Found</h1>
          <p className="text-gray-600 mb-6">The city you're looking for doesn't exist.</p>
          <Link to="/transport-services" className="btn-primary inline-block">
            View All States
          </Link>
        </div>
      </div>
    );
  }

  const stateObj = states.find((s) => s.name === city.state);

  return (
    <>
      <SEOHead
        title={`Goods Transport in ${city.city} - Book Trucks & Logistics`}
        description={city.description}
        keywords={city.keywords}
        canonicalUrl={`https://bihartransport.in/cities/${city.slug}`}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 text-blue-200 text-sm mb-4">
              <Link to="/" className="hover:text-white transition-colors">Home</Link>
              <span>/</span>
              <Link to="/transport-services" className="hover:text-white transition-colors">Services</Link>
              <span>/</span>
              <span className="text-white">{city.city}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              Goods Transport in {city.city}, {city.state}
            </h1>
            <p className="text-blue-100 text-lg max-w-3xl">
              {city.description}
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Quick Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
              <p className="text-2xl font-bold text-amber-600">{city.city.charAt(0)}</p>
              <p className="text-gray-500 text-xs mt-1">City Code</p>
            </div>
            <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{city.state}</p>
              <p className="text-gray-500 text-xs mt-1">State</p>
            </div>
            <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{cityRoutes.length}</p>
              <p className="text-gray-500 text-xs mt-1">Routes</p>
            </div>
            <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{city.popularIndustries.length}</p>
              <p className="text-gray-500 text-xs mt-1">Industries</p>
            </div>
          </div>

          {/* Industries */}
          <div className="mb-10">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Industries We Serve in {city.city}</h2>
            <div className="flex flex-wrap gap-3">
              {city.popularIndustries.map((industry) => (
                <span key={industry} className="bg-amber-50 text-amber-700 px-4 py-2 rounded-full text-sm font-medium">
                  {industry}
                </span>
              ))}
            </div>
          </div>

          {/* Routes */}
          {cityRoutes.length > 0 && (
            <div className="mb-10">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Popular Routes from {city.city}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cityRoutes.slice(0, 9).map((route) => (
                  <RouteCard key={`${route.from}-${route.to}`} route={route} />
                ))}
              </div>
            </div>
          )}

          {/* Nearby Cities */}
          {nearbyCityData.length > 0 && (
            <div className="mb-10">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Nearby Cities</h2>
              <div className="flex flex-wrap gap-2">
                {nearbyCityData.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/cities/${c.slug}`}
                    className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 hover:border-amber-300 hover:text-amber-600 transition-colors"
                  >
                    {c.city}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* State Link */}
          {stateObj && (
            <div className="mb-10 bg-blue-50 rounded-xl p-6 text-center">
              <p className="text-gray-700 mb-3">
                View all transport services in <strong>{city.state}</strong>
              </p>
              <Link
                to={`/transport-services/${stateObj.slug}`}
                className="text-amber-600 hover:text-amber-700 font-medium inline-flex items-center gap-1"
              >
                Explore {city.state} Services
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}

          {/* CTA */}
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Book Transport in {city.city}
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              Get an instant quote and reliable goods transport service in {city.city}.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/book-transport" className="btn-primary inline-flex items-center justify-center">
                Book Now
              </Link>
              <a href="tel:+918210931799" className="btn-outline inline-flex items-center justify-center">
                Call +91 82109 31799
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

