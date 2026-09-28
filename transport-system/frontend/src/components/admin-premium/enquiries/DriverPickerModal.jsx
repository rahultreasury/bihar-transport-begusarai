/**
 * DriverPickerModal.jsx
 * ---------------------------------------------------------------------------
 * The single driver picker used by the whole booking/enquiry quote flow.
 *
 * ONE COMPONENT, ONE API
 *   Data comes from the EXISTING scalable endpoint
 *   GET /api/admin/booking-drivers?page&limit&search&status&vehicle_type
 *   (adminBookingController.getAssignableDrivers → DriverRepository.findAssignable).
 *   Only a bounded page is ever held in memory, so 10k+ drivers are fine.
 *   Each row carries the driver's real registered vehicle — one driver, one
 *   vehicle — which the quote service auto-resolves on send.
 *
 * It is shared by the full-page ENQUIRY workspace and the Bookings drawer so
 * the two never drift apart.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Search, Star, Truck, UserRound, X } from 'lucide-react';
import { adminAPI } from '../../../services/api';
import { EmptyBlock, ErrorBlock, LoadingBlock, inputClass } from './EnquiryUI';
import { apiErrorMessage } from './enquiryStatus';

const VEHICLE_TYPE_OPTIONS = [
  { value: '', label: 'All Vehicle Types' },
  { value: 'truck', label: 'Truck' },
  { value: 'mini_truck', label: 'Mini Truck' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'tata_ace', label: 'Tata Ace' },
  { value: 'ashok_leyland_dost', label: 'Dost' },
  { value: 'container', label: 'Container' },
];

export default function DriverPickerModal({
  open,
  onClose,
  onSelect,
  selectedDriverId = null,
  title = 'Search & Select Driver',
  subtitle = 'Real drivers from your fleet',
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const listRef = useRef(null);
  const pageRef = useState(1);
  const loadingRef = useState(false);
  const searchRef = useRef('');
  const statusRef = useState('');
  const vehicleTypeRef = useState('');

  /**
   * Reset every time the modal opens so a previous search never leaks across.
   *
   * `loadingRef.current` MUST be cleared here too. It is the in-flight guard
   * inside fetchPage(); if the modal was closed while a request was still
   * pending, the guard stayed `true` forever and every later fetch returned
   * immediately without requesting anything — which is what produced an
   * endlessly EMPTY "0 drivers" list. Resetting it on open makes the guard
   * self-healing.
   */
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setStatus('');
    setVehicleType('');
    setDrivers([]);
    setError(null);
    setLoading(false);
    setHasMore(false);
    pageRef.current = 1;
    loadingRef.current = false;
    searchRef.current = '';
    statusRef.current = '';
    vehicleTypeRef.current = '';
  }, [open]);

  const fetchPage = useCallback(
    async (page, { append = false } = {}) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const response = await adminAPI.getAssignableDrivers({
          page,
          limit: 20,
          search: searchRef.current,
          status: statusRef.current,
          vehicle_type: vehicleTypeRef.current,
        });

        const body = response?.data;

        if (body?.success) {
          const rows = Array.isArray(body.data) ? body.data : [];
          setDrivers((prev) => (append ? [...prev, ...rows] : rows));
          setTotal(Number(body.pagination?.total) || 0);
          pageRef.current = page;
          setHasMore(page < (Number(body.pagination?.pages) || 1));
        } else {
          // Surface the server's own reason instead of a blanket "Server error".
          const reason = body?.message || `Unexpected response (HTTP ${response?.status ?? '?'})`;
          setError(`Unable to load drivers. ${reason}`);
        }
      } catch (err) {
        const status = err?.response?.status;
        const reason = err?.response?.data?.message;
        if (status === 403) {
          setError('You do not have permission to view the driver list.');
        } else if (status === 401) {
          setError('Your session has expired. Please sign in again.');
        } else {
          setError(
            reason ? `Unable to load drivers. ${reason}` : apiErrorMessage(err, 'Unable to load drivers.'),
          );
        }
      } finally {
        // Always release the guard, even if this component unmounted mid-flight.
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [],
  );

  // Debounced server-side search — the single source of truth for fetching.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      searchRef.current = search.trim();
      statusRef.current = status;
      vehicleTypeRef.current = vehicleType;
      fetchPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, status, vehicleType, open, fetchPage]);

  // Lock background scroll while the picker is open.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && hasMore && !loadingRef.current) {
      fetchPage(pageRef.current + 1, { append: true });
    }
  }, [fetchPage, hasMore]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />

      <div className="relative flex h-full w-full flex-col overflow-hidden border border-border bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500">
              <UserRound className="h-4 w-4 text-white" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-bold text-text">{title}</h2>
              <p className="truncate text-[11.5px] text-muted">
                {loading && drivers.length === 0
                  ? 'Loading drivers…'
                  : `${total.toLocaleString('en-IN')} drivers · vehicle auto-assigned from the driver`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close driver picker"
            className="h-8 w-8 shrink-0 rounded-lg border border-border text-text transition hover:bg-slate-50"
          >
            <X className="mx-auto h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="shrink-0 space-y-2.5 border-b border-border px-4 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, driver ID, mobile, vehicle number or type…"
              aria-label="Search drivers"
              className={`${inputClass} pl-8`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter drivers by availability"
              className={`${inputClass} font-semibold`}
            >
              <option value="">All Status</option>
              <option value="available">Available</option>
              <option value="on_trip">On Trip</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              aria-label="Filter drivers by vehicle type"
              className={`${inputClass} font-semibold`}
            >
              {VEHICLE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="min-h-[180px] flex-1 space-y-2 overflow-y-auto px-4 py-3"
        >
          {error ? (
            <ErrorBlock
              message={error}
              onRetry={() => {
                searchRef.current = search.trim();
                statusRef.current = status;
                vehicleTypeRef.current = vehicleType;
                fetchPage(1);
              }}
            />
          ) : null}

          {!error && loading && drivers.length === 0 ? <LoadingBlock label="Loading drivers" rows={5} /> : null}

          {!error && !loading && drivers.length === 0 ? (
            <EmptyBlock
              title="No drivers found"
              subtitle="Adjust the search or filters to find an available driver."
            />
          ) : null}

          {drivers.map((driver) => {
            const name =
              driver.driver_name ||
              `${driver.first_name || ''} ${driver.last_name || ''}`.trim() ||
              `Driver #${driver.driver_id}`;
            const code = driver.driver_code || `DRV${String(driver.driver_id).padStart(6, '0')}`;
            const vehicle = driver.vehicle;
            const chosen = selectedDriverId === driver.driver_id;
            return (
              <button
                key={driver.driver_id}
                type="button"
                onClick={() => onSelect?.(driver)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  chosen ? 'border-amber-500 bg-amber-50/60' : 'border-border hover:border-amber-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1e3a5f] text-[12px] font-bold text-white">
                    {name
                      .split(' ')
                      .filter(Boolean)
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-bold text-text">{name}</span>
                      <span className="font-mono text-[10.5px] text-muted">{code}</span>
                      <span
                        className={`rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                          driver.status === 'available'
                            ? 'bg-emerald-50 text-emerald-700'
                            : driver.status === 'on_trip'
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {String(driver.status || 'available').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted">
                      <span>{driver.mobile || '—'}</span>
                      {driver.rating != null ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="h-3 w-3 text-amber-500" strokeWidth={0} fill="currentColor" aria-hidden="true" />
                          {driver.rating}
                        </span>
                      ) : null}
                      {typeof driver.todayTrips === 'number' ? <span>{driver.todayTrips} today</span> : null}
                      {typeof driver.total_deliveries === 'number' ? (
                        <span>{driver.total_deliveries} trips</span>
                      ) : null}
                    </div>
                    {vehicle ? (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                        <Truck className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                        {vehicle.vehicle_number}
                        {vehicle.vehicle_type ? ` · ${String(vehicle.vehicle_type).replace(/_/g, ' ')}` : ''}
                        {vehicle.capacity_kg ? ` · ${vehicle.capacity_kg} kg` : ''}
                      </p>
                    ) : (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
                        <AlertCircle className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                        No vehicle registered
                      </p>
                    )}
                  </div>
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      chosen ? 'border-amber-500 bg-amber-500' : 'border-border'
                    }`}
                  >
                    {chosen ? <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" /> : null}
                  </span>
                </div>
              </button>
            );
          })}

          {loading && drivers.length > 0 ? (
            <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-muted">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              Loading more drivers…
            </div>
          ) : null}
          {!loading && hasMore ? (
            <p className="py-2 text-center text-[11.5px] text-muted">Scroll for more drivers…</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
