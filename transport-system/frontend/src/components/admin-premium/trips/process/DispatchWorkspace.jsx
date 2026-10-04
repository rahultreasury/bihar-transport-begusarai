/**
 * DispatchWorkspace.jsx
 * ============================================================================
 * THE DISPATCH WORKSPACE — answers two questions and refuses to guess at either:
 *
 *   1. "Is this vehicle actually ready to leave the loading point?"
 *   2. "If not, exactly what is missing?"
 *
 * EVERY FACT HERE COMES FROM THE DATABASE.
 *   The whole page is driven by ONE call —
 *   `GET /api/trips/:id/dispatch` — which returns the header, the readiness
 *   report with every blocker, the shipment facts, the vehicle and its
 *   documents, the loading record, the document checklist, LR/GR, the e-way
 *   bill, delivery, insurance, billing, additional charges, the dispatch record
 *   and the movement history. If the server cannot supply a value the screen
 *   shows a dash. It never substitutes a plausible-looking number, and there is
 *   no state in this file that pretends a fact the backend has not confirmed.
 *
 * EVERY BUTTON DOES SOMETHING REAL.
 *   [ Save ] writes to PostgreSQL. [ Upload ] stores actual bytes. [ Create
 *   Invoice ] persists a real invoice. [ Download PDF ] streams a real
 *   pdfkit document. [ Dispatch Vehicle ] performs a real, transactional status
 *   change. There is no button on this page that only changes React state.
 *
 * THE THREE THINGS THIS PAGE REFUSES TO DO (§41)
 *   • Pretend the government e-way bill was updated. The e-way bill section
 *     shows the internal record and, separately, the government confirmation,
 *     which reads NOT_CONNECTED — because no government API exists here.
 *   • Pretend this is a government e-invoice. The billing section says
 *     "Internal customer invoice" in as many words.
 *   • Mark a customer bill paid because a truck left. Billing is its own
 *     lifecycle and dispatch writes nothing to it.
 *
 * THE STEPPER IS NOT THIS FILE'S BUSINESS.
 *   Which stage is current is decided by the server from `Trip.status`
 *   (`config/tripStagePolicy.js`, rendered by `TripProcessShell`). Opening
 *   /dispatch never makes the Dispatch stage look active.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, FileText } from 'lucide-react';

import {
  Badge, CheckRow, ConfirmModal, ConfirmRow, DoneBanner, ExpiryBadge, Facts, Field,
  Notice, YesNo, cx, fmtDate, inr, inputClass,
} from './dispatchAtoms';

const POST_DISPATCH_STATUSES = ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

/** The document rows the checklist offers an upload for. */
const UPLOADABLE = ['LR', 'GR', 'INVOICE', 'E_WAY_BILL', 'INSURANCE', 'POD', 'OTHER'];

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

export default function DispatchWorkspace({
  tripId,
  trip,
  stages,
  ops,
  workspace,
  workspaceError,
  busy,
  onRun,
  onRefresh,
}) {
  // ── Local form state ──────────────────────────────────────────────────────
  // These are INPUT BUFFERS only. Nothing is "applied" by typing here — each
  // form has a Save button that calls the backend, and the values shown
  // elsewhere on the page come from the server payload, never from this state.
  const [deliveryForm, setDeliveryForm] = useState(null);
  const [lrGrForm, setLrGrForm] = useState({ document_type: 'LR', reference_number: '', issued_at: '', remarks: '' });
  const [lrGrFile, setLrGrFile] = useState(null);
  const [ewayForm, setEwayForm] = useState({ eway_bill_number: '', eway_bill_date: '', expiry_at: '', remarks: '' });
  const [ewayFile, setEwayFile] = useState(null);
  const [insForm, setInsForm] = useState({
    insured: null, insurance_company: '', policy_number: '', sum_insured: '', claim_contact: '', valid_from: '', valid_to: '',
  });
  const [insFile, setInsFile] = useState(null);
  const [uploadType, setUploadType] = useState('OTHER');
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'CASH', reference_number: '', notes: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const readiness = workspace?.readiness || null;
  const shipped = POST_DISPATCH_STATUSES.includes(String(trip?.status || '').toUpperCase());

  // ── Seed the forms from the SERVER payload whenever it changes ───────────
  // Keyed on the payload, so a save that comes back from the server replaces
  // what the operator typed with what was actually persisted.
  useEffect(() => {
    if (!workspace?.delivery) return;
    setDeliveryForm({
      delivery_number: workspace.delivery.delivery_number || '',
      consignee_name: workspace.delivery.consignee_name || '',
      consignee_contact: workspace.delivery.consignee_contact || '',
      pod_required: workspace.delivery.pod_required ?? null,
      value_of_goods: workspace.shipment?.value_of_goods ?? '',
    });
  }, [workspace?.delivery, workspace?.shipment?.value_of_goods]);

  useEffect(() => {
    if (!workspace?.lr_gr) return;
    setLrGrForm((f) => ({
      ...f,
      reference_number: workspace.lr_gr.number || '',
      remarks: workspace.lr_gr.remarks || '',
      issued_at: workspace.lr_gr.date ? String(workspace.lr_gr.date).slice(0, 10) : '',
    }));
  }, [workspace?.lr_gr]);

  useEffect(() => {
    if (!workspace?.eway_bill?.internal) return;
    const b = workspace.eway_bill.internal;
    setEwayForm({
      eway_bill_number: b.number || '',
      eway_bill_date: b.date ? String(b.date).slice(0, 10) : '',
      expiry_at: b.expiry_at ? String(b.expiry_at).slice(0, 10) : '',
      remarks: b.remarks || '',
    });
  }, [workspace?.eway_bill]);

  useEffect(() => {
    if (!workspace?.insurance) return;
    const i = workspace.insurance;
    setInsForm({
      insured: i.insured ?? null,
      insurance_company: i.insurance_company || '',
      policy_number: i.policy_number || '',
      sum_insured: i.sum_insured ?? '',
      claim_contact: i.claim_contact || '',
      valid_from: i.valid_from ? String(i.valid_from).slice(0, 10) : '',
      valid_to: i.valid_to ? String(i.valid_to).slice(0, 10) : '',
    });
  }, [workspace?.insurance]);

  const run = useCallback(async (name, fn) => {
    const ok = await onRun(name, fn);
    if (ok !== false) onRefresh?.();
    return ok;
  }, [onRun, onRefresh]);

  /** Read a picked file as base64 — the transport the API accepts. */
  const readFile = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const canDispatch = Boolean(readiness?.ready) && !shipped && !workspaceError;

  // =========================================================================
  // RENDER
  // =========================================================================

  if (workspaceError) {
    return (
      <section className="rounded-xl border border-red-300 bg-red-50 p-5">
        <p className="flex items-center gap-2 text-[14px] font-bold text-red-800">
          <AlertTriangle size={16} aria-hidden="true" /> Dispatch readiness could not be verified
        </p>
        <p className="mt-1 text-[13px] text-red-900">
          Unable to check dispatch readiness. Please try again.
        </p>

        {/*
          THE TECHNICAL DETAIL IS SHOWN, NOT SWALLOWED — but it is labelled, so
          a stale backend reads as "the server is out of date" rather than as a
          mystery. It is never used to decide anything.
        */}
        <p className="mt-2 rounded-md border border-red-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-red-900">
          {describeApiFailure(workspaceError)}
        </p>

        <p className="mt-3 text-[12px] leading-snug text-red-900">
          This screen will not claim dispatch is allowed while the server cannot confirm it. A failed
          check and a passed check must never look the same.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={busy === 'readiness-retry'} onClick={() => run('readiness-retry', onRefresh)}>
            Retry Readiness Check
          </Button>
          <Button tone="ghost" onClick={() => window.location.reload()}>
            Reload Page
          </Button>
        </div>
      </section>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-xl border border-border bg-white p-6 text-center">
        <p className="text-[13px] text-muted">Loading dispatch workspace…</p>
      </div>
    );
  }

  const { header, shipment, vehicle, driver, loading, documents, lr_gr: lrGr, eway_bill: eway, delivery, insurance, billing, charges, dispatch, movement_history: history } = workspace;

  return (
    <div className="space-y-4">
      {/* ══ B. DISPATCH READINESS ═══════════════════════════════════════════ */}
      <Section
        title="Dispatch Readiness"
        subtitle={readiness?.ready
          ? 'Every mandatory requirement is satisfied. The vehicle may leave the loading point.'
          : `${readiness?.summary?.failed ?? 0} requirement(s) must be fixed before this vehicle can leave.`}
        tone={readiness?.ready ? 'good' : 'bad'}
      >
        {shipped ? (
          <DoneBanner title="Vehicle dispatched">
            <Facts
              columns={4}
              items={[
                { label: 'Dispatch Date', value: fmtDate(dispatch?.dispatched_at) },
                { label: 'Dispatch Time', value: dispatch?.dispatched_at ? fmtDate(dispatch.dispatched_at, true).split(', ').pop() : '—' },
                { label: 'Vehicle', value: header?.vehicle?.vehicle_number },
                { label: 'Driver', value: header?.driver?.driver_name },
                { label: 'LR/GR', value: dispatch?.lr_gr_number || lrGr?.number },
                { label: 'E-Way Bill', value: eway?.internal?.number },
                { label: 'Invoice', value: billing?.invoice?.invoice_number },
                { label: 'POD Required', value: delivery?.pod_required ? 'Yes' : 'No' },
                { label: 'Expected Delivery', value: fmtDate(delivery?.expected_delivery_date) },
              ]}
            />
            <div className="mt-3">
              <Link
                to={`/admin/trips/${tripId}/transit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              >
                Open Transit Workspace <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </DoneBanner>
        ) : (
          <>
            <div className={cx(
              'mb-3 flex items-center gap-2 rounded-lg border px-3 py-2.5',
              readiness?.ready ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50',
            )}
            >
              {readiness?.ready
                ? <CheckCircle2 size={18} className="text-emerald-700" aria-hidden="true" />
                : <Ban size={18} className="text-red-700" aria-hidden="true" />}
              <div>
                <p className={cx('text-[15px] font-bold uppercase tracking-wide', readiness?.ready ? 'text-emerald-800' : 'text-red-800')}>
                  {readiness?.ready ? '🟢 Ready for Dispatch' : '🔴 Dispatch Blocked'}
                </p>
                {readiness?.ready ? null : (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-red-900">
                    Dispatch cannot be completed because the following requirement is missing:{' '}
                    <strong>{(readiness?.blockers || []).map((b) => b.label).join(', ')}</strong>.
                  </p>
                )}
              </div>
            </div>

            <ul className="divide-y divide-border/60">
              {(readiness?.checks || []).map((c) => <CheckRow key={c.key} check={c} />)}
            </ul>

            {Array.isArray(readiness?.blocker_codes) && readiness.blocker_codes.length ? (
              <p className="mt-3 font-mono text-[11px] text-muted">
                blocker_codes: {readiness.blocker_codes.join(', ')}
              </p>
            ) : null}
          </>
        )}
      </Section>

      {/* ══ C. SHIPMENT INFORMATION ════════════════════════════════════════ */}
      <Section title="Shipment Details" subtitle="Consignor, consignee, goods and the declared value">
        <Facts
          items={[
            { label: 'Consignor', value: shipment?.consignor },
            { label: 'Consignee', value: shipment?.consignee_name },
            { label: 'Consignee Contact', value: shipment?.consignee_contact },
            { label: 'Pickup', value: header?.route?.from },
            { label: 'Drop', value: header?.route?.to },
            { label: 'Goods', value: shipment?.goods_description },
            {
              label: 'Planned Quantity',
              value: shipment?.planned_quantity ? `${shipment.planned_quantity} ${shipment.planned_quantity_unit || ''}`.trim() : null,
            },
            {
              label: 'Actual Quantity',
              value: shipment?.actual_quantity != null ? `${shipment.actual_quantity} ${shipment.actual_quantity_unit || ''}`.trim() : null,
            },
            {
              label: 'Planned Weight',
              value: shipment?.planned_weight_kg ? `${shipment.planned_weight_kg} kg` : null,
            },
            {
              label: 'Actual Weight',
              value: shipment?.actual_weight_kg != null ? `${shipment.actual_weight_kg} kg` : null,
            },
            { label: 'Trip Type', value: shipment?.trip_type },
            { label: 'Distance', value: shipment?.distance_km ? `${shipment.distance_km} km` : null },
            { label: 'Expected Delivery', value: fmtDate(shipment?.expected_delivery_date) },
            {
              label: 'Value of Goods',
              value: shipment?.value_of_goods != null
                ? inr(shipment.value_of_goods)
                : (
                  <span className="text-muted">
                    Not declared — {inr(charges?.freight ?? shipment?.value_of_goods)} used as fallback
                  </span>
                ),
            },
          ]}
        />
      </Section>

      {/* ══ D. VEHICLE & DRIVER ════════════════════════════════════════════ */}
      <Section title="Vehicle & Driver" subtitle="Assigned resources and their statutory documents">
        <Facts
          items={[
            { label: 'Vehicle Number', value: vehicle?.vehicle_number },
            { label: 'Vehicle Type', value: vehicle?.vehicle_type },
            { label: 'Body Type', value: vehicle?.body_type },
            { label: 'Capacity', value: vehicle?.capacity_kg ? `${vehicle.capacity_kg} kg` : null },
            { label: 'Owner / Vendor', value: vehicle?.owner },
            { label: 'Driver', value: driver?.driver_name },
            // Admin operational page: dispatch has to be able to call the driver.
            { label: 'Driver Mobile', value: driver?.mobile },
          ]}
        />

        {vehicle?.documents?.length ? (
          <div className="mt-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">Vehicle Documents</p>
            <ul className="mt-1.5 divide-y divide-border/60">
              {vehicle.documents.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-text">{d.label}</p>
                    <p className="text-[11.5px] text-muted">
                      {d.number || 'No number recorded'}
                      {d.expiry ? ` · expires ${fmtDate(d.expiry)}` : ''}
                    </p>
                  </div>
                  <ExpiryBadge state={d.state} expiry={d.expiry} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {/* ══ E. LOADING CONFIRMATION ════════════════════════════════════════ */}
      <Section title="Loading Confirmation" subtitle="What was actually loaded, recorded at the loading point">
        {loading?.completed ? (
          <Notice tone="success" title="Loading completed">
            The vehicle is loaded and awaiting dispatch.
          </Notice>
        ) : (
          <Notice tone="danger" title="Loading not completed">
            {`Loading completion has not been recorded. Current trip status is ${String(trip?.status || '').replace(/_/g, ' ')}.`}
            {' The vehicle cannot be dispatched from the Loading workspace until it is marked as loaded.'}
          </Notice>
        )}

        <Facts
          columns={4}
          items={[
            { label: 'Loading Date', value: fmtDate(loading?.completed_at) },
            {
              label: 'Loading Time',
              value: loading?.completed_at ? fmtDate(loading.completed_at, true).split(', ').pop() : '—',
            },
            {
              label: 'Actual Quantity',
              value: loading?.actual_quantity != null ? `${loading.actual_quantity} ${loading.actual_quantity_unit || ''}`.trim() : null,
            },
            { label: 'Actual Weight', value: loading?.actual_weight_kg != null ? `${loading.actual_weight_kg} kg` : null },
            { label: 'Loaded By', value: loading?.loaded_by },
            { label: 'Loading Remarks', value: loading?.remarks },
            { label: 'Loading Location', value: loading?.location },
            { label: 'Sent to Loading', value: fmtDate(loading?.sent_to_loading_at, true) },
            { label: 'Arrived at Loading', value: fmtDate(loading?.arrived_at_loading_at, true) },
          ]}
        />
      </Section>

      {/* ══ I. LR / GR ═════════════════════════════════════════════════════ */}
      <Section title="LR / GR" subtitle="Lorry receipt / goods receipt for this consignment">
        <Facts
          items={[
            { label: 'LR/GR Number', value: lrGr?.number },
            { label: 'LR/GR Date', value: fmtDate(lrGr?.date) },
            {
              label: 'Document',
              value: lrGr?.document?.file_url ? (
                <a
                  href={ops.documentFileUrl(tripId, lrGr.document.document_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-700 underline"
                >
                  {lrGr.document.file_url.split('/').pop()}
                </a>
              ) : 'Not uploaded',
            },
            { label: 'Remarks', value: lrGr?.remarks },
          ]}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Document Type" required>
            <select
              value={lrGrForm.document_type}
              onChange={(e) => setLrGrForm({ ...lrGrForm, document_type: e.target.value })}
              className={inputClass}
            >
              <option value="LR">LR — Lorry Receipt (issued at loading)</option>
              <option value="GR">GR — Goods Receipt</option>
            </select>
          </Field>
          <Field label="LR/GR Number" required>
            <input
              value={lrGrForm.reference_number}
              onChange={(e) => setLrGrForm({ ...lrGrForm, reference_number: e.target.value })}
              className={inputClass}
              placeholder="LR-2026-00125"
            />
          </Field>
          <Field label="LR/GR Date">
            <input
              type="date"
              value={lrGrForm.issued_at}
              onChange={(e) => setLrGrForm({ ...lrGrForm, issued_at: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Upload LR/GR" hint="The file is stored on the server and linked to this trip.">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
              onChange={(e) => setLrGrFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-[12px] text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-white file:px-2 file:py-1 file:text-[11.5px] file:font-semibold file:text-text"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Remarks">
              <input
                value={lrGrForm.remarks}
                onChange={(e) => setLrGrForm({ ...lrGrForm, remarks: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={busy === 'lrgr'} onClick={() => run('lrgr', async () => ops.saveLrGr(tripId, {
            document_type: lrGrForm.document_type,
            reference_number: lrGrForm.reference_number,
            issued_at: lrGrForm.issued_at || undefined,
            remarks: lrGrForm.remarks || undefined,
            file_name: lrGrFile?.name,
            file_content: await readFile(lrGrFile),
          }))}
          >
            Save LR/GR
          </Button>
          {lrGr?.document?.file_url ? (
            <Button tone="ghost" onClick={() => window.open(ops.documentFileUrl(tripId, lrGr.document.document_id), '_blank')}>
              View
            </Button>
          ) : null}
        </div>
      </Section>

      {/* ══ H. E-WAY BILL ══════════════════════════════════════════════════ */}
      <Section title="E-Way Bill" subtitle="Internal record and government confirmation, kept separate">
        <Notice tone="warn" title="Government E-Way Bill API not connected">
          {eway?.integration_notice}
          {' Recording a number here records what our office holds. It does not notify the government portal.'}
        </Notice>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">Internal Record</p>
            <Facts
              columns={2}
              items={[
                { label: 'E-Way Bill Number', value: eway?.internal?.number },
                { label: 'E-Way Bill Date', value: fmtDate(eway?.internal?.date) },
                { label: 'Expiry Date', value: fmtDate(eway?.internal?.expiry_at) },
                { label: 'Status', value: <Badge state={eway?.internal?.status} /> },
                { label: 'Current Vehicle', value: eway?.internal?.current_vehicle_number || header?.vehicle?.vehicle_number },
                { label: 'Previous Vehicle', value: eway?.internal?.previous_vehicle_number },
              ]}
            />

            {eway?.internal?.vehicle_update_required ? (
              <Notice tone="warn" title="Update required">
                <p>
                  Previous Vehicle: <strong>{eway.internal.previous_vehicle_number || '—'}</strong>
                </p>
                <p>
                  Current Vehicle: <strong>{eway.internal.current_vehicle_number || header?.vehicle?.vehicle_number || '—'}</strong>
                </p>
                <p className="mt-1">
                  The paper we hold no longer matches the truck on this load. Amend it in the e-way bill
                  portal; this screen cannot do it for you.
                </p>
              </Notice>
            ) : null}
          </div>

          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">Government Confirmation</p>
            <Facts
              columns={2}
              items={[
                { label: 'Sync Status', value: <Badge state={eway?.government?.sync_status} label="Not connected" /> },
                { label: 'Government E-Way Bill No.', value: eway?.government?.eway_bill_number || '—' },
                { label: 'Last Synced', value: eway?.government?.synced_at ? fmtDate(eway.government.synced_at, true) : '—' },
              ]}
            />
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              These stay empty until a real e-way bill API is integrated. Nothing in this system writes to
              them, so nothing in this system can claim the government record was updated.
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="E-Way Bill Number" required>
            <input
              value={ewayForm.eway_bill_number}
              onChange={(e) => setEwayForm({ ...ewayForm, eway_bill_number: e.target.value })}
              className={inputClass}
              placeholder="121234567890"
            />
          </Field>
          <Field label="Current Vehicle Number" hint="Defaults to the assigned vehicle. Changing it flags the paper for amendment.">
            <input value={ewayForm.current_vehicle_number || ''} readOnly className={cx(inputClass, 'bg-slate-50 text-muted')} placeholder={header?.vehicle?.vehicle_number || '—'} />
          </Field>
          <Field label="E-Way Bill Date">
            <input
              type="date"
              value={ewayForm.eway_bill_date}
              onChange={(e) => setEwayForm({ ...ewayForm, eway_bill_date: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Expiry Date">
            <input
              type="date"
              value={ewayForm.expiry_at}
              onChange={(e) => setEwayForm({ ...ewayForm, expiry_at: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Upload E-Way Bill" hint="Stored on the server and linked to this trip.">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
              onChange={(e) => setEwayFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-[12px] text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-white file:px-2 file:py-1 file:text-[11.5px] file:font-semibold file:text-text"
            />
          </Field>
          <Field label="Remarks">
            <input
              value={ewayForm.remarks}
              onChange={(e) => setEwayForm({ ...ewayForm, remarks: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={busy === 'eway'} onClick={() => run('eway', async () => ops.saveEwayBill(tripId, {
            eway_bill_number: ewayForm.eway_bill_number,
            eway_bill_date: ewayForm.eway_bill_date || undefined,
            expiry_at: ewayForm.expiry_at || undefined,
            remarks: ewayForm.remarks || undefined,
            file_name: ewayFile?.name,
            file_content: await readFile(ewayFile),
          }))}
          >
            {eway?.internal ? 'Update E-Way Bill' : 'Add E-Way Bill'}
          </Button>
          <Button
            tone="ghost"
            busy={busy === 'eway-vehicle'}
            disabled={!eway?.internal || shipped}
            onClick={() => run('eway-vehicle', () => ops.saveEwayBill(tripId, {
              eway_bill_number: ewayForm.eway_bill_number || eway?.internal?.number,
              current_vehicle_number: header?.vehicle?.vehicle_number,
              vehicle_update_required: false,
              remarks: `Vehicle on this load confirmed as ${header?.vehicle?.vehicle_number}`,
            }))}
          >
            Update Vehicle on E-Way Bill
          </Button>
          {eway?.internal?.document?.file_url ? (
            <Button tone="ghost" onClick={() => window.open(ops.documentFileUrl(tripId, eway.internal.document.document_id), '_blank')}>
              View Document
            </Button>
          ) : null}
        </div>
      </Section>

      {/* ══ J. DELIVERY INFORMATION ════════════════════════════════════════ */}
      <Section title="Delivery Information" subtitle="Captured before departure — it cannot be recovered from a truck that has gone">
        <Facts
          items={[
            { label: 'Delivery Number', value: delivery?.delivery_number },
            { label: 'Consignee Name', value: delivery?.consignee_name },
            { label: 'Consignee Contact', value: delivery?.consignee_contact },
            { label: 'Drop Address', value: delivery?.drop_address },
            { label: 'Expected Delivery', value: fmtDate(delivery?.expected_delivery_date) },
            { label: 'POD Required', value: <Badge state={delivery?.pod_required ? 'YES' : 'NO'} label={delivery?.pod_required ? 'Yes' : 'No'} tone={delivery?.pod_required ? 'orange' : 'grey'} /> },
          ]}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Delivery Number" hint="Often assigned by the consignee at unloading — not required before dispatch.">
            <input
              value={deliveryForm?.delivery_number || ''}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, delivery_number: e.target.value })}
              className={inputClass}
              disabled={shipped}
            />
          </Field>
          <Field label="Consignee Name" required>
            <input
              value={deliveryForm?.consignee_name || ''}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, consignee_name: e.target.value })}
              className={inputClass}
              disabled={shipped}
            />
          </Field>
          <Field label="Consignee Contact" required>
            <input
              value={deliveryForm?.consignee_contact || ''}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, consignee_contact: e.target.value })}
              className={inputClass}
              disabled={shipped}
            />
          </Field>
          <Field label="Value of Goods" hint="Decides whether an E-Way Bill is statutorily required.">
            <input
              type="number"
              value={deliveryForm?.value_of_goods ?? ''}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, value_of_goods: e.target.value })}
              className={inputClass}
              disabled={shipped}
            />
          </Field>
          <Field
            label="POD Required"
            required
            hint="YES: DELIVERED → POD PENDING → POD RECEIVED → COMPLETED.  NO: DELIVERED → COMPLETED."
          >
            <YesNo
              name="pod_required"
              value={deliveryForm?.pod_required ?? null}
              onChange={(v) => setDeliveryForm({ ...deliveryForm, pod_required: v })}
              disabled={shipped}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Button
            busy={busy === 'delivery'}
            disabled={shipped}
            onClick={() => run('delivery', () => ops.saveDeliveryInfo(tripId, {
              delivery_number: deliveryForm.delivery_number,
              consignee_name: deliveryForm.consignee_name,
              consignee_contact: deliveryForm.consignee_contact,
              pod_required: deliveryForm.pod_required,
              value_of_goods: deliveryForm.value_of_goods === '' ? undefined : Number(deliveryForm.value_of_goods),
            }))}
          >
            Save Delivery Information
          </Button>
        </div>
      </Section>

      {/* ══ K. TRANSIT INSURANCE ═══════════════════════════════════════════ */}
      <Section title="Transit Insurance" subtitle="Optional unless the business rule for this consignment requires it">
        <Notice tone={insurance?.requirement?.required ? 'warn' : 'info'}>
          {insurance?.requirement?.required
            ? `Transit insurance is REQUIRED for this consignment (decided by ${String(insurance.requirement.source).replace(/_/g, ' ').toLowerCase()}). Dispatch is blocked until a valid policy is recorded.`
            : 'Transit insurance is not required for this consignment. A missing policy is a warning, not a blocker.'}
        </Notice>

        <Facts
          items={[
            { label: 'Insured', value: insurance?.insured ? 'Yes' : 'No' },
            { label: 'Insurance Company', value: insurance?.insurance_company },
            { label: 'Policy Number', value: insurance?.policy_number },
            { label: 'Sum Insured', value: insurance?.sum_insured != null ? inr(insurance.sum_insured) : null },
            { label: 'Goods Value', value: insurance?.goods_value != null ? inr(insurance.goods_value) : null },
            { label: 'Claim Contact', value: insurance?.claim_contact },
            { label: 'Valid From', value: fmtDate(insurance?.valid_from) },
            { label: 'Valid To', value: fmtDate(insurance?.valid_to) },
            {
              label: 'Certificate',
              value: insurance?.document?.file_url ? (
                <a href={ops.documentFileUrl(tripId, insurance.document.document_id)} target="_blank" rel="noreferrer" className="text-amber-700 underline">
                  View certificate
                </a>
              ) : 'Not uploaded',
            },
          ]}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Insured?" required>
            <YesNo
              name="insured"
              value={insForm.insured}
              onChange={(v) => setInsForm({ ...insForm, insured: v })}
            />
          </Field>
          <Field label="Insurance Company" required={insForm.insured === true}>
            <input
              value={insForm.insurance_company}
              onChange={(e) => setInsForm({ ...insForm, insurance_company: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Policy Number">
            <input
              value={insForm.policy_number}
              onChange={(e) => setInsForm({ ...insForm, policy_number: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Sum Insured">
            <input
              type="number"
              value={insForm.sum_insured}
              onChange={(e) => setInsForm({ ...insForm, sum_insured: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Valid From">
            <input
              type="date"
              value={insForm.valid_from}
              onChange={(e) => setInsForm({ ...insForm, valid_from: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Valid To">
            <input
              type="date"
              value={insForm.valid_to}
              onChange={(e) => setInsForm({ ...insForm, valid_to: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Claim Contact">
            <input
              value={insForm.claim_contact}
              onChange={(e) => setInsForm({ ...insForm, claim_contact: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Upload Certificate" hint="Stored on the server and linked to this trip.">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
              onChange={(e) => setInsFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-[12px] text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-white file:px-2 file:py-1 file:text-[11.5px] file:font-semibold file:text-text"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Button
            busy={busy === 'insurance'}
            onClick={() => run('insurance', async () => ops.saveInsurance(tripId, {
              insured: insForm.insured,
              insurance_company: insForm.insurance_company || undefined,
              policy_number: insForm.policy_number || undefined,
              sum_insured: insForm.sum_insured === '' ? undefined : Number(insForm.sum_insured),
              claim_contact: insForm.claim_contact || undefined,
              valid_from: insForm.valid_from || undefined,
              valid_to: insForm.valid_to || undefined,
              file_name: insFile?.name,
              file_content: await readFile(insFile),
            }))}
          >
            Save Insurance
          </Button>
        </div>
      </Section>

      {/* ══ G. DOCUMENT CHECKLIST ═══════════════════════════════════════════ */}
      <Section title="Transport Documents" subtitle="Configured, required-or-optional, and who uploaded what">
        <ul className="divide-y divide-border/60">
          {(documents || []).map((d) => (
            <li key={d.document_type} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-text">
                  {DOCUMENT_LABEL[d.document_type] || d.document_type}
                  {!d.required ? <span className="ml-1.5 text-[10.5px] font-normal uppercase text-muted">Optional</span> : null}
                </p>
                <p className="text-[11.5px] text-muted">
                  {d.reference_number ? `${d.reference_number} · ` : ''}
                  {d.uploaded_at
                    ? `Uploaded ${fmtDate(d.uploaded_at, true)}${d.created_by ? ` by #${d.created_by}` : ''}`
                    : 'Not uploaded'}
                  {d.verified ? ' · Verified' : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {d.file_url ? (
                  <a
                    href={ops.documentFileUrl(tripId, d.document_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11.5px] font-semibold text-amber-700 underline"
                  >
                    View
                  </a>
                ) : null}
                <Badge
                  state={d.satisfied ? 'PASSED' : d.is_present ? 'WARNING' : d.required ? 'FAILED' : 'PENDING'}
                  label={d.satisfied ? 'Received' : d.is_present ? 'On file' : d.required ? 'Pending' : 'Pending'}
                  tone={d.satisfied ? 'green' : d.is_present ? 'orange' : d.required ? 'red' : 'grey'}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Field label="Document Type">
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className={inputClass}>
                {UPLOADABLE.map((t) => (
                  <option key={t} value={t}>{DOCUMENT_LABEL[t] || t}</option>
                ))}
              </select>
            </Field>
          </div>
          <UploadButton
            busy={busy === 'upload'}
            onFile={(file) => run('upload', async () => {
              const stored = await readFile(file);
              await ops.uploadDocument(tripId, {
                document_type: uploadType,
                file_name: file.name,
                file_content: stored,
              });
              setUploadType('OTHER');
            })}
          />
        </div>
      </Section>

      {/* ══ §18 / §19 / §24. DISPATCH CONFIRMATION ════════════════════════ */}
      {!shipped ? (
        <Section title="Dispatch Confirmation">
          {!canDispatch ? (
            <Notice tone="danger" title="Dispatch is not available yet">
              {(readiness?.blockers || []).map((b) => b.message).join(' ')}
            </Notice>
          ) : (
            <Notice tone="success" title="All mandatory requirements are satisfied">
              Review the summary below and confirm. The dispatch is recorded, the movement history entry is
              written, and the trip becomes DISPATCHED — all in one database transaction.
            </Notice>
          )}

          <div className="mt-3">
            <Button
              tone={canDispatch ? 'primary' : 'ghost'}
              disabled={!canDispatch || busy === 'dispatch'}
              onClick={() => setConfirmOpen(true)}
              className="text-[13px]"
            >
              {shipped ? 'Vehicle Dispatched' : 'DISPATCH VEHICLE'}
            </Button>
            {!canDispatch ? (
              <p className="mt-2 text-[12px] text-muted">
                The button stays disabled until the server confirms readiness. It cannot be enabled from
                the browser.
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* ══ §22. MOVEMENT HISTORY ══════════════════════════════════════════ */}
      <Section title="Movement History" subtitle="Written by the server as each action happens — read-only here">
        {history?.length ? (
          <ol className="space-y-2">
            {history.map((e, i) => (
              <li key={e.timeline_id || i} className="flex gap-2 text-[12.5px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-text">{e.description}</p>
                  {e.created_at ? <p className="text-[11.5px] text-muted">{fmtDate(e.created_at, true)}</p> : null}
                  {e.metadata ? (
                    <MetadataChips metadata={e.metadata} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-muted">
            No movement recorded yet. Events appear here automatically as the trip advances — nothing here
            is ever entered by hand.
          </p>
        )}
      </Section>

      {/* ══ §18. THE CONFIRMATION MODAL ════════════════════════════════════ */}
      <ConfirmModal
        open={confirmOpen}
        title="Dispatch Confirmation"
        busy={busy === 'dispatch'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const ok = await onRun('dispatch', () => ops.dispatchVehicle(tripId, {
            lr_gr_number: lrGr?.number || lrGrForm.reference_number || undefined,
            eway_bill_number: eway?.internal?.number || ewayForm.eway_bill_number || undefined,
            delivery_number: delivery?.delivery_number || deliveryForm?.delivery_number || undefined,
            consignee_name: delivery?.consignee_name || deliveryForm?.consignee_name || undefined,
            consignee_contact: delivery?.consignee_contact || deliveryForm?.consignee_contact || undefined,
            pod_required: delivery?.pod_required ?? deliveryForm?.pod_required ?? undefined,
            value_of_goods: deliveryForm?.value_of_goods === '' || deliveryForm?.value_of_goods == null
              ? undefined
              : Number(deliveryForm.value_of_goods),
            invoice_id: billing?.invoice?.invoice_id || undefined,
          }));
          if (ok !== false) setConfirmOpen(false);
        }}
      >
        <ConfirmRow label="Trip" value={header?.trip_number} />
        <ConfirmRow label="Vehicle" value={header?.vehicle?.vehicle_number} />
        <ConfirmRow label="Driver" value={header?.driver?.driver_name} />
        <ConfirmRow label="Route" value={`${header?.route?.from} → ${header?.route?.to}`} />
        <ConfirmRow label="Loading" value={loading?.completed ? 'Completed' : 'Not completed'} />
        <ConfirmRow label="LR/GR" value={lrGr?.number || lrGrForm.reference_number || '—'} />
        <ConfirmRow label="E-Way Bill" value={eway?.internal?.number || ewayForm.eway_bill_number || '—'} />
        <ConfirmRow label="E-Way Bill Type" value="Internal record only — government API not connected" />
        <ConfirmRow label="Consignee" value={delivery?.consignee_name || deliveryForm?.consignee_name || '—'} />
        <ConfirmRow label="Invoice" value={billing?.invoice?.invoice_number || 'Not raised'} />
        <ConfirmRow label="POD Required" value={delivery?.pod_required ? 'Yes' : 'No'} />
        <ConfirmRow label="Expected Delivery" value={fmtDate(delivery?.expected_delivery_date)} />

        <Notice tone="info" title="What happens when you confirm">
          The trip moves LOADED → DISPATCHED, a dispatch record is written, and a movement-history entry plus
          an audit entry are created in the same transaction. Customer billing is untouched.
        </Notice>
      </ConfirmModal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL PRESENTATION PIECES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Turn a failed request into a sentence an operator or a developer can act on.
 *
 * The 404 case gets its OWN wording because it has a single, well-understood
 * cause: the backend process is older than this page. Saying only "Route not
 * found" leaves someone restarting the frontend; naming the cause in one line
 * saves that round trip.
 *
 * This NEVER changes what the page decides. It only explains an error that has
 * already happened.
 */
function describeApiFailure(message) {
  const text = String(message || '');
  if (/route not found/i.test(text)) {
    return `${text} — the backend is running an older version of the code. `
      + 'Restart the backend server so the dispatch routes are registered.';
  }
  if (/network error|failed to fetch/i.test(text)) {
    return `${text} — the backend could not be reached. Check that it is running on port 3000.`;
  }
  if (/timeout/i.test(text)) {
    return `${text} — the backend did not respond in time.`;
  }
  return text;
}

/** A titled section. One flat card — never a card inside a card inside a card. */
function Section({ title, subtitle, children, tone }) {
  return (
    <section className={cx(
      'rounded-xl border bg-white',
      tone === 'bad' ? 'border-red-200' : tone === 'good' ? 'border-emerald-200' : 'border-border',
    )}
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[14px] font-bold text-text">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Button({ children, onClick, disabled, busy, tone = 'primary', className }) {
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
        className,
      )}
    >
      {busy ? <span className="text-[11px]">Working…</span> : children}
    </button>
  );
}

/** The file picker + its own Upload button, so the handler can await the read. */
function UploadButton({ onFile, busy }) {
  return (
    <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-amber-700">
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <FileText size={14} aria-hidden="true" />
      {busy ? 'Uploading…' : 'Upload Document'}
    </label>
  );
}

/**
 * Movement-history metadata as small chips.
 *
 * The dispatch event carries the vehicle, the driver, the LR number and who
 * recorded it — the facts the specification asks the timeline entry to show.
 */
function MetadataChips({ metadata }) {
  let parsed = metadata;
  if (typeof metadata === 'string') {
    try { parsed = JSON.parse(metadata); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const KEYS = [
    ['trip_number', 'Trip'],
    ['vehicle_number', 'Vehicle'],
    ['driver_name', 'Driver'],
    ['lr_gr_number', 'LR/GR'],
    ['eway_bill_number', 'E-Way Bill'],
    ['pod_required', 'POD Required'],
    ['location', 'Location'],
    ['recorded_by', 'Recorded by'],
    ['invoice_number', 'Invoice'],
  ];
  const chips = KEYS
    .filter(([k]) => parsed[k] !== null && parsed[k] !== undefined && parsed[k] !== '')
    .map(([k, label]) => `${label}: ${parsed[k] === true ? 'Yes' : parsed[k] === false ? 'No' : parsed[k]}`);

  if (!chips.length) return null;
  return (
    <p className="mt-0.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-700">
          {c}
        </span>
      ))}
    </p>
  );
}

export { Section, Button, DOCUMENT_LABEL };
