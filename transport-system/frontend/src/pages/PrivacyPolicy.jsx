/**
 * PrivacyPolicy — Privacy Policy page for Bihar Transport
 * E-E-A-T compliance: Clear data handling practices
 */
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';

export default function PrivacyPolicy() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.in/' },
      { '@type': 'ListItem', position: 2, name: 'Privacy Policy', item: 'https://bihartransport.in/privacy-policy' },
    ],
  };

  return (
    <>
      <SEO
        title="Privacy Policy"
        description="Privacy Policy of Bihar Transport. Learn how we collect, use, and protect your personal information when you use our goods transport and logistics services."
        canonical="https://bihartransport.in/privacy-policy"
        schema={[breadcrumbSchema]}
      />
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm p-8 md:p-12">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
            <p className="text-gray-500 text-sm mb-8">Last updated: January 2025</p>

            <div className="prose prose-gray max-w-none space-y-6">
              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">1. Introduction</h2>
                <p className="text-gray-700 leading-relaxed">
                  Bihar Transport ("we," "our," or "us") is committed to protecting your privacy. 
                  This Privacy Policy explains how we collect, use, disclose, and safeguard your 
                  information when you visit our website or use our goods transport and logistics services.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">2. Information We Collect</h2>
                <p className="text-gray-700 leading-relaxed mb-3">We may collect the following types of information:</p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li><strong>Personal Information:</strong> Name, email address, phone number, and billing address when you book our services.</li>
                  <li><strong>Booking Information:</strong> Pickup and drop locations, goods description, vehicle preferences, and delivery dates.</li>
                  <li><strong>Usage Data:</strong> How you interact with our website, including pages visited and time spent.</li>
                  <li><strong>Device Information:</strong> Browser type, IP address, and operating system.</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">3. How We Use Your Information</h2>
                <p className="text-gray-700 leading-relaxed mb-3">We use the collected information for:</p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Processing and managing your transport bookings</li>
                  <li>Providing real-time shipment tracking</li>
                  <li>Communicating with you about your bookings</li>
                  <li>Improving our services and website experience</li>
                  <li>Sending service-related updates and promotional offers (with consent)</li>
                  <li>Complying with legal obligations</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">4. Data Sharing</h2>
                <p className="text-gray-700 leading-relaxed">
                  We do not sell your personal information. We may share your information with:
                </p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2 mt-3">
                  <li>Transport partners and drivers for service fulfillment</li>
                  <li>Payment processors for transaction processing</li>
                  <li>Legal authorities when required by law</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">5. Data Security</h2>
                <p className="text-gray-700 leading-relaxed">
                  We implement appropriate technical and organizational measures to protect your 
                  personal information against unauthorized access, alteration, disclosure, or destruction. 
                  All data transmissions are encrypted using SSL/TLS protocols.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">6. Your Rights</h2>
                <p className="text-gray-700 leading-relaxed mb-3">You have the right to:</p>
                <ul className="list-disc pl-6 text-gray-700 space-y-2">
                  <li>Access your personal data held by us</li>
                  <li>Request correction of inaccurate data</li>
                  <li>Request deletion of your data</li>
                  <li>Withdraw consent for marketing communications</li>
                  <li>Lodge a complaint with relevant data protection authorities</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">7. Cookies</h2>
                <p className="text-gray-700 leading-relaxed">
                  Our website uses cookies to enhance your browsing experience. You can control cookie 
                  settings through your browser preferences. Essential cookies are required for the 
                  website to function properly.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-gray-900 mb-3">8. Contact Us</h2>
                <p className="text-gray-700 leading-relaxed">
                  If you have any questions about this Privacy Policy, please contact us:
                </p>
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

