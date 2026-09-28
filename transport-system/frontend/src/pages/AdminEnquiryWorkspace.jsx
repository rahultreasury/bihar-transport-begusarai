/**
 * AdminEnquiryWorkspace.jsx
 * ---------------------------------------------------------------------------
 * The single-screen operator console for one enquiry. Route: /admin/enquiries/:id
 *
 * WHAT THIS IS
 *   A logistics operations workspace, not a CRUD form. It answers, in order:
 *   which enquiry is this → what stage is it at → who is the customer → where is
 *   the load going → what is assigned → what is quoted → what happens next.
 *
 * TRUST BOUNDARY
 *   Every button here is a thin wrapper around a server-authoritative call. The
 *   backend re-validates vehicle/driver/owner/partner ids, re-checks capacity and
 *   schedule conflicts, and recomputes the resulting status. A rejected action
 *   surfaces the server's own message verbatim in the error banner — this page
 *   never second-guesses it and never writes status from the client.
 *
 * READ-ONLY RULES MIRROR THE BACKEND, NOT THE OLD UI
 *   The editable regions are gated on exactly the conditions the service itself
 *   enforces, so the page can never offer an action the API will reject:
 *     • assignment  → blocked only when `isTerminal(status)`
 *                      (EnquiryService.adminAssign)
 *     • quote       → blocked when terminal, or when the customer has committed
 *                      AND the status is past CUSTOMER_ACCEPTED — that is the
 *                      literal guard in EnquiryService.adminSetQuote, which
 *                      still permits an edit at CUSTOMER_ACCEPTED.
 *     • send quote  → offered only at QUOTE_READY, the single status from which
 *                      AWAITING_CUSTOMER_ACCEPTANCE is reachable
 *                      (EnquiryStateMachine.ALLOWED_TRANSITIONS).
 *   Every successful action re-reads the whole enquiry from the server, so what
 *   is on screen afterwards is the persisted truth, never a local guess.
 *
 * PRIVACY
 *   The driver's mobile number is shown HERE and only here. Dispatch must be able
 *   to call the driver; the customer-facing surfaces never receive it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ChevronRight,
  Handshake,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  Package,
  Phone,
  RefreshCw,
  Save,
  Send,
  Shield,
  Truck,
  User,
  UserRound,
} from 'lucide-react';

import { adminEnquiryAPI } from '../services/enquiryAPI';
import { useEnquiryRealtime } from '../hooks/useEnquiryRealtime';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import {
  formatINR,
  formatFareRange,
  formatLongDate,
  formatTime12,
  formatTimestamp,
  withUnit,
  statusLabel,
  statusTone,
  ENQUIRY_STATUS,
} from '../utils/enquiryFormat';

import { FactGrid, InfoRow, Notice, Panel } from '../components/admin-premium/enquiries/EnquiryUI';
import EnquiryLifecycleRail from '../components/admin-premium/enquiries/EnquiryLifecycleRail';
import EnquiryRouteStrip from '../components/admin-premium/enquiries/EnquiryRouteStrip';
import EnquiryActivityFeed from '../components/admin-premium/enquiries/EnquiryActivityFeed';
import PremiumCombobox from '../components/admin-premium/enquiries/PremiumCombobox';
import {
  buildAssignmentIndex,
  getVehicleId,
  getDriverId,
  getOwnerId,
  getPartnerId,
  vehicleKeywords,
  driverKeywords,
  ownerKeywords,
  partnerKeywords,
  renderVehicleOption,
  renderVehicleSelected,
  renderDriverOption,
  renderDriverSelected,
  renderOwnerOption,
  renderOwnerSelected,
  renderPartnerOption,
  renderPartnerSelected,
} from '../components/admin-premium/enquiries/assignmentSelectors';

/* ── Status sets, mirroring backend/utils/EnquiryStateMachine.js ─────────── */

const TERMINAL = [
  ENQUIRY_STATUS.CANCELLED,
  ENQUIRY_STATUS.CUSTOMER_REJECTED,
  ENQUIRY_STATUS.COMPLETED,
];

/** Statuses where the customer has committed (isCustomerCommitted). */
const CUSTOMER_COMMITTED = [
  ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
  ENQUIRY_STATUS.CONFIRMED,
  ENQUIRY_STATUS.IN_PROGRESS,
  ENQUIRY_STATUS.COMPLETED,
];

/* ── Small local atoms ───────────────────────────────────────────────────── */

/** Up to two initials for the customer avatar. */
function initialsOf(name) {
  return String(name || '?')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Inline action button used across the workflow strip. */
function ActionButton({ tone = 'navy', icon: Icon, children, ...rest }) {
  const tones = {
    navy: 'bg-[#1e3a5f] text-white hover:bg-[#16294a] focus:ring-[#1e3a5f]/40',
    amber: 'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-500/40',
    ghost: 'border border-border bg-white text-text hover:bg-slate-50 focus:ring-amber-500/30',
    danger: 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-400/30',
  };
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** One row of the CURRENT ASSIGNMENT block. */
function AssignmentRow({ label, value, sub, action }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="w-[104px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-right">
        <p className="truncate text-[13px] font-semibold text-text">{value || '—'}</p>
        {sub ? <p className="mt-0.5 truncate text-[11.5px] text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Transient success / failure banner. */
function Banner({ tone = 'error', children, onDismiss }) {
  if (!children) return null;
  const styles =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-700';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] ${styles}`}
    >
      {tone === 'success' ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      )}
      <span className="flex-1">{children}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[11.5px] underline">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/* ── Loading skeleton ────────────────────────────────────────────────────── */

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading enquiry">
      <div className="rounded-xl border border-border bg-white p-4">
        <div className="h-4 w-56 animate-pulse rounded bg-skeleton" />
        <div className="mt-4 flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div className="h-9 w-9 animate-pulse rounded-full bg-skeleton" />
              <div className="h-2.5 w-full max-w-[84px] animate-pulse rounded bg-skeleton" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {[0, 1].map((col) => (
          <div key={col} className="space-y-4">
            {Array.from({ length: col === 0 ? 3 : 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-4">
                <div className="h-3 w-32 animate-pulse rounded bg-skeleton" />
                <div className="mt-4 space-y-2.5">
                  {Array.from({ length: 4 }).map((__, r) => (
                    <div key={r} className="h-3 animate-pulse rounded bg-skeleton" style={{ width: `${90 - r * 11}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading enquiry…</span>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AdminEnquiryWorkspace() {
  const { id } = useParams();

  const [enquiry, setEnquiry] = useState(null);
  const [options, setOptions] = useState({ vehicles: [], drivers: [], partners: [], owners: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({ vehicle_id: '', driver_id: '', partner_id: '', owner_id: '' });
  const [quote, setQuote] = useState({ final_price: '', remarks: '' });

  const [busy, setBusy] = useState(null); // which action is in flight
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);

  /**
   * Which enquiry the form was last seeded from. The form is a STAGING AREA
   * for the operator's next action, so a background refresh (the realtime hook
   * refetches on socket activity) must not overwrite a half-made selection —
   * doing so silently cleared the chosen vehicle between picking it and
   * pressing "Assign Resources", which then posted an empty payload and drew a
   * "Provide at least one of vehicle_id…" error for a selection the operator
   * could still see.
   *
   * The CURRENT ASSIGNMENT block above the selectors always reads straight from
   * `enquiry`, so the server truth is never hidden by this.
   */
  const seededIdRef = useRef(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [{ data }, { data: optData }] = await Promise.all([
        adminEnquiryAPI.get(id),
        adminEnquiryAPI.getOptions(),
      ]);
      const e = data?.data || null;
      setEnquiry(e);
      setOptions(optData?.data || { vehicles: [], drivers: [], partners: [], owners: [] });

      // Seed the form from the PERSISTED state, and only when this enquiry is
      // first opened. Never from anything the browser happened to be holding.
      if (seededIdRef.current !== String(id)) {
        setForm({
          vehicle_id: e?.vehicle?.assigned_vehicle_id || '',
          driver_id: e?.assignment?.driver?.driver_id || '',
          partner_id: e?.assignment?.partner?.partner_id || '',
          owner_id: e?.assignment?.owner?.owner_id || '',
        });
        setQuote({
          final_price: e?.quote?.final_quoted_price ?? '',
          remarks: e?.quote?.quote_remarks ?? '',
        });
        seededIdRef.current = String(id);
      }
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load this enquiry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A customer accepting or cancelling while this screen is open updates it
  // immediately, so an operator never sends a quote to a closed enquiry.
  useEnquiryRealtime({
    enquiryIdOrNumber: id,
    role: 'admin',
    enabled: Boolean(id),
    refetch: load,
  });

  /** Run an admin action, then re-read the server so the UI shows the truth. */
  const run = useCallback(
    async (name, fn, successMessage) => {
      setBusy(name);
      setActionError(null);
      setMessage(null);
      try {
        await fn();
        await load();
        setMessage({ tone: 'success', text: successMessage });
      } catch (err) {
        setActionError(err?.response?.data?.message || 'The action could not be completed.');
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  /* ── Derived state ────────────────────────────────────────────────────── */

  const status = enquiry?.status;
  const isClosed = TERMINAL.includes(status);
  const isCancelled = status === ENQUIRY_STATUS.CANCELLED;
  const isRejected = status === ENQUIRY_STATUS.CUSTOMER_REJECTED;

  /**
   * Read-only gates — each one is the backend's own condition, not a guess.
   * See the TRUST BOUNDARY note at the top of this file.
   */
  const assignmentLocked = isClosed;
  const quoteLocked =
    isClosed || (CUSTOMER_COMMITTED.includes(status) && status !== ENQUIRY_STATUS.CUSTOMER_ACCEPTED);
  const canStartReview = status === ENQUIRY_STATUS.ENQUIRY_SUBMITTED;
  // The backend only persists QUOTE_READY once a valid price exists AND a
  // vehicle + driver are committed, so this single check IS the "quote is
  // prepared and publishable" condition. It is derived from the server status,
  // never from local state.
  const canSendQuote = status === ENQUIRY_STATUS.QUOTE_READY;
  const isQuoteSent = status === ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE;
  const isAccepted = [
    ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
    ENQUIRY_STATUS.CONFIRMED,
    ENQUIRY_STATUS.IN_PROGRESS,
    ENQUIRY_STATUS.COMPLETED,
  ].includes(status);
  const isCommitted = CUSTOMER_COMMITTED.includes(status);
  const hasBooking = Boolean(enquiry?.booking);
  // `quoted_at` is stamped by the send endpoint, so it is the authoritative
  // "sent at" time — not anything the browser remembers.
  const quoteSentAt = enquiry?.quote?.quoted_at || null;

  const estimatedRange = useMemo(
    () => formatFareRange(enquiry?.quote?.estimated_price_min, enquiry?.quote?.estimated_price_max),
    [enquiry],
  );

  const load_ = useMemo(() => {
    if (!enquiry?.shipment) return { quantity: '', weight: '' };
    return {
      quantity: withUnit(enquiry.shipment.quantity, enquiry.shipment.quantity_unit),
      weight: withUnit(enquiry.shipment.weight, enquiry.shipment.weight_unit),
    };
  }, [enquiry]);

  const createdLabel = useMemo(
    () => formatTimestamp(enquiry?.timeline?.created_at),
    [enquiry],
  );

  /* ── Assignment selector bindings ────────────────────────────────────── */

  /** One cross-reference pass over the SAME options payload already fetched. */
  const resourceIndex = useMemo(() => buildAssignmentIndex(options), [options]);

  const vehicleSearch = useCallback((v) => vehicleKeywords(v, resourceIndex), [resourceIndex]);
  const driverSearch = useCallback((d) => driverKeywords(d, resourceIndex), [resourceIndex]);
  const ownerSearch = useCallback(ownerKeywords, []);
  const partnerSearch = useCallback(partnerKeywords, []);

  const vehicleRow = useCallback((item, ctx) => renderVehicleOption(item, ctx, resourceIndex), [resourceIndex]);
  const driverRow = useCallback((item, ctx) => renderDriverOption(item, ctx, resourceIndex), [resourceIndex]);
  const ownerRow = useCallback((item, ctx) => renderOwnerOption(item, ctx, resourceIndex), [resourceIndex]);
  const partnerRow = useCallback((item, ctx) => renderPartnerOption(item, ctx, resourceIndex), [resourceIndex]);

  const vehiclePicked = useCallback(renderVehicleSelected, []);
  const driverPicked = useCallback((d) => renderDriverSelected(d, resourceIndex), [resourceIndex]);
  const ownerPicked = useCallback((o) => renderOwnerSelected(o, resourceIndex), [resourceIndex]);
  const partnerPicked = useCallback((p) => renderPartnerSelected(p, resourceIndex), [resourceIndex]);

  /**
   * Fallbacks for an already-assigned resource the options endpoint no longer
   * lists. Same response, still real server data — they just stop the closed
   * field from reading as "nothing is assigned" after a reload.
   */
  const assignment = enquiry?.assignment;
  const assignedOwner = useMemo(() => {
    const owner = assignment?.owner;
    if (!owner) return null;
    return { ...owner, company_name: owner.name, owner_name: owner.name };
  }, [assignment]);

  /* ── Render states ────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="enquiries" onNav={() => {}}>
        <div className="bg-surface px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-none">
            <div className="mb-4 flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500" aria-hidden="true" />
              <span className="text-[13px]">Loading enquiry…</span>
            </div>
            <WorkspaceSkeleton />
          </div>
        </div>
      </AdminShell>
    );
  }

  if (error || !enquiry) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="enquiries" onNav={() => {}}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-surface px-4 text-center">
          <AlertCircle className="h-9 w-9 text-red-500" strokeWidth={1.75} aria-hidden="true" />
          <h1 className="text-[17px] font-bold text-text">Enquiry unavailable</h1>
          <p className="max-w-md text-[13px] text-muted">{error || 'Not found'}</p>
          <Link
            to="/admin/enquiries"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-[13px] font-semibold text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to enquiries
          </Link>
        </div>
      </AdminShell>
    );
  }

  const finalQuote = formatINR(enquiry.quote?.final_quoted_price);
  const booking = enquiry.booking;

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="enquiries" onNav={() => {}}>
      <div className="bg-surface">
        {/* ══ 1. HEADER ═══════════════════════════════════════════════════ */}
        <header className="border-b border-border bg-white">
          <div className="mx-auto max-w-none px-4 py-4 sm:px-6">
            <Link
              to="/admin/enquiries"
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted transition hover:text-[#1e3a5f]"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              Back to Enquiries
            </Link>

            <div className="mt-2.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
                    Enquiry
                  </span>
                  <h1 className="font-mono text-[19px] font-bold leading-none tracking-tight text-[#1e3a5f] sm:text-[22px]">
                    #{enquiry.enquiry_number}
                  </h1>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusTone(status)}`}
                  >
                    {statusLabel(status)}
                  </span>
                  {booking ? (
                    <Link
                      to={`/admin/bookings/${booking.booking_number}`}
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      Booking {booking.booking_number}
                    </Link>
                  ) : null}
                </div>

                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                  {createdLabel ? <span>Created {createdLabel}</span> : null}
                  {createdLabel && finalQuote ? <span aria-hidden="true">·</span> : null}
                  {finalQuote ? (
                    <span>
                      Final <span className="font-semibold text-text">{finalQuote}</span>
                    </span>
                  ) : (
                    <span>No quote yet</span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <ActionButton
                  tone="ghost"
                  icon={RefreshCw}
                  onClick={refresh}
                  disabled={refreshing}
                  aria-label="Refresh enquiry"
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </ActionButton>
                <Link
                  to="/admin/enquiries"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                >
                  All Enquiries
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-none space-y-4 px-4 py-4 sm:px-6">
          {/* ══ 2. LIFECYCLE ══════════════════════════════════════════════ */}
          <Panel>
            <EnquiryLifecycleRail status={status} />
          </Panel>

          <div className="space-y-2.5">
            <Banner tone="success" onDismiss={() => setMessage(null)}>
              {message?.text}
            </Banner>
            <Banner tone="error" onDismiss={() => setActionError(null)}>
              {actionError}
            </Banner>
          </div>

          {/* ══ 3. WORKSPACE ══════════════════════════════════════════════ */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* ── LEFT: who and what ────────────────────────────────────── */}
            <div className="space-y-4">
              {/* 6. Route visualization */}
              <EnquiryRouteStrip route={enquiry.route} schedule={enquiry.schedule} />

              {/* 4. Customer */}
              <Panel
                title="Customer"
                icon={User}
                subtitle={enquiry.customer_id ? 'Registered customer account' : 'Guest enquiry'}
              >
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1e3a5f] text-[14px] font-bold text-white">
                    {initialsOf(enquiry.customer.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold leading-tight text-text">
                      {enquiry.customer.name || 'Unnamed customer'}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {enquiry.customer_id ? `Account #${enquiry.customer_id}` : 'No linked account'}
                    </p>
                  </div>
                </div>

                <div className="border-t border-border pt-1">
                  <InfoRow label="Mobile" value={enquiry.customer.mobile} mono />
                  <InfoRow
                    label="Email"
                    value={
                      enquiry.customer.email ? (
                        <a
                          href={`mailto:${enquiry.customer.email}`}
                          className="text-[#1e3a5f] underline decoration-slate-300 underline-offset-2 transition hover:decoration-amber-500"
                        >
                          {enquiry.customer.email}
                        </a>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <InfoRow
                    label="Customer type"
                    value={enquiry.customer_id ? 'Registered customer account' : 'Guest enquiry'}
                  />
                </div>
              </Panel>

              {/* 5. Transport request */}
              <Panel title="Transport Request" icon={Package}>
                <FactGrid
                  items={[
                    { label: 'Vehicle requested', value: enquiry.vehicle.requested_vehicle_name },
                    { label: 'Material', value: enquiry.shipment.material },
                    { label: 'Quantity', value: load_.quantity },
                    { label: 'Weight', value: load_.weight },
                    { label: 'Goods category', value: enquiry.shipment.goods_category },
                    {
                      label: 'Handling',
                      value: enquiry.shipment.fragile ? 'Fragile — handle with care' : 'Standard handling',
                    },
                    {
                      label: 'Pickup date',
                      value: formatLongDate(enquiry.schedule.pickup_date),
                      icon: undefined,
                    },
                    {
                      label: 'Pickup time',
                      value: formatTime12(enquiry.schedule.pickup_time),
                    },
                  ]}
                />

                {enquiry.shipment.special_instructions ? (
                  <div className="mt-3.5 border-t border-border pt-3">
                    <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                      Remarks
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-text">
                      {enquiry.shipment.special_instructions}
                    </p>
                  </div>
                ) : null}
              </Panel>

              {/* 15. Activity — reference material, so it sits with the other
                  read-only detail rather than below the fold on its own row. */}
              <EnquiryActivityFeed events={enquiry.events || []} />
            </div>

            {/* ── RIGHT: what happens next ──────────────────────────────── */}
            <div className="space-y-4">
              {/* 7 + 8 + 9 + 10 + 11. Quote & Assignment */}
              <Panel
                title="Quote & Assignment"
                icon={ListChecks}
                subtitle="Assign resources, set the final quote and publish it to the customer."
              >
                {/* Current assignment */}
                <div className="mb-4">
                  <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted">
                    Current assignment
                  </p>
                  <div className="rounded-xl border border-border bg-slate-50/60 px-3.5">
                    <AssignmentRow
                      label="Driver"
                      value={assignment?.driver?.driver_name}
                      sub={assignment?.driver?.driver_code || null}
                      action={
                        assignment?.driver?.mobile ? (
                          <a
                            href={`tel:${assignment.driver.mobile}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-semibold text-[#1e3a5f] transition hover:border-amber-300"
                          >
                            <Phone className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                            {assignment.driver.mobile}
                          </a>
                        ) : null
                      }
                    />
                    <AssignmentRow
                      label="Vehicle"
                      value={
                        assignment?.vehicle
                          ? `${assignment.vehicle.vehicle_number} · ${
                              assignment.vehicle.vehicle_name || assignment.vehicle.vehicle_type
                            }`
                          : null
                      }
                      sub={enquiry.vehicle.assigned_vehicle_number ? undefined : null}
                    />
                    <AssignmentRow label="Owner" value={assignment?.owner?.name} sub={assignment?.owner?.city} />
                    <AssignmentRow
                      label="Partner"
                      value={assignment?.partner?.partner_name}
                      sub={assignment?.partner?.city}
                    />
                  </div>
                </div>

                {/* 14. Read-only states — never imply an edit the API rejects */}
                {quoteLocked ? (
                  <Notice tone="neutral" className="mb-4">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <Lock className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      This enquiry is already quoted and confirmed — the quote workspace is read-only.
                    </span>
                  </Notice>
                ) : null}

                {/* Selectors */}
                <div className="space-y-3.5">
                  <PremiumCombobox
                    id="assign-vehicle"
                    label="Vehicle"
                    icon={Truck}
                    value={form.vehicle_id}
                    onChange={(next) => setForm((f) => ({ ...f, vehicle_id: next }))}
                    options={options.vehicles}
                    getOptionId={getVehicleId}
                    getKeywords={vehicleSearch}
                    renderOption={vehicleRow}
                    renderSelected={vehiclePicked}
                    selectedFallback={assignment?.vehicle || null}
                    selectedPrompt="Search vehicle…"
                    searchPlaceholder="Search vehicle number, type, owner or capacity…"
                    emptyTitle="No vehicles found"
                    emptyHint="Try another registration number, vehicle type or owner."
                    noun="available vehicles"
                    disabled={assignmentLocked}
                  />

                  <PremiumCombobox
                    id="assign-driver"
                    label="Driver"
                    icon={UserRound}
                    value={form.driver_id}
                    onChange={(next) => setForm((f) => ({ ...f, driver_id: next }))}
                    options={options.drivers}
                    getOptionId={getDriverId}
                    getKeywords={driverSearch}
                    renderOption={driverRow}
                    renderSelected={driverPicked}
                    selectedFallback={assignment?.driver || null}
                    selectedPrompt="Search driver…"
                    searchPlaceholder="Search driver by name, ID, mobile or vehicle…"
                    emptyTitle="No drivers found"
                    emptyHint="Try another driver name, ID or mobile number."
                    noun="drivers"
                    disabled={assignmentLocked}
                  />

                  <PremiumCombobox
                    id="assign-owner"
                    label="Transport Owner"
                    icon={Building2}
                    value={form.owner_id}
                    onChange={(next) => setForm((f) => ({ ...f, owner_id: next }))}
                    options={options.owners}
                    getOptionId={getOwnerId}
                    getKeywords={ownerSearch}
                    renderOption={ownerRow}
                    renderSelected={ownerPicked}
                    selectedFallback={assignedOwner}
                    selectedPrompt="Search transport owner…"
                    searchPlaceholder="Search transport owner by company, name or city…"
                    emptyTitle="No transport owners found"
                    emptyHint="Try another company name, owner name or city."
                    noun="transport owners"
                    disabled={assignmentLocked}
                  />

                  <PremiumCombobox
                    id="assign-partner"
                    label="Transport Partner"
                    icon={Handshake}
                    value={form.partner_id}
                    onChange={(next) => setForm((f) => ({ ...f, partner_id: next }))}
                    options={options.partners}
                    getOptionId={getPartnerId}
                    getKeywords={partnerSearch}
                    renderOption={partnerRow}
                    renderSelected={partnerPicked}
                    selectedFallback={assignment?.partner || null}
                    selectedPrompt="Search transport partner…"
                    searchPlaceholder="Search transport partner by name, company or city…"
                    emptyTitle="No transport partners found"
                    emptyHint="Try another partner name, company or city."
                    noun="transport partners"
                    disabled={assignmentLocked}
                  />
                </div>

                {/* 11. One clear primary action */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <ActionButton
                    tone="navy"
                    icon={Truck}
                    disabled={busy === 'assign' || assignmentLocked}
                    onClick={() =>
                      run(
                        'assign',
                        () =>
                          adminEnquiryAPI.assign(id, {
                            vehicle_id: form.vehicle_id || undefined,
                            driver_id: form.driver_id || undefined,
                            owner_id: form.owner_id || undefined,
                            partner_id: form.partner_id || undefined,
                          }),
                        'Resources assigned'
                      )
                    }
                  >
                    {busy === 'assign' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Assign Resources
                  </ActionButton>

                  {isCommitted && !isClosed ? (
                    <ActionButton
                      tone="ghost"
                      icon={RefreshCw}
                      disabled={busy === 'reassign' || assignmentLocked}
                      onClick={() =>
                        run(
                          'reassign',
                          () =>
                            adminEnquiryAPI.reassign(id, {
                              vehicle_id: form.vehicle_id || undefined,
                              driver_id: form.driver_id || undefined,
                              owner_id: form.owner_id || undefined,
                              partner_id: form.partner_id || undefined,
                            }),
                          'Resources reassigned'
                        )
                      }
                    >
                      Reassign
                    </ActionButton>
                  ) : null}
                </div>
              </Panel>

              {/* 12. Pricing */}
              <Panel title="Pricing" icon={Package}>
                <div className="space-y-3.5">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                        Estimated price
                      </p>
                      <p className="mt-0.5 truncate text-[14px] font-semibold text-text">
                        {estimatedRange || 'No estimate on file'}
                      </p>
                    </div>
                    {enquiry.quote?.price_status ? (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-600">
                        {String(enquiry.quote.price_status).replace(/_/g, ' ')}
                      </span>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border bg-slate-50/70 px-4 py-3.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                      Final quote
                    </p>
                    {finalQuote ? (
                      <p className="mt-1 text-[26px] font-bold leading-none tracking-tight text-[#1e3a5f]">
                        {finalQuote}
                      </p>
                    ) : (
                      <p className="mt-1 text-[15px] font-semibold text-muted">
                        No quote prepared yet
                      </p>
                    )}
                    {enquiry.quote?.quoted_at ? (
                      <p className="mt-1.5 text-[11.5px] text-muted">
                        Quoted {formatTimestamp(enquiry.quote.quoted_at)}
                        {enquiry.quote.quoted_by?.name ? ` by ${enquiry.quote.quoted_by.name}` : ''}
                      </p>
                    ) : null}
                  </div>

                  {enquiry.quote?.quote_remarks ? (
                    <div className="border-t border-border pt-3">
                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                        Quote remarks
                      </p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-text">
                        {enquiry.quote.quote_remarks}
                      </p>
                    </div>
                  ) : null}

                  <p className="text-[11px] leading-relaxed text-slate-400">
                    Rate, freight, GST and additional charges are recorded on the booking once the
                    customer accepts this quote.
                  </p>
                </div>
              </Panel>

              {/* 13. Quote workflow — only what this status actually allows */}
              <Panel title="Next Action" icon={Send}>
                {isAccepted ? (
                  /* The customer accepted. The existing business logic advances
                     the enquiry to CONFIRMED and creates the canonical Booking
                     in the same atomic step, so there is no second "confirm"
                     click to perform here — the next action is dispatching the
                     trip that now exists. */
                  <div className="space-y-2.5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                        Customer accepted the quote
                      </p>
                      {finalQuote ? (
                        <p className="mt-1 text-[12px] text-emerald-900/70">
                          Agreed at {finalQuote}
                          {enquiry.timeline?.accepted_at
                            ? ` · accepted ${formatTimestamp(enquiry.timeline.accepted_at)}`
                            : ''}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-emerald-900/80">
                        {hasBooking
                          ? `Trip confirmed. Booking ${enquiry.booking.booking_number} was created automatically — dispatch the trip from the booking.`
                          : 'Trip confirmed. Dispatch the trip for this enquiry.'}
                      </p>
                    </div>
                    {hasBooking ? (
                      <Link
                        to={`/admin/bookings/${enquiry.booking.booking_id}`}
                        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1e3a5f] transition hover:text-amber-600"
                      >
                        Open booking {enquiry.booking.booking_number}
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                ) : isCancelled || isRejected ? (
                  <div className="space-y-2.5">
                    <Notice tone="error">
                      {isCancelled ? 'This enquiry was cancelled.' : 'The customer declined this quote.'}
                      {enquiry.cancellation_reason ? ` Reason: ${enquiry.cancellation_reason}` : ''}
                    </Notice>
                    <Link
                      to="/admin/enquiries"
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1e3a5f] transition hover:text-amber-600"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      Back to all enquiries
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {/* Draft the price. Mirrors the backend's own edit window. */}
                    {!quoteLocked ? (
                      <div className="space-y-2.5">
                        <div>
                          <label
                            htmlFor="final-price"
                            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-text"
                          >
                            Final quote (₹)
                          </label>
                          <input
                            id="final-price"
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            value={quote.final_price}
                            onChange={(e) => setQuote((q) => ({ ...q, final_price: e.target.value }))}
                            placeholder={estimatedRange ? 'e.g. 61000' : 'Enter the final price'}
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] font-semibold text-text outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="quote-remarks"
                            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-text"
                          >
                            Remarks for customer (optional)
                          </label>
                          <textarea
                            id="quote-remarks"
                            rows={2}
                            value={quote.remarks}
                            onChange={(e) => setQuote((q) => ({ ...q, remarks: e.target.value }))}
                            placeholder="e.g. Includes loading and unloading"
                            className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                          />
                        </div>
                      </div>
                    ) : (
                      <Notice tone="success">
                        Accepted at {finalQuote || 'the agreed price'} on{' '}
                        {formatTimestamp(enquiry.timeline?.accepted_at)}. The agreed price is now the
                        contract and can no longer be edited here.
                      </Notice>
                    )}

                    <div className="flex flex-wrap gap-2 border-t border-border pt-3.5">
                      {canStartReview ? (
                        <ActionButton
                          tone="navy"
                          icon={Shield}
                          disabled={busy === 'review'}
                          onClick={() =>
                            run(
                              'review',
                              () => adminEnquiryAPI.update(id, { status: 'ADMIN_REVIEW' }),
                              'Review started'
                            )
                          }
                        >
                          Start Reviewing
                        </ActionButton>
                      ) : null}

                      {!quoteLocked ? (
                        <ActionButton
                          tone="navy"
                          icon={Save}
                          disabled={busy === 'quote' || !String(quote.final_price).trim()}
                          onClick={() =>
                            run(
                              'quote',
                              () =>
                                adminEnquiryAPI.saveQuote(id, {
                                  final_price: Number(quote.final_price),
                                  remarks: quote.remarks || undefined,
                                }),
                              'Quote saved — not yet sent to the customer'
                            )
                          }
                        >
                          {busy === 'quote' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          Prepare Quote
                        </ActionButton>
                      ) : null}

                      {/* Only QUOTE_READY can legally reach AWAITING_CUSTOMER_ACCEPTANCE. */}
                      {canSendQuote ? (
                        <ActionButton
                          tone="amber"
                          icon={Send}
                          disabled={busy === 'send'}
                          onClick={() =>
                            run(
                              'send',
                              () => adminEnquiryAPI.sendQuote(id),
                              'Quote sent to the customer'
                            )
                          }
                        >
                          {busy === 'send' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          Send Quote
                        </ActionButton>
                      ) : null}

                      {/* ── QUOTE SENT — read-only, the action is done ──
                          Replaces the Send button the moment the server says
                          the quote is with the customer. `quoted_at` is the
                          server-stamped send time. */}
                      {isQuoteSent ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5">
                          <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-800">
                            <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                            Quote sent to customer
                          </p>
                          {quoteSentAt ? (
                            <p className="mt-1 text-[12px] text-emerald-900/70">
                              Sent at: {formatTimestamp(quoteSentAt)}
                              {enquiry.quote?.quoted_by?.name ? ` by ${enquiry.quote.quoted_by.name}` : ''}
                            </p>
                          ) : null}
                          <p className="mt-1.5 text-[12.5px] leading-relaxed text-emerald-900/80">
                            Waiting for customer response. No action is needed from dispatch until
                            they accept or decline.
                          </p>
                        </div>
                      ) : null}

                      {hasBooking ? (
                        <Link
                          to={`/admin/bookings/${booking.booking_number}`}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#16294a] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40 focus:ring-offset-1"
                        >
                          View Booking
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                )}
              </Panel>
            </div>
          </div>

          {/* Cancel — allowed by the admin for any non-terminal enquiry. */}
          {!isClosed ? (
            <Panel title="Cancel Enquiry" icon={Ban}>
              <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
                Cancelling notifies the customer and records the reason in the activity history. A
                driver cannot perform this action — they may only request a reassignment.
              </p>
              <ActionButton
                tone="danger"
                icon={Ban}
                disabled={busy === 'cancel'}
                onClick={() => {
                  const reason = window.prompt(
                    'Reason for cancellation (shown to admin only):',
                  );
                  if (reason === null) return;
                  run(
                    'cancel',
                    () => adminEnquiryAPI.cancel(id, reason || 'Cancelled by Bihar Transport'),
                    'Enquiry cancelled'
                  );
                }}
              >
                {busy === 'cancel' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Cancel this enquiry
              </ActionButton>
            </Panel>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
