import { useCallback, useEffect, useState, useContext } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Truck,
  User,
  MapPin,
  Calendar,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { AuthContext } from '../contexts/AuthContext';
import { partnerAPI } from '../services/api';
import PartnerShell from '../components/partner/PartnerShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ITEMS_PER_PAGE = 10;

function formatTripDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export default function PartnerTrips() {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    search: searchParams.get('search') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
  });

  const page = parseInt(searchParams.get('page')) || 1;

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        sort_by: 'created_at',
        sort_order: 'desc',
        ...filters,
      };
      // Remove empty params
      Object.keys(params).forEach(key => params[key] === '' && delete params[key]);

      const response = await partnerAPI.getTrips(params);
      if (response.data?.success) {
        setTrips(response.data.data || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else if (Array.isArray(response.data)) {
        setTrips(response.data);
      } else {
        throw new Error(response.data?.message || 'Failed to fetch trips');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load trips. Please try again.');
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    const params = new URLSearchParams();
    Object.entries(newFilters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    handleFilterChange('search', e.target.value);
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    const params = new URLSearchParams(searchParams);
    params.set('page', String(newPage));
    setSearchParams(params, { replace: true });
  };

  const clearFilters = () => {
    setFilters({ status: '', search: '', date_from: '', date_to: '' });
    setSearchParams({}, { replace: true });
  };

  const hasActiveFilters = Object.values(filters).some(v => v);

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Trips</p>
            <h2 className="mt-1 text-2xl font-bold text-[#15345B]">All Trips</h2>
            <p className="mt-1 text-sm text-[#15345B]/60">Manage and track your transport operations.</p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button onClick={fetchTrips} className="font-semibold underline hover:decoration-red-500">Retry</button>
          </div>
        )}

        {/* Filters */}
        <SectionCard title="Filters" right={hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs font-semibold text-[#F5A000] hover:underline">Clear all</button>
        )}>
          <form onSubmit={handleSearch} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="search" className="sr-only">Search trips</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#15345B]/40" aria-hidden="true" />
                <input
                  type="search"
                  id="search"
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                  placeholder="Search by trip ID, route, vehicle, driver..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#15345B]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
                />
              </div>
            </div>

            <div className="w-full sm:w-48">
              <label htmlFor="status" className="block text-xs font-semibold text-[#15345B]/60 mb-1">Status</label>
              <select
                id="status"
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#15345B]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
              >
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            <div className="w-full sm:w-48">
              <label htmlFor="date_from" className="block text-xs font-semibold text-[#15345B]/60 mb-1">From</label>
              <input
                type="date"
                id="date_from"
                value={filters.date_from}
                onChange={(e) => handleFilterChange('date_from', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#15345B]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
              />
            </div>

            <div className="w-full sm:w-48">
              <label htmlFor="date_to" className="block text-xs font-semibold text-[#15345B]/60 mb-1">To</label>
              <input
                type="date"
                id="date_to"
                value={filters.date_to}
                onChange={(e) => handleFilterChange('date_to', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#15345B]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
              />
            </div>
          </form>
        </SectionCard>

        {/* Trips List */}
        <SectionCard title={`Trips (${pagination.total || 0})`}>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <TripRowSkeleton key={i} />)}
            </div>
          ) : trips.length === 0 ? (
            <EmptyState
              title="No trips found"
              subtitle={hasActiveFilters ? 'Try adjusting your filters.' : 'No trips recorded yet.'}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-[#15345B]/10 text-left text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">
                      <th className="pb-3 pr-4">Trip ID</th>
                      <th className="pb-3 pr-4 hidden md:table-cell">Route</th>
                      <th className="pb-3 pr-4 hidden lg:table-cell">Vehicle</th>
                      <th className="pb-3 pr-4 hidden lg:table-cell">Driver</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3 pr-4 hidden md:table-cell">Date</th>
                      <th className="pb-3 pr-4">Commission</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#15345B]/8">
                    {trips.map((trip) => (
                      <TripRow key={trip.booking_id || trip.id} trip={trip} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 mt-4">
                {trips.map((trip) => (
                  <TripCard key={trip.booking_id || trip.id} trip={trip} />
                ))}
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span className="px-4 text-sm font-medium text-[#15345B]/70">
                    Page {pagination.page} of {pagination.pages}
                  </span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </PartnerShell>
  );
}

function TripRow({ trip }) {
  const tripId = trip.booking_number || trip.bookingNumber || trip.trip_id || trip.id || '—';
  const routeText = [trip.pickup_city, trip.drop_city].filter(Boolean).join(' → ') || '—';
  const vehicleText = trip.vehicle?.registration_number || trip.vehicle_number || '—';
  const driverText = trip.driver?.name || trip.driver_name || '—';
  const amount = trip.commission_amount || 0;

  return (
    <tr className="hover:bg-[#F5A000]/3 transition-colors">
      <td className="py-3 pr-4 font-semibold text-[#15345B]">{tripId}</td>
      <td className="py-3 pr-4 hidden md:table-cell text-[#15345B]/70">{routeText}</td>
      <td className="py-3 pr-4 hidden lg:table-cell">
        <span className="flex items-center gap-1 text-[#15345B]/60">
          <Truck className="h-3.5 w-3.5" aria-hidden="true" />
          {vehicleText}
        </span>
      </td>
      <td className="py-3 pr-4 hidden lg:table-cell">
        <span className="flex items-center gap-1 text-[#15345B]/60">
          <User className="h-3.5 w-3.5" aria-hidden="true" />
          {driverText}
        </span>
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={trip.status} size="sm" />
      </td>
      <td className="py-3 pr-4 hidden md:table-cell text-[#15345B]/60">
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          {formatTripDate(trip.created_at || trip.pickup_date)}
        </span>
      </td>
      <td className="py-3 pr-4 font-medium text-[#15345B]">{amount > 0 ? formatCurrency(amount) : '—'}</td>
      <td className="py-3 text-right">
        <Link
          to={`/partner/trips/${trip.booking_id || trip.trip_id || trip.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
        >
          View
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

function TripCard({ trip }) {
  const tripId = trip.booking_number || trip.bookingNumber || trip.trip_id || trip.id || '—';
  const routeText = [trip.pickup_city, trip.drop_city].filter(Boolean).join(' → ') || '—';
  const vehicleText = trip.vehicle?.registration_number || trip.vehicle_number || '—';
  const driverText = trip.driver?.name || trip.driver_name || '—';
  const amount = trip.commission_amount || 0;

  return (
    <Link
      to={`/partner/trips/${trip.booking_id || trip.trip_id || trip.id}`}
      className="block rounded-xl border border-[#15345B]/10 bg-white p-4 hover:border-[#F5A000]/30 hover:shadow-[0_4px_12px_rgba(245,166,35,0.1)] transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#15345B]">{tripId}</span>
            {trip.status && <StatusBadge status={trip.status} size="sm" />}
          </div>
          <p className="mt-1 truncate text-sm text-[#15345B]/70">{routeText}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#15345B]/50">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3" aria-hidden="true" />
              {vehicleText}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" aria-hidden="true" />
              {driverText}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {formatTripDate(trip.created_at || trip.pickup_date)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-right">
          <span className="font-medium text-[#15345B]">{amount > 0 ? formatCurrency(amount) : '—'}</span>
          <ChevronRight className="h-4 w-4 text-[#F5A000]" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

function TripRowSkeleton() {
  return (
    <tr>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-5 w-32" /></td>
      <td className="py-3 pr-4 hidden md:table-cell"><LoadingSkeleton className="h-4 w-40" /></td>
      <td className="py-3 pr-4 hidden lg:table-cell"><LoadingSkeleton className="h-4 w-28" /></td>
      <td className="py-3 pr-4 hidden lg:table-cell"><LoadingSkeleton className="h-4 w-28" /></td>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-5 w-20 rounded-full" /></td>
      <td className="py-3 pr-4 hidden md:table-cell"><LoadingSkeleton className="h-4 w-24" /></td>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-5 w-20" /></td>
      <td className="py-3"><LoadingSkeleton className="h-5 w-16" /></td>
    </tr>
  );
}