import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Check, ArrowRight, ArrowLeft, Truck, Users, MapPin, BarChart3 } from 'lucide-react';
import SEO from '../components/seo/SEO';
import { partnerAPI } from '../services/api';

const STEPS = [
  { id: 1, label: 'Account' },
  { id: 2, label: 'Business' },
  { id: 3, label: 'Operations' },
  { id: 4, label: 'Review' },
];

const contextBenefits = [
  { icon: Truck, text: 'Manage your vehicles' },
  { icon: Users, text: 'Connect drivers' },
  { icon: MapPin, text: 'Access transport opportunities' },
  { icon: BarChart3, text: 'Track your fleet' },
];

export default function TransportOwnerRegistration() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    company_name: '',
    gst_number: '',
    pan_number: '',
    city: '',
    state: 'Bihar',
    address: '',
    number_of_vehicles: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [applicationId, setApplicationId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
  };

  const validateStep = (step) => {
    const newErrors = {};
    if (step === 1) {
      if (!formData.first_name.trim()) newErrors.first_name = 'First name is required';
      if (!formData.last_name.trim()) newErrors.last_name = 'Last name is required';
      if (!formData.email.trim()) newErrors.email = 'Email is required';
      else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Enter a valid email';
      if (!formData.phone.trim()) newErrors.phone = 'Phone number is required';
      else if (!/^[6-9]\d{9}$/.test(formData.phone)) newErrors.phone = 'Enter a valid 10-digit mobile number';
      if (!formData.password) newErrors.password = 'Password is required';
      else if (formData.password.length < 8) newErrors.password = 'Use at least 8 characters';
      if (!formData.confirmPassword) newErrors.confirmPassword = 'Please confirm your password';
      else if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    }
    if (step === 2) {
      if (!formData.company_name.trim()) newErrors.company_name = 'Company name is required';
      if (!formData.city.trim()) newErrors.city = 'City is required';
      if (!formData.address.trim()) newErrors.address = 'Address is required';
    }
    if (step === 3) {
      if (!formData.number_of_vehicles || parseInt(formData.number_of_vehicles) < 1) {
        newErrors.number_of_vehicles = 'Enter a valid number of vehicles';
      }
    }
    return newErrors;
  };

  const [errors, setErrors] = useState({});

  const handleNext = () => {
    const stepErrors = validateStep(currentStep);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    setLoading(true);
    try {
      const payload = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        partnership_type: 'transport_owner',
        company_name: formData.company_name,
        gst_number: formData.gst_number,
        pan_number: formData.pan_number,
        city: formData.city,
        state: formData.state,
        address: formData.address,
        number_of_vehicles: formData.number_of_vehicles,
      };

      const res = await partnerAPI.apply(payload);
      if (res.data?.success) {
        setSuccess('Application submitted successfully! Our team will review it shortly.');
        setApplicationId(res.data.data.application_id);
      } else {
        setError(res.data?.message || 'Failed to submit application');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Server error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderFieldError = (fieldName) => {
    if (errors[fieldName] && touched[fieldName]) {
      return <p className="mt-1 text-xs text-red-600">{errors[fieldName]}</p>;
    }
    return null;
  };

  const inputClass = (fieldName) =>
    `w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/30 focus:border-[#F59E0B] transition-all ${
      errors[fieldName] && touched[fieldName]
        ? 'border-red-300'
        : 'border-[#E5E7EB]'
    }`;

  return (
    <>
      <SEO
        title="Transport Owner Registration — Bihar Transport"
        description="Register as a transport owner with Bihar Transport. Expand your fleet and get more business opportunities."
        canonical="https://bihartransport.in/partner/transport-owner"
      />
      <div className="min-h-screen bg-[#F7F9FC]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 md:pt-7 pb-12 md:pb-16">
          {/* Back Navigation */}
          <Link
            to="/partner"
            className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F2747] transition-colors mb-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Become a Partner
          </Link>

          {/* Compact Header */}
          <div className="mb-4">
            <h1 className="text-[36px] font-bold text-[#0F2747] mb-1 tracking-tight leading-[1.1]">
              Transport Owner Registration
            </h1>
            <p className="text-[#64748B] text-base">
              Create your Bihar Transport partner account
            </p>
          </div>

          {/* Compact Progress Navigation */}
          <div className="mb-5">
            <div className="flex items-center">
              {STEPS.map((step, index) => (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                        currentStep > step.id
                          ? 'bg-green-500 text-white'
                          : currentStep === step.id
                          ? 'bg-[#F59E0B] text-white'
                          : 'bg-[#E5E7EB] text-[#64748B]'
                      }`}
                    >
                      {currentStep > step.id ? <Check className="w-3.5 h-3.5" /> : step.id}
                    </div>
                    <span
                      className={`mt-1 text-[13px] font-medium ${
                        currentStep >= step.id ? 'text-[#0F2747]' : 'text-[#64748B]'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className="w-6 sm:w-8 mx-1">
                      <div className="h-0.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            currentStep > step.id ? 'bg-green-500 w-full' : 'bg-transparent w-0'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-green-800 mb-2">Application Submitted!</h3>
              <p className="text-green-700 mb-4">{success}</p>
              {applicationId && (
                <p className="text-sm text-green-600">
                  Application ID: <span className="font-mono font-bold">#{applicationId}</span>
                </p>
              )}
              <p className="text-sm text-green-600 mt-2">
                Our team will review your application and contact you within 2-3 business days.
              </p>
            </div>
          )}

          {/* Form Steps */}
          {!success && (
            <form onSubmit={currentStep === 4 ? handleSubmit : (e) => e.preventDefault()}>
              <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm">
                {error && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                  {/* Left Context Panel */}
                  <div className="hidden lg:block lg:col-span-4 xl:col-span-4 border-b lg:border-b-0 lg:border-r border-[#E5E7EB]">
                    <div className="p-6 xl:p-8">
                      <div className="mb-4">
                        <span className="text-xs font-bold text-[#F59E0B] uppercase tracking-widest">Transport Owner</span>
                        <h3 className="text-[20px] font-bold text-[#0F2747] mt-2 leading-tight">
                          Manage your transport business through Bihar Transport.
                        </h3>
                      </div>
                      <div className="space-y-2.5">
                        {contextBenefits.map((benefit) => {
                          const Icon = benefit.icon;
                          return (
                            <div key={benefit.text} className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-7 h-7 rounded-md bg-[#F7F9FC] border border-[#E5E7EB] flex items-center justify-center">
                                <Icon className="w-3.5 h-3.5 text-[#0F2747]" />
                              </div>
                              <span className="text-sm text-[#64748B] leading-snug pt-0.5">{benefit.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Form Area */}
                  <div className="lg:col-span-8 xl:col-span-8 p-5 md:p-6 xl:p-6">
                    {/* Step 1: Account */}
                    {currentStep === 1 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Account Information</h2>
                        <p className="text-[#64748B] text-sm mb-4">Enter the details of the person who will manage this transport account.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">First Name *</label>
                            <input
                              type="text"
                              name="first_name"
                              value={formData.first_name}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('first_name')}
                              placeholder="Enter your first name"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('first_name')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Last Name *</label>
                            <input
                              type="text"
                              name="last_name"
                              value={formData.last_name}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('last_name')}
                              placeholder="Enter your last name"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('last_name')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Email *</label>
                            <input
                              type="email"
                              name="email"
                              value={formData.email}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('email')}
                              placeholder="your@email.com"
                              autoComplete="email"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('email')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Mobile Number *</label>
                            <input
                              type="tel"
                              name="phone"
                              value={formData.phone}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              pattern="[6-9][0-9]{9}"
                              className={inputClass('phone')}
                              placeholder="10-digit mobile number"
                              autoComplete="tel"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('phone')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Password *</label>
                            <div className="relative">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                onBlur={handleBlur}
                                required
                                minLength={8}
                                className={inputClass('password')}
                                placeholder="Min. 8 characters"
                                autoComplete="new-password"
                                style={{ height: '44px' }}
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F2747]"
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            {!errors.password && formData.password.length > 0 && (
                              <p className="mt-1 text-xs text-[#64748B]">Use at least 8 characters.</p>
                            )}
                            {renderFieldError('password')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Confirm Password *</label>
                            <div className="relative">
                              <input
                                type={showConfirmPassword ? 'text' : 'password'}
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                onBlur={handleBlur}
                                required
                                className={inputClass('confirmPassword')}
                                placeholder="Re-enter password"
                                autoComplete="new-password"
                                style={{ height: '44px' }}
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F2747]"
                              >
                                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            {renderFieldError('confirmPassword')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Business */}
                    {currentStep === 2 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Business Information</h2>
                        <p className="text-[#64748B] text-sm mb-4">Tell us about your transport business.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Company Name *</label>
                            <input
                              type="text"
                              name="company_name"
                              value={formData.company_name}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('company_name')}
                              placeholder="Your company name"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('company_name')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">GST Number</label>
                            <input
                              type="text"
                              name="gst_number"
                              value={formData.gst_number}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClass('gst_number')}
                              placeholder="GSTIN (optional)"
                              style={{ height: '44px' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">PAN Number</label>
                            <input
                              type="text"
                              name="pan_number"
                              value={formData.pan_number}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClass('pan_number')}
                              placeholder="PAN (optional)"
                              style={{ height: '44px' }}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">City *</label>
                            <input
                              type="text"
                              name="city"
                              value={formData.city}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('city')}
                              placeholder="Your city"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('city')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">State</label>
                            <select
                              name="state"
                              value={formData.state}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              className={inputClass('state')}
                              style={{ height: '44px' }}
                            >
                              <option value="Bihar">Bihar</option>
                              <option value="Jharkhand">Jharkhand</option>
                              <option value="Uttar Pradesh">Uttar Pradesh</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Address *</label>
                            <textarea
                              name="address"
                              value={formData.address}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              rows={2}
                              className={inputClass('address')}
                              placeholder="Your full address"
                            />
                            {renderFieldError('address')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Operations */}
                    {currentStep === 3 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Transport Operations</h2>
                        <p className="text-[#64748B] text-sm mb-4">Help us understand your current transport operations.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Number of Vehicles *</label>
                            <input
                              type="number"
                              name="number_of_vehicles"
                              value={formData.number_of_vehicles}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              min="1"
                              className={inputClass('number_of_vehicles')}
                              placeholder="How many vehicles do you have?"
                              style={{ height: '44px', maxWidth: '420px' }}
                            />
                            {renderFieldError('number_of_vehicles')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Review */}
                    {currentStep === 4 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Review & Submit</h2>
                        <p className="text-[#64748B] text-sm mb-4">Please verify your information before submitting.</p>

                        {/* Account Information */}
                        <div className="mb-4 p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Account Information</h3>
                            <button
                              type="button"
                              onClick={() => setCurrentStep(1)}
                              className="text-xs font-medium text-[#F59E0B] hover:text-[#d97706] transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-[#64748B]">Name:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.first_name} {formData.last_name}</span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">Email:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.email}</span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">Phone:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.phone}</span>
                            </div>
                          </div>
                        </div>

                        {/* Business Information */}
                        <div className="mb-4 p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Business Information</h3>
                            <button
                              type="button"
                              onClick={() => setCurrentStep(2)}
                              className="text-xs font-medium text-[#F59E0B] hover:text-[#d97706] transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-[#64748B]">Company:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.company_name}</span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">City:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.city}</span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">State:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.state}</span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-[#64748B]">Address:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.address}</span>
                            </div>
                          </div>
                        </div>

                        {/* Transport Operations */}
                        <div className="p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Transport Operations</h3>
                            <button
                              type="button"
                              onClick={() => setCurrentStep(3)}
                              className="text-xs font-medium text-[#F59E0B] hover:text-[#d97706] transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                          <div className="text-sm">
                            <span className="text-[#64748B]">Number of Vehicles:</span>{' '}
                            <span className="text-[#0F2747] font-medium">{formData.number_of_vehicles}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3 mt-4">
                      {currentStep > 1 && (
                        <button
                          type="button"
                          onClick={handleBack}
                          className="inline-flex items-center justify-center gap-2 border-2 border-[#E5E7EB] text-[#0F2747] px-5 py-2 rounded-xl font-semibold hover:bg-[#F7F9FC] hover:border-[#0F2747]/20 transition-all duration-300"
                          style={{ height: '44px', minWidth: '100px' }}
                        >
                          <ArrowLeft className="w-4 h-4" />
                          Back
                        </button>
                      )}
                      {currentStep < 4 ? (
                        <button
                          type="button"
                          onClick={handleNext}
                          className="inline-flex items-center justify-center gap-2 bg-[#F59E0B] text-white px-6 py-2 rounded-xl font-semibold hover:bg-[#d97706] transition-all duration-300 shadow-lg shadow-[#F59E0B]/20"
                          style={{ height: '44px', minWidth: '150px' }}
                        >
                          Continue
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={loading}
                          className="inline-flex items-center justify-center gap-2 bg-[#F59E0B] text-white px-6 py-2 rounded-xl font-semibold hover:bg-[#d97706] transition-all duration-300 shadow-lg shadow-[#F59E0B]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ height: '44px', minWidth: '150px' }}
                        >
                          {loading ? (
                            <>
                              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Submitting...
                            </>
                          ) : (
                            <>
                              Submit Registration
                              <ArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
