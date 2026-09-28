import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { clientAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import {
  PageHeader,
  Button,
  SearchBar,
  FilterBar,
  ErrorState,
  StatusBadge,
} from '../components/admin-premium/ui/AdminUI';
import ClientFormModal from '../components/admin-premium/clients/ClientFormModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦', path: '/admin' },
  { key: 'financials', label: 'Financials', icon: '◷', path: '/admin/financials' },
  { key: 'bookings', label: 'Bookings', icon: '⟐', path: '/admin/bookings' },
  { key: 'trips', label: 'Trips', icon: '🚛', path: '/admin/trips' },
  { key: 'clients', label: 'Clients', icon: '☍', path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉', path: '/admin/owners' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛', path: '/admin/vehicles' },
  { key: 'drivers', label: 'Drivers', icon: '⌁', path: '/admin/drivers' },
  { key: 'analytics', label: 'Analytics', icon: '◷', path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: '☰', path: '/admin/reports' },
];

const ITEMS_PER_PAGE = 10;

function AdminClients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadClients();
  }, [search, pagination.page]);

  const loadClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        page: pagination.page,
        limit: ITEMS_PER_PAGE,
      };
      if (search) params.search = search;

      const res = await clientAPI.getAll(params);
      setClients(res.data.data);
      setPagination(res.data.pagination);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  const handleClientCreated = (createdClient) => {
    showToast('Client created successfully');
    setShowAddModal(false);
    loadClients();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  // Status is no longer hand-coloured per page. StatusBadge resolves the
  // semantic tone once, so Active / Suspended / Paid / Partial / Pending look
  // identical to every other status in the console.

  // Calculate summary metrics from loaded clients
  const summaryMetrics = useMemo(() => {
    const totalClients = pagination.total;
    const activeClients = clients.filter(c => c.status === 'active').length;
    const totalReceivable = clients.reduce((sum, c) => sum + (c.financials?.totalOutstanding || 0), 0);
    const totalOutstanding = totalReceivable; // Same as receivable for clients
    return { totalClients, activeClients, totalReceivable, totalOutstanding };
  }, [clients, pagination.total]);

  const columns = useMemo(() => [
    {
      key: 'companyName',
      header: 'CLIENT',
      render: (row) => (
        <div className="font-medium text-text">
          {row.company_name}
          {row.client_code && <span className="ml-2 text-xs text-muted">({row.client_code})</span>}
        </div>
      ),
      sortable: true,
    },
    { 
      key: 'contactPerson', 
      header: 'CONTACT',
      render: (row) => (
        <div>
          <div className="font-medium">{row.contact_person || '—'}</div>
          <div className="text-xs text-muted">{row.phone}</div>
          {row.email && <div className="text-xs text-muted">{row.email}</div>}
        </div>
      ),
    },
    { 
      key: 'financials.totalTrips', 
      header: 'TRIPS',
      render: (row) => (
        <div className="font-medium tabular-nums">{row.financials?.totalTrips || 0}</div>
      ),
      className: 'text-right',
    },
    { 
      key: 'financials.activeTrips', 
      header: 'ACTIVE',
      render: (row) => (
        <div className="font-medium tabular-nums text-amber-600">{row.financials?.activeTrips || 0}</div>
      ),
      className: 'text-right',
    },
    { 
      key: 'financials.totalFreight', 
      header: 'BILLING',
      render: (row) => (
        <div className="font-medium tabular-nums">{formatCurrency(row.financials?.totalFreight || 0)}</div>
      ),
      className: 'text-right',
    },
    { 
      key: 'financials.totalPaid', 
      header: 'RECEIVED',
      render: (row) => (
        <div className="font-medium tabular-nums text-green-600">{formatCurrency(row.financials?.totalPaid || 0)}</div>
      ),
      className: 'text-right',
    },
    { 
      key: 'financials.totalOutstanding', 
      header: 'OUTSTANDING',
      render: (row) => {
        const outstanding = row.financials?.totalOutstanding || 0;
        return (
          <div className={`font-bold tabular-nums ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {formatCurrency(outstanding)}
          </div>
        );
      },
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'STATUS',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'financials.paymentStatus',
      header: 'PAYMENT',
      render: (row) => <StatusBadge status={row.financials?.paymentStatus || 'PENDING'} />,
    },
  ], []);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="clients" onNav={(key) => {
      if (key === 'trips') navigate('/admin/trips');
      else if (key === 'financials') navigate('/admin/financials');
      else if (key === 'dashboard') navigate('/admin');
    }}>
      <div className="space-y-5 lg:space-y-6">
        {/* HEADER — shared hierarchy */}
        <PageHeader
          eyebrow="Network"
          title="Clients"
          description="Offline business accounts and their transport and financial activity."
          actions={
            <Button variant="accent" icon={UserPlus} onClick={() => setShowAddModal(true)}>
              Add Client
            </Button>
          }
        />

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            title="Total Clients"
            value={summaryMetrics.totalClients}
            subtitle="All accounts"
            accent="slate"
          />
          <KpiCard
            title="Active Clients"
            value={summaryMetrics.activeClients}
            subtitle="Currently active"
            accent="green"
          />
          <KpiCard
            title="Total Receivable"
            value={formatCurrency(summaryMetrics.totalReceivable)}
            subtitle="Client billing"
            accent="amber"
          />
          <KpiCard
            title="Total Outstanding"
            value={formatCurrency(summaryMetrics.totalOutstanding)}
            subtitle="Amount due"
            accent={summaryMetrics.totalOutstanding > 0 ? 'red' : 'green'}
          />
        </div>

        {/* Search + result count */}
        <FilterBar>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search clients by name, company, phone, email…"
            className="w-full sm:max-w-md"
          />
          <span className="text-[13px] text-bt-ink-2">
            {clients.length} of {pagination.total} client{pagination.total === 1 ? '' : 's'}
          </span>
        </FilterBar>

        {/* Clients Table — PremiumTable brings its own surface, so the page no
            longer wraps it in a second, competing card. */}
        {error ? (
          <ErrorState title="Could not load clients" message={error} onRetry={() => window.location.reload()} />
        ) : clients.length === 0 && !loading ? (
          <EmptyState
            title="No clients found"
            subtitle={search ? 'Try adjusting your search criteria.' : 'Add your first offline business client to get started.'}
          />
        ) : (
          <PremiumTable
            columns={columns}
            rows={clients}
            loading={loading}
            onRowClick={(row) => navigate(`/admin/clients/${row.client_id}`)}
          />
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-bt-ink-2">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} clients
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                disabled={pagination.page === 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                disabled={pagination.page === pagination.pages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Add Client Modal */}
        <ClientFormModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleClientCreated}
        />

        {/* Toast */}
        {toast && (
          <div
            className={`bt-badge fixed bottom-5 right-5 z-50 shadow-[var(--bt-shadow-popover)] ${
              toast.type === 'success' ? 'bt-badge-success' : 'bt-badge-danger'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminClients;
