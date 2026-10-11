/**
 * CompletionWorkspace.jsx — the read-only final record.
 * ---------------------------------------------------------------------------
 * §9 — READ ONLY. Nothing here mutates the trip.
 *
 * A finished consignment is inspected, not operated. There is no reopen or
 * correction control on this screen because none exists in the backend: showing
 * an action that silently does nothing would be worse than showing none.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import { Panel, FactGrid, NotStarted } from './TripProcessShell';
import { describeProcessState } from './tripProcessModel';

const inr = (n) =>
  Number.isFinite(Number(n))
    ? new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(n))
    : null;

export default function CompletionWorkspace({ trip, stages, hire, documents, timeline }) {
  const status = String(trip?.status || 'PENDING').toUpperCase();
  const completed = status === 'COMPLETED';
  const { headline, waitingFor } = describeProcessState({
    processKey: 'completed',
    tripStatus: status,
    stages,
  });

  if (!completed) {
    return (
      <NotStarted
        headline={headline}
        waitingFor={waitingFor}
        prerequisites={[
          { label: 'Vehicle assigned', done: Boolean(trip?.vehicle_id) },
          { label: 'Loading completed', done: ['LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(status) },
          { label: 'Dispatched', done: ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(status) },
          { label: 'Delivered', done: ['DELIVERED', 'COMPLETED'].includes(status) },
          { label: 'POD resolved', done: status === 'COMPLETED' },
        ]}
      />
    );
  }

  return (
    <>
      <Panel title="Trip Completed">
        <p className="text-[15px] font-bold uppercase tracking-wide text-emerald-700">
          TRIP COMPLETED
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          Completed {trip?.completed_at ? new Date(trip.completed_at).toLocaleString('en-IN') : '—'}. This
          is the final record.
        </p>
      </Panel>

      {/* Resource release — the vehicle and driver are freed for
          rehire once a trip is COMPLETED. Read from the timeline
          event the server writes inside the completion transaction,
          so the indicator reflects what actually happened rather
          than a guess. Trips completed before the release rule
          existed have no such event and are reported as such. */}
      <Panel title="Resource Release">
        <ReleaseIndicator timeline={timeline} />
      </Panel>

      <Panel title="Summary">
        <FactGrid
          items={[
            { label: 'Trip Number', value: trip?.trip_number },
            { label: 'Customer', value: trip?.booking?.customer_name },
            { label: 'Route', value: [trip?.pickup_location, trip?.drop_location].filter(Boolean).join(' → ') },
            { label: 'Vehicle', value: trip?.vehicle?.vehicle_number },
            { label: 'Driver', value: trip?.driver?.driver_name },
            { label: 'Trip Date', value: trip?.trip_date?.slice(0, 10) },
            { label: 'Delivered Date', value: trip?.trip_delivered_date },
            { label: 'POD Status', value: (documents || []).find((d) => String(d.document_type).toUpperCase().includes('POD'))?.status || '—' },
          ]}
        />
      </Panel>

      {/* §18 — money is REPORTED here, never recomputed. The figures come from
          the canonical financial service; this screen only displays them. */}
      <Panel title="Final Position" subtitle="Read from the canonical financial service — not calculated here">
        <FactGrid
          items={[
            { label: 'Customer Billing', value: inr(hire?.customerBilling ?? trip?.booking?.final_price) },
            { label: 'Vehicle Gross Hire', value: inr(hire?.gross_hire) },
            { label: 'Commission', value: inr(hire?.commission) },
            { label: 'Net Vendor Payable', value: inr(hire?.net_vendor_payable) },
          ]}
        />
      </Panel>

      <Panel title="Documents">
        {documents?.length ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {documents.map((d) => (
              <li key={d.document_id} className="flex items-center justify-between gap-3">
                <span className="text-text">{d.document_type}</span>
                <span className="font-semibold uppercase text-muted">{d.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No documents recorded.</p>
        )}
      </Panel>

      {/* §17 — history is the past; it is shown, never rewritten by this view. */}
      <Panel title="Movement History">
        {timeline?.length ? (
          <ol className="space-y-2 text-[12.5px]">
            {timeline.map((e) => (
              <li key={e.id || e.event_id} className="flex gap-3">
                <span className="w-32 shrink-0 font-mono text-[11px] text-muted">
                  {e.at || e.event_at || e.created_at}
                </span>
                <span className="text-text">{e.description || e.event_type}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted">No movement history returned.</p>
        )}
      </Panel>

      <Panel title="Actions">
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/admin/trips/${trip?.trip_id}`}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text hover:bg-slate-50"
          >
            View Trip
          </Link>
          <Link
            to={`/admin/trips/${trip?.trip_id}/pod`}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text hover:bg-slate-50"
          >
            View POD Record
          </Link>
        </div>
      </Panel>
    </>
  );
}

function parseMeta(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function ReleaseIndicator({ timeline }) {
  const list = Array.isArray(timeline)
    ? timeline
    : Array.isArray(timeline?.events)
      ? timeline.events
      : [];
  const releaseEvent = list.find((e) => String(e.event_type) === 'resources_released');
  const meta = parseMeta(releaseEvent?.metadata);

  if (!releaseEvent) {
    return (
      <p className="text-[12.5px] text-muted">
        No resource-release event is recorded. Trips completed before the
        release rule existed keep their original vehicle and driver assignment.
      </p>
    );
  }

  return (
    <FactGrid
      items={[
        {
          label: 'Driver',
          value: meta.driver_released
            ? 'Released for rehire'
            : 'Still committed to another active trip',
        },
        {
          label: 'Vehicle',
          value: meta.vehicle_released
            ? 'Released for rehire'
            : 'Still committed to another active trip',
        },
      ]}
    />
  );
}