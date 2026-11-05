/**
 * EnquiryFilters.jsx
 * ---------------------------------------------------------------------------
 * Sticky status navigation + search for the ENQUIRY queue.
 *
 * Clicking a chip re-filters the EXISTING list endpoint
 * (GET /api/admin/bookings?quote_status=…). No client-side fake filtering and
 * no new endpoint: `ACTIONABLE` and the comma-separated groups are resolved
 * server-side by BookingRepository.listBookings.
 *
 * Search is debounced and passed to the same endpoint's `search` parameter,
 * which matches enquiry/booking id, customer name, mobile, pickup, drop, goods
 * and vehicle against the real database rows.
 */

import React from 'react';
import { RotateCw, Search, X } from 'lucide-react';
import { STATUS_FILTERS } from './enquiryStatus';

const CHIP_ACTIVE = 'border-[#1e3a5f] bg-[#1e3a5f] text-white';
const CHIP_IDLE = 'border-border bg-white text-text hover:border-slate-300 hover:bg-slate-50';

export default function EnquiryFilters({
  status,
  onStatusChange,
  counts,
  countsLoading,
  search,
  onSearchChange,
  onRefresh,
  refreshing,
  resultLabel,
}) {
  return (
    <div className="sticky top-0 z-20 -mx-1 space-y-2.5 bg-surface/95 px-1 py-2">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        {/* Status navigation */}
        <div
          className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0"
          role="tablist"
          aria-label="Filter enquiries by quote status"
        >
          {STATUS_FILTERS.map((f) => {
            const count = counts?.[f.key];
            const isActive = status === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => onStatusChange(f.key)}
                className={`inline-flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition ${
                  isActive ? CHIP_ACTIVE : CHIP_IDLE
                }`}
              >
                {f.label}
                {count !== null && count !== undefined ? (
                  <span
                    className={`rounded px-1 py-px text-[10.5px] font-bold tabular-nums ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-muted'
                    }`}
                  >
                    {countsLoading && !isActive ? '·' : count.toLocaleString('en-IN')}
                  </span>
                ) : (
                  <span className="h-3 w-5 rounded bg-skeleton animate-pulse" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        {/* Search + refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-72 lg:flex-none">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search enquiries…"
              aria-label="Search enquiries by id, customer, mobile, pickup, drop, goods or vehicle"
              className="w-full rounded-lg border border-border bg-white py-2 pl-8 pr-8 text-[13px] text-text outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition hover:bg-slate-100 hover:text-text"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>
      </div>

      {resultLabel ? (
        <p className="text-[11.5px] text-muted" aria-live="polite">
          {resultLabel}
        </p>
      ) : null}
    </div>
  );
}
