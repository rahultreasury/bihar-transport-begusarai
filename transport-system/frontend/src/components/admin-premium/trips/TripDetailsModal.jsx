import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../../services/api';

function TripDetailsModal({ isOpen, onClose, trip, onStatusChange, onDeleted }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);

  useEffect(() => {
    if (isOpen && trip) {
      fetchTripDetails();
    }
  }, [isOpen, trip]);

  const fetchTripDetails = async () => {
    if (!trip?.trip_id) return;
    setLoading(true);
    try {
      const response = await adminAPI.getTrip(trip.trip_id);
      if (response.data?.success) {
        setDetails(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch trip details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!trip?.trip_id) return;
    setStatusChanging(true);
    try {
      await onStatusChange(trip.trip_id, newStatus);
      await fetchTripDetails();
    } catch (err) {
      console.error('Failed to change status:', err);
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDelete = async () => {
    if (!trip?.trip_id) return;
    if (!window.confirm('Are you sure you want to delete this trip? This action cannot be undone.')) {
      return;
    }
    try {
      await adminAPI.deleteTrip(trip.trip_id);
      onDeleted?.();
    } catch (err) {
      alert(err.message || 'Failed to delete trip');
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

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'ASSIGNED':
        return 'bg-blue-100 text-blue-800';
      case 'IN_TRANSIT':
        return 'bg-purple-100 text-purple-800';
      case 'DELIVERED':
        return 'bg-green-100 text-green-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {loading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-skeleton rounded w-1/3"></div>
              <div className="h-4 bg-skeleton rounded w-1/2"></div>
              <div className="h-32 bg-skeleton rounded"></div>
            </div>
          </div>
        ) : details ? (
          <>
            <div className="p-6 border-b border-border/60">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Trip Details</h2>
                  <p className="text-sm text-muted mt-1">{details.trip_number}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(details.status)}`}>
                    {details.status?.replace('_', ' ')}
                  </span>
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
            </div>

            <div className="p-6 space-y-6">
              {/* Trip Information */}
              <div>
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Trip Information</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted">Trip Number</div>
                    <div className="text-sm font-medium mt-0.5">{details.trip_number}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Trip Date</div>
                    <div className="text-sm font-medium mt-0.5">{formatDate(details.trip_date)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Status</div>
                    <div className="text-sm font-medium mt-0.5">{details.status?.replace('_', ' ')}</div>
                  </div>
                </div>
              </div>

              {/* Client */}
              <div>
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Client</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted">Name</div>
                    <div className="text-sm font-medium mt-0.5">
                      {details.user ? `${details.user.first_name} ${details.user.last_name}` : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Contact</div>
                    <div className="text-sm font-medium mt-0.5">{details.user?.phone || '-'}</div>
                  </div>
                </div>
              </div>

              {/* Route */}
              <div>
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Route</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-muted">Pickup</div>
                    <div className="text-sm font-medium mt-0.5">{details.pickup_location}</div>
                    <div className="text-xs text-muted">{details.pickup_city}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Drop</div>
                    <div className="text-sm font-medium mt-0.5">{details.drop_location}</div>
                    <div className="text-xs text-muted">{details.drop_city}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Distance</div>
                    <div className="text-sm font-medium mt-0.5">{details.distance_km ? `${details.distance_km} km` : '-'}</div>
                  </div>
                </div>
              </div>

              {/* Transport */}
              <div>
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Transport</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted">Transport Owner</div>
                    <div className="text-sm font-medium mt-0.5">{details.transportOwner?.owner_name || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Vehicle</div>
                    <div className="text-sm font-medium mt-0.5">{details.vehicle?.vehicle_number || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Driver</div>
                    <div className="text-sm font-medium mt-0.5">{details.driver?.driver_name || '-'}</div>
                  </div>
                </div>
              </div>

              {/* Financial */}
              <div>
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Financial</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted">Freight</div>
                    <div className="text-sm font-medium mt-0.5">{formatCurrency(details.freight_amount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Total Expenses</div>
                    <div className="text-sm font-medium mt-0.5 text-red-600">{formatCurrency(details.totalExpenses)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Profit</div>
                    <div className="text-sm font-medium mt-0.5 text-green-600">{formatCurrency(details.profit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Total Received</div>
                    <div className="text-sm font-medium mt-0.5">{formatCurrency(details.totalPayments)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Outstanding</div>
                    <div className="text-sm font-medium mt-0.5 text-orange-600">{formatCurrency(details.outstanding)}</div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {details.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Notes</h3>
                  <p className="text-sm text-muted">{details.notes}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-border/60 flex items-center justify-between">
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Delete Trip
              </button>
              <div className="flex items-center gap-3">
                {details.status !== 'IN_TRANSIT' && details.status !== 'COMPLETED' && details.status !== 'CANCELLED' && (
                  <button
                    onClick={() => handleStatusChange('IN_TRANSIT')}
                    disabled={statusChanging}
                    className="px-4 py-2.5 bg-purple-500 text-white rounded-xl text-sm font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors"
                  >
                    {statusChanging ? 'Updating...' : 'Mark In Transit'}
                  </button>
                )}
                {details.status === 'IN_TRANSIT' && (
                  <button
                    onClick={() => handleStatusChange('COMPLETED')}
                    disabled={statusChanging}
                    className="px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    {statusChanging ? 'Updating...' : 'Mark Completed'}
                  </button>
                )}
                {details.status !== 'CANCELLED' && details.status !== 'COMPLETED' && (
                  <button
                    onClick={() => handleStatusChange('CANCELLED')}
                    disabled={statusChanging}
                    className="px-4 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {statusChanging ? 'Updating...' : 'Cancel Trip'}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-muted">Failed to load trip details</div>
        )}
      </div>
    </div>
  );
}

export default TripDetailsModal;
