import React from 'react';

/**
 * TripPartyAccounts
 * Shows financial account summary for each party involved in the trip.
 *
 * Makes it immediately obvious who owes whom.
 */

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

function AccountCard({ title, party, items, due, dueLabel = 'Due', dueColor = 'text-orange-600', bgColor = 'bg-orange-50' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</h4>

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-600">{item.label}</span>
            <span className={`text-sm font-medium ${item.color || 'text-gray-900'}`}>
              {formatCurrency(item.value)}
            </span>
          </div>
        ))}

        {items.length > 0 && (
          <div className="border-t border-gray-100 my-2 pt-2">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-sm font-medium text-gray-700">{dueLabel}</span>
              <span className={`text-sm font-bold ${dueColor}`}>
                {formatCurrency(due)}
              </span>
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div className="text-center py-4 text-gray-400 text-sm">No transactions yet</div>
        )}
      </div>
    </div>
  );
}

export default function TripPartyAccounts({ balances = {}, freight = 0, commission = 0, ownerShare = 0 }) {
  const { customer = {}, client = {}, owner = {}, driver = {} } = balances;

  const customerReceived = customer.received || 0;
  const customerDue = Math.max(0, freight - customerReceived);

  const clientReceived = client.received || 0;
  const clientDue = Math.max(0, freight - clientReceived);

  const ownerTotalPaid = (owner.advance || 0) + (owner.settlement || 0);
  const ownerDue = Math.max(0, ownerShare - ownerTotalPaid);

  const driverTotalPaid = (driver.advance || 0) + (driver.settlement || 0);
  const driverDue = Math.max(0, (driver.payout || 0) - driverTotalPaid);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Party Accounts</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Customer Account */}
        <AccountCard
          title="Customer Account"
          party="Customer"
          items={[
            { label: 'Freight', value: freight },
            { label: 'Received', value: customerReceived, color: 'text-green-600' },
          ]}
          due={customerDue}
          dueLabel="Receivable"
          dueColor="text-orange-600"
          bgColor="bg-orange-50"
        />

        {/* Client Account */}
        {clientReceived > 0 || clientDue > 0 ? (
          <AccountCard
            title="Client Account"
            party="Client"
            items={[
              { label: 'Freight', value: freight },
              { label: 'Received', value: clientReceived, color: 'text-green-600' },
            ]}
            due={clientDue}
            dueLabel="Receivable"
            dueColor="text-orange-600"
            bgColor="bg-orange-50"
          />
        ) : null}

        {/* Owner Account */}
        <AccountCard
          title="Owner Account"
          party="Transport Owner"
          items={[
            { label: 'Owner Share', value: ownerShare },
            { label: 'Advance Paid', value: owner.advance || 0, color: 'text-red-600' },
            { label: 'Settlement Paid', value: owner.settlement || 0, color: 'text-red-600' },
          ]}
          due={ownerDue}
          dueLabel="Owner Due"
          dueColor={ownerDue > 0 ? 'text-orange-600' : 'text-green-600'}
          bgColor={ownerDue > 0 ? 'bg-orange-50' : 'bg-green-50'}
        />

        {/* Driver Account */}
        <AccountCard
          title="Driver Account"
          party="Driver"
          items={[
            { label: 'Driver Payout', value: driver.payout || 0 },
            { label: 'Advance Paid', value: driver.advance || 0, color: 'text-red-600' },
            { label: 'Settlement Paid', value: driver.settlement || 0, color: 'text-red-600' },
          ]}
          due={driverDue}
          dueLabel="Driver Due"
          dueColor={driverDue > 0 ? 'text-orange-600' : 'text-green-600'}
          bgColor={driverDue > 0 ? 'bg-orange-50' : 'bg-green-50'}
        />
      </div>
    </div>
  );
}
