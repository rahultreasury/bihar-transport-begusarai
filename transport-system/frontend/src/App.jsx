import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect, createContext, useContext, lazy, Suspense, useMemo } from 'react';

// Context
export const AuthContext = createContext(null);

// Components (keep Navbar + Footer eager for instant shell)
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PageLoader from './components/PageLoader';

// Eager pages (critical path — small, always needed)
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';

// Lazy pages (code-split by route)
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const BookTransport = lazy(() => import('./pages/BookTransport'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DriverDashboard = lazy(() => import('./pages/DriverDashboard'));
const TrackBooking = lazy(() => import('./pages/TrackBooking'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminBookings = lazy(() => import('./pages/AdminBookings'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDrivers = lazy(() => import('./pages/AdminDrivers'));
const AdminDriverProfile = lazy(() => import('./pages/AdminDriverProfile'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminPartners = lazy(() => import('./pages/AdminPartners'));
const AdminPartnerProfile = lazy(() => import('./pages/AdminPartnerProfile'));
const AdminSettlements = lazy(() => import('./pages/AdminSettlements'));
const VehicleSearch = lazy(() => import('./pages/VehicleSearch'));
const LicenseSearch = lazy(() => import('./pages/LicenseSearch'));
const ChallanSearch = lazy(() => import('./pages/ChallanSearch'));
const Appointment = lazy(() => import('./pages/Appointment'));

// SEO Resource Pages
const ServicesListing = lazy(() => import('./pages/resources/ServicesListing'));
const StatePage = lazy(() => import('./pages/resources/StatePage'));
const CityPage = lazy(() => import('./pages/resources/CityPage'));
const RoutePage = lazy(() => import('./pages/resources/RoutePage'));

// New SEO / Nav Pages
const Blog = lazy(() => import('./pages/Blog'));
const Partner = lazy(() => import('./pages/Partner'));
const RoutesListing = lazy(() => import('./pages/RoutesListing'));
const NotFound = lazy(() => import('./pages/NotFound'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const Terms = lazy(() => import('./pages/Terms'));

/**
 * Determines if current path is an admin route.
 * @param {string} pathname - Current URL pathname
 * @returns {boolean}
 */
function isAdminRoute(pathname) {
  return pathname.startsWith('/admin');
}

/**
 * Layout wrapper that conditionally renders public Navbar/Footer
 * based on whether the current route is an admin route.
 */
function PublicLayout({ children }) {
  const { pathname } = useLocation();
  const isAdmin = useMemo(() => isAdminRoute(pathname), [pathname]);

if (isAdmin) {
    // Render only children (admin pages have their own layout via AdminShell)
    return children;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}

function AppContent() {
  const { user, login, logout, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <PublicLayout>
      <Routes>
        {/* Public Routes (eager) */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Public Routes (lazy) */}
        <Route path="/about" element={<Suspense fallback={<PageLoader label="Loading About..." />}><About /></Suspense>} />
        <Route path="/contact" element={<Suspense fallback={<PageLoader label="Loading Contact..." />}><Contact /></Suspense>} />
        <Route path="/track" element={<Suspense fallback={<PageLoader label="Loading Tracking..." />}><TrackBooking /></Suspense>} />
        <Route path="/track/:bookingNumber" element={<Suspense fallback={<PageLoader label="Loading Tracking..." />}><TrackBooking /></Suspense>} />
        <Route path="/vehicle-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><VehicleSearch /></Suspense>} />
        <Route path="/license-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><LicenseSearch /></Suspense>} />
        <Route path="/challan-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><ChallanSearch /></Suspense>} />
        <Route path="/appointment" element={<Suspense fallback={<PageLoader label="Loading..." />}><Appointment /></Suspense>} />
        
        {/* Book Transport - Available to all */}
        <Route path="/book-transport" element={<Suspense fallback={<PageLoader label="Loading Booking..." />}><BookTransport /></Suspense>} />
        
        {/* Customer Routes */}
        <Route 
          path="/dashboard" 
          element={
            user 
              ? <Suspense fallback={<PageLoader label="Loading Dashboard..." />}><Dashboard /></Suspense>
              : <Navigate to="/login" />
          } 
        />
        
        {/* Driver Routes */}
        <Route 
          path="/driver-dashboard" 
          element={
            user?.role === 'driver' 
              ? <Suspense fallback={<PageLoader label="Loading Driver Dashboard..." />}><DriverDashboard /></Suspense>
              : <Navigate to="/" />
          } 
        />
        
        {/* Admin Routes */}
        <Route path="/admin/login" element={<Suspense fallback={<PageLoader label="Loading..." />}><AdminLogin /></Suspense>} />
        <Route 
          path="/admin" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Admin..." />}><AdminDashboard /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/bookings" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Bookings..." />}><AdminBookings /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/drivers" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Drivers..." />}><AdminDrivers /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/drivers/:id" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Driver Profile..." />}><AdminDriverProfile /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/reports" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Reports..." />}><AdminReports /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/analytics" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Analytics..." />}><AdminAnalytics /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/partners" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Partners..." />}><AdminPartners /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/partners/:id" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Partner Profile..." />}><AdminPartnerProfile /></Suspense>
              : <Navigate to="/" />
          } 
        />
        <Route 
          path="/admin/settlements" 
          element={
            user?.role === 'admin' || user?.role === 'super_admin' 
              ? <Suspense fallback={<PageLoader label="Loading Settlements..." />}><AdminSettlements /></Suspense>
              : <Navigate to="/" />
          } 
        />

        {/* SEO Resource Pages */}
        <Route path="/transport-services" element={<Suspense fallback={<PageLoader label="Loading..." />}><ServicesListing /></Suspense>} />
        <Route path="/transport-services/:stateSlug" element={<Suspense fallback={<PageLoader label="Loading..." />}><StatePage /></Suspense>} />
        <Route path="/cities/:citySlug" element={<Suspense fallback={<PageLoader label="Loading..." />}><CityPage /></Suspense>} />
        <Route path="/routes" element={<Suspense fallback={<PageLoader label="Loading..." />}><RoutesListing /></Suspense>} />
        <Route path="/routes/:routeSlug" element={<Suspense fallback={<PageLoader label="Loading..." />}><RoutePage /></Suspense>} />
        <Route path="/blog" element={<Suspense fallback={<PageLoader label="Loading..." />}><Blog /></Suspense>} />
        <Route path="/partner" element={<Suspense fallback={<PageLoader label="Loading..." />}><Partner /></Suspense>} />
        <Route path="/privacy-policy" element={<Suspense fallback={<PageLoader label="Loading..." />}><PrivacyPolicy /></Suspense>} />
        <Route path="/terms" element={<Suspense fallback={<PageLoader label="Loading..." />}><Terms /></Suspense>} />

        {/* Catch all - 404 NotFound */}
        <Route path="*" element={<Suspense fallback={<PageLoader label="Loading..." />}><NotFound /></Suspense>} />
      </Routes>
    </PublicLayout>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      setUser(JSON.parse(userData));
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      <Router>
        <AppContent />
      </Router>
    </AuthContext.Provider>
  );
}

export default App;

