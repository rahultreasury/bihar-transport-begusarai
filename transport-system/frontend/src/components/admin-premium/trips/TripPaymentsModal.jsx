import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

const PAYMENT_TYPES = [
  { value: 'ADVANCE', label: 'Advance' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'FULL', label: 'Full' },
  { value: 'SETTLEMENT', label: 'Settlement' },
  { value: 'OTHER', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
];

function TripPaymentsModal({ isOpen, onClose, trip, onSaved }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    amount: '',
    payment_type: 'ADVANCE',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    reference: '',
    notes: '',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && trip) {
      fetchPayments();
    }
  }, [isOpen, trip]);

  const fetchPayments = async () => {
    if (!trip?.trip_id) return;
    setLoading(true);
    try {
      const response = await adminAPI.getTripPayments(trip.trip_id);
      if (response.data?.success) {
        setPayments(response.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch payments:', err);
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
      const data = {
        ...formData,
        amount: parseFloat(formData.amount),
      };

      await adminAPI.addTripPayment(trip.trip_id, data);

      setShowForm(false);
      setFormData({
        amount: '',
        payment_type: 'ADVANCE',
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'cash',
        reference: '',
        notes: '',
      });
      await fetchPayments();
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save payment');
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

  const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Trip Payments</h2>
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
          {/* Total */}
          <div className="flex items-center justify-between mb-4 p-4 bg-green-50 rounded-xl">
            <span className="text-sm font-medium text-green-700">Total Received</span>
            <span className="text-lg font-semibold text-green-700">{formatCurrency(totalPayments)}</span>
          </div>

          {/* Add Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-6 p-4 bg-surface rounded-xl space-y-4">
              <h3 className="text-sm font-semibold">Add Payment</h3>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Amount (₹)</label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                    required
                    step="0.01"
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Payment Type</label>
                  <select
                    name="payment_type"
                    value={formData.payment_type}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    {PAYMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Payment Date</label>
                  <input
                    type="date"
                    name="payment_date"
                    value={formData.payment_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Payment Method</label>
                  <select
                    name="payment_method"
                    value={formData.payment_method}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Reference</label>
                  <input
                    type="text"
                    name="reference"
                    value={formData.reference}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Notes</label>
                  <input
                    type="text"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Add Payment'}
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
              + Add Payment
            </button>
          )}

          {/* Payments List */}
          {loading ? (
            <div className="text-center py-8 text-muted">Loading payments...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-muted">No payments recorded yet</div>
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => (
                <div
                  key={payment.payment_id}
                  className="flex items-center justify-between p-3 bg-surface rounded-xl"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{payment.payment_type}</span>
                      <span className="text-sm font-semibold text-green-600">{formatCurrency(payment.amount)}</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {payment.payment_date ? new Date(payment.payment_date).toLocaleDateString('en-IN') : ''}
                      {payment.payment_method && ` - ${payment.payment_method}`}
                      {payment.reference && ` (Ref: ${payment.reference})`}
                      {payment.notes && ` - ${payment.notes}`}
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

export default TripPaymentsModal;
