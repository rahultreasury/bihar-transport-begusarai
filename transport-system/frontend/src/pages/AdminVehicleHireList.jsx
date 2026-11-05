/**
 * AdminVehicleHireList.jsx
 * ---------------------------------------------------------------------------
 * UNIVERSAL VEHICLE HIRE WORKSPACE — /admin/vehicle-hire
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *                               → TO LOADING POINT
 *
 * ONE UNIVERSAL WORKFLOW
 *   Every eligible trip opens the SAME hire page. There is no Contract Hire page
 *   and no Commission Hire page — "Billing To" on that page decides the model,
 *   and the business model is derived from it.
 *
 * EVERY FIGURE IS REAL AND SERVER-SOURCED
 *   The rows come from GET /api/vehicle-hire/trips, which joins the existing
 *   `trips` table to the `vehicle_hires` records. Gross Vehicle Hire, Commission
 *   and Net Vendor Payable are read from their own stored Decimal columns and
 *   are displayed as THREE SEPARATE values — the gross is never replaced by the
 *   net, here or anywhere else in this module.
 *
 * DESIGN
 *   Full-screen workspace (no sidebar, no reserved sidebar column), a compact
 *   global toolbar whose overflow menu carries the admin navigation, a shallow
 *   hero, six KPI cards, a two-row filter panel with real status counts, and the
 *   premium vehicle-hire table. Every control is wired to the existing API, the
 *   existing hire workspace, or the existing trip routes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Filter,
  IndianRupee,
  Loader2,
  MoreVertical,
  Package,
  Pencil,
  Percent,
  Search,
  Truck,
  Wallet,
} from 'lucide-react';

import AdminShell, {
  ActionMenu,
  AdminModal,
  BlankState,
  Button,
  DEFAULT_NAV_ITEMS,
  ErrorState,
  PremiumTable,
} from '../components/admin-premium/ui';
import { vehicleHireAPI } from '../services/vehicleHireAPI';

import tataAceImg from '../assets/vehicles/tata-ace.webp';
import tata407Img from '../assets/vehicles/tata-407-14ft.webp';
import truck16Img from '../assets/vehicles/truck-16-wheeler.webp';
import truck17Img from '../assets/vehicles/truck-17ft.webp';
import truck18Img from '../assets/vehicles/truck-18-wheeler.webp';
import truck19Img from '../assets/vehicles/truck-19ft.webp';
import truck22Img from '../assets/vehicles/truck-22ft-10ton.webp';
import pickupImg from '../assets/vehicles/pickup-truck.webp';
import containerImg from '../assets/vehicles/container-32ft-single.webp';

/* ════════════════════════════════════════════════════════════════════════════
   FORMATTING
   ═══════════════════════════════════════════════════════════════════════════ */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function inr(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return INR.format(n);
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE.format(d).replace(',', '');
}

function city(value) {
  if (!value) return '';
  const first = String(value).split(',')[0].trim();
  return first || '';
}

function routeLine(row) {
  const pickup = row.route?.pickup_city || city(row.route?.pickup) || '—';
  const drop = row.route?.drop_city || city(row.route?.drop) || '—';
  return `${pickup} → ${drop}`;
}

function goodsLine(row) {
  const goods = row.goods || {};
  const bits = [];
  if (goods.description) bits.push(goods.description);
  if (goods.quantity) {
    bits.push(`${goods.quantity}${goods.quantity_unit ? ` ${goods.quantity_unit}` : ''}`);
  } else if (goods.weight_kg) {
    bits.push(`${goods.weight_kg}${goods.weight_unit ? ` ${goods.weight_unit}` : ' kg'}`);
  }
  return bits.join(' · ');
}

function customerName(row) {
  return row.customer || (row.customer_type === 'ONLINE' ? 'Online customer' : '—');
}

/**
 * The Trip / Order cell opens the record that owns the row:
 *   booking_number → Order / Trip Master (canonical number)
 *   booking_id     → Order / Trip Master (numeric fallback)
 *   trip_id        → Trip Workspace (enquiry-reservation trips have no booking)
 * No destination is invented when the row carries none.
 */
function tripOrderHref(r) {
  if (r.booking_number) return `/admin/bookings/${r.booking_number}`;
  else if (r.booking_id) return `/admin/bookings/${r.booking_id}`;
  else if (r.trip_id) return `/admin/trips/${r.trip_id}`;
  return null;
}

function vehicleImage(vehicle) {
  const key = `${vehicle?.vehicle_type || ''} ${vehicle?.vehicle_name || ''}`.toLowerCase();
  if (key.includes('ace')) return tataAceImg;
  if (key.includes('pickup')) return pickupImg;
  if (key.includes('container')) return containerImg;
  if (key.includes('407') || key.includes('tempo')) return tata407Img;
  if (key.includes('17')) return truck17Img;
  if (key.includes('18')) return truck18Img;
  if (key.includes('19')) return truck19Img;
  if (key.includes('22')) return truck22Img;
  if (key.includes('16')) return truck16Img;
  return truck19Img;
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/* ════════════════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════════════ */

function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

/* ════════════════════════════════════════════════════════════════════════════
   STATUS
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_CHIPS = [
  { key: 'ALL', label: 'All', tone: 'blue' },
  { key: 'WAITING', label: 'Waiting', tone: 'amber' },
  { key: 'HIRED', label: 'Hired', tone: 'green' },
  { key: 'TO_LOADING', label: 'To Loading', tone: 'sky' },
  { key: 'LOADING', label: 'Loading', tone: 'violet' },
  { key: 'IN_TRANSIT', label: 'In Transit', tone: 'sky' },
  { key: 'DELIVERED', label: 'Delivered', tone: 'green' },
  { key: 'COMPLETED', label: 'Completed', tone: 'slate' },
];

const CHIP_TONES = {
  blue: {
    idle: 'border-[#DCE8FF] bg-[#F1F6FF] text-[#1D4ED8]',
    active: 'border-[#1764E8] bg-[#1764E8] text-white shadow-[0_6px_14px_rgba(23,100,232,0.22)]',
    badgeIdle: 'bg-[#DCE8FF] text-[#1D4ED8]',
    badgeActive: 'bg-white/20 text-white',
  },
  amber: {
    idle: 'border-[#FCEBCB] bg-[#FFF8E8] text-[#B45309]',
    active: 'border-[#F3B64B] bg-[#FEF3D7] text-[#92400E] ring-2 ring-[#F3B64B]/25',
    badgeIdle: 'bg-[#FCEBCB] text-[#B45309]',
    badgeActive: 'bg-[#F3B64B]/25 text-[#92400E]',
  },
  green: {
    idle: 'border-[#D9F3E4] bg-[#F3FDF8] text-[#047857]',
    active: 'border-[#6EE7B7] bg-[#DCFCE7] text-[#065F46] ring-2 ring-[#6EE7B7]/25',
    badgeIdle: 'bg-[#D9F3E4] text-[#047857]',
    badgeActive: 'bg-[#6EE7B7]/25 text-[#065F46]',
  },
  sky: {
    idle: 'border-[#DCEAFB] bg-[#F3F9FF] text-[#1D4ED8]',
    active: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1E40AF] ring-2 ring-[#93C5FD]/25',
    badgeIdle: 'bg-[#DCEAFB] text-[#1D4ED8]',
    badgeActive: 'bg-[#93C5FD]/25 text-[#1E40AF]',
  },
  violet: {
    idle: 'border-[#E9E2FB] bg-[#F8F5FF] text-[#6D28D9]',
    active: 'border-[#C4B5FD] bg-[#EDE9FE] text-[#5B21B6] ring-2 ring-[#C4B5FD]/25',
    badgeIdle: 'bg-[#E9E2FB] text-[#6D28D9]',
    badgeActive: 'bg-[#C4B5FD]/25 text-[#5B21B6]',
  },
  slate: {
    idle: 'border-[#E6EBF2] bg-[#F8FAFC] text-[#475569]',
    active: 'border-[#CBD5E1] bg-[#F1F5F9] text-[#334155] ring-2 ring-[#CBD5E1]/30',
    badgeIdle: 'bg-[#E6EBF2] text-[#475569]',
    badgeActive: 'bg-[#CBD5E1]/35 text-[#334155]',
  },
};

const STATUS_TONES = {
  amber: { pill: 'bg-[#FFF8E8] text-[#B45309]', dot: 'bg-[#F59E0B]' },
  green: { pill: 'bg-[#ECFDF3] text-[#047857]', dot: 'bg-[#10B981]' },
  blue: { pill: 'bg-[#EFF6FF] text-[#1D4ED8]', dot: 'bg-[#3B82F6]' },
  violet: { pill: 'bg-[#F5F3FF] text-[#6D28D9]', dot: 'bg-[#8B5CF6]' },
  slate: { pill: 'bg-[#F1F5F9] text-[#475569]', dot: 'bg-[#94A3B8]' },
};

function operationalStatus(row) {
  const status = String(row.status || '').toUpperCase();

  if (status === 'IN_TRANSIT') return { label: 'In Transit', sub: 'On the way', tone: 'blue' };
  if (status === 'DELIVERED') return { label: 'Delivered', sub: 'Delivered', tone: 'green' };
  if (status === 'COMPLETED') return { label: 'Completed', sub: 'Completed', tone: 'slate' };
  if (status === 'AT_LOADING_POINT') return { label: 'Loading', sub: 'At loading point', tone: 'violet' };
  if (status === 'TO_LOADING_POINT') return { label: 'To Loading', sub: 'Hired & ready', tone: 'blue' };
  if (status === 'LOADED') return { label: 'Loaded', sub: 'Ready to dispatch', tone: 'violet' };
  if (status === 'DISPATCHED') return { label: 'Dispatched', sub: 'On the way', tone: 'blue' };

  if (row.hire_status === 'VEHICLE_HIRED') {
    return { label: 'Hired', sub: 'Vehicle assigned', tone: 'green' };
  }
  if (row.hire_status === 'VEHICLE_ASSIGNED') {
    return { label: 'Waiting', sub: 'Vehicle assigned', tone: 'amber' };
  }
  return { label: 'Waiting', sub: 'Pending hire', tone: 'amber' };
}

/* ════════════════════════════════════════════════════════════════════════════
   KPI CARDS
   ═══════════════════════════════════════════════════════════════════════════ */

const KPI_CARDS = [
  {
    key: 'waiting',
    label: 'Waiting for Vehicle',
    sub: 'Orders pending hire',
    icon: Truck,
    bg: 'bg-[#FFFDF8]',
    border: 'border-[#F7EEDC]',
    iconBg: 'bg-[#FEF3D7]',
    iconColor: 'text-[#D97706]',
    filter: 'WAITING',
  },
  {
    key: 'hired',
    label: 'Vehicle Hired',
    sub: 'Ready for loading',
    icon: Truck,
    bg: 'bg-[#F8FEFB]',
    border: 'border-[#DFF3E8]',
    iconBg: 'bg-[#DCFCE7]',
    iconColor: 'text-[#059669]',
    filter: 'HIRED',
  },
  {
    key: 'toLoading',
    label: 'To Loading',
    sub: 'Hired & awaiting loading',
    icon: Package,
    bg: 'bg-[#F8FBFF]',
    border: 'border-[#E1EDFB]',
    iconBg: 'bg-[#DBEAFE]',
    iconColor: 'text-[#2563EB]',
    filter: 'LOADING',
  },
  {
    key: 'grossHire',
    label: 'Gross Vehicle Hire',
    sub: 'Total hire amount',
    icon: IndianRupee,
    bg: 'bg-[#FBF9FF]',
    border: 'border-[#ECE6FA]',
    iconBg: 'bg-[#EDE9FE]',
    iconColor: 'text-[#7C3AED]',
    filter: 'HIRED',
  },
  {
    key: 'commission',
    label: 'Commission',
    sub: 'Total commission',
    icon: Percent,
    bg: 'bg-[#FFFCF6]',
    border: 'border-[#F8EDDA]',
    iconBg: 'bg-[#FEF3C7]',
    iconColor: 'text-[#D97706]',
    filter: 'HIRED',
  },
  {
    key: 'netPayable',
    label: 'Net Vendor Payable',
    sub: 'Amount to be paid',
    icon: Wallet,
    bg: 'bg-[#F8FEFB]',
    border: 'border-[#DFF3E8]',
    iconBg: 'bg-[#DCFCE7]',
    iconColor: 'text-[#059669]',
    filter: 'HIRED',
  },
];

const TRUST_INDICATORS = [
  { label: 'Reliable Vehicles', icon: Truck },
  { label: 'Verified Partners', icon: Check },
  { label: 'Real-time Operations', icon: Clock },
];

/* ════════════════════════════════════════════════════════════════════════════
   PAGINATION
   ═══════════════════════════════════════════════════════════════════════════ */

function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const items = [1];
  if (current > 3) items.push('left-ellipsis');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let page = start; page <= end; page += 1) items.push(page);
  if (current < total - 2) items.push('right-ellipsis');
  items.push(total);
  return items;
}

/* ════════════════════════════════════════════════════════════════════════════
   SMALL PIECES
   ═══════════════════════════════════════════════════════════════════════════ */

function StatusChip({ chip, count, active, onClick }) {
  const tone = CHIP_TONES[chip.tone] || CHIP_TONES.slate;
  const isAll = chip.key === 'ALL';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-[7px] border px-2.5 text-[11px] font-semibold transition-all duration-150',
        active ? tone.active : `${tone.idle} hover:-translate-y-px hover:shadow-sm`,
      ].join(' ')}
    >
      <span>{chip.label}</span>
      <span
        className={[
          'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold leading-none',
          active ? tone.badgeActive : tone.badgeIdle,
          isAll && active ? 'bg-white/20 text-white' : '',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  );
}

function StatusPill({ status }) {
  const tone = STATUS_TONES[status.tone] || STATUS_TONES.slate;

  return (
    <div className="min-w-0">
      <span className={`inline-flex h-[23px] items-center gap-1.5 rounded-full px-2.5 text-[9.5px] font-semibold ${tone.pill}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
        {status.label}
      </span>
      <p className="mt-1 truncate text-[9px] text-[#94A3B8]">{status.sub}</p>
    </div>
  );
}

function BillingPill({ model }) {
  if (!model) {
    return <span className="text-[11px] text-[#CBD5E1]">—</span>;
  }

  const commission = String(model).toUpperCase() === 'COMMISSION';
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[9.5px] font-semibold ${
        commission
          ? 'border-[#FDE9C4] bg-[#FFF7E6] text-[#B45309]'
          : 'border-[#DBEAFE] bg-[#EFF6FF] text-[#1D4ED8]'
      }`}
    >
      {commission ? 'Commission' : 'Contract'}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AdminVehicleHireList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({
    waiting: 0,
    assigned: 0,
    hired: 0,
    to_loading: 0,
    shown: 0,
    gross_hire: 0,
    commission_amount: 0,
    net_vendor_payable: 0,
    statuses: {},
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 5, total: 0, totalPages: 1 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // One status state feeds BOTH the chip row and the All Status dropdown, so
  // the two controls can never disagree.
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState(urlSearch);
  const [tripDate, setTripDate] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [businessModel, setBusinessModel] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [exporting, setExporting] = useState(false);

  const [hirePickerOpen, setHirePickerOpen] = useState(false);
  const [hirePickerSearch, setHirePickerSearch] = useState('');
  const [hirePickerRows, setHirePickerRows] = useState([]);
  const [hirePickerLoading, setHirePickerLoading] = useState(false);
  const [hirePickerError, setHirePickerError] = useState(null);
  const [hirePickerNonce, setHirePickerNonce] = useState(0);

  const debouncedSearch = useDebouncedValue(search);
  const debouncedTripDate = useDebouncedValue(tripDate, 150);
  const debouncedVehicleType = useDebouncedValue(vehicleType, 250);
  const debouncedPickerSearch = useDebouncedValue(hirePickerSearch, 300);
  const requestIdRef = useRef(0);

  // The global toolbar sends /admin/vehicle-hire?search=…; adopt that query.
  useEffect(() => {
    setSearch(urlSearch);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [urlSearch]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /* ── The one request parameter builder ────────────────────────────────── */
  const filterParams = useMemo(() => {
    const params = { view: 'all' };

    if (debouncedSearch) params.search = debouncedSearch;
    if (debouncedTripDate) params.trip_date = debouncedTripDate;
    if (debouncedVehicleType) params.vehicle_type = debouncedVehicleType;
    if (businessModel) params.business_model = businessModel;

    if (statusFilter === 'WAITING') params.hire_state = 'WAITING_FOR_VEHICLE';
    if (statusFilter === 'HIRED') params.hire_state = 'VEHICLE_HIRED';
    if (statusFilter === 'TO_LOADING') params.trip_status = 'TO_LOADING_POINT';
    if (statusFilter === 'LOADING') params.trip_status = 'AT_LOADING_POINT';
    if (statusFilter === 'IN_TRANSIT') params.trip_status = 'IN_TRANSIT';
    if (statusFilter === 'DELIVERED') params.trip_status = 'DELIVERED';
    if (statusFilter === 'COMPLETED') params.trip_status = 'COMPLETED';

    return params;
  }, [debouncedSearch, debouncedTripDate, debouncedVehicleType, businessModel, statusFilter]);

  /* ── Load the real list ───────────────────────────────────────────────── */
  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const response = await vehicleHireAPI.listTrips({
        ...filterParams,
        page: pagination.page,
        limit: pagination.limit,
      });

      if (requestId !== requestIdRef.current) return;

      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Failed to load vehicle hires');
      }

      const payload = response.data;
      setRows(payload.data || []);
      setCounts({
        waiting: payload.counts?.waiting || 0,
        assigned: payload.counts?.assigned || 0,
        hired: payload.counts?.hired || 0,
        to_loading: payload.counts?.to_loading || 0,
        shown: payload.counts?.shown || 0,
        gross_hire: payload.counts?.gross_hire || 0,
        commission_amount: payload.counts?.commission_amount || 0,
        net_vendor_payable: payload.counts?.net_vendor_payable || 0,
        statuses: payload.counts?.statuses || {},
      });
      setPagination(payload.pagination || { page: 1, limit: 5, total: 0, totalPages: 1 });
      setSelectedIds(new Set());
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.response?.data?.message || err.message || 'Failed to load vehicle hires');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [filterParams, pagination.page, pagination.limit]);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Filter handlers ──────────────────────────────────────────────────── */
  const resetToFirstPage = () => setPagination((prev) => ({ ...prev, page: 1 }));

  const applyStatusFilter = (key) => {
    setStatusFilter(key);
    resetToFirstPage();
  };

  const clearFilters = () => {
    setSearch('');
    setTripDate('');
    setVehicleType('');
    setBusinessModel('');
    setStatusFilter('ALL');
    setPagination((prev) => ({ ...prev, page: 1 }));
    setSelectedIds(new Set());
    if (urlSearch) setSearchParams({}, { replace: true });
  };

  const changePage = (page) => {
    if (page < 1 || page > pagination.totalPages) return;
    setPagination((prev) => ({ ...prev, page }));
  };

  const changePageSize = (limit) => {
    setPagination((prev) => ({ ...prev, limit, page: 1 }));
  };

  /* ── Row actions ──────────────────────────────────────────────────────── */
  const openHire = (trip) => navigate(`/admin/trips/${trip.trip_id}/vehicle-hire`);
  const openTrip = (trip) => navigate(`/admin/trips/${trip.trip_id}`, { state: { from: '/admin/vehicle-hire' } });

  /* ── Selection ────────────────────────────────────────────────────────── */
  const rowIds = useMemo(() => rows.map((row) => row.trip_id), [rows]);
  const isAllSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const isIndeterminate = selectedIds.size > 0 && !isAllSelected;

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (isAllSelected) return new Set();
      const next = new Set(prev);
      rowIds.forEach((id) => next.add(id));
      return next;
    });
  };

  /* ── Export — real CSV of the current filtered result set ─────────────── */
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);

    try {
      const first = await vehicleHireAPI.listTrips({ ...filterParams, page: 1, limit: 100 });
      let exportedRows = first.data?.data || [];
      const totalPages = first.data?.pagination?.totalPages || 1;

      for (let page = 2; page <= totalPages; page += 1) {
        const next = await vehicleHireAPI.listTrips({ ...filterParams, page, limit: 100 });
        exportedRows = exportedRows.concat(next.data?.data || []);
      }

      if (!exportedRows.length) {
        showToast('There is nothing to export for these filters.', 'error');
        return;
      }

      const header = [
        'Trip / Order',
        'Booking',
        'Customer',
        'Pickup',
        'Drop',
        'Goods',
        'Vehicle',
        'Driver',
        'Driver Mobile',
        'Vendor',
        'Trip Date',
        'Operational Status',
        'Billing Model',
        'Gross Hire',
        'Commission',
        'Net Payable',
      ];

      const lines = [header.map(csvCell).join(',')];
      exportedRows.forEach((row) => {
        const status = operationalStatus(row);
        lines.push(
          [
            row.trip_number || '',
            row.booking_number || '',
            customerName(row),
            row.route?.pickup_city || city(row.route?.pickup),
            row.route?.drop_city || city(row.route?.drop),
            goodsLine(row),
            row.vehicle?.vehicle_number || '',
            row.driver?.driver_name || '',
            row.driver?.mobile || '',
            row.vendor?.owner_name || '',
            fmtDate(row.trip_date),
            status.label,
            row.vehicleHire?.business_model || '',
            row.vehicleHire?.gross_hire ?? '',
            row.vehicleHire?.commission_amount ?? '',
            row.vehicleHire?.net_vendor_payable ?? '',
          ]
            .map(csvCell)
            .join(',')
        );
      });

      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `vehicle-hire-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(href);

      showToast(`Exported ${exportedRows.length} row${exportedRows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast(err.response?.data?.message || err.message || 'Export failed.', 'error');
    } finally {
      setExporting(false);
    }
  };

  /* ── Hire picker — a real waiting-trip picker, then the real workspace ── */
  useEffect(() => {
    if (!hirePickerOpen) return undefined;

    let cancelled = false;
    setHirePickerLoading(true);
    setHirePickerError(null);

    vehicleHireAPI
      .listTrips({
        view: 'all',
        hire_state: 'WAITING_FOR_VEHICLE',
        search: debouncedPickerSearch || undefined,
        page: 1,
        limit: 12,
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.data?.success) throw new Error(response.data?.message || 'Failed to load trips');
        setHirePickerRows(response.data.data || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setHirePickerError(err.response?.data?.message || err.message || 'Failed to load trips');
      })
      .finally(() => {
        if (!cancelled) setHirePickerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hirePickerOpen, debouncedPickerSearch, hirePickerNonce]);

  const openHirePicker = () => {
    setHirePickerSearch('');
    setHirePickerRows([]);
    setHirePickerError(null);
    setHirePickerOpen(true);
  };

  /* ── Derived display values ───────────────────────────────────────────── */
  const statusCount = (key) => {
    const statuses = counts.statuses || {};
    if (key === 'ALL') return statuses.all ?? counts.shown ?? 0;
    return statuses[key.toLowerCase()] ?? 0;
  };

  const kpiValue = (key) => {
    if (key === 'waiting') return counts.waiting;
    if (key === 'hired') return counts.hired;
    if (key === 'toLoading') return counts.to_loading;
    if (key === 'grossHire') return inr(counts.gross_hire);
    if (key === 'commission') return inr(counts.commission_amount);
    return inr(counts.net_vendor_payable);
  };

  const kpiFilter = (card) => {
    // The KPI's historic "to loading" figure combines both loading stages.
    // Drill into whichever stage actually holds the rows.
    if (card.key === 'toLoading') {
      return (counts.statuses?.to_loading || 0) > 0 ? 'TO_LOADING' : 'LOADING';
    }
    return card.filter;
  };

  const startRecord = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endRecord = Math.min(startRecord + rows.length - 1, pagination.total);
  const totalPages = Math.max(1, pagination.totalPages);
  const pages = pageItems(pagination.page, totalPages);

  /* ── Columns ──────────────────────────────────────────────────────────── */
  const columns = useMemo(
    () => [
      {
        key: 'trip_number',
        header: 'TRIP / ORDER',
        width: '148px',
        render: (row) => {
          const r = row;
          const hasHire = Boolean(r.vehicleHire);
          const href = tripOrderHref(r);
          return (
            <div className="min-w-0">
              {href ? (
                <button
                  type="button"
                  onClick={() => navigate(href, { state: { from: '/admin/vehicle-hire' } })}
                  className="block max-w-full truncate text-left text-[12px] font-bold text-[#F97316] transition-colors duration-150 hover:text-bt-orange hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange/40"
                  title={`Open ${r.trip_number || `trip ${r.trip_id}`}`}
                >
                  {r.trip_number || `Trip #${r.trip_id}`}
                </button>
              ) : (
                <p className="truncate text-[13px] font-semibold text-bt-navy">{r.trip_number}</p>
              )}

              <div className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[9.5px] text-[#5B6B82]">
                <button
                  type="button"
                  onClick={() => navigate(`/admin/trips/${r.trip_id}/vehicle-hire`)}
                  className="inline-flex shrink-0 items-center gap-1 rounded transition-colors hover:text-[#0B2B52] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25"
                  title={hasHire ? 'Edit this hire' : 'Hire a vehicle for this trip'}
                >
                  <Pencil className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                  {hasHire ? 'Edit Hire' : 'Hire'}
                </button>
                <span className="h-2.5 w-px shrink-0 bg-[#E2E8F0]" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => navigate(`/admin/trips/${r.trip_id}`, { state: { from: '/admin/vehicle-hire' } })}
                  className="inline-flex shrink-0 items-center gap-1 rounded transition-colors hover:text-[#0B2B52] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25"
                  title="View the trip workspace"
                >
                  <Eye className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                  View Trip
                </button>
              </div>
            </div>
          );
        },
      },
      {
        key: 'customer_route',
        header: 'CUSTOMER / ROUTE',
        width: '170px',
        render: (row) => {
          const goods = goodsLine(row);
          return (
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-bold text-[#0B2B52]" title={customerName(row)}>
                {customerName(row)}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-[#5B6B82]" title={routeLine(row)}>
                {routeLine(row)}
              </p>
              {goods ? (
                <p className="mt-0.5 truncate text-[9px] text-[#94A3B8]" title={goods}>
                  {goods}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'vehicle_driver_vendor',
        header: 'VEHICLE / DRIVER / VENDOR',
        width: '184px',
        render: (row) => {
          const vehicle = row.vehicle;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#F8FAFD]">
                {vehicle?.vehicle_id ? (
                  <img
                    src={vehicleImage(vehicle)}
                    alt=""
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Truck className="h-4 w-4 text-[#CBD5E1]" strokeWidth={1.8} aria-hidden="true" />
                )}
              </span>

              <div className="min-w-0">
                {vehicle?.vehicle_id ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/vehicles/${vehicle.vehicle_id}`)}
                    className="block max-w-full truncate text-left text-[10.5px] font-bold text-[#0B2B52] transition-colors hover:text-[#1764E8] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25"
                    title={`View vehicle ${vehicle.vehicle_number}`}
                  >
                    {vehicle.vehicle_number}
                  </button>
                ) : (
                  <p className="truncate text-[10.5px] font-semibold text-[#94A3B8]">Not assigned</p>
                )}

                <p className="mt-0.5 truncate text-[9px] text-[#64748B]">
                  {row.driver?.driver_name || 'No driver'}
                  {row.driver?.mobile ? ` · ${row.driver.mobile}` : ''}
                </p>
                <p className="truncate text-[8.5px] text-[#94A3B8]">
                  {row.vendor?.owner_name || 'No vendor'}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        key: 'trip_date',
        header: 'TRIP DATE',
        width: '100px',
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[10.5px] font-medium text-[#334155]">{fmtDate(row.trip_date)}</p>
            <p className="mt-1 truncate text-[9px] text-[#94A3B8]">
              {row.expected_delivery_date ? fmtDate(row.expected_delivery_date) : '—'}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'OPERATIONAL STATUS',
        width: '120px',
        render: (row) => <StatusPill status={operationalStatus(row)} />,
      },
      {
        key: 'billing_model',
        header: 'BILLING MODEL',
        width: '112px',
        render: (row) => <BillingPill model={row.vehicleHire?.business_model} />,
      },
      {
        key: 'gross_hire',
        header: 'GROSS HIRE',
        width: '102px',
        render: (row) => (
          <p className="text-right text-[10.5px] font-medium text-[#0B2B52]">
            {row.vehicleHire ? inr(row.vehicleHire.gross_hire) : '—'}
          </p>
        ),
      },
      {
        key: 'commission',
        header: 'COMMISSION',
        width: '96px',
        render: (row) => (
          <p className="text-right text-[10.5px] font-medium text-[#0B2B52]">
            {row.vehicleHire ? inr(row.vehicleHire.commission_amount) : '—'}
          </p>
        ),
      },
      {
        key: 'net_payable',
        header: 'NET PAYABLE',
        width: '140px',
        render: (row) => (
          <p className="text-right text-[10.5px] font-bold text-[#1D4ED8]">
            {row.vehicleHire ? inr(row.vehicleHire.net_vendor_payable) : '—'}
          </p>
        ),
      },
      {
        key: 'actions',
        header: 'ACTIONS',
        width: '64px',
        render: (row) => (
          <div className="flex justify-center">
            <ActionMenu
              label={`Actions for ${row.trip_number || `trip ${row.trip_id}`}`}
              width="w-48"
              trigger={(
                <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E7EDF5] bg-white text-[#64748B] transition-colors hover:border-[#CBD5E1] hover:text-[#0B2B52]">
                  <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </span>
              )}
            >
              {(close) => (
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      openHire(row);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-[#334155] transition-colors hover:bg-[#F8FAFD] hover:text-[#0B2B52]"
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#F97316]" strokeWidth={2} aria-hidden="true" />
                    {row.vehicleHire ? 'Edit Hire' : 'Hire Vehicle'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      openTrip(row);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-[#334155] transition-colors hover:bg-[#F8FAFD] hover:text-[#0B2B52]"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-[#64748B]" strokeWidth={2} aria-hidden="true" />
                    View Trip
                  </button>
                </div>
              )}
            </ActionMenu>
          </div>
        ),
      },
    ],
    [navigate]
  );

  /* ── RENDER ───────────────────────────────────────────────────────────── */
  return (
    <AdminShell activeKey="vehicle-hire" workspace navItems={DEFAULT_NAV_ITEMS}>
      <div className="bt-vh w-full min-w-0 px-4 pb-2 pt-3 sm:px-6 lg:px-8">

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-[#7C8CA3]">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="flex h-5 w-5 items-center justify-center rounded text-[#7C8CA3] transition-colors hover:bg-white hover:text-[#0B2B52]"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          </button>
          <span>Operations</span>
          <ChevronRight className="h-3 w-3 text-[#B6C2D2]" strokeWidth={2} aria-hidden="true" />
          <span className="font-semibold text-[#0B2B52]">Vehicle Hire</span>
        </nav>

        {/* ── HERO ─────────────────────────────────────────────────────────
            Full workspace width. The existing Order / Trip Master artwork is
            right-anchored and fades into the page surface, so the heading keeps
            a protected reading column at every desktop width. */}
        <section className="relative mb-1 h-[148px] overflow-hidden rounded-[16px] bg-[#F6FAFF] sm:h-[156px]">
          <img
            src="/assets/bihar-transport-operations-hero.webp"
            srcSet="/assets/bihar-transport-operations-hero.webp 1x, /assets/bihar-transport-operations-hero@2x.webp 2x"
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full max-w-none object-cover object-[58%_45%] opacity-30 sm:left-auto sm:right-0 sm:top-1/2 sm:h-full sm:w-[60%] sm:-translate-y-1/2 sm:object-[50%_45%] sm:opacity-100 lg:w-[62%] xl:w-[min(1166px,80%)]"
          />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[94%] bg-gradient-to-r from-[#F8FBFE] via-[#F8FBFE]/95 to-transparent sm:w-[56%]" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[26%] bg-gradient-to-l from-[#F8FBFE]/80 via-[#F8FBFE]/20 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#F8FBFE] to-transparent" />

          <div className="relative z-10 flex h-full items-center px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <Truck className="h-8 w-8 shrink-0 text-[#0B2B52] sm:h-10 sm:w-10" strokeWidth={1.6} aria-hidden="true" />
              <div className="min-w-0">
                <h1 className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-[#0B2B52] sm:text-[36px] lg:text-[38px]">
                  Vehicle Hire
                </h1>
                <p className="mt-1.5 max-w-[280px] text-[11px] leading-snug text-[#5B6B82] sm:max-w-[320px] sm:text-[13px] lg:max-w-[380px] xl:max-w-[520px]">
                  Hire vehicles for confirmed orders. Manage contract and commission hiring in one place.
                </p>
              </div>
            </div>
          </div>

          <div className="absolute right-4 top-4 z-10 hidden items-start gap-5 lg:flex lg:right-8 lg:top-5">
            <p className="text-right text-[17px] font-bold leading-[1.25] text-[#0B2B52] lg:text-[19px]">
              Moving
              <br />
              Bihar Forward
            </p>
            <ul className="space-y-1.5">
              {TRUST_INDICATORS.map((indicator) => {
                const Icon = indicator.icon;
                return (
                  <li key={indicator.label} className="flex items-center gap-2 text-[10px] font-medium text-[#3E516B] lg:text-[11px]">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/80 shadow-[0_1px_2px_rgba(16,43,76,0.08)]">
                      <Icon className="h-2.5 w-2.5 text-[#1764E8]" strokeWidth={2} aria-hidden="true" />
                    </span>
                    {indicator.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── SIX KPI CARDS ──────────────────────────────────────────────── */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {KPI_CARDS.map((card) => {
            const Icon = card.icon;
            const active = statusFilter === kpiFilter(card);

            return (
              <button
                key={card.key}
                type="button"
                onClick={() => applyStatusFilter(kpiFilter(card))}
                aria-pressed={active}
                className={[
                  'group flex h-[112px] min-w-0 flex-col justify-between rounded-[13px] border px-3 py-2.5 text-left transition-all duration-150 sm:h-[122px] sm:px-3.5 sm:py-3 xl:h-[128px]',
                  card.bg,
                  card.border,
                  active ? 'ring-2 ring-[#1764E8]/15' : 'hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-18px_rgba(16,43,76,0.35)]',
                ].join(' ')}
              >
                <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] sm:h-[33px] sm:w-[33px] sm:rounded-[9px] ${card.iconBg} ${card.iconColor}`}>
                    <Icon className="h-4 w-4 sm:h-[17px] sm:w-[17px]" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold leading-tight text-[#0B2B52] sm:text-[12.5px]">
                      {card.label}
                    </span>
                    <span className="mt-0.5 block text-[8.5px] leading-tight text-[#7C8CA3] sm:text-[9.5px]">
                      {card.sub}
                    </span>
                  </span>
                </div>

                <div className="flex items-end justify-between gap-2">
                  <span className="block whitespace-nowrap text-[21px] font-extrabold leading-none tracking-[-0.03em] text-[#0B2B52] tabular-nums sm:text-[26px] xl:text-[27px]">
                    {kpiValue(card.key)}
                  </span>
                  <span className={`hidden h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full sm:flex ${card.iconBg} ${card.iconColor} transition-transform group-hover:translate-x-0.5`}>
                    <ChevronRight className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── FILTER PANEL ───────────────────────────────────────────────── */}
        <section className="mb-5 rounded-[14px] border border-[#E7EDF5] bg-white p-4 shadow-[0_1px_2px_rgba(16,43,76,0.04)]">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full min-w-0 sm:w-[480px] sm:flex-none xl:w-[520px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetToFirstPage();
                }}
                placeholder="Search trip/order, customer, route, vehicle or driver..."
                aria-label="Search vehicle hires"
                className="bt-vh-field bt-vh-field-icon h-[36px] w-full rounded-[8px] border border-[#E4E9F1] bg-white pl-9 pr-3 text-[11.5px] text-[#0B2B52] outline-none transition-colors placeholder:text-[#9AA9BC] focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>

            <div className="relative w-full sm:w-[158px]">
              <CalendarDays
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <input
                type="date"
                lang="en-GB"
                value={tripDate}
                onChange={(event) => {
                  setTripDate(event.target.value);
                  resetToFirstPage();
                }}
                aria-label="Filter by trip date"
                className="bt-vh-date bt-vh-field bt-vh-field-icon h-[36px] w-full rounded-[8px] border border-[#E4E9F1] bg-white pl-9 pr-2 text-[11.5px] text-[#0B2B52] outline-none transition-colors focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
              />
            </div>

            <div className="relative w-full sm:w-[158px]">
              <select
                value={statusFilter}
                onChange={(event) => applyStatusFilter(event.target.value)}
                aria-label="Filter by status"
                className="bt-vh-select bt-vh-field bt-vh-field-select h-[36px] w-full appearance-none rounded-[8px] border border-[#E4E9F1] bg-white pl-3 pr-8 text-[11.5px] text-[#334155] outline-none transition-colors focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
              >
                <option value="ALL">All Status</option>
                <option value="WAITING">Waiting</option>
                <option value="HIRED">Hired</option>
                <option value="TO_LOADING">To Loading</option>
                <option value="LOADING">Loading</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="DELIVERED">Delivered</option>
                <option value="COMPLETED">Completed</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" strokeWidth={2} aria-hidden="true" />
            </div>

            <div className="relative w-full sm:w-[158px]">
              <select
                value={businessModel}
                onChange={(event) => {
                  setBusinessModel(event.target.value);
                  resetToFirstPage();
                }}
                aria-label="Filter by billing model"
                className="bt-vh-select bt-vh-field bt-vh-field-select h-[36px] w-full appearance-none rounded-[8px] border border-[#E4E9F1] bg-white pl-3 pr-8 text-[11.5px] text-[#334155] outline-none transition-colors focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
              >
                <option value="">All Models</option>
                <option value="CONTRACT">Contract</option>
                <option value="COMMISSION">Commission</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" strokeWidth={2} aria-hidden="true" />
            </div>

            <div className="relative w-full sm:w-[158px]">
              <select
                value={vehicleType}
                onChange={(event) => {
                  setVehicleType(event.target.value);
                  resetToFirstPage();
                }}
                aria-label="Filter by vehicle type"
                className="bt-vh-select bt-vh-field bt-vh-field-select h-[36px] w-full appearance-none rounded-[8px] border border-[#E4E9F1] bg-white pl-3 pr-8 text-[11.5px] text-[#334155] outline-none transition-colors focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
              >
                <option value="">Vehicle Type</option>
                <option value="Truck">Truck</option>
                <option value="Tata Ace">Tata Ace</option>
                <option value="Tempo">Tempo</option>
                <option value="Pickup">Pickup</option>
                <option value="Container">Container</option>
                <option value="17 ft">17 ft Truck</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" strokeWidth={2} aria-hidden="true" />
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-[36px] w-full shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[#E4E9F1] bg-white px-3.5 text-[11px] font-semibold text-[#42526B] transition-colors hover:border-[#CBD5E1] hover:bg-[#F8FAFD] hover:text-[#0B2B52] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25 sm:ml-auto sm:w-auto"
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Clear Filters
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {STATUS_CHIPS.map((chip) => (
              <StatusChip
                key={chip.key}
                chip={chip}
                count={statusCount(chip.key)}
                active={statusFilter === chip.key}
                onClick={() => applyStatusFilter(chip.key)}
              />
            ))}

            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex h-[36px] flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-[#DCE3ED] bg-white px-3.5 text-[11.5px] font-semibold text-[#334155] transition-colors hover:border-[#CBD5E1] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25 sm:flex-none"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                )}
                Export
              </button>

              <button
                type="button"
                onClick={openHirePicker}
                className="inline-flex h-[36px] flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-[#0B2B52] px-4 text-[11.5px] font-semibold text-white shadow-[0_6px_16px_-10px_rgba(11,43,82,0.7)] transition-colors hover:bg-[#123A6B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/40 sm:flex-none"
              >
                <Truck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Hire Vehicle
              </button>
            </div>
          </div>
        </section>

        {/* ── TABLE ──────────────────────────────────────────────────────── */}
        {error ? (
          <ErrorState
            title="Could not load vehicle hires"
            message={error}
            onRetry={load}
            retryLabel="Retry"
          />
        ) : !loading && rows.length === 0 ? (
          <BlankState
            title="No trips match these filters"
            subtitle="Widen the search or clear the filters to return to the full vehicle-hire queue."
            action={(
              <Button variant="secondary" onClick={clearFilters}>
                Clear Filters
              </Button>
            )}
          />
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-[#E7EDF5] bg-white shadow-[0_1px_2px_rgba(16,43,76,0.04)]">
            <PremiumTable
              className="bt-vh-table"
              columns={columns}
              rows={rows}
              loading={loading}
              selectedIds={selectedIds}
              onSelect={toggleRow}
              onSelectAll={toggleAll}
              isAllSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              getRowId={(row) => row.trip_id}
            />

            {/* ── PAGINATION FOOTER ─────────────────────────────────────── */}
            <div className="flex flex-col gap-3 border-t border-[#EDF1F7] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10.5px] text-[#64748B]">
                Showing <span className="font-semibold text-[#334155]">{startRecord}</span> to{' '}
                <span className="font-semibold text-[#334155]">{endRecord}</span> of{' '}
                <span className="font-semibold text-[#334155]">{pagination.total}</span> results
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <label className="relative">
                  <span className="sr-only">Rows per page</span>
                  <select
                    value={pagination.limit}
                    onChange={(event) => changePageSize(Number(event.target.value))}
                    className="bt-vh-select bt-vh-field bt-vh-pagesize h-8 w-[118px] appearance-none rounded-[7px] border border-[#E4E9F1] bg-white pl-2.5 pr-7 text-[10.5px] font-medium text-[#334155] outline-none transition-colors focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
                  >
                    {[5, 10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>{size} per page</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#94A3B8]" strokeWidth={2} aria-hidden="true" />
                </label>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changePage(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E4E9F1] bg-white text-[#64748B] transition-colors hover:border-[#CBD5E1] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>

                  {pages.map((page) =>
                    typeof page === 'number' ? (
                      <button
                        key={page}
                        type="button"
                        onClick={() => changePage(page)}
                        aria-current={page === pagination.page ? 'page' : undefined}
                        className={`flex h-7 min-w-[28px] items-center justify-center rounded-[7px] border px-1.5 text-[10.5px] font-semibold transition-colors ${
                          page === pagination.page
                            ? 'border-[#1764E8] bg-[#1764E8] text-white shadow-[0_4px_10px_rgba(23,100,232,0.24)]'
                            : 'border-[#E4E9F1] bg-white text-[#475569] hover:border-[#CBD5E1] hover:bg-[#F8FAFD]'
                        }`}
                      >
                        {page}
                      </button>
                    ) : (
                      <span key={page} className="flex h-7 w-6 items-center justify-center text-[10.5px] text-[#94A3B8]">
                        …
                      </span>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => changePage(pagination.page + 1)}
                    disabled={pagination.page >= totalPages}
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E4E9F1] bg-white text-[#64748B] transition-colors hover:border-[#CBD5E1] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TOAST ──────────────────────────────────────────────────────── */}
        {toast ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
            <div
              role="status"
              className={`pointer-events-auto rounded-xl px-4 py-2.5 text-[12.5px] font-medium text-white shadow-lg ${
                toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-600'
              }`}
            >
              {toast.message}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── REAL HIRE PICKER ─────────────────────────────────────────────── */}
      <AdminModal
        open={hirePickerOpen}
        onClose={() => setHirePickerOpen(false)}
        title="Hire Vehicle"
        description="Choose a confirmed trip that is waiting for a vehicle. The existing universal hire workspace opens next."
        icon={Truck}
        size="md"
        footer={(
          <Button variant="secondary" onClick={() => setHirePickerOpen(false)}>
            Close
          </Button>
        )}
      >
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              type="search"
              value={hirePickerSearch}
              onChange={(event) => setHirePickerSearch(event.target.value)}
              placeholder="Search waiting trips by number, customer or route..."
              aria-label="Search waiting trips"
              className="bt-vh-field bt-vh-field-icon h-10 w-full rounded-[9px] border border-[#E4E9F1] bg-white pl-9 pr-3 text-[12.5px] text-[#0B2B52] outline-none transition-colors placeholder:text-[#9AA9BC] focus:border-[#B9C9DE] focus:ring-2 focus:ring-[#1764E8]/10"
            />
          </div>

          {hirePickerLoading ? (
            <div className="flex items-center justify-center py-10 text-[12px] text-[#64748B]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              Loading waiting trips…
            </div>
          ) : hirePickerError ? (
            <ErrorState
              title="Could not load waiting trips"
              message={hirePickerError}
              onRetry={() => setHirePickerNonce((value) => value + 1)}
            />
          ) : hirePickerRows.length === 0 ? (
            <BlankState
              title="No waiting trips"
              subtitle="Every confirmed trip already has a vehicle, or nothing matches this search."
            />
          ) : (
            <ul className="divide-y divide-[#EEF2F7] overflow-hidden rounded-[10px] border border-[#E7EDF5]">
              {hirePickerRows.map((trip) => (
                <li key={trip.trip_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setHirePickerOpen(false);
                      openHire(trip);
                    }}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#F8FAFD]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#FFF4DD] text-[#D97706]">
                      <Truck className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-[#F97316]">
                        {trip.trip_number || `Trip #${trip.trip_id}`}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-[#64748B]">
                        {customerName(trip)} · {routeLine(trip)}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-[10px] text-[#94A3B8] sm:block">
                      {fmtDate(trip.trip_date)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#94A3B8]" strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AdminModal>
    </AdminShell>
  );
}
