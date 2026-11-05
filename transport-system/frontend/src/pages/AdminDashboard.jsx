import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  FileWarning,
  Handshake,
  Layers3,
  Package,
  Route,
  Truck,
  UserCheck,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';

import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';
import {
  DashboardHero,
  DashboardMetricCard,
  DashboardSection,
} from '../components/admin-premium/dashboard/DashboardPrimitives';

const CORE_ENDPOINTS = ['dashboard', 'tripSummary', 'vehicleStats', 'driverStats', 'ownerStats'];

function AdminDashboard() {
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
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const requestId = useRef(0);
  const hasLoadedOnce = useRef(false);

  const fetchAll = useCallback(async () => {
    const id = ++requestId.current;
    const firstLoad = !hasLoadedOnce.current;

    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    setErrors({});

    try {
      const [dashRes, tripSumRes, tripsRes, vehRes, drvRes, ownRes] = await Promise.allSettled([
        adminAPI.getDashboard(),
        adminAPI.getTripSummary(),
        adminAPI.getTrips({ page: 1, limit: 8, sort_by: 'created_at', sort_order: 'desc' }),
        adminAPI.getVehicleStats(),
        adminAPI.getDriverStats(),
        adminAPI.getVehicleOwnerStats(),
      ]);

      if (requestId.current !== id) return;

      const nextErrors = {};
      let successes = 0;

      const apply = (result, key, setter, extract) => {
        if (result.status === 'fulfilled' && result.value?.data?.success) {
          const data = result.value.data.data;
          setter(extract ? extract(data) : data);
          successes += 1;
        } else {
          nextErrors[key] =
            result.reason?.message ||
            result.value?.data?.message ||
            'Failed to load';
        }
      };

      apply(dashRes, 'dashboard', setDashboard);
      apply(tripSumRes, 'tripSummary', setTripSummary);
      apply(tripsRes, 'recentTrips', setRecentTrips, (data) => data || []);
      apply(vehRes, 'vehicleStats', setVehicleStats);
      apply(drvRes, 'driverStats', setDriverStats);
      apply(ownRes, 'ownerStats', setOwnerStats);

      setErrors(nextErrors);
      if (successes > 0) setLastUpdated(new Date());
      hasLoadedOnce.current = true;
    } catch (err) {
      if (requestId.current !== id) return;
      setErrors((current) => ({ ...current, global: err.message }));
    } finally {
      if (requestId.current === id) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return () => {
      // Invalidate any in-flight request when the page unmounts.
      requestId.current += 1;
    };
  }, [fetchAll]);

  // Keep the relative "last updated" chip honest without polling the APIs.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Formatters
  const fmt = useCallback((n) => {
    if (n === null || n === undefined) return null;
    const value = Number(n);
    if (!Number.isFinite(value)) return null;
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
  }, []);

  const fmtCurrency = useCallback((n) => {
    if (n === null || n === undefined) return null;
    const value = Number(n);
    if (!Number.isFinite(value)) return null;
    const sign = value < 0 ? '-' : '';
    return `${sign}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
      Math.abs(value)
    )}`;
  }, []);

  const fmtDate = useCallback((d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, []);

  // Real values. Each KPI prefers its canonical trip-summary figure and falls
  // back to the equivalent admin-dashboard figure when that response is down.
  const activeTrips = tripSummary?.inTransit ?? dashboard?.stats?.activeDeliveries ?? null;
  const pendingTrips = tripSummary?.pending ?? dashboard?.stats?.pendingBookings ?? null;
  const totalBookings = dashboard?.stats?.totalBookings ?? null;

  const totalFreight = tripSummary?.totalFreight ?? dashboard?.stats?.totalFreight ?? null;
  const customerDue = tripSummary?.customerDue ?? dashboard?.stats?.customerDue ?? null;
  const ownerOutstanding = tripSummary?.ownerOutstanding ?? dashboard?.stats?.ownerOutstanding ?? null;
  const netProfit = tripSummary?.totalProfit ?? dashboard?.stats?.totalBtNetProfit ?? null;

  const operationsDataMissing = tripSummary == null && dashboard == null;
  const financialDataMissing = tripSummary == null && dashboard == null;

  const operationsError = activeTrips == null ? errors.tripSummary || errors.dashboard : null;
  const pendingError = pendingTrips == null ? errors.tripSummary || errors.dashboard : null;
  const bookingsError = totalBookings == null ? errors.dashboard : null;

  const freightError = totalFreight == null ? errors.tripSummary || errors.dashboard : null;
  const customerDueError = customerDue == null ? errors.tripSummary || errors.dashboard : null;
  const ownerOutstandingError =
    ownerOutstanding == null ? errors.tripSummary || errors.dashboard : null;
  const netProfitError = netProfit == null ? errors.tripSummary || errors.dashboard : null;

  const vehicleError = vehicleStats?.available == null ? errors.vehicleStats : null;
  const driverError = driverStats?.available == null ? errors.driverStats : null;
  const ownerError = ownerStats?.activeOwners == null ? errors.ownerStats : null;

  const coreErrorCount = CORE_ENDPOINTS.filter((key) => Boolean(errors[key])).length;
  const liveTone =
    coreErrorCount >= 3 ? 'danger' : coreErrorCount > 0 ? 'amber' : 'emerald';
  const liveLabel = loading
    ? 'Loading operations'
    : coreErrorCount >= 3
      ? 'Data unavailable'
      : coreErrorCount > 0
        ? 'Partial data'
        : 'Live Operations';

  const date = new Date(now);
  const dateLabel = date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dateChip = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return 'Not updated yet';
    const minutes = Math.max(0, Math.floor((now - lastUpdated.getTime()) / 60000));
    if (minutes < 1) return 'Last updated just now';
    if (minutes < 60) return `Last updated ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `Last updated ${days} day${days === 1 ? '' : 's'} ago`;
  }, [lastUpdated, now]);

  const opsCards = useMemo(
    () => [
      {
        key: 'active',
        label: 'Active Trips',
        value: fmt(activeTrips),
        caption: 'Currently running',
        status: 'Live',
        tone: 'emerald',
        icon: Truck,
        watermark: Truck,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'operations',
        onClick: () => navigate('/admin/bookings/active-trips'),
        loading: loading || (operationsDataMissing && !operationsError),
        error: operationsError,
        sparkVariant: 0,
      },
      {
        key: 'pending',
        label: 'Pending Trips',
        value: fmt(pendingTrips),
        caption: 'Needs attention',
        status: 'Pending',
        tone: 'amber',
        icon: FileWarning,
        watermark: AlertTriangle,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'operations',
        onClick: () => navigate('/admin/bookings'),
        loading: loading || (operationsDataMissing && !pendingError),
        error: pendingError,
        sparkVariant: 1,
      },
      {
        key: 'bookings',
        label: 'Total Bookings',
        value: fmt(totalBookings),
        caption: 'All time',
        status: 'All time',
        tone: 'blue',
        icon: Package,
        watermark: Package,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'operations',
        onClick: () => navigate('/admin/bookings'),
        loading: loading || (dashboard == null && !bookingsError),
        error: bookingsError,
        sparkVariant: 2,
      },
    ],
    [
      activeTrips,
      pendingTrips,
      totalBookings,
      fmt,
      loading,
      operationsDataMissing,
      dashboard,
      operationsError,
      pendingError,
      bookingsError,
      navigate,
    ]
  );

  const finCards = useMemo(
    () => [
      {
        key: 'freight',
        label: 'Total Freight',
        value: fmtCurrency(totalFreight),
        caption: 'Across trips',
        tone: 'amber',
        icon: Truck,
        watermark: '₹',
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'financial',
        onClick: () => navigate('/admin/financials'),
        loading: loading || (financialDataMissing && !freightError),
        error: freightError,
        sparkVariant: 1,
      },
      {
        key: 'customer-due',
        label: 'Customer Due',
        value: fmtCurrency(customerDue),
        caption: 'Pending receivables',
        tone: 'red',
        icon: UsersRound,
        watermark: UsersRound,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'financial',
        onClick: () => navigate('/admin/financials/client-receivables'),
        loading: loading || (financialDataMissing && !customerDueError),
        error: customerDueError,
        sparkVariant: 2,
      },
      {
        key: 'owner-outstanding',
        label: 'Owner Outstanding',
        value: fmtCurrency(ownerOutstanding),
        caption: 'Payable to owners',
        tone: 'blue',
        icon: UserRound,
        watermark: UserRound,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'financial',
        onClick: () => navigate('/admin/financials/provider-payables'),
        loading: loading || (financialDataMissing && !ownerOutstandingError),
        error: ownerOutstandingError,
        sparkVariant: 0,
      },
      {
        key: 'net-profit',
        label: 'BT Net Profit',
        value: fmtCurrency(netProfit),
        caption: 'After payouts',
        tone: 'green',
        icon: BarChart3,
        watermark: BarChart3,
        watermarkClass: 'text-[#DDE7F3]',
        layout: 'financial',
        onClick: () => navigate('/admin/financials'),
        loading: loading || (financialDataMissing && !netProfitError),
        error: netProfitError,
        sparkVariant: 3,
      },
    ],
    [
      totalFreight,
      customerDue,
      ownerOutstanding,
      netProfit,
      fmtCurrency,
      loading,
      financialDataMissing,
      freightError,
      customerDueError,
      ownerOutstandingError,
      netProfitError,
      navigate,
    ]
  );

  const resCards = useMemo(
    () => [
      {
        key: 'vehicles',
        label: 'Available Vehicles',
        value: fmt(vehicleStats?.available),
        caption: 'Ready for assignment',
        tone: 'blue',
        icon: Truck,
        watermark: Truck,
        layout: 'resources',
        onClick: () => navigate('/admin/vehicles'),
        loading: loading || (vehicleStats == null && !vehicleError),
        error: vehicleError,
        sparkVariant: 2,
      },
      {
        key: 'drivers',
        label: 'Available Drivers',
        value: fmt(driverStats?.available),
        caption: 'On duty / ready',
        tone: 'green',
        icon: UserCheck,
        watermark: UserRound,
        layout: 'resources',
        onClick: () => navigate('/admin/drivers'),
        loading: loading || (driverStats == null && !driverError),
        error: driverError,
        sparkVariant: 0,
      },
      {
        key: 'owners',
        label: 'Transport Owners',
        value: fmt(ownerStats?.activeOwners),
        caption: 'Active partners',
        tone: 'amber',
        icon: Handshake,
        watermark: UsersRound,
        layout: 'resources',
        onClick: () => navigate('/admin/owners'),
        loading: loading || (ownerStats == null && !ownerError),
        error: ownerError,
        sparkVariant: 3,
      },
    ],
    [
      vehicleStats,
      driverStats,
      ownerStats,
      fmt,
      loading,
      vehicleError,
      driverError,
      ownerError,
      navigate,
    ]
  );

  // Recent trips table columns (unchanged data contract).
  const tripColumns = useMemo(
    () => [
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
                <div className="font-medium">
                  {r.user.first_name} {r.user.last_name}
                </div>
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
            <svg
              className="w-3 h-3 text-muted shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
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
        render: (r) => (
          <span className="font-semibold">{fmtCurrency(r.freight_amount) ?? '—'}</span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        render: (r) => (
          <span className="text-sm text-muted">{fmtDate(r.trip_date || r.created_at)}</span>
        ),
      },
    ],
    [fmtCurrency, fmtDate]
  );

  const tripRows = useMemo(
    () => recentTrips.map((t) => ({ ...t, id: t.trip_id })),
    [recentTrips]
  );

  const needsAttentionCount = tripSummary?.needsAttention ?? 0;

  // Initial load: a premium skeleton that mirrors the final composition.
  if (loading) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="dashboard">
        <div className="bt-dash -mt-4 lg:-mt-5" aria-busy="true" aria-label="Loading dashboard">
          <div className="relative -mx-4 min-h-[206px] overflow-hidden bg-[#F7FBFF] px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#FFFFFF_0%,#F5FAFF_48%,#EAF4FF_100%)]" />
            <div className="relative">
              <div className="h-3 w-32 bt-skeleton rounded" />
              <div className="mt-3 h-11 w-56 max-w-full bt-skeleton rounded-lg" />
              <div className="mt-3 h-4 w-80 max-w-full bt-skeleton rounded" />
              <div className="mt-5 flex flex-wrap gap-2">
                <div className="h-9 w-32 bt-skeleton rounded-full" />
                <div className="h-9 w-28 bt-skeleton rounded-full" />
                <div className="h-9 w-40 bt-skeleton rounded-full" />
              </div>
            </div>
          </div>

          <div className="space-y-3.5">
            {[3, 4, 3].map((count, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-[18px] border border-[#E4ECF7] bg-white shadow-[0_2px_18px_rgba(16,43,76,0.045)]"
              >
                <div className="flex items-start gap-3 px-4 pb-3.5 pt-4 sm:px-5 sm:pb-4 sm:pt-5">
                  <div className="h-11 w-11 shrink-0 bt-skeleton rounded-[12px]" />
                  <div className="min-w-0 pt-1">
                    <div className="h-5 w-40 bt-skeleton rounded" />
                    <div className="mt-2 h-3.5 w-72 max-w-full bt-skeleton rounded" />
                  </div>
                </div>
                <div
                  className={`grid gap-3 px-4 pb-4 sm:px-5 ${
                    index === 1
                      ? 'sm:grid-cols-2 xl:grid-cols-4'
                      : 'sm:grid-cols-2 lg:grid-cols-3'
                  }`}
                >
                  {Array.from({ length: count }).map((_, cardIndex) => (
                    <div
                      key={cardIndex}
                      className="min-h-[146px] rounded-[12px] border border-[#E6EDF6] bg-[#FBFDFF] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-[38px] w-[38px] bt-skeleton rounded-[10px]" />
                        <div className="min-w-0 pt-1">
                          <div className="h-3.5 w-28 bt-skeleton rounded" />
                          <div className="mt-2 h-3 w-20 bt-skeleton rounded" />
                        </div>
                      </div>
                      <div className="mt-7 h-8 w-24 bt-skeleton rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="dashboard">
      <div className="bt-dash" aria-busy={refreshing || undefined}>
        <DashboardHero
          dateLabel={dateLabel}
          dateChip={dateChip}
          lastUpdatedLabel={lastUpdatedLabel}
          liveLabel={liveLabel}
          liveTone={liveTone}
          onViewReports={() => navigate('/admin/reports')}
          onRefresh={fetchAll}
          refreshing={refreshing}
        />

        <div className="space-y-3.5">
          <DashboardSection
            title="Operations"
            icon={Layers3}
            subtitle="What is happening across transport operations right now."
            actionLabel="View All Operations"
            onAction={() => navigate('/admin/bookings')}
            bodyClassName="px-4 pb-6 sm:px-5 sm:pb-[22px]"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {opsCards.map(({ key, ...card }) => (
                <DashboardMetricCard key={key} {...card} />
              ))}
            </div>
          </DashboardSection>

          <DashboardSection
            title="Financials"
            icon={WalletCards}
            subtitle="Freight, receivables, payables and net position across all trips."
            actionLabel="View Financial Reports"
            onAction={() => navigate('/admin/financials')}
            bodyClassName="px-4 pb-4 sm:px-5 sm:pb-3.5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {finCards.map(({ key, ...card }) => (
                <DashboardMetricCard key={key} {...card} />
              ))}
            </div>
          </DashboardSection>

          <DashboardSection
            title="Resources"
            icon={UsersRound}
            subtitle="Whether the fleet, drivers and owners on record can carry today's load."
            actionLabel="View Resource Details"
            onAction={() => navigate('/admin/vehicles')}
            bodyClassName="px-4 pb-4 sm:px-5 sm:pb-[15px]"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {resCards.map(({ key, ...card }) => (
                <DashboardMetricCard key={key} {...card} />
              ))}
            </div>
          </DashboardSection>

          {needsAttentionCount > 0 && (
            <DashboardSection
              title="Needs Attention"
              icon={AlertTriangle}
              subtitle="Trips currently stalled and waiting on an operator."
              actionLabel="View Bookings"
              onAction={() => navigate('/admin/bookings')}
            >
              <div className="flex flex-col gap-3 rounded-[12px] border border-[#FDE7C3] bg-[#FFF9EE] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF1D6] text-[#D98900]">
                    <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#0B2B52]">
                      {needsAttentionCount} trip{needsAttentionCount !== 1 ? 's' : ''} require
                      attention
                    </p>
                    <p className="text-[12px] text-[#7A6A4A]">
                      Stalled trips are waiting on an operator.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/admin/bookings')}
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-[9px] border border-[#F3D39A] bg-white px-3 py-2 text-[12px] font-semibold text-[#8C5600] transition-colors hover:border-[#E7B95E] hover:bg-[#FFFDF8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A000]/30 sm:self-auto"
                >
                  Review now
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </DashboardSection>
          )}

          <DashboardSection
            title="Recent Trips"
            icon={Route}
            subtitle="The latest operational activity across the network."
            actionLabel="View All Trips"
            onAction={() => navigate('/admin/bookings')}
          >
            {tripRows.length ? (
              <PremiumTable
                columns={tripColumns}
                rows={tripRows}
                loading={false}
                onRowClick={(row) => navigate(`/admin/trips/${row.trip_id}`)}
              />
            ) : (
              <EmptyState
                title="No recent trips"
                subtitle="Trips will appear here once created."
              />
            )}
          </DashboardSection>
        </div>
      </div>
    </AdminShell>
  );
}

export default AdminDashboard;
