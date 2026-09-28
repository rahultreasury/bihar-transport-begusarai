/**
 * EnquiryConfirmation.jsx
 * ---------------------------------------------------------------------------
 * /booking/enquiry/:enquiryNumber — the page a customer lands on the instant
 * they press "Submit Booking".
 *
 * WHAT THIS PAGE IS FOR
 * A customer who has just handed over a form is asking three things, in order:
 *
 *   1. Did you get it, and can I quote a number?  → hero + Request ID
 *   2. Is a human on it?                          → Customer Care card
 *   3. Is anything actually happening?            → the live route map
 *
 * So the page is built in THAT order, and the vertical rhythm is deliberately
 * tight: the reassurance, the identifier and the "we are working on it" proof
 * all sit above the fold, and everything else (route, shipment, schedule, fare)
 * lives behind one-line accordions. There is no decorative whitespace on this
 * page — a customer who is waiting for a truck should never have to scroll past
 * empty space to find out what is happening.
 *
 * DESIGN CONSTRAINTS HONOURED
 *   • Every value comes from the API. No literals, no mock state.
 *   • The "searching" animation is driven by the real `enquiry.status` via
 *     utils/enquirySearchStage.js — it stops the moment the backend reports an
 *     assignment. There is no second state machine here.
 *   • Socket.IO (with polling as the documented fallback) drives live updates.
 *   • Driver/owner phone numbers are never rendered (the backend DTO omits
 *     them; see dtos/EnquiryDTO.js).
 *   • Contact details come from the backend customer-care config only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  Loader2,
  MapPin,
  Package,
  CalendarClock,
  IndianRupee,
  RefreshCw,
  ArrowRight,
  Printer,
  XCircle,
  ChevronRight,
  Sparkles,
  Radio,
  Phone,
  MessageCircle,
} from 'lucide-react';

import { enquiryAPI } from '../services/enquiryAPI';

/* ── First-load data policy ───────────────────────────────────────────────
   The page a customer lands on straight after pressing "Submit Booking" must
   never flash an error for something that is still recoverable. Two mechanisms
   guarantee that:

   1. SEED. /book-transport hands the enquiry it just received from the POST
      over in router state. The page renders from that on the FIRST frame, then
      revalidates against the server and replaces it with the authoritative read.
   2. TRANSIENT RETRY. If the very first GET still races the create (replica lag,
      a cold connection, a 5xx), only genuinely transient failures are retried,
      on a short exponential backoff — ~300ms, ~700ms, ~1500ms. A 401/403 (the
      scoped guest token is gone) or an unknown id is permanent and is reported
      immediately instead of being retried into a longer wait. */
const ENQUIRY_QUERY_KEY = 'enquiry';

/** Backoff schedule. Deliberately short — this covers a race, not an outage. */
const ENQUIRY_RETRY_DELAYS = [300, 700, 1500];

/**
 * Is this failure worth retrying?
 *
 * Retryable : no response at all (offline / DNS / timeout / CORS), 404 (the
 *             create may not be visible to this connection yet), 408/425/429,
 *             and any 5xx.
 * Permanent: 400, 401, 403, 422 — a bad id or a missing/revoked guest token
 *             will not fix itself, and retrying only delays a real message.
 */
function isTransientEnquiryError(error) {
  const status = error?.response?.status;
  if (!status) return true; // network / timeout — no HTTP status was reached
  if (status === 404 || status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

/** ~0ms → ~300ms → ~700ms → ~1500ms, then hold at the last step. */
function enquiryRetryDelay(attemptIndex = 0) {
  const i = Math.max(0, attemptIndex);
  return ENQUIRY_RETRY_DELAYS[Math.min(i, ENQUIRY_RETRY_DELAYS.length - 1)];
}

/**
 * The one retry decision, shared by `retry` and `retryDelay`.
 *
 * They MUST use the same predicate: React Query evaluates `retryDelay` first and
 * unconditionally, even for a failure it is about to give up on, so a log inside
 * `retryDelay` alone would announce a retry that never happens.
 */
function shouldRetryEnquiry(failureCount, error) {
  return failureCount < ENQUIRY_RETRY_DELAYS.length && isTransientEnquiryError(error);
}
import { FALLBACK_CUSTOMER_CARE, buildWhatsAppUrl, buildCallUrl } from '../config/customerCare';
import { useEnquiryRealtime } from '../hooks/useEnquiryRealtime';
import { useSearchNarrative } from '../hooks/useSearchNarrative';
import {
  formatINR,
  formatFareRange,
  formatKm,
  formatLongDate,
  formatTime12,
  formatTimestamp,
  withUnit,
  statusLabel,
  ENQUIRY_STATUS,
  TERMINAL_STATUSES,
} from '../utils/enquiryFormat';

import SupportCard from '../components/enquiry/SupportCard';
import RequestIdCard from '../components/enquiry/RequestIdCard';
import RouteMapExperience from '../components/enquiry/RouteMapExperience';
import EnquiryStatusSteps from '../components/enquiry/EnquiryStatusSteps';
import DetailAccordion, { DetailRow, DetailBlock } from '../components/enquiry/DetailAccordion';

/* ── Loading skeleton ───────────────────────────────────────────────────
   A blank screen after submitting a form reads as failure. The skeleton
   mirrors the real layout — including the map block — so the page does not
   jump when data lands.

   The "Finding your transport…" line above it is the honest first-load state.
   It stays on screen through every retry of the first read, so a recoverable
   first-load race can never be mistaken for a failure. */
function HeroSkeleton() {
  return (
    <div className="bg-[#F7F8FA] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#172B4D]">
          <Loader2 className="h-4 w-4 animate-spin text-[#F5A623]" aria-hidden="true" />
          Finding your transport…
        </p>
        <div className="h-5 w-36 animate-pulse rounded-full bg-slate-200" />
        <div className="h-9 w-full max-w-md animate-pulse rounded-lg bg-slate-200" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-slate-100" />

        <div className="grid items-start gap-5 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-4">
            <div className="h-28 w-full animate-pulse rounded-2xl bg-slate-200" />
            <div className="h-[400px] w-full animate-pulse rounded-3xl bg-slate-200 sm:h-[460px] lg:h-[520px]" />
          </div>
          <div className="h-80 animate-pulse rounded-3xl bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

/* ── Error state ─────────────────────────────────────────────────────── */
function ErrorState({ message, onRetry }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 bg-[#F7F8FA] px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <AlertCircle className="h-7 w-7 text-red-500" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-bold text-[#172B4D]">
          We couldn't load your request status
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{message}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#172B4D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#172B4D]/90"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
        <Link
          to="/book-transport"
          className="inline-flex items-center justify-center rounded-xl border border-[#172B4D]/20 px-5 py-2.5 text-sm font-semibold text-[#172B4D] transition hover:bg-[#172B4D]/5"
        >
          Book another transport
        </Link>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function EnquiryConfirmation() {
  const { enquiryNumber } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [action, setAction] = useState(null); // 'accept' | 'reject' | 'cancel'
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showDeclineReason, setShowDeclineReason] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  /**
   * The enquiry handed over by /book-transport in router state.
   *
   * This is data the SERVER already sent back on the successful POST — the same
   * object GET /api/enquiries/:number would return — so it is a transport of the
   * authoritative value, not a second source of truth. React Query treats it as
   * `initialData`: it renders on the first frame, then is immediately
   * revalidated and replaced by the server read.
   *
   * Gated on the enquiry number matching, so it is never applied to a different
   * enquiry the customer navigates to, and it disappears on a plain refresh
   * (no router state), which correctly falls back to a normal fetch.
   */
  const seededEnquiry =
    location.state?.enquiry && location.state?.enquiryNumber === enquiryNumber
      ? location.state.enquiry
      : undefined;

  /**
   * The single source of truth for this page's data.
   *
   * `retry` is deliberately narrow: only transient failures are retried, three
   * times, on a ~300 / ~700 / ~1500ms backoff. A 401/403 (this device no longer
   * holds the scoped guest token) and a malformed id are reported immediately.
   */
  const enquiryQuery = useQuery({
    queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber],
    enabled: Boolean(enquiryNumber),
    initialData: seededEnquiry,
    staleTime: 0,
    retry: shouldRetryEnquiry,
    retryDelay: (attemptIndex, error) => {
      const delay = enquiryRetryDelay(attemptIndex);
      if (import.meta.env.DEV && shouldRetryEnquiry(attemptIndex, error)) {
        console.info(
          `[enquiry] GET /enquiries/${enquiryNumber} failed (${error?.response?.status ?? 'network'}) — retrying in ${delay}ms`
        );
      }
      return delay;
    },
    queryFn: async ({ signal }) => {
      if (import.meta.env.DEV) {
        console.info(`[enquiry] GET /enquiries/${enquiryNumber} started`);
      }
      const { data } = await enquiryAPI.get(enquiryNumber, { signal });
      if (import.meta.env.DEV) {
        console.info(`[enquiry] GET /enquiries/${enquiryNumber} resolved`, {
          status: data?.data?.status,
        });
      }
      return data?.data || null;
    },
  });

  const enquiry = enquiryQuery.data ?? null;
  // `isPending` stays true through every retry, so the loading state — not the
  // error state — is what a customer sees while a recoverable first read settles.
  const isFirstLoad = enquiryQuery.isPending;
  const loadError = enquiryQuery.isError ? enquiryQuery.error : null;

  /** Re-read the authoritative state. Runs on every socket event and poll tick. */
  const load = useCallback(() => enquiryQuery.refetch(), [enquiryQuery.refetch]);

  useEffect(() => {
    if (!enquiryQuery.isSuccess) return;
    if (import.meta.env.DEV) {
      console.info(`[enquiry] page loaded for ${enquiryNumber}`);
    }
  }, [enquiryQuery.isSuccess, enquiryNumber]);

  // Live updates. `connected` drives the "Live updates" indicator, so the UI
  // never claims a live connection that does not exist.
  // Automatic refresh. Socket first, polling as the safety net — both call the
  // same `load`, so the status, the timeline, the vehicle and the driver all
  // re-render from one authoritative server read. `TERMINAL_STATUSES` retires
  // the timer once the request can no longer change.
  const { connected } = useEnquiryRealtime({
    enquiryIdOrNumber: enquiryNumber,
    role: 'customer',
    enabled: Boolean(enquiryNumber),
    refetch: load,
    currentStatus: enquiry?.status,
    stopWhenStatus: TERMINAL_STATUSES,
  });

  const runAction = useCallback(
    async (kind, payload) => {
      setActionBusy(true);
      setActionError(null);
      setAction(kind);
      try {
        let updated = null;
        if (kind === 'accept') {
          const { data } = await enquiryAPI.accept(enquiryNumber);
          updated = data?.data?.enquiry || null;
        } else if (kind === 'reject') {
          const { data } = await enquiryAPI.reject(enquiryNumber, declineReason || undefined);
          updated = data?.data?.enquiry || null;
          setShowDeclineReason(false);
          setDeclineReason('');
        } else if (kind === 'cancel') {
          const { data } = await enquiryAPI.cancel(enquiryNumber, 'Cancelled by customer');
          updated = data?.data?.enquiry || null;
        }
        // Write the server's own result into the cache. One source of truth: the
        // page re-renders from the cache exactly as it would from a refetch.
        if (updated) {
          queryClient.setQueryData([ENQUIRY_QUERY_KEY, enquiryNumber], updated);
        }
      } catch (err) {
        setActionError(
          err?.response?.data?.message ||
            'We could not complete that action right now. Please try again.'
        );
      } finally {
        setActionBusy(false);
        setAction(null);
      }
    },
    [enquiryNumber, declineReason, queryClient]
  );

  /* ── Derived state ──────────────────────────────────────────────────── */
  const status = enquiry?.status;
  const isAwaitingDecision = status === ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE;
  const isCancelled = status === ENQUIRY_STATUS.CANCELLED;
  const isRejected = status === ENQUIRY_STATUS.CUSTOMER_REJECTED;
  const isCompleted = status === ENQUIRY_STATUS.COMPLETED;
  const isClosed = isCancelled || isRejected || isCompleted;
  const isCommitted = [
    ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
    ENQUIRY_STATUS.CONFIRMED,
    ENQUIRY_STATUS.IN_PROGRESS,
    ENQUIRY_STATUS.COMPLETED,
  ].includes(status);
  // Read-only "you accepted" state. Driven by the backend status only.
  const isQuoteAccepted = [
    ENQUIRY_STATUS.CUSTOMER_ACCEPTED,
    ENQUIRY_STATUS.CONFIRMED,
    ENQUIRY_STATUS.IN_PROGRESS,
    ENQUIRY_STATUS.COMPLETED,
  ].includes(status);

  // The search narrative is derived from the REAL status. When the server says
  // a vehicle is assigned, `searching` flips to false and the map animation
  // stops — no client-side flag can override that.
  const { searching, stage } = useSearchNarrative(status);

  const estimatedRange = useMemo(
    () => formatFareRange(enquiry?.pricing?.estimated_price_min, enquiry?.pricing?.estimated_price_max),
    [enquiry]
  );
  const finalPrice = useMemo(() => formatINR(enquiry?.pricing?.final_quoted_price), [enquiry]);

  const vehicleLabel =
    enquiry?.vehicle?.assigned_vehicle_type || enquiry?.vehicle?.requested_vehicle_name || null;

  const shipmentSummary = useMemo(() => {
    if (!enquiry?.shipment) return '';
    return withUnit(enquiry.shipment.weight, enquiry.shipment.weight_unit);
  }, [enquiry]);

  const routeSummary = useMemo(() => {
    if (!enquiry?.route) return '';
    return `${enquiry.route.pickup_location} → ${enquiry.route.drop_location}`;
  }, [enquiry]);

  const assignedLabel = useMemo(() => {
    if (!enquiry?.assignment) return 'Vehicle assigned';
    const vehicle = enquiry.assignment.vehicle_type || enquiry.assignment.vehicle_number;
    return vehicle ? `Assigned · ${vehicle}` : 'Vehicle assigned';
  }, [enquiry]);

  /* ── Render ─────────────────────────────────────────────────────────── */
  if (isFirstLoad) return <HeroSkeleton />;
  if (loadError || !enquiry) {
    // 401/403 means the scoped guest token is gone (new device / cleared
    // storage) — explain how to recover rather than showing a blank page.
    const status = loadError?.response?.status;
    return (
      <ErrorState
        message={
          status === 401 || status === 403
            ? 'This enquiry link has expired on this device. Please verify your mobile number to view it again.'
            : 'Something went wrong while loading your request. Please try again.'
        }
        onRetry={load}
      />
    );
  }

  return (
    <div className="bg-[#F7F8FA] pb-24 md:pb-12">
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        {/* ══ HERO ══════════════════════════════════════════════════════
            Desktop: Request ID + live map on the left, Customer Care on the
            right (sticky, so it is always in reach while the customer reads).
            Mobile:  stacked in the order the customer needs them —
                      received → ID → map → Customer Care → status → details.

            The mobile order is achieved with `order-*` on the flex flow plus
            explicit `lg:col-start/row-start` for the desktop grid, because
            DOM order alone cannot express both. */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[1.45fr_1fr] lg:items-start lg:gap-x-6 lg:gap-y-5">
          {/* ── 0. The one-line promise ── */}
          <header className="order-0 lg:col-span-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${
                isClosed && !isCompleted
                  ? 'bg-red-50 text-red-700'
                  : isCommitted || isCompleted
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-[#F5A623]/12 text-[#B26A00]'
              }`}
            >
              {isCancelled ? (
                <>
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Request cancelled
                </>
              ) : isRejected ? (
                <>
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Quote declined
                </>
              ) : isCompleted ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Trip completed
                </>
              ) : isCommitted ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Trip confirmed
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Request received
                </>
              )}
            </span>

            <h1 className="mt-2.5 text-2xl font-bold leading-tight text-[#172B4D] sm:text-[30px]">
              {isCancelled
                ? 'Your request has been cancelled'
                : isRejected
                ? 'We have recorded your decision'
                : isCommitted || isCompleted
                ? 'Your trip is confirmed'
                : 'Your transport request is being processed'}
            </h1>

            <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-slate-600">
              {isCancelled
                ? 'This request is now closed. Contact Bihar Transport customer care if you need to place a new one.'
                : isRejected
                ? 'Our team will get in touch to understand what you need.'
                : isCommitted || isCompleted
                ? 'Your vehicle and driver are being arranged. Details are below.'
                : "We've received your shipment details. Bihar Transport is now finding the right vehicle for your route."}
            </p>

            {enquiry.booking?.booking_number && (
              <p className="mt-1.5 text-xs text-slate-500">
                Booking reference:{' '}
                <span className="font-mono font-semibold text-[#172B4D]">
                  {enquiry.booking.booking_number}
                </span>
              </p>
            )}
          </header>

          {/* ── 1. Request ID + the live route map ── */}
          <div className="order-1 space-y-3.5 lg:col-start-1 lg:row-start-2">
            <RequestIdCard enquiryNumber={enquiry.enquiry_number} />

            {/* Section label — kept to a single line so it costs no vertical
                space but names what the customer is looking at. */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#172B4D]">
                {searching ? (
                  <Radio className="btb-accent-pulse h-3.5 w-3.5 rounded-full text-[#F5A623]" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                )}
                {searching ? 'Finding your truck' : stage.headline}
              </h2>
              <p className="truncate text-[11.5px] font-medium text-slate-500">{stage.detail}</p>
            </div>

            <RouteMapExperience
              route={enquiry.route}
              stage={stage}
              searching={searching}
              connected={connected}
              assignedLabel={assignedLabel}
            />

            {actionError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{actionError}</span>
              </div>
            )}

            {/* ── Quote ACCEPTED — read-only confirmation, replaces the buttons
                the moment the backend reports the acceptance. ── */}
            {isQuoteAccepted && enquiry.pricing?.final_quoted_price != null && (
              <div className="overflow-hidden rounded-3xl border-2 border-emerald-200 bg-emerald-50/50 p-5 shadow-[0_20px_44px_-30px_rgba(11,27,51,0.5)] sm:p-6">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                  Quote Accepted
                </p>

                <p className="mt-2 text-3xl font-bold text-[#172B4D] sm:text-4xl">{finalPrice}</p>

                <p className="mt-3 text-sm leading-relaxed text-[#172B4D]/80">
                  Your transport request has been accepted. We are preparing your trip confirmation.
                </p>

                {enquiry.booking?.booking_number && (
                  <p className="mt-2 text-[12.5px] text-slate-500">
                    Booking reference:{' '}
                    <span className="font-semibold text-[#172B4D]">
                      {enquiry.booking.booking_number}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* ── Quote decision — the one action that must dominate ── */}
            {isAwaitingDecision && enquiry.pricing?.final_quoted_price != null && (
              <div className="overflow-hidden rounded-3xl border-2 border-[#F5A623]/40 bg-[#F5A623]/[0.06] p-5 shadow-[0_20px_44px_-30px_rgba(11,27,51,0.5)] sm:p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#B26A00]">
                  Your final transport quote is ready
                </p>

                <p className="mt-2 text-3xl font-bold text-[#172B4D] sm:text-4xl">{finalPrice}</p>

                {estimatedRange && (
                  <p className="mt-1 text-sm text-slate-500">Estimated range was {estimatedRange}</p>
                )}

                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Route</dt>
                    <dd className="text-right font-medium text-[#172B4D]">
                      {enquiry.route.pickup_location} → {enquiry.route.drop_location}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Vehicle</dt>
                    <dd className="text-right font-medium text-[#172B4D]">{vehicleLabel || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Weight</dt>
                    <dd className="text-right font-medium text-[#172B4D]">
                      {shipmentSummary || '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Pickup</dt>
                    <dd className="text-right font-medium text-[#172B4D]">
                      {formatLongDate(enquiry.schedule.pickup_date)},{' '}
                      {formatTime12(enquiry.schedule.pickup_time)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => runAction('accept')}
                    disabled={actionBusy}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {actionBusy && action === 'accept' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    Accept Quote
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDeclineReason((v) => !v)}
                    disabled={actionBusy}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#172B4D]/20 bg-white px-4 py-3 text-sm font-semibold text-[#172B4D] transition hover:bg-[#172B4D]/5 disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Decline
                  </button>
                </div>

                {showDeclineReason && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                    <label
                      htmlFor="decline-reason"
                      className="mb-1.5 block text-xs font-medium text-slate-600"
                    >
                      Tell us why (optional) — helps us improve the quote
                    </label>
                    <textarea
                      id="decline-reason"
                      rows={2}
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="e.g. Price is above my budget"
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#172B4D] focus:ring-1 focus:ring-[#172B4D]"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => runAction('reject')}
                        disabled={actionBusy}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                      >
                        {actionBusy && action === 'reject' ? 'Submitting…' : 'Confirm decline'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeclineReason(false)}
                        className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}

                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                  This is an estimate. Final price is confirmed by Bihar Transport after vehicle
                  and driver assignment.
                </p>
              </div>
            )}
          </div>

          {/* ── 2. THE SUPPORT CARD + LIVE STATUS ──
              Mobile: third, directly under the map. Desktop: this is the whole
              right-hand column, so the page reads as two balanced halves
              instead of a very tall left column beside a short, empty one. */}
          <div className="order-2 space-y-5 lg:col-start-2 lg:row-start-2 lg:row-span-2 lg:self-start">
            <SupportCard enquiryNumber={enquiry.enquiry_number} />

            <EnquiryStatusSteps status={status} connected={connected} />

            {/* ── Vehicle / driver, once the backend reports an assignment ──
                Renders from `enquiry.assignment`, which the API returns as soon
                as an admin commits resources. Both halves are conditional so a
                truck-without-a-crew reads honestly as "vehicle assigned" rather
                than claiming a driver exists. */}
            {enquiry.assignment && (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-[0_2px_6px_rgba(23,43,77,0.04)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                  {enquiry.assignment.driver_assigned
                    ? 'Vehicle & driver assigned'
                    : 'Vehicle assigned'}
                </p>
                <div className="mt-3">
                  {enquiry.assignment.driver_name && (
                    <DetailRow label="Driver Name" value={enquiry.assignment.driver_name} strong />
                  )}
                  <DetailRow label="Vehicle" value={enquiry.assignment.vehicle_type} />
                  <DetailRow
                    label="Vehicle Number"
                    value={enquiry.assignment.vehicle_number}
                    strong
                  />
                  {enquiry.assignment.vehicle_capacity_kg > 0 && (
                    <DetailRow
                      label="Capacity"
                      value={withUnit(enquiry.assignment.vehicle_capacity_kg, 'kg')}
                    />
                  )}
                  {enquiry.assignment.driver_rating > 0 && (
                    <DetailRow
                      label="Driver Rating"
                      value={`★ ${Number(enquiry.assignment.driver_rating).toFixed(1)}`}
                    />
                  )}
                  {enquiry.assignment.transport_owner?.name && (
                    <DetailRow
                      label="Transport Owner"
                      value={enquiry.assignment.transport_owner.name}
                    />
                  )}
                  <DetailRow
                    label="Status"
                    value={enquiry.assignment.driver_assigned ? 'Driver assigned' : 'Vehicle assigned'}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-emerald-800/70">
                  {enquiry.assignment.driver_assigned
                    ? 'Your vehicle and driver are confirmed for this shipment.'
                    : 'Your vehicle is confirmed. We are finalising the driver for this shipment.'}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/70">
                  For safety and privacy, driver contact details are not shared. All coordination
                  happens through Bihar Transport Customer Care.
                </p>
              </div>
            )}
          </div>

          {/* ── 3. Request details + actions ── */}
          <div className="order-3 space-y-4 lg:col-start-1 lg:row-start-3">
            {/* ── Recent activity, straight from the audit trail ── */}
            {enquiry.events?.length > 0 && (
              <details className="group overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-white shadow-[0_1px_2px_rgba(23,43,77,0.04)]">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-sm font-semibold text-[#172B4D]">
                  <Sparkles className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />
                  Request timeline
                  <ChevronRight
                    className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                </summary>
                <ul className="space-y-3 border-t border-slate-100 px-4 py-4">
                  {enquiry.events.slice(0, 10).map((ev) => (
                    <li key={ev.id} className="flex gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F5A623]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#172B4D]">{ev.message}</p>
                        <p className="text-[11px] text-slate-400">{formatTimestamp(ev.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* ══ SECONDARY CONTENT ═══════════════════════════════════
                Real data, demoted behind one-line accordions. Collapsed, each
                card shows only its own summary — no empty columns, no wasted
                vertical space. */}
            <section aria-labelledby="request-details-heading">
              <h2
                id="request-details-heading"
                className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"
              >
                Request Details
              </h2>

              {/* `items-start` stops a closed accordion from stretching to match
                  the height of its open neighbour, which would leave dead space. */}
              <div className="grid items-start gap-2.5 sm:grid-cols-2">
                <DetailAccordion title="Route" icon={MapPin} summary={routeSummary}>
                  <DetailRow label="Pickup" value={enquiry.route.pickup_location} strong />
                  <DetailBlock label="Pickup address">{enquiry.route.pickup_address}</DetailBlock>

                  <div className="h-px bg-slate-100" />

                  <DetailRow label="Drop" value={enquiry.route.drop_location} strong />
                  <DetailBlock label="Drop address">{enquiry.route.drop_address}</DetailBlock>

                  {enquiry.route.distance_km != null && (
                    <>
                      <div className="h-px bg-slate-100" />
                      <DetailRow
                        label="Distance"
                        value={formatKm(enquiry.route.distance_km)}
                        strong
                      />
                    </>
                  )}
                </DetailAccordion>

                <DetailAccordion
                  title="Shipment"
                  icon={Package}
                  // material is optional (the customer may not have known the
                  // load yet), so the collapsed summary falls back to whatever
                  // shipment detail does exist — never the string "null".
                  summary={
                    [
                      enquiry.shipment.material,
                      shipmentSummary || enquiry.shipment.goods_category,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Details shared with the team'
                  }
                >
                  <DetailRow label="Vehicle" value={vehicleLabel} strong />
                  <DetailRow label="Material" value={enquiry.shipment.material} strong />
                  <DetailRow
                    label="Quantity"
                    value={withUnit(enquiry.shipment.quantity, enquiry.shipment.quantity_unit)}
                  />
                  <DetailRow label="Weight" value={shipmentSummary} />
                  <DetailRow label="Category" value={enquiry.shipment.goods_category} />
                  <DetailRow
                    label="Handling"
                    value={enquiry.shipment.fragile ? 'Fragile goods' : null}
                  />
                  <DetailRow label="Instructions" value={enquiry.shipment.special_instructions} />
                </DetailAccordion>

                <DetailAccordion
                  title="Pickup Schedule"
                  icon={CalendarClock}
                  summary={`${formatLongDate(enquiry.schedule.pickup_date)} · ${formatTime12(
                    enquiry.schedule.pickup_time
                  )}`}
                >
                  <DetailRow
                    label="Pickup Date"
                    value={formatLongDate(enquiry.schedule.pickup_date)}
                    strong
                  />
                  <DetailRow
                    label="Pickup Time"
                    value={formatTime12(enquiry.schedule.pickup_time)}
                    strong
                  />
                </DetailAccordion>

                {/* Fare is deliberately the quietest thing on this page. It is
                    reference information, never the reason the customer is
                    here — the search experience and the support card are. */}
                <DetailAccordion
                  title="Estimated Fare"
                  icon={IndianRupee}
                  summary={estimatedRange || finalPrice || 'Not available yet'}
                  tone="accent"
                >
                  {estimatedRange && (
                    <p className="text-xl font-bold text-[#172B4D]">{estimatedRange}</p>
                  )}
                  {!estimatedRange && !finalPrice && (
                    <p className="text-sm text-slate-500">
                      A fare estimate will be available shortly.
                    </p>
                  )}

                  {enquiry.pricing?.final_quoted_price != null && (
                    <div className="mt-3">
                      <DetailRow label="Final Quote" value={finalPrice} strong />
                    </div>
                  )}

                  <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
                    Final price will be confirmed by Bihar Transport.
                  </p>
                </DetailAccordion>
              </div>
            </section>

            {/* ══ SECONDARY ACTIONS ════════════════════════════════════ */}
            <section className="border-t border-[#172B4D]/10 pt-5">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#172B4D]/15 px-4 py-2.5 text-sm font-medium text-[#172B4D] transition hover:bg-[#172B4D]/5"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Print / Save
                </button>

                {!isClosed && !isCommitted && (
                  <button
                    type="button"
                    onClick={() => runAction('cancel')}
                    disabled={actionBusy}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                  >
                    {actionBusy && action === 'cancel' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                    )}
                    Cancel Request
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => navigate('/book-transport')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#172B4D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#172B4D]/90 sm:ml-auto"
                >
                  Book Another Transport
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Sticky mobile support bar — the two actions a waiting customer
          actually reaches for, always one tap away. It sits below the map in
          the document, so it never covers the map's own controls while the map
          is on screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#172B4D]/10 bg-white/95 px-3 py-3 shadow-[0_-4px_20px_-6px_rgba(23,43,77,0.12)] backdrop-blur md:hidden">
        <MobileSupportBar enquiryNumber={enquiry.enquiry_number} />
      </div>
    </div>
  );
}

/* ── Sticky mobile bar ──────────────────────────────────────────────────
   Loads the customer-care profile once (same endpoint as the Support card) and
   renders the two contact actions. Kept separate so the sticky bar does not
   re-render when unrelated page state changes. The links are built from the
   exact same customer-care config the Support card uses — one number, one
   source of truth, real wa.me and tel: targets. */
function MobileSupportBar({ enquiryNumber }) {
  const [care, setCare] = useState(null);

  useEffect(() => {
    let cancelled = false;
    enquiryAPI
      .getCustomerCare(enquiryNumber)
      .then(({ data }) => {
        if (!cancelled) setCare(data?.data || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enquiryNumber]);

  // Both links come from the shared customer-care builders — the same number,
  // the same profile object the Support card renders.
  const profile = care || FALLBACK_CUSTOMER_CARE;
  const whatsappUrl = buildWhatsAppUrl(profile, enquiryNumber);
  const callUrl = buildCallUrl(profile);

  if (!whatsappUrl && !callUrl) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={callUrl}
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#172B4D]/20 bg-white px-3 text-sm font-semibold text-[#172B4D]"
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        Call
      </a>
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 text-sm font-semibold text-white"
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        WhatsApp
      </a>
    </div>
  );
}
