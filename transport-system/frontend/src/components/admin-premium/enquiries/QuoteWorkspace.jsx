/**
 * QuoteWorkspace.jsx
 * ---------------------------------------------------------------------------
 * "QUOTATION" — the pricing core of the enquiry workspace.
 *
 * SCOPE: THIS CARD QUOTES. IT DOES NOT HIRE.
 *   The Driver / Vehicle picker, the "Change"/"Clear" assignment buttons and the
 *   "Current assignment" summary that used to live here have been REMOVED. They
 *   were a second vehicle-hiring form competing with the canonical one, and they
 *   duplicated the Vehicle Hire workflow.
 *
*   Hiring happens in exactly one place: the Universal Vehicle Hire workspace at
*   /admin/trips/:tripId/vehicle-hire, which owns vehicle, driver, owner/vendor, billing
*   model, contract/commission, hire amount, commission and net vendor payable.
 *
 *   What remains here is the read-only `VehicleHireStatusCard` — a status and
 *   handoff card that reads the canonical assignment and links to that one
 *   workflow. It contains no hiring form.
 *
 * WHY driver_id IS STILL SENT IN THE PAYLOAD
 *   The booking quote endpoints (`prepare-quote` / `send-quote`) require a
 *   driver_id. That is an EXISTING backend contract and it is not changed here.
 *   The value posted is the PERSISTED `booking.driver_id` — i.e. whatever the
 *   single assignment writer (`TripVehicleAssignmentService`, driven from the
 *   Vehicle Hire page) already stored. This card never lets an operator choose a
 *   driver, so it can never create a competing assignment; it only forwards the
 *   server's own current one, for backwards compatibility.
 *
 * REAL ENDPOINTS ONLY
 *   Prepare  : POST /api/admin/bookings/:id/prepare-quote  (UNDER_REVIEW → QUOTE_PREPARED)
 *   Send     : POST /api/admin/bookings/:id/send-quote     (QUOTE_PREPARED → QUOTE_SENT)
 *
 * WHICH BUTTON IS THE PRIMARY ONE IS DECIDED BY THE DATABASE
 *   At stage 2 the primary button is "Prepare Quote" (saves the draft, notifies
 *   nobody). At stage 3 it is "Send Quote to Customer". The stage comes from
 *   stageForBooking(), never from local state.
 *
 * Pricing is never recomputed here. The estimated price is whatever the backend
 * already calculated for this booking; the admin only sets the final amount.
 * Success is only ever reported when the real API call resolves.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeIndianRupee,
  ClipboardCheck,
  FileText,
  MapPinned,
  Send,
  Timer,
} from 'lucide-react';

import { adminAPI } from '../../../services/api';
import VehicleHireStatusCard from './VehicleHireStatusCard';
import {
  Field,
  GhostButton,
  Notice,
  Panel,
  PrimaryButton,
  inputClass,
} from './EnquiryUI';
import {
  apiErrorMessage,
  fmtDistance,
  inr,
} from './enquiryStatus';
import { STAGE, stageForBooking } from './workflow/workflowStages';

const VALIDITY_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '2', label: '2 hours' },
  { value: '4', label: '4 hours' },
  { value: '8', label: '8 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
];

export default function QuoteWorkspace({
  booking,
  onSent,
  stage: stageOverride,
  feedback,
  onDismissFeedback,
}) {
  /**
   * The quote may only be EDITED before it reaches the customer. Once it is
   * sent the card becomes read-only and the customer's decision is the only
   * thing left — which is exactly what the backend enforces too.
   */
  const editable = useMemo(() => {
    const s = String(booking?.quote_status || 'PENDING').toUpperCase();
    if (['SENT', 'QUOTE_SENT', 'WAITING_CUSTOMER_APPROVAL', 'ACCEPTED', 'REJECTED', 'EXPIRED'].includes(s)) {
      return false;
    }
    return !['cancelled', 'completed', 'delivered'].includes(String(booking?.status || '').toLowerCase());
  }, [booking]);

  const stage = stageOverride || stageForBooking(booking);
  const isPreparedStage = stage === STAGE.QUOTE_PREPARED;

  const [finalPrice, setFinalPrice] = useState('');
  const [validity, setValidity] = useState('24');
  const [remarks, setRemarks] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendSuccess, setSendSuccess] = useState(null);
  const [validation, setValidation] = useState([]);

  const bookingKey = booking?.booking_id;

  /**
   * THE PERSISTED ASSIGNMENT — read, never written.
   * This is the driver/vehicle the backend already stored through the single
   * assignment writer. It is forwarded to the quote endpoints for contract
   * compatibility and displayed in the Vehicle Hire status card. There is no
   * picker, no "Change" and no "Clear" here any more.
   */
  const assignedDriverId = booking?.driver_id || null;
  const assignedVehicleId = booking?.vehicle_id || null;

  /* Re-seed the form from PERSISTED state, not from anything the browser held. */
  useEffect(() => {
    if (!booking) return;
    setFinalPrice(booking.final_price ? String(booking.final_price) : '');
    setValidity('24');
    setRemarks(booking.quote_remarks || '');
    setSendError(null);
    setSendSuccess(null);
    setValidation([]);
  }, [bookingKey, booking]);

  /* Validation mirrors the backend's own contract for both endpoints. */
  const computeValidation = useCallback(() => {
    if (!booking) return [];
    const issues = [];
    const price = Number(finalPrice);
    if (!finalPrice || !Number.isFinite(price) || price <= 0) {
      issues.push('Enter a final quote amount greater than ₹0.');
    }
    if (!assignedDriverId) {
      issues.push(
        'No driver is assigned to this consignment yet — assign one in the Vehicle Hire workspace, then prepare the quote.',
      );
    }
    if (!validity || Number(validity) <= 0) {
      issues.push('Choose how long this quote stays valid.');
    }
    return issues;
  }, [booking, finalPrice, assignedDriverId, validity]);

  /**
   * The one submit handler for BOTH buttons. `send` picks which real endpoint
   * is called; the payload is identical because the backend contract is.
   */
  const handleSubmit = useCallback(
    async (send) => {
      if (!booking?.booking_id) return;
      const issues = computeValidation();
      setValidation(issues);
      if (issues.length > 0) {
        setSendError('Fix the highlighted items before continuing.');
        setSendSuccess(null);
        return;
      }

      setSending(true);
      setSendError(null);
      setSendSuccess(null);
      try {
        const payload = {
          driver_id: assignedDriverId,
          final_price: Number(finalPrice),
          quote_validity_hours: Number(validity),
          remarks: remarks.trim() ? remarks.trim() : null,
        };
        if (assignedVehicleId) payload.vehicle_id = Number(assignedVehicleId);

        if (send) {
          const res = await adminAPI.sendQuote(booking.booking_id, payload);
          if (res?.data?.success) {
            setSendSuccess('Quote sent successfully');
            setRemarks(payload.remarks || '');
            await onSent?.();
          } else {
            setSendError(res?.data?.message || 'The server could not send this quote.');
          }
        } else {
          const res = await adminAPI.prepareQuote(booking.booking_id, payload);
          if (res?.data?.success) {
            setSendSuccess('Quote prepared. Send it to the customer when you are ready.');
            await onSent?.();
          } else {
            setSendError(res?.data?.message || 'The server could not prepare this quote.');
          }
        }
      } catch (err) {
        setSendError(
          apiErrorMessage(
            err,
            send ? 'Unable to send the quote.' : 'Unable to prepare the quote. Please try again.',
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [booking, computeValidation, assignedDriverId, assignedVehicleId, finalPrice, validity, remarks, onSent],
  );

  const estimated = booking?.estimated_price ? inr(booking.estimated_price) : '—';

  /** External feedback (from a stage action elsewhere on the page). */
  const externalNotice = feedback ? (
    <Notice tone={feedback.tone === 'error' ? 'error' : 'success'} className="mt-3">
      <span className="font-semibold">
        {feedback.tone === 'error' ? 'Action failed.' : 'Saved.'}
      </span>{' '}
      {feedback.text}
      {onDismissFeedback ? (
        <button type="button" onClick={onDismissFeedback} className="ml-2 font-semibold underline">
          Dismiss
        </button>
      ) : null}
    </Notice>
  ) : null;

  return (
    <Panel
      title="Quotation"
      icon={FileText}
      subtitle="Set the final quote and publish it to the customer"
    >
      {/* ── VEHICLE HIRE — a status/handoff card, never a hiring form ────────
        *
        * Rendered from the SAME Trip record the Vehicle Hire page reads, via
        * `GET /api/vehicle-hire/assignment?booking_id=`. It performs no hire
        * arithmetic, infers no state and writes no assignment: it shows what the
        * backend stored and its buttons navigate to the one universal Vehicle
        * Hire workflow. */}
      <VehicleHireStatusCard
        bookingId={booking?.booking_id}
        enquiryId={booking?.enquiry_id}
      />

      {!editable ? (
        <div className="space-y-3">
          <Notice tone="neutral">
            This enquiry has already been quoted. The quote workspace is read-only — the customer decision
            is recorded by the existing backend flow.
          </Notice>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Final quote</span>
            <span className="text-[16px] font-bold text-amber-600">
              {Number(booking?.final_price) > 0 ? inr(booking.final_price) : '—'}
            </span>
          </div>
          {externalNotice}
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* ── Pricing ─────────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-white px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted">
                <MapPinned className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Estimated price
              </p>
              <p className="mt-1 text-[20px] font-bold leading-6 text-[#1e3a5f]">{estimated}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                Distance {fmtDistance(booking?.estimated_distance_km)} · calculated by the backend
              </p>
              {Number(booking?.estimated_price) > 0 ? (
                <button
                  type="button"
                  onClick={() => setFinalPrice(String(booking.estimated_price))}
                  className="mt-1.5 text-[11px] font-semibold text-amber-600 underline-offset-2 hover:underline"
                >
                  Use estimated price
                </button>
              ) : null}
            </div>

            <Field label="Final quote (₹)" required htmlFor="enquiry-final-price">
              <div className="relative">
                <BadgeIndianRupee
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <input
                  id="enquiry-final-price"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={finalPrice}
                  onChange={(e) => setFinalPrice(e.target.value)}
                  placeholder="e.g. 80000"
                  className={`${inputClass} pl-8 text-[16px] font-bold`}
                />
              </div>
            </Field>
          </div>

          {/* ── Validity ────────────────────────────────────────────────── */}
          <Field label="Quote valid until" htmlFor="enquiry-validity" hint="The backend stores the exact expiry timestamp when the quote is saved.">
            <div className="relative">
              <Timer
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                strokeWidth={2}
                aria-hidden="true"
              />
              <select
                id="enquiry-validity"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                className={`${inputClass} pl-8 font-semibold`}
              >
                {VALIDITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          {/* ── Remarks ─────────────────────────────────────────────────── */}
          <Field label="Internal / customer remarks" htmlFor="enquiry-remarks">
            <textarea
              id="enquiry-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Price includes tolls, loading and unloading charges."
              className={`${inputClass} resize-y font-normal`}
            />
          </Field>

          {/* ── Validation ──────────────────────────────────────────────── */}
          {validation.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5" role="alert">
              <p className="text-[12px] font-bold uppercase tracking-wider text-amber-800">Before you continue</p>
              <ul className="mt-1.5 space-y-1">
                {validation.map((issue) => (
                  <li key={issue} className="flex items-start gap-1.5 text-[12.5px] text-amber-900">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={2} aria-hidden="true" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sendError ? (
            <Notice tone="error">
              <span className="font-semibold">Not saved.</span> {sendError}
            </Notice>
          ) : null}

          {sendSuccess ? (
            <Notice tone="success">
              <span className="font-semibold">{sendSuccess}.</span>{' '}
              {isPreparedStage
                ? 'The customer can now review, accept or reject this quote from their tracking page.'
                : 'Send it to the customer when you are ready.'}
            </Notice>
          ) : null}

          {/* ── Primary action — decided by the DATABASE stage ─────────── */}
          <PrimaryButton
            onClick={() => handleSubmit(isPreparedStage)}
            disabled={sending}
            className={`w-full py-3 text-[14px] ${sending ? 'cursor-wait' : ''}`}
          >
            {sending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {isPreparedStage ? 'Sending quote…' : 'Preparing quote…'}
              </>
            ) : isPreparedStage ? (
              <>
                <Send className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                Send Quote to Customer
              </>
            ) : (
              <>
                <ClipboardCheck className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                Prepare Quote
              </>
            )}
          </PrimaryButton>

          {/* Secondary action, only meaningful once a quote exists. */}
          {isPreparedStage ? (
            <GhostButton onClick={() => handleSubmit(false)} disabled={sending} className="w-full">
              Save changes without sending
            </GhostButton>
          ) : null}

          {externalNotice}

          {/* ── THE BOUNDARY, stated on the card itself ───────────────────
            A customer accepting this price does NOT hire a vehicle, and this
            amount is NEVER a hire amount, a vendor payable or a commission.
            Those belong to the Vehicle Hire workflow. */}
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            The booking is not confirmed until the customer accepts. This amount is the customer
            transport price only — vehicle hire money is agreed separately in the Vehicle Hire
            workspace.
          </p>
        </div>
      )}
    </Panel>
  );
}
