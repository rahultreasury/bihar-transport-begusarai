import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../../services/api';

const INITIAL_FORM = {
  vehicle_number: '',
  vehicle_type: '',
  vehicle_name: '',
  capacity_kg: '',
  capacity_volume: '',
  vehicle_make: '',
  vehicle_model: '',
  manufacturing_year: '',
  registration_date: '',
  insurance_number: '',
  insurance_expiry: '',
  permit_number: '',
  permit_expiry: '',
  pollution_certificate: '',
  pollution_expiry: '',
  base_location: '',
  hourly_rate: '',
  per_km_rate: '',
  owner_id: '',
  driver_id: '',
  current_status: 'available',
};

const VEHICLE_TYPES = [
  'Mahindra Bolero Pickup',
  'Tata Ace (Chhota Hathi)',
  'Tata Yodha',
  'Ashok Leyland Dost',
  'Mahindra Jeeto',
  'Pickup Truck',
  'Mini Truck',
  '14 ft Truck',
  '17 ft Truck',
  '19 ft Truck',
  '22 ft Truck',
  'Trailer',
  'Container',
  'Other'
];

export default function VehicleRegisterModal({ isOpen, onClose, onSuccess, ownerId }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [owners, setOwners] = useState([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const ownerWrapperRef = useRef(null);

  // Fetch transport owners for dropdown
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchOwners = async () => {
      setOwnersLoading(true);
      try {
        const res = await adminAPI.getVehicleOwners({ search: ownerSearch, limit: 50, status: 'active' });
        if (active && res.data?.success) {
          setOwners(res.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch vehicle owners:', err);
      } finally {
        if (active) setOwnersLoading(false);
      }
    };
    if (ownerOpen || ownerSearch) {
      fetchOwners();
    }
    return () => { active = false; };
  }, [isOpen, ownerSearch, ownerOpen]);

  // Fetch drivers for dropdown
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchDrivers = async () => {
      setDriversLoading(true);
      try {
        const res = await adminAPI.getDrivers({ limit: 100 });
        if (active && res.data?.success) {
          setDrivers(res.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch drivers:', err);
      } finally {
        if (active) setDriversLoading(false);
      }
    };
    fetchDrivers();
    return () => { active = false; };
  }, [isOpen]);

  // Close owner dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ownerWrapperRef.current && !ownerWrapperRef.current.contains(e.target)) {
        setOwnerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pre-select owner if ownerId is provided
  useEffect(() => {
    if (isOpen && ownerId) {
      setForm(prev => ({ ...prev, owner_id: String(ownerId) }));
    }
  }, [isOpen, ownerId]);

  const handleChange = useCallback((e) => {
    const { name, value, type } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'number' ? (value === '' ? '' : Number(value)) : value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  }, [errors]);

  const handleOwnerSelect = useCallback((owner) => {
    setForm(prev => ({ ...prev, owner_id: String(owner.owner_id) }));
    setOwnerSearch('');
    setOwnerOpen(false);
    if (errors.owner_id) {
      setErrors(prev => ({ ...prev, owner_id: '' }));
    }
  }, [errors]);

  const validate = useCallback(() => {
    const newErrors = {};
    if (!form.vehicle_number.trim()) {
      newErrors.vehicle_number = 'Vehicle number is required';
    }
    if (!form.vehicle_type.trim()) {
      newErrors.vehicle_type = 'Vehicle type is required';
    }
    if (!form.vehicle_name.trim()) {
      newErrors.vehicle_name = 'Vehicle name is required';
    }
    if (!form.owner_id) {
      newErrors.owner_id = 'Transport owner is required';
    }
    if (!form.current_status) {
      newErrors.current_status = 'Status is required';
    }
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
        vehicle_number: form.vehicle_number.trim(),
        vehicle_type: form.vehicle_type.trim(),
        vehicle_name: form.vehicle_name.trim(),
        capacity_kg: form.capacity_kg ? Number(form.capacity_kg) : null,
        capacity_volume: form.capacity_volume ? Number(form.capacity_volume) : null,
        vehicle_make: form.vehicle_make.trim() || null,
        vehicle_model: form.vehicle_model.trim() || null,
        manufacturing_year: form.manufacturing_year ? Number(form.manufacturing_year) : null,
        registration_date: form.registration_date.trim() || null,
        insurance_number: form.insurance_number.trim() || null,
        insurance_expiry: form.insurance_expiry.trim() || null,
        permit_number: form.permit_number.trim() || null,
        permit_expiry: form.permit_expiry.trim() || null,
        pollution_certificate: form.pollution_certificate.trim() || null,
        pollution_expiry: form.pollution_expiry.trim() || null,
        base_location: form.base_location.trim() || null,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
        per_km_rate: form.per_km_rate ? Number(form.per_km_rate) : null,
        driver_id: form.driver_id ? Number(form.driver_id) : null,
        current_status: form.current_status,
      };

      const res = await adminAPI.createVehicleOwnerVehicle(form.owner_id, payload);
      if (res.data?.success) {
        onSuccess?.(res.data.data);
        handleClose();
      } else {
        setServerError(res.data?.message || 'Failed to add vehicle');
      }
    } catch (err) {
      console.error('Add vehicle error:', err);
      const errorMsg = err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Server error. Please try again.';
      setServerError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, ownerId, onSuccess]);

  const handleClose = useCallback(() => {
    setForm({ ...INITIAL_FORM });
    setErrors({});
    setServerError('');
    setOwners([]);
    setOwnerSearch('');
    setOwnerOpen(false);
    setDrivers([]);
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
        aria-label="Add Vehicle"
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">+ Add Vehicle</h3>
              <p className="text-sm text-muted mt-0.5">
                Register a new vehicle to your fleet.
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
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1 space-y-5">
          {serverError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
              {serverError}
            </div>
          )}

          {/* Section 1: Basic Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Basic Information</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vehicle Number */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Vehicle Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="vehicle_number"
                  value={form.vehicle_number}
                  onChange={handleChange}
                  placeholder="BR09AB1234"
                  maxLength={10}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.vehicle_number ? 'border-red-500/50' : 'border-border/60'
                  }`}
                />
                {errors.vehicle_number && <p className="text-xs text-red-500 mt-1">{errors.vehicle_number}</p>}
              </div>

              {/* Vehicle Type */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Vehicle Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="vehicle_type"
                  value={form.vehicle_type}
                  onChange={handleChange}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.vehicle_type ? 'border-red-500/50' : 'border-border/60'
                  }`}
                >
                  <option value="">Select type</option>
                  {VEHICLE_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                {errors.vehicle_type && <p className="text-xs text-red-500 mt-1">{errors.vehicle_type}</p>}
              </div>

              {/* Vehicle Name */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Vehicle Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="vehicle_name"
                  value={form.vehicle_name}
                  onChange={handleChange}
                  placeholder="e.g. Tata Ace"
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.vehicle_name ? 'border-red-500/50' : 'border-border/60'
                  }`}
                />
                {errors.vehicle_name && <p className="text-xs text-red-500 mt-1">{errors.vehicle_name}</p>}
              </div>

              {/* Registration Date */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Registration Date <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="date"
                  name="registration_date"
                  value={form.registration_date}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Status <span className="text-red-500">*</span>
                </label>
                <select
                  name="current_status"
                  value={form.current_status}
                  onChange={handleChange}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.current_status ? 'border-red-500/50' : 'border-border/60'
                  }`}
                >
                  <option value="available">Available</option>
                  <option value="on_trip">On Trip</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inactive">Inactive</option>
                </select>
                {errors.current_status && <p className="text-xs text-red-500 mt-1">{errors.current_status}</p>}
              </div>
            </div>
          </div>

          {/* Section 2: Capacity */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Capacity</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Capacity (kg) */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Capacity (kg) <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="number"
                  name="capacity_kg"
                  value={form.capacity_kg}
                  onChange={handleChange}
                  placeholder="e.g. 1000"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Capacity Volume */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Capacity Volume <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="capacity_volume"
                  value={form.capacity_volume}
                  onChange={handleChange}
                  placeholder="e.g. 500 cu ft"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Ownership */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Ownership</span>
            </div>
            <div ref={ownerWrapperRef}>
              <label className="block text-sm font-medium mb-1.5">
                Transport Owner <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={ownerSearch}
                  onChange={(e) => { setOwnerSearch(e.target.value); setOwnerOpen(true); }}
                  onFocus={() => setOwnerOpen(true)}
                  placeholder="Search and select owner..."
                  autoComplete="off"
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.owner_id ? 'border-red-500/50' : 'border-border/60'
                  }`}
                />
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {ownerOpen && (
                <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-gray-800 border border-border/60 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                  {ownersLoading ? (
                    <div className="px-4 py-3 text-sm text-muted">Loading owners...</div>
                  ) : owners.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-muted">No matching transport owners</div>
                  ) : (
                    owners.map(owner => (
                      <button
                        key={owner.owner_id}
                        type="button"
                        onClick={() => handleOwnerSelect(owner)}
                        className="w-full text-left px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
                      >
                        <div className="text-sm font-medium">{owner.owner_name}</div>
                        <div className="text-xs text-muted">{owner.owner_code} • {owner.city || 'N/A'} • {owner.mobile}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
              {errors.owner_id && <p className="text-xs text-red-500 mt-1">{errors.owner_id}</p>}
            </div>
          </div>

          {/* Section 4: Driver Assignment */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Driver Assignment</span>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Assign Driver <span className="text-muted text-[10px]">(Optional)</span>
              </label>
              <select
                name="driver_id"
                value={form.driver_id}
                onChange={handleChange}
                className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              >
                <option value="">Unassigned</option>
                {drivers.map(d => (
                  <option key={d.driver_id} value={d.driver_id}>
                    {d.driver_name} {d.driver_code ? `(${d.driver_code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 5: Documents */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Documents</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Insurance Number */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Insurance Number <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="insurance_number"
                  value={form.insurance_number}
                  onChange={handleChange}
                  placeholder="Insurance policy number"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Insurance Expiry */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Insurance Expiry <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="date"
                  name="insurance_expiry"
                  value={form.insurance_expiry}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Permit Number */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Permit Number <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="permit_number"
                  value={form.permit_number}
                  onChange={handleChange}
                  placeholder="Permit number"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Permit Expiry */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Permit Expiry <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="date"
                  name="permit_expiry"
                  value={form.permit_expiry}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Pollution Certificate */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Pollution Certificate <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="pollution_certificate"
                  value={form.pollution_certificate}
                  onChange={handleChange}
                  placeholder="PUC number"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Pollution Expiry */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Pollution Expiry <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="date"
                  name="pollution_expiry"
                  value={form.pollution_expiry}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Pricing */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Pricing</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Hourly Rate */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Hourly Rate (₹) <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="number"
                  name="hourly_rate"
                  value={form.hourly_rate}
                  onChange={handleChange}
                  placeholder="e.g. 200"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Per KM Rate */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Per KM Rate (₹) <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="number"
                  name="per_km_rate"
                  value={form.per_km_rate}
                  onChange={handleChange}
                  placeholder="e.g. 15"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>
          </div>

          {/* Section 6: Additional Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Additional Details</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Make */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Make <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="vehicle_make"
                  value={form.vehicle_make}
                  onChange={handleChange}
                  placeholder="e.g. Tata"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Model <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="vehicle_model"
                  value={form.vehicle_model}
                  onChange={handleChange}
                  placeholder="e.g. Ace"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Manufacturing Year */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Manufacturing Year <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="number"
                  name="manufacturing_year"
                  value={form.manufacturing_year}
                  onChange={handleChange}
                  placeholder="e.g. 2022"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Base Location */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Base Location <span className="text-muted text-[10px]">(Optional)</span>
                </label>
                <input
                  type="text"
                  name="base_location"
                  value={form.base_location}
                  onChange={handleChange}
                  placeholder="e.g. Begusarai"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
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
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Adding...
                </>
              ) : (
                '+ Add Vehicle'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
