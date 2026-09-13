import React from 'react';

/**
 * TripMoneyFlow
 * Visual representation of money movement for a trip.
 *
 * Shows the complete flow:
 * Customer/Client → Bihar Transport → [Advances/Settlements] → Parties
 *
 * NOTE: Trip expenses are excluded from the active trip financial workflow.
 */

const PARTY_COLORS = {
  BIHAR_TRANSPORT: 'bg-blue-500',
  CUSTOMER: 'bg-green-500',
  CLIENT: 'bg-emerald-500',
  TRANSPORT_OWNER: 'bg-purple-500',
  DRIVER: 'bg-orange-500',
  VENDOR: 'bg-gray-500',
  OTHER: 'bg-gray-400',
};

const PARTY_LABELS = {
  BIHAR_TRANSPORT: 'Bihar Transport',
  CUSTOMER: 'Customer',
  CLIENT: 'Client',
  TRANSPORT_OWNER: 'Transport Owner',
  DRIVER: 'Driver',
  VENDOR: 'Vendor',
  OTHER: 'Other',
};

function ArrowDown({ color = 'bg-gray-400' }) {
  return (
    <div className="flex flex-col items-center py-1">
      <div className={`w-0.5 h-6 ${color}`}></div>
      <div className={`w-2 h-2 rotate-45 ${color}`}></div>
    </div>
  );
}

function MoneyFlowCard({ party, amount, label, color, isSource = false }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl ${color} bg-opacity-10 border ${color} border-opacity-30`}>
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${color}`}></div>
        <span className="text-sm font-medium text-gray-700">{party}</span>
      </div>
      {amount > 0 && (
        <span className="text-sm font-semibold text-gray-900">₹{amount.toLocaleString()}</span>
      )}
    </div>
  );
}

export default function TripMoneyFlow({ transactions = [], freight = 0, commission = 0, ownerShare = 0 }) {
  // Build money flow from transactions
  // NOTE: Trip expenses are excluded from the active trip financial workflow.
  const flow = {
    customerPayment: 0,
    clientPayment: 0,
    ownerAdvance: 0,
    driverAdvance: 0,
    ownerSettlement: 0,
    driverSettlement: 0,
  };

  for (const tx of transactions) {
    const amount = tx.amount || 0;
    if (tx.transaction_type === 'CUSTOMER_PAYMENT' && tx.direction === 'CREDIT') {
      flow.customerPayment += amount;
    } else if (tx.transaction_type === 'CLIENT_PAYMENT' && tx.direction === 'CREDIT') {
      flow.clientPayment += amount;
    } else if (tx.transaction_type === 'OWNER_ADVANCE') {
      flow.ownerAdvance += amount;
    } else if (tx.transaction_type === 'DRIVER_ADVANCE' || tx.transaction_type === 'FUEL_ADVANCE') {
      flow.driverAdvance += amount;
    } else if (tx.transaction_type === 'OWNER_SETTLEMENT') {
      flow.ownerSettlement += amount;
    } else if (tx.transaction_type === 'DRIVER_SETTLEMENT') {
      flow.driverSettlement += amount;
    }
    // TRIP_EXPENSE is intentionally excluded from the active trip financial workflow
  }

  const hasCustomerPayment = flow.customerPayment > 0;
  const hasClientPayment = flow.clientPayment > 0;
  const hasPayments = hasCustomerPayment || hasClientPayment;
  const hasOutflows = flow.ownerAdvance > 0 || flow.driverAdvance > 0 || flow.ownerSettlement > 0 || flow.driverSettlement > 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Money Flow</h3>

      <div className="space-y-4">
        {/* Revenue Side */}
        {hasPayments && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Revenue</div>
            {hasCustomerPayment && (
              <MoneyFlowCard
                party="Customer"
                amount={flow.customerPayment}
                color="bg-green-500"
                isSource
              />
            )}
            {hasClientPayment && (
              <MoneyFlowCard
                party="Client"
                amount={flow.clientPayment}
                color="bg-emerald-500"
                isSource
              />
            )}
            <div className="flex items-center gap-2 py-2">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="text-xs text-gray-400">Total: ₹{(flow.customerPayment + flow.clientPayment).toLocaleString()}</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>
          </div>
        )}

        {/* Bihar Transport (Hub) */}
        <div className="flex justify-center">
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl px-6 py-3 text-center">
            <div className="text-sm font-semibold text-blue-700">Bihar Transport</div>
            <div className="text-xs text-blue-500 mt-0.5">Freight: ₹{freight.toLocaleString()}</div>
            {commission > 0 && (
              <div className="text-xs text-blue-400">Commission: ₹{commission.toLocaleString()}</div>
            )}
          </div>
        </div>

        {/* Outflows */}
        {hasOutflows && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Advances & Settlements</div>

            {flow.ownerAdvance > 0 && (
              <>
                <ArrowDown color="bg-purple-400" />
                <MoneyFlowCard
                  party="Transport Owner (Advance)"
                  amount={flow.ownerAdvance}
                  color="bg-purple-500"
                />
              </>
            )}

            {flow.driverAdvance > 0 && (
              <>
                <ArrowDown color="bg-orange-400" />
                <MoneyFlowCard
                  party="Driver (Advance)"
                  amount={flow.driverAdvance}
                  color="bg-orange-500"
                />
              </>
            )}

            {flow.ownerSettlement > 0 && (
              <>
                <ArrowDown color="bg-purple-400" />
                <MoneyFlowCard
                  party="Transport Owner (Settlement)"
                  amount={flow.ownerSettlement}
                  color="bg-purple-600"
                />
              </>
            )}

            {flow.driverSettlement > 0 && (
              <>
                <ArrowDown color="bg-orange-400" />
                <MoneyFlowCard
                  party="Driver (Settlement)"
                  amount={flow.driverSettlement}
                  color="bg-orange-600"
                />
              </>
            )}

            {/* Trip expenses are excluded from the active trip financial workflow */}
          </div>
        )}

        {/* No transactions */}
        {!hasPayments && !hasOutflows && (
          <div className="text-center py-8 text-gray-400 text-sm">
            No financial transactions recorded yet
          </div>
        )}
      </div>
    </div>
  );
}
