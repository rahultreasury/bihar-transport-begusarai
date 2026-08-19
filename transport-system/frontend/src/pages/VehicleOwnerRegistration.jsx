import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Check, ArrowRight, ArrowLeft, Truck, Users, MapPin, BarChart3 } from 'lucide-react';
import SEO from '../components/seo/SEO';
import { partnerAPI } from '../services/api';

const STEPS = [
  { id: 1, label: 'Account' },
  { id: 2, label: 'Vehicle' },
  { id: 3, label: 'Documents' },
  { id: 4, label: 'Review' },
];

const contextBenefits = [
  { icon: Truck, text: 'Connect your vehicle' },
  { icon: Users, text: 'Verified transport opportunities' },
  { icon: MapPin, text: 'Earn on every trip' },
  { icon: BarChart3, text: 'Track your earnings' },
];

export default function VehicleOwnerRegistration() {
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
    vehicle_number: '',
    vehicle_type: '',
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
      if (!formData.vehicle_number.trim()) newErrors.vehicle_number = 'Vehicle number is required';
      if (!formData.vehicle_type) newErrors.vehicle_type = 'Please select a vehicle type';
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
        partnership_type: 'vehicle_owner',
        company_name: formData.company_name,
        gst_number: formData.gst_number,
        pan_number: formData.pan_number,
        city: formData.city,
        state: formData.state,
        address: formData.address,
        vehicle_number: formData.vehicle_number,
        vehicle_type: formData.vehicle_type,
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
        title="Vehicle Owner Registration — Bihar Transport"
        description="Register as a vehicle owner with Bihar Transport. Connect your vehicle with more transportation opportunities."
        canonical="https://bihartransport.in/partner/vehicle-owner"
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
              Vehicle Owner Registration
            </h1>
            <p className="text-[#64748B] text-base">
              Register your vehicle with Bihar Transport and connect with verified transport opportunities.
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
                        <span className="text-xs font-bold text-[#F59E0B] uppercase tracking-widest">Vehicle Owner</span>
                        <h3 className="text-[20px] font-bold text-[#0F2747] mt-2 leading-tight">
                          Connect your vehicle with Bihar Transport.
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
                        <p className="text-[#64748B] text-sm mb-4">Enter the details of the vehicle owner.</p>
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

                    {/* Step 2: Vehicle */}
                    {currentStep === 2 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Vehicle Information</h2>
                        <p className="text-[#64748B] text-sm mb-4">Tell us about the vehicle you want to connect with Bihar Transport.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Vehicle Registration Number *</label>
                            <input
                              type="text"
                              name="vehicle_number"
                              value={formData.vehicle_number}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('vehicle_number')}
                              placeholder="e.g., BR12AB1234"
                              style={{ height: '44px' }}
                            />
                            {renderFieldError('vehicle_number')}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-[#0F2747] mb-1">Vehicle Type *</label>
                            <select
                              name="vehicle_type"
                              value={formData.vehicle_type}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              required
                              className={inputClass('vehicle_type')}
                              style={{ height: '44px' }}
                            >
                              <option value="">Select vehicle type</option>
                              <option value="Tata Ace">Tata Ace</option>
                              <option value="Tata 407">Tata 407</option>
                              <option value="Pickup Truck">Pickup Truck</option>
                              <option value="17ft Truck">17ft Truck</option>
                              <option value="19ft Truck">19ft Truck</option>
                              <option value="22ft Truck">22ft Truck</option>
                              <option value="Container 32ft">Container 32ft</option>
                              <option value="Other">Other</option>
                            </select>
                            {renderFieldError('vehicle_type')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Documents */}
                    {currentStep === 3 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Vehicle Documents</h2>
                        <p className="text-[#64748B] text-sm mb-4">Document verification will be completed after registration.</p>
                        <div className="p-5 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB] text-center">
                          <p className="text-sm text-[#64748B]">
                            No documents are required at this stage. Our team will guide you through the document verification process after your application is approved.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Review */}
                    {currentStep === 4 && (
                      <div>
                        <h2 className="text-[26px] font-bold text-[#0F2747] mb-1">Review Your Registration</h2>
                        <p className="text-[#64748B] text-sm mb-4">Please verify your information before submitting.</p>

                        {/* Owner Information */}
                        <div className="mb-4 p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Owner Information</h3>
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

                        {/* Vehicle Information */}
                        <div className="mb-4 p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Vehicle Information</h3>
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
                              <span className="text-[#64748B]">Registration Number:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.vehicle_number}</span>
                            </div>
                            <div>
                              <span className="text-[#64748B]">Vehicle Type:</span>{' '}
                              <span className="text-[#0F2747] font-medium">{formData.vehicle_type}</span>
                            </div>
                          </div>
                        </div>

                        {/* Documents */}
                        <div className="p-4 rounded-xl bg-[#F7F9FC] border border-[#E5E7EB]">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-[#0F2747] uppercase tracking-wider">Documents</h3>
                            <button
                              type="button"
                              onClick={() => setCurrentStep(3)}
                              className="text-xs font-medium text-[#F59E0B] hover:text-[#d97706] transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                          <div className="text-sm text-[#64748B]">
                            Document verification will be completed after registration.
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
                              Register Vehicle
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
