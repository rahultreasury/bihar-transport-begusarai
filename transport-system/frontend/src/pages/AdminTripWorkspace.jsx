import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import TripAdvancesModal from '../components/admin-premium/trips/TripAdvancesModal';
import TripSettlementModal from '../components/admin-premium/trips/TripSettlementModal';
import TripPaymentsModal from '../components/admin-premium/trips/TripPaymentsModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'trips', label: 'Trips', icon: '🚛' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

// Trip lifecycle statuses - correct state machine
// Created → Assigned → In Transit → Completed
// Created → Assigned → In Transit → Cancelled (separate terminal path)
const TRIP_LIFECYCLE = [
  { key: 'PENDING', label: 'Created' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
];
const TERMINAL_STATUSES = {
  COMPLETED: { label: 'Completed', color: 'bg-green-500' },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-500' },
};

export default function AdminTripWorkspace() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [advances, setAdvances] = useState([]);
  const [financialSummary, setFinancialSummary] = useState(null);
  const [advancesModalOpen, setAdvancesModalOpen] = useState(false);
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Fetch trip details
  const fetchTrip = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminAPI.getTrip(tripId);
      if (response.data?.success) {
        setTrip(response.data.data);
      } else {
        throw new Error(response.data?.message || 'Failed to fetch trip');
      }
    } catch (err) {
      setError(err.message || 'Failed to load trip');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  // Fetch trip advances
  const fetchAdvances = useCallback(async () => {
    try {
      const response = await adminAPI.getTripAdvancesByTripId(tripId);
      if (response.data?.success) {
        setAdvances(response.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch advances:', err);
    }
  }, [tripId]);

  // Fetch financial summary (authoritative calculation from backend)
  const fetchFinancialSummary = useCallback(async () => {
    try {
      const response = await adminAPI.getTripFinancialSummary(tripId);
      if (response.data?.success) {
        setFinancialSummary(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch financial summary:', err);
    }
  }, [tripId]);

  // Initial load
  useEffect(() => {
    fetchTrip();
    fetchAdvances();
    fetchFinancialSummary();
  }, [fetchTrip, fetchAdvances, fetchFinancialSummary]);

  // Handle advance saved
  const handleAdvanceSaved = useCallback(() => {
    setAdvancesModalOpen(false);
    fetchAdvances();
    fetchFinancialSummary();
    fetchTrip();
    showToast('Advance recorded successfully');
  }, [fetchAdvances, fetchFinancialSummary, fetchTrip, showToast]);

  // Handle settlement saved
  const handleSettlementSaved = useCallback(() => {
    setSettlementModalOpen(false);
    fetchFinancialSummary();
    fetchTrip();
    showToast('Settlement recorded successfully');
  }, [fetchFinancialSummary, fetchTrip, showToast]);

  // Handle customer payment saved
  const handlePaymentSaved = useCallback(() => {
    setShowPaymentModal(false);
    fetchFinancialSummary();
    fetchTrip();
    showToast('Customer payment recorded successfully');
  }, [fetchFinancialSummary, fetchTrip, showToast]);

  // Handle status change
  const handleStatusChange = useCallback(async (newStatus) => {
    try {
      const response = await adminAPI.updateTripStatus(tripId, newStatus);
      if (response.data?.success) {
        showToast('Trip status updated successfully');
        fetchTrip();
      } else {
        showToast(response.data?.message || 'Failed to update status', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  }, [tripId, fetchTrip, showToast]);

  // Format currency
  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'ASSIGNED': return 'bg-blue-100 text-blue-800';
      case 'IN_TRANSIT': return 'bg-purple-100 text-purple-800';
      case 'DELIVERED': return 'bg-green-100 text-green-800';
      case 'COMPLETED': return 'bg-green-100 text-green-800';
      case 'CANCELLED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Use backend's authoritative financial summary
  // Bihar Transport broker model:
  // - Freight → BT Commission → Owner Share
  // - Advances are tracked separately
  const freight = financialSummary?.freight || trip?.freight_amount || 0;
  const customerDue = financialSummary?.customerDue || 0;
  const customerCollected = financialSummary?.customerCollected || 0;
  const ownerPayable = financialSummary?.ownerPayable || 0;
  const ownerPayableRemaining = financialSummary?.ownerPayableRemaining || 0;
  const ownerPaid = financialSummary?.ownerPaid || 0;
  const btCommission = financialSummary?.btCommission || 0;
  const ownerShare = financialSummary?.ownerShare || 0;
  
  // For display purposes, use the most relevant "due" based on context
  // The "Amount Due" in the settlement section represents what the owner should receive
  const amountDue = ownerPayableRemaining;

  // Get lifecycle step index (only for non-terminal statuses)
  const getStepIndex = (status) => {
    if (status === 'COMPLETED' || status === 'CANCELLED') return TRIP_LIFECYCLE.length;
    return TRIP_LIFECYCLE.findIndex(s => s.key === status);
  };

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={(k) => {}}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={(k) => {}}>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <div className="text-red-600 font-medium mb-2">{error}</div>
          <button
            onClick={fetchTrip}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  if (!trip) return null;

  const isTerminal = trip.status === 'COMPLETED' || trip.status === 'CANCELLED';
  const terminalInfo = TERMINAL_STATUSES[trip.status];
  const currentStepIndex = getStepIndex(trip.status);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={(k) => {}}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => navigate('/admin/trips')}
              className="flex items-center gap-2 text-muted hover:text-text transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Trips</span>
            </button>
            <div className="h-6 w-px bg-border hidden sm:block"></div>
            <div>
              <h1 className="text-2xl font-bold text-text tracking-tight">{trip.trip_number}</h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(trip.status)}`}>
                  {trip.status?.replace('_', ' ')}
                </span>
                {trip.client && (
                  <>
                    <span className="text-muted/50">·</span>
                    <span>{trip.client.client_name || trip.client.name}</span>
                  </>
                )}
                {trip.offline_client_name && !trip.client && (
                  <>
                    <span className="text-muted/50">·</span>
                    <span>{trip.offline_client_name}</span>
                  </>
                )}
                {trip.vehicle && (
                  <>
                    <span className="text-muted/50">·</span>
                    <span>{trip.vehicle.vehicle_number}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/admin/trips/create', { state: { trip } })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Trip
            </button>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const menu = document.getElementById('trip-actions-menu');
                  if (menu) menu.classList.toggle('hidden');
                }}
                className="p-2 hover:bg-hover/60 rounded-xl border border-border transition-colors"
              >
                <svg className="w-5 h-5 text-muted" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              <div
                id="trip-actions-menu"
                className="hidden absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-border/60 z-20 py-1"
              >
                <button
                  onClick={() => handleStatusChange('IN_TRANSIT')}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
                >
                  Mark In Transit
                </button>
                <button
                  onClick={() => {
                    if (customerDue > 0) {
                      showToast(`Cannot complete trip. Customer payment pending: ${formatCurrency(customerDue)}`, 'error');
                    } else {
                      handleStatusChange('COMPLETED');
                    }
                  }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    customerDue > 0
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'hover:bg-hover/60'
                  }`}
                  disabled={customerDue > 0}
                >
                  Mark Completed
                  {customerDue > 0 && (
                    <span className="block text-xs text-orange-500 mt-0.5">
                      Pending: {formatCurrency(customerDue)}
                    </span>
                  )}
                </button>
                <div className="border-t border-border/40 my-1"></div>
                <button
                  onClick={() => handleStatusChange('CANCELLED')}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
                >
                  Cancel Trip
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Trip Progress */}
        <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-4">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Trip Progress</h2>
          {isTerminal ? (
            <div className="flex items-center justify-center py-2">
              <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white ${terminalInfo.color}`}>
                {trip.status === 'COMPLETED' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {terminalInfo.label}
              </span>
            </div>
          ) : (
            <div className="flex items-center">
              {TRIP_LIFECYCLE.map((step, index) => (
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      index < currentStepIndex
                        ? 'bg-green-500 text-white'
                        : index === currentStepIndex
                          ? 'bg-amber-500 text-white ring-2 ring-amber-500/20'
                          : 'bg-gray-100 text-gray-400'
                    }`}>
                      {index < currentStepIndex ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="text-xs font-medium">{index + 1}</span>
                      )}
                    </div>
                    <span className={`text-[10px] mt-1 ${index === currentStepIndex ? 'text-amber-600 font-medium' : 'text-muted'}`}>
                      {step.label}
                    </span>
                  </div>
                  {index < TRIP_LIFECYCLE.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1.5 rounded ${index < currentStepIndex ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Trip Overview + Resources */}
          <div className="space-y-5">
            {/* Trip Overview */}
            <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Trip Overview</h2>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted uppercase">Route</div>
                  <div className="text-lg font-semibold text-text mt-1">
                    {trip.pickup_city} → {trip.drop_city}
                  </div>
                </div>
                
                {(trip.client || trip.offline_client_name) && (
                  <div>
                    <div className="text-xs text-muted uppercase">Client</div>
                    <div className="text-sm text-text mt-1">
                      {trip.client?.client_name || trip.client?.name || trip.offline_client_name}
                    </div>
                  </div>
                )}
                
                <div>
                  <div className="text-xs text-muted uppercase">Trip Date</div>
                  <div className="text-sm text-text mt-1">{formatDate(trip.trip_date)}</div>
                </div>
                
                <div>
                  <div className="text-xs text-muted uppercase">Trip Number</div>
                  <div className="text-sm font-mono text-text mt-1">{trip.trip_number}</div>
                </div>
              </div>
            </div>

            {/* Transport Resources */}
            <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Transport Resources</h2>
              <div className="space-y-3">
                {trip.transportOwner && (
                  <div className="flex items-center justify-between p-3 bg-amber-50/50 rounded-xl">
                    <div>
                      <div className="text-xs text-muted uppercase">Provider</div>
                      <Link
                        to={`/admin/vehicle-owners/${trip.transportOwner.owner_id}`}
                        className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline"
                      >
                        {trip.transportOwner.owner_name}
                      </Link>
                    </div>
                  </div>
                )}
                {trip.vehicle && (
                  <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-xl">
                    <div>
                      <div className="text-xs text-muted uppercase">Vehicle</div>
                      <Link
                        to={`/admin/vehicles/${trip.vehicle.vehicle_id}`}
                        className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline"
                      >
                        {trip.vehicle.vehicle_number}
                      </Link>
                    </div>
                    <span className="text-xs text-muted">{trip.vehicle.vehicle_type}</span>
                  </div>
                )}
                {trip.driver && (
                  <div className="flex items-center justify-between p-3 bg-green-50/50 rounded-xl">
                    <div>
                      <div className="text-xs text-muted uppercase">Driver</div>
                      <Link
                        to={`/admin/drivers/${trip.driver.driver_id}`}
                        className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline"
                      >
                        {trip.driver.driver_name}
                      </Link>
                    </div>
                    {trip.driver.phone && (
                      <span className="text-xs text-muted">{trip.driver.phone}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Financial Summary */}
          <div className="space-y-5">
            {/* Client Financials */}
            <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Client</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Freight</span>
                  <span className="text-lg font-semibold text-text text-right">{formatCurrency(freight)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Paid</span>
                  <span className="text-sm font-medium text-green-600 text-right">{formatCurrency(customerCollected)}</span>
                </div>
                <div className="border-t border-border/40 pt-3 flex justify-between items-center">
                  <span className="text-sm font-bold text-text">Due</span>
                  <span className={`text-lg font-bold text-right ${customerDue > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    {formatCurrency(customerDue)}
                  </span>
                </div>
                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Record Customer Payment
                </button>
              </div>
            </div>

            {/* Provider Financials */}
            <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Provider</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Agreed Amount</span>
                  <span className="text-lg font-semibold text-text text-right">{formatCurrency(financialSummary?.ownerPayable || 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Advance</span>
                  <span className="text-sm font-medium text-amber-600 text-right">{formatCurrency(financialSummary?.ownerPaid || 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Paid</span>
                  <span className="text-sm font-medium text-green-600 text-right">{formatCurrency(financialSummary?.ownerPaid || 0)}</span>
                </div>
                <div className="border-t border-border/40 pt-3 flex justify-between items-center">
                  <span className="text-sm font-bold text-text">Due</span>
                  <span className={`text-lg font-bold text-right ${(financialSummary?.ownerPayableRemaining || 0) > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    {formatCurrency(financialSummary?.ownerPayableRemaining || 0)}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setAdvancesModalOpen(true)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Give Advance
                  </button>
                  <button
                    onClick={() => setSettlementModalOpen(true)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Record Settlement
                  </button>
                </div>
              </div>
            </div>

            {/* Bihar Transport Commission */}
            <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Bihar Transport</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Freight</span>
                  <span className="text-lg font-semibold text-text text-right">{formatCurrency(freight)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Provider Cost</span>
                  <span className="text-sm font-medium text-text text-right">{formatCurrency(ownerShare)}</span>
                </div>
                <div className="border-t border-border/40 pt-3 flex justify-between items-center">
                  <span className="text-sm font-bold text-text">Commission</span>
                  <span className={`text-lg font-bold text-amber-600 text-right`}>
                    {formatCurrency(btCommission)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xs text-muted">Rate</span>
                  <span className="text-xs font-medium text-amber-600 text-right">
                    {financialSummary?.commissionRate || 5}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Advances & Settlement */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Advances */}
          <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Advances</h2>
              <button
                onClick={() => setAdvancesModalOpen(true)}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                + Give Advance
              </button>
            </div>
            {advances.length === 0 ? (
              <div className="text-sm text-muted text-center py-4">No advances recorded</div>
            ) : (
              <div className="space-y-3">
                {advances.map((adv, idx) => (
                  <div key={adv.advance_id || idx} className="flex justify-between items-start text-sm p-3 bg-gray-50/50 rounded-xl">
                    <div>
                      <div className="text-text font-medium">{adv.recipient_type === 'owner' ? 'Provider' : 'Driver'}</div>
                      <div className="text-xs text-muted">{adv.purpose}</div>
                      {adv.payment_method && <div className="text-xs text-muted">Via {adv.payment_method}</div>}
                      {adv.reference_number && <div className="text-xs text-muted">Ref: {adv.reference_number}</div>}
                    </div>
                    <span className="font-medium text-green-600 text-right">{formatCurrency(adv.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Settlement */}
          <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">Settlement</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Provider Share</span>
                <span className="text-sm font-medium text-text text-right">{formatCurrency(ownerPayable)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Provider Paid</span>
                <span className="text-sm font-medium text-green-600 text-right">{formatCurrency(ownerPaid)}</span>
              </div>
              <div className="border-t border-border/40 pt-3 flex justify-between items-center">
                <span className="text-sm font-bold text-text">Amount Due</span>
                <span className={`text-lg font-bold text-right ${amountDue > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {formatCurrency(amountDue)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-muted">Status</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${amountDue > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                  {amountDue > 0 ? 'Pending' : 'Settled'}
                </span>
              </div>
            </div>
            {amountDue > 0 && (
              <button
                onClick={() => setSettlementModalOpen(true)}
                className="w-full mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Settle Payment
              </button>
            )}
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Activity Timeline</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-text">Trip Created</div>
                <div className="text-xs text-muted">{formatDate(trip.created_at)}</div>
              </div>
            </div>
            
            {trip.vehicle && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">Vehicle Assigned</div>
                  <div className="text-xs text-muted">{trip.vehicle.vehicle_number}</div>
                </div>
              </div>
            )}
            
            {trip.driver && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">Driver Assigned</div>
                  <div className="text-xs text-muted">{trip.driver.driver_name}</div>
                </div>
              </div>
            )}
            
            {(trip.status === 'IN_TRANSIT' || trip.status === 'COMPLETED') && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-purple-500 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">Trip Started</div>
                </div>
              </div>
            )}
            
            {trip.status === 'COMPLETED' && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">Trip Completed</div>
                </div>
              </div>
            )}
            
            {trip.status === 'CANCELLED' && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">Trip Cancelled</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modals */}
        {advancesModalOpen && (
          <TripAdvancesModal
            isOpen={advancesModalOpen}
            onClose={() => setAdvancesModalOpen(false)}
            trip={trip}
            onSaved={handleAdvanceSaved}
          />
        )}

        {settlementModalOpen && (
          <TripSettlementModal
            isOpen={settlementModalOpen}
            onClose={() => setSettlementModalOpen(false)}
            trip={trip}
            onSaved={handleSettlementSaved}
          />
        )}

        {showPaymentModal && (
          <TripPaymentsModal
            isOpen={showPaymentModal}
            onClose={() => setShowPaymentModal(false)}
            trip={trip}
            onSaved={handlePaymentSaved}
          />
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg z-50 ${
            toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
          }`}>
            {toast.message}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
