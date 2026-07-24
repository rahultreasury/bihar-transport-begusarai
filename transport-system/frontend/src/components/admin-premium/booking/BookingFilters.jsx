import React, { useRef } from 'react';
import { getAllStatuses } from './StatusBadge';

const BookingFilters = React.memo(function BookingFilters({
  search, onSearchChange,
  status, onStatusChange,
  goodsType, onGoodsTypeChange,
  pickupCity, onPickupCityChange,
  dropCity, onDropCityChange,
  dateFrom, onDateFromChange,
  dateTo, onDateToChange,
  priceMin, onPriceMinChange,
  priceMax, onPriceMaxChange,
  onReset,
  activeFilterCount,
  showFilters,
  onToggleFilters
}) {
  const searchInputRef = useRef(null);

  return (
    <div className="space-y-3 w-full max-w-full">
      {/* Search + Filter Toggle Row */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-full lg:max-w-md">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by booking #, customer, mobile, city..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
            aria-label="Search bookings"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-3 flex items-center text-muted hover:text-text transition"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={onToggleFilters}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium hover:bg-hover/60 transition-all"
          aria-label="Toggle filters"
          aria-expanded={showFilters}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={onReset}
            className="px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 transition-all"
            aria-label="Reset all filters"
          >
            Reset
          </button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Advanced Filters</div>
            <button
              onClick={onReset}
              className="text-xs font-medium text-red-500 hover:text-red-400 transition"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by status"
              >
                <option value="">All Statuses</option>
                {getAllStatuses().map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Goods Type</label>
              <input
                type="text"
                value={goodsType}
                onChange={(e) => onGoodsTypeChange(e.target.value)}
                placeholder="e.g. Electronics"
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Pickup City</label>
              <input
                type="text"
                value={pickupCity}
                onChange={(e) => onPickupCityChange(e.target.value)}
                placeholder="e.g. Patna"
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Drop City</label>
              <input
                type="text"
                value={dropCity}
                onChange={(e) => onDropCityChange(e.target.value)}
                placeholder="e.g. Gaya"
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Price Range</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={priceMin}
                  onChange={(e) => onPriceMinChange(e.target.value)}
                  placeholder="Min"
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
                <span className="text-muted text-xs">—</span>
                <input
                  type="number"
                  value={priceMax}
                  onChange={(e) => onPriceMaxChange(e.target.value)}
                  placeholder="Max"
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default BookingFilters;

