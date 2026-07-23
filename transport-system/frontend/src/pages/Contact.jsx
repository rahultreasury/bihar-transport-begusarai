import { useState } from 'react';

function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real app, this would send to the server
    console.log('Form submitted:', formData);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="hero-gradient py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold text-white mb-4">Contact Us</h1>
          <p className="text-blue-100 text-lg">
            Get in touch with us for any inquiries or support
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Contact Info */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Get In Touch</h2>
            <p className="text-gray-600 mb-8">
              Have questions about our services? Need a quote? We're here to help. 
              Contact us through any of the methods below or fill out the form.
            </p>

            <div className="space-y-6">
              <div className="flex items-start">
                <div className="w-12 h-12 bg-amber-500 rounded-lg flex items-center justify-center text-white text-xl shrink-0">
                  📍
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold">Address</h3>
                  <a
                    href="https://maps.app.goo.gl/fT7TwvVRE9tJcK8g8"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-amber-600 transition-colors"
                    aria-label="View Bihar Transport on Google Maps"
                    title="Open Bihar Transport location in Google Maps"
                  >
                    Bihar Transport<br />
                    Main Road, Begusarai<br />
                    Bihar - 851101<br />
                    India
                  </a>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-amber-500 rounded-lg flex items-center justify-center text-white text-xl shrink-0">
                  📞
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold">Phone</h3>
                  <p className="text-gray-600 space-y-1">
                    <a
                      href="tel:+918210931799"
                      className="block hover:text-amber-600 transition-colors"
                      aria-label="Call Bihar Transport at +91 8210931799"
                    >
                      +91 8210931799
                    </a>
                    <a
                      href="tel:+919939800744"
                      className="block hover:text-amber-600 transition-colors"
                      aria-label="Call Bihar Transport at +91 9939800744"
                    >
                      +91 9939800744
                    </a>
                    <a
                      href="tel:+919835273508"
                      className="block hover:text-amber-600 transition-colors"
                      aria-label="Call Bihar Transport at +91 9835273508"
                    >
                      +91 9835273508
                    </a>
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-amber-500 rounded-lg flex items-center justify-center text-white text-xl shrink-0">
                  📧
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold">Email</h3>
                  <p className="text-gray-600 space-y-1">
                    <a
                      href="mailto:akshaykumar@bihartransport.in"
                      className="block hover:text-amber-600 transition-colors"
                      aria-label="Send email to akshaykumar@bihartransport.in"
                    >
                      akshaykumar@bihartransport.in
                    </a>
                    <a
                      href="mailto:info@bihartransport.in"
                      className="block hover:text-amber-600 transition-colors"
                      aria-label="Send email to info@bihartransport.in"
                    >
                      info@bihartransport.in
                    </a>
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-amber-500 rounded-lg flex items-center justify-center text-white text-xl shrink-0">
                  🕐
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold">Business Hours</h3>
                  <p className="text-gray-600">
                    <span className="font-medium text-amber-600">24 Hours × 7 Days</span><br />
                    Always Available
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="card">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Send us a Message</h2>
            
            {submitted ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-xl font-semibold text-green-600 mb-2">Message Sent!</h3>
                <p className="text-gray-600">
                  Thank you for contacting us. We'll get back to you shortly.
                </p>
                <button
                  onClick={() => setSubmitted(false)}
                  className="mt-4 btn-outline"
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Name *</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Email *</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      className="input-field"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label">Subject *</label>
                    <select
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      className="input-field"
                      required
                    >
                      <option value="">Select Subject</option>
                      <option value="general">General Inquiry</option>
                      <option value="booking">Booking Related</option>
                      <option value="support">Technical Support</option>
                      <option value="feedback">Feedback</option>
                      <option value="partnership">Partnership</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Message *</label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    className="input-field"
                    rows={5}
                    required
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="w-full btn-primary"
                >
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>

      {/* Follow Bihar Transport */}
      <div className="mt-12">
        <div className="card text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Follow Bihar Transport</h2>
          <p className="text-gray-600 mb-6">Stay connected with us on social media for updates and news</p>
          <div className="flex items-center justify-center gap-6">
            {[
              {
                name: 'Facebook',
                url: 'https://www.facebook.com/bihartransport.in',
                title: 'Follow Bihar Transport on Facebook',
                ariaLabel: 'Visit Bihar Transport on Facebook',
                hoverColor: 'hover:text-[#1877F2] hover:bg-[#1877F2]/10',
                icon: (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                )
              },
              {
                name: 'LinkedIn',
                url: 'https://www.linkedin.com/company/bihartransport/',
                title: 'Follow Bihar Transport on LinkedIn',
                ariaLabel: 'Visit Bihar Transport on LinkedIn',
                hoverColor: 'hover:text-[#0A66C2] hover:bg-[#0A66C2]/10',
                icon: (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                )
              },
              {
                name: 'Instagram',
                url: 'https://www.instagram.com/bihartransport.in/',
                title: 'Follow Bihar Transport on Instagram',
                ariaLabel: 'Visit Bihar Transport on Instagram',
                hoverColor: 'hover:text-[#E4405F] hover:bg-[#E4405F]/10',
                icon: (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                )
              }
            ].map((social) => (
              <a
                key={social.name}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                title={social.title}
                aria-label={social.ariaLabel}
                className="text-gray-600 transition-all duration-300 hover:scale-110 p-3 rounded-full bg-gray-100 hover:bg-gray-200"
              >
                <span className={`transition-colors duration-300 ${social.hoverColor.split(' ')[0]}`}>
                  {social.icon}
                </span>
              </a>
            ))}
          </div>
          <p className="text-gray-500 text-sm mt-4">
            Follow us for the latest updates, offers, and transport news
          </p>
        </div>
      </div>

      {/* Map */}
        <div className="mt-12">
          <a
            href="https://maps.app.goo.gl/fT7TwvVRE9tJcK8g8"
            target="_blank"
            rel="noopener noreferrer"
            className="card block hover:shadow-card-hover transition-all duration-300 group"
            aria-label="View Bihar Transport location on Google Maps"
            title="Open Bihar Transport in Google Maps"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Find Us</h2>
              <span className="inline-flex items-center gap-2 text-amber-600 font-medium text-sm group-hover:gap-3 transition-all">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                View on Google Maps
              </span>
            </div>
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg h-64 flex items-center justify-center group-hover:from-amber-50 group-hover:to-gray-100 transition-all duration-300">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-3 bg-amber-500 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-gray-600 font-medium">Bihar Transport, Main Road, Begusarai</p>
                <p className="text-gray-400 text-sm mt-1">Click to open in Google Maps →</p>
              </div>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}

export default Contact;

