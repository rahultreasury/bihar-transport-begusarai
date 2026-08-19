import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from 'react';
import { useNavigate } from 'react-router-dom';
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
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const ITEMS_PER_PAGE = 20;

const SORTABLE_FIELDS = ['created_at', 'pickup_date', 'final_price', 'status'];

function AdminBookings() {
  const navigate = useNavigate();
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
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingBooking, setDeletingBooking] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [deletionSummary, setDeletionSummary] = useState(null);
  const [selectedAction, setSelectedAction] = useState('keep');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toast, setToast] = useState(null);

  // Quote modal state
  const [quoteTarget, setQuoteTarget] = useState(null);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteSuccess, setQuoteSuccess] = useState('');

  // Toast helper
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

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

  // Open booking details in a READ-ONLY dedicated page (by canonical booking number)
  const bookingIdentifier = useCallback((row) => {
    return row?.booking_number || row?.booking_reference || null;
  }, []);

  const openBooking = useCallback((row) => {
    const id = bookingIdentifier(row);
    if (!id) return;
    navigate(`/admin/bookings/${encodeURIComponent(id)}`);
  }, [navigate, bookingIdentifier]);

  // Open booking details drawer (retained only for the separate "Send Quote" workflow)
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

  // Determine whether a booking row can open the deletion management modal.
  // Cancelled and rejected bookings are always eligible for the modal.
  // Other cleanup states (pending, quote_sent, expired) are also eligible
  // but the backend will enforce the final rules.
  const isDeletableBooking = useCallback((row) => {
    const status = (row.status || '').toLowerCase();
    const protectedStatuses = ['confirmed', 'driver_assigned', 'pickup_completed', 'pickup_started', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];
    if (protectedStatuses.includes(status)) return false;
    return true;
  }, []);

  // Fetch deletion summary when the modal opens.
  useEffect(() => {
    let cancelled = false;
    if (!deleteTarget) {
      setDeletionSummary(null);
      setSelectedAction('keep');
      setConfirmationCode('');
      return;
    }
    setLoadingSummary(true);
    setDeleteError(null);
    adminAPI
      .getDeletionSummary(deleteTarget.booking_id)
      .then((response) => {
        if (!cancelled && response.data?.success) {
          setDeletionSummary(response.data.data);
          // Default to 'keep' for safety.
          setSelectedAction('keep');
          setConfirmationCode('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err?.response?.data?.error?.message || err?.message || 'Failed to load deletion options.';
          setDeleteError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deleteTarget]);

  // For permanent delete, show a second confirmation modal before calling the API.
  const handleDeletionAction = useCallback(async () => {
    if (!deleteTarget || deletingBooking) return;
    if (!selectedAction) return;
    if (selectedAction === 'delete') {
      if (confirmationCode !== 'DELETE') {
        setDeleteError('Please type DELETE to confirm.');
        return;
      }
      setShowDeleteConfirm(true);
      return;
    }
    // For keep/archive, proceed directly.
    setDeletingBooking(true);
    setDeleteError(null);
    try {
      const response = await adminAPI.deletionAction(deleteTarget.booking_id, selectedAction, confirmationCode);
      const data = response.data || {};
      const actionLabels = { keep: 'kept', archive: 'archived', delete: 'permanently deleted' };
      // Immediately remove the booking from local state so the UI updates instantly.
      setBookings(prev => prev.filter(b => b.booking_id !== deleteTarget.booking_id));
      setDeleteTarget(null);
      setDeletionSummary(null);
      setSelectedAction('keep');
      setConfirmationCode('');
      setShowDeleteConfirm(false);
      showToast('✓ ' + (data.message || `Booking ${actionLabels[selectedAction]} successfully`), 'success');
      fetchBookings(pagination.page);
      fetchStats();
    } catch (err) {
      const structured = err?.response?.data?.error;
      const msg = structured?.message || err?.response?.data?.message || err?.message || 'Failed to process deletion action.';
      setDeleteError(msg);
      showToast('✗ ' + msg, 'error');
    } finally {
      setDeletingBooking(false);
    }
  }, [deleteTarget, deletingBooking, selectedAction, confirmationCode, pagination.page, fetchBookings, fetchStats, showToast]);

  // Confirm permanent delete from the second confirmation modal.
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deletingBooking) return;
    setDeletingBooking(true);
    setDeleteError(null);
    try {
      const response = await adminAPI.deletionAction(deleteTarget.booking_id, 'delete', confirmationCode);
      const data = response.data || {};
      // Immediately remove the booking from local state so the UI updates instantly.
      setBookings(prev => prev.filter(b => b.booking_id !== deleteTarget.booking_id));
      setDeleteTarget(null);
      setDeletionSummary(null);
      setSelectedAction('keep');
      setConfirmationCode('');
      setShowDeleteConfirm(false);
      showToast('✓ ' + (data.message || 'Booking permanently deleted successfully'), 'success');
      fetchBookings(pagination.page);
      fetchStats();
    } catch (err) {
      const structured = err?.response?.data?.error;
      const msg = structured?.message || err?.response?.data?.message || err?.message || 'Failed to permanently delete booking.';
      setDeleteError(msg);
      showToast('✗ ' + msg, 'error');
    } finally {
      setDeletingBooking(false);
    }
  }, [deleteTarget, deletingBooking, confirmationCode, pagination.page, fetchBookings, fetchStats, showToast]);

// Handle driver assignment — navigate to the dedicated full-page assignment workflow.
  // The driver's registered vehicle is auto-assigned (brokerage model), so there is
  // no separate "Assign Vehicle" action.
  const handleAssignDriver = useCallback((row) => {
    const id = bookingIdentifier(row);
    if (!id) return;
    navigate(`/admin/bookings/${encodeURIComponent(id)}/assign-driver`);
  }, [navigate, bookingIdentifier]);

  // Open quote modal for a booking that already has a driver assigned
  const handleOpenQuoteModal = useCallback((row) => {
    setQuoteTarget(row);
    setQuotePrice(row.final_price != null ? String(row.final_price) : '');
    setQuoteNote('');
    setQuoteError('');
    setQuoteSuccess('');
    setQuoteModalOpen(true);
  }, []);

  const handleCloseQuoteModal = useCallback(() => {
    setQuoteModalOpen(false);
    setQuoteTarget(null);
    setQuotePrice('');
    setQuoteNote('');
    setQuoteError('');
    setQuoteSuccess('');
  }, []);

  const handleSendQuote = useCallback(async () => {
    if (!quoteTarget) return;
    const price = Number(quotePrice);
    if (!quotePrice || isNaN(price) || price <= 0) {
      setQuoteError('Please enter a valid final price (₹).');
      return;
    }
    setSendingQuote(true);
    setQuoteError('');
    setQuoteSuccess('');
    try {
      const response = await adminAPI.sendAdminQuote(quoteTarget.booking_id, {
        final_price: price,
        note: quoteNote || null,
      });
      if (response.data?.success) {
        setQuoteSuccess('Quote sent to customer successfully.');
        setQuoteModalOpen(false);
        fetchBookings(pagination.page);
        fetchStats();
      } else {
        setQuoteError(response.data?.message || 'Failed to send quote');
      }
    } catch (err) {
      setQuoteError(err?.response?.data?.message || err?.message || 'Failed to send quote');
    } finally {
      setSendingQuote(false);
    }
  }, [quoteTarget, quotePrice, quoteNote, pagination.page, fetchBookings, fetchStats]);

  // Bulk actions
  const handleBulkStatusUpdate = useCallback(async (newStatus) => {
    if (selection.selectedCount === 0) return;
    const ids = selection.selectedBookings.map((b) => b.booking_id);
    try {
      if (newStatus === 'confirmed') {
        await adminAPI.bulkConfirm(ids);
      } else if (newStatus === 'cancelled') {
        await adminAPI.bulkCancel(ids);
      } else {
        await adminAPI.bulkUpdateStatus(ids, newStatus);
      }
      selection.clearSelection();
      fetchBookings(pagination.page);
    } catch (err) {
      console.error('Bulk status update error:', err);
      setError(err?.response?.data?.message || err.message || 'Bulk update failed. Please try again.');
    }
  }, [selection, fetchBookings, pagination.page, setError]);

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
          onClick={() => openBooking(r)}
          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline text-left whitespace-nowrap"
          aria-label={`View booking ${r.booking_number || r.booking_reference}`}
          title="View booking"
        >
          {r.booking_number || r.booking_reference}
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
render: (r) => <StatusBadge status={r.status} quoteStatus={r.quote_status} size="sm" />
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
            onClick={() => openBooking(r)}
            className="p-1.5 rounded-lg hover:bg-blue-500/10 transition text-blue-500 hover:text-blue-600"
            aria-label={`View details for ${r.booking_number || r.booking_reference}`}
            title="View"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <button
            onClick={() => handleAssignDriver(r)}
            className="p-1.5 rounded-lg hover:bg-violet-500/10 transition text-violet-500 hover:text-violet-600"
            aria-label={`Assign driver for ${r.booking_number || r.booking_reference}`}
            title="Assign Driver (vehicle auto-assigned from driver's vehicle)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </button>
          <button
            onClick={() => handleOpenQuoteModal(r)}
            disabled={!r.driver_id && !r.driver_name_snapshot}
            className={`p-1.5 rounded-lg transition ${(r.driver_id || r.driver_name_snapshot) ? 'hover:bg-emerald-500/10 text-emerald-500 hover:text-emerald-600' : 'text-muted/40 cursor-not-allowed'}`}
            aria-label={`Send quote for ${r.booking_number || r.booking_reference}`}
            title={(r.driver_id || r.driver_name_snapshot) ? 'Send Final Quote' : 'Assign a driver before sending a quote'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
<button
            onClick={() => handleOpenStatusUpdate(r.booking_id, r.status)}
            className="p-1.5 rounded-lg hover:bg-amber-500/10 transition text-amber-500 hover:text-amber-600"
            aria-label={`Update status for ${r.booking_number || r.booking_reference}`}
            title="Update Status"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => setDeleteTarget(r)}
            disabled={!isDeletableBooking(r)}
            className={`p-1.5 rounded-lg transition ${isDeletableBooking(r) ? 'hover:bg-red-500/10 text-red-500 hover:text-red-600' : 'text-muted/40 cursor-not-allowed'}`}
            aria-label={`Manage booking ${r.booking_number || r.booking_reference}`}
            title={isDeletableBooking(r) ? 'Manage Booking (Keep / Archive / Delete)' : 'Only non-operational bookings can be managed'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )
    }
  ], [openDrawer, handleAssignDriver, handleOpenQuoteModal, openBooking, handleOpenStatusUpdate, setDeleteTarget, isDeletableBooking]);

  // Mobile card view
  const renderMobileCard = useCallback((booking) => (
    <div
      key={booking.booking_id}
      className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => openBooking(booking)}
          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
        >
          {booking.booking_number || booking.booking_reference}
        </button>
<StatusBadge status={booking.status} quoteStatus={booking.quote_status} size="sm" />
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
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => openBooking(booking)}
          className="flex-1 px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-xs font-medium hover:bg-hover/60 transition"
        >
          View
        </button>
        <button
          onClick={() => handleAssignDriver(booking)}
          className="px-3 py-2 rounded-lg bg-violet-500/10 text-violet-600 text-xs font-medium hover:bg-violet-500/20 transition"
        >
          Assign Driver
        </button>
        <button
          onClick={() => handleOpenQuoteModal(booking)}
          disabled={!booking.driver_id && !booking.driver_name_snapshot}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition ${(booking.driver_id || booking.driver_name_snapshot) ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          Send Quote
        </button>
      </div>
</div>
  ), [openBooking, handleAssignDriver, handleOpenQuoteModal]);

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
                title={`Confirm ${selection.selectedCount} booking(s)`}
              >
                Confirm
              </button>
              <button
                onClick={() => handleBulkStatusUpdate('cancelled')}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition"
                title={`Cancel ${selection.selectedCount} booking(s)`}
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

        {/* Send Quote Modal */}
        {quoteModalOpen && quoteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCloseQuoteModal} />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true" aria-label="Send Final Quote">
              <div className="text-center mb-4">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold">Send Final Quote</h3>
                <div className="mt-2 rounded-xl border border-border/60 bg-card/40 px-4 py-2.5 text-left inline-flex items-center gap-4">
                  <div>
                    <span className="text-muted text-xs block">Booking</span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 text-sm">{quoteTarget.booking_number || quoteTarget.booking_reference}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Driver</span>
                    <span className="font-semibold text-sm">{quoteTarget.driver_name_snapshot || `${quoteTarget.driver_first_name || ''} ${quoteTarget.driver_last_name || ''}`.trim() || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Vehicle</span>
                    <span className="font-semibold text-sm">{quoteTarget.truck_number_snapshot || quoteTarget.vehicle_number || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Final Price (₹) *</label>
                  <input
                    type="number"
                    value={quotePrice}
                    onChange={(e) => setQuotePrice(e.target.value)}
                    placeholder="Enter final transport price"
                    className="w-full px-3 py-2.5 border border-border/60 rounded-xl bg-surface text-sm focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 outline-none transition"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Note (optional)</label>
                  <textarea
                    value={quoteNote}
                    onChange={(e) => setQuoteNote(e.target.value)}
                    placeholder="Add a note for the customer"
                    rows={3}
                    className="w-full px-3 py-2.5 border border-border/60 rounded-xl bg-surface text-sm focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 outline-none transition resize-none"
                  />
                </div>

                {quoteError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                    {quoteError}
                  </div>
                )}
                {quoteSuccess && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
                    {quoteSuccess}
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleCloseQuoteModal}
                  disabled={sendingQuote}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendQuote}
                  disabled={sendingQuote}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 inline-flex items-center justify-center gap-2"
                >
                  {sendingQuote ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    'Send Quote'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

{/* Toast notification */}
        {toast && (
          <div className="fixed top-6 right-6 z-[100] animate-slide-down">
            <div className={`px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-semibold flex items-center gap-3 backdrop-blur-sm ${
              toast.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {toast.type === 'success' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                )}
              </svg>
              <span>{toast.message}</span>
              <button onClick={() => setToast(null)} className="ml-3 opacity-50 hover:opacity-100 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Booking Deletion Action Modal (Keep / Archive / Permanent Delete) */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setDeleteTarget(null); setDeletionSummary(null); setSelectedAction('keep'); setConfirmationCode(''); }} />
            <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true" aria-label="Booking Deletion Options">
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold mb-1">Manage Booking</h3>
                <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-2.5 text-left inline-flex items-center gap-4">
                  <div>
                    <span className="text-muted text-xs block">Booking</span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 text-sm">{deleteTarget.booking_number || deleteTarget.booking_reference}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Status</span>
                    <span className="font-semibold capitalize text-sm">{deleteTarget.status || '—'}</span>
                  </div>
                </div>
              </div>

              {loadingSummary && (
                <div className="text-center py-4 text-muted text-sm">Loading options...</div>
              )}

              {!loadingSummary && deletionSummary && (
                <>
                  {/* Warnings */}
                  {deletionSummary.warnings && deletionSummary.warnings.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                      {deletionSummary.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span>⚠</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action selector */}
                  <div className="space-y-2 mb-4">
                    <label className="block text-sm font-semibold mb-2">Select Action</label>
                    <button
                      type="button"
                      onClick={() => { setSelectedAction('keep'); setConfirmationCode(''); }}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition ${
                        selectedAction === 'keep'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                          : 'border-border/60 hover:bg-hover/60'
                      }`}
                    >
                      <span className="font-semibold">Keep Booking</span>
                      <span className="block text-xs text-muted mt-0.5">No changes. Booking remains in the system.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSelectedAction('archive'); setConfirmationCode(''); }}
                      disabled={!deletionSummary.eligible_actions.includes('archive')}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition ${
                        selectedAction === 'archive'
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-border/60 hover:bg-hover/60'
                      } ${!deletionSummary.eligible_actions.includes('archive') ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className="font-semibold">Archive Booking</span>
                      <span className="block text-xs text-muted mt-0.5">Soft-delete. Booking is hidden but all records are preserved for audit.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSelectedAction('delete'); setConfirmationCode(''); }}
                      disabled={!deletionSummary.eligible_actions.includes('delete')}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition ${
                        selectedAction === 'delete'
                          ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'
                          : 'border-border/60 hover:bg-hover/60'
                      } ${!deletionSummary.eligible_actions.includes('delete') ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className="font-semibold">Permanently Delete</span>
                      <span className="block text-xs text-muted mt-0.5">Irreversibly remove the booking and all non-protected related records.</span>
                    </button>
                  </div>

                  {/* Confirmation input for permanent delete */}
                  {selectedAction === 'delete' && (
                    <div className="mb-4">
                      <label className="block text-sm font-semibold mb-1.5 text-red-600 dark:text-red-400">
                        Type <span className="font-mono font-bold">DELETE</span> to confirm permanent deletion
                      </label>
                      <input
                        type="text"
                        value={confirmationCode}
                        onChange={(e) => setConfirmationCode(e.target.value)}
                        placeholder="Type DELETE here"
                        className="w-full px-3 py-2.5 border border-red-300 dark:border-red-500/40 rounded-xl bg-surface text-sm focus:ring-2 focus:ring-red-500/30 focus:border-red-500 outline-none transition"
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Error display */}
                  {deleteError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                      {deleteError}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setDeleteTarget(null); setDeletionSummary(null); setSelectedAction('keep'); setConfirmationCode(''); setShowDeleteConfirm(false); }}
                      disabled={deletingBooking}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeletionAction}
                      disabled={
                        deletingBooking ||
                        !selectedAction ||
                        (selectedAction === 'delete' && confirmationCode !== 'DELETE')
                      }
                      className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${
                        selectedAction === 'delete'
                          ? 'bg-red-500 hover:bg-red-600'
                          : selectedAction === 'archive'
                          ? 'bg-amber-500 hover:bg-amber-600'
                          : 'bg-blue-500 hover:bg-blue-600'
                      }`}
                    >
                      {deletingBooking && (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      {deletingBooking ? 'Processing...' : selectedAction === 'keep' ? 'Keep Booking' : selectedAction === 'archive' ? 'Archive Booking' : 'Delete Permanently'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Second confirmation modal for permanent delete */}
        {showDeleteConfirm && deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true" aria-label="Confirm Permanent Delete">
              <div className="text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold mb-1">Delete Booking Permanently?</h3>
                <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-2.5 text-left inline-flex items-center gap-4">
                  <div>
                    <span className="text-muted text-xs block">Booking</span>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-400 text-sm">{deleteTarget.booking_number || deleteTarget.booking_reference}</span>
                  </div>
                  <div>
                    <span className="text-muted text-xs block">Status</span>
                    <span className="font-semibold capitalize text-sm">{deleteTarget.status || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                <p>This will permanently remove this booking and its booking-specific records. This action cannot be undone.</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deletingBooking}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deletingBooking}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {deletingBooking && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {deletingBooking ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        )}

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

