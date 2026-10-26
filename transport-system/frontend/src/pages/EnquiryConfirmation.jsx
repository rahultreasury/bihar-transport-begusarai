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
 *   2. What is the price, and what truck/crew is it? → final quote + assignment
 *   3. What do I have to do?                      → Accept / Decline
 *
 * Once a quotation has actually been SENT, questions 2 and 3 are the reason the
 * customer came back — so the final quote and the assigned vehicle/driver render
 * immediately under the Request ID, above the map. Previously the quote sat at
 * the BOTTOM of the column, underneath a 400–520px map, so a customer whose
 * quotation was ready still had to scroll past the whole page to find the
 * amount they were being asked to approve. The sections were REPOSITIONED; the
 * cards, their styling, the map, Customer Care and the accept/decline controls
 * are the same components as before.
 *
 * When nothing has been published yet the quote and assignment blocks simply do
 * not render, and the page is exactly the "being processed" view it always was:
 *
 *   received → Request ID → live map → Customer Care → status → details
 *
 * There is no decorative whitespace on this page — a customer who is waiting for
 * a truck should never have to scroll past empty space to find out what is
 * happening, and a customer with a quote in hand should never have to scroll
 * past the map to find out what it costs.
 *
 * DESIGN CONSTRAINTS HONOURED
 *   • Every value comes from the API. No literals, no mock state.
 *   • The quoted amount comes from the CANONICAL persisted Quotation
 *     (GET /enquiries/:idOrNumber/quote → data.quotation), which the backend
 *     returns only once that row is SENT or CONVERTED. A quotation an admin has
 *     merely SAVED is a draft: it is absent from the payload, so it cannot reach
 *     the customer, and the page keeps showing the processing state.
 *   • Accept / Decline stay wired to the real customer-acceptance endpoints and
 *     render only while the server reports AWAITING_CUSTOMER_ACCEPTANCE.
 *   • The "searching" animation is driven by the real `enquiry.status` via
 *     utils/enquirySearchStage.js — it stops the moment the backend reports an
 *     assignment. There is no second state machine here.
 *   • Socket.IO (with polling as the documented fallback) drives live updates.
 *   • Driver/owner phone numbers are never rendered (the backend DTO omits
 *     them; see dtos/EnquiryDTO.js).
 *   • Contact details come from the backend customer-care config only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  Info,
  Sparkles,
  Radio,
  Phone,
  MessageCircle,
  Copy,
  Headset,
  Truck,
  CheckCircle2,
  Clock,
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
 * Retryable : no response at all (offline / DNS / timeout / CORS), 408/425, and
 *             any 5xx — plus a 404 ONLY while the page has never yet had data
 *             for this enquiry (the create may not be visible to this connection
 *             yet). Once the page has shown this enquiry, a 404 is permanent:
 *             the number is wrong or the record is gone, and retrying it on every
 *             poll tick is pure load.
 * Permanent: 400, 401, 403, 422 (a bad id or a missing/revoked guest token) and
 *             429.
 *
 * WHY 429 IS NEVER RETRIED HERE
 * 429 is the server saying "you are asking too often, stop". Re-asking it after
 * 300ms/700ms/1500ms against a five-minute window cannot succeed, and each
 * attempt is another request charged to the same bucket. It is reported
 * immediately instead, and the page suspends its automatic refresh (see `paused`
 * below) until the customer deliberately presses Retry.
 *
 * @param {object} error
 * @param {boolean} hasData - has this page ever resolved data for this enquiry?
 */
function isTransientEnquiryError(error, hasData) {
  const status = error?.response?.status;
  if (!status) return true; // network / timeout — no HTTP status was reached
  if (status === 429) return false;
  if (status === 404) return !hasData;
  if (status === 408 || status === 425) return true;
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
function shouldRetryEnquiry(failureCount, error, hasData) {
  return failureCount < ENQUIRY_RETRY_DELAYS.length && isTransientEnquiryError(error, hasData);
}

/**
 * Coerce a persisted money field into a usable number, or null when it is absent.
 *
 * A quoted amount is NOT the same as a missing amount, so this never collapses
 * the two: `null`, `undefined`, `''` and `NaN` all become null (nothing was
 * quoted), while a real number — including 0 — is returned as-is. Formatting
 * helpers such as Number() would silently turn "no quote" into ₹0.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

/* ── Retention / detention disclosure ──────────────────────────────────────
   The customer is told, in the quotation section itself, that a per-day charge
   applies if the assigned vehicle is held back. It is printed here, on the
   quotation, so nobody can read the approved amount without reading it.

   TERMINOLOGY. The client document's own charge category for "the truck is held
   / vacant for a day" is DETENTION — its example additional-charge line reads
   "Detention rate ₹1500 × 2 Days = ₹3000", which is exactly this charge. That
   existing term is preserved, so the disclosure names it as "Retention
   (detention)" instead of introducing a third name for one charge.

   WHAT THIS IS NOT. It is a CONDITIONAL possibility, not a line item:
     • ₹1,000 is never added to the quoted amount — `finalPrice` still comes
       from Quotation.total_billing_amount and nothing else;
     • no retention row is written to the database to justify the sentence;
     • GST and Total Billing Amount are untouched;
     • if a genuine retention event ever occurs it is raised separately through
       the normal financial workflow, never by this sentence.
   The disclosure is copy, not arithmetic. */
const RETENTION_RATE_PER_DAY = 1000;

/** One-line statement, rendered in the quotation card next to the amount. */
const RETENTION_HEADLINE = `Retention (detention): ${formatINR(RETENTION_RATE_PER_DAY)}/day may apply if the vehicle is retained/vacant.`;

/** The explanatory version that sits directly beneath it. */
const RETENTION_DISCLOSURE = `Retention (detention) charges of ${formatINR(
  RETENTION_RATE_PER_DAY
)} per day may apply if the assigned vehicle is retained/vacant beyond the agreed schedule. Any applicable retention charge will be communicated by Bihar Transport before being applied.`;

/* ── Collapsible presentation of the same disclosure ───────────────────────
   LAYOUT ONLY. The paragraphs above are unchanged in meaning, rate and wording;
   what changed is WHEN the customer sees them. Printed permanently, the full
   paragraph pushed the quotation card — the thing the customer opened the page
   to see — far down the fold, so the card was reduced to a one-line summary and
   the full text revealed on demand.

   This is still a DISCLOSURE, not a smaller claim:
     • the collapsed row names the category ("Additional / Conditional
       Charges") and states plainly that retention may apply, so nothing is
       hidden behind the interaction;
     • the rate is the same RETENTION_RATE_PER_DAY, never summed into anything;
     • Accept / Decline are NOT inside the collapsible. They stay outside it, so
       approving a quotation never requires opening (or being blocked by) the
       disclosure, and the decision stays the last thing on the card.

   WHAT IT IS NOT: an arithmetic control. Nothing here reads `finalPrice` to
   build a number, and no figure below it is ever added to the quote. */

/** Sub-label on the collapsed row. Names the possibility without the wall of text. */
const RETENTION_COLLAPSED_SUMMARY = 'Retention charges may apply';

/** Heading of the expanded panel — the category and its rate. */
const RETENTION_PANEL_HEADING = `Retention (Detention): ${formatINR(
  RETENTION_RATE_PER_DAY
)}/day`;

/** The body of the expanded panel — the full explanation, on demand. */
const RETENTION_PANEL_BODY = `${formatINR(
  RETENTION_RATE_PER_DAY
)} per day may apply if the assigned vehicle is retained/vacant beyond the agreed schedule. Any applicable retention charge will be communicated by Bihar Transport before being applied.`;

/** Closing assurance: the conditional charge is outside the quoted amount. */
const RETENTION_PANEL_FOOTNOTE =
  'This charge is not included in the quoted amount above.';

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

/**
 * A driver-sensitive value inside the "Vehicle & Driver Assigned" card.
 *
 * Until the customer has ACCEPTED the quotation, the driver's identity — name,
 * rating, transport owner — is masked rather than shown: the card still says a
 * vehicle and driver are assigned (that fact is not secret), but who they are is
 * not readable. Once the server confirms the acceptance the mask lifts and the
 * value is simply there.
 *
 * The transition is a blur + opacity fade, ~700ms, ease-out. Short enough to feel
 * like the information arriving, long enough to read as deliberate. Nothing is
 * animated in from off-screen, scaled, or bounced.
 *
 * This is a PRESENTATION effect and nothing more. The same values are still in
 * the JSON the API returned — the backend's job is to decide what may be SENT at
 * all, and it continues to withhold every driver and owner phone number from
 * the customer payload before this component ever runs.
 */
function DriverIdentityValue({ masked, children }) {
  return (
    <span
      aria-hidden={masked ? 'true' : undefined}
      className={
        masked
          ? 'select-none blur-[7px] opacity-55 transition-[filter,opacity] duration-700 ease-out'
          : 'transition-[filter,opacity] duration-700 ease-out'
      }
    >
      {children}
    </span>
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
  // { kind: 'accept' | 'reject' | 'cancel', message: string } | null — the kind
  // is stored with the message so a failure is reported NEXT TO the control the
  // customer actually pressed (the quotation card for Accept/Decline, the page
  // for Cancel) instead of one shared error slot elsewhere on the column.
  const [actionError, setActionError] = useState(null);
  const [showDeclineReason, setShowDeclineReason] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef(null);
  const mapRef = useRef(null);

  /* ── Retention / conditional-charge disclosure visibility ─────────────────
     PRESENTATION ONLY, DEFAULTING TO COLLAPSED.
     `false` on first render is the whole point: the quotation card opens on the
     amount, the route and the decision, and the full retention paragraph is one
     click away instead of permanently pushing them down the page.

     Deliberately plain component state with no persistence and no side effects:
       • nothing is derived from it, so no render path can turn it into money —
         `finalPrice` is Quotation.total_billing_amount whether this is true or
         false, which is why the expansion cannot alter the quoted amount;
       • Accept / Decline are rendered OUTSIDE the collapsible, so toggling this
         neither reveals nor blocks the decision;
       • it is not written to localStorage/sessionStorage or the URL, so a
         refresh — or opening the same quotation in a new tab — returns to the
         default collapsed view rather than restoring a stale open panel.
     `aria-expanded` on the row is driven from this single source of truth. */
  const [showRetentionInfo, setShowRetentionInfo] = useState(false);

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
   * Has this page EVER resolved data for this enquiry?
   *
   * Read straight from the query cache rather than from a state flag, because the
   * retry predicate runs outside render. It is what separates "a 404 that raced
   * the create, worth one more try" from "a 404 for a number that does not
   * exist, which must not be retried on every poll tick forever".
   */
  const enquiryHasData = () =>
    Boolean(
      queryClient.getQueryData([ENQUIRY_QUERY_KEY, enquiryNumber]) ?? seededEnquiry
    );

  /**
   * The single source of truth for this page's data.
   *
   * `retry` is deliberately narrow: only genuinely transient failures are
   * retried, three times, on a ~300 / ~700 / ~1500ms backoff. A 401/403 (this
   * device no longer holds the scoped guest token), a 429 (the server asked us to
   * stop), a 404 for a page that has already loaded, and a malformed id are all
   * reported immediately instead of being retried into more load.
   */
  const enquiryQuery = useQuery({
    queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber],
    enabled: Boolean(enquiryNumber),
    initialData: seededEnquiry,
    staleTime: 0,
    // A single automatic re-read on window focus. The 12s realtime poll below is
    // the steady-state refresh; refocusing must not stack another chain on top.
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => shouldRetryEnquiry(failureCount, error, enquiryHasData()),
    retryDelay: (attemptIndex, error) => {
      const delay = enquiryRetryDelay(attemptIndex);
      if (import.meta.env.DEV && shouldRetryEnquiry(attemptIndex, error, enquiryHasData())) {
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

  /**
   * THE CANONICAL PERSISTED QUOTATION.
   *
   * The enquiry DTO carries `pricing.final_quoted_price`, which the backend
   * nulls for the customer until an admin has published a price. The Phase B
   * commercial record lives behind GET /enquiries/:idOrNumber/quote, and
   * QuotationService returns it ONLY when the persisted Quotation row is SENT or
   * CONVERTED — a saved-but-unsent DRAFT is never in this payload.
   *
   * This query is therefore what makes "saved ≠ sent" true on the customer's
   * screen rather than merely assumed by it:
   *   CASE 1  quote saved, not sent → data.quotation === null → nothing rendered
   *   CASE 2  quote sent           → data.quotation is the persisted row
   *
   * There is no local quote state anywhere on this page: every rupee below comes
   * out of this response or out of the enquiry DTO, both server-owned.
   */
  const quoteQuery = useQuery({
    queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber, 'quote'],
    enabled: Boolean(enquiryNumber),
    staleTime: 0,
    // Read-only and non-critical — the rest of the page is complete without it,
    // so a failure must never escalate into an error screen or a retry storm.
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await enquiryAPI.getQuote(enquiryNumber, { signal });
      return data?.data || null;
    },
  });

  const enquiry = enquiryQuery.data ?? null;
  // `isPending` stays true through every retry, so the loading state — not the
  // error state — is what a customer sees while a recoverable first read settles.
  const isFirstLoad = enquiryQuery.isPending;
  const loadError = enquiryQuery.isError ? enquiryQuery.error : null;

  /**
   * Re-read the authoritative state. Runs on every socket event and poll tick.
   *
   * Both reads are refreshed together on purpose: the enquiry status and the
   * quotation's own published status move together when an admin sends a quote,
   * so a socket tick that refreshed only one of them could leave the page
   * showing a decision prompt for a quote that is not published yet — or a
   * published quote with a stale status. One tick, one consistent render.
   */
  const load = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber, 'quote'] });
    return enquiryQuery.refetch();
  }, [enquiryQuery.refetch, queryClient, enquiryNumber]);

  /**
   * The Retry button: EXACTLY ONE deliberate request.
   *
   * It deliberately does not go through `load()`, because a manual refetch would
   * otherwise re-enter the query's own retry chain and turn one button press into
   * up to four requests. `retry: false` is passed explicitly so the button can
   * never be the start of a burst, whatever the query's automatic policy is.
   */
  const retryOnce = useCallback(() => {
    queryClient.refetchQueries(
      { queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber], exact: true },
      { retry: false }
    );
    queryClient.invalidateQueries({ queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber, 'quote'] });
  }, [enquiryNumber, queryClient]);

  const copyRequestId = async () => {
    if (!enquiry?.enquiry_number) return;
    const text = String(enquiry.enquiry_number);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

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
    // While this page's own read is failing it must NOT keep asking. A page that
    // cannot read the enquiry and keeps polling every 12s is precisely what
    // exhausted the shared rate-limit bucket and made every other customer on
    // the same address see this error. Polling resumes by itself the moment a
    // read succeeds again (e.g. after the customer presses Retry).
    paused: enquiryQuery.isError,
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
        // The quotation's own state changes with the decision, so re-read it
        // from the server instead of assuming what it now says.
        queryClient.invalidateQueries({ queryKey: [ENQUIRY_QUERY_KEY, enquiryNumber, 'quote'] });
      } catch (err) {
        // The message is stored together with the action that produced it, so the
        // failure is reported NEXT TO the control the customer pressed — the
        // quotation card for Accept/Decline, the page for Cancel — instead of one
        // shared error slot somewhere else on the column.
        setActionError({
          kind,
          message:
            err?.response?.data?.message ||
            'We could not complete that action right now. Please try again.',
        });
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

  /* ── Driver identity: blurred until the quotation is accepted ───────────────
     THE SERVER IS THE ONLY SWITCH. `isQuoteAccepted` is derived from the
     persisted `enquiry.status`, so the blur can only lift after the acceptance
     has actually been confirmed by POST /api/enquiries/:idOrNumber/accept (or by
     an admin confirming the same order). It is never lifted optimistically, and a
     refresh re-reads the same status, so the reveal survives a reload.

     The reveal is a PRESENTATION effect only. The backend keeps withholding the
     driver's phone numbers from the customer payload in every state — see
     `customerDriverSelect` / `assertNoDriverPhone` in dtos/EnquiryDTO.js. Blurring
     text here never widens what the API is allowed to send. */
  const isDriverRevealed = isQuoteAccepted;

  // The search narrative is derived from the REAL status. When the server says
  // a vehicle is assigned, `searching` flips to false and the map animation
  // stops — no client-side flag can override that.
  const { searching, stage } = useSearchNarrative(status);

  const estimatedRange = useMemo(
    () => formatFareRange(enquiry?.pricing?.estimated_price_min, enquiry?.pricing?.estimated_price_max),
    [enquiry]
  );

  /**
   * The canonical persisted quotation — the Phase B Quotation row — or null.
   *
   * `null` is meaningful, not a placeholder: QuotationService.getQuotationForCustomer
   * returns null unless the persisted status is SENT or CONVERTED, so this is
   * null while an admin's price is still a saved DRAFT, and non-null the instant
   * POST /api/admin/enquiries/:id/quotation/send succeeds. Nothing here is
   * inferred from a form input or from optimistic frontend state.
   */
  const quotation = quoteQuery.data?.quotation || null;

  /**
   * The single number the customer is being asked to act on.
   *
   * Priority is deliberate: Quotation.total_billing_amount is the commercial
   * record (freight + the additional charges actually itemised on the quotation
   * + their tax), so it always wins. Enquiry.final_quoted_price is kept only as
   * the fallback for the pre-Phase-B send path, and the DTO already nulls it
   * whenever the price is still an unsent draft — so neither branch can surface
   * a number the customer was never sent.
   */
  const quoteAmount = useMemo(() => {
    const fromQuotation = toAmount(quotation?.total_billing_amount);
    if (fromQuotation !== null) return fromQuotation;
    return toAmount(enquiry?.pricing?.final_quoted_price);
  }, [quotation, enquiry]);

  /**
   * Has a quote actually been PUBLISHED to this customer?
   *
   * This is the single gate for every "final quote" affordance on the page. It
   * is false while a quotation is merely saved, so CASE 1 keeps showing only the
   * processing state and never leaks a draft.
   */
  const hasFinalQuote = quoteAmount !== null;

  const finalPrice = useMemo(() => formatINR(quoteAmount), [quoteAmount]);

  /**
   * Additional-charge disclosure.
   *
   * The wording is selected from what is actually PERSISTED on the quotation,
   * never invented:
   *   • the quotation itemises additional charges → the sentence names their
   *     total and says they are already inside the quoted amount, and repeats
   *     that anything outside this quotation must be communicated first;
   *   • it itemises none → the amount is stated as covering the charges included
   *     in this quotation, with anything else conditional on prior disclosure.
   *
   * NO charge category is named in either branch. Toll / parking / loading /
   * detention are never mentioned, because none of them is defined by the
   * quotation or the client document and inventing them would be exactly the
   * ambiguity this disclosure exists to remove.
   */
  const additionalChargeNote = useMemo(() => {
    const charges = Array.isArray(quotation?.additional_charges)
      ? quotation.additional_charges
      : [];
    const chargesTotal = toAmount(quotation?.total_additional_charges);
    const hasCharges = charges.length > 0 || (chargesTotal !== null && chargesTotal > 0);

    return hasCharges
      ? `${finalPrice} is the final quoted amount for the charges included in this quotation, including ${formatINR(
          chargesTotal
        )} of additional charges already applied. Any additional charge that may apply for services or circumstances not included in this quotation will be communicated by Bihar Transport before it is applied.`
      : `${finalPrice} is the final quoted amount for the charges included in this quotation. Additional charges may apply only if separately applicable and will be communicated by Bihar Transport before being applied.`;
  }, [quotation, finalPrice]);

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
    // Each failure gets the reason the server actually gave, so the customer is
    // never told "something went wrong" when the real answer is "this request
    // number does not exist" or "we asked too often".
    const status = loadError?.response?.status;
    const retryAfter = loadError?.response?.headers?.['retry-after'];
    const serverMessage =
      typeof loadError?.response?.data?.message === 'string'
        ? loadError.response.data.message
        : null;

    let message = 'Something went wrong while loading your request. Please try again.';
    if (status === 401 || status === 403) {
      message =
        'This enquiry link has expired on this device. Please verify your mobile number to view it again.';
    } else if (status === 404) {
      message = `We could not find request ${enquiryNumber}. Please check the link, or call customer care.`;
    } else if (status === 429) {
      message = retryAfter
        ? `We are checking your request status a little too often. Please wait ${retryAfter} seconds and then try again.`
        : 'We are checking your request status a little too often. Please wait a moment and then try again.';
    } else if (serverMessage) {
      message = serverMessage;
    }

    return <ErrorState message={message} onRetry={retryOnce} />;
  }

  return (
    <div className="bg-[#F7F8FA] pb-24 md:pb-12">
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        {/* ══ HERO ══════════════════════════════════════════════════════
            READING ORDER (both breakpoints, same sequence):
              received → Request ID → FINAL QUOTE → Vehicle & Driver
              → Accept / Decline → map → Customer Care + status
              → Request Details → Request Timeline
            The final quote and the assigned crew sit directly under the
            Request ID, because once a quotation has been sent those are the
            two things the customer opened the page to see.

            Desktop: that commercial column on the left, Customer Care on the
            right (sticky, so it is always in reach while they read).
            Mobile:  the same single stack.

            Both orders are expressed with `order-*` on the flex flow plus
            explicit `lg:col-start/row-start` for the desktop grid, because
            DOM order alone cannot express both. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.6fr_1fr] lg:items-start lg:gap-x-5 lg:gap-y-4">
          {/* ── Navy Hero Banner ── */}
          <header className="order-0 lg:col-span-2">
            <div className="relative overflow-hidden rounded-2xl bg-[#172B4D] p-4 shadow-lg sm:p-5 lg:p-6">
              {/* Subtle gradient overlay */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#172B4D] via-[#172B4D]/95 to-[#172B4D]/70"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(245,166,35,0.16),transparent_55%)]"
              />
              {/* Truck image on right with subtle road/sunset background effect */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-0 hidden h-full w-1/2 bg-cover bg-right opacity-90 md:block"
                style={{
                  backgroundImage: "url('/bihar-transport-hero.jpg')",
                  filter: 'brightness(0.9) contrast(1.05)',
                }}
              />
              {/* Navy gradient overlay on truck image for readability */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-0 hidden h-full w-1/2 bg-gradient-to-l from-[#172B4D] via-[#172B4D]/70 to-transparent md:block"
              />
              <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5A623]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#F5A623]">
                    REQUEST RECEIVED
                  </span>

                  <h1 className="mt-2 text-xl font-bold leading-tight text-white sm:text-2xl lg:text-2xl xl:text-3xl">
                    {isCancelled
                      ? 'Your request has been cancelled'
                      : isRejected
                      ? 'We have recorded your decision'
                      : isCommitted || isCompleted
                      ? 'Your trip is confirmed'
                      : 'Your transport request is being processed'}
                  </h1>

                  <p className="mt-1 max-w-lg text-sm leading-relaxed text-white/85">
                    {isCancelled
                      ? 'This request is now closed. Contact Bihar Transport customer care if you need to place a new one.'
                      : isRejected
                      ? 'Our team will get in touch to understand what you need.'
                      : isCommitted || isCompleted
                      ? 'Your vehicle and driver are being arranged. Details are below.'
                      : "We've received your shipment details. Bihar Transport is now finding the right vehicle for your route."}
                  </p>

                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
                        REQUEST ID
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 select-all break-all font-mono text-lg font-bold tracking-wider text-white sm:text-xl">
                        {enquiry.enquiry_number}
                      </span>
                      <button
                        type="button"
                        onClick={copyRequestId}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <Link
                        to={`/track/${encodeURIComponent(enquiry.enquiry_number)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#F5A623] px-2.5 py-1.5 text-xs font-semibold text-[#172B4D] transition hover:bg-[#F5A623]/90"
                      >
                        Track Request
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                    {enquiry.booking?.booking_number && (
                      <p className="text-xs text-white/70">
                        Booking reference:{' '}
                        <span className="font-mono font-semibold text-white">
                          {enquiry.booking.booking_number}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* ── 1. THE COMMERCIAL COLUMN ──
              Once an admin has PUBLISHED a quotation, this column leads with the
              money and the crew, because that is what the customer came back to
              see:
                  Request ID → Final Quote → Vehicle & Driver → Accept/Decline
                  → Map → (details below)
              When nothing has been published the first three blocks simply do not
              render and the column collapses back to ID → Map → details, which is
              exactly the CASE 1 processing view.

              Nothing here is duplicated. The vehicle/driver card MOVED up from the
              right-hand column and still renders from the same `enquiry.assignment`
              object; the quote card MOVED up from below the map with its styling
              untouched; the Accept/Decline buttons are the same elements, still
              wired to enquiryAPI.accept / enquiryAPI.reject. */}
          <div className="order-1 space-y-3 lg:col-start-1 lg:row-start-2">

            {/* ── Quote ACCEPTED — read-only confirmation, replaces the quote
                card and the buttons the moment the backend reports the
                acceptance. ── */}
            {isQuoteAccepted && hasFinalQuote && (
              <div className="overflow-hidden rounded-3xl border-2 border-emerald-200 bg-emerald-50/50 p-5 shadow-[0_20px_44px_-30px_rgba(11,27,51,0.5)] sm:p-6">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                  Quote Accepted
                </p>

                <p className="mt-2 text-3xl font-bold text-[#172B4D] sm:text-4xl">{finalPrice}</p>

                <p className="mt-3 text-sm leading-relaxed text-[#172B4D]/80">
                  Your transport request has been accepted. We are preparing your trip confirmation.
                </p>

                {/* The accepted amount is the same amount the customer approved —
                    the disclosure stays with it, because a commercial term of an
                    accepted quotation does not disappear once the buttons do. */}
                <p className="mt-3 rounded-xl bg-white/70 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                  {RETENTION_HEADLINE} {RETENTION_DISCLOSURE}
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

            {/* ══ THE FINAL QUOTE ══════════════════════════════════════════
                MOVED UP from below the map. Previously the amount the customer
                was being asked to approve sat underneath a 400–520px map, so the
                page opened with "being processed" and the quote was only found
                after scrolling. It now renders immediately after the Request ID.

                VISIBILITY: `hasFinalQuote` is driven by the PERSISTED quotation —
                the canonical Quotation row once it is SENT/CONVERTED, otherwise
                the enquiry's published final price. A quotation an admin has only
                SAVED satisfies neither, so CASE 1 shows no quote at all. */}
            {hasFinalQuote && !isQuoteAccepted && (
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

                {/* ── ADDITIONAL-CHARGE DISCLOSURE ──
                    Sits inside the quote card, immediately under the amount and
                    the breakdown, so it reads as part of the price rather than as
                    a warning bolted on. It uses the page's existing muted
                    informational typography and never names a charge category —
                    the wording is derived from what the saved quotation actually
                    contains (see additionalChargeNote). It states a possibility
                    that must be communicated in advance; it never alleges that
                    anything is being withheld. */}
                <p className="mt-4 rounded-xl bg-white/70 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                  {additionalChargeNote}
                </p>

                {/* ── RETENTION / DETENTION DISCLOSURE — NOW COLLAPSIBLE ──
                    Unchanged in POSITION, meaning and rate; changed in FOOTPRINT.
                    It still sits inside the quotation card between the amount and
                    the decision — it is the figure it qualifies — but printed open
                    it spent three permanently-visible paragraphs pushing the very
                    amount and buttons the customer opened the page for down the
                    card. So the detail is now revealed on demand.

                    NOTHING IS CONCEALED. The collapsed row is not an empty bar: it
                    is a real <button> (keyboard-operable, aria-expanded /
                    aria-controls wired to the panel) that names the category and
                    states that retention may apply, so the existence of the charge
                    is visible with zero interaction. Only the detail is deferred.

                    WHY A GRID, NOT A MODAL. `grid-template-rows` 0fr→1fr with a
                    paired opacity change animates the panel's real height without
                    measuring it in JS and without unmounting it, so it opens and
                    closes IN PLACE: no overlay, no route change, no second card,
                    and the Accept / Decline buttons below never jump out from
                    under a thumb. `motion-reduce:` drops the transition for anyone
                    whose OS asks for less motion. The collapsed panel is
                    aria-hidden so a screen reader is not read text that is
                    visually clipped to zero height.

                    THE AMOUNT IS UNTOUCHED — the rule that must not drift.
                    `showRetentionInfo` feeds nothing but these class names and the
                    chevron rotation; it is never read by `finalPrice` (still
                    Quotation.total_billing_amount and nothing else), the ₹1,000 is
                    added to neither Total Billing Amount nor GST, and no retention
                    row is written to justify it. Retention stays CONDITIONAL — it
                    applies only if a genuine retention event occurs, and that is
                    raised separately through the normal financial workflow.
                    Accept / Decline are deliberately OUTSIDE this block, so
                    approving a quotation never requires expanding it. */}
                <div className="mt-3 overflow-hidden rounded-xl border border-[#F5A623]/30 bg-white/70">
                  <button
                    type="button"
                    id="retention-disclosure-toggle"
                    aria-expanded={showRetentionInfo}
                    aria-controls="retention-disclosure-panel"
                    onClick={() => setShowRetentionInfo((v) => !v)}
                    className="flex w-full items-center justify-between gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#F5A623]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#B26A00]/40"
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <Info
                        className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#B26A00]"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-semibold leading-snug text-[#172B4D]">
                          Additional / Conditional Charges
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                          {RETENTION_COLLAPSED_SUMMARY}
                        </span>
                      </span>
                    </span>

                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-[#B26A00] transition-transform duration-300 ease-out motion-reduce:transition-none ${
                        showRetentionInfo ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  <div
                    id="retention-disclosure-panel"
                    role="region"
                    aria-labelledby="retention-disclosure-toggle"
                    aria-hidden={!showRetentionInfo}
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                      showRetentionInfo ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-[#F5A623]/25 px-3 pb-2.5 pt-2.5">
                        <p className="flex items-start gap-1.5 text-[11.5px] font-semibold leading-relaxed text-[#172B4D]">
                          <CalendarClock
                            className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#B26A00]"
                            aria-hidden="true"
                          />
                          {RETENTION_PANEL_HEADING}
                        </p>
                        <p className="mt-1.5 break-words text-[11px] leading-relaxed text-slate-500">
                          {RETENTION_PANEL_BODY}
                        </p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                          {RETENTION_PANEL_FOOTNOTE}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {quotation?.quotation_number && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    Quotation reference:{' '}
                    <span className="font-mono font-semibold text-[#172B4D]">
                      {quotation.quotation_number}
                    </span>
                  </p>
                )}

                {/* ── THE COMPLETE OFFER — ONE package, approved in one tap ───
                    *
                    * The customer is approving a specific truck, driven by a
                    * specific person, for a specific route on a specific date,
                    * at a specific price. Those facts are therefore presented
                    * together, immediately above the Accept button, so what the
                    * customer approves is exactly what they are shown.
                    *
                    * This is a PRESENTATION of data the enquiry already carries
                    * (`assignment` + `schedule` + `shipment`). It introduces no
                    * second offer, no second quote and no second notification —
                    * and it repeats nothing that is already shown in detail
                    * directly below.
                    *
                    * PRIVACY: the driver's NAME is shown; the driver's mobile is
                    * not, and cannot be — `EnquiryDTO.assertNoDriverPhone()`
                    * strips it from this payload before it ever reaches the
                    * browser. Customer care / WhatsApp remains the contact
                    * channel, exactly as before.
                    */}
                {isAwaitingDecision && (
                  <div className="mt-3 rounded-xl border border-[#172B4D]/15 bg-white p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#172B4D]">
                      Your complete offer
                    </p>

                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Pickup
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {enquiry?.route?.pickup_location || '—'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Drop
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {enquiry?.route?.drop_location || '—'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Date & time
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {[
                            formatLongDate(enquiry?.schedule?.pickup_date),
                            formatTime12(enquiry?.schedule?.pickup_time),
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Material
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {enquiry?.shipment?.material || '—'}
                        </dd>
                      </div>

                      {/* The reserved resources. When they exist, the offer is
                          complete — which is why "Finalize & Send" on the admin
                          side will not offer this button without them. */}
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Vehicle
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {enquiry?.assignment?.vehicle_number
                            ? `${enquiry.assignment.vehicle_number}${
                              enquiry.assignment.vehicle_type
                                ? ` · ${enquiry.assignment.vehicle_type}`
                                : ''
                            }`
                            : 'Being arranged'}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                          Driver
                        </dt>
                        <dd className="truncate font-semibold text-[#172B4D]">
                          {enquiry?.assignment?.driver_name || 'Being arranged'}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[#172B4D]/10 pt-2.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Final price
                      </span>
                      <span className="text-[20px] font-bold leading-none text-[#172B4D]">
                        {finalPrice}
                      </span>
                    </div>

                    <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
                      Accepting confirms this booking with the vehicle and driver shown above. No
                      separate vehicle-assignment step follows.
                    </p>
                  </div>
                )}

                {/* ── ACCEPT / DECLINE — THE QUOTATION DECISION ──
                    These two buttons MOVED INTO this card. The customer is
                    approving a COMMERCIAL QUOTATION, not a driver or a truck, so
                    the decision now sits with the number it decides: amount →
                    breakdown → charge disclosure → approve/decline. They are the
                    SAME elements, unchanged, still calling the real
                    enquiryAPI.accept / enquiryAPI.reject against
                    POST /api/enquiries/:idOrNumber/accept and …/reject.

                    They render inside the quotation card only while the SERVER
                    reports AWAITING_CUSTOMER_ACCEPTANCE. That status stays
                    authoritative: rendering them in any other state would offer a
                    tap that EnquiryService.customerAccept rejects with a 409. Once
                    the acceptance is confirmed the whole card — buttons included —
                    is replaced by the read-only "Quote Accepted" state, so there is
                    exactly ONE acceptance action on the page and it can never be
                    pressed twice. */}
                {isAwaitingDecision && (
                  <>
                    <div className="mt-4 border-t border-[#F5A623]/30 pt-4">
                      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#B26A00]">
                        Your decision on this quote
                      </p>

                      <div className="grid gap-2 sm:grid-cols-2">
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

                      {actionError && actionError.kind !== 'cancel' && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{actionError.message}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Vehicle / driver, once the backend reports an assignment ──
                MOVED UP from the right-hand column so it reads directly beneath
                the quote. Renders from `enquiry.assignment`, which the API
                returns as soon as an admin commits resources. Both halves are
                conditional so a truck-without-a-crew reads honestly as "vehicle
                assigned" rather than claiming a driver exists.

                PRIVACY: the field list below is unchanged and remains the
                allow-list the backend projection defines — driver name, vehicle,
                vehicle number, capacity, rating, transport owner name, status.
                No driver mobile and no owner contact number is requested from the
                API, so none can be rendered here. */}
            {enquiry.assignment && (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-[0_2px_6px_rgba(23,43,77,0.04)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                  {enquiry.assignment.driver_assigned
                    ? 'Vehicle & driver assigned'
                    : 'Vehicle assigned'}
                </p>
                <div className="mt-3">
                  {enquiry.assignment.driver_name && (
                    <DetailRow
                      label="Driver Name"
                      value={
                        <DriverIdentityValue masked={!isDriverRevealed}>
                          {enquiry.assignment.driver_name}
                        </DriverIdentityValue>
                      }
                      strong
                    />
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
                      value={
                        <DriverIdentityValue masked={!isDriverRevealed}>
                          ★ {Number(enquiry.assignment.driver_rating).toFixed(1)}
                        </DriverIdentityValue>
                      }
                    />
                  )}
                  {enquiry.assignment.transport_owner?.name && (
                    <DetailRow
                      label="Transport Owner"
                      value={
                        <DriverIdentityValue masked={!isDriverRevealed}>
                          {enquiry.assignment.transport_owner.name}
                        </DriverIdentityValue>
                      }
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
                {!isDriverRevealed && (
                  <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/70">
                    Driver name, rating and transport owner stay hidden until you accept this
                    quotation.
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/70">
                  For safety and privacy, driver contact details are not shared. All coordination
                  happens through Bihar Transport Customer Care.
                </p>
              </div>
            )}

            {/* A published quote whose approval window has not opened yet. Honest
                about the wait rather than presenting two buttons that would be
                rejected by the server if tapped. */}
            {hasFinalQuote && !isAwaitingDecision && !isQuoteAccepted && !isClosed && (
              <p className="text-[11.5px] leading-relaxed text-slate-500">
                Your quote is ready. The Accept and Decline options appear here as
                soon as Bihar Transport opens this quotation for your approval.
              </p>
            )}

            {/* An Accept/Decline failure is reported INSIDE the quotation card,
                directly under the buttons the customer pressed. Only the one
                action left out here — Cancel Request, at the bottom of the page —
                reports at this level, so one failure is never shown twice. */}
            {actionError && actionError.kind === 'cancel' && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{actionError.message}</span>
              </div>
            )}

            <RouteMapExperience
              ref={mapRef}
              route={enquiry.route}
              stage={stage}
              searching={searching}
              connected={connected}
              assignedLabel={assignedLabel}
              mode={isQuoteAccepted ? 'CONFIRMED_ROUTE' : 'PICKUP_SEARCH'}
            />

            {/* Vehicle Search Status Card */}
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#F5A623]/20 bg-[#F5A623]/[0.06] p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A623]/20">
                  <Radio className="h-5 w-5 text-[#F5A623]" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-[#172B4D]">
                        Finding the right truck for you
                      </h3>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                        We're checking suitable transport options near your pickup location.
                      </p>
                    </div>
                    {enquiry.route?.distance_km != null && (
                      <span className="text-xs font-medium text-[#172B4D]/70 whitespace-nowrap">
                        {formatKm(enquiry.route.distance_km)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (mapRef.current) {
                        mapRef.current.fitMapBounds();
                      }
                    }}
                    className="mt-2 text-xs font-medium text-[#F5A623] hover:text-[#F5A623]/80"
                  >
                    View Full Route
                  </button>
                </div>
              </div>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#F5A623]/10">
                <div className="h-full w-full animate-pulse rounded-full bg-[#F5A623]" style={{
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                }} />
              </div>
            </div>
          </div>

          {/* ── 2. RIGHT COLUMN ── */}
          <div className="order-2 space-y-3 lg:col-start-2 lg:row-start-2 lg:row-span-2 lg:self-start">
            {/* Bihar Transport Customer Care Card */}
            <section className="overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center gap-2">
                <Headset className="h-4 w-4 text-[#172B4D]" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#172B4D]">
                  BIHAR TRANSPORT SUPPORT
                </h3>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Available now
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="relative">
                  <div className="h-14 w-14 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 p-0.5">
                    <img
                      src="/assets/customer-care.png"
                      alt="Bihar Transport Customer Care"
                      className="h-full w-full rounded-full object-cover object-center"
                    />
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 ring-2 ring-white" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-[#172B4D]">
                    Bihar Transport Customer Care
                  </h4>
                  <p className="text-sm text-[#F5A623]">Customer Care Executive</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Mon – Sat, 8:00 AM – 8:00 PM
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <a
                  href="https://wa.me/918210931799"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1EBE5A]"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  WhatsApp
                </a>
                <a
                  href="tel:+918210931799"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#172B4D]/20 bg-white px-4 py-2.5 text-sm font-semibold text-[#172B4D] transition hover:bg-[#172B4D]/5"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call Customer Care
                </a>
              </div>
            </section>

            {/* Request Progress Card */}
            <section className="overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-sm font-semibold text-[#172B4D]">Request Progress</h3>
              <div className="mt-4 flex flex-col gap-3">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#172B4D]">Request Received</p>
                    <p className="text-xs text-slate-500">Your enquiry has been submitted</p>
                  </div>
                </div>
                <div className="ml-4 h-6 border-l-2 border-dashed border-slate-200" />
                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    [ENQUIRY_STATUS.CONFIRMED, ENQUIRY_STATUS.CUSTOMER_ACCEPTED, ENQUIRY_STATUS.IN_PROGRESS, ENQUIRY_STATUS.COMPLETED].includes(status)
                      ? 'bg-emerald-100'
                      : 'bg-[#F5A623]/20'
                  }`}>
                    {[ENQUIRY_STATUS.CONFIRMED, ENQUIRY_STATUS.CUSTOMER_ACCEPTED, ENQUIRY_STATUS.IN_PROGRESS, ENQUIRY_STATUS.COMPLETED].includes(status) ? (
                      <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Clock className="h-4 w-4 text-[#F5A623]" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#172B4D]">Finding Your Transport</p>
                    <p className="text-xs text-slate-500">Searching for suitable vehicle</p>
                  </div>
                </div>
                <div className="ml-4 h-6 border-l-2 border-dashed border-slate-200" />
                {/* Step 3 */}
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    [ENQUIRY_STATUS.CONFIRMED, ENQUIRY_STATUS.COMPLETED].includes(status)
                      ? 'bg-emerald-100'
                      : 'bg-slate-100'
                  }`}>
                    {[ENQUIRY_STATUS.CONFIRMED, ENQUIRY_STATUS.COMPLETED].includes(status) ? (
                      <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#172B4D]">Transport Confirmed</p>
                    <p className="text-xs text-slate-500">
                      {[ENQUIRY_STATUS.CONFIRMED, ENQUIRY_STATUS.COMPLETED].includes(status)
                        ? 'Vehicle and driver assigned'
                        : 'Awaiting confirmation'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Live Updates Card */}
            {enquiry.events?.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#172B4D]">Live Updates</h3>
                  {enquiry.events.length > 4 && (
                    <button
                      type="button"
                      onClick={() => navigate(`/track/${encodeURIComponent(enquiry.enquiry_number)}`)}
                      className="text-xs font-medium text-[#F5A623] hover:text-[#F5A623]/80"
                    >
                      View All
                    </button>
                  )}
                </div>
                <ul className="mt-3 space-y-3">
                  {enquiry.events.slice(0, 4).map((ev) => (
                    <li key={ev.id} className="flex gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F5A623]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#172B4D]">{ev.message}</p>
                        <p className="text-[11px] text-slate-400">{formatTimestamp(ev.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* ── 3. Request details, request timeline + actions ──
              Order below is now Details → Timeline, so the reference data a
              customer is likely to want sits directly under the map and the
              audit trail stays as the last thing they scroll to. */}
          <div className="order-3 space-y-4 lg:col-start-1 lg:row-start-3">
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

                  {hasFinalQuote && (
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
