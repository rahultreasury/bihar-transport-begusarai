/**
 * AdminOrders.jsx
 * ---------------------------------------------------------------------------
 * ORDER / TRIP MASTER — the central operational list for every shipment.
 *
 * DATA SOURCE (unchanged): GET /api/admin/bookings with the same server-side
 * search / status / lifecycle-stage filters, and the same lifecycle count and
 * summary endpoints. This file changes presentation only.
 *
 * The list remains the canonical route at /admin/bookings; row clicks and the
 * View action continue to open /admin/bookings/:bookingNumber.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  FileCheck2,
  IndianRupee,
  Loader2,
  MapPin,
  MoreVertical,
  Navigation,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Truck,
  User,
  Zap,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import PremiumKpiCard from '../components/admin-premium/booking/PremiumKpiCard';
import { resolveOrder, ORDER_STAGE_FILTERS, summariseOrders } from '../utils/orderStatus';
import { customerName, formatDate, inr, inrCompact, na } from '../utils/orderFormat';

const PAGE_SIZE = 25;

/** The lifecycle stage tab row. Labels come from the shared status mapper. */
const STAGES = [
  { key: 'ALL', label: 'All' },
  ...ORDER_STAGE_FILTERS.filter((f) => f.key !== 'ALL'),
];

/** Status badge colours. The label itself always comes from resolveOrder(). */
const STAGE_BADGE = {
  ENQUIRY: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  QUOTATION: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  ORDER_CONFIRMED: 'bg-blue-50 text-blue-700 ring-blue-200/70',
  VEHICLE_HIRED: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  LOADING: 'bg-orange-50 text-orange-700 ring-orange-200/70',
  DISPATCH: 'bg-sky-50 text-sky-700 ring-sky-200/70',
  TRANSIT: 'bg-violet-50 text-violet-700 ring-violet-200/70',
  DELIVERY: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  POD: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
};

const STATUS_OPTIONS = [
  'pending',
  'confirmed',
  'driver_assigned',
  'pickup_completed',
  'in_transit',
  'delivered',
  'completed',
  'cancelled',
];

const DATE_OPTIONS = [
  { value: '', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
];

/** Format a Date as the YYYY-MM-DD string expected by the booking query API. */
function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Turn the dashboard's date preset into the pickup-date range accepted by
 * GET /api/admin/bookings (date_from / date_to). Keeping this local avoids a
 * new API surface while making the visible selector genuinely functional.
 */
function resolveDateRange(value) {
  if (!value) return {};

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const to = new Date(from);

  if (value === 'week') {
    const daysSinceMonday = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - daysSinceMonday);
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 6);
  } else if (value === 'month') {
    from.setDate(1);
    to.setFullYear(from.getFullYear(), from.getMonth() + 1, 0);
  } else if (value === 'quarter') {
    const quarterStart = Math.floor(from.getMonth() / 3) * 3;
    from.setMonth(quarterStart, 1);
    to.setFullYear(from.getFullYear(), quarterStart + 3, 0);
  }

  return { date_from: toISODate(from), date_to: toISODate(to) };
}

function OperationalBadge({ order }) {
  const resolved = resolveOrder(order, order.trip);
  const tone =
    resolved.state === 'blocked'
      ? 'bg-rose-50 text-rose-700 ring-rose-200/70'
      : STAGE_BADGE[resolved.stageKey] || 'bg-slate-50 text-slate-600 ring-slate-200/70';

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase leading-none tracking-[0.035em] ring-1 ring-inset ${tone}`}
      title={resolved.blockedReason || resolved.nextAction || resolved.stageLabel}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {resolved.stageLabel}
    </span>
  );
}

function HeadingGlyph() {
  return (
    <span className="mt-[2px] flex h-[30px] shrink-0 items-end gap-[3px] sm:h-[34px]" aria-hidden="true">
      <span className="h-[16px] w-[5px] rounded-[2px] bg-emerald-500 sm:h-[20px] sm:w-[6px]" />
      <span className="h-[23px] w-[5px] rounded-[2px] bg-blue-600 sm:h-[27px] sm:w-[6px]" />
      <span className="h-[30px] w-[5px] rounded-[2px] bg-[#15345B] sm:h-[34px] sm:w-[6px]" />
    </span>
  );
}

export default function AdminOrders() {
  const navigate = useNavigate();

  const [stage, setStage] = useState('ALL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [lifecycleCounts, setLifecycleCounts] = useState({});
  const [summaryCounts, setSummaryCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const requestId = useRef(0);
  const selectAllRef = useRef(null);

  const dateRange = useMemo(() => resolveDateRange(dateFilter), [dateFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [stage]);

  useEffect(() => {
    setSelectedIds(new Set());
    setActionMenu(null);
  }, [page, debounced, status, stage, dateFilter]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, sort_by: 'created_at', sort_order: 'desc' };
      if (debounced) params.search = debounced;
      if (status) params.status = status;
      if (stage && stage !== 'ALL') params.stage = stage;
      Object.assign(params, dateRange);

      const res = await adminAPI.getBookings(params);
      if (requestId.current !== id) return;

      setRows(res?.data?.data || []);
      setPagination(res?.data?.pagination || { total: 0, pages: 1, page: 1 });
      setError(null);
    } catch (e) {
      if (requestId.current !== id) return;
      setRows([]);
      setError(e?.response?.data?.message || e.message || 'Could not load orders');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [page, debounced, status, stage, dateRange]);

  const loadCounts = useCallback(async () => {
    try {
      const params = {};
      if (debounced) params.search = debounced;
      if (status) params.status = status;
      Object.assign(params, dateRange);
      const [countsRes, summaryRes] = await Promise.all([
        adminAPI.getLifecycleCounts(params),
        // KPI totals stay global; the date preset filters the list and tabs.
        adminAPI.getLifecycleSummary(),
      ]);
      if (countsRes?.data?.counts) {
        setLifecycleCounts(countsRes.data.counts);
      }
      if (summaryRes?.data?.counts) {
        setSummaryCounts(summaryRes.data.counts);
      }
    } catch {
      // KPI/count failures are non-critical: the list itself stays usable.
    }
  }, [debounced, status, dateRange]);

  useEffect(() => {
    load();
    loadCounts();
  }, [load, loadCounts]);

  const refreshAll = useCallback(() => {
    load();
    loadCounts();
  }, [load, loadCounts]);

  // Stage tab counts, all sourced from the lifecycle API.
  const stageCounts = useMemo(() => {
    const counts = {};
    counts.ALL = lifecycleCounts.all ?? pagination.total ?? rows.length;
    counts.ENQUIRY = lifecycleCounts.enquiry ?? 0;
    counts.QUOTATION = lifecycleCounts.quotation ?? 0;
    counts.ORDER_CONFIRMED = lifecycleCounts.confirmed ?? 0;
    counts.VEHICLE_HIRED = lifecycleCounts.vehicleHired ?? 0;
    counts.LOADING = lifecycleCounts.loading ?? 0;
    counts.DISPATCH = lifecycleCounts.dispatch ?? 0;
    counts.TRANSIT = lifecycleCounts.transit ?? 0;
    counts.DELIVERY = lifecycleCounts.delivered ?? 0;
    counts.POD = lifecycleCounts.podPending ?? 0;
    counts.COMPLETED = lifecycleCounts.completed ?? 0;
    return counts;
  }, [lifecycleCounts, pagination.total, rows.length]);

  // The eight KPI values are API-derived. Only the display formatting lives here.
  const summary = useMemo(() => {
    const computed = summariseOrders(rows);
    return {
      // The summary endpoint is deliberately unfiltered: these eight cards are
      // global operational totals, while the tabs below reflect the table's
      // search/status/date selection.
      total: summaryCounts.totalOrders ?? summaryCounts.all ?? lifecycleCounts.all ?? computed.total,
      activeTrips: summaryCounts.activeTrips ?? lifecycleCounts.activeTrips ?? computed.activeTrips,
      vehiclePending: summaryCounts.vehiclePending ?? lifecycleCounts.vehicleHired ?? computed.vehiclesHired,
      inTransit:
        summaryCounts.inTransit ?? lifecycleCounts.inTransit ?? lifecycleCounts.transit ?? computed.inTransit,
      delivered: summaryCounts.delivered ?? lifecycleCounts.delivered ?? computed.delivered,
      podPending: summaryCounts.podPending ?? lifecycleCounts.podPending ?? computed.podPending,
      completed: summaryCounts.completed ?? lifecycleCounts.completed ?? computed.completed,
      paymentDue:
        summaryCounts.outstandingAmount ?? lifecycleCounts.outstandingAmount ?? computed.paymentDue,
    };
  }, [rows, lifecycleCounts, summaryCounts]);

  const visible = rows;

  const nextActionCount = useMemo(
    () => rows.filter((r) => resolveOrder(r, r.trip).stageKey === 'LOADING').length,
    [rows]
  );

  const openOrder = useCallback(
    (row) => {
      const no = row?.booking_number || row?.booking_reference;
      if (!no) return;
      navigate(`/admin/bookings/${encodeURIComponent(no)}`, {
        state: {
          orderId: row.booking_id,
          tripId: row.trip_id ?? row.trip?.trip_id,
          bookingNumber: no,
          status: row.status,
          vehicleId: row.vehicle_id,
          driverId: row.driver_id,
        },
      });
    },
    [navigate]
  );

  const assignDriver = useCallback(
    (row) => {
      const no = row?.booking_number || row?.booking_reference;
      if (!no) return;
      navigate(`/admin/bookings/${encodeURIComponent(no)}/assign-driver`);
    },
    [navigate]
  );

  const openActionMenu = useCallback((event, row) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuHeight = 92;
    const opensUp = rect.bottom + menuHeight + 12 > window.innerHeight;
    setActionMenu({
      row,
      top: opensUp ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.booking_id));
  const someSelected = rows.some((row) => selectedIds.has(row.booking_id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (rows.length > 0 && rows.every((row) => prev.has(row.booking_id))) return new Set();
      return new Set(rows.map((row) => row.booking_id));
    });
  }, [rows]);

  const changeStage = (key) => {
    setStage(key);
    setPage(1);
  };

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
      <div className="min-w-0">
        {/* ── HERO ─────────────────────────────────────────────────────────
            Full-bleed within the page gutters, exactly like the reference. The
            bitmap is right-anchored and width-capped so the truck can never
            encroach on the protected heading column at any desktop width. */}
        <section
          aria-labelledby="order-trip-master-title"
          className="relative -mx-4 -mt-6 min-h-[196px] overflow-hidden bg-[#F6FAFF] px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5 xl:min-h-[206px] xl:px-10"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_25%_10%,#FFFFFF_0%,#F3F9FF_46%,#EAF4FF_100%)]" />

          {/* Desktop truck + Bihar landscape.
              Width = min(native 1166px, (available space - heading column) × 1.195).
              The truck begins ~16.3% into the artwork, so this formula keeps its
              left edge at or beyond x=520px — clear of the heading — while still
              showing the full illustration at the 1586px reference width. */}
          <div
            className="pointer-events-none absolute bottom-0 right-0 hidden xl:block min-[1440px]:bottom-auto min-[1440px]:top-0"
            style={{ width: 'min(1166px, calc((100% - 520px) * 1.195))' }}
          >
            <img
              src="/assets/bihar-transport-operations-hero@2x.webp"
              width="2332"
              height="396"
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="block h-auto w-full"
            />

            {/* Crisp replacement for the low-resolution bubble baked into the
                bitmap. Hidden below 1440px so it can never collide with the
                hero actions on narrower laptops. */}
            <div
              className="absolute hidden min-[1440px]:block"
              style={{ left: '59.2%', top: '12.6%', width: '10.8%' }}
              aria-hidden="true"
            >
              <div className="relative rounded-[14px] bg-[#C6D9F7]/95 px-[9%] py-[9%] text-[#1E3A8A] shadow-[0_2px_12px_rgba(30,58,138,0.08)]">
                <p className="text-[clamp(9.5px,0.72vw,11.5px)] font-medium leading-[1.15]">Delivering</p>
                <p className="mt-[2px] whitespace-nowrap text-[clamp(10px,0.78vw,12.5px)] font-bold leading-[1.15]">
                  A Stronger Bihar
                </p>
                <span className="absolute -bottom-[5px] left-[14%] h-2.5 w-2.5 rotate-45 bg-[#C6D9F7]" />
              </div>
            </div>
          </div>

          {/* Smaller screens: softly cropped artwork, never over the controls. */}
          <div className="pointer-events-none absolute inset-0 xl:hidden">
            <img
              src="/assets/bihar-transport-operations-hero@2x.webp"
              width="2332"
              height="396"
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="h-full w-full object-cover object-[68%_55%] opacity-25"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#F8FBFF] via-[#F8FBFF]/90 to-[#F8FBFF]/40" />
          </div>

          {/* Text-protection scrim stops at the truck's left edge. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[520px] max-w-[45%] bg-gradient-to-r from-[#F7FBFF] via-[#F7FBFF]/75 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-[#F6F8FB] to-transparent" />

          <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
                <span>Operations</span>
                <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
                <span className="font-semibold text-slate-700">Order / Trip Master</span>
              </nav>

              <div className="mt-1 flex items-start gap-3 xl:gap-5">
                <HeadingGlyph />
                <h1
                  id="order-trip-master-title"
                  className="text-[30px] font-bold leading-[1.05] tracking-[-0.035em] text-[#15345B] sm:text-[34px] lg:text-[36px]"
                >
                  Order / Trip Master
                </h1>
              </div>

              <p className="mt-1 text-[13px] font-medium text-slate-600 sm:text-[14px]">
                Manage every shipment from confirmation to delivery.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2.5 sm:mt-0.5 sm:justify-end">
              <button
                type="button"
                onClick={refreshAll}
                disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-200 bg-white/95 px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#15345B]/25 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Refresh orders"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin/enquiries')}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#15345B] px-4 text-[13px] font-semibold text-white shadow-[0_5px_14px_-8px_rgba(21,52,91,0.8)] transition-colors hover:bg-[#102B4C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#15345B]/30 focus-visible:ring-offset-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create order
              </button>
            </div>
          </div>

          <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 lg:mt-6">
            <span className="inline-flex h-7 items-center gap-2 rounded-full border border-slate-200/90 bg-white/90 px-2.5 text-[11.5px] font-semibold text-slate-600 shadow-sm backdrop-blur-sm">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live Operations
            </span>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-2.5 text-[11.5px] font-semibold text-slate-600 shadow-sm backdrop-blur-sm">
              <CalendarDays className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-2.5 text-[11.5px] font-semibold text-slate-600 shadow-sm backdrop-blur-sm">
              <ClipboardList className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              {summary.total.toLocaleString('en-IN')} Total Orders
            </span>
          </div>
        </section>

        <div className="pt-3">
          {/* ── KPI CARDS ──────────────────────────────────────────────────
              Four across on large desktop, two on tablet, one on phones. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:[grid-auto-rows:152px]">
            <PremiumKpiCard
              compact
              label="Total Orders"
              subtitle="All shipment orders"
              value={summary.total}
              icon={ClipboardList}
              tone="blue"
              onClick={() => navigate('/admin/bookings/overview')}
              ariaLabel="View all orders"
            />
            <PremiumKpiCard
              compact
              label="Bookings with Active Trips"
              subtitle="Live operational trips"
              value={summary.activeTrips}
              icon={Truck}
              tone="green"
              onClick={() => navigate('/admin/bookings/active-trips')}
              ariaLabel="Filter by active trips"
            />
            <PremiumKpiCard
              compact
              label="Vehicle Pending"
              subtitle="Orders awaiting vehicle"
              value={summary.vehiclePending}
              icon={Navigation}
              tone="orange"
              onClick={() => navigate('/admin/bookings/vehicle-pending')}
              ariaLabel="Filter by vehicle pending"
            />
            <PremiumKpiCard
              compact
              label="In Transit"
              subtitle="Currently moving"
              value={summary.inTransit}
              icon={Package}
              tone="purple"
              onClick={() => navigate('/admin/bookings/in-transit')}
              ariaLabel="Filter by in transit"
            />
            <PremiumKpiCard
              compact
              label="Delivered"
              subtitle="Reached destination"
              value={summary.delivered}
              icon={PackageCheck}
              tone="green"
              onClick={() => navigate('/admin/bookings/delivered')}
              ariaLabel="Filter by delivered"
            />
            <PremiumKpiCard
              compact
              label="POD Pending"
              subtitle="Awaiting proof of delivery"
              value={summary.podPending}
              icon={FileCheck2}
              tone="orange"
              onClick={() => navigate('/admin/bookings/pod-pending')}
              ariaLabel="Filter by POD pending"
            />
            <PremiumKpiCard
              compact
              label="Completed"
              subtitle="Successfully closed"
              value={summary.completed}
              icon={CheckCircle2}
              tone="blue"
              onClick={() => navigate('/admin/bookings/completed')}
              ariaLabel="Filter by completed"
            />
            <PremiumKpiCard
              compact
              label="Outstanding Amount"
              subtitle="Pending payments"
              value={summary.paymentDue}
              icon={IndianRupee}
              tone="red"
              isMoney
              formatValue={inrCompact}
              disabled
              ariaLabel="Outstanding amount"
            />
          </div>

          {/* ── SEARCH + FILTERS ─────────────────────────────────────────── */}
          <div className="mt-4 flex flex-col gap-2.5 rounded-[12px] border border-slate-200/80 bg-white px-3 py-1.5 shadow-[0_1px_2px_rgba(15,43,85,0.035)] lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order, customer, route, vehicle..."
                aria-label="Search orders"
                className="h-10 w-full rounded-[9px] border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] font-medium text-slate-700 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#15345B] focus:ring-2 focus:ring-[#15345B]/10"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 lg:contents">
              <div className="relative lg:w-[26%] lg:shrink-0">
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by backend status"
                  className="h-10 w-full cursor-pointer appearance-none rounded-[9px] border border-slate-200 bg-white pl-3 pr-8 text-[13.5px] font-medium text-slate-700 outline-none transition focus:border-[#15345B] focus:ring-2 focus:ring-[#15345B]/10"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
              </div>

              <div className="relative lg:w-[33%] lg:shrink-0">
                <CalendarDays
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <select
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by date"
                  className="h-10 w-full cursor-pointer appearance-none rounded-[9px] border border-slate-200 bg-white pl-8 pr-8 text-[13.5px] font-medium text-slate-700 outline-none transition focus:border-[#15345B] focus:ring-2 focus:ring-[#15345B]/10"
                >
                  {DATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
              </div>

              {nextActionCount > 0 ? (
                <button
                  type="button"
                  onClick={() => changeStage('LOADING')}
                  className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-amber-200 bg-amber-50 px-3 text-[11.5px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 lg:col-span-1 lg:w-auto"
                  title="Show trips waiting for loading"
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {nextActionCount} waiting for loading
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          {/* ── LIFECYCLE TABS ───────────────────────────────────────────── */}
          <div className="mt-3 rounded-[12px] border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,43,85,0.035)]">
            <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {STAGES.map((s) => {
                const active = stage === s.key;
                const count = stageCounts[s.key] ?? 0;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => changeStage(s.key)}
                    aria-pressed={active}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                      active
                        ? 'bg-[#15345B] text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    {s.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
                        active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── ORDERS TABLE ─────────────────────────────────────────────── */}
          <div className="mt-3 overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.035)]">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[12.5px] font-medium text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading orders…
              </div>
            ) : error ? (
              <div className="m-3 rounded-xl border border-red-200 bg-red-50/80 p-4">
                <p className="flex items-start gap-2 text-[12.5px] font-semibold text-red-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Unable to load orders.
                </p>
                <p className="mt-1 pl-6 text-[12px] text-red-700">{error}</p>
                <button
                  type="button"
                  onClick={load}
                  className="ml-6 mt-2 inline-flex h-8 items-center rounded-lg bg-red-600 px-3 text-[11px] font-semibold text-white transition hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-slate-400">No orders match the current filters.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1180px] table-fixed border-collapse text-left">
                    <colgroup>
                      <col style={{ width: '4%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '15.5%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '11.5%' }} />
                      <col style={{ width: '10%' }} />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200/80 bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.09em] text-slate-500">
                        <th className="h-10 w-9 px-3">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 accent-[#15345B] focus:ring-2 focus:ring-[#15345B]/20"
                            aria-label={allSelected ? 'Deselect all orders' : 'Select all orders'}
                          />
                        </th>
                        <th className="h-10 px-3">Order</th>
                        <th className="h-10 px-3">Customer</th>
                        <th className="h-10 px-3">Route</th>
                        <th className="h-10 px-3">Vehicle &amp; Driver</th>
                        <th className="h-10 px-3">Trip Date</th>
                        <th className="h-10 px-3">Customer Quote</th>
                        <th className="h-10 px-3">Operational Status</th>
                        <th className="h-10 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => {
                        const no = r.booking_number || r.booking_reference;
                        const selected = selectedIds.has(r.booking_id);
                        return (
                          <tr
                            key={r.booking_id}
                            onClick={() => openOrder(r)}
                            className={`h-11 cursor-pointer border-b border-slate-100/90 transition-colors last:border-0 ${
                              selected ? 'bg-blue-50/40' : 'hover:bg-slate-50/70'
                            }`}
                          >
                            <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleRow(r.booking_id)}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 accent-[#15345B] focus:ring-2 focus:ring-[#15345B]/20"
                                aria-label={`Select order ${no || r.booking_id}`}
                              />
                            </td>

                            <td className="px-3 py-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrder(r);
                                }}
                                className="block max-w-[220px] truncate text-left font-mono text-[12.5px] font-bold leading-tight text-slate-800 transition-colors hover:text-[#15345B] hover:underline"
                                title={no || 'Order'}
                              >
                                {na(no)}
                              </button>
                              <p className="mt-0.5 text-[10.5px] font-medium leading-tight text-slate-400">
                                {formatDate(r.created_at)}
                              </p>
                            </td>

                            <td className="px-3 py-1">
                              <p className="max-w-[190px] truncate text-[13.5px] font-semibold leading-tight text-slate-800" title={customerName(r)}>
                                {customerName(r)}
                              </p>
                              <p className="mt-0.5 max-w-[190px] truncate text-[11px] leading-tight text-slate-400" title={na(r.goods_description || r.goods_type)}>
                                {na(r.goods_description || r.goods_type)}
                              </p>
                            </td>

                            <td className="px-3 py-1">
                              <div className="flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                                <span className="max-w-[160px] truncate text-[12px] font-medium leading-tight text-slate-700" title={na(r.pickup_location ?? r.pickup_city)}>
                                  {na(r.pickup_location ?? r.pickup_city)}
                                </span>
                              </div>
                              <div className="mt-[2px] flex items-center gap-1.5">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
                                <span className="max-w-[160px] truncate text-[12px] font-medium leading-tight text-slate-700" title={na(r.drop_location ?? r.drop_city)}>
                                  {na(r.drop_location ?? r.drop_city)}
                                </span>
                              </div>
                            </td>

                            <td className="px-3 py-1">
                              <div className="flex items-center gap-1.5">
                                <Truck className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                                <span className="max-w-[140px] truncate font-mono text-[12px] font-semibold leading-tight text-slate-700" title={na(r.vehicle_number || r.truck_number_snapshot)}>
                                  {na(r.vehicle_number || r.truck_number_snapshot)}
                                </span>
                              </div>
                              <div className="mt-[2px] flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                                <span className="max-w-[140px] truncate text-[12px] font-medium leading-tight text-slate-500" title={na(r.driver_name_snapshot || r.driver_first_name)}>
                                  {na(r.driver_name_snapshot || r.driver_first_name)}
                                </span>
                              </div>
                            </td>

                            <td className="px-3 py-1">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                                <span className="text-[12.5px] font-medium leading-tight text-slate-600">{formatDate(r.pickup_date)}</span>
                              </div>
                            </td>

                            <td className="px-3 py-1">
                              <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-800">
                                {inr(r.final_price ?? r.estimated_price)}
                              </span>
                            </td>

                            <td className="px-3 py-1">
                              <OperationalBadge order={r} />
                            </td>

                            <td className="px-3 py-1">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openOrder(r);
                                  }}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200/80 bg-blue-50 px-2.5 text-[11.5px] font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
                                  aria-label={`View order ${no || r.booking_id}`}
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => openActionMenu(e, r)}
                                  className="flex h-8 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#15345B]/20"
                                  aria-label={`More actions for ${no || r.booking_id}`}
                                  aria-haspopup="menu"
                                  aria-expanded={actionMenu?.row?.booking_id === r.booking_id}
                                >
                                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile / tablet cards */}
                <div className="divide-y divide-slate-100 lg:hidden">
                  {visible.map((r) => {
                    const no = r.booking_number || r.booking_reference;
                    return (
                      <div
                        key={r.booking_id}
                        onClick={() => openOrder(r)}
                        className="cursor-pointer px-3.5 py-3 transition-colors hover:bg-slate-50/70"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[11.5px] font-bold text-slate-800">{na(no)}</p>
                            <p className="mt-0.5 text-[9.5px] font-medium text-slate-400">{formatDate(r.created_at)}</p>
                          </div>
                          <OperationalBadge order={r} />
                        </div>

                        <div className="mt-1.5 flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-[12px] font-semibold text-slate-800">{customerName(r)}</p>
                          <p className="shrink-0 text-[11.5px] font-semibold tabular-nums text-slate-800">
                            {inr(r.final_price ?? r.estimated_price)}
                          </p>
                        </div>

                        <div className="mt-1.5 grid grid-cols-1 gap-1 xl:grid-cols-2">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
                            <span className="truncate text-[10.5px] font-medium text-slate-600">
                              {na(r.pickup_location ?? r.pickup_city)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 shrink-0 text-rose-500" aria-hidden="true" />
                            <span className="truncate text-[10.5px] font-medium text-slate-600">
                              {na(r.drop_location ?? r.drop_city)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Truck className="h-3 w-3 text-slate-400" aria-hidden="true" />
                              <span className="truncate font-mono font-semibold text-slate-600">
                                {na(r.vehicle_number || r.truck_number_snapshot)}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="h-3 w-3 text-slate-400" aria-hidden="true" />
                              {formatDate(r.pickup_date)}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openOrder(r);
                              }}
                              className="inline-flex h-7 items-center rounded-md border border-blue-200/80 bg-blue-50 px-2.5 text-[10px] font-semibold text-blue-700"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openActionMenu(e, r)}
                              className="flex h-7 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              aria-label={`More actions for ${no || r.booking_id}`}
                              aria-haspopup="menu"
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {pagination.total > PAGE_SIZE ? (
                  <div className="flex flex-col gap-2 border-t border-slate-200/80 px-3.5 py-2.5 text-[10.5px] font-medium text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      Page {pagination.page || page} of {pagination.pages} · {pagination.total} orders
                      {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[10.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={page >= pagination.pages}
                        onClick={() => setPage((p) => p + 1)}
                        className="inline-flex h-7 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[10.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Fixed-position action menu escapes the table's overflow clip. */}
        {actionMenu ? (
          <>
            <button
              type="button"
              aria-label="Close order actions"
              className="fixed inset-0 z-40 cursor-default bg-transparent"
              onClick={() => setActionMenu(null)}
              tabIndex={-1}
            />
            <div
              role="menu"
              className="fixed z-50 w-[168px] rounded-xl border border-slate-200 bg-white p-1 shadow-[0_14px_35px_-12px_rgba(15,43,85,0.28)]"
              style={{ top: actionMenu.top, right: actionMenu.right }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActionMenu(null);
                  openOrder(actionMenu.row);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Eye className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                View order
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActionMenu(null);
                  assignDriver(actionMenu.row);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <User className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                Assign driver
              </button>
            </div>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
