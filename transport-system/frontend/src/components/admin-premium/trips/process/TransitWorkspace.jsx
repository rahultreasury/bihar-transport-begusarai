/**
 * TransitWorkspace.jsx
 * ============================================================================
 * The operational next step after dispatch — NOT a dead page.
 *
 * TRACKING AND MOVEMENT HISTORY ARE DIFFERENT QUESTIONS (§25, §26)
 *   The client document defines them separately, and so does this screen:
 *     • TRACKING          — "Where is my vehicle right now?"  A live POSITION.
 *     • MOVEMENT HISTORY  — "What happened to this load from beginning until
 *                            now?"  The append-only server timeline.
 *   They are rendered as two separate sections with separate headings, because
 *   collapsing them was what made "Tracking" a page that showed a list of past
 *   events and called it a location.
 *
 * NO GPS INTEGRATION EXISTS, SO NO LOCATION IS INVENTED (§26)
 *   When no position has ever been reported this screen says
 *   "GPS Not Connected" and shows nothing at all for a location. It does NOT
 *   drop a pin on the map, and it does NOT report a distance travelled of zero
 *   — a zero would read as "the truck has not moved", which is a completely
 *   different and equally untrue statement.
 *
 * A VEHICLE CHANGE NEVER ERASES THE ORIGINAL (§27)
 *   [ Change Vehicle ] appends a record; the original dispatch vehicle stays at
 *   the top of the list forever. The e-way bill is flagged as needing
 *   amendment and the screen says so in those words — it never claims the
 *   government paper was updated, because this system maintains an internal record only.
 *
 * INCIDENTS ARE PERSISTENT RECORDS (§28)
 *   [ Report Incident ] writes a `trip_incidents` row. A Breakdown resolved by
 *   changing the vehicle writes BOTH the incident decision and the vehicle
 *   change, in one server transaction, so the two can never disagree.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Radio } from 'lucide-react';

import {
  Badge, ConfirmModal, ConfirmRow, Facts, Field, Notice, YesNo, cx, fmtDate, inputClass,
} from './dispatchAtoms';

const INCIDENT_TYPES = [
  { value: 'VEHICLE_MISSING', label: 'Vehicle Missing' },
  { value: 'DRIVER_UNREACHABLE', label: 'Driver Unreachable' },
  { value: 'ACCIDENT', label: 'Accident' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'DELIVERY_PROBLEM', label: 'Delivery Problem' },
  { value: 'OTHER', label: 'Other' },
];

const CHANGE_REASONS = [
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'TRANSSHIPMENT', label: 'Transshipment' },
  { value: 'ACCIDENT', label: 'Accident' },
  { value: 'OTHER', label: 'Other' },
];

const RESOLUTIONS = [
  { value: 'CONTINUED_SAME_VEHICLE', label: 'Continue With Same Vehicle' },
  { value: 'WAITING_REPAIR', label: 'Wait for Repair' },
  { value: 'VEHICLE_CHANGED', label: 'Change Vehicle' },
  { value: 'RESOLVED', label: 'Resolved — no further action' },
];

export default function TransitWorkspace({ tripId, trip, stages, ops, tracking, transit, busy, onRun }) {
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [resolving, setResolving] = useState(null);

  const [incidentForm, setIncidentForm] = useState({
    incident_type: 'BREAKDOWN', description: '', location: '', vehicle_can_continue: null, expected_repair_at: '',
  });
  const [changeForm, setChangeForm] = useState({
    reason: 'BREAKDOWN', remarks: '', location: '', new_vehicle_id: '', new_driver_id: '',
  });
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [resolveForm, setResolveForm] = useState({ resolution: 'CONTINUED_SAME_VEHICLE', remarks: '' });

  const status = String(transit?.status || trip?.status || '').toUpperCase();
  const onRoad = ['DISPATCHED', 'IN_TRANSIT'].includes(status);

  /** Replacement resources for the Change Vehicle picker. */
  useEffect(() => {
    if (!changeOpen) return;
    // Both lists are the EXISTING lookups the Vehicle Hire page already uses.
    Promise.all([
      tripOperationsLookupVehicles(ops),
      tripOperationsLookupDrivers(ops),
    ]).then(([v, d]) => { setVehicles(v); setDrivers(d); }).catch(() => {});
  }, [changeOpen, ops]);

  const run = useCallback(async (name, fn) => {
    const ok = await onRun(name, fn);
    return ok;
  }, [onRun]);

  if (!transit) {
    return (
      <Notice tone="warn" title="Transit workspace unavailable">
        The transit workspace could not be loaded. Start Transit from this page once the vehicle has been
        dispatched.
      </Notice>
    );
  }

  const t = transit.tracking || {};
  const actions = transit.available_actions || [];
  const can = (id) => actions.some((a) => a.id === id);

  return (
    <div className="space-y-4">
      {/* ══ A. THE LOAD ═══════════════════════════════════════════════════ */}
      <Section title="Transit Workspace" subtitle="Where this load is, and what can be done from here">
        <Facts
          items={[
            { label: 'Trip', value: transit.trip_number },
            { label: 'Customer', value: transit.customer?.name },
            { label: 'Route', value: `${transit.trip?.pickup} → ${transit.trip?.drop}` },
            { label: 'Distance', value: transit.trip?.distance_km ? `${transit.trip.distance_km} km` : null },
            { label: 'Current Vehicle', value: transit.current_vehicle?.vehicle_number },
            { label: 'Driver', value: transit.driver?.driver_name },
            { label: 'Driver Mobile', value: transit.driver?.mobile },
            { label: 'Vendor', value: transit.vendor?.owner_name },
            { label: 'Dispatch Date', value: fmtDate(transit.dispatch?.dispatched_at) },
            { label: 'Dispatch Time', value: transit.dispatch?.dispatched_at ? fmtDate(transit.dispatch.dispatched_at, true).split(', ').pop() : '—' },
            { label: 'Expected Delivery', value: fmtDate(transit.trip?.expected_delivery_date) },
            { label: 'Current Status', value: <Badge state={status} tone={onRoad ? 'orange' : 'grey'} /> },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Action busy={busy === 'transit/start'} disabled={!can('START_TRANSIT')} onClick={() => run('transit/start', () => ops.startTransit(tripId, {}))}>
            Start Transit
          </Action>
          <Action busy={busy === 'incident'} disabled={!onRoad} onClick={() => setIncidentOpen(true)}>
            Report Incident
          </Action>
          <Action busy={busy === 'vehicle-change'} disabled={!onRoad} onClick={() => setChangeOpen(true)}>
            Change Vehicle
          </Action>
          <Action busy={busy === 'arrival'} disabled={!can('ARRIVE_DELIVERY')} onClick={() => run('arrival', () => ops.arriveAtDestination(tripId, {}))}>
            Arrived at Delivery
          </Action>
          <a
            href={`/admin/trips/${tripId}/finance`}
            className="inline-flex min-h-[40px] items-center rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50"
          >
            View Finance
          </a>
          <Action
            busy={busy === 'movement'}
            onClick={() => run('movement', () => ops.getTimeline(tripId))}
            tone="ghost"
          >
            Movement History
          </Action>
        </div>
      </Section>

      {/* ══ B. TRACKING — "where is my vehicle right now?" ════════════════ */}
      <Section title="Tracking" subtitle="Where is my vehicle right now?">
        {!t.connected ? (
          <Notice tone="warn" title={t.headline || 'GPS Not Connected'} icon={Radio}>
            {t.message}
          </Notice>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge state={t.status === 'LIVE' ? 'VALID' : 'EXPIRING'} label={t.headline} tone={t.status === 'LIVE' ? 'green' : 'orange'} />
              {t.source ? <span className="text-[11.5px] text-muted">Source: {String(t.source).replace(/_/g, ' ')}</span> : null}
            </div>
            <Facts
              items={[
                { label: 'Latitude', value: t.current_location?.latitude },
                { label: 'Longitude', value: t.current_location?.longitude },
                { label: 'GPS Status', value: t.status },
                { label: 'Last Updated', value: fmtDate(t.last_updated, true) },
                { label: 'Accuracy', value: t.accuracy_m != null ? `${t.accuracy_m} m` : null },
                { label: 'Distance Travelled', value: t.distance_travelled_km != null ? `${t.distance_travelled_km} km` : null },
                { label: 'Distance Remaining', value: t.distance_remaining_km != null ? `${t.distance_remaining_km} km` : null },
                { label: 'Expected Arrival', value: fmtDate(t.expected_arrival, true) },
              ]}
            />
            {t.status === 'STALE' ? (
              <Notice tone="warn">{t.message}</Notice>
            ) : null}
          </>
        )}
        <p className="text-[11.5px] leading-snug text-muted">
          No GPS device integration is connected to this system. A position appears here only if one was
          genuinely recorded; nothing is simulated.
        </p>
      </Section>

      {/* ══ C. VEHICLE HISTORY — the original is never overwritten ═════════ */}
      <Section title="Vehicle History" subtitle="Every vehicle that has been on this load, in order">
        {transit.vehicle_changes?.length ? (
          <ol className="space-y-2">
            {transit.vehicle_changes.map((v, i) => (
              <li key={v.change_id || i} className="flex items-start gap-2 text-[12.5px]">
                <span className="mt-1 w-14 shrink-0 font-mono text-[11px] text-muted">
                  {v.occurred_at ? fmtDate(v.occurred_at, true).split(', ').pop() : '—'}
                </span>
                <div>
                  <p className="font-semibold text-text">
                    {v.old_vehicle_number ? `${v.old_vehicle_number} → ` : ''}
                    <span className="font-mono">{v.new_vehicle_number}</span>
                    {v.reason ? <span className="ml-2 text-[11px] font-normal text-muted">{String(v.reason).replace(/_/g, ' ')}</span> : null}
                  </p>
                  {v.remarks ? <p className="text-[11.5px] text-muted">{v.remarks}</p> : null}
                  {v.location ? <p className="text-[11.5px] text-muted">at {v.location}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted">
            The vehicle dispatched with this consignment is still the one on it. No change has been recorded.
          </p>
        )}

        {transit.eway_bill?.vehicle_update_required ? (
          <Notice tone="warn" title="E-Way Bill update required">
            <p>Previous Vehicle: <strong>{transit.eway_bill.previous_vehicle_number || '—'}</strong></p>
            <p>Current Vehicle: <strong>{transit.eway_bill.current_vehicle_number || transit.current_vehicle?.vehicle_number || '—'}</strong></p>
            <p className="mt-1">The internal E-Way Bill record no longer matches the vehicle on this load. Amend the record.</p>
          </Notice>
        ) : null}
      </Section>

      {/* ══ D. INCIDENTS ═══════════════════════════════════════════════════ */}
      <Section title="Incidents" subtitle="Persistent records — not notes">
        {transit.incidents?.length ? (
          <ul className="divide-y divide-border/60">
            {transit.incidents.map((i) => (
              <li key={i.incident_id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-semibold text-text">
                    <AlertTriangle size={12} className="mr-1 inline text-amber-600" aria-hidden="true" />
                    {INCIDENT_TYPES.find((t2) => t2.value === i.incident_type)?.label || i.incident_type}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      state={i.resolution === 'ONGOING' ? 'PENDING' : 'PASSED'}
                      label={String(i.resolution || 'ONGOING').replace(/_/g, ' ')}
                    />
                    {i.resolution === 'ONGOING' ? (
                      <button
                        type="button"
                        onClick={() => { setResolving(i); setResolveForm({ resolution: 'CONTINUED_SAME_VEHICLE', remarks: '' }); }}
                        className="text-[11.5px] font-semibold text-amber-700 underline"
                      >
                        Resolve
                      </button>
                    ) : null}
                  </div>
                </div>
                {i.description ? <p className="mt-0.5 text-[12px] text-text">{i.description}</p> : null}
                <p className="mt-0.5 text-[11.5px] text-muted">
                  {fmtDate(i.reported_at, true)}
                  {i.location ? ` · ${i.location}` : ''}
                  {i.expected_repair_at ? ` · repair expected ${fmtDate(i.expected_repair_at, true)}` : ''}
                  {i.resolution_remarks ? ` · ${i.resolution_remarks}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No incidents have been reported for this trip.</p>
        )}
      </Section>

      {/* ══ E. MOVEMENT HISTORY — "what happened to this load?" ════════════ */}
      <Section title="Movement History" subtitle="What happened to this load from beginning until now?">
        {transit.movement_history?.length ? (
          <ol className="space-y-2">
            {transit.movement_history.map((e, i) => (
              <li key={e.timeline_id || i} className="flex gap-2 text-[12.5px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-text">{e.description}</p>
                  <p className="text-[11.5px] text-muted">{fmtDate(e.created_at, true)}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted">No movement recorded yet.</p>
        )}
      </Section>

      {/* ══ INCIDENT MODAL ═════════════════════════════════════════════════ */}
      <ConfirmModal
        open={incidentOpen}
        title="Report Incident"
        confirmLabel="Report Incident"
        busy={busy === 'incident'}
        onCancel={() => setIncidentOpen(false)}
        onConfirm={async () => {
          const ok = await run('incident', () => ops.reportIncident(tripId, {
            incident_type: incidentForm.incident_type,
            description: incidentForm.description,
            location: incidentForm.location || undefined,
            vehicle_can_continue: incidentForm.vehicle_can_continue ?? undefined,
            expected_repair_at: incidentForm.expected_repair_at || undefined,
          }));
          if (ok !== false) {
            setIncidentOpen(false);
            setIncidentForm({ incident_type: 'BREAKDOWN', description: '', location: '', vehicle_can_continue: null, expected_repair_at: '' });
          }
        }}
      >
        <div className="space-y-3">
          <Field label="Incident Type" required>
            <select
              value={incidentForm.incident_type}
              onChange={(e) => setIncidentForm({ ...incidentForm, incident_type: e.target.value })}
              className={inputClass}
            >
              {INCIDENT_TYPES.map((t2) => <option key={t2.value} value={t2.value}>{t2.label}</option>)}
            </select>
          </Field>
          <Field label="What happened" required>
            <textarea
              rows={3}
              value={incidentForm.description}
              onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Location">
            <input
              value={incidentForm.location}
              onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })}
              className={inputClass}
            />
          </Field>
          {incidentForm.incident_type === 'BREAKDOWN' ? (
            <>
              <Field label="Vehicle can continue?">
                <YesNo
                  name="vehicle_can_continue"
                  value={incidentForm.vehicle_can_continue}
                  onChange={(v) => setIncidentForm({ ...incidentForm, vehicle_can_continue: v })}
                />
              </Field>
              <Field label="Expected repair time">
                <input
                  type="datetime-local"
                  value={incidentForm.expected_repair_at}
                  onChange={(e) => setIncidentForm({ ...incidentForm, expected_repair_at: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </>
          ) : null}
          <Notice tone="info">
            This creates a permanent record on the trip. It is not a note and it cannot be typed over later.
          </Notice>
        </div>
      </ConfirmModal>

      {/* ══ RESOLVE MODAL ══════════════════════════════════════════════════ */}
      <ConfirmModal
        open={Boolean(resolving)}
        title="Resolve Incident"
        confirmLabel="Resolve"
        busy={busy === 'resolve'}
        onCancel={() => setResolving(null)}
        onConfirm={async () => {
          const ok = await run('resolve', () => ops.resolveIncident(tripId, resolving.incident_id, resolveForm));
          if (ok !== false) setResolving(null);
        }}
      >
        <div className="space-y-3">
          <Notice tone="info" title="The three ways out of an incident">
            <ul className="mt-1 list-disc pl-4">
              <li><strong>Continue With Same Vehicle</strong> — the load carries on as it is.</li>
              <li><strong>Wait for Repair</strong> — the incident stays open until the repair is done.</li>
              <li>
                <strong>Change Vehicle</strong> — record the change FIRST with
                {' '}<button type="button" className="underline" onClick={() => { setResolving(null); setChangeOpen(true); }}>Change Vehicle</button>.
                The server refuses to close a breakdown this way until the replacement vehicle is actually on
                record.
              </li>
            </ul>
          </Notice>
          <Field label="Resolution" required>
            <select
              value={resolveForm.resolution}
              onChange={(e) => setResolveForm({ ...resolveForm, resolution: e.target.value })}
              className={inputClass}
            >
              {RESOLUTIONS.filter((r) => r.value !== 'VEHICLE_CHANGED').map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Remarks">
            <textarea
              rows={2}
              value={resolveForm.remarks}
              onChange={(e) => setResolveForm({ ...resolveForm, remarks: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>
      </ConfirmModal>

      {/* ══ CHANGE VEHICLE MODAL ══════════════════════════════════════════ */}
      <ConfirmModal
        open={changeOpen}
        title="Change Vehicle"
        confirmLabel="Record Vehicle Change"
        busy={busy === 'vehicle-change'}
        onCancel={() => setChangeOpen(false)}
        onConfirm={async () => {
          const ok = await run('vehicle-change', () => ops.changeVehicle(tripId, {
            reason: changeForm.reason,
            remarks: changeForm.remarks,
            location: changeForm.location || undefined,
            new_vehicle_id: Number(changeForm.new_vehicle_id),
            new_driver_id: changeForm.new_driver_id ? Number(changeForm.new_driver_id) : undefined,
            incident_id: resolving?.incident_id || undefined,
          }));
          if (ok !== false) {
            setChangeOpen(false);
            setChangeForm({ reason: 'BREAKDOWN', remarks: '', location: '', new_vehicle_id: '', new_driver_id: '' });
          }
        }}
      >
        <ConfirmRow label="Current Vehicle" value={transit.current_vehicle?.vehicle_number} />
        <ConfirmRow label="Current Driver" value={transit.driver?.driver_name} />
        <div className="mt-3 space-y-3">
          <Field label="Reason" required>
            <select
              value={changeForm.reason}
              onChange={(e) => setChangeForm({ ...changeForm, reason: e.target.value })}
              className={inputClass}
            >
              {CHANGE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Replacement Vehicle" required>
            <select
              value={changeForm.new_vehicle_id}
              onChange={(e) => setChangeForm({ ...changeForm, new_vehicle_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Select a vehicle…</option>
              {vehicles
                .filter((v) => v.vehicle_id !== transit.current_vehicle?.vehicle_id)
                .map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.vehicle_number} — {v.vehicle_type}</option>)}
            </select>
          </Field>
          <Field label="Replacement Driver" hint="Leave blank to keep the current driver.">
            <select
              value={changeForm.new_driver_id}
              onChange={(e) => setChangeForm({ ...changeForm, new_driver_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Keep current driver</option>
              {drivers.map((d) => <option key={d.driver_id} value={d.driver_id}>{d.driver_name}</option>)}
            </select>
          </Field>
          <Field label="Where did this happen?" required>
            <input
              value={changeForm.location}
              onChange={(e) => setChangeForm({ ...changeForm, location: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="What happened?" required>
            <textarea
              rows={2}
              value={changeForm.remarks}
              onChange={(e) => setChangeForm({ ...changeForm, remarks: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Notice tone="warn" title="The original vehicle is kept">
            This appends a change record. The vehicle dispatched with this consignment stays in the trip
            history permanently, and any e-way bill is flagged as needing amendment — which is not the same
            thing as the government paper having been updated.
          </Notice>
        </div>
      </ConfirmModal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

function Section({ title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[14px] font-bold text-text">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Action({ children, onClick, disabled, busy, tone = 'primary' }) {
  const tones = {
    primary: 'bg-amber-600 text-white hover:bg-amber-700',
    ghost: 'border border-border bg-white text-text hover:bg-slate-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cx(
        'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-45',
        tones[tone],
      )}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

/** Reuse the EXISTING lookup endpoints rather than adding new ones. */
async function tripOperationsLookupVehicles(ops) {
  if (typeof ops.getLookupVehicles !== 'function') return [];
  const r = await ops.getLookupVehicles();
  return r?.data?.data || r?.data || [];
}

async function tripOperationsLookupDrivers(ops) {
  if (typeof ops.getLookupDrivers !== 'function') return [];
  const r = await ops.getLookupDrivers();
  return r?.data?.data || r?.data || [];
}

export { Section, Action };
