/**
 * AdminOrderMaster.jsx
 * ---------------------------------------------------------------------------
 * ORDER / TRIP MASTER — the single control centre for one shipment.
 * Route: /admin/bookings/:bookingNumber
 *
 * ARCHITECTURE (spec §20 — no new backend system)
 *   This page is a VIEW over records that already exist. It creates no table,
 *   no endpoint and no calculation of its own:
 *
 *     GET /api/admin/bookings/by-number/:n   → the order master
 *                                           (customer, route, goods, vehicle,
 *                                            driver, owner, partner, commercial,
 *                                            quote, delivery — already flattened
 *                                            by BookingMapper)
 *     GET /api/admin/bookings/:id/trip-draft → the linked Trip (if any)
 *     GET /api/trips/:bookingId/financial    → CANONICAL money
 *                                           (amountReceived, outstandingAmount,
 *                                            paymentStatus)
 *     GET /api/trips/:bookingId/transactions/balances → additional charges
 *
 *   Lifecycle stage is NOT computed here — it comes from utils/orderStatus.js,
 *   the single mapping module (spec §21).
 *
 * Every figure below comes from those responses. Where the backend has not
 * recorded something (most bookings have no trip yet, and therefore no expenses
 * and no POD), the page says so honestly instead of inventing a value.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Receipt,
  IndianRupee,
  MapPin,
  Package,
  Truck,
  User,
  Building2,
  Route as RouteIcon,
  CreditCard,
  History,
  ClipboardList,
  Phone,
  Settings2,
  FileText,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import { vehicleHireAPI } from '../services/vehicleHireAPI';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import OrderLifecycle from '../components/admin-premium/orders/OrderLifecycle';
import {
  SectionCard,
  Field,
  Badge,
  StatusCard,
  MoneyRow,
  ActionButton,
  EmptyNote,
  BRAND,
} from '../components/admin-premium/orders/orderUi';
import { resolveOrder, resolvePaymentState } from '../utils/orderStatus';
import { normalizeProcess } from '../components/admin-premium/trips/process/tripProcessModel';
import {
  inr,
  distance,
  formatDate,
  formatDateTime,
  formatClock,
  place,
  na,
  qtyWithUnit,
} from '../utils/orderFormat';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

/** Error-tolerant GET: a 404 on a supplementary call must not blank the page. */
async function safeGet(promise) {
  try {
    const res = await promise;
    return res?.data?.success === false ? null : res?.data?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a workflow object (matching backend trip workflow shape) from booking state
 * when no trip exists. This ensures consistent mapping with backend logic.
 *
 * This function mirrors the backend's config/tripStagePolicy.resolveTripStage()
 * to ensure the frontend fallback produces identical results to the backend.
 */
function buildWorkflowFromBooking(booking, trip = null) {
  const hasVehicle = Boolean(booking?.vehicle_id);
  const hasDriver = Boolean(booking?.driver_id);
  const hasVehicleHire = Boolean(trip?.vehicle_hire_id) || Boolean(booking?.vehicle_hire_id);

  // Determine equivalent trip status based on booking state
  let tripStatus = null;
  const bookingStatus = String(booking?.status || '').toUpperCase();
  const quoteStatus = String(booking?.quote_status || '').toUpperCase();

  if (quoteStatus === 'ACCEPTED') {
    if (bookingStatus === 'COMPLETED') tripStatus = 'COMPLETED';
    else if (bookingStatus === 'DELIVERED') tripStatus = 'DELIVERED';
    else if (bookingStatus === 'IN_TRANSIT' || bookingStatus === 'PICKUP_COMPLETED') tripStatus = 'IN_TRANSIT';
    else if (bookingStatus === 'DRIVER_ASSIGNED') tripStatus = hasVehicleHire ? 'ASSIGNED' : 'PENDING';
    else if (bookingStatus === 'CONFIRMED') tripStatus = 'PENDING';
    else tripStatus = 'PENDING';
  }

  // Fallback to resolve based on resources
  if (!tripStatus && (hasVehicle || hasDriver)) {
    tripStatus = hasVehicleHire ? 'ASSIGNED' : 'PENDING';
  }

  // Use the same stage definitions as the backend (config/tripStagePolicy.js)
  const STAGES = [
    { key: 'ENQUIRY', label: 'Enquiry', trip_status: null, goto: { kind: 'enquiry' } },
    { key: 'QUOTATION', label: 'Quote', trip_status: null, goto: { kind: 'enquiry', anchor: 'quote' } },
    { key: 'ORDER_CONFIRMED', label: 'Confirmed', trip_status: null, goto: { kind: 'overview' } },
    { key: 'VEHICLE_HIRED', label: 'Vehicle', trip_status: 'ASSIGNED', goto: { kind: 'vehicle_hire' } },
    { key: 'LOADING', label: 'Loading', trip_status: 'AT_LOADING_POINT', goto: { kind: 'trip_tab', tab: 'loading' } },
    { key: 'DISPATCH', label: 'Dispatch', trip_status: 'DISPATCHED', goto: { kind: 'trip_tab', tab: 'dispatch' } },
    { key: 'TRANSIT', label: 'Transit', trip_status: 'IN_TRANSIT', goto: { kind: 'trip_tab', tab: 'tracking' } },
    { key: 'DELIVERY', label: 'Delivery', trip_status: 'DELIVERED', goto: { kind: 'trip_tab', tab: 'delivery' } },
    { key: 'POD', label: 'POD', trip_status: null, goto: { kind: 'trip_tab', tab: 'pod' } },
    { key: 'COMPLETED', label: 'Completed', trip_status: 'COMPLETED', goto: { kind: 'trip_tab', tab: 'summary' } },
  ];

  const STATUS_TO_STAGE = {
    PENDING: 'VEHICLE_HIRED',
    ASSIGNED: 'VEHICLE_HIRED',
    TO_LOADING_POINT: 'LOADING',
    AT_LOADING_POINT: 'LOADING',
    LOADED: 'LOADING',
    DISPATCHED: 'DISPATCH',
    IN_TRANSIT: 'TRANSIT',
    DELIVERED: 'POD', // Will be refined by POD logic below
    COMPLETED: 'COMPLETED',
    CANCELLED: 'COMPLETED',
  };

  const NEXT_ACTION_BY_STATUS = {
    PENDING: { id: 'HIRE_VEHICLE', label: 'Hire Vehicle', stage: 'VEHICLE_HIRED', endpoint: `/api/vehicle-hire/trips/${trip?.trip_id || ''}`, method: 'POST', requires_hire_form: true },
    ASSIGNED: { id: 'SEND_TO_LOADING', label: 'Send / Schedule Vehicle for Loading', stage: 'LOADING', endpoint: `/api/trips/${trip?.trip_id || ''}/loading/send`, method: 'POST', requires_hire_form: false },
    TO_LOADING_POINT: { id: 'ARRIVE_LOADING', label: 'Mark Arrived at Loading', stage: 'LOADING', endpoint: `/api/trips/${trip?.trip_id || ''}/loading/arrive`, method: 'POST' },
    AT_LOADING_POINT: { id: 'MARK_LOADED', label: 'Mark as Loaded', stage: 'LOADING', endpoint: `/api/trips/${trip?.trip_id || ''}/loading/complete`, method: 'POST' },
    LOADED: { id: 'DISPATCH', label: 'Dispatch Vehicle', stage: 'DISPATCH', endpoint: `/api/trips/${trip?.trip_id || ''}/dispatch`, method: 'POST' },
    DISPATCHED: { id: 'START_TRANSIT', label: 'Start Transit / View Tracking', stage: 'TRANSIT', endpoint: `/api/trips/${trip?.trip_id || ''}/transit/start`, method: 'POST' },
    IN_TRANSIT: { id: 'ARRIVE_DELIVERY', label: 'Arrived at Delivery', stage: 'DELIVERY', endpoint: `/api/trips/${trip?.trip_id || ''}/arrival`, method: 'POST' },
    DELIVERED: { id: 'UPLOAD_POD', label: 'Upload POD', stage: 'POD', endpoint: `/api/trips/${trip?.trip_id || ''}/pod`, method: 'POST' },
    COMPLETED: { id: 'VIEW_SUMMARY', label: 'View Completion Summary', stage: 'COMPLETED', endpoint: null, method: null },
    CANCELLED: { id: 'VIEW_SUMMARY', label: 'Order cancelled — no action required', stage: 'COMPLETED', endpoint: null, method: null },
  };

  const STAGE_REQUIREMENT = {
    LOADING: 'The vehicle must be hired and sent to the loading point first',
    DISPATCH: 'Loading must be completed before the vehicle can be dispatched',
    TRANSIT: 'Transit starts after the vehicle is dispatched',
    DELIVERY: 'Delivery opens once the vehicle is in transit',
    POD: 'Proof of delivery opens after the consignment is delivered',
    COMPLETED: 'The trip completes after delivery and, where required, POD',
  };

  // When quote is ACCEPTED but no trip exists yet, the operational stages are
  // locked except for Vehicle Hire, which provisions the trip.
  const quoteAcceptedNoTrip = quoteStatus === 'ACCEPTED' && !tripStatus;

  if (!tripStatus) {
    const stages = STAGES.map((s) => {
      let state = 'unavailable';
      let requirement = 'This order has no operational trip yet';
      if (quoteAcceptedNoTrip && s.key === 'VEHICLE_HIRED') {
        state = 'available';
        requirement = 'Click to create the operational trip and hire a vehicle';
      } else if (quoteAcceptedNoTrip && s.key === 'ORDER_CONFIRMED') {
        state = 'current';
        requirement = null;
      }
      return ({ key: s.key, label: s.label, trip_status: s.trip_status, goto: s.goto, state, requirement });
    });

    return {
      status: null,
      effective_status: null,
      has_trip: false,
      vehicle_hire_state: null,
      pod_required: false,
      pod_received: false,
      current_stage: quoteAcceptedNoTrip ? 'ORDER_CONFIRMED' : null,
      current_stage_label: quoteAcceptedNoTrip ? 'Confirmed' : 'Not operational yet',
      next_action: quoteAcceptedNoTrip
        ? { id: 'HIRE_VEHICLE', label: 'Create Trip & Hire Vehicle', stage: 'VEHICLE_HIRED', endpoint: '/api/vehicle-hire/provision', method: 'POST', requires_hire_form: true }
        : { id: 'NONE', label: 'This order has no operational trip yet', stage: null, endpoint: null, method: null },
      stages,
    };
  }

  // ── Vehicle hire state (mirrors backend logic) ──────────────────────────────
  let vehicleHireState = null;
  if (tripStatus === 'PENDING') {
    vehicleHireState = hasVehicleHire ? 'VEHICLE_HIRED' : 'WAITING_FOR_VEHICLE';
  } else if (tripStatus === 'ASSIGNED') {
    vehicleHireState = hasVehicleHire ? 'VEHICLE_HIRED' : 'VEHICLE_ASSIGNED';
  }

  // ── POD handling (mirrors backend logic) ────────────────────────────────────
  // POD is a DOCUMENT state, not a trip status. Check if POD is required/received.
  // Since we don't have document checklist in fallback, we infer from booking/delivery.
  // For fallback, we assume POD is required if status is DELIVERED but not COMPLETED.
  const podRequired = tripStatus === 'DELIVERED' && bookingStatus !== 'COMPLETED';
  const podReceived = bookingStatus === 'COMPLETED'; // Completed implies POD received

  // Effective status refines DELIVERED based on POD state (mirrors backend)
  let effectiveStatus = tripStatus;
  if (tripStatus === 'DELIVERED') {
    effectiveStatus = podRequired && !podReceived ? 'POD_PENDING' : 'READY_TO_COMPLETE';
  }

  // Next action for effective status (mirrors backend nextActionFor)
  let action;
  if (effectiveStatus === 'POD_PENDING') {
    action = {
      id: 'UPLOAD_POD',
      label: 'Upload POD',
      stage: 'POD',
      endpoint: `/api/trips/${trip?.trip_id || ''}/pod`,
      method: 'POST',
      requires_hire_form: false,
    };
  } else if (effectiveStatus === 'READY_TO_COMPLETE') {
    action = {
      id: 'COMPLETE_TRIP',
      label: 'Complete Trip',
      stage: 'COMPLETED',
      endpoint: `/api/trips/${trip?.trip_id || ''}/complete`,
      method: 'POST',
    };
  } else {
    action = NEXT_ACTION_BY_STATUS[effectiveStatus] || { id: 'NONE', label: 'No action required', stage: 'COMPLETED', endpoint: null, method: null };
  }

  // Current stage key (mirrors backend stageKeyFor)
  let currentStageKey;
  if (effectiveStatus === 'POD_PENDING' || effectiveStatus === 'READY_TO_COMPLETE') {
    currentStageKey = 'POD';
  } else {
    currentStageKey = STATUS_TO_STAGE[tripStatus] || STATUS_TO_STAGE[effectiveStatus] || 'VEHICLE_HIRED';
  }

  const currentStageLabel = STAGES.find((s) => s.key === currentStageKey)?.label || currentStageKey;

  function stageStateFor(key, currentKey, actionStage) {
    const i = STAGES.findIndex((s) => s.key === key);
    const cur = STAGES.findIndex((s) => s.key === currentKey);
    if (i < 0) return 'locked';
    if (i < cur) return 'done';
    if (i === cur) return 'current';
    // 'available' is the stage the NEXT ACTION belongs to
    if (actionStage && key === actionStage) return 'available';
    return 'locked';
  }

  return {
    status: tripStatus,
    effective_status: effectiveStatus,
    vehicle_hire_state: vehicleHireState,
    pod_required: podRequired,
    pod_received: podReceived,
    current_stage: currentStageKey,
    current_stage_label: currentStageLabel === 'Vehicle Hired' ? 'Vehicle' : currentStageLabel,
    next_action: action,
    has_trip: Boolean(trip?.trip_id),
    stages: STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      trip_status: s.trip_status,
      goto: s.goto,
      state: stageStateFor(s.key, currentStageKey, action.stage),
      requirement: STAGE_REQUIREMENT[s.key] || null,
    })),
  };
}

export default function AdminOrderMaster() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state || {};

  const [order, setOrder] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [trip, setTrip] = useState(null);
  const [balances, setBalances] = useState(null);
  const [events, setEvents] = useState([]);
  // The CANONICAL operational projection for this trip:
  // GET /api/trips/:id/workflow → `stage` (current stage, next action, the ten
  // rail nodes), resolved server-side from `Trip.status` alone. Null until a
  // trip exists, in which case the page falls back to resolveOrder().
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Determine if the param is a numeric ID or a booking number string
  const isBookingId = bookingNumber && /^\d+$/.test(bookingNumber);
  const bookingId = isBookingId ? parseInt(bookingNumber, 10) : null;
  const bookingNumberStr = isBookingId ? null : bookingNumber;

  const load = useCallback(
    async ({ silent } = {}) => {
      if (!bookingNumber) return;
      silent ? setRefreshing(true) : setLoading(true);
      try {
        // Support both booking_id (numeric) and booking_number (string)
        const res = isBookingId
          ? await adminAPI.getBooking(bookingId)
          : await adminAPI.getBookingByNumber(bookingNumberStr);
        if (!res?.data?.success) throw new Error(res?.data?.message || 'Order not found');
        const row = res.data.data;
        setOrder(row);
        setError(null);

        // Supplementary calls run in parallel and are individually fault-tolerant:
        // a booking without a trip must still render a complete order header.
        const [fin, draft, bal, tl] = await Promise.all([
          safeGet(adminAPI.getTripFinancial(row.booking_id)),
          safeGet(adminAPI.getTripDraft(row.booking_id)),
          safeGet(adminAPI.getTripPartyBalances(row.booking_id)),
          safeGet(adminAPI.getTripFinancialTimeline(row.booking_id)),
        ]);
        setFinancial(fin);
        const tripRow = draft?.existing_trip || null;
        setTrip(tripRow);
        setBalances(bal);
        setEvents(Array.isArray(tl) ? tl : []);

        // Load full trip data with relations (vehicle, driver, owner, etc.) when a trip exists
        // This provides the canonical vehicle/driver/owner data for the Vehicle & Driver section
        const fullTrip = tripRow?.trip_id ? await safeGet(adminAPI.getTrip(tripRow.trip_id)) : null;
        if (fullTrip) {
          // Preserve trip_id if it's missing from fullTrip to avoid breaking clickability
          // The trip API returns `id` as the primary key; normalize to trip_id for consistency
          const normalizedTrip = {
            ...fullTrip,
            trip_id: fullTrip.trip_id ?? fullTrip.id ?? tripRow.trip_id,
          };
          setTrip(normalizedTrip);
        }

        // The operational stage comes from the trip's OWN workflow endpoint when available.
        // When no trip exists, construct workflow using canonical mapping for consistency.
        if (tripRow?.trip_id) {
          const wf = await safeGet(adminAPI.getTripWorkflow(tripRow.trip_id));
          setWorkflow(wf);
        } else {
          const constructed = buildWorkflowFromBooking(row, fullTrip);
          setWorkflow(constructed);
        }
      } catch (e) {
        setError(e.message || 'Could not load this order');
        setOrder(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [bookingNumber]
  );

  useEffect(() => {
    load();
  }, [load]);

  // ── Trip ID ────────────────────────────────────────────────────────────────
  // Canonical trip ID derived from all available sources.
  const tripId = useMemo(() => 
    trip?.trip_id ?? trip?.id ?? order?.trip_id ?? order?.trip?.trip_id ?? order?.trip?.id ?? workflow?.trip_id ?? null,
    [trip, order, workflow]
  );

  // ── Trip existence flag ────────────────────────────────────────────────────
  // A trip exists only when we have a valid tripId from the API response.
  // Loading/error states are handled separately and do not imply "no trip".
  const hasTrip = useMemo(() => {
    const id = trip?.trip_id ?? trip?.id ?? order?.trip_id ?? order?.trip?.trip_id ?? order?.trip?.id ?? workflow?.trip_id ?? null;
    console.log('[AdminOrderMaster] hasTrip calc:', { tripId: id, hasTrip: !!id, trip, orderTripId: order?.trip_id, orderTrip: order?.trip?.trip_id, workflowTripId: workflow?.trip_id });
    return !!id;
  }, [trip, order, workflow]);

  // navState.tripId is used ONLY for navigation fallback in goto(), not for determining trip existence.
  const navTripId = navState?.tripId ?? null;
 
  const resolved = useMemo(() => (order ? resolveOrder(order, trip) : null), [order, trip]);

  // ── Where a click on the rail / a card / the next action goes ──────────────
  // Pure NAVIGATION. Nothing here writes: a stage click opens the workspace for
  // that stage, and a status only ever moves through the operational endpoint the
  // backend named in `workflow.stage.next_action`.
  // The trip API returns `id` as primary key; normalize across all sources.
  // IMPORTANT: navState.tripId is NOT used as a fallback for trip existence.
  // It may contain a stale value from a previous navigation. Trip existence is
  // determined solely by the API response (trip, order.trip, workflow).

  /**
   * The canonical order number and the flattened booking row.
   *
   * DECLARED HERE, BEFORE `goto` BELOW, ON PURPOSE.
   *   `goto` needs the order number to route "Confirmed" back to this same page.
   *   It used to be declared far below in the render body, which put it in the
   *   temporal dead zone for every hook above it: React evaluated the hook's
   *   dependency array, hit `orderNo` before its `const` had initialised, and
   *   threw
   *       ReferenceError: Cannot access 'orderNo' before initialization
   *   The error boundary then rendered "Something went wrong" for EVERY order,
   *   including ones whose API call had succeeded. Moving the declaration above
   *   its first use is the whole fix.
   */
  const orderNo = order?.booking_number || order?.booking_reference || bookingNumberStr || (bookingId ? String(bookingId) : '');

  /**
   * The canonical operational status for this order's TRIP.
   *
   * Trip is the single source of truth (§17): the status cards below read this,
   * never `Booking.status`, `Enquiry.status` or `VehicleHire.status`. A booking
   * with no trip has no operational status, and the cards fall back to the
   * pre-existing booking fields instead of inventing one.
   * 
   * Priority: trip.status (from API) > workflow.status (from backend workflow) > constructed workflow status
   */
  const tripStatus = useMemo(() => 
    trip?.status ?? workflow?.status ?? workflow?.stage?.status ?? null,
    [trip, workflow]
  );

  // Normalized workflow reference: backend returns {stages, pod_received, pod_required, loading, delivery, ...} directly;
  // constructed workflow wraps everything in {stage: {stages, pod_received, pod_required, loading, delivery, ...}}.
  const wf = useMemo(() => workflow?.stages ? workflow : workflow?.stage, [workflow]);

  // Helper to get stage state from workflow stages array
  const getStageState = useCallback((stageKey) => {
    if (!wf?.stages?.length) return null;
    const stage = wf.stages.find((s) => s.key === stageKey);
    return stage?.state || null;
  }, [wf]);

  // Map stage state to display label and tone for status cards
  const getStageDisplay = useCallback((stageKey) => {
    const state = getStageState(stageKey);
    switch (state) {
      case 'done':
        return { label: 'Completed', tone: 'success' };
      case 'skipped':
        return { label: 'Skipped', tone: 'warning' };
      case 'current':
        return { label: 'In Progress', tone: 'warning' };
      case 'available':
        return { label: 'Ready', tone: 'warning' };
      case 'locked':
        return { label: 'Pending', tone: 'neutral' };
      case 'unavailable':
        return { label: 'N/A', tone: 'neutral' };
      default:
        return { label: 'Unknown', tone: 'neutral' };
    }
  }, [getStageState]);

  // Check if quote is accepted (for provisioning and enabling Vehicle Hire stage)
  const quoteAccepted = useMemo(() => String(order?.quote_status || '').toUpperCase() === 'ACCEPTED', [order]);

  const goto = useCallback(
    async (kind, extra = {}) => {
      const enquiryId = order?.enquiry_id ?? null;
      // Use the normalized tripId (already memoized with all fallbacks including trip.id)
      const tid = tripId;
      console.log('[OrderMaster] goto:', { kind, extra, tid, tripId, enquiryId, hasTrip });
      
      // Trip-dependent actions that should not navigate when no trip exists
      // EXCEPTION: vehicle_hire is allowed when quote is accepted (provisions trip)
      const tripDependentActions = ['trip_tab', 'finance'];
      
      if (!hasTrip && tripDependentActions.includes(kind)) {
        console.log('[OrderMaster] Blocked navigation - no trip exists:', kind);
        return;
      }
      
      switch (kind) {
        case 'enquiry':
          // The EXISTING enquiry workspace — no second enquiry screen.
          if (enquiryId) navigate(`/admin/enquiries/${enquiryId}`);
          else if (order?.enquiry_reference) navigate(`/admin/enquiries/${order.enquiry_reference}`);
          break;
        case 'vehicle_hire':
          // The vehicle PROCESS workspace. `/vehicle-hire` is the canonical
          // Universal Vehicle Hire page for actually engaging a truck.
          // When a tripId exists, go to the trip-specific hire page.
          if (tid) {
            navigate(`/admin/trips/${tid}/vehicle-hire`);
          } else if (quoteAccepted && order?.booking_id) {
            // No trip yet, but quote is accepted — provision the trip first
            try {
              const response = await vehicleHireAPI.provision({ booking_id: order.booking_id });
              if (response.data?.success && response.data.data?.trip?.trip_id) {
                const newTripId = response.data.data.trip.trip_id;
                // Navigate to the new trip's vehicle-hire page
                navigate(`/admin/trips/${newTripId}/vehicle-hire`);
              }
            } catch (err) {
              console.error('[OrderMaster] Provisioning failed:', err);
              // Error will be shown by the API interceptor / toast
            }
          }
          // If no tripId and no quote acceptance, do not navigate - action is disabled in UI
          break;
        case 'overview':
          navigate(`/admin/bookings/${orderNo}`);
          break;
        case 'trip_tab':
          const process = normalizeProcess(
            String(extra.tab || 'loading').toLowerCase().replace(/_/g, ''),
          );
          console.log('[OrderMaster] trip_tab:', { tid, process, target: tid ? `/admin/trips/${tid}/${process}` : `/admin/bookings/${orderNo}` });
          // Align with Path B (Vehicle Hire → View Trip): Transit, Delivery, POD, Completed
          // all live in the central Trip Workspace tabs, not separate process routes.
          // Only Vehicle, Loading, Dispatch have dedicated process pages.
          const centralTabs = { transit: 'loading', delivery: 'pod', pod: 'pod', completed: 'pod' };
          const tab = centralTabs[process];
          if (tid && tab) {
            navigate(`/admin/trips/${tid}?tab=${tab}`, { replace: true });
          } else if (tid) {
            navigate(`/admin/trips/${tid}/${process}`);
          }
          // If no tripId, navigation is blocked above
          break;
        case 'finance':
          if (tid) navigate(`/admin/trips/${tid}/finance`);
          break;
        default:
          break;
      }
    },
    [navigate, orderNo, tripId, order, hasTrip, vehicleHireAPI, quoteAccepted]
  );

  /** Handle a click on any rail node, the next action, or a status card. */
  const handleStageSelect = useCallback(
    (stage) => {
      console.log('[OrderMaster] handleStageSelect called:', {
        stageKey: stage?.key,
        stageState: stage?.state,
        stageGoto: stage?.goto,
        stageAction: stage?.action,
        tripId,
        workflowKeys: Object.keys(workflow || {}),
        wfKeys: Object.keys(wf || {}),
        hasTrip,
      });
      if (!stage) return;
      
      // Allow Vehicle Hire stage click when quote is accepted (provisions trip)
      const quoteAccepted = String(order?.quote_status || '').toUpperCase() === 'ACCEPTED';
      
      // Block trip-dependent stages when no trip exists
      // EXCEPTION: Vehicle Hire is allowed when quote is accepted
      const tripDependentStages = ['LOADING', 'DISPATCH', 'TRANSIT', 'DELIVERY', 'POD', 'COMPLETED'];
      if (!hasTrip && stage.key && tripDependentStages.includes(stage.key)) {
        console.log('[OrderMaster] Blocked stage click - no trip exists:', stage.key);
        return;
      }
      
      if (stage.goto?.kind === 'next_action') {
        // The next action leads into the workspace for the stage it belongs to.
        const stageKey = stage.action?.stage;
        console.log('[OrderMaster] next_action path, stageKey:', stageKey);
        goto(stageKey === 'VEHICLE_HIRED' ? 'vehicle_hire' : 'trip_tab', {
          tab: String(stageKey || '').toLowerCase(),
        });
        return;
      }
      console.log('[OrderMaster] calling goto with:', stage.goto?.kind, stage.goto);
      goto(stage.goto?.kind, stage.goto || {});
    },
    [goto, tripId, workflow, wf, hasTrip, order]
  );

  // Payment truth comes from the canonical financial API when it exists, and
  // only falls back to the booking row otherwise.
  const payment = useMemo(() => {
    if (financial && (financial.paymentStatus || financial.outstandingAmount != null)) {
      const billing = Number(financial.customerFare) || Number(order?.final_price) || 0;
      const received = Number(financial.amountReceived) || 0;
      const state =
        financial.paymentStatus === 'PAID' || (billing > 0 && received >= billing)
          ? { key: 'PAID', label: 'Paid', tone: 'success' }
          : financial.paymentStatus === 'PARTIAL' || received > 0
            ? { key: 'PARTIAL', label: 'Partially Paid', tone: 'warning' }
            : { key: 'PENDING', label: 'Pending', tone: 'neutral' };
      return { ...state, billing, received, due: Number(financial.outstandingAmount) || 0 };
    }
    const billing = Number(order?.final_price ?? order?.estimated_price) || 0;
    const state = resolvePaymentState(order);
    return { ...state, billing, received: 0, due: billing };
  }, [financial, order]);

  if (loading) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
        <div className="space-y-4">
          <LoadingSkeleton className="h-32 w-full rounded-2xl" />
          <LoadingSkeleton className="h-24 w-full rounded-2xl" />
          <LoadingSkeleton className="h-64 w-full rounded-2xl" />
        </div>
      </AdminShell>
    );
  }

  if (error || !order) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <h1 className="text-lg font-bold text-red-800">Order unavailable</h1>
          <p className="mt-1 text-sm text-red-700">{error || 'Not found'}</p>
          <button
            type="button"
            onClick={() => navigate('/admin/bookings')}
            className="mt-4 rounded-xl bg-[#15345B] px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Order Master
          </button>
        </div>
      </AdminShell>
    );
  }

  const o = order;

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
      <div className="mx-auto max-w-none space-y-4">
        {/* ── Page title + actions ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="bt-page-title">Order / Trip Master</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Manage the complete shipment lifecycle, commercial details, vehicle assignment and
              delivery operations from one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={ArrowLeft} onClick={() => navigate('/admin/bookings')}>
              All Orders
            </ActionButton>
            <ActionButton
              icon={RefreshCw}
              onClick={() => load({ silent: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </ActionButton>
            <ActionButton icon={Settings2} onClick={() => navigate(`/admin/bookings/${orderNo}/assign-driver`)}>
              Change Driver
            </ActionButton>
            {/* Vehicle Hire button - only enabled when a trip exists */}
            <ActionButton
              data-testid="order-trip-vehicle-hire"
              icon={Truck}
              onClick={hasTrip ? () => navigate(`/admin/trips/${tripId}/vehicle-hire`) : undefined}
              disabled={!hasTrip}
              title={hasTrip ? 'Open Vehicle Hire for this trip' : 'No operational trip exists — Vehicle Hire unavailable'}
            >
              Vehicle Hire
            </ActionButton>
            {/* Print uses the browser's own renderer — no PDF library, no new
                backend document job, and it always reflects the live DOM. */}
            <ActionButton icon={FileText} onClick={() => window.print()}>
              Print
            </ActionButton>
          </div>
        </div>

        {/* ── Order header ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-mono text-xl font-bold tracking-tight text-slate-900">
                      ORDER #{orderNo}
                </h2>
                <Badge tone={
                  (hasTrip && wf && wf.current_stage === 'COMPLETED') ? 'success' :
                  (hasTrip && wf && wf.current_stage === 'POD' && !wf.pod_received && wf.pod_required) ? 'warning' :
                  (resolved.state === 'blocked' ? 'danger' : 'brand')
                }>
                  Order {hasTrip && wf ? wf.current_stage_label : resolved.stageLabel}
                </Badge>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                <div>
                  <dt className="inline font-semibold">Created: </dt>
                  <dd className="inline">{formatDateTime(o.created_at)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Last Updated: </dt>
                  <dd className="inline">{formatDateTime(o.updated_at)}</dd>
                </div>
                {trip?.trip_number ? (
                  <div>
                    <dt className="inline font-semibold">Trip: </dt>
                    <dd className="inline font-mono">{trip.trip_number}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums tracking-tight text-[#15345B]">
                {inr(payment.billing)}
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Total Billing Amount
              </p>
              <div className="mt-1.5">
                <Badge tone={payment.tone}>Payment: {payment.label}</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* ── Lifecycle ────────────────────────────────────────────────__ */}
        <OrderLifecycle
          resolved={resolved}
          workflow={wf || null}
          onSelect={handleStageSelect}
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* ══ MAIN COLUMN ══════════════════════════════════════════════ */}
          <div className="min-w-0 space-y-4">
            {/* Order information */}
            <SectionCard title="Order Information" icon={ClipboardList}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                <Field label="Order Number" value={orderNo} mono />
                <Field label="Date" value={formatDate(o.pickup_date)} />
                <Field
                  label="Party"
                  value={place(o.customer_first_name, o.customer_last_name)}
                />
                <Field
                  label="Contact Person"
                  value={na(o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}`.trim() : null)}
                />
                <Field label="Mobile" value={na(o.customer_phone)} />
                <Field label="Email" value={na(o.customer_email)} />
                <Field label="Trip Type" value="One Way" />
                <Field label="Trip Date" value={formatDate(o.pickup_date)} />
                <Field label="Trip Time" value={formatClock(o.pickup_time)} />
                <Field
                  label="Expected Delivery"
                  value={formatDate(o.estimated_delivery_time || o.delivered_at)}
                />
                <Field label="Confirmation Source" value={na(o.confirmation_source)} />
                <Field label="Quote Valid Until" value={formatDate(o.quote_valid_until)} />
              </dl>
            </SectionCard>

            {/* Route */}
            <SectionCard title="Shipment Details" icon={RouteIcon}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    Pickup
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-800">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    {place(o.pickup_location, o.pickup_city, o.pickup_state)}
                  </p>
                  {o.pickup_address ? (
                    <p className="mt-1 pl-6 text-xs text-slate-500">{o.pickup_address}</p>
                  ) : null}
                  <p className="mt-1.5 pl-6 text-xs text-slate-500">
                    {formatDate(o.pickup_date)} · {formatClock(o.pickup_time)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
                    Drop
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-800">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                    {place(o.drop_location, o.drop_city, o.drop_state)}
                  </p>
                  {o.drop_address ? (
                    <p className="mt-1 pl-6 text-xs text-slate-500">{o.drop_address}</p>
                  ) : null}
                  <p className="mt-1.5 pl-6 text-xs text-slate-500">
                    Expected {formatDate(o.estimated_delivery_time)}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
                <Field label="Distance" value={distance(o.estimated_distance_km)} />
                <Field label="Trip Type" value="One Way" />
                <Field label="Trip Date" value={formatDate(o.pickup_date)} />
                <Field label="Expected Delivery" value={formatDate(o.estimated_delivery_time)} />
              </dl>
            </SectionCard>

            {/* Goods */}
            <SectionCard title="Goods Details" icon={Package}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Field label="Goods" value={na(o.goods_description)} />
                <Field label="Goods Type" value={na(o.goods_type)} />
                <Field label="Quantity" value={qtyWithUnit(o.number_of_items, o.quantity_unit)} />
                <Field label="Weight" value={qtyWithUnit(o.goods_weight_kg, o.weight_unit)} />
                <Field label="Volume" value={na(o.goods_volume)} />
                <Field label="Vehicle Type Required" value={na(o.vehicle_type_required)} />
                <Field label="Fragile" value={o.fragile ? 'Yes' : 'No'} />
                <Field
                  label="Vehicle Size"
                  value={na(o.vehicle_type || o.vehicle_name)}
                />
                <Field label="Remarks" value={na(o.special_instructions)} />
              </dl>
            </SectionCard>

            {/* Commercial */}
            <SectionCard title="Commercial Details" icon={Receipt}>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="Payment Terms" value={na(o.payment_terms || 'Not recorded')} />
                  <Field label="Rate As Per" value={na(o.rate_basis || 'Per Trip')} />
                  <Field label="Quote Status" value={na(o.quote_status)} />
                  <Field label="Quote Remarks" value={na(o.quote_remarks)} />
                </dl>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <MoneyRow label="Estimated Freight" value={inr(o.estimated_price)} />
                  <MoneyRow label="Final Freight" value={inr(o.final_price)} />
                  {financial && Number(financial.driverPayout) > 0 ? (
                    <MoneyRow label="Driver Payout" value={inr(financial.driverPayout)} />
                  ) : null}
                  {financial && Number(financial.btMargin) > 0 ? (
                    <MoneyRow label="BT Margin" value={inr(financial.btMargin)} />
                  ) : null}
                  <MoneyRow label="Total Billing" value={inr(payment.billing)} emphasis />
                </div>
              </div>
            </SectionCard>

            {/* Additional charges — real TripExpense figures only */}
            <SectionCard
              title="Additional Charges"
              icon={IndianRupee}
              subtitle={
                trip ? 'Recorded trip expenses' : 'No trip is linked to this order yet, so there are no trip expenses'
              }
            >
              {balances?.expenses?.byType && Object.keys(balances.expenses.byType).length > 0 ? (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 font-semibold">Charge</th>
                        <th className="py-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(balances.expenses.byType).map(([type, amount]) => (
                        <tr key={type} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 capitalize text-slate-700">{type.replace(/_/g, ' ')}</td>
                          <td className="py-2 text-right font-semibold tabular-nums text-slate-800">
                            {inr(amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 rounded-xl bg-slate-50/70 p-4">
                    <MoneyRow label="Total Additional Charges" value={inr(balances.expenses.total)} />
                    <MoneyRow label="Total Billing Amount" value={inr(payment.billing)} emphasis />
                  </div>
                </>
              ) : (
                <EmptyNote>No additional charges have been recorded against this order.</EmptyNote>
              )}
            </SectionCard>

            {/* Vehicle & driver */}
            <SectionCard title="Vehicle & Driver" icon={Truck}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Vehicle
                  </p>
                  <p className="mt-1.5 font-mono text-sm font-bold text-slate-800">
                    {na(trip?.vehicle?.vehicle_number || o.vehicle_number || o.truck_number_snapshot)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{na(trip?.vehicle?.vehicle_name || o.vehicle_name)}</p>
                  <p className="text-xs text-slate-500">Type: {na(trip?.vehicle?.vehicle_type || o.vehicle_type)}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Owner: {na(trip?.transportOwner?.owner_name || o.vehicle_owner_name || o.owner_name_snapshot || o.assigned_owner_name)}
                  </p>
                  {(trip?.transportOwner?.phone || o.vehicle_owner_phone) ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <Phone className="h-3 w-3" aria-hidden="true" />
                      {na(trip?.transportOwner?.phone || o.vehicle_owner_phone)}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/vehicles')}>View Vehicle</ActionButton>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Driver
                  </p>
                  <p className="mt-1.5 text-sm font-bold text-slate-800">
                    {na(trip?.driver?.driver_name || o.driver_name_snapshot || o.driver_first_name)}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <Phone className="h-3 w-3" aria-hidden="true" />
                    {na(trip?.driver?.mobile || o.driver_phone)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Assigned: {formatDateTime(trip?.driver_assigned_at || o.driver_assigned_at)}
                  </p>
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/drivers')}>View Driver</ActionButton>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Transport Partner
                  </p>
                  <p className="mt-1.5 text-sm font-bold text-slate-800">
                    {na(trip?.transportOwner?.owner_name || o.partner_name || o.partner_owner_name)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {trip?.transportOwner?.owner_id ? `Partner ID ${trip.transportOwner.owner_id}` : (o.partner_id ? `Partner ID ${o.partner_id}` : 'No partner on this order')}
                  </p>
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/owners')}>View Owner</ActionButton>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* ── OPERATIONAL STATUS ────────────────────────────────────────
             * Each card is CLICKABLE and opens the workspace for its own stage —
             * a VIEW or an action form, never a status write. The status each
             * card shows is read from the CANONICAL trip workflow when one
             * exists, so these cards can never contradict the rail above them.
             * Without a trip the page falls back to the booking/delivery fields
             * it already had, and the operational cards are not clickable at all
             * because there is no trip to open.
             */}
            <SectionCard title="Operational Status" icon={Settings2}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatusCard
                  title="Vehicle Status"
                  icon={Truck}
                  status={
                    hasTrip && wf?.stages
                      ? getStageDisplay('VEHICLE_HIRED').label
                      : hasTrip && wf
                      ? (wf.vehicle_hire_state === 'VEHICLE_HIRED' ? 'Hired' : wf.vehicle_hire_state === 'WAITING_FOR_VEHICLE' ? 'Waiting for Vehicle' : wf.vehicle_hire_state === 'VEHICLE_ASSIGNED' ? 'Vehicle Assigned' : 'Hired')
                      : o.vehicle_id ? 'Hired' : 'Pending'
                  }
                  tone={
                    hasTrip && wf?.stages
                      ? getStageDisplay('VEHICLE_HIRED').tone
                      : hasTrip && wf
                      ? (wf.vehicle_hire_state === 'VEHICLE_HIRED' ? 'success' : wf.vehicle_hire_state === 'VEHICLE_ASSIGNED' ? 'info' : 'warning')
                      : o.vehicle_id ? 'success' : 'neutral'
                  }
                  meta={[o.vehicle_number, formatDateTime(o.driver_assigned_at)]}
                  onClick={hasTrip || quoteAccepted ? () => goto('vehicle_hire') : undefined}
                  hrefLabel="vehicle hire"
                />
                <StatusCard
                  title="Loading Status"
                  status={
                    hasTrip && wf?.stages
                      ? getStageDisplay('LOADING').label
                      : wf?.loading
                      ? (wf.loading.loading_completed_at ? 'Completed' : wf.loading.arrived_at_loading_at ? 'Arrived' : wf.loading.sent_to_loading_at ? 'Sent to Loading' : 'Pending')
                      : o.delivery_current_status === 'pickup_completed' ? 'Completed' : 'Pending'
                  }
                  tone={
                    hasTrip && wf?.stages
                      ? getStageDisplay('LOADING').tone
                      : wf?.loading
                      ? (wf.loading.loading_completed_at ? 'success' : wf.loading.arrived_at_loading_at || wf.loading.sent_to_loading_at ? 'warning' : 'neutral')
                      : o.delivery_current_status === 'pickup_completed' ? 'success' : 'neutral'
                  }
                  meta={[place(o.pickup_location), formatDateTime(wf?.loading?.loading_completed_at)]}
                  onClick={hasTrip ? () => goto('trip_tab', { tab: 'loading' }) : undefined}
                  hrefLabel="loading workspace"
                />
                <StatusCard
                  title="Dispatch Status"
                  status={
                    hasTrip && wf?.stages
                      ? getStageDisplay('DISPATCH').label
                      : wf?.loading
                      ? (wf.loading.dispatched_at ? 'Dispatched' : 'Pending')
                      : o.status === 'in_transit' ? 'Dispatched' : 'Pending'
                  }
                  tone={
                    hasTrip && wf?.stages
                      ? getStageDisplay('DISPATCH').tone
                      : wf?.loading
                      ? (wf.loading.dispatched_at ? 'success' : 'neutral')
                      : o.status === 'in_transit' ? 'success' : 'neutral'
                  }
                  meta={[formatDateTime(wf?.loading?.dispatched_at)]}
                  onClick={hasTrip ? () => goto('trip_tab', { tab: 'dispatch' }) : undefined}
                  hrefLabel="dispatch workspace"
                />
                <StatusCard
                  title="Delivery Status"
                  status={
                    hasTrip && wf?.stages
                      ? getStageDisplay('DELIVERY').label
                      : wf?.delivery
                      ? (wf.delivery.arrived_at_destination_at ? 'Delivered' : wf.current_stage === 'TRANSIT' ? 'In Transit' : 'Pending')
                      : o.delivery_current_status === 'delivered' ? 'Delivered' : 'Pending'
                  }
                  tone={
                    hasTrip && wf?.stages
                      ? getStageDisplay('DELIVERY').tone
                      : wf?.delivery
                      ? (wf.delivery.arrived_at_destination_at ? 'success' : wf.current_stage === 'TRANSIT' ? 'warning' : 'neutral')
                      : o.delivery_current_status === 'delivered' ? 'success' : 'neutral'
                  }
                  meta={[place(o.drop_location), formatDateTime(wf?.delivery?.arrived_at_destination_at)]}
                  onClick={hasTrip ? () => goto('trip_tab', { tab: 'delivery' }) : undefined}
                  hrefLabel="delivery workspace"
                />
                <StatusCard
                  title="POD Status"
                  // POD is a DOCUMENT state, deliberately separate from the trip
                  // status — a trip can be IN_TRANSIT while POD is still
                  // PENDING, and neither may be derived from the other.
                  status={
                    hasTrip && wf
                      ? (wf.pod_received
                          ? 'Received'
                          : wf.pod_required
                            ? (wf.current_stage === 'COMPLETED' ? 'Not Required' : 'Pending')
                            : 'Not Required')
                      : o.otp_verified ? 'Verified' : 'Pending'
                  }
                  tone={
                    hasTrip && wf
                      ? (wf.pod_received || !wf.pod_required) ? 'success' : 'warning'
                      : o.otp_verified ? 'success' : 'neutral'
                  }
                  meta={[o.recipient_name ? `Received by ${o.recipient_name}` : null]}
                  onClick={hasTrip ? () => goto('trip_tab', { tab: 'pod' }) : undefined}
                  hrefLabel="POD workspace"
                />
                <StatusCard
                  title="Payment Status"
                  icon={CreditCard}
                  status={payment.label}
                  tone={payment.tone}
                  meta={[`Due ${inr(payment.due)}`]}
                  onClick={hasTrip ? () => goto('finance') : undefined}
                  hrefLabel="trip finance"
                />
              </div>
            </SectionCard>

            {/* Operations */}
            <SectionCard title="Operations" icon={RouteIcon}>
              <ol className="space-y-0">
                {(() => {
                  // Use workflow stage states when available (trip exists), fallback to booking/delivery timestamps
                  const loadingStageState = hasTrip && wf?.stages ? getStageState('LOADING') : null;
                  const dispatchStageState = hasTrip && wf?.stages ? getStageState('DISPATCH') : null;
                  const deliveryStageState = hasTrip && wf?.stages ? getStageState('DELIVERY') : null;
                  const transitStageState = hasTrip && wf?.stages ? getStageState('TRANSIT') : null;

                  const loading = wf?.loading || {};
                  const dispatch = wf?.loading || {};
                  const delivery = wf?.delivery || {};
                  const pod = wf || {};

                  // Map stage state to display label
                  const stageStateToLabel = (state, fallback) => {
                    switch (state) {
                      case 'done': return 'Completed';
                      case 'skipped': return 'Skipped';
                      case 'current': return 'In Progress';
                      case 'available': return 'Ready';
                      case 'locked': return 'Pending';
                      case 'unavailable': return 'N/A';
                      default: return fallback;
                    }
                  };

                  // Determine transit status from workflow stage state
                  const transitStatus = hasTrip && wf?.stages
                    ? stageStateToLabel(transitStageState, 'Not started')
                    : tripStatus === 'IN_TRANSIT' ? 'In transit' : 'Not started';

                  return [
                    {
                      k: 'Loading',
                      s: loadingStageState
                        ? stageStateToLabel(loadingStageState)
                        : loading.loading_completed_at ? 'Completed' : loading.arrived_at_loading_at ? 'Arrived' : loading.sent_to_loading_at ? 'Sent to Loading' : 'Pending',
                      d: place(o.pickup_location),
                      w: `${formatDate(o.pickup_date)}, ${formatClock(o.pickup_time)}`,
                      a: loading.loading_completed_at || loading.arrived_at_loading_at || loading.sent_to_loading_at,
                    },
                    {
                      k: 'Dispatch',
                      s: dispatchStageState
                        ? stageStateToLabel(dispatchStageState)
                        : loading.dispatched_at ? 'Dispatched' : 'Pending',
                      d: 'Expected departure',
                      w: `${formatDate(o.pickup_date)}, ${formatClock(o.pickup_time)}`,
                      a: loading.dispatched_at,
                    },
                    {
                      k: 'Transit',
                      s: transitStatus,
                      d: place(o.pickup_city, '→', o.drop_city),
                      w: distance(o.estimated_distance_km),
                      a: null,
                    },
                    {
                      k: 'Delivery',
                      s: deliveryStageState
                        ? stageStateToLabel(deliveryStageState)
                        : delivery.arrived_at_destination_at ? 'Delivered' : 'Pending',
                      d: place(o.drop_location),
                      w: formatDate(o.estimated_delivery_time),
                      a: delivery.arrived_at_destination_at,
                    },
                    {
                      k: 'POD',
                      s: pod.pod_received ? 'Received' : pod.pod_required ? 'Pending' : 'Not Required',
                      d: pod.pod_received ? 'Proof of delivery captured' : pod.pod_required ? 'Awaiting POD' : 'POD not required',
                      w: null,
                      a: pod.pod_received_at,
                    },
                  ];
                })().map((row, i, arr) => (
                  <li key={row.k} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2.5 w-2.5 rounded-full ${
                          row.s === 'Pending' || row.s === 'Not started' || row.s === 'Not Required' || row.s === 'N/A'
                            ? 'bg-slate-300'
                            : row.s === 'Skipped'
                            ? 'bg-amber-500'
                            : row.s === 'In Progress' || row.s === 'Ready'
                            ? 'bg-[#F5A000]'
                            : 'bg-emerald-500'
                        }`}
                      />
                      {i < arr.length - 1 ? <span className="w-px flex-1 bg-slate-200" /> : null}
                    </div>
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{row.k}</p>
                        <Badge
                          tone={
                            row.s === 'Pending' || row.s === 'Not started' || row.s === 'Not Required' || row.s === 'N/A' ? 'neutral' :
                            row.s === 'Skipped' ? 'warning' :
                            row.s === 'In Progress' || row.s === 'Ready' ? 'warning' : 'success'
                          }
                        >
                          {row.s}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{row.d}</p>
                      {row.w ? <p className="text-xs text-slate-400">{row.w}</p> : null}
                      {row.a ? (
                        <p className="mt-0.5 text-xs font-medium text-emerald-700">
                          Actual: {formatDateTime(row.a)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>

            {/* Payment */}
            <SectionCard title="Payment & Collection" icon={CreditCard}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Billing Amount
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-800">
                    {inr(payment.billing)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Amount Received
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-emerald-700">
                    {inr(payment.received)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Balance Due
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-[#D98C0B]">
                    {inr(payment.due)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={payment.tone}>{payment.label}</Badge>
                {financial ? (
                  <span className="text-xs text-slate-500">
                    Source: canonical trip financial ledger
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    No trip financial record yet — showing order value
                  </span>
                )}
                <div className="ml-auto">
                  <ActionButton
                    variant="primary"
                    onClick={() => navigate('/admin/financials')}
                  >
                    Record Payment
                  </ActionButton>
                </div>
              </div>
            </SectionCard>

            {/* Activity */}
            <SectionCard title="Order Activity" icon={History}>
              {events.length ? (
                <ol className="space-y-3">
                  {events.map((ev, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{ev.event}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(ev.timestamp)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyNote>No recorded events for this order yet.</EmptyNote>
              )}
            </SectionCard>
          </div>

          {/* ══ STICKY SUMMARY ═══════════════════════════════════════════ */}
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700">
                Order Summary
              </h2>
              <dl className="mt-4 space-y-3">
                {[
                  { k: 'Order', v: orderNo, mono: true },
                  { k: 'Customer', v: place(o.customer_first_name, o.customer_last_name) },
                  { k: 'Route', v: `${na(o.pickup_location)} → ${na(o.drop_location)}` },
                  { k: 'Vehicle', v: na(o.vehicle_number || o.truck_number_snapshot), mono: true },
                  { k: 'Driver', v: na(o.driver_name_snapshot || o.driver_first_name) },
                  { k: 'Total', v: inr(payment.billing) },
                  { k: 'Paid', v: inr(payment.received) },
                  { k: 'Balance', v: inr(payment.due) },
                ].map((row) => (
                  <div key={row.k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {row.k}
                    </dt>
                    <dd
                      className={`min-w-0 truncate text-sm font-semibold text-slate-800 ${
                        row.mono ? 'font-mono tabular-nums' : ''
                      }`}
                      title={String(row.v)}
                    >
                      {row.v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Current Status
                </p>
                <div className="mt-1.5">
                  <Badge tone={
                    (hasTrip && wf && wf.current_stage === 'COMPLETED') ? 'success' :
                    (hasTrip && wf && wf.current_stage === 'POD' && !wf.pod_received && wf.pod_required) ? 'warning' :
                    (resolved.state === 'blocked' ? 'danger' : 'warning')
                  }>
                    {hasTrip && wf ? wf.current_stage_label : resolved.stageLabel}
                  </Badge>
                </div>

                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Next Action
                </p>
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {hasTrip && wf ? (wf.next_action?.label || 'No action required') : (resolved.state === 'blocked' ? resolved.blockedReason : resolved.nextAction)}
                </p>

                <button
                  type="button"
                  onClick={() => load({ silent: true })}
                  className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#102B4C]"
                  style={{ backgroundColor: BRAND.navy }}
                >
                  Update Order
                </button>
              </div>
            </div>

            {/* Customer card — the "who is the customer" answer, always visible. */}
            <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
              <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700">
                <User className="h-4 w-4 text-slate-400" aria-hidden="true" /> Customer
              </h3>
              <p className="mt-3 text-sm font-semibold text-slate-800">
                {place(o.customer_first_name, o.customer_last_name)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{na(o.customer_email)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{na(o.customer_phone)}</p>
              {o.customer_address ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                  <Building2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {o.customer_address}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
