import React, { useState, useCallback } from 'react';
import { adminAPI } from '../../../services/api';

const INITIAL_FORM = {
  driver_name: '',
  mobile: '',
  alternate_mobile: '',
  address: '',
  city: '',
  state: 'Bihar',
  pincode: '',
  license_number: '',
  license_expiry: '',
  license_class: '',
  joining_date: new Date().toISOString().split('T')[0]
};

export default function DriverRegisterModal({ isOpen, onClose, onSuccess }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  }, [errors]);

  const validate = useCallback(() => {
    const newErrors = {};
    if (!form.driver_name.trim()) newErrors.driver_name = 'Driver name is required';
    if (!form.mobile.trim()) newErrors.mobile = 'Mobile number is required';
    else if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) newErrors.mobile = 'Enter a valid 10-digit mobile number';
    if (!form.license_number.trim()) newErrors.license_number = 'Licence number is required';
    if (!form.license_expiry.trim()) newErrors.license_expiry = 'Licence expiry is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError('');

    try {
      const payload = {
        ...form,
        mobile: form.mobile.trim(),
        alternate_mobile: form.alternate_mobile.trim() || undefined,
        license_number: form.license_number.trim(),
        license_expiry: form.license_expiry,
        joining_date: form.joining_date || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        license_class: form.license_class.trim() || undefined
      };

      const response = await adminAPI.createDriver(payload);
      if (response.data?.success) {
        onSuccess?.(response.data.data);
        handleClose();
      } else {
        setServerError(response.data?.message || 'Failed to register driver');
      }
    } catch (err) {
      console.error('Register driver error:', err);
      setServerError(
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.msg ||
        'Server error. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, onSuccess]);

  const handleClose = useCallback(() => {
    setForm({ ...INITIAL_FORM });
    setErrors({});
    setServerError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Register New Driver"
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Register New Driver</h3>
              <p className="text-sm text-muted mt-0.5">Enter driver details for transport operations</p>
            </div>
            <button onClick={handleClose} className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-hover/60 transition" aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1">
          {serverError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
              {serverError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Driver Name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1.5">
                Driver Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="driver_name"
                value={form.driver_name}
                onChange={handleChange}
                placeholder="Full name as per licence"
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.driver_name ? 'border-red-500/50' : 'border-border/60'
                }`}
              />
              {errors.driver_name && <p className="text-xs text-red-500 mt-1">{errors.driver_name}</p>}
            </div>

            {/* Mobile */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Mobile Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                name="mobile"
                value={form.mobile}
                onChange={handleChange}
                placeholder="10-digit mobile"
                maxLength={10}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.mobile ? 'border-red-500/50' : 'border-border/60'
                }`}
              />
              {errors.mobile && <p className="text-xs text-red-500 mt-1">{errors.mobile}</p>}
            </div>

            {/* Alternate Mobile */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Alternate Mobile</label>
              <input
                type="tel"
                name="alternate_mobile"
                value={form.alternate_mobile}
                onChange={handleChange}
                placeholder="Optional"
                maxLength={10}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            {/* Licence Number */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Driving Licence No. <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="license_number"
                value={form.license_number}
                onChange={handleChange}
                placeholder="e.g. BR01 20240012345"
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.license_number ? 'border-red-500/50' : 'border-border/60'
                }`}
              />
              {errors.license_number && <p className="text-xs text-red-500 mt-1">{errors.license_number}</p>}
            </div>

            {/* Licence Expiry */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Licence Expiry <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="license_expiry"
                value={form.license_expiry}
                onChange={handleChange}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.license_expiry ? 'border-red-500/50' : 'border-border/60'
                }`}
              />
              {errors.license_expiry && <p className="text-xs text-red-500 mt-1">{errors.license_expiry}</p>}
            </div>

            {/* Licence Class */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Licence Class</label>
              <select
                name="license_class"
                value={form.license_class}
                onChange={handleChange}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              >
                <option value="">Select class</option>
                <option value="HTV">HTV (Heavy Transport Vehicle)</option>
                <option value="LMV">LMV (Light Motor Vehicle)</option>
                <option value="MCWG">MCWG (Motorcycle)</option>
                <option value="MCWOG">MCWOG (Motorcycle without Gear)</option>
                <option value="HMV">HMV (Heavy Motor Vehicle)</option>
              </select>
            </div>

            {/* Joining Date */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Joining Date</label>
              <input
                type="date"
                name="joining_date"
                value={form.joining_date}
                onChange={handleChange}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium mb-1.5">City</label>
              <input
                type="text"
                name="city"
                value={form.city}
                onChange={handleChange}
                placeholder="e.g. Begusarai"
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            {/* State */}
            <div>
              <label className="block text-sm font-medium mb-1.5">State</label>
              <input
                type="text"
                name="state"
                value={form.state}
                onChange={handleChange}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            {/* Pincode */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Pincode</label>
              <input
                type="text"
                name="pincode"
                value={form.pincode}
                onChange={handleChange}
                placeholder="6-digit pincode"
                maxLength={6}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            {/* Address - full width */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1.5">Address</label>
              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="Current residential address"
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition resize-none"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-5 mt-4 border-t border-border/60">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Registering...
                </>
              ) : (
                'Register Driver'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

