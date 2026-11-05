import { useCallback, useEffect, useState, useContext } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Truck,
  Loader2,
  AlertCircle,
  Plus,
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
  { value: 'available', label: 'Available' },
  { value: 'on_trip', label: 'On Trip' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inactive', label: 'Inactive' },
];

const ITEMS_PER_PAGE = 10;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PartnerVehicles() {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    search: searchParams.get('search') || '',
    vehicle_type: searchParams.get('vehicle_type') || '',
  });

  const page = parseInt(searchParams.get('page')) || 1;

  const fetchVehicles = useCallback(async () => {
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
      Object.keys(params).forEach(key => params[key] === '' && delete params[key]);

      const response = await partnerAPI.getVehicles(params);
      if (response.data?.success) {
        setVehicles(response.data.data || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      } else if (Array.isArray(response.data)) {
        setVehicles(response.data);
      } else {
        throw new Error(response.data?.message || 'Failed to fetch vehicles');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load vehicles. Please try again.');
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

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
    setFilters({ status: '', search: '', vehicle_type: '' });
    setSearchParams({}, { replace: true });
  };

  const hasActiveFilters = Object.values(filters).some(v => v);

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Vehicles</p>
            <h2 className="mt-1 text-2xl font-bold text-[#15345B]">Fleet Management</h2>
            <p className="mt-1 text-sm text-[#15345B]/60">Manage your vehicle fleet.</p>
          </div>
          <Link
            to="/partner/vehicles/new"
            className="inline-flex items-center gap-2 rounded-xl border border-[#F5A000]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Vehicle
          </Link>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button onClick={fetchVehicles} className="font-semibold underline hover:decoration-red-500">Retry</button>
          </div>
        )}

        {/* Filters */}
        <SectionCard title="Filters" right={hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs font-semibold text-[#F5A000] hover:underline">Clear all</button>
        )}>
          <form onSubmit={handleSearch} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="search" className="sr-only">Search vehicles</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#15345B]/40" aria-hidden="true" />
                <input
                  type="search"
                  id="search"
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                  placeholder="Search by vehicle number, type..."
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
              <label htmlFor="vehicle_type" className="block text-xs font-semibold text-[#15345B]/60 mb-1">Type</label>
              <select
                id="vehicle_type"
                value={filters.vehicle_type}
                onChange={(e) => handleFilterChange('vehicle_type', e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#15345B]/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
              >
                <option value="">All Types</option>
                <option value="truck">Truck</option>
                <option value="pickup">Pickup</option>
                <option value="tempo">Tempo</option>
                <option value="container">Container</option>
                <option value="trailer">Trailer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </form>
        </SectionCard>

        {/* Vehicles List */}
        <SectionCard title={`Vehicles (${pagination.total || 0})`}>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <VehicleRowSkeleton key={i} />)}
            </div>
          ) : vehicles.length === 0 ? (
            <EmptyState
              title="No vehicles found"
              subtitle={hasActiveFilters ? 'Try adjusting your filters.' : 'No vehicles registered yet.'}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-[#15345B]/10 text-left text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">
                      <th className="pb-3 pr-4">Vehicle #</th>
                      <th className="pb-3 pr-4">Type</th>
                      <th className="pb-3 pr-4 hidden md:table-cell">Registration</th>
                      <th className="pb-3 pr-4 hidden lg:table-cell">Capacity</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3 pr-4 hidden md:table-cell">Driver</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#15345B]/8">
                    {vehicles.map((vehicle) => (
                      <VehicleRow key={vehicle.vehicle_id || vehicle.id} vehicle={vehicle} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 mt-4">
                {vehicles.map((vehicle) => (
                  <VehicleCard key={vehicle.vehicle_id || vehicle.id} vehicle={vehicle} />
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

function VehicleRow({ vehicle }) {
  const vehicleNumber = vehicle.vehicle_number || vehicle.registration_number || '—';
  const vehicleType = vehicle.vehicle_type || '—';
  const registrationNumber = vehicle.registration_number || vehicle.vehicle_number || '—';
  const capacity = vehicle.capacity_kg ? `${vehicle.capacity_kg} kg` : '—';
  const driverName = vehicle.driver?.name || vehicle.driver_name || '—';
  const status = vehicle.current_status || vehicle.status || 'available';

  return (
    <tr className="hover:bg-[#F5A000]/3 transition-colors">
      <td className="py-3 pr-4 font-semibold text-[#15345B]">{vehicleNumber}</td>
      <td className="py-3 pr-4">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#F5A000]/10 text-[#F5A000] text-xs font-medium">
          <Truck className="h-3 w-3" aria-hidden="true" />
          {vehicleType}
        </span>
      </td>
      <td className="py-3 pr-4 hidden md:table-cell text-[#15345B]/70">{registrationNumber}</td>
      <td className="py-3 pr-4 hidden lg:table-cell text-[#15345B]/60">{capacity}</td>
      <td className="py-3 pr-4">
        <StatusBadge status={status} size="sm" />
      </td>
      <td className="py-3 pr-4 hidden md:table-cell">
        <span className="flex items-center gap-1 text-[#15345B]/60">
          <Truck className="h-3.5 w-3.5" aria-hidden="true" />
          {driverName}
        </span>
      </td>
      <td className="py-3 text-right">
        <Link
          to={`/partner/vehicles/${vehicle.vehicle_id || vehicle.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
        >
          View
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

function VehicleCard({ vehicle }) {
  const vehicleNumber = vehicle.vehicle_number || vehicle.registration_number || '—';
  const vehicleType = vehicle.vehicle_type || '—';
  const registrationNumber = vehicle.registration_number || vehicle.vehicle_number || '—';
  const capacity = vehicle.capacity_kg ? `${vehicle.capacity_kg} kg` : '—';
  const driverName = vehicle.driver?.name || vehicle.driver_name || '—';
  const status = vehicle.current_status || vehicle.status || 'available';

  return (
    <Link
      to={`/partner/vehicles/${vehicle.vehicle_id || vehicle.id}`}
      className="block rounded-xl border border-[#15345B]/10 bg-white p-4 hover:border-[#F5A000]/30 hover:shadow-[0_4px_12px_rgba(245,166,35,0.1)] transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#15345B]">{vehicleNumber}</span>
            <StatusBadge status={status} size="sm" />
          </div>
          <p className="mt-1 truncate text-sm text-[#15345B]/70">{vehicleType} • {registrationNumber}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#15345B]/50">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3" aria-hidden="true" />
              {capacity}
            </span>
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3" aria-hidden="true" />
              {driverName}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-right">
          <ChevronRight className="h-4 w-4 text-[#F5A000]" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

function VehicleRowSkeleton() {
  return (
    <tr>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-5 w-32" /></td>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-4 w-24" /></td>
      <td className="py-3 pr-4 hidden md:table-cell"><LoadingSkeleton className="h-4 w-28" /></td>
      <td className="py-3 pr-4 hidden lg:table-cell"><LoadingSkeleton className="h-4 w-20" /></td>
      <td className="py-3 pr-4"><LoadingSkeleton className="h-5 w-20 rounded-full" /></td>
      <td className="py-3 pr-4 hidden md:table-cell"><LoadingSkeleton className="h-4 w-24" /></td>
      <td className="py-3"><LoadingSkeleton className="h-5 w-16" /></td>
    </tr>
  );
}