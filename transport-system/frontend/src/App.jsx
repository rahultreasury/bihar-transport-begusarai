import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, lazy, Suspense } from 'react';

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
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminBookings = lazy(() => import('./pages/AdminBookings'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const VehicleSearch = lazy(() => import('./pages/VehicleSearch'));
const LicenseSearch = lazy(() => import('./pages/LicenseSearch'));
const ChallanSearch = lazy(() => import('./pages/ChallanSearch'));
const Appointment = lazy(() => import('./pages/Appointment'));

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <Router>
        <div className="flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              {/* Public Routes (eager) */}
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Public Routes (lazy) */}
              <Route path="/about" element={<Suspense fallback={<PageLoader label="Loading About..." />}><About /></Suspense>} />
              <Route path="/contact" element={<Suspense fallback={<PageLoader label="Loading Contact..." />}><Contact /></Suspense>} />
              <Route path="/track" element={<Suspense fallback={<PageLoader label="Loading Tracking..." />}><DeliveryTracking /></Suspense>} />
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

              {/* Catch all - redirect to home */}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </AuthContext.Provider>
  );
}

export default App;

