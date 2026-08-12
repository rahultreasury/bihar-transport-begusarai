import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import DriverStatusBadge from '../components/admin-premium/drivers/DriverStatusBadge';
import DriverFilters from '../components/admin-premium/drivers/DriverFilters';
import DriverRegisterModal from '../components/admin-premium/drivers/DriverRegisterModal';
import DriverTransactionModal from '../components/admin-premium/drivers/DriverTransactionModal';
import DriverVehicleAssignModal from '../components/admin-premium/drivers/DriverVehicleAssignModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const ITEMS_PER_PAGE = 20;

// 300ms debounce hook
function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// Highlight matching text in search results
function HighlightText({ text, highlight }) {
  if (!highlight || !text) return <>{text}</>;
  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-amber-200 dark:bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  );
}

// Generate avatar initials from driver name (e.g., "Rahul Kumar" → "RK")
function getInitials(name) {
  if (!name) return 'DR';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

// Helper to format balance
function formatBalance(balance) {
  if (balance == null || balance === 0) return null;
  const absBal = Math.abs(balance);
  if (absBal >= 100000) return `₹${(absBal / 100000).toFixed(1)}L`;
  if (absBal >= 1000) return `₹${(absBal / 1000).toFixed(1)}K`;
  return `₹${absBal.toLocaleString('en-IN')}`;
}

// Action Menu Item component
function ActionMenuItem({ icon, label, onClick, href, color = 'text-text' }) {
  const classes = `flex items-center gap-3 px-3 py-2 text-sm ${color} hover:bg-hover/60 rounded-lg transition w-full text-left`;
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>{icon}{label}</a>;
  }
  return <button onClick={(e) => { e.stopPropagation(); onClick?.(e); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClick?.(e); } }} className={classes}>{icon}{label}</button>;
}

// Quick filter buttons
const QUICK_FILTERS = [
  { key: 'available', label: 'Available', color: 'emerald' },
  { key: 'on_trip', label: 'On Trip', color: 'blue' },
  { key: 'inactive', label: 'Inactive', color: 'gray' },
  { key: 'assigned', label: 'Has Vehicle', color: 'amber' },
  { key: 'unassigned', label: 'No Vehicle', color: 'slate' },
  { key: 'today_active', label: "Today's Active", color: 'violet' },
  { key: 'newest', label: 'Newest', color: 'sky' },
];

function AdminDrivers() {
  const navigate = useNavigate();
  const [openMenuId, setOpenMenuId] = useState(null);

  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeQuickFilter, setActiveQuickFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('');
  const [tripsFilter, setTripsFilter] = useState('');
  const [recentlyActiveFilter, setRecentlyActiveFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showVehicleAssignModal, setShowVehicleAssignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
const [selectedDriver, setSelectedDriver] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [transactionType, setTransactionType] = useState('advance');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [toast, setToast] = useState(null);
const searchInputRef = useRef(null);
  const deletingRef = useRef(false);

  // Debounce search input
  const debouncedSearchValue = useDebounce(search, 300);

  // When debounced search changes, update the actual search param
  useEffect(() => {
    setDebouncedSearch(debouncedSearchValue);
  }, [debouncedSearchValue]);

  // Close action menu on outside click or ESC key
  useEffect(() => {
    const handleClick = (e) => {
      if (!openMenuId) return;
      // Check if the click target is inside any open action menu dropdown
      const dropdown = document.querySelector('[data-action-menu="true"]');
      if (dropdown && !dropdown.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && openMenuId) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (debouncedSearch) count++;
    if (statusFilter) count++;
    if (availabilityFilter) count++;
    if (balanceFilter) count++;
    if (tripsFilter) count++;
    if (recentlyActiveFilter) count++;
    if (activeQuickFilter) count++;
    return count;
  }, [debouncedSearch, statusFilter, availabilityFilter, balanceFilter, tripsFilter, recentlyActiveFilter, activeQuickFilter]);

  // Fetch drivers
  const fetchDrivers = useCallback(async (page = 1) => {
    setLoading(true);
    setSearchLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        search: debouncedSearch || undefined,
        status: statusFilter || (activeQuickFilter === 'available' ? 'available' : activeQuickFilter === 'on_trip' ? 'on_trip' : activeQuickFilter === 'inactive' ? 'inactive' : statusFilter || undefined),
        availability: availabilityFilter || undefined,
        balance_filter: balanceFilter || undefined,
        trips_filter: tripsFilter || undefined,
        recently_active: recentlyActiveFilter || undefined,
        quick_filter: activeQuickFilter || undefined,
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
      setSearchLoading(false);
    }
  }, [debouncedSearch, statusFilter, availabilityFilter, balanceFilter, tripsFilter, recentlyActiveFilter, activeQuickFilter, sortField, sortDirection]);

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

  // Toast helper
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Bulk delete: ONE request for all selected drivers, guarded against
  // duplicate clicks (ref guard + disabled state). Prevents the old
  // N-request loop that caused duplicates and HTTP 429.
  const handleBulkDelete = useCallback(async () => {
    if (deletingRef.current) return;          // ignore duplicate clicks
    if (!selectedIds.length) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await adminAPI.bulkDeleteDrivers(selectedIds);
      setSelectedIds([]);
      showToast(`✓ ${selectedIds.length} driver${selectedIds.length !== 1 ? 's' : ''} deleted.`, 'success');
      fetchDrivers(pagination.page);
      fetchStats();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to delete drivers.';
      setDeleteError(msg);
      showToast('✗ ' + msg, 'error');
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [selectedIds, fetchDrivers, fetchStats, pagination.page, showToast]);

// Single delete: guarded, with loading + error handling.
  // The backend only returns success AFTER the database confirms the row is
  // gone. We show "deleted" ONLY on a resolved success. Rejections surface the
  // structured error.code / error.message from the API.
  const handleSingleDelete = useCallback(async () => {
    if (deletingRef.current || !showDeleteConfirm) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await adminAPI.deleteDriver(showDeleteConfirm);
      const data = response.data || {};
      setShowDeleteConfirm(null);
      if (data.archived) {
        // Driver was archived (financial history retained), not hard-deleted.
        showToast('⚠️ Driver archived (financial records retained).', 'error');
      } else {
        showToast('✓ Driver deleted.', 'success');
      }
      fetchDrivers(pagination.page);
      fetchStats();
    } catch (err) {
      const data = err?.response?.data;
      const structured = data?.error;
      const msg = structured?.message || data?.message || err?.message || 'Failed to delete driver.';
      setDeleteError(msg);
      showToast('✗ ' + msg, 'error');
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [showDeleteConfirm, fetchDrivers, fetchStats, pagination.page, showToast]);

  // Initial load — only runs once on mount
  useEffect(() => {
    fetchDrivers(1);
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when search or filters change
  useEffect(() => {
    fetchDrivers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, activeQuickFilter, sortField, sortDirection]);

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

  // Handle quick filter click
  const handleQuickFilter = useCallback((key) => {
    setActiveQuickFilter(prev => prev === key ? null : key);
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Reset filters
  const resetFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('');
    setAvailabilityFilter('');
    setBalanceFilter('');
    setTripsFilter('');
    setRecentlyActiveFilter('');
    setActiveQuickFilter(null);
    setPagination(prev => ({ ...prev, page: 1 }));
    searchInputRef.current?.focus();
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
    ];
  }, [stats]);

  // Table columns
  const columns = useMemo(() => [
    {
      key: 'driver',
      header: 'Driver',
      render: (r) => {
        const initials = getInitials(r.driver_name);
        return (
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/admin/drivers/${r.driver_id}`)}>
            {/* Avatar with initials */}
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-sm">
              {initials}
            </div>
            {/* Driver info - hierarchical: name > code > phone */}
            <div className="min-w-0">
              <div className="text-base font-bold text-text truncate max-w-[200px] leading-tight group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                <HighlightText text={r.driver_name || 'Unknown'} highlight={debouncedSearch} />
              </div>
              <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                <HighlightText text={r.driver_code || `DRV${String(r.driver_id).padStart(6, '0')}`} highlight={debouncedSearch} />
              </div>
              <div className="text-[11px] text-muted mt-0.5 flex items-center gap-1">
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <HighlightText text={r.mobile || '—'} highlight={debouncedSearch} />
              </div>
            </div>
          </div>
        );
      }
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <DriverStatusBadge status={r.status} size="sm" showIcon={true} />
    },
{
      key: 'vehicle_type',
      header: 'Vehicle Type',
      render: (r) => (
        <div className="text-sm">
          <div className="font-medium">{r.vehicle_type || '—'}</div>
        </div>
      )
    },
    {
      key: 'vehicle_number',
      header: 'Vehicle Number',
      render: (r) => {
        const raw = r.vehicle_number || r.transportVehicles?.[0]?.vehicle_number || '';
        return (
          <div className="text-sm">
            {raw ? (
              <div className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                <HighlightText text={raw} highlight={debouncedSearch} />
              </div>
            ) : (
              <span className="text-muted text-xs">—</span>
            )}
          </div>
        );
      }
    },
    {
      key: 'assigned_vehicle',
      header: 'Assigned Vehicle',
      render: (r) => {
        const vehicle = r.transportVehicles?.[0];
        return (
          <div className="text-sm">
            {vehicle ? (
              <div>
                <div className="font-medium font-mono">{vehicle.vehicle_number}</div>
                <div className="text-[10px] text-muted">{vehicle.vehicle_name || vehicle.vehicle_type || ''}</div>
              </div>
            ) : (
              <span className="text-muted text-xs">Not assigned</span>
            )}
          </div>
        );
      }
    },
    {
      key: 'total_deliveries',
      header: "Today's Trips",
      sortable: true,
      render: (r) => (
        <div className="text-center">
          <div className="text-sm font-semibold text-text">{r.total_deliveries || 0}</div>
          <div className="text-[10px] text-muted">trips</div>
        </div>
      )
    },
    {
      key: 'last_activity',
      header: 'Last Active',
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">
          {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
        </span>
      )
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === r.driver_id ? null : r.driver_id); }}
            className="p-2 rounded-lg hover:bg-hover/60 transition text-muted hover:text-text"
            aria-label="Actions"
            title="Actions"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>

          {openMenuId === r.driver_id && (
            <div data-action-menu="true" className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border border-border/60 bg-white dark:bg-gray-900 shadow-xl backdrop-blur-xl overflow-hidden py-1 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="px-3 py-1.5 border-b border-border/40 mb-1">
                <div className="text-xs font-semibold text-text truncate">{r.driver_name}</div>
                <div className="text-[10px] text-muted">{r.driver_code}</div>
              </div>

              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                label="View Profile"
                onClick={() => navigate(`/admin/drivers/${r.driver_id}`)}
              />
              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
                label="Edit Driver"
                onClick={() => { setSelectedDriver(r); setShowEditModal(true); setOpenMenuId(null); }}
              />

              <div className="border-t border-border/40 my-1" />

              <div className="px-3 py-1 text-[10px] font-semibold text-muted uppercase tracking-wider">Quick Actions</div>
              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                label="Add Advance"
                onClick={() => { setSelectedDriver(r); setTransactionType('advance'); setShowTransactionModal(true); setOpenMenuId(null); }}
              />
              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>}
                label="Record Payment"
                onClick={() => { setSelectedDriver(r); setTransactionType('trip_payment'); setShowTransactionModal(true); setOpenMenuId(null); }}
              />
              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>}
                label="Assign Vehicle"
                onClick={() => { setSelectedDriver(r); setShowVehicleAssignModal(true); setOpenMenuId(null); }}
              />

              <div className="border-t border-border/40 my-1" />
              <div className="px-3 py-1 text-[10px] font-semibold text-muted uppercase tracking-wider">Contact</div>
              {r.mobile && (
                <>
                  <ActionMenuItem
                    icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
                    label="Call Driver"
                    href={`tel:${r.mobile}`}
                  />
                  <ActionMenuItem
                    icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>}
                    label="WhatsApp Chat"
                    href={`https://wa.me/91${r.mobile}`}
                  />
                </>
              )}

              <div className="border-t border-border/40 my-1" />
              <ActionMenuItem
                icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                label="Delete Driver"
                color="text-red-500"
                onClick={() => { setShowDeleteConfirm(r.driver_id); setOpenMenuId(null); }}
              />
            </div>
          )}
        </div>
      )
    }
  ], [navigate, setSelectedDriver, setShowTransactionModal, setShowVehicleAssignModal, setShowEditModal, openMenuId, debouncedSearch]);

  // Mobile card view
  const renderMobileCard = useCallback((driver) => {
    const vehicle = driver.transportVehicles?.[0];
    return (
      <div
        key={driver.driver_id}
        className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 space-y-3 cursor-pointer hover:bg-hover/30 transition"
        onClick={() => navigate(`/admin/drivers/${driver.driver_id}`)}
      >
        <div className="flex items-center justify-between">
<div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
              {getInitials(driver.driver_name)}
            </div>
            <div>
              <div className="text-sm font-semibold"><HighlightText text={driver.driver_name} highlight={debouncedSearch} /></div>
              <div className="text-[10px] font-mono text-muted"><HighlightText text={driver.driver_code} highlight={debouncedSearch} /></div>
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
            <span className="text-muted text-xs">City</span>
            <div className="font-medium">{driver.city || '—'}</div>
          </div>
          <div>
            <span className="text-muted text-xs">Vehicle Type</span>
            <div className="font-medium">{driver.vehicle_type || '—'}</div>
          </div>
          <div>
            <span className="text-muted text-xs">Vehicle No.</span>
            <div className="font-medium font-mono">{driver.vehicle_number || vehicle?.vehicle_number || '—'}</div>
          </div>
        </div>
      </div>
    );
  }, [navigate, debouncedSearch]);

  return (
<AdminShell navItems={NAV_ITEMS} activeKey="drivers" onNav={(k) => {}}>
      <div className="space-y-5">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {kpis.map(k => (
              <KpiCard key={k.key} title={k.title} value={k.value} sub={k.sub} accent={k.accent} loading={false} />
            ))}
          </div>
        )}

        {/* Search + Quick Filters */}
        <div className="space-y-3">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px] max-w-full lg:max-w-md">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
placeholder="Search by name, driver code, mobile, vehicle number, city..."
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
              aria-label="Search drivers"
            />
            {searchLoading && (
              <div className="absolute inset-y-0 right-3 flex items-center">
                <svg className="animate-spin h-4 w-4 text-muted" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
            {search && !searchLoading && (
              <button
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-3 flex items-center text-muted hover:text-text transition"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Quick Filter Buttons */}
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map((qf) => {
              const isActive = activeQuickFilter === qf.key;
              const colorMap = {
                emerald: isActive ? 'bg-emerald-500 text-white border-emerald-500' : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10',
                blue: isActive ? 'bg-blue-500 text-white border-blue-500' : 'border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10',
                gray: isActive ? 'bg-gray-500 text-white border-gray-500' : 'border-gray-500/30 text-gray-600 dark:text-gray-400 hover:bg-gray-500/10',
                amber: isActive ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
                slate: isActive ? 'bg-slate-500 text-white border-slate-500' : 'border-slate-500/30 text-slate-600 dark:text-slate-400 hover:bg-slate-500/10',
                violet: isActive ? 'bg-violet-500 text-white border-violet-500' : 'border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10',
                sky: isActive ? 'bg-sky-500 text-white border-sky-500' : 'border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10',
              };
              return (
                <button
                  key={qf.key}
                  onClick={() => handleQuickFilter(qf.key)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${colorMap[qf.color]}`}
                  aria-pressed={isActive}
                >
                  {qf.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <DriverFilters
          search={search}
          onSearchChange={setSearch}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          availability={availabilityFilter}
          onAvailabilityChange={setAvailabilityFilter}
          balanceFilter={balanceFilter}
          onBalanceFilterChange={setBalanceFilter}
          tripsFilter={tripsFilter}
          onTripsFilterChange={setTripsFilter}
          recentlyActive={recentlyActiveFilter}
          onRecentlyActiveChange={setRecentlyActiveFilter}
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
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-10 text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-500/20 dark:to-orange-500/20 flex items-center justify-center mx-auto mb-5">
              {debouncedSearch ? (
                <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </div>
            {debouncedSearch ? (
              <>
                <h3 className="text-lg font-bold text-text mb-2">No driver found matching "<span className="text-amber-600 dark:text-amber-400">{debouncedSearch}</span>"</h3>
                <p className="text-sm text-muted max-w-md mx-auto mb-4">Try searching by:</p>
<ul className="text-sm text-muted mx-auto max-w-xs text-left space-y-1.5 mb-6">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    Driver Name
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    Driver Code
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    Mobile Number
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    Vehicle Number
                  </li>
                </ul>
                <button
                  onClick={() => setSearch('')}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-lg shadow-amber-500/20"
                >
                  Clear Search
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-text mb-2">Your driver network is empty</h3>
                <p className="text-sm text-muted max-w-md mx-auto mb-6">
                  {activeFilterCount > 0
                    ? "No drivers match your search criteria. Try adjusting your filters."
                    : "Register your first driver to start building your transport network. You'll be able to assign them to bookings and track their trips."}
                </p>
                {activeFilterCount === 0 && (
                  <button
                    onClick={() => setShowRegisterModal(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-lg shadow-amber-500/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Register First Driver
                  </button>
                )}
              </>
            )}
          </div>
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
              selectedIds={new Set(selectedIds)}
              onSelect={(id) => {
                setSelectedIds(prev =>
                  prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
                );
              }}
              onSelectAll={() => {
                if (selectedIds.length === drivers.length) {
                  setSelectedIds([]);
                } else {
                  setSelectedIds(drivers.map(d => d.driver_id));
                }
              }}
              isAllSelected={selectedIds.length === drivers.length && drivers.length > 0}
              isIndeterminate={selectedIds.length > 0 && selectedIds.length < drivers.length}
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

        {/* Bulk Actions Toolbar */}
        {selectedIds.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-xl p-3 flex items-center justify-between animate-fade-in">
            <div className="text-sm font-medium">
              <span className="text-amber-600 dark:text-amber-400">{selectedIds.length}</span> driver{selectedIds.length !== 1 ? 's' : ''} selected
            </div>
            <div className="flex items-center gap-2">
<button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {deleting && (
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {deleting ? 'Deleting...' : 'Delete Selected'}
              </button>
              <button
                onClick={() => {
                  const status = prompt('Set status to: (available, inactive, on_trip)');
                  if (status && ['available', 'inactive', 'on_trip'].includes(status)) {
                    selectedIds.forEach(async (id) => {
                      try { await adminAPI.toggleDriverStatus(id, status); } catch (e) { console.error(e); }
                    });
                    setSelectedIds([]);
                    fetchDrivers(pagination.page);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition"
              >
                Change Status
              </button>
              <button
                onClick={() => {
                  const csvContent = [
                    ['Driver ID', 'Name', 'Mobile', 'Status', 'City', 'Vehicle', 'Deliveries'].join(','),
                    ...selectedIds.map(id => {
                      const d = drivers.find(d => d.driver_id === id);
                      const v = d?.transportVehicles?.[0]?.vehicle_number || '';
                      return d ? [d.driver_code, d.driver_name, d.mobile, d.status, d.city || '', v, d.total_deliveries].map(c => `"${c || ''}"`).join(',') : '';
                    }).filter(Boolean)
                  ].join('\n');
                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'drivers_export.csv'; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition"
              >
                Export
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-text transition"
              >
                Clear
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

        {/* Edit Driver Modal */}
        {selectedDriver && (
          <DriverRegisterModal
            isOpen={showEditModal}
            onClose={() => { setShowEditModal(false); setSelectedDriver(null); }}
            onSuccess={() => { fetchDrivers(pagination.page); fetchStats(); }}
            driver={selectedDriver}
            mode="edit"
          />
        )}

        {/* Transaction Modal */}
        {selectedDriver && (
          <DriverTransactionModal
            isOpen={showTransactionModal}
            onClose={() => { setShowTransactionModal(false); setSelectedDriver(null); }}
            onSuccess={() => { fetchDrivers(pagination.page); fetchStats(); }}
            driver={selectedDriver}
          />
        )}

        {/* Vehicle Assign Modal */}
        {selectedDriver && (
          <DriverVehicleAssignModal
            isOpen={showVehicleAssignModal}
            onClose={() => { setShowVehicleAssignModal(false); setSelectedDriver(null); }}
            onSuccess={() => { fetchDrivers(pagination.page); fetchStats(); }}
            driver={selectedDriver}
          />
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(null)} />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true" aria-label="Delete Driver">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
<h3 className="text-lg font-bold mb-2">Delete Driver?</h3>
                <p className="text-sm text-muted mb-6">
                  This permanently removes the driver. It is only allowed when the driver has
                  no active bookings, reservations, assignments or protected financial records.
                  If such records exist, deletion will be rejected and the driver will be archived instead.
                </p>
{deleteError && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                    {deleteError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSingleDelete}
                    disabled={deleting}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    {deleting && (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {deleting ? 'Deleting...' : 'Delete Driver'}
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

export default AdminDrivers;

