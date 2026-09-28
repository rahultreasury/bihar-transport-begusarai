import React, { useState, useEffect, useRef, useCallback } from 'react';
import { adminAPI } from '../../../services/api';

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

function CityAutocomplete({ value, onChange, onEnter, inputClass, error }) {
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
        className={`${inputClass} ${error ? 'border-red-500/50' : ''}`}
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

export default function OwnerRegistrationSection({
  formData,
  errors,
  onChange,
  onErrorsChange,
  context,
  createdOwner,
}) {
  const [showExtra, setShowExtra] = useState(false);
  const ownerNameRef = useRef(null);
  const phoneRef = useRef(null);
  const cityRef = useRef(null);
  const commissionRef = useRef(null);

  // Pre-fill from context or created owner
  useEffect(() => {
    if (createdOwner && Object.keys(formData).length === 0) {
      onChange('owner_name', createdOwner.owner_name || '');
      onChange('phone', createdOwner.mobile || '');
      onChange('city', createdOwner.city || '');
      onChange('company_name', createdOwner.company_name || '');
      onChange('email', createdOwner.email || '');
      onChange('state', createdOwner.state || 'Bihar');
      onChange('gst_number', createdOwner.gst_number || '');
      onChange('pan_number', createdOwner.pan_number || '');
      onChange('bank_name', createdOwner.bank_name || '');
      onChange('account_number', createdOwner.bank_account || '');
      onChange('ifsc', createdOwner.bank_ifsc || '');
      onChange('upi_id', createdOwner.upi_id || '');
      onChange('address', createdOwner.address || '');
      onChange('alternate_mobile', createdOwner.alternate_mobile || '');
    } else if (context.ownerId && Object.keys(formData).length === 0) {
      // Fetch owner details to pre-fill the form
      const fetchOwner = async () => {
        try {
          const res = await adminAPI.getVehicleOwner(context.ownerId);
          if (res.data?.success && res.data.data) {
            const owner = res.data.data;
            onChange('owner_name', owner.owner_name || '');
            onChange('phone', owner.mobile || '');
            onChange('city', owner.city || '');
            onChange('company_name', owner.company_name || '');
            onChange('email', owner.email || '');
            onChange('state', owner.state || 'Bihar');
            onChange('gst_number', owner.gst_number || '');
            onChange('pan_number', owner.pan_number || '');
            onChange('bank_name', owner.bank_name || '');
            onChange('account_number', owner.bank_account || '');
            onChange('ifsc', owner.bank_ifsc || '');
            onChange('upi_id', owner.upi_id || '');
            onChange('address', owner.address || '');
            onChange('alternate_mobile', owner.alternate_mobile || '');
          }
        } catch (err) {
          console.error('Failed to fetch owner details:', err);
        }
      };
      fetchOwner();
    }
  }, [createdOwner, context.ownerId, formData]);

  const inputCls = (f) =>
    `w-full px-4 py-3.5 rounded-xl border text-[15px] leading-relaxed transition duration-150 ${
      errors[f]
        ? 'border-red-400 bg-red-50 dark:bg-red-900/10 dark:border-red-500/50'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
    } focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white placeholder-gray-400 dark:placeholder-gray-500`;

  const labelCls = 'block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5';

  return (
    <fieldset className="space-y-5 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 bg-amber-50/30 dark:bg-amber-900/10">
      <legend className="flex items-center gap-2 px-3 py-1 bg-amber-100 dark:bg-amber-900/30 rounded-xl text-sm font-semibold text-amber-700 dark:text-amber-300">
        <span className="text-xl">🏢</span>
        <span>Transport Owner</span>
      </legend>
      
      {/* Required Fields */}
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
              value={formData.owner_name || ''}
              onChange={(e) => onChange('owner_name', e.target.value)}
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
              value={formData.phone || ''}
              onChange={(e) => onChange('phone', formatPhone(e.target.value))}
              placeholder="XXXX-XXX-XXX"
              maxLength={12}
              className={`${inputCls('phone')} font-mono tracking-widest`}
            />
            {errors.phone && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.phone}</p>}
          </div>

          <div>
            <label className={labelCls}>City <span className="text-red-400">*</span></label>
            <CityAutocomplete
              value={formData.city || ''}
              onChange={(e) => onChange('city', e.target.value)}
              onEnter={() => commissionRef.current?.focus()}
              inputClass={inputCls('city')}
              error={errors.city}
            />
            {errors.city && <p className="mt-1.5 text-sm text-red-500 flex items-center gap-1.5">{errors.city}</p>}
          </div>

          <div>
            <label className={labelCls}>Commission % <span className="text-red-400">*</span></label>
            <div className="relative">
              <input
                ref={commissionRef}
                type="number"
                name="commission_percentage"
                value={formData.commission_percentage || 10}
                onChange={(e) => onChange('commission_percentage', e.target.value)}
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

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* Additional Details Toggle */}
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

      {/* Additional Details Content */}
      {showExtra && (
        <div className="space-y-5 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Company Name</label>
              <input type="text" name="company_name" value={formData.company_name || ''} onChange={(e) => onChange('company_name', e.target.value)} placeholder="Firm or company" className={inputCls('company_name')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
              <input type="email" name="email" value={formData.email || ''} onChange={(e) => onChange('email', e.target.value)} placeholder="email@example.com" className={inputCls('email')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Alternate Phone</label>
              <input type="tel" name="alternate_mobile" value={formData.alternate_mobile || ''} onChange={(e) => onChange('alternate_mobile', formatPhone(e.target.value))} placeholder="Alternate number" maxLength={12} className={inputCls('alternate_mobile')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">State</label>
              <input type="text" name="state" value={formData.state || 'Bihar'} onChange={(e) => onChange('state', e.target.value)} className={inputCls('state')} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Address</label>
            <textarea name="address" value={formData.address || ''} onChange={(e) => onChange('address', e.target.value)} placeholder="Full address" rows={2} className={inputCls('address')} />
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-purple-400" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Tax & Bank Details</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">GST Number</label>
                <input type="text" name="gst_number" value={formData.gst_number || ''} onChange={(e) => onChange('gst_number', e.target.value)} placeholder="GSTIN" className={inputCls('gst_number')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">PAN Number</label>
                <input type="text" name="pan_number" value={formData.pan_number || ''} onChange={(e) => onChange('pan_number', e.target.value)} placeholder="PAN" className={inputCls('pan_number')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Bank Name</label>
                <input type="text" name="bank_name" value={formData.bank_name || ''} onChange={(e) => onChange('bank_name', e.target.value)} placeholder="Bank name" className={inputCls('bank_name')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Account Number</label>
                <input type="text" name="account_number" value={formData.account_number || ''} onChange={(e) => onChange('account_number', e.target.value)} placeholder="A/c number" className={inputCls('account_number')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">IFSC Code</label>
                <input type="text" name="ifsc" value={formData.ifsc || ''} onChange={(e) => onChange('ifsc', e.target.value)} placeholder="IFSC" className={inputCls('ifsc')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">UPI ID</label>
                <input type="text" name="upi_id" value={formData.upi_id || ''} onChange={(e) => onChange('upi_id', e.target.value)} placeholder="UPI ID" className={inputCls('upi_id')} />
              </div>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}