import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

function Signup() {
  const navigate = useNavigate();
  const [userType, setUserType] = useState('customer');
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    address: '',
    city: 'Begusarai',
    // Driver specific fields
    license_number: '',
    license_expiry: '',
    aadhar_number: '',
    date_of_birth: '',
    gender: 'male',
    experience_years: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { confirmPassword, ...data } = formData;
      
      let response;
      if (userType === 'driver') {
        response = await authAPI.driverSignup(data);
      } else {
        response = await authAPI.signup(data);
      }

      if (response.data.success) {
        navigate('/login', { state: { message: 'Registration successful! Please login.' } });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-lg w-full">
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
          <h2 className="text-2xl font-bold text-gray-900">Create Account</h2>
          <p className="text-gray-600 mt-1">Register to book transport services</p>
        </div>

        {/* User Type Selection */}
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => setUserType('customer')}
            className={`px-4 py-2 rounded-l-lg ${userType === 'customer' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Customer
          </button>
          <button
            type="button"
            onClick={() => setUserType('driver')}
            className={`px-4 py-2 rounded-r-lg ${userType === 'driver' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Driver
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="card">
          {/* Common Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">First Name *</label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleChange}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="label">Last Name *</label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleChange}
                  className="input-field"
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Email Address *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input-field"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Phone Number *</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="9876543210"
                  maxLength={10}
                  required
                />
              </div>
              <div>
                <label className="label">City</label>
                <select
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="Begusarai">Begusarai</option>
                  <option value="Patna">Patna</option>
                  <option value="Muzaffarpur">Muzaffarpur</option>
                  <option value="Gaya">Gaya</option>
                  <option value="Darbhanga">Darbhanga</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Address</label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
                className="input-field"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Password *</label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="input-field"
                  minLength={6}
                  required
                />
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="input-field"
                  required
                />
              </div>
            </div>
          </div>

          {/* Driver Specific Fields */}
          {userType === 'driver' && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="font-semibold mb-4">Driver Information</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">License Number *</label>
                    <input
                      type="text"
                      name="license_number"
                      value={formData.license_number}
                      onChange={handleChange}
                      className="input-field"
                      required={userType === 'driver'}
                    />
                  </div>
                  <div>
                    <label className="label">License Expiry *</label>
                    <input
                      type="date"
                      name="license_expiry"
                      value={formData.license_expiry}
                      onChange={handleChange}
                      className="input-field"
                      required={userType === 'driver'}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Aadhar Number *</label>
                    <input
                      type="text"
                      name="aadhar_number"
                      value={formData.aadhar_number}
                      onChange={handleChange}
                      className="input-field"
                      maxLength={12}
                      placeholder="123456789012"
                      required={userType === 'driver'}
                    />
                  </div>
                  <div>
                    <label className="label">Date of Birth *</label>
                    <input
                      type="date"
                      name="date_of_birth"
                      value={formData.date_of_birth}
                      onChange={handleChange}
                      className="input-field"
                      required={userType === 'driver'}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Gender *</label>
                    <select
                      name="gender"
                      value={formData.gender}
                      onChange={handleChange}
                      className="input-field"
                      required={userType === 'driver'}
                    >
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Experience (Years)</label>
                    <input
                      type="number"
                      name="experience_years"
                      value={formData.experience_years}
                      onChange={handleChange}
                      className="input-field"
                      min={0}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary mt-6 disabled:opacity-50"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <p className="text-center text-gray-600 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-amber-500 hover:underline font-medium">
              Sign In
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default Signup;

