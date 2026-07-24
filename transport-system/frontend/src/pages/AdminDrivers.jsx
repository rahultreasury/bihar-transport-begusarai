import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import DriverStatusBadge from '../components/admin-premium/drivers/DriverStatusBadge';
import DriverFilters from '../components/admin-premium/drivers/DriverFilters';
import DriverRegisterModal from '../components/admin-premium/drivers/DriverRegisterModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'vehicles', label: 'Vehicles', icon: '⧉' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const ITEMS_PER_PAGE = 20;

function AdminDrivers() {
  const navigate = useNavigate();

  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusFilter) count++;
    return count;
  }, [search, statusFilter]);

  // Fetch drivers
  const fetchDrivers = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        search: search || undefined,
        status: statusFilter || undefined,
        sort_by: sortField || undefined,
        sort_order: sortDirection || undefined
      };

      const response = await adminAPI.getDrivers(params);
      if (response.data?.success) {
        setDrivers(response.data.data || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Failed to fetch drivers');
      }
    } catch (err) {
      console.error('Error fetching drivers:', err);
      setError(err.message || 'Failed to load drivers');
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sortField, sortDirection]);

  // Fetch dashboard stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await adminAPI.getDriverStats();
      if (response.data?.success) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching driver stats:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDrivers(1);
    fetchStats();
  }, [fetchDrivers, fetchStats]);

  // Handle page change
  const handlePageChange = useCallback((newPage) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    setPagination(prev => ({ ...prev, page: newPage }));
    fetchDrivers(newPage);
  }, [pagination.pages, fetchDrivers]);

  // Handle sort
  const handleSort = useCallback((field) => {
    setSortField(prevField => {
      if (prevField === field) {
        setSortDirection(prevDir => prevDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortDirection('desc');
      }
      return field;
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Reset filters
  const resetFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Handle driver registration success
  const handleRegisterSuccess = useCallback(() => {
    fetchDrivers(1);
    fetchStats();
  }, [fetchDrivers, fetchStats]);

  // KPI data
  const kpis = useMemo(() => {
    if (!stats) return [];
    return [
      { key: 'total', title: 'Total Drivers', value: stats.total ?? 0, sub: 'Registered', accent: 'amber', loading: false },
      { key: 'available', title: 'Available Drivers', value: stats.available ?? 0, sub: 'Ready for dispatch', accent: 'green', loading: false },
      { key: 'onTrip', title: 'Drivers on Trip', value: stats.onTrip ?? 0, sub: 'Currently active', accent: 'sky', loading: false },
      { key: 'inactive', title: 'Inactive Drivers', value: stats.inactive ?? 0, sub: 'Not available', accent: 'purple', loading: false },
      { key: 'todaysTrips', title: "Today's Trips", value: stats.todaysTrips ?? 0, sub: 'Started today', accent: 'amber', loading: false },
      { key: 'pendingPayments', title: 'Pending Payments', value: stats.pendingPayments ?? 0, sub: 'Balance due', accent: 'purple', loading: false },
      { key: 'advanceOutstanding', title: 'Advance Outstanding', value: stats.advanceOutstanding != null ? `₹${Number(stats.advanceOutstanding).toLocaleString()}` : '₹0', sub: 'Total advance given', accent: 'sky', loading: false },
    ];
  }, [stats]);

  // Table columns
  const columns = useMemo(() => [
    {
      key: 'driver_code',
      header: 'Driver ID',
      sortable: true,
      render: (r) => (
        <button
          onClick={() => navigate(`/admin/drivers/${r.driver_id}`)}
          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline text-left whitespace-nowrap font-mono"
        >
          {r.driver_code}
        </button>
      )
    },
    {
      key: 'driver_name',
      header: 'Name',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {r.driver_name?.charAt(0) || 'D'}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-text truncate max-w-[160px]">{r.driver_name}</div>
            <div className="text-[11px] text-muted">{r.mobile || '—'}</div>
          </div>
        </div>
      )
    },
    {
      key: 'vehicle',
      header: 'Assigned Vehicle',
      render: (r) => {
        const vehicle = r.transportVehicles?.[0];
        return (
          <div className="whitespace-nowrap">
            {vehicle ? (
              <div>
                <div className="text-sm font-medium">{vehicle.vehicle_number || '—'}</div>
                <div className="text-[10px] text-muted">{vehicle.vehicle_name || vehicle.vehicle_type || ''}</div>
              </div>
            ) : (
              <span className="text-sm text-muted">—</span>
            )}
          </div>
        );
      }
    },
    {
      key: 'current_booking',
      header: 'Current Trip',
      render: (r) => {
        const booking = r.bookings?.[0];
        if (!booking) return <span className="text-sm text-muted">—</span>;
        return (
          <div className="flex items-center gap-1 text-sm whitespace-nowrap">
            <span className="font-medium">{booking.pickup_city || '—'}</span>
            <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <span className="font-medium">{booking.drop_city || '—'}</span>
          </div>
        );
      }
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <DriverStatusBadge status={r.status} size="sm" />
    },
    {
      key: 'current_balance',
      header: 'Balance',
      sortable: true,
      render: (r) => {
        const balance = parseFloat(r.current_balance || 0);
        return (
          <span className={`font-semibold text-sm whitespace-nowrap ${balance > 0 ? 'text-red-500' : balance < 0 ? 'text-green-500' : 'text-muted'}`}>
            ₹{Math.abs(balance).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            {balance > 0 ? ' Dr' : balance < 0 ? ' Cr' : ''}
          </span>
        );
      }
    },
    {
      key: 'total_deliveries',
      header: 'Deliveries',
      sortable: true,
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">{r.total_deliveries || 0}</span>
      )
    },
    {
      key: 'last_activity',
      header: 'Last Activity',
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">
          {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate(`/admin/drivers/${r.driver_id}`)}
            className="p-1.5 rounded-lg hover:bg-amber-500/10 transition text-amber-500 hover:text-amber-600"
            aria-label={`View profile for ${r.driver_name}`}
            title="View Profile"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <button
            onClick={() => navigate(`/admin/drivers/${r.driver_id}?tab=finance`)}
            className="p-1.5 rounded-lg hover:bg-green-500/10 transition text-green-500 hover:text-green-600"
            aria-label={`Finance for ${r.driver_name}`}
            title="Finance"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      )
    }
  ], [navigate]);

  // Mobile card view
  const renderMobileCard = useCallback((driver) => (
    <div
      key={driver.driver_id}
      className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 space-y-3 cursor-pointer hover:bg-hover/30 transition"
      onClick={() => navigate(`/admin/drivers/${driver.driver_id}`)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs">
            {driver.driver_name?.charAt(0) || 'D'}
          </div>
          <div>
            <div className="text-sm font-semibold">{driver.driver_name}</div>
            <div className="text-[10px] font-mono text-muted">{driver.driver_code}</div>
          </div>
        </div>
        <DriverStatusBadge status={driver.status} size="sm" />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted text-xs">Mobile</span>
          <div className="font-medium">{driver.mobile || '—'}</div>
        </div>
        <div>
          <span className="text-muted text-xs">Balance</span>
          <div className={`font-semibold ${parseFloat(driver.current_balance || 0) > 0 ? 'text-red-500' : ''}`}>
            ₹{Number(driver.current_balance || 0).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="col-span-2">
          <span className="text-muted text-xs">Vehicle</span>
          <div className="font-medium">{driver.transportVehicles?.[0]?.vehicle_number || 'Not assigned'}</div>
        </div>
      </div>
    </div>
  ), [navigate]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="drivers" onNav={(k) => {}}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Driver Management</h1>
            <p className="text-sm text-muted mt-1">
              {pagination.total > 0
                ? `${pagination.total} driver${pagination.total !== 1 ? 's' : ''} registered`
                : 'Manage all drivers and their operations'}
            </p>
          </div>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Register Driver
          </button>
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            {kpis.map(k => (
              <KpiCard key={k.key} title={k.title} value={k.value} sub={k.sub} accent={k.accent} loading={false} />
            ))}
          </div>
        )}

        {/* Filters */}
        <DriverFilters
          search={search}
          onSearchChange={setSearch}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onReset={resetFilters}
          activeFilterCount={activeFilterCount}
        />

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Failed to load drivers</div>
            <div className="text-sm text-muted mb-4">{error}</div>
            <button
              onClick={() => fetchDrivers(1)}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            <LoadingSkeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && drivers.length === 0 && (
          <EmptyState
            title="No drivers found"
            subtitle={
              activeFilterCount > 0
                ? "Try adjusting your search or filters."
                : "Register your first driver to get started."
            }
          >
            {activeFilterCount === 0 && (
              <button
                onClick={() => setShowRegisterModal(true)}
                className="mt-4 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
              >
                Register First Driver
              </button>
            )}
          </EmptyState>
        )}

        {/* Table - Desktop */}
        {!loading && !error && drivers.length > 0 && (
          <div className="hidden sm:block">
            <PremiumTable
              columns={columns}
              rows={drivers.map(d => ({ ...d, id: d.driver_id }))}
              loading={false}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          </div>
        )}

        {/* Mobile Cards */}
        {!loading && !error && drivers.length > 0 && (
          <div className="sm:hidden space-y-3">
            {drivers.map(renderMobileCard)}
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && pagination.pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              {Array.from({ length: Math.min(pagination.pages, 5) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`w-9 h-9 rounded-xl text-sm font-medium transition ${
                      pageNum === pagination.page
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'border border-border/60 bg-card/40 hover:bg-hover/60'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Register Driver Modal */}
        <DriverRegisterModal
          isOpen={showRegisterModal}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={handleRegisterSuccess}
        />
      </div>
    </AdminShell>
  );
}

export default AdminDrivers;

