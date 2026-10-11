/**
 * TripDetailWorkspace.jsx
 * ============================================================================
 * CENTRAL TRIP DETAIL WORKSPACE — /admin/trips/:tripId
 *
 * The single, complete operational workspace for one trip. It is reached from
 * Vehicle Hire (View), the Trips list and Bookings, and it is the ONLY trip
 * detail surface — there is no second, disconnected trip detail page.
 *
 * Tabs: Overview · Vehicle · Loading · Documents · Billing · Payments · POD · History
 *
 * Every tab reuses the EXISTING process workspace components and the REAL
 * backend APIs. No business logic is duplicated here; this component wires the
 * existing workspaces together behind one header, one lifecycle rail and one
 * tab bar, and provides the shared `onRun` runner that re-reads the trip after
 * every operational action (the server writes the movement-history event as part
 * of the same request, so the operator never records it by hand).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, Calendar, CheckCircle2, ChevronRight,
  CircleDollarSign, ClipboardList, Clock, FileCheck2, FileText,
  History as HistoryIcon, Info, Landmark, Loader2, MapPin, Package,
  Receipt, RefreshCw, ScrollText, ShieldCheck, Truck, UploadCloud,
  User, Wallet, XCircle, AlertTriangle, Eye,
} from 'lucide-react';
import { adminAPI, tripFinancialAPI } from '../../../../services/api';
import { adminEnquiryAPI } from '../../../../services/enquiryAPI';
import { vehicleHireAPI } from '../../../../services/vehicleHireAPI';
import AdminShell from '../../layout/AdminShell';
import ErrorBoundary from '../../../../components/ErrorBoundary';
import { Badge, Facts, Notice, ConfirmModal, inr, fmtDate, cx } from './dispatchAtoms';
import VehicleWorkspace from './VehicleWorkspace';
import LoadingWorkspace from './LoadingWorkspace';
import TransitWorkspace from './TransitWorkspace';
import DeliveryWorkspace from './DeliveryWorkspace';
import PodWorkspace from './PodWorkspace';
import CompletionWorkspace from './CompletionWorkspace';
import TripFinanceWorkspace from './TripFinanceWorkspace';

const TABS = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'vehicle', label: 'Vehicle', icon: Truck },
  { id: 'loading', label: 'Loading', icon: Package },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'billing', label: 'Billing', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CircleDollarSign },
  { id: 'pod', label: 'POD', icon: FileCheck2 },
  { id: 'history', label: 'History', icon: HistoryIcon },
];

const LIFECYCLE_STEPS = [
  { key: 'ENQUIRY', label: 'Enquiry' },
  { key: 'RATE_QUOTED', label: 'Rate Quoted' },
  { key: 'ORDER_CONFIRMED', label: 'Order Confirmed' },
  { key: 'WAITING_FOR_VEHICLE', label: 'Waiting for Vehicle' },
  { key: 'VEHICLE_HIRED', label: 'Vehicle Hired' },
  { key: 'TO_LOADING_POINT', label: 'To Loading Point' },
  { key: 'AT_LOADING_POINT', label: 'At Loading Point' },
  { key: 'LOADED', label: 'Loaded / Waiting Dispatch' },
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: 'IN_TRANSIT', label: 'In Transit' },
  { key: 'AT_DELIVERY_POINT', label: 'At Delivery Point' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'POD_PENDING', label: 'POD Pending' },
  { key: 'POD_RECEIVED', label: 'POD Received' },
  { key: 'COMPLETED', label: 'Completed' },
];

const ALLOWED_BACK_PATHS = new Set([
  '/admin/vehicle-hire',
  '/admin/trips',
  '/admin/bookings',
  '/admin/enquiries',
  '/admin/dashboard',
]);

/** Validate a return path against an allow-list. Never trust arbitrary URLs. */
function getValidBackPath(location) {
  const candidates = [
    location?.state?.from,
    location?.state?.returnTo,
    typeof document !== 'undefined' ? document.referrer : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.startsWith('/')) continue;
    try {
      const url = new URL(candidate, window.location.origin);
      if (ALLOWED_BACK_PATHS.has(url.pathname)) return url.pathname;
    } catch {
      // ignore malformed URLs
    }
  }
  return '/admin/vehicle-hire';
}

function lifecycleIndexFor(trip) {
  if (!trip) return -1;
  if (trip.status === 'CANCELLED') return -1;
  const map = {
    PENDING: 0,
    ASSIGNED: 4,
    TO_LOADING_POINT: 5,
    AT_LOADING_POINT: 6,
    LOADED: 7,
    DISPATCHED: 8,
    IN_TRANSIT: 9,
    DELIVERED: 11,
    COMPLETED: 14,
  };
  let idx = map[trip.status] ?? 0;
  if (trip.quotation_number || trip.quoted_amount != null) idx = Math.max(idx, 1);
  if (trip.status !== 'PENDING' || trip.confirmed_at) idx = Math.max(idx, 2);
  if (trip.status === 'PENDING' && !trip.vehicle_hire_id) idx = Math.max(idx, 3);
  if (trip.pod_required && trip.status === 'DELIVERED' && !trip.pod_received_at) idx = 12;
  if (trip.pod_required && trip.pod_received_at) idx = 13;
  if (!trip.pod_required && trip.status === 'DELIVERED') idx = 14;
  return idx;
}

function SectionCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ icon: Icon = Info, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <Icon className="h-6 w-6 text-slate-400" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="max-w-md text-xs text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-red-500" />
      <p className="text-sm font-medium text-red-700">{message || 'Failed to load trip details'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

function LoadingState({ label = 'Loading trip workspace...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-12 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      <p className="text-sm text-slate-600">{label}</p>
    </div>
  );
}

/** Map each lifecycle step to the workspace tab that owns it. */
const STEP_TAB = {
  ENQUIRY: 'overview',
  RATE_QUOTED: 'overview',
  ORDER_CONFIRMED: 'overview',
  WAITING_FOR_VEHICLE: 'vehicle',
  VEHICLE_HIRED: 'vehicle',
  TO_LOADING_POINT: 'loading',
  AT_LOADING_POINT: 'loading',
  LOADED: 'loading',
  DISPATCHED: 'loading',
  IN_TRANSIT: 'loading',
  AT_DELIVERY_POINT: 'pod',
  DELIVERED: 'pod',
  POD_PENDING: 'pod',
  POD_RECEIVED: 'pod',
  COMPLETED: 'pod',
};

function LifecycleRail({ trip, cancellationReason, onGoTab }) {
  const current = lifecycleIndexFor(trip);
  const isCancelled = trip?.status === 'CANCELLED';
  const podRequired = Boolean(trip?.pod_required);
  const steps = useMemo(() => {
    if (!podRequired) {
      return LIFECYCLE_STEPS.filter((s) => s.key !== 'POD_PENDING' && s.key !== 'POD_RECEIVED');
    }
    return LIFECYCLE_STEPS;
  }, [podRequired]);
  const effectiveCurrent = !podRequired && current > 11 ? current - 2 : current;

  if (isCancelled) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-red-700">
          <Ban className="h-4 w-4" /> Trip Cancelled
        </div>
        {cancellationReason && (
          <p className="mt-1 text-xs text-red-600">Reason: {cancellationReason}</p>
        )}
        {trip?.cancelled_at && (
          <p className="mt-0.5 text-xs text-red-500">Cancelled on {fmtDate(trip.cancelled_at)}</p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          The cancellation reason and full audit history are preserved in the History tab.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-center">
        {steps.map((step, i) => {
          const done = i < effectiveCurrent;
          const active = i === effectiveCurrent;
          const tab = STEP_TAB[step.key] || 'overview';
          const reached = i <= effectiveCurrent;
          return (
            <li key={step.key} className="flex items-center">
              <button
                type="button"
                onClick={() => onGoTab?.(tab)}
                title={
                  reached
                    ? `${step.label} — open the ${tab} workspace`
                    : `${step.label} — not reached yet. Open the ${tab} workspace to see what is required.`
                }
                className="group flex flex-col items-center gap-1"
              >
                <span
                  className={cx(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
                    done && 'border-emerald-600 bg-emerald-600 text-white',
                    active && 'border-indigo-600 bg-indigo-600 text-white ring-4 ring-indigo-100',
                    !done && !active && 'border-slate-300 bg-white text-slate-400 group-hover:border-indigo-300 group-hover:text-indigo-500'
                  )}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <span
                  className={cx(
                    'whitespace-nowrap text-[10px] font-medium',
                    active ? 'text-indigo-700' : done ? 'text-emerald-700' : 'text-slate-400 group-hover:text-indigo-600'
                  )}
                >
                  {step.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span className={cx('mx-1 mb-4 h-0.5 w-6 rounded', i < effectiveCurrent ? 'bg-emerald-500' : 'bg-slate-200')} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RecentEvents({ timeline, limit = 5 }) {
  const events = useMemo(() => {
    const list = Array.isArray(timeline?.events)
      ? timeline.events
      : Array.isArray(timeline)
        ? timeline
        : [];
    return list.slice(0, limit);
  }, [timeline, limit]);

  if (!events.length) {
    return <EmptyState icon={HistoryIcon} title="No events recorded yet" hint="Events appear here as the trip progresses." />;
  }
  return (
    <ul className="space-y-2">
      {events.map((ev) => {
        const meta = parseMetadata(ev.metadata);
        const label = EVENT_LABELS[ev.event_type] || ev.event_type?.replace(/_/g, ' ') || 'Event';
        const location = meta.location || meta.current_location || null;
        const recordedBy = meta.recorded_by || meta.staff || (ev.created_by ? `Staff #${ev.created_by}` : null);
        return (
          <li key={ev.timeline_id || ev.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            <div className="min-w-0">
              <p className="font-medium text-slate-800">{label}</p>
              <p className="truncate text-xs text-slate-500">{ev.description}</p>
              <p className="text-xs text-slate-500">
                {ev.created_at ? fmtDate(ev.created_at) : ''}
                {location ? ` · ${location}` : ''}
                {recordedBy ? ` · ${recordedBy}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Safely parse a JSON metadata string stored on a timeline event. */
function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

/**
 * Recover the cancellation reason from the timeline. The cancellation event
 * stores its reason in `metadata` (or `details`). Returns null when the trip
 * was not cancelled or no reason was recorded.
 */
function extractCancellationReason(timeline) {
  const list = Array.isArray(timeline?.events)
    ? timeline.events
    : Array.isArray(timeline)
      ? timeline
      : [];
  const cancelEvent = list.find(
    (ev) =>
      (ev.event_type || '').toLowerCase().includes('cancel') ||
      (ev.event_name || '').toLowerCase().includes('cancel')
  );
  if (!cancelEvent) return null;
  const meta = parseMetadata(cancelEvent.metadata);
  return (
    meta.reason ||
    meta.cancellation_reason ||
    cancelEvent.details ||
    cancelEvent.reason ||
    'Reason not recorded'
  );
}

export default function TripDetailWorkspace() {
  const { tripId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tabParam = searchParams.get('tab');
  const activeTab = TABS.some((t) => t.id === tabParam) ? tabParam : 'overview';
  const backPath = useMemo(() => getValidBackPath(location), [location]);

  // ── Shared state: ONE load feeds every tab ──────────────────────────
  const [trip, setTrip] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [delivery, setDelivery] = useState(null);
  const [vehicleAssignment, setVehicleAssignment] = useState(null);
  const [transitTracking, setTransitTracking] = useState(null);
  const [podData, setPodData] = useState(null);
  const [completionData, setCompletionData] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [customerName, setCustomerName] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);

  const stages = useMemo(() => workflow?.stages || [], [workflow]);
  const cancellationReason = useMemo(
    () => extractCancellationReason(timeline),
    [timeline]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [
        tripRes, workflowRes, docsRes, timelineRes, deliveryRes,
      ] = await Promise.all([
        adminAPI.getTrip(tripId),
        adminAPI.getTripWorkflow(tripId).catch(() => null),
        adminAPI.tripOperations.getDocuments(tripId).catch(() => null),
        adminAPI.tripOperations.getTimeline(tripId).catch(() => null),
        adminAPI.tripOperations.getDelivery(tripId).catch(() => null),
      ]);

      const loadedTrip = tripRes?.data?.data || tripRes?.data || null;
      setTrip(loadedTrip);
      setWorkflow(workflowRes?.data?.data || null);
      // GET /trips/:id/documents → { success, data: checklist.items, checklist }
      setDocuments(
        Array.isArray(docsRes?.data?.data)
          ? docsRes.data.data
          : Array.isArray(docsRes?.data?.documents)
            ? docsRes.data.documents
            : []
      );
      setTimeline(timelineRes?.data?.data || timelineRes?.data || []);
      setDelivery(deliveryRes?.data?.data || deliveryRes?.data || null);

      // §13 — resolve the customer name. A trip raised from an enquiry
      // carries enquiry_id but no client/user/booking relation, so the
      // name lives on the enquiry. Read it only when the trip cannot
      // answer for itself; a failure leaves the header as "—".
      const inlineName = loadedTrip?.booking?.customer_name || loadedTrip?.customer_name || null;
      if (inlineName) {
        setCustomerName(inlineName);
      } else if (loadedTrip?.enquiry_id) {
        const enq = await adminEnquiryAPI
          .get(loadedTrip.enquiry_id)
          .then((r) => r?.data?.data || r?.data || null)
          .catch(() => null);
        setCustomerName(
          enq?.customer_name
            || [enq?.customer_first_name, enq?.customer_last_name].filter(Boolean).join(' ')
            || null
        );
      } else {
        setCustomerName(null);
      }

      // Vehicle assignment — the SAME canonical assignment the hire
      // workspace writes, so the stage summary and the form agree.
      const assignment = await vehicleHireAPI.getAssignment(tripId).catch(() => null);
      setVehicleAssignment(assignment?.data?.data || null);

      // Transit workspace — the single source for transit tracking,
      // incidents and vehicle changes (GET /trips/:id/transit).
      try {
        const r = await adminAPI.tripOperations.getTransitWorkspace(tripId);
        setTransitTracking(r?.data?.data || null);
      } catch {
        setTransitTracking(null);
      }

      // POD + completion share the delivery endpoint
      const del = deliveryRes?.data?.data || deliveryRes?.data || null;
      setPodData(del);
      setCompletionData(del);

      // Financials + transaction ledger
      const fin = await tripFinancialAPI.getTripFinancials(tripId).catch(() => null);
      setFinancials(fin?.data?.data || null);
      const tx = await tripFinancialAPI.getTripTransactions(tripId).catch(() => null);
      setTransactions(tx?.data?.data || tx?.data?.transactions || []);
    } catch (err) {
      setLoadError(err?.response?.data?.message || err?.response?.data?.error || 'Trip not found.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /**
   * Run an operational action, then RE-READ everything.
   * The movement-history event is written by the SERVER as part of the
   * same request that changes the status, so the operator never records
   * it and it can never drift from the status it describes.
   * Returns TRUE on success, FALSE on refusal (so a workspace can decide
   * whether to close a confirmation modal).
   */
  const onRun = useCallback(
    async (name, fn) => {
      setBusy(name);
      setActionError(null);
      try {
        await fn();
        await load();
        return true;
      } catch (err) {
        setActionError(err?.response?.data?.message || 'That action could not be completed.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  // Preserve router state (the `from` origin) across tab switches so
  // Back keeps returning to the page the operator came from.
  const goTab = useCallback(
    (tabId) => navigate(`/admin/trips/${tripId}?tab=${tabId}`, { state: location.state }),
    [navigate, tripId, location.state]
  );
  const goBack = useCallback(() => navigate(backPath), [navigate, backPath]);

  if (loading) {
    return (
      <AdminShell activeKey="vehicle-hire" onNav={() => {}}>
        <LoadingState />
      </AdminShell>
    );
  }

  if (loadError || !trip) {
    return (
      <AdminShell activeKey="vehicle-hire" onNav={() => {}}>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={goBack}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <ErrorState message={loadError || 'Trip not found'} onRetry={load} />
        </div>
      </AdminShell>
    );
  }

  const podRequired = Boolean(trip.pod_required);
  const displayName = customerName || trip.customer_name || trip.client_name || trip.booking?.customer_name;

  return (
      <AdminShell activeKey="vehicle-hire" onNav={() => {}}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={goBack}
              className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                {trip.trip_number || trip.booking_number || `Trip #${trip.id}`}
              </h1>
              <Badge state={trip.status} label={trip.status?.replace(/_/g, ' ')} />
              {podRequired && <Badge tone="grey" label="POD Required" />}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" /> {displayName || '—'}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {trip.pickup_location || '—'} → {trip.drop_location || trip.delivery_location || '—'}
              </span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-slate-500">
              {trip.trip_date && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Trip: {fmtDate(trip.trip_date)}
                </span>
              )}
              {trip.expected_delivery_date && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> ETA: {fmtDate(trip.expected_delivery_date)}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* ── Lifecycle rail ─────────────────────────────────────── */}
        <SectionCard
          title="Shipment Lifecycle"
          subtitle="Current operational status — separate from the historical timeline"
          className="mb-4"
        >
          <LifecycleRail trip={trip} cancellationReason={cancellationReason} onGoTab={goTab} />
        </SectionCard>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {/* ── Tab bar ────────────────────────────────────────────── */}
        <div className="mb-4 border-b border-slate-200">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Trip workspace tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => goTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cx(
                    'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Tab content ────────────────────────────────────────── */}
        <div key={activeTab}>
          {activeTab === 'overview' && (
            <OverviewTab
              trip={trip}
              workflow={workflow}
              documents={documents}
              timeline={timeline}
              financials={financials}
              transactions={transactions}
              displayName={displayName}
              onGoTab={goTab}
              onRefresh={refresh}
            />
          )}
          {activeTab === 'vehicle' && (
            <ErrorBoundary fallback={({ error }) => (
              <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-red-800">
                  Vehicle tab error
                </p>
                <p className="mt-1 text-[13px] text-red-900">
                  {error?.message || 'An unexpected error occurred'}
                </p>
              </div>
            )}>
              <VehicleWorkspace
                trip={trip}
                hire={vehicleAssignment}
                hireStatus={vehicleAssignment?.hire_status || trip.status || 'WAITING_FOR_VEHICLE'}
                ops={adminAPI.tripOperations}
                onRun={onRun}
                busy={busy}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'loading' && (
            <LoadingTab
              tripId={tripId}
              trip={trip}
              stages={stages}
              documents={documents}
              transit={transitTracking}
              ops={adminAPI.tripOperations}
              busy={busy}
              onRun={onRun}
            />
          )}
          {activeTab === 'documents' && (
            <DocumentsTab
              tripId={tripId}
              trip={trip}
              documents={documents}
              ops={adminAPI.tripOperations}
              onRun={onRun}
              busy={busy}
              onRefresh={load}
            />
          )}
          {activeTab === 'billing' && <BillingTab tripId={tripId} />}
          {activeTab === 'payments' && (
            <PaymentsTab
              tripId={tripId}
              trip={trip}
              financials={financials}
              transactions={transactions}
              onRefresh={load}
            />
          )}
          {activeTab === 'pod' && (
            <PodTab
              tripId={tripId}
              trip={trip}
              stages={stages}
              delivery={delivery}
              pod={podData}
              completion={completionData}
              documents={documents}
              timeline={timeline}
              ops={adminAPI.tripOperations}
              busy={busy}
              onRun={onRun}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab trip={trip} timeline={timeline} onRefresh={refresh} />
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function OverviewTab({ trip, workflow, documents, timeline, financials, transactions, displayName, onGoTab, onRefresh }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const canCancel = trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED' && trip.status !== 'DELIVERED';
  const fin = financials || {};

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      setCancelError('Cancellation reason is required');
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await adminAPI.tripOperations.cancelTrip(trip.id, { reason: cancelReason.trim() });
      if (res?.success !== false) {
        setCancelOpen(false);
        onRefresh();
      } else {
        setCancelError(res?.error || res?.message || 'Failed to cancel trip');
      }
    } catch (err) {
      setCancelError(err?.response?.data?.message || err?.message || 'Failed to cancel trip');
    } finally {
      setCancelling(false);
    }
  };

  const assigned = Boolean(trip.vehicle_id || trip.vehicle || trip.vehicle_number);
  const driverAssigned = Boolean(trip.driver_id || trip.driver || trip.driver_name);

  return (
    <div className="space-y-4">
      {/* Trip summary */}
      <SectionCard title="Trip Summary" subtitle="Core shipment and party information">
        <Facts
          items={[
            { label: 'Trip / Order No.', value: trip.trip_number || trip.booking_number || `#${trip.id}` },
            { label: 'Customer / Party', value: displayName || '—' },
            { label: 'Route', value: `${trip.pickup_location || '—'} → ${trip.drop_location || trip.delivery_location || '—'}` },
            { label: 'Status', value: trip.status?.replace(/_/g, ' ') },
            { label: 'Trip Date', value: trip.trip_date ? fmtDate(trip.trip_date) : '—' },
            { label: 'Expected Delivery', value: trip.expected_delivery_date ? fmtDate(trip.expected_delivery_date) : '—' },
            { label: 'Material', value: trip.material_name || trip.material || '—' },
            { label: 'Quantity', value: trip.quantity != null ? `${trip.quantity} ${trip.quantity_unit || ''}` : '—' },
            { label: 'Weight', value: trip.weight_kg != null ? `${trip.weight_kg} kg` : '—' },
            { label: 'POD Required', value: trip.pod_required ? 'Yes' : 'No' },
          ]}
        />
        {trip.special_instructions && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Special instructions:</span> {trip.special_instructions}
          </div>
        )}
      </SectionCard>

      {/* Assigned resources */}
      <SectionCard
        title="Vehicle, Vendor & Driver"
        subtitle="Current assignment for this trip"
        action={
          <button
            type="button"
            onClick={() => onGoTab('vehicle')}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            Open Vehicle tab <ChevronRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        {assigned || driverAssigned ? (
          <Facts
            items={[
              { label: 'Vehicle', value: trip.vehicle_number || trip.vehicle?.registration_number || '—' },
              { label: 'Vehicle Type', value: trip.vehicle_type || trip.vehicle?.vehicle_type || '—' },
              { label: 'Vendor / Owner', value: trip.owner_name || trip.vehicle?.owner_name || '—' },
              { label: 'Driver', value: trip.driver_name || trip.driver?.name || '—' },
              { label: 'Driver Phone', value: trip.driver_phone || trip.driver?.phone || '—' },
              { label: 'Hire Status', value: trip.hire_status || (trip.vehicle_hire_id ? 'Hired' : 'Not hired') },
            ]}
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="No vehicle assigned yet"
            hint="This trip is waiting for a vehicle. Open the Vehicle tab to hire a vehicle and driver."
            action={
              <button
                type="button"
                onClick={() => onGoTab('vehicle')}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Truck className="h-3.5 w-3.5" /> Hire Vehicle
              </button>
            }
          />
        )}
      </SectionCard>

      {/* Financial summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => onGoTab('billing')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-indigo-300 hover:shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Customer Billing</span>
            <Wallet className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">{inr(fin.freight ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Collected {inr(fin.customerCollected ?? 0)} · Due {inr(fin.customerDue ?? 0)}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
            Open Billing <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onGoTab('payments')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Vendor / Owner Payment</span>
            <Landmark className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">{inr(fin.ownerShare ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Paid {inr(fin.ownerPaid ?? 0)} · Due {inr(fin.ownerDue ?? 0)}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            Open Payments <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onGoTab('payments')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-amber-300 hover:shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Driver Settlement</span>
            <User className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">{inr(fin.driverAgreedPay ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Paid {inr(fin.driverPaid ?? 0)} · Due {inr(fin.driverDue ?? 0)}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-600">
            Open Payments <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* Quick actions */}
      <SectionCard title="Quick Actions" subtitle="Operational workflows for this trip">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onGoTab('vehicle')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Truck className="h-3.5 w-3.5" /> Vehicle & Hire
          </button>
          <button
            type="button"
            onClick={() => onGoTab('loading')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Package className="h-3.5 w-3.5" /> Loading & Dispatch
          </button>
          <button
            type="button"
            onClick={() => onGoTab('documents')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" /> Documents
          </button>
          <button
            type="button"
            onClick={() => onGoTab('billing')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Receipt className="h-3.5 w-3.5" /> Customer Billing
          </button>
          <button
            type="button"
            onClick={() => onGoTab('pod')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileCheck2 className="h-3.5 w-3.5" /> POD
          </button>
          <button
            type="button"
            onClick={() => onGoTab('history')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <HistoryIcon className="h-3.5 w-3.5" /> Movement History
          </button>
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel Trip
            </button>
          )}
        </div>
      </SectionCard>

      {/* Recent activity preview */}
      <SectionCard
        title="Recent Activity"
        subtitle="Latest recorded events"
        action={
          <button
            type="button"
            onClick={() => onGoTab('history')}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            Full history <ChevronRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        <RecentEvents timeline={timeline} limit={5} />
      </SectionCard>

      {cancelOpen && (
        <ConfirmModal
          open={cancelOpen}
          title="Cancel Trip"
          confirmLabel="Cancel Trip"
          busy={cancelling}
          onCancel={() => { setCancelOpen(false); setCancelError(null); setCancelReason(''); }}
          onConfirm={handleCancel}
        >
          <p className="mb-3 text-xs text-slate-600">
            This will cancel the trip. The cancellation reason and audit history will be
            preserved. This action cannot be undone.
          </p>
          <label className="block text-xs font-medium text-slate-700">
            Cancellation reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Enter reason for cancellation"
          />
          {cancelError && <p className="mt-2 text-xs text-red-600">{cancelError}</p>}
        </ConfirmModal>
      )}
    </div>
  );
}

function LoadingTab({
  tripId, trip, stages, documents, transit, ops, busy, onRun,
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Loading</h3>
        <LoadingWorkspace
          tripId={tripId}
          trip={trip}
          ops={ops}
          busy={busy}
          onRun={onRun}
          documents={documents}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Dispatch</h3>
        {/* ONE dispatch workflow. The dispatch form lives only at
            /admin/trips/:id/dispatch. This tab links to it instead of
            rendering a second copy of the same form, so there is
            exactly one place to dispatch a trip and exactly one set
            of loading and document checks guarding it. */}
        <Link
          to={`/admin/trips/${tripId}/dispatch`}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 transition hover:bg-slate-50"
        >
          <span>
            <span className="block text-[13px] font-semibold text-slate-900">
              Open Dispatch Workspace
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">
              Dispatch is managed in the dedicated dispatch workspace, which re-checks loading
              completion and the mandatory documents before a trip can leave the yard.
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
        </Link>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Transit & Incidents</h3>
        <TransitWorkspace
          tripId={tripId}
          trip={trip}
          stages={stages}
          ops={ops}
          transit={transit}
          busy={busy}
          onRun={onRun}
        />
      </div>
    </div>
  );
}

function DocumentsTab({ tripId, trip, documents, ops, onRun, busy, onRefresh }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({
    document_type: 'LR',
    document_status: 'PRESENT',
    reference_number: '',
    issued_at: '',
    expires_at: '',
    remarks: '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  const items = Array.isArray(documents) ? documents : [];
  const present = items.filter((i) => i.is_present).length;

  const readFile = (f) => new Promise((resolve, reject) => {
    if (!f) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const handleUpload = async () => {
    setError(null);
    try {
      const fileContent = await readFile(file);
      await onRun('documents/upload', async () => {
        await ops.uploadDocument(tripId, {
          document_type: form.document_type,
          document_status: form.document_status,
          reference_number: form.reference_number || undefined,
          issued_at: form.issued_at || undefined,
          expires_at: form.expires_at || undefined,
          remarks: form.remarks || undefined,
          file_name: file?.name,
          file_content: fileContent || undefined,
        });
      });
      setUploadOpen(false);
      setFile(null);
      setForm({ document_type: 'LR', document_status: 'PRESENT', reference_number: '', issued_at: '', expires_at: '', remarks: '' });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Upload failed');
    }
  };

  const handleVerify = (documentId) => onRun('documents/verify', async () => {
    await ops.verifyDocument(tripId, documentId);
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title="Document Checklist"
        subtitle={`${present} of ${items.length} document types recorded`}
        action={
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <UploadCloud className="h-3.5 w-3.5" /> Record Document
          </button>
        }
      >
        {items.length === 0 ? (
          <EmptyState icon={FileText} title="No document checklist available" hint="Document requirements could not be loaded for this trip." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => {
              const doc = item.document;
              return (
                <li key={item.document_type} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cx(
                        'flex h-8 w-8 items-center justify-center rounded-md',
                        item.satisfied ? 'bg-emerald-100 text-emerald-700' : item.required ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                      )}
                    >
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {item.document_type.replace(/_/g, ' ')}
                        {item.required && <span className="ml-2 text-[10px] font-bold uppercase text-red-500">Required</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {doc
                          ? `${doc.document_status?.replace(/_/g, ' ')}${doc.reference_number ? ` · ${doc.reference_number}` : ''}${doc.issued_at ? ` · issued ${fmtDate(doc.issued_at)}` : ''}`
                          : 'Not recorded'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge state={item.document_status} />
                    {doc?.document_id && (
                      <>
                        {item.document_status !== 'VERIFIED' && (
                          <button
                            type="button"
                            onClick={() => handleVerify(doc.document_id)}
                            disabled={busy != null}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <ShieldCheck className="h-3 w-3" /> Verify
                          </button>
                        )}
                        {doc.file_url && (
                          <a
                            href={ops.documentFileUrl(tripId, doc.document_id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3 w-3" /> File
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {uploadOpen && (
        <ConfirmModal
          open={uploadOpen}
          title="Record Document"
          confirmLabel="Record Document"
          busy={busy != null}
          onCancel={() => { setUploadOpen(false); setError(null); }}
          onConfirm={handleUpload}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Document type</label>
              <select
                value={form.document_type}
                onChange={(e) => setForm({ ...form, document_type: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {['LR', 'GR', 'INVOICE', 'E_WAY_BILL', 'INSURANCE', 'PERMIT', 'FITNESS', 'RC', 'POD', 'OTHER'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Status</label>
              <select
                value={form.document_status}
                onChange={(e) => setForm({ ...form, document_status: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {['PRESENT', 'VERIFIED', 'REJECTED', 'EXPIRED'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Reference number</label>
              <input
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="e.g. LR/2026/0001"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Issued at</label>
                <input
                  type="date"
                  value={form.issued_at}
                  onChange={(e) => setForm({ ...form, issued_at: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Expires at</label>
                <input
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">File (optional)</label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 w-full text-sm text-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Remarks</label>
              <input
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional remarks"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function BillingTab({ tripId }) {
  return (
    <TripFinanceWorkspace tripId={tripId} />
  );
}

const PAYMENT_PARTIES = [
  { value: 'CLIENT', label: 'Customer / Client', type: 'CUSTOMER_PAYMENT', direction: 'CREDIT', from: 'CUSTOMER', to: 'BIHAR_TRANSPORT', purpose: 'Customer payment for trip' },
  { value: 'OWNER', label: 'Vendor / Owner', type: 'OWNER_PAYMENT', direction: 'DEBIT', from: 'BIHAR_TRANSPORT', to: 'TRANSPORT_OWNER', purpose: 'Owner payment for trip' },
  { value: 'DRIVER', label: 'Driver', type: 'DRIVER_SETTLEMENT', direction: 'DEBIT', from: 'BIHAR_TRANSPORT', to: 'DRIVER', purpose: 'Driver settlement for trip' },
];

function PaymentsTab({ tripId, trip, financials, transactions, onRefresh }) {
  const [payOpen, setPayOpen] = useState(false);
  const [party, setParty] = useState('CLIENT');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [txDate, setTxDate] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reverseId, setReverseId] = useState(null);

  const fin = financials || {};
  const ledger = Array.isArray(transactions) ? transactions : [];

  const handleRecord = async () => {
    setError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('A valid payment amount is required');
      return;
    }
    const p = PAYMENT_PARTIES.find((x) => x.value === party);
    setBusy(true);
    try {
      if (party === 'CLIENT') {
        await tripFinancialAPI.recordClientPayment(tripId, {
          amount: amt,
          payment_method: method,
          reference_number: reference || undefined,
          notes: notes || undefined,
          transaction_date: txDate || undefined,
        });
      } else {
        await tripFinancialAPI.recordTransaction(tripId, {
          transaction_type: p.type,
          amount: amt,
          direction: p.direction,
          from_party: p.from,
          to_party: p.to,
          purpose: p.purpose,
          payment_method: method,
          reference_number: reference || undefined,
          transaction_date: txDate || undefined,
          notes: notes || undefined,
        });
      }
      setPayOpen(false);
      setAmount(''); setReference(''); setNotes(''); setTxDate('');
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Payment could not be recorded');
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async (tx) => {
    setBusy(true);
    setError(null);
    try {
      await tripFinancialAPI.reverseTransaction(tripId, tx.transaction_id || tx.id);
      setReverseId(null);
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Transaction could not be reversed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Balances */}
      <div className="grid gap-4 md:grid-cols-3">
        <SectionCard title="Customer" subtitle={fin.clientName || '—'}>
          <p className="text-2xl font-bold text-slate-900">{inr(fin.freight ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Collected {inr(fin.customerCollected ?? 0)} · Due {inr(fin.customerDue ?? 0)}
          </p>
          <Badge state={fin.customerPaymentStatus} />
        </SectionCard>
        <SectionCard title="Vendor / Owner" subtitle={fin.ownerName || '—'}>
          <p className="text-2xl font-bold text-slate-900">{inr(fin.ownerShare ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Paid {inr(fin.ownerPaid ?? 0)} · Due {inr(fin.ownerDue ?? 0)}
          </p>
          <Badge state={fin.ownerPaymentStatus} />
        </SectionCard>
        <SectionCard title="Driver" subtitle={fin.driverName || '—'}>
          <p className="text-2xl font-bold text-slate-900">{inr(fin.driverAgreedPay ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Paid {inr(fin.driverPaid ?? 0)} · Due {inr(fin.driverDue ?? 0)}
          </p>
          <Badge state={fin.driverPaymentStatus} />
        </SectionCard>
      </div>

      {/* Record payment */}
      <SectionCard
        title="Record a Payment"
        subtitle="Customer, vendor or driver — recorded against the canonical ledger"
        action={
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <CircleDollarSign className="h-3.5 w-3.5" /> Record Payment
          </button>
        }
      >
        <p className="text-xs text-slate-500">
          Payments are validated and calculated server-side. Amounts entered here are user input only.
        </p>
      </SectionCard>

      {/* Ledger */}
      <SectionCard title="Payment & Transaction History" subtitle={`${ledger.length} ledger entries`}>
        {ledger.length === 0 ? (
          <EmptyState icon={CircleDollarSign} title="No transactions recorded" hint="Payments and settlements for this trip will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {ledger.map((tx) => (
              <li key={tx.transaction_id || tx.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {tx.transaction_type?.replace(/_/g, ' ')}
                    <span className={cx(
                      'ml-2 text-[10px] font-bold uppercase',
                      tx.direction === 'CREDIT' ? 'text-emerald-600' : 'text-red-600'
                    )}>
                      {tx.direction}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {tx.purpose || '—'}
                    {tx.payment_method ? ` · ${tx.payment_method}` : ''}
                    {tx.reference_number ? ` · ${tx.reference_number}` : ''}
                    {tx.transaction_date ? ` · ${fmtDate(tx.transaction_date)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className={cx(
                    'text-sm font-bold',
                    tx.direction === 'CREDIT' ? 'text-emerald-700' : 'text-red-700'
                  )}>
                    {tx.direction === 'CREDIT' ? '+' : '−'}{inr(tx.amount)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setReverseId(tx.transaction_id || tx.id)}
                    disabled={busy}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reverse
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {payOpen && (
        <ConfirmModal
          open={payOpen}
          title="Record Payment"
          confirmLabel="Record Payment"
          busy={busy}
          onCancel={() => { setPayOpen(false); setError(null); }}
          onConfirm={handleRecord}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Party</label>
              <select
                value={party}
                onChange={(e) => setParty(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {PAYMENT_PARTIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Amount (₹) <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="0.00"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Method</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'ONLINE'].map((m) => (
                    <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Reference number</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </ConfirmModal>
      )}

      {reverseId && (
        <ConfirmModal
          open={reverseId != null}
          title="Reverse Transaction"
          confirmLabel="Reverse Transaction"
          busy={busy}
          onCancel={() => setReverseId(null)}
          onConfirm={() => handleReverse({ transaction_id: reverseId })}
        >
          <p className="text-xs text-slate-600">
            This will reverse the selected transaction. A reversal entry is recorded in the ledger; the original entry is preserved.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

function PodTab({ tripId, trip, stages, delivery, pod, completion, documents, timeline, ops, busy, onRun }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Delivery</h3>
        <DeliveryWorkspace
          tripId={tripId}
          trip={trip}
          stages={stages}
          ops={ops}
          delivery={delivery}
          busy={busy}
          onRun={onRun}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Proof of Delivery</h3>
        <PodWorkspace
          tripId={tripId}
          trip={trip}
          stages={stages}
          ops={ops}
          pod={pod}
          documents={documents}
          busy={busy}
          onRun={onRun}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Completion</h3>
        <CompletionWorkspace
          tripId={tripId}
          trip={trip}
          stages={stages}
          ops={ops}
          completion={completion}
          documents={documents}
          timeline={timeline}
          busy={busy}
          onRun={onRun}
        />
      </div>
    </div>
  );
}

const EVENT_LABELS = {
  trip_created: 'Trip Created',
  status_changed: 'Status Changed',
  client_payment: 'Client Payment',
  customer_payment: 'Customer Payment',
  owner_advance: 'Owner Advance',
  owner_settlement: 'Owner Settlement',
  driver_advance: 'Driver Advance',
  driver_settlement: 'Driver Settlement',
  trip_expense: 'Trip Expense',
  vehicle_assigned: 'Vehicle Assigned',
  vehicle_hired: 'Vehicle Hired',
  loading_sent: 'Sent to Loading Point',
  loading_arrived: 'Arrived at Loading Point',
  loading_completed: 'Loading Completed',
  dispatched: 'Dispatched',
  transit_started: 'Transit Started',
  transit_update: 'Transit Update',
  incident: 'Incident / Breakdown',
  vehicle_changed: 'Vehicle Changed',
  arrival: 'Arrived at Delivery Point',
  delivered: 'Delivered',
  pod_uploaded: 'POD Uploaded',
  pod_received: 'POD Received',
  trip_completed: 'Trip Completed',
  resources_released: 'Resources Released',
  trip_cancelled: 'Trip Cancelled',
  document_recorded: 'Document Recorded',
  document_verified: 'Document Verified',
  reversal: 'Transaction Reversed',
};

function HistoryTab({ trip, timeline }) {
  const events = useMemo(() => {
    const list = Array.isArray(timeline) ? timeline : Array.isArray(timeline?.events) ? timeline.events : [];
    return [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [timeline]);

  // A trip is "historically incomplete" when it predates the movement-history
  // timeline: either it has no events at all, or its first recorded event
  // starts well after the trip itself was created.
  const incomplete = Boolean(
    trip?.created_at
    && (events.length === 0
      || new Date(events[0].created_at) > new Date(trip.created_at).getTime() + 60 * 1000)
  );

  return (
    <div className="space-y-4">
      {incomplete && (
        <Notice tone="orange" title="Historical records incomplete">
          This trip was created before the movement-history timeline was in place.
          Only the events that were recorded are shown; earlier events could not be reconstructed.
        </Notice>
      )}
      <SectionCard
        title="Movement History"
        subtitle={`${events.length} events, oldest first`}
      >
        {events.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No movement history"
            hint="No events have been recorded for this trip yet. Events are written automatically by the server as operational actions happen."
          />
        ) : (
          <ol className="relative ml-3 border-l-2 border-slate-200">
            {events.map((ev) => {
              const meta = parseMetadata(ev.metadata);
              const label = EVENT_LABELS[ev.event_type] || ev.event_type?.replace(/_/g, ' ') || 'Event';
              const location = meta.location || meta.current_location || null;
              const recordedBy = meta.recorded_by || meta.staff || (ev.created_by ? `Staff #${ev.created_by}` : null);
              const docRef = meta.document_type || meta.document_id || null;
              // Rich operational details stored in the event metadata.
              const transition = meta.from && meta.to ? `${meta.from} → ${meta.to}` : null;
              const operation = meta.operation || null;
              const vehicle = meta.vehicle_number || meta.vehicle || null;
              const vendor = meta.vendor_name || meta.owner_name || meta.vendor || null;
              const driver = meta.driver_name || meta.driver || null;
              const docNumber = meta.reference_number || meta.challan_number || null;
              const driverReleased = meta.driver_released;
              const vehicleReleased = meta.vehicle_released;
              const details = [
                transition && { label: 'Transition', value: transition },
                operation && { label: 'Operation', value: operation.replace(/_/g, ' ') },
                vehicle && { label: 'Vehicle', value: vehicle },
                vendor && { label: 'Vendor', value: vendor },
                driver && { label: 'Driver', value: driver },
                docNumber && { label: 'Reference', value: docNumber },
                driverReleased !== undefined && { label: 'Driver released', value: driverReleased ? 'Yes' : 'No' },
                vehicleReleased !== undefined && { label: 'Vehicle released', value: vehicleReleased ? 'Yes' : 'No' },
              ].filter(Boolean);
              return (
                <li key={ev.timeline_id || ev.id} className="mb-4 ml-4">
                  <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <p className="text-xs text-slate-500">
                        {ev.created_at ? fmtDate(ev.created_at, true) : ''}
                      </p>
                    </div>
                    {ev.description && (
                      <p className="mt-1 text-xs text-slate-600">{ev.description}</p>
                    )}
                    {details.length > 0 && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        {details.map((d) => (
                          <div key={d.label} className="flex items-baseline gap-1.5">
                            <dt className="shrink-0 font-medium text-slate-400">{d.label}</dt>
                            <dd className="truncate text-slate-700">{d.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {location}
                        </span>
                      )}
                      {recordedBy && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> {recordedBy}
                        </span>
                      )}
                      {ev.reference_type && (
                        <span className="inline-flex items-center gap-1">
                          <ScrollText className="h-3 w-3" /> {ev.reference_type}
                          {ev.reference_id != null ? ` #${ev.reference_id}` : ''}
                        </span>
                      )}
                      {docRef && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {String(docRef).replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    {meta.status && (
                      <div className="mt-2">
                        <Badge state={meta.status} label={String(meta.status).replace(/_/g, ' ')} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
