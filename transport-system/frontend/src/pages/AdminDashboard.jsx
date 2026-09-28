import { useEffect, useState, useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Users, Wallet, Route, AlertTriangle, Package, UserRound } from 'lucide-react';
import { AuthContext } from '../contexts/AuthContext';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import { PageHeader, Button } from '../components/admin-premium/ui/AdminUI';
import { SkeletonKpis, SkeletonTable } from '../components/admin-premium/ui/LoadingSkeleton';
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

  /**
   * The dashboard's KPI tile.
   *
   * It is now the SAME KpiCard every other module uses, so a number on this
   * page has exactly the same anatomy as a number in Drivers or Financials.
   * The only local concern left is honesty about failure: a tile whose request
   * failed says so rather than rendering a fake zero.
   */
  const DashboardKpi = ({ label, value, sub, onClick, loading, error, accent, icon }) => {
    if (error) {
      return (
        <div className="bt-kpi border-bt-danger/40 bg-bt-danger-bg">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-bt-danger" aria-hidden="true" />
          <div className="bt-kpi-label">
            <span className="bt-kpi-dot bg-bt-danger" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </div>
          <p className="bt-kpi-error text-bt-danger">Unable to load</p>
        </div>
      );
    }

    return (
      <KpiCard
        title={label}
        value={value}
        sub={sub}
        accent={accent}
        icon={icon}
        loading={loading}
        onClick={onClick}
        ariaLabel={`${label}: ${value}`}
      />
    );
  };

  // Operations KPIs
  const opsKpis = useMemo(() => [
    {
      label: 'Active Trips',
      value: fmt(tripSummary?.inTransit ?? dashboard?.stats?.activeDeliveries ?? 0),
      sub: 'Currently running',
      accent: 'emerald',
      icon: Route,
      onClick: () => navigate('/admin/trips?status=IN_TRANSIT'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Pending Trips',
      value: fmt(tripSummary?.pending ?? dashboard?.stats?.pendingBookings ?? 0),
      sub: 'Needs attention',
      accent: 'amber',
      icon: AlertTriangle,
      onClick: () => navigate('/admin/trips?status=PENDING'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Total Bookings',
      value: fmt(dashboard?.stats?.totalBookings ?? 0),
      sub: 'All time',
      accent: 'navy',
      icon: Package,
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
      icon: Wallet,
      onClick: () => navigate('/admin/financials?view=overview'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Customer Due',
      value: fmtCurrency(tripSummary?.customerDue ?? 0),
      sub: 'Pending receivables',
      accent: 'red',
      icon: Wallet,
      onClick: () => navigate('/admin/financials?view=client-receivable'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'Owner Outstanding',
      value: fmtCurrency(tripSummary?.ownerOutstanding ?? 0),
      sub: 'Payable to owners',
      accent: 'sky',
      icon: Wallet,
      onClick: () => navigate('/admin/financials?view=provider-payable'),
      loading: loading || !tripSummary,
      error: errors.tripSummary,
    },
    {
      label: 'BT Net Profit',
      value: fmtCurrency(tripSummary?.totalProfit ?? 0),
      sub: 'After payouts',
      accent: 'green',
      icon: Wallet,
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
      icon: Truck,
      onClick: () => navigate('/admin/vehicles'),
      loading: loading || !vehicleStats,
      error: errors.vehicleStats,
    },
    {
      label: 'Available Drivers',
      value: fmt(driverStats?.available ?? 0),
      sub: 'Currently available',
      accent: 'navy',
      icon: Users,
      onClick: () => navigate('/admin/drivers'),
      loading: loading || !driverStats,
      error: errors.driverStats,
    },
    {
      label: 'Transport Owners',
      value: fmt(ownerStats?.activeOwners ?? 0),
      sub: 'Active owners',
      accent: 'orange',
      icon: UserRound,
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
      // ENQUIRY — the operational quote queue over real Bookings. Sits above
      // Bookings because an unanswered request is what needs attention first.
      // The `enquiries` key is what makes AdminSidebar render the live
      // pending-enquiry badge.
      { key: 'enquiries', label: 'ENQUIRY', icon: '◉', path: '/admin/enquiries' },
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
        <div className="bt-dash space-y-3">
          <div>
            <div className="h-7 w-48 bt-skeleton rounded-lg" />
            <div className="mt-2.5 h-3.5 w-80 max-w-full bt-skeleton rounded" />
          </div>
          <SkeletonKpis count={3} />
          <SkeletonKpis count={4} />
          <SkeletonTable rows={6} />
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={navItems} activeKey="dashboard" onNav={() => {}}>
      {/*
        `bt-dash` activates the Dashboard density scope in index.css. It is
        applied here and nowhere else, so the compressed vertical rhythm is
        this page's alone — every other module keeps the shared spacing.
        `lg:-mt-2` recovers a little of AdminShell's top padding on desktop
        without letting the header crowd the sticky top bar on mobile.
      */}
      <div className="bt-dash space-y-3 lg:-mt-2">
        {/* HEADER — the same PageHeader every module uses, tighter spacing */}
        <PageHeader
          className="!mb-3"
          eyebrow="Operations Console"
          title="Dashboard"
          description={`Live operational and financial overview for ${new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}.`}
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/reports')}>
              View Reports
            </Button>
          }
        />

        {/* OPERATIONS */}
        <SectionCard
          title="Operations"
          icon={Route}
          subtitle="What is happening across transport operations right now."
          bodyClass="!p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {opsKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* FINANCIALS */}
        <SectionCard
          title="Financials"
          icon={Wallet}
          subtitle="Freight, receivables, payables and net position across all trips."
          bodyClass="!p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {finKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* RESOURCES */}
        <SectionCard
          title="Resources"
          icon={Truck}
          subtitle="Whether the fleet, drivers and owners on record can carry today's load."
          bodyClass="!p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resKpis.map((k) => (
              <DashboardKpi key={k.label} {...k} />
            ))}
          </div>
        </SectionCard>

        {/* NEEDS ATTENTION */}
        {needsAttentionCount > 0 && (
          <SectionCard
            className="!mt-5"
            title="Needs Attention"
            icon={AlertTriangle}
            subtitle="Trips currently stalled and waiting on an operator."
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/admin/trips')}>
                View all
              </Button>
            }
          >
            <div className="flex items-center gap-3 text-[13px] text-bt-navy">
              <span className="bt-kpi-dot bg-bt-orange" aria-hidden="true" />
              <span>
                {needsAttentionCount} trip{needsAttentionCount !== 1 ? 's' : ''} require
                attention
              </span>
            </div>
          </SectionCard>
        )}

        {/* RECENT TRIPS */}
        <SectionCard
          className="!mt-5"
          title="Recent Trips"
          icon={Route}
          subtitle="The latest operational activity across the network."
          padded={false}
          bodyClass="p-4"
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
