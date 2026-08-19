import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

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
  if (!name) return 'VO';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function OwnerStatusBadge({ status }) {
  const colors = {
    active: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
    suspended: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colors[status] || colors.inactive}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
    </span>
  );
}

function ActionsDropdown({ owner, onViewProfile, onEdit, onDeactivate, onDelete }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 rounded-lg hover:bg-hover/60 transition"
      >
        <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-2xl border border-border/60 bg-card shadow-xl backdrop-blur-xl py-1.5">
            <button onClick={() => { setOpen(false); onViewProfile(owner); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-hover/60 transition">
              <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              View Profile
            </button>
            <button onClick={() => { setOpen(false); onEdit(owner); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-hover/60 transition">
              <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
            <div className="border-t border-border/40 my-1" />
            <button onClick={() => { setOpen(false); onDeactivate(owner); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
              {owner.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
            <button onClick={() => { setOpen(false); onDelete(owner); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-500/10 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete Owner
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminVehicleOwners() {
  const navigate = useNavigate();
  const [owners, setOwners] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [editingOwner, setEditingOwner] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const debouncedSearch = useDebounce(search, 300);

  const fetchOwners = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: pagination.page,
        limit: ITEMS_PER_PAGE,
        search: debouncedSearch,
        status: statusFilter,
      };
      const res = await adminAPI.getVehicleOwners(params);
      if (res.data?.success) {
        setOwners(res.data.data);
        setPagination(prev => ({ ...prev, ...res.data.pagination }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch vehicle owners');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, debouncedSearch, statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await adminAPI.getVehicleOwnerStats();
      if (res.data?.success) {
        setStats(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchOwners();
  }, [fetchOwners]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleSearch = (value) => {
    setSearch(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleStatusFilter = (status) => {
    setStatusFilter(status);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleViewProfile = (owner) => {
    navigate(`/admin/vehicle-owners/${owner.owner_id}`);
  };

  const handleEdit = (owner) => {
    setEditingOwner(owner);
    setShowRegisterModal(true);
  };

  const handleDelete = async (owner) => {
    if (!window.confirm(`Are you sure you want to delete vehicle owner "${owner.owner_name}"?`)) return;
    try {
      await adminAPI.deleteVehicleOwner(owner.owner_id);
      setOwners(prev => prev.filter(o => o.owner_id !== owner.owner_id));
      setDeleteConfirm(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete vehicle owner');
    }
  };

  const handleDeactivate = async (owner) => {
    try {
      const newStatus = owner.status === 'active' ? 'inactive' : 'active';
      await adminAPI.toggleVehicleOwnerStatus(owner.owner_id, newStatus);
      setOwners(prev => prev.map(o => o.owner_id === owner.owner_id ? { ...o, status: newStatus } : o));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update status');
    }
  };

  const handleModalClose = () => {
    setShowRegisterModal(false);
    setEditingOwner(null);
  };

  const handleModalSuccess = () => {
    handleModalClose();
    fetchOwners();
    fetchStats();
  };

  const columns = [
    {
      key: 'owner_code',
      label: 'Code',
      render: (owner) => (
        <span className="font-mono text-xs text-muted">{owner.owner_code || 'N/A'}</span>
      ),
    },
    {
      key: 'owner_name',
      label: 'Owner Name',
      render: (owner) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-700 dark:text-amber-400">
            {getInitials(owner.owner_name)}
          </div>
          <div>
            <div className="font-medium text-text">{owner.owner_name}</div>
            {owner.company_name && <div className="text-xs text-muted">{owner.company_name}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'mobile',
      label: 'Mobile',
      render: (owner) => <span className="text-sm">{owner.mobile}</span>,
    },
    {
      key: 'city',
      label: 'City',
      render: (owner) => <span className="text-sm">{owner.city || '-'}</span>,
    },
    {
      key: 'vehicles',
      label: 'Vehicles',
      render: (owner) => (
        <span className="text-sm font-medium">{owner._count?.vehicles || 0}</span>
      ),
    },
    {
      key: 'drivers',
      label: 'Drivers',
      render: (owner) => (
        <span className="text-sm font-medium">{owner._count?.drivers || 0}</span>
      ),
    },
    {
      key: 'bookings',
      label: 'Bookings',
      render: (owner) => (
        <span className="text-sm font-medium">{owner._count?.bookings || 0}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (owner) => <OwnerStatusBadge status={owner.status} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (owner) => (
        <ActionsDropdown
          owner={owner}
          onViewProfile={handleViewProfile}
          onEdit={handleEdit}
          onDeactivate={handleDeactivate}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text">Vehicle Owners</h1>
            <p className="text-muted text-sm mt-1">Manage vehicle owners and their fleet</p>
          </div>
          <button
            onClick={() => { setEditingOwner(null); setShowRegisterModal(true); }}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition"
          >
            + Register Owner
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard title="Total Owners" value={stats.totalOwners} icon="👤" color="amber" />
            <KpiCard title="Active Owners" value={stats.activeOwners} icon="✅" color="green" />
            <KpiCard title="Total Vehicles" value={stats.totalVehicles} icon="🚛" color="blue" />
            <KpiCard title="Total Drivers" value={stats.totalDrivers} icon="⌁" color="sky" />
            <KpiCard title="Total Bookings" value={stats.totalBookings} icon="📦" color="purple" />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name, code, mobile, city..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="px-4 py-2 rounded-xl border border-border bg-surface text-text focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {/* Table */}
        <PremiumTable
          columns={columns}
          data={owners}
          loading={loading}
          emptyMessage="No vehicle owners found"
          onRowClick={(owner) => handleViewProfile(owner)}
        />

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted">
              Showing {((pagination.page - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(pagination.page * ITEMS_PER_PAGE, pagination.total)} of {pagination.total} owners
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 rounded-lg border border-border bg-surface text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-hover transition"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
                className="px-3 py-1 rounded-lg border border-border bg-surface text-text disabled:opacity-50 disabled:cursor-not-allowed hover:bg-hover transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Register/Edit Modal */}
        {showRegisterModal && (
          <OwnerRegisterModal
            owner={editingOwner}
            onClose={handleModalClose}
            onSuccess={handleModalSuccess}
          />
        )}
      </div>
    </AdminShell>
  );
}
