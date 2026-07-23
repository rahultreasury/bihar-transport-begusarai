/**
 * RoutesListing — Browse popular transport routes across India
 * SEO-optimized index page for /routes
 */
import { Link } from 'react-router-dom';
import routes from '../data/resources/routes';
import RouteCard from '../components/resources/RouteCard';
import SEO from '../components/seo/SEO';

// Get unique route pairs (one direction only to avoid duplicates)
const uniqueRoutes = routes.reduce((acc, route) => {
  const key = [route.from, route.to].sort().join('-');
  if (!acc.some(r => [r.from, r.to].sort().join('-') === key)) {
    acc.push(route);
  }
  return acc;
}, []);

// Sort by distance (most popular = most distance?)
const popularRoutes = [...uniqueRoutes].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 50);

export default function RoutesListing() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.com/' },
      { '@type': 'ListItem', position: 2, name: 'Popular Transport Routes', item: 'https://bihartransport.com/routes' },
    ],
  };

  return (
    <>
      <SEO
        title="Popular Transport Routes Across India"
        description="Browse popular goods transport routes across India. Check distance, estimated hours, and book trucks online from Bihar Transport."
        keywords="transport routes India, goods transport routes, truck routes, logistics routes India, popular transport routes"
        canonical="https://bihartransport.com/routes"
        schema={[breadcrumbSchema]}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl font-bold text-white mb-4">
              Popular Transport Routes
            </h1>
            <p className="text-blue-100 text-lg max-w-2xl mx-auto">
              Explore our most popular goods transport routes across India. 
              Check distances, estimated travel times, and book online instantly.
            </p>
          </div>
        </section>

        {/* Routes Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">All Popular Routes</h2>
            <p className="text-gray-600">
              Showing {popularRoutes.length} popular routes. Click any route to get a detailed quote.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {popularRoutes.map((route, index) => (
              <RouteCard key={index} route={route} />
            ))}
          </div>

          {/* CTA Section */}
          <div className="mt-16 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Route Not Listed?
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              We serve thousands of routes across India. Contact us for a custom quote
              for your specific transport route.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/book-transport"
                className="btn-primary inline-flex items-center justify-center"
              >
                Book Transport Now
              </Link>
              <a
                href="tel:+918210931799"
                className="btn-outline inline-flex items-center justify-center"
              >
                Call +91 82109 31799
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

