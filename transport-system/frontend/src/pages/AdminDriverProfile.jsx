import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import DriverStatusBadge from '../components/admin-premium/drivers/DriverStatusBadge';
import DriverTimeline from '../components/admin-premium/drivers/DriverTimeline';
import DriverFinanceModal from '../components/admin-premium/drivers/DriverFinanceModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'vehicles', label: 'Vehicles', icon: '⧉' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'ℹ️' },
  { key: 'trips', label: 'Trips', icon: '🚚' },
  { key: 'finance', label: 'Finance', icon: '💰' },
  { key: 'vehicle', label: 'Vehicle', icon: '🚛' },
  { key: 'timeline', label: 'Timeline', icon: '📋' }
];

export default function AdminDriverProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tab state from URL or default
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = useCallback((tab) => {
    setSearchParams(tab === 'overview' ? {} : { tab });
  }, [setSearchParams]);

  // Finance modal
  const [showFinanceModal, setShowFinanceModal] = useState(false);

  // Fetch driver profile
  const fetchDriver = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminAPI.getDriver(id);
      if (response.data?.success) {
        setDriver(response.data.data);
      } else {
        throw new Error(response.data?.message || 'Driver not found');
      }
    } catch (err) {
      console.error('Error fetching driver profile:', err);
      setError(err.message || 'Failed to load driver profile');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchDriver();
  }, [id, fetchDriver]);

  // Navigate back to drivers list
  const goBack = useCallback(() => {
    navigate('/admin/drivers');
  }, [navigate]);

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="drivers" onNav={(k) => {}}>
        <div className="space-y-4">
          <LoadingSkeleton className="h-12 w-48" />
          <LoadingSkeleton className="h-64 w-full" />
        </div>
      </AdminShell>
    );
  }

  if (error || !driver) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="drivers" onNav={(k) => {}}>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <div className="text-red-500 font-semibold mb-2">Failed to load driver</div>
          <div className="text-sm text-muted mb-4">{error || 'Driver not found'}</div>
          <button onClick={goBack} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">
            Back to Drivers
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="drivers" onNav={(k) => {}}>
      <div className="space-y-5">
        {/* Back navigation */}
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Drivers
        </button>

        {/* Driver Header Card */}
        <div className="rounded-3xl border border-border/60 bg-card/40 backdrop-blur-xl p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            {/* Avatar */}
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-lg shadow-amber-500/20">
              {driver.driver_name?.charAt(0) || 'D'}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{driver.driver_name}</h1>
                <DriverStatusBadge status={driver.status} size="md" />
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted flex-wrap">
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{driver.driver_code}</span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {driver.mobile || '—'}
                </span>
                {driver.transportVehicles?.[0] && (
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 1h8l2-1z" />
                    </svg>
                    {driver.transportVehicles[0].vehicle_number}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowFinanceModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
              >
                + Add Transaction
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                  : 'text-muted hover:text-text hover:bg-hover/60 border border-transparent'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'overview' && <OverviewTab driver={driver} />}
          {activeTab === 'trips' && <TripsTab driverId={driver.driver_id} />}
          {activeTab === 'finance' && <FinanceTab driverId={driver.driver_id} driver={driver} onAddTransaction={() => setShowFinanceModal(true)} />}
          {activeTab === 'vehicle' && <VehicleTab driverId={driver.driver_id} />}
          {activeTab === 'timeline' && <TimelineTab driverId={driver.driver_id} />}
        </div>

        {/* Finance Modal */}
        <DriverFinanceModal
          isOpen={showFinanceModal}
          onClose={() => setShowFinanceModal(false)}
          onSuccess={() => {
            fetchDriver();
          }}
          driver={driver}
        />
      </div>
    </AdminShell>
  );
}

// ============================
// OVERVIEW TAB
// ============================
function OverviewTab({ driver }) {
  const infoRows = useMemo(() => [
    { label: 'Driver ID', value: driver.driver_code, mono: true },
    { label: 'Full Name', value: driver.driver_name },
    { label: 'Mobile Number', value: driver.mobile },
    { label: 'Alternate Mobile', value: driver.alternate_mobile || '—' },
    { label: 'Current Status', value: <DriverStatusBadge status={driver.status} size="sm" /> },
    { label: 'Joining Date', value: driver.joining_date ? new Date(driver.joining_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
    { label: 'Licence Number', value: driver.license_number || '—' },
    { label: 'Licence Expiry', value: driver.license_expiry ? new Date(driver.license_expiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
    { label: 'Licence Class', value: driver.license_class || '—' },
    { label: 'Is Verified', value: driver.is_verified ? '✅ Yes' : '❌ No' },
    { label: 'Rating', value: driver.rating ? `⭐ ${driver.rating.toFixed(1)}` : '—' },
    { label: 'Total Deliveries', value: driver.total_deliveries || 0 },
    { label: 'City', value: driver.city || '—' },
    { label: 'State', value: driver.state || 'Bihar' },
    { label: 'Address', value: driver.address || '—' },
    { label: 'Registered On', value: driver.created_at ? new Date(driver.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
  ], [driver]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Left: Bio + Quick Info */}
      <div className="lg:col-span-2">
        <SectionCard title="Driver Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {infoRows.map(row => (
              <div key={row.label} className="flex flex-col">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wider">{row.label}</span>
                <span className={`text-sm mt-0.5 ${row.mono ? 'font-mono font-semibold text-amber-600 dark:text-amber-400' : 'font-medium'}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Right: Financial Summary */}
      <div className="space-y-4">
        <SectionCard title="Financial Summary">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">💰</div>
                <div>
                  <div className="text-xs text-muted">Total Advance</div>
                  <div className="text-sm font-bold">₹{Number(driver.total_advance || 0).toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-500">💵</div>
                <div>
                  <div className="text-xs text-muted">Total Paid</div>
                  <div className="text-sm font-bold">₹{Number(driver.total_paid || 0).toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">📋</div>
                <div>
                  <div className="text-xs text-muted">Total Expenses</div>
                  <div className="text-sm font-bold">₹{Number(driver.total_expenses || 0).toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-border/60">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Current Balance</div>
                <div className={`text-lg font-bold ${parseFloat(driver.current_balance || 0) > 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {parseFloat(driver.current_balance || 0) > 0 ? 'Dr ' : 'Cr '}
                  ₹{Math.abs(parseFloat(driver.current_balance || 0)).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="text-[10px] text-muted mt-1">
                {parseFloat(driver.current_balance || 0) > 0
                  ? 'Driver owes the company'
                  : parseFloat(driver.current_balance || 0) < 0
                    ? 'Company owes the driver'
                    : 'Settled'
                }
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Current Assignment">
          <div className="space-y-3">
            {driver.transportVehicles?.[0] ? (
              <div>
                <div className="text-xs text-muted">Assigned Vehicle</div>
                <div className="text-sm font-semibold">{driver.transportVehicles[0].vehicle_number}</div>
                <div className="text-xs text-muted">{driver.transportVehicles[0].vehicle_name || driver.transportVehicles[0].vehicle_type || ''}</div>
              </div>
            ) : (
              <div className="text-sm text-muted">No vehicle assigned</div>
            )}
            {driver.bookingAssignments?.[0]?.booking ? (
              <div className="pt-2 border-t border-border/60">
                <div className="text-xs text-muted">Current Booking</div>
                <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">{driver.bookingAssignments[0].booking.booking_reference}</div>
                <div className="text-xs text-muted">
                  {driver.bookingAssignments[0].booking.pickup_city} → {driver.bookingAssignments[0].booking.drop_city}
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================
// TRIPS TAB
// ============================
function TripsTab({ driverId }) {
  const [trips, setTrips] = useState([]);
  const [summary, setSummary] = useState({ revenue: 0, totalDistance: 0 });
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });

  const fetchTrips = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const response = await adminAPI.getDriverTrips(driverId, { page, limit: 20 });
      if (response.data?.success) {
        setTrips(response.data.data || []);
        setSummary({ revenue: response.data.revenue || 0, totalDistance: response.data.totalDistance || 0 });
        if (response.data.pagination) setPagination(response.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching trips:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  const columns = useMemo(() => [
    {
      key: 'booking_reference',
      header: 'Booking #',
      render: (r) => (
        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{r.booking_reference || '—'}</span>
      )
    },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (
        <div className="flex items-center gap-1 text-sm whitespace-nowrap">
          <span className="font-medium">{r.pickup_city || '—'}</span>
          <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          <span className="font-medium">{r.drop_city || '—'}</span>
        </div>
      )
    },
    {
      key: 'goods_description',
      header: 'Goods',
      render: (r) => <span className="text-sm text-muted">{r.goods_type || r.goods_description || '—'}</span>
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (r) => <span className="text-sm">{r.vehicle?.vehicle_number || '—'}</span>
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const statusColors = {
          pending: 'text-amber-500',
          confirmed: 'text-blue-500',
          in_transit: 'text-indigo-500',
          delivered: 'text-green-500',
          completed: 'text-emerald-500',
          cancelled: 'text-red-500'
        };
        return (
          <span className={`text-sm font-medium ${statusColors[r.status] || 'text-muted'}`}>
            {(r.status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </span>
        );
      }
    },
    {
      key: 'final_price',
      header: 'Revenue',
      render: (r) => (
        <span className="font-semibold text-sm">₹{Number(r.final_price || 0).toLocaleString('en-IN')}</span>
      )
    },
    {
      key: 'created_at',
      header: 'Date',
      render: (r) => (
        <span className="text-sm text-muted">
          {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
        </span>
      )
    }
  ], []);

  if (loading) {
    return (
      <SectionCard title="Trip History">
        <LoadingSkeleton className="h-48 w-full" />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trip Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Total Trips</div>
          <div className="text-2xl font-bold">{pagination.total || 0}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Completed</div>
          <div className="text-2xl font-bold text-green-500">
            {trips.filter(t => ['delivered', 'completed'].includes(t.status)).length}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Revenue Generated</div>
          <div className="text-2xl font-bold text-amber-500">₹{Number(summary.revenue).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Distance Travelled</div>
          <div className="text-2xl font-bold text-sky-500">{Number(summary.totalDistance).toLocaleString('en-IN')} km</div>
        </div>
      </div>

      {/* Trips Table */}
      <SectionCard title="Trip History">
        {trips.length === 0 ? (
          <EmptyState title="No trips found" subtitle="Trip history will appear here once the driver completes trips." />
        ) : (
          <PremiumTable columns={columns} rows={trips.map(t => ({ ...t, id: t.booking_id }))} loading={false} />
        )}
        {pagination.pages > 1 && (
          <div className="flex justify-center mt-4 gap-2">
            {Array.from({ length: pagination.pages }, (_, i) => (
              <button
                key={i}
                onClick={() => fetchTrips(i + 1)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                  pagination.page === i + 1 ? 'bg-amber-500 text-white' : 'border border-border/60 hover:bg-hover/60'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ============================
// FINANCE TAB (LEDGER)
// ============================
function FinanceTab({ driverId, driver, onAddTransaction }) {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ totalAdvance: 0, totalPayments: 0, totalFuel: 0, totalToll: 0, totalOtherExpenses: 0 });
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });

  const fetchFinance = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const response = await adminAPI.getDriverFinance(driverId, { page, limit: 50 });
      if (response.data?.success) {
        setTransactions(response.data.data || []);
        if (response.data.summary) setSummary(response.data.summary);
        if (response.data.pagination) setPagination(response.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching finance:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => { fetchFinance(); }, [fetchFinance]);

  const typeLabels = {
    advance: { label: 'Advance', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    trip_payment: { label: 'Trip Payment', color: 'text-green-500', bg: 'bg-green-500/10' },
    fuel_expense: { label: 'Fuel', color: 'text-orange-500', bg: 'bg-orange-500/10' },
    toll_expense: { label: 'Toll', color: 'text-purple-500', bg: 'bg-purple-500/10' },
    other_expense: { label: 'Other Expense', color: 'text-red-500', bg: 'bg-red-500/10' },
    recovery: { label: 'Recovery', color: 'text-emerald-500', bg: 'bg-emerald-500/10' }
  };

  const columns = useMemo(() => [
    {
      key: 'transaction_date',
      header: 'Date',
      render: (r) => (
        <span className="text-sm text-muted whitespace-nowrap">
          {r.transaction_date ? new Date(r.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        </span>
      )
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => {
        const config = typeLabels[r.transaction_type] || { label: r.transaction_type, color: 'text-muted', bg: 'bg-gray-500/10' };
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium ${config.bg} ${config.color}`}>
            {config.label}
          </span>
        );
      }
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <div className="text-sm">
          <div className="font-medium truncate max-w-[200px]">{r.description || '—'}</div>
          {r.notes && <div className="text-[10px] text-muted truncate max-w-[200px]">{r.notes}</div>}
        </div>
      )
    },
    {
      key: 'payment_mode',
      header: 'Mode',
      render: (r) => (
        <span className="text-sm text-muted capitalize">{r.payment_mode || '—'}</span>
      )
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => {
        const isDebit = ['advance', 'fuel_expense', 'toll_expense', 'other_expense'].includes(r.transaction_type);
        return (
          <span className={`font-semibold text-sm whitespace-nowrap ${isDebit ? 'text-red-500' : 'text-green-500'}`}>
            {isDebit ? '-' : '+'}₹{Number(r.amount).toLocaleString('en-IN')}
          </span>
        );
      }
    },
    {
      key: 'balance_after',
      header: 'Running Balance',
      render: (r) => (
        <span className={`font-mono font-semibold text-sm whitespace-nowrap ${parseFloat(r.balance_after) > 0 ? 'text-red-500' : 'text-green-500'}`}>
          ₹{Number(r.balance_after || 0).toLocaleString('en-IN')}
        </span>
      )
    }
  ], []);

  if (loading) {
    return (
      <SectionCard title="Driver Ledger">
        <LoadingSkeleton className="h-48 w-full" />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Advance Given</div>
          <div className="text-lg font-bold text-blue-500">₹{Number(summary.totalAdvance).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Trip Payments</div>
          <div className="text-lg font-bold text-green-500">₹{Number(summary.totalPayments).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Fuel Expenses</div>
          <div className="text-lg font-bold text-orange-500">₹{Number(summary.totalFuel).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Toll Expenses</div>
          <div className="text-lg font-bold text-purple-500">₹{Number(summary.totalToll).toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="text-xs text-muted">Other Expenses</div>
          <div className="text-lg font-bold text-red-500">₹{Number(summary.totalOtherExpenses).toLocaleString('en-IN')}</div>
        </div>
      </div>

      {/* Add Transaction Button */}
      <div className="flex justify-end">
        <button
          onClick={onAddTransaction}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition shadow-sm shadow-amber-500/20"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Record Transaction
        </button>
      </div>

      {/* Ledger Table (bank statement style) */}
      <SectionCard title="Driver Ledger">
        {transactions.length === 0 ? (
          <EmptyState title="No transactions" subtitle="Transactions will appear here as you record advances, payments, and expenses." />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-tableHead">
                  <th className="text-left px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Date</th>
                  <th className="text-left px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Type</th>
                  <th className="text-left px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Description</th>
                  <th className="text-left px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Mode</th>
                  <th className="text-right px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Debit</th>
                  <th className="text-right px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Credit</th>
                  <th className="text-right px-6 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => {
                  const isDebit = ['advance', 'fuel_expense', 'toll_expense', 'other_expense'].includes(tx.transaction_type);
                  const config = typeLabels[tx.transaction_type] || { label: tx.transaction_type, color: 'text-muted', bg: 'bg-gray-500/10' };
                  return (
                    <tr key={tx.transaction_id || idx} className="border-b border-border/40 hover:bg-hover/40 transition">
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                        {tx.transaction_date ? new Date(tx.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="text-sm">{tx.description || '—'}</div>
                        {tx.notes && <div className="text-[10px] text-muted">{tx.notes}</div>}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted capitalize">{tx.payment_mode || '—'}</td>
                      <td className="px-6 py-3 text-right text-sm font-medium text-red-500">
                        {isDebit ? `₹${Number(tx.amount).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-medium text-green-500">
                        {!isDebit ? `₹${Number(tx.amount).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono font-semibold text-sm">
                        <span className={parseFloat(tx.balance_after) > 0 ? 'text-red-500' : 'text-green-500'}>
                          ₹{Number(tx.balance_after || 0).toLocaleString('en-IN')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pagination.pages > 1 && (
          <div className="flex justify-center mt-4 gap-2">
            {Array.from({ length: pagination.pages }, (_, i) => (
              <button
                key={i}
                onClick={() => fetchFinance(i + 1)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                  pagination.page === i + 1 ? 'bg-amber-500 text-white' : 'border border-border/60 hover:bg-hover/60'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ============================
// VEHICLE TAB
// ============================
function VehicleTab({ driverId }) {
  const [vehicleData, setVehicleData] = useState({ currentVehicle: null, vehicleHistory: [] });
  const [loading, setLoading] = useState(true);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getDriverVehicles(driverId);
      if (response.data?.success) {
        setVehicleData(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  if (loading) {
    return (
      <SectionCard title="Vehicle Information">
        <LoadingSkeleton className="h-40 w-full" />
      </SectionCard>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Current Vehicle */}
      <SectionCard title="Currently Assigned Vehicle">
        {vehicleData.currentVehicle ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-xl shrink-0">
                🚛
              </div>
              <div>
                <div className="text-lg font-bold">{vehicleData.currentVehicle.vehicle_number}</div>
                <div className="text-sm text-muted">{vehicleData.currentVehicle.vehicle_name || vehicleData.currentVehicle.vehicle_type || ''}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/60">
              {vehicleData.currentVehicle.vehicle_type && (
                <div>
                  <div className="text-[11px] text-muted">Type</div>
                  <div className="text-sm font-semibold capitalize">{vehicleData.currentVehicle.vehicle_type.replace(/_/g, ' ')}</div>
                </div>
              )}
              {vehicleData.currentVehicle.capacity_kg && (
                <div>
                  <div className="text-[11px] text-muted">Capacity</div>
                  <div className="text-sm font-semibold">{vehicleData.currentVehicle.capacity_kg} kg</div>
                </div>
              )}
              {vehicleData.currentVehicle.vehicle_make && (
                <div>
                  <div className="text-[11px] text-muted">Make</div>
                  <div className="text-sm font-semibold">{vehicleData.currentVehicle.vehicle_make}</div>
                </div>
              )}
              {vehicleData.currentVehicle.vehicle_model && (
                <div>
                  <div className="text-[11px] text-muted">Model</div>
                  <div className="text-sm font-semibold">{vehicleData.currentVehicle.vehicle_model}</div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="No vehicle assigned" subtitle="This driver has not been assigned any vehicle." />
        )}
      </SectionCard>

      {/* Vehicle History */}
      <SectionCard title="Vehicle Assignment History">
        {vehicleData.vehicleHistory.length === 0 ? (
          <EmptyState title="No history" subtitle="Vehicle assignment history will appear here." />
        ) : (
          <div className="space-y-3">
            {vehicleData.vehicleHistory.map((v, idx) => (
              <div key={v.vehicle_id || idx} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-500 text-xs">
                    🚛
                  </div>
                  <div>
                    <div className="text-sm font-medium">{v.vehicle_number}</div>
                    <div className="text-[10px] text-muted">{v.vehicle_name || v.vehicle_type || ''}</div>
                  </div>
                </div>
                <div className="text-[11px] text-muted">
                  {v.created_at ? new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ============================
// TIMELINE TAB
// ============================
function TimelineTab({ driverId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getDriverTimeline(driverId);
      if (response.data?.success) {
        setEvents(response.data.data || []);
      }
    } catch (err) {
      console.error('Error fetching timeline:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  return (
    <SectionCard title="Activity Timeline">
      <DriverTimeline events={events} loading={loading} />
    </SectionCard>
  );
}

