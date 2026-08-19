import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import VehicleRegisterModal from '../components/admin-premium/vehicles/VehicleRegisterModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: '👤' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const ITEMS_PER_PAGE = 20;

function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function getInitials(name) {
  if (!name) return 'VH';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

const VEHICLE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'truck', label: 'Truck' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'container', label: 'Container' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'available', label: 'Available' },
  { value: 'on_trip', label: 'On Trip' },
  { value: 'assigned', label: 'On Trip (legacy)' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inactive', label: 'Inactive' },
];

const DOCUMENT_STATUS_OPTIONS = [
  { value: '', label: 'All Documents' },
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring Soon' },
  { value: 'expired', label: 'Expired' },
];

export default function AdminVehicles() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [docFilter, setDocFilter] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [owners, setOwners] = useState([]);
  const [drivers, setDrivers] = useState([]);

  const debouncedSearchValue = useDebounce(search, 300);

  useEffect(() => {
    setDebouncedSearch(debouncedSearchValue);
  }, [debouncedSearchValue]);

  const fetchFilters = useCallback(async () => {
    try {
      const [ownersRes, driversRes] = await Promise.all([
        adminAPI.getVehicleOwners({ limit: 100, status: 'active' }),
        adminAPI.getDrivers({ limit: 100 }),
      ]);
      if (ownersRes.data?.success) setOwners(ownersRes.data.data || []);
      if (driversRes.data?.success) setDrivers(driversRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch filters:', err);
    }
  }, []);

  const fetchVehicles = useCallback(async (page = 1) => {
    setLoading(true);
    setSearchLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        type: typeFilter || undefined,
      };

      const response = await adminAPI.getVehicles(params);
      if (response.data?.success) {
        let data = response.data.data || [];
        
        // Apply search filter on frontend
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          data = data.filter(v => 
            (v.vehicle_number && v.vehicle_number.toLowerCase().includes(q)) ||
            (v.vehicle_type && v.vehicle_type.toLowerCase().includes(q)) ||
            (v.vehicle_name && v.vehicle_name.toLowerCase().includes(q)) ||
            (v.owner_name && v.owner_name.toLowerCase().includes(q))
          );
        }

        // Apply owner filter
        if (ownerFilter) {
          data = data.filter(v => String(v.owner_id) === String(ownerFilter));
        }

        // Apply driver filter
        if (driverFilter) {
          data = data.filter(v => String(v.driver_id) === String(driverFilter));
        }

        // Apply status filter (backward-compat: treat 'assigned' as 'on_trip')
        if (statusFilter) {
          data = data.filter(v => {
            const status = v.current_status || (v.is_available ? 'available' : 'inactive');
            return status === statusFilter || (statusFilter === 'on_trip' && status === 'assigned');
          });
        }

        // Apply document status filter
        if (docFilter) {
          const today = new Date();
          data = data.filter(v => {
            if (docFilter === 'valid') {
              return (v.insurance_expiry && new Date(v.insurance_expiry) > today) &&
                     (v.permit_expiry && new Date(v.permit_expiry) > today);
            } else if (docFilter === 'expired') {
              return (v.insurance_expiry && new Date(v.insurance_expiry) <= today) ||
                     (v.permit_expiry && new Date(v.permit_expiry) <= today);
            } else if (docFilter === 'expiring') {
              const thirtyDays = new Date();
              thirtyDays.setDate(today.getDate() + 30);
              return (v.insurance_expiry && new Date(v.insurance_expiry) <= thirtyDays && new Date(v.insurance_expiry) > today) ||
                     (v.permit_expiry && new Date(v.permit_expiry) <= thirtyDays && new Date(v.permit_expiry) > today);
            }
            return true;
          });
        }

        setVehicles(data);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Failed to fetch vehicles');
      }
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setError(err.message || 'Failed to load vehicles');
      setVehicles([]);
    } finally {
      setLoading(false);
      setSearchLoading(false);
    }
  }, [debouncedSearch, statusFilter, typeFilter, ownerFilter, driverFilter, docFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await adminAPI.getVehicleStats();
      if (response.data?.success) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching vehicle stats:', err);
    }
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Initial load
  useEffect(() => {
    fetchVehicles(1);
    fetchStats();
    fetchFilters();
  }, []);

  // Re-fetch when search or filters change
  useEffect(() => {
    fetchVehicles(1);
  }, [fetchVehicles]);

  const handlePageChange = useCallback((newPage) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    setPagination(prev => ({ ...prev, page: newPage }));
    fetchVehicles(newPage);
  }, [pagination.pages, fetchVehicles]);

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setOwnerFilter('');
    setDriverFilter('');
    setDocFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleRegisterSuccess = useCallback(() => {
    fetchVehicles(1);
    fetchStats();
    showToast('Vehicle added successfully');
  }, [fetchVehicles, fetchStats, showToast]);

  const getDocumentStatus = (v) => {
    const today = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(today.getDate() + 30);
    
    const insuranceExpired = v.insurance_expiry && new Date(v.insurance_expiry) <= today;
    const permitExpired = v.permit_expiry && new Date(v.permit_expiry) <= today;
    const insuranceExpiring = v.insurance_expiry && new Date(v.insurance_expiry) <= thirtyDays && new Date(v.insurance_expiry) > today;
    const permitExpiring = v.permit_expiry && new Date(v.permit_expiry) <= thirtyDays && new Date(v.permit_expiry) > today;
    
    if (insuranceExpired || permitExpired) return { label: 'Expired', color: 'red' };
    if (insuranceExpiring || permitExpiring) return { label: 'Expiring', color: 'amber' };
    return { label: 'Valid', color: 'green' };
  };

  const columns = useMemo(() => [
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (v) => (
        <button
          onClick={() => navigate(`/admin/vehicles/${v.vehicle_id}`)}
          className="text-left hover:opacity-80 transition-opacity"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text truncate max-w-[200px]">
                {v.vehicle_name || v.vehicle_number}
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                {v.vehicle_number}
              </div>
            </div>
          </div>
        </button>
      )
    },
    {
      key: 'type',
      header: 'Type',
      render: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {v.vehicle_type?.replace(/_/g, ' ') || '—'}
        </span>
      )
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (v) => {
        const owner = owners.find(o => String(o.owner_id) === String(v.owner_id));
        return (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {owner?.owner_name || v.owner_name || '—'}
          </span>
        );
      }
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (v) => {
        if (v.driver_id) {
          const driver = drivers.find(d => String(d.driver_id) === String(v.driver_id));
          return (
            <button
              onClick={() => navigate(`/admin/drivers/${v.driver_id}`)}
              className="text-left text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              {driver?.driver_name || v.driver_name || `Driver #${v.driver_id}`}
            </button>
          );
        }
        return (
          <span className="text-sm text-slate-400">Unassigned</span>
        );
      }
    },
    {
      key: 'capacity',
      header: 'Capacity',
      render: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {v.capacity_kg ? `${v.capacity_kg.toLocaleString()} kg` : '—'}
        </span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (v) => {
        const rawStatus = v.current_status || (v.is_available ? 'available' : 'inactive');
        // Normalize legacy 'assigned' → 'on_trip' for display
        const status = rawStatus === 'assigned' ? 'on_trip' : rawStatus;
        const styles = {
          available: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
          on_trip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
          maintenance: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
          inactive: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400 border-slate-200 dark:border-slate-500/20',
        };
        const label = status === 'on_trip' ? 'On Trip' : status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown';
        return (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${styles[status] || styles.inactive}`}>
            {label}
          </span>
        );
      }
    },
    {
      key: 'documents',
      header: 'Documents',
      render: (v) => {
        const doc = getDocumentStatus(v);
        const styles = {
          green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
          amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
          red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
        };
        return (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${styles[doc.color]}`}>
            {doc.label}
          </span>
        );
      }
    },
    {
      key: 'last_active',
      header: 'Last Active',
      render: (v) => (
        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {v.updated_at ? new Date(v.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        </span>
      )
    },
    {
      key: 'actions',
      header: '',
      render: (v) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate(`/admin/vehicles/${v.vehicle_id}`)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
            title="View details"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        </div>
      )
    }
  ], [navigate, owners, drivers]);

  const hasActiveFilters = statusFilter || typeFilter || ownerFilter || driverFilter || docFilter || search;

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicles">
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
            <h1 className="text-[22px] font-bold tracking-tight text-text">Vehicles</h1>
            <p className="text-sm text-muted mt-1">
              Manage your fleet, availability, assignments and vehicle documents
            </p>
          </div>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            + Add Vehicle
          </button>
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard title="Total Vehicles" value={stats.total ?? 0} sub="Registered" accent="blue" />
            <KpiCard title="Available" value={stats.available ?? 0} sub="Ready for dispatch" accent="emerald" />
            <KpiCard title="On Trip" value={stats.onTrip ?? 0} sub="With driver" accent="sky" />
            <KpiCard title="Maintenance" value={stats.maintenance ?? 0} sub="In service" accent="amber" />
            <KpiCard title="Inactive" value={stats.inactive ?? 0} sub="Not available" accent="slate" />
          </div>
        )}

        {/* Search + Filters */}
        <div className="space-y-3">
          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vehicle number, name, owner, driver..."
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
                aria-label="Search vehicles"
              />
              {searchLoading && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <svg className="animate-spin h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
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
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
            >
              {VEHICLE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
            >
              <option value="">All Owners</option>
              {owners.map(owner => (
                <option key={owner.owner_id} value={owner.owner_id}>{owner.owner_name}</option>
              ))}
            </select>

            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
            >
              <option value="">All Drivers</option>
              {drivers.map(driver => (
                <option key={driver.driver_id} value={driver.driver_id}>{driver.driver_name}</option>
              ))}
            </select>

            <select
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
            >
              {DOCUMENT_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="px-3 py-2 rounded-xl border border-border/60 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 hover:border-red-300 transition-all"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Unable to load vehicles</div>
            <div className="text-sm text-muted mb-4">{error}</div>
            <button
              onClick={() => fetchVehicles(1)}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            <LoadingSkeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && vehicles.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
            </div>
            {debouncedSearch || hasActiveFilters ? (
              <>
                <h3 className="text-base font-semibold text-text mb-1">No vehicles found</h3>
                <p className="text-sm text-muted max-w-md mx-auto mb-4">Try adjusting your search or filters.</p>
                <button
                  onClick={handleClearFilters}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
                >
                  Clear Filters
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-text mb-1">No vehicles in your fleet</h3>
                <p className="text-sm text-muted max-w-md mx-auto mb-6">
                  Add your first vehicle to start managing your transport fleet.
                </p>
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-lg shadow-amber-500/20"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  + Add Vehicle
                </button>
              </>
            )}
          </div>
        )}

        {/* Table */}
        {!loading && !error && vehicles.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden">
            <PremiumTable
              columns={columns}
              rows={vehicles.map(v => ({ ...v, id: v.vehicle_id }))}
              loading={false}
            />
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
              <span className="text-sm text-muted">
                Page {pagination.page} of {pagination.pages}
              </span>
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

        {/* Register Modal */}
        <VehicleRegisterModal
          isOpen={showRegisterModal}
          onClose={() => setShowRegisterModal(false)}
          onSuccess={handleRegisterSuccess}
        />
      </div>
    </AdminShell>
  );
}
