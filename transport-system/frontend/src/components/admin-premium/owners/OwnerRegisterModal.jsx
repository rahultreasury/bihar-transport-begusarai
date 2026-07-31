import React, { useState, useEffect, useRef } from 'react';

const INITIAL_FORM = {
  owner_name: '',
  phone: '',
  city: '',
  commission_percentage: 10,
  company_name: '',
  email: '',
  state: 'Bihar',
  gst_number: '',
  pan_number: '',
  bank_name: '',
  account_number: '',
  ifsc: '',
  upi_id: '',
  address: '',
  alternate_mobile: '',
};

const BIHAR_CITIES = [
  'Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga',
  'Begusarai', 'Arrah', 'Chapra', 'Katihar', 'Munger', 'Sasaram',
  'Hajipur', 'Bettiah', 'Motihari', 'Samastipur', 'Siwan', 'Saharsa',
  'Madhubani', 'Nalanda', 'Buxar', 'Kishanganj', 'Aurangabad', 'Jamalpur',
];

function toSearchable(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}

function CityAutocomplete({ value, onChange, onEnter, inputClass }) {
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (value && focused) {
      const search = toSearchable(value);
      setSuggestions(BIHAR_CITIES.filter(c => toSearchable(c).includes(search)).slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, [value, focused]);

  const selectCity = (city) => {
    onChange({ target: { name: 'city', value: city } });
    setSuggestions([]);
    setFocused(false);
    onEnter?.();
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        name="city"
        value={value}
        onChange={(e) => { onChange(e); setFocused(true); }}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestions.length === 1) selectCity(suggestions[0]);
            else if (value.trim()) { setSuggestions([]); onEnter?.(); }
          }
        }}
        placeholder="Enter city"
        className={inputClass}
        autoComplete="off"
      />
      {suggestions.length > 0 && focused && (
        <div className="absolute z-20 w-full mt-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
          {suggestions.map(city => (
            <button
              key={city}
              type="button"
              onClick={() => selectCity(city)}
              className="w-full text-left px-4 py-3 text-sm hover:bg-amber-50 dark:hover:bg-amber-500/10 transition flex items-center gap-3"
            >
              <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {city}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OwnerRegisterModal({ isOpen, onClose, onSuccess }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [showExtra, setShowExtra] = useState(false);
  const [toast, setToast] = useState(null);

  const ownerNameRef = useRef(null);
  const phoneRef = useRef(null);
  const cityRef = useRef(null);
  const commissionRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setForm(INITIAL_FORM);
      setErrors({});
      setServerError(null);
      setShowExtra(false);
      setSubmitting(false);
      setTimeout(() => ownerNameRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const errs = {};
    if (!form.owner_name?.trim()) errs.owner_name = 'Please enter the owner\'s name.';
    const raw = form.phone.replace(/\D/g, '');
    if (!raw) errs.phone = 'Phone number is required.';
    else if (!/^[6-9]\d{9}$/.test(raw)) errs.phone = 'Please enter a valid 10-digit phone number.';
    if (!form.city?.trim()) errs.city = 'Please select or enter a city.';
    const com = parseFloat(form.commission_percentage);
    if (isNaN(com) || com < 0 || com > 100) errs.commission_percentage = 'Commission must be between 0 and 100%.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: name === 'phone' ? formatPhone(value) : value,
    }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const map = { owner_name: phoneRef, phone: cityRef, city: commissionRef };
    const next = map[e.target.name];
    if (next?.current) next.current.focus();
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      const firstErr = ['owner_name', 'phone', 'city', 'commission_percentage'].find(f => errors[f]);
      if (firstErr === 'owner_name') ownerNameRef.current?.focus();
      else if (firstErr === 'phone') phoneRef.current?.focus();
      else if (firstErr === 'city') cityRef.current?.focus();
      else if (firstErr === 'commission_percentage') commissionRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      const { adminAPI } = await import('../../../services/api');
      const payload = {
        owner_name: form.owner_name.trim(),
        mobile: form.phone.replace(/\D/g, ''),
        city: form.city.trim(),
        commission_percentage: parseFloat(form.commission_percentage) || 10,
        company_name: form.company_name?.trim() || null,
        email: form.email?.trim() || null,
        state: form.state || 'Bihar',
        gst_number: form.gst_number?.trim() || null,
        pan_number: form.pan_number?.trim() || null,
        bank_name: form.bank_name?.trim() || null,
        bank_account: form.account_number?.trim() || null,
        bank_ifsc: form.ifsc?.trim() || null,
        upi_id: form.upi_id?.trim() || null,
        address: form.address?.trim() || null,
        alternate_mobile: form.alternate_mobile?.trim() || null,
      };
      const res = await adminAPI.createPartner(payload);
      if (res.data?.success) {
        showToast('✓ Transport Owner registered successfully.');
        setForm(INITIAL_FORM);
        onSuccess?.(res.data.data);
        setTimeout(() => onClose(), 400);
      }
    } catch (err) {
      setServerError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setForm(INITIAL_FORM);
    setErrors({});
    setServerError(null);
    setShowExtra(false);
    setSubmitting(false);
    onClose();
  };

  const inputCls = (f) =>
    `w-full px-4 py-3.5 rounded-xl border text-[15px] leading-relaxed transition duration-150 ${
      errors[f]
        ? 'border-red-400 bg-red-50 dark:bg-red-900/10 dark:border-red-500/50'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
    } focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-500`;

  const labelCls = 'block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5';

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-slide-down">
          <div className={`
            px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-semibold flex items-center gap-3 backdrop-blur-sm
            ${toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {toast.type === 'success' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              {toast.message}
            </span>
            <button onClick={() => setToast(null)} className="ml-3 opacity-50 hover:opacity-100 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto animate-scale-in">
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-7 py-5 flex items-center justify-between rounded-t-3xl">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                Register Transport Owner
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Only 4 required fields. Fill optional details later.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition shrink-0"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-7 py-6 space-y-6">

            {/* Server Error */}
            {serverError && (
              <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-5 py-4">
                <div className="flex items-center gap-3 text-red-600 dark:text-red-400 text-sm font-medium">
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {serverError}
                </div>
              </div>
            )}

            {/* === REQUIRED FIELDS === */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Required Information</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Owner Name <span className="text-red-400">*</span></label>
                  <input
                    ref={ownerNameRef}
                    type="text"
                    name="owner_name"
                    value={form.owner_name}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. Rahul Sharma"
                    className={inputCls('owner_name')}
                    autoComplete="off"
                  />
                  {errors.owner_name && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.owner_name}</p>}
                </div>

                <div>
                  <label className={labelCls}>Phone Number <span className="text-red-400">*</span></label>
                  <input
                    ref={phoneRef}
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="XXXX-XXX-XXX"
                    maxLength={12}
                    className={`${inputCls('phone')} font-mono tracking-widest`}
                  />
                  {errors.phone && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.phone}</p>}
                </div>

                <div>
                  <label className={labelCls}>City <span className="text-red-400">*</span></label>
                  <CityAutocomplete value={form.city} onChange={handleChange} onEnter={() => commissionRef.current?.focus()} inputClass={inputCls('city')} />
                  {errors.city && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.city}</p>}
                </div>

                <div>
                  <label className={labelCls}>Commission % <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <input
                      ref={commissionRef}
                      type="number"
                      name="commission_percentage"
                      value={form.commission_percentage}
                      onChange={handleChange}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(e); } }}
                      min={0}
                      max={100}
                      step={0.5}
                      className={`${inputCls('commission_percentage')} pr-12 text-lg font-semibold`}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base text-gray-400 dark:text-gray-500 font-semibold">%</span>
                  </div>
                  {errors.commission_percentage && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.commission_percentage}</p>}
                </div>
              </div>
            </div>

            {/* === Divider === */}
            <div className="border-t border-gray-100 dark:border-gray-800" />

            {/* === ADDITIONAL DETAILS TOGGLE === */}
            <button
              type="button"
              onClick={() => setShowExtra(!showExtra)}
              className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition group"
            >
              <span className="flex items-center gap-3">
                <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${showExtra ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Additional Details</span>
                <span className="text-xs text-gray-400 font-normal">(optional)</span>
              </span>
              <svg className={`w-4 h-4 transition-transform duration-200 ${showExtra ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* === ADDITIONAL DETAILS CONTENT === */}
            {showExtra && (
              <div className="space-y-5 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Company Name</label>
                    <input type="text" name="company_name" value={form.company_name} onChange={handleChange} placeholder="Firm or company" className={inputCls('company_name')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
                    <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="email@example.com" className={inputCls('email')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Alternate Phone</label>
                    <input type="tel" name="alternate_mobile" value={form.alternate_mobile} onChange={handleChange} placeholder="Alternate number" maxLength={12} className={inputCls('alternate_mobile')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">State</label>
                    <input type="text" name="state" value={form.state} onChange={handleChange} className={inputCls('state')} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Address</label>
                  <textarea name="address" value={form.address} onChange={handleChange} placeholder="Full address" rows={2} className={inputCls('address')} />
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-2 w-2 rounded-full bg-purple-400" />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Tax & Bank Details</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">GST Number</label>
                      <input type="text" name="gst_number" value={form.gst_number} onChange={handleChange} placeholder="GSTIN" className={inputCls('gst_number')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">PAN Number</label>
                      <input type="text" name="pan_number" value={form.pan_number} onChange={handleChange} placeholder="PAN" className={inputCls('pan_number')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Name</label>
                      <input type="text" name="bank_name" value={form.bank_name} onChange={handleChange} placeholder="Bank name" className={inputCls('bank_name')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Account Number</label>
                      <input type="text" name="account_number" value={form.account_number} onChange={handleChange} placeholder="A/c number" className={inputCls('account_number')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">IFSC Code</label>
                      <input type="text" name="ifsc" value={form.ifsc} onChange={handleChange} placeholder="IFSC" className={inputCls('ifsc')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">UPI ID</label>
                      <input type="text" name="upi_id" value={form.upi_id} onChange={handleChange} placeholder="UPI ID" className={inputCls('upi_id')} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === ACTION BUTTONS === */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-3.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[15px] font-bold hover:from-amber-600 hover:to-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2.5 shadow-lg shadow-amber-500/20 min-w-[160px] justify-center"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Register Owner
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

