/**
 * VehicleWorkspace.jsx — the `vehicle` stage of a Trip.
 * ---------------------------------------------------------------------------
 *   /admin/trips/:tripId/vehicle
 *
 * WHY THIS PAGE USED TO LOOK EMPTY
 *   It was a read-only summary. It reported that no vehicle was engaged and
 *   offered a link to a hire form that lived at a different URL, so opening a
 *   trip's Vehicle stage showed the process shell with the actual operational
 *   work missing from it. The trip's canonical Vehicle page has to BE the place
 *   the vehicle is engaged.
 *
 * WHAT IT IS NOW
 *   WAITING FOR VEHICLE  →  the Universal Vehicle Hire workspace, rendered
 *                           inline. Vehicle, driver, vendor, documents, billing
 *                           model, rate basis, commission, gross / net payable,
 *                           the summary and the HIRE VEHICLE action are all here,
 *                           on the operator's actual URL.
 *   VEHICLE HIRED        →  the recorded hire, the three money values and the
 *                           next operational action.
 *
 * IT REUSES THE WORKSPACE; IT NEVER REIMPLEMENTS IT
 *   The form below is `VehicleHireWorkspace`, the exact component the standalone
 *   `/vehicle-hire` route renders and the exact one the backend serves. Two
 *   copies of this arithmetic would be two chances for them to disagree about
 *   what a vendor is owed.
 *
 * VENDOR PAYMENT IS NOT HERE
 *   A hire establishes gross / commission / net payable — an obligation. Money
 *   moving is a Trip advance or settlement against the vendor ledger, so this
 *   stage links to those rather than recording a payment of its own. Completing
 *   a trip must never silently settle a vendor.
 *
 * §3 — the facts are read, never recomputed here. Gross hire, commission and net
 * vendor payable are shown as the three stored values.
 */

import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';

import { Panel, FactGrid, CompletedRecord, Action } from './TripProcessShell';
import { DetailRow } from '../../ui';
import VehicleHireWorkspace, { MoneyLine } from './VehicleHireWorkspace';
import { inr } from './dispatchAtoms';

/** Money as a bare number, for placing inside a ₹ prefix. */
function amount(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VehicleWorkspace({ trip, hire, hireStatus, ops, onRun, busy }) {
  const [searchParams] = useSearchParams();

  /**
   * EDIT MODE
   *   `?edit=1` re-opens the SAME form pre-filled with the existing hire. Saving
   *   UPDATEs that hire, so a second `vehicle_hires` row cannot be created from
   *   this page.
   */
  const editMode = ['1', 'true', 'yes'].includes(
    String(searchParams.get('edit') || '').toLowerCase()
  );

  const tripId = trip?.trip_id;
  const hired = Boolean(hire) && String(hireStatus || '').toUpperCase() !== 'WAITING_FOR_VEHICLE';

  try {
    /* ══ NOT HIRED (or re-editing) — THE ACTUAL HIRE WORKSPACE ══════════════ */
    if (!hired || editMode) {
    return (
      <>
        {!hired ? (
          <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-amber-800">
              Waiting for vehicle
            </p>
            <p className="mt-1 text-[13px] text-amber-900">
              No vehicle is engaged for this trip yet. Select the vehicle, driver and vendor,
              agree the rate and commission, then hire.
            </p>
          </section>
        ) : null}

        <VehicleHireWorkspace tripId={tripId} embedded editMode={editMode} />
      </>
    );
  }

  /* ══ VEHICLE HIRED — THE RECORDED HIRE ═════════════════════════════════ */
  // Only ASSIGNED can advance; the server owns that rule, so the control is
  // offered only where the trip is actually waiting to move.
  const canSendToLoading = String(trip?.status || '').toUpperCase() === 'ASSIGNED';

  return (
    <>
      {/* §11 — compact "Vehicle Hired" summary */}
      <div className="flex items-center gap-2 rounded-lg border border-bt-green-200 bg-emerald-50/50 px-3.5 py-2.5">
        <Check size={14} className="text-emerald-700" aria-hidden="true" />
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800">
          Vehicle Hired
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
        {/* Left: vehicle + driver + commercial details */}
        <div className="space-y-3">
          <Panel title="Vehicle & Driver" subtitle="Engaged for this trip" padded="compact">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <DetailRow label="Vehicle" value={hire.vehicle?.vehicle_number} />
              <DetailRow label="Vehicle Type" value={hire.vehicle?.vehicle_type} />
              <DetailRow label="Vehicle Size" value={hire.vehicle?.vehicle_name} />
              <DetailRow label="Vendor" value={hire.vendor?.owner_name} />
              <DetailRow label="Vendor Mobile" value={hire.vendor?.mobile} />
              <DetailRow label="Driver" value={hire.driver?.driver_name} />
              <DetailRow label="Driver Mobile" value={hire.driver?.mobile} />
              <DetailRow label="Challan No." value={hire.hire?.challan_number} />
            </dl>
          </Panel>

          <Panel title="Commercial Terms" subtitle="Billing To determines the business model" padded="compact">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <DetailRow label="Billing To" value={hire.hire?.billing_to} />
              <DetailRow label="Business Model" value={hire.hire?.business_model} />
              <DetailRow label="Rate As Per" value={hire.hire?.rate_basis} />
            </dl>
          </Panel>
        </div>

        {/* Right: financial summary */}
        <div className="space-y-3">
          {/* §3 — the three money figures, kept apart exactly as stored. */}
          <Panel title="Hire Financial Summary" subtitle="Gross − Commission = Net Vendor Payable" padded="compact">
            <dl className="space-y-0">
              <MoneyLine label="Gross Hire" value={hire.hire?.gross_hire} />
              <MoneyLine
                label="Commission"
                value={hire.hire?.commission_amount}
                prefix="−"
                tone="muted"
                caption={
                  hire.hire?.commission_type === 'fixed'
                    ? `Fixed ${inr(hire.hire?.commission_rate)}`
                    : `${amount(hire.hire?.commission_rate)}%`
                }
              />
              <div className="my-2 border-t border-bt-navy/15" />
              <MoneyLine label="Net Vendor Payable" value={hire.hire?.net_vendor_payable} emphasis />
            </dl>
          </Panel>

          {/* §12 — Vendor Payment */}
          <Panel title="Vendor Payment" subtitle="Current trip payable" padded="compact">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <DetailRow label="Net Payable" value={inr(hire.hire?.net_vendor_payable)} />
              <DetailRow label="Paid" value={inr(hire.hire?.paid_amount || 0)} />
              <DetailRow
                label="Balance"
                value={inr(Number(hire.hire?.net_vendor_payable || 0) - Number(hire.hire?.paid_amount || 0))}
              />
              <DetailRow label="Status" value={hire.hire?.payment_status || 'Pending'} />
            </dl>
            <div className="mt-3">
              <Link
                to="/admin/settlements"
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
              >
                Make Transaction
              </Link>
            </div>
          </Panel>
        </div>
      </div>

      {/* §10 — next operational action */}
      <Panel title="Actions" padded="compact">
        <div className="flex flex-wrap items-center gap-2">
          {/* The next workflow step, run by the EXISTING loading endpoint. The
              server moves ASSIGNED → TO_LOADING_POINT and writes its own
              movement-history entry, so this stage never invents a status. */}
          {canSendToLoading && ops ? (
            <Action
              busy={busy === 'loading/send'}
              onClick={() => onRun('loading/send', () => ops.sendToLoading(trip.trip_id, {}))}
            >
              SEND TO LOADING
            </Action>
          ) : null}

          {/* Changing the vehicle later re-opens the hire form pre-filled. It updates
              the hire and preserves the old vehicle in the trip's vehicle
              history rather than overwriting it. */}
          <Link
            to={`/admin/trips/${tripId}/vehicle-hire?edit=1`}
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
          >
            Change Vehicle
          </Link>

          {/* The same form again, from the standalone route. Both open the one
              workspace; neither can add a second hire. */}
          <Link
            to={`/admin/trips/${tripId}/vehicle-hire?edit=1`}
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
          >
            Edit Vehicle Hire
          </Link>

          {/*
            Vendor PAYMENT lives in the Trip ledger, never in this form. A hire
            establishes gross / commission / net payable; money actually moving is
            recorded as an advance or settlement against the Trip, so completing
            a trip never silently settles a vendor. There is deliberately NO
            per-trip payment form here.
          */}
          <Link
            to="/admin/settlements"
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
          >
            Record Payment
          </Link>
          <Link
            to="/admin/financials/provider-payables"
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
          >
            View Vendor
          </Link>
          <Link
            to="/admin/drivers"
            className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-bt-border bg-white px-3 py-1.5 text-[12px] font-semibold text-bt-navy hover:bg-bt-surface-soft"
          >
            View Driver
          </Link>
        </div>
      </Panel>
    </>
  );
  } catch (error) {
    console.error('VehicleWorkspace render error:', error);
    return (
      <section className="rounded-xl border border-red-300 bg-red-50 px-4 py-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-red-800">
          Vehicle tab error
        </p>
        <p className="mt-1 text-[13px] text-red-900">
          {error?.message || 'An unexpected error occurred'}
        </p>
      </section>
    );
  }
}
