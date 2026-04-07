import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext } from 'react';

// Context
export const AuthContext = createContext(null);

// Components
import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import BookTransport from './pages/BookTransport';
import Dashboard from './pages/Dashboard';
import DriverDashboard from './pages/DriverDashboard';
import DeliveryTracking from './pages/DeliveryTracking';
import AdminDashboard from './pages/AdminDashboard';
import About from './pages/About';
import Contact from './pages/Contact';
import VehicleSearch from './pages/VehicleSearch';
import LicenseSearch from './pages/LicenseSearch';
import ChallanSearch from './pages/ChallanSearch';
import Appointment from './pages/Appointment';

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
              {/* Public Routes */}
              <Route path="/" element={<Home />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/track" element={<DeliveryTracking />} />
              <Route path="/vehicle-search" element={<VehicleSearch />} />
              <Route path="/license-search" element={<LicenseSearch />} />
              <Route path="/challan-search" element={<ChallanSearch />} />
              <Route path="/appointment" element={<Appointment />} />
              
              {/* Book Transport - Available to all (redirects to login if not authenticated) */}
              <Route path="/book-transport" element={<BookTransport />} />
              
              {/* Customer Routes */}
              <Route 
                path="/dashboard" 
                element={user ? <Dashboard /> : <Navigate to="/login" />} 
              />
              
              {/* Driver Routes */}
              <Route 
                path="/driver-dashboard" 
                element={user?.role === 'driver' ? <DriverDashboard /> : <Navigate to="/" />} 
              />
              
              {/* Admin Routes */}
              <Route 
                path="/admin" 
                element={user?.role === 'admin' || user?.role === 'super_admin' ? <AdminDashboard /> : <Navigate to="/" />} 
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

