import { useState, useContext } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { authAPI } from '../services/api';

function Login() {
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  
  const from = location.state?.from || '/dashboard';

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = showAdminLogin ? '/auth/admin-login' : '/auth/login';
      const response = await authAPI.login(formData);
      
      if (response.data.success) {
        login(response.data.data, response.data.token);
        
        // Redirect based on role
        if (response.data.data.role === 'admin' || response.data.data.role === 'super_admin') {
          navigate('/admin');
        } else if (response.data.data.role === 'driver') {
          navigate('/driver-dashboard');
        } else {
          navigate(from);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-3 mb-4">
            <div className="bg-amber-500 p-2 rounded-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold text-gray-900">Bihar Transport</h1>
              <p className="text-xs text-amber-600">Begusarai</p>
            </div>
          </Link>
          <h2 className="text-2xl font-bold text-gray-900">Welcome Back</h2>
          <p className="text-gray-600 mt-1">Sign in to your account</p>
        </div>

        {/* Toggle */}
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => setShowAdminLogin(false)}
            className={`px-4 py-2 rounded-l-lg ${!showAdminLogin ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Customer Login
          </button>
          <button
            type="button"
            onClick={() => setShowAdminLogin(true)}
            className={`px-4 py-2 rounded-r-lg ${showAdminLogin ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Admin Login
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="card">
          <div className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input-field"
                placeholder="you@example.com"
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

          {!showAdminLogin && (
            <p className="text-center text-gray-600 mt-4">
              Don't have an account?{' '}
              <Link to="/signup" className="text-amber-500 hover:underline font-medium">
                Sign Up
              </Link>
            </p>
          )}
        </form>

        {/* Demo Credentials */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <p className="text-sm font-semibold text-blue-800 mb-2">Demo Credentials:</p>
          <p className="text-sm text-blue-700">Customer: rahul.kumar@email.com</p>
          <p className="text-sm text-blue-700">Admin: admin@bihartransport.com</p>
          <p className="text-xs text-blue-600 mt-1">Password for all: password123</p>
        </div>
      </div>
    </div>
  );
}

export default Login;

