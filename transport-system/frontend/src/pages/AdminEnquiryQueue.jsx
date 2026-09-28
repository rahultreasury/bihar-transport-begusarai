/**
 * AdminEnquiryQueue.jsx
 * ---------------------------------------------------------------------------
 * /admin/enquiries — the full-page ENQUIRY operations workspace.
 *
 * WHAT THIS IS
 *   An operational VIEW OVER REAL BOOKINGS. The `bookings` table is the single
 *   source of truth for the quote workflow; an "enquiry" here is a booking
 *   whose quote has not been settled yet. There is no second store, no second
 *   table and no local quote state on this page.
 *
 * APIS REUSED (none of these are new)
 *   • Rows + totals : GET /api/admin/bookings?quote_status=…&search=…
 *                     (the same endpoint the Bookings screen uses; KPI and
 *                     chip counts are its real `pagination.total` values)
 *   • Detail        : GET /api/admin/bookings/by-number/:bookingNumber
 *                     → /admin/enquiries/:id (the full quote workspace)
 *   • Live updates  : the existing `admin:enquiries` socket room, which only
 *                     re-reads the list; it never writes anything.
 *
 * Opening an enquiry navigates to the full-page workspace — there is no
 * drawer, no modal and no duplicated quote UI on this screen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Car,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  Route,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';

import { adminAPI } from '../services/api';
import { useAdminEnquiryRealtime } from '../hooks/useEnquiryRealtime';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import EnquiryFilters from '../components/admin-premium/enquiries/EnquiryFilters';
import EnquiryKpiStrip from '../components/admin-premium/enquiries/EnquiryKpiStrip';
import EnquiryTable from '../components/admin-premium/enquiries/EnquiryTable';
import {
  KPI_DEFS,
  STATUS_FILTERS,
  apiErrorMessage,
} from '../components/admin-premium/enquiries/enquiryStatus';

// Mirrors AdminSidebar's DEFAULT_NAV_ITEMS. The `enquiries` key must be present
// for the live pending-count badge to render next to the item.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/admin' },
  { key: 'enquiries', label: 'ENQUIRY', icon: Inbox, path: '/admin/enquiries' },
  { key: 'intake-enquiries', label: 'Enquiry Intake', icon: ClipboardList, path: '/admin/intake-enquiries' },
  { key: 'financials', label: 'Financials', icon: BarChart3, path: '/admin/financials' },
  { key: 'bookings', label: 'Bookings', icon: Package, path: '/admin/bookings' },
  { key: 'trips', label: 'Trips', icon: Route, path: '/admin/trips' },
  { key: 'clients', label: 'Clients', icon: Users, path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: Truck, path: '/admin/owners' },
  { key: 'vehicles', label: 'Vehicles', icon: Car, path: '/admin/vehicles' },
  { key: 'drivers', label: 'Drivers', icon: Users, path: '/admin/drivers' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: Truck, path: '/admin/vehicle-owners' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: FileText, path: '/admin/reports' },
  { key: 'ai', label: 'AI Insights', icon: Sparkles, path: '/admin/ai' },
];

const PAGE_SIZE = 25;

/** Filter key → the `quote_status` value the backend understands. */
const API_STATUS = Object.fromEntries(STATUS_FILTERS.map((f) => [f.key, f.apiValue]));

export default function AdminEnquiryQueue() {
  const navigate = useNavigate();

  const [status, setStatus] = useState('ACTIONABLE');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 0 });
  const [counts, setCounts] = useState(() => Object.fromEntries(STATUS_FILTERS.map((f) => [f.key, null])));
  const [countsLoading, setCountsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards against a slow response from an old filter overwriting a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  /* ── Rows ─────────────────────────────────────────────────────────────── */
  const load = useCallback(async ({ silent } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!silent) setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, sort_by: 'created_at', sort_order: 'desc' };
      const apiStatus = API_STATUS[status];
      if (apiStatus) params.quote_status = apiStatus;
      if (debouncedSearch) params.search = debouncedSearch;

      const res = await adminAPI.getBookings(params);
      if (requestIdRef.current !== requestId) return;

      setRows(res?.data?.data || []);
      setPagination(res?.data?.pagination || { total: 0, pages: 0 });
      setError(null);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(apiErrorMessage(err, 'Unable to load enquiries.'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [status, debouncedSearch, page]);

  /* ── KPI + chip counts: one real COUNT per status group ───────────────── */
  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    const results = await Promise.allSettled(
      STATUS_FILTERS.map((f) =>
        adminAPI.getBookings({
          page: 1,
          limit: 1,
          ...(f.apiValue ? { quote_status: f.apiValue } : {}),
        }),
      ),
    );
    const next = {};
    results.forEach((r, i) => {
      next[STATUS_FILTERS[i].key] =
        r.status === 'fulfilled' ? (r.value?.data?.pagination?.total ?? null) : null;
    });
    setCounts(next);
    setCountsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // A new enquiry, a sent quote or a customer decision re-reads the list.
  useAdminEnquiryRealtime({ enabled: true, onChanged: () => { load({ silent: true }); loadCounts(); } });

  const refreshAll = useCallback(() => {
    load();
    loadCounts();
    // The sidebar badge is a real pending-enquiry count; re-read it too.
    window.dispatchEvent(new Event('enquiry-count:changed'));
  }, [load, loadCounts]);

  const openEnquiry = useCallback(
    (row) => {
      const ref = row?.booking_number || row?.booking_reference;
      if (!ref) return;
      navigate(`/admin/enquiries/${encodeURIComponent(ref)}`);
    },
    [navigate],
  );

  const resultLabel = useMemo(() => {
    if (loading) return 'Loading enquiries…';
    if (error) return null;
    const total = pagination.total || 0;
    if (total === 0) return 'No enquiries in this view.';
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    const label = STATUS_FILTERS.find((f) => f.key === status)?.label || 'All';
    return `Showing ${from}–${to} of ${total.toLocaleString('en-IN')} · ${label}${
      debouncedSearch ? ` · matching “${debouncedSearch}”` : ''
    }`;
  }, [loading, error, pagination.total, page, status, debouncedSearch]);

  return (
    <AdminShell
      navItems={NAV_ITEMS}
      activeKey="enquiries"
      onNav={(k) => {
        if (k === 'bookings') navigate('/admin/bookings');
        if (k === 'dashboard') navigate('/admin');
      }}
    >
      <div className="space-y-4">
        {/* ── Page header ──────────────────────────────────────────────── */}
        <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500">
                <Inbox className="h-4 w-4 text-white" strokeWidth={2.25} aria-hidden="true" />
              </span>
              <h1 className="text-[22px] font-bold uppercase tracking-[0.04em] text-text sm:text-[24px]">
                Enquiry
              </h1>
            </div>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
              Manage incoming transport requests, vehicle availability, driver assignment and customer
              quotations.
            </p>
          </div>
          <p className="shrink-0 text-[11.5px] text-muted sm:text-right">
            Open an enquiry to assign a vehicle and driver, set the final quote and send it to the customer.
          </p>
        </header>

        {/* ── Operational summary ──────────────────────────────────────── */}
        <EnquiryKpiStrip defs={KPI_DEFS} counts={counts} activeKey={status} onSelect={setStatus} />

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <EnquiryFilters
          status={status}
          onStatusChange={(key) => {
            setStatus(key);
            setPage(1);
          }}
          counts={counts}
          countsLoading={countsLoading}
          search={search}
          onSearchChange={setSearch}
          onRefresh={refreshAll}
          refreshing={loading}
          resultLabel={resultLabel}
        />

        {/* ── Table ────────────────────────────────────────────────────── */}
        <EnquiryTable
          rows={rows}
          loading={loading}
          error={error}
          onOpen={openEnquiry}
          onRetry={refreshAll}
          emptyTitle={debouncedSearch ? 'No enquiries match this search' : 'No enquiries in this view'}
          emptySubtitle={
            debouncedSearch
              ? 'Try a different enquiry ID, customer, mobile, city, goods or vehicle.'
              : 'Nothing is waiting on this stage right now. Pick another status to see more.'
          }
        />

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {pagination.pages > 1 && !error ? (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-[12.5px] text-muted">
            <span>
              Page {page} of {pagination.pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border bg-white px-3 py-1.5 font-semibold text-text transition hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pagination.pages}
                className="rounded-lg border border-border bg-white px-3 py-1.5 font-semibold text-text transition hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
