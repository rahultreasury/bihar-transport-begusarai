import React, { useState, useCallback, useMemo } from 'react';
import { adminAPI } from '../../../services/api';

const TRANSACTION_TYPES = [
  { value: 'advance', label: 'Advance Payment', description: 'Pay advance to driver before trip', icon: '💰' },
  { value: 'payment', label: 'Trip Payment', description: 'Record final trip payment/settlement', icon: '💵' },
  { value: 'fuel', label: 'Fuel Expense', description: 'Record fuel expense for a trip', icon: '⛽' },
  { value: 'toll', label: 'Toll Expense', description: 'Record toll charges paid', icon: '🛣️' },
  { value: 'other', label: 'Other Expense', description: 'Record other miscellaneous expenses', icon: '📋' }
];

const INITIAL_FORM = {
  transactionType: 'advance',
  amount: '',
  description: '',
  payment_mode: 'cash',
  booking_id: '',
  notes: ''
};

export default function DriverFinanceModal({ isOpen, onClose, onSuccess, driver }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const selectedType = useMemo(
    () => TRANSACTION_TYPES.find(t => t.value === form.transactionType),
    [form.transactionType]
  );

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    setServerError('');
  }, [errors]);

  const validate = useCallback(() => {
    const newErrors = {};
    const amount = parseFloat(form.amount);
    if (!form.amount || isNaN(amount) || amount <= 0) {
      newErrors.amount = 'Enter a valid amount greater than 0';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form.amount]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError('');

    try {
      const amount = parseFloat(form.amount);
      let response;

      const payload = {
        amount,
        description: form.description.trim() || undefined,
        payment_mode: form.payment_mode,
        booking_id: form.booking_id ? parseInt(form.booking_id) : undefined,
        notes: form.notes.trim() || undefined
      };

      if (form.transactionType === 'advance') {
        response = await adminAPI.addDriverAdvance(driver.driver_id, payload);
      } else if (form.transactionType === 'payment') {
        response = await adminAPI.addDriverPayment(driver.driver_id, payload);
      } else {
        response = await adminAPI.addDriverExpense(driver.driver_id, {
          ...payload,
          expense_type: form.transactionType
        });
      }

      if (response.data?.success) {
        onSuccess?.(response.data.data);
        handleClose();
      } else {
        setServerError(response.data?.message || 'Transaction failed');
      }
    } catch (err) {
      console.error('Finance transaction error:', err);
      setServerError(
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.msg ||
        'Server error. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, validate, driver, onSuccess]);

  const handleClose = useCallback(() => {
    setForm({ ...INITIAL_FORM });
    setErrors({});
    setServerError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Record Transaction"
      >
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Record Transaction</h3>
              <p className="text-sm text-muted mt-0.5">
                {driver?.driver_name ? `For ${driver.driver_name} (${driver.driver_code})` : ''}
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
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1">
          {serverError && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
              {serverError}
            </div>
          )}

          {/* Transaction Type Selection */}
          <div className="mb-5">
            <label className="block text-sm font-medium mb-2">Transaction Type</label>
            <div className="grid grid-cols-1 gap-2">
              {TRANSACTION_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, transactionType: type.value }))}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                    form.transactionType === type.value
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-border/60 bg-card/40 hover:bg-hover/60'
                  }`}
                >
                  <span className="text-xl">{type.icon}</span>
                  <div>
                    <div className="text-sm font-semibold">{type.label}</div>
                    <div className="text-[11px] text-muted">{type.description}</div>
                  </div>
                  {form.transactionType === type.value && (
                    <span className="ml-auto text-amber-500">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {selectedType && (
            <div className="space-y-4">
              {/* Amount */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Amount (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted text-sm font-medium">₹</span>
                  <input
                    type="number"
                    name="amount"
                    value={form.amount}
                    onChange={handleChange}
                    placeholder="0.00"
                    min="1"
                    step="0.01"
                    className={`w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
                      errors.amount ? 'border-red-500/50' : 'border-border/60'
                    }`}
                  />
                </div>
                {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <input
                  type="text"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Optional description"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
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

              {/* Booking ID (optional) */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Booking Reference (optional)</label>
                <input
                  type="text"
                  name="booking_id"
                  value={form.booking_id}
                  onChange={handleChange}
                  placeholder="Booking ID if linked"
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  placeholder="Any additional notes..."
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-border/60 text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition resize-none"
                />
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

