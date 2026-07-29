import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  { key: 'partners', label: 'Transport Partners', icon: '⧉' },
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
  if (!name) return 'PT';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function PartnerStatusBadge({ status }) {
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
  const debouncedSearch = useDebounce(search, 300);

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
      setError(err.message || 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, sortField, sortDirection]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await adminAPI.getPartnerStats();
      if (response.data?.success) setStats(response.data.data);
    } catch (err) { console.error('Error fetching partner stats:', err); }
  }, []);

  useEffect(() => { fetchPartners(1); fetchStats(); }, []);
  useEffect(() => { fetchPartners(1); }, [debouncedSearch, statusFilter, sortField, sortDirection]);

  const kpis = useMemo(() => {
    if (!stats) return [];
    return [
      { key: 'total', title: 'Total Partners', value: stats.total ?? 0, sub: 'Registered partners', accent: 'amber', loading: false },
      { key: 'active', title: 'Active Partners', value: stats.active ?? 0, sub: 'Currently active', accent: 'green', loading: false },
      { key: 'totalOutstanding', title: 'Total Outstanding', value: `₹${(stats.totalOutstanding || 0).toLocaleString('en-IN')}`, sub: 'Across all partners', accent: 'sky', loading: false },
      { key: 'pendingSettlements', title: 'Pending Settlements', value: stats.pendingSettlements ?? 0, sub: 'Awaiting settlement', accent: 'purple', loading: false },
    ];
  }, [stats]);

  const columns = useMemo(() => [
    {
      key: 'partner',
      header: 'Partner',
      render: (r) => (
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/admin/partners/${r.partner_id}`)}>
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {getInitials(r.partner_name)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate max-w-[200px]">{r.partner_name}</div>
            <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{r.partner_code}</div>
            <div className="text-[11px] text-muted">{r.mobile}</div>
          </div>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <PartnerStatusBadge status={r.status} />
    },
    {
      key: 'city',
      header: 'City',
      render: (r) => <span className="text-sm text-muted">{r.city || '—'}</span>
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (r) => <span className="text-sm">{r.owner_name || '—'}</span>
    },
    {
      key: 'bookings',
      header: 'Bookings',
      sortable: true,
      render: (r) => <div className="text-center font-semibold">{r._count?.bookings || 0}</div>
    },
    {
      key: 'trucks',
      header: 'Trucks',
      render: (r) => <div className="text-center font-semibold">{r._count?.trucks || 0}</div>
    },
    {
      key: 'created_at',
      header: 'Added',
      render: (r) => (
        <span className="text-sm text-muted">
          {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
        </span>
      )
    },
  ], [navigate]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="partners" onNav={(k) => {}}>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Transport Partners</h1>
            <p className="text-sm text-muted mt-1">
              {pagination.total > 0 ? `${pagination.total} partner${pagination.total !== 1 ? 's' : ''} registered` : 'Manage all transport partners'}
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
              onClick={() => {/* Open register modal */}}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Register Partner
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            <div className="text-red-500 font-semibold mb-2">Failed to load partners</div>
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

        {!loading && !error && partners.length === 0 && (
          <EmptyState title="No partners found" subtitle="Register your first transport partner to get started." />
        )}

        {!loading && !error && partners.length > 0 && (
          <PremiumTable columns={columns} rows={partners.map(p => ({ ...p, id: p.partner_id }))} loading={false} />
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
      </div>
    </AdminShell>
  );
}
