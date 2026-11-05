import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../../../services/api';

const INITIAL_FORM = {
  connectionType: 'vehicle', // 'vehicle' or 'driver'
  vehicle_id: '',
  driver_id: '',
  owner_id: '',
  is_driver_owner: false,
};

export default function ConnectionModal({ isOpen, onClose, onSuccess, initialType = 'vehicle' }) {
  const [form, setForm] = useState({ ...INITIAL_FORM, connectionType: initialType });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [owners, setOwners] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState(null);

  // Fetch orphan records on open
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [orphanVehiclesRes, orphanDriversRes, ownersRes] = await Promise.all([
          adminAPI.getOrphanVehicles(),
          adminAPI.getOrphanDrivers(),
          adminAPI.getVehicleOwners({ status: 'active', limit: 100 }),
        ]);
        if (active) {
          setVehicles(orphanVehiclesRes.data?.success ? orphanVehiclesRes.data.data : []);
          setDrivers(orphanDriversRes.data?.success ? orphanDriversRes.data.data : []);
          setOwners(ownersRes.data?.success ? ownersRes.data.data : []);
        }
      } catch (err) {
        console.error('Failed to fetch connection data:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();
    return () => { active = false; };
  }, [isOpen]);

  // Filter drivers by selected owner
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchDrivers = async () => {
      if (selectedOwner) {
        try {
          const res = await adminAPI.getDrivers({ transport_owner_id: selectedOwner.owner_id, limit: 100 });
          if (active && res.data?.success) {
            setDrivers(res.data.data || []);
          }
        } catch (err) {
          console.error('Failed to fetch drivers:', err);
        }
      }
    };
    fetchDrivers();
    return () => { active = false; };
  }, [isOpen, selectedOwner]);

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ 
      ...prev, 
      [name]: type === 'checkbox' ? checked : value 
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  }, [errors]);

  const handleOwnerSelect = useCallback((owner) => {
    setSelectedOwner(owner);
    setForm(prev => ({ ...prev, owner_id: String(owner.owner_id) }));
    setErrors(prev => ({ ...prev, owner_id: '' }));
    setServerError('');
  }, []);

  const validate = useCallback(() => {
    const newErrors = {};
    if (form.connectionType === 'vehicle') {
      if (!form.vehicle_id) {
        newErrors.vehicle_id = 'Please select a vehicle';
      }
      if (!form.owner_id) {
        newErrors.owner_id = 'Please select a Transport Owner';
      }
      if (!form.driver_id) {
        newErrors.driver_id = 'Please select a Driver';
      }
    } else {
      if (!form.driver_id) {
        newErrors.driver_id = 'Please select a Driver';
      }
      if (!form.owner_id) {
        newErrors.owner_id = 'Please select a Transport Owner';
      }
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
      let res;
      if (form.connectionType === 'vehicle') {
        res = await adminAPI.connectVehicle({
          vehicle_id: parseInt(form.vehicle_id),
          owner_id: parseInt(form.owner_id),
          driver_id: parseInt(form.driver_id),
        });
      } else {
        res = await adminAPI.connectDriver({
          driver_id: parseInt(form.driver_id),
          owner_id: parseInt(form.owner_id),
          is_driver_owner: form.is_driver_owner,
        });
      }

      if (res.data?.success) {
        onSuccess?.(res.data.data);
        handleClose();
      } else {
        setServerError(res.data?.message || 'Failed to create connection');
      }
    } catch (err) {
      console.error('Connection error:', err);
      const errorMsg = err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Server error. Please try again.';
      setServerError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, onSuccess]);

  const handleClose = useCallback(() => {
    setForm({ ...INITIAL_FORM, connectionType: initialType });
    setErrors({});
    setServerError('');
    setSelectedOwner(null);
    onClose();
  }, [onClose, initialType]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Create Connection"
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">+ Create Connection</h3>
              <p className="text-sm text-muted mt-0.5">
                Connect orphan records to establish operational relationships.
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

          {/* Connection Type */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Connection Type</span>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="connectionType"
                  value="vehicle"
                  checked={form.connectionType === 'vehicle'}
                  onChange={handleChange}
                  className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-medium">Connect Vehicle + Owner + Driver</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="connectionType"
                  value="driver"
                  checked={form.connectionType === 'driver'}
                  onChange={handleChange}
                  className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-medium">Connect Driver + Owner</span>
              </label>
            </div>
          </div>

          {/* Vehicle Selection (for vehicle connection type) */}
          {form.connectionType === 'vehicle' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Vehicle</span>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Select Vehicle <span className="text-red-500">*</span>
                </label>
                <select
                  name="vehicle_id"
                  value={form.vehicle_id}
                  onChange={handleChange}
                  className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                    errors.vehicle_id ? 'border-red-500/50' : 'border-border/60'
                  }`}
                >
                  <option value="">Select vehicle</option>
                  {vehicles.map(v => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>
                      {v.vehicle_number} - {v.vehicle_type} {v.vehicle_name ? `(${v.vehicle_name})` : ''}
                    </option>
                  ))}
                </select>
                {errors.vehicle_id && <p className="text-xs text-red-500 mt-1">{errors.vehicle_id}</p>}
                {vehicles.length === 0 && !loading && (
                  <p className="text-xs text-green-600 mt-1">No orphan vehicles found. All vehicles are connected.</p>
                )}
              </div>
            </div>
          )}

          {/* Driver Selection */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Driver</span>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Select Driver <span className="text-red-500">*</span>
              </label>
              <select
                name="driver_id"
                value={form.driver_id}
                onChange={handleChange}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.driver_id ? 'border-red-500/50' : 'border-border/60'
                }`}
              >
                <option value="">Select driver</option>
                {drivers.map(d => (
                  <option key={d.driver_id} value={d.driver_id}>
                    {d.driver_name} {d.driver_code ? `(${d.driver_code})` : ''}
                  </option>
                ))}
              </select>
              {errors.driver_id && <p className="text-xs text-red-500 mt-1">{errors.driver_id}</p>}
              {drivers.length === 0 && !loading && (
                <p className="text-xs text-amber-600 mt-1">No orphan drivers found. All drivers are connected.</p>
              )}
            </div>
          </div>

          {/* Owner Selection */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Transport Owner</span>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Select Transport Owner <span className="text-red-500">*</span>
              </label>
              <select
                name="owner_id"
                value={form.owner_id}
                onChange={(e) => {
                  handleChange(e);
                  const owner = owners.find(o => String(o.owner_id) === e.target.value);
                  if (owner) setSelectedOwner(owner);
                }}
                className={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                  errors.owner_id ? 'border-red-500/50' : 'border-border/60'
                }`}
              >
                <option value="">Select owner</option>
                {owners.map(o => (
                  <option key={o.owner_id} value={o.owner_id}>
                    {o.owner_name} ({o.owner_code}) - {o.owner_type}
                  </option>
                ))}
              </select>
              {errors.owner_id && <p className="text-xs text-red-500 mt-1">{errors.owner_id}</p>}
              {owners.length === 0 && !loading && (
                <p className="text-xs text-green-600 mt-1">No active owners found.</p>
              )}
            </div>
          </div>

          {/* Driver is Owner checkbox (for driver connection type) */}
          {form.connectionType === 'driver' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="is_driver_owner"
                    checked={form.is_driver_owner}
                    onChange={handleChange}
                    className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Driver is the Owner
                    </span>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      The selected driver is also the transport owner. No separate owner record needed.
                    </p>
                  </div>
                </label>
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
              disabled={submitting || loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connecting...
                </>
              ) : (
                'Create Connection'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
