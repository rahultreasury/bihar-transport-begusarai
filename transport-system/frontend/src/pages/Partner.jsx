/**
 * Partner — Become a Transport Partner with Bihar Transport
 * Production-ready landing page with SEO
 */
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';

const benefits = [
  {
    title: 'Regular Loads',
    description: 'Get consistent business with regular transport orders from our wide customer base across India.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: 'Timely Payments',
    description: 'Get paid on time, every time. Transparent payment cycles with no delays or hidden deductions.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Pan India Network',
    description: 'Access routes across all 28 states. Expand your business reach with our established network.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'GPS-Enabled Platform',
    description: 'Track all your trips digitally. Our platform gives you and your customers complete visibility.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    title: 'Dedicated Support',
    description: 'Get priority support from our partner relations team. We help you resolve issues quickly.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    title: 'Digital Documentation',
    description: 'Paperless onboarding and trip management. All documents managed digitally for your convenience.',
    icon: (
      <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

const requirements = [
  { label: 'Vehicle Type', value: 'Pickup, Mini Truck, Truck, Trailer' },
  { label: 'Vehicle Age', value: 'Less than 10 years old' },
  { label: 'Documentation', value: 'RC, Insurance, Pollution, Driving License' },
  { label: 'GPS Tracking', value: 'Active GPS device required' },
  { label: 'PAN Card', value: 'Mandatory for payment processing' },
  { label: 'Bank Account', value: 'Valid current account for settlements' },
];

export default function Partner() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.com/' },
      { '@type': 'ListItem', position: 2, name: 'Become a Partner', item: 'https://bihartransport.com/partner' },
    ],
  };

  const partnerSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Bihar Transport Partner Program',
    description: 'Join Bihar Transport as a transport partner and get regular loads, timely payments, and dedicated support.',
    url: 'https://bihartransport.com/partner',
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      city: formData.get('city'),
      vehicleType: formData.get('vehicleType'),
    };
    // Encode as mailto or handle via backend
    window.location.href = `mailto:partner@bihartransport.com?subject=Partner%20Enquiry%20-%20${encodeURIComponent(data.name)}&body=Name:%20${encodeURIComponent(data.name)}%0APhone:%20${encodeURIComponent(data.phone)}%0ACity:%20${encodeURIComponent(data.city)}%0AVehicle%20Type:%20${encodeURIComponent(data.vehicleType)}`;
  };

  return (
    <>
      <SEO
        title="Become a Transport Partner"
        description="Partner with Bihar Transport and get regular loads, timely payments, and dedicated support. Join India's growing transport network across 28 states."
        keywords="transport partner, truck partner, logistics partner, vehicle owner partner, Bihar Transport partner"
        canonical="https://bihartransport.com/partner"
        schema={[breadcrumbSchema, partnerSchema]}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">
                Become a Transport Partner
              </h1>
              <p className="text-blue-100 text-lg md:text-xl mb-8">
                Join India's fastest-growing transport network. Get regular loads, 
                timely payments, and a dedicated partner support team.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="#partner-form"
                  className="bg-amber-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-amber-600 transition-colors inline-flex items-center justify-center"
                >
                  Apply Now
                </a>
                <a
                  href="tel:+918210931799"
                  className="border-2 border-white/40 text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-colors inline-flex items-center justify-center"
                >
                  Call +91 82109 31799
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Why Partner With Us?
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                We believe in building long-term partnerships. Here's what you get when you join Bihar Transport.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {benefits.map((benefit, index) => (
                <div
                  key={index}
                  className="bg-white rounded-xl p-6 shadow-sm hover:shadow-lg transition-all duration-300"
                >
                  <div className="w-14 h-14 bg-amber-50 rounded-lg flex items-center justify-center mb-4">
                    {benefit.icon}
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{benefit.title}</h3>
                  <p className="text-gray-600 text-sm">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Requirements */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                What You Need
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                Simple requirements to get started as a Bihar Transport partner.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {requirements.map((req, index) => (
                <div
                  key={index}
                  className="border border-gray-200 rounded-lg p-5 hover:border-amber-300 transition-colors"
                >
                  <h3 className="font-semibold text-gray-900 mb-1">{req.label}</h3>
                  <p className="text-gray-600 text-sm">{req.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Partner Form */}
        <section id="partner-form" className="py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-white rounded-2xl shadow-sm p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
                Apply to Become a Partner
              </h2>
              <p className="text-gray-600 text-center mb-8">
                Fill out the form below and our team will get back to you within 24 hours.
              </p>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors"
                      placeholder="Your full name"
                    />
                  </div>
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors"
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div>
                    <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                      City / Base Location *
                    </label>
                    <input
                      type="text"
                      id="city"
                      name="city"
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors"
                      placeholder="e.g., Patna, Delhi"
                    />
                  </div>
                  <div>
                    <label htmlFor="vehicleType" className="block text-sm font-medium text-gray-700 mb-1">
                      Vehicle Type *
                    </label>
                    <select
                      id="vehicleType"
                      name="vehicleType"
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors bg-white"
                    >
                      <option value="">Select vehicle type</option>
                      <option value="pickup">Pickup</option>
                      <option value="mini-truck">Mini Truck</option>
                      <option value="truck">Truck (FTL)</option>
                      <option value="trailer">Trailer</option>
                      <option value="container">Container</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-amber-500 text-white py-3 rounded-lg font-semibold hover:bg-amber-600 transition-colors"
                >
                  Submit Application
                </button>
                <p className="text-xs text-gray-400 text-center">
                  By submitting, you agree to our terms and privacy policy. We'll contact you within 24 hours.
                </p>
              </form>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-gradient-to-br from-amber-50 to-yellow-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Ready to Grow Your Business?
            </h2>
            <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
              Join hundreds of transport partners across India who trust Bihar Transport 
              for regular business and timely payments.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="#partner-form"
                className="btn-primary inline-flex items-center justify-center"
              >
                Apply Now
              </a>
              <Link
                to="/contact"
                className="btn-outline inline-flex items-center justify-center"
              >
                Talk to Our Team
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

