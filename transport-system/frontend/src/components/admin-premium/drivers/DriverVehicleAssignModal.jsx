import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../../../services/api';

export default function DriverVehicleAssignModal({ isOpen, onClose, onSuccess, driver }) {
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchVehicles();
    }
  }, [isOpen]);

  const fetchVehicles = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminAPI.getAvailableVehicles(driver.driver_id);
      if (response.data?.success) {
        setVehicles(response.data.data || []);
      } else {
        setError(response.data?.message || 'Failed to load available vehicles');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load available vehicles');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = useCallback(async () => {
    if (!selectedVehicleId) {
      setError('Please select a vehicle');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await adminAPI.assignVehicleToDriver(driver.driver_id, selectedVehicleId);
      if (response.data?.success) {
        onSuccess?.();
        handleClose();
      } else {
        setError(response.data?.message || 'Failed to assign vehicle');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Server error');
    } finally {
      setSubmitting(false);
    }
  }, [selectedVehicleId, driver, onSuccess]);

  const handleClose = useCallback(() => {
    setSelectedVehicleId(null);
    setError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden" role="dialog" aria-modal="true" aria-label="Assign Vehicle">
        <div className="p-5 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Assign Vehicle</h3>
              <p className="text-sm text-muted mt-0.5">{driver.driver_name} ({driver.driver_code})</p>
            </div>
            <button onClick={handleClose} className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-hover/60 transition" aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse h-20 rounded-2xl bg-gray-100 dark:bg-gray-800/50" />
              ))}
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-text">No Available Vehicles</p>
              <p className="text-xs text-muted mt-1">All vehicles are currently assigned to other bookings</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vehicles.map(vehicle => (
                <button
                  key={vehicle.vehicle_id}
                  onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition ${
                    selectedVehicleId === vehicle.vehicle_id
                      ? 'border-violet-500 bg-violet-500/5'
                      : 'border-border/60 hover:border-violet-500/40'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{vehicle.vehicle_name || vehicle.vehicle_number}</div>
                      <div className="text-xs text-muted mt-0.5">
                        {vehicle.vehicle_number} · {vehicle.vehicle_type?.replace(/_/g, ' ') || '—'}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {vehicle.capacity_kg ? `${vehicle.capacity_kg} kg capacity` : ''}
                        {vehicle.per_km_rate ? ` · ₹${vehicle.per_km_rate}/km` : ''}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selectedVehicleId === vehicle.vehicle_id ? 'border-violet-500 bg-violet-500' : 'border-border'
                    }`}>
                      {selectedVehicleId === vehicle.vehicle_id && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border/60">
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={!selectedVehicleId || submitting || loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Assigning...
                </>
              ) : (
                'Assign Vehicle'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
