import { useEffect, useState, useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

function AdminDashboard() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  // Data states
  const [dashboard, setDashboard] = useState(null);
  const [tripSummary, setTripSummary] = useState(null);
  const [recentTrips, setRecentTrips] = useState([]);
  const [vehicleStats, setVehicleStats] = useState(null);
  const [driverStats, setDriverStats] = useState(null);
  const [ownerStats, setOwnerStats] = useState(null);

  // Loading / error per section
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  // Fetch all data in parallel
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);
      setErrors({});
      try {
        const [
          dashRes,
          tripSumRes,
          tripsRes,
          vehRes,
          drvRes,
          ownRes,
        ] = await Promise.allSettled([
          adminAPI.getDashboard(),
          adminAPI.getTripSummary(),
          adminAPI.getTrips({ page: 1, limit: 8, sort_by: 'created_at', sort_order: 'desc' }),
          adminAPI.getVehicleStats(),
          adminAPI.getDriverStats(),
          adminAPI.getVehicleOwnerStats(),
        ]);

        if (cancelled) return;

        if (dashRes.status === 'fulfilled' && dashRes.value.data?.success) {
          setDashboard(dashRes.value.data.data);
        } else {
          setErrors((e) => ({ ...e, dashboard: dashRes.reason?.message || 'Failed' }));
        }

        if (tripSumRes.status === 'fulfilled' && tripSumRes.value.data?.success) {
          setTripSummary(tripSumRes.value.data.data);
        } else {
          setErrors((e) => ({ ...e, tripSummary: tripSumRes.reason?.message || 'Failed' }));
        }

        if (tripsRes.status === 'fulfilled' && tripsRes.value.data?.success) {
          setRecentTrips(tripsRes.value.data.data || []);
        } else {
          setErrors((e) => ({ ...e, recentTrips: tripsRes.reason?.message || 'Failed' }));
        }

        if (vehRes.status === 'fulfilled' && vehRes.value.data?.success) {
          setVehicleStats(vehRes.value.data.data);
        } else {
          setErrors((e) => ({ ...e, vehicleStats: vehRes.reason?.message || 'Failed' }));
        }

        if (drvRes.status === 'fulfilled' && drvRes.value.data?.success) {
          setDriverStats(drvRes.value.data.data);
        } else {
          setErrors((e) => ({ ...e, driverStats: drvRes.reason?.message || 'Failed' }));
        }

        if (ownRes.status === 'fulfilled' && ownRes.value.data?.success) {
          setOwnerStats(ownRes.value.data.data);
        } else {
          setErrors((e) => ({ ...e, ownerStats: ownRes.reason?.message || 'Failed' }));
        }
      } catch (err) {
        if (!cancelled) setErrors((e) => ({ ...e, global: err.message }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // Formatters
  const fmt = useCallback((n) => {
    if (n === null || n === undefined) return '—';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
  }, []);

  const fmtCurrency = useCallback((n) => {
    if (n === null || n === undefined) return '₹0';
    return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
  }, []);

  const fmtDate = useCallback((d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }, []);

  // Loading skeleton for a KPI card
  const KpiSkeleton = () => (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
      <div className="h-4 w-24 bg-skeleton animate-pulse rounded mb-2" />
      <div className="h-8 w-32 bg-skeleton animate-pulse rounded mb-2" />
      <div className="h-3 w-20 bg-skeleton animate-pulse rounded" />
    </div>
  );

  // Enterprise KPI card
  const DashboardKpi = ({ label, value, sub, onClick, loading, error, accent }) => {
    const accentColors = {
      green: 'bg-emerald-500/10 border-emerald-500/20',
      amber: 'bg-amber-500/10 border-amber-500/20',
      red: 'bg-red-500/10 border-red-500/20',
      blue: 'bg-blue-500/10 border-blue-500/20',
      sky: 'bg-sky-500/10 border-sky-500/20',
      purple: 'bg-purple-500/10 border-purple-500/20',
      emerald: 'bg-emerald-500/10 border-emerald-500/20',
      slate: 'bg-slate-500/10 border-slate-500/20',
    };
    const accentClass = accentColors[accent] || accentColors.amber;

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading || error}
        className={`w-full text-left rounded-2xl border transition-all ${
          onClick
            ? 'cursor-pointer hover:shadow-md hover:border-amber-500/40 hover:bg-amber-500/5'
            : 'cursor-default'
        } ${accentClass} ${error ? 'border-red-500/40 bg-red-500/5' : 'bg-card/40'} backdrop-blur-xl p-5`}
        aria-busy={loading}
        aria-disabled={loading || error}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{label}</div>
        {loading ? (
          <div className="h-10 w-36 bg-skeleton animate-pulse rounded" />
        ) : error ? (
          <div className="text-lg font-semibold text-red-500">Unable to load</div>
        ) : (
          <div className="text-3xl font-semibold tabular-nums">{value}</div>
        )}
        {sub && !loading && !error && <div className="text-xs text-muted mt-1.5">{sub}</div>}
        {onClick && !loading && !error && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span>View details</span>
          </div>
        )}
      </button>
    );
  };

  // Section header with optional action
  const SectionHeader = ({ title, action }) => (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {action}
    </div>
  );

  // Operations KPIs
  const opsKpis = useMemo(() => [
    {
      label: 'Active Trips',
      value: fmt(tripSummary?.inTransit ?? dashboard?.stats?.activeDeliveries ?? 0),
      sub: 'Currently running',
      accent: 'emerald',
      onClick: () => navigate('/admin/trips?status=IN_TRANSIT'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Pending Trips',
      value: fmt(tripSummary?.pending ?? dashboard?.stats?.pendingBookings ?? 0),
      sub: 'Needs attention',
      accent: 'amber',
      onClick: () => navigate('/admin/trips?status=PENDING'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Total Bookings',
      value: fmt(dashboard?.stats?.totalBookings ?? 0),
      sub: 'All time',
      accent: 'blue',
      onClick: () => navigate('/admin/bookings'),
      loading: loading || !dashboard,
      error: errors.dashboard,
    },
  ], [tripSummary, dashboard, loading, errors, navigate, fmt]);

  // Financials KPIs
  const finKpis = useMemo(() => [
    {
      label: 'Total Freight',
      value: fmtCurrency(tripSummary?.totalFreight ?? 0),
      sub: 'Across trips',
      accent: 'amber',
      onClick: () => navigate('/admin/financials?view=overview'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Customer Due',
      value: fmtCurrency(tripSummary?.customerDue ?? 0),
      sub: 'Pending receivables',
      accent: 'red',
      onClick: () => navigate('/admin/financials?view=client-receivable'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Owner Outstanding',
      value: fmtCurrency(tripSummary?.ownerOutstanding ?? 0),
      sub: 'Payable to owners',
      accent: 'sky',
      onClick: () => navigate('/admin/financials?view=provider-payable'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'BT Net Profit',
      value: fmtCurrency(tripSummary?.totalProfit ?? 0),
      sub: 'After payouts',
      accent: 'green',
      onClick: () => navigate('/admin/financials?view=overview'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
  ], [tripSummary, loading, errors, navigate, fmtCurrency]);

  // Resources KPIs
  const resKpis = useMemo(() => [
    {
      label: 'Available Vehicles',
      value: fmt(vehicleStats?.available ?? 0),
      sub: 'Ready for assignment',
      accent: 'emerald',
      onClick: () => navigate('/admin/vehicles'),
      loading: loading || !vehicleStats,
      error: errors.vehicleStats,
    },
    {
      label: 'Available Drivers',
      value: fmt(driverStats?.available ?? 0),
      sub: 'Currently available',
      accent: 'blue',
      onClick: () => navigate('/admin/drivers'),
      loading: loading || !driverStats,
      error: errors.driverStats,
    },
    {
      label: 'Transport Owners',
      value: fmt(ownerStats?.activeOwners ?? 0),
      sub: 'Active owners',
      accent: 'purple',
      onClick: () => navigate('/admin/owners'),
      loading: loading || !ownerStats,
      error: errors.ownerStats,
    },
  ], [vehicleStats, driverStats, ownerStats, loading, errors, navigate, fmt]);

  // Recent trips table columns
  const tripColumns = useMemo(() => [
    {
      key: 'trip_number',
      header: 'Trip #',
      render: (r) => (
        <span className="font-mono text-sm font-medium text-amber-600">{r.trip_number}</span>
      ),
    },
    {
      key: 'party',
      header: 'Customer / Client',
      render: (r) => {
        if (r.source_type === 'ONLINE_BOOKING' && r.user) {
          return (
            <div>
              <div className="font-medium">{r.user.first_name} {r.user.last_name}</div>
              <div className="text-[11px] text-muted">Online Customer</div>
            </div>
          );
        }
        if (r.source_type === 'OFFLINE_CLIENT' && r.client_id) {
          return (
            <div>
              <div className="font-medium">Client #{r.client_id}</div>
              <div className="text-[11px] text-muted">Offline Client</div>
            </div>
          );
        }
        return (
          <div>
            <div className="font-medium">{r.transportOwner?.owner_name || '—'}</div>
            <div className="text-[11px] text-muted">Direct</div>
          </div>
        );
      },
    },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (
        <div className="flex items-center gap-1">
          <span className="font-medium">{r.pickup_city}</span>
          <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          <span className="font-medium">{r.drop_city}</span>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (r) => (
        <div>
          <div className="font-medium">{r.vehicle?.vehicle_number || '—'}</div>
          <div className="text-[11px] text-muted">{r.vehicle?.vehicle_type || ''}</div>
        </div>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (r) => (
        <div>
          <div className="font-medium">{r.driver?.driver_name || '—'}</div>
          <div className="text-[11px] text-muted">{r.driver?.mobile || ''}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status?.toLowerCase()} size="sm" />,
    },
    {
      key: 'freight',
      header: 'Amount',
      render: (r) => <span className="font-semibold">{fmtCurrency(r.freight_amount)}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      render: (r) => <span className="text-sm text-muted">{fmtDate(r.trip_date || r.created_at)}</span>,
    },
  ], [fmtCurrency, fmtDate]);

  const tripRows = useMemo(() => recentTrips.map((t) => ({ ...t, id: t.trip_id })), [recentTrips]);

  // Needs Attention
  const needsAttentionCount = tripSummary?.needsAttention ?? 0;

  // Navigation items for sidebar (string icons — compatible with AdminSidebar rendering)
  const navItems = useMemo(
    () => [
      { key: 'dashboard', label: 'Dashboard', icon: '▦', path: '/admin' },
      { key: 'bookings', label: 'Bookings', icon: '⟐', path: '/admin/bookings' },
      { key: 'trips', label: 'Trips', icon: '🚛', path: '/admin/trips' },
      { key: 'clients', label: 'Clients', icon: '☍', path: '/admin/clients' },
      { key: 'owners', label: 'Transport Owners', icon: '⧉', path: '/admin/owners' },
      { key: 'vehicles', label: 'Vehicles', icon: '🚛', path: '/admin/vehicles' },
      { key: 'drivers', label: 'Drivers', icon: '⌁', path: '/admin/drivers' },
      { key: 'analytics', label: 'Analytics', icon: '◷', path: '/admin/analytics' },
      { key: 'reports', label: 'Reports', icon: '☰', path: '/admin/reports' },
      { key: 'ai', label: 'AI Insights', icon: '✦', path: '/admin/ai' },
    ],
    []
  );

  // Loading full-page skeleton
  if (loading) {
    return (
      <AdminShell navItems={navItems} activeKey="dashboard" onNav={() => {}}>
        <div className="w-full max-w-full min-w-0 space-y-4 lg:space-y-6 p-4">
          <div className="h-8 w-48 bg-skeleton animate-pulse rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <KpiSkeleton key={i} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <KpiSkeleton key={`f${i}`} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <KpiSkeleton key={`r${i}`} />)}
          </div>
          <div className="h-64 bg-skeleton animate-pulse rounded-2xl" />
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={navItems} activeKey="dashboard" onNav={() => {}}>
      <div className="w-full max-w-full min-w-0 space-y-4 lg:space-y-6 p-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-xs lg:text-sm text-muted mt-1 truncate">
              Operational and financial overview — {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl px-4 py-2">
              <div className="text-xs text-muted">Ops Mode</div>
              <div className="text-sm font-semibold">Enterprise</div>
            </div>
          </div>
        </div>

        {/* OPERATIONS */}
        <SectionCard
          title="Operations"
          right={<span className="text-xs text-muted">What is happening with transport operations right now?</span>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {opsKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* FINANCIALS */}
        <SectionCard
          title="Financials"
          right={<span className="text-xs text-muted">What is happening with the company's money?</span>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {finKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* RESOURCES */}
        <SectionCard
          title="Resources"
          right={<span className="text-xs text-muted">Do we have enough resources to operate?</span>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {resKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* NEEDS ATTENTION */}
        {needsAttentionCount > 0 && (
          <SectionCard
            title="Needs Attention"
            right={
              <button
                onClick={() => navigate('/admin/trips')}
                className="text-xs font-medium text-amber-600 hover:underline"
              >
                View all →
              </button>
            }
          >
            <div className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{needsAttentionCount} trip{needsAttentionCount !== 1 ? 's' : ''} require attention</span>
            </div>
          </SectionCard>
        )}

        {/* RECENT TRIPS */}
        <SectionCard
          title="Recent Trips"
          right={<span className="text-xs text-muted">Latest operational activity</span>}
        >
          {tripRows.length ? (
            <PremiumTable
              columns={tripColumns}
              rows={tripRows}
              loading={false}
              onRowClick={(row) => navigate(`/admin/trips/${row.trip_id}`)}
            />
          ) : (
            <EmptyState title="No recent trips" subtitle="Trips will appear here once created." />
          )}
        </SectionCard>
      </div>
    </AdminShell>
  );
}

export default AdminDashboard;
