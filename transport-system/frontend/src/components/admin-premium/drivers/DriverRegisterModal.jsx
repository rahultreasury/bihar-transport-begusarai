import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../../services/api';

const INITIAL_FORM = {
  driver_name: '',
  mobile: '',
  license_number: '',
  license_expiry: '',
  address: '',
  emergency_contact: '',
  transport_owner_id: '',
  vehicle_id: '',
  no_vehicle_assigned: false,
  vehicle_type: '',
  vehicle_number: '',
  alternate_mobile: '',
  city: '',
  state: 'Bihar',
};

// Normalize for case-insensitive search filtering
function toSearchable(text) {
  return (text || '').toLowerCase();
}

// Searchable select dropdown for transport owner
function SearchableSelect({ value, onChange, options, placeholder, inputClass, error, displayRenderer }) {
  const [query, setQuery] = useState(value);
  const [filtered, setFiltered] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Keep local query in sync with the controlled value
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options based on query
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
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered.length === 1) select(filtered[0]);
              else if (query.trim()) { onChange(query.trim()); setOpen(false); }
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
              key={option.owner_id}
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

export default function DriverRegisterModal({ isOpen, onClose, onSuccess, driver, mode = 'create' }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [existingDriver, setExistingDriver] = useState(null);

  // Transport Owner & Vehicle selection state
  const [owners, setOwners] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const ownerWrapperRef = useRef(null);

  const isEdit = mode === 'edit' && driver;

  // Pre-fill form when editing
  useEffect(() => {
    if (isOpen) {
      if (isEdit) {
        setForm({
          driver_name: driver.driver_name || '',
          mobile: driver.mobile || '',
          license_number: driver.license_number || '',
          license_expiry: driver.license_expiry || '',
          address: driver.address || '',
          emergency_contact: driver.emergency_contact || '',
          transport_owner_id: driver.transport_owner_id || '',
          vehicle_id: driver.current_vehicle_id || '',
          no_vehicle_assigned: !driver.current_vehicle_id,
          vehicle_type: driver.vehicle_type || '',
          vehicle_number: driver.vehicle_number || '',
          alternate_mobile: driver.alternate_mobile || '',
          city: driver.city || '',
          state: driver.state || 'Bihar',
        });
      } else {
        setForm({ ...INITIAL_FORM });
      }
      setErrors({});
      setServerError('');
      setExistingDriver(null);
      setOwners([]);
      setSelectedOwner(null);
      setVehicles([]);
    }
  }, [isOpen, isEdit, driver]);

  // Fetch transport owners for searchable dropdown
  useEffect(() => {
    if (!isOpen || isEdit) return;
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
  }, [isOpen, isEdit]);

  // Fetch vehicles when owner changes
  useEffect(() => {
    if (!isOpen || !form.transport_owner_id || isEdit) return;
    let active = true;
    const fetchVehicles = async () => {
      setVehicleLoading(true);
      setVehicles([]);
      try {
        const res = await adminAPI.getVehicleOwnerVehicles(form.transport_owner_id, { limit: 50 });
        if (active && res.data?.success) {
          setVehicles(res.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch owner vehicles:', err);
      } finally {
        if (active) setVehicleLoading(false);
      }
    };
    fetchVehicles();
    return () => { active = false; };
  }, [isOpen, isEdit, form.transport_owner_id]);

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

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    let nextValue = value;
    // Auto-uppercase + trim spaces for vehicle number
    if (name === 'vehicle_number') {
      nextValue = value.toUpperCase().replace(/\s+/g, '').slice(0, 10);
    }
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : nextValue }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  }, [errors]);

  const handleOwnerSelect = useCallback((owner) => {
    setForm(prev => ({
      ...prev,
      transport_owner_id: String(owner.owner_id),
      vehicle_id: '',
      vehicle_type: '',
      vehicle_number: '',
      no_vehicle_assigned: false,
    }));
    setSelectedOwner(owner);
    if (errors.transport_owner_id) {
      setErrors(prev => ({ ...prev, transport_owner_id: '' }));
    }
  }, [errors]);

  const handleVehicleSelect = useCallback((e) => {
    const vehicleId = e.target.value;
    const selected = vehicles.find(v => String(v.vehicle_id) === vehicleId);
    setForm(prev => ({
      ...prev,
      vehicle_id: vehicleId,
      no_vehicle_assigned: !vehicleId,
      vehicle_type: selected ? selected.vehicle_type : prev.vehicle_type,
      vehicle_number: selected ? selected.vehicle_number : prev.vehicle_number,
    }));
    if (errors.vehicle_id) {
      setErrors(prev => ({ ...prev, vehicle_id: '' }));
    }
  }, [vehicles, errors]);

  const handleNoVehicleChange = useCallback((e) => {
    const checked = e.target.checked;
    setForm(prev => ({
      ...prev,
      no_vehicle_assigned: checked,
      vehicle_id: checked ? '' : prev.vehicle_id,
      vehicle_type: checked ? '' : prev.vehicle_type,
      vehicle_number: checked ? '' : prev.vehicle_number,
    }));
  }, []);

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
    if (!form.license_number.trim()) {
      newErrors.license_number = 'Driving licence number is required';
    }
    if (!isEdit && !form.transport_owner_id) {
      newErrors.transport_owner_id = 'Transport owner is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form, isEdit]);

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
        vehicle_type: form.vehicle_type.trim() || undefined,
        vehicle_number: form.vehicle_number.trim().toUpperCase() || undefined,
        license_number: form.license_number.trim() || undefined,
        license_expiry: form.license_expiry.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state || 'Bihar',
        address: form.address.trim() || undefined,
        emergency_contact: form.emergency_contact.trim() || undefined,
        transport_owner_id: form.transport_owner_id ? parseInt(form.transport_owner_id) : undefined,
      };

      let response;
      if (isEdit) {
        response = await adminAPI.updateDriver(driver.driver_id, payload);
      } else {
        response = await adminAPI.createDriver(payload);
      }

      if (response.data?.success) {
        const newDriverId = response.data.data?.driver_id;
        // Assign vehicle after driver creation if selected
        if (!isEdit && form.vehicle_id && newDriverId) {
          try {
            await adminAPI.assignVehicleToDriver(newDriverId, parseInt(form.vehicle_id));
          } catch (assignErr) {
            console.error('Vehicle assignment failed:', assignErr);
            // Driver was created but vehicle assignment failed - still show success
          }
        }
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
    setOwners([]);
    setSelectedOwner(null);
    setVehicles([]);
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
        aria-label={isEdit ? 'Edit Driver' : 'Add New Driver'}
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">{isEdit ? 'Edit Driver' : 'Add New Driver'}</h3>
              <p className="text-sm text-muted mt-0.5">
                {isEdit
                  ? `Updating ${driver.driver_name}`
                  : 'Add a new driver to your transport network.'}
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
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1 space-y-6">
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

          {/* ==================== SECTION 1: Driver Information ==================== */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Driver Information</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Full Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1.5">
                  Full Name <span className="text-red-500">*</span>
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

              {/* Mobile Number */}
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

              {/* Driving Licence Number */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Driving Licence Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="license_number"
                  value={form.license_number}
                  onChange={handleChange}
                  placeholder="Enter driving licence number"
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.license_number ? 'border-red-500/50' : 'border-border/60'
                  }`}
                />
                {errors.license_number && <p className="text-xs text-red-500 mt-1">{errors.license_number}</p>}
              </div>

              {/* Licence Expiry */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Licence Expiry <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="date"
                  name="license_expiry"
                  value={form.license_expiry}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Address */}
              <div>
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

              {/* Emergency Contact */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1.5">
                  Emergency Contact <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="tel"
                  name="emergency_contact"
                  value={form.emergency_contact}
                  onChange={handleChange}
                  placeholder="Emergency contact number"
                  maxLength={10}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>
          </div>

          {/* ==================== SECTION 2: Transport Partner ==================== */}
          {!isEdit && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Transport Partner</span>
              </div>
              <div ref={ownerWrapperRef}>
                <label className="block text-sm font-medium mb-1.5">
                  Select Transport Owner <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  value={selectedOwner ? `${selectedOwner.owner_name} (${selectedOwner.owner_code}) — ${selectedOwner.city || 'N/A'}` : ''}
                  onChange={(selected) => handleOwnerSelect(selected)}
                  options={owners}
                  placeholder="Search and select owner..."
                  inputClass="w-full px-3 py-2.5 rounded-xl text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                  error={errors.transport_owner_id}
                  displayRenderer={(owner) => `${owner.owner_name} (${owner.owner_code}) — ${owner.city || 'N/A'}`}
                />
                {ownerLoading && <p className="text-xs text-muted mt-1">Loading owners...</p>}
                {errors.transport_owner_id && <p className="text-xs text-red-500 mt-1">{errors.transport_owner_id}</p>}
              </div>
            </div>
          )}

          {/* ==================== SECTION 3: Vehicle ==================== */}
          {!isEdit && form.transport_owner_id && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Vehicle</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Vehicle Dropdown */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Vehicle <span className="text-muted text-[10px]">(Optional)</span>
                  </label>
                  <select
                    value={form.vehicle_id}
                    onChange={handleVehicleSelect}
                    disabled={vehicleLoading}
                    className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                      errors.vehicle_id ? 'border-red-500/50' : 'border-border/60'
                    } ${vehicleLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map(v => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>
                        {v.vehicle_number} — {v.vehicle_type}
                      </option>
                    ))}
                  </select>
                  {vehicleLoading && <p className="text-xs text-muted mt-1">Loading vehicles...</p>}
                  {!vehicleLoading && form.transport_owner_id && vehicles.length === 0 && (
                    <p className="text-xs text-muted mt-1">No vehicles registered for this owner</p>
                  )}
                </div>

                {/* No Vehicle Assigned */}
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="no_vehicle_assigned"
                    name="no_vehicle_assigned"
                    checked={form.no_vehicle_assigned}
                    onChange={handleNoVehicleChange}
                    className="w-4 h-4 rounded border-border/60 text-amber-500 focus:ring-amber-500/30"
                  />
                  <label htmlFor="no_vehicle_assigned" className="text-sm text-muted cursor-pointer">
                    No vehicle assigned
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ==================== Edit Mode Fields ==================== */}
          {isEdit && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Additional Details</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                {/* City */}
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

                {/* State */}
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
              </div>
            </div>
          )}

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
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {isEdit ? 'Updating...' : 'Adding...'}
                </>
              ) : (
                isEdit ? 'Update Driver' : '+ Add Driver'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
