import React from 'react';

function About() {
  const features = [
    {
      title: 'Professional Team',
      description: 'Our team consists of experienced professionals dedicated to providing the best logistics solutions.',
      icon: '👥'
    },
    {
      title: '24/7 Support',
      description: 'Round-the-clock customer support to assist you with all your transportation needs.',
      icon: '🕐'
    },
    {
      title: 'Real-time Tracking',
      description: 'Track your shipments in real-time from pickup to final delivery.',
      icon: '📍'
    },
    {
      title: 'Competitive Pricing',
      description: 'Transparent pricing with no hidden charges. Get value for your money.',
      icon: '💰'
    },
    {
      title: 'Verified Fleet',
      description: 'All vehicles are regularly maintained and verified for safety.',
      icon: '✅'
    },
    {
      title: 'Pan Bihar Service',
      description: 'We operate across Bihar and neighboring states.',
      icon: '🗺️'
    }
  ];

  const timeline = [
    { year: '1998', title: 'Company Founded', description: 'Bihar Transport Begusarai was established' },
    { year: '2005', title: 'Fleet Expansion', description: 'Expanded to 20+ vehicles' },
    { year: '2010', title: 'Technology Integration', description: 'Introduced GPS tracking system' },
    { year: '2015', title: 'Pan Bihar Coverage', description: 'Services expanded across Bihar' },
    { year: '2020', title: 'Digital Transformation', description: 'Launched online booking platform' },
    { year: '2024', title: '5000+ Deliveries', description: 'Successfully completed over 5000 deliveries' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="hero-gradient py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">
            About Bihar Transport Begusarai
          </h1>
          <p className="text-xl text-blue-100 max-w-3xl mx-auto">
            Your trusted partner for professional goods transportation services in Bihar since 1998
          </p>
        </div>
      </section>

      {/* Company Info */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Leading Logistics Provider in Bihar
              </h2>
              <p className="text-gray-600 mb-4">
                Bihar Transport Begusarai has been a pioneer in the logistics and transportation industry 
                in Bihar since 1998. Based in Begusarai, we have grown to become one of the most trusted 
                names in goods transportation across the region.
              </p>
              <p className="text-gray-600 mb-6">
                Our mission is to provide reliable, efficient, and affordable transportation solutions 
                for businesses and individuals. With a fleet of over 100 vehicles and a team of 50+ 
                professional drivers, we ensure safe and timely delivery of your goods.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-500">25+</div>
                  <div className="text-sm text-gray-600">Years</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-500">100+</div>
                  <div className="text-sm text-gray-600">Vehicles</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-500">5000+</div>
                  <div className="text-sm text-gray-600">Deliveries</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <img 
                src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=400&h=300&fit=crop" 
                alt="Logistics" 
                className="rounded-lg shadow-lg"
              />
              <img 
                src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=400&h=300&fit=crop" 
                alt="Truck" 
                className="rounded-lg shadow-lg mt-8"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose Us</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              We are committed to providing the best transportation services in Bihar
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="card text-center">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Journey</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Over two decades of excellence in transportation services
            </p>
          </div>
          <div className="relative">
            {/* Timeline Line */}
            <div className="absolute left-1/2 transform -translate-x-1/2 h-full w-1 bg-amber-500"></div>
            
            <div className="space-y-12">
              {timeline.map((item, index) => (
                <div 
                  key={index} 
                  className={`flex items-center ${index % 2 === 0 ? 'flex-row' : 'flex-row-reverse'}`}
                >
                  <div className="flex-1"></div>
                  <div className="w-4 h-4 bg-amber-500 rounded-full z-10"></div>
                  <div className="flex-1">
                    <div className="card ml-4">
                      <span className="text-amber-500 font-bold">{item.year}</span>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="text-sm text-gray-600">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-btb-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Book Your Transport?
          </h2>
          <p className="text-blue-100 mb-8 max-w-2xl mx-auto">
            Experience the best logistics services in Bihar. Book now and get reliable transportation for your goods.
          </p>
          <a href="/book-transport" className="btn-primary">
            Book Transport
          </a>
        </div>
      </section>
    </div>
  );
}

export default About;

