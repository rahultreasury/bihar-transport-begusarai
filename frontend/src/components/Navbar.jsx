import { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';

function Navbar() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="bg-btb-dark text-white shadow-lg sticky top-0 z-50 animate-fade-in-down" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.15)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center">
            <div className="logo-wrapper">
              <img src="/assets/logo.png" alt="Bihar Transport Logo" className="site-logo" />
              <div className="brand-text">
                <span className="brand-title">Bihar Transport</span>
                <span className="brand-location">Begusarai</span>
              </div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            <Link to="/" className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors nav-link">Home</Link>
            <Link to="/about" className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors nav-link">About</Link>
            <Link to="/book-transport" className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors nav-link">Book Transport</Link>
            <Link to="/track" className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors nav-link">Track Delivery</Link>
            <Link to="/contact" className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors nav-link">Contact</Link>
            
            {/* Services Dropdown */}
            <div className="relative group">
              <button className="px-4 py-2 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-1 cursor-pointer">
                Services
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className="absolute left-0 mt-2 w-48 bg-white rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-gray-800">
                <Link to="/vehicle-search" className="block px-4 py-2 hover:bg-gray-100 rounded-t-lg">Vehicle Search</Link>
                <Link to="/license-search" className="block px-4 py-2 hover:bg-gray-100">License Search</Link>
                <Link to="/challan-search" className="block px-4 py-2 hover:bg-gray-100">Challan Search</Link>
                <Link to="/appointment" className="block px-4 py-2 hover:bg-gray-100 rounded-b-lg">Book Appointment</Link>
              </div>
            </div>
          </div>

          {/* User Menu */}
          <div className="hidden md:flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-4">
                {user.role === 'customer' && (
                  <Link to="/dashboard" className="px-4 py-2 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors">
                    My Bookings
                  </Link>
                )}
                {user.role === 'driver' && (
                  <Link to="/driver-dashboard" className="px-4 py-2 bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors">
                    Driver Panel
                  </Link>
                )}
                {user.role === 'admin' && (
                  <Link to="/admin" className="px-4 py-2 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors">
                    Admin
                  </Link>
                )}
                <button 
                  onClick={handleLogout}
                  className="px-4 py-2 border border-white/30 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <Link 
                  to="/login" 
                  className="px-4 py-2 border border-white/30 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  style={{ border: '1.5px solid rgba(255,255,255,0.7)' }}
                >
                  Login
                </Link>
                <Link 
                  to="/signup" 
                  className="px-4 py-2 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors btn-hover-scale cursor-pointer"
                >
                  Get Free Quote
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button - Hamburger */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded-lg hover:bg-white/10 cursor-pointer"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-btb-dark/95 backdrop-blur">
          <div className="px-4 py-3 space-y-2">
            <Link to="/" className="block px-4 py-2 rounded-lg hover:bg-white/10">Home</Link>
            <Link to="/about" className="block px-4 py-2 rounded-lg hover:bg-white/10">About</Link>
            <Link to="/book-transport" className="block px-4 py-2 rounded-lg hover:bg-white/10">Book Transport</Link>
            <Link to="/track" className="block px-4 py-2 rounded-lg hover:bg-white/10">Track Delivery</Link>
            <Link to="/contact" className="block px-4 py-2 rounded-lg hover:bg-white/10">Contact</Link>
            <hr className="border-white/20 my-2" />
            <p className="px-4 py-1 text-xs text-gray-400 uppercase">Services</p>
            <Link to="/vehicle-search" className="block px-4 py-2 rounded-lg hover:bg-white/10">Vehicle Search</Link>
            <Link to="/license-search" className="block px-4 py-2 rounded-lg hover:bg-white/10">License Search</Link>
            <Link to="/challan-search" className="block px-4 py-2 rounded-lg hover:bg-white/10">Challan Search</Link>
            <Link to="/appointment" className="block px-4 py-2 rounded-lg hover:bg-white/10">Book Appointment</Link>
            <hr className="border-white/20 my-2" />
            {user ? (
              <>
                {user.role === 'customer' && (
                  <Link to="/dashboard" className="block px-4 py-2 rounded-lg hover:bg-white/10">My Bookings</Link>
                )}
                {user.role === 'driver' && (
                  <Link to="/driver-dashboard" className="block px-4 py-2 rounded-lg hover:bg-white/10">Driver Panel</Link>
                )}
                {user.role === 'admin' && (
                  <Link to="/admin" className="block px-4 py-2 rounded-lg hover:bg-white/10">Admin Dashboard</Link>
                )}
                <button onClick={handleLogout} className="block w-full text-left px-4 py-2 rounded-lg hover:bg-white/10">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="block px-4 py-2 rounded-lg hover:bg-white/10">Login</Link>
                <Link to="/signup" className="block px-4 py-2 rounded-lg hover:bg-white/10">Get Free Quote</Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

export default Navbar;

