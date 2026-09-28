import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { financialAPI } from '../services/api';
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
  { key: 'receivables', label: 'Client Receivables' },
  { key: 'payables', label: 'Provider Payables' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'advances', label: 'Advances' },
  { key: 'settlements', label: 'Settlements' },
];

const VIEW_TO_TAB = {
  'client-receivable': 'receivables',
  'client-due': 'receivables',
  'provider-payable': 'payables',
  'advances': 'advances',
  'commission': 'overview',
};

function AdminFinancials() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const view = searchParams.get('view');
    return view && VIEW_TO_TAB[view] ? VIEW_TO_TAB[view] : 'overview';
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [receivables, setReceivables] = useState([]);
  const [payables, setPayables] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [advances, setAdvances] = useState(null);
  const [settlements, setSettlements] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    const viewParam = Object.entries(VIEW_TO_TAB).find(([_, v]) => v === tab);
    if (viewParam) {
      setSearchParams({ view: viewParam[0] }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [setSearchParams]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'overview') {
        const res = await financialAPI.getSummary();
        setSummary(res.data.data);
      } else if (activeTab === 'receivables') {
        const res = await financialAPI.getReceivables();
        setReceivables(res.data.data.receivables);
      } else if (activeTab === 'payables') {
        const res = await financialAPI.getPayables();
        setPayables(res.data.data);
      } else if (activeTab === 'transactions') {
        const res = await financialAPI.getTransactions();
        setTransactions(res.data.data);
      } else if (activeTab === 'advances') {
        const res = await financialAPI.getAdvances();
        setAdvances(res.data.data);
      } else if (activeTab === 'settlements') {
        const res = await financialAPI.getSettlements();
        setSettlements(res.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load financial data');
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

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Total Receivable"
          value={formatCurrency(summary?.totalReceivable || 0)}
          subtitle="Money customers owe"
          trend={summary?.totalReceivable > 0 ? 'up' : 'neutral'}
          trendValue={summary?.totalReceivable > 0 ? 'Outstanding' : 'Clear'}
        />
        <KpiCard
          title="Total Payable"
          value={formatCurrency(summary?.totalPayable || 0)}
          subtitle="Money we owe owners/drivers"
          trend={summary?.totalPayable > 0 ? 'up' : 'neutral'}
          trendValue={summary?.totalPayable > 0 ? 'Pending' : 'Clear'}
        />
        <KpiCard
          title="Total Received"
          value={formatCurrency(summary?.totalReceived || 0)}
          subtitle="Customer payments received"
          trend="up"
          trendValue="Collected"
        />
        <KpiCard
          title="Total Advances"
          value={formatCurrency(summary?.totalAdvances || 0)}
          subtitle="Advances given"
          trend="neutral"
          trendValue="Paid out"
        />
        <KpiCard
          title="Net Position"
          value={formatCurrency(summary?.netPosition || 0)}
          subtitle="Receivable - Payable"
          trend={summary?.netPosition >= 0 ? 'up' : 'down'}
          trendValue={summary?.netPosition >= 0 ? 'Positive' : 'Negative'}
        />
      </div>

      {/* Receivables Breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Receivables Breakdown</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-500">Total Freight</div>
            <div className="text-xl font-bold">{formatCurrency(summary?.receivables?.totalFreight || 0)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Total Received</div>
            <div className="text-xl font-bold text-green-600">{formatCurrency(summary?.receivables?.totalReceived || 0)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Total Outstanding</div>
            <div className="text-xl font-bold text-red-600">{formatCurrency(summary?.receivables?.totalOutstanding || 0)}</div>
          </div>
        </div>
      </div>

      {/* Payables Breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Payables Breakdown</h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Owners</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Share</span>
                <span className="font-medium">{formatCurrency(summary?.payables?.owner?.totalShare || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Paid</span>
                <span className="font-medium text-green-600">{formatCurrency(summary?.payables?.owner?.totalPaid || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Due</span>
                <span className="font-medium text-red-600">{formatCurrency(summary?.payables?.owner?.totalDue || 0)}</span>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-500 mb-2">Drivers</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Agreed Pay</span>
                <span className="font-medium">{formatCurrency(summary?.payables?.driver?.totalAgreedPay || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Paid</span>
                <span className="font-medium text-green-600">{formatCurrency(summary?.payables?.driver?.totalPaid || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Due</span>
                <span className="font-medium text-red-600">{formatCurrency(summary?.payables?.driver?.totalDue || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Commission */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">BT Commission</h3>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-sm text-gray-500">Total Commission</div>
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(summary?.commission?.total || 0)}</div>
          </div>
          <div className="text-sm text-gray-400">
            From {summary?.trips?.total || 0} trips
          </div>
        </div>
      </div>
    </div>
  );

  const renderReceivables = () => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold">Client Receivables</h3>
        <p className="text-sm text-gray-500">Clients who owe money to Bihar Transport</p>
      </div>
      <PremiumTable
        columns={[
          { key: 'companyName', label: 'Client' },
          { key: 'contactPerson', label: 'Contact' },
          { key: 'totalTrips', label: 'Trips' },
          { key: 'totalFreight', label: 'Freight', format: formatCurrency },
          { key: 'totalPaid', label: 'Paid', format: formatCurrency },
          { key: 'outstanding', label: 'Outstanding', format: formatCurrency, highlight: true },
          { key: 'paymentStatus', label: 'Status' },
        ]}
        data={receivables}
        onRowClick={(row) => navigate(`/admin/clients/${row.clientId}`)}
      />
    </div>
  );

  const renderPayables = () => (
    <div className="space-y-6">
      {/* Owners */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">Owner Payables</h3>
          <p className="text-sm text-gray-500">Money Bihar Transport owes to transport owners</p>
        </div>
        <PremiumTable
          columns={[
            { key: 'ownerName', label: 'Owner' },
            { key: 'tripCount', label: 'Trips' },
            { key: 'totalShare', label: 'Total Share', format: formatCurrency },
            { key: 'totalPaid', label: 'Paid', format: formatCurrency },
            { key: 'totalDue', label: 'Due', format: formatCurrency, highlight: true },
          ]}
          data={payables?.owners || []}
        />
      </div>

      {/* Drivers */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">Driver Payables</h3>
          <p className="text-sm text-gray-500">Money Bihar Transport owes to drivers</p>
        </div>
        <PremiumTable
          columns={[
            { key: 'driverName', label: 'Driver' },
            { key: 'tripCount', label: 'Trips' },
            { key: 'totalAgreedPay', label: 'Agreed Pay', format: formatCurrency },
            { key: 'totalPaid', label: 'Paid', format: formatCurrency },
            { key: 'totalDue', label: 'Due', format: formatCurrency, highlight: true },
          ]}
          data={payables?.drivers || []}
        />
      </div>
    </div>
  );

  const renderTransactions = () => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold">All Transactions</h3>
        <p className="text-sm text-gray-500">Complete financial transaction ledger</p>
      </div>
      <PremiumTable
        columns={[
          { key: 'transaction_date', label: 'Date', format: (v) => v ? new Date(v).toLocaleDateString() : '-' },
          { key: 'transaction_type', label: 'Type' },
          { key: 'trip', label: 'Trip', format: (v) => v?.trip_number || '-', render: (row) => row.trip?.trip_id ? (
            <button onClick={() => navigate(`/admin/trips/${row.trip.trip_id}`)} className="text-amber-600 hover:text-amber-700 hover:underline font-medium">
              {row.trip?.trip_number || '-'}
            </button>
          ) : (row.trip?.trip_number || '-') },
          { key: 'amount', label: 'Amount', format: formatCurrency },
          { key: 'direction', label: 'Direction' },
          { key: 'from_party', label: 'From' },
          { key: 'to_party', label: 'To' },
          { key: 'payment_method', label: 'Method' },
        ]}
        data={transactions}
        onRowClick={(row) => row.trip?.trip_id && navigate(`/admin/trips/${row.trip.trip_id}`)}
      />
    </div>
  );

  const renderAdvances = () => (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Advances Summary</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-500">Driver Advances</div>
            <div className="text-xl font-bold">{formatCurrency(advances?.summary?.totalDriverAdvance || 0)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Fuel Advances</div>
            <div className="text-xl font-bold">{formatCurrency(advances?.summary?.totalFuelAdvance || 0)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Owner Advances</div>
            <div className="text-xl font-bold">{formatCurrency(advances?.summary?.totalOwnerAdvance || 0)}</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between">
            <span className="font-medium">Total Advances</span>
            <span className="font-bold text-lg">{formatCurrency(advances?.summary?.totalAll || 0)}</span>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">Advance Records</h3>
        </div>
        <PremiumTable
          columns={[
            { key: 'transaction_date', label: 'Date', format: (v) => v ? new Date(v).toLocaleDateString() : '-' },
            { key: 'transaction_type', label: 'Type' },
            { key: 'trip', label: 'Trip', format: (v) => v?.trip_number || '-', render: (row) => row.trip?.trip_id ? (
              <button onClick={() => navigate(`/admin/trips/${row.trip.trip_id}`)} className="text-amber-600 hover:text-amber-700 hover:underline font-medium">
                {row.trip?.trip_number || '-'}
              </button>
            ) : (row.trip?.trip_number || '-') },
            { key: 'amount', label: 'Amount', format: formatCurrency },
            { key: 'from_party', label: 'From' },
            { key: 'to_party', label: 'To' },
            { key: 'payment_method', label: 'Method' },
          ]}
          data={advances?.advances || []}
          onRowClick={(row) => row.trip?.trip_id && navigate(`/admin/trips/${row.trip.trip_id}`)}
        />
      </div>
    </div>
  );

  const renderSettlements = () => (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Settlements Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500">Driver Settlements</div>
            <div className="text-xl font-bold">{formatCurrency(settlements?.summary?.totalDriverSettlement || 0)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Owner Settlements</div>
            <div className="text-xl font-bold">{formatCurrency(settlements?.summary?.totalOwnerSettlement || 0)}</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between">
            <span className="font-medium">Total Settlements</span>
            <span className="font-bold text-lg">{formatCurrency(settlements?.summary?.totalAll || 0)}</span>
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">Settlement Records</h3>
        </div>
        <PremiumTable
          columns={[
            { key: 'transaction_date', label: 'Date', format: (v) => v ? new Date(v).toLocaleDateString() : '-' },
            { key: 'transaction_type', label: 'Type' },
            { key: 'trip', label: 'Trip', format: (v) => v?.trip_number || '-', render: (row) => row.trip?.trip_id ? (
              <button onClick={() => navigate(`/admin/trips/${row.trip.trip_id}`)} className="text-amber-600 hover:text-amber-700 hover:underline font-medium">
                {row.trip?.trip_number || '-'}
              </button>
            ) : (row.trip?.trip_number || '-') },
            { key: 'amount', label: 'Amount', format: formatCurrency },
            { key: 'from_party', label: 'From' },
            { key: 'to_party', label: 'To' },
            { key: 'payment_method', label: 'Method' },
          ]}
          data={settlements?.settlements || []}
          onRowClick={(row) => row.trip?.trip_id && navigate(`/admin/trips/${row.trip.trip_id}`)}
        />
      </div>
    </div>
  );

  const renderContent = () => {
    if (loading) return <LoadingSkeleton />;
    if (error) return <div className="text-red-500">{error}</div>;

    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'receivables': return renderReceivables();
      case 'payables': return renderPayables();
      case 'transactions': return renderTransactions();
      case 'advances': return renderAdvances();
      case 'settlements': return renderSettlements();
      default: return renderOverview();
    }
  };

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="financials" onNav={(key) => {
      if (key === 'trips') navigate('/admin/trips');
      else if (key === 'clients') navigate('/admin/clients');
      else if (key === 'dashboard') navigate('/admin');
    }}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="bt-page-title">Financials</h1>
          <p className="text-gray-500">Track client receivables, provider payables, advances, payments and commission.</p>
        </div>

        {/* Financial Overview KPI Cards */}
        {activeTab === 'overview' && summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard
              title="Client Receivable"
              value={formatCurrency(summary.totalReceivable || 0)}
              subtitle="Money clients owe"
              accent={summary.totalReceivable > 0 ? 'orange' : 'green'}
            />
            <KpiCard
              title="Client Due"
              value={formatCurrency(summary.receivables?.totalOutstanding || 0)}
              subtitle="Outstanding from clients"
              accent="orange"
            />
            <KpiCard
              title="Provider Payable"
              value={formatCurrency(summary.totalPayable || 0)}
              subtitle="Money owed to providers"
              accent="orange"
            />
            <KpiCard
              title="Advances"
              value={formatCurrency(summary.totalAdvances || 0)}
              subtitle="Advances given"
              accent="amber"
            />
            <KpiCard
              title="Commission"
              value={formatCurrency(summary.commission?.total || 0)}
              subtitle="BT commission earned"
              accent="amber"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-4">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
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

export default AdminFinancials;
