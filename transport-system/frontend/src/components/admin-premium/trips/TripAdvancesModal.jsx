import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

const PURPOSES = [
  { value: 'FUEL', label: 'Fuel' },
  { value: 'TOLL', label: 'Toll' },
  { value: 'LOADING', label: 'Loading' },
  { value: 'UNLOADING', label: 'Unloading' },
  { value: 'FOOD', label: 'Food' },
  { value: 'PARKING', label: 'Parking' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

function TripAdvancesModal({ isOpen, onClose, trip, onSaved }) {
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    recipient_type: 'driver',
    purpose: 'FUEL',
    custom_purpose: '',
    payment_method: 'cash',
    advance_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && trip) {
      fetchAdvances();
    }
  }, [isOpen, trip]);

  const fetchAdvances = async () => {
    if (!trip?.trip_id) return;
    setLoading(true);
    try {
      const response = await adminAPI.getTripAdvancesByTripId(trip.trip_id);
      if (response.data?.success) {
        setAdvances(response.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch advances:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!trip?.trip_id) return;
    setSaving(true);
    setError(null);

    try {
      // Map purpose to advance_type
      const purposeToAdvanceType = {
        'FUEL': 'FUEL_ADVANCE',
        'TOLL': 'DRIVER_ADVANCE',
        'LOADING': 'DRIVER_ADVANCE',
        'UNLOADING': 'DRIVER_ADVANCE',
        'FOOD': 'DRIVER_ADVANCE',
        'PARKING': 'DRIVER_ADVANCE',
        'MAINTENANCE': 'DRIVER_ADVANCE',
        'OTHER': 'OTHER',
      };

      const advanceType = purposeToAdvanceType[formData.purpose] || 'OTHER';
      const purposeValue = formData.purpose === 'OTHER' ? formData.custom_purpose : formData.purpose;

      const data = {
        amount: parseFloat(formData.amount),
        advance_type: advanceType,
        payment_method: formData.payment_method,
        advance_date: formData.advance_date,
        notes: formData.notes || purposeValue,
        reference_number: formData.reference || null,
      };

      // Add recipient ID based on type
      if (formData.recipient_type === 'driver' && trip.driver?.driver_id) {
        data.driver_id = trip.driver.driver_id;
      } else if (formData.recipient_type === 'owner' && trip.transportOwner?.owner_id) {
        data.transport_owner_id = trip.transportOwner.owner_id;
      }

      await adminAPI.createTripAdvanceByTripId(trip.trip_id, data);

      setShowForm(false);
      setFormData({
        amount: '',
        recipient_type: 'driver',
        purpose: 'FUEL',
        custom_purpose: '',
        payment_method: 'cash',
        advance_date: new Date().toISOString().split('T')[0],
        notes: '',
        reference: '',
      });
      await fetchAdvances();
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save advance');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormData({
      amount: '',
      recipient_type: 'driver',
      purpose: 'FUEL',
      custom_purpose: '',
      payment_method: 'cash',
      advance_date: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setError(null);
  };

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const totalAdvances = advances.reduce((sum, adv) => sum + (adv.amount || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Trip Advances</h2>
              <p className="text-sm text-muted mt-1">{trip?.trip_number} - {trip?.pickup_city} → {trip?.drop_city}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-hover/60 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* Helper text */}
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs text-amber-800">
              <strong>Advance:</strong> Money given to the driver or transport owner before/during the trip. 
              The purpose is simply a description of why the money was given.
            </p>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between mb-4 p-4 bg-green-50 rounded-xl">
            <span className="text-sm font-medium text-green-700">Total Advances</span>
            <span className="text-lg font-semibold text-green-700">{formatCurrency(totalAdvances)}</span>
          </div>

          {/* Add Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-6 p-4 bg-surface rounded-xl space-y-4">
              <h3 className="text-sm font-semibold">Give Advance</h3>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Amount (₹) *</label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                    required
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Paid To *</label>
                  <select
                    name="recipient_type"
                    value={formData.recipient_type}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    <option value="driver">Driver</option>
                    <option value="owner">Transport Owner</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Purpose *</label>
                  <select
                    name="purpose"
                    value={formData.purpose}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    {PURPOSES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                {formData.purpose === 'OTHER' && (
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1.5">Custom Purpose *</label>
                    <input
                      type="text"
                      name="custom_purpose"
                      value={formData.custom_purpose}
                      onChange={handleChange}
                      required
                      placeholder="Enter purpose"
                      className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Payment Method *</label>
                  <select
                    name="payment_method"
                    value={formData.payment_method}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Date *</label>
                  <input
                    type="date"
                    name="advance_date"
                    value={formData.advance_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-muted mb-1.5">Notes (optional)</label>
                  <input
                    type="text"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    placeholder="Additional notes..."
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Give Advance'}
                </button>
              </div>
            </form>
          )}

          {/* Add Button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full mb-4 px-4 py-2.5 border-2 border-dashed border-border/60 rounded-xl text-sm font-medium text-muted hover:border-amber-500 hover:text-amber-600 transition-colors"
            >
              + Give Advance
            </button>
          )}

          {/* Advances List */}
          {loading ? (
            <div className="text-center py-8 text-muted">Loading advances...</div>
          ) : advances.length === 0 ? (
            <div className="text-center py-8 text-muted">No advances given yet</div>
          ) : (
            <div className="space-y-3">
              {advances.map((advance) => (
                <div
                  key={advance.advance_id}
                  className="p-4 bg-surface rounded-xl"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-text">
                          {advance.recipient_type === 'owner' ? advance.owner_name || 'Transport Owner' : advance.driver_name || 'Driver'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          advance.recipient_type === 'owner' 
                            ? 'bg-purple-100 text-purple-700' 
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {advance.recipient_type === 'owner' ? 'Owner' : 'Driver'}
                        </span>
                      </div>
                      <div className="text-xs text-muted mb-2">
                        {advance.purpose}
                      </div>
                      <div className="text-sm font-semibold text-green-600 mb-1">
                        {formatCurrency(advance.amount)}
                      </div>
                      <div className="text-xs text-muted">
                        Paid via {advance.payment_method?.toUpperCase() || 'Cash'} • {formatDate(advance.advance_date)}
                        {advance.notes && ` • ${advance.notes}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default TripAdvancesModal;
