import React from 'react';

function TripSummary({ formData, clients, owners, ownerVehicles, allDrivers, onNavigateToStep }) {
  const selectedClient = clients.find(c => c.user_id === parseInt(formData.user_id));
  const selectedOwner = owners.find(o => o.owner_id === parseInt(formData.transport_owner_id));
  const selectedVehicle = ownerVehicles.find(v => v.vehicle_id === parseInt(formData.vehicle_id));
  const selectedDriver = allDrivers.find(d => d.driver_id === parseInt(formData.driver_id));

  const freightAmount = parseFloat(formData.freight_amount || 0);
  const ownerPayment = parseFloat(formData.owner_payment || 0);
  const driverPayment = parseFloat(formData.driver_payment || 0);
  const advance = parseFloat(formData.advance || 0);
  const totalExpenses = ownerPayment + driverPayment + advance;
  const estimatedProfit = freightAmount - totalExpenses;

  const SummaryRow = ({ label, value, subValue, step, isClickable = true }) => (
    <button
      type="button"
      onClick={() => isClickable && onNavigateToStep?.(step)}
      className={`w-full text-left py-2.5 border-b border-border/40 last:border-0 flex items-center justify-between gap-2 group ${
        isClickable ? 'hover:bg-hover/40 transition-colors' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
        <div className="text-sm font-medium truncate">{value || 'Not selected'}</div>
        {subValue && <div className="text-xs text-muted truncate">{subValue}</div>}
      </div>
      {isClickable && (
        <svg className="w-4 h-4 text-muted group-hover:text-text transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );

  return (
    <div className="bg-card/40 rounded-2xl border border-border/60 p-5">
      <h3 className="text-lg font-semibold mb-4">Trip Summary</h3>

      <div className="space-y-1">
        <SummaryRow
          label="Client"
          value={selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : ''}
          subValue={selectedClient?.phone}
          step={0}
        />

        <SummaryRow
          label="Route"
          value={formData.pickup_city && formData.drop_city ? `${formData.pickup_city} → ${formData.drop_city}` : ''}
          subValue={formData.trip_date}
          step={1}
        />

        <div className="py-2.5 border-b border-border/40">
          <div className="text-xs text-muted uppercase tracking-wider mb-1">Transport Assignment</div>
          <div className="space-y-1 pl-2 border-l-2 border-amber-500">
            <SummaryRow
              label="Owner"
              value={
                selectedOwner?.owner_name
                  ? `${selectedOwner.owner_name} ${selectedOwner.owner_type === 'DRIVER_OWNER' ? '(Driver Owner)' : selectedOwner.owner_type === 'INDIVIDUAL_OWNER' ? '(Individual)' : ''}`
                  : ''
              }
              subValue={selectedOwner?.company_name || selectedOwner?.mobile}
              step={2}
              isClickable={!!formData.user_id}
            />
            <SummaryRow
              label="Vehicle"
              value={selectedVehicle?.vehicle_number}
              subValue={selectedVehicle?.vehicle_name}
              step={2}
              isClickable={!!formData.transport_owner_id}
            />
            <SummaryRow
              label="Driver"
              value={selectedDriver?.driver_name}
              subValue={selectedDriver?.mobile}
              step={2}
              isClickable={!!formData.transport_owner_id}
            />
          </div>
        </div>

        <SummaryRow
          label="Freight"
          value={freightAmount > 0 ? `₹${freightAmount.toLocaleString('en-IN')}` : ''}
          step={3}
          isClickable={!!formData.user_id}
        />

        <SummaryRow
          label="Owner Payable"
          value={ownerPayment > 0 ? `₹${ownerPayment.toLocaleString('en-IN')}` : ''}
          step={3}
          isClickable={!!formData.user_id}
        />

        <SummaryRow
          label="Driver Payable"
          value={driverPayment > 0 ? `₹${driverPayment.toLocaleString('en-IN')}` : ''}
          step={3}
          isClickable={!!formData.user_id}
        />

        <SummaryRow
          label="Advance"
          value={advance > 0 ? `₹${advance.toLocaleString('en-IN')}` : ''}
          step={3}
          isClickable={!!formData.user_id}
        />
      </div>

      {/* Financial Totals */}
      <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Total Revenue</span>
          <span className="font-medium text-amber-600">₹{freightAmount.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Total Expenses</span>
          <span className="font-medium text-red-600">₹{totalExpenses.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex justify-between text-sm pt-2 border-t border-border/40">
          <span className="font-medium">Estimated Profit</span>
          <span className={`font-semibold ${estimatedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ₹{estimatedProfit.toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TripSummary;
