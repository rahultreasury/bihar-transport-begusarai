/**
 * AdminEnquiries.jsx
 * ---------------------------------------------------------------------------
 * ENQUIRY — the admin operations console for pre-booking customer requests.
 * Route: /admin/enquiries
 *
 * This is an OPERATIONS screen, not a customer screen: dense, filterable, and
 * built for scanning many rows quickly.
 *
 * PRESENTATION-ONLY
 *   The data path is untouched. This screen still reads exactly the same two
 *   existing endpoints through the existing `adminEnquiryAPI` client:
 *     GET /api/admin/enquiries         (list + search + status filter + pagination)
 *     GET /api/admin/enquiries/stats   (per-status counts for the KPI cards and pills)
 *   Row click still navigates to /admin/enquiries/:enquiry_id — the existing
 *   AdminEnquiryWorkspace. No new component, API or query was added, and no
 *   number, id, name, route, price, vehicle or status is hardcoded.
 *
 *   The KPI cards and the filter pills are two presentations of the SAME
 *   `stats` response, so the two rows can never disagree with each other.
 *
 * LAYOUT RHYTHM
 *   Header → KPIs → filters → search → table, each visually connected to the
 *   next. Section spacing is deliberately tight (space-y-4) so the page reads as
 *   one console rather than a stack of loosely related blocks.
 *
 * LIVE UPDATES
 *   Subscribes to the `admin:enquiries` room. A new customer enquiry, a sent
 *   quote, or a customer acceptance re-fetches the current view — the table never
 *   shows a stale status while a customer is waiting on a decision.
 *
 * PRIVACY
 *   Admins see driver mobile numbers here on purpose: dispatch has to be able to
 *   call a driver. The customer-facing surfaces have no access to this DTO.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RefreshCw,
  Filter,
  Inbox,
  AlertCircle,
  CircleDot,
  CheckCircle2,
  XCircle,
  Send,
  Clock,
} from 'lucide-react';

import { adminEnquiryAPI } from '../services/enquiryAPI';
import { useAdminEnquiryRealtime } from '../hooks/useEnquiryRealtime';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { DEFAULT_NAV_ITEMS } from '../components/admin-premium/layout/AdminSidebar';
import {
  formatINR,
  formatFareRange,
  formatShortDate,
  formatTime12,
  withUnit,
  statusLabel,
  statusTone,
} from '../utils/enquiryFormat';

/** Brand tokens — the same navy/orange the admin sidebar uses. */
const NAVY = '#15345B';
const ORANGE = '#F5A000';

/**
 * Status filters. `key` is a value the backend's _mapStatusFilter already
 * understands and `stats[key]` is the count the stats endpoint already returns,
 * so every pill filters server-side AND shows a real number.
 */
const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'ASSIGNMENT_PENDING', label: 'Awaiting Quote' },
  { key: 'AWAITING_CUSTOMER', label: 'Quote Sent' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'CANCELLED', label: 'Rejected' },
  { key: 'CONFIRMED', label: 'Confirmed' },
];

/** The six overview cards — each key is a real chip from GET /admin/enquiries/stats. */
const KPI_CARDS = [
  { key: 'NEW', label: 'New', icon: CircleDot, accent: ORANGE },
  { key: 'ASSIGNMENT_PENDING', label: 'Awaiting Quote', icon: Clock, accent: '#0EA5E9' },
  { key: 'AWAITING_CUSTOMER', label: 'Quote Sent', icon: Send, accent: '#8B5CF6' },
  { key: 'ACCEPTED', label: 'Accepted', icon: CheckCircle2, accent: '#10B981' },
  { key: 'CANCELLED', label: 'Rejected', icon: XCircle, accent: '#EF4444' },
  { key: 'ALL', label: 'Total', icon: Inbox, accent: NAVY },
];

/**
 * Status dot colour per EnquiryStatus. Purely a visual accent for the pill —
 * the pill's own tone still comes from the shared `statusTone()` helper, so the
 * status vocabulary is not duplicated here.
 */
const STATUS_DOT = {
  ENQUIRY_SUBMITTED: 'bg-slate-400',
  ADMIN_REVIEW: 'bg-sky-500',
  ASSIGNMENT_PENDING: 'bg-amber-500',
  QUOTE_READY: 'bg-violet-500',
  AWAITING_CUSTOMER_ACCEPTANCE: 'bg-blue-500',
  CUSTOMER_ACCEPTED: 'bg-emerald-500',
  CONFIRMED: 'bg-emerald-600',
  IN_PROGRESS: 'bg-blue-600',
  COMPLETED: 'bg-emerald-600',
  CUSTOMER_REJECTED: 'bg-red-500',
  CANCELLED: 'bg-red-500',
};

const PAGE_SIZE = 25;

function KpiCard({ card, value, loading }) {
  const Icon = card.icon;
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white py-3 pl-4 pr-3 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: card.accent }}
      />
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          {card.label}
        </p>
      </div>
      {loading ? (
        <div className="mt-1.5 h-6 w-12 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-0.5 text-[26px] font-bold leading-none tabular-nums tracking-tight text-slate-900">
          {Number(value || 0).toLocaleString('en-IN')}
        </p>
      )}
    </div>
  );
}

function TableSkeleton({ rows = 8, cols = 9 }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-t border-slate-100">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3.5">
              <div className="h-3 animate-pulse rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export default function AdminEnquiries() {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, total_pages: 1 });
  const [stats, setStats] = useState({});

  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ data }, { data: statData }] = await Promise.all([
        adminEnquiryAPI.list({
          status: filter,
          search: search || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        adminEnquiryAPI.getStats(),
      ]);
      setRows(data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, total_pages: 1 });
      setStats(statData?.data || {});
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load enquiries');
    } finally {
      setLoading(false);
    }
  }, [filter, search, page]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Live: a new enquiry or a customer decision refreshes the current view.
  const { connected: live } = useAdminEnquiryRealtime({
    onChanged: () => {
      load();
      setConnected(true);
    },
  });
  useEffect(() => setConnected(live), [live]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalLabel = useMemo(() => {
    if (pagination.total === 0) return 'No enquiries';
    const from = (pagination.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(pagination.page * PAGE_SIZE, pagination.total);
    return `${from}–${to} of ${pagination.total}`;
  }, [pagination]);

  return (
    <AdminShell navItems={DEFAULT_NAV_ITEMS} activeKey="enquiries" onNav={(k) => {}}>
      {/* Full width. The permanent 285px sidebar column is gone, so this page
          no longer caps itself at 1600px — it uses every pixel the shell gives
          it. `max-w-none` (no max-width utility) is deliberate. */}
      <div className="w-full max-w-none space-y-4">
        {/* ── Page header (compact) ────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-[28px] font-bold leading-none tracking-tight text-slate-900">
              <Inbox className="h-6 w-6 shrink-0" style={{ color: ORANGE }} aria-hidden="true" />
              ENQUIRY
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
              Manage incoming transport requests, vehicle availability, driver assignment and
              customer quotations.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1">
            {connected && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Live
              </span>
            )}
          </div>
        </header>

        {/* ── Overview KPIs ─────────────────────────────────────────────── */}
        <section aria-label="Enquiry overview">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {KPI_CARDS.map((card) => (
              <KpiCard key={card.key} card={card} value={stats[card.key]} loading={loading} />
            ))}
          </div>
        </section>

        {/* ── Status filter bar (single row, scrolls instead of wrapping) ─ */}
        <section
          aria-label="Filter enquiries by status"
          className="flex items-center gap-2 overflow-x-auto pb-0.5"
        >
          <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
                aria-pressed={active}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? 'text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                style={active ? { backgroundColor: NAVY } : undefined}
              >
                {f.label}
                <span
                  className={`ml-1.5 tabular-nums ${active ? 'text-white/70' : 'text-slate-400'}`}
                >
                  {Number(stats[f.key] || 0).toLocaleString('en-IN')}
                </span>
              </button>
            );
          })}
        </section>

        {/* ── Search + Refresh (same row) ──────────────────────────────── */}
        <section aria-label="Search enquiries" className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search enquiries by ID, customer, mobile, pickup or drop…"
              aria-label="Search enquiries"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-[0_1px_2px_rgba(15,43,85,0.04)] outline-none transition placeholder:text-slate-400 focus:border-[#15345B] focus:ring-2 focus:ring-[#15345B]/10"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,43,85,0.04)] transition-colors hover:bg-slate-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        </section>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
          {/* The scroll lives HERE, on the table wrapper — never on the page.
              A table that is wider than the viewport scrolls inside its own
              container, so the admin chrome and header never shift and the
              document never gains a horizontal scrollbar. */}
          <div className="w-full max-w-none overflow-x-auto">
            {/* min-w is the table's own floor, not a layout reservation: raised
                from 1040px to 1240px so the ten enterprise columns (route,
                customer, vehicle, load, pickup, status, driver, quote, actions)
                get room to breathe now that the sidebar no longer eats 285px. */}
            <table className="w-full min-w-[1240px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-4 py-3">Enquiry ID</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Load</th>
                  <th className="px-4 py-3">Pickup</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Est. Price</th>
                  <th className="px-4 py-3 text-right">Final Quote</th>
                </tr>
              </thead>

              {loading ? (
                <TableSkeleton />
              ) : (
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-14 text-center text-sm text-slate-500">
                        No enquiries match this filter.
                      </td>
                    </tr>
                  )}

                  {rows.map((r) => (
                    <tr
                      key={r.enquiry_id}
                      onClick={() => navigate(`/admin/enquiries/${r.enquiry_id}`)}
                      className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className="font-mono text-[12.5px] font-bold tracking-tight"
                          style={{ color: NAVY }}
                        >
                          {r.enquiry_number}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <p className="max-w-[170px] truncate text-[13.5px] font-semibold text-slate-800">
                          {r.customer_name}
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                          {r.customer_mobile}
                        </p>
                      </td>

                      {/* Route gets the largest share of the reclaimed width —
                          it is the column operators scan first. */}
                      <td className="px-4 py-3">
                        <p className="max-w-[230px] truncate text-[13.5px] text-slate-800">
                          {r.pickup_location}
                        </p>
                        <p className="mt-0.5 max-w-[230px] truncate text-xs text-slate-400">
                          → {r.drop_location}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        {r.assigned_vehicle_number || r.requested_vehicle_name ? (
                          <>
                            <p className="max-w-[150px] truncate text-[13.5px] text-slate-800">
                              {r.requested_vehicle_name || r.assigned_vehicle_type || 'Vehicle'}
                            </p>
                            <p className="mt-0.5 font-mono text-xs text-slate-400">
                              {r.assigned_vehicle_number || ''}
                            </p>
                          </>
                        ) : (
                          <span className="text-[13.5px] text-slate-300">Not assigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <p className="max-w-[150px] truncate text-[13.5px] text-slate-800">
                          {r.material || '—'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {withUnit(r.weight, r.weight_unit) ||
                            withUnit(r.quantity, r.quantity_unit) ||
                            ''}
                        </p>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="text-[13.5px] text-slate-800">
                          {formatShortDate(r.pickup_date)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{formatTime12(r.pickup_time)}</p>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold ${statusTone(
                            r.status
                          )}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${
                              STATUS_DOT[r.status] || 'bg-slate-400'
                            }`}
                          />
                          {statusLabel(r.status)}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right text-[13.5px] text-slate-600">
                        {formatFareRange(r.estimated_price_min, r.estimated_price_max) || '—'}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {r.final_quoted_price != null ? (
                          <span
                            className="text-[13.5px] font-bold tabular-nums"
                            style={{ color: NAVY }}
                          >
                            {formatINR(r.final_quoted_price)}
                          </span>
                        ) : (
                          <span className="text-[13.5px] text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>

          {/* ── Footer / pagination ─────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
            <span>{totalLabel}</span>
            {pagination.total_pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="tabular-nums">
                  {pagination.page} / {pagination.total_pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pagination.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
