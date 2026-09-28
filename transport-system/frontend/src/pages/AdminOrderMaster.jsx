/**
 * AdminOrderMaster.jsx
 * ---------------------------------------------------------------------------
 * ORDER / TRIP MASTER — the single control centre for one shipment.
 * Route: /admin/bookings/:bookingNumber
 *
 * ARCHITECTURE (spec §20 — no new backend system)
 *   This page is a VIEW over records that already exist. It creates no table,
 *   no endpoint and no calculation of its own:
 *
 *     GET /api/admin/bookings/by-number/:n   → the order master
 *                                           (customer, route, goods, vehicle,
 *                                            driver, owner, partner, commercial,
 *                                            quote, delivery — already flattened
 *                                            by BookingMapper)
 *     GET /api/admin/bookings/:id/trip-draft → the linked Trip (if any)
 *     GET /api/trips/:bookingId/financial    → CANONICAL money
 *                                           (amountReceived, outstandingAmount,
 *                                            paymentStatus)
 *     GET /api/trips/:bookingId/transactions/balances → additional charges
 *
 *   Lifecycle stage is NOT computed here — it comes from utils/orderStatus.js,
 *   the single mapping module (spec §21).
 *
 * Every figure below comes from those responses. Where the backend has not
 * recorded something (most bookings have no trip yet, and therefore no expenses
 * and no POD), the page says so honestly instead of inventing a value.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Receipt,
  IndianRupee,
  MapPin,
  Package,
  Truck,
  User,
  Building2,
  Route as RouteIcon,
  CreditCard,
  History,
  ClipboardList,
  Phone,
  Settings2,
  FileText,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import OrderLifecycle from '../components/admin-premium/orders/OrderLifecycle';
import {
  SectionCard,
  Field,
  Badge,
  StatusCard,
  MoneyRow,
  ActionButton,
  EmptyNote,
  BRAND,
} from '../components/admin-premium/orders/orderUi';
import { resolveOrder, resolvePaymentState } from '../utils/orderStatus';
import {
  inr,
  distance,
  formatDate,
  formatDateTime,
  formatClock,
  place,
  na,
  qtyWithUnit,
} from '../utils/orderFormat';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

/** Error-tolerant GET: a 404 on a supplementary call must not blank the page. */
async function safeGet(promise) {
  try {
    const res = await promise;
    return res?.data?.success === false ? null : res?.data?.data ?? null;
  } catch {
    return null;
  }
}

export default function AdminOrderMaster() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [trip, setTrip] = useState(null);
  const [balances, setBalances] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async ({ silent } = {}) => {
      if (!bookingNumber) return;
      silent ? setRefreshing(true) : setLoading(true);
      try {
        const res = await adminAPI.getBookingByNumber(bookingNumber);
        if (!res?.data?.success) throw new Error(res?.data?.message || 'Order not found');
        const row = res.data.data;
        setOrder(row);
        setError(null);

        // Supplementary calls run in parallel and are individually fault-tolerant:
        // a booking without a trip must still render a complete order header.
        const [fin, draft, bal, tl] = await Promise.all([
          safeGet(adminAPI.getTripFinancial(row.booking_id)),
          safeGet(adminAPI.getTripDraft(row.booking_id)),
          safeGet(adminAPI.getTripPartyBalances(row.booking_id)),
          safeGet(adminAPI.getTripFinancialTimeline(row.booking_id)),
        ]);
        setFinancial(fin);
        setTrip(draft?.existing_trip || null);
        setBalances(bal);
        setEvents(Array.isArray(tl) ? tl : []);
      } catch (e) {
        setError(e.message || 'Could not load this order');
        setOrder(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [bookingNumber]
  );

  useEffect(() => {
    load();
  }, [load]);

  const resolved = useMemo(() => (order ? resolveOrder(order, trip) : null), [order, trip]);

  // Payment truth comes from the canonical financial API when it exists, and
  // only falls back to the booking row otherwise.
  const payment = useMemo(() => {
    if (financial && (financial.paymentStatus || financial.outstandingAmount != null)) {
      const billing = Number(financial.customerFare) || Number(order?.final_price) || 0;
      const received = Number(financial.amountReceived) || 0;
      const state =
        financial.paymentStatus === 'PAID' || (billing > 0 && received >= billing)
          ? { key: 'PAID', label: 'Paid', tone: 'success' }
          : financial.paymentStatus === 'PARTIAL' || received > 0
            ? { key: 'PARTIAL', label: 'Partially Paid', tone: 'warning' }
            : { key: 'PENDING', label: 'Pending', tone: 'neutral' };
      return { ...state, billing, received, due: Number(financial.outstandingAmount) || 0 };
    }
    const billing = Number(order?.final_price ?? order?.estimated_price) || 0;
    const state = resolvePaymentState(order);
    return { ...state, billing, received: 0, due: billing };
  }, [financial, order]);

  if (loading) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
        <div className="space-y-4">
          <LoadingSkeleton className="h-32 w-full rounded-2xl" />
          <LoadingSkeleton className="h-24 w-full rounded-2xl" />
          <LoadingSkeleton className="h-64 w-full rounded-2xl" />
        </div>
      </AdminShell>
    );
  }

  if (error || !order) {
    return (
      <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <h1 className="text-lg font-bold text-red-800">Order unavailable</h1>
          <p className="mt-1 text-sm text-red-700">{error || 'Not found'}</p>
          <button
            type="button"
            onClick={() => navigate('/admin/bookings')}
            className="mt-4 rounded-xl bg-[#15345B] px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Order Master
          </button>
        </div>
      </AdminShell>
    );
  }

  const orderNo = order.booking_number || order.booking_reference || bookingNumber;
  const o = order;

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
      <div className="mx-auto max-w-none space-y-4">
        {/* ── Page title + actions ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="bt-page-title">Order / Trip Master</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Manage the complete shipment lifecycle, commercial details, vehicle assignment and
              delivery operations from one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={ArrowLeft} onClick={() => navigate('/admin/bookings')}>
              All Orders
            </ActionButton>
            <ActionButton
              icon={RefreshCw}
              onClick={() => load({ silent: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </ActionButton>
            <ActionButton icon={Settings2} onClick={() => navigate(`/admin/bookings/${orderNo}/assign-driver`)}>
              Change Driver
            </ActionButton>
            {/* Print uses the browser's own renderer — no PDF library, no new
                backend document job, and it always reflects the live DOM. */}
            <ActionButton icon={FileText} onClick={() => window.print()}>
              Print
            </ActionButton>
          </div>
        </div>

        {/* ── Order header ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-mono text-xl font-bold tracking-tight text-slate-900">
                      ORDER #{orderNo}
                </h2>
                <Badge tone={resolved.state === 'blocked' ? 'danger' : 'brand'}>
                  Order {resolved.stageLabel}
                </Badge>
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                <div>
                  <dt className="inline font-semibold">Created: </dt>
                  <dd className="inline">{formatDateTime(o.created_at)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Last Updated: </dt>
                  <dd className="inline">{formatDateTime(o.updated_at)}</dd>
                </div>
                {trip?.trip_number ? (
                  <div>
                    <dt className="inline font-semibold">Trip: </dt>
                    <dd className="inline font-mono">{trip.trip_number}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums tracking-tight text-[#15345B]">
                {inr(payment.billing)}
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Total Billing Amount
              </p>
              <div className="mt-1.5">
                <Badge tone={payment.tone}>Payment: {payment.label}</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* ── Lifecycle ────────────────────────────────────────────────── */}
        <OrderLifecycle resolved={resolved} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* ══ MAIN COLUMN ══════════════════════════════════════════════ */}
          <div className="min-w-0 space-y-4">
            {/* Order information */}
            <SectionCard title="Order Information" icon={ClipboardList}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                <Field label="Order Number" value={orderNo} mono />
                <Field label="Date" value={formatDate(o.pickup_date)} />
                <Field
                  label="Party"
                  value={place(o.customer_first_name, o.customer_last_name)}
                />
                <Field
                  label="Contact Person"
                  value={na(o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}`.trim() : null)}
                />
                <Field label="Mobile" value={na(o.customer_phone)} />
                <Field label="Email" value={na(o.customer_email)} />
                <Field label="Trip Type" value="One Way" />
                <Field label="Trip Date" value={formatDate(o.pickup_date)} />
                <Field label="Trip Time" value={formatClock(o.pickup_time)} />
                <Field
                  label="Expected Delivery"
                  value={formatDate(o.estimated_delivery_time || o.delivered_at)}
                />
                <Field label="Confirmation Source" value={na(o.confirmation_source)} />
                <Field label="Quote Valid Until" value={formatDate(o.quote_valid_until)} />
              </dl>
            </SectionCard>

            {/* Route */}
            <SectionCard title="Shipment Details" icon={RouteIcon}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    Pickup
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-800">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    {place(o.pickup_location, o.pickup_city, o.pickup_state)}
                  </p>
                  {o.pickup_address ? (
                    <p className="mt-1 pl-6 text-xs text-slate-500">{o.pickup_address}</p>
                  ) : null}
                  <p className="mt-1.5 pl-6 text-xs text-slate-500">
                    {formatDate(o.pickup_date)} · {formatClock(o.pickup_time)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
                    Drop
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-800">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                    {place(o.drop_location, o.drop_city, o.drop_state)}
                  </p>
                  {o.drop_address ? (
                    <p className="mt-1 pl-6 text-xs text-slate-500">{o.drop_address}</p>
                  ) : null}
                  <p className="mt-1.5 pl-6 text-xs text-slate-500">
                    Expected {formatDate(o.estimated_delivery_time)}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
                <Field label="Distance" value={distance(o.estimated_distance_km)} />
                <Field label="Trip Type" value="One Way" />
                <Field label="Trip Date" value={formatDate(o.pickup_date)} />
                <Field label="Expected Delivery" value={formatDate(o.estimated_delivery_time)} />
              </dl>
            </SectionCard>

            {/* Goods */}
            <SectionCard title="Goods Details" icon={Package}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Field label="Goods" value={na(o.goods_description)} />
                <Field label="Goods Type" value={na(o.goods_type)} />
                <Field label="Quantity" value={qtyWithUnit(o.number_of_items, o.quantity_unit)} />
                <Field label="Weight" value={qtyWithUnit(o.goods_weight_kg, o.weight_unit)} />
                <Field label="Volume" value={na(o.goods_volume)} />
                <Field label="Vehicle Type Required" value={na(o.vehicle_type_required)} />
                <Field label="Fragile" value={o.fragile ? 'Yes' : 'No'} />
                <Field
                  label="Vehicle Size"
                  value={na(o.vehicle_type || o.vehicle_name)}
                />
                <Field label="Remarks" value={na(o.special_instructions)} />
              </dl>
            </SectionCard>

            {/* Commercial */}
            <SectionCard title="Commercial Details" icon={Receipt}>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Field label="Payment Terms" value={na(o.payment_terms || 'Not recorded')} />
                  <Field label="Rate As Per" value={na(o.rate_basis || 'Per Trip')} />
                  <Field label="Quote Status" value={na(o.quote_status)} />
                  <Field label="Quote Remarks" value={na(o.quote_remarks)} />
                </dl>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <MoneyRow label="Estimated Freight" value={inr(o.estimated_price)} />
                  <MoneyRow label="Final Freight" value={inr(o.final_price)} />
                  {financial && Number(financial.driverPayout) > 0 ? (
                    <MoneyRow label="Driver Payout" value={inr(financial.driverPayout)} />
                  ) : null}
                  {financial && Number(financial.btMargin) > 0 ? (
                    <MoneyRow label="BT Margin" value={inr(financial.btMargin)} />
                  ) : null}
                  <MoneyRow label="Total Billing" value={inr(payment.billing)} emphasis />
                </div>
              </div>
            </SectionCard>

            {/* Additional charges — real TripExpense figures only */}
            <SectionCard
              title="Additional Charges"
              icon={IndianRupee}
              subtitle={
                trip ? 'Recorded trip expenses' : 'No trip is linked to this order yet, so there are no trip expenses'
              }
            >
              {balances?.expenses?.byType && Object.keys(balances.expenses.byType).length > 0 ? (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 font-semibold">Charge</th>
                        <th className="py-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(balances.expenses.byType).map(([type, amount]) => (
                        <tr key={type} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 capitalize text-slate-700">{type.replace(/_/g, ' ')}</td>
                          <td className="py-2 text-right font-semibold tabular-nums text-slate-800">
                            {inr(amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 rounded-xl bg-slate-50/70 p-4">
                    <MoneyRow label="Total Additional Charges" value={inr(balances.expenses.total)} />
                    <MoneyRow label="Total Billing Amount" value={inr(payment.billing)} emphasis />
                  </div>
                </>
              ) : (
                <EmptyNote>No additional charges have been recorded against this order.</EmptyNote>
              )}
            </SectionCard>

            {/* Vehicle & driver */}
            <SectionCard title="Vehicle & Driver" icon={Truck}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Vehicle
                  </p>
                  <p className="mt-1.5 font-mono text-sm font-bold text-slate-800">
                    {na(o.vehicle_number || o.truck_number_snapshot)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{na(o.vehicle_name)}</p>
                  <p className="text-xs text-slate-500">Type: {na(o.vehicle_type)}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    Owner: {na(o.vehicle_owner_name || o.owner_name_snapshot || o.assigned_owner_name)}
                  </p>
                  {o.vehicle_owner_phone ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <Phone className="h-3 w-3" aria-hidden="true" />
                      {o.vehicle_owner_phone}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/vehicles')}>View Vehicle</ActionButton>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Driver
                  </p>
                  <p className="mt-1.5 text-sm font-bold text-slate-800">
                    {na(o.driver_name_snapshot || o.driver_first_name)}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <Phone className="h-3 w-3" aria-hidden="true" />
                    {na(o.driver_phone)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Assigned: {formatDateTime(o.driver_assigned_at)}
                  </p>
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/drivers')}>View Driver</ActionButton>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Transport Partner
                  </p>
                  <p className="mt-1.5 text-sm font-bold text-slate-800">
                    {na(o.partner_name || o.partner_owner_name)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {o.partner_id ? `Partner ID ${o.partner_id}` : 'No partner on this order'}
                  </p>
                  <div className="mt-3">
                    <ActionButton onClick={() => navigate('/admin/owners')}>View Owner</ActionButton>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Operational status */}
            <SectionCard title="Operational Status" icon={Settings2}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatusCard
                  title="Vehicle Status"
                  icon={Truck}
                  status={o.vehicle_id ? 'Hired' : 'Pending'}
                  tone={o.vehicle_id ? 'success' : 'neutral'}
                  meta={[o.vehicle_number, formatDateTime(o.driver_assigned_at)]}
                />
                <StatusCard
                  title="Loading Status"
                  status={o.delivery_current_status === 'pickup_completed' ? 'Completed' : 'Pending'}
                  tone={o.delivery_current_status === 'pickup_completed' ? 'success' : 'neutral'}
                  meta={[place(o.pickup_location), formatDateTime(o.actual_pickup_time)]}
                />
                <StatusCard
                  title="Dispatch Status"
                  status={o.status === 'in_transit' ? 'Dispatched' : 'Pending'}
                  tone={o.status === 'in_transit' ? 'success' : 'neutral'}
                  meta={[formatDateTime(o.actual_pickup_time)]}
                />
                <StatusCard
                  title="Delivery Status"
                  status={o.delivery_current_status === 'delivered' ? 'Delivered' : 'Pending'}
                  tone={o.delivery_current_status === 'delivered' ? 'success' : 'neutral'}
                  meta={[place(o.drop_location), formatDateTime(o.actual_delivery_time)]}
                />
                <StatusCard
                  title="POD Status"
                  status={o.otp_verified ? 'Verified' : 'Pending'}
                  tone={o.otp_verified ? 'success' : 'neutral'}
                  meta={[o.recipient_name ? `Received by ${o.recipient_name}` : null]}
                />
                <StatusCard
                  title="Payment Status"
                  icon={CreditCard}
                  status={payment.label}
                  tone={payment.tone}
                  meta={[`Due ${inr(payment.due)}`]}
                />
              </div>
            </SectionCard>

            {/* Operations */}
            <SectionCard title="Operations" icon={RouteIcon}>
              <ol className="space-y-0">
                {[
                  {
                    k: 'Loading',
                    s:
                      o.delivery_current_status === 'pickup_completed'
                        ? 'Completed'
                        : o.delivery_current_status === 'pickup_in_progress'
                          ? 'In progress'
                          : 'Pending',
                    d: place(o.pickup_location),
                    w: `${formatDate(o.pickup_date)}, ${formatClock(o.pickup_time)}`,
                    a: o.actual_pickup_time,
                  },
                  {
                    k: 'Dispatch',
                    s: o.status === 'in_transit' ? 'Dispatched' : 'Pending',
                    d: 'Expected departure',
                    w: `${formatDate(o.pickup_date)}, ${formatClock(o.pickup_time)}`,
                    a: o.actual_pickup_time,
                  },
                  {
                    k: 'Transit',
                    s: o.status === 'in_transit' ? 'In transit' : 'Not started',
                    d: place(o.pickup_city, '→', o.drop_city),
                    w: distance(o.estimated_distance_km),
                    a: null,
                  },
                  {
                    k: 'Delivery',
                    s: o.delivery_current_status === 'delivered' ? 'Delivered' : 'Pending',
                    d: place(o.drop_location),
                    w: formatDate(o.estimated_delivery_time),
                    a: o.actual_delivery_time,
                  },
                  {
                    k: 'POD',
                    s: o.otp_verified ? 'Verified' : 'Pending',
                    d: o.otp_verified ? 'Proof of delivery captured' : 'Awaiting delivery OTP',
                    w: o.delivery_otp ? `OTP ${o.delivery_otp}` : null,
                    a: o.actual_delivery_time,
                  },
                ].map((row, i, arr) => (
                  <li key={row.k} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2.5 w-2.5 rounded-full ${
                          row.s === 'Pending' || row.s === 'Not started'
                            ? 'bg-slate-300'
                            : 'bg-emerald-500'
                        }`}
                      />
                      {i < arr.length - 1 ? <span className="w-px flex-1 bg-slate-200" /> : null}
                    </div>
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{row.k}</p>
                        <Badge
                          tone={
                            row.s === 'Pending' || row.s === 'Not started' ? 'neutral' : 'success'
                          }
                        >
                          {row.s}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{row.d}</p>
                      {row.w ? <p className="text-xs text-slate-400">{row.w}</p> : null}
                      {row.a ? (
                        <p className="mt-0.5 text-xs font-medium text-emerald-700">
                          Actual: {formatDateTime(row.a)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>

            {/* Payment */}
            <SectionCard title="Payment & Collection" icon={CreditCard}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Billing Amount
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-800">
                    {inr(payment.billing)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Amount Received
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-emerald-700">
                    {inr(payment.received)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Balance Due
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-[#D98C0B]">
                    {inr(payment.due)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={payment.tone}>{payment.label}</Badge>
                {financial ? (
                  <span className="text-xs text-slate-500">
                    Source: canonical trip financial ledger
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    No trip financial record yet — showing order value
                  </span>
                )}
                <div className="ml-auto">
                  <ActionButton
                    variant="primary"
                    onClick={() => navigate('/admin/financials')}
                  >
                    Record Payment
                  </ActionButton>
                </div>
              </div>
            </SectionCard>

            {/* Activity */}
            <SectionCard title="Order Activity" icon={History}>
              {events.length ? (
                <ol className="space-y-3">
                  {events.map((ev, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{ev.event}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(ev.timestamp)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyNote>No recorded events for this order yet.</EmptyNote>
              )}
            </SectionCard>
          </div>

          {/* ══ STICKY SUMMARY ═══════════════════════════════════════════ */}
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700">
                Order Summary
              </h2>
              <dl className="mt-4 space-y-3">
                {[
                  { k: 'Order', v: orderNo, mono: true },
                  { k: 'Customer', v: place(o.customer_first_name, o.customer_last_name) },
                  { k: 'Route', v: `${na(o.pickup_location)} → ${na(o.drop_location)}` },
                  { k: 'Vehicle', v: na(o.vehicle_number || o.truck_number_snapshot), mono: true },
                  { k: 'Driver', v: na(o.driver_name_snapshot || o.driver_first_name) },
                  { k: 'Total', v: inr(payment.billing) },
                  { k: 'Paid', v: inr(payment.received) },
                  { k: 'Balance', v: inr(payment.due) },
                ].map((row) => (
                  <div key={row.k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {row.k}
                    </dt>
                    <dd
                      className={`min-w-0 truncate text-sm font-semibold text-slate-800 ${
                        row.mono ? 'font-mono tabular-nums' : ''
                      }`}
                      title={String(row.v)}
                    >
                      {row.v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Current Status
                </p>
                <div className="mt-1.5">
                  <Badge tone={resolved.state === 'blocked' ? 'danger' : 'warning'}>
                    {resolved.stageLabel}
                  </Badge>
                </div>

                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Next Action
                </p>
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {resolved.state === 'blocked' ? resolved.blockedReason : resolved.nextAction}
                </p>

                <button
                  type="button"
                  onClick={() => load({ silent: true })}
                  className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#102B4C]"
                  style={{ backgroundColor: BRAND.navy }}
                >
                  Update Order
                </button>
              </div>
            </div>

            {/* Customer card — the "who is the customer" answer, always visible. */}
            <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
              <h3 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700">
                <User className="h-4 w-4 text-slate-400" aria-hidden="true" /> Customer
              </h3>
              <p className="mt-3 text-sm font-semibold text-slate-800">
                {place(o.customer_first_name, o.customer_last_name)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{na(o.customer_email)}</p>
              <p className="mt-0.5 text-xs text-slate-500">{na(o.customer_phone)}</p>
              {o.customer_address ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                  <Building2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  {o.customer_address}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
