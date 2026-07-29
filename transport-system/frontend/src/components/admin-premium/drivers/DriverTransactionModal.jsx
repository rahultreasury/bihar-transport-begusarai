import React, { useState, useCallback } from 'react';
import { adminAPI } from '../../../services/api';

const TRANSACTION_TYPES = [
  { value: 'advance', label: 'Advance', icon: '💰' },
  { value: 'trip_payment', label: 'Trip Payment', icon: '💵' },
  { value: 'fuel_expense', label: 'Fuel', icon: '⛽' },
  { value: 'toll_expense', label: 'Toll', icon: '🛣️' },
  { value: 'recovery', label: 'Recovery', icon: '🔄' },
  { value: 'other_expense', label: 'Other Expense', icon: '📋' },
];

const INITIAL_FORM = {
  transaction_type: 'advance',
  amount: '',
  payment_mode: 'cash',
  description: '',
  notes: '',
};

export default function DriverTransactionModal({ isOpen, onClose, onSuccess, driver }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError('');
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await adminAPI.recordDriverTransaction(driver.driver_id, {
        transaction_type: form.transaction_type,
        amount: parseFloat(form.amount),
        payment_mode: form.payment_mode,
        description: form.description || `${TRANSACTION_TYPES.find(t => t.value === form.transaction_type)?.label} of ₹${parseFloat(form.amount).toLocaleString('en-IN')}`,
        notes: form.notes || undefined,
      });

      if (response.data?.success) {
        onSuccess?.();
        handleClose();
      } else {
        setError(response.data?.message || 'Failed to record transaction');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Server error');
    } finally {
      setSubmitting(false);
    }
  }, [form, driver, onSuccess]);

  const handleClose = useCallback(() => {
    setForm({ ...INITIAL_FORM });
    setError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const selectedType = TRANSACTION_TYPES.find(t => t.value === form.transaction_type);
  const isDebit = ['advance', 'fuel_expense', 'toll_expense', 'other_expense'].includes(form.transaction_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden" role="dialog" aria-modal="true" aria-label="Record Transaction">
        <div className="p-5 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Record Transaction</h3>
              <p className="text-sm text-muted mt-0.5">{driver.driver_name} ({driver.driver_code})</p>
            </div>
            <button onClick={handleClose} className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-hover/60 transition" aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          {/* Transaction Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Transaction Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TRANSACTION_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, transaction_type: type.value }))}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition ${
                    form.transaction_type === type.value
                      ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border/60 hover:bg-hover/60'
                  }`}
                >
                  <span className="mr-1.5">{type.icon}</span>
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Amount (₹) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleChange}
              placeholder="0.00"
              min="0.01"
              step="0.01"
              className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
            />
            <p className={`text-xs mt-1 ${isDebit ? 'text-red-500' : 'text-green-500'}`}>
              {isDebit ? 'This will be debited from driver balance' : 'This will be credited to driver balance'}
            </p>
          </div>

          {/* Payment Mode */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Payment Mode</label>
            <select
              name="payment_mode"
              value={form.payment_mode}
              onChange={handleChange}
              className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Brief description of the transaction"
              className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Notes (Optional)</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder="Additional notes..."
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t border-border/60">
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Recording...
                </>
              ) : (
                `Record ${selectedType?.label || 'Transaction'}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
