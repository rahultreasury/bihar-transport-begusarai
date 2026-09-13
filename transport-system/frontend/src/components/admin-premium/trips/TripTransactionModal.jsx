import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

const TRANSACTION_TYPES = [
  { value: 'OWNER_ADVANCE', label: 'Owner Advance', from: 'BIHAR_TRANSPORT', to: 'TRANSPORT_OWNER', direction: 'DEBIT' },
  { value: 'DRIVER_ADVANCE', label: 'Driver Advance', from: 'BIHAR_TRANSPORT', to: 'DRIVER', direction: 'DEBIT' },
  { value: 'FUEL_ADVANCE', label: 'Fuel Advance', from: 'BIHAR_TRANSPORT', to: 'DRIVER', direction: 'DEBIT' },
  { value: 'OWNER_SETTLEMENT', label: 'Owner Settlement', from: 'BIHAR_TRANSPORT', to: 'TRANSPORT_OWNER', direction: 'DEBIT' },
  { value: 'DRIVER_SETTLEMENT', label: 'Driver Settlement', from: 'BIHAR_TRANSPORT', to: 'DRIVER', direction: 'DEBIT' },
  // Customer/Client payments are recorded via the dedicated "Record Customer Payment" modal
  // TRIP_EXPENSE is excluded from the active trip financial workflow
];

function TripTransactionModal({ isOpen, onClose, trip, onSaved, defaultType = null }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    transaction_type: defaultType || 'OWNER_ADVANCE',
    amount: '',
    direction: 'DEBIT',
    from_party: 'BIHAR_TRANSPORT',
    to_party: 'TRANSPORT_OWNER',
    purpose: '',
    payment_method: 'cash',
    reference_number: '',
    transaction_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  // Update form when defaultType changes
  useEffect(() => {
    if (defaultType) {
      const txType = TRANSACTION_TYPES.find(t => t.value === defaultType);
      if (txType) {
        setFormData(prev => ({
          ...prev,
          transaction_type: defaultType,
          direction: txType.direction,
          from_party: txType.from,
          to_party: txType.to,
          purpose: txType.label,
        }));
      }
    }
  }, [defaultType]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const newData = { ...prev, [name]: value };

      // Auto-update from/to parties when transaction type changes
      if (name === 'transaction_type') {
        const txType = TRANSACTION_TYPES.find(t => t.value === value);
        if (txType) {
          newData.direction = txType.direction;
          newData.from_party = txType.from;
          newData.to_party = txType.to;
          newData.purpose = txType.label;
        }
      }

      return newData;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!trip?.trip_id && !trip?.booking_id) return;
    setSaving(true);
    setError(null);

    try {
      const data = {
        ...formData,
        amount: parseFloat(formData.amount),
        transaction_date: formData.transaction_date,
      };

      const id = trip.booking_id || trip.trip_id;
      await adminAPI.createTripTransaction(id, data);

      setShowForm(false);
      setFormData({
        transaction_type: defaultType || 'OWNER_ADVANCE',
        amount: '',
        direction: 'DEBIT',
        from_party: 'BIHAR_TRANSPORT',
        to_party: 'TRANSPORT_OWNER',
        purpose: '',
        payment_method: 'cash',
        reference_number: '',
        transaction_date: new Date().toISOString().split('T')[0],
        notes: '',
      });
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
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

  const selectedTxType = TRANSACTION_TYPES.find(t => t.value === formData.transaction_type);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Record Transaction</h2>
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
          {/* Transaction Type Selector (when form is hidden) */}
          {!showForm && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {TRANSACTION_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => {
                    setFormData(prev => ({
                      ...prev,
                      transaction_type: type.value,
                      direction: type.direction,
                      from_party: type.from,
                      to_party: type.to,
                      purpose: type.label,
                    }));
                    setShowForm(true);
                  }}
                  className={`p-4 rounded-xl border-2 text-left transition-colors ${
                    formData.transaction_type === type.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900">{type.label}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {type.from.replace(/_/g, ' ')} → {type.to.replace(/_/g, ' ')}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Transaction Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              {/* Live Preview */}
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      {formData.from_party?.replace(/_/g, ' ')}
                    </span>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">
                      {formData.to_party?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {formData.amount && (
                    <span className="text-lg font-semibold text-gray-900">
                      {formatCurrency(parseFloat(formData.amount))}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {formData.purpose} • {formData.direction}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Transaction Type *</label>
                  <select
                    name="transaction_type"
                    value={formData.transaction_type}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  >
                    {TRANSACTION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
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
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Payment Method</label>
                  <select
                    name="payment_method"
                    value={formData.payment_method}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
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
                    name="transaction_date"
                    value={formData.transaction_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Reference / Transaction ID</label>
                  <input
                    type="text"
                    name="reference_number"
                    value={formData.reference_number}
                    onChange={handleChange}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Notes</label>
                  <input
                    type="text"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    placeholder="Optional notes"
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
                >
                  Back
                </button>
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
                  className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Recording...' : 'Record Transaction'}
                </button>
              </div>
            </form>
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

export default TripTransactionModal;
