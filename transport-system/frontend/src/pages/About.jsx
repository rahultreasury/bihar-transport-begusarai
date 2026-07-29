import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const testimonials = [
  {
    name: 'Rajesh Kumar',
    company: 'Tata Steel',
    text: 'Bihar Transport has been our reliable partner for 10+ years. Their service is impeccable.',
    rating: 5,
    avatar: 'RK'
  },
  {
    name: 'Priya Sharma',
    company: 'Reliance Retail',
    text: 'Excellent real-time tracking and timely deliveries. Highly recommended for logistics.',
    rating: 5,
    avatar: 'PS'
  },
  {
    name: 'Amit Singh',
    company: 'Amazon India',
    text: 'Competitive pricing with premium service quality. Perfect logistics partner.',
    rating: 5,
    avatar: 'AS'
  }
];

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
    { year: '1998', title: 'Company Founded', description: 'Bihar Transport was established' },
    { year: '2005', title: 'Fleet Expansion', description: 'Expanded to 20+ vehicles' },
    { year: '2010', title: 'Technology Integration', description: 'Introduced GPS tracking system' },
    { year: '2015', title: 'Pan Bihar Coverage', description: 'Services expanded across Bihar' },
    { year: '2020', title: 'Digital Transformation', description: 'Launched online booking platform' },
    { year: '2024', title: '5000+ Deliveries', description: 'Successfully completed over 5000 deliveries' }
  ];

  const stats = [
    { number: '100+', label: 'Vehicles' },
    { number: '50+', label: 'Drivers' },
    { number: '10K+', label: 'Deliveries' },
    { number: '25+', label: 'Clients' }
  ];

  const clients = [
    'Tata',
    'Reliance', 
    'Adani',
    'Amazon',
    'Flipkart',
    'Mahindra'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <motion.section 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-gradient-to-r from-amber-600 via-orange-500 to-amber-700 py-24 overflow-hidden"
      >
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent"></div>
        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 text-center z-10">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-5xl md:text-7xl font-black text-white mb-6 drop-shadow-2xl leading-tight"
          >
            About <span className="text-amber-200">Bihar Transport</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-xl md:text-2xl text-blue-100 max-w-4xl mx-auto leading-relaxed drop-shadow-lg mb-12"
          >
            Your trusted partner for professional goods transportation services in Bihar since 1998. 
            <span className="block mt-4 font-semibold text-amber-100">25+ Years of Excellence</span>
          </motion.p>
          
          {/* Trusted Companies - Stripe Style */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-12 md:gap-20 opacity-80"
          >
            {clients.map((client, index) => (
              <motion.div
                key={client}
                initial={{ scale: 0.8, opacity: 0.5 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.7 + index * 0.1 }}
                whileHover={{ scale: 1.1, opacity: 1 }}
                className="text-2xl md:text-3xl font-black text-slate-200 hover:text-white transition-all duration-300 cursor-default"
              >
                {client}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      {/* Company Info */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl lg:text-5xl font-black text-gray-900 mb-8 bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Leading Logistics Provider
              </h2>
              <div className="space-y-6 text-lg text-gray-700 leading-relaxed">
                <p className="text-xl">
                  Bihar Transport has been a pioneer in the logistics and transportation industry 
                  in Bihar since 1998. Based in Begusarai, we have grown to become one of the most trusted 
                  names in goods transportation across the region.
                </p>
                <p className="text-xl">
                  Our mission is to provide reliable, efficient, and affordable transportation solutions 
                  for businesses and individuals. With a fleet of over 100 vehicles and a team of 50+ 
                  professional drivers, we ensure safe and timely delivery of your goods.
                </p>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="group relative overflow-hidden rounded-3xl shadow-2xl bg-gradient-to-br from-blue-50 to-indigo-50 p-8 cursor-pointer"
              >
                <img 
                  src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=500&h=400&fit=crop" 
                  alt="Warehouse Operations" 
                  className="w-full h-64 object-cover rounded-2xl group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="absolute bottom-6 left-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-500">
                  <h3 className="text-2xl font-bold mb-2">Advanced Warehouse</h3>
                  <p className="opacity-90">State-of-the-art storage facilities</p>
                </div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="group relative overflow-hidden rounded-3xl shadow-2xl bg-gradient-to-br from-emerald-50 to-green-50 p-8 cursor-pointer mt-6 md:mt-0"
              >
                <img 
                  src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=500&h=400&fit=crop" 
                  alt="Modern Fleet" 
                  className="w-full h-64 object-cover rounded-2xl group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="absolute bottom-6 left-6 text-white opacity-0 group-hover:opacity-100 transition-all duration-500">
                  <h3 className="text-2xl font-bold mb-2">Modern Fleet</h3>
                  <p className="opacity-90">GPS-enabled vehicles</p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl lg:text-5xl font-black text-gray-900 mb-6 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700 bg-clip-text text-transparent">
              Why Choose <span className="text-amber-600">Bihar Transport</span>
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              We are committed to providing the best transportation services in Bihar with cutting-edge technology and unmatched reliability
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="group relative bg-white/80 backdrop-blur-xl rounded-3xl p-10 shadow-xl border border-white/50 hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 cursor-pointer overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-blue-500/5 -skew-x-3 -rotate-1 -translate-x-4 -translate-y-4 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform duration-700"></div>
                <div className="text-5xl mb-8 relative z-10">{feature.icon}</div>
                <h3 className="text-2xl font-black text-gray-900 mb-6 relative z-10 leading-tight">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed relative z-10">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trusted Clients */}
      <section className="py-24 bg-gradient-to-r from-slate-900 to-slate-800">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl lg:text-5xl font-black text-white mb-6">
              Trusted by <span className="text-amber-400">Leading Companies</span>
            </h2>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto">
              Join thousands of satisfied customers who trust us for their logistics needs
            </p>
          </motion.div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-12 items-center justify-items-center">
            {clients.map((client, index) => (
              <motion.div
                key={client}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                whileHover={{ scale: 1.1, rotate: 5 }}
                className="group relative p-6 rounded-2xl bg-white/10 backdrop-blur-xl shadow-2xl border border-white/20 hover:bg-white/20 transition-all duration-500 cursor-pointer"
              >
                <div className="text-3xl md:text-4xl font-black text-slate-300 group-hover:text-slate-100 transition-colors duration-300">
                  {client}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-24 bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center">
            {stats.map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.2 }}
                viewport={{ once: true }}
                className="text-white"
              >
                <div className="text-5xl md:text-7xl font-black mb-4 bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent drop-shadow-2xl">
                  {stat.number}
                </div>
                <div className="text-2xl font-semibold opacity-90 tracking-wide uppercase">
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl lg:text-5xl font-black text-gray-900 mb-6">
              Our <span className="text-amber-600">Journey</span>
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Over two decades of growth, innovation, and commitment to excellence in transportation
            </p>
          </motion.div>
          
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute left-1/2 transform -translate-x-1/2 w-1 h-full bg-gradient-to-b from-amber-400 to-amber-600"></div>
            <div className="space-y-16">
              {timeline.map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  viewport={{ once: true }}
                  className={`flex items-center ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}
                >
                  <div className={`w-1/2 ${index % 2 === 0 ? 'pr-8' : 'pl-8'}`}>
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-8 rounded-3xl shadow-2xl border border-amber-200/50 group hover:shadow-3xl hover:-translate-y-2 transition-all duration-500">
                      <div className="flex items-baseline mb-4">
                        <span className="text-3xl font-black text-white mr-4">{item.year}</span>
                        <div className="w-4 h-4 bg-white/20 rounded-full"></div>
                      </div>
                      <h3 className="text-2xl font-black text-white mb-4">{item.title}</h3>
                      <p className="text-blue-100 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <motion.section 
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="py-24 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white"
      >
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <motion.div
            initial={{ scale: 0.9 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl lg:text-5xl font-black mb-6 drop-shadow-2xl">
              Get Your <span className="text-white">Free</span> Transport Quote Today
            </h2>
            <p className="text-xl mb-12 opacity-90 max-w-2xl mx-auto leading-relaxed drop-shadow-lg">
              Experience reliable, fast, and affordable transportation services across Bihar. 
              Book now and let us handle your logistics with care.
            </p>
            <Link 
              to="/book-transport"
              className="group inline-flex items-center gap-4 px-12 py-6 bg-white text-amber-700 rounded-3xl font-black text-xl shadow-2xl hover:shadow-3xl hover:-translate-y-2 transition-all duration-500 hover:bg-amber-50 cursor-pointer"
            >
              Book Now 
              <svg className="w-6 h-6 group-hover:translate-x-2 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </motion.div>
        </div>
      </motion.section>
    </div>
  );
}

export default About;
