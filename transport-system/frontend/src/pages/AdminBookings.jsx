import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import StatusBadge, { getStatusLabel, getAllStatuses } from '../components/admin-premium/booking/StatusBadge';
import BookingFilters from '../components/admin-premium/booking/BookingFilters';
import BookingDetailsDrawer from '../components/admin-premium/booking/BookingDetailsDrawer';
import useBookingFilters from '../components/admin-premium/booking/useBookingFilters';
import useBookingSelection from '../components/admin-premium/booking/useBookingSelection';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const ITEMS_PER_PAGE = 20;

const SORTABLE_FIELDS = ['created_at', 'pickup_date', 'final_price', 'status'];

function AdminBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [stats, setStats] = useState(null);

  const filters = useBookingFilters();
  const selection = useBookingSelection(bookings);
  const tableRef = useRef(null);

  // Fetch bookings
  const fetchBookings = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        ...filters.queryParams,
      };

      // Only include sort params if field is supported
      if (SORTABLE_FIELDS.includes(sortField)) {
        params.sort_by = sortField;
        params.sort_order = sortDirection;
      }

      const response = await adminAPI.getBookings(params);
      if (response.data?.success) {
        setBookings(response.data.data || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Failed to fetch bookings');
      }
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError(err.message || 'Failed to load bookings. Please try again.');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [filters.queryParams, sortField, sortDirection]);

  // Fetch dashboard stats for quick stats bar
  const fetchStats = useCallback(async () => {
    try {
      const response = await adminAPI.getDashboard();
      if (response.data?.success) {
        setStats(response.data.data?.stats || null);
      }
    } catch (err) {
      // Stats are non-critical — silently fail
      console.error('Error fetching stats:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchBookings(1);
    fetchStats();
  }, [fetchBookings, fetchStats]);

  // Handle page change
  const handlePageChange = useCallback((newPage) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    selection.clearSelection();
    setPagination(prev => ({ ...prev, page: newPage }));
    fetchBookings(newPage);
  }, [pagination.pages, fetchBookings, selection]);

  // Handle sort
  const handleSort = useCallback((field) => {
    if (!SORTABLE_FIELDS.includes(field)) return;
    setSortField(prevField => {
      if (prevField === field) {
        setSortDirection(prevDir => prevDir === 'asc' ? 'desc' : 'asc');
      } else {
        setSortDirection('desc');
      }
      return field;
    });
    selection.clearSelection();
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [selection]);

  // Status management state
  const [statusUpdateBookingId, setStatusUpdateBookingId] = useState(null);
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Open booking details drawer
  const openDrawer = useCallback(async (bookingId) => {
    try {
      const response = await adminAPI.getBooking(bookingId);
      if (response.data?.success) {
        setSelectedBooking(response.data.data);
        setDrawerOpen(true);
      }
    } catch (err) {
      console.error('Error fetching booking details:', err);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedBooking(null), 200);
  }, []);

  // Handle status update
  const handleOpenStatusUpdate = useCallback((bookingId, currentStatus) => {
    setStatusUpdateBookingId(bookingId);
    setNewStatus(currentStatus || 'pending');
    setStatusUpdateOpen(true);
  }, []);

  const handleCloseStatusUpdate = useCallback(() => {
    setStatusUpdateOpen(false);
    setStatusUpdateBookingId(null);
    setNewStatus('');
  }, []);

  const handleStatusUpdate = useCallback(async () => {
    if (!statusUpdateBookingId || !newStatus) return;
    setIsUpdating(true);
    try {
      await adminAPI.updateBookingStatus(statusUpdateBookingId, newStatus);
      handleCloseStatusUpdate();
      fetchBookings(pagination.page);
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setIsUpdating(false);
    }
  }, [statusUpdateBookingId, newStatus, pagination.page, fetchBookings, handleCloseStatusUpdate]);

  // Handle driver assignment — navigate to drivers or show placeholder
  const handleAssignDriver = useCallback((bookingId) => {
    // Opens the drawer which already shows driver/vehicle assignment info
    openDrawer(bookingId);
  }, [openDrawer]);

  // Bulk actions
  const handleBulkStatusUpdate = useCallback(async (newStatus) => {
    if (selection.selectedCount === 0) return;
    try {
      for (const booking of selection.selectedBookings) {
        await adminAPI.updateBookingStatus(booking.booking_id, newStatus);
      }
      selection.clearSelection();
      fetchBookings(pagination.page);
    } catch (err) {
      console.error('Bulk status update error:', err);
    }
  }, [selection, fetchBookings, pagination.page]);

  // Export CSV
  const handleExportCSV = useCallback(() => {
    if (bookings.length === 0) return;
    const headers = [
      'Booking #', 'Customer', 'Phone', 'Pickup', 'Drop',
      'Goods', 'Price', 'Status', 'Created', 'Vehicle'
    ];
    const rows = bookings.map(b => [
      b.booking_reference,
      `${b.customer_first_name || ''} ${b.customer_last_name || ''}`.trim(),
      b.customer_phone,
      b.pickup_city,
      b.drop_city,
      b.goods_type,
      b.final_price,
      getStatusLabel(b.status),
      b.created_at,
      b.vehicle_number || '—'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bookings_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [bookings]);

  // Table columns
  const columns = useMemo(() => [
    {
      key: 'booking_reference',
      header: 'Booking #',
      sortable: true,
      render: (r) => (
        <button
          onClick={() => openDrawer(r.booking_id)}
          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline text-left whitespace-nowrap"
          aria-label={`View booking ${r.booking_reference}`}
        >
          {r.booking_reference}
        </button>
      )
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => {
        const name = `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim();
        return (
          <div className="whitespace-nowrap">
            <div className="font-medium text-text">{name || '—'}</div>
            <div className="text-[11px] text-muted">{r.customer_phone || '—'}</div>
          </div>
        );
      }
    },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (
        <div className="flex items-center gap-1 text-sm whitespace-nowrap">
          <span className="font-medium">{r.pickup_city || '—'}</span>
          <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          <span className="font-medium">{r.drop_city || '—'}</span>
        </div>
      )
    },
    {
      key: 'goods_type',
      header: 'Goods',
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">{r.goods_type || '—'}</span>
      )
    },
    {
      key: 'vehicle_number',
      header: 'Vehicle',
      render: (r) => (
        <div className="whitespace-nowrap">
          <div className="text-sm font-medium">{r.vehicle_number || '—'}</div>
          {r.vehicle_name && <div className="text-[10px] text-muted">{r.vehicle_name}</div>}
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <StatusBadge status={r.status} size="sm" />
    },
    {
      key: 'final_price',
      header: 'Price',
      sortable: true,
      render: (r) => (
        <span className="font-semibold text-sm whitespace-nowrap">
          {r.final_price != null ? `₹${Number(r.final_price).toLocaleString()}` : '—'}
        </span>
      )
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">
          {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        </span>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openDrawer(r.booking_id)}
            className="p-1.5 rounded-lg hover:bg-blue-500/10 transition text-blue-500 hover:text-blue-600"
            aria-label={`View details for ${r.booking_reference}`}
            title="View Details"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <button
            onClick={() => handleAssignDriver(r.booking_id)}
            className="p-1.5 rounded-lg hover:bg-violet-500/10 transition text-violet-500 hover:text-violet-600"
            aria-label={`Assign driver for ${r.booking_reference}`}
            title="Assign Driver"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </button>
          <button
            onClick={() => handleOpenStatusUpdate(r.booking_id, r.status)}
            className="p-1.5 rounded-lg hover:bg-amber-500/10 transition text-amber-500 hover:text-amber-600"
            aria-label={`Update status for ${r.booking_reference}`}
            title="Update Status"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      )
    }
  ], [openDrawer, handleAssignDriver, handleOpenStatusUpdate]);

  // Mobile card view
  const renderMobileCard = useCallback((booking) => (
    <div
      key={booking.booking_id}
      className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => openDrawer(booking.booking_id)}
          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
        >
          {booking.booking_reference}
        </button>
        <StatusBadge status={booking.status} size="sm" />
      </div>
      <div className="text-sm">
        <span className="text-muted">Customer: </span>
        <span className="font-medium">{`${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || '—'}</span>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="font-medium">{booking.pickup_city || '—'}</span>
        <span className="text-muted">→</span>
        <span className="font-medium">{booking.drop_city || '—'}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          {booking.final_price != null ? `₹${Number(booking.final_price).toLocaleString()}` : '—'}
        </span>
        <span className="text-muted">
          {booking.created_at ? new Date(booking.created_at).toLocaleDateString('en-IN') : '—'}
        </span>
      </div>
    </div>
  ), [openDrawer]);

  // Quick stats bar
  const quickStats = useMemo(() => {
    if (!stats) return [];
    return [
      { label: 'Pending', value: stats.pendingBookings ?? 0, color: 'text-amber-500' },
      { label: 'Active', value: stats.activeDeliveries ?? 0, color: 'text-blue-500' },
      { label: 'Delivered', value: stats.completedDeliveries ?? 0, color: 'text-green-500' },
      { label: 'Revenue', value: stats.todayRevenue ? `₹${Number(stats.todayRevenue).toLocaleString()}` : '₹0', color: 'text-emerald-500' },
    ];
  }, [stats]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="bookings" onNav={(k) => {}}>
      <div className="space-y-5" ref={tableRef}>
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
            <p className="text-sm text-muted mt-1">
              {pagination.total > 0
                ? `${pagination.total} total bookings`
                : 'Manage all transport bookings'}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {bookings.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium hover:bg-hover/60 transition flex items-center gap-2"
                aria-label="Export bookings as CSV"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                CSV
              </button>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        {quickStats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4"
              >
                <div className="text-[11px] font-medium text-muted uppercase tracking-wider">{stat.label}</div>
                <div className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <BookingFilters
          search={filters.search}
          onSearchChange={filters.setSearch}
          status={filters.status}
          onStatusChange={filters.setStatus}
          goodsType={filters.goodsType}
          onGoodsTypeChange={filters.setGoodsType}
          pickupCity={filters.pickupCity}
          onPickupCityChange={filters.setPickupCity}
          dropCity={filters.dropCity}
          onDropCityChange={filters.setDropCity}
          dateFrom={filters.dateFrom}
          onDateFromChange={filters.setDateFrom}
          dateTo={filters.dateTo}
          onDateToChange={filters.setDateTo}
          priceMin={filters.priceMin}
          onPriceMinChange={filters.setPriceMin}
          priceMax={filters.priceMax}
          onPriceMaxChange={filters.setPriceMax}
          onReset={filters.resetFilters}
          activeFilterCount={filters.activeFilterCount}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
        />

        {/* Bulk Actions Toolbar */}
        {selection.selectedCount > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-xl p-3 flex items-center justify-between animate-fade-in">
            <div className="text-sm font-medium">
              <span className="text-amber-600 dark:text-amber-400">{selection.selectedCount}</span> selected
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkStatusUpdate('confirmed')}
                className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition"
                disabled // No backend bulk endpoint
                title="Not available — no bulk API endpoint"
              >
                Confirm
              </button>
              <button
                onClick={() => handleBulkStatusUpdate('cancelled')}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition"
                disabled
                title="Not available — no bulk API endpoint"
              >
                Cancel
              </button>
              <button
                onClick={selection.clearSelection}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-text transition"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Failed to load bookings</div>
            <div className="text-sm text-muted mb-4">{error}</div>
            <button
              onClick={() => fetchBookings(1)}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="space-y-4">
            <LoadingSkeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && bookings.length === 0 && (
          <EmptyState
            title="No bookings found"
            subtitle={filters.hasActiveFilters
              ? "Try adjusting your search or filters."
              : "Bookings will appear here once customers create them."
            }
          />
        )}

        {/* Table — Desktop */}
        {!loading && !error && bookings.length > 0 && (
          <div className="hidden sm:block">
            <PremiumTable
              columns={columns}
              rows={bookings}
              loading={false}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              selectedIds={selection.selectedIds}
              onSelect={selection.toggleSelection}
              onSelectAll={selection.selectAll}
              isAllSelected={selection.isAllSelected}
              isIndeterminate={selection.isIndeterminate}
              onKeyDown={selection.handleKeyDown}
              focusedIndex={selection.focusedIndex}
            />
          </div>
        )}

        {/* Mobile Cards */}
        {!loading && !error && bookings.length > 0 && (
          <div className="sm:hidden space-y-3">
            {bookings.map(renderMobileCard)}
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
                aria-label="Previous page"
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
                    aria-label={`Page ${pageNum}`}
                    aria-current={pageNum === pagination.page ? 'page' : undefined}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Booking Details Drawer */}
        <BookingDetailsDrawer
          booking={selectedBooking}
          isOpen={drawerOpen}
          onClose={closeDrawer}
          onBookingUpdated={(bookingId) => {
            // Refresh booking details after driver assignment
            openDrawer(bookingId);
            // Also refresh the bookings list
            fetchBookings(pagination.page);
          }}
        />

        {/* Status Update Modal */}
        {statusUpdateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCloseStatusUpdate} />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden" role="dialog" aria-modal="true" aria-label="Update Booking Status">
              <div className="p-5 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Update Status</h3>
                  <button onClick={handleCloseStatusUpdate} className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-hover/60 transition" aria-label="Close">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm text-muted mt-1">Booking #{statusUpdateBookingId}</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">New Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full px-3 py-2.5 border border-border/60 rounded-xl bg-surface text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 outline-none transition"
                  >
                    {getAllStatuses().map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleCloseStatusUpdate}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStatusUpdate}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50"
                  >
                    {isUpdating ? 'Updating...' : 'Update'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminBookings;

