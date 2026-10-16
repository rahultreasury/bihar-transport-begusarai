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
import { Truck, MapPin } from 'lucide-react';

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
  let arrived = false;
  try {
    arrived = Boolean(trip?.arrived_at_destination_at || trip?.arrived_at_destination || trip?.arrival_time || trip?.arrived_at) || delivered;
  } catch (e) {
    arrived = delivered;
  }

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
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF4E2]">
              <svg className="h-5 w-5 text-[#FF9900]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14,2 14,8 20,8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10,9 9,9 8,9"></polyline>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#18345B]">Proof of Delivery (POD)</h2>
              <p className="text-sm text-slate-500">Track and manage delivery confirmation for this trip.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-[#FFE4B5] bg-[#FFF4E2] px-4 py-2">
            <svg className="h-4 w-4 text-[#FF9900] mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <p className="text-sm text-[#B26A00]">
              This section shows the current delivery status and related information. Record the delivery when it is completed.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
          </svg>
          <h3 className="text-base font-semibold text-[#18345B]">Current Status</h3>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#FFF7E6] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFE4B5]">
              <Truck className="h-5 w-5 text-[#B26A00]" />
            </div>
            <div>
              <p className="text-base font-bold uppercase tracking-wide text-[#B26A00]">
                {delivered ? 'DELIVERED' : arrived ? 'AT DELIVERY POINT' : status.replace(/_/g, ' ')}
              </p>
              <p className="text-sm text-slate-600">
                {delivered ? 'Delivery completed' : arrived ? 'Vehicle has arrived at delivery location and is ready for unloading' : 'In transit to delivery location'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 pr-4 sm:border-r sm:border-slate-300">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
                <svg className="h-4 w-4 text-[#2878E5]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Arrival Date</p>
                <p className="text-sm font-semibold text-slate-900">{trip?.arrived_at_destination_at?.slice(0, 10) || trip?.trip_delivered_date || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pr-4 sm:border-r sm:border-slate-300">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
                <svg className="h-4 w-4 text-[#FF9900]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12,6 12,12 16,14"></polyline>
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Arrival Time</p>
                <p className="text-sm font-semibold text-slate-900">{trip?.arrived_at_destination_at?.slice(11, 16) || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
                <MapPin className="h-4 w-4 text-[#2878E5]" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Delivery Location</p>
                <p className="text-sm font-semibold text-slate-900">{trip?.drop_location || trip?.delivery_location || '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[#18345B]">Delivery Progress</h3>
        <p className="mt-1 text-sm text-slate-500">Track the key milestones for this delivery.</p>
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <svg className="h-4 w-4 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20,6 9,17 4,12"></polyline>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Dispatched</p>
                <p className="text-xs text-slate-500">Vehicle dispatched from loading point</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <svg className="h-4 w-4 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20,6 9,17 4,12"></polyline>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Arrived at destination</p>
                <p className="text-xs text-slate-500">Vehicle arrived at delivery location</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                <div className="h-2 w-2 rounded-full bg-slate-400"></div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Delivery not started</p>
                <p className="text-xs text-slate-500">Awaiting delivery recording</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-[#EFF6FF] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#DBEAFE]">
                <svg className="h-5 w-5 text-[#2878E5]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12,6 12,12 16,14"></polyline>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#2878E5] uppercase tracking-wide">
                  {delivered ? 'DELIVERED' : arrived ? 'AT DELIVERY POINT' : 'DELIVERY NOT STARTED'}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {delivered ? 'Delivery has been completed.' : arrived ? 'Vehicle has arrived. Delivery recording pending.' : 'This step has not been recorded yet.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">Please record the delivery once it is completed.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[#2878E5]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14,2 14,8 20,8"></polyline>
          </svg>
          <h3 className="text-base font-semibold text-[#18345B]">Delivery Details</h3>
        </div>
        <p className="mt-1 text-sm text-slate-500">Additional information about the delivery</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-slate-500">Consignee</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{trip?.delivered_receiver_name || trip?.booking?.consignee_name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Delivery Date</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{trip?.trip_delivered_date || trip?.arrived_at_destination_at?.slice(0, 10) || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Delivery Location</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{trip?.drop_location || trip?.delivery_location || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Vehicle</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{trip?.vehicle?.vehicle_number || trip?.vehicle_number || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Driver</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{trip?.driver?.driver_name || trip?.driver_name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">POD Status</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{podStatus}</p>
          </div>
        </div>
      </div>

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