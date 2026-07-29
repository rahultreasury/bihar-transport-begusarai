import { Link } from 'react-router-dom';

function Footer() {
  const socialLinks = [
    {
      name: 'Facebook',
      url: 'https://www.facebook.com/bihartransport.in',
      title: 'Follow Bihar Transport on Facebook',
      ariaLabel: 'Visit Bihar Transport on Facebook',
      hoverColor: 'hover:text-[#1877F2]',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      )
    },
    {
      name: 'LinkedIn',
      url: 'https://www.linkedin.com/company/bihartransport/',
      title: 'Follow Bihar Transport on LinkedIn',
      ariaLabel: 'Visit Bihar Transport on LinkedIn',
      hoverColor: 'hover:text-[#0A66C2]',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      )
    },
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/bihartransport.in/',
      title: 'Follow Bihar Transport on Instagram',
      ariaLabel: 'Visit Bihar Transport on Instagram',
      hoverColor: 'hover:text-[#E4405F]',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
      )
    }
  ];

  return (
    <footer className="bg-gray-900 text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Column 1: Company Info */}
          <div>
            <div className="flex items-center mb-4">
              <div className="logo-wrapper">
                <img src="/assets/logo.png" alt="Bihar Transport Logo" className="site-logo" style={{ height: '42px' }} />
                <div className="brand-text">
                  <span className="brand-title">Bihar Transport</span>
                </div>
              </div>
            </div>
            <p className="text-gray-400 mb-4 text-sm leading-relaxed">
              Professional logistics and goods transportation services in Bihar since 1998. 
              We provide reliable truck, mini truck, and pickup services for all your transportation needs.
            </p>
            <div className="space-y-2 text-sm text-gray-400">
              <p className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <a href="tel:+918210931799" className="hover:text-amber-500 transition-colors" aria-label="Call Bihar Transport at +91 8210931799">+91 8210931799</a>
              </p>
              <p className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <a href="mailto:info@bihartransport.in" className="hover:text-amber-500 transition-colors" aria-label="Send email to info@bihartransport.in">info@bihartransport.in</a>
              </p>
              <p className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <a href="https://maps.app.goo.gl/fT7TwvVRE9tJcK8g8" target="_blank" rel="noopener noreferrer" className="hover:text-amber-500 transition-colors" aria-label="View Bihar Transport on Google Maps">Main Road, Begusarai, Bihar - 851101</a>
              </p>
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li><Link to="/" className="text-gray-400 hover:text-amber-500 transition-colors">Home</Link></li>
              <li><Link to="/about" className="text-gray-400 hover:text-amber-500 transition-colors">About Us</Link></li>
              <li><Link to="/book-transport" className="text-gray-400 hover:text-amber-500 transition-colors">Book Transport</Link></li>
              <li><Link to="/track" className="text-gray-400 hover:text-amber-500 transition-colors">Track Delivery</Link></li>
              <li><Link to="/contact" className="text-gray-400 hover:text-amber-500 transition-colors">Contact Us</Link></li>
            </ul>
          </div>

          {/* Column 3: Services */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Services</h3>
            <ul className="space-y-2">
              <li><span className="text-gray-400">Full Truck Load (FTL)</span></li>
              <li><span className="text-gray-400">Part Truck Load (PTL)</span></li>
              <li><span className="text-gray-400">Industrial Logistics</span></li>
              <li><span className="text-gray-400">Commercial Transport</span></li>
              <li><span className="text-gray-400">Pan India Transport</span></li>
            </ul>
          </div>

          {/* Column 4: Follow Us */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Follow Us</h3>
            <div className="flex flex-wrap gap-3 mb-4">
              {socialLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={social.title}
                  aria-label={social.ariaLabel}
                  className={`text-gray-400 transition-all duration-300 hover:scale-110 ${social.hoverColor}`}
                >
                  {social.icon}
                </a>
              ))}
            </div>
            <ul className="space-y-3">
              {socialLinks.map((social) => (
                <li key={social.name}>
                  <a
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={social.title}
                    aria-label={social.ariaLabel}
                    className="text-gray-400 hover:text-amber-500 transition-colors text-sm flex items-center gap-2"
                  >
                    <span className="w-5 h-5 shrink-0">{social.icon}</span>
                    <span>{social.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-gray-950 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-400 text-sm">
            © 1998–{new Date().getFullYear()} Bihar Transport. Professional Goods Transport Company.
          </p>
          <div className="flex space-x-6 mt-2 md:mt-0">
            <Link to="/privacy-policy" className="text-gray-400 hover:text-amber-500 text-sm transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-gray-400 hover:text-amber-500 text-sm transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;

