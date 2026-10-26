/**
 * AdminEnquiryWorkspace.jsx
 * ---------------------------------------------------------------------------
 * The single-screen operator console for one enquiry. Route: /admin/enquiries/:id
 *
 * WHAT THIS IS
 *   A logistics operations workspace, not a CRUD form. It answers, in order:
 *   which enquiry is this → what stage is it at → who is the customer → where is
 *   the load going → what is quoted → what happens next.
 *
 * SCOPE — THE ENQUIRY PAGE DOES NOT HIRE VEHICLES
 *   This page owns exactly five things:
 *     ENQUIRY INTAKE → REVIEW → QUOTATION → CUSTOMER DECISION → CONFIRMATION
 *
 *   Vehicle hiring lives in ONE place only: the Universal Vehicle Hire workspace
 *   at /admin/trips/:tripId/hire. The "TRANSPORT OWNER", "TRANSPORT PARTNER",
 *   "DRIVER" and "VEHICLE" selectors and the "Assign Resources" / "Reassign"
 *   buttons that used to live here have been REMOVED. They were a second hiring
 *   form competing with the canonical one, and an operator could use either —
 *   which is how the two screens drifted apart.
 *
 *   What replaces them is a compact, READ-ONLY handoff card
 *   (`VehicleHireStatusCard`). It reads the SAME canonical assignment the
 *   Vehicle Hire page reads — `GET /api/vehicle-hire/assignment?enquiry_id=`,
 *   served by `TripVehicleAssignmentService`, the single assignment writer — and
 *   offers a single navigation action into that workflow. It performs no hiring,
 *   computes no gross/commission/net and creates no second assignment.
 *
 *   ENQUIRY → QUOTE → CUSTOMER DECISION → CONFIRMED → HANDOFF TO VEHICLE HIRE
 *
 * TRUST BOUNDARY
 *   Every button here is a thin wrapper around a server-authoritative call. The
 *   backend re-validates the ids it receives, re-checks schedule conflicts, and
 *   recomputes the resulting status. A rejected action surfaces the server's own
 *   message verbatim in the error banner — this page never second-guesses it and
 *   never writes status from the client.
 *
 * READ-ONLY RULES MIRROR THE BACKEND, NOT THE OLD UI
 *   The editable region is gated on exactly the conditions the service itself
 *   enforces, so the page can never offer an action the API will reject:
 *     • quote       → blocked when terminal, or when the customer has committed
 *                      AND the status is past CUSTOMER_ACCEPTED — that is the
 *                      literal guard in EnquiryService.adminSetQuote, which
 *                      still permits an edit at CUSTOMER_ACCEPTED.
 *     • send quote  → offered only at QUOTE_READY, the single status from which
 *                      AWAITING_CUSTOMER_ACCEPTANCE is reachable
 *                      (EnquiryStateMachine.ALLOWED_TRANSITIONS).
 *   Every successful action re-reads the whole enquiry from the server, so what
 *   is on screen afterwards is the persisted truth, never a local guess.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Shield,
  Truck,
  User,
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
import VehicleHireStatusCard from '../components/admin-premium/enquiries/VehicleHireStatusCard';
import { describeHireAssignment } from '../components/admin-premium/enquiries/hireHandoff';
import { vehicleHireAPI } from '../services/vehicleHireAPI';

/* ── Status sets, mirroring backend/utils/EnquiryStateMachine.js ─────────── */

const TERMINAL = [
  ENQUIRY_STATUS.CANCELLED,
  ENQUIRY_STATUS.CUSTOMER_REJECTED,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // THE CANONICAL VEHICLE/DRIVER RESERVATION, read once for the whole page.
  //
  // The handoff card needs it, so it is fetched HERE and handed down rather than
  // fetched twice. It resolves through TripVehicleAssignmentService — the single
  // assignment writer — to the same Trip row the Vehicle Hire page reads, so
  // this page can never show a different vehicle from the one actually reserved.
  const [assignment, setAssignment] = useState(null);

  const [busy, setBusy] = useState(null); // which action is in flight
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // The reservation is read alongside the enquiry so the page can show the
      // vehicle and driver with the quote and gate sending on them. A failure
      // there must not fail the enquiry read, so it is settled separately.
      const [{ data }, assignmentRes] = await Promise.all([
        adminEnquiryAPI.get(id),
        vehicleHireAPI
          .getAssignmentByBooking({ enquiry_id: id })
          .catch(() => null),
      ]);
      const e = data?.data || null;
      setEnquiry(e);
      setAssignment(assignmentRes?.data?.data || null);
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
  const canStartReview = status === ENQUIRY_STATUS.ENQUIRY_SUBMITTED;
  const isAccepted = [
    ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
    ENQUIRY_STATUS.CONFIRMED,
    ENQUIRY_STATUS.IN_PROGRESS,
    ENQUIRY_STATUS.COMPLETED,
  ].includes(status);
  const hasBooking = Boolean(enquiry?.booking);

  /**
   * WHAT THE CUSTOMER WOULD BE OFFERED — the reservation, read back from the
   * single canonical assignment. Null until a vehicle and driver are engaged.
   */
  const reservation = useMemo(() => describeHireAssignment(assignment), [assignment]);

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
              {/* ── VEHICLE & DRIVER — reserved BEFORE the quote goes out ─────
                  *
                  * The Transport Owner / Transport Partner / Driver / Vehicle
                  * selectors and the "Assign Resources" / "Reassign" buttons
                  * that used to live here were a SECOND vehicle-hiring form.
                  * They are gone. Selection happens in exactly one place: the
*   Universal Vehicle Hire workspace at /admin/trips/:tripId/vehicle-hire.
                  *
                  * This card is the HAND-OFF, not a form. It reads the SAME
                  * canonical assignment the Vehicle Hire page reads
                  * (GET /api/vehicle-hire/assignment → TripVehicleAssignmentService,
                  * the single assignment writer), and when nothing is engaged it
                  * asks the SERVER to provision the consignment's one trip and
                  * then navigates into that workspace. React never creates a
                  * trip and never writes an assignment. */}
              <Panel
                title="Vehicle & Driver"
                icon={Truck}
                subtitle="Reserved before the quote is sent, so the customer never has to wait after accepting."
              >
                <VehicleHireStatusCard
                  enquiryId={enquiry.enquiry_id}
                  bookingId={enquiry.booking?.booking_id}
                  enquiryStatus={status}
                  quoteLabel={finalQuote}
                  pickup={enquiry.route?.pickup_location || enquiry.schedule?.pickup_location || null}
                  drop={enquiry.route?.drop_location || enquiry.schedule?.drop_location || null}
                  customerOfferUrl={`/booking/enquiry/${enquiry.enquiry_number}`}
                  tripUrl={assignment?.trip_id ? `/admin/trips/${assignment.trip_id}` : null}
                  assignment={assignment}
                />
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

                    {/* THE QUOTE AND THE TRUCK GO OUT AS ONE PACKAGE.
                        These two rows are the whole workflow: the customer is
                        shown the vehicle and driver they are being offered
                        alongside the price, so "accept, then wait while we find
                        a vehicle" can never happen. */}
                    <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                          Vehicle
                        </p>
                        <p className="mt-0.5 truncate text-[13px] font-semibold text-text">
                          {reservation.vehicle}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted">
                          Driver
                        </p>
                        <p className="mt-0.5 truncate text-[13px] font-semibold text-text">
                          {reservation.driver}
                        </p>
                      </div>
                    </div>
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

              {/* Enquiry status display — read-only, no quote controls */}
              <Panel title="Status" icon={Send}>
                {isAccepted ? (
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
                          ? `Trip confirmed. Booking ${enquiry.booking.booking_number} was created automatically — the next step is Vehicle Hire.`
                          : 'Trip confirmed. The next step is Vehicle Hire.'}
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-emerald-900/80">
                        Select the vehicle, driver, owner/vendor and hire terms in the Vehicle Hire
                        workspace. The Vehicle Hire card above shows the current state and links
                        straight to it.
                      </p>
                    </div>
                    {hasBooking ? (
                      <Link
                        to={`/admin/bookings/${enquiry.booking.booking_number}`}
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
                  <div className="space-y-2.5">
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
                    {status === ENQUIRY_STATUS.ADMIN_REVIEW ? (
                      <Notice tone="neutral">
                        <span className="font-semibold">Under Review.</span> Prepare the quotation in the Vehicle Hire
                        workspace, then finalize and send it to the customer from there.
                      </Notice>
                    ) : status === ENQUIRY_STATUS.QUOTE_READY ? (
                      <Notice tone="success">
                        <span className="font-semibold">Quote prepared.</span> The quotation is ready. Send it to
                        the customer from the Vehicle Hire workspace.
                      </Notice>
                    ) : status === ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE ? (
                      <Notice tone="success">
                        <span className="font-semibold">Quote sent to customer.</span> Waiting for customer response.
                        No action is needed from dispatch until they accept or decline.
                      </Notice>
                    ) : (
                      <Notice tone="neutral">
                        <span className="font-semibold">Awaiting action.</span> The next step will appear here when
                        the enquiry progresses.
                      </Notice>
                    )}
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
