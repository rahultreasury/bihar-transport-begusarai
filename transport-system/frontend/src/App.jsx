import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useParams } from 'react-router-dom';
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
// ORDER / TRIP MASTER (spec: turn Bookings into the central operational workspace).
// AdminOrders       → the list  (/admin/bookings)
// AdminOrderMaster  → the detail (/admin/bookings/:bookingNumber)
// AdminBookings / AdminBookingDetail are retained, not deleted, and still serve
// the legacy booking screens the Order pages link out to.
const AdminOrders = lazy(() => import('./pages/AdminOrders'));
const AdminOrderMaster = lazy(() => import('./pages/AdminOrderMaster'));
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
const AdminVehicleOwnerEdit = lazy(() => import('./pages/AdminVehicleOwnerEdit'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminPartners = lazy(() => import('./pages/AdminPartners'));
const AdminPartnerProfile = lazy(() => import('./pages/AdminPartnerProfile'));
const AdminSettlements = lazy(() => import('./pages/AdminSettlements'));
const AdminTrips = lazy(() => import('./pages/AdminTrips'));
const AdminCreateTrip = lazy(() => import('./pages/AdminCreateTrip'));
const AdminTripWorkspace = lazy(() => import('./pages/AdminTripWorkspace'));
const AdminTripProcess = lazy(() => import('./pages/AdminTripProcess'));
const AdminFinancials = lazy(() => import('./pages/AdminFinancials'));
const AdminClients = lazy(() => import('./pages/AdminClients'));
const AdminClientDetail = lazy(() => import('./pages/AdminClientDetail'));
const AdminOwners = lazy(() => import('./pages/AdminPartners'));
const AdminOwnerProfile = lazy(() => import('./pages/AdminPartnerProfile'));
const VehicleSearch = lazy(() => import('./pages/VehicleSearch'));
const LicenseSearch = lazy(() => import('./pages/LicenseSearch'));
const ChallanSearch = lazy(() => import('./pages/ChallanSearch'));
const Appointment = lazy(() => import('./pages/Appointment'));

// Enquiry module — customer confirmation + admin workspace
const EnquiryConfirmation = lazy(() => import('./pages/EnquiryConfirmation'));
const AdminEnquiryQueue = lazy(() => import('./pages/AdminEnquiryQueue'));
const AdminEnquiryDetail = lazy(() => import('./pages/AdminEnquiryDetail'));
const AdminEnquiries = lazy(() => import('./pages/AdminEnquiries'));
const AdminEnquiryWorkspace = lazy(() => import('./pages/AdminEnquiryWorkspace'));

/**
 * Old bookmark compatibility: /admin/intake-enquiries/:id → /admin/enquiries/:id.
 * Keeps the canonical enquiry number/id in the URL so the workspace still loads.
 */
function LegacyEnquiryRedirect() {
  const { id } = useParams();
  return <Navigate to={`/admin/enquiries/${id}`} replace />;
}

// Auth pages
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

// SEO Resource Pages
const ServicesListing = lazy(() => import('./pages/resources/ServicesListing'));
const StatePage = lazy(() => import('./pages/resources/StatePage'));
const CityPage = lazy(() => import('./pages/resources/CityPage'));
const RoutePage = lazy(() => import('./pages/resources/RoutePage'));

// New SEO / Nav Pages
const Blog = lazy(() => import('./pages/Blog'));
const Partner = lazy(() => import('./pages/Partner'));
const PartnerLogin = lazy(() => import('./pages/PartnerLogin'));
const PartnerDashboard = lazy(() => import('./pages/PartnerDashboard'));
const PartnerTrips = lazy(() => import('./pages/PartnerTrips'));
const PartnerVehicles = lazy(() => import('./pages/PartnerVehicles'));
const PartnerDrivers = lazy(() => import('./pages/PartnerDrivers'));
const PartnerFinancials = lazy(() => import('./pages/PartnerFinancials'));
const PartnerProfile = lazy(() => import('./pages/PartnerProfile'));
const PartnerTripDetail = lazy(() => import('./pages/PartnerTripDetail'));
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
 * Determines if current path uses its own authenticated shell.
 * @param {string} pathname - Current URL pathname
 * @returns {boolean}
 */
function isPartnerDashboardRoute(pathname) {
  return pathname.startsWith('/partner/dashboard');
}

/**
 * Route-scoped fallback for /booking/enquiry/:enquiryNumber.
 *
 * The enquiry itself is safe — it is already committed and the customer can
 * always reach it. So this says exactly that, and offers a way forward, instead
 * of the app-wide "We couldn't load this page" screen that made a recoverable
 * moment look like a dead end.
 */
function EnquiryRouteErrorState({ canRetry, onRetry }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 bg-[#F7F8FA] px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <svg className="h-7 w-7 text-[#B26A00]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="1.6" />
          <circle cx="17.5" cy="18" r="1.6" />
        </svg>
      </div>
      <div>
        <h1 className="text-lg font-bold text-[#172B4D]">We couldn't display your request</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          Your request is saved and safe. This page just failed to display — please try once
          more, or call customer care and we will read it out to you.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#172B4D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#172B4D]/90"
          >
            Try again
          </button>
        )}
        <Link
          to="/book-transport"
          className="inline-flex items-center justify-center rounded-xl border border-[#172B4D]/20 px-5 py-2.5 text-sm font-semibold text-[#172B4D] transition hover:bg-[#172B4D]/5"
        >
          Book another transport
        </Link>
      </div>
    </div>
  );
}

/**
 * Layout wrapper that conditionally renders public Navbar/Footer
 * based on whether the current route has its own shell.
 */
function PublicLayout({ children }) {
  const { pathname } = useLocation();
  const hasDedicatedShell = useMemo(
    () => isAdminRoute(pathname) || isPartnerDashboardRoute(pathname),
    [pathname]
  );

  if (hasDedicatedShell) {
    // Admin and partner pages render their own authenticated shells.
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

        {/* Password Reset Routes (public, no auth required) */}
        <Route path="/forgot-password" element={<Suspense fallback={<PageLoader label="Loading..." />}><ForgotPassword /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={<PageLoader label="Loading..." />}><ResetPassword /></Suspense>} />

        {/* Public Routes (lazy) */}
        <Route path="/about" element={<Suspense fallback={<PageLoader label="Loading About..." />}><About /></Suspense>} />
        <Route path="/contact" element={<Suspense fallback={<PageLoader label="Loading Contact..." />}><Contact /></Suspense>} />
        <Route path="/track" element={<Suspense fallback={<PageLoader label="Loading Tracking..." />}><TrackBooking /></Suspense>} />
        <Route path="/track/:bookingNumber" element={<Suspense fallback={<PageLoader label="Loading Tracking..." />}><TrackBooking /></Suspense>} />
        <Route path="/vehicle-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><VehicleSearch /></Suspense>} />
        <Route path="/license-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><LicenseSearch /></Suspense>} />
        <Route path="/challan-search" element={<Suspense fallback={<PageLoader label="Loading..." />}><ChallanSearch /></Suspense>} />
// Book Transport - Available to all
        <Route path="/book-transport" element={<Suspense fallback={<PageLoader label="Loading Booking..." />}><BookTransport /></Suspense>} />
        <Route path="/appointment" element={<Suspense fallback={<PageLoader label="Loading..." />}><Appointment /></Suspense>} />

        {/* Enquiry Confirmation - reached straight from "Submit Booking".
            Public: the scoped enquiry token issued at submit time authorises it,
            so the customer is never bounced through a login wall.

            The ErrorBoundary here is ROUTE-SCOPED on purpose. The app-level
            boundary wraps the whole Router, so any render error here replaced
            the entire page with the generic "Something went wrong. We couldn't
            load this page." — including for a page that is still perfectly
            loadable. Scoping it keeps the failure message specific to this page
            and leaves the navbar and the rest of the site intact. */}
        <Route
          path="/booking/enquiry/:enquiryNumber"
          element={
            <ErrorBoundary
              fallback={({ retry, canRetry }) => (
                <EnquiryRouteErrorState canRetry={canRetry} onRetry={retry} />
              )}
            >
              <Suspense fallback={<PageLoader label="Finding your transport..." />}>
                <EnquiryConfirmation />
              </Suspense>
            </ErrorBoundary>
          }
        />
        
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
        
// Admin Routes
        <Route path="/admin/login" element={<Suspense fallback={<PageLoader label="Loading..." />}><AdminLogin /></Suspense>} />

        {/* ENQUIRY — THE canonical workflow, backed by the `enquiries` table.

            This is the same store the customer writes to on submit
            (POST /api/enquiries) and the same store /booking/enquiry/:enquiryNumber
            reads back. The Enquiry is the source of truth from request receipt
            until the customer accepts the quote; the Booking is only linked at
            confirmation (Enquiry.booking_id). Backed by
            GET /api/admin/enquiries and GET /api/admin/enquiries/:idOrNumber.

            :id accepts EITHER the numeric enquiry_id (what the list links to)
            or the canonical enquiry_number — adminEnquiryController.resolveEnquiry
            resolves both. */}
        <Route
          path="/admin/enquiries"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading enquiries..." />}>
                <AdminEnquiries />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/enquiries/:id"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading enquiry..." />}>
                <AdminEnquiryWorkspace />
              </Suspense>
            </ProtectedRoute>
          }
        />

        {/* Legacy booking-backed quote queue.

            This view reads the `bookings` table (GET /api/admin/bookings) and is
            NOT the enquiry workflow. It is retained — not deleted, no data
            touched — at its own path so existing links keep working, but it is
            deliberately NOT mounted at /admin/enquiries any more: doing so was
            the reason customer enquiries never appeared in the admin queue. */}
        <Route
          path="/admin/enquiries-bookings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading enquiries..." />}>
                <AdminEnquiryQueue />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/enquiries-bookings/:bookingNumber"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading enquiry..." />}>
                <AdminEnquiryDetail />
              </Suspense>
            </ProtectedRoute>
          }
        />

        {/* Backwards-compatible aliases. /admin/intake-enquiries used to hold the
            canonical enquiry screens before the booking queue took over the
            /admin/enquiries path. Both now redirect to the single canonical
            route so there is exactly ONE admin enquiry screen, not two. */}
        <Route
          path="/admin/intake-enquiries"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/enquiries" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/intake-enquiries/:id"
          element={
            <ProtectedRoute>
              <LegacyEnquiryRedirect />
            </ProtectedRoute>
          }
        />
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
        {/* ORDER / TRIP MASTER — list. Reads the same GET /api/admin/bookings the
            old Bookings page used; only the presentation is new. */}
        <Route
          path="/admin/bookings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading orders..." />}><AdminOrders /></Suspense>
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
        <Route
          path="/admin/trips/:tripId"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Trip Workspace..." />}><AdminTripWorkspace /></Suspense>
            </ProtectedRoute>
          }
        />
        {/*
            THE PROCESS WORKSPACES — one Trip, addressed by a second segment.

            This is the fix for "every step in the stepper shows the same page".
            `/admin/trips/:tripId` stays the Trip OVERVIEW; this route renders a
            DIFFERENT COMPONENT per process, so clicking Loading shows loading,
            Dispatch shows dispatch, and so on. Same trip id, same data, one
            master record — only the workspace changes.

            Declared AFTER `/admin/trips/:tripId` deliberately: they occupy
            different segment counts, so neither can shadow the other.
        */}
        <Route
          path="/admin/trips/:tripId/:process"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Trip Process..." />}><AdminTripProcess /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/financials"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Financials..." />}><AdminFinancials /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/clients"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Clients..." />}><AdminClients /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/clients/:id"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Client Detail..." />}><AdminClientDetail /></Suspense>
            </ProtectedRoute>
          }
        />
        {/* Admin booking detail (read-only) + dedicated assignment workflows */}
        {/* ORDER / TRIP MASTER — detail. The unified view over Booking + Trip +
            Delivery + the canonical financial ledger. */}
        <Route
          path="/admin/bookings/:bookingNumber"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading order..." />}><AdminOrderMaster /></Suspense>
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
          path="/admin/vehicle-owners/:id/edit"
          element={
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading Vehicle Owner Edit..." />}><AdminVehicleOwnerEdit /></Suspense>
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
        <Route
          path="/partner/dashboard"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Partner Dashboard..." />}>
                <PartnerDashboard />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/trips"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Trips..." />}>
                <PartnerTrips />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/trips/:id"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Trip..." />}>
                <PartnerTripDetail />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/vehicles"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Vehicles..." />}>
                <PartnerVehicles />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/drivers"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Drivers..." />}>
                <PartnerDrivers />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/financials"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Financials..." />}>
                <PartnerFinancials />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/partner/profile"
          element={
            <ProtectedRoute
              roles={['partner']}
              loginPath="/partner/login"
              unauthorizedPath="/partner/login"
            >
              <Suspense fallback={<PageLoader label="Loading Profile..." />}>
                <PartnerProfile />
              </Suspense>
            </ProtectedRoute>
          }
        />
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

