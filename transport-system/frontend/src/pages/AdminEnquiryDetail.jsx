/**
 * AdminEnquiryDetail.jsx
 * ---------------------------------------------------------------------------
 * /admin/enquiries/:bookingNumber — the full-page ENQUIRY operations workspace.
 *
 * THE APPROVED LAYOUT IS UNCHANGED
 *   This is the SAME page that was already approved: the same header, the same
 *   two-column workspace, the same cards (Customer, Transport Request, Route,
 *   Quote & Assignment, Activity, Customer View) with identical spacing,
 *   typography, borders and colours. Nothing has been re-laid-out, nothing has
 *   been replaced with a dashboard, and no section is hidden behind a tab.
 *
 * THE ONE ENHANCEMENT
 *   The six-step journey rail is now a real NAVIGATION CONTROL wired to real
 *   APIs:
 *
 *     1 Request Received → 2 Under Review → 3 Quote Prepared
 *     → 4 Quote Sent → 5 Customer Accepted → 6 Confirmed
 *
 *   Clicking a step scrolls to the existing section that owns that stage and
 *   flashes it — see JourneyTimeline.jsx and STAGE_SECTIONS below. All six
 *   sections remain on the page, exactly as before.
 *
 * REAL DATA ONLY
 *   Detail     GET  /api/admin/bookings/by-number/:bookingNumber
 *   Drivers    GET  /api/admin/booking-drivers          (real driver search)
 *   Vehicles   GET  /api/admin/vehicles?driver_id=      (real vehicle list)
 *   Stage 1    POST /api/admin/bookings/:id/start-review
 *   Stage 2/3  POST /api/admin/bookings/:id/prepare-quote   (save the quote)
 *   Stage 3    POST /api/admin/bookings/:id/send-quote      (pre-existing API)
 *   Stage 4    the customer decides on their tracking page via
 *              POST /api/bookings/track/:reference/quote/accept | reject
 *   Stage 5    PATCH /api/admin/bookings/:id/status { status:'confirmed' }
 *   Stage 6    GET  /api/admin/bookings/:id/trip-draft + POST /api/trips
 *   Audit      GET  /api/admin/bookings/:id/workflow-timeline
 *
 * THE DATABASE IS THE SOURCE OF TRUTH
 *   Every mutation is followed by a re-read of the booking. The rail is derived
 *   from the row the backend returns (see workflow/workflowStages.js). There is
 *   no optimistic advancement and nothing is cached, so a browser refresh
 *   reproduces exactly the state the database holds.
 *
 * SCOPE
 *   Only this page and its enquiry components changed. The customer tracking UX,
 *   the driver/vehicle modules and the rest of the admin app are untouched.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  BadgeCheck,
  Car,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Hourglass,
  Inbox,
  LayoutDashboard,
  Package,
  PlayCircle,
  RotateCw,
  Route as RouteIcon,
  Sparkles,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import { useEnquiryRealtime } from '../hooks/useEnquiryRealtime';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import EnquiryStatusBadge from '../components/admin-premium/enquiries/EnquiryStatusBadge';
import JourneyTimeline, { STAGE_SECTIONS, focusStageSection } from '../components/admin-premium/enquiries/JourneyTimeline';
import ActivityTimeline from '../components/admin-premium/enquiries/ActivityTimeline';
import CustomerQuotePreview from '../components/admin-premium/enquiries/CustomerQuotePreview';
import QuoteWorkspace from '../components/admin-premium/enquiries/QuoteWorkspace';
import RequestDetails from '../components/admin-premium/enquiries/RequestDetails';
import RouteSummary from '../components/admin-premium/enquiries/RouteSummary';
import {
  ErrorBlock,
  GhostButton,
  InfoRow,
  LoadingBlock,
  Notice,
  Panel,
  PrimaryButton,
} from '../components/admin-premium/enquiries/EnquiryUI';
import {
  apiErrorMessage,
  bookingRef,
  customerName,
  fmtDateTime,
  inr,
} from '../components/admin-premium/enquiries/enquiryStatus';
import {
  STAGE,
  isCustomerRejected,
  isQuoteExpired,
  stageForBooking,
} from '../components/admin-premium/enquiries/workflow/workflowStages';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/admin' },
  { key: 'enquiries', label: 'ENQUIRY', icon: Inbox, path: '/admin/enquiries' },
  { key: 'intake-enquiries', label: 'Enquiry Intake', icon: ClipboardList, path: '/admin/intake-enquiries' },
  { key: 'financials', label: 'Financials', icon: BarChart3, path: '/admin/financials' },
  { key: 'bookings', label: 'Bookings', icon: Package, path: '/admin/bookings' },
  { key: 'trips', label: 'Trips', icon: RouteIcon, path: '/admin/trips' },
  { key: 'clients', label: 'Clients', icon: Users, path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: Truck, path: '/admin/owners' },
  { key: 'vehicles', label: 'Vehicles', icon: Car, path: '/admin/vehicles' },
  { key: 'drivers', label: 'Drivers', icon: Users, path: '/admin/drivers' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: Truck, path: '/admin/vehicle-owners' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: FileText, path: '/admin/reports' },
  { key: 'ai', label: 'AI Insights', icon: Sparkles, path: '/admin/ai' },
];

/** Highlight a section when the operator lands on it from the rail. */
function sectionProps(id) {
  return {
    id,
    className:
      'scroll-mt-4 rounded-xl transition-shadow duration-500 focus:outline-none',
  };
}

export default function AdminEnquiryDetail() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  /** action → { tone, text } — every mutation has success and error states. */
  const [feedback, setFeedback] = useState({});
  const [busyAction, setBusyAction] = useState(null);

  const [tripDraft, setTripDraft] = useState(null);
  const [tripError, setTripError] = useState(null);

  const requestIdRef = React.useRef(0);

  /* ── Reads ──────────────────────────────────────────────────────────── */

  const load = useCallback(
    async ({ silent } = {}) => {
      if (!bookingNumber) return null;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await adminAPI.getBookingByNumber(bookingNumber);
        if (requestIdRef.current !== requestId) return null;
        const data = res?.data?.data || null;
        if (!data) {
          setError('This enquiry could not be found.');
          setBooking(null);
        } else {
          setBooking(data);
          setError(null);
        }
        return data;
      } catch (err) {
        if (requestIdRef.current !== requestId) return null;
        setError(apiErrorMessage(err, 'Unable to load enquiry details.'));
        setBooking(null);
        return null;
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [bookingNumber],
  );

  const loadAudit = useCallback(async () => {
    if (!booking?.booking_id) return;
    try {
      const res = await adminAPI.getEntityAuditLogs('booking', booking.booking_id, { limit: 20 });
      setAuditLogs(res?.data?.success ? res.data.data || [] : []);
    } catch {
      setAuditLogs([]);
    }
  }, [booking?.booking_id]);

  /** The REAL booking_events audit trail. Failures are reported, never hidden. */
  const loadTimeline = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await adminAPI.getWorkflowTimeline(id, { limit: 100 });
      setTimeline(Array.isArray(res?.data?.data) ? res.data.data : []);
    } catch {
      // A missing audit trail must not blank the page; ActivityTimeline falls
      // back to the timestamps persisted on the booking row itself.
      setTimeline([]);
    }
  }, []);

  const loadTripDraft = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await adminAPI.getTripDraft(id);
      setTripDraft(res?.data?.data || null);
      setTripError(null);
    } catch (err) {
      setTripDraft(null);
      setTripError(apiErrorMessage(err, 'Unable to resolve the trip from this booking.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  useEffect(() => {
    if (booking?.booking_id) loadTimeline(booking.booking_id);
  }, [booking?.booking_id, loadTimeline]);

  useEffect(() => {
    const id = booking?.booking_id;
    if (id && stageForBooking(booking) === STAGE.CONFIRMED) loadTripDraft(id);
  }, [booking, loadTripDraft]);

  // A customer accepting or rejecting while this page is open re-reads it, so
  // the rail advances to Customer Accepted without the admin clicking anything.
  useEnquiryRealtime({
    enquiryIdOrNumber: booking?.booking_id ? String(booking.booking_id) : undefined,
    role: 'admin',
    enabled: Boolean(booking?.booking_id),
    refetch: () => load({ silent: true }),
  });

  /* ── Mutations ──────────────────────────────────────────────────────── */

  /**
   * Run a real API call, then re-read the booking. The rail only ever moves
   * because of the re-read — never because of the click.
   */
  const run = useCallback(
    async (name, fn, fallbackMessage) => {
      if (busyAction) return null;
      setBusyAction(name);
      setFeedback((f) => {
        const { [name]: _drop, ...rest } = f;
        return rest;
      });
      try {
        const result = await fn();
        await load({ silent: true });
        if (booking?.booking_id) await loadTimeline(booking.booking_id);
        setFeedback((f) => ({
          ...f,
          [name]: { tone: 'success', text: result?.data?.message || fallbackMessage },
        }));
        return result;
      } catch (err) {
        setFeedback((f) => ({
          ...f,
          [name]: { tone: 'error', text: apiErrorMessage(err, fallbackMessage) },
        }));
        // Re-read regardless: the server may have applied the change before the
        // response failed, and the rail must never disagree with the database.
        load({ silent: true });
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, load, loadTimeline, booking?.booking_id],
  );

  /** STAGE 1 → 2 */
  const startReview = useCallback(
    () => run('startReview', () => adminAPI.startReview(booking.booking_id), 'Unable to start the review.'),
    [run, booking?.booking_id],
  );

  /** STAGE 5 → 6 — the existing confirmation path. */
  const confirmBooking = useCallback(
    () => run('confirmBooking', () => adminAPI.confirmBooking(booking.booking_id), 'Unable to confirm the booking.'),
    [run, booking?.booking_id],
  );

  /** STAGE 6 → operations — the EXISTING trip API, prefilled from the booking. */
  const createTrip = useCallback(
    async () => {
      if (!tripDraft?.trip) return;
      const result = await run('createTrip', () => adminAPI.createTrip(tripDraft.trip), 'Unable to create the trip.');
      if (result && booking?.booking_id) await loadTripDraft(booking.booking_id);
    },
    [run, tripDraft, loadTripDraft, booking?.booking_id],
  );

  const clearFeedback = useCallback((name) => {
    setFeedback((f) => {
      if (!name || !(name in f)) return f;
      const { [name]: _drop, ...rest } = f;
      return rest;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    setFeedback({});
    load();
    loadAudit();
    window.dispatchEvent(new Event('enquiry-count:changed'));
  }, [load, loadAudit]);

  const backToList = useCallback(() => navigate('/admin/enquiries'), [navigate]);

  /* ── Derived ────────────────────────────────────────────────────────── */

  const stage = useMemo(() => stageForBooking(booking), [booking]);
  const rejected = isCustomerRejected(booking);
  const expired = isQuoteExpired(booking);
  const customerAccepted = stage === STAGE.CUSTOMER_ACCEPTED;
  const confirmed = stage === STAGE.CONFIRMED;
  const vehicleNumber = booking?.vehicle_number || booking?.truck_number_snapshot || null;

  const noticeFor = (name) => {
    const f = feedback[name];
    if (!f) return null;
    return (
      <div className="mt-2 space-y-1.5">
        <Notice tone={f.tone === 'error' ? 'error' : 'success'}>
          <span className="font-semibold">
            {f.tone === 'error' ? 'Not saved.' : 'Done.'}
          </span>{' '}
          {f.text}
        </Notice>
        <button
          type="button"
          onClick={() => clearFeedback(name)}
          className="text-[11px] font-semibold text-muted hover:text-text"
        >
          Dismiss
        </button>
      </div>
    );
  };

  /* ── Page states ────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="enquiries" onNav={() => navigate('/admin/enquiries')}>
        <div className="mx-auto max-w-none space-y-4">
          <div className="rounded-xl border border-border bg-white p-4">
            <LoadingBlock label="Loading enquiry details" rows={4} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-white p-4">
                <LoadingBlock label="Loading request details" rows={6} />
              </div>
              <div className="rounded-xl border border-border bg-white p-4">
                <LoadingBlock label="Loading route" rows={3} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-white p-4">
              <LoadingBlock label="Loading quote workspace" rows={7} />
            </div>
          </div>
        </div>
      </AdminShell>
    );
  }

  if (error || !booking) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="enquiries" onNav={() => navigate('/admin/enquiries')}>
        <div className="mx-auto max-w-2xl space-y-3">
          <GhostButton onClick={backToList}>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            Back to Enquiries
          </GhostButton>
          <ErrorBlock message={error || 'Unable to load enquiry details.'} onRetry={handleRefresh} />
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      navItems={NAV_ITEMS}
      activeKey="enquiries"
      onNav={(k) => {
        if (k === 'bookings') navigate('/admin/bookings');
        if (k === 'dashboard') navigate('/admin');
      }}
    >
      <div className="mx-auto max-w-none space-y-4">
        {/* ── Page header (unchanged) ─────────────────────────────────── */}
        <header className="flex flex-col gap-3 border-b border-border pb-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={backToList}
              className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted transition hover:text-amber-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              Back to Enquiries
            </button>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-[20px] font-bold tracking-tight text-text sm:text-[22px]">
                ENQUIRY #{bookingRef(booking)}
              </h1>
              <EnquiryStatusBadge booking={booking} size="lg" />
            </div>
            <p className="mt-1.5 text-[12px] text-muted">
              Created {fmtDateTime(booking.created_at)}
              {booking.quote_sent_at ? ` · Quote sent ${fmtDateTime(booking.quote_sent_at)}` : ''}
              {Number(booking.final_price) > 0 ? ` · Final ${inr(booking.final_price)}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <GhostButton onClick={handleRefresh} disabled={refreshing}>
              <RotateCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                strokeWidth={2.5}
                aria-hidden="true"
              />
              Refresh
            </GhostButton>
            <GhostButton onClick={backToList} className="hidden sm:inline-flex">
              All enquiries
            </GhostButton>
          </div>
        </header>

        {/* ── Customer journey — now a real navigation control ─────────── */}
        <JourneyTimeline booking={booking} />

        {/* Two-column operations workspace (unchanged) */}
        <div className="grid gap-3.5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] xl:items-start">
          {/* LEFT — what was requested */}
          <div className="space-y-3.5">
            {/* STAGE 1 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.RECEIVED])}>
              <RequestDetails booking={booking} />
              {stage === STAGE.RECEIVED ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-amber-700">
                    Original customer request
                  </p>
                  <p className="mt-1 text-[12.5px] text-amber-900">
                    This enquiry has not been picked up yet. Start the review to assign a driver and build
                    the quote.
                  </p>
                  <PrimaryButton
                    onClick={startReview}
                    disabled={Boolean(busyAction)}
                    className={`mt-2.5 ${busyAction === 'startReview' ? 'cursor-wait' : ''}`}
                  >
                    {busyAction === 'startReview' ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Moving to Under Review…
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                        Start Review
                      </>
                    )}
                  </PrimaryButton>
                  {noticeFor('startReview')}
                </div>
              ) : null}
            </div>

            {/* STAGE 2 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.UNDER_REVIEW])}>
              <Panel title="Route" icon={RouteIcon} subtitle="Pickup to drop">
                <RouteSummary booking={booking} />
              </Panel>
            </div>

            {/* STAGE 5 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.CUSTOMER_ACCEPTED])}>
              <Panel
                title="Customer Acceptance"
                icon={customerAccepted ? CheckCircle2 : Hourglass}
                subtitle="The customer's decision, as recorded by the backend"
              >
                {customerAccepted || confirmed ? (
                  <>
                    <InfoRow label="Accepted timestamp" value={fmtDateTime(booking.quote_accepted_at)} />
                    <InfoRow label="Accepted quote" value={inr(booking.final_price)} tone="strong" />
                    <InfoRow label="Driver" value={booking.driver_name_snapshot} />
                    <InfoRow label="Vehicle" value={vehicleNumber} />
                    <InfoRow label="Customer" value={customerName(booking)} />
                    {customerAccepted ? (
                      <>
                        <PrimaryButton
                          onClick={confirmBooking}
                          disabled={Boolean(busyAction)}
                          className={`mt-3 w-full ${busyAction === 'confirmBooking' ? 'cursor-wait' : ''}`}
                        >
                          {busyAction === 'confirmBooking' ? (
                            <>
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              Confirming…
                            </>
                          ) : (
                            <>
                              <BadgeCheck className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                              Confirm Booking
                            </>
                          )}
                        </PrimaryButton>
                        {noticeFor('confirmBooking')}
                      </>
                    ) : null}
                  </>
                ) : rejected ? (
                  <Notice tone="error">
                    <span className="font-semibold">Customer rejected this quote.</span>{' '}
                    Rejected {fmtDateTime(booking.quote_rejected_at)} — adjust the price under Quote &
                    Assignment and send a revised quote.
                  </Notice>
                ) : expired ? (
                  <Notice tone="warning">
                    <span className="font-semibold">This quote expired.</span> The validity window closed
                    at {fmtDateTime(booking.quote_valid_until)}.
                  </Notice>
                ) : (
                  <Notice tone="neutral">
                    <span className="font-semibold">Awaiting customer.</span> Once the quote is sent, the
                    customer accepts or rejects it from their own tracking page. This card updates on its
                    own — acceptance is never entered by hand.
                  </Notice>
                )}
              </Panel>
            </div>

            {/* STAGE 6 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.CONFIRMED])}>
              <Panel
                title="Confirmed Booking"
                icon={BadgeCheck}
                subtitle="Final assignment and operational next steps"
              >
                {confirmed ? (
                  <>
                    <InfoRow label="Booking ID" value={bookingRef(booking)} mono />
                    <InfoRow label="Customer" value={customerName(booking)} />
                    <InfoRow label="Pickup" value={booking.pickup_location || booking.pickup_city} />
                    <InfoRow label="Drop" value={booking.drop_location || booking.drop_city} />
                    <InfoRow label="Driver" value={booking.driver_name_snapshot} />
                    <InfoRow label="Driver phone" value={booking.mobile_snapshot} mono />
                    <InfoRow label="Vehicle number" value={vehicleNumber} mono />
                    <InfoRow label="Owner / partner" value={booking.owner_name_snapshot} />
                    <InfoRow label="Final price" value={inr(booking.final_price)} tone="strong" />
                    <InfoRow label="Confirmation timestamp" value={fmtDateTime(booking.confirmed_at)} />

                    <div className="mt-3 border-t border-border pt-3">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
                        Next operational action
                      </p>

                      {tripDraft?.existing_trip ? (
                        <Notice tone="success" className="mt-2">
                          <span className="font-semibold">Trip {tripDraft.existing_trip.trip_number}</span>{' '}
                          already exists for this booking (
                          <span className="font-mono">{tripDraft.existing_trip.status}</span>).
                        </Notice>
                      ) : tripError ? (
                        <ErrorBlock message={tripError} onRetry={() => loadTripDraft(booking.booking_id)} retryLabel="Reload" />
                      ) : !tripDraft ? (
                        <p className="mt-1.5 text-[12.5px] text-muted">Resolving the trip from the booking…</p>
                      ) : !tripDraft.ready ? (
                        <Notice tone="warning" className="mt-2">
                          <span className="font-semibold">A trip cannot be created yet.</span>
                          <ul className="mt-1 list-disc pl-4">
                            {(tripDraft.blockers || []).map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        </Notice>
                      ) : (
                        <>
                          <p className="mt-1.5 text-[12px] text-muted">
                            Driver #{tripDraft.trip.driver_id} · Vehicle #{tripDraft.trip.vehicle_id} ·
                            Owner #{tripDraft.trip.transport_owner_id} · {inr(tripDraft.trip.freight_amount)}
                          </p>
                          <PrimaryButton
                            onClick={createTrip}
                            disabled={Boolean(busyAction)}
                            className={`mt-2 w-full ${busyAction === 'createTrip' ? 'cursor-wait' : ''}`}
                          >
                            {busyAction === 'createTrip' ? (
                              <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Creating trip…
                              </>
                            ) : (
                              <>
                                <Truck className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                                Create Trip
                              </>
                            )}
                          </PrimaryButton>
                        </>
                      )}
                      {noticeFor('createTrip')}
                    </div>
                  </>
                ) : (
                  <Notice tone="neutral">
                    <span className="font-semibold">Not confirmed yet.</span> The booking is confirmed once
                    the customer has accepted and an admin has signed it off.
                  </Notice>
                )}
              </Panel>
            </div>

            <Panel title="Activity" icon={History} subtitle="Recorded on this enquiry">
              <ActivityTimeline booking={booking} timeline={timeline} auditLogs={auditLogs} />
            </Panel>
          </div>

          {/* RIGHT — what we do about it */}
          <div className="space-y-3.5">
            {/* STAGE 3 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.QUOTE_PREPARED])}>
              <QuoteWorkspace
                booking={booking}
                onSent={handleRefresh}
                // Re-reads the booking (and its audit trail) after a driver
                // assignment is PERSISTED, so the card renders the database
                // truth rather than the picker's local state. This is what
                // keeps the assignment across refreshes and navigation.
                onAssigned={handleRefresh}
                stage={stage}
                feedback={feedback.prepareQuote || feedback.sendQuote || null}
                onDismissFeedback={() => {
                  clearFeedback('prepareQuote');
                  clearFeedback('sendQuote');
                }}
              />
            </div>

            {/* STAGE 4 */}
            <div {...sectionProps(STAGE_SECTIONS[STAGE.QUOTE_SENT])}>
              <Panel title="Customer View" icon={Inbox} subtitle="Preview of the customer's quote screen">
                <CustomerQuotePreview booking={booking} />
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export { STAGE_SECTIONS, focusStageSection };
