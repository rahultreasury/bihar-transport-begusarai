import React, { useState } from 'react';
import { adminAPI } from '../../../services/api';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

function TripSettlementModal({ isOpen, onClose, trip, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    payment_method: 'cash',
    settlement_date: new Date().toISOString().split('T')[0],
    reference: '',
    notes: '',
  });
  const [error, setError] = useState(null);

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
      const data = {
        amount: parseFloat(formData.amount),
        payment_method: formData.payment_method,
        settlement_date: formData.settlement_date,
        reference: formData.reference,
        notes: formData.notes,
      };

      // Record owner settlement
      await adminAPI.recordOwnerSettlement(trip.trip_id, data);

      setFormData({
        amount: '',
        payment_method: 'cash',
        settlement_date: new Date().toISOString().split('T')[0],
        reference: '',
        notes: '',
      });
      onSaved?.();
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to record settlement';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Settle Payment</h2>
              <p className="text-sm text-muted mt-1">{trip?.trip_number}</p>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}

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
              name="settlement_date"
              value={formData.settlement_date}
              onChange={handleChange}
              className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Reference (optional)</label>
            <input
              type="text"
              name="reference"
              value={formData.reference}
              onChange={handleChange}
              placeholder="Receipt number, transaction ID, etc."
              className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            />
          </div>

          <div>
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

          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Settle Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TripSettlementModal;
