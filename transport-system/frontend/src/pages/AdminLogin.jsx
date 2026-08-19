import { useState, useContext, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Truck,
  Shield,
  CheckCircle,
  ArrowRight,
  Loader2,
  AlertCircle,
  MapPin,
  Target,
  BarChart3,
} from 'lucide-react';
import { AuthContext } from '../App';
import { authAPI } from '../services/api';

// ─── Floating background shape component ────────────────────
function FloatingShape({ Icon, color, size, x, y, duration, delay }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0.08, 0.15, 0.08],
        scale: [1, 1.15, 1],
        y: [0, -18, 0],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      <Icon size={size} className={color} strokeWidth={1.5} />
    </motion.div>
  );
}

// ─── Feature item for left panel ────────────────────────────
function FeatureItem({ icon: Icon, text, delay }) {
  return (
    <motion.li
      className="flex items-center gap-3 text-white/80"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5, ease: 'easeOut' }}
    >
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white/15 flex items-center justify-center">
        <CheckCircle size={14} className="text-emerald-400" />
      </span>
      <span className="text-sm font-medium">{text}</span>
    </motion.li>
  );
}

// ─── Show / Hide password button ────────────────────────────
function PasswordToggle({ visible, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-md p-0.5"
      aria-label={visible ? 'Hide password' : 'Show password'}
      tabIndex={-1}
    >
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}

// ─── Input field with floating label ────────────────────────
function FloatingInput({
  id,
  label,
  type,
  value,
  onChange,
  icon: Icon,
  error,
  children,
}) {
  const [focused, setFocused] = useState(false);
  const hasValue = value && value.length > 0;

  return (
    <div className="relative">
      <div
        className={`relative flex items-center border-2 rounded-xl transition-all duration-200 ${
          focused
            ? 'border-blue-500 shadow-sm shadow-blue-500/10'
            : error
            ? 'border-red-300 bg-red-50/30'
            : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        {/* Icon */}
        <div
          className={`pl-4 transition-colors duration-200 ${
            focused ? 'text-blue-500' : error ? 'text-red-400' : 'text-slate-400'
          }`}
        >
          <Icon size={18} />
        </div>

        {/* Input */}
        <div className="relative flex-1">
          <input
            id={id}
            type={type}
            name={id}
            value={value}
            onChange={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            required
            autoComplete={id === 'email' ? 'email' : 'current-password'}
            className="w-full bg-transparent px-3 py-4 text-slate-900 text-sm outline-none placeholder-transparent peer"
            placeholder={label}
            autoFocus={id === 'email'}
          />
          {/* Floating label */}
          <label
            htmlFor={id}
            className={`absolute left-3 transition-all duration-200 pointer-events-none ${
              focused || hasValue
                ? '-top-2.5 text-xs bg-white px-1 text-blue-600 font-medium'
                : 'top-4 text-sm text-slate-400'
            } ${error ? 'text-red-500' : ''}`}
          >
            {label}
          </label>
        </div>

        {/* Children (e.g., password toggle) */}
        {children}
      </div>
    </div>
  );
}

// ─── Main AdminLogin Component ──────────────────────────────
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
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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

  const handleChange = useCallback(
    (e) => {
      setFormData((prev) => ({
        ...prev,
        [e.target.name]: e.target.value,
      }));
    },
    []
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authAPI.adminLogin(formData);
      if (response?.data?.success) {
        login(response.data.data, response.data.token);
        navigate('/admin', { replace: true });
      } else {
        throw new Error(response?.data?.message || 'Admin login failed');
      }
    } catch (err) {
      if (err._isTimeout) {
        setError('The server is taking too long to respond. Please try again.');
      } else if (err._isNetworkError) {
        setError('Unable to connect to the server. Please try again.');
      } else if (err?.response?.status === 401) {
        setError(err?.response?.data?.message || 'Invalid credentials');
      } else {
        setError(
          err?.response?.data?.message || err?.message || 'Admin login failed'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="min-h-screen flex"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* ─── LEFT PANEL — Brand / Illustration ──────────────── */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-blue-900">
        {/* Animated background shapes */}
        <FloatingShape
          Icon={Truck}
          color="text-white/10"
          size={120}
          x="8%"
          y="12%"
          duration={7}
          delay={0}
        />
        <FloatingShape
          Icon={MapPin}
          color="text-white/8"
          size={90}
          x="72%"
          y="18%"
          duration={9}
          delay={1.2}
        />
        <FloatingShape
          Icon={Target}
          color="text-white/8"
          size={70}
          x="15%"
          y="68%"
          duration={8}
          delay={0.6}
        />
        <FloatingShape
          Icon={BarChart3}
          color="text-white/8"
          size={100}
          x="65%"
          y="72%"
          duration={10}
          delay={0.3}
        />

        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.06),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.15),transparent_50%)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-16 w-full">
          {/* Logo + Brand */}
          <motion.div
            className="flex items-center gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
              <Truck size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Bihar Transport
              </h1>
              <p className="text-xs text-blue-200/80 font-medium tracking-wider uppercase">
                Begusarai
              </p>
            </div>
          </motion.div>

          {/* Tagline */}
          <motion.p
            className="text-white/90 text-xl font-semibold leading-snug mb-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          >
            India's Trusted Transport
            <br />
            Management Platform
          </motion.p>
          <motion.p
            className="text-blue-200/70 text-sm mb-10 leading-relaxed max-w-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: 'easeOut' }}
          >
            Streamline your logistics operations with powerful tools for booking,
            tracking, and managing your entire fleet from one dashboard.
          </motion.p>

          {/* Features */}
          <ul className="space-y-4">
            <FeatureItem
              icon={CheckCircle}
              text="Secure Booking Management"
              delay={0.35}
            />
            <FeatureItem
              icon={CheckCircle}
              text="Driver Management"
              delay={0.45}
            />
            <FeatureItem
              icon={CheckCircle}
              text="Vehicle Tracking"
              delay={0.55}
            />
            <FeatureItem
              icon={CheckCircle}
              text="Real-time Analytics"
              delay={0.65}
            />
          </ul>

          {/* Bottom branding */}
          <motion.div
            className="mt-auto pt-12 text-blue-200/50 text-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
          >
            <span className="flex items-center gap-1.5">
              <Shield size={12} />
              Enterprise-grade security · ISO 27001
            </span>
          </motion.div>
        </div>
      </div>

      {/* ─── RIGHT PANEL — Login Card ──────────────────────── */}
      <div className="w-full lg:w-[55%] flex items-center justify-center bg-slate-50 p-4 md:p-8">
        <motion.div
          className="w-full max-w-[440px]"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
        >
          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-8 md:p-10">
            {/* Logo (mobile visible, desktop hidden on left) */}
            <motion.div
              className="flex items-center gap-3 mb-8 lg:mb-8"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
                <Truck size={20} className="text-white" />
              </div>
              <div>
                <span className="text-lg font-bold text-slate-900">
                  Bihar Transport
                </span>
                <span className="block text-[10px] text-blue-600 font-medium uppercase tracking-wider">
                  Admin Portal
                </span>
              </div>
            </motion.div>

            {/* Heading */}
            <motion.div
              className="mb-8"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Welcome Back
              </h2>
              <p className="text-slate-500 mt-1.5 text-sm">
                Sign in to your admin account to manage your transport operations.
              </p>
            </motion.div>

            {/* Error message */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 mb-6"
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.25 }}
                  role="alert"
                >
                  <AlertCircle
                    size={18}
                    className="text-red-500 mt-0.5 flex-shrink-0"
                  />
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-5">
                {/* Email */}
                <div>
                  <FloatingInput
                    id="email"
                    label="Admin Email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    icon={Mail}
                    error={error && !formData.email}
                  />
                </div>

                {/* Password */}
                <div>
                  <FloatingInput
                    id="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleChange}
                    icon={Lock}
                    error={error && !formData.password}
                  >
                    <PasswordToggle
                      visible={showPassword}
                      onToggle={() =>
                        setShowPassword((prev) => !prev)
                      }
                    />
                  </FloatingInput>
                </div>

                {/* Remember me + Forgot password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) =>
                          setRememberMe(e.target.checked)
                        }
                        className="peer sr-only"
                      />
                      <div className="w-4 h-4 rounded border-2 border-slate-300 peer-checked:border-blue-600 peer-checked:bg-blue-600 transition-all duration-150 group-hover:border-slate-400 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/40" />
                      {/* Checkmark */}
                      <svg
                        className="absolute top-0 left-0 w-4 h-4 text-white pointer-events-none scale-0 peer-checked:scale-100 transition-transform duration-150"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3.5 8.5L6.5 11.5L12.5 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <span className="text-sm text-slate-600 group-hover:text-slate-700 transition-colors select-none">
                      Remember me
                    </span>
                  </label>
                  <a
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-md"
                  >
                    Forgot password?
                  </a>
                </div>

                {/* Submit button */}
                <motion.button
                  type="submit"
                  disabled={loading}
                  className="relative w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold text-sm shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/25 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 overflow-hidden group"
                  whileTap={{ scale: loading ? 1 : 0.98 }}
                >
                  {/* Ripple effect on hover */}
                  <span className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />

                  <span className="relative flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <Loader2
                          size={18}
                          className="animate-spin"
                        />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                      </>
                    )}
                  </span>
                </motion.button>
              </div>
            </form>

            {/* Customer login link */}
            <motion.div
              className="mt-6 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.4 }}
            >
              <p className="text-sm text-slate-500">
                Back to{' '}
                <Link
                  to="/login"
                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded-md"
                >
                  Customer Login
                </Link>
              </p>
            </motion.div>

            {/* Security badge */}
            <motion.div
              className="mt-8 pt-6 border-t border-slate-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.5 }}
            >
              <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                <Shield size={14} className="text-emerald-500" />
                <span>
                  Secured with{' '}
                  <span className="font-medium text-slate-500">
                    Enterprise Authentication
                  </span>
                </span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default AdminLogin;

