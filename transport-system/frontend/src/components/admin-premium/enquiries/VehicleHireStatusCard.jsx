/**
 * VehicleHireStatusCard.jsx
 * ---------------------------------------------------------------------------
 * The "VEHICLE & DRIVER" block inside the Enquiry workspace.
 *
 * THE NEW OPERATIONAL ORDER
 *   A vehicle and driver are now reserved BEFORE the quote is finalised:
 *
 *     ENQUIRY → ASSIGN VEHICLE & DRIVER → FINALISE & SEND QUOTE → CUSTOMER ACCEPTS
 *
 *   So the card is no longer a passive "waiting for vehicle" notice. When
 *   nothing is engaged it offers ONE action that provisions the consignment's
 *   operational trip if it has none and then drops the operator into the
 *   Universal Vehicle Hire workspace to pick resources. The customer therefore
 *   receives the price, the vehicle and the driver TOGETHER, and never has to be
 *   told to wait after accepting.
 *
 * IT IS STILL NOT A HIRING FORM
 *   There is deliberately NO <select>, NO <input> and NO hire POST call in this
 *   file. Vehicle, driver, owner/vendor, billing model, contract/commission,
 *   hire amount and "Complete Vehicle Hire" all belong to /admin/trips/:tripId/vehicle-hire.
 *   What lives here is a status, a summary and navigation.
 *
 * PROVISIONING IS DONE BY THE SERVER, NEVER BY REACT
 *   The card POSTs to `POST /api/vehicle-hire/provision { enquiry_id }`, which
 *   runs the existing `TripProvisioningService` — idempotent, transaction-safe
 *   and duplicate-safe in the database itself (a partial UNIQUE index on
 *   trips.enquiry_id). The browser never creates a Trip row; it only asks for
 *   "the one trip for this enquiry" and navigates to wherever that turns out to
 *   be. If the trip already existed, nothing is provisioned and the trip id is
 *   simply returned.
 *
 * ITS DATA IS ONE BACKEND READ
 *   `GET /api/vehicle-hire/assignment?booking_id=|enquiry_id=` resolves through
 *   `TripVehicleAssignmentService`, the single assignment writer, to the same
 *   Trip row the Vehicle Hire page reads. So a reservation made here and a hire
 *   made there can never disagree.
 *
 * IT COMPUTES NO MONEY
 *   Gross hire / commission / net payable, when a hire exists, are displayed
 *   exactly as the Vehicle Hire workflow stored them. A customer Final Quote is a
 *   different financial concept and is never shown here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Pencil, Truck } from 'lucide-react';

import { vehicleHireAPI } from '../../../services/vehicleHireAPI';
import { apiErrorMessage, inr } from './enquiryStatus';
import {
  HIRE_STATE,
  HANDOFF_STAGE,
  describeHireAssignment,
  handoffStage,
  hireRouteFor,
} from './hireHandoff';

/** Icon + chrome per resource state. Presentation only. */
const TONE = {
  waiting: { Icon: Clock, className: 'border-amber-300 bg-amber-50 text-amber-800' },
  assigned: { Icon: Truck, className: 'border-sky-300 bg-sky-50 text-sky-800' },
  hired: { Icon: CheckCircle2, className: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  unknown: { Icon: Clock, className: 'border-border bg-slate-50 text-text' },
};

/** The shell every state renders inside, so the card keeps one footprint. */
function Card({ children, className = 'rounded-lg border border-border bg-slate-50/70 p-3' }) {
  return <div className={`mb-4 ${className}`}>{children}</div>;
}

/** Small label/value pair used in the summary grids. */
function Fact({ label, value, strong = false }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`truncate ${strong ? 'font-semibold text-text' : 'text-text'}`}>{value}</p>
    </div>
  );
}

/**
 * THE PRESENTATION HALF — separated from the fetch so it can be rendered and
 * asserted on directly, with no effects, no router and no network.
 *
 * @param {object} props
 * @param {object|null} props.assignment   one `vehicle-hire/assignment` payload
 * @param {string|null} [props.enquiryStatus] the enquiry's own status
 * @param {string|null} [props.enquiryId]   used to provision on demand
 * @param {string|null} [props.quoteLabel]  the final quote, for the sent stage
 * @param {boolean} [props.provisioning]   a provision request is in flight
 * @param {(route:string)=>void} props.onOpenHire
 * @param {()=>void} props.onAssignVehicleAndDriver  provisions, then navigates
 * @param {()=>void} [props.onRefresh]
 */
export function VehicleHireHandoffCard({
  assignment,
  enquiryStatus = null,
  enquiryId = null,
  quoteLabel = null,
  pickup = null,
  drop = null,
  customerOfferUrl = null,
  tripUrl = null,
  provisioning = false,
  onOpenHire,
  onAssignVehicleAndDriver,
  onRefresh,
}) {
  const view = describeHireAssignment(assignment);
  const stage = handoffStage({ assignment, enquiryStatus });
  const { Icon, className } = TONE[view.tone] || TONE.unknown;

  // THE OPERATIONAL WORD for each stage, which is what the operator reads:
  //   nothing engaged  → WAITING FOR VEHICLE
  //   resources held   → RESERVED
  //   quote with them  → READY FOR CUSTOMER
  //   customer agreed  → CONFIRMED
  const badge =
    stage === HANDOFF_STAGE.CONFIRMED
      ? { label: 'Confirmed', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 }
      : stage === HANDOFF_STAGE.QUOTE_SENT
        ? { label: 'Ready for Customer', className: 'border-violet-300 bg-violet-50 text-violet-800', Icon: CheckCircle2 }
        : stage === HANDOFF_STAGE.RESOURCES_READY
          ? { label: 'Reserved', className: 'border-emerald-300 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 }
          : { label: view.stateLabel, className, Icon };

  const BadgeIcon = badge.Icon;

  // ── STATE 1: nothing engaged. This is the action that changes the workflow.
  if (stage === HANDOFF_STAGE.NEED_RESOURCES) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
            Vehicle & Driver
          </p>
          <span
            data-hire-state={view.state || 'UNKNOWN'}
            data-handoff-stage={stage}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${badge.className}`}
          >
            <BadgeIcon size={12} />
            {badge.label}
          </span>
        </div>

        <p className="mt-2 text-[12.5px] leading-relaxed text-text">
          Assign an available vehicle and driver before sending the final quote.
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          The customer then receives the price, the vehicle and the driver together — and never has to
          wait for an assignment after accepting.
        </p>

        <div className="mt-2.5">
          <button
            type="button"
            data-testid="assign-vehicle-and-driver"
            onClick={onAssignVehicleAndDriver}
            disabled={provisioning}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
          >
            <Truck size={13} />
            {provisioning ? 'Preparing the workspace…' : 'Assign Vehicle & Driver'}
          </button>
        </div>
      </Card>
    );
  }

  // ── STATES 2-4: resources are engaged, so show WHAT was reserved.
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
          Vehicle & Driver
        </p>
        <span
          data-hire-state={view.state || 'UNKNOWN'}
          data-handoff-stage={stage}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${badge.className}`}
        >
          <BadgeIcon size={12} />
          {badge.label}
        </span>
      </div>

      <p className="mt-1 text-[11.5px] text-muted">
        Trip <span className="font-mono">{view.tripNumber || '—'}</span>
      </p>

      {/* ── WHAT THE CUSTOMER WAS OFFERED — read from the one server read ─── */}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
        <Fact label="Vehicle" value={view.vehicle} strong />
        <Fact label="Driver" value={view.driver} />
        <Fact label="Owner" value={view.vendor} />
        {stage === HANDOFF_STAGE.RESOURCES_READY
          ? <Fact label="Customer approval" value="Pending" />
          : <Fact label="Final Quote" value={quoteLabel || '—'} />}
        {pickup ? <Fact label="Pickup" value={pickup} /> : null}
        {drop ? <Fact label="Drop" value={drop} /> : null}
      </dl>

      {/* ── WHAT HAPPENS NEXT, in the operator's words ─────────────────────── */}
      <p className="mt-2 text-[12px] leading-relaxed text-text">
        {stage === HANDOFF_STAGE.RESOURCES_READY
          ? 'Reserved for this enquiry. Finalise the quote — vehicle and driver will be sent to the customer together.'
          : stage === HANDOFF_STAGE.QUOTE_SENT
            ? 'Vehicle and quote were sent together to the customer. Waiting for their decision.'
            : 'The customer accepted with this vehicle and driver. Send the vehicle to loading.'}
      </p>

      {stage === HANDOFF_STAGE.CONFIRMED ? (
        <p className="mt-1 text-[12.5px] font-semibold text-emerald-800">
          Next: Send / Schedule Vehicle for Loading
        </p>
      ) : null}

      {/* ── HIRE MONEY — READ-BACK ONLY, and only once a hire exists ─────────
          Shown exactly as the Vehicle Hire workflow stored it. This page does
          not compute a gross, a commission or a net payable. */}
      {view.hire ? (
        <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-1 rounded-md border border-border bg-white px-2.5 py-2 text-[12.5px]">
          <Fact label="Gross hire" value={inr(view.hire.gross_hire)} />
          <Fact label="Commission" value={`−${inr(view.hire.commission_amount)}`} />
          <Fact label="Net payable" value={inr(view.hire.net_vendor_payable)} />
        </dl>
      ) : null}

      {/* ── ACTIONS ──────────────────────────────────────────────────────────
          Navigation into the ONE hiring workspace — but ONLY when a Trip
          actually exists. `hireRouteFor` returns null before acceptance, and a
          Trip-scoped link would be a dead end (`/admin/trips//vehicle` →
          `/admin/trips/vehicle` → HTTP 400 "Invalid trip ID"). When there is no
          Trip the operator is told so plainly instead of being sent to a page
          that cannot exist. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {view.route ? (
          <button
            type="button"
            data-testid="open-vehicle-hire"
            onClick={() => onOpenHire(view.route)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-amber-700"
          >
            {view.isHired ? <ExternalLink size={13} /> : <Truck size={13} />}
            Open Vehicle Hire
          </button>
        ) : (
          <p
            data-testid="no-trip-yet"
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800"
          >
            No trip yet — Vehicle & Driver are reserved for this enquiry and become a
            confirmed hire only after the customer accepts.
          </p>
        )}

        {stage === HANDOFF_STAGE.RESOURCES_READY && view.route ? (
          <button
            type="button"
            data-testid="change-assignment"
            onClick={() => onOpenHire(view.route)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-100"
          >
            <Pencil size={12} />
            Change Assignment
          </button>
        ) : null}

        {/* What the CUSTOMER was actually sent, and where the truck now is. Both
            navigate to EXISTING screens; neither introduces a workflow. */}
        {stage === HANDOFF_STAGE.QUOTE_SENT && customerOfferUrl ? (
          <a
            href={customerOfferUrl}
            data-testid="view-customer-offer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-100"
          >
            View Customer Offer
          </a>
        ) : null}

        {stage === HANDOFF_STAGE.CONFIRMED && tripUrl ? (
          <a
            href={tripUrl}
            data-testid="open-trip"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-100"
          >
            Open Trip
          </a>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * THE DATA HALF — reads the canonical assignment once and renders the handoff.
 *
 * `onChanged` lets a parent ask for a re-read after it changes an assignment
 * somewhere else. It is the only escape hatch, and it still cannot write one
 * from this page.
 */
export default function VehicleHireStatusCard({
  bookingId,
  enquiryId,
  enquiryStatus = null,
  quoteLabel = null,
  pickup = null,
  drop = null,
  customerOfferUrl = null,
  tripUrl = null,
  assignment: assignmentProp = undefined,
  onChanged,
}) {
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState(assignmentProp ?? null);
  const [loading, setLoading] = useState(assignmentProp === undefined);
  const [error, setError] = useState(null);
  const [provisioning, setProvisioning] = useState(false);
  const [actionError, setActionError] = useState(null);

  // A parent that already holds the canonical assignment (the Enquiry page does,
  // because it also needs it to gate the quote) passes it in. Then this card
  // performs NO fetch of its own: ONE backend read per page, not two, and no
  // chance of the two copies disagreeing.
  const ownsFetch = assignmentProp === undefined;

  // Adopt a parent's assignment whenever it changes.
  useEffect(() => {
    if (assignmentProp !== undefined) setAssignment(assignmentProp ?? null);
  }, [assignmentProp]);

  /**
   * Read the canonical state. Re-runs whenever the order changes, and can be
   * re-run by the parent, so the card always reflects the same assignment the
   * Vehicle Hire page would show.
   */
  const load = useCallback(async () => {
    if (!bookingId && !enquiryId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await vehicleHireAPI.getAssignmentByBooking({
        booking_id: bookingId || undefined,
        enquiry_id: enquiryId || undefined,
      });
      setAssignment(res?.data?.data || null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to load the vehicle hire state.'));
    } finally {
      setLoading(false);
    }
  }, [bookingId, enquiryId]);

  useEffect(() => {
    if (ownsFetch) load();
  }, [load, ownsFetch]);

  // Expose a refresh so the parent can re-read after changing an assignment.
  useEffect(() => {
    if (typeof onChanged === 'function') onChanged(load);
  }, [onChanged, load]);

  /**
   * "ASSIGN VEHICLE & DRIVER".
   *
   * The server creates the consignment's ONE operational trip if it has none —
   * idempotent and duplicate-safe — and returns its id. React then navigates to
   * the Universal Vehicle Hire screen for that trip. No trip is ever created in
   * the browser, and no assignment is made here.
   */
  const assignVehicleAndDriver = useCallback(async () => {
    setProvisioning(true);
    setActionError(null);
    try {
      const ref = enquiryId
        ? { enquiry_id: enquiryId }
        : { booking_id: bookingId };
      const res = await vehicleHireAPI.provision(ref);
      const tripId = res?.data?.data?.trip?.trip_id ?? null;
      if (!tripId) {
        throw new Error('The server did not return a trip for this enquiry. Please try again.');
      }
      // `hireRouteFor` returns null for anything that is not a real trip id.
      // Navigating to null would silently do nothing while looking like success,
      // so the refusal is explicit instead.
      const route = hireRouteFor(tripId);
      if (!route) {
        throw new Error('The Vehicle Hire workspace is not available for this consignment yet.');
      }
      navigate(route);
    } catch (err) {
      setActionError(apiErrorMessage(err, 'Unable to open the Vehicle Hire workspace.'));
    } finally {
      setProvisioning(false);
    }
  }, [bookingId, enquiryId, navigate]);

  // Only the self-fetching variant ever waits; a parent-supplied assignment is
  // already resolved by the time this renders.
  if (loading && ownsFetch) {
    return (
      <Card>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
          Vehicle & Driver
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted">Loading assignment…</p>
      </Card>
    );
  }

  return (
    <>
      {actionError ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-[12px] font-semibold text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {actionError}
          </p>
        </div>
      ) : null}
      <VehicleHireHandoffCard
        assignment={assignment}
        enquiryStatus={enquiryStatus}
        enquiryId={enquiryId}
        quoteLabel={quoteLabel}
        pickup={pickup}
        drop={drop}
        customerOfferUrl={customerOfferUrl}
        tripUrl={tripUrl}
        provisioning={provisioning}
        onOpenHire={(route) => navigate(route)}
        onAssignVehicleAndDriver={assignVehicleAndDriver}
      />
      {error ? (
        <p className="-mt-2 mb-4 text-[11.5px] text-amber-700">{error}</p>
      ) : null}
    </>
  );
}

/* Re-exported so callers can branch on the same constants the card renders
   against, without importing a second copy of the truth. */
export { HIRE_STATE };
