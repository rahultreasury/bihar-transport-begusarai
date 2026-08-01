import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../../services/api';

const INITIAL_FORM = {
  driver_name: '',
  mobile: '',
  alternate_mobile: '',
  city: '',
  state: 'Bihar',
  address: ''
};

export default function DriverRegisterModal({ isOpen, onClose, onSuccess, driver, mode = 'create' }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [existingDriver, setExistingDriver] = useState(null);

  const isEdit = mode === 'edit' && driver;

  // Pre-fill form when editing
  useEffect(() => {
    if (isOpen) {
      if (isEdit) {
        setForm({
          driver_name: driver.driver_name || '',
          mobile: driver.mobile || '',
          alternate_mobile: driver.alternate_mobile || '',
          city: driver.city || '',
          state: driver.state || 'Bihar',
          address: driver.address || ''
        });
      } else {
        setForm({ ...INITIAL_FORM });
      }
      setErrors({});
      setServerError('');
      setExistingDriver(null);
    }
  }, [isOpen, isEdit, driver]);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  }, [errors]);

  const validate = useCallback(() => {
    const newErrors = {};
    if (!form.driver_name.trim()) {
      newErrors.driver_name = 'Driver name is required';
    }
    if (!form.mobile.trim()) {
      newErrors.mobile = 'Mobile number is required';
    } else if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) {
      newErrors.mobile = 'Enter a valid 10-digit mobile number';
    }
    // All other fields are optional - no validation needed
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
        driver_name: form.driver_name.trim(),
        mobile: form.mobile.trim(),
        alternate_mobile: form.alternate_mobile.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state || 'Bihar',
        address: form.address.trim() || undefined
      };

      let response;
      if (isEdit) {
        response = await adminAPI.updateDriver(driver.driver_id, payload);
      } else {
        response = await adminAPI.createDriver(payload);
      }

      if (response.data?.success) {
        onSuccess?.(response.data.data);
        handleClose();
      } else {
        setServerError(response.data?.message || `Failed to ${isEdit ? 'update' : 'register'} driver`);
      }
    } catch (err) {
      console.error('Driver save error:', err);
      const errorMsg = err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Server error. Please try again.';
      setServerError(errorMsg);

      // Handle "Driver already exists" with existing driver data
      if (err.response?.status === 409 && err.response?.data?.data) {
        setExistingDriver(err.response.data.data);
      }
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, isEdit, driver, onSuccess]);

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
        aria-label={isEdit ? 'Edit Driver' : 'Register New Driver'}
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">{isEdit ? 'Edit Driver' : 'Register New Driver'}</h3>
              <p className="text-sm text-muted mt-0.5">
                {isEdit
                  ? `Updating ${driver.driver_name}`
                  : 'Register a driver from your transport network. Only name and mobile are required.'}
              </p>
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

          {/* Driver Already Exists Warning */}
          {existingDriver && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-amber-800 dark:text-amber-300">Driver already exists</h4>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    A driver with this mobile number is already registered
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                      {existingDriver.driver_name?.charAt(0) || 'D'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 truncate">
                        {existingDriver.driver_name}
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                        {existingDriver.driver_code} • {existingDriver.mobile}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      navigate(`/admin/drivers/${existingDriver.driver_id}`);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Open Existing Driver
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Required Fields Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Required Information</span>
            </div>
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
                  placeholder="Full name of the driver"
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
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.mobile ? 'border-red-500/50' : 'border-border/60'
                  }`}
                />
                {errors.mobile && <p className="text-xs text-red-500 mt-1">{errors.mobile}</p>}
              </div>

              {/* Alternate Mobile */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Alternate Mobile <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="tel"
                  name="alternate_mobile"
                  value={form.alternate_mobile}
                  onChange={handleChange}
                  placeholder="Alternate contact number"
                  maxLength={10}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>
          </div>

{/* Optional Section - Contact & Location */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Contact & Location (Optional)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Alternate Mobile <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="tel"
                  name="alternate_mobile"
                  value={form.alternate_mobile}
                  onChange={handleChange}
                  placeholder="Alternate contact number"
                  maxLength={10}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  City <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  placeholder="e.g. Begusarai"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  State <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="state"
                  value={form.state}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1.5">
                  Address <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <textarea
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  rows={2}
                  placeholder="Full address"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition resize-none"
                />
              </div>
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
                  {isEdit ? 'Updating...' : 'Registering...'}
                </>
              ) : (
                isEdit ? 'Update Driver' : 'Register Driver'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
