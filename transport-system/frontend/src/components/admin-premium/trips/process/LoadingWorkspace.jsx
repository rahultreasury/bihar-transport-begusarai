/**
 * LoadingWorkspace.jsx — the LOADING stage, as the four real operational steps.
 * ============================================================================
 *
 * WHAT WAS BROKEN, AND WHY IT LOOKED FINE
 *   This screen used to branch on one boolean, `started`, which came from
 *   `describeProcessState({ processKey: 'loading' })`. That helper answers
 *   "is the LOADING stage COMPLETE?" — not "is the next loading action
 *   available?". Those are different questions, and using one for the other is
 *   what produced this symptom:
 *
 *       trip.status = AT_LOADING_POINT  →  stage LOADING is CURRENT, not DONE
 *                                      →  started === false
 *                                      →  the page rendered "LOADING NOT STARTED"
 *                                      →  [ Mark as Loaded ] was never rendered
 *
 *   A trip that has physically arrived at the loading point was told it had not
 *   started loading, and the one control that could move it forward was missing
 *   from the page entirely.
 *
 *   Loading is not a boolean. It is FOUR steps, and which one you may press is a
 *   function of the ONE authoritative operational status — `Trip.status`, the
 *   existing `TripStatus` enum. So the screen now derives its action from that
 *   status directly (see LOADING_STEP below) and nothing else.
 *
 * ONE SOURCE OF TRUTH (§15)
 *   There is no `loadingStatus`, no local status of its own, and no second copy
 *   of the trip. Every fact on this screen is read from the `trip` row that
 *   `GET /api/trips/:id` returned, which is the same row the Dispatch workspace,
 *   the Trip Overview and the movement history all read. The trip row is FLAT —
 *   `loading_completed_at`, `actual_quantity` and friends are columns ON the
 *   trip, not a nested `trip.loading` object — and this screen reads them from
 *   where they actually are.
 *
 * EVERY BUTTON PERFORMS A REAL TRANSITION
 *   [Send to Loading]  POST /api/trips/:id/loading/send      ASSIGNED → TO_LOADING_POINT
 *   [Mark Arrived]     POST /api/trips/:id/loading/arrive    TO_LOADING_POINT → AT_LOADING_POINT
 *   [Mark as Loaded]   POST /api/trips/:id/loading/complete  AT_LOADING_POINT → LOADED
 *
 *   All three are `protect` + `adminOnly`, are validated server-side against the
 *   CURRENT status, and write the Trip update, the movement-history event and
 *   the audit entry inside ONE transaction. A double click is safe: the backend
 *   is idempotent by target state and writes no second history entry.
 *
 * LOADING AND DOCUMENTS ARE SEPARATE (§9 of the workflow document)
 *   "Bill received" is NOT a status. A trip may be LOADED with papers still
 *   outstanding; that combination is `LOADED + documents missing`, which the
 *   Dispatch readiness report itemises separately. Nothing on this screen blocks
 *   loading on a document, and nothing on the Dispatch screen treats loading as
 *   a substitute for one.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, PackageCheck, Truck } from 'lucide-react';

import { Panel, FactGrid, Action, Blocked } from './TripProcessShell';
import { ConfirmModal, ConfirmRow, Notice, cx, fmtDate, inr } from './dispatchAtoms';

/**
 * THE LOADING STATE MACHINE — one entry per TripStatus, derived from the ONE
 * authoritative status column. The backend enforces exactly the same edges
 * (`utils/TripStateMachine.js`); this table only decides which button to draw,
 * and the server still has the final word.
 */
const LOADING_STEP = Object.freeze({
  PENDING: {
    state: 'waiting',
    headline: 'WAITING FOR A VEHICLE',
    detail: 'This consignment has no vehicle hired yet, so there is nothing to send to the loading point.',
    action: null,
  },
  ASSIGNED: {
    state: 'ready',
    headline: 'READY TO GO TO THE LOADING POINT',
    detail: 'The vehicle is hired. Send it to the loading point to begin.',
    action: 'SEND_TO_LOADING',
  },
  TO_LOADING_POINT: {
    state: 'in_progress',
    headline: 'VEHICLE ON THE WAY TO THE LOADING POINT',
    detail: 'Mark the vehicle as arrived once it is physically at the loading point.',
    action: 'ARRIVE_LOADING',
  },
  AT_LOADING_POINT: {
    state: 'arrived',
    headline: 'AT LOADING POINT — WAITING FOR LOADING',
    detail: 'The vehicle is at the loading point. Record what actually went on, then mark it as loaded.',
    action: 'MARK_LOADED',
  },
  LOADED: {
    state: 'completed',
    headline: 'LOADED / WAITING FOR DISPATCH',
    detail: 'Loading is complete. The consignment is now ready for the dispatch workspace.',
    action: null,
  },
  DISPATCHED: {
    state: 'past',
    headline: 'DISPATCHED',
    detail: 'The vehicle has left the loading point.',
    action: null,
  },
  IN_TRANSIT: { state: 'past', headline: 'IN TRANSIT', detail: 'This load is on the road.', action: null },
  DELIVERED: { state: 'past', headline: 'DELIVERED', detail: 'This load has been delivered.', action: null },
  COMPLETED: { state: 'past', headline: 'COMPLETED', detail: 'This consignment is closed.', action: null },
  CANCELLED: {
    state: 'cancelled',
    headline: 'CANCELLED',
    detail: 'This consignment has been cancelled, so no loading action is available.',
    action: null,
  },
});

/** The document checklist uses these labels; keep them in one place. */
const DOCUMENT_LABEL = {
  LR: 'LR / GR',
  GR: 'LR / GR',
  INVOICE: 'Party Invoice / Bill',
  E_WAY_BILL: 'E-Way Bill',
  INSURANCE: 'Insurance Certificate',
  PERMIT: 'Permit',
  FITNESS: 'Fitness Certificate',
  RC: 'RC',
  POD: 'Proof of Delivery',
  OTHER: 'Other Document',
};

export default function LoadingWorkspace({ tripId, trip, ops, busy, onRun, documents }) {
  const status = String(trip?.status || 'PENDING').toUpperCase();
  const step = LOADING_STEP[status] || LOADING_STEP.PENDING;

  const [qty, setQty] = useState('');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loadedBy, setLoadedBy] = useState('');
  const [confirmLoaded, setConfirmLoaded] = useState(false);

  // Seed the inputs from the SERVER row, and re-seed whenever it changes, so a
  // save that comes back from the backend replaces what was typed with what was
  // actually persisted. The trip row is FLAT — there is no `trip.loading`.
  useEffect(() => {
    if (trip?.actual_quantity != null) setQty(String(trip.actual_quantity));
    if (trip?.actual_weight_kg != null) setWeight(String(trip.actual_weight_kg));
    if (trip?.actual_quantity_unit) setUnit(trip.actual_quantity_unit);
    if (trip?.loading_remarks) setRemarks(trip.loading_remarks);
    if (trip?.loaded_by) setLoadedBy(trip.loaded_by);
  }, [trip?.actual_quantity, trip?.actual_weight_kg, trip?.actual_quantity_unit, trip?.loading_remarks, trip?.loaded_by]);

  const vehicleAssigned = Boolean(trip?.vehicle_id || trip?.vehicle);
  const driverAssigned = Boolean(trip?.driver_id || trip?.driver);

  /** Only the fields the operator actually filled in are sent. */
  const facts = {
    actual_quantity: qty === '' ? undefined : Number(qty),
    actual_weight_kg: weight === '' ? undefined : Number(weight),
    actual_quantity_unit: unit || undefined,
    loading_remarks: remarks || undefined,
    loaded_by: loadedBy || undefined,
  };

  const busyKey = step.action === 'SEND_TO_LOADING'
    ? 'loading/send'
    : step.action === 'ARRIVE_LOADING' ? 'loading/arrive' : 'loading/complete';

  const planned = trip?.booking || {};
  const loadingPoint = [trip?.pickup_location, trip?.pickup_city].filter(Boolean).join(', ');

  const run = (name, fn) => onRun(name, fn);

  return (
    <>
      {/* ══ THE STATE, STATED PLAINLY ════════════════════════════════════ */}
      <Panel title="Loading Status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={cx(
              'text-[15px] font-bold uppercase tracking-wide',
              step.state === 'completed' || step.state === 'past' ? 'text-emerald-700' : 'text-amber-700',
            )}
            >
              {step.headline}
            </p>
            <p className="mt-1 max-w-xl text-[12.5px] text-muted">{step.detail}</p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Current Trip Status</p>
            <p className="font-mono text-[14px] font-bold text-text">{status.replace(/_/g, ' ')}</p>
          </div>
        </div>
      </Panel>

      {/* ══ PREREQUISITES — stated as facts, not as a blocker ════════════ */}
      <Panel title="Prerequisites">
        <FactGrid
          items={[
            { label: 'Vehicle Assigned', value: trip?.vehicle?.vehicle_number || trip?.vehicle_number || (vehicleAssigned ? 'Yes' : 'No') },
            { label: 'Driver Assigned', value: trip?.driver?.driver_name || (driverAssigned ? 'Yes' : 'No') },
            { label: 'Trip Number', value: trip?.trip_number },
            { label: 'Loading Location', value: loadingPoint || '—' },
            { label: 'Sent To Loading', value: fmtDate(trip?.sent_to_loading_at, true) },
            { label: 'Arrived At Loading', value: fmtDate(trip?.arrived_at_loading_at, true) },
          ]}
        />
      </Panel>

      {/* ══ LOADING INFORMATION ═════════════════════════════════════════ */}
      {step.action === 'MARK_LOADED' || step.state === 'completed' || step.state === 'past' ? (
        <Panel title="Loading Information" subtitle="What actually went on the vehicle">
          <FactGrid
            items={[
              { label: 'Loading Completed', value: fmtDate(trip?.loading_completed_at, true) },
              {
                label: 'Actual Quantity',
                value: trip?.actual_quantity != null
                  ? `${trip.actual_quantity} ${trip.actual_quantity_unit || ''}`.trim()
                  : null,
              },
              { label: 'Actual Weight', value: trip?.actual_weight_kg != null ? `${trip.actual_weight_kg} kg` : null },
              { label: 'Loaded By', value: trip?.loaded_by },
              { label: 'Loading Remarks', value: trip?.loading_remarks },
              {
                label: 'Planned Quantity',
                value: planned.number_of_items ? `${planned.number_of_items} ${planned.quantity_unit || ''}`.trim() : null,
              },
              { label: 'Planned Weight', value: planned.goods_weight_kg ? `${planned.goods_weight_kg} kg` : null },
              { label: 'Freight', value: trip?.freight_amount != null ? inr(trip.freight_amount) : null },
            ]}
          />
        </Panel>
      ) : null}

      {/* ══ THE ONE ACTION THE CURRENT STATUS PERMITS ═══════════════════ */}
      <Panel title="Actions">
        {!vehicleAssigned && ['PENDING', 'ASSIGNED'].includes(status) ? (
          <Blocked reason="A vehicle must be assigned before it can be sent to the loading point." />
        ) : null}

        {step.state === 'waiting' ? (
          <Notice tone="warn" title="Waiting for a vehicle">
            This consignment has no vehicle hired yet. Hire one from the Vehicle Hire workspace, and this
            page will offer [ Send to Loading ].
          </Notice>
        ) : null}

        {step.state === 'cancelled' ? (
          <Notice tone="danger" title="Consignment cancelled">
            No loading action is available for a cancelled consignment.
          </Notice>
        ) : null}

        {step.action === 'SEND_TO_LOADING' ? (
          <>
            <Action
              disabled={!vehicleAssigned || busy === 'loading/send'}
              busy={busy === 'loading/send'}
              onClick={() => run('loading/send', () => ops.sendToLoading(trip.trip_id, {}))}
            >
              SEND TO LOADING
            </Action>
            <p className="mt-2 text-[12px] text-muted">
              Moves the trip ASSIGNED → TO_LOADING_POINT and writes its own movement-history entry.
            </p>
          </>
        ) : null}

        {step.action === 'ARRIVE_LOADING' ? (
          <>
            <Action
              disabled={busy === 'loading/arrive'}
              busy={busy === 'loading/arrive'}
              onClick={() => run('loading/arrive', () => ops.arriveAtLoading(trip.trip_id, {}))}
            >
              MARK ARRIVED AT LOADING
            </Action>
            <p className="mt-2 text-[12px] text-muted">
              Moves the trip TO_LOADING_POINT → AT_LOADING_POINT and writes its own movement-history entry.
            </p>
          </>
        ) : null}

        {step.action === 'MARK_LOADED' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-[12px] font-semibold text-text">
                Actual Quantity
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={trip?.actual_quantity ?? ''}
                  className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
                />
              </label>
              <label className="block text-[12px] font-semibold text-text">
                Quantity Unit
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Bags"
                  className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
                />
              </label>
              <label className="block text-[12px] font-semibold text-text">
                Actual Weight (kg)
                <input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder={trip?.actual_weight_kg ?? ''}
                  className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
                />
              </label>
              <label className="block text-[12px] font-semibold text-text">
                Loaded By
                <input
                  value={loadedBy}
                  onChange={(e) => setLoadedBy(e.target.value)}
                  placeholder="Name of the loader"
                  className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
                />
              </label>
              <label className="block text-[12px] font-semibold text-text sm:col-span-2">
                Loading Remarks
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="How the load was secured, condition, count…"
                  className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Action
                tone="ghost"
                busy={busy === 'loading/facts'}
                onClick={() => run('loading/facts', () => ops.saveLoadingFacts(trip.trip_id, facts))}
              >
                Save Loading Facts
              </Action>
              {/* Opening the modal does NOT transition anything. */}
              <Action busy={busy === busyKey} onClick={() => setConfirmLoaded(true)}>
                MARK AS LOADED
              </Action>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              Saving facts records the numbers without changing the status. Mark as Loaded moves the trip
              AT_LOADING_POINT → LOADED and writes the movement-history entry automatically.
            </p>
          </>
        ) : null}

        {step.state === 'completed' ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5">
              <Check size={16} className="text-emerald-700" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-bold uppercase tracking-wide text-emerald-800">Loading completed</p>
                <p className="text-[12px] text-emerald-900">
                  Loading finished {fmtDate(trip?.loading_completed_at, true)}. The consignment is waiting for
                  dispatch.
                </p>
              </div>
            </div>
            <Link
              to={`/admin/trips/${tripId}/dispatch`}
              className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            >
              GO TO DISPATCH <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <p className="mt-2 text-[12px] text-muted">
              Loaded does not automatically mean dispatch-ready: the dispatch workspace checks the paperwork
              separately and will list anything still outstanding.
            </p>
          </>
        ) : null}

        {step.state === 'past' ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5">
            <PackageCheck size={16} className="text-emerald-700" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-bold uppercase tracking-wide text-emerald-800">{step.headline}</p>
              <p className="text-[12px] text-emerald-900">{step.detail}</p>
            </div>
          </div>
        ) : null}
      </Panel>

      {/* ══ THE LOADING TIMELINE, FROM THE TRIP ROW ═════════════════════ */}
      <Panel title="Loading Record">
        <ol className="space-y-2">
          {[
            { label: 'Sent to loading point', at: trip?.sent_to_loading_at },
            { label: 'Arrived at loading point', at: trip?.arrived_at_loading_at },
            { label: 'Loading started', at: trip?.loading_started_at },
            { label: 'Loading completed', at: trip?.loading_completed_at },
            { label: 'Dispatched', at: trip?.dispatched_at },
          ].map((step2) => (
            <li key={step2.label} className="flex items-center gap-2 text-[12.5px]">
              <span
                className={cx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold',
                  step2.at ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-400',
                )}
                aria-hidden="true"
              >
                {step2.at ? <Check size={9} /> : '·'}
              </span>
              <span className={step2.at ? 'font-semibold text-text' : 'text-muted'}>{step2.label}</span>
              <span className="ml-auto text-[11.5px] text-muted">
                {step2.at ? fmtDate(step2.at, true) : 'Not yet'}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      {/* ══ DOCUMENTS — a checklist, never a status ══════════════════════ */}
      <Panel
        title="Loading Documents"
        subtitle="Party Invoice / Bill, E-Way Bill, LR/GR and other papers — recorded here, not as an operational status"
      >
        {documents?.length ? (
          <ul className="space-y-1.5">
            {documents.map((d) => {
              const type = d.document_type || d.type;
              const status2 = d.document_status || d.status || 'PENDING';
              const satisfied = ['PRESENT', 'VERIFIED'].includes(String(status2).toUpperCase());
              return (
                <li key={d.document_id || d.id || type} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="flex items-center gap-2 text-text">
                    <FileIcon satisfied={satisfied} />
                    {DOCUMENT_LABEL[type] || type}
                  </span>
                  <span
                    className={cx(
                      'font-semibold uppercase',
                      satisfied ? 'text-emerald-700' : 'text-amber-700',
                    )}
                  >
                    {status2}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">
            No loading documents recorded yet. This does not prevent loading — dispatch is where the
            mandatory papers are checked.
          </p>
        )}
      </Panel>

      {/* ══ CONFIRM MARK AS LOADED ═════════════════════════════════════ */}
      <ConfirmModal
        open={confirmLoaded}
        title="Confirm loading completed?"
        confirmLabel="Confirm Loading Complete"
        busy={busy === busyKey}
        onCancel={() => setConfirmLoaded(false)}
        onConfirm={async () => {
          // The REAL call. It re-reads the trip, verifies the status is still
          // AT_LOADING_POINT, and writes status + facts + movement history +
          // audit in one transaction.
          const ok = await onRun('loading/complete', () => ops.completeLoading(trip.trip_id, facts));
          if (ok !== false) setConfirmLoaded(false);
        }}
      >
        <ConfirmRow label="Trip" value={trip?.trip_number} />
        <ConfirmRow label="Vehicle" value={trip?.vehicle?.vehicle_number || trip?.vehicle_number} />
        <ConfirmRow label="Driver" value={trip?.driver?.driver_name} />
        <ConfirmRow label="Loading Location" value={loadingPoint} />
        <ConfirmRow label="Current Status" value={status.replace(/_/g, ' ')} />
        <ConfirmRow label="New Status" value="LOADED / WAITING FOR DISPATCH" />
        {qty !== '' ? <ConfirmRow label="Actual Quantity" value={`${qty} ${unit || ''}`.trim()} /> : null}
        {weight !== '' ? <ConfirmRow label="Actual Weight" value={`${weight} kg`} /> : null}
        {loadedBy ? <ConfirmRow label="Loaded By" value={loadedBy} /> : null}

        <Notice tone="info" title="What happens when you confirm">
          The trip moves AT_LOADING_POINT → LOADED, the loading facts are recorded, and a
          "Loading completed" movement-history entry plus an audit entry are written in the same
          database transaction. The Dispatch workspace will recalculate immediately afterwards.
        </Notice>
      </ConfirmModal>
    </>
  );
}

/** A small per-row document icon so the checklist is scannable. */
function FileIcon({ satisfied }) {
  return satisfied
    ? <Check size={12} className="text-emerald-600" aria-hidden="true" />
    : <Truck size={12} className="text-slate-400" aria-hidden="true" />;
}

export { LOADING_STEP };
