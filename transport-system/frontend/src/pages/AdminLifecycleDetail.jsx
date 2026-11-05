/**
 * AdminLifecycleDetail.jsx
 * Reusable detail page for lifecycle categories
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  CalendarDays,
  MapPin,
} from 'lucide-react';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import { Badge, ActionButton } from '../components/admin-premium/orders/orderUi';
import { inr, routeLine, customerName, formatDate, na } from '../utils/orderFormat';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

const PAGE_SIZE = 25;

const CATEGORY_CONFIG = {
  overview: { title: 'Total Orders', stage: 'ALL', icon: '📊' },
  'active-trips': { title: 'Active Trips', stage: 'ACTIVE_TRIPS', icon: '🚛' },
  'vehicle-pending': { title: 'Vehicle Pending', stage: 'VEHICLE_HIRED', icon: '⏳' },
  'in-transit': { title: 'In Transit', stage: 'TRANSIT', icon: '🛣️' },
  delivered: { title: 'Delivered', stage: 'DELIVERY', icon: '✅' },
  'pod-pending': { title: 'POD Pending', stage: 'POD', icon: '📄' },
  completed: { title: 'Completed', stage: 'COMPLETED', icon: '🎯' },
};

/** Extract lifecycle category from pathname like "/admin/bookings/pod-pending" → "pod-pending" */
function getCategoryFromPath(pathname) {
  const match = pathname.match(/\/admin\/bookings\/([^/]+)$/);
  return match ? match[1] : 'overview';
}

export default function AdminLifecycleDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const category = getCategoryFromPath(location.pathname);

  const config = CATEGORY_CONFIG[category] || { title: category, stage: 'ALL', icon: '📊' };

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [category]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, sort_by: 'created_at', sort_order: 'desc' };
      if (debounced) params.search = debounced;
      if (config.stage && config.stage !== 'ALL') params.stage = config.stage;
      const res = await adminAPI.getBookings(params);
      if (requestId.current !== id) return;
      setRows(res?.data?.data || []);
      setPagination(res?.data?.pagination || { total: 0, pages: 1, page: 1 });
      setError(null);
    } catch (e) {
      if (requestId.current !== id) return;
      setRows([]);
      setError(e?.response?.data?.message || e.message || 'Could not load records');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [page, debounced, config.stage, category]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
      <div className="mx-auto max-w-none space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <nav className="text-sm text-slate-500 mb-2">
              <span>Operations → Order / Trip Master → </span>
              <span className="text-slate-700 font-medium">{config.title}</span>
            </nav>
            <h1 className="bt-page-title flex items-center gap-2">
              <span>{config.icon}</span>
              {config.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{pagination.total} records</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <ActionButton variant="secondary" icon={ArrowLeft} onClick={() => navigate('/admin/bookings')}>
              Back to Orders
            </ActionButton>
            <ActionButton variant="secondary" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </ActionButton>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search booking number, customer, route..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-[#F5A000]/60 focus:ring-2 focus:ring-[#F5A000]/20"
              />
            </div>
          </div>

          {loading ? (
            <LoadingSkeleton className="h-64" />
          ) : error ? (
            <div className="p-8 text-center text-red-600">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No records found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/80 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Booking No</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Customer</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Route</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Vehicle</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Driver</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Date</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Stage</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.booking_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 text-sm font-medium text-slate-900">{row.booking_number}</td>
                      <td className="p-3 text-sm text-slate-600">{customerName(row)}</td>
                      <td className="p-3 text-sm text-slate-600">{routeLine(row)}</td>
                      <td className="p-3 text-sm text-slate-600">{row.vehicle?.vehicle_number || '—'}</td>
                      <td className="p-3 text-sm text-slate-600">{row.driver?.driver_name || '—'}</td>
                      <td className="p-3 text-sm text-slate-600">{formatDate(row.pickup_date)}</td>
                      <td className="p-3 text-sm text-slate-600">{row.status || '—'}</td>
                      <td className="p-3">
                        <button
                          onClick={() => navigate(`/admin/bookings/${row.booking_number}`)}
                          className="text-amber-600 hover:text-amber-700 text-sm font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
