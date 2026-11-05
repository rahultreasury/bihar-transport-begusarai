import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  Plus,
  Search,
  ChevronDown,
  Calendar,
  Truck,
  User,
  MapPin,
  ArrowRight,
  Wallet,
  ClipboardList,
  PackageCheck,
  FileCheck,
  CheckCircle,
  LayoutList,
  Loader2,
  BarChart3,
  Activity,
  Clock,
} from 'lucide-react';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import StatusBadge, { getStatusLabel, getAllStatuses } from '../components/admin-premium/booking/StatusBadge';
import BookingDetailsDrawer from '../components/admin-premium/booking/BookingDetailsDrawer';
import useBookingFilters from '../components/admin-premium/booking/useBookingFilters';
import useBookingSelection from '../components/admin-premium/booking/useBookingSelection';
import { resolveOrder, STAGE_INDEX, ORDER_STAGE_FILTERS } from '../utils/orderStatus';
import { Button } from '../components/admin-premium/ui/AdminUI';
import PremiumKpiCard from '../components/admin-premium/booking/PremiumKpiCard';

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

const ITEMS_PER_PAGE = 20;

const SORTABLE_FIELDS = ['created_at', 'pickup_date', 'final_price', 'status'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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

  // Fetch lifecycle summary for KPI cards
  const fetchLifecycleSummary = useCallback(async () => {
    try {
      const response = await adminAPI.getLifecycleSummary({});
      if (response.data?.success && response.data.counts) {
        setLifecycleSummary(response.data.counts);
      }
    } catch (err) {
      console.error('Error fetching lifecycle summary:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchBookings(1);
    fetchStats();
    fetchLifecycleSummary();
  }, [fetchBookings, fetchStats, fetchLifecycleSummary]);

  const [lifecycleSummary, setLifecycleSummary] = useState({
    totalOrders: 0,
    activeTrips: 0,
    vehiclePending: 0,
    inTransit: 0,
    delivered: 0,
    podPending: 0,
    completed: 0,
  });

  // KPI values from lifecycle summary API (full database counts)
  const kpi = useMemo(() => {
    return {
      totalOrders: lifecycleSummary.totalOrders || 0,
      activeTrips: lifecycleSummary.activeTrips || 0,
      vehiclePending: lifecycleSummary.vehiclePending || 0,
      inTransit: lifecycleSummary.inTransit || 0,
      delivered: lifecycleSummary.delivered || 0,
      podPending: lifecycleSummary.podPending || 0,
      completed: lifecycleSummary.completed || 0,
      outstanding: lifecycleSummary.outstandingAmount || 0,
    };
  }, [lifecycleSummary]);

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
    // Prefer Trip Master when a trip exists; fallback to Order Master for pre-operational bookings
    const tripId = row.trip_id ?? row.trip?.trip_id;
    const path = tripId ? `/admin/trips/${tripId}` : `/admin/bookings/${encodeURIComponent(id)}`;
    navigate(path, {
      state: {
        orderId: row.booking_id,
        tripId,
        bookingNumber: id,
        status: row.status,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id,
      }
    });
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

// Create order — navigate to the existing enquiry intake workflow, which is the
// entry point for creating a new order (enquiry → quotation → booking).
const handleCreateOrder = useCallback(() => {
  navigate('/admin/enquiries');
}, [navigate]);

// Review trips — filter to trips waiting for vehicle/loading (ORDER_CONFIRMED stage)
const handleReviewTrips = useCallback(() => {
  filters.setStage('VEHICLE_HIRED');
}, [filters]);

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

  // Table columns — redesigned to match target screenshot
  const columns = useMemo(() => [
    {
      key: 'booking_reference',
      header: 'Order',
      sortable: true,
      render: (r) => (
        <div className="whitespace-nowrap">
          <button
            onClick={() => openBooking(r)}
            className="font-semibold text-text hover:underline"
            aria-label={`View order ${r.booking_number || r.booking_reference}`}
            title="View order"
          >
            {r.booking_number || r.booking_reference}
          </button>
          {r.created_at && (
            <div className="text-[11px] text-muted mt-0.5">
              {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => {
        const name = `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim();
        return (
          <div className="whitespace-nowrap">
            <div className="font-semibold text-text">{name || '—'}</div>
            <div className="text-[11px] text-muted">{r.goods_type || '—'}</div>
          </div>
        );
      }
    },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-50 text-green-600 text-[10px]">
            <MapPin className="w-3 h-3" />
          </span>
          <span className="font-medium text-text">{r.pickup_city || '—'}</span>
          <span className="text-[10px] text-muted">→</span>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-50 text-red-600 text-[10px]">
            <MapPin className="w-3 h-3" />
          </span>
          <span className="font-medium text-text">{r.drop_city || '—'}</span>
        </div>
      )
    },
    {
      key: 'vehicle_driver',
      header: 'Vehicle & Driver',
      render: (r) => (
        <div className="whitespace-nowrap">
          <div className="flex items-center gap-1.5 text-sm">
            <Truck className="w-4 h-4 text-muted" />
            <span className="font-medium text-text">{r.vehicle_number || '—'}</span>
          </div>
          {r.driver_name_snapshot || r.driver_name || r.driver_id && r.driver_name ? (
            <div className="flex items-center gap-1.5 text-sm mt-0.5">
              <User className="w-4 h-4 text-muted" />
              <span className="font-medium text-text">
                {r.driver_name_snapshot || r.driver_name || '—'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm mt-0.5">
              <User className="w-4 h-4 text-muted/40" />
              <span className="text-[11px] text-muted/40">—</span>
            </div>
          )}
        </div>
      )
    },
    {
      key: 'trip_date',
      header: 'Trip Date',
      render: (r) => {
        const date = r.pickup_date || r.created_at;
        if (!date) return <span className="text-muted">—</span>;
        const d = new Date(date);
        return (
          <div className="flex items-center gap-1.5 text-sm">
            <Calendar className="w-4 h-4 text-muted" />
            <span className="font-medium text-text whitespace-nowrap">
              {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        );
      }
    },
    {
      key: 'customer_quote',
      header: 'Customer Quote',
      sortable: true,
      render: (r) => (
        <span className="font-semibold text-text whitespace-nowrap">
          {r.final_price != null ? `₹${Number(r.final_price).toLocaleString()}` : '—'}
        </span>
      )
    },
    {
      key: 'operational_status',
      header: 'Operational Status',
      sortable: true,
      render: (r) => {
        const resolved = resolveOrder(r);
        const stageLabel = resolved.stageLabel;
        const toneMap = {
          ENQUIRY: 'bg-amber-50 text-amber-700 border-amber-100',
          QUOTATION: 'bg-blue-50 text-blue-700 border-blue-100',
          ORDER_CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-100',
          VEHICLE_HIRED: 'bg-amber-50 text-amber-700 border-amber-100',
          LOADING: 'bg-amber-50 text-amber-700 border-amber-100',
          DISPATCH: 'bg-blue-50 text-blue-700 border-blue-100',
          TRANSIT: 'bg-blue-50 text-blue-700 border-blue-100',
          DELIVERY: 'bg-emerald-50 text-emerald-700 border-emerald-100',
          POD: 'bg-amber-50 text-amber-700 border-amber-100',
          COMPLETED: 'bg-[#15345B]/08 text-[#15345B] border-[#15345B]/20',
        };
        const toneClass = toneMap[resolved.stageKey] || 'bg-gray-50 text-gray-700 border-gray-100';
        return (
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[10px] font-medium leading-none ${toneClass}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {stageLabel}
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button
          onClick={() => openBooking(r)}
          className="p-1.5 rounded-lg hover:bg-hover/60 transition text-muted"
          aria-label={`View details for ${r.booking_number || r.booking_reference}`}
          title="View"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      )
    }
  ], [openBooking, handleAssignDriver, handleOpenQuoteModal, resolveOrder]);

  // Mobile card view
  const renderMobileCard = useCallback((booking) => (
    <div
      key={booking.booking_id}
      className="rounded-2xl border border-border/60 bg-card/40 p-4 space-y-3"
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
      <div className="space-y-6" ref={tableRef}>
        {/* Hero Header — compact premium composition matching reference screenshot 2 */}
        <div className="relative overflow-hidden rounded-[16px] border border-slate-200/80 bg-gradient-to-r from-white via-white to-sky-50 shadow-[0_24px_50px_-38px_rgba(23,54,93,0.95)]">
          <div className="absolute -right-8 -top-12 hidden lg:block h-[190px] w-[420px] opacity-90">
            <img
              src="/bihar-transport-hero.jpg"
              alt="Bihar Transport fleet illustration"
              className="h-full w-full object-contain object-right"
              loading="lazy"
            />
          </div>
          <div className="relative flex flex-col gap-3.5 px-4 py-3.5 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                <span className="font-medium">Operations</span>
                <span className="text-slate-300">→</span>
                <span className="font-semibold text-slate-700">Order / Trip Master</span>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#15345B]/10 text-[#15345B]">
                  <BarChart3 className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold tracking-tight text-[#15345B]">
                    Order / Trip Master
                  </h1>
                  <p className="mt-0.5 text-[13px] text-slate-600">
                    Manage every shipment from confirmation to delivery.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                  <Activity className="h-3 w-3 text-emerald-500" />
                  Live Operations
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
                  <Clock className="h-3 w-3 text-slate-500" />
                  {kpi.totalOrders.toLocaleString('en-IN')} Total Orders
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { fetchBookings(1); fetchLifecycleSummary(); }}
                icon={RefreshCw}
                aria-label="Refresh bookings"
                className="rounded-full px-3.5"
              >
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button variant="primary" size="sm" onClick={handleCreateOrder} className="rounded-full px-4" icon={Plus}>
                Create Order
              </Button>
            </div>
          </div>
        </div>

        {/* KPI Cards — compact 4-col, 2-row grid matching reference screenshot 2 */}
        <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-3 sm:gap-[12px] lg:grid-cols-4 lg:gap-[12px] xl:grid-cols-4">
          <PremiumKpiCard
            key="totalOrders"
            label="Total Orders"
            value={kpi.totalOrders}
            icon={ClipboardList}
            tone="blue"
            compact
            onClick={() => filters.setStage('ALL')}
            ariaLabel="View all orders"
          />
          <PremiumKpiCard
            key="activeTrips"
            label="Bookings with Active Trips"
            value={kpi.activeTrips}
            icon={Truck}
            tone="green"
            compact
            onClick={() => filters.setStage('ACTIVE_TRIPS')}
            ariaLabel="Filter by active trips"
          />
          <PremiumKpiCard
            key="vehiclePending"
            label="Vehicle Pending"
            value={kpi.vehiclePending}
            icon={LayoutList}
            tone="orange"
            compact
            onClick={() => filters.setStage('VEHICLE_HIRED')}
            ariaLabel="Filter by vehicle pending"
          />
          <PremiumKpiCard
            key="inTransit"
            label="In Transit"
            value={kpi.inTransit}
            icon={PackageCheck}
            tone="blue"
            compact
            onClick={() => filters.setStage('TRANSIT')}
            ariaLabel="Filter by in transit"
          />
          <PremiumKpiCard
            key="delivered"
            label="Delivered"
            value={kpi.delivered}
            icon={PackageCheck}
            tone="green"
            compact
            onClick={() => filters.setStage('DELIVERY')}
            ariaLabel="Filter by delivered"
          />
          <PremiumKpiCard
            key="podPending"
            label="POD Pending"
            value={kpi.podPending}
            icon={FileCheck}
            tone="orange"
            compact
            onClick={() => filters.setStage('POD')}
            ariaLabel="Filter by POD pending"
          />
          <PremiumKpiCard
            key="completed"
            label="Completed"
            value={kpi.completed}
            icon={CheckCircle}
            tone="navy"
            compact
            onClick={() => filters.setStage('COMPLETED')}
            ariaLabel="Filter by completed"
          />
          <PremiumKpiCard
            key="outstanding"
            label="Outstanding Amount"
            value={kpi.outstanding}
            icon={Wallet}
            tone="purple"
            isMoney={true}
            compact
            disabled
            ariaLabel="Outstanding amount"
          />
        </div>

        {/* Filter Row 1 — Search + Status + Date + Next Action Banner (compact) */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-[14px] border border-slate-200/80 bg-white p-3 shadow-[0_24px_50px_-38px_rgba(21,52,91,0.9)] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center min-w-0">
              {/* Search */}
              <div className="relative flex-1 min-w-[220px]">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <Search className="w-4 h-4 text-slate-400" strokeWidth={2} />
                </div>
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => filters.setSearch(e.target.value)}
                  placeholder="Search order, customer, route, vehicle..."
                  className="w-full pl-10 pr-4 py-2 rounded-[10px] border border-slate-200 bg-white text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all"
                  aria-label="Search bookings"
                />
              </div>

              {/* Status dropdown */}
              <div className="relative min-w-[150px]">
                <select
                  value={filters.status}
                  onChange={(e) => {
                    filters.setStatus(e.target.value);
                    setStatusChip && setStatusChip('ALL');
                  }}
                  className="w-full pl-4 pr-10 py-2 rounded-[10px] border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all appearance-none"
                >
                  <option value="">All statuses</option>
                  {getAllStatuses().map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>

              {/* Date dropdown */}
              <div className="relative min-w-[150px]">
                <select
                  value={filters.dateFrom}
                  onChange={(e) => {
                    filters.setDateFrom(e.target.value);
                    setStatusChip && setStatusChip('ALL');
                  }}
                  className="w-full pl-4 pr-10 py-2 rounded-[10px] border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all appearance-none"
                >
                  <option value="">All dates</option>
                  <option value="today">Today</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Next Action Banner */}
            <div className="flex w-full items-center gap-2.5 rounded-[10px] border border-amber-200/80 bg-gradient-to-r from-amber-50 to-white px-3 py-2 shadow-sm lg:w-auto">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-amber-900">
                  Next action: {kpi.vehiclePending} trips waiting for loading
                </div>
              </div>
              <button
                onClick={handleReviewTrips}
                className="ml-2 whitespace-nowrap px-2.5 py-1 rounded-full bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition"
              >
                Review trips →
              </button>
            </div>
          </div>
        </div>

        {/* Status Chips Row — compact lifecycle tabs */}
        <div className="rounded-[12px] border border-slate-200/80 bg-white p-1.5 shadow-[0_24px_50px_-38px_rgba(21,52,91,0.9)]">
          <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
            {ORDER_STAGE_FILTERS.map((chip) => {
              const isSelected = filters.stage === chip.key || (chip.key === 'ALL' && !filters.stage);
              const count = chip.key === 'ALL' ? pagination.total : (stageCounts?.[chip.key] || 0);
              return (
                <button
                  key={chip.key}
                  onClick={() => {
                    if (chip.key === 'ALL') {
                      filters.setStage('');
                      filters.setStatus('');
                    } else {
                      filters.setStage(chip.key);
                      const statusMap = {
                        ENQUIRY: 'pending',
                        QUOTATION: 'pending',
                        ORDER_CONFIRMED: 'confirmed',
                        VEHICLE_HIRED: 'confirmed',
                        LOADING: 'pickup_completed',
                        DISPATCH: 'in_transit',
                        TRANSIT: 'in_transit',
                        DELIVERY: 'delivered',
                        POD: 'delivered',
                        COMPLETED: 'completed',
                      };
                      filters.setStatus(statusMap[chip.key] || '');
                    }
                    if (typeof setStatusChip === 'function') {
                      setStatusChip(chip.key);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12.5px] font-medium whitespace-nowrap transition-all ${
                    isSelected
                      ? 'bg-[#15345B] text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full ${
                    isSelected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk Actions Toolbar */}
        {selection.selectedCount > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between animate-fade-in">
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
          <div className="hidden overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_24px_50px_-38px_rgba(21,52,91,0.9)] sm:block">
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
              onRowClick={(row) => openBooking(row)}
              getRowKey={(row) => row.booking_id}
              dense
              emptyMessage="No bookings match your filters"
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
            <div className="absolute inset-0 bg-black/40" onClick={handleCloseQuoteModal} />
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
            <div className={`px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-semibold flex items-center gap-3 ${
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
            <div className="absolute inset-0 bg-black/40" onClick={() => { setDeleteTarget(null); setDeletionSummary(null); setSelectedAction('keep'); setConfirmationCode(''); }} />
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
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeleteConfirm(false)} />
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
            <div className="absolute inset-0 bg-black/40" onClick={handleCloseStatusUpdate} />
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

