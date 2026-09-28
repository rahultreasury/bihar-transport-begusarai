/**
 * QuoteWorkspace.jsx
 * ---------------------------------------------------------------------------
 * "QUOTE & ASSIGNMENT" — the operational core of the enquiry workspace.
 *
 * THIS IS THE ORIGINAL, APPROVED CARD. Its layout, spacing, typography and
 * order are unchanged; only its ACTIONS are now backed by the six-stage
 * workflow API.
 *
 * REAL ENDPOINTS ONLY
 *   Driver   : GET  /api/admin/booking-drivers            (driver + their vehicle)
 *   Vehicle  : GET  /api/admin/vehicles?driver_id=&status= (real available vehicles)
 *   Prepare  : POST /api/admin/bookings/:id/prepare-quote  (UNDER_REVIEW → QUOTE_PREPARED)
 *   Send     : POST /api/admin/bookings/:id/send-quote     (QUOTE_PREPARED → QUOTE_SENT)
 *
 * WHICH BUTTON IS THE PRIMARY ONE IS DECIDED BY THE DATABASE
 *   At stage 2 the primary button is "Prepare Quote" (saves the draft, notifies
 *   nobody). At stage 3 it is "Send Quote to Customer". The stage comes from
 *   stageForBooking(), never from local state.
 *
 * The send payload matches the existing backend contract exactly:
 *   { driver_id (required), vehicle_id (optional), final_price (required),
 *     quote_validity_hours, remarks }
 *
 * Pricing is never recomputed here. The estimated price is whatever the backend
 * already calculated for this booking; the admin only sets the final amount.
 * Success is only ever reported when the real API call resolves.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeIndianRupee,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  MapPinned,
  Send,
  Timer,
  Truck,
  UserRound,
} from 'lucide-react';

import { adminAPI } from '../../../services/api';
import DriverPickerModal from './DriverPickerModal';
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
import {
  apiErrorMessage,
  assignedDriverName,
  assignedVehicleNumber,
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
  onAssigned,
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

  const [driver, setDriver] = useState(null);
  const [driverId, setDriverId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState(null);
  const [vehicleId, setVehicleId] = useState('');

  const [finalPrice, setFinalPrice] = useState('');
  const [validity, setValidity] = useState('24');
  const [remarks, setRemarks] = useState('');

  const [sending, setSending] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendSuccess, setSendSuccess] = useState(null);
  const [validation, setValidation] = useState([]);

  const bookingKey = booking?.booking_id;

  /* Re-seed the form from PERSISTED state, not from anything the browser held. */
  useEffect(() => {
    if (!booking) return;
    setDriver(null);
    setDriverId(booking.driver_id || null);
    setVehicleId('');
    setVehicles([]);
    setVehiclesError(null);
    setFinalPrice(booking.final_price ? String(booking.final_price) : '');
    setValidity('24');
    setRemarks(booking.quote_remarks || '');
    setSendError(null);
    setSendSuccess(null);
    setValidation([]);
  }, [bookingKey, booking]);

  /* Real available vehicles that belong to the selected driver. */
  const loadVehicles = useCallback(async (id) => {
    if (!id) {
      setVehicles([]);
      return;
    }
    setVehiclesLoading(true);
    setVehiclesError(null);
    try {
      const res = await adminAPI.getVehicles({ driver_id: id, status: 'available', limit: 50 });
      setVehicles(res?.data?.data || []);
    } catch (err) {
      setVehiclesError(apiErrorMessage(err, 'Unable to load vehicles for this driver.'));
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!editable) {
      setVehicles([]);
      return;
    }
    loadVehicles(driverId);
  }, [driverId, editable, loadVehicles]);

  const driverVehicle = driver?.vehicle || null;
  const effectiveVehicleId =
    vehicleId || (driverVehicle?.vehicle_id ? String(driverVehicle.vehicle_id) : '');

  /**
   * SELECTING A DRIVER IS A REAL, PERSISTED OPERATION.
   *
   * It used to be `setDriver(...)` + `setDriverId(...)` only — pure React
   * state — so the assignment vanished on the next render, the next workflow
   * step, and any browser refresh. The database was never written.
   *
   * It now calls the canonical assignment endpoint
   * (POST /api/admin/bookings/:id/assign-driver), which persists
   * driver_id + the vehicle resolved from the driver's registered vehicle +
   * the owner/partner on the booking row, and then re-reads the booking.
   * The summary below is rendered from that re-read, not from local state.
   */
  const handleSelectDriver = useCallback(
    async (picked) => {
      if (!picked?.driver_id || !booking?.booking_id) return;

      setAssigning(true);
      setSendError(null);
      setSendSuccess(null);
      setPickerOpen(false);

      try {
        const res = await adminAPI.assignBookingDriver(booking.booking_id, {
          driver_id: picked.driver_id,
          // Optional override: only sent when the admin explicitly picked a
          // different vehicle than the driver's registered one.
          ...(picked.vehicle?.vehicle_id ? { vehicle_id: picked.vehicle.vehicle_id } : {}),
        });

        if (!res?.data?.success) {
          setSendError(res?.data?.message || 'The server could not save this driver.');
          return;
        }

        // Keep the picked driver for the label only; every displayed fact is
        // re-read from the booking by onAssigned() below.
        setDriver(picked);
        setDriverId(picked.driver_id);
        setVehicleId(picked?.vehicle?.vehicle_id ? String(picked.vehicle.vehicle_id) : '');
        setSendSuccess('Driver assigned and saved.');
        await onAssigned?.();
      } catch (err) {
        setSendError(
          apiErrorMessage(err, 'Unable to assign driver. Please try again.'),
        );
      } finally {
        setAssigning(false);
      }
    },
    [booking?.booking_id, onAssigned],
  );

  /**
   * The ONLY normal action that removes an assignment. It calls the same
   * endpoint with `clear: true` so the database is updated too — clearing only
   * local state would leave the booking still assigned after a refresh.
   */
  const clearDriver = useCallback(async () => {
    if (!booking?.booking_id) return;
    setAssigning(true);
    setSendError(null);
    setSendSuccess(null);
    try {
      const res = await adminAPI.assignBookingDriver(booking.booking_id, { clear: true });
      if (!res?.data?.success) {
        setSendError(res?.data?.message || 'The server could not clear this assignment.');
        return;
      }
      setDriver(null);
      setDriverId(null);
      setVehicleId('');
      setSendSuccess('Assignment cleared.');
      await onAssigned?.();
    } catch (err) {
      setSendError(apiErrorMessage(err, 'Unable to clear the assignment. Please try again.'));
    } finally {
      setAssigning(false);
    }
  }, [booking?.booking_id, onAssigned]);

  /* Validation mirrors the backend's own contract for both endpoints. */
  const computeValidation = useCallback(() => {
    if (!booking) return [];
    const issues = [];
    const price = Number(finalPrice);
    if (!finalPrice || !Number.isFinite(price) || price <= 0) {
      issues.push('Enter a final quote amount greater than ₹0.');
    }
    if (!driverId) {
      issues.push('Select a driver — the quote API requires one.');
    }
    if (!validity || Number(validity) <= 0) {
      issues.push('Choose how long this quote stays valid.');
    }
    return issues;
  }, [booking, finalPrice, driverId, validity]);

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
          driver_id: driverId,
          final_price: Number(finalPrice),
          quote_validity_hours: Number(validity),
          remarks: remarks.trim() ? remarks.trim() : null,
        };
        if (effectiveVehicleId) payload.vehicle_id = Number(effectiveVehicleId);

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
    [booking, computeValidation, driverId, finalPrice, validity, remarks, effectiveVehicleId, onSent],
  );

  const estimated = booking?.estimated_price ? inr(booking.estimated_price) : '—';

  const readOnlyDriverName = assignedDriverName(booking);
  const readOnlyVehicle = assignedVehicleNumber(booking);

  /**
   * THE DATABASE IS THE SOURCE OF TRUTH FOR WHAT IS DISPLAYED.
   *
   * The `driver` object from the picker is used only for the driver code and
   * as an instant label. Name, phone, vehicle and owner/partner all come from
   * the booking row, which is re-read from the API after every mutation — that
   * is what makes the assignment survive a refresh, a workflow step change and
   * navigating away and back.
   */
  const assignmentSummary = useMemo(() => {
    const persistedName =
      readOnlyDriverName || (driver ? driver.driver_name || `Driver #${driver.driver_id}` : null);

    // The persisted relation wins; the picker's payload is only a bridge for
    // the instant between choosing and the re-read landing.
    const persistedVehicle =
      booking?.vehicle_number || readOnlyVehicle || driverVehicle?.vehicle_number || null;

    return {
      name: persistedName,
      phone: booking?.mobile_snapshot || driver?.mobile || booking?.driver_phone || null,
      vehicle: persistedVehicle || 'No vehicle assigned to this driver',
      vehicleType: booking?.vehicle_type || driverVehicle?.vehicle_type || null,
      owner:
        booking?.assigned_owner_name ||
        booking?.owner_name_snapshot ||
        driver?.owner_name ||
        driver?.owner?.owner_name ||
        driver?.partner?.partner_name ||
        null,
    };
  }, [driver, driverVehicle, readOnlyDriverName, readOnlyVehicle, booking]);

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
    <Panel title="Quote & Assignment" icon={FileText} subtitle="Assign resources, set the final quote and publish it to the customer">
      {/* ── Current assignment — read from the persisted booking row ───── */}
      <div className="mb-4 rounded-lg border border-border bg-slate-50/70 p-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Current assignment</p>
        {assignmentSummary.name || assignmentSummary.vehicle ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
            <div className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Driver</dt>
              <dd className="truncate font-semibold text-text">{assignmentSummary.name || 'Not assigned'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Driver phone</dt>
              <dd className="truncate text-text">{assignmentSummary.phone || '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Vehicle</dt>
              <dd className="truncate font-semibold text-text">
                {assignmentSummary.vehicle}
                {assignmentSummary.vehicleType ? (
                  <span className="ml-1.5 font-normal text-muted">
                    · {String(assignmentSummary.vehicleType).replace(/_/g, ' ')}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Owner / partner</dt>
              <dd className="truncate text-text">{assignmentSummary.owner || '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-muted">No driver assigned yet.</p>
        )}
      </div>

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
          {/* ── Driver ─────────────────────────────────────────────────── */}
          <Field label="Driver" required htmlFor="enquiry-driver-button" hint="One driver, one vehicle — the vehicle below is resolved from the driver you choose.">
            {driverId ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-text">
                    {assignmentSummary.name}
                    {driver?.driver_code ? (
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-muted">
                        {driver.driver_code}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[11.5px] text-muted">
                    {assigning ? 'Saving assignment…' : `${assignmentSummary.phone || '—'} · ${assignmentSummary.vehicle}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <GhostButton
                    onClick={() => setPickerOpen(true)}
                    disabled={assigning}
                    className="px-2 py-1 text-[12px]"
                  >
                    Change
                  </GhostButton>
                  {/* Shown whenever a driver is PERSISTED, not only when the
                      picker happens to be holding one — after a refresh the
                      local `driver` is null but the assignment is real, and
                      "Clear" must still be reachable. */}
                  {assignmentSummary.name ? (
                    <GhostButton
                      onClick={clearDriver}
                      disabled={assigning}
                      className="px-2 py-1 text-[12px]"
                    >
                      Clear
                    </GhostButton>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                id="enquiry-driver-button"
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={assigning}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50/40 px-3 py-2.5 text-[13px] font-bold text-amber-700 transition hover:bg-amber-50"
              >
                <UserRound className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                {assigning ? 'Saving assignment…' : 'Search & select driver'}
              </button>
            )}
          </Field>

          {/* ── Vehicle ─────────────────────────────────────────────────── */}
          <Field
            label="Vehicle"
            htmlFor="enquiry-vehicle-select"
            hint="Real fleet vehicles registered to this driver. Leave on auto to use the driver's registered vehicle."
          >
            {!driverId ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted">
                Select a driver to load their available vehicles.
              </p>
            ) : vehiclesLoading ? (
              <div className="rounded-lg border border-border px-3 py-2.5">
                <LoadingBlock label="Loading vehicles" rows={2} />
              </div>
            ) : vehiclesError ? (
              <ErrorBlock
                message={vehiclesError}
                onRetry={() => loadVehicles(driverId)}
                retryLabel="Retry"
              />
            ) : vehicles.length === 0 ? (
              <EmptyBlock
                title="No fleet vehicle listed"
                subtitle="This driver's own registered vehicle is used automatically when the quote is sent."
              />
            ) : (
              <select
                id="enquiry-vehicle-select"
                value={effectiveVehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className={inputClass}
              >
                <option value="">
                  Auto — use the driver's registered vehicle
                </option>
                {vehicles.map((v) => (
                  <option key={v.vehicle_id} value={v.vehicle_id}>
                    {v.vehicle_number}
                    {v.vehicle_type ? ` · ${String(v.vehicle_type).replace(/_/g, ' ')}` : ''}
                    {v.capacity_kg ? ` · ${v.capacity_kg} kg` : ''}
                    {v.owner_name ? ` · ${v.owner_name}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

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

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
            <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            The booking is not confirmed until the customer accepts. Driver and vehicle are reserved for the
            validity window.
          </p>
        </div>
      )}

      <DriverPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectDriver}
        selectedDriverId={driverId}
      />
    </Panel>
  );
}
