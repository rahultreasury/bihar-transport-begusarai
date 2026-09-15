import React, { useState, useCallback, useEffect, useRef } from 'react';
import { adminAPI } from '../../../services/api';

function toSearchable(text) {
  return (text || '').toLowerCase();
}

function SearchableSelect({ value, onChange, options, placeholder, inputClass, error, displayRenderer, onOpenChange }) {
  const [query, setQuery] = useState(value);
  const [filtered, setFiltered] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      const q = toSearchable(query);
      setFiltered(options.filter(o => toSearchable(displayRenderer ? displayRenderer(o) : o).includes(q)));
    } else {
      setFiltered([]);
    }
  }, [query, open, options, displayRenderer]);

  const select = (option) => {
    onChange(option);
    setQuery(displayRenderer ? displayRenderer(option) : option);
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onOpenChange?.(true); }}
          onFocus={() => { setOpen(true); onOpenChange?.(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered.length === 1) select(filtered[0]);
              else if (query.trim()) { onChange(query.trim()); setOpen(false); onOpenChange?.(false); }
            }
          }}
          placeholder={placeholder || 'Select...'}
          autoComplete="off"
          className={`${inputClass} ${error ? 'border-red-500/50' : 'border-border/60'}`}
        />
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-gray-800 border border-border/60 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
          {filtered.map(option => (
            <button
              key={option.owner_id || option.driver_id || option.vehicle_id}
              type="button"
              onClick={() => select(option)}
              className="w-full text-left px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
            >
              {displayRenderer ? displayRenderer(option) : option}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-gray-800 border border-border/60 rounded-xl shadow-2xl">
          <div className="px-4 py-3 text-sm text-muted">No matching results</div>
        </div>
      )}
    </div>
  );
}

export default function DriverRegistrationSection({
  formData,
  errors,
  onChange,
  onErrorsChange,
  context,
  createdOwner,
  createdDriver,
}) {
  const [owners, setOwners] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const ownerWrapperRef = useRef(null);

  // Fetch transport owners for searchable dropdown
  useEffect(() => {
    let active = true;
    const fetchOwners = async () => {
      setOwnerLoading(true);
      try {
        const res = await adminAPI.getVehicleOwners({ search: '', limit: 50, status: 'active' });
        if (active && res.data?.success) {
          setOwners(res.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch vehicle owners:', err);
      } finally {
        if (active) setOwnerLoading(false);
      }
    };
    fetchOwners();
    return () => { active = false; };
  }, []);

  // Pre-select owner from context or created owner
  useEffect(() => {
    if (createdOwner) {
      setSelectedOwner(createdOwner);
      onChange('transport_owner_id', String(createdOwner.owner_id));
      onChange('is_self_owner', false);
    } else if (context.ownerId && !selectedOwner) {
      const owner = owners.find(o => String(o.owner_id) === String(context.ownerId));
      if (owner) {
        setSelectedOwner(owner);
        onChange('transport_owner_id', String(owner.owner_id));
        onChange('is_self_owner', false);
      }
    }
  }, [createdOwner, context.ownerId, owners, onChange]);

  // Close owner dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ownerWrapperRef.current && !ownerWrapperRef.current.contains(e.target)) {
        // Don't close if clicking inside the dropdown panel
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOwnerSelect = useCallback((owner) => {
    onChange('transport_owner_id', String(owner.owner_id));
    onChange('vehicle_id', '');
    onChange('vehicle_type', '');
    onChange('vehicle_number', '');
    onChange('no_vehicle_assigned', false);
    onChange('is_self_owner', false);
    setSelectedOwner(owner);
    if (errors.transport_owner_id) {
      onErrorsChange(prev => ({ ...prev, transport_owner_id: '' }));
    }
  }, [errors, onChange, onErrorsChange]);

  const handleSelfOwnerToggle = useCallback((e) => {
    const checked = e.target.checked;
    onChange('is_self_owner', checked);
    onChange('transport_owner_id', checked ? '' : formData.transport_owner_id);
    onChange('vehicle_id', checked ? '' : formData.vehicle_id);
    onChange('vehicle_type', checked ? '' : formData.vehicle_type);
    onChange('vehicle_number', checked ? '' : formData.vehicle_number);
    onChange('no_vehicle_assigned', checked ? false : formData.no_vehicle_assigned);
    if (checked) setSelectedOwner(null);
    if (errors.transport_owner_id) {
      onErrorsChange(prev => ({ ...prev, transport_owner_id: '' }));
    }
  }, [formData, errors, onChange, onErrorsChange]);

  const handleVehicleSelect = useCallback((e) => {
    const vehicleId = e.target.value;
    onChange('vehicle_id', vehicleId);
    onChange('no_vehicle_assigned', !vehicleId);
    if (errors.vehicle_id) {
      onErrorsChange(prev => ({ ...prev, vehicle_id: '' }));
    }
  }, [errors, onChange, onErrorsChange]);

  const handleNoVehicleChange = useCallback((e) => {
    const checked = e.target.checked;
    onChange('no_vehicle_assigned', checked);
    onChange('vehicle_id', checked ? '' : formData.vehicle_id);
    onChange('vehicle_type', checked ? '' : formData.vehicle_type);
    onChange('vehicle_number', checked ? '' : formData.vehicle_number);
  }, [formData, onChange]);

  const inputCls = (f) =>
    `w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
      errors[f] ? 'border-red-500/50' : 'border-border/60'
    }`;

  const labelCls = 'block text-sm font-medium mb-1.5';

  return (
    <fieldset className="space-y-5 border border-blue-200 dark:border-blue-800 rounded-2xl p-5 bg-blue-50/30 dark:bg-blue-900/10">
      <legend className="flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-sm font-semibold text-blue-700 dark:text-blue-300">
        <span className="text-xl">👨‍✈️</span>
        <span>Driver</span>
      </legend>

      {/* Driver Information */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Driver Information</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Full Name */}
          <div className="md:col-span-2">
            <label className={labelCls}>
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="driver_name"
              value={formData.driver_name || ''}
              onChange={(e) => onChange('driver_name', e.target.value)}
              placeholder="e.g. Rajesh Kumar"
              className={inputCls('driver_name')}
              autoComplete="off"
            />
            {errors.driver_name && <p className="mt-1.5 text-sm text-red-500">{errors.driver_name}</p>}
          </div>

          {/* Mobile */}
          <div>
            <label className={labelCls}>
              Mobile Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              name="mobile"
              value={formData.mobile || ''}
              onChange={(e) => onChange('mobile', e.target.value)}
              placeholder="9876543210"
              maxLength={10}
              className={`${inputCls('mobile')} font-mono tracking-widest`}
            />
            {errors.mobile && <p className="mt-1.5 text-sm text-red-500">{errors.mobile}</p>}
          </div>

          {/* Alternate Mobile */}
          <div>
            <label className={labelCls}>Alternate Mobile</label>
            <input
              type="tel"
              name="alternate_mobile"
              value={formData.alternate_mobile || ''}
              onChange={(e) => onChange('alternate_mobile', e.target.value)}
              placeholder="Alternate number"
              maxLength={10}
              className={inputCls('alternate_mobile')}
            />
          </div>

          {/* License Number */}
          <div>
            <label className={labelCls}>
              License Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="license_number"
              value={formData.license_number || ''}
              onChange={(e) => onChange('license_number', e.target.value.toUpperCase())}
              placeholder="DL/BR/023456/2019"
              className={inputCls('license_number')}
            />
            {errors.license_number && <p className="mt-1.5 text-sm text-red-500">{errors.license_number}</p>}
          </div>

          {/* License Expiry */}
          <div>
            <label className={labelCls}>License Expiry</label>
            <input
              type="date"
              name="license_expiry"
              value={formData.license_expiry || ''}
              onChange={(e) => onChange('license_expiry', e.target.value)}
              className={inputCls('license_expiry')}
            />
          </div>

          {/* City */}
          <div>
            <label className={labelCls}>City</label>
            <input
              type="text"
              name="city"
              value={formData.city || ''}
              onChange={(e) => onChange('city', e.target.value)}
              placeholder="e.g. Begusarai"
              className={inputCls('city')}
            />
          </div>

          {/* State */}
          <div>
            <label className={labelCls}>State</label>
            <input
              type="text"
              name="state"
              value={formData.state || 'Bihar'}
              onChange={(e) => onChange('state', e.target.value)}
              className={inputCls('state')}
            />
          </div>

          {/* Address */}
          <div className="md:col-span-2">
            <label className={labelCls}>Address</label>
            <textarea
              name="address"
              value={formData.address || ''}
              onChange={(e) => onChange('address', e.target.value)}
              placeholder="Full address"
              rows={2}
              className={inputCls('address')}
            />
          </div>

          {/* Emergency Contact */}
          <div>
            <label className={labelCls}>Emergency Contact</label>
            <input
              type="tel"
              name="emergency_contact"
              value={formData.emergency_contact || ''}
              onChange={(e) => onChange('emergency_contact', e.target.value)}
              placeholder="Emergency contact number"
              maxLength={10}
              className={inputCls('emergency_contact')}
            />
          </div>
        </div>
      </div>

      {/* Transport Owner Assignment */}
      <div className="border-t border-border/40 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Transport Owner Assignment</span>
        </div>

        {/* Self-Owner Toggle */}
        <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer">
          <input
            type="checkbox"
            name="is_self_owner"
            checked={formData.is_self_owner}
            onChange={(e) => {
              const checked = e.target.checked;
              onChange('is_self_owner', checked);
              onChange('transport_owner_id', checked ? '' : formData.transport_owner_id);
              onChange('vehicle_id', checked ? '' : formData.vehicle_id);
              onChange('vehicle_type', checked ? '' : formData.vehicle_type);
              onChange('vehicle_number', checked ? '' : formData.vehicle_number);
              onChange('no_vehicle_assigned', checked ? false : formData.no_vehicle_assigned);
              if (checked) onErrorsChange(prev => ({ ...prev, transport_owner_id: '' }));
            }}
            className="w-5 h-5 text-amber-500 border-border/60 rounded focus:ring-amber-500/30"
          />
          <div className="flex-1">
            <div className="font-medium text-text">Driver is the vehicle owner (Self-Owner)</div>
            <div className="text-sm text-muted">Backend will resolve/create a DRIVER_OWNER from the driver's mobile number. No separate owner selection needed.</div>
          </div>
        </label>

        {/* Owner Selection (hidden when self-owner) */}
        {!formData.is_self_owner && (
          <div className="space-y-3 mt-3" ref={ownerWrapperRef}>
            <label className={labelCls}>
              Transport Owner <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              value={selectedOwner ? `${selectedOwner.owner_name} (${selectedOwner.owner_code || selectedOwner.owner_id})` : ''}
              onChange={handleOwnerSelect}
              options={owners}
              placeholder="Search transport owner by name or code..."
              inputClass={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${errors.transport_owner_id ? 'border-red-500/50' : 'border-border/60'}`}
              error={errors.transport_owner_id}
              displayRenderer={(o) => `${o.owner_name} (${o.owner_code || o.owner_id}) • ${o.city || ''}`}
              onOpenChange={() => {}}
            />
            {errors.transport_owner_id && <p className="mt-1.5 text-sm text-red-500">{errors.transport_owner_id}</p>}

            {/* Selected Owner Display */}
            {selectedOwner && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-xs font-bold text-amber-700 dark:text-amber-400">
                    {selectedOwner.owner_name?.charAt(0) || 'O'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-amber-900 dark:text-amber-200 truncate">{selectedOwner.owner_name}</div>
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-mono">
                      {selectedOwner.owner_code || `ID: ${selectedOwner.owner_id}`} • {selectedOwner.city || ''}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Inline Owner Creation */}
        {showOwnerModal && (
          <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">Create a new Transport Owner inline, then continue with driver registration.</p>
            {/* This would embed OwnerRegistrationSection - for now we'll use the existing modal approach */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowOwnerModal(false)}
                className="px-4 py-2 text-sm font-medium text-amber-600 hover:text-amber-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Vehicle Assignment */}
      <div className="border-t border-border/40 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Vehicle Assignment (Optional)</span>
        </div>

        <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer mb-3">
          <input
            type="checkbox"
            name="no_vehicle_assigned"
            checked={formData.no_vehicle_assigned}
            onChange={(e) => {
              const checked = e.target.checked;
              onChange('no_vehicle_assigned', checked);
              onChange('vehicle_id', checked ? '' : formData.vehicle_id);
              onChange('vehicle_type', checked ? '' : formData.vehicle_type);
              onChange('vehicle_number', checked ? '' : formData.vehicle_number);
            }}
            className="w-5 h-5 text-amber-500 border-border/60 rounded focus:ring-amber-500/30"
          />
          <div className="flex-1">
            <div className="font-medium text-text">No vehicle assigned to this driver</div>
            <div className="text-sm text-muted">Driver will be created without a vehicle assignment</div>
          </div>
        </label>

        {!formData.no_vehicle_assigned && (
          <div className="space-y-3">
            <label className={labelCls}>
              Vehicle <span className="text-red-500">*</span>
            </label>
            <select
              name="vehicle_id"
              value={formData.vehicle_id || ''}
              onChange={(e) => handleVehicleSelect(e)}
              className={inputCls('vehicle_id')}
            >
              <option value="">Select a vehicle</option>
              {/* Vehicles would be loaded based on selected owner - for now placeholder */}
            </select>
            {errors.vehicle_id && <p className="mt-1.5 text-sm text-red-500">{errors.vehicle_id}</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}