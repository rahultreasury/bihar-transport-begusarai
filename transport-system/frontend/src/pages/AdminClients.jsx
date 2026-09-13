import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';

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
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClient, setNewClient] = useState({
    company_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'Bihar',
    gst_number: '',
    pan_number: '',
    status: 'active',
    notes: '',
  });

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

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClient.company_name || !newClient.phone) {
      showToast('Company name and phone are required', 'error');
      return;
    }
    setCreatingClient(true);
    try {
      await clientAPI.create(newClient);
      showToast('Client created successfully');
      setShowAddModal(false);
      setNewClient({
        company_name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: 'Bihar',
        gst_number: '',
        pan_number: '',
        status: 'active',
        notes: '',
      });
      loadClients();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to create client', 'error');
    } finally {
      setCreatingClient(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'suspended': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPaymentStatusColor = (status) => {
    switch (status) {
      case 'PAID': return 'bg-green-100 text-green-800';
      case 'PARTIAL': return 'bg-yellow-100 text-yellow-800';
      case 'PENDING': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

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
      render: (row) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}>
          {row.status}
        </span>
      ),
    },
    { 
      key: 'financials.paymentStatus', 
      header: 'PAYMENT',
      render: (row) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPaymentStatusColor(row.financials?.paymentStatus)}`}>
          {row.financials?.paymentStatus || 'PENDING'}
        </span>
      ),
    },
  ], []);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="clients" onNav={(key) => {
      if (key === 'trips') navigate('/admin/trips');
      else if (key === 'financials') navigate('/admin/financials');
      else if (key === 'dashboard') navigate('/admin');
    }}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Clients</h1>
            <p className="text-gray-500">Offline business accounts and their transport/financial activity</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors w-full sm:w-auto"
          >
            + Add Client
          </button>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

        {/* Search */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder="Search clients by name, company, phone, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="p-8">
              <LoadingSkeleton />
            </div>
          ) : error ? (
            <div className="p-8 text-red-500">{error}</div>
          ) : clients.length === 0 ? (
            <div className="p-8">
              <EmptyState 
                title="No clients found" 
                subtitle={search ? 'Try adjusting your search criteria.' : 'Add your first offline business client to get started.'}
              />
            </div>
          ) : (
          <PremiumTable
            columns={columns}
            rows={clients}
            loading={loading}
            onRowClick={(row) => navigate(`/admin/clients/${row.client_id}`)}
          />
        )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} clients
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                disabled={pagination.page === pagination.pages}
                className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Add Client Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowAddModal(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Add New Client</h3>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <form onSubmit={handleCreateClient} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                    <input
                      type="text"
                      value={newClient.company_name}
                      onChange={(e) => setNewClient({ ...newClient, company_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                    <input
                      type="tel"
                      value={newClient.phone}
                      onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                    <input
                      type="text"
                      value={newClient.contact_person}
                      onChange={(e) => setNewClient({ ...newClient, contact_person: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={newClient.email}
                      onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={newClient.address}
                    onChange={(e) => setNewClient({ ...newClient, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input
                      type="text"
                      value={newClient.city}
                      onChange={(e) => setNewClient({ ...newClient, city: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input
                      type="text"
                      value={newClient.state}
                      onChange={(e) => setNewClient({ ...newClient, state: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
                    <input
                      type="text"
                      value={newClient.gst_number}
                      onChange={(e) => setNewClient({ ...newClient, gst_number: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number</label>
                    <input
                      type="text"
                      value={newClient.pan_number}
                      onChange={(e) => setNewClient({ ...newClient, pan_number: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={newClient.status}
                    onChange={(e) => setNewClient({ ...newClient, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={newClient.notes}
                    onChange={(e) => setNewClient({ ...newClient, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingClient}
                    className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50"
                  >
                    {creatingClient ? 'Creating...' : 'Create Client'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.message}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminClients;
