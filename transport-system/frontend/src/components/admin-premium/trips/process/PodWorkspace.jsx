/**
 * PodWorkspace.jsx — DELIVERED → POD PENDING → POD RECEIVED → COMPLETED.
 * ---------------------------------------------------------------------------
 * The POD stage.
 *
 * §8 — THE COMPLETION CHAIN IS EXPLICIT, AND CONDITIONAL.
 *   With a POD required: delivered, then POD pending, then received, then
 *   completed. Without one: delivered, then completed. Both paths are shown as
 *   written, so nobody has to infer which one applies.
 *
 *   This screen never completes a trip itself. Completion is the server's
 *   decision once every condition is satisfied; all this does is get the POD in.
 *
 * UPDATED: Now uses the delivery service's POD data structure and supports
 * file upload via base64 or stored file URL.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { Panel, FactGrid, NotStarted, CompletedRecord, Action, Blocked } from './TripProcessShell';
import { describeProcessState } from './tripProcessModel';

export default function PodWorkspace({
  trip,
  stages,
  ops,
  documents,
  busy,
  onRun,
}) {
  const status = String(trip?.status || 'PENDING').toUpperCase();
  const completed = status === 'COMPLETED';
  const delivered = ['DELIVERED', 'COMPLETED'].includes(status);

  const { headline, waitingFor } = describeProcessState({
    processKey: 'pod',
    tripStatus: status,
    stages,
  });

  const podDocs = (documents || []).filter((d) =>
    String(d.document_type || '').toUpperCase().includes('POD'),
  );
  const podReceived = podDocs.some((d) => String(d.status || '').toUpperCase() === 'VERIFIED'
    || String(d.status || '').toUpperCase() === 'RECEIVED');

  const podRequired = trip?.documents_required !== false;
  const podStatus = !podRequired
    ? 'NOT REQUIRED'
    : podReceived
      ? 'POD RECEIVED'
      : delivered
        ? 'POD PENDING'
        : 'NOT STARTED';

  const [remarks, setRemarks] = useState('');
  const [reference, setReference] = useState('');

  return (
    <>
      <Panel title="POD Status">
        <p
          className={`text-[15px] font-bold uppercase tracking-wide ${
            podStatus === 'POD RECEIVED' || podStatus === 'NOT REQUIRED'
              ? 'text-emerald-700'
              : 'text-amber-700'
          }`}
        >
          {podStatus}
        </p>
        {podRequired ? (
          <FactGrid
            items={[
              { label: 'POD Required', value: 'Yes' },
              { label: 'Delivery Date', value: trip?.trip_delivered_date },
              { label: 'Consignee', value: trip?.delivered_receiver_name || trip?.booking?.consignee_name },
              { label: 'Delivery Location', value: trip?.drop_location },
            ]}
          />
        ) : (
          <p className="mt-1.5 text-[12.5px] text-muted">
            No Proof of Delivery is required for this consignment. It completes on delivery.
          </p>
        )}
      </Panel>

      {podRequired && !podReceived ? (
        <NotStarted
          headline={delivered ? 'POD PENDING' : headline}
          waitingFor={delivered ? null : waitingFor}
          prerequisites={[
            { label: 'Delivered', done: delivered },
            { label: 'POD uploaded', done: podDocs.length > 0 },
            { label: 'POD received and verified', done: podReceived },
          ]}
        />
      ) : null}

      {podReceived ? (
        <CompletedRecord>
          <FactGrid
            items={podDocs.map((d) => ({
              label: d.document_type,
              value: `${d.status || 'PENDING'}${d.reference_number ? ` · ${d.reference_number}` : ''}`,
            }))}
          />
        </CompletedRecord>
      ) : null}

      {podRequired ? (
        <Panel title="Actions">
          <Blocked reason={delivered ? null : 'The consignment must be delivered before a POD can be recorded.'} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] font-semibold text-text">
              POD Reference
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
              />
            </label>
            <label className="block text-[12px] font-semibold text-text">
              Remarks
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-2.5 py-2 text-[13px] font-normal"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Action
              disabled={!delivered}
              busy={busy === 'pod'}
              onClick={() =>
                onRun('pod', () =>
                  ops.submitPod(trip.trip_id, {
                    reference_number: reference || undefined,
                    remarks: remarks || undefined,
                  }),
                )
              }
            >
              Upload POD
            </Action>
            {podDocs.map((d) => (
              <Action
                key={d.document_id}
                tone="ghost"
                busy={busy === `pod/${d.document_id}`}
                onClick={() => onRun(`pod/${d.document_id}`, () => ops.verifyPod(trip.trip_id, d.document_id))}
              >
                Receive POD
              </Action>
            ))}
            {podDocs.map((d) => (
              <a
                key={`v-${d.document_id}`}
                href={d.file_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text hover:bg-slate-50"
              >
                View POD
              </a>
            ))}
            {podReceived ? (
              <Link
                to={`/admin/trips/${trip?.trip_id}/completed`}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text hover:bg-slate-50"
              >
                View Final Summary
              </Link>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* §8 — both chains, shown so nobody has to infer which applies.
          COMPLETE TRIP is the single, authoritative way to close a trip.
          It is enabled only once the chain for THIS consignment has
          actually run: delivered, and — where a POD is required —
          received. The server re-validates every condition and releases
          the vehicle and driver inside the same transaction. */}
      <Panel title="Completion Path">
        <ol className="space-y-1.5 text-[12.5px]">
          {(podRequired
            ? ['DELIVERED', 'POD PENDING', 'POD RECEIVED', 'COMPLETED']
            : ['DELIVERED', 'COMPLETED']
          ).map((step, i, arr) => (
            <li key={step} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted">{i + 1}.</span>
              <span className={completed ? 'font-semibold text-emerald-700' : 'text-text'}>{step}</span>
            </li>
          ))}
        </ol>

        {completed ? (
          <p className="mt-3 text-[12.5px] font-semibold text-emerald-700">
            Trip completed
            {trip?.completed_at ? ` ${new Date(trip.completed_at).toLocaleString('en-IN')}` : ''}.
          </p>
        ) : (
          <>
            <Blocked
              reason={
                !delivered
                  ? 'The consignment must be delivered before the trip can be completed.'
                  : podRequired && !podReceived
                    ? 'A received POD is required before this trip can be completed.'
                    : null
              }
            />
            <div className="mt-3">
              <Action
                disabled={!delivered || (podRequired && !podReceived)}
                busy={busy === 'complete'}
                onClick={() => {
                  if (!window.confirm('Complete this trip? This closes the trip operationally and releases the vehicle and driver for rehire.')) return;
                  onRun('complete', () => ops.completeTrip(trip.trip_id, {}));
                }}
              >
                Complete Trip
              </Action>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}