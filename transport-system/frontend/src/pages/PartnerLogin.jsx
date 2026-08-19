import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import SEO from '../components/seo/SEO';
import { authAPI } from '../services/api';
import { setStoredAuth } from '../services/authStorage';

export default function PartnerLogin() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/partner/dashboard';

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.email || !formData.password) {
      setError('Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.partnerLogin(formData);
      if (res.data?.success) {
        const { token, data } = res.data;
        setStoredAuth(token, data);
        navigate(from, { replace: true });
      } else {
        setError(res.data?.message || 'Invalid credentials');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Server error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEO
        title="Partner Login — Bihar Transport"
        description="Login to your Bihar Transport partner account."
        canonical="https://bihartransport.in/partner/login"
      />
      <div className="min-h-screen bg-[#F4F7FB] flex items-center justify-center">
        <div className="w-full max-w-md mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl border border-[#1e3a5f]/8 shadow-lg p-8 md:p-10">
            {/* Header */}
            <div className="text-center mb-8">
              <Link to="/" className="inline-block mb-4">
                <span className="text-2xl font-bold text-[#0F2B55]">Bihar Transport</span>
              </Link>
              <h1 className="text-2xl font-bold text-[#0F2B55] mb-2">Partner Login</h1>
              <p className="text-[#1e3a5f]/60 text-sm">
                Access your partner dashboard
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#1e3a5f] mb-1.5">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-[#1e3a5f]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A623]/30 focus:border-[#F5A623]"
                  placeholder="your@email.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#1e3a5f] mb-1.5">Password</label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-[#1e3a5f]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A623]/30 focus:border-[#F5A623]"
                  placeholder="Enter your password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#F5A623] text-white px-8 py-3.5 rounded-xl font-semibold hover:bg-[#e8941a] transition-all duration-300 shadow-lg shadow-[#F5A623]/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-[#1e3a5f]/60">
              <p>
                Not registered yet?{' '}
                <Link to="/partner" className="text-[#F5A623] font-semibold hover:underline">
                  Become a Partner
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
