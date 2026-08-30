import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import AddTripModal from '../components/admin-premium/trips/AddTripModal';
import TripDetailsModal from '../components/admin-premium/trips/TripDetailsModal';
import TripExpensesModal from '../components/admin-premium/trips/TripExpensesModal';
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
  const [topClients, setTopClients] = useState([]);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [expensesModalOpen, setExpensesModalOpen] = useState(false);
  const [paymentsModalOpen, setPaymentsModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [toast, setToast] = useState(null);

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

  // Fetch top clients
  const fetchTopClients = useCallback(async () => {
    try {
      const response = await adminAPI.getTopClients(5);
      if (response.data?.success) {
        setTopClients(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch top clients:', err);
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
    fetchTopClients();
  }, [fetchSummary, fetchTopClients]);

  // Fetch trips when tab changes
  useEffect(() => {
    fetchTrips(1, activeTab);
  }, [activeTab, fetchTrips]);

  // Handle tab change
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
  }, []);

  // Handle add trip — navigate to full-page create trip workflow
  const handleAddTrip = useCallback(() => {
    navigate('/admin/trips/create');
  }, [navigate]);

  // Handle edit trip
  const handleEditTrip = useCallback((trip) => {
    setEditingTrip(trip);
    setAddModalOpen(true);
  }, []);

  // Handle view trip
  const handleViewTrip = useCallback((trip) => {
    setSelectedTrip(trip);
    setDetailsModalOpen(true);
  }, []);

  // Handle add expense
  const handleAddExpense = useCallback((trip) => {
    setSelectedTrip(trip);
    setExpensesModalOpen(true);
  }, []);

  // Handle add payment
  const handleAddPayment = useCallback((trip) => {
    setSelectedTrip(trip);
    setPaymentsModalOpen(true);
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

  // Handle trip saved (add or edit)
  const handleTripSaved = useCallback(() => {
    setAddModalOpen(false);
    setEditingTrip(null);
    fetchTrips(pagination.page, activeTab);
    fetchSummary();
    fetchTopClients();
  }, [fetchTrips, pagination.page, activeTab, fetchSummary, fetchTopClients]);

  // Handle expense saved
  const handleExpenseSaved = useCallback(() => {
    setExpensesModalOpen(false);
    setSelectedTrip(null);
    fetchTrips(pagination.page, activeTab);
    fetchSummary();
  }, [fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle payment saved
  const handlePaymentSaved = useCallback(() => {
    setPaymentsModalOpen(false);
    setSelectedTrip(null);
    fetchTrips(pagination.page, activeTab);
    fetchSummary();
  }, [fetchTrips, pagination.page, activeTab, fetchSummary]);

  // Handle trip deleted
  const handleTripDeleted = useCallback(() => {
    setDetailsModalOpen(false);
    setSelectedTrip(null);
    fetchTrips(1, activeTab);
    fetchSummary();
    fetchTopClients();
  }, [fetchTrips, activeTab, fetchSummary, fetchTopClients]);

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

  // Table columns
  const columns = useMemo(() => [
    {
      key: 'trip_number',
      header: 'Trip #',
      sortable: true,
      render: (row) => (
        <span className="font-medium text-amber-600">{row.trip_number}</span>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: (row) => (
        <span>
          {row.user ? `${row.user.first_name} ${row.user.last_name}` : '-'}
        </span>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      render: (row) => (
        <span className="text-sm">
          {row.pickup_city} → {row.drop_city}
        </span>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (row) => row.driver?.driver_name || '-',
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) => row.vehicle?.vehicle_number || '-',
    },
    {
      key: 'freight',
      header: 'Freight',
      sortable: true,
      render: (row) => formatCurrency(row.freight_amount),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}>
          {row.status?.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'trip_date',
      header: 'Trip Date',
      sortable: true,
      render: (row) => formatDate(row.trip_date),
    },
    {
      key: 'actions',
      header: 'Action',
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
                handleAddExpense(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Add Expense
            </button>
            <button
              onClick={() => {
                handleAddPayment(row);
                document.getElementById(`trip-menu-${row.trip_id}`)?.classList.add('hidden');
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-hover/60 transition-colors"
            >
              Add Payment
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
          </div>
        </div>
      ),
    },
  ], [handleViewTrip, handleEditTrip, handleAddExpense, handleAddPayment, handleStatusChange, formatCurrency, formatDate, getStatusColor]);

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Trips Management</h1>
          <p className="text-sm text-muted mt-1">Manage all offline and online trips in one place</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-hover/60 rounded-xl transition-colors relative">
            <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
          <button className="p-2 hover:bg-hover/60 rounded-xl transition-colors">
            <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-sm font-medium">
            A
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summaryError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Total Trips"
          value={summary?.totalTrips || 0}
          sub="All time"
          accent="amber"
          loading={!summary}
          onClick={() => handleTabChange('all')}
          active={activeTab === 'all'}
        />
        <KpiCard
          title="In Transit"
          value={summary?.inTransit || 0}
          sub="Active trips"
          accent="purple"
          loading={!summary}
          onClick={() => handleTabChange('in_transit')}
          active={activeTab === 'in_transit'}
        />
        <KpiCard
          title="Completed"
          value={summary?.completed || 0}
          sub="Finished trips"
          accent="green"
          loading={!summary}
          onClick={() => handleTabChange('completed')}
          active={activeTab === 'completed'}
        />
        <KpiCard
          title="Total Freight"
          value={formatCurrency(summary?.totalFreight)}
          sub="All time"
          accent="sky"
          loading={!summary}
        />
        <KpiCard
          title="Total Profit"
          value={formatCurrency(summary?.totalProfit)}
          sub="All time"
          accent="green"
          loading={!summary}
        />
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Left - Trips Table */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4 bg-card/40 p-1 rounded-xl w-fit">
            {TRIP_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  activeTab === tab.key
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-muted hover:text-text hover:bg-hover/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search and Filters */}
          <TripFilters onFilterChange={handleFilterChange} />

          {/* Add Trip Button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={handleAddTrip}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Trip
            </button>
          </div>

          {/* Table */}
          <div className="bg-card/40 rounded-2xl border border-border/60 overflow-hidden">
            {loading ? (
              <div className="p-6">
                <LoadingSkeleton />
              </div>
            ) : error ? (
              <div className="p-6 text-center text-red-500">{error}</div>
            ) : trips.length === 0 ? (
              <EmptyState message="No trips found" />
            ) : (
              <PremiumTable
                columns={columns}
                rows={trips}
                loading={loading}
              />
            )}
          </div>

          {/* Pagination */}
          {!loading && trips.length > 0 && (
            <div className="flex items-center justify-between mt-4">
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

        {/* Right Sidebar */}
        <div className="w-80 shrink-0 space-y-6">
          {/* Trip Summary */}
          <div className="bg-card/40 rounded-2xl border border-border/60 p-5">
            <h3 className="text-lg font-semibold mb-4">Trip Summary (All Time)</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Total Trips</span>
                <span className="font-semibold">{summary?.totalTrips || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Completed</span>
                <span className="font-semibold text-green-600">{summary?.completed || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">In Transit</span>
                <span className="font-semibold text-purple-600">{summary?.inTransit || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Pending</span>
                <span className="font-semibold text-yellow-600">{summary?.pending || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Cancelled</span>
                <span className="font-semibold text-red-600">{summary?.cancelled || 0}</span>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="bg-card/40 rounded-2xl border border-border/60 p-5">
            <h3 className="text-lg font-semibold mb-4">Financial Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Total Freight</span>
                <span className="font-semibold">{formatCurrency(summary?.totalFreight)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Total Expenses</span>
                <span className="font-semibold text-red-600">{formatCurrency(summary?.totalExpenses)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Total Profit</span>
                <span className="font-semibold text-green-600">{formatCurrency(summary?.totalProfit)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Total Received</span>
                <span className="font-semibold">{formatCurrency(summary?.totalPayments)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Outstanding</span>
                <span className="font-semibold text-orange-600">{formatCurrency(summary?.outstanding)}</span>
              </div>
            </div>
          </div>

          {/* Top Clients */}
          <div className="bg-card/40 rounded-2xl border border-border/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Top Clients</h3>
              <button
                onClick={() => navigate('/admin/bookings')}
                className="text-sm text-amber-600 hover:text-amber-700"
              >
                View all
              </button>
            </div>
            <div className="space-y-3">
              {topClients.map((client, index) => (
                <div key={client.user?.user_id || index} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {client.user ? `${client.user.first_name} ${client.user.last_name}` : 'Unknown'}
                    </div>
                    <div className="text-xs text-muted">
                      {client.tripCount} Trips
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {formatCurrency(client.totalFreight)}
                  </div>
                </div>
              ))}
              {topClients.length === 0 && (
                <div className="text-sm text-muted text-center py-4">No data available</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {addModalOpen && editingTrip && (
        <AddTripModal
          isOpen={addModalOpen}
          onClose={() => {
            setAddModalOpen(false);
            setEditingTrip(null);
          }}
          onSaved={handleTripSaved}
          editingTrip={editingTrip}
        />
      )}

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

      {expensesModalOpen && selectedTrip && (
        <TripExpensesModal
          isOpen={expensesModalOpen}
          onClose={() => {
            setExpensesModalOpen(false);
            setSelectedTrip(null);
          }}
          trip={selectedTrip}
          onSaved={handleExpenseSaved}
        />
      )}

      {paymentsModalOpen && selectedTrip && (
        <TripPaymentsModal
          isOpen={paymentsModalOpen}
          onClose={() => {
            setPaymentsModalOpen(false);
            setSelectedTrip(null);
          }}
          trip={selectedTrip}
          onSaved={handlePaymentSaved}
        />
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
