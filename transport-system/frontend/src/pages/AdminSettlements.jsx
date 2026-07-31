import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'settlements', label: 'Settlements', icon: '📊' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'reports', label: 'Reports', icon: '📊' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

export default function AdminSettlements() {
  const navigate = useNavigate();
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [page, setPage] = useState(1);

  const fetchSettlements = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: p,
        limit: 20,
        status: statusFilter || undefined,
        partner_id: partnerFilter || undefined,
        month: monthFilter || undefined,
        year: yearFilter || undefined,
      };
      const response = await adminAPI.getAllSettlements(params);
      if (response.data?.success) {
        setSettlements(response.data.data || []);
        if (response.data.pagination) setPagination(response.data.pagination);
      }
    } catch (err) {
      setError(err.message || 'Failed to load settlements');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, partnerFilter, monthFilter, yearFilter]);

  useEffect(() => { fetchSettlements(page); }, [page, fetchSettlements]);

  const handleStatusUpdate = async (id, status) => {
    try {
      await adminAPI.updateSettlementStatus(id, status);
      fetchSettlements(page);
    } catch (err) { console.error(err); }
  };

  const handleLock = async (id) => {
    try {
      await adminAPI.lockSettlement(id);
      fetchSettlements(page);
    } catch (err) { console.error(err); }
  };

  const columns = useMemo(() => [
    {
      key: 'settlement_number',
      header: 'Settlement #',
      render: (r) => (
        <div>
          <div className="font-mono font-semibold text-amber-600 dark:text-amber-400">{r.settlement_number}</div>
          <div className="text-[10px] text-muted">ID: {r.settlement_id}</div>
        </div>
      )
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (r) => (
        <div className="cursor-pointer" onClick={() => navigate(`/admin/owners/${r.partner_id}`)}>
          <div className="font-medium text-sm">{r.partner?.partner_name || `Owner #${r.partner_id}`}</div>
          <div className="text-[10px] text-muted font-mono">{r.partner?.partner_code || ''}</div>
        </div>
      )
    },
    {
      key: 'period',
      header: 'Period',
      render: (r) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return <span className="font-semibold">{months[r.month - 1] || r.month} {r.year}</span>;
      }
    },
    {
      key: 'bookings',
      header: 'Bookings',
      render: (r) => <div className="text-center font-semibold">{r.total_bookings || 0}</div>
    },
    {
      key: 'gross_revenue',
      header: 'Gross Revenue',
      render: (r) => <span className="font-medium">₹{(r.gross_revenue || 0).toLocaleString('en-IN')}</span>
    },
    {
      key: 'commission',
      header: 'Commission',
      render: (r) => <span className="font-medium text-purple-500">₹{(r.commission || 0).toLocaleString('en-IN')}</span>
    },
    {
      key: 'net_payable',
      header: 'Net Payable',
      render: (r) => <span className="font-bold text-green-500">₹{(r.net_payable || 0).toLocaleString('en-IN')}</span>
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const colors = {
          pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
          paid: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
          partially_paid: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
          cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
          locked: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
        };
        return (
          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colors[r.status] || colors.pending}`}>
            {r.status ? r.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown'}
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          {r.status === 'pending' && (
            <>
              <button onClick={() => handleStatusUpdate(r.settlement_id, 'paid')}
                className="px-2 py-1 rounded-lg bg-green-500/10 text-green-600 text-xs font-medium hover:bg-green-500/20">Pay</button>
              <button onClick={() => handleLock(r.settlement_id)}
                className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 text-xs font-medium hover:bg-blue-500/20">Lock</button>
            </>
          )}
          {r.status === 'paid' && (
            <button onClick={() => handleLock(r.settlement_id)}
              className="px-2 py-1 rounded-lg bg-gray-500/10 text-gray-600 text-xs font-medium hover:bg-gray-500/20">Lock</button>
          )}
        </div>
      )
    }
  ], [navigate]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="settlements" onNav={(k) => {}}>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Monthly Settlements</h1>
            <p className="text-sm text-muted mt-1">
              {pagination.total > 0 ? `${pagination.total} settlement${pagination.total !== 1 ? 's' : ''} generated` : 'Generate and manage partner settlements'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="locked">Locked</option>
          </select>
          <select value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm">
            <option value="">All Months</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{new Date(2024, i).toLocaleString('default', { month: 'long' })}</option>
            ))}
          </select>
          <select value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm">
            <option value="">All Years</option>
            {[2024, 2025, 2026, 2027, 2028].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">{error}</div>
            <button onClick={() => fetchSettlements(1)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold">Retry</button>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <LoadingSkeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => <LoadingSkeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {!loading && !error && settlements.length === 0 && (
          <EmptyState title="No settlements found" subtitle="Generate a monthly settlement for a partner to get started." />
        )}

        {!loading && !error && settlements.length > 0 && (
          <PremiumTable columns={columns} rows={settlements.map(s => ({ ...s, id: s.settlement_id }))} loading={false} />
        )}

        {!loading && !error && pagination.pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium disabled:opacity-40">← Prev</button>
              <span className="text-sm text-muted">Page {page} of {pagination.pages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-sm font-medium disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
