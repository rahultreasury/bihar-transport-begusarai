/**
 * Terms — Terms of Service page for Bihar Transport
 * E-E-A-T compliance: Clear terms for service usage
 */
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';

export default function Terms() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.in/' },
      { '@type': 'ListItem', position: 2, name: 'Terms of Service', item: 'https://bihartransport.in/terms' },
    ],
  };

  return (
    <>
      <SEO
        title="Terms of Service"
        description="Terms of Service for Bihar Transport. Understand the terms and conditions for using our goods transport and logistics services."
        canonical="https://bihartransport.in/terms"
        schema={[breadcrumbSchema]}
      />
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm p-8 md:p-12">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
            <p className="text-gray-500 text-sm mb-8">Last updated: January 2025</p>

            <div className="prose prose-gray max-w-none space-y-6">
              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
                <p className="text-gray-700 leading-relaxed">
                  By accessing or using Bihar Transport's website and services, you agree to be bound 
                  by these Terms of Service. If you do not agree with any part of these terms, you 
                  should not use our services.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">2. Services Description</h2>
                <p className="text-gray-700 leading-relaxed">
                  Bihar Transport provides goods transportation and logistics services including 
                  Full Truck Load (FTL), Part Truck Load (PTL), mini truck, pickup, and tempo 
                  services across India. All services are subject to availability and service area restrictions.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">3. Booking and Payment</h2>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>All bookings are subject to confirmation and availability.</li>
                  <li>Prices quoted are estimates and may vary based on actual distance, weight, and conditions.</li>
                  <li>Payment terms will be communicated at the time of booking confirmation.</li>
                  <li>Cancellation charges may apply as per our cancellation policy.</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">4. User Responsibilities</h2>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Provide accurate and complete information for bookings.</li>
                  <li>Ensure goods are properly packaged and labeled for transport.</li>
                  <li>Not transport prohibited or illegal items.</li>
                  <li>Provide safe and accessible pickup and delivery locations.</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">5. Limitation of Liability</h2>
                <p className="text-gray-700 leading-relaxed">
                  Bihar Transport shall not be liable for any indirect, incidental, or consequential 
                  damages arising from the use of our services. Our maximum liability is limited to 
                  the value of the transport service provided.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">6. Prohibited Items</h2>
                <p className="text-gray-700 leading-relaxed mb-3">The following items are prohibited from transport:</p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Illegal drugs and narcotics</li>
                  <li>Explosives and flammable materials</li>
                  <li>Live animals (except with prior arrangement)</li>
                  <li>Perishable items without proper packaging</li>
                  <li>Items prohibited by applicable laws</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">7. Intellectual Property</h2>
                <p className="text-gray-700 leading-relaxed">
                  All content on our website, including text, graphics, logos, and software, is the 
                  property of Bihar Transport and is protected by applicable intellectual property laws.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">8. Changes to Terms</h2>
                <p className="text-gray-700 leading-relaxed">
                  We reserve the right to modify these terms at any time. Users will be notified of 
                  material changes via email or website notice. Continued use of services after 
                  changes constitutes acceptance of new terms.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">9. Contact Information</h2>
                <p className="text-gray-700 leading-relaxed">For questions about these terms, contact us:</p>
                <div className="mt-3 text-gray-700">
                  <p>Email: <a href="mailto:info@bihartransport.in" className="text-amber-600 hover:text-amber-700">info@bihartransport.in</a></p>
                  <p>Phone: <a href="tel:+918210931799" className="text-amber-600 hover:text-amber-700">+91 82109 31799</a></p>
                  <p>Address: Main Road, Begusarai, Bihar - 851101</p>
                </div>
              </section>
            </div>

            <div className="mt-10 pt-6 border-t border-gray-200">
              <Link to="/" className="text-amber-600 hover:text-amber-700 font-medium">
                ← Back to Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

