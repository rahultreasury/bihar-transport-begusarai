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
    <nav className="bg-white border-b border-[#E8EDF3] sticky top-0 z-50 animate-fade-in-down shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          {/* Logo + Desktop Navigation */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <div className="logo-wrapper">
                <img src="/assets/logo.png" alt="Bihar Transport Logo" className="site-logo" />
                <div className="brand-text">
                  <span className="brand-title">Bihar Transport</span>
                </div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-0.5 ml-6">
              <Link to="/" className="px-3 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] transition-colors duration-150">Home</Link>
              <Link to="/about" className="px-3 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] transition-colors duration-150">About</Link>
              <Link to="/book-transport" className="px-3 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] transition-colors duration-150">Book Transport</Link>
              <Link to="/track" className="px-3 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] transition-colors duration-150">Track Delivery</Link>
              <Link to="/partner" className="px-3 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors duration-150">Become a Partner</Link>
              <Link to="/contact" className="px-3 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] transition-colors duration-150">Contact</Link>
            </div>
          </div>

          {/* User Menu */}
          <div className="hidden md:flex items-center space-x-3 ml-auto">
            {user ? (
              <div className="flex items-center space-x-3">
                {user.role === 'customer' && (
                  <Link to="/dashboard" className="px-4 py-2 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors duration-150 font-medium text-white">
                    My Bookings
                  </Link>
                )}
                {user.role === 'driver' && (
                  <Link to="/driver-dashboard" className="px-4 py-2 bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors duration-150 font-medium text-white">
                    Driver Panel
                  </Link>
                )}
                {user.role === 'admin' && (
                  <Link to="/admin" className="px-4 py-2 bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors duration-150 font-medium text-white">
                    Admin
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 border border-[#172B4D]/20 text-[#172B4D] rounded-lg font-medium hover:bg-[#172B4D]/5 transition-colors duration-150 cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <Link
                  to="/login"
                  className="px-4 py-2 border border-[#172B4D]/20 text-[#172B4D] rounded-lg font-medium hover:bg-[#172B4D]/5 transition-colors duration-150 cursor-pointer"
                >
                  Login
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button - Hamburger */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 text-[#172B4D] cursor-pointer"
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
        <div className="md:hidden bg-white border-b border-[#E8EDF3]">
          <div className="px-4 py-3 space-y-2">
            <Link to="/" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Home</Link>
            <Link to="/about" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">About</Link>
            <Link to="/book-transport" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Book Transport</Link>
            <Link to="/track" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Track Delivery</Link>
            <Link to="/partner" className="block px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors duration-150 text-center">Become a Partner</Link>
            <Link to="/contact" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Contact</Link>
            <hr className="border-[#E8EDF3] my-2" />
            {user ? (
              <>
                {user.role === 'customer' && (
                  <Link to="/dashboard" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">My Bookings</Link>
                )}
                {user.role === 'driver' && (
                  <Link to="/driver-dashboard" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Driver Panel</Link>
                )}
                {user.role === 'admin' && (
                  <Link to="/admin" className="block px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">Admin Dashboard</Link>
                )}
                <button onClick={handleLogout} className="block w-full text-left px-4 py-2 rounded-lg text-[#172B4D] font-medium hover:text-[#F5A623] hover:bg-gray-50 transition-colors duration-150">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="block px-4 py-2 border border-[#172B4D]/20 text-[#172B4D] rounded-lg font-medium hover:bg-[#172B4D]/5 transition-colors duration-150">Login</Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

export default Navbar;
