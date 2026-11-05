import { useCallback, useContext, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CircleDollarSign,
  Clock3,
  DollarSign,
  PackageCheck,
  Route,
  Truck,
  Users,
  WalletCards,
  RefreshCw,
  ChevronRight,
  MapPin,
  Truck as TruckIcon,
  User,
  Loader2,
  AlertCircle,
  CheckCircle,
  MoreHorizontal,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';
import { partnerAPI } from '../services/api';
import PartnerShell from '../components/partner/PartnerShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

const statusStyles = {
  active: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  in_transit: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  assigned: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  completed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-700 border-red-500/20',
  suspended: 'bg-red-500/10 text-red-700 border-red-500/20',
  inactive: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value));
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatTripDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTimeAgo(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTripDate(value);
}

function getProgressPercent(status, trip) {
  // Calculate progress based on status
  const statusProgress = {
    assigned: 10,
    pending: 15,
    active: 30,
    in_transit: 60,
    in_progress: 60,
    loading: 70,
    unloading: 80,
    delivered: 95,
    completed: 100,
  };
  return statusProgress[status?.toLowerCase()] || 0;
}

function getStatusLabel(status) {
  const labels = {
    assigned: 'Assigned',
    pending: 'Pending',
    active: 'Active',
    in_transit: 'In Transit',
    in_progress: 'In Progress',
    loading: 'Loading',
    unloading: 'Unloading',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return labels[status?.toLowerCase()] || status || 'Unknown';
}

export default function PartnerDashboard() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [activeTrips, setActiveTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTripsLoading, setActiveTripsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const loadDashboard = useCallback(async () => {
    setRetrying(true);
    setError('');
    try {
      const response = await partnerAPI.getDashboard();
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Dashboard data is unavailable');
      }
      setDashboard(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load partner dashboard. Please try again.');
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  const loadActiveTrips = useCallback(async () => {
    setActiveTripsLoading(true);
    try {
      // Fetch trips with active/in-transit statuses
      const response = await partnerAPI.getTrips({ 
        status: 'active,in_transit,in_progress,assigned,pending,loading,unloading',
        limit: 10,
        sort_by: 'created_at',
        sort_order: 'desc'
      });
      if (response.data?.success && Array.isArray(response.data.data)) {
        setActiveTrips(response.data.data);
      } else if (Array.isArray(response.data)) {
        setActiveTrips(response.data);
      }
    } catch (err) {
      console.error('Failed to load active trips:', err);
      setActiveTrips([]);
    } finally {
      setActiveTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    loadActiveTrips();
  }, [loadDashboard, loadActiveTrips]);

  const partner = dashboard?.partner;
  const operations = dashboard?.operations;
  const fleet = dashboard?.fleet;
  const financials = dashboard?.financials;
  const recentTrips = Array.isArray(dashboard?.recentTrips) ? dashboard.recentTrips : [];
  const isLoading = loading || !dashboard;
  const partnerStatus = String(partner?.status || '').toLowerCase();
  const partnerStatusClass = statusStyles[partnerStatus] || 'bg-gray-500/10 text-gray-600 border-gray-500/20';

  const identityItems = [
    { label: 'Partner code', value: partner?.partner_code || '—' },
    { label: 'Status', value: partner?.status || '—' },
    { label: 'Account', value: user?.email || partner?.partner_name ? 'Verified partner' : '—' },
  ];

  // KPI Cards - Operations First
  const operationCards = [
    { title: 'Total Trips', value: formatNumber(operations?.totalTrips), sub: 'All partner trips', accent: 'blue', icon: Route, onClick: () => navigate('/partner/trips?status=all') },
    { title: 'Active Trips', value: formatNumber(operations?.activeTrips), sub: 'Currently in progress', accent: 'emerald', icon: Activity, onClick: () => navigate('/partner/trips?status=active') },
    { title: 'Pending Trips', value: formatNumber(operations?.pendingTrips), sub: 'Awaiting movement', accent: 'amber', icon: Clock3, onClick: () => navigate('/partner/trips?status=pending') },
    { title: 'Completed Trips', value: formatNumber(operations?.completedTrips), sub: 'Successfully completed', accent: 'sky', icon: PackageCheck, onClick: () => navigate('/partner/trips?status=completed') },
  ];

  // Financial KPI - only show if data exists
  const financialCards = financials ? [
    { title: 'Total Revenue', value: formatCurrency(financials?.totalRevenue), sub: 'Completed trip revenue', accent: 'amber', icon: DollarSign, onClick: () => navigate('/partner/financials') },
    { title: 'Commission Earned', value: formatCurrency(financials?.commission), sub: 'Partner earnings', accent: 'green', icon: WalletCards, onClick: () => navigate('/partner/financials?view=commission') },
    { title: 'Outstanding Balance', value: formatCurrency(financials?.outstandingBalance), sub: 'Current ledger balance', accent: 'rose', icon: WalletCards, onClick: () => navigate('/partner/financials?view=outstanding') },
    { title: 'Pending Settlement', value: formatCurrency(financials?.pendingSettlement), sub: 'Awaiting settlement', accent: 'red', icon: Clock3, onClick: () => navigate('/partner/financials?view=pending') },
  ] : [];

  // Fleet Cards
  const fleetCards = [
    { title: 'Total Vehicles', value: fleet?.totalVehicles === undefined ? 'Not available' : formatNumber(fleet.totalVehicles), sub: 'Partner fleet', accent: 'purple', icon: Truck, onClick: () => navigate('/partner/vehicles') },
    { title: 'Total Drivers', value: formatNumber(fleet?.totalDrivers), sub: 'Connected drivers', accent: 'green', icon: Users, onClick: () => navigate('/partner/drivers') },
  ];

  // Quick Actions - link to partner routes
  const quickActions = [
    { label: 'View Trips', href: '/partner/trips', icon: Route, description: 'Browse all trips' },
    { label: 'Vehicles', href: '/partner/vehicles', icon: Truck, description: 'Manage fleet' },
    { label: 'Drivers', href: '/partner/drivers', icon: Users, description: 'Manage drivers' },
    { label: 'Financials', href: '/partner/financials', icon: WalletCards, description: 'View ledger' },
  ];

  const greetingTime = new Date().getHours();
  const greeting = greetingTime < 12 ? 'Good morning' : greetingTime < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">PARTNER WORKSPACE</p>
            <h2 className="mt-1 text-2xl font-bold text-[#15345B] sm:text-3xl">
              {greeting}, {partner?.partner_name || user?.first_name || 'Partner'}
            </h2>
            <p className="mt-1 text-sm text-[#15345B]/60">Here's what's happening with your transport operations.</p>
          </div>
          <button
            type="button"
            onClick={() => { loadDashboard(); loadActiveTrips(); }}
            disabled={retrying}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#F5A000]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button type="button" onClick={loadDashboard} className="font-semibold underline decoration-red-300 underline-offset-2 hover:decoration-red-500">Retry</button>
            </div>
          </div>
        )}

        {/* KPI Cards - Operations */}
        <section aria-labelledby="operations-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Operations</p>
              <h2 id="operations-heading" className="mt-1 text-lg font-bold text-[#15345B]">Trip activity</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }, (_, index) => <KpiCard key={index} title="Loading" loading accent="slate" />)
              : operationCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <KpiCard
                      key={card.title}
                      title={card.title}
                      value={card.value}
                      sub={card.sub}
                      accent={card.accent}
                      ariaLabel={`${card.title}: ${card.value}`}
                      onClick={card.onClick}
                    >
                      <Icon className="h-4 w-4" />
                    </KpiCard>
                  );
                })}
          </div>
        </section>

        {/* Financial Summary - only if data available */}
        {financialCards.length > 0 && (
          <section aria-labelledby="financials-heading">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Financial summary</p>
                <h2 id="financials-heading" className="mt-1 text-lg font-bold text-[#15345B]">Partner ledger</h2>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {isLoading
                ? Array.from({ length: 4 }, (_, index) => <KpiCard key={index} title="Loading" loading accent="slate" />)
                : financialCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <KpiCard
                        key={card.title}
                        title={card.title}
                        value={card.value}
                        sub={card.sub}
                        accent={card.accent}
                        ariaLabel={`${card.title}: ${card.value}`}
                        onClick={card.onClick}
                      >
                        <Icon className="h-4 w-4" />
                      </KpiCard>
                    );
                  })}
            </div>
          </section>
        )}

        {/* Active Operations Section */}
        <section aria-labelledby="active-ops-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Active operations</p>
              <h2 id="active-ops-heading" className="mt-1 text-lg font-bold text-[#15345B]">Trips in progress</h2>
            </div>
            <Link
              to="/partner/trips?status=active"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
            >
              View all
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {activeTripsLoading ? (
            <div className="space-y-3">
              <ActiveTripSkeleton />
              <ActiveTripSkeleton />
              <ActiveTripSkeleton />
            </div>
          ) : activeTrips.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#15345B]/15 bg-[#F8FAFC] p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F5A000]/10">
                <TruckIcon className="h-7 w-7 text-[#F5A000]" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold text-[#15345B] mb-1">No active trips</h3>
              <p className="text-sm text-[#15345B]/60 mb-4">Your active trips will appear here when a trip starts.</p>
              <Link
                to="/partner"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
              >
                View Trips
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {activeTrips.map((trip, index) => (
                <ActiveTripCard key={trip.booking_id || trip.trip_id || trip.id || index} trip={trip} />
              ))}
            </div>
          )}
        </section>

        {/* Fleet Overview */}
        <section aria-labelledby="fleet-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Fleet</p>
              <h2 id="fleet-heading" className="mt-1 text-lg font-bold text-[#15345B]">Vehicles and drivers</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 2 }, (_, index) => <KpiCard key={index} title="Loading" loading accent="slate" />)
              : fleetCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <KpiCard
                      key={card.title}
                      title={card.title}
                      value={card.value}
                      sub={card.sub}
                      accent={card.accent}
                      ariaLabel={`${card.title}: ${card.value}`}
                      onClick={card.onClick}
                    >
                      <Icon className="h-4 w-4" />
                    </KpiCard>
                  );
                })}
          </div>
        </section>

        {/* Recent Trips */}
        <SectionCard
          title="Recent Trips"
          right={
            <Link
              to="/partner/trips?status=all"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#15345B]/60 hover:text-[#F5A000]"
            >
              {isLoading ? 'Loading...' : `${recentTrips.length} shown`}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          {isLoading ? (
            <div className="space-y-3">
              <LoadingSkeleton className="h-14" />
              <LoadingSkeleton className="h-14" />
              <LoadingSkeleton className="h-14" />
            </div>
          ) : recentTrips.length === 0 ? (
            <EmptyState
              title="No recent trips"
              subtitle="Trip activity will appear here as bookings are created."
            />
          ) : (
            <div className="divide-y divide-[#15345B]/8">
              {recentTrips.map((trip, index) => {
                const tripName = trip.booking_number || trip.bookingNumber || trip.trip_id || trip.id || `Trip ${index + 1}`;
                const routeText = [trip.pickup_city, trip.drop_city].filter(Boolean).join(' → ') || 'Route details unavailable';
                const vehicleText = trip.vehicle?.registration_number || trip.vehicle_number || '—';
                const driverText = trip.driver?.name || trip.driver_name || '—';
                const tripId = trip.booking_id || trip.trip_id || trip.id;
                return (
                  <Link
                    key={tripId || index}
                    to={tripId ? `/partner/trips/${tripId}` : '#'}
                    className="block rounded-xl border border-transparent p-1 -m-1 hover:border-[#F5A000]/20 hover:bg-[#F5A000]/3 transition-all"
                  >
                    <div className="flex flex-col gap-3 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#15345B]">{tripName}</span>
                          {trip.status && <StatusBadge status={trip.status} size="sm" />}
                        </div>
                        <p className="mt-1 truncate text-sm text-[#15345B]/60">{routeText}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[#15345B]/50">
                          <span className="flex items-center gap-1">
                            <TruckIcon className="h-3 w-3" aria-hidden="true" />
                            {vehicleText}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" aria-hidden="true" />
                            {driverText}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-xs text-[#15345B]/50">
                        <span>{formatTripDate(trip.created_at || trip.pickup_date)}</span>
                        <ChevronRight className="h-4 w-4 text-[#F5A000]" aria-hidden="true" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* Quick Actions */}
        <section aria-labelledby="quick-actions-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Quick actions</p>
            <h2 id="quick-actions-heading" className="mt-1 text-lg font-bold text-[#15345B]">Common tasks</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                to={action.href}
                className={`group flex items-center gap-3 rounded-xl border p-4 transition-all ${
                  action.disabled
                    ? 'border-[#15345B]/8 bg-[#F8FAFC] text-[#15345B]/40 cursor-not-allowed'
                    : 'border-[#15345B]/10 bg-white hover:border-[#F5A000]/30 hover:bg-[#F5A000]/5 hover:shadow-[0_4px_12px_rgba(245,166,35,0.1)]'
                }`}
                aria-disabled={action.disabled}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  action.disabled
                    ? 'bg-[#15345B]/5 text-[#15345B]/40'
                    : 'bg-[#F5A000]/10 text-[#F5A000] group-hover:bg-[#F5A000]/20'
                }`}>
                  <action.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className={`font-semibold text-sm ${action.disabled ? 'text-[#15345B]/40' : 'text-[#15345B]'}`}>{action.label}</p>
                  <p className={`text-xs ${action.disabled ? 'text-[#15345B]/30' : 'text-[#15345B]/60'}`}>{action.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PartnerShell>
  );
}

// Active Trip Card Component
function ActiveTripCard({ trip }) {
  const status = trip.status?.toLowerCase() || 'unknown';
  const progress = getProgressPercent(status, trip);
  const statusLabel = getStatusLabel(status);
  const statusClass = statusStyles[status] || 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  const tripId = trip.booking_number || trip.bookingNumber || trip.trip_id || trip.id || '—';
  const routeText = [trip.pickup_city, trip.drop_city].filter(Boolean).join(' → ') || 'Route details unavailable';
  const vehicleText = trip.vehicle?.registration_number || trip.vehicle_number || '—';
  const driverText = trip.driver?.name || trip.driver_name || '—';

  return (
    <div className="rounded-xl border border-[#15345B]/10 bg-white p-4 transition-all hover:border-[#F5A000]/30 hover:shadow-[0_4px_12px_rgba(15,43,85,0.06)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#15345B]">TRIP #{tripId}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-[#15345B]/70">{routeText}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[#15345B]/50">
            <span className="flex items-center gap-1">
              <TruckIcon className="h-3 w-3" aria-hidden="true" />
              {vehicleText}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" aria-hidden="true" />
              {driverText}
            </span>
          </div>
        </div>

        {/* Progress */}
        <div className="w-full sm:w-64 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[#15345B]/60">Progress</span>
            <span className="text-xs font-semibold text-[#F5A000]">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#15345B]/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#F5A000] to-[#e8941a] transition-all duration-500"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Trip progress"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[#15345B]/8 flex items-center justify-end">
        <Link
          to={`/partner/trips/${trip.booking_id || trip.trip_id || trip.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
        >
          View Trip
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

// Skeleton for Active Trip Card
function ActiveTripSkeleton() {
  return (
    <div className="rounded-xl border border-[#15345B]/10 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-5 w-48 bg-skeleton animate-pulse rounded" />
          <div className="h-4 w-64 bg-skeleton animate-pulse rounded" />
          <div className="h-3 w-40 bg-skeleton animate-pulse rounded" />
        </div>
        <div className="w-full sm:w-64 shrink-0 space-y-2">
          <div className="h-3 w-16 bg-skeleton animate-pulse rounded" />
          <div className="h-2 rounded-full bg-[#15345B]/10 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-skeleton animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
