import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useContext, lazy, Suspense, useMemo, useCallback, useRef } from 'react';

// Context — defined in a separate module so React Fast Refresh does not
// treat App.jsx as both a component and a context exporter.
import { AuthContext } from './contexts/AuthContext';

// Components (keep Navbar + Footer eager for instant shell)
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PageLoader from './components/PageLoader';
import ErrorBoundary from './components/ErrorBoundary';
// safeLazyImport removed — using standard React.lazy to avoid invalid element type

// Auth persistence + route guard
import { getStoredAuth, setStoredAuth, clearStoredAuth, onAuthChange } from './services/authStorage';
import { authAPI } from './services/api';
import ProtectedRoute from './components/ProtectedRoute';

// Eager pages (critical path — small, always needed)
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';

// Lazy pages (code-split by route)
// Public pages use standard lazy loading.
// Admin pages use safeLazyImport for controlled chunk-failure recovery.
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const BookTransport = lazy(() => import('./pages/BookTransport'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DriverDashboard = lazy(() => import('./pages/DriverDashboard'));
const TrackBooking = lazy(() => import('./pages/TrackBooking'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminBookings = lazy(() => import('./pages/AdminBookings'));
const AdminBookingDetail = lazy(() => import('./pages/AdminBookingDetail'));
const AdminAssignDriver = lazy(() => import('./pages/AdminAssignDriver'));
const AdminAssignVehicle = lazy(() => import('./pages/AdminAssignVehicle'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDrivers = lazy(() => import('./pages/AdminDrivers'));
const AdminDriverProfile = lazy(() => import('./pages/AdminDriverProfile'));
const AdminVehicles = lazy(() => import('./pages/AdminVehicles'));
const AdminVehicleProfile = lazy(() => import('./pages/AdminVehicleProfile'));
const AdminVehicleOwners = lazy(() => import('./pages/AdminVehicleOwners'));
const AdminVehicleOwnerProfile = lazy(() => import('./pages/AdminVehicleOwnerProfile'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminPartners = lazy(() => import('./pages/AdminPartners'));
const AdminPartnerProfile = lazy(() => import('./pages/AdminPartnerProfile'));
const AdminSettlements = lazy(() => import('./pages/AdminSettlements'));
const AdminTrips = lazy(() => import('./pages/AdminTrips'));
const AdminCreateTrip = lazy(() => import('./pages/AdminCreateTrip'));
const AdminOwners = lazy(() => import('./pages/AdminPartners'));
const AdminOwnerProfile = lazy(() => import('./pages/AdminPartnerProfile'));
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
const PartnerLogin = lazy(() => import('./pages/PartnerLogin'));
const VehicleOwnerRegistration = lazy(() => import('./pages/VehicleOwnerRegistration'));
const TransportOwnerRegistration = lazy(() => import('./pages/TransportOwnerRegistration'));
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
  const { user, login, logout, authLoading } = useContext(AuthContext);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
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
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Admin..." />}><AdminDashboard /></Suspense>
            </ProtectedRoute>
          }
        />
        {/* AI Insights — sidebar item exists but route was missing */}
        <Route
          path="/admin/ai"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading AI Insights..." />}><AdminAnalytics /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/bookings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Bookings..." />}><AdminBookings /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/trips"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Trips..." />}><AdminTrips /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/trips/create"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Create Trip..." />}><AdminCreateTrip /></Suspense>
            </ProtectedRoute>
          }
        />
        {/* Admin booking detail (read-only) + dedicated assignment workflows */}
        <Route 
          path="/admin/bookings/:bookingNumber" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Booking..." />}><AdminBookingDetail /></Suspense>
            </ProtectedRoute>
          } 
        />
<Route 
          path="/admin/bookings/:bookingNumber/assign-driver" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Driver Assignment..." />}><AdminAssignDriver /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/bookings/:bookingNumber/assign-vehicle" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Vehicle Assignment..." />}><AdminAssignVehicle /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route
          path="/admin/drivers"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Drivers..." />}><AdminDrivers /></Suspense>
            </ProtectedRoute>
          }
        />
<Route
  path="/admin/drivers/:id"
  element={
    <ProtectedRoute>
      <Suspense fallback={<PageLoader label="Loading Driver Profile..." />}><AdminDriverProfile /></Suspense>
    </ProtectedRoute>
  }
/>
<Route
  path="/admin/vehicles"
  element={
    <ProtectedRoute>
      <Suspense fallback={<PageLoader label="Loading Vehicles..." />}><AdminVehicles /></Suspense>
    </ProtectedRoute>
  }
/>
<Route
  path="/admin/vehicles/:id"
  element={
    <ProtectedRoute>
      <Suspense fallback={<PageLoader label="Loading Vehicle Profile..." />}><AdminVehicleProfile /></Suspense>
    </ProtectedRoute>
  }
/>
<Route
  path="/admin/vehicle-owners"
  element={
    <ProtectedRoute>
      <Suspense fallback={<PageLoader label="Loading Vehicle Owners..." />}><AdminVehicleOwners /></Suspense>
    </ProtectedRoute>
  }
/>
        <Route
          path="/admin/vehicle-owners/:id"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Vehicle Owner Profile..." />}><AdminVehicleOwnerProfile /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Reports..." />}><AdminReports /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/analytics" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Analytics..." />}><AdminAnalytics /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/owners" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Transport Owners..." />}><AdminPartners /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/owners/:id" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Owner Profile..." />}><AdminPartnerProfile /></Suspense>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/settlements" 
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Settlements..." />}><AdminSettlements /></Suspense>
            </ProtectedRoute>
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
        <Route path="/partner/login" element={<Suspense fallback={<PageLoader label="Loading..." />}><PartnerLogin /></Suspense>} />
        <Route path="/partner/vehicle-owner" element={<Suspense fallback={<PageLoader label="Loading..." />}><VehicleOwnerRegistration /></Suspense>} />
        <Route path="/partner/transport-owner" element={<Suspense fallback={<PageLoader label="Loading..." />}><TransportOwnerRegistration /></Suspense>} />
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
  const [authLoading, setAuthLoading] = useState(true);

  // Single boot routine: read persisted auth, then validate the token.
  const boot = useCallback(async () => {
    const stored = getStoredAuth();
    if (!stored.token || !stored.user) {
      setUser(null);
      setAuthLoading(false);
      return;
    }

    // Optimistically hydrate from persisted user so the app shell renders.
    setUser(stored.user);

    // Validate the token server-side. If invalid/expired, clear auth.
    // Use a bounded timeout so authLoading never stays true forever.
    const AUTH_TIMEOUT = 12000; // 12 seconds
    let authError = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT);
      try {
        // Use the correct endpoint based on the stored user's role.
        // Admin/operator/super_admin tokens are validated by /auth/admin/me.
        // Customer/driver tokens are validated by /auth/me.
        const adminRoles = ['admin', 'super_admin', 'operator'];
        const isAdmin = adminRoles.includes(stored.user?.role);
        const authFn = isAdmin ? authAPI.adminMe : authAPI.getMe;
        const res = await authFn({ signal: controller.signal });
        clearTimeout(timeoutId);
        const me = res?.data?.data?.user || res?.data?.user;
        if (me) {
          const freshUser = { ...stored.user, ...me };
          setUser(freshUser);
          setStoredAuth(stored.token, freshUser);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      authError = err;
      // Only clear auth for confirmed auth failures (401/403).
      // Timeouts and network errors are treated as transient — keep the
      // persisted session so the user is not logged out unnecessarily.
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        clearStoredAuth();
        setUser(null);
      }
      // For timeout / network / unknown errors: keep stored user, just stop loading.
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // Keep runtime auth in sync when api.js clears/sets auth (e.g. a 401).
  useEffect(() => {
    const unsubscribe = onAuthChange((authenticated) => {
      if (!authenticated) {
        setUser(null);
        setAuthLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // bfcache / pageshow: on back-forward navigation the persisted auth may have
  // changed (e.g. logged out in another tab). Re-read + re-validate.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) boot();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [boot]);

  const login = useCallback((userData, token) => {
    setStoredAuth(token, userData);
    setUser(userData);
    setAuthLoading(false);
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setUser(null);
    setAuthLoading(false);
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, authLoading }),
    [user, login, logout, authLoading]
  );

  return (
    <AuthContext.Provider value={value}>
      <ErrorBoundary>
        <Router>
          <AppContent />
        </Router>
      </ErrorBoundary>
    </AuthContext.Provider>
  );
}

export default App;

