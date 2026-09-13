import React, { useState, useMemo } from 'react';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

const ADVANCE_TYPES = [
  { value: 'DRIVER_ADVANCE', label: 'Driver Advance' },
  { value: 'OWNER_ADVANCE', label: 'Transport Owner Advance' },
  { value: 'OTHER', label: 'Other Advance' },
];

function TripAdvanceStep({ formData, onChange, errors }) {
  const [advances, setAdvances] = useState(
    formData.advances && formData.advances.length > 0
      ? formData.advances
      : [{ type: 'DRIVER_ADVANCE', amount: '', payment_method: 'cash', date: new Date().toISOString().split('T')[0], note: '' }]
  );

  const totals = useMemo(() => {
    return advances.reduce(
      (acc, adv) => {
        const amount = parseFloat(adv.amount) || 0;
        acc.total += amount;
        if (adv.type === 'DRIVER_ADVANCE') acc.driver += amount;
        else if (adv.type === 'OWNER_ADVANCE') acc.owner += amount;
        else acc.other += amount;
        return acc;
      },
      { total: 0, driver: 0, owner: 0, other: 0 }
    );
  }, [advances]);

  // Sync advances to parent
  React.useEffect(() => {
    if (onChange) {
      onChange(advances);
    }
  }, [advances, onChange]);

  const handleAdvanceChange = (index, field, value) => {
    setAdvances((prev) =>
      prev.map((adv, i) => (i === index ? { ...adv, [field]: value } : adv))
    );
  };

  const addAdvance = () => {
    setAdvances((prev) => [
      ...prev,
      { type: 'DRIVER_ADVANCE', amount: '', payment_method: 'cash', date: new Date().toISOString().split('T')[0], note: '' },
    ]);
  };

  const removeAdvance = (index) => {
    setAdvances((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <span>💰</span> Advance Payments
      </h3>
      <p className="text-sm text-muted">Record advance payments for this trip. Advances are first-class financial transactions.</p>

      <div className="space-y-4">
        {advances.map((advance, index) => (
          <div key={index} className="p-4 bg-surface border border-border/60 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted">Advance #{index + 1}</span>
              {advances.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAdvance(index)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Type *</label>
                <select
                  value={advance.type}
                  onChange={(e) => handleAdvanceChange(index, 'type', e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                >
                  {ADVANCE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Amount (₹) *</label>
                <input
                  type="number"
                  value={advance.amount}
                  onChange={(e) => handleAdvanceChange(index, 'amount', e.target.value)}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Payment Method</label>
                <select
                  value={advance.payment_method}
                  onChange={(e) => handleAdvanceChange(index, 'payment_method', e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Date</label>
                <input
                  type="date"
                  value={advance.date}
                  onChange={(e) => handleAdvanceChange(index, 'date', e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1.5">Note (Optional)</label>
              <input
                type="text"
                value={advance.note}
                onChange={(e) => handleAdvanceChange(index, 'note', e.target.value)}
                placeholder="Optional note..."
                className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addAdvance}
        className="w-full py-3 border-2 border-dashed border-border/60 rounded-xl text-sm font-medium text-muted hover:border-amber-500 hover:text-amber-600 transition-colors"
      >
        + Add Another Advance
      </button>

      {/* Live Summary */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <h4 className="text-sm font-semibold text-amber-800 mb-3">TOTAL ADVANCE</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-amber-700">Driver</span>
            <span className="font-medium text-amber-800">₹{totals.driver.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-amber-700">Owner</span>
            <span className="font-medium text-amber-800">₹{totals.owner.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-amber-700">Other</span>
            <span className="font-medium text-amber-800">₹{totals.other.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-amber-300">
            <span className="font-semibold text-amber-900">Total</span>
            <span className="font-semibold text-amber-900">₹{totals.total.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TripAdvanceStep;
