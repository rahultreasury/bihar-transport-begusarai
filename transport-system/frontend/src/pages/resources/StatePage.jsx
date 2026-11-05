
/**
 * StatePage — Individual state transport services page
 * SEO-optimized with structured data for /transport-services/:state
 */
import { useParams, Link } from 'react-router-dom';
import states from '../../data/resources/states';
import { getCitiesByState } from '../../data/resources/cities';
import routes from '../../data/resources/routes';
import SEOHead from '../../components/seo/SEOHead';
import CityCard from '../../components/resources/CityCard';
import RouteCard, { generateRouteSlug } from '../../components/resources/RouteCard';

export default function StatePage() {
  const { stateSlug } = useParams();

  const state = states.find((s) => s.slug === stateSlug);
  const stateCities = getCitiesByState(stateSlug);
  const stateRoutes = routes.filter(
    (r) =>
      r.fromState.toLowerCase() === state?.name.toLowerCase() ||
      r.toState.toLowerCase() === state?.name.toLowerCase()
  );

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">State Not Found</h1>
          <p className="text-gray-600 mb-6">The state you're looking for doesn't exist.</p>
          <Link to="/transport-services" className="btn-primary inline-block">
            View All States
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title={`Transport in ${state.name} - Book Trucks & Goods Transport`}
        description={state.metaDescription}
        keywords={state.keywords}
        canonicalUrl={`https://bihartransport.in/transport-services/${state.slug}`}
      />

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Service',
            name: `Goods Transport in ${state.name}`,
            description: state.serviceDescription,
            provider: {
              '@type': 'Organization',
              name: 'Bihar Transport',
              url: 'https://bihartransport.in'
            },
            areaServed: {
              '@type': 'State',
              name: state.name
            },
            availableChannel: {
              '@type': 'ServiceChannel',
              serviceUrl: `https://bihartransport.in/transport-services/${state.slug}`,
              servicePhone: '+918210931799'
            }
          })
        }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 text-blue-200 text-sm mb-4">
              <Link to="/" className="hover:text-white transition-colors">Home</Link>
              <span>/</span>
              <Link to="/transport-services" className="hover:text-white transition-colors">Services</Link>
              <span>/</span>
              <span className="text-white">{state.name}</span>
            </div>
            <h1 className="text-4xl font-bold text-white mb-4">
              Goods Transport in {state.name}
            </h1>
            <p className="text-blue-100 text-lg max-w-3xl">
              {state.serviceDescription}
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {state.highlights.map((highlight) => (
              <div key={highlight} className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
                <p className="text-amber-600 font-medium text-sm">{highlight}</p>
              </div>
            ))}
          </div>

          {/* Services Offered */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Transport Services in {state.name}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {state.services.map((service) => (
                <div key={service.name} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-2">{service.name}</h3>
                  <p className="text-gray-600 text-sm">{service.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Major Cities */}
          {stateCities.length > 0 && (
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                Cities We Serve in {state.name}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {stateCities.map((city) => (
                  <CityCard key={city.slug} city={city} />
                ))}
              </div>
            </div>
          )}

          {/* Popular Routes */}
          {stateRoutes.length > 0 && (
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                Popular Routes {state.name === 'Bihar' ? 'from Bihar' : `in ${state.name}`}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stateRoutes.slice(0, 12).map((route) => (
                  <RouteCard key={`${route.from}-${route.to}`} route={route} />
                ))}
              </div>
              {stateRoutes.length > 12 && (
                <div className="text-center mt-6">
                  <Link to="/routes" className="text-amber-600 hover:text-amber-700 font-medium">
                    View all {stateRoutes.length} routes
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* FAQ */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {state.faq.map((item, index) => (
                <details key={index} className="bg-white rounded-xl shadow-sm border border-gray-100 group">
                  <summary className="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-amber-600 transition-colors list-none flex items-center justify-between">
                    <span>{item.q}</span>
                    <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-6 pb-4 text-gray-600 text-sm leading-relaxed">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Book Transport in {state.name} Today
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              Get an instant quote and book your goods transport online. 
              Reliable, tracked, and affordable.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/book-transport"
                className="btn-primary inline-flex items-center justify-center"
              >
                Book Now
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

