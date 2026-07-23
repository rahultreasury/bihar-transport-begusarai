/**
 * ServicesListing — Browse all 28 states where Bihar Transport operates
 * SEO-optimized index page for /transport-services
 */
import { Link } from 'react-router-dom';
import states from '../../data/resources/states';
import StateCard from '../../components/resources/StateCard';
import SEOHead from '../../components/seo/SEOHead';

export default function ServicesListing() {
  return (
    <>
      <SEOHead
        title="Transport Services Across India"
        description="Bihar Transport offers goods transport and logistics across all 28 Indian states. Book trucks, mini trucks, pickups for FTL and PTL services nationwide."
        keywords="transport services India, goods transport all states, truck booking India, logistics across India, Bihar Transport services"
        canonicalUrl="https://bihartransport.in/transport-services"
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl font-bold text-white mb-4">
              Transport Services Across India
            </h1>
            <p className="text-blue-100 text-lg max-w-2xl mx-auto">
              Reliable goods transportation and logistics services in all 28 Indian states. 
              Book trucks, mini trucks, pickups for FTL and PTL services.
            </p>
          </div>
        </section>

        {/* States Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">All States</h2>
            <p className="text-gray-600">
              Select your state to explore available transport services and book online.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {states.map((state) => (
              <StateCard key={state.slug} state={state} />
            ))}
          </div>

          {/* CTA Section */}
          <div className="mt-16 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Need Help Choosing a Service?
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              Our team can help you find the best transport solution for your needs.
              Call us or book online for an instant quote.
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

