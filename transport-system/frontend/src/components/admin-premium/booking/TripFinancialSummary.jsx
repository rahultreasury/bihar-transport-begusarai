/**
 * TripFinancialSummary
 * Displays trip financial information based on user role.
 *
 * SECURITY: Backend enforces what data is returned.
 * - ADMIN: Sees everything including BT Margin
 * - TRANSPORT_OWNER: Sees only owner-specific financials
 * - DRIVER: Sees only driver-specific financials
 */

import { useState, useEffect } from 'react';
import { adminAPI, driverAPI } from '../../../../src/services/api';

export default function TripFinancialSummary({ bookingId, userRole = 'ADMIN' }) {
  const [financial, setFinancial] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadFinancialData();
  }, [bookingId, userRole]);

  const loadFinancialData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Use the appropriate API based on role
      const api = userRole === 'DRIVER' ? driverAPI : adminAPI;
      
      const [financialRes, timelineRes] = await Promise.all([
        api.getTripFinancial(bookingId),
        api.getTripFinancialTimeline(bookingId),
      ]);

      if (financialRes.data?.success) {
        setFinancial(financialRes.data.data);
      }
      if (timelineRes.data?.success) {
        setTimeline(timelineRes.data.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load financial data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 m-4">
        <p className="text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (!financial) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 m-4">
        <p className="text-gray-500">No financial data available for this trip.</p>
      </div>
    );
  }

  // ADMIN VIEW - Complete financial picture
  if (userRole === 'ADMIN') {
    return (
      <div className="space-y-6">
        {/* Customer Financials */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Customer Financials</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-sm text-blue-600">Customer Fare</p>
              <p className="text-xl font-bold text-blue-900">₹{financial.customerFare?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-sm text-green-600">Amount Received</p>
              <p className="text-xl font-bold text-green-900">₹{financial.amountReceived?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <p className="text-sm text-yellow-600">Payment Status</p>
              <p className="text-xl font-bold text-yellow-900">{financial.paymentStatus || 'PENDING'}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-sm text-red-600">Outstanding Amount</p>
              <p className="text-xl font-bold text-red-900">₹{financial.outstandingAmount?.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>

        {/* Driver Financials */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Driver Financials</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-sm text-purple-600">Driver Payout</p>
              <p className="text-xl font-bold text-purple-900">₹{financial.driverPayout?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-4">
              <p className="text-sm text-orange-600">Driver Advance</p>
              <p className="text-xl font-bold text-orange-900">₹{financial.driverAdvance?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-indigo-50 rounded-lg p-4">
              <p className="text-sm text-indigo-600">Fuel Advance</p>
              <p className="text-xl font-bold text-indigo-900">₹{financial.fuelAdvance?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-teal-50 rounded-lg p-4">
              <p className="text-sm text-teal-600">Remaining Settlement</p>
              <p className="text-xl font-bold text-teal-900">₹{financial.remainingDriverSettlement?.toLocaleString() || 0}</p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-600">Driver Payment Status: <span className="font-semibold">{financial.driverPaymentStatus || 'PENDING'}</span></p>
          </div>
        </div>

        {/* Owner Financials */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Owner Financials</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-pink-50 rounded-lg p-4">
              <p className="text-sm text-pink-600">Owner Settlement</p>
              <p className="text-xl font-bold text-pink-900">₹{financial.ownerSettlement?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-4">
              <p className="text-sm text-rose-600">Owner Advance</p>
              <p className="text-xl font-bold text-rose-900">₹{financial.ownerAdvance?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-fuchsia-50 rounded-lg p-4">
              <p className="text-sm text-fuchsia-600">Remaining Settlement</p>
              <p className="text-xl font-bold text-fuchsia-900">₹{financial.remainingOwnerSettlement?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">Owner Payment Status</p>
              <p className="text-xl font-bold text-gray-900">{financial.ownerPaymentStatus || 'PENDING'}</p>
            </div>
          </div>
        </div>

        {/* Commission & BT Margin */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Commission & BT Margin</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-amber-50 rounded-lg p-4">
              <p className="text-sm text-amber-600">Commission Rate</p>
              <p className="text-xl font-bold text-amber-900">{financial.commissionRate || 5}%</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <p className="text-sm text-yellow-600">Commission Amount</p>
              <p className="text-xl font-bold text-yellow-900">₹{financial.commissionAmount?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-4 border-2 border-emerald-200">
              <p className="text-sm text-emerald-600 font-semibold">BT MARGIN (ADMIN ONLY)</p>
              <p className="text-xl font-bold text-emerald-900">₹{financial.btMargin?.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>

        {/* Financial Timeline */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Timeline</h3>
          <div className="space-y-3">
            {timeline.map((event, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-500 whitespace-nowrap">
                  {new Date(event.timestamp).toLocaleString()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{event.event}</p>
                  {event.amount && (
                    <p className="text-sm text-gray-600">₹{event.amount.toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
            {timeline.length === 0 && (
              <p className="text-gray-500 text-sm">No financial events recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // TRANSPORT OWNER VIEW - Owner-specific financials only
  if (userRole === 'TRANSPORT_OWNER') {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">My Settlement</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-pink-50 rounded-lg p-4">
              <p className="text-sm text-pink-600">Trip Amount</p>
              <p className="text-xl font-bold text-pink-900">₹{financial.tripAmount?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-rose-50 rounded-lg p-4">
              <p className="text-sm text-rose-600">Advance</p>
              <p className="text-xl font-bold text-rose-900">₹{financial.advance?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-fuchsia-50 rounded-lg p-4">
              <p className="text-sm text-fuchsia-600">Remaining Settlement</p>
              <p className="text-xl font-bold text-fuchsia-900">₹{financial.remainingSettlement?.toLocaleString() || 0}</p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-sm text-gray-600">Payment Status: <span className="font-semibold">{financial.paymentStatus || 'PENDING'}</span></p>
          </div>
        </div>

        {/* Owner Timeline */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction History</h3>
          <div className="space-y-3">
            {timeline.map((event, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-500 whitespace-nowrap">
                  {new Date(event.timestamp).toLocaleString()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{event.event}</p>
                  {event.amount && (
                    <p className="text-sm text-gray-600">₹{event.amount.toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
            {timeline.length === 0 && (
              <p className="text-gray-500 text-sm">No transactions recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // DRIVER VIEW - Driver-specific financials only
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">My Payment</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-purple-50 rounded-lg p-4">
            <p className="text-sm text-purple-600">Trip Amount</p>
            <p className="text-xl font-bold text-purple-900">₹{financial.tripAmount?.toLocaleString() || 0}</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-4">
            <p className="text-sm text-orange-600">Advance Received</p>
            <p className="text-xl font-bold text-orange-900">₹{financial.advanceReceived?.toLocaleString() || 0}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-4">
            <p className="text-sm text-indigo-600">Fuel Advance</p>
            <p className="text-xl font-bold text-indigo-900">₹{financial.fuelAdvance?.toLocaleString() || 0}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-teal-50 rounded-lg p-4">
            <p className="text-sm text-teal-600">Remaining Amount</p>
            <p className="text-xl font-bold text-teal-900">₹{financial.remainingAmount?.toLocaleString() || 0}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">Payment Status</p>
            <p className="text-xl font-bold text-gray-900">{financial.paymentStatus || 'PENDING'}</p>
          </div>
        </div>
      </div>

      {/* Driver Timeline */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h3>
        <div className="space-y-3">
          {timeline.map((event, index) => (
            <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-500 whitespace-nowrap">
                {new Date(event.timestamp).toLocaleString()}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{event.event}</p>
                {event.amount && (
                  <p className="text-sm text-gray-600">₹{event.amount.toLocaleString()}</p>
                )}
              </div>
            </div>
          ))}
          {timeline.length === 0 && (
            <p className="text-gray-500 text-sm">No payment history available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
