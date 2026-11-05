import { useState, useContext } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Truck } from 'lucide-react';
import SEO from '../components/seo/SEO';
import { AuthContext } from '../contexts/AuthContext';
import { authAPI } from '../services/api';

export default function PartnerLogin() {
  const { login } = useContext(AuthContext);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/partner/dashboard';

  const validateField = (name, value) => {
    if (name === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Please enter a valid email address';
    }
    if (name === 'password' && value && value.length < 6) {
      return 'Password must be at least 6 characters';
    }
    return '';
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    const fieldError = validateField(name, value);
    setFieldErrors(prev => ({ ...prev, [name]: fieldError }));
    if (error) setError('');
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    const fieldError = validateField(name, value);
    setFieldErrors(prev => ({ ...prev, [name]: fieldError }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const emailError = validateField('email', formData.email);
    const passwordError = validateField('password', formData.password);
    const newFieldErrors = { email: emailError, password: passwordError };
    setFieldErrors(newFieldErrors);

    if (emailError || passwordError || !formData.email || !formData.password) {
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.partnerLogin(formData);
      if (res.data?.success) {
        const { token, data } = res.data;
        login(data, token);
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
      <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white rounded-[20px] border border-[#15345B]/8 shadow-[0_4px_24px_rgba(15,43,85,0.08)] p-8 md:p-10">
            {/* Brand Header */}
            <div className="text-center mb-10">
              <Link to="/" className="inline-flex items-center gap-2 mb-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#F5A000] to-[#e8941a] text-white">
                  <Truck className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="text-2xl font-bold text-[#15345B]">Bihar Transport</span>
              </Link>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#F5A000] mb-3">PARTNER PLATFORM</p>
              <h1 className="text-2xl font-bold text-[#15345B] mb-2">Welcome back</h1>
              <p className="text-[#15345B]/60 text-sm">
                Sign in to manage your transport operations.
              </p>
            </div>

            {/* Error State */}
            {error && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3" role="alert">
                <svg className="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-[#15345B] mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  autoComplete="email"
                  disabled={loading}
                  className={`w-full px-4 py-3 rounded-xl border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000] transition-all duration-200 ${
                    fieldErrors.email ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-[#15345B]/15'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  placeholder="your@email.com"
                  aria-invalid={fieldErrors.email ? 'true' : 'false'}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                />
                {fieldErrors.email && (
                  <p id="email-error" className="mt-1.5 text-sm text-red-600" role="alert">{fieldErrors.email}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-semibold text-[#15345B]">
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-[#F5A000] font-semibold hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                    className={`w-full px-4 py-3 rounded-xl border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000] transition-all duration-200 pr-12 ${
                      fieldErrors.password ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-[#15345B]/15'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    placeholder="Enter your password"
                    aria-invalid={fieldErrors.password ? 'true' : 'false'}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#15345B]/50 hover:text-[#15345B] transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" className="mt-1.5 text-sm text-red-600" role="alert">{fieldErrors.password}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#F5A000] text-white px-8 py-3.5 rounded-xl font-semibold hover:bg-[#e8941a] transition-all duration-300 shadow-lg shadow-[#F5A000]/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-[#F5A000]/40 focus:ring-offset-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {/* Become a Partner Link */}
            <div className="mt-8 text-center text-sm text-[#15345B]/60">
              <p>
                Don't have an account?{' '}
                <Link to="/partner" className="text-[#F5A000] font-semibold hover:underline">
                  Become a Partner
                </Link>
              </p>
            </div>
          </div>

          {/* Trust indicator */}
          <p className="mt-6 text-center text-xs text-[#15345B]/40">
            Secure partner portal &mdash; Your data is protected
          </p>
        </div>
      </div>
    </>
  );
}
