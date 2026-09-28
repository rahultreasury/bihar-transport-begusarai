/**
 * AdminOrders.jsx
 * ---------------------------------------------------------------------------
 * ORDER / TRIP MASTER — the central control list for every shipment, order and
 * trip. Replaces the previous "Bookings" list on /admin/bookings.
 *
 * DATA SOURCE (unchanged): GET /api/admin/bookings — the same endpoint the old
 * page used, with the same server-side search / status / date filters. This page
 * adds a client-side lifecycle filter on top, computed by the shared
 * utils/orderStatus.js mapping so the chips can never disagree with the badges.
 *
 * The row click navigates to /admin/bookings/:bookingNumber, which now renders
 * the Order / Trip Master detail workspace.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  Truck,
  User,
  CalendarDays,
  IndianRupee,
  ChevronRight,
  Loader2,
  AlertCircle,
  LayoutDashboard,
  Package,
  Route,
  Car,
  BarChart3,
  FileText,
  Sparkles,
  Users,
  Inbox,
  ClipboardList,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import OrderKpiStrip from '../components/admin-premium/orders/OrderKpiStrip';
import { Badge, stateTone, EmptyNote, BRAND } from '../components/admin-premium/orders/orderUi';
import { resolveOrder, ORDER_STAGE_FILTERS } from '../utils/orderStatus';
import { inr, routeLine, customerName, formatDate, na } from '../utils/orderFormat';

const PAGE_SIZE = 25;

/** The "Main Menu" / stage chip row. */
const STAGES = [
  { key: 'ALL', label: 'All' },
  ...ORDER_STAGE_FILTERS.filter((f) => f.key !== 'ALL'),
];

export default function AdminOrders() {
  const navigate = useNavigate();

  const [stage, setStage] = useState('ALL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, sort_by: 'created_at', sort_order: 'desc' };
      // Push the search to the server so it filters on the canonical columns
      // (customer, route, vehicle, driver, booking number) rather than in JS.
      if (debounced) params.search = debounced;
      if (status) params.status = status;

      const res = await adminAPI.getBookings(params);
      if (requestId.current !== id) return;

      setRows(res?.data?.data || []);
      setPagination(res?.data?.pagination || { total: 0, pages: 1, page: 1 });
      setError(null);
    } catch (e) {
      if (requestId.current !== id) return;
      setError(e.message || 'Could not load orders');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [page, debounced, status]);

  useEffect(() => {
    load();
  }, [load]);

  // Stage chip counts are derived from the same resolver the rows use.
  const stageCounts = useMemo(() => {
    const counts = { ALL: rows.length };
    for (const r of rows) {
      const key = resolveOrder(r).stageKey;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const visible = useMemo(
    () => (stage === 'ALL' ? rows : rows.filter((r) => resolveOrder(r).stageKey === stage)),
    [rows, stage]
  );

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="bookings">
      <div className="mx-auto max-w-none space-y-4">
        {/* ── Title ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="bt-page-title">Order / Trip Master</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Central control for every shipment, order and trip.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {/* ── KPIs (real, from the returned rows) ──────────────────────── */}
        <OrderKpiStrip rows={rows} loading={loading} />

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order #, customer, route, vehicle or driver…"
                aria-label="Search orders"
                className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#15345B]"
              />
            </div>

            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by backend status"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#15345B]"
            >
              <option value="">All backend statuses</option>
              {['pending', 'confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'completed', 'cancelled'].map(
                (s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                )
              )}
            </select>

            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filter by lifecycle stage"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#15345B]"
            >
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {STAGES.map((s) => {
              const active = stage === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setStage(s.key);
                    setPage(1);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active ? 'text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                  style={active ? { backgroundColor: BRAND.navy } : undefined}
                >
                  {s.label}
                  {stageCounts[s.key] ? (
                    <span
                      className={`ml-1.5 tabular-nums ${active ? 'text-white/70' : 'text-slate-400'}`}
                    >
                      {stageCounts[s.key]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          {error ? (
            <div className="m-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading orders…
            </div>
          ) : visible.length === 0 ? (
            <EmptyNote>No orders match the current filters.</EmptyNote>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 font-semibold">Order</th>
                      <th className="px-4 py-3 font-semibold">Customer</th>
                      <th className="px-4 py-3 font-semibold">Route</th>
                      <th className="px-4 py-3 font-semibold">Vehicle / Driver</th>
                      <th className="px-4 py-3 font-semibold">Trip Date</th>
                      <th className="px-4 py-3 text-right font-semibold">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="w-10 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const res = resolveOrder(r);
                      const no = r.booking_number || r.booking_reference;
                      return (
                        <tr
                          key={r.booking_id}
                          onClick={() => navigate(`/admin/bookings/${no}`)}
                          className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-3">
                            <span className="font-mono text-[13px] font-bold text-slate-800">{no}</span>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {formatDate(r.created_at)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block max-w-[160px] truncate font-medium text-slate-800">
                              {customerName(r)}
                            </span>
                            <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-slate-400">
                              {na(r.goods_description)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block max-w-[190px] truncate text-slate-700">
                              {routeLine(r)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block font-mono text-[12px] font-semibold text-slate-700">
                              {na(r.vehicle_number || r.truck_number_snapshot)}
                            </span>
                            <p className="mt-0.5 max-w-[150px] truncate text-[11px] text-slate-400">
                              {na(r.driver_name_snapshot || r.driver_first_name)}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDate(r.pickup_date)}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                            {inr(r.final_price ?? r.estimated_price)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={stateTone(res.state)}>{res.stageLabel}</Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile / tablet cards (§23) */}
              <div className="divide-y divide-slate-100 lg:hidden">
                {visible.map((r) => {
                  const res = resolveOrder(r);
                  const no = r.booking_number || r.booking_reference;
                  return (
                    <button
                      key={r.booking_id}
                      type="button"
                      onClick={() => navigate(`/admin/bookings/${no}`)}
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[13px] font-bold text-slate-800">{no}</span>
                        <Badge tone={stateTone(res.state)}>{res.stageLabel}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{customerName(r)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{routeLine(r)}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span className="font-mono">
                          {na(r.vehicle_number || r.truck_number_snapshot)}
                        </span>
                        <span className="font-semibold tabular-nums text-slate-800">
                          {inr(r.final_price ?? r.estimated_price)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Pagination ─────────────────────────────────────────────── */}
          {pagination.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>
                Page {pagination.page || page} of {pagination.pages} · {pagination.total} orders
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}
