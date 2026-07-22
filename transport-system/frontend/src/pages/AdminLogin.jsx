import { useState, useContext, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { authAPI } from '../services/api';

function AdminLogin() {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from || '/admin';

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If already logged in as admin/super_admin, redirect away.
  useEffect(() => {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) return;
      const user = JSON.parse(userData);
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        navigate(from, { replace: true });
      }
    } catch {
      // ignore
    }
  }, [navigate, from]);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    console.log('[AdminLogin] handleSubmit CALLED');
    console.log('[AdminLogin] Calling e.preventDefault()...');
    e.preventDefault();
    console.log('[AdminLogin] e.preventDefault() EXECUTED, form will NOT reload');
    setError('');
    setLoading(true);
    console.log('[AdminLogin] Starting API request to /auth/admin-login...');

    try {
      console.log('[AdminLogin] API request: authAPI.adminLogin() calling...');
      const response = await authAPI.adminLogin(formData);
      console.log('[AdminLogin] API RESPONSE received:', response?.data);

      if (response?.data?.success) {
        console.log('[AdminLogin] Login SUCCESS, updating auth context...');
        login(response.data.data, response.data.token);
        console.log('[AdminLogin] Navigating to /admin...');
        navigate('/admin', { replace: true });
      } else {
        console.log('[AdminLogin] Login FAILED (success=false):', response?.data?.message);
        throw new Error(response?.data?.message || 'Admin login failed');
      }
    } catch (err) {
      console.log('[AdminLogin] CATCH block entered. Error:', err?.message, 'Status:', err?.response?.status);
      console.log('[AdminLogin] axios error.config.url:', err?.config?.url);
      // Attempt to prevent any full-page redirect from axios interceptor
      if (err?.response?.status === 401) {
        setError(err?.response?.data?.message || 'Invalid credentials');
      } else {
        setError(err?.response?.data?.message || err?.message || 'Admin login failed');
      }
    } finally {
      setLoading(false);
      console.log('[AdminLogin] handleSubmit COMPLETED (finally block)');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-3 mb-4">
            <div className="bg-amber-500 p-2 rounded-lg">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
                />
              </svg>
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold text-gray-900">Bihar Transport</h1>
              <p className="text-xs text-amber-600">Begusarai</p>
            </div>
          </Link>

          <h2 className="text-2xl font-bold text-gray-900">Admin Login</h2>
          <p className="text-gray-600 mt-1">Sign in to manage bookings and users</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="card">
          <div className="space-y-4">
            <div>
              <label className="label">Admin Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input-field"
                placeholder="admin@example.com"
                required
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="input-field"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary mt-6 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-gray-600 mt-4">
            Back to{' '}
            <Link to="/login" className="text-amber-500 hover:underline font-medium">
              Customer Login
            </Link>
          </p>

        </form>
      </div>
    </div>
  );
}

export default AdminLogin;

