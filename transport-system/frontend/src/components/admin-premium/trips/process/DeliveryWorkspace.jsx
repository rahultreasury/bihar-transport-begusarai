/**
 * DeliveryWorkspace.jsx — has the vehicle arrived, and has the shipment moved?
 * ---------------------------------------------------------------------------
 * The delivery stage.
 *
 * §7 — DELIVERY IS NOT COMPLETION.
 *   Marking delivered does NOT complete a trip that still needs a POD. That
 *   hand-off (DELIVERED → POD PENDING → POD RECEIVED → COMPLETED) belongs to the
 *   POD workspace, and this screen says so rather than implying the job is done.
 */

import React, { useState } from 'react';

import { Panel, FactGrid, NotStarted, CompletedRecord, Action, Blocked } from './TripProcessShell';
import { blockedReason, describeProcessState } from './tripProcessModel';

export default function DeliveryWorkspace({
  trip,
  stages,
  ops,
  readiness,
  readinessError,
  busy,
  onRun,
}) {
  const status = String(trip?.status || 'PENDING').toUpperCase();
  const delivered = ['DELIVERED', 'COMPLETED'].includes(status);
  const arrived = Boolean(trip?.arrived_at_destination_at) || delivered;

  const { headline, waitingFor } = describeProcessState({
    processKey: 'delivery',
    tripStatus: status,
    stages,
  });

  const [receiver, setReceiver] = useState('');
  const [remarks, setRemarks] = useState('');

  const reason = readinessError
    ? `Delivery readiness could not be verified: ${readinessError}`
    : blockedReason(readiness);
  const podRequired = trip?.documents_required !== false && readiness?.podRequired !== false;

  return (
    <>
      <Panel title="Current Status" subtitle={delivered ? 'Delivery completed' : arrived ? 'Vehicle at delivery point' : 'En route to destination'}>
        <div className="mb-2">
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${
            delivered ? 'bg-emerald-100 text-emerald-800'
            : arrived ? 'bg-sky-100 text-sky-800'
            : 'bg-amber-100 text-amber-800'
          }`}>
            {delivered ? 'DELIVERED' : arrived ? 'AT DELIVERY POINT' : status.replace(/_/g, ' ')}
          </span>
        </div>
        {arrived ? (
          <FactGrid
            items={[
              { label: 'Arrival Date', value: trip?.arrived_at_destination_at?.slice(0, 10) },
              { label: 'Arrival Time', value: trip?.arrived_at_destination_at?.slice(11, 16) },
              { label: 'Delivery Location', value: trip?.drop_location },
            ]}
          />
        ) : null}
      </Panel>

      {delivered ? (
        <CompletedRecord>
          <FactGrid
            items={[
              { label: 'Delivered Date', value: trip?.trip_delivered_date },
              { label: 'Receiver', value: trip?.delivered_receiver_name },
              { label: 'Unloading Date', value: trip?.arrived_at_destination_at },
              { label: 'Delivery Remarks', value: trip?.delivery_remarks },
              { label: 'Delivered Quantity', value: trip?.delivered_quantity },
              { label: 'Delivered Weight', value: trip?.delivered_weight_kg ? `${trip.delivered_weight_kg} kg` : null },
            ]}
          />
          {/* §7 — completion is NOT implied by delivery. */}
          {podRequired ? (
            <p className="mt-3 text-[12.5px] font-semibold text-amber-800">
              Delivered. This consignment still needs its Proof of Delivery before it can be
              completed — see the POD workspace.
            </p>
          ) : (
            <p className="mt-3 text-[12.5px] font-semibold text-emerald-800">
              Delivered. No POD is required for this consignment.
            </p>
          )}
        </CompletedRecord>
      ) : (
        <NotStarted
          headline={headline}
          waitingFor={waitingFor}
          prerequisites={[
            { label: 'Dispatched', done: ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(status) },
            { label: 'Arrived at destination', done: arrived },
          ]}
        />
      )}

      <Panel title="Delivery Details" subtitle="Consignment and assignment information">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-slate-900">
            Receiver
            <input
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={trip?.delivered_receiver_name || ''}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[13px] font-normal focus:border-amber-500 focus:ring-1 focus:ring-amber-200"
            />
          </label>
          <label className="block text-[12px] font-semibold text-slate-900">
            Remarks
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={trip?.delivery_remarks || ''}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[13px] font-normal focus:border-amber-500 focus:ring-1 focus:ring-amber-200"
            />
          </label>
        </div>

        <FactGrid
          items={[
            { label: 'Consignor', value: trip?.booking?.customer_name },
            { label: 'Consignee', value: trip?.booking?.consignee_name },
            { label: 'Pickup', value: trip?.pickup_location },
            { label: 'Drop', value: trip?.drop_location },
            { label: 'Quantity', value: trip?.actual_quantity },
            { label: 'Weight', value: trip?.actual_weight_kg ? `${trip.actual_weight_kg} kg` : null },
            { label: 'Vehicle', value: trip?.vehicle?.vehicle_number },
          ]}
        />
      </Panel>

      <Panel title="Actions">
        <Blocked reason={delivered ? null : arrived ? null : reason} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Action
            disabled={arrived}
            busy={busy === 'arrival'}
            onClick={() =>
              onRun('arrival', () =>
                ops.arriveAtDestination(trip.trip_id, { arrival_remarks: remarks || undefined }),
              )
            }
          >
            Arrived at Delivery
          </Action>
          <Action
            disabled={!arrived || delivered}
            busy={busy === 'delivered'}
            onClick={() =>
              onRun('delivered', () =>
                ops.markDelivered(trip.trip_id, {
                  delivered_receiver_name: receiver || undefined,
                  delivery_remarks: remarks || undefined,
                }),
              )
            }
          >
            Mark Delivered
          </Action>
          <Action tone="ghost">Report Delivery Problem</Action>
        </div>
      </Panel>
    </>
  );
}