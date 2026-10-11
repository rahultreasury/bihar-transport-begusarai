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
 *   and the business model is derived from it. Splitting them would mean two
 *   flows drifting apart over the same arithmetic.
 *
 * EVERY FIGURE IS REAL AND SERVER-SOURCED
 *   The rows come from GET /api/vehicle-hire/trips, which joins the existing
 *   `trips` table to the `vehicle_hires` records. Gross Vehicle Hire, Commission
 *   and Net Vendor Payable are read from their own stored Decimal columns and
 *   are displayed as THREE SEPARATE values — the gross is never replaced by the
 *   net, here or anywhere else in this module.
 *
 * THE THREE CONCEPTS STAY SEPARATE
 *   Customer Freight, Vehicle Gross Hire and Net Vendor Payable are different
 *   things and are never merged into one column. Customer freight belongs to the
 *   customer relationship; the other two belong to the vehicle vendor.
 *
 * DESIGN
 *   Rendered entirely from the shared console vocabulary — AdminShell, PageHeader,
 *   StatusBadge, SearchBar, FilterSelect, ErrorState, BlankState —
 *   so it reads as a native part of the Bihar Transport Operations Console.
 *   The hiring form itself lives in VehicleHireWorkspace.jsx; this page merely
 *   presents the operational list and lets a trip open that workspace directly.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  Search,
  CalendarDays,
  Package,
  Wallet,
  TrendingDown,
  AlertTriangle,
  ExternalLink,
  FileDown,
} from 'lucide-react';

import AdminShell, {
  PageHeader,
  Button,
  StatusBadge,
  SearchBar,
  FilterSelect,
  ErrorState,
  BlankState,
  PremiumTable,
} from '../components/admin-premium/ui';
import VehicleHireWorkspace from '../components/admin-premium/trips/process/VehicleHireWorkspace';
import { vehicleHireAPI } from '../services/vehicleHireAPI';

/* ══════════════════════════════════════════════════════════════════════════
   FORMATTING
   ═════════════════════════════════════════════════════════════════════════ */

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return rupees.format(n);
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).replace(/[_-]+/g, ' ').trim();
  if (!text) return '—';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export default function AdminVehicleHireList() {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({
    waiting: 0,
    assigned: 0,
    hired: 0,
    to_loading: 0,
    shown: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [businessModel, setBusinessModel] = useState('');
  const [operationalStatus, setOperationalStatus] = useState('');

  const debouncedSearch = useDebounce(search);
  const debouncedTripDate = useDebounce(tripDate);
  const debouncedVehicleType = useDebounce(vehicleType);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /* ── Debounce a value so search does not fire a request per keystroke. */
  function useDebounce(value, delay = 350) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
      const handle = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(handle);
    }, [value, delay]);
    return debounced;
  }

/* ── Load the real list ────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const view = operationalStatus
        ? operationalStatus === 'VEHICLE_HIRED'
          ? 'hired'
          : operationalStatus === 'WAITING_FOR_VEHICLE' || operationalStatus === 'VEHICLE_ASSIGNED'
            ? 'waiting'
            : operationalStatus === 'TO_LOADING_POINT' || operationalStatus === 'AT_LOADING_POINT'
              ? 'all'
              : 'all'
        : undefined;
      const response = await vehicleHireAPI.listTrips({
        search: debouncedSearch || undefined,
        trip_date: debouncedTripDate || undefined,
        vehicle_type: debouncedVehicleType || undefined,
        business_model: businessModel || undefined,
        view,
        page: 1,
        limit: 25,
      });

      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Failed to load vehicle hires');
      }

      setRows(response.data.data || []);
      setCounts({
        waiting: response.data.counts?.waiting || 0,
        assigned: response.data.counts?.assigned || 0,
        hired: response.data.counts?.hired || 0,
        to_loading: response.data.counts?.to_loading || response.data.counts?.toLoading || 0,
        shown: response.data.data?.length || 0,
        gross_hire: response.data.counts?.gross_hire || 0,
        commission_amount: response.data.counts?.commission_amount || 0,
        net_vendor_payable: response.data.counts?.net_vendor_payable || 0,
      });
      setPagination(response.data.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load vehicle hires');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, debouncedTripDate, debouncedVehicleType, businessModel, operationalStatus]);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Set filter, return to page 1 ─────────────────────────────────────── */
  const setFilter = (setter) => (value) => {
    setter(value);
  };

  /* ── RENDER ─────────────────────────────────────────────────────────────── */

  return (
    <AdminShell activeKey="vehicle-hire" onNav={() => {}}>
      <PageHeader
        eyebrow="Operations"
        title="Vehicle Hire"
        description="This is one universal workflow for contract and commission hiring."
        actions={(
          <Button
            variant="secondary"
            icon={RefreshIcon}
            loading={loading}
            onClick={load}
          >
            Refresh
          </Button>
        )}
      />

      {/* ── OPERATIONAL COUNTERS ─────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setOperationalStatus('WAITING_FOR_VEHICLE')}
          className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2 hover:bg-white"
        >
          <div className="flex items-center gap-1.5">
            <StatusBadge status="WAITING_FOR_VEHICLE" label="Waiting for Vehicle" tone="warning" />
          </div>
          <span className="text-bt-navy">{counts.waiting}</span>
        </button>
        <button
          type="button"
          onClick={() => setOperationalStatus('VEHICLE_HIRED')}
          className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2 hover:bg-white"
        >
          <div className="flex items-center gap-1.5">
            <StatusBadge status="VEHICLE_HIRED" label="Vehicle Hired" tone="success" />
          </div>
          <span className="text-bt-navy">{counts.hired}</span>
        </button>
        <button
          type="button"
          onClick={() => setOperationalStatus('TO_LOADING_POINT')}
          className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2 hover:bg-white"
        >
          <div className="flex items-center gap-1.5">
            <StatusBadge status="TO_LOADING_POINT" label="To Loading" tone="info" />
          </div>
          <span className="text-bt-navy">{counts.to_loading}</span>
        </button>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2">
          <span>Gross Vehicle Hire</span>
          <span className="text-bt-navy">{inr(counts.gross_hire || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2">
          <span>Commission</span>
          <span className="text-bt-navy">{inr(counts.commission_amount || 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2 text-left text-[11px] font-semibold text-bt-ink-2">
          <span>Net Vendor Payable</span>
          <span className="text-bt-navy">{inr(counts.net_vendor_payable || 0)}</span>
        </div>
      </div>

      {/* ── FILTERS ───────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search trip/order, customer, route, vehicle..."
          className="sm:col-span-2"
        />
        <input
          type="date"
          value={tripDate}
          onChange={(e) => setTripDate(e.target.value)}
          className="bt-input bt-input-sm"
        />
        <FilterSelect
          value={operationalStatus}
          onChange={(v) => setOperationalStatus(v)}
          options={[
            { value: '', label: 'All Status' },
            { value: 'WAITING_FOR_VEHICLE', label: 'Waiting' },
            { value: 'VEHICLE_ASSIGNED', label: 'Assigned' },
            { value: 'VEHICLE_HIRED', label: 'Hired' },
            { value: 'TO_LOADING_POINT', label: 'To Loading' },
          ]}
          placeholder="Operational Status"
        />
        <FilterSelect
          value={businessModel}
          onChange={(v) => setBusinessModel(v)}
          options={[
            { value: '', label: 'All Models' },
            { value: 'CONTRACT', label: 'Contract' },
            { value: 'COMMISSION', label: 'Commission' },
          ]}
          placeholder="Business Model"
        />
        <input
          type="text"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value)}
          placeholder="Vehicle Type"
          className="bt-input bt-input-sm"
        />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-bt-ink-3">
          TRIP LIST ({rows.length})
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            setTripDate('');
            setVehicleType('');
            setBusinessModel('');
            setOperationalStatus('');
          }}
        >
          Clear Filters
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-bt-orange border-t-transparent" />
        </div>
      ) : error ? (
        <ErrorState
          title="Could not load vehicle hires"
          message={error}
          onRetry={load}
          retryLabel="Retry"
        />
      ) : rows.length === 0 ? (
        <BlankState
          title="No trips match these filters"
          subtitle="Every confirmed trip currently has a vehicle hired. Switch to 'Vehicle Hired' to review them."
          action={(
            <Button
              variant="secondary"
              onClick={() => {
                // reset filters
                setSearch('');
                setTripDate('');
                setVehicleType('');
                setBusinessModel('');
                setOperationalStatus('');
            }}
            className="mt-2"
            >
                Refresh
            </Button>
          )}
        />
      ) : (
        <PremiumTable
          rows={rows.map((r) => ({ ...r, id: r.trip_id }))}
          columns={[
            {
              key: 'trip_number',
              header: 'Trip / Order',
              width: '20%',
              render: (r) => (
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-bt-navy">{r.trip_number}</p>
                  {r.booking_number ? (
                    <p className="truncate text-[11px] text-bt-ink-3">Booking: {r.booking_number}</p>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              width: '20%',
              render: (r) => (
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-bt-navy">{r.customer || '—'}</p>
                  <p className="truncate text-[11px] text-bt-ink-3">{humanize(r.customer_type || '')}</p>
                </div>
              ),
            },
            {
              key: 'trip_date',
              header: 'Trip / Delivery Date',
              width: '15%',
              render: (r) => (
                <div className="min-w-0 text-[12px]">
                  <p className="text-bt-navy">{r.trip_date ? fmtDate(r.trip_date) : '—'}</p>
                  <p className="text-bt-ink-3">{r.expected_delivery_date ? fmtDate(r.expected_delivery_date) : '—'}</p>
                </div>
              ),
            },
            {
              key: 'vehicle_driver_vendor',
              header: 'Vehicle / Driver / Vendor',
              width: '20%',
              render: (r) => (
                <div className="min-w-0 text-[11px]">
                  <p className="truncate text-bt-navy">{r.vehicle?.vehicle_number || '—'}</p>
                  <p className="truncate text-bt-ink-3">{r.driver?.driver_name || '—'}</p>
                  <p className="truncate text-bt-ink-3">{r.transportOwner?.owner_name || '—'}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Operational Status',
              width: '12%',
              render: (r) => {
                const hireState = r.hire_status || (r.vehicle_id ? (r.vehicleHire ? 'VEHICLE_HIRED' : 'VEHICLE_ASSIGNED') : 'WAITING_FOR_VEHICLE');
                const hireLabels = {
                  WAITING_FOR_VEHICLE: 'Waiting',
                  VEHICLE_ASSIGNED: 'Assigned',
                  VEHICLE_HIRED: 'Hired',
                };
                return (
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={hireState} label={hireLabels[hireState] || humanize(hireState)} tone={hireState === 'VEHICLE_HIRED' ? 'success' : hireState === 'VEHICLE_ASSIGNED' ? 'info' : 'warning'} />
                    <p className="text-[10px] text-bt-ink-3/50 mt-0.5">
                      {humanize(r.status)}
                    </p>
                  </div>
                );
              },
            },
            {
              key: 'billing_model',
              header: 'Billing Model',
              width: '8%',
              render: (r) => (
                <span className="text-[11px] text-bt-ink-2">
                  {humanize(r.vehicleHire?.business_model || r.business_model || '') || '—'}
                </span>
              ),
            },
            {
              key: 'gross_hire',
              header: 'Gross Hire',
              width: '10%',
              align: 'right',
              render: (r) => (
                <span className="text-[11px] text-bt-navy">{inr(r.vehicleHire?.gross_hire || 0)}</span>
              ),
            },
            {
              key: 'commission',
              header: 'Commission',
              width: '10%',
              align: 'right',
              render: (r) => (
                <span className="text-[11px] text-bt-ink-2">{inr(r.vehicleHire?.commission_amount || 0)}</span>
              ),
            },
            {
              key: 'net_payable',
              header: 'Net Vendor Payable',
              width: '12%',
              align: 'right',
              render: (r) => (
                <span className="text-[11px] font-medium text-bt-navy">{inr(r.vehicleHire?.net_vendor_payable || 0)}</span>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              width: '12%',
              align: 'center',
              render: (r) => {
                const hasHire = Boolean(r.vehicleHire);
                const canHire = r.vehicle_id === null && !hasHire;
                return (
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {canHire ? (
                      <Button
                        variant="accent"
                        size="sm"
                        icon={Truck}
                        onClick={() => navigate(`/admin/trips/${r.trip_id}/vehicle-hire`)}
                      >
                        Hire Vehicle
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Truck}
                        onClick={() => navigate(`/admin/trips/${r.trip_id}/vehicle-hire?edit=1`)}
                      >
                        Edit Hire
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ExternalLink}
                      onClick={() => navigate(`/admin/trips/${r.trip_id}`, { state: { from: '/admin/vehicle-hire' } })}
                    >
                      View Trip
                    </Button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-[13px] font-medium text-white shadow-lg ${
              toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-600'
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}

/** A refresh glyph that is not pulled from the icon set, kept local. */
function RefreshIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}