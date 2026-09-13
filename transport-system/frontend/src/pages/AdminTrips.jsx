import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import TripDetailsModal from '../components/admin-premium/trips/TripDetailsModal';
import TripPaymentsModal from '../components/admin-premium/trips/TripPaymentsModal';
import TripFilters from '../components/admin-premium/trips/TripFilters';

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

const ITEMS_PER_PAGE = 10;

const TRIP_TABS = [
  { key: 'all', label: 'All Trips' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function AdminTrips() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [paymentsModalOpen, setPaymentsModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTrip, setPaymentTrip] = useState(null);
  const [attentionExpanded, setAttentionExpanded] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Fetch summary stats
  const fetchSummary = useCallback(async () => {
    try {
      setSummaryError(null);
      const response = await adminAPI.getTripSummary();
      if (response.data?.success) {
        setSummary(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch summary:', err);
      setSummaryError(err.message || 'Failed to load summary');
    }
  }, []);

  // Fetch trips
  const fetchTrips = useCallback(async (page = 1, status = activeTab) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        sort_by: 'created_at',
        sort_order: 'desc',
      };

      if (status !== 'all') {
        params.status = status.toUpperCase();
      }

      const response = await adminAPI.getTrips(params);
      if (response.data?.success) {
        setTrips(response.data.data || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Failed to fetch trips');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch trips');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  // Stable filter-change callback to avoid re-creating on every render
  const handleFilterChange = useCallback(() => {
    fetchTrips(1, activeTab);
  }, [fetchTrips, activeTab]);

  // Initial load
  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Fetch trips when tab changes
  useEffect(() => {
    fetchTrips(1, activeTab);
  }, [activeTab, fetchTrips]);

  // Handle tab change
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
  }, []);

  // Handle add trip — navigate to create page
  const handleAddTrip = useCallback(() => {
    navigate('/admin/trips/create');
  }, [navigate]);

  // Handle edit trip — navigate to create page with trip data
  const handleEditTrip = useCallback((trip) => {
    navigate('/admin/trips/create');
  }, [navigate]);

  // Handle view trip
  const handleViewTrip = useCallback((trip) => {
    setSelectedTrip(trip);
    setDetailsModalOpen(true);
  }, []);

  // Handle record payment
  const handleAddPayment = useCallback((trip) => {
    setPaymentTrip(trip);
    setShowPaymentModal(true);
  }, []);

  // Handle status change
  const handleStatusChange = useCallback(async (tripId, newStatus) => {
    try {
      const response = await adminAPI.updateTripStatus(tripId, newStatus);
      if (response.data?.success) {
        showToast('Trip status updated successfully');
        fetchTrips(pagination.page, activeTab);
        fetchSummary();
      }
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  }, [showToast, fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle delete trip - open confirmation dialog
  const handleDeleteTrip = useCallback((trip) => {
    setDeleteTarget(trip);
    setDeleteDialogOpen(true);
  }, []);

  // Handle confirm delete
  const confirmDeleteTrip = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await adminAPI.deleteTrip(deleteTarget.trip_id);
      if (response.data?.success) {
        showToast(`Trip ${deleteTarget.trip_number} deleted successfully`);
        setDeleteDialogOpen(false);
        setDeleteTarget(null);
        fetchTrips(pagination.page, activeTab);
        fetchSummary();
      } else {
        showToast(response.data?.message || 'Failed to delete trip', 'error');
      }
    } catch (err) {
      // Extract the actual error message from the backend response
      const errorMessage = err.response?.data?.message || err.message || 'Failed to delete trip';
      showToast(errorMessage, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, showToast, fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle trip saved
  const handleTripSaved = useCallback(() => {
    fetchTrips(pagination.page, activeTab);
    fetchSummary();
  }, [fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle payment saved
  const handlePaymentSaved = useCallback(() => {
    setShowPaymentModal(false);
    setPaymentTrip(null);
    fetchTrips(pagination.page, activeTab);
    fetchSummary();
  }, [fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle trip deleted
  const handleTripDeleted = useCallback(() => {
    setDetailsModalOpen(false);
    setSelectedTrip(null);
    fetchTrips(1, activeTab);
    fetchSummary();
  }, [fetchTrips, activeTab, fetchSummary]);

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

  // Compute attention items from trips data
  const computeAttentionItems = useCallback(() => {
    if (!trips.length) return { pendingOverdue: [], completedUnpaid: [] };
    const now = new Date();
    const pendingOverdue = trips.filter(t =>
      t.status === 'PENDING' && t.trip_date && new Date(t.trip_date) < now
    );
    const completedUnpaid = trips.filter(t =>
      t.status === 'COMPLETED' && (t.financials?.client?.due || t.outstanding || 0) > 0
    );
    return { pendingOverdue, completedUnpaid };
  }, [trips]);

  // Get status badge color
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

  // Table columns - redesigned per business rules
  const columns = useMemo(() => [
    {
      key: 'trip_number',
      header: 'Trip',
      sortable: true,
      render: (row) => (
        <button
          onClick={() => navigate(`/admin/trips/${row.trip_id}`)}
          className="font-semibold text-amber-600 hover:text-amber-700 hover:underline"
        >
          {row.trip_number}
        </button>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: (row) => {
        const clientName = row.client?.client_name || row.client?.name || row.offline_client_name || row.user?.first_name ? `${row.user?.first_name} ${row.user?.last_name}` : '—';
        return <span className="text-sm font-medium text-text">{clientName}</span>;
      },
    },
    {
      key: 'route',
      header: 'Route',
      render: (row) => (
        <span className="text-sm font-medium text-text">
          {row.pickup_city} → {row.drop_city}
        </span>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) => {
        const vehicleId = row.vehicle?.vehicle_id;
        const vehicleNumber = row.vehicle?.vehicle_number;
        if (!vehicleId || !vehicleNumber) return <span className="text-sm text-muted">—</span>;
        return (
          <Link to={`/admin/vehicles/${vehicleId}`} className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline">
            {vehicleNumber}
          </Link>
        );
      },
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (row) => {
        const driverId = row.driver?.driver_id;
        const driverName = row.driver?.driver_name;
        if (!driverId || !driverName) return <span className="text-sm text-muted">—</span>;
        return (
          <Link to={`/admin/drivers/${driverId}`} className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline">
            {driverName}
          </Link>
        );
      },
    },
    {
      key: 'owner',
      header: 'Provider',
      render: (row) => {
        const ownerId = row.transportOwner?.owner_id;
        const ownerName = row.transportOwner?.owner_name;
        if (!ownerId || !ownerName) return <span className="text-sm text-muted">—</span>;
        return (
          <Link to={`/admin/vehicle-owners/${ownerId}`} className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline">
            {ownerName}
          </Link>
        );
      },
    },
    {
      key: 'freight',
      header: 'Freight',
      sortable: true,
      className: 'text-right',
      render: (row) => <span className="font-medium text-text">{formatCurrency(row.financials?.client?.freight || row.freight_amount || 0)}</span>,
    },
    {
      key: 'customer_paid',
      header: 'Client Paid',
      className: 'text-right',
      render: (row) => <span className="font-medium text-green-600">{formatCurrency(row.financials?.client?.paid || row.totalPayments || 0)}</span>,
    },
    {
      key: 'customer_due',
      header: 'Client Due',
      className: 'text-right',
      render: (row) => {
        const due = row.financials?.client?.due || row.outstanding || 0;
        const dueClass = due > 0 ? 'text-orange-600 font-medium' : 'text-green-600';
        return <span className={dueClass}>{formatCurrency(due)}</span>;
      },
    },
    {
      key: 'owner_due',
      header: 'Provider Due',
      className: 'text-right',
      render: (row) => {
        const due = row.financials?.provider?.due || 0;
        const dueClass = due > 0 ? 'text-orange-600 font-medium' : 'text-green-600';
        return <span className={dueClass}>{formatCurrency(due)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(row.status)}`}>
          {row.status?.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 50,
      render: (row) => (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const menu = document.getElementById(`trip-menu-${row.trip_id}`);
              if (menu) {
                menu.classList.toggle('hidden');
              }
            }}
            className="p-1 hover:bg-hover/60 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-muted" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          <div
            id={`trip-menu-${row.trip_id}`}
            className="hidden absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-border/60 z-20 py-1"
          >
            <button
              onClick={() => {
                handleViewTrip(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              View Trip
            </button>
            <button
              onClick={() => {
                handleEditTrip(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Edit Trip
            </button>
            <button
              onClick={() => {
                handleAddPayment(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Record Payment
            </button>
            <button
              onClick={() => {
                handleStatusChange(row.trip_id, 'IN_TRANSIT');
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Mark In Transit
            </button>
            <button
              onClick={() => {
                handleStatusChange(row.trip_id, 'COMPLETED');
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Mark Completed
            </button>
            <button
              onClick={() => {
                handleStatusChange(row.trip_id, 'CANCELLED');
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              Cancel Trip
            </button>
            <div className="border-t border-border/40 my-1" />
            <button
              onClick={() => {
                handleDeleteTrip(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
            >
              Delete Trip
            </button>
          </div>
        </div>
      ),
    },
  ], [handleViewTrip, handleEditTrip, handleAddPayment, handleStatusChange, handleDeleteTrip, formatCurrency, formatDate, getStatusColor]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      document.querySelectorAll('[id^="trip-menu-"]').forEach((menu) => {
        menu.classList.add('hidden');
      });
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={(k) => {}}>
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted mb-1">
            <span>Operations</span>
            <span className="text-muted/50">/</span>
            <span className="text-text font-medium">Trips</span>
          </div>
          <h1 className="text-3xl font-bold text-text tracking-tight">Trips Management</h1>
          <p className="text-sm text-muted mt-1">Track transport operations, payments, advances and settlements.</p>
        </div>
        <button
          onClick={handleAddTrip}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-semibold shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Add Trip
        </button>
      </div>

      {/* KPI Row */}
      {summaryError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-red-500">⚠</span>
              <span className="text-sm text-red-700">{summaryError}</span>
            </div>
            <button
              onClick={fetchSummary}
              className="text-sm text-red-600 hover:text-red-800 font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {/* Financial Overview */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-4 bg-emerald-500 rounded-full"></span>
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Financial Overview</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            onClick={() => navigate('/admin/financials?view=client-receivable')}
            className="bg-white rounded-xl border border-border/60 shadow-sm p-4 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left"
          >
            <div className="text-xs text-muted uppercase tracking-wider">Client Receivable</div>
            <div className="text-2xl font-bold text-text mt-1">{summary ? formatCurrency(summary.totalFreight) : '—'}</div>
          </button>
          <button
            onClick={() => navigate('/admin/financials?view=commission')}
            className="bg-white rounded-xl border border-border/60 shadow-sm p-4 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left"
          >
            <div className="text-xs text-muted uppercase tracking-wider">Commission</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{summary ? formatCurrency(summary.totalCommission) : '—'}</div>
          </button>
          <button
            onClick={() => navigate('/admin/financials?view=advances')}
            className="bg-white rounded-xl border border-border/60 shadow-sm p-4 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left"
          >
            <div className="text-xs text-muted uppercase tracking-wider">Advances</div>
            <div className="text-2xl font-bold text-text mt-1">{summary ? formatCurrency(summary.advanceOut) : '—'}</div>
          </button>
          <button
            onClick={() => navigate('/admin/financials?view=client-due')}
            className="bg-white rounded-xl border border-border/60 shadow-sm p-4 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left"
          >
            <div className="text-xs text-muted uppercase tracking-wider">Client Due</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">{summary ? formatCurrency(summary.customerDue) : '—'}</div>
          </button>
          <button
            onClick={() => navigate('/admin/financials?view=provider-payable')}
            className="bg-white rounded-xl border border-border/60 shadow-sm p-4 hover:border-amber-500 hover:shadow-md transition-all cursor-pointer text-left"
          >
            <div className="text-xs text-muted uppercase tracking-wider">Provider Payable</div>
            <div className="text-2xl font-bold text-orange-600 mt-1">{summary ? formatCurrency(summary.ownerOutstanding) : '—'}</div>
          </button>
        </div>
      </div>

      {/* Attention Strip */}
      {summary?.needsAttention > 0 ? (
        <>
          <button
            onClick={() => setAttentionExpanded(!attentionExpanded)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAttentionExpanded(!attentionExpanded); }}}
            className="w-full flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 hover:bg-amber-100 hover:border-amber-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 text-left"
            aria-expanded={attentionExpanded}
            aria-controls="attention-details"
          >
            <div className="flex items-center gap-2">
              <span className="text-amber-600">⚠</span>
              <span className="text-sm font-medium text-amber-800">
                {summary.needsAttention} items need attention
              </span>
            </div>
            <span className={`text-sm text-amber-700 font-medium transition-transform ${attentionExpanded ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>
          {attentionExpanded && (
            <div id="attention-details" className="mt-3 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 rounded-xl overflow-hidden animate-slide-down">
              <div className="p-4">
                {(() => {
                  const { pendingOverdue, completedUnpaid } = computeAttentionItems();
                  const items = [];
                  
                  if (pendingOverdue.length > 0) {
                    const totalDue = pendingOverdue.reduce((sum, t) => sum + (t.financials?.client?.due || t.outstanding || 0), 0);
                    items.push(
                      <div key="pending-overdue" className="mb-4 last:mb-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-amber-600">⏰</span>
                            <span className="text-sm font-medium text-amber-800">Pending Trips Overdue</span>
                          </div>
                          <div className="text-sm font-bold text-amber-800">{formatCurrency(pendingOverdue.reduce((sum, t) => sum + (t.financials?.client?.due || t.outstanding || 0), 0))}</div>
                        </div>
                        <div className="text-xs text-amber-700 mb-2">{pendingOverdue.length} trip{pendingOverdue.length !== 1 ? 's' : ''} past due date</div>
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-64 overflow-y-auto">
                          {pendingOverdue.map(trip => (
                            <button
                              key={trip.trip_id}
                              onClick={() => { navigate(`/admin/trips/${trip.trip_id}`); setAttentionExpanded(false); }}
                              className="w-full text-left p-2 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-amber-800">{trip.trip_number}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(trip.status)}`}>
                                    {trip.status}
                                  </span>
                                </div>
                                <div className="text-xs text-amber-700 truncate">
                                  {trip.client?.client_name || trip.client?.name || trip.offline_client_name || 'Unknown Client'} · {trip.pickup_city} → {trip.drop_city}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-right">
                                <span className="text-sm font-bold text-amber-800 whitespace-nowrap">
                                  {formatCurrency(trip.financials?.client?.due || trip.outstanding || 0)} due
                                </span>
                                <span className="text-xs text-amber-600 hover:text-amber-700">View trip →</span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => { handleTabChange('all'); setAttentionExpanded(false); }}
                          className="w-full mt-2 text-xs text-amber-700 hover:text-amber-800 font-medium underline"
                        >
                          View all pending overdue trips →
                        </button>
                      </div>
                    );
                  }
                  
                  if (completedUnpaid.length > 0) {
                    items.push(
                      <div key="completed-unpaid" className="mb-4 last:mb-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-orange-600">💰</span>
                            <span className="text-sm font-medium text-orange-800">Completed Trips Unpaid</span>
                          </div>
                          <div className="text-sm font-bold text-orange-800">{formatCurrency(completedUnpaid.reduce((sum, t) => sum + (t.financials?.client?.due || t.outstanding || 0), 0))}</div>
                        </div>
                        <div className="text-xs text-orange-700 mb-2">{completedUnpaid.length} completed trip{completedUnpaid.length !== 1 ? 's' : ''} with unpaid client balance</div>
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-64 overflow-y-auto">
                          {completedUnpaid.map(trip => (
                            <button
                              key={trip.trip_id}
                              onClick={() => { navigate(`/admin/trips/${trip.trip_id}`); setAttentionExpanded(false); }}
                              className="w-full text-left p-2 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-orange-800">{trip.trip_number}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(trip.status)}`}>
                                    {trip.status}
                                  </span>
                                </div>
                                <div className="text-xs text-orange-700 truncate">
                                  {trip.client?.client_name || trip.client?.name || trip.offline_client_name || 'Unknown Client'} · {trip.pickup_city} → {trip.drop_city}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-right">
                                <span className="text-sm font-bold text-orange-800 whitespace-nowrap">
                                  {formatCurrency(trip.financials?.client?.due || trip.outstanding || 0)} due
                                </span>
                                <span className="text-xs text-orange-600 hover:text-orange-700">View trip →</span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => { handleTabChange('all'); setAttentionExpanded(false); }}
                          className="w-full mt-2 text-xs text-orange-700 hover:text-orange-800 font-medium underline"
                        >
                          View all completed unpaid trips →
                        </button>
                      </div>
                    );
                  }
                  
                  return items.length > 0 ? items : (
                    <div className="text-center text-amber-700 py-2">
                      No specific attention items found in current view.
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <span>✓</span>
          <span>Everything is on track. No trips require attention right now.</span>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-1 bg-white border border-border/60 rounded-xl p-1">
          {TRIP_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.key
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-muted hover:text-text hover:bg-amber-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => navigate('/admin/trips/financials')}
            className="text-muted hover:text-text transition-colors"
          >
            Financials →
          </button>
          <button
            onClick={() => navigate('/admin/clients')}
            className="text-muted hover:text-text transition-colors"
          >
            Clients →
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <TripFilters onFilterChange={handleFilterChange} />

      {/* Trips Table */}
      <div className="bg-white rounded-2xl border border-border/60 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingSkeleton />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-500">{error}</div>
        ) : trips.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-lg font-semibold text-text mb-2">No trips yet</div>
            <div className="text-sm text-muted mb-4">Create your first trip and start tracking vehicle, driver, advances, settlements and profit.</div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleAddTrip}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Trip
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <PremiumTable
              columns={columns}
              rows={trips}
              loading={loading}
            />
          </div>
        )}

          {/* Pagination */}
          {!loading && trips.length > 0 && (
            <div className="px-6 py-4 border-t border-border/60 flex items-center justify-between">
              <div className="text-sm text-muted">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} trips
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchTrips(pagination.page - 1, activeTab)}
                  disabled={pagination.page === 1}
                  className="px-3 py-1.5 text-sm border border-border/60 rounded-lg hover:bg-hover/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-muted">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <button
                  onClick={() => fetchTrips(pagination.page + 1, activeTab)}
                  disabled={pagination.page >= pagination.pages}
                  className="px-3 py-1.5 text-sm border border-border/60 rounded-lg hover:bg-hover/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

      {/* Modals */}
      {detailsModalOpen && selectedTrip && (
        <TripDetailsModal
          isOpen={detailsModalOpen}
          onClose={() => {
            setDetailsModalOpen(false);
            setSelectedTrip(null);
          }}
          trip={selectedTrip}
          onStatusChange={handleStatusChange}
          onDeleted={handleTripDeleted}
        />
      )}

      {showPaymentModal && paymentTrip && (
        <TripPaymentsModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentTrip(null);
          }}
          trip={paymentTrip}
          onSaved={handlePaymentSaved}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialogOpen && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteDialogOpen(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-text">Delete Trip?</h3>
                  <p className="text-sm text-muted">This action cannot be undone.</p>
                </div>
              </div>
              <p className="text-sm text-text mb-6">
                Are you sure you want to delete trip <span className="font-mono font-medium">{deleteTarget.trip_number}</span>?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteTrip}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    'Delete Trip'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg z-50 ${
            toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
    </AdminShell>
  );
}

export default AdminTrips;
