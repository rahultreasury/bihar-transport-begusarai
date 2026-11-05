import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../services/api';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tokenValid, setTokenValid] = useState(null); // null = checking, true = valid, false = invalid
  const navigate = useNavigate();

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      setError('Invalid or missing reset token');
      return;
    }
    // Token format validation (64 char hex string)
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setTokenValid(false);
      setError('Invalid reset token format');
    } else {
      setTokenValid(true);
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // Client-side validation
    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await authAPI.resetPassword({ token, password });
      if (res.data?.success) {
        setMessage('Password reset successfully.');
        // Clear form
        setPassword('');
        setConfirmPassword('');
      } else {
        setError(res.data?.message || 'Failed to reset password');
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      if (status === 400) {
        if (msg?.includes('expired')) {
          setError('This reset link has expired. Please request a new one.');
        } else if (msg?.includes('used') || msg?.includes('already')) {
          setError('This reset link has already been used. Please request a new one.');
        } else {
          setError(msg || 'Invalid or expired reset token');
        }
      } else {
        setError(err.response?.data?.message || 'Server error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking token
  if (tokenValid === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto"></div>
          <p className="text-gray-600 mt-4">Validating reset token...</p>
        </div>
      </div>
    );
  }

  // Show error if token is invalid
  if (tokenValid === false) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error || 'Invalid or expired reset token'}
          </div>
          <p className="text-gray-600 mb-4">This password reset link is invalid or has expired.</p>
          <Link to="/forgot-password" className="text-amber-500 hover:underline font-medium">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-3 mb-4">
            <div className="bg-amber-500 p-2 rounded-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold text-gray-900">Bihar Transport</h1>
              <p className="text-xs text-amber-600">Begusarai</p>
            </div>
          </Link>
          <h2 className="text-2xl font-bold text-gray-900">Create a New Password</h2>
          <p className="text-gray-600 mt-1">Your new password must be different from previous passwords</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-6">
            {message}
            <div className="mt-4">
              <Link to="/login" className="btn-primary inline-block">
                Go to Login
              </Link>
            </div>
          </div>
        )}

        {!message && (
          <form onSubmit={handleSubmit} className="card">
            <div className="space-y-4">
              <div>
                <label className="label">New Password</label>
                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  minLength={6}
                />
                <p className="text-xs text-gray-500 mt-1">At least 6 characters</p>
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary mt-6 disabled:opacity-50"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}

        <p className="text-center text-gray-600 mt-4">
          <Link to="/login" className="text-amber-500 hover:underline font-medium">
            Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ResetPassword;