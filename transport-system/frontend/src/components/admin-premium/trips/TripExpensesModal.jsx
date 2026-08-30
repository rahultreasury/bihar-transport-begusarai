import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

const EXPENSE_TYPES = [
  { value: 'DRIVER', label: 'Driver' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'TOLL', label: 'Toll' },
  { value: 'LOADING', label: 'Loading' },
  { value: 'UNLOADING', label: 'Unloading' },
  { value: 'OWNER', label: 'Owner' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

function TripExpensesModal({ isOpen, onClose, trip, onSaved }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [formData, setFormData] = useState({
    expense_type: 'DRIVER',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    description: '',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && trip) {
      fetchExpenses();
    }
  }, [isOpen, trip]);

  const fetchExpenses = async () => {
    if (!trip?.trip_id) return;
    setLoading(true);
    try {
      const response = await adminAPI.getTripExpenses(trip.trip_id);
      if (response.data?.success) {
        setExpenses(response.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch expenses:', err);
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

      if (editingExpense) {
        await adminAPI.updateTripExpense(trip.trip_id, editingExpense.expense_id, data);
      } else {
        await adminAPI.addTripExpense(trip.trip_id, data);
      }

      setShowForm(false);
      setEditingExpense(null);
      setFormData({
        expense_type: 'DRIVER',
        amount: '',
        expense_date: new Date().toISOString().split('T')[0],
        description: '',
      });
      await fetchExpenses();
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (expense) => {
    setEditingExpense(expense);
    setFormData({
      expense_type: expense.expense_type,
      amount: expense.amount,
      expense_date: expense.expense_date ? new Date(expense.expense_date).toISOString().split('T')[0] : '',
      description: expense.description || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (expenseId) => {
    if (!trip?.trip_id) return;
    if (!window.confirm('Are you sure you want to delete this expense?')) {
      return;
    }
    try {
      await adminAPI.deleteTripExpense(trip.trip_id, expenseId);
      await fetchExpenses();
      onSaved?.();
    } catch (err) {
      alert(err.message || 'Failed to delete expense');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingExpense(null);
    setFormData({
      expense_type: 'DRIVER',
      amount: '',
      expense_date: new Date().toISOString().split('T')[0],
      description: '',
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

  const totalExpenses = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Trip Expenses</h2>
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
          <div className="flex items-center justify-between mb-4 p-4 bg-red-50 rounded-xl">
            <span className="text-sm font-medium text-red-700">Total Expenses</span>
            <span className="text-lg font-semibold text-red-700">{formatCurrency(totalExpenses)}</span>
          </div>

          {/* Add/Edit Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-6 p-4 bg-surface rounded-xl space-y-4">
              <h3 className="text-sm font-semibold">{editingExpense ? 'Edit Expense' : 'Add Expense'}</h3>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Expense Type</label>
                  <select
                    name="expense_type"
                    value={formData.expense_type}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  >
                    {EXPENSE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
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
                  <label className="block text-sm font-medium text-muted mb-1.5">Date</label>
                  <input
                    type="date"
                    name="expense_date"
                    value={formData.expense_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-white border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-muted mb-1.5">Description</label>
                  <input
                    type="text"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
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
                  {saving ? 'Saving...' : editingExpense ? 'Update' : 'Add Expense'}
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
              + Add Expense
            </button>
          )}

          {/* Expenses List */}
          {loading ? (
            <div className="text-center py-8 text-muted">Loading expenses...</div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-8 text-muted">No expenses recorded yet</div>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div
                  key={expense.expense_id}
                  className="flex items-center justify-between p-3 bg-surface rounded-xl"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{EXPENSE_TYPES.find(t => t.value === expense.expense_type)?.label || expense.expense_type}</span>
                      <span className="text-sm font-semibold text-red-600">{formatCurrency(expense.amount)}</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {expense.expense_date ? new Date(expense.expense_date).toLocaleDateString('en-IN') : ''}
                      {expense.description && ` - ${expense.description}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(expense)}
                      className="p-1.5 hover:bg-hover/60 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(expense.expense_id)}
                      className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
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

export default TripExpensesModal;
