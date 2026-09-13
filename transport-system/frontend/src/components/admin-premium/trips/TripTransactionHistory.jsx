import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const PARTY_COLORS = {
  BIHAR_TRANSPORT: 'bg-blue-100 text-blue-700',
  CUSTOMER: 'bg-green-100 text-green-700',
  CLIENT: 'bg-emerald-100 text-emerald-700',
  TRANSPORT_OWNER: 'bg-purple-100 text-purple-700',
  DRIVER: 'bg-orange-100 text-orange-700',
  VENDOR: 'bg-gray-100 text-gray-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

const TRANSACTION_TYPE_LABELS = {
  CUSTOMER_PAYMENT: 'Customer Payment',
  CLIENT_PAYMENT: 'Client Payment',
  DRIVER_ADVANCE: 'Driver Advance',
  FUEL_ADVANCE: 'Fuel Advance',
  OWNER_ADVANCE: 'Owner Advance',
  DRIVER_SETTLEMENT: 'Driver Settlement',
  OWNER_SETTLEMENT: 'Owner Settlement',
  COMMISSION: 'Commission',
  // TRIP_EXPENSE is excluded from the active trip financial workflow
  ADJUSTMENT: 'Adjustment',
  REFUND: 'Refund',
  REVERSAL: 'Reversal',
};

function TransactionArrow({ from, to, direction }) {
  const isCredit = direction === 'CREDIT';
  const arrowColor = isCredit ? 'text-green-500' : 'text-red-500';
  const amountColor = isCredit ? 'text-green-600' : 'text-red-600';

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className={`px-1.5 py-0.5 rounded ${PARTY_COLORS[from] || 'bg-gray-100 text-gray-700'}`}>
        {from?.replace(/_/g, ' ')}
      </span>
      <span className={`${arrowColor}`}>→</span>
      <span className={`px-1.5 py-0.5 rounded ${PARTY_COLORS[to] || 'bg-gray-100 text-gray-700'}`}>
        {to?.replace(/_/g, ' ')}
      </span>
      <span className={`font-semibold ${amountColor}`}>
        {formatCurrency(direction === 'CREDIT' ? undefined : undefined)}
      </span>
    </div>
  );
}

export default function TripTransactionHistory({ bookingId, tripId }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (bookingId || tripId) {
      fetchTransactions();
    }
  }, [bookingId, tripId]);

  const fetchTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const id = bookingId || tripId;
      const response = await adminAPI.getTripTransactionLedger(id);
      if (response.data?.success) {
        setTransactions(response.data.data || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction History</h3>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction History</h3>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Transaction History</h3>
        <button
          onClick={fetchTransactions}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          Refresh
        </button>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          No transactions recorded yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">From → To</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Purpose</th>
                <th className="text-right py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Method</th>
                <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((tx) => (
                <tr key={tx.transaction_id} className="hover:bg-gray-50">
                  <td className="py-3 px-2 text-gray-600 whitespace-nowrap">
                    {formatDate(tx.transaction_date || tx.created_at)}
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-xs font-medium text-gray-700">
                      {TRANSACTION_TYPE_LABELS[tx.transaction_type] || tx.transaction_type}
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${PARTY_COLORS[tx.from_party] || 'bg-gray-100 text-gray-700'}`}>
                        {tx.from_party?.replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${PARTY_COLORS[tx.to_party] || 'bg-gray-100 text-gray-700'}`}>
                        {tx.to_party?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-gray-600">{tx.purpose || '-'}</td>
                  <td className={`py-3 px-2 text-right font-semibold ${tx.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.direction === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </td>
                  <td className="py-3 px-2 text-gray-500 capitalize">
                    {tx.payment_method || '-'}
                  </td>
                  <td className="py-3 px-2 text-gray-500">
                    {tx.reference_number || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
