/**
 * RoutePage — Individual transport route page
 * SEO-optimized for /routes/:from-to-:to
 */
import { useParams, Link } from 'react-router-dom';
import routes from '../../data/resources/routes';
import SEOHead from '../../components/seo/SEOHead';
import RouteCard from '../../components/resources/RouteCard';

export default function RoutePage() {
  const { routeSlug } = useParams();

  // Parse slug like "patna-to-delhi"
  const parts = routeSlug?.split('-to-') || [];
  const fromCity = parts[0]?.replace(/-/g, ' ') || '';
  const toCity = parts[1]?.replace(/-/g, ' ') || '';

  const route = routes.find(
    (r) => r.from.toLowerCase() === fromCity.toLowerCase() && r.to.toLowerCase() === toCity.toLowerCase()
  );

  // Related routes
  const relatedFromRoutes = routes.filter(
    (r) => r.from.toLowerCase() === fromCity.toLowerCase() && r.to.toLowerCase() !== toCity.toLowerCase()
  ).slice(0, 6);
  const relatedToRoutes = routes.filter(
    (r) => r.to.toLowerCase() === toCity.toLowerCase() && r.from.toLowerCase() !== fromCity.toLowerCase()
  ).slice(0, 6);

  if (!route) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Route Not Found</h1>
          <p className="text-gray-600 mb-6">The transport route you're looking for doesn't exist.</p>
          <Link to="/transport-services" className="btn-primary inline-block">
            Browse Services
          </Link>
        </div>
      </div>
    );
  }

  const estimatedCost = (route.distanceKm * 14).toLocaleString();
  const routeName = `${route.from} to ${route.to}`;

  return (
    <>
      <SEOHead
        title={`Goods Transport from ${route.from} to ${route.to} - Book Trucks Online`}
        description={`Book trucks and goods transport from ${route.from} (${route.fromState}) to ${route.to} (${route.toState}). ${route.distanceKm} km, ~${route.estimatedHours} hours transit. FTL, PTL services. Get instant quote.`}
        keywords={`goods transport ${route.from} to ${route.to}, truck booking ${route.from} ${route.to}, logistics ${route.from} to ${route.to}`}
        canonicalUrl={`https://bihartransport.in/routes/${routeSlug}`}
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
              <span className="text-white">{routeName}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              Goods Transport from {route.from} to {route.to}
            </h1>
            <p className="text-blue-100 text-lg max-w-3xl">
              Reliable truck, mini truck, and pickup services from {route.from}, {route.fromState} to {route.to}, {route.toState}.
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Route Details */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <p className="text-gray-400 text-sm mb-1">From</p>
                <p className="text-xl font-bold text-gray-900">{route.from}</p>
                <p className="text-gray-500 text-sm">{route.fromState}</p>
              </div>
              <div className="text-center border-t md:border-t-0 md:border-l md:border-r border-gray-100 px-4">
                <p className="text-gray-400 text-sm mb-1">Distance</p>
                <p className="text-2xl font-bold text-amber-600">{route.distanceKm} km</p>
                <p className="text-gray-500 text-sm">~{route.estimatedHours} hours transit</p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-sm mb-1">To</p>
                <p className="text-xl font-bold text-gray-900">{route.to}</p>
                <p className="text-gray-500 text-sm">{route.toState}</p>
              </div>
            </div>
          </div>

          {/* Estimated Pricing */}
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-6 md:p-8 mb-10">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Estimated Pricing</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-amber-200">
                    <th className="text-left py-3 font-semibold text-gray-700">Vehicle Type</th>
                    <th className="text-center py-3 font-semibold text-gray-700">Starting Rate</th>
                    <th className="text-center py-3 font-semibold text-gray-700">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-amber-100">
                    <td className="py-3 text-gray-800 font-medium">Pickup</td>
                    <td className="py-3 text-center text-gray-600">₹12/km</td>
                    <td className="py-3 text-center text-gray-800 font-semibold">₹{(route.distanceKm * 12).toLocaleString()}</td>
                  </tr>
                  <tr className="border-b border-amber-100">
                    <td className="py-3 text-gray-800 font-medium">Mini Truck</td>
                    <td className="py-3 text-center text-gray-600">₹14/km</td>
                    <td className="py-3 text-center text-gray-800 font-semibold">₹{(route.distanceKm * 14).toLocaleString()}</td>
                  </tr>
                  <tr className="border-b border-amber-100">
                    <td className="py-3 text-gray-800 font-medium">Truck (6-Wheeler)</td>
                    <td className="py-3 text-center text-gray-600">₹16/km</td>
                    <td className="py-3 text-center text-gray-800 font-semibold">₹{(route.distanceKm * 16).toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-gray-800 font-medium">Container Truck</td>
                    <td className="py-3 text-center text-gray-600">₹20/km</td>
                    <td className="py-3 text-center text-gray-800 font-semibold">₹{(route.distanceKm * 20).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-gray-500 text-xs mt-4 text-center">
              *Prices are indicative. Actual cost may vary based on load, vehicle availability, and road conditions.
            </p>
          </div>

          {/* Related Routes - From same origin */}
          {relatedFromRoutes.length > 0 && (
            <div className="mb-10">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                More Routes from {route.from}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {relatedFromRoutes.map((r) => (
                  <RouteCard key={`${r.from}-${r.to}`} route={r} />
                ))}
              </div>
            </div>
          )}

          {/* Related Routes - To same destination */}
          {relatedToRoutes.length > 0 && (
            <div className="mb-10">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                More Routes to {route.to}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {relatedToRoutes.map((r) => (
                  <RouteCard key={`${r.from}-${r.to}`} route={r} />
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Book Transport from {route.from} to {route.to}
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              Get an instant quote and book your goods transport online. 
              Reliable, tracked, and affordable.
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

