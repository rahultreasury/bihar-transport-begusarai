import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import OwnerRegisterModal from '../components/admin-premium/owners/OwnerRegisterModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'reports', label: 'Reports', icon: '📊' },
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
  if (!name) return 'OW';
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

export default function AdminPartners() {
  const navigate = useNavigate();
  const [partners, setPartners] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingOwner, setDeletingOwner] = useState(false);
  const [deleteOwnerError, setDeleteOwnerError] = useState(null);
  const [toast, setToast] = useState(null);
  const debouncedSearch = useDebounce(search, 300);

  // Applications tab state
  const [activeTab, setActiveTab] = useState('owners');
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState(null);
  const [applicationsPagination, setApplicationsPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [appStatusFilter, setAppStatusFilter] = useState('pending');
  const [appTypeFilter, setAppTypeFilter] = useState('all');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewAction, setReviewAction] = useState(null); // 'approve' | 'reject'
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchPartners = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        sort_by: sortField,
        sort_order: sortDirection,
      };
      const response = await adminAPI.getPartners(params);
      if (response.data?.success) {
        setPartners(response.data.data || []);
        if (response.data.pagination) setPagination(response.data.pagination);
      }
    } catch (err) {
      setError(err.message || 'Failed to load owners');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, sortField, sortDirection]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await adminAPI.getOwnerStats();
      if (response.data?.success) setStats(response.data.data);
    } catch (err) { console.error('Error fetching owner stats:', err); }
  }, []);

  useEffect(() => { fetchPartners(1); fetchStats(); }, []);
  useEffect(() => { fetchPartners(1); }, [debouncedSearch, statusFilter, sortField, sortDirection]);

  // Applications fetch
  const fetchApplications = useCallback(async (page = 1) => {
    setApplicationsLoading(true);
    setApplicationsError(null);
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        status: appStatusFilter !== 'all' ? appStatusFilter : undefined,
        partnership_type: appTypeFilter !== 'all' ? appTypeFilter : undefined,
      };
      const response = await adminAPI.getPartnerApplications(params);
      if (response.data?.success) {
        setApplications(response.data.data || []);
        if (response.data.pagination) setApplicationsPagination(response.data.pagination);
      }
    } catch (err) {
      setApplicationsError(err.message || 'Failed to load applications');
    } finally {
      setApplicationsLoading(false);
    }
  }, [appStatusFilter, appTypeFilter]);

  useEffect(() => {
    if (activeTab === 'applications') {
      fetchApplications(1);
    }
  }, [activeTab, appStatusFilter, appTypeFilter, fetchApplications]);

  const handleApprove = useCallback(async () => {
    if (!reviewTarget || !reviewAction) return;
    setReviewing(true);
    try {
      const payload = reviewAction === 'approve'
        ? { admin_notes: reviewNotes }
        : { rejection_reason: reviewNotes };
      const apiCall = reviewAction === 'approve'
        ? adminAPI.approvePartnerApplication(reviewTarget.application_id, payload)
        : adminAPI.rejectPartnerApplication(reviewTarget.application_id, payload);
      const res = await apiCall;
      if (res.data?.success) {
        showToast(reviewAction === 'approve' ? 'Application approved' : 'Application rejected', 'success');
        setReviewTarget(null);
        setReviewAction(null);
        setReviewNotes('');
        fetchApplications(applicationsPagination.page);
      } else {
        showToast(res.data?.message || 'Action failed', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.message || 'Server error', 'error');
    } finally {
      setReviewing(false);
    }
  }, [reviewTarget, reviewAction, reviewNotes, applicationsPagination.page, fetchApplications, showToast]);

  const handleDeactivate = useCallback(async (owner) => {
    const newStatus = owner.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'active' ? 'activate' : 'deactivate'} ${owner.partner_name}?`)) return;
    try {
      await adminAPI.togglePartnerStatus(owner.partner_id, newStatus);
      fetchPartners(pagination.page);
      fetchStats();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update status');
    }
}, [fetchPartners, fetchStats, pagination.page]);

  // Delete an owner — only shows success after the backend confirms the DB row is gone.
  const handleDeleteOwner = useCallback(async () => {
    if (!deleteTarget || deletingOwner) return;
    setDeletingOwner(true);
    setDeleteOwnerError(null);
    try {
      const response = await adminAPI.deletePartner(deleteTarget.partner_id);
      const data = response.data || {};
      setDeleteTarget(null);
      showToast('✓ ' + (data.message || 'Transport Owner deleted'), 'success');
      fetchPartners(pagination.page);
      fetchStats();
    } catch (err) {
      const structured = err?.response?.data?.error;
      const msg = structured?.message || err?.response?.data?.message || err?.message || 'Failed to delete transport owner.';
      setDeleteOwnerError(msg);
      showToast('✗ ' + msg, 'error');
    } finally {
      setDeletingOwner(false);
    }
  }, [deleteTarget, deletingOwner, pagination.page, fetchPartners, fetchStats, showToast]);

  const handleRegisterSuccess = useCallback(() => {
    fetchPartners(1);
    fetchStats();
  }, [fetchPartners, fetchStats]);

  const kpis = useMemo(() => {
    if (!stats) return [];
    return [
      { key: 'total', title: 'Total Owners', value: stats.total ?? 0, sub: 'Registered owners', accent: 'amber', loading: false },
      { key: 'active', title: 'Active Owners', value: stats.active ?? 0, sub: 'Currently active', accent: 'green', loading: false },
      { key: 'inactive', title: 'Inactive Owners', value: stats.inactive ?? 0, sub: 'Currently inactive', accent: 'purple', loading: false },
      { key: 'totalOutstanding', title: 'Total Outstanding', value: `₹${(stats.totalOutstanding || 0).toLocaleString('en-IN')}`, sub: 'Across all owners', accent: 'sky', loading: false },
      { key: 'todayAssignedTrips', title: "Today's Assigned Trips", value: stats.todayAssignedTrips ?? 0, sub: 'Active trips today', accent: 'green', loading: false },
    ];
  }, [stats]);

  const columns = useMemo(() => [
    {
      key: 'owner',
      header: 'Owner Code',
      render: (r) => (
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/admin/owners/${r.partner_id}`)}>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {getInitials(r.partner_name)}
          </div>
          <div className="min-w-0">
            <div className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">{r.partner_code}</div>
            <div className="text-sm font-semibold truncate max-w-[180px]">{r.company_name || r.partner_name}</div>
          </div>
        </div>
      )
    },
    {
      key: 'owner_name',
      header: 'Owner Name',
      render: (r) => <span className="text-sm">{r.owner_name || '—'}</span>
    },
    {
      key: 'mobile',
      header: 'Mobile',
      render: (r) => <span className="text-sm font-mono">{r.mobile || '—'}</span>
    },
    {
      key: 'city',
      header: 'City',
      render: (r) => <span className="text-sm text-muted">{r.city || '—'}</span>
    },
    {
      key: 'vehicles',
      header: 'Vehicles',
      sortable: true,
      render: (r) => <div className="text-center font-semibold">{r._count?.trucks || 0}</div>
    },
    {
      key: 'commission_percentage',
      header: 'Commission %',
      render: (r) => <span className="text-sm font-semibold text-purple-500">{r.commission_percentage || 0}%</span>
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      render: (r) => <span className="text-sm font-semibold text-red-500">₹{(r.outstandingBalance || 0).toLocaleString('en-IN')}</span>
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <OwnerStatusBadge status={r.status} />
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
<ActionsDropdown
          owner={r}
          onViewProfile={(o) => navigate(`/admin/owners/${o.partner_id}`)}
          onEdit={(o) => navigate(`/admin/owners/${o.partner_id}?tab=edit`)}
          onDeactivate={handleDeactivate}
          onDelete={setDeleteTarget}
        />
      )
    },
  ], [navigate, handleDeactivate]);

  // Get outstanding balance for each owner from their dashboard data
  // Since we don't have per-owner balance in list, we show "--" for now (Phase 2 will add)
  const enhancedPartners = useMemo(() => {
    return (partners || []).map(p => ({
      ...p,
      outstandingBalance: 0, // Phase 2: populate from ledger
    }));
  }, [partners]);

  return (
<AdminShell navItems={NAV_ITEMS} activeKey="owners" onNav={(k) => {}}>
      <OwnerRegisterModal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        onSuccess={handleRegisterSuccess}
      />

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

      {/* Delete Owner Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true" aria-label="Delete Transport Owner">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-2">Delete Transport Owner?</h3>
              <div className="mb-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Owner:</span>
                  <span className="font-semibold">{deleteTarget.partner_name || deleteTarget.company_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Code:</span>
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{deleteTarget.partner_code}</span>
                </div>
              </div>
              <p className="text-sm text-muted mb-6">
                This action permanently removes the transport owner and its related non-protected records. If the owner has protected dependencies (drivers, vehicles, bookings, financial records), deletion will be rejected.
              </p>
              {deleteOwnerError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                  {deleteOwnerError}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deletingOwner}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteOwner}
                  disabled={deletingOwner}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {deletingOwner && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {deletingOwner ? 'Deleting...' : 'Delete Owner'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#1e3a5f]/5 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('owners')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'owners'
                ? 'bg-white text-[#0F2B55] shadow-sm'
                : 'text-[#1e3a5f]/60 hover:text-[#1e3a5f]'
            }`}
          >
            Transport Owners
          </button>
          <button
            onClick={() => setActiveTab('applications')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'applications'
                ? 'bg-white text-[#0F2B55] shadow-sm'
                : 'text-[#1e3a5f]/60 hover:text-[#1e3a5f]'
            }`}
          >
            Applications
          </button>
        </div>

        {activeTab === 'owners' && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Transport Owners</h1>
                <p className="text-sm text-muted mt-1">
                  {pagination.total > 0 ? `${pagination.total} owner${pagination.total !== 1 ? 's' : ''} registered` : 'Manage all transport owners'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate('/admin/settlements')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
                >
                  Settlements
                </button>
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Register Owner
                </button>
              </div>
            </div>

        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {kpis.map(k => (
              <KpiCard key={k.key} title={k.title} value={k.value} sub={k.sub} accent={k.accent} loading={false} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code, mobile, city..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Failed to load owners</div>
            <div className="text-sm text-muted mb-4">{error}</div>
            <button onClick={() => fetchPartners(1)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">Retry</button>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <LoadingSkeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => <LoadingSkeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {!loading && !error && enhancedPartners.length === 0 && (
          <EmptyState title="No transport owners found" subtitle="Register your first transport owner to get started." />
        )}

        {!loading && !error && enhancedPartners.length > 0 && (
          <PremiumTable columns={columns} rows={enhancedPartners.map(p => ({ ...p, id: p.partner_id }))} loading={false} />
        )}

        {!loading && !error && pagination.pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchPartners(pagination.page - 1)} disabled={pagination.page <= 1}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40">← Prev</button>
              <span className="text-sm text-muted">Page {pagination.page} of {pagination.pages}</span>
              <button onClick={() => fetchPartners(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </>
    )}
      </div>

      {/* Applications Tab Content */}
      {activeTab === 'applications' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Partner Applications</h1>
              <p className="text-sm text-muted mt-1">
                {applicationsPagination.total > 0 ? `${applicationsPagination.total} application${applicationsPagination.total !== 1 ? 's' : ''} found` : 'Review partner applications'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={appStatusFilter}
              onChange={(e) => setAppStatusFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              value={appTypeFilter}
              onChange={(e) => setAppTypeFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              <option value="all">All Types</option>
              <option value="vehicle_owner">Vehicle Owner</option>
              <option value="transport_owner">Transport Owner</option>
            </select>
          </div>

          {applicationsError && !applicationsLoading && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
              <div className="text-red-500 font-semibold mb-2">Failed to load applications</div>
              <div className="text-sm text-muted mb-4">{applicationsError}</div>
              <button onClick={() => fetchApplications(1)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">Retry</button>
            </div>
          )}

          {applicationsLoading && (
            <div className="space-y-4">
              <LoadingSkeleton className="h-12 w-full" />
              {Array.from({ length: 5 }).map((_, i) => <LoadingSkeleton key={i} className="h-16 w-full" />)}
            </div>
          )}

          {!applicationsLoading && !applicationsError && applications.length === 0 && (
            <EmptyState title="No applications found" subtitle="Applications will appear here when users submit them." />
          )}

          {!applicationsLoading && !applicationsError && applications.length > 0 && (
            <>
              <div className="bg-white rounded-2xl border border-[#1e3a5f]/8 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e3a5f]/10">
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">Application</th>
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">Applicant</th>
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">Type</th>
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">City</th>
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">Status</th>
                      <th className="text-left px-6 py-4 font-semibold text-[#1e3a5f]/70">Date</th>
                      <th className="text-right px-6 py-4 font-semibold text-[#1e3a5f]/70">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.application_id} className="border-b border-[#1e3a5f]/5 hover:bg-[#F4F7FB]/50 transition">
                        <td className="px-6 py-4">
                          <div className="font-mono text-xs font-bold text-amber-600">{app.application_code}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-[#0F2B55]">{app.first_name} {app.last_name}</div>
                          <div className="text-xs text-[#1e3a5f]/50">{app.email}</div>
                          <div className="text-xs text-[#1e3a5f]/50">{app.phone}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            app.partnership_type === 'vehicle_owner'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            {app.partnership_type === 'vehicle_owner' ? 'Vehicle Owner' : 'Transport Owner'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#1e3a5f]/70">{app.city}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            app.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                            app.status === 'approved' ? 'bg-green-100 text-green-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#1e3a5f]/50 text-xs">
                          {new Date(app.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {app.status === 'pending' && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => { setReviewTarget(app); setReviewAction('approve'); setReviewNotes(''); }}
                                className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-semibold hover:bg-green-600 transition"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => { setReviewTarget(app); setReviewAction('reject'); setReviewNotes(''); }}
                                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {app.status !== 'pending' && (
                            <span className="text-xs text-[#1e3a5f]/40">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {applicationsPagination.pages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-sm text-muted">
                    Showing {(applicationsPagination.page - 1) * applicationsPagination.limit + 1}–{Math.min(applicationsPagination.page * applicationsPagination.limit, applicationsPagination.total)} of {applicationsPagination.total}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => fetchApplications(applicationsPagination.page - 1)} disabled={applicationsPagination.page <= 1}
                      className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40">← Prev</button>
                    <span className="text-sm text-muted">Page {applicationsPagination.page} of {applicationsPagination.pages}</span>
                    <button onClick={() => fetchApplications(applicationsPagination.page + 1)} disabled={applicationsPagination.page >= applicationsPagination.pages}
                      className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40">Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setReviewTarget(null); setReviewAction(null); setReviewNotes(''); }} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 p-6" role="dialog" aria-modal="true">
            <div className="text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${
                reviewAction === 'approve' ? 'bg-green-500/10' : 'bg-red-500/10'
              }`}>
                <svg className={`w-7 h-7 ${reviewAction === 'approve' ? 'text-green-500' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {reviewAction === 'approve' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  )}
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-2">
                {reviewAction === 'approve' ? 'Approve Application' : 'Reject Application'}
              </h3>
              <div className="mb-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Applicant:</span>
                  <span className="font-semibold">{reviewTarget.first_name} {reviewTarget.last_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Code:</span>
                  <span className="font-mono font-semibold text-amber-600">{reviewTarget.application_code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Type:</span>
                  <span className="font-semibold">{reviewTarget.partnership_type === 'vehicle_owner' ? 'Vehicle Owner' : 'Transport Owner'}</span>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-[#1e3a5f] mb-1.5 text-left">
                  {reviewAction === 'approve' ? 'Admin Notes (optional)' : 'Rejection Reason *'}
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  required={reviewAction === 'reject'}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#1e3a5f]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A623]/30 focus:border-[#F5A623]"
                  placeholder={reviewAction === 'approve' ? 'Optional notes for the applicant...' : 'Please provide a reason for rejection...'}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setReviewTarget(null); setReviewAction(null); setReviewNotes(''); }}
                  disabled={reviewing}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  disabled={reviewing || (reviewAction === 'reject' && !reviewNotes.trim())}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${
                    reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {reviewing && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {reviewing ? 'Processing...' : (reviewAction === 'approve' ? 'Approve' : 'Reject')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
