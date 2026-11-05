/**
 * QuotationEditor.jsx
 * ---------------------------------------------------------------------------
 * PHASE B — THE CLIENT DOCUMENT §2 QUOTATION / RATE SCREEN.
 *
 * "QUOTATION / RATE
 *    Rate Type :- FIXED
 *    Rate / Freight / GST Type:- RCM / GST% / Total Freight / Validity:-15 Days
 *    Payment Schedule … Additional charges … Total billing Amount
 *    [Save Quotation] [Download Quotation] [Send Quotation] [Confirm Order]
 *    Status: RATE QUOTED"
 *
 * WHY A NEW COMPONENT
 *   The old QuoteWorkspace is bound to the BOOKING quote endpoints
 *   (`adminAPI.sendQuote(booking.booking_id, …)`) and returns early without a
 *   booking_id — so on a genuine pre-order enquiry, exactly the case the client
 *   describes, it was dead. The client workflow puts quoting BEFORE order
 *   creation, so this screen must hang off the ENQUIRY. The legacy Booking
 *   quote path is left completely untouched for existing booking screens.
 *
 * NO UX/UI REDESIGN
 *   Every element below is built from the SAME primitives the enquiry workspace
 *   already uses — Panel, Field, inputClass, PrimaryButton, GhostButton, Notice,
 *   LoadingBlock, ErrorBlock, EmptyBlock — so this screen is visually
 *   indistinguishable from the rest of the page. No new colours, typography,
 *   spacing or navigation were introduced, and no existing card was restyled.
 *
 * MONEY IS NEVER COMPUTED HERE
 *   The figures shown are the ones the SERVER returned. A local preview exists
 *   only so the operator is not typing blind, and it is clearly labelled as a
 *   preview: the value that is saved, sent, printed on the PDF and shown after
 *   a save is always the persisted one. The server recomputes and overwrites
 *   every total — a client can never dictate its own price.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeIndianRupee,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';

import { adminAPI } from '../../../services/api';
import {
  EmptyBlock,
  ErrorBlock,
  Field,
  GhostButton,
  LoadingBlock,
  Notice,
  Panel,
  PrimaryButton,
  inputClass,
} from './EnquiryUI';
import { apiErrorMessage, inr } from './enquiryStatus';

/** Client document §2 wording, used verbatim. */
const RATE_TYPES = [
  { value: 'FIXED', label: 'FIXED' },
  { value: 'PER_UNIT', label: 'PER_UNIT' },
];

const GST_TYPES = [
  { value: 'RCM', label: 'RCM' },
  { value: 'FORWARD_CHARGE', label: 'Forward Charge' },
  { value: 'EXEMPT', label: 'Exempt' },
];

const SCHEDULE_TYPES = [
  { value: 'FULL_PAYMENT_IN_ADVANCE', label: 'Full Payment in Advance' },
  {
    value: 'BOOKING_ADVANCE_BALANCE',
    label: 'Booking Amount + Advance After Loading + Balance at Unloading',
  },
  { value: 'CUSTOM', label: 'Custom Schedule' },
];

const STATUS_LABEL = {
  DRAFT: 'DRAFT',
  RATE_QUOTED: 'RATE QUOTED',
  SENT: 'SENT',
  CONVERTED: 'CONVERTED',
};

/** Round to 2dp for the preview only. */
const r2 = (n) => (Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0);
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function emptyCharge() {
  return { charges_name: '', rate: '', quantity: '', quantity_unit: '' };
}
function emptyMilestone() {
  return { due_point: '', amount_type: 'FIXED', amount_value: '' };
}

export default function QuotationEditor({ enquiryId, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saved, setSaved] = useState(null); // the PERSISTED quotation
  const [enquiryStatus, setEnquiryStatus] = useState(null);
  const [hasOrder, setHasOrder] = useState(false);

  // ── form state ──────────────────────────────────────────────────────────
  const [rateType, setRateType] = useState('FIXED');
  const [rate, setRate] = useState('');
  const [freight, setFreight] = useState('');
  const [gstType, setGstType] = useState('RCM');
  const [gstPct, setGstPct] = useState('');
  const [chargeTax, setChargeTax] = useState('');
  const [validityDays, setValidityDays] = useState('15');
  const [scheduleType, setScheduleType] = useState('FULL_PAYMENT_IN_ADVANCE');
  const [bookingAmount, setBookingAmount] = useState('');
  const [advancePct, setAdvancePct] = useState('');
  const [charges, setCharges] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [remarks, setRemarks] = useState('');

  // ── action state ────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(null); // 'save' | 'send' | 'confirm' | 'download'
  const [actionError, setActionError] = useState(null);
  const [actionOk, setActionOk] = useState(null);

  /** Re-seed the form from PERSISTED data only — never from local state. */
  const hydrate = useCallback((q) => {
    setSaved(q);
    if (!q) {
      setRateType('FIXED');
      setRate('');
      setFreight('');
      setGstType('RCM');
      setGstPct('');
      setChargeTax('');
      setValidityDays('15');
      setScheduleType('FULL_PAYMENT_IN_ADVANCE');
      setBookingAmount('');
      setAdvancePct('');
      setCharges([]);
      setMilestones([]);
      setRemarks('');
      return;
    }
    setRateType(q.rate_type || 'FIXED');
    setRate(q.rate ?? '');
    setFreight(q.freight ?? '');
    setGstType(q.gst_type || '');
    setGstPct(q.gst_percentage ?? '');
    setChargeTax(q.additional_charges_tax ?? '');
    setValidityDays(q.validity_days ?? '');
    setScheduleType(q.payment_schedule_type || 'FULL_PAYMENT_IN_ADVANCE');
    setBookingAmount(q.booking_amount ?? '');
    setAdvancePct(q.advance_after_loading_percentage ?? '');
    setCharges(
      (q.additional_charges || []).map((c) => ({
        charges_name: c.charges_name,
        rate: c.rate,
        quantity: c.quantity,
        quantity_unit: c.quantity_unit || '',
      })),
    );
    // Custom milestones come back from the operator; options 1 and 2 are
    // server-derived, so their rows are not editable and are not re-seeded.
    setMilestones(
      q.payment_schedule_type === 'CUSTOM'
        ? (q.milestones || []).map((m) => ({
            due_point: m.due_point,
            amount_type: m.amount_type,
            amount_value: m.amount_value,
          }))
        : [],
    );
    setRemarks(q.remarks || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminAPI.getQuotation(enquiryId);
      const data = res?.data?.data;
      hydrate(data?.quotation || null);
      setEnquiryStatus(data?.enquiry_status || null);
      setHasOrder(Boolean(data?.has_order));
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Unable to load the quotation.'));
    } finally {
      setLoading(false);
    }
  }, [enquiryId, hydrate]);

  useEffect(() => {
    if (enquiryId) load();
  }, [enquiryId, load]);

  /**
   * LOCAL PREVIEW ONLY — never sent, never authoritative.
   * It mirrors the server formula so the operator can see the effect of typing,
   * but the value that gets saved is whatever the server returns.
   */
  const preview = useMemo(() => {
    const chargesTotal = r2(
      charges.reduce((sum, c) => sum + toNum(c.rate) * toNum(c.quantity), 0),
    );
    const freightN = r2(toNum(freight));
    const tax = r2(toNum(chargeTax));
    const total = r2(freightN + chargesTotal + tax);
    const gstAmount = r2(gstType && gstPct !== '' ? (freightN * toNum(gstPct)) / 100 : 0);

    let scheduleTotal = 0;
    if (scheduleType === 'FULL_PAYMENT_IN_ADVANCE') {
      scheduleTotal = total;
    } else if (scheduleType === 'BOOKING_ADVANCE_BALANCE') {
      const booking = r2(toNum(bookingAmount));
      const pct = advancePct === '' ? 100 : toNum(advancePct);
      const target = r2((freightN * pct) / 100);
      scheduleTotal = r2(booking + (target - booking) + (total - target));
    } else {
      scheduleTotal = r2(
        milestones.reduce((sum, m) => {
          const v = toNum(m.amount_value);
          return sum + (m.amount_type === 'PERCENTAGE' ? r2((total * v) / 100) : v);
        }, 0),
      );
    }

    return {
      chargesTotal,
      freightN,
      tax,
      total,
      gstAmount,
      scheduleTotal,
      remaining: r2(total - scheduleTotal),
    };
  }, [charges, freight, chargeTax, gstType, gstPct, scheduleType, bookingAmount, advancePct, milestones]);

  /**
   * The four client actions. Each one performs a REAL call and re-reads the
   * quotation from the server afterwards, so what is on screen is always the
   * persisted truth.
   */
  const runAction = useCallback(
    async (name, fn, okMessage) => {
      setBusy(name);
      setActionError(null);
      setActionOk(null);
      try {
        const result = await fn();
        setActionOk(typeof okMessage === 'function' ? okMessage(result) : okMessage);
        await load();
        await onChanged?.();
        return result;
      } catch (err) {
        setActionError(apiErrorMessage(err, 'The action could not be completed.'));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged],
  );

  const handleSave = () =>
    runAction(
      'save',
      () =>
        adminAPI.saveQuotation(enquiryId, {
          rate_type: rateType,
          rate: rate === '' ? null : toNum(rate),
          freight: freight === '' ? null : toNum(freight),
          gst_type: gstType || null,
          gst_percentage: gstType === 'EXEMPT' || gstPct === '' ? null : toNum(gstPct),
          additional_charges_tax: chargeTax === '' ? 0 : toNum(chargeTax),
          validity_days: validityDays === '' ? null : Number(validityDays),
          payment_schedule_type: scheduleType,
          booking_amount: scheduleType === 'BOOKING_ADVANCE_BALANCE' ? toNum(bookingAmount) : null,
          advance_after_loading_percentage:
            scheduleType === 'BOOKING_ADVANCE_BALANCE' ? (advancePct === '' ? 100 : toNum(advancePct)) : null,
          additional_charges: charges
            .filter((c) => c.charges_name && c.rate !== '' && c.quantity !== '')
            .map((c) => ({
              charges_name: c.charges_name,
              rate: toNum(c.rate),
              quantity: toNum(c.quantity),
              quantity_unit: c.quantity_unit || null,
            })),
          milestones:
            scheduleType === 'CUSTOM'
              ? milestones
                  .filter((m) => m.due_point && m.amount_value !== '')
                  .map((m) => ({
                    due_point: m.due_point,
                    amount_type: m.amount_type,
                    amount_value: toNum(m.amount_value),
                  }))
              : null,
          remarks: remarks || null,
        }),
      'Quotation saved.',
    );

  const handleSend = () =>
    runAction('send', () => adminAPI.sendQuotation(enquiryId), 'Quotation sent. The enquiry is still open.');

  const handleConfirm = () =>
    runAction(
      'confirm',
      () => adminAPI.confirmQuotationOrder(enquiryId),
      (r) => (r?.data?.already_confirmed ? 'This enquiry was already an order.' : 'Order confirmed.'),
    );

  const handleDownload = () =>
    runAction('download', async () => {
      const res = await adminAPI.downloadQuotation(enquiryId);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      // Filename comes from the server's Content-Disposition where possible.
      a.href = url;
      a.download = `${saved?.quotation_number || 'quotation'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return res;
    }, 'Quotation downloaded.');

  const converted = saved?.status === 'CONVERTED' || hasOrder;
  const canSend = Boolean(saved) && !converted && saved.status !== 'SENT';
  const canConfirm = Boolean(saved) && saved.status === 'SENT' && !converted;
  const canDownload = Boolean(saved);

  if (loading) {
    return (
      <Panel title="Quotation / Rate" icon={FileText} subtitle="Client document §2">
        <LoadingBlock label="Loading quotation" rows={4} />
      </Panel>
    );
  }

  if (loadError) {
    return (
      <Panel title="Quotation / Rate" icon={FileText} subtitle="Client document §2">
        <ErrorBlock message={loadError} onRetry={load} />
      </Panel>
    );
  }

  return (
    <Panel
      title="Quotation / Rate"
      icon={FileText}
      subtitle="Give rate for this enquiry — Save, Download, Send, Confirm Order"
    >
      {/* ── Status line (client: "Status RATE QUOTED") ───────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-slate-50/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Status</span>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
            {STATUS_LABEL[saved?.status] || 'NOT QUOTED'}
          </span>
          {saved?.quotation_number ? (
            <span className="font-mono text-[11px] text-muted">{saved.quotation_number}</span>
          ) : null}
        </div>
        {enquiryStatus ? (
          <span className="text-[11px] text-muted">Enquiry: {String(enquiryStatus).replace(/_/g, ' ')}</span>
        ) : null}
      </div>

      {converted ? (
        <Notice tone="success">
          <span className="font-semibold">Order confirmed.</span> This quotation is now the agreed
          contract and can no longer be edited.
        </Notice>
      ) : null}

      {actionOk ? (
        <Notice tone="success" className="mt-3">
          <span className="font-semibold">Done.</span> {actionOk}
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="error" className="mt-3">
          <span className="font-semibold">Action failed.</span> {actionError}
        </Notice>
      ) : null}

      {/* ── Rate / Freight / GST ─────────────────────────────────────────── */}
      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <Field label="Rate Type" htmlFor="qt-rate-type">
          <select
            id="qt-rate-type"
            className={inputClass}
            value={rateType}
            disabled={converted || busy !== null}
            onChange={(e) => setRateType(e.target.value)}
          >
            {RATE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Rate" htmlFor="qt-rate" hint="Client document lists Rate and Freight separately.">
          <input
            id="qt-rate"
            type="number"
            min="0"
            step="0.01"
            className={inputClass}
            value={rate}
            disabled={converted || busy !== null}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>

        <Field label="Freight" required htmlFor="qt-freight">
          <input
            id="qt-freight"
            type="number"
            min="0"
            step="0.01"
            className={inputClass}
            value={freight}
            disabled={converted || busy !== null}
            onChange={(e) => setFreight(e.target.value)}
          />
        </Field>

        <Field
          label="Total Freight"
          htmlFor="qt-total-freight"
          hint="Calculated by the server."
        >
          <input
            id="qt-total-freight"
            readOnly
            className={`${inputClass} bg-slate-50`}
            value={saved?.total_freight ?? preview.freightN ?? ''}
          />
        </Field>

        <Field label="GST Type" htmlFor="qt-gst-type">
          <select
            id="qt-gst-type"
            className={inputClass}
            value={gstType}
            disabled={converted || busy !== null}
            onChange={(e) => setGstType(e.target.value)}
          >
            <option value="">Not set</option>
            {GST_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="GST %"
          htmlFor="qt-gst-pct"
          hint="Stored and shown as recorded. The client's document does not state how RCM affects the billing total, so it is not added to it."
        >
          <input
            id="qt-gst-pct"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className={inputClass}
            value={gstPct}
            disabled={converted || busy !== null || gstType === 'EXEMPT'}
            onChange={(e) => setGstPct(e.target.value)}
          />
        </Field>

        <Field label="Validity" htmlFor="qt-validity" hint="In days, as the client specifies (e.g. 15 Days).">
          <input
            id="qt-validity"
            type="number"
            min="1"
            step="1"
            className={inputClass}
            value={validityDays}
            disabled={converted || busy !== null}
            onChange={(e) => setValidityDays(e.target.value)}
          />
        </Field>

        <Field label="Additional charges Tax" htmlFor="qt-charge-tax">
          <input
            id="qt-charge-tax"
            type="number"
            min="0"
            step="0.01"
            className={inputClass}
            value={chargeTax}
            disabled={converted || busy !== null}
            onChange={(e) => setChargeTax(e.target.value)}
          />
        </Field>
      </div>

      {/* ── Additional charges ───────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
            Additional Charges
          </p>
          <GhostButton
            onClick={() => setCharges((c) => [...c, emptyCharge()])}
            disabled={converted || busy !== null}
            className="px-2 py-1 text-[12px]"
          >
            <Plus className="mr-1 inline h-3 w-3" /> Add
          </GhostButton>
        </div>

        {charges.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted">
            No additional charges.
          </p>
        ) : (
          <div className="space-y-2">
            {charges.map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <Field label={i === 0 ? 'Charges Name' : ''} htmlFor={`qt-charge-name-${i}`}>
                    <input
                      id={`qt-charge-name-${i}`}
                      className={inputClass}
                      placeholder="Detention"
                      value={c.charges_name}
                      disabled={converted || busy !== null}
                      onChange={(e) =>
                        setCharges((prev) =>
                          prev.map((row, j) => (j === i ? { ...row, charges_name: e.target.value } : row)),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={i === 0 ? 'Rate' : ''} htmlFor={`qt-charge-rate-${i}`}>
                    <input
                      id={`qt-charge-rate-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={c.rate}
                      disabled={converted || busy !== null}
                      onChange={(e) =>
                        setCharges((prev) =>
                          prev.map((row, j) => (j === i ? { ...row, rate: e.target.value } : row)),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={i === 0 ? 'Quantity' : ''} htmlFor={`qt-charge-qty-${i}`}>
                    <input
                      id={`qt-charge-qty-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={c.quantity}
                      disabled={converted || busy !== null}
                      onChange={(e) =>
                        setCharges((prev) =>
                          prev.map((row, j) => (j === i ? { ...row, quantity: e.target.value } : row)),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={i === 0 ? 'Unit' : ''} htmlFor={`qt-charge-unit-${i}`}>
                    <input
                      id={`qt-charge-unit-${i}`}
                      className={inputClass}
                      placeholder="Days"
                      value={c.quantity_unit}
                      disabled={converted || busy !== null}
                      onChange={(e) =>
                        setCharges((prev) =>
                          prev.map((row, j) => (j === i ? { ...row, quantity_unit: e.target.value } : row)),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-1 pb-1">
                  <span className="text-[12px] font-semibold text-text">
                    {inr(toNum(c.rate) * toNum(c.quantity))}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCharges((prev) => prev.filter((_, j) => j !== i))}
                    disabled={converted || busy !== null}
                    className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    aria-label={`Remove ${c.charges_name || 'charge'}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex justify-end text-[12px] font-bold text-text">
              Total Additional Charges:{' '}
              {saved ? inr(saved.total_additional_charges) : inr(preview.chargesTotal)}
            </div>
          </div>
        )}
      </div>

      {/* ── Payment schedule ─────────────────────────────────────────────── */}
      <div className="mt-5">
        <Field label="Payment Schedule" htmlFor="qt-schedule" required>
          <select
            id="qt-schedule"
            className={inputClass}
            value={scheduleType}
            disabled={converted || busy !== null}
            onChange={(e) => setScheduleType(e.target.value)}
          >
            {SCHEDULE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {scheduleType === 'BOOKING_ADVANCE_BALANCE' ? (
          <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
            <Field label="Booking Amount" htmlFor="qt-booking-amount" required>
              <input
                id="qt-booking-amount"
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={bookingAmount}
                disabled={converted || busy !== null}
                onChange={(e) => setBookingAmount(e.target.value)}
              />
            </Field>
            <Field
              label="Advance After Loading (%)"
              htmlFor="qt-advance-pct"
              hint="Percent of freight. The client document says this advance INCLUDES the booking amount, so the extra advance is worked out on the server."
            >
              <input
                id="qt-advance-pct"
                type="number"
                min="1"
                max="100"
                step="0.01"
                className={inputClass}
                value={advancePct}
                disabled={converted || busy !== null}
                onChange={(e) => setAdvancePct(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {scheduleType === 'CUSTOM' ? (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Milestones</p>
              <GhostButton
                onClick={() => setMilestones((m) => [...m, emptyMilestone()])}
                disabled={converted || busy !== null}
                className="px-2 py-1 text-[12px]"
              >
                <Plus className="mr-1 inline h-3 w-3" /> Add
              </GhostButton>
            </div>
            {milestones.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted">
                Add at least one milestone.
              </p>
            ) : (
              <div className="space-y-2">
                {milestones.map((m, i) => (
                  <div key={i} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-4">
                      <Field label={i === 0 ? 'Due Point' : ''} htmlFor={`qt-ms-due-${i}`}>
                        <input
                          id={`qt-ms-due-${i}`}
                          className={inputClass}
                          placeholder="On loading"
                          value={m.due_point}
                          disabled={converted || busy !== null}
                          onChange={(e) =>
                            setMilestones((prev) =>
                              prev.map((row, j) => (j === i ? { ...row, due_point: e.target.value } : row)),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="col-span-3">
                      <Field label={i === 0 ? 'Type' : ''} htmlFor={`qt-ms-type-${i}`}>
                        <select
                          id={`qt-ms-type-${i}`}
                          className={inputClass}
                          value={m.amount_type}
                          disabled={converted || busy !== null}
                          onChange={(e) =>
                            setMilestones((prev) =>
                              prev.map((row, j) => (j === i ? { ...row, amount_type: e.target.value } : row)),
                            )
                          }
                        >
                          <option value="FIXED">Fixed Amount</option>
                          <option value="PERCENTAGE">Percentage</option>
                        </select>
                      </Field>
                    </div>
                    <div className="col-span-4">
                      <Field label={i === 0 ? 'Amount' : ''} htmlFor={`qt-ms-amount-${i}`}>
                        <input
                          id={`qt-ms-amount-${i}`}
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          value={m.amount_value}
                          disabled={converted || busy !== null}
                          onChange={(e) =>
                            setMilestones((prev) =>
                              prev.map((row, j) => (j === i ? { ...row, amount_value: e.target.value } : row)),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="col-span-1 pb-2">
                      <button
                        type="button"
                        onClick={() => setMilestones((prev) => prev.filter((_, j) => j !== i))}
                        disabled={converted || busy !== null}
                        className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                        aria-label={`Remove milestone ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* The schedule actually stored by the server, shown after a save. */}
        {saved && saved.milestones?.length ? (
          <div className="mt-3 rounded-lg border border-border bg-slate-50/70 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">
              Payment schedule
            </p>
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {saved.milestones.map((m) => (
                <li key={m.milestone_id} className="flex justify-between gap-3">
                  <span className="text-text">{m.due_point}</span>
                  <span className="font-semibold text-text">
                    {inr(m.computed_amount)}
                    <span className="ml-2 font-normal text-muted">
                      (bal {inr(m.remaining_balance)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-[12px] font-bold">
              <span className="text-muted">Remaining Balance</span>
              <span className="text-text">{inr(saved.schedule_remaining)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Remarks ──────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <Field label="Remarks" htmlFor="qt-remarks">
          <textarea
            id="qt-remarks"
            rows={2}
            className={inputClass}
            value={remarks}
            disabled={converted || busy !== null}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
      </div>

      {/* ── Total Billing Amount ─────────────────────────────────────────── */}
      <div className="mt-5 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
          Total Billing Amount
        </span>
        <span className="text-[18px] font-bold text-amber-700">
          {saved ? inr(saved.total_billing_amount) : inr(preview.total)}
        </span>
      </div>
      {!saved ? (
        <p className="mt-1 text-[11px] text-muted">
          Preview only — the saved, sent and printed figures are always the server's.
        </p>
      ) : null}

      {/* ── The four client actions ──────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap gap-2">
        <PrimaryButton onClick={handleSave} disabled={converted || busy !== null} className="text-[13px]">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
          {busy === 'save' ? 'Saving…' : 'Save Quotation'}
        </PrimaryButton>

        <GhostButton onClick={handleDownload} disabled={!canDownload || busy !== null} className="px-3 py-2 text-[13px]">
          <Download className="mr-1.5 inline h-4 w-4" />
          {busy === 'download' ? 'Preparing…' : 'Download Quotation'}
        </GhostButton>

        <GhostButton
          onClick={handleSend}
          disabled={!canSend || busy !== null}
          className="px-3 py-2 text-[13px]"
        >
          <Send className="mr-1.5 inline h-4 w-4" />
          {busy === 'send' ? 'Sending…' : 'Send Quotation'}
        </GhostButton>

        <GhostButton
          onClick={handleConfirm}
          disabled={!canConfirm || busy !== null}
          className="px-3 py-2 text-[13px]"
        >
          <BadgeIndianRupee className="mr-1.5 inline h-4 w-4" />
          {busy === 'confirm' ? 'Confirming…' : 'Confirm Order'}
        </GhostButton>
      </div>

      {!saved ? (
        <Notice tone="neutral" className="mt-3">
          <AlertCircle className="mr-1.5 inline h-4 w-4" />
          Save a quotation first. Send and Confirm Order act on the persisted quotation, never on
          unsaved values.
        </Notice>
      ) : null}
      {saved && !canSend && !converted ? (
        <Notice tone="neutral" className="mt-3">
          This quotation has already been sent to the customer. Save a change to re-quote, or
          confirm the order.
        </Notice>
      ) : null}
      {saved && !canConfirm && !converted ? (
        <Notice tone="neutral" className="mt-3">
          Send the quotation before confirming the order.
        </Notice>
      ) : null}
    </Panel>
  );
}
