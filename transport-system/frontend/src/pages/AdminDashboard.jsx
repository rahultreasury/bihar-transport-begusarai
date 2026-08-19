import { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

function AdminDashboard() {
  const { user } = useContext(AuthContext);

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  // Phase 1: enterprise home only. Other admin tabs are removed from this screen
  // (backend/APIs untouched; Phase 2 will reintroduce these as proper routes).
  const [activeKey, setActiveKey] = useState('dashboard');

  const navItems = useMemo(
    () => [
      { key: 'dashboard', label: 'Dashboard', icon: '▦' },
      { key: 'bookings', label: 'Bookings', icon: '⟐' },
      { key: 'owners', label: 'Transport Owners', icon: '⧉' },
      { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
      { key: 'drivers', label: 'Drivers', icon: '⌁' },
      { key: 'analytics', label: 'Analytics', icon: '◷' },
      { key: 'ai', label: 'AI Insights', icon: '✦' }
    ],
    []
  );

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await adminAPI.getDashboard();
        if (response.data?.success) setDashboard(response.data.data);
      } catch (error) {
        console.error('Error fetching dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getStatusBadge = (status) => {
    const badges = {
      pending: { className: 'badge-pending', label: 'Pending' },
      confirmed: { className: 'badge-confirmed', label: 'Confirmed' },
      in_transit: { className: 'badge-in-transit', label: 'In Transit' },
      delivered: { className: 'badge-delivered', label: 'Delivered' },
      cancelled: { className: 'badge-cancelled', label: 'Cancelled' }
    };
    const badge = badges[status] || badges.pending;
    return <span className={`badge ${badge.className}`}>{badge.label}</span>;
  };

  const stats = dashboard?.stats || {};
  const recentBookings = dashboard?.recentBookings || [];

  const kpis = [
    { key: 'todayRevenue', title: "Today's Revenue", value: stats?.todayRevenue ?? stats?.totalRevenue, sub: 'INR', accent: 'amber', loading },
    { key: 'todayBookings', title: "Today's Bookings", value: stats?.todayBookings ?? 0, sub: 'New bookings', accent: 'green', loading },
    { key: 'pendingBookings', title: 'Pending Bookings', value: stats?.pendingBookings ?? 0, sub: 'Awaiting dispatch', accent: 'purple', loading },
    { key: 'activeTrips', title: 'Active Trips', value: stats?.activeTrips ?? stats?.activeDeliveries, sub: 'In progress', accent: 'sky', loading },
    { key: 'totalOwners', title: 'Total Owners', value: stats?.totalOwners ?? 0, sub: 'Transport owners', accent: 'green', loading },
    { key: 'activeOwners', title: 'Active Owners', value: stats?.activeOwners ?? 0, sub: 'Currently active', accent: 'green', loading },
    { key: 'inactiveOwners', title: 'Inactive Owners', value: stats?.inactiveOwners ?? 0, sub: 'Inactive', accent: 'purple', loading },
    { key: 'outstandingPayments', title: 'Outstanding Payments', value: stats?.outstandingPayments ?? 0, sub: 'Due amount', accent: 'amber', loading },
  ];

  const navigate = useNavigate();

  const bookingColumns = useMemo(
    () => [
      {
        key: 'booking_reference',
        header: 'Booking #',
        render: (r) => (
          <button
            onClick={() => navigate('/admin/bookings')}
            className="text-amber-500 font-semibold hover:underline"
          >
            {r.booking_reference}
          </button>
        )
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (r) => (
          <div>
            <div className="font-medium">{r.first_name} {r.last_name}</div>
            <div className="text-[11px] text-muted">{r.phone || '—'}</div>
          </div>
        )
      },
      {
        key: 'route',
        header: 'Route',
        render: (r) => (
          <div className="flex items-center gap-1">
            <span className="font-medium">{r.pickup_city}</span>
            <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <span className="font-medium">{r.drop_city}</span>
          </div>
        )
      },
      {
        key: 'goods_type',
        header: 'Goods',
        render: (r) => <span className="text-sm text-muted">{r.goods_type || '—'}</span>
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => getStatusBadge(r.status)
      },
      {
        key: 'final_price',
        header: 'Price',
        render: (r) => <span className="font-semibold">₹{r.final_price}</span>
      },
      {
        key: 'created_at',
        header: 'Booked',
        render: (r) => (
          <span className="text-sm text-muted">
            {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        )
      }
    ],
    [navigate]
  );

  const bookingRows = useMemo(() => {
    if (!recentBookings?.length) return [];
    // Ensure stable shape for PremiumTable
    return recentBookings.map((b) => ({
      ...b,
      id: b.booking_id
    }));
  }, [recentBookings]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <AdminShell
      navItems={navItems}
      activeKey={activeKey}
      onNav={(k) => setActiveKey(k)}
    >
      <div className="w-full max-w-full min-w-0 space-y-4 lg:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-xs lg:text-sm text-muted mt-1 truncate">Welcome, {user?.full_name || user?.first_name || 'Admin'}.</p>
          </div>
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl px-4 py-2">
              <div className="text-xs text-muted">Ops Mode</div>
              <div className="text-sm font-semibold">Enterprise</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.slice(0, 4).map((k) => (
            <KpiCard
              key={k.key}
              title={k.title}
              value={typeof k.value === 'number' ? k.value.toLocaleString() : (k.value ?? '—')}
              sub={k.sub}
              accent={k.accent}
              loading={k.loading}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.slice(4, 8).map((k) => (
            <KpiCard
              key={k.key}
              title={k.title}
              value={typeof k.value === 'number' ? k.value.toLocaleString() : (k.value ?? '—')}
              sub={k.sub}
              accent={k.accent}
              loading={k.loading}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-5">
            <SectionCard
              title="Recent Bookings"
              right={<div className="text-xs text-muted">Last updates</div>}
            >
              {bookingRows.length ? (
                <PremiumTable columns={bookingColumns} rows={bookingRows.slice(0, 8)} loading={false} />
              ) : (
                <EmptyState title="No recent bookings" subtitle="Bookings will appear here once created." />
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export default AdminDashboard;


