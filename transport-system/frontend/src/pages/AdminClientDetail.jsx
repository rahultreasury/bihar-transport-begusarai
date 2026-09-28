import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clientAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import KpiCard from '../components/admin-premium/ui/KpiCard';

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

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trips', label: 'Trips' },
  { key: 'statement', label: 'Statement' },
];

function AdminClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [client, setClient] = useState(null);
  const [trips, setTrips] = useState([]);
  const [statement, setStatement] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    loadData();
  }, [id, activeTab]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'overview') {
        const res = await clientAPI.getById(id);
        setClient(res.data.data);
      } else if (activeTab === 'trips') {
        const res = await clientAPI.getTrips(id);
        setTrips(res.data.data);
      } else if (activeTab === 'statement') {
        const res = await clientAPI.getStatement(id);
        setStatement(res.data.data);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setError('Client not found');
      } else {
        setError(err.response?.data?.message || 'Failed to load client data');
      }
    } finally {
      setLoading(false);
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

  const renderOverview = () => {
    if (!client) return null;
    const financials = client.financials || {};

    return (
      <div className="space-y-6">
        {/* Client Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold">{client.company_name}</h2>
              <p className="text-gray-500">{client.contact_person}</p>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                <p>Phone: {client.phone}</p>
                <p>Email: {client.email || '-'}</p>
                <p>Address: {client.address || '-'}</p>
                <p>GST: {client.gst_number || '-'}</p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(client.status)}`}>
              {client.status}
            </span>
          </div>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard
            title="Total Trips"
            value={financials.totalTrips || 0}
            subtitle="All time"
          />
          <KpiCard
            title="Total Freight"
            value={formatCurrency(financials.totalFreight || 0)}
            subtitle="Total revenue"
          />
          <KpiCard
            title="Total Paid"
            value={formatCurrency(financials.totalPaid || 0)}
            subtitle="Payments received"
            trend="up"
          />
          <KpiCard
            title="Outstanding"
            value={formatCurrency(financials.totalOutstanding || 0)}
            subtitle="Amount due"
            trend={financials.totalOutstanding > 0 ? 'up' : 'neutral'}
            trendValue={financials.totalOutstanding > 0 ? 'Due' : 'Clear'}
          />
        </div>

        {/* Payment Status */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold mb-4">Payment Status</h3>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getPaymentStatusColor(financials.paymentStatus)}`}>
              {financials.paymentStatus || 'PENDING'}
            </span>
            {financials.totalOutstanding > 0 && (
              <span className="text-red-600 font-medium">
                Outstanding: {formatCurrency(financials.totalOutstanding)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTrips = () => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold">Client Trips</h3>
        <p className="text-sm text-gray-500">All trips for this client with financial status</p>
      </div>
      <PremiumTable
        columns={[
          { key: 'tripNumber', label: 'Trip' },
          { key: 'status', label: 'Status' },
          { key: 'route', label: 'Route' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'driver', label: 'Driver' },
          { key: 'freight', label: 'Freight', format: formatCurrency },
          { key: 'paid', label: 'Paid', format: formatCurrency },
          { key: 'due', label: 'Due', format: formatCurrency, highlight: true },
          { key: 'paymentStatus', label: 'Payment', format: (v) => (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPaymentStatusColor(v)}`}>
              {v}
            </span>
          )},
        ]}
        rows={trips}
        onRowClick={(row) => navigate(`/admin/trips/${row.tripId}`)}
      />
    </div>
  );

  const renderStatement = () => {
    if (!statement) return null;

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">Client Statement</h3>
          <p className="text-sm text-gray-500">
            {statement.companyName} — Current Balance: {formatCurrency(statement.currentBalance)}
          </p>
        </div>
        <PremiumTable
          columns={[
            { key: 'date', label: 'Date', format: (v) => v ? new Date(v).toLocaleDateString() : '-' },
            { key: 'type', label: 'Type' },
            { key: 'tripNumber', label: 'Trip' },
            { key: 'description', label: 'Description' },
            { key: 'debit', label: 'Debit', format: (v) => v > 0 ? formatCurrency(v) : '-' },
            { key: 'credit', label: 'Credit', format: (v) => v > 0 ? formatCurrency(v) : '-' },
            { key: 'balance', label: 'Balance', format: formatCurrency },
            { key: 'paymentMethod', label: 'Method' },
          ]}
          data={statement.statement}
        />
      </div>
    );
  };

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) {
      const isNotFound = error === 'Client not found';
      return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <div className="text-2xl font-semibold mb-2">{isNotFound ? 'Client Not Found' : 'Failed to Load'}</div>
          <div className="text-gray-500 mb-4">{error}</div>
          {!isNotFound && (
            <button
              onClick={loadData}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600"
            >
              Retry
            </button>
          )}
          {isNotFound && (
            <button
              onClick={() => navigate('/admin/clients')}
              className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              ← Back to Clients
            </button>
          )}
        </div>
      );
    }

    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'trips': return renderTrips();
      case 'statement': return renderStatement();
      default: return renderOverview();
    }
  };

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="clients" onNav={(key) => {
      if (key === 'clients') navigate('/admin/clients');
      else if (key === 'financials') navigate('/admin/financials');
      else if (key === 'dashboard') navigate('/admin');
    }}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/clients')}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            ← Back
          </button>
          <div>
            <h1 className="bt-page-title">{client?.company_name || 'Client Detail'}</h1>
            {client && (
              <p className="text-gray-500">
                {client.contact_person} • {client.phone}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-4">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {renderContent()}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </AdminShell>
  );
}

export default AdminClientDetail;
